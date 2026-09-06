import { describe, expect, it } from "vitest";

import {
  checkStudioWasm64Capability,
  createStudioWasmMemoryRuntime,
  STUDIO_WASM_PAGE_BYTES,
} from "../studio-wasm64-memory-governor";

import {
  buildStudioWasmConnectedComponentsModule,
  createStudioPersistentBinaryMaskScanner,
  createStudioWasmConnectedComponentsKernel,
  scanStudioBinaryMaskJs,
  STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET,
  STUDIO_WASM_COMPONENT_SCAN_WINDOW_BYTES,
  type StudioWasmConnectedComponentsKernelCreationResult,
} from "./studio-wasm-connected-components-kernel";

function createMemory32Kernel(maximumPages = BigInt(8)) {
  const runtime = createStudioWasmMemoryRuntime({
    selectedMode: "i32",
    initialPages: BigInt(1),
    maximumPages,
  });
  if (!runtime.ok) {
    throw new Error(`Memory32 runtime unavailable: ${runtime.reason}`);
  }
  const kernel = createStudioWasmConnectedComponentsKernel(runtime.runtime);
  if (!kernel.ok) {
    throw new Error(`Memory32 mask kernel unavailable: ${kernel.reason}`);
  }
  return { runtime: runtime.runtime, kernel: kernel.kernel };
}

function deterministicMask(
  width: number,
  height: number,
  stride = width,
  seed = 0xc0ffee,
): Uint8Array {
  const mask = new Uint8Array((height - 1) * stride + width);
  let state = seed >>> 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      if ((state >>> 28) < 5) {
        mask[y * stride + x] = (state & 0xff) || 255;
      }
    }
  }
  return mask;
}

describe("studio WASM connected-component scan binary", () => {
  it("builds a valid memory32 imported-memory module", () => {
    const bytes = buildStudioWasmConnectedComponentsModule("i32");
    expect(bytes.subarray(0, 8)).toEqual(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    );
    expect(WebAssembly.validate(bytes)).toBe(true);
  });

  it("validates the genuine i64 ABI only on Memory64 hosts", () => {
    const capability = checkStudioWasm64Capability();
    expect(
      WebAssembly.validate(
        buildStudioWasmConnectedComponentsModule("i64"),
      ),
    ).toBe(capability.isWasm64Supported);
  });
});

describe("binary mask JS reference", () => {
  it("treats every non-zero byte as foreground and ignores row padding", () => {
    const mask = new Uint8Array([
      0, 2, 5, 0, 99, 99,
      7, 0, 9, 4, 88, 88,
      0, 0, 0, 3,
    ]);
    expect(
      scanStudioBinaryMaskJs({
        mask,
        width: 4,
        height: 3,
        stride: 6,
      }),
    ).toEqual({
      ok: true,
      backend: "js",
      spanBytes: 16,
      scan: {
        foregroundPixelCount: BigInt(6),
        rowRunCount: BigInt(4),
        bounds: {
          minX: 0,
          minY: 0,
          maxXExclusive: 4,
          maxYExclusive: 3,
          width: 4,
          height: 3,
        },
      },
    });
  });

  it("returns an empty bound and fail-closes malformed dimensions", () => {
    expect(
      scanStudioBinaryMaskJs({
        mask: new Uint8Array(12),
        width: 4,
        height: 3,
      }),
    ).toMatchObject({
      ok: true,
      scan: {
        foregroundPixelCount: BigInt(0),
        rowRunCount: BigInt(0),
        bounds: null,
      },
    });
    expect(
      scanStudioBinaryMaskJs({
        mask: new Uint8Array(1),
        width: 2,
        height: 2,
      }),
    ).toEqual({ ok: false, reason: "input-too-short" });
    expect(
      scanStudioBinaryMaskJs({
        mask: new Uint8Array(1),
        width: 2,
        height: 1,
        stride: 1,
      }),
    ).toEqual({ ok: false, reason: "invalid-dimensions" });
    expect(
      scanStudioBinaryMaskJs({
        mask: new Uint8Array(1),
        width: 0xffff_ffff,
        height: 0xffff_ffff,
      }),
    ).toEqual({ ok: false, reason: "dimension-overflow" });
  });
});

describe("StudioWasmConnectedComponentsKernel parity", () => {
  it.each([
    { width: 1, height: 1, stride: 1, seed: 1 },
    { width: 7, height: 9, stride: 7, seed: 2 },
    { width: 31, height: 17, stride: 40, seed: 3 },
    { width: 257, height: 129, stride: 263, seed: 4 },
  ])(
    "matches JS foreground/runs/bounds at $width×$height stride $stride",
    ({ width, height, stride, seed }) => {
      const { kernel } = createMemory32Kernel();
      const mask = deterministicMask(width, height, stride, seed);
      const input = { mask, width, height, stride };
      const expected = scanStudioBinaryMaskJs(input);
      const actual = kernel.copyAndScan(input);

      expect(expected.ok).toBe(true);
      expect(actual).toMatchObject({
        ok: true,
        backend: "wasm32",
      });
      if (!expected.ok || !actual.ok) return;
      expect(actual.spanBytes).toBe(expected.spanBytes);
      expect(actual.scan).toEqual(expected.scan);
    },
  );

  it("handles empty and solid masks exactly", () => {
    const { kernel } = createMemory32Kernel();
    const empty = kernel.copyAndScan({
      mask: new Uint8Array(24),
      width: 6,
      height: 4,
    });
    expect(empty).toMatchObject({
      ok: true,
      scan: {
        foregroundPixelCount: BigInt(0),
        rowRunCount: BigInt(0),
        bounds: null,
      },
    });

    const solid = kernel.copyAndScan({
      mask: new Uint8Array(24).fill(255),
      width: 6,
      height: 4,
    });
    expect(solid).toMatchObject({
      ok: true,
      scan: {
        foregroundPixelCount: BigInt(24),
        rowRunCount: BigInt(4),
        bounds: {
          minX: 0,
          minY: 0,
          maxXExclusive: 6,
          maxYExclusive: 4,
          width: 6,
          height: 4,
        },
      },
    });
  });

  it("refreshes copied views after grow", () => {
    const { runtime, kernel } = createMemory32Kernel(BigInt(4));
    const oldView = runtime.createByteView(
      STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET,
      8,
    );
    expect(oldView.ok).toBe(true);
    if (!oldView.ok) return;

    const width = Number(STUDIO_WASM_PAGE_BYTES) + 701;
    const mask = deterministicMask(width, 1);
    const result = kernel.copyAndScan({ mask, width, height: 1 });
    expect(result.ok).toBe(true);
    expect(runtime.generation).toBe(1);
    expect(oldView.view.buffer.byteLength).toBe(0);
  });

  it("rejects stale generations, scratch overlap, and ranges beyond 64 MiB", () => {
    const { runtime, kernel } = createMemory32Kernel(BigInt(4));
    const oldGeneration = runtime.generation;
    runtime.memory.grow(1);

    expect(
      kernel.scanResident({
        residentByteOffset: STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET,
        width: 1,
        height: 1,
        expectedGeneration: oldGeneration,
      }),
    ).toEqual({ ok: false, reason: "stale-generation" });
    expect(
      kernel.scanResident({
        residentByteOffset: BigInt(0),
        width: 1,
        height: 1,
        expectedGeneration: runtime.generation,
      }),
    ).toEqual({ ok: false, reason: "output-overlaps-input" });
    expect(
      kernel.scanResident({
        residentByteOffset:
          BigInt(STUDIO_WASM_COMPONENT_SCAN_WINDOW_BYTES) - BigInt(1),
        width: 2,
        height: 1,
        expectedGeneration: runtime.generation,
      }),
    ).toEqual({ ok: false, reason: "resident-window-exceeded" });
  });

  it("executes actual i64 pointers and dimensions on Memory64 hosts", () => {
    const capability = checkStudioWasm64Capability();
    const runtime = createStudioWasmMemoryRuntime({
      selectedMode: "i64",
      initialPages: BigInt(1),
      maximumPages: BigInt(4),
    });
    if (!capability.isWasm64Supported) {
      expect(runtime).toMatchObject({
        ok: false,
        reason: "memory64-unsupported",
      });
      return;
    }
    expect(runtime.ok).toBe(true);
    if (!runtime.ok) return;
    const created = createStudioWasmConnectedComponentsKernel(
      runtime.runtime,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const input = {
      mask: deterministicMask(193, 211, 201, 0x1234),
      width: 193,
      height: 211,
      stride: 201,
    };
    const expected = scanStudioBinaryMaskJs(input);
    const actual = created.kernel.copyAndScan(input);
    expect(actual).toMatchObject({ ok: true, backend: "wasm64" });
    if (!expected.ok || !actual.ok) return;
    expect(actual.scan).toEqual(expected.scan);
  });
});

describe("persistent exact-backend mask scanner", () => {
  it("runs byte-exact JS only when JS is explicitly selected", () => {
    const scanner = createStudioPersistentBinaryMaskScanner({
      backend: "js",
    });
    const input = {
      mask: deterministicMask(43, 47, 49, 0xbadc0de),
      width: 43,
      height: 47,
      stride: 49,
    };
    const expected = scanStudioBinaryMaskJs(input);
    const actual = scanner.scan(input);

    expect(actual.ok).toBe(true);
    if (!expected.ok || !actual.ok) return;
    expect(actual.scan).toEqual(expected.scan);
    expect(actual.backend).toBe("js");
  });

  it("returns the live Wasm backend while it remains healthy", () => {
    const { kernel } = createMemory32Kernel();
    const scanner = createStudioPersistentBinaryMaskScanner({
      backend: "wasm32",
      createKernel() {
        return { ok: true, kernel };
      },
    });
    const input = {
      mask: deterministicMask(37, 41),
      width: 37,
      height: 41,
    };
    const expected = scanStudioBinaryMaskJs(input);
    const actual = scanner.scan(input);

    expect(actual).toMatchObject({ ok: true, backend: "wasm32" });
    if (!expected.ok || !actual.ok) return;
    expect(actual.scan).toEqual(expected.scan);
  });

  it("keeps a selected Wasm failure terminal without retrying JS or another Wasm", () => {
    let createCount = 0;
    let runCount = 0;
    const scanner = createStudioPersistentBinaryMaskScanner({
      backend: "wasm32",
      createKernel() {
        createCount += 1;
        return {
          ok: true,
          kernel: {
            runtime: { addressType: "i32" },
            copyAndScan() {
              runCount += 1;
              return { ok: false, reason: "kernel-run-failed" };
            },
          },
        } as unknown as StudioWasmConnectedComponentsKernelCreationResult;
      },
    });
    const first = {
      mask: deterministicMask(23, 13),
      width: 23,
      height: 13,
    };
    const second = {
      mask: deterministicMask(17, 19),
      width: 17,
      height: 19,
    };

    expect(scanner.scan(first)).toEqual({ ok: false, reason: "kernel-run-failed" });
    expect(scanner.scan(second)).toEqual({ ok: false, reason: "kernel-run-failed" });
    expect(createCount).toBe(1);
    expect(runCount).toBe(1);
  });
});
