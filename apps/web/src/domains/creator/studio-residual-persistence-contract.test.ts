import { describe, expect, it } from "vitest";

import {
  createDefaultStudioDrawingAssistDocument,
} from "./brush/studio-drawing-assist-document";
import {
  studioCrdtElementToSceneElement,
  studioCrdtStrokeToDrawElement,
  studioDrawElementToCrdtStroke,
  studioElementToCrdtSceneElement,
  studioPageToCrdtPage,
} from "./live/studio-crdt-page-bridge";
import {
  parseStudioAutosave,
  serializeStudioAutosave,
  type StudioAutosavePayload,
} from "./studio-autosave";
import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";
import {
  createStudioIsometricPrimitiveElements,
  planStudioIsometricPrimitive,
  type StudioIsometricPrimitiveInput,
} from "./studio-isometric-solid";
import {
  buildStudioProjectArchive as buildStudioProjectArchiveWithBackend,
  importStudioProjectArchive,
} from "./studio-project-archive";
import {
  parseStudioProjectFile,
  serializeStudioProjectFile,
} from "./studio-project-file";
import {
  DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW,
  type StudioReferenceBoardDocument,
} from "./studio-reference-board";
import {
  prepareStudioReferenceBoardArchiveExport,
} from "./studio-reference-board-archive";
import {
  buildStudioSharedSavePatch,
  type StudioSavePayload,
} from "./studio-save-payload";
import {
  normalizeStudioSharedDocumentPatch,
} from "./studio-shared-document-client";
import {
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
} from "./vrm/studio-vrm-scene-document";

import type {
  StudioCrdtSceneElementRecord,
  StudioCrdtStrokeRecord,
} from "./live/studio-crdt-document";
import type { StudioAsset } from "./studio-asset-library";
import type { DrawEl, El, ImageEl } from "./studio-element-model";

function buildStudioProjectArchive(
  input: Parameters<typeof buildStudioProjectArchiveWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioProjectArchiveWithBackend>[1]> = {},
): ReturnType<typeof buildStudioProjectArchiveWithBackend> {
  return buildStudioProjectArchiveWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

const SAVED_AT = "2026-07-20T00:00:00.000Z";

function project(elements: readonly unknown[], extra: Record<string, unknown> = {}) {
  return {
    version: 2 as const,
    title: "잔여 경계 영속성",
    description: "",
    tagsText: "",
    pagesList: [{
      id: "page-1",
      elements: [...elements],
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 1_200,
    }],
    currentPageId: "page-1",
    webtoonTheme: "classic" as const,
    panelGutter: 24,
    ...extra,
  };
}

function autosavePayload(
  pagesList: StudioAutosavePayload["pagesList"],
  extra: Partial<StudioAutosavePayload> = {}
): StudioAutosavePayload {
  return {
    version: 2,
    savedAt: SAVED_AT,
    pagesList,
    ...extra,
  };
}

function primitiveElements(): DrawEl[] {
  const inputs: StudioIsometricPrimitiveInput[] = [
    {
      kind: "cylinder",
      originX: 260,
      originY: 520,
      angleDeg: 30,
      width: 160,
      depth: 120,
      height: 180,
      segments: 24,
    },
    {
      kind: "stairs",
      originX: 420,
      originY: 760,
      angleDeg: 30,
      width: 220,
      depth: 280,
      height: 160,
      steps: 8,
    },
    {
      kind: "wedge",
      originX: 620,
      originY: 900,
      angleDeg: 30,
      width: 180,
      depth: 140,
      height: 120,
    },
  ];
  return inputs.flatMap((input, primitiveIndex) => {
    const plan = planStudioIsometricPrimitive(input);
    return createStudioIsometricPrimitiveElements(plan, {
      ids: plan.faces.map((_, faceIndex) => `primitive-${primitiveIndex}-face-${faceIndex}`),
      baseColor: "#6366f1",
      strokeColor: "#111827",
      strokeWidth: 2,
    });
  });
}

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${globalThis.btoa(binary)}`;
}

async function contentHash(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const copy = bytes.slice();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function sharedSavePayload(doc: Record<string, unknown>): StudioSavePayload {
  return {
    title: "잔여 경계 영속성",
    description: "",
    tags: [],
    format: "cuttoon",
    cover: "",
    pages: [],
    doc,
    status: "draft",
  };
}

describe("Studio residual feature persistence contract", () => {
  it("round-trips cylinder, stairs, and wedge faces through project, autosave, archive, and stroke CRDT", async () => {
    const faces = primitiveElements();
    const parsed = parseStudioProjectFile(project(faces));
    const serialized = serializeStudioProjectFile(parsed);
    const reparsed = parseStudioProjectFile(JSON.parse(serialized));
    expect(reparsed.pagesList[0]?.elements).toEqual(faces);

    const restoredAutosave = parseStudioAutosave(serializeStudioAutosave(
      autosavePayload(reparsed.pagesList)
    ));
    expect(restoredAutosave?.pagesList[0]?.elements).toEqual(faces);

    const crdtRoundTrip = faces.map((face, orderIndex) => {
      const encoded = studioDrawElementToCrdtStroke("page-1", face);
      const record: StudioCrdtStrokeRecord = {
        ...encoded,
        status: "finalized",
        deleted: false,
        orderIndex,
      };
      return studioCrdtStrokeToDrawElement(record);
    });
    crdtRoundTrip.forEach((face, index) => {
      expect(face).toMatchObject(faces[index]!);
    });

    const archived = await buildStudioProjectArchive({ project: reparsed });
    const imported = await importStudioProjectArchive(archived.blob, {
      rehydrateDataUrls: false,
    });
    expect(imported.project.pagesList[0]?.elements).toEqual(faces);
  });

  it("keeps a remotely acquired reference hash-only in shared JSON and carries its bytes in the authenticated archive", async () => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const hash = await contentHash(bytes);
    const board: StudioReferenceBoardDocument = {
      version: 1,
      items: [{
        id: "remote-reference",
        asset: {
          sha256: hash,
          assetId: "device-local-remote-reference",
          name: "원격 포즈 참고.png",
          mimeType: "image/png",
          width: 640,
          height: 360,
        },
        view: { ...DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW, zoom: 1.5 },
      }],
    };
    const remoteAsset: StudioAsset = {
      id: "device-local-remote-reference",
      name: "원격 포즈 참고",
      dataUrl: dataUrl("image/png", bytes),
      contentHash: hash,
      width: 640,
      height: 360,
      createdAt: 1,
      kind: "remote-reference",
    };
    const parsed = parseStudioProjectFile(project([], { referenceBoard: board }));
    const patch = normalizeStudioSharedDocumentPatch(buildStudioSharedSavePatch({
      payload: sharedSavePayload({
        width: 800,
        pagesList: parsed.pagesList,
        referenceBoard: parsed.referenceBoard,
      }),
      baseRevision: 7,
      crdtServerSequence: "19",
      role: "editor",
    }));
    expect(patch.doc?.referenceBoard).toEqual(board);
    expect(JSON.stringify(patch.doc)).not.toContain("https://");
    expect(JSON.stringify(patch.doc)).not.toContain("data:image");
    expect(creatorWorkSnapshotToStudioProject({
      title: "잔여 경계 영속성",
      description: "",
      tags: [],
      doc: patch.doc,
    }).referenceBoard).toEqual(board);

    const prepared = await prepareStudioReferenceBoardArchiveExport(parsed, {
      listAssets: async () => [remoteAsset],
    });
    expect(prepared).toMatchObject({ isComplete: true, missing: [], diagnostics: [] });
    const archived = await buildStudioProjectArchive({
      project: parsed,
      attachments: prepared.attachments,
    });
    const imported = await importStudioProjectArchive(archived.blob, {
      rehydrateDataUrls: false,
    });
    expect(imported.isSelfContained).toBe(true);
    expect(imported.project.referenceBoard).toEqual(board);
    expect(imported.attachments.get(hash.slice("sha256:".length))?.blob.size)
      .toBe(bytes.byteLength);
  });

  it("preserves drawing-assist v2 and VRM scene v3 translations across CRDT, autosave, shared save, and archive", async () => {
    const drawingAssist = createDefaultStudioDrawingAssistDocument({
      canvasWidth: 800,
      canvasHeight: 1_200,
    });
    drawingAssist.advanced.rulers.push({
      id: "curve-a",
      type: "curve",
      name: "동작 곡선",
      enabled: true,
      visible: true,
      scope: { kind: "page", groupId: null },
      snapMode: "on-curve",
      fixedOffset: 0,
      p0: { x: 80, y: 920 },
      p1: { x: 240, y: 520 },
      p2: { x: 520, y: 420 },
      p3: { x: 720, y: 860 },
    });
    drawingAssist.advanced.activeSnapRulerId = "curve-a";
    drawingAssist.advanced.selectedRulerId = "curve-a";

    const baseScene = createStudioVrmSceneDocument();
    const vrmScene = normalizeStudioVrmSceneDocument({
      ...baseScene,
      pose: {
        ...baseScene.pose,
        yOffset: 0.35,
        translations: {
          version: 1,
          root: [1.25, 0, -0.8],
          hips: [0.3, 0.45, -0.2],
          spine: [-0.15, 0.2, 0.1],
        },
      },
      rig: {
        ...baseScene.rig,
        fullBodyIk: true,
        footPlant: true,
      },
    });
    const image = {
      id: "vrm-raster",
      type: "image",
      src: "work-asset://image/vrm-raster",
      x: 120,
      y: 80,
      width: 560,
      height: 840,
      rotation: 0,
      vrmScene,
    } as ImageEl;
    const parsed = parseStudioProjectFile(project([image], {
      pagesList: [{
        id: "page-1",
        elements: [image],
        bg: "#ffffff",
        bgGrad: null,
        canvasH: 1_200,
        drawingAssist,
      }],
    }));

    const pagePayload = studioPageToCrdtPage({
      ...(parsed.pagesList[0] as {
        id: string;
        elements: El[];
        bg: string;
        bgGrad: string[] | null;
        canvasH: number;
      }),
      drawingAssist,
    });
    expect(pagePayload.payload.props.drawingAssist).toEqual(drawingAssist);

    const topology = studioElementToCrdtSceneElement("page-1", image);
    // VRM authoring metadata stays in the canonical project source; the realtime reference owns
    // only bounded topology/placement and must neither duplicate nor erase that larger document.
    expect(topology.payload.props).not.toHaveProperty("vrmScene");
    const topologyRecord: StudioCrdtSceneElementRecord = {
      ...topology,
      deleted: false,
      orderIndex: 0,
    };
    const topologyRoundTrip = studioCrdtElementToSceneElement(topologyRecord, image) as ImageEl;
    expect(topologyRoundTrip.vrmScene).toEqual(vrmScene);
    expect(topologyRoundTrip.vrmScene?.pose.translations).toEqual({
      version: 1,
      root: [1.25, 0, -0.8],
      hips: [0.3, 0.45, -0.2],
      spine: [-0.15, 0.2, 0.1],
    });

    const restoredAutosave = parseStudioAutosave(serializeStudioAutosave(autosavePayload(
      parsed.pagesList as StudioAutosavePayload["pagesList"]
    )));
    const restoredImage = restoredAutosave?.pagesList[0]?.elements?.[0] as ImageEl | undefined;
    expect(restoredAutosave?.pagesList[0]?.drawingAssist).toEqual(drawingAssist);
    expect(restoredImage?.vrmScene).toEqual(vrmScene);

    const patch = normalizeStudioSharedDocumentPatch(buildStudioSharedSavePatch({
      payload: sharedSavePayload({ width: 800, pagesList: parsed.pagesList }),
      baseRevision: 8,
      crdtServerSequence: "20",
      role: "editor",
    }));
    const sharedPage = (patch.doc?.pagesList as Array<{
      drawingAssist?: unknown;
      elements: Array<{ vrmScene?: unknown }>;
    }>)[0]!;
    expect(sharedPage.drawingAssist).toEqual(drawingAssist);
    expect(sharedPage.elements[0]?.vrmScene).toEqual(vrmScene);
    const hydratedSharedProject = creatorWorkSnapshotToStudioProject({
      title: "잔여 경계 영속성",
      description: "",
      tags: [],
      doc: patch.doc,
    });
    expect(hydratedSharedProject.pagesList[0]?.drawingAssist).toEqual(drawingAssist);
    expect((hydratedSharedProject.pagesList[0]?.elements[0] as ImageEl).vrmScene)
      .toEqual(vrmScene);

    const archived = await buildStudioProjectArchive({ project: parsed });
    const imported = await importStudioProjectArchive(archived.blob, {
      rehydrateDataUrls: false,
    });
    const archivedPage = imported.project.pagesList[0] as {
      drawingAssist?: unknown;
      elements: Array<{ vrmScene?: unknown }>;
    };
    expect(archivedPage.drawingAssist).toEqual(drawingAssist);
    expect(archivedPage.elements[0]?.vrmScene).toEqual(vrmScene);
  });
});
