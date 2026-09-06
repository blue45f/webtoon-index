import {
  checkStudioWasm64Capability,
  createStudioWasmMemoryRuntime,
  STUDIO_WEB_MEMORY64_ADDRESS_LIMIT_BYTES,
  STUDIO_WASM32_ADDRESS_LIMIT_BYTES,
  STUDIO_WASM_PAGE_BYTES,
} from "../studio-wasm64-memory-governor";

import type {
  StudioWasm64CapabilityReport,
  StudioWasmAddressType,
  StudioWasmCapabilityCheckOptions,
} from "../studio-wasm64-memory-governor";

/**
 * Memory64 is a disposable compute accelerator. It never becomes an authority
 * for canonical project state, persistence, or recovery.
 */
export const WASM_MEMORY64_ACCELERATOR_POLICY = Object.freeze({
  canonicalStateAuthority: "CreatorProjectIRV16",
  durablePersistenceAuthority: "opfs-cas-paging",
  role: "scratch-accelerator-only",
  selectionPolicy: "exact-runtime-before-operation",
  memory32Role: "explicit-reference-provider-only",
  memory64AllocationPolicy: "retry-smaller-i64-window-then-backpressure",
  workloads: Object.freeze([
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
  ] as const),
  canonicalWritesAllowed: false,
  persistenceWritesAllowed: false,
  wholeDocumentMaterializationAllowed: false,
  wholeJsonMaterializationAllowed: false,
});

export type WasmScratchWorkload =
  (typeof WASM_MEMORY64_ACCELERATOR_POLICY.workloads)[number];

export type WasmMemoryRuntimeSelection =
  | "memory64"
  | "memory32-requested"
  | "unavailable";

export type WasmExactMemoryRuntime = Exclude<
  WasmMemoryRuntimeSelection,
  "unavailable"
>;

export type WasmJsApiProbeFailureReason =
  | "module-probe-failed"
  | "memory-construction-failed"
  | "runtime-contract-mismatch";

export interface WasmJsApiProbeReceipt {
  readonly addressType: StudioWasmAddressType;
  readonly attempted: boolean;
  readonly operational: boolean;
  /** The confirmation allocates exactly one 64 KiB page, never a large heap. */
  readonly initialPages: bigint;
  readonly maximumPages: bigint;
  readonly observedPages: bigint;
  readonly failureReason: WasmJsApiProbeFailureReason | null;
}

export interface WasmMemory64CapabilityReceipt {
  /** Immutable provider requested before the capability probe begins. */
  readonly requestedRuntime: WasmExactMemoryRuntime;
  readonly selectedRuntime: WasmMemoryRuntimeSelection;
  readonly isMemory64Supported: boolean;
  readonly isMemory32ReferenceSupported: boolean;
  /** Actual module validation/instantiation/grow evidence from the existing governor. */
  readonly moduleProbe: StudioWasm64CapabilityReport;
  /** Independent JS `WebAssembly.Memory` construction confirmation. */
  readonly memory64JsApi: WasmJsApiProbeReceipt;
  readonly memory32JsApi: WasmJsApiProbeReceipt;
  /** A feature probe cannot estimate physical or safely allocatable memory. */
  readonly runtimeAvailableBytes: null;
  readonly runtimeAvailablePages: null;
  readonly largestSingleProbeAllocationBytes: bigint;
  readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
}

export interface WasmMemory64CapabilityOptions
  extends StudioWasmCapabilityCheckOptions {
  /** Defaults to the product Memory64 provider; Memory32 is reference-only and explicit. */
  readonly selectedRuntime?: WasmExactMemoryRuntime;
}

const ONE_PAGE = BigInt(1);
const ZERO_PAGES = BigInt(0);
const WASM32_PROTOCOL_MAX_PAGES =
  STUDIO_WASM32_ADDRESS_LIMIT_BYTES / STUDIO_WASM_PAGE_BYTES;
const WEB_MEMORY64_PROTOCOL_MAX_PAGES =
  STUDIO_WEB_MEMORY64_ADDRESS_LIMIT_BYTES / STUDIO_WASM_PAGE_BYTES;

const cachedDefaultCapabilities = new Map<
  WasmExactMemoryRuntime,
  WasmMemory64CapabilityReceipt
>();

function skippedJsApiProbe(
  addressType: StudioWasmAddressType,
): WasmJsApiProbeReceipt {
  return Object.freeze({
    addressType,
    attempted: false,
    operational: false,
    initialPages: ZERO_PAGES,
    maximumPages: ZERO_PAGES,
    observedPages: ZERO_PAGES,
    failureReason: "module-probe-failed" as const,
  });
}

function confirmJsMemoryApi(
  addressType: StudioWasmAddressType,
  options: WasmMemory64CapabilityOptions,
): WasmJsApiProbeReceipt {
  const runtimeResult = createStudioWasmMemoryRuntime({
    webAssembly: options.webAssembly,
    selectedMode: addressType,
    initialPages: ONE_PAGE,
    maximumPages: ONE_PAGE,
  });

  if (!runtimeResult.ok) {
    return Object.freeze({
      addressType,
      attempted: true,
      operational: false,
      initialPages: ONE_PAGE,
      maximumPages: ONE_PAGE,
      observedPages: ZERO_PAGES,
      failureReason: "memory-construction-failed" as const,
    });
  }

  const runtime = runtimeResult.runtime;
  const operational =
    runtime.addressType === addressType
    && runtime.currentPages === ONE_PAGE
    && runtime.maximumPages === ONE_PAGE;
  return Object.freeze({
    addressType,
    attempted: true,
    operational,
    initialPages: ONE_PAGE,
    maximumPages: ONE_PAGE,
    observedPages: runtime.currentPages,
    failureReason: operational ? null : "runtime-contract-mismatch",
  });
}

/**
 * Performs feature detection without user-agent inspection.
 *
 * The existing governor owns the tiny Memory64/Memory32 module probes. This
 * adapter additionally confirms the JS constructor contract with a one-page
 * runtime. The requested runtime is immutable: partial Memory64 support returns
 * unavailable and never selects Memory32. Neither probe makes a physical-memory
 * capacity claim.
 */
export function probeWasmMemory64Capability(
  options: WasmMemory64CapabilityOptions = {},
): WasmMemory64CapabilityReceipt {
  const requestedRuntime = options.selectedRuntime ?? "memory64";
  const usesDefaultHost = options.webAssembly === undefined;
  const cached = cachedDefaultCapabilities.get(requestedRuntime);
  if (usesDefaultHost && cached) {
    return cached;
  }

  const moduleProbe = checkStudioWasm64Capability({
    webAssembly: options.webAssembly,
    selectedMode: requestedRuntime === "memory64" ? "i64" : "i32",
  });
  const memory64JsApi = moduleProbe.memory64.operational
    ? confirmJsMemoryApi("i64", options)
    : skippedJsApiProbe("i64");
  const memory32JsApi = moduleProbe.memory32.operational
    ? confirmJsMemoryApi("i32", options)
    : skippedJsApiProbe("i32");

  const isMemory64Supported =
    moduleProbe.memory64.operational && memory64JsApi.operational;
  const isMemory32ReferenceSupported =
    moduleProbe.memory32.operational && memory32JsApi.operational;
  const requestedRuntimeSupported = requestedRuntime === "memory64"
    ? isMemory64Supported
    : isMemory32ReferenceSupported;
  const selectedRuntime: WasmMemoryRuntimeSelection = requestedRuntimeSupported
    ? requestedRuntime
    : "unavailable";

  const receipt = Object.freeze({
    requestedRuntime,
    selectedRuntime,
    isMemory64Supported,
    isMemory32ReferenceSupported,
    moduleProbe,
    memory64JsApi,
    memory32JsApi,
    runtimeAvailableBytes: null,
    runtimeAvailablePages: null,
    largestSingleProbeAllocationBytes:
      STUDIO_WASM_PAGE_BYTES * BigInt(2),
    policy: WASM_MEMORY64_ACCELERATOR_POLICY,
  });
  if (usesDefaultHost) cachedDefaultCapabilities.set(requestedRuntime, receipt);
  return receipt;
}

export type WasmScratchByteCount = number | bigint;

export interface WasmScratchRuntimeBudget {
  /** Runtime-measured bytes safe to offer to this accelerator right now. */
  readonly availableBytes: WasmScratchByteCount;
  /** Runtime-measured WebAssembly pages safe to offer right now. */
  readonly availablePages: WasmScratchByteCount;
  /** Optional bytes retained for the host/UI and unavailable to this plan. */
  readonly reservedBytes?: WasmScratchByteCount;
}

export interface WasmScratchWorkingSetRequest {
  readonly workload: WasmScratchWorkload;
  /**
   * Logical scratch stream length. `project` means OPFS-backed surface/page
   * ranges; it never means canonical IR or serialized JSON.
   */
  readonly logicalByteLength: WasmScratchByteCount;
  /** Caller preference, not a product-wide ceiling. */
  readonly preferredChunkBytes: WasmScratchByteCount;
  /** Smallest useful retry unit. Defaults to one logical byte. */
  readonly minimumChunkBytes?: WasmScratchByteCount;
}

export interface WasmScratchCapabilitySelection {
  readonly selectedRuntime: WasmMemoryRuntimeSelection;
}

export interface WasmScratchResolvedBudget {
  readonly providedAvailableBytes: bigint;
  readonly providedAvailablePages: bigint;
  readonly reservedBytes: bigint;
  readonly effectiveAvailableBytes: bigint;
  readonly usableBytes: bigint;
  readonly usablePages: bigint;
  readonly pageSizeBytes: bigint;
  /**
   * Address-space ceiling of the selected web embedding (i32 or the browser's 16 GiB i64 bound).
   * This is never treated as evidence of allocatable RAM; the smaller runtime budget remains the
   * actual resident admission authority.
   */
  readonly protocolMaximumPages: bigint;
}

export type WasmScratchBackpressureReason =
  | "invalid-request"
  | "invalid-runtime-budget"
  | "accelerator-unavailable"
  | "insufficient-runtime-budget"
  | "allocation-failed";

export type WasmScratchBackpressureAction =
  | "provide-runtime-budget"
  | "wait-for-budget"
  | "reduce-minimum-working-set"
  | "retry-smaller-working-set"
  | "stream-through-opfs";

export interface WasmScratchBackpressureReceipt {
  readonly ok: false;
  readonly status: "backpressure";
  readonly workload: WasmScratchWorkload | null;
  readonly reason: WasmScratchBackpressureReason;
  readonly action: WasmScratchBackpressureAction;
  readonly message: string;
  readonly recommendedPages: bigint;
  readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
}

export interface WasmScratchWorkingSetPlan {
  readonly ok: true;
  readonly status: "ready";
  readonly workload: WasmScratchWorkload;
  readonly runtime: Exclude<WasmMemoryRuntimeSelection, "unavailable">;
  readonly addressType: StudioWasmAddressType;
  readonly logicalByteLength: bigint;
  readonly preferredChunkBytes: bigint;
  readonly minimumChunkBytes: bigint;
  readonly chunkBytes: bigint;
  readonly chunkCount: bigint;
  readonly workingSetPages: bigint;
  readonly workingSetBytes: bigint;
  readonly minimumWorkingSetPages: bigint;
  readonly budget: WasmScratchResolvedBudget;
  readonly readsCanonicalProjectBytes: false;
  readonly materializesWholeDocument: false;
  readonly materializesWholeJson: false;
  readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
}

export type WasmScratchPlanReceipt =
  | WasmScratchWorkingSetPlan
  | WasmScratchBackpressureReceipt;

export interface WasmScratchChunkDescriptor {
  readonly chunkIndex: bigint;
  readonly logicalByteOffset: bigint;
  readonly logicalByteLength: bigint;
  readonly requiredPages: bigint;
  readonly residentByteLength: bigint;
  readonly isLast: boolean;
  readonly sourceAccess: "paged-range-only";
}

function toNonNegativeBigInt(value: WasmScratchByteCount): bigint | null {
  if (typeof value === "bigint") {
    return value >= ZERO_PAGES ? value : null;
  }
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return BigInt(value);
}

function toPositiveBigInt(value: WasmScratchByteCount): bigint | null {
  const normalized = toNonNegativeBigInt(value);
  return normalized !== null && normalized > ZERO_PAGES
    ? normalized
    : null;
}

function minBigInt(...values: readonly bigint[]): bigint {
  let result = values[0] ?? ZERO_PAGES;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined && value < result) result = value;
  }
  return result;
}

function ceilPages(byteLength: bigint): bigint {
  return (
    byteLength + STUDIO_WASM_PAGE_BYTES - ONE_PAGE
  ) / STUDIO_WASM_PAGE_BYTES;
}

function isScratchWorkload(value: unknown): value is WasmScratchWorkload {
  return WASM_MEMORY64_ACCELERATOR_POLICY.workloads.some(
    (workload) => workload === value,
  );
}

function backpressure(
  values: Omit<WasmScratchBackpressureReceipt, "ok" | "status" | "policy">,
): WasmScratchBackpressureReceipt {
  return Object.freeze({
    ok: false,
    status: "backpressure",
    ...values,
    policy: WASM_MEMORY64_ACCELERATOR_POLICY,
  });
}

/**
 * Plans one bounded resident window over an arbitrarily large logical stream.
 * Caller-provided runtime availability determines the resident working set. The
 * web embedding's 16 GiB Memory64 ceiling is applied only as a protocol maximum,
 * never as evidence that the host has that much allocatable RAM.
 */
export function planWasmScratchWorkingSet(
  capability: WasmScratchCapabilitySelection,
  budget: WasmScratchRuntimeBudget,
  request: WasmScratchWorkingSetRequest,
): WasmScratchPlanReceipt {
  const workload = isScratchWorkload(request.workload)
    ? request.workload
    : null;
  const logicalByteLength = toPositiveBigInt(request.logicalByteLength);
  const preferredChunkBytes = toPositiveBigInt(
    request.preferredChunkBytes,
  );
  const minimumChunkBytes = toPositiveBigInt(
    request.minimumChunkBytes ?? ONE_PAGE,
  );
  if (
    workload === null
    || logicalByteLength === null
    || preferredChunkBytes === null
    || minimumChunkBytes === null
    || preferredChunkBytes
      < minBigInt(minimumChunkBytes, logicalByteLength)
  ) {
    return backpressure({
      workload,
      reason: "invalid-request",
      action: "stream-through-opfs",
      message:
        "Scratch lengths must be positive safe integers or bigint values, and the preferred chunk must satisfy the minimum.",
      recommendedPages: ZERO_PAGES,
    });
  }

  const availableBytes = toNonNegativeBigInt(budget.availableBytes);
  const availablePages = toNonNegativeBigInt(budget.availablePages);
  const reservedBytes = toNonNegativeBigInt(
    budget.reservedBytes ?? ZERO_PAGES,
  );
  if (
    availableBytes === null
    || availablePages === null
    || reservedBytes === null
  ) {
    return backpressure({
      workload,
      reason: "invalid-runtime-budget",
      action: "provide-runtime-budget",
      message:
        "Runtime memory availability must be expressed as non-negative safe integers or bigint values.",
      recommendedPages: ZERO_PAGES,
    });
  }

  if (capability.selectedRuntime === "unavailable") {
    return backpressure({
      workload,
      reason: "accelerator-unavailable",
      action: "stream-through-opfs",
      message:
        "No operational WebAssembly memory path is available; keep the job paged through OPFS.",
      recommendedPages: ZERO_PAGES,
    });
  }

  const addressType: StudioWasmAddressType =
    capability.selectedRuntime === "memory64" ? "i64" : "i32";
  const protocolMaximumPages =
    addressType === "i32"
      ? WASM32_PROTOCOL_MAX_PAGES
      : WEB_MEMORY64_PROTOCOL_MAX_PAGES;
  const budgetPages = minBigInt(availablePages, protocolMaximumPages);
  const effectiveAvailableBytes = minBigInt(
    availableBytes,
    budgetPages * STUDIO_WASM_PAGE_BYTES,
  );
  const usableBytes = reservedBytes >= effectiveAvailableBytes
    ? ZERO_PAGES
    : effectiveAvailableBytes - reservedBytes;
  const usablePages = usableBytes / STUDIO_WASM_PAGE_BYTES;
  const requiredMinimumBytes = minBigInt(
    minimumChunkBytes,
    logicalByteLength,
  );
  const minimumWorkingSetPages = ceilPages(requiredMinimumBytes);

  if (usablePages < minimumWorkingSetPages) {
    return backpressure({
      workload,
      reason: "insufficient-runtime-budget",
      action: usablePages === ZERO_PAGES
        ? "wait-for-budget"
        : "reduce-minimum-working-set",
      message:
        "The runtime-provided byte/page budget cannot hold the minimum scratch window.",
      recommendedPages: usablePages,
    });
  }

  const preferredWorkingBytes = minBigInt(
    preferredChunkBytes,
    logicalByteLength,
  );
  const workingSetPages = minBigInt(
    ceilPages(preferredWorkingBytes),
    usablePages,
  );
  const workingSetBytes = workingSetPages * STUDIO_WASM_PAGE_BYTES;
  const chunkBytes = minBigInt(
    preferredChunkBytes,
    logicalByteLength,
    workingSetBytes,
  );
  const chunkCount =
    (logicalByteLength + chunkBytes - ONE_PAGE) / chunkBytes;
  const resolvedBudget = Object.freeze({
    providedAvailableBytes: availableBytes,
    providedAvailablePages: availablePages,
    reservedBytes,
    effectiveAvailableBytes,
    usableBytes,
    usablePages,
    pageSizeBytes: STUDIO_WASM_PAGE_BYTES,
    protocolMaximumPages,
  });

  return Object.freeze({
    ok: true,
    status: "ready",
    workload,
    runtime: capability.selectedRuntime,
    addressType,
    logicalByteLength,
    preferredChunkBytes,
    minimumChunkBytes,
    chunkBytes,
    chunkCount,
    workingSetPages,
    workingSetBytes,
    minimumWorkingSetPages,
    budget: resolvedBudget,
    readsCanonicalProjectBytes: false,
    materializesWholeDocument: false,
    materializesWholeJson: false,
    policy: WASM_MEMORY64_ACCELERATOR_POLICY,
  });
}

/** Lazily emits range descriptors; it never builds an array for the full job. */
export function* iterateWasmScratchChunks(
  plan: WasmScratchWorkingSetPlan,
): Generator<WasmScratchChunkDescriptor, void, undefined> {
  let chunkIndex = ZERO_PAGES;
  let logicalByteOffset = ZERO_PAGES;
  while (logicalByteOffset < plan.logicalByteLength) {
    const remaining = plan.logicalByteLength - logicalByteOffset;
    const logicalByteLength = minBigInt(plan.chunkBytes, remaining);
    const requiredPages = ceilPages(logicalByteLength);
    yield Object.freeze({
      chunkIndex,
      logicalByteOffset,
      logicalByteLength,
      requiredPages,
      residentByteLength: requiredPages * STUDIO_WASM_PAGE_BYTES,
      isLast:
        logicalByteOffset + logicalByteLength === plan.logicalByteLength,
      sourceAccess: "paged-range-only" as const,
    });
    chunkIndex += ONE_PAGE;
    logicalByteOffset += logicalByteLength;
  }
}

export interface WasmScratchAllocationRequest {
  readonly workload: WasmScratchWorkload;
  readonly runtime: Exclude<WasmMemoryRuntimeSelection, "unavailable">;
  readonly addressType: StudioWasmAddressType;
  readonly initialPages: bigint;
  readonly maximumPages: bigint;
  readonly residentBytes: bigint;
}

export interface WasmScratchAllocationPort {
  /** Implementations own/register the resulting resource and throw on failure. */
  allocate(request: WasmScratchAllocationRequest): void;
}

export interface WasmScratchAllocationIssue {
  readonly name: string;
  readonly message: string;
}

export type WasmScratchAllocationReceipt =
  | {
      readonly ok: true;
      readonly status: "allocated";
      readonly runtime: Exclude<WasmMemoryRuntimeSelection, "unavailable">;
      readonly pages: bigint;
      readonly residentBytes: bigint;
      readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
    }
  | {
      readonly ok: false;
      readonly status: "backpressure";
      readonly reason: "allocation-failed";
      readonly action: "retry-smaller-working-set" | "stream-through-opfs";
      readonly retryRuntime: Exclude<WasmMemoryRuntimeSelection, "unavailable">;
      readonly recommendedPages: bigint;
      readonly issue: WasmScratchAllocationIssue;
      readonly policy: typeof WASM_MEMORY64_ACCELERATOR_POLICY;
    };

function allocationIssue(cause: unknown): WasmScratchAllocationIssue {
  if (cause instanceof Error) {
    return Object.freeze({ name: cause.name, message: cause.message });
  }
  return Object.freeze({
    name: "Error",
    message: "WebAssembly scratch allocation failed",
  });
}

/**
 * Runs an explicitly supplied allocator and converts OOM/device/runtime failure
 * into backpressure for the same selected runtime. The planner itself never allocates.
 */
export function attemptWasmScratchAllocation(
  plan: WasmScratchWorkingSetPlan,
  port: WasmScratchAllocationPort,
): WasmScratchAllocationReceipt {
  try {
    port.allocate(Object.freeze({
      workload: plan.workload,
      runtime: plan.runtime,
      addressType: plan.addressType,
      initialPages: plan.workingSetPages,
      maximumPages: plan.workingSetPages,
      residentBytes: plan.workingSetBytes,
    }));
    return Object.freeze({
      ok: true,
      status: "allocated",
      runtime: plan.runtime,
      pages: plan.workingSetPages,
      residentBytes: plan.workingSetBytes,
      policy: WASM_MEMORY64_ACCELERATOR_POLICY,
    });
  } catch (cause) {
    const issue = allocationIssue(cause);
    const halvedPages = plan.workingSetPages / BigInt(2);
    const recommendedPages = halvedPages >= plan.minimumWorkingSetPages
      ? halvedPages
      : plan.workingSetPages > plan.minimumWorkingSetPages
        ? plan.minimumWorkingSetPages
        : ZERO_PAGES;

    if (recommendedPages > ZERO_PAGES) {
      return Object.freeze({
        ok: false,
        status: "backpressure",
        reason: "allocation-failed",
        action: "retry-smaller-working-set",
        retryRuntime: plan.runtime,
        recommendedPages,
        issue,
        policy: WASM_MEMORY64_ACCELERATOR_POLICY,
      });
    }

    return Object.freeze({
      ok: false,
      status: "backpressure",
      reason: "allocation-failed",
      action: recommendedPages > ZERO_PAGES
        ? "retry-smaller-working-set"
        : "stream-through-opfs",
      retryRuntime: plan.runtime,
      recommendedPages,
      issue,
      policy: WASM_MEMORY64_ACCELERATOR_POLICY,
    });
  }
}
