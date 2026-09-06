import { beforeAll, describe, expect, it } from "vitest";

import {
  OpenCvUnavailableError,
  computeFloodMask,
  computeGrabCutMask,
  loadOpenCvForSelection,
  maskToPathIR,
  refineMaskEdges,
} from "./studio-opencv-selection";

import type { StudioSelectionPathArtifact } from "./studio-opencv-selection";
import type { CV } from "@techstark/opencv-js";
import type { SceneIR } from "@toonspectrum/studio-project-model";

/**
 * The skia engine is loaded through a runtime-resolved specifier on purpose:
 * the root app tsconfig maps `canvaskit-wasm` to a narrow type shim, so a
 * statically analyzable import of "@toonspectrum/studio-engine-skia" would
 * pull the engine sources (typed against the full canvaskit-wasm API) into
 * the root program and break `tsc --noEmit`. Runtime resolution keeps the
 * type universes separate while the test still drives the real engine.
 */
const SKIA_PACKAGE = "@toonspectrum/studio-engine-skia";

interface SkiaRenderModule {
  renderSceneToPixels(ck: unknown, scene: SceneIR): Uint8Array;
}

interface SkiaNodeModule {
  loadCanvasKitNode(): Promise<unknown>;
}

async function importSkiaModule(subpath: ""): Promise<SkiaRenderModule>;
async function importSkiaModule(subpath: "/node"): Promise<SkiaNodeModule>;
async function importSkiaModule(subpath: string): Promise<unknown> {
  return import(/* @vite-ignore */ `${SKIA_PACKAGE}${subpath}`);
}

function fillRgba(
  width: number,
  height: number,
  color: (x: number, y: number) => readonly [number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b] = color(x, y);
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

/** Red disc on a uniform dark background — the grabCut foreground target. */
function circleRgba(width: number, height: number, radius: number): Uint8Array {
  const centerX = width / 2;
  const centerY = height / 2;
  return fillRgba(width, height, (x, y) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return dx * dx + dy * dy <= radius * radius ? [220, 30, 30] : [40, 40, 40];
  });
}

function circleMask(width: number, height: number, radius: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const centerX = width / 2;
  const centerY = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radius * radius) mask[y * width + x] = 255;
    }
  }
  return mask;
}

function annulusMask(
  width: number,
  height: number,
  outerRadius: number,
  innerRadius: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const centerX = width / 2;
  const centerY = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= outerRadius * outerRadius && d2 >= innerRadius * innerRadius) {
        mask[y * width + x] = 255;
      }
    }
  }
  return mask;
}

function countSelected(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) if (value === 255) count += 1;
  return count;
}

function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < a.length; index += 1) {
    const inA = a[index]! > 127;
    const inB = b[index]! > 127;
    if (inA && inB) intersection += 1;
    if (inA || inB) union += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

describe("studio-opencv-selection", () => {
  let cv: CV;
  let skia: SkiaRenderModule;
  let ck: unknown;

  beforeAll(async () => {
    cv = await loadOpenCvForSelection();
    skia = await importSkiaModule("");
    const { loadCanvasKitNode } = await importSkiaModule("/node");
    ck = await loadCanvasKitNode();
  });

  /** Rasterizes the vectorized selection through the real canvaskit lane. */
  function renderArtifactMask(
    artifact: StudioSelectionPathArtifact,
    width: number,
    height: number,
  ): Uint8Array {
    const scene: SceneIR = {
      version: 11,
      width,
      height,
      background: { r: 0, g: 0, b: 0, a: 1 },
      nodes: [
        {
          id: "selection-fill",
          kind: "fill-path",
          path: artifact.path,
          paint: { kind: "solid", color: { r: 1, g: 1, b: 1, a: 1 } },
          fillRule: artifact.fillRule,
          opacity: 1,
          blend: "src-over",
        },
      ],
    };
    const pixels = skia.renderSceneToPixels(ck, scene);
    const rendered = new Uint8Array(width * height);
    for (let index = 0; index < rendered.length; index += 1) {
      rendered[index] = pixels[index * 4]! > 127 ? 255 : 0;
    }
    return rendered;
  }

  describe("loadOpenCvForSelection", () => {
    it("caches the default runtime load and exposes the selection capabilities", async () => {
      expect(typeof cv.grabCut).toBe("function");
      expect(typeof cv.floodFill).toBe("function");
      expect(typeof cv.approxPolyDP).toBe("function");
      const again = await loadOpenCvForSelection();
      expect(again).toBe(cv);
    });

    it("rejects with OpenCvUnavailableError when the loader itself fails", async () => {
      await expect(
        loadOpenCvForSelection({
          runtimeLoader: () => {
            throw new Error("no wasm here");
          },
        }),
      ).rejects.toBeInstanceOf(OpenCvUnavailableError);
    });

    it("rejects with OpenCvUnavailableError when required capabilities are missing", async () => {
      await expect(
        loadOpenCvForSelection({ runtimeLoader: () => ({ Mat: class {} }) }),
      ).rejects.toBeInstanceOf(OpenCvUnavailableError);
    });
  });

  describe("computeGrabCutMask", () => {
    const SIZE = 96;
    const RADIUS = 28;
    const RECT = { x: 16, y: 16, width: 64, height: 64 };

    it("extracts the foreground disc with IoU >= 0.85 against the ideal mask", async () => {
      const rgba = circleRgba(SIZE, SIZE, RADIUS);
      const mask = await computeGrabCutMask(rgba, SIZE, SIZE, RECT, 3, cv);
      expect(mask).toHaveLength(SIZE * SIZE);
      const ideal = circleMask(SIZE, SIZE, RADIUS);
      expect(maskIoU(mask, ideal)).toBeGreaterThanOrEqual(0.85);
      // Corners are far outside the rect and must stay background.
      expect(mask[0]).toBe(0);
      expect(mask[SIZE * SIZE - 1]).toBe(0);
    });

    it("is deterministic: identical inputs produce byte-identical masks", async () => {
      const rgba = circleRgba(SIZE, SIZE, RADIUS);
      const first = await computeGrabCutMask(rgba, SIZE, SIZE, RECT, 3, cv);
      const second = await computeGrabCutMask(rgba, SIZE, SIZE, RECT, 3, cv);
      expect(second).toEqual(first);
    });

    it("clamps an out-of-bounds rect to the image before running", async () => {
      const rgba = circleRgba(SIZE, SIZE, RADIUS);
      const clamped = await computeGrabCutMask(
        rgba,
        SIZE,
        SIZE,
        { x: -10, y: 8, width: 200, height: 80 },
        2,
        cv,
      );
      const explicit = await computeGrabCutMask(
        rgba,
        SIZE,
        SIZE,
        { x: 0, y: 8, width: SIZE, height: 80 },
        2,
        cv,
      );
      expect(clamped).toEqual(explicit);
    });

    it("fails closed on unusable inputs instead of guessing", async () => {
      const rgba = circleRgba(SIZE, SIZE, RADIUS);
      // A rect covering the full image leaves grabCut no background samples.
      await expect(
        computeGrabCutMask(rgba, SIZE, SIZE, { x: 0, y: 0, width: SIZE, height: SIZE }, 3, cv),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        computeGrabCutMask(rgba, SIZE, SIZE, { x: 200, y: 200, width: 10, height: 10 }, 3, cv),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        computeGrabCutMask(new Uint8Array(4), SIZE, SIZE, RECT, 3, cv),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        computeGrabCutMask(rgba, SIZE, SIZE, RECT, 0, cv),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        computeGrabCutMask(rgba, SIZE, SIZE, RECT, 1.5, cv),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("computeFloodMask", () => {
    const WIDTH = 64;
    const HEIGHT = 64;
    /** Left half value 60, right half value 200 — one hard vertical edge. */
    const twoTone = fillRgba(WIDTH, HEIGHT, (x) => {
      const value = x < WIDTH / 2 ? 60 : 200;
      return [value, value, value];
    });

    it("fills exactly the seeded flat region under a tight tolerance", async () => {
      const mask = await computeFloodMask(twoTone, WIDTH, HEIGHT, 5, 5, 30, {}, cv);
      expect(countSelected(mask)).toBe((WIDTH / 2) * HEIGHT);
      expect(mask[10 * WIDTH + 3]).toBe(255);
      expect(mask[10 * WIDTH + WIDTH - 3]).toBe(0);
    });

    it("grows monotonically with tolerance and saturates at full coverage", async () => {
      const GRADIENT_WIDTH = 128;
      const GRADIENT_HEIGHT = 32;
      const gradient = fillRgba(GRADIENT_WIDTH, GRADIENT_HEIGHT, (x) => {
        const value = x * 2;
        return [value, value, value];
      });
      const tolerances = [0, 10, 50, 100, 200, 255];
      const counts: number[] = [];
      for (const tolerance of tolerances) {
        counts.push(countSelected(
          await computeFloodMask(gradient, GRADIENT_WIDTH, GRADIENT_HEIGHT, 0, 0, tolerance, {}, cv),
        ));
      }
      for (let index = 1; index < counts.length; index += 1) {
        expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
      }
      // Strict growth across the gradient, full coverage at max tolerance.
      expect(counts[0]!).toBeLessThan(counts[3]!);
      expect(counts.at(-1)).toBe(GRADIENT_WIDTH * GRADIENT_HEIGHT);
    });

    it("clamps out-of-bounds seeds onto the nearest edge pixel", async () => {
      const fromNegative = await computeFloodMask(twoTone, WIDTH, HEIGHT, -9.7, -3, 30, {}, cv);
      const fromOrigin = await computeFloodMask(twoTone, WIDTH, HEIGHT, 0, 0, 30, {}, cv);
      expect(fromNegative).toEqual(fromOrigin);
      const fromFar = await computeFloodMask(twoTone, WIDTH, HEIGHT, 1_000, 1_000, 30, {}, cv);
      const fromCorner = await computeFloodMask(
        twoTone,
        WIDTH,
        HEIGHT,
        WIDTH - 1,
        HEIGHT - 1,
        30,
        {},
        cv,
      );
      expect(fromFar).toEqual(fromCorner);
    });

    it("honors 4- vs 8-connectivity across a diagonal corner touch", async () => {
      const SIZE = 16;
      const diagonal = fillRgba(SIZE, SIZE, (x, y) => {
        const inFirst = x >= 2 && x <= 5 && y >= 2 && y <= 5;
        const inSecond = x >= 6 && x <= 9 && y >= 6 && y <= 9;
        return inFirst || inSecond ? [200, 200, 200] : [0, 0, 0];
      });
      const four = await computeFloodMask(diagonal, SIZE, SIZE, 3, 3, 10, { connectivity: 4 }, cv);
      const eight = await computeFloodMask(diagonal, SIZE, SIZE, 3, 3, 10, { connectivity: 8 }, cv);
      expect(countSelected(four)).toBe(16);
      expect(countSelected(eight)).toBe(32);
    });
  });

  describe("refineMaskEdges", () => {
    const SIZE = 64;

    it("feathers a hard boundary into a gradient while keeping core and exterior", async () => {
      const mask = circleMask(SIZE, SIZE, 20);
      const refined = await refineMaskEdges(mask, SIZE, SIZE, { featherPx: 3 }, cv);
      const center = (SIZE / 2) * SIZE + SIZE / 2;
      expect(refined[center]).toBe(255);
      expect(refined[0]).toBe(0);
      let intermediate = 0;
      for (const value of refined) {
        if (value > 0 && value < 255) intermediate += 1;
      }
      // The feather band must exist around the ~125px circumference.
      expect(intermediate).toBeGreaterThan(100);
    });

    it("morphological opening removes speckles but preserves the main blob", async () => {
      const mask = circleMask(SIZE, SIZE, 15);
      const blobArea = countSelected(mask);
      const speckles = [[5, 5], [58, 6], [6, 58]] as const;
      for (const [x, y] of speckles) mask[y * SIZE + x] = 255;
      const refined = await refineMaskEdges(mask, SIZE, SIZE, { morphOpen: 1 }, cv);
      for (const [x, y] of speckles) expect(refined[y * SIZE + x]).toBe(0);
      expect(refined[(SIZE / 2) * SIZE + SIZE / 2]).toBe(255);
      expect(countSelected(refined)).toBeGreaterThanOrEqual(Math.floor(blobArea * 0.9));
    });

    it("returns an untouched defensive copy when no refinement is requested", async () => {
      const mask = circleMask(SIZE, SIZE, 12);
      const refined = await refineMaskEdges(mask, SIZE, SIZE, {}, cv);
      expect(refined).toEqual(mask);
      expect(refined).not.toBe(mask);
      await expect(
        refineMaskEdges(mask, SIZE, SIZE, { gaussian: 1 } as never, cv),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        refineMaskEdges(mask, SIZE, SIZE, { featherPx: -1 }, cv),
      ).rejects.toBeInstanceOf(RangeError);
    });
  });

  describe("maskToPathIR", () => {
    const SIZE = 128;

    it("round-trips a disc mask through canvaskit fill with IoU >= 0.9", async () => {
      const mask = circleMask(SIZE, SIZE, 40);
      const artifact = await maskToPathIR(mask, SIZE, SIZE, 1, cv);
      expect(artifact.fillRule).toBe("evenodd");
      expect(artifact.contourCount).toBe(1);
      expect(artifact.holeCount).toBe(0);
      const rendered = renderArtifactMask(artifact, SIZE, SIZE);
      expect(maskIoU(rendered, mask)).toBeGreaterThanOrEqual(0.9);
    });

    it("emits holes as evenodd subpaths that stay empty when rendered", async () => {
      const mask = annulusMask(SIZE, SIZE, 45, 20);
      const artifact = await maskToPathIR(mask, SIZE, SIZE, 1, cv);
      expect(artifact.contourCount).toBe(2);
      expect(artifact.holeCount).toBe(1);
      const rendered = renderArtifactMask(artifact, SIZE, SIZE);
      expect(maskIoU(rendered, mask)).toBeGreaterThanOrEqual(0.9);
      // The annulus hole center must remain unselected after the round-trip.
      expect(rendered[(SIZE / 2) * SIZE + SIZE / 2]).toBe(0);
    });

    it("simplifyEps trades vertices for simplicity without losing coverage", async () => {
      const mask = circleMask(SIZE, SIZE, 40);
      const raw = await maskToPathIR(mask, SIZE, SIZE, 0, cv);
      const simplified = await maskToPathIR(mask, SIZE, SIZE, 2, cv);
      expect(simplified.path.verbs.length).toBeLessThan(raw.path.verbs.length);
      const rendered = renderArtifactMask(simplified, SIZE, SIZE);
      expect(maskIoU(rendered, mask)).toBeGreaterThanOrEqual(0.9);
    });

    it("returns an empty path for an empty mask", async () => {
      const artifact = await maskToPathIR(new Uint8Array(SIZE * SIZE), SIZE, SIZE, 1, cv);
      expect(artifact.contourCount).toBe(0);
      expect(artifact.holeCount).toBe(0);
      expect(artifact.path.verbs).toHaveLength(0);
    });
  });

  describe("Mat lifetime hygiene", () => {
    function wasmHeapBytes(runtime: CV): number {
      const probe = new runtime.Mat(1, 1, runtime.CV_8UC1);
      try {
        return probe.data.buffer.byteLength;
      } finally {
        probe.delete();
      }
    }

    it(
      "keeps the wasm heap flat across a leak-forcing volume of selection calls",
      async () => {
        const SIZE = 512;
        const rgba = circleRgba(SIZE, SIZE, 160);
        const mask = circleMask(SIZE, SIZE, 160);
        const iterate = async (): Promise<void> => {
          await computeFloodMask(rgba, SIZE, SIZE, 8, 8, 40, {}, cv);
          await refineMaskEdges(mask, SIZE, SIZE, { featherPx: 2, morphOpen: 1 }, cv);
          await maskToPathIR(mask, SIZE, SIZE, 1, cv);
        };
        // Warm the wasm allocator so steady-state reuse is measured.
        await iterate();
        await iterate();
        const before = wasmHeapBytes(cv);
        // Each iteration allocates at least the flood source Mat
        // (SIZE*SIZE*4 bytes) inside the wasm heap. Sizing the loop so that
        // leaking only that lower bound would exceed the current heap plus
        // 64MiB guarantees a missing delete() must force the heap to grow,
        // while correct reverse-order cleanup keeps it flat
        // (render-memory.test.ts technique). Never fewer than 100 calls.
        const perIterationLowerBoundBytes = SIZE * SIZE * 4;
        const loops = Math.max(
          100,
          Math.ceil((before + 64 * 1024 * 1024) / perIterationLowerBoundBytes),
        );
        for (let index = 0; index < loops; index += 1) {
          await iterate();
        }
        const growth = wasmHeapBytes(cv) - before;
        expect(growth).toBeLessThan(8 * 1024 * 1024);
      },
      240_000,
    );
  });
});
