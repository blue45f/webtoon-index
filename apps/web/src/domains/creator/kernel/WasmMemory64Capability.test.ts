import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { StudioLargeDocumentMemory64Runtime } from "../studio-large-document-memory64-runtime";
import { createStudioWasmMemoryRuntime } from "../studio-wasm64-memory-governor";

import {
  attemptWasmScratchAllocation,
  iterateWasmScratchChunks,
  planWasmScratchWorkingSet,
  probeWasmMemory64Capability,
  WASM_MEMORY64_ACCELERATOR_POLICY,
  type WasmScratchCapabilitySelection,
  type WasmScratchWorkingSetPlan,
} from "./WasmMemory64Capability";

const PAGE_BYTES = BigInt(64 * 1024);
const MEMORY64_CAPABILITY: WasmScratchCapabilitySelection = Object.freeze({
  selectedRuntime: "memory64",
});
const MEMORY32_CAPABILITY: WasmScratchCapabilitySelection = Object.freeze({
  selectedRuntime: "memory32-requested",
});
const UNAVAILABLE_CAPABILITY: WasmScratchCapabilitySelection = Object.freeze({
  selectedRuntime: "unavailable",
});

function mebibytes(value: number): bigint {
  return BigInt(value) * BigInt(1024) * BigInt(1024);
}

function gibibytes(value: number): bigint {
  return mebibytes(value) * BigInt(1024);
}

function nativeHostWithoutMemory64(): typeof WebAssembly {
  return {
    ...WebAssembly,
    Module: WebAssembly.Module,
    Instance: WebAssembly.Instance,
    Memory: WebAssembly.Memory,
    validate(bytes: BufferSource): boolean {
      const view = ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
      if (view[11] === 0x05) return false;
      return WebAssembly.validate(bytes);
    },
  } as typeof WebAssembly;
}

function nativeHostWithBrokenMemory64JsApi(): typeof WebAssembly {
  const Memory = new Proxy(WebAssembly.Memory, {
    construct(target, argumentsList, newTarget) {
      const descriptor = argumentsList[0] as { readonly address?: unknown };
      if (descriptor.address === "i64") {
        throw new TypeError("i64 JS Memory descriptor is unavailable");
      }
      return Reflect.construct(target, argumentsList, newTarget);
    },
  });
  return {
    ...WebAssembly,
    Module: WebAssembly.Module,
    Instance: WebAssembly.Instance,
    Memory,
    validate: WebAssembly.validate,
  } as typeof WebAssembly;
}

function requirePlan(
  result: ReturnType<typeof planWasmScratchWorkingSet>,
): WasmScratchWorkingSetPlan {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected a plan, received ${result.reason}`);
  return result;
}

describe("WasmMemory64 capability boundary", () => {
  it.each(["Chrome", "Firefox"])(
    "detects a %s-class Memory64 API profile from real Wasm behavior, not its name",
    () => {
      const receipt = probeWasmMemory64Capability({
        webAssembly: WebAssembly,
      });

      expect(receipt).toMatchObject({
        requestedRuntime: "memory64",
        selectedRuntime: "memory64",
        isMemory64Supported: true,
        isMemory32ReferenceSupported: true,
        runtimeAvailableBytes: null,
        runtimeAvailablePages: null,
        memory64JsApi: {
          addressType: "i64",
          attempted: true,
          operational: true,
          initialPages: BigInt(1),
          maximumPages: BigInt(1),
          observedPages: BigInt(1),
          failureReason: null,
        },
      });
      expect(receipt.moduleProbe.memory64).toMatchObject({
        moduleValidated: true,
        instantiated: true,
        growSucceeded: true,
        operational: true,
      });
      expect(receipt.largestSingleProbeAllocationBytes).toBe(
        PAGE_BYTES * BigInt(2),
      );
      expect(Object.isFrozen(receipt)).toBe(true);
    },
  );

  it("fails closed for a Safari-class profile without Memory64", () => {
    const receipt = probeWasmMemory64Capability({
      webAssembly: nativeHostWithoutMemory64(),
    });

    expect(receipt).toMatchObject({
      requestedRuntime: "memory64",
      selectedRuntime: "unavailable",
      isMemory64Supported: false,
      isMemory32ReferenceSupported: true,
      memory64JsApi: {
        attempted: false,
        operational: false,
        failureReason: "module-probe-failed",
      },
      memory32JsApi: {
        attempted: true,
        operational: true,
      },
    });
    expect(receipt.moduleProbe.memory64.failureReason).toBe(
      "module-not-validated",
    );

    const explicitReference = probeWasmMemory64Capability({
      webAssembly: nativeHostWithoutMemory64(),
      selectedRuntime: "memory32-requested",
    });
    expect(explicitReference).toMatchObject({
      requestedRuntime: "memory32-requested",
      selectedRuntime: "memory32-requested",
      isMemory64Supported: false,
      isMemory32ReferenceSupported: true,
    });
  });

  it("rejects partial Memory64 when the binary works but the JS Memory API does not", () => {
    const receipt = probeWasmMemory64Capability({
      webAssembly: nativeHostWithBrokenMemory64JsApi(),
    });

    expect(receipt.moduleProbe.memory64.operational).toBe(true);
    expect(receipt.memory64JsApi).toMatchObject({
      attempted: true,
      operational: false,
      initialPages: BigInt(1),
      maximumPages: BigInt(1),
      failureReason: "memory-construction-failed",
    });
    expect(receipt.selectedRuntime).toBe("unavailable");
    expect(receipt.isMemory64Supported).toBe(false);
  });

  it("reports an unavailable host without fabricating a memory budget", () => {
    const receipt = probeWasmMemory64Capability({ webAssembly: null });

    expect(receipt).toMatchObject({
      selectedRuntime: "unavailable",
      isMemory64Supported: false,
      isMemory32ReferenceSupported: false,
      runtimeAvailableBytes: null,
      runtimeAvailablePages: null,
    });
    expect(receipt.memory64JsApi.attempted).toBe(false);
    expect(receipt.memory32JsApi.attempted).toBe(false);
  });

  it("contains no UA-sniffing branch and classifies Memory64 as scratch-only", () => {
    const source = readFileSync(
      new URL("./WasmMemory64Capability.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/navigator|userAgentData|userAgent/u);
    expect(WASM_MEMORY64_ACCELERATOR_POLICY).toEqual({
      canonicalStateAuthority: "CreatorProjectIRV16",
      durablePersistenceAuthority: "opfs-cas-paging",
      role: "scratch-accelerator-only",
      selectionPolicy: "exact-runtime-before-operation",
      memory32Role: "explicit-reference-provider-only",
      memory64AllocationPolicy: "retry-smaller-i64-window-then-backpressure",
      workloads: [
        "project",
        "decode",
        "effect",
        "tile",
        "animation",
        "brush",
        "texture",
        "scene3d",
        "physics",
        "vision",
      ],
      canonicalWritesAllowed: false,
      persistenceWritesAllowed: false,
      wholeDocumentMaterializationAllowed: false,
      wholeJsonMaterializationAllowed: false,
    });
    expect(Object.isFrozen(WASM_MEMORY64_ACCELERATOR_POLICY.workloads)).toBe(
      true,
    );
  });
});

describe("dynamic Wasm scratch working-set planning", () => {
  it("uses an explicit 16 GiB runtime budget without treating it as the working set", () => {
    const availableBytes = gibibytes(16);
    const preferredChunkBytes = mebibytes(96);
    const logicalByteLength = gibibytes(1024);

    const plan = requirePlan(planWasmScratchWorkingSet(
      MEMORY64_CAPABILITY,
      {
        availableBytes,
        availablePages: availableBytes / PAGE_BYTES,
      },
      {
        workload: "effect",
        logicalByteLength,
        preferredChunkBytes,
        minimumChunkBytes: mebibytes(2),
      },
    ));

    expect(plan).toMatchObject({
      status: "ready",
      runtime: "memory64",
      addressType: "i64",
      logicalByteLength,
      chunkBytes: preferredChunkBytes,
      workingSetBytes: preferredChunkBytes,
      materializesWholeDocument: false,
      materializesWholeJson: false,
      readsCanonicalProjectBytes: false,
    });
    expect(plan.workingSetBytes).toBeLessThan(availableBytes);
    expect(plan.budget.protocolMaximumPages).toBe(BigInt(262_144));
    expect(plan.chunkCount).toBeGreaterThan(BigInt(1));
  });

  it("clamps an overstated runtime page budget to the web Memory64 16 GiB address limit", () => {
    const advertisedBytes = gibibytes(64);
    const plan = requirePlan(planWasmScratchWorkingSet(
      MEMORY64_CAPABILITY,
      {
        availableBytes: advertisedBytes,
        availablePages: advertisedBytes / PAGE_BYTES,
      },
      {
        workload: "scene3d",
        logicalByteLength: gibibytes(256),
        preferredChunkBytes: gibibytes(32),
        minimumChunkBytes: mebibytes(1),
      },
    ));

    expect(plan.budget.protocolMaximumPages).toBe(BigInt(262_144));
    expect(plan.budget.effectiveAvailableBytes).toBe(gibibytes(16));
    expect(plan.workingSetBytes).toBe(gibibytes(16));
    expect(plan.chunkCount).toBe(BigInt(16));
  });

  it("keeps an explicitly selected memory32 reference job in bounded windows", () => {
    const availableBytes = gibibytes(8);
    const logicalByteLength = gibibytes(128);
    const plan = requirePlan(planWasmScratchWorkingSet(
      MEMORY32_CAPABILITY,
      {
        availableBytes,
        availablePages: availableBytes / PAGE_BYTES,
      },
      {
        workload: "animation",
        logicalByteLength,
        preferredChunkBytes: mebibytes(128),
        minimumChunkBytes: mebibytes(1),
      },
    ));

    expect(plan.status).toBe("ready");
    expect(plan.runtime).toBe("memory32-requested");
    expect(plan.logicalByteLength).toBeGreaterThan(gibibytes(4));
    expect(plan.workingSetBytes).toBe(mebibytes(128));
    expect(plan.budget.protocolMaximumPages).toBe(BigInt(65_536));
    expect(plan.budget.effectiveAvailableBytes).toBe(gibibytes(4));
    expect(plan.chunkCount).toBe(BigInt(1024));
  });

  it("feeds an explicitly selected memory32 plan into the out-of-core reference runtime", () => {
    const plan = requirePlan(planWasmScratchWorkingSet(
      MEMORY32_CAPABILITY,
      {
        availableBytes: mebibytes(2),
        availablePages: mebibytes(2) / PAGE_BYTES,
      },
      {
        workload: "project",
        logicalByteLength: gibibytes(8),
        preferredChunkBytes: mebibytes(1),
        minimumChunkBytes: mebibytes(1),
      },
    ));
    const runtimeResult = createStudioWasmMemoryRuntime({
      selectedMode: "i32",
      initialPages: BigInt(1),
      maximumPages: plan.workingSetPages,
    });
    expect(runtimeResult.ok).toBe(true);
    if (!runtimeResult.ok) return;

    const runtime = new StudioLargeDocumentMemory64Runtime({
      runtime: runtimeResult.runtime,
      maxResidentBytes: plan.workingSetBytes,
      chunkBytes: Number(plan.chunkBytes),
    });
    const globalByteOffset = gibibytes(4) + BigInt(123_456);
    const activation = runtime.activateWindow({
      focusSlotIndex: BigInt(0),
      firstSlotIndex: BigInt(0),
      lastSlotIndexExclusive: BigInt(1),
      tileCount: BigInt(1),
      byteOffset: globalByteOffset,
      byteLength: plan.chunkBytes,
      byteEndExclusive: globalByteOffset + plan.chunkBytes,
    });

    expect(activation.ok).toBe(true);
    if (!activation.ok) return;
    expect(activation.handle.residentView.byteLength).toBe(
      Number(mebibytes(1)),
    );
    expect(runtime.globalToResident(
      activation.handle,
      globalByteOffset + PAGE_BYTES,
    )).toEqual({ ok: true, address: PAGE_BYTES });
    expect(plan).toMatchObject({
      runtime: "memory32-requested",
      logicalByteLength: gibibytes(8),
      workingSetBytes: mebibytes(1),
      materializesWholeDocument: false,
      materializesWholeJson: false,
    });
  });

  it("takes the smaller of runtime bytes/pages and preserves a caller reserve", () => {
    const plan = requirePlan(planWasmScratchWorkingSet(
      MEMORY64_CAPABILITY,
      {
        availableBytes: PAGE_BYTES * BigInt(10),
        availablePages: BigInt(4),
        reservedBytes: PAGE_BYTES,
      },
      {
        workload: "tile",
        logicalByteLength: PAGE_BYTES * BigInt(20),
        preferredChunkBytes: PAGE_BYTES * BigInt(8),
        minimumChunkBytes: PAGE_BYTES,
      },
    ));

    expect(plan.budget).toEqual({
      providedAvailableBytes: PAGE_BYTES * BigInt(10),
      providedAvailablePages: BigInt(4),
      reservedBytes: PAGE_BYTES,
      effectiveAvailableBytes: PAGE_BYTES * BigInt(4),
      usableBytes: PAGE_BYTES * BigInt(3),
      usablePages: BigInt(3),
      pageSizeBytes: PAGE_BYTES,
      protocolMaximumPages: BigInt(262_144),
    });
    expect(plan.workingSetPages).toBe(BigInt(3));
    expect(plan.chunkBytes).toBe(PAGE_BYTES * BigInt(3));
  });

  it("returns explicit backpressure for missing capacity instead of assuming host RAM", () => {
    const result = planWasmScratchWorkingSet(
      MEMORY64_CAPABILITY,
      { availableBytes: BigInt(0), availablePages: BigInt(0) },
      {
        workload: "decode",
        logicalByteLength: gibibytes(1),
        preferredChunkBytes: mebibytes(16),
      },
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: "backpressure",
      reason: "insufficient-runtime-budget",
      action: "wait-for-budget",
      recommendedPages: BigInt(0),
    }));
  });

  it("returns OPFS paging when neither memory mode is operational", () => {
    const result = planWasmScratchWorkingSet(
      UNAVAILABLE_CAPABILITY,
      { availableBytes: mebibytes(64), availablePages: BigInt(1024) },
      {
        workload: "decode",
        logicalByteLength: gibibytes(1),
        preferredChunkBytes: mebibytes(16),
      },
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: "backpressure",
      reason: "accelerator-unavailable",
      action: "stream-through-opfs",
    }));
  });

  it.each([
    {
      label: "non-finite logical size",
      budget: { availableBytes: mebibytes(2), availablePages: BigInt(32) },
      request: {
        workload: "decode" as const,
        logicalByteLength: Number.POSITIVE_INFINITY,
        preferredChunkBytes: mebibytes(1),
      },
      reason: "invalid-request",
    },
    {
      label: "unsafe Number chunk size",
      budget: { availableBytes: mebibytes(2), availablePages: BigInt(32) },
      request: {
        workload: "decode" as const,
        logicalByteLength: mebibytes(4),
        preferredChunkBytes: Number.MAX_SAFE_INTEGER + 1,
      },
      reason: "invalid-request",
    },
    {
      label: "negative bigint budget",
      budget: { availableBytes: BigInt(-1), availablePages: BigInt(1) },
      request: {
        workload: "decode" as const,
        logicalByteLength: mebibytes(4),
        preferredChunkBytes: mebibytes(1),
      },
      reason: "invalid-runtime-budget",
    },
    {
      label: "NaN page budget",
      budget: { availableBytes: mebibytes(2), availablePages: Number.NaN },
      request: {
        workload: "decode" as const,
        logicalByteLength: mebibytes(4),
        preferredChunkBytes: mebibytes(1),
      },
      reason: "invalid-runtime-budget",
    },
  ])("rejects $label", ({ budget, request, reason }) => {
    const result = planWasmScratchWorkingSet(
      MEMORY64_CAPABILITY,
      budget,
      request,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: "backpressure",
      reason,
    }));
  });

  it("pages a beyond-Number-safe project surface stream without materializing project JSON", () => {
    const logicalByteLength =
      BigInt(Number.MAX_SAFE_INTEGER) * mebibytes(2);
    const plan = requirePlan(planWasmScratchWorkingSet(
      MEMORY64_CAPABILITY,
      {
        availableBytes: mebibytes(2),
        availablePages: mebibytes(2) / PAGE_BYTES,
      },
      {
        workload: "project",
        logicalByteLength,
        preferredChunkBytes: mebibytes(1),
      },
    ));
    const chunks = iterateWasmScratchChunks(plan);

    expect(plan.chunkCount).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(plan).toMatchObject({
      workload: "project",
      readsCanonicalProjectBytes: false,
      materializesWholeDocument: false,
      materializesWholeJson: false,
    });
    expect(chunks.next().value).toEqual({
      chunkIndex: BigInt(0),
      logicalByteOffset: BigInt(0),
      logicalByteLength: mebibytes(1),
      requiredPages: BigInt(16),
      residentByteLength: mebibytes(1),
      isLast: false,
      sourceAccess: "paged-range-only",
    });
    expect(chunks.next().value).toEqual(expect.objectContaining({
      chunkIndex: BigInt(1),
      logicalByteOffset: mebibytes(1),
      logicalByteLength: mebibytes(1),
    }));
    expect(chunks.next().done).toBe(false);
  });
});

describe("Wasm scratch allocation receipts", () => {
  function smallPlan(
    capability: WasmScratchCapabilitySelection = MEMORY64_CAPABILITY,
    preferredPages = BigInt(4),
    minimumPages = BigInt(1),
  ): WasmScratchWorkingSetPlan {
    return requirePlan(planWasmScratchWorkingSet(
      capability,
      {
        availableBytes: PAGE_BYTES * BigInt(8),
        availablePages: BigInt(8),
      },
      {
        workload: "effect",
        logicalByteLength: PAGE_BYTES * BigInt(32),
        preferredChunkBytes: PAGE_BYTES * preferredPages,
        minimumChunkBytes: PAGE_BYTES * minimumPages,
      },
    ));
  }

  it("passes only the bounded resident request to an external resource owner", () => {
    const allocate = vi.fn();
    const plan = smallPlan();

    const receipt = attemptWasmScratchAllocation(plan, { allocate });

    expect(receipt).toEqual({
      ok: true,
      status: "allocated",
      runtime: "memory64",
      pages: BigInt(4),
      residentBytes: PAGE_BYTES * BigInt(4),
      policy: WASM_MEMORY64_ACCELERATOR_POLICY,
    });
    expect(allocate).toHaveBeenCalledWith({
      workload: "effect",
      runtime: "memory64",
      addressType: "i64",
      initialPages: BigInt(4),
      maximumPages: BigInt(4),
      residentBytes: PAGE_BYTES * BigInt(4),
    });
    expect(Object.isFrozen(allocate.mock.calls[0]?.[0])).toBe(true);
  });

  it("returns a smaller-window backpressure receipt for the same Memory64 provider", () => {
    const plan = smallPlan();
    const receipt = attemptWasmScratchAllocation(plan, {
      allocate() {
        throw new RangeError("host allocation denied");
      },
    });

    expect(receipt).toEqual({
      ok: false,
      status: "backpressure",
      reason: "allocation-failed",
      action: "retry-smaller-working-set",
      retryRuntime: "memory64",
      recommendedPages: BigInt(2),
      issue: {
        name: "RangeError",
        message: "host allocation denied",
      },
      policy: WASM_MEMORY64_ACCELERATOR_POLICY,
    });
  });

  it("fails closed when the minimum useful Memory64 window fails", () => {
    const plan = smallPlan(MEMORY64_CAPABILITY, BigInt(1), BigInt(1));
    const receipt = attemptWasmScratchAllocation(plan, {
      allocate() {
        throw new RangeError("minimum i64 allocation denied");
      },
    });

    expect(receipt).toEqual(expect.objectContaining({
      ok: false,
      status: "backpressure",
      reason: "allocation-failed",
      action: "stream-through-opfs",
      retryRuntime: "memory64",
      recommendedPages: BigInt(0),
    }));
  });

  it("backpressures a failed memory32 allocation with a smaller retry window", () => {
    const plan = smallPlan(MEMORY32_CAPABILITY);
    const receipt = attemptWasmScratchAllocation(plan, {
      allocate() {
        throw new Error("device memory pressure");
      },
    });

    expect(receipt).toEqual(expect.objectContaining({
      ok: false,
      status: "backpressure",
      reason: "allocation-failed",
      action: "retry-smaller-working-set",
      retryRuntime: "memory32-requested",
      recommendedPages: BigInt(2),
      issue: {
        name: "Error",
        message: "device memory pressure",
      },
    }));
  });

  it("falls back to OPFS streaming when the minimum window itself cannot allocate", () => {
    const plan = smallPlan(MEMORY32_CAPABILITY, BigInt(1), BigInt(1));
    const receipt = attemptWasmScratchAllocation(plan, {
      allocate() {
        throw new RangeError("out of memory");
      },
    });

    expect(receipt).toEqual(expect.objectContaining({
      ok: false,
      status: "backpressure",
      reason: "allocation-failed",
      action: "stream-through-opfs",
      retryRuntime: "memory32-requested",
      recommendedPages: BigInt(0),
    }));
  });
});
