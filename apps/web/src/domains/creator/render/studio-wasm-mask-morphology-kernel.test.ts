import { describe, expect, it, vi } from "vitest";

import {
  checkStudioWasm64Capability,
  createStudioWasmMemoryRuntime,
  STUDIO_WASM_PAGE_BYTES,
} from "../studio-wasm64-memory-governor";

import {
  applyStudioMaskMorphology3x3Reference,
  buildStudioWasmMaskMorphologyModule,
  createStudioPersistentMaskMorphologyExecutor,
  createStudioWasmMaskMorphologyKernel,
  STUDIO_WASM_MASK_MORPHOLOGY_MAX_INPUT_BYTES,
  STUDIO_WASM_MASK_MORPHOLOGY_WORKING_SET_BYTES,
  type StudioWasmMaskMorphologyKernelCreationResult,
  type StudioWasmMaskMorphologyKernelLike,
} from "./studio-wasm-mask-morphology-kernel";

function createKernel(
  addressType: "i64" | "i32",
): StudioWasmMaskMorphologyKernelCreationResult {
  const runtime = createStudioWasmMemoryRuntime({
    selectedMode: addressType,
    initialPages: BigInt(1),
    maximumPages:
      BigInt(STUDIO_WASM_MASK_MORPHOLOGY_WORKING_SET_BYTES)
      / STUDIO_WASM_PAGE_BYTES,
  });
  if (!runtime.ok) {
    return { ok: false, reason: "memory-runtime-unavailable" };
  }
  return createStudioWasmMaskMorphologyKernel(runtime.runtime);
}

function deterministicMask(width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = (index * 73 + (index >>> 2) * 19 + 11) & 0xff;
  }
  return mask;
}

describe("studio WASM mask morphology module", () => {
  it("validates the memory32 module and exposes both kernels", () => {
    const bytes = buildStudioWasmMaskMorphologyModule("i32");
    expect(WebAssembly.validate(bytes)).toBe(true);

    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(bytes),
      { env: { memory } },
    );
    expect(instance.exports.dilate3x3).toBeTypeOf("function");
    expect(instance.exports.erode3x3).toBeTypeOf("function");
  });

  it("validates and instantiates an i64-pointer ABI when Memory64 is operational", () => {
    const report = checkStudioWasm64Capability();
    const bytes = buildStudioWasmMaskMorphologyModule("i64");
    expect(WebAssembly.validate(bytes)).toBe(report.isWasm64Supported);

    if (report.isWasm64Supported) {
      const created = createKernel("i64");
      expect(created.ok).toBe(true);
      if (created.ok) {
        expect(created.kernel.addressType).toBe("i64");
      }
    }
  });
});

describe("studio mask morphology reference", () => {
  it("uses only in-bounds neighbours at every edge", () => {
    const mask = new Uint8Array([
      10, 20, 30,
      40, 50, 60,
      70, 80, 90,
    ]);
    expect([
      ...applyStudioMaskMorphology3x3Reference(
        mask,
        3,
        3,
        "dilate",
      ),
    ]).toEqual([
      50, 60, 60,
      80, 90, 90,
      80, 90, 90,
    ]);
    expect([
      ...applyStudioMaskMorphology3x3Reference(
        mask,
        3,
        3,
        "erode",
      ),
    ]).toEqual([
      10, 10, 20,
      10, 10, 20,
      40, 40, 50,
    ]);
  });

  it("preserves a one-pixel mask for both operations", () => {
    const mask = new Uint8ClampedArray([137]);
    expect([
      ...applyStudioMaskMorphology3x3Reference(mask, 1, 1, "dilate"),
    ]).toEqual([137]);
    expect([
      ...applyStudioMaskMorphology3x3Reference(mask, 1, 1, "erode"),
    ]).toEqual([137]);
  });

  it("rejects malformed dimensions and masks beyond the resident budget", () => {
    expect(() =>
      applyStudioMaskMorphology3x3Reference(
        new Uint8Array(6),
        2,
        2,
        "dilate",
      )).toThrow("mask-size-mismatch");

    const oversized = new Uint8Array(
      STUDIO_WASM_MASK_MORPHOLOGY_MAX_INPUT_BYTES + 1,
    );
    expect(() =>
      applyStudioMaskMorphology3x3Reference(
        oversized,
        oversized.length,
        1,
        "erode",
      )).toThrow("input-budget-exceeded");
    expect(() =>
      applyStudioMaskMorphology3x3Reference(
        new Uint8Array(1),
        1,
        1,
        "open" as "dilate",
      )).toThrow("invalid-operation");
  });
});

describe.each(["i32", "i64"] as const)(
  "studio %s mask morphology kernel",
  (addressType) => {
    it("is byte-exact for dilation and erosion, including border pixels", () => {
      const report = checkStudioWasm64Capability();
      if (addressType === "i64" && !report.isWasm64Supported) {
        expect(createKernel("i64").ok).toBe(false);
        return;
      }

      const created = createKernel(addressType);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      for (const [width, height] of [
        [1, 7],
        [2, 5],
        [3, 3],
        [11, 9],
        [127, 65],
      ] as const) {
        const mask = deterministicMask(width, height);
        for (const operation of ["dilate", "erode"] as const) {
          const result = created.kernel.process(
            mask,
            width,
            height,
            operation,
          );
          expect(result.ok).toBe(true);
          if (!result.ok) continue;
          expect(result.backend).toBe(
            addressType === "i64"
              ? "wasm-memory64"
              : "wasm-memory32",
          );
          expect([...result.pixels]).toEqual([
            ...applyStudioMaskMorphology3x3Reference(
              mask,
              width,
              height,
              operation,
            ),
          ]);
        }
      }
    });

    it("grows once, reacquires views, and returns the current generation", () => {
      const report = checkStudioWasm64Capability();
      if (addressType === "i64" && !report.isWasm64Supported) return;
      const created = createKernel(addressType);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const mask = deterministicMask(257, 257);
      const generationBefore = created.kernel.runtime.generation;
      const result = created.kernel.process(
        mask,
        257,
        257,
        "dilate",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.generation).toBeGreaterThan(generationBefore);
      expect(result.generation).toBe(created.kernel.runtime.generation);
      expect(result.pixels).toEqual(
        applyStudioMaskMorphology3x3Reference(mask, 257, 257, "dilate"),
      );
    });
  },
);

describe("persistent studio mask morphology executor", () => {
  it("retains one explicitly selected Memory64 kernel", () => {
    const memory64Kernel = createKernel("i64");
    const report = checkStudioWasm64Capability();
    if (!report.isWasm64Supported) {
      expect(memory64Kernel.ok).toBe(false);
      return;
    }
    expect(memory64Kernel.ok).toBe(true);
    if (!memory64Kernel.ok) return;

    const memory64Factory = vi.fn(() => memory64Kernel);
    const executor = createStudioPersistentMaskMorphologyExecutor({
      backend: "wasm-memory64",
      createKernel: memory64Factory,
    });
    const mask = deterministicMask(9, 9);
    const first = executor.process(mask, 9, 9, "dilate");
    const second = executor.process(mask, 9, 9, "erode");

    expect(first.ok && first.backend).toBe("wasm-memory64");
    expect(second.ok && second.backend).toBe("wasm-memory64");
    expect(memory64Factory).toHaveBeenCalledTimes(1);
  });

  it("keeps a selected Wasm failure terminal without trying another backend", () => {
    let runCount = 0;
    const failedKernel: StudioWasmMaskMorphologyKernelLike = {
      addressType: "i64",
      process: () => {
        runCount += 1;
        return { ok: false, reason: "kernel-run-failed" };
      },
    };
    const memory64Factory = vi.fn(() => ({
      ok: true as const,
      kernel: failedKernel,
    }));
    const executor = createStudioPersistentMaskMorphologyExecutor({
      backend: "wasm-memory64",
      createKernel: memory64Factory,
    });
    const mask = deterministicMask(7, 7);
    const first = executor.process(mask, 7, 7, "dilate");
    const second = executor.process(mask, 7, 7, "erode");

    expect(first).toEqual({ ok: false, reason: "kernel-run-failed" });
    expect(second).toEqual({ ok: false, reason: "kernel-run-failed" });
    expect(memory64Factory).toHaveBeenCalledOnce();
    expect(runCount).toBe(1);
  });

  it("runs byte-exact JS only when JS is selected before execution", () => {
    const executor = createStudioPersistentMaskMorphologyExecutor({
      backend: "js",
    });
    const mask = deterministicMask(8, 6);
    const result = executor.process(mask, 8, 6, "erode");

    expect(result.ok && result.backend).toBe("js");
    if (result.ok) {
      expect(result.pixels).toEqual(
        applyStudioMaskMorphology3x3Reference(mask, 8, 6, "erode"),
      );
    }
  });

  it("fails closed before selecting a backend for invalid or oversized input", () => {
    const factory = vi.fn(() => createKernel("i32"));
    const executor = createStudioPersistentMaskMorphologyExecutor({
      backend: "wasm-memory32",
      createKernel: factory,
    });
    expect(executor.process(
      new Uint8Array(5),
      2,
      3,
      "dilate",
    )).toEqual({ ok: false, reason: "mask-size-mismatch" });
    expect(executor.process(
      new Uint8Array(1),
      1,
      1,
      "close" as "erode",
    )).toEqual({ ok: false, reason: "invalid-operation" });

    const oversized = new Uint8Array(
      STUDIO_WASM_MASK_MORPHOLOGY_MAX_INPUT_BYTES + 1,
    );
    expect(executor.process(
      oversized,
      oversized.length,
      1,
      "erode",
    )).toEqual({ ok: false, reason: "input-budget-exceeded" });
    expect(factory).not.toHaveBeenCalled();
  });
});
