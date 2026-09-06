import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  addSelectionSubpath,
  emptyPixelSelection,
  expandContractSelection,
  rectSelectionPolygon,
} from "../studio-selection-tools";

import {
  applyHybridPixelSelectionBoundaryChange,
  applyHybridPixelSelectionBoundaryChangeSync,
  rasterizePixelSelectionToAlphaMask,
} from "./studio-hybrid-pixel-selection-boundary";

import type { CV, Mat } from "@techstark/opencv-js";

function usableRectSelection() {
  return addSelectionSubpath(
    emptyPixelSelection(),
    "add",
    rectSelectionPolygon({ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.7 }),
  )!;
}

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
        destination.data8U[index] = Math.min(255, (source.data8U[index] ?? 0) + iterations);
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

describe("hybrid pixel selection boundary (product expand/contract path)", () => {
  it("rasterizes a usable selection into a non-empty alpha mask", () => {
    const selection = usableRectSelection();
    const mask = rasterizePixelSelectionToAlphaMask(selection, 32, 32);
    expect(mask).not.toBeNull();
    expect(mask!.some((value) => value === 255)).toBe(true);
    expect(mask!.some((value) => value === 0)).toBe(true);
  });

  it("applies geometry expand and invokes OpenCV dilate on the selection mask", async () => {
    const selection = usableRectSelection();
    const geometricOnly = expandContractSelection(selection, 0.04);
    const result = await applyHybridPixelSelectionBoundaryChange(selection, 0.04, {
      maskWidth: 24,
      maskHeight: 24,
      requestEpoch: 9,
      runtimeLoader: () => createFakeOpenCvRuntime(),
    });
    expect(result.morphInvoked).toBe(true);
    expect(result.direction).toBe("expand");
    expect(result.selection).toEqual(geometricOnly);
    expect(result.morph?.ok).toBe(true);
    if (!result.morph?.ok) return;
    expect(result.morph.artifact.operation).toBe("morphology");
    if (result.morph.artifact.operation !== "morphology") return;
    expect(result.morph.artifact.mode).toBe("dilate");
    expect(result.morph.artifact.receipt.packageName).toBe("@techstark/opencv-js");
  });

  it("applies geometry contract and invokes OpenCV erode on the selection mask", async () => {
    const selection = usableRectSelection();
    const result = await applyHybridPixelSelectionBoundaryChange(selection, -0.03, {
      maskWidth: 24,
      maskHeight: 24,
      requestEpoch: 11,
      runtimeLoader: () => createFakeOpenCvRuntime(),
    });
    expect(result.morphInvoked).toBe(true);
    expect(result.direction).toBe("contract");
    expect(result.morph?.ok).toBe(true);
    if (!result.morph?.ok) return;
    if (result.morph.artifact.operation !== "morphology") return;
    expect(result.morph.artifact.mode).toBe("erode");
  });

  it("sync product path returns geometry immediately and still schedules morph", async () => {
    const selection = usableRectSelection();
    const sync = applyHybridPixelSelectionBoundaryChangeSync(selection, 0.02, {
      maskWidth: 16,
      maskHeight: 16,
      requestEpoch: 2,
      runtimeLoader: () => createFakeOpenCvRuntime(),
    });
    expect(sync.selection).toEqual(expandContractSelection(selection, 0.02));
    expect(sync.direction).toBe("expand");
    const morph = await sync.morphPromise;
    expect(morph?.ok).toBe(true);
  });

  it("hybrid pixel selection boundary is product-admitted for expand/contract", () => {
    const boundary = readFileSync(
      new URL("./studio-hybrid-pixel-selection-boundary.ts", import.meta.url),
      "utf8",
    );
    expect(boundary).toContain("applyHybridPixelSelectionBoundaryChange");
    expect(boundary).toContain("expandContractSelection");
    expect(boundary).toContain("runHybridSelectionMaskMorphology");
    const admission = readFileSync(
      new URL("./studio-hybrid-edit-product-admission.ts", import.meta.url),
      "utf8",
    );
    expect(admission).toContain("applyHybridPixelSelectionBoundaryChangeSync");
    expect(admission).toContain("selection-tools-expand-contract");
  });
});
