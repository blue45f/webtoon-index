import { describe, expect, it } from "vitest";

import {
  checkStudioWasm64Capability,
  createStudioWasmMemoryRuntime,
  STUDIO_WASM32_ADDRESS_LIMIT_BYTES,
  STUDIO_WASM32_DEFAULT_WORKING_SET_MAX_BYTES,
  STUDIO_WASM64_DEFAULT_WORKING_SET_MAX_BYTES,
  STUDIO_WASM_PAGE_BYTES,
  STUDIO_WEB_MEMORY64_ADDRESS_LIMIT_BYTES,
  StudioWasmLinearMemoryRuntime,
  StudioWasm64MemoryManager,
} from "./studio-wasm64-memory-governor";

function nativeHostWithoutMemory64(): typeof WebAssembly {
  return {
    ...WebAssembly,
    Module: WebAssembly.Module,
    Instance: WebAssembly.Instance,
    Memory: WebAssembly.Memory,
    validate(bytes: BufferSource): boolean {
      const view =
        ArrayBuffer.isView(bytes)
          ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          : new Uint8Array(bytes);
      const memorySectionFlags = view[11];
      if (memorySectionFlags === 0x05) return false;
      return WebAssembly.validate(bytes);
    },
  } as typeof WebAssembly;
}

function externalGrowModule(addressType: "i64" | "i32"): WebAssembly.Module {
  const isI64 = addressType === "i64";
  return new WebAssembly.Module(
    new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      // type: () -> i32/i64
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, isI64 ? 0x7e : 0x7f,
      // import env.memory with min=1, max=3 and matching address type
      0x02, 0x10, 0x01, 0x03, 0x65, 0x6e, 0x76,
      0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79,
      0x02, isI64 ? 0x05 : 0x01, 0x01, 0x03,
      // one function using type 0
      0x03, 0x02, 0x01, 0x00,
      // export function 0 as "grow"
      0x07, 0x08, 0x01, 0x04, 0x67, 0x72, 0x6f, 0x77, 0x00, 0x00,
      // body: i32/i64.const 1; memory.grow 0; end
      0x0a, 0x08, 0x01, 0x06, 0x00, isI64 ? 0x42 : 0x41,
      0x01, 0x40, 0x00, 0x0b,
    ]),
  );
}

function growThroughImportedMemory(
  memory: WebAssembly.Memory,
  addressType: "i64" | "i32",
): number | bigint {
  const instance = new WebAssembly.Instance(externalGrowModule(addressType), {
    env: { memory },
  });
  const grow = instance.exports.grow;
  if (typeof grow !== "function") {
    throw new TypeError("external grow probe did not export a function");
  }
  return grow() as number | bigint;
}

describe("studio-wasm64-memory-governor capability probes", () => {
  it("uses real module instantiation and grow results instead of claiming a safe GiB value", () => {
    const report = checkStudioWasm64Capability();

    expect(typeof report.isWasm64Supported).toBe("boolean");
    expect(report.requestedRuntime).toBe("memory64");
    expect(typeof report.isWasm32ReferenceSupported).toBe("boolean");
    expect(typeof report.isSimdSupported).toBe("boolean");
    expect(report.maxAllocatableMemoryGiB).toBeNull();
    expect(report.webMemory64AddressSpaceLimitGiB).toBe(16);
    expect(report.wasm32AddressSpaceLimitGiB).toBe(4);

    if (report.isWasm64Supported) {
      expect(report.selectedRuntime).toBe("memory64");
      expect(report.memory64).toMatchObject({
        addressType: "i64",
        moduleValidated: true,
        instantiated: true,
        growSucceeded: true,
        operational: true,
        initialByteLength: Number(STUDIO_WASM_PAGE_BYTES),
        grownByteLength: Number(STUDIO_WASM_PAGE_BYTES * BigInt(2)),
        failureReason: null,
      });
    } else {
      expect(report.selectedRuntime).toBe("unavailable");
      expect(report.memory64.operational).toBe(false);
      expect(report.memory64.failureReason).not.toBeNull();
    }

    expect(report.memory32).toMatchObject({
      addressType: "i32",
      moduleValidated: true,
      instantiated: true,
      growSucceeded: true,
      operational: true,
      initialByteLength: Number(STUDIO_WASM_PAGE_BYTES),
      grownByteLength: Number(STUDIO_WASM_PAGE_BYTES * BigInt(2)),
      failureReason: null,
    });
  });

  it("reports an unavailable host without throwing or inventing a fallback", () => {
    const report = checkStudioWasm64Capability({ webAssembly: null });

    expect(report).toMatchObject({
      isWasm64Supported: false,
      isWasm32ReferenceSupported: false,
      isSimdSupported: false,
      selectedRuntime: "unavailable",
    });
    expect(report.memory64.failureReason).toBe("webassembly-unavailable");
    expect(report.memory32.failureReason).toBe("webassembly-unavailable");
  });

  it("keeps supported memory32 evidence reference-only until explicitly selected", () => {
    const webAssembly = nativeHostWithoutMemory64();
    const report = checkStudioWasm64Capability({
      webAssembly,
    });

    expect(report.isWasm64Supported).toBe(false);
    expect(report.memory64.failureReason).toBe("module-not-validated");
    expect(report.isWasm32ReferenceSupported).toBe(true);
    expect(report.requestedRuntime).toBe("memory64");
    expect(report.selectedRuntime).toBe("unavailable");

    const explicitReference = checkStudioWasm64Capability({
      webAssembly: nativeHostWithoutMemory64(),
      selectedMode: "i32",
    });
    expect(explicitReference.requestedRuntime).toBe("memory32-requested");
    expect(explicitReference.selectedRuntime).toBe("memory32-requested");
  });

  it("caches the default host probe once but never caches an injected test seam", () => {
    const firstDefault = checkStudioWasm64Capability();
    expect(checkStudioWasm64Capability()).toBe(firstDefault);

    const base = nativeHostWithoutMemory64();
    let validateCalls = 0;
    const injected = {
      ...base,
      Module: base.Module,
      Instance: base.Instance,
      Memory: base.Memory,
      validate(bytes: BufferSource): boolean {
        validateCalls += 1;
        return base.validate(bytes);
      },
    } as typeof WebAssembly;

    checkStudioWasm64Capability({ webAssembly: injected });
    const callsAfterFirstProbe = validateCalls;
    checkStudioWasm64Capability({ webAssembly: injected });

    expect(callsAfterFirstProbe).toBe(3);
    expect(validateCalls).toBe(6);
  });
});

describe("StudioWasmLinearMemoryRuntime", () => {
  it("reserves a quality-first Memory64 ceiling without eagerly committing it", () => {
    const result = createStudioWasmMemoryRuntime();
    if (!result.ok) {
      expect(result.reason).toBe("memory64-unsupported");
      return;
    }

    expect(result.runtime.addressType).toBe("i64");
    expect(result.runtime.maximumPages * STUDIO_WASM_PAGE_BYTES).toBe(
      STUDIO_WASM64_DEFAULT_WORKING_SET_MAX_BYTES,
    );
    expect(result.runtime.currentByteLength).toBe(STUDIO_WASM_PAGE_BYTES);
  });

  it("keeps explicit memory32 on its smaller compatibility ceiling", () => {
    const result = createStudioWasmMemoryRuntime({ selectedMode: "i32" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.runtime.maximumPages * STUDIO_WASM_PAGE_BYTES).toBe(
      STUDIO_WASM32_DEFAULT_WORKING_SET_MAX_BYTES,
    );
    expect(result.runtime.currentByteLength).toBe(STUDIO_WASM_PAGE_BYTES);
  });

  it("selects Memory64 as the primary path when the host supports it", () => {
    const capability = checkStudioWasm64Capability();
    const result = createStudioWasmMemoryRuntime({
      initialPages: BigInt(1),
      maximumPages: BigInt(3),
    });

    if (!capability.isWasm64Supported) {
      expect(result).toMatchObject({
        ok: false,
        reason: "memory64-unsupported",
      });
      return;
    }

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.runtime.addressType).toBe("i64");
    expect(result.runtime.selection).toBe("memory64");
    expect(result.runtime.currentPages).toBe(BigInt(1));

    const grow = result.runtime.growToFit(STUDIO_WASM_PAGE_BYTES + BigInt(1));
    expect(grow).toMatchObject({
      ok: true,
      previousPages: BigInt(1),
      currentPages: BigInt(2),
      grownPages: BigInt(1),
      generation: 1,
    });

    const view = result.runtime.createByteView(
      STUDIO_WASM_PAGE_BYTES,
      32,
    );
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.view.byteLength).toBe(32);
      expect(view.generation).toBe(1);
    }
  });

  it("never turns a failed Memory64 request into Memory32 execution", () => {
    const webAssembly = nativeHostWithoutMemory64();
    const denied = createStudioWasmMemoryRuntime({
      webAssembly,
      maximumPages: BigInt(2),
    });
    expect(denied).toMatchObject({
      ok: false,
      reason: "memory64-unsupported",
    });

    const explicitReference = createStudioWasmMemoryRuntime({
      webAssembly,
      selectedMode: "i32",
      maximumPages: BigInt(2),
    });
    expect(explicitReference.ok).toBe(true);
    if (!explicitReference.ok) return;
    expect(explicitReference.runtime.addressType).toBe("i32");
    expect(explicitReference.runtime.selection).toBe("memory32-requested");
  });

  it("supports an explicit memory32 runtime and refreshes views after grow", () => {
    const result = createStudioWasmMemoryRuntime({
      selectedMode: "i32",
      initialPages: BigInt(1),
      maximumPages: BigInt(3),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = result.runtime.createByteView(BigInt(0), 16);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const grow = result.runtime.growToFit(STUDIO_WASM_PAGE_BYTES * BigInt(2));
    expect(grow.ok).toBe(true);
    if (!grow.ok) return;
    expect(grow.generation).toBe(1);
    expect(before.view.buffer.byteLength).toBe(0);

    const after = result.runtime.createByteView(BigInt(0), 16);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.generation).toBe(1);
      expect(after.view.buffer.byteLength).toBe(
        Number(STUDIO_WASM_PAGE_BYTES * BigInt(2)),
      );
    }
  });

  it.each(["i32", "i64"] as const)(
    "detects a real external %s Wasm memory.grow and invalidates old views",
    (addressType) => {
      const result = createStudioWasmMemoryRuntime({
        selectedMode: addressType,
        initialPages: BigInt(1),
        maximumPages: BigInt(3),
      });
      if (addressType === "i64" && !result.ok) {
        expect(result.reason).toBe("memory64-unsupported");
        return;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const before = result.runtime.createByteView(BigInt(0), 16);
      expect(before.ok).toBe(true);
      if (!before.ok) return;

      expect(
        growThroughImportedMemory(result.runtime.memory, addressType),
      ).toBe(addressType === "i64" ? BigInt(1) : 1);
      expect(result.runtime.generation).toBe(1);
      expect(result.runtime.currentPages).toBe(BigInt(2));
      expect(result.runtime.currentByteLength).toBe(
        STUDIO_WASM_PAGE_BYTES * BigInt(2),
      );
      expect(before.view.buffer.byteLength).toBe(0);

      const after = result.runtime.createByteView(BigInt(0), 16);
      expect(after).toMatchObject({ ok: true, generation: 1 });
    },
  );

  it("synchronizes direct external JS growth at grow and view entry points", () => {
    const result = createStudioWasmMemoryRuntime({
      selectedMode: "i32",
      initialPages: BigInt(1),
      maximumPages: BigInt(3),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const firstView = result.runtime.createByteView(BigInt(0), 16);
    expect(firstView.ok).toBe(true);
    result.runtime.memory.grow(1);

    expect(
      result.runtime.growToFit(STUDIO_WASM_PAGE_BYTES * BigInt(2)),
    ).toEqual({
      ok: true,
      previousPages: BigInt(2),
      currentPages: BigInt(2),
      grownPages: BigInt(0),
      generation: 1,
      oldBufferDetached: false,
    });
    expect(firstView.ok && firstView.view.buffer.byteLength).toBe(0);

    const secondView = result.runtime.createByteView(
      STUDIO_WASM_PAGE_BYTES,
      16,
    );
    expect(secondView).toMatchObject({ ok: true, generation: 1 });
    result.runtime.memory.grow(1);

    const thirdView = result.runtime.createByteView(
      STUDIO_WASM_PAGE_BYTES * BigInt(2),
      16,
    );
    expect(thirdView).toMatchObject({ ok: true, generation: 2 });
    expect(secondView.ok && secondView.view.buffer.byteLength).toBe(0);
  });

  it("detects a same-identity resizable buffer length change", () => {
    const buffer = new ArrayBuffer(Number(STUDIO_WASM_PAGE_BYTES), {
      maxByteLength: Number(STUDIO_WASM_PAGE_BYTES * BigInt(3)),
    });
    const memory = {
      buffer,
      grow(delta: number | bigint): number | bigint {
        const previousPages =
          BigInt(buffer.byteLength) / STUDIO_WASM_PAGE_BYTES;
        const nextPages = previousPages + BigInt(delta);
        buffer.resize(Number(nextPages * STUDIO_WASM_PAGE_BYTES));
        return typeof delta === "bigint"
          ? previousPages
          : Number(previousPages);
      },
    } as unknown as WebAssembly.Memory;
    const runtime = new StudioWasmLinearMemoryRuntime({
      memory,
      addressType: "i32",
      selection: "memory32-requested",
      maximumPages: BigInt(3),
    });
    const before = runtime.createByteView(BigInt(0), 16);
    expect(before.ok).toBe(true);

    memory.grow(1);

    expect(runtime.currentByteLength).toBe(
      STUDIO_WASM_PAGE_BYTES * BigInt(2),
    );
    expect(runtime.generation).toBe(1);
    expect(memory.buffer).toBe(buffer);
    expect(before.ok && before.view.buffer.byteLength).toBe(
      Number(STUDIO_WASM_PAGE_BYTES * BigInt(2)),
    );
  });

  it("bumps generation and poisons the runtime after a grow result mismatch", () => {
    const memory = new WebAssembly.Memory({
      initial: 1,
      maximum: 3,
    });
    const nativeGrow = memory.grow.bind(memory);
    Object.defineProperty(memory, "grow", {
      configurable: true,
      value(delta: number) {
        return nativeGrow(delta) + 1;
      },
    });
    const runtime = new StudioWasmLinearMemoryRuntime({
      memory,
      addressType: "i32",
      selection: "memory32-requested",
      maximumPages: BigInt(3),
    });
    const before = runtime.createByteView(BigInt(0), 16);
    expect(before.ok).toBe(true);

    const mismatch = runtime.growToFit(
      STUDIO_WASM_PAGE_BYTES * BigInt(2),
    );

    expect(mismatch).toEqual({
      ok: false,
      reason: "grow-result-mismatch",
      currentPages: BigInt(2),
      maximumPages: BigInt(3),
      generation: 1,
    });
    expect(before.ok && before.view.buffer.byteLength).toBe(0);
    expect(runtime.createByteView(BigInt(0), 16)).toEqual({
      ok: false,
      reason: "runtime-poisoned-after-grow-validation",
      generation: 1,
    });
    expect(
      runtime.growToFit(STUDIO_WASM_PAGE_BYTES * BigInt(3)),
    ).toEqual({
      ok: false,
      reason: "runtime-poisoned-after-grow-validation",
      currentPages: BigInt(2),
      maximumPages: BigInt(3),
      generation: 1,
    });
  });

  it("bumps generation and poisons the runtime after a grown-size mismatch", () => {
    const memory = new WebAssembly.Memory({
      initial: 1,
      maximum: 3,
    });
    const nativeGrow = memory.grow.bind(memory);
    Object.defineProperty(memory, "grow", {
      configurable: true,
      value() {
        return nativeGrow(1);
      },
    });
    const runtime = new StudioWasmLinearMemoryRuntime({
      memory,
      addressType: "i32",
      selection: "memory32-requested",
      maximumPages: BigInt(3),
    });

    expect(
      runtime.growToFit(STUDIO_WASM_PAGE_BYTES * BigInt(3)),
    ).toEqual({
      ok: false,
      reason: "grown-size-mismatch",
      currentPages: BigInt(2),
      maximumPages: BigInt(3),
      generation: 1,
    });
    expect(runtime.createByteView(BigInt(0), 16)).toMatchObject({
      ok: false,
      reason: "runtime-poisoned-after-grow-validation",
      generation: 1,
    });
  });

  it("refuses over-budget growth before asking the host to allocate", () => {
    const result = createStudioWasmMemoryRuntime({
      selectedMode: "i32",
      initialPages: BigInt(1),
      maximumPages: BigInt(2),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grow = result.runtime.growToFit(STUDIO_WASM_PAGE_BYTES * BigInt(3));
    expect(grow).toEqual({
      ok: false,
      reason: "working-set-limit-exceeded",
      currentPages: BigInt(1),
      maximumPages: BigInt(2),
      generation: 0,
    });
    expect(result.runtime.currentPages).toBe(BigInt(1));
  });

  it("rejects impossible page budgets and the web Memory64 ceiling", () => {
    expect(
      createStudioWasmMemoryRuntime({
        initialPages: BigInt(2),
        maximumPages: BigInt(1),
      }),
    ).toMatchObject({ ok: false, reason: "invalid-page-budget" });

    expect(
      createStudioWasmMemoryRuntime({
        maximumPages:
          STUDIO_WEB_MEMORY64_ADDRESS_LIMIT_BYTES /
            STUDIO_WASM_PAGE_BYTES +
          BigInt(1),
      }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(
        /address-space-limit-exceeded|memory64-unsupported/,
      ),
    });
  });
});

describe("StudioWasm64MemoryManager chunk windows", () => {
  it("keeps allocations and totals as bigint", () => {
    const manager = new StudioWasm64MemoryManager({
      windowBytes: 1024,
    });
    const first = manager.allocateLayerMemory("layer-1", 1000);
    const second = manager.allocateLayerMemory("layer-2", BigInt(2000));

    expect(first.addressI64 % BigInt(64)).toBe(BigInt(0));
    expect(second.addressI64).toBeGreaterThan(first.addressI64);
    expect(manager.getTotalAllocatedBytes()).toBe(BigInt(3000));
    expect(manager.getAllocation("layer-1")).toEqual(first);
    expect(manager.releaseAllocation("layer-1")).toBe(true);
    expect(manager.getTotalAllocatedBytes()).toBe(BigInt(2000));
  });

  it("crosses the 4 GiB boundary without Number or bitwise truncation", () => {
    const manager = new StudioWasm64MemoryManager({
      startAddressI64: STUDIO_WASM32_ADDRESS_LIMIT_BYTES - BigInt(64),
      alignmentBytes: BigInt(64),
      windowBytes: 128,
      maxVirtualAddressExclusiveI64:
        STUDIO_WASM32_ADDRESS_LIMIT_BYTES + BigInt(1024),
    });
    const allocation = manager.allocateLayerMemory("huge-layer", BigInt(256));
    const windows = [...manager.iterateAllocationWindows(allocation)];

    expect(allocation).toMatchObject({
      addressI64: STUDIO_WASM32_ADDRESS_LIMIT_BYTES - BigInt(64),
      endAddressExclusiveI64: STUDIO_WASM32_ADDRESS_LIMIT_BYTES + BigInt(192),
      crossesWasm32Boundary: true,
      requiresMemory64Addressing: true,
    });
    expect(manager.getWindowCountForRange(allocation.addressI64, BigInt(256))).toBe(BigInt(3));
    expect(windows.map((window) => window.byteLength)).toEqual([64, 128, 64]);
    expect(windows.map((window) => window.addressTier)).toEqual([
      "wasm32-compatible",
      "memory64-only",
      "memory64-only",
    ]);
    expect(windows[1]?.globalAddressI64).toBe(
      STUDIO_WASM32_ADDRESS_LIMIT_BYTES,
    );
    expect(typeof windows[1]?.offsetInChunk).toBe("number");
  });

  it("exposes one bounded window at a time for a large logical range", () => {
    const manager = new StudioWasm64MemoryManager({
      startAddressI64: STUDIO_WASM32_ADDRESS_LIMIT_BYTES + BigInt(17),
      alignmentBytes: BigInt(1),
      windowBytes: 1024,
      maxVirtualAddressExclusiveI64:
        STUDIO_WASM32_ADDRESS_LIMIT_BYTES + BigInt(4096),
    });
    const allocation = manager.allocateLayerMemory("windowed", BigInt(2048));
    const firstWindow = manager.resolveNextWindow(
      allocation.addressI64,
      allocation.byteSize,
    );

    expect(firstWindow.addressTier).toBe("memory64-only");
    expect(firstWindow.byteLength).toBeLessThanOrEqual(1024);
    expect(firstWindow.byteLengthI64).toBe(BigInt(firstWindow.byteLength));
    expect(firstWindow.globalAddressI64).toBeGreaterThan(BigInt(0xffffffff));
    expect(typeof firstWindow.chunkIndexI64).toBe("bigint");
  });

  it("rejects duplicate IDs, unsafe Number sizes and virtual-map overflow", () => {
    const manager = new StudioWasm64MemoryManager({
      startAddressI64: BigInt(0),
      windowBytes: 1024,
      maxVirtualAddressExclusiveI64: BigInt(4096),
    });
    manager.allocateLayerMemory("layer", BigInt(1024));

    expect(() => manager.allocateLayerMemory("layer", BigInt(1))).toThrow(
      /already exists/,
    );
    expect(() =>
      manager.allocateLayerMemory("unsafe", Number.MAX_SAFE_INTEGER + 1),
    ).toThrow(/safe integer/);
    expect(() => manager.allocateLayerMemory("overflow", BigInt(4096))).toThrow(
      /exceeds/,
    );
  });

  it("rejects a start address whose aligned value reaches the virtual-map limit", () => {
    expect(
      () =>
        new StudioWasm64MemoryManager({
          startAddressI64: BigInt(99),
          alignmentBytes: BigInt(64),
          windowBytes: 64,
          maxVirtualAddressExclusiveI64: BigInt(100),
        }),
    ).toThrow(/aligned startAddressI64/);
  });
});
