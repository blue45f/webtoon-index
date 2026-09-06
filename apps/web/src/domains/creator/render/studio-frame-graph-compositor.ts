import {
  compileRenderIslands,
  type CompiledRenderIsland,
} from "@toonspectrum/studio-engine-registry";
import {
  renderSceneToSceneIR,
  type FrameGraphIR,
  type RenderSceneIR,
  type SceneIR,
} from "@toonspectrum/studio-project-model";

import { StudioGpuTextureRegistry } from "./studio-gpu-fabric";
import {
  STUDIO_VELLO_CLASSIC_BACKEND_ID,
  STUDIO_VELLO_HYBRID_BACKEND_ID,
  type StudioVelloHub,
  type StudioVelloHubBackendId,
  type StudioVelloHubRenderReceipt,
} from "./studio-vello-hub";

/**
 * StudioFrameGraphCompositor — owns the visible swapchain (V13 §6).
 *
 * Vello Classic/Hybrid render path-heavy and mixed islands onto fabric
 * textures. Skia islands are planned but never force a CPU readback on the
 * interactive path.
 */

export interface StudioFrameGraphCompileInput {
  readonly surfaceId?: string;
  readonly document: RenderSceneIR;
  readonly overlay?: SceneIR | null;
  readonly presentScene?: SceneIR | null;
  readonly ownedDocumentIds?: readonly string[];
  readonly deviceEpoch?: number;
  readonly dpr?: number;
}

export interface StudioFrameGraphExecuteReceipt {
  readonly graph: FrameGraphIR;
  readonly velloReceipts: readonly StudioVelloHubRenderReceipt[];
  readonly ownedDocumentIds: readonly string[];
  readonly providerHints: readonly string[];
  readonly visibleCanvasCount: 1 | 0;
  readonly interactiveCpuReadback: 0;
}

const HINT_TO_BACKEND: Record<
  string,
  Exclude<StudioVelloHubBackendId, "vello-cpu"> | null
> = {
  "vello-classic": STUDIO_VELLO_CLASSIC_BACKEND_ID,
  "vello-hybrid": STUDIO_VELLO_HYBRID_BACKEND_ID,
  "skia-gpu": null,
  "skia-cpu-reference": null,
};

function islandScene(document: RenderSceneIR, island: CompiledRenderIsland): SceneIR {
  return renderSceneToSceneIR({
    ...document,
    background: { r: 0, g: 0, b: 0, a: 0 },
    nodes: [...island.nodes],
  });
}

function pass(
  id: string,
  kind: FrameGraphIR["passes"][number]["kind"],
  dependencies: readonly string[],
  extra: Partial<FrameGraphIR["passes"][number]> = {},
): FrameGraphIR["passes"][number] {
  return {
    id,
    kind,
    dependencies: [...dependencies],
    reads: extra.reads ?? [],
    writes: extra.writes ?? [],
    islandId: extra.islandId,
    providerId: extra.providerId,
  };
}

export class StudioFrameGraphCompositor {
  readonly textures = new StudioGpuTextureRegistry();

  compile(input: StudioFrameGraphCompileInput): FrameGraphIR {
    const compiled = compileRenderIslands(input.document, {
      mode: "interactive",
      dpr: input.dpr,
    });
    const passes: FrameGraphIR["passes"] = [
      pass("resource-upload", "resource-upload", []),
    ];
    const islands: FrameGraphIR["islands"] = [];
    for (const island of compiled.islands) {
      const passKind = island.providerHint === "vello-classic"
        ? "vello-classic"
        : island.providerHint === "vello-hybrid"
          ? "vello-hybrid"
          : "skia-island";
      const passId = `pass-${island.id}`;
      passes.push(pass(passId, passKind, ["resource-upload"], {
        writes: [island.id],
        islandId: island.id,
        providerId: island.providerHint,
      }));
      islands.push({
        id: island.id,
        providerId: island.providerHint,
        transport: island.transport,
        textureHandle: island.id,
        documentIds: [...island.documentIds],
      });
    }
    if (input.overlay) {
      passes.push(pass(
        "interaction-overlay",
        "interaction-overlay",
        passes.map((item) => item.id),
      ));
    }
    passes.push(pass("present", "present", passes.map((item) => item.id)));
    return {
      version: 13,
      surfaceId: input.surfaceId ?? "studio-primary",
      deviceEpoch: input.deviceEpoch ?? 0,
      width: input.document.width,
      height: input.document.height,
      colorSpace: "srgb",
      textures: compiled.islands.map((island) => ({
        id: island.id,
        format: "rgba8unorm" as const,
        width: input.document.width,
        height: input.document.height,
        revision: 0,
      })),
      islands,
      passes,
    };
  }

  async execute(
    hub: StudioVelloHub,
    input: StudioFrameGraphCompileInput & { readonly penDown?: boolean },
  ): Promise<StudioFrameGraphExecuteReceipt> {
    const compiled = compileRenderIslands(input.document, {
      mode: "interactive",
      dpr: input.dpr,
    });
    if (compiled.rejectedInteractiveCpuReadback) {
      throw new Error("FrameGraph refused an interactive CPU readback plan");
    }
    const graph = this.compile(input);
    const velloReceipts: StudioVelloHubRenderReceipt[] = [];
    const ownedDocumentIds: string[] = [...(input.ownedDocumentIds ?? [])];
    // An explicit empty present scene means "park the swapchain". Do not fall
    // through to document islands — that would re-submit a full-page GPU frame
    // the caller just decided not to show.
    if (input.presentScene && input.presentScene.nodes.length === 0) {
      return {
        graph,
        velloReceipts,
        ownedDocumentIds: [...new Set(ownedDocumentIds)],
        providerHints: compiled.islands.map((island) => island.providerHint),
        visibleCanvasCount: 0,
        interactiveCpuReadback: 0,
      };
    }
    if (input.presentScene && input.presentScene.nodes.length > 0) {
      const pathHeavy = input.presentScene.nodes.filter((node) =>
        node.kind === "fill-path" || node.kind === "stroke-path",
      ).length >= 8;
      const receipt = await hub.render(input.presentScene, {
        penDown: input.penDown,
        preferredBackend: pathHeavy
          ? STUDIO_VELLO_CLASSIC_BACKEND_ID
          : STUDIO_VELLO_HYBRID_BACKEND_ID,
      });
      velloReceipts.push(receipt);
    } else {
      for (const island of compiled.islands) {
        const backend = HINT_TO_BACKEND[island.providerHint];
        if (!backend) continue;
        const scene = islandScene(input.document, island);
        if (scene.nodes.length === 0) continue;
        const receipt = await hub.render(scene, {
          penDown: input.penDown,
          preferredBackend: backend,
        });
        velloReceipts.push(receipt);
        ownedDocumentIds.push(...island.documentIds.map((id) => id.split(":")[0] ?? id));
      }
    }
    return {
      graph,
      velloReceipts,
      ownedDocumentIds: [...new Set(ownedDocumentIds)],
      providerHints: compiled.islands.map((island) => island.providerHint),
      visibleCanvasCount: 1,
      interactiveCpuReadback: 0,
    };
  }

  dispose(): void {
    this.textures.dispose();
  }
}
