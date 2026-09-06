import { describe, expect, it } from "vitest";

import { calculateStudioCrc32 } from "../studio-crc32";
import {
  checkStudioWasm64Capability,
  createStudioWasmMemoryRuntime,
  STUDIO_WASM_PAGE_BYTES,
} from "../studio-wasm64-memory-governor";

import {
  buildStudioWasmCrc32Module,
  createStudioPersistentCrc32Executor,
  createStudioWasmCrc32Kernel,
  STUDIO_WASM_CRC32_INPUT_OFFSET,
  StudioPersistentCrc32UnavailableError,
  type StudioWasmCrc32KernelCreationResult,
} from "./studio-wasm-crc32-kernel";

function deterministicBytes(byteLength: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let state = seed >>> 0;
  for (let index = 0; index < byteLength; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

function createMemory32Kernel(maximumPages = BigInt(8)) {
  const runtime = createStudioWasmMemoryRuntime({
    selectedMode: "i32",
    initialPages: BigInt(1),
    maximumPages,
  });
  if (!runtime.ok) {
    throw new Error(`Memory32 runtime unavailable: ${runtime.reason}`);
  }
  const kernel = createStudioWasmCrc32Kernel(runtime.runtime);
  if (!kernel.ok) {
    throw new Error(`Memory32 CRC kernel unavailable: ${kernel.reason}`);
  }
  return { runtime: runtime.runtime, kernel: kernel.kernel };
}

describe("studio WASM CRC32 binary builder", () => {
  it("builds and validates the memory32 variant without external tooling", () => {
    const bytes = buildStudioWasmCrc32Module("i32");
    expect(bytes.subarray(0, 8)).toEqual(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    );
    expect(WebAssembly.validate(bytes)).toBe(true);
  });

  it("validates memory64 bytes exactly when the host reports Memory64", () => {
    const capability = checkStudioWasm64Capability();
    const validated = WebAssembly.validate(
      buildStudioWasmCrc32Module("i64"),
    );
    expect(validated).toBe(capability.isWasm64Supported);
  });
});

describe("StudioWasmCrc32Kernel parity", () => {
  it.each([
    { length: 0, seed: 1 },
    { length: 1, seed: 2 },
    { length: 7, seed: 3 },
    { length: 255, seed: 4 },
    { length: 256, seed: 5 },
    { length: 4097, seed: 6 },
    { length: 65_535, seed: 7 },
    { length: 65_536, seed: 8 },
    { length: 131_109, seed: 9 },
  ])("matches JS byte-for-byte at $length bytes", ({ length, seed }) => {
    const { kernel } = createMemory32Kernel();
    const bytes = deterministicBytes(length, seed);
    const result = kernel.copyAndCalculate(bytes);

    expect(result).toMatchObject({
      ok: true,
      crc32: calculateStudioCrc32(bytes),
    });
  });

  it("calculates a bounded resident subrange at the reserved table boundary", () => {
    const { runtime, kernel } = createMemory32Kernel();
    const bytes = new TextEncoder().encode("prefix-123456789-suffix");
    const grow = runtime.growToFit(
      STUDIO_WASM_CRC32_INPUT_OFFSET + BigInt(bytes.byteLength),
    );
    expect(grow.ok).toBe(true);
    const view = runtime.createByteView(
      STUDIO_WASM_CRC32_INPUT_OFFSET,
      bytes.byteLength,
    );
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    view.view.set(bytes);

    const result = kernel.calculateResident(
      STUDIO_WASM_CRC32_INPUT_OFFSET + BigInt(7),
      9,
    );
    expect(result).toMatchObject({
      ok: true,
      crc32: calculateStudioCrc32(bytes.subarray(7, 16)),
    });
    expect(
      kernel.calculateResident(STUDIO_WASM_CRC32_INPUT_OFFSET - BigInt(1), 1),
    ).toEqual({ ok: false, reason: "invalid-range" });
  });

  it("refreshes the copy view after grow and keeps the imported kernel live", () => {
    const { runtime, kernel } = createMemory32Kernel();
    const beforeGrow = runtime.createByteView(
      STUDIO_WASM_CRC32_INPUT_OFFSET,
      16,
    );
    expect(beforeGrow.ok).toBe(true);
    if (!beforeGrow.ok) return;
    expect(runtime.generation).toBe(0);

    const bytes = deterministicBytes(
      Number(STUDIO_WASM_PAGE_BYTES) + 777,
      42,
    );
    const result = kernel.copyAndCalculate(bytes);
    expect(result).toMatchObject({
      ok: true,
      crc32: calculateStudioCrc32(bytes),
      generation: 1,
    });
    expect(runtime.generation).toBe(1);
    expect(beforeGrow.view.buffer.byteLength).toBe(0);

    const second = deterministicBytes(128, 100);
    expect(kernel.copyAndCalculate(second)).toMatchObject({
      ok: true,
      crc32: calculateStudioCrc32(second),
      generation: 1,
    });
  });

  it("executes the actual i64 pointer/length variant on Memory64 hosts", () => {
    const capability = checkStudioWasm64Capability();
    const runtime = createStudioWasmMemoryRuntime({
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
    const kernel = createStudioWasmCrc32Kernel(runtime.runtime);
    expect(kernel.ok).toBe(true);
    if (!kernel.ok) return;

    const bytes = deterministicBytes(100_003, 0xc0ffee);
    const result = kernel.kernel.copyAndCalculate(bytes);
    expect(runtime.runtime.addressType).toBe("i64");
    expect(result).toMatchObject({
      ok: true,
      crc32: calculateStudioCrc32(bytes),
    });
  });
});

describe("persistent CRC32 executor policy", () => {
  it("keeps small inputs in JS and lazily initializes one persistent kernel", () => {
    let createCount = 0;
    let runCount = 0;
    const fakeKernelResult: StudioWasmCrc32KernelCreationResult = {
      ok: true,
      kernel: {
        copyAndCalculate(bytes: Uint8Array) {
          runCount += 1;
          return {
            ok: true,
            crc32: calculateStudioCrc32(bytes),
            generation: 0,
          };
        },
      } as never,
    };
    const executor = createStudioPersistentCrc32Executor({
      minimumWasmBytes: 8,
      createKernel() {
        createCount += 1;
        return fakeKernelResult;
      },
    });

    expect(executor.calculate(deterministicBytes(7, 1))).toBe(
      calculateStudioCrc32(deterministicBytes(7, 1)),
    );
    expect(createCount).toBe(0);
    const firstLarge = deterministicBytes(8, 2);
    const secondLarge = deterministicBytes(9, 3);
    expect(executor.calculate(firstLarge)).toBe(
      calculateStudioCrc32(firstLarge),
    );
    expect(executor.calculate(secondLarge)).toBe(
      calculateStudioCrc32(secondLarge),
    );
    expect(createCount).toBe(1);
    expect(runCount).toBe(2);
  });

  it("fails closed after Memory64 initialization or run failure without executing JS", () => {
    let initializationAttempts = 0;
    const initFailureExecutor = createStudioPersistentCrc32Executor({
      minimumWasmBytes: 0,
      createKernel() {
        initializationAttempts += 1;
        return { ok: false, reason: "module-instantiation-failed" };
      },
    });
    const first = deterministicBytes(32, 10);
    const second = deterministicBytes(64, 11);
    expect(() => initFailureExecutor.calculate(first)).toThrowError(
      StudioPersistentCrc32UnavailableError,
    );
    expect(() => initFailureExecutor.calculate(second)).toThrowError(
      StudioPersistentCrc32UnavailableError,
    );
    expect(initializationAttempts).toBe(1);

    let runAttempts = 0;
    const runFailureExecutor = createStudioPersistentCrc32Executor({
      minimumWasmBytes: 0,
      createKernel() {
        return {
          ok: true,
          kernel: {
            copyAndCalculate() {
              runAttempts += 1;
              return { ok: false, reason: "kernel-run-failed" };
            },
          } as never,
        };
      },
    });
    expect(() => runFailureExecutor.calculate(first)).toThrowError(
      StudioPersistentCrc32UnavailableError,
    );
    expect(() => runFailureExecutor.calculate(second)).toThrowError(
      StudioPersistentCrc32UnavailableError,
    );
    expect(runAttempts).toBe(1);
  });
});
