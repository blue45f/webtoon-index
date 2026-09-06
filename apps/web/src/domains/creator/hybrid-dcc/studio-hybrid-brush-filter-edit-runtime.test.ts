import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  appendStudioCanonicalFilterNode,
  createStudioCanonicalFilterRecipe,
  studioCanonicalFilterGaussianRadius,
  STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
} from "../render/studio-engine-canonical-filter-plan";
import {
  createStudioOpenCvImageProvider,
} from "../studio-opencv-image-provider";

import {
  createHybridPixiEditOverlayHost,
  runHybridBrushOutlineStroke,
  runHybridFilterPlan,
  runHybridObjectPickAtPoint,
  runHybridPrecisionStabilizeSample,
  runHybridSelectionMaskMorphology,
  STUDIO_HYBRID_BRUSH_FILTER_EDIT_PACKAGE_IMPORTS,
  STUDIO_HYBRID_BRUSH_FILTER_EDIT_ROUTES,
  STUDIO_HYBRID_BRUSH_FILTER_EDIT_RUNTIME_VERSION,
} from "./studio-hybrid-brush-filter-edit-runtime";

import type { CV, Mat } from "@techstark/opencv-js";

/** Minimal OpenCV runtime satisfying validateRuntime + morphology path (mirrors provider tests). */
function createFakeOpenCvRuntime(): CV {
  const types = {
    CV_8UC1: 1,
    CV_8UC3: 3,
    CV_8UC4: 4,
    CV_32S: 10,
    CV_32SC1: 10,
    CV_32SC2: 11,
    CV_32SC4: 13,
    CV_32FC2: 21,
    CV_64F: 30,
    CV_64FC1: 30,
  } as const;

  class FakeMat {
    rows = 0;
    cols = 0;
    data8U = new Uint8Array();
    data32S = new Int32Array();
    data32F = new Float32Array();
    data64F = new Float64Array();
    private matType: number = types.CV_8UC1;
    constructor(rows?: number, cols?: number, type?: number) {
      if (rows !== undefined && cols !== undefined && type !== undefined) {
        this.configure(rows, cols, type);
      }
    }
    configure(rows: number, cols: number, type: number): void {
      this.rows = rows;
      this.cols = cols;
      this.matType = type;
      const channels = type === types.CV_8UC4 ? 4 : type === types.CV_8UC3 ? 3 : 1;
      this.data8U = type <= types.CV_8UC4 ? new Uint8Array(rows * cols * channels) : new Uint8Array();
    }
    channels(): number {
      return this.matType === types.CV_8UC4 ? 4 : this.matType === types.CV_8UC3 ? 3 : 1;
    }
    type(): number {
      return this.matType;
    }
    delete(): void {
      /* no-op */
    }
  }

  class FakeMatVector {
    size(): number {
      return 0;
    }
    get(): Mat {
      return new FakeMat() as unknown as Mat;
    }
    delete(): void {
      /* no-op */
    }
  }

  return {
    ...types,
    MORPH_RECT: 40,
    MORPH_CROSS: 41,
    MORPH_ELLIPSE: 42,
    MORPH_ERODE: 50,
    MORPH_DILATE: 51,
    MORPH_OPEN: 52,
    MORPH_CLOSE: 53,
    MORPH_GRADIENT: 54,
    RETR_EXTERNAL: 60,
    RETR_LIST: 61,
    RETR_CCOMP: 62,
    RETR_TREE: 63,
    CHAIN_APPROX_SIMPLE: 70,
    INTER_NEAREST: 80,
    INTER_LINEAR: 81,
    INTER_CUBIC: 82,
    BORDER_CONSTANT: 90,
    BORDER_REPLICATE: 91,
    BORDER_REFLECT: 92,
    Mat: FakeMat as unknown as typeof Mat,
    MatVector: FakeMatVector as unknown as CV["MatVector"],
    Point: class {
      constructor(public x: number, public y: number) {}
    },
    Size: class {
      constructor(public width: number, public height: number) {}
    },
    Scalar: class extends Array<number> {
      constructor(...values: number[]) {
        super(...values);
        Object.setPrototypeOf(this, (this.constructor as typeof Array).prototype);
      }
    },
    matFromArray(rows: number, cols: number, type: number, array: ArrayBufferView): Mat {
      const mat = new FakeMat(rows, cols, type);
      if (type <= types.CV_8UC4) {
        mat.data8U.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
      return mat as unknown as Mat;
    },
    getStructuringElement(_shape: number, size: { width: number; height: number }): Mat {
      return new FakeMat(size.height, size.width, types.CV_8UC1) as unknown as Mat;
    },
    morphologyEx(
      source: FakeMat,
      destination: FakeMat,
      _operation: number,
      _kernel: FakeMat,
      _anchor: unknown,
      iterations: number,
    ): void {
      destination.configure(source.rows, source.cols, source.type());
      for (let index = 0; index < source.data8U.length; index += 1) {
        const value = source.data8U[index] ?? 0;
        destination.data8U[index] = Math.min(255, value + iterations);
      }
    },
    connectedComponentsWithStats(): number {
      return 0;
    },
    findContours(): void {
      /* unused */
    },
    getPerspectiveTransform(): Mat {
      return new FakeMat(3, 3, types.CV_64FC1) as unknown as Mat;
    },
    warpPerspective(): void {
      /* unused */
    },
  } as unknown as CV;
}

describe("Studio hybrid brush/filter/edit runtime", () => {
  it("advertises a fixed version and package import inventory for hybrid-table roles", () => {
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_RUNTIME_VERSION).toBe(1);
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_PACKAGE_IMPORTS["perfect-freehand"]).toBe("perfect-freehand");
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_PACKAGE_IMPORTS["lazy-brush"]).toBe("lazy-brush");
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_PACKAGE_IMPORTS.rbush).toBe("rbush");
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_PACKAGE_IMPORTS["@techstark/opencv-js"])
      .toBe("@techstark/opencv-js");
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_PACKAGE_IMPORTS["pixi.js"]).toBe("pixi.js");
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_ROUTES.some((route) => route.library === "perfect-freehand"))
      .toBe(true);
    expect(STUDIO_HYBRID_BRUSH_FILTER_EDIT_ROUTES.some((route) => route.library === "rbush"))
      .toBe(true);
  });

  it("builds a pressure-aware freehand outline through perfect-freehand on the real adapter path", () => {
    const result = runHybridBrushOutlineStroke({
      brushId: "perfect-ink",
      points: [0, 0, 8, 2, 20, 0, 36, 4, 50, 1],
      pressures: [0.2, 0.55, 0.9, 0.7, 0.35],
      strokeWidth: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outlinePointCount).toBeGreaterThan(8);
    expect(result.pathLengthHint).toBeGreaterThan(40);
    expect(result.outline[0]!.length).toBeGreaterThanOrEqual(2);
    expect(runHybridBrushOutlineStroke({
      brushId: "not-a-freehand-brush",
      points: [0, 0, 1, 1],
      strokeWidth: 4,
    })).toEqual({ ok: false, reason: "unknown-brush" });
  });

  it("stabilizes precision samples through the shipped lazy-brush stabilizer", () => {
    const first = runHybridPrecisionStabilizeSample({
      x: 0,
      y: 0,
      pointerType: "mouse",
      pointerId: 7,
      radiusCssPx: 24,
    });
    expect(first.accepted).toBe(true);
    expect(first.initialized).toBe(true);
    const far = runHybridPrecisionStabilizeSample({
      x: 400,
      y: 0,
      pointerType: "mouse",
      pointerId: 8,
      radiusCssPx: 40,
      friction: 0.5,
    });
    // A fresh stabilizer instance per call: far point is accepted as first of that stroke.
    expect(far.firstPoint).toBe(true);
    expect(far.point[0]).toBe(400);
  });

  it("picks the topmost interactive object through the real RBush spatial index", () => {
    const hit = runHybridObjectPickAtPoint(
      [
        { id: "back", x: 0, y: 0, width: 100, height: 100, zOrder: 1 },
        { id: "front", x: 20, y: 20, width: 40, height: 40, zOrder: 9 },
        { id: "side", x: 200, y: 200, width: 10, height: 10, zOrder: 99 },
        {
          id: "locked-top",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zOrder: 50,
          locked: true,
        },
      ],
      { x: 30, y: 30 },
    );
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    expect(hit.entry?.id).toBe("front");
    expect(hit.candidateCount).toBeGreaterThanOrEqual(2);
    expect(hit.indexSize).toBe(4);

    const locked = runHybridObjectPickAtPoint(
      [
        { id: "locked", x: 0, y: 0, width: 50, height: 50, zOrder: 3, locked: true },
      ],
      { x: 10, y: 10 },
      { includeLocked: true },
    );
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.entry?.id).toBe("locked");
  });

  it("plans a canonical filter stack for the WebGPU filter consumer", () => {
    const base = createStudioCanonicalFilterRecipe({ recipeId: "hybrid-filter-plan" });
    const recipe = appendStudioCanonicalFilterNode(base, {
      id: "blur",
      kind: "gaussian-blur",
      input: "source",
      sigma: 1.2,
      radius: studioCanonicalFilterGaussianRadius(1.2),
      truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
      borderMode: "reflect",
    });
    const plan = runHybridFilterPlan(recipe, 64, 48);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.plan.width).toBe(64);
    expect(plan.plan.height).toBe(48);
    expect(plan.plan.stages.length).toBeGreaterThan(0);
  });

  it("runs OpenCV morphology on a selection mask through the shipped provider", async () => {
    const width = 8;
    const height = 8;
    const mask = new Uint8Array(width * height);
    for (let y = 2; y < 6; y += 1) {
      for (let x = 2; x < 6; x += 1) {
        mask[y * width + x] = 255;
      }
    }
    // Prove the hybrid façade and the provider share the same execute entry.
    const direct = createStudioOpenCvImageProvider({
      requestEpoch: 3,
      runtimeLoader: () => createFakeOpenCvRuntime(),
    });
    const directResult = await direct.execute({
      operation: "morphology",
      requestEpoch: 3,
      image: { width, height, channels: 1, data: mask },
      mode: "dilate",
      kernel: { shape: "ellipse", width: 3, height: 3 },
    });
    direct.dispose();
    expect(directResult.ok).toBe(true);

    const result = await runHybridSelectionMaskMorphology({
      width,
      height,
      mask,
      mode: "dilate",
      kernelSize: 3,
      iterations: 1,
      requestEpoch: 4,
      runtimeLoader: () => createFakeOpenCvRuntime(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`${result.reason}: ${result.detail}`);
    }
    expect(result.artifact.operation).toBe("morphology");
    if (result.artifact.operation !== "morphology") return;
    expect(result.artifact.image.width).toBe(width);
    expect(result.artifact.image.height).toBe(height);
    expect(result.artifact.image.data.byteLength).toBe(width * height);
    expect(result.artifact.receipt.packageName).toBe("@techstark/opencv-js");
  });

  it("exposes a Pixi edit-overlay host entry that reuses the shipped scene provider", () => {
    const source = readFileSync(new URL("./studio-hybrid-brush-filter-edit-runtime.ts", import.meta.url), "utf8");
    expect(source).toContain('from "../render/studio-pixi-scene-provider"');
    expect(source).toContain("createStudioPixiSceneProvider");
    expect(source).toContain("export async function createHybridPixiEditOverlayHost");
    expect(typeof createHybridPixiEditOverlayHost).toBe("function");
  });

  it("keeps every route entry pointing at a real shipped module file", () => {
    for (const route of STUDIO_HYBRID_BRUSH_FILTER_EDIT_ROUTES) {
      const path = new URL(`./${route.shippedModule}`, import.meta.url);
      const text = readFileSync(path, "utf8");
      expect(text.length).toBeGreaterThan(100);
      if (route.library === "perfect-freehand") {
        expect(text).toContain('from "perfect-freehand"');
      }
      if (route.library === "lazy-brush") {
        expect(text).toContain('from "lazy-brush"');
      }
      if (route.library === "rbush") {
        expect(text).toContain('from "rbush"');
      }
      if (route.library === "pixi.js") {
        expect(text).toContain("pixi.js");
      }
    }
  });
});
