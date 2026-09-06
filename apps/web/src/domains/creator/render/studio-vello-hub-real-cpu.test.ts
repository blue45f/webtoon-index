import { loadVelloNode } from "@toonspectrum/studio-engine-vello/node";
import { beforeAll, describe, expect, it } from "vitest";

import { buildStudioDocumentPresentScene } from "./studio-document-scene-present";
import {
  createStudioVelloCpuReferenceBackend,
  lowerStudioSceneOverlaysToVelloIsland,
  StudioVelloHub,
  STUDIO_VELLO_CLASSIC_BACKEND_ID,
  STUDIO_VELLO_CPU_BACKEND_ID,
  type StudioVelloBackendFrame,
  type StudioVelloHubBackend,
} from "./studio-vello-hub";

import type { El } from "../studio-element-model";

beforeAll(async () => {
  await loadVelloNode();
});

describe("VelloHub real CPU vertical slice", () => {
  it("renders the lowered product selection island deterministically with real vello_cpu wasm", async () => {
    const admission = lowerStudioSceneOverlaysToVelloIsland(
      [
        {
          documentId: "real-selection",
          zIndex: 0,
          fill: { color: 0x2563eb, alpha: 0.2 },
          stroke: { color: 0x2563eb, alpha: 1, width: 2 },
          shape: {
            kind: "rect",
            bounds: { x: 8, y: 8, width: 40, height: 32 },
          },
        },
      ],
      { width: 64, height: 64, dpr: 1 },
    );
    expect(admission.admitted).toBe(true);
    if (!admission.admitted) return;

    const backend = createStudioVelloCpuReferenceBackend();
    const first = await backend.render(admission.island.scene);
    const second = await backend.render(admission.island.scene);
    expect(first.kind).toBe("pixels");
    expect(second.kind).toBe("pixels");
    if (first.kind !== "pixels" || second.kind !== "pixels") return;
    expect(first.backendId).toBe(STUDIO_VELLO_CPU_BACKEND_ID);
    expect(first.pixels).toEqual(second.pixels);
    let nonTransparentPixels = 0;
    for (let index = 3; index < first.pixels.length; index += 4) {
      if ((first.pixels[index] ?? 0) > 0) nonTransparentPixels += 1;
    }
    expect(nonTransparentPixels).toBeGreaterThan(500);
    expect(nonTransparentPixels).toBeLessThan(
      admission.island.scene.width * admission.island.scene.height,
    );
  });
});

/**
 * CPU remains an independent golden/reference renderer for lowered geometry.
 * Product WebGPU failure is tested separately as fail-closed: it never invokes
 * this software rasteriser without an explicit reference request.
 */
describe("Comic line geometry CPU reference lane", () => {
  const focusElement = {
    id: "burst",
    type: "focusLines",
    x: 6,
    y: 6,
    width: 112,
    height: 112,
    lineCount: 24,
    innerRadius: 12,
    outerRadius: 54,
    stroke: "#000000",
    strokeWidth: 2,
    noise: 8,
    rotation: 0,
  } as unknown as El;

  function presentScene(element: El) {
    return buildStudioDocumentPresentScene({
      elements: [element],
      documentWidth: 128,
      documentHeight: 128,
      viewportWidth: 128,
      viewportHeight: 128,
      dpr: 1,
    });
  }

  function opaquePixelCount(pixels: Uint8Array): number {
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) > 0) count += 1;
    }
    return count;
  }

  it("renders the lowered focus-line page on real vello_cpu with no WebGPU present", async () => {
    const present = presentScene(focusElement);
    // The page is exclusively vector, so Konva hands the pixels over.
    expect(present.ownedDocumentIds).toEqual(["burst"]);
    expect(present.scene.nodes).toHaveLength(24);

    const backend = createStudioVelloCpuReferenceBackend();
    const first = await backend.render(present.scene);
    const second = await backend.render(present.scene);
    expect(first.kind).toBe("pixels");
    if (first.kind !== "pixels" || second.kind !== "pixels") return;
    expect(first.pixels).toEqual(second.pixels);
    expect(opaquePixelCount(first.pixels)).toBeGreaterThan(500);
  });

  it("actually applies element rotation on the reference lane", async () => {
    // The lowering used to ignore speed-line rotation entirely and pivot focus
    // rays about the pattern centre. Identical pixels here would mean rotation
    // never reached the renderer.
    const backend = createStudioVelloCpuReferenceBackend();
    const upright = await backend.render(presentScene(focusElement).scene);
    const turned = await backend.render(
      presentScene({ ...focusElement, rotation: 37 } as El).scene,
    );
    if (upright.kind !== "pixels" || turned.kind !== "pixels") throw new Error("expected pixels");
    expect(turned.pixels).not.toEqual(upright.pixels);
    expect(opaquePixelCount(turned.pixels)).toBeGreaterThan(0);
  });

  it("does not render CPU automatically when the GPU backend fails", async () => {
    const present = presentScene(focusElement);
    const presented: StudioVelloBackendFrame[] = [];
    const held: string[] = [];
    const released: string[] = [];
    const lostGpuBackend: StudioVelloHubBackend = {
      id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
      async availability() {
        return { available: true, reason: null };
      },
      async render() {
        throw new Error("GPUDevice was lost");
      },
      dispose() {
        // Test double owns no resources.
      },
    };
    const hub = new StudioVelloHub({
      target: {
        async present(frame) {
          presented.push(frame);
        },
        holdLastGood(reason) {
          held.push(reason);
        },
        releaseLostDevice(reason) {
          released.push(reason);
        },
      },
      classicBackend: lostGpuBackend,
      hybridBackend: lostGpuBackend,
      cpuBackend: createStudioVelloCpuReferenceBackend(),
      subscribeDeviceLoss: () => () => undefined,
    });

    await expect(hub.render(present.scene)).rejects.toMatchObject({
      name: "StudioVelloHubUnavailableError",
      failure: { source: "render", reason: "GPUDevice was lost" },
    });
    expect(presented).toEqual([]);
    expect(held.at(-1)).toContain("unavailable-render:GPUDevice was lost");

    const receipt = await hub.renderReference(present.scene);
    expect(receipt).toMatchObject({
      backendId: STUDIO_VELLO_CPU_BACKEND_ID,
      decision: "reference",
      referenceOnly: true,
    });
    const frame = presented.at(-1);
    expect(frame?.kind).toBe("pixels");
    if (frame?.kind !== "pixels") return;
    // The separately requested reference frame still carries the artwork.
    expect(opaquePixelCount(frame.pixels)).toBeGreaterThan(500);
    hub.dispose();
  });
});
