/**
 * Studio Memory64 runtime contract and large-document window allocator.
 *
 * Official references checked on 2026-07-27:
 * - Wasm 3.0 standardizes i64-addressed memories. The Web embedding still caps one
 *   memory at 16 GiB, so a 64-bit address space is not a promise that physical RAM
 *   of that size can be committed:
 *   https://webassembly.org/news/2025-09-17-wasm-3.0/
 * - The JS API uses `{ address: "i64", initial: bigint, maximum: bigint }`; grow()
 *   also takes/returns bigint for Memory64:
 *   https://webassembly.github.io/spec/js-api/#memories
 * - The official feature table lists Memory64 in Chrome 133+, Firefox 134+ and
 *   Node.js 24+, while Safari has no supported release in the table:
 *   https://webassembly.org/features/
 * - For a future native kernel build, Emscripten recommends `-m64` or
 *   `--target=wasm64`. Its older `-sMEMORY64=1` switch is deprecated:
 *   https://emscripten.org/docs/tools_reference/settings_reference.html#memory64
 *
 * This module therefore separates three different facts:
 * 1. a tiny Memory64 module validates;
 * 2. a tiny Memory64 instance can allocate and grow one 64 KiB page;
 * 3. a caller-specific working set can grow within an explicit physical budget.
 *
 * It never derives a "safe allocatable GiB" value from feature detection. Large
 * documents must still use OPFS/tiled backing storage and move bounded windows into
 * linear memory.
 */

export const STUDIO_WASM_PAGE_BYTES = BigInt(64) * BigInt(1024);
export const STUDIO_WASM32_ADDRESS_LIMIT_BYTES = BigInt(1) << BigInt(32);
export const STUDIO_WEB_MEMORY64_ADDRESS_LIMIT_BYTES = BigInt(16) * BigInt(1024) * BigInt(1024) * BigInt(1024);
export const STUDIO_WASM64_DEFAULT_WINDOW_BYTES = 64 * 1024 * 1024;
/**
 * Quality-first default for a Memory64 runtime. `maximum` reserves address
 * capacity; the browser commits physical pages only through explicit grow calls.
 * This lets 8K/16K document kernels keep a larger resident tile set without
 * allocating 1 GiB at Studio startup.
 */
export const STUDIO_WASM64_DEFAULT_WORKING_SET_MAX_BYTES =
  BigInt(1024) * BigInt(1024) * BigInt(1024);
/** Explicit legacy ceiling when a caller opts into a memory32 runtime. */
export const STUDIO_WASM32_DEFAULT_WORKING_SET_MAX_BYTES =
  BigInt(256) * BigInt(1024) * BigInt(1024);
export const STUDIO_WASM64_MAX_SINGLE_VIEW_BYTES = 256 * 1024 * 1024;

const WASM32_MAX_PAGES = STUDIO_WASM32_ADDRESS_LIMIT_BYTES / STUDIO_WASM_PAGE_BYTES;
const WEB_MEMORY64_MAX_PAGES =
  STUDIO_WEB_MEMORY64_ADDRESS_LIMIT_BYTES / STUDIO_WASM_PAGE_BYTES;
const MEMORY64_DEFAULT_WORKING_SET_MAX_PAGES =
  STUDIO_WASM64_DEFAULT_WORKING_SET_MAX_BYTES / STUDIO_WASM_PAGE_BYTES;
const MEMORY32_DEFAULT_WORKING_SET_MAX_PAGES =
  STUDIO_WASM32_DEFAULT_WORKING_SET_MAX_BYTES / STUDIO_WASM_PAGE_BYTES;

/**
 * `(module (memory (export "memory") 1 2))`, using an i32 address type.
 */
const MEMORY32_PROBE_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // memory section: one memory, has maximum, min=1, max=2
  0x05, 0x04, 0x01, 0x01, 0x01, 0x02,
  // export section: export memory 0 as "memory"
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

/**
 * `(module (memory (export "memory") i64 1 2))`.
 *
 * The limits flag is `0x01 /* maximum *\/ | 0x04 /* memory64 *\/ = 0x05`.
 * Both limits use unsigned LEB64. Values 1 and 2 have the same one-byte encoding
 * as their LEB32 counterparts.
 */
const MEMORY64_PROBE_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // memory section: one i64-addressed memory, min=1, max=2
  0x05, 0x04, 0x01, 0x05, 0x01, 0x02,
  // export section: export memory 0 as "memory"
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

/**
 * A valid module containing `v128.const`. Validation is sufficient for SIMD
 * feature detection and does not allocate application memory.
 */
const SIMD128_PROBE_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type: () -> v128
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  // one function using type 0
  0x03, 0x02, 0x01, 0x00,
  // body: no locals, v128.const 0, end
  0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x0b,
]);

export type StudioWasmAddressType = "i64" | "i32";
export type StudioWasmRuntimeSelection =
  | "memory64"
  | "memory32-requested"
  | "unavailable";
export type StudioWasmExactRuntimeSelection = Exclude<
  StudioWasmRuntimeSelection,
  "unavailable"
>;

export type StudioWasmProbeFailureReason =
  | "webassembly-unavailable"
  | "module-not-validated"
  | "module-instantiation-failed"
  | "memory-export-missing"
  | "initial-size-mismatch"
  | "grow-failed"
  | "grow-result-mismatch"
  | "grown-size-mismatch";

export interface StudioWasmAddressProbeReport {
  readonly addressType: StudioWasmAddressType;
  readonly moduleValidated: boolean;
  readonly instantiated: boolean;
  readonly growSucceeded: boolean;
  readonly operational: boolean;
  readonly initialByteLength: number;
  readonly grownByteLength: number;
  readonly oldBufferDetachedAfterGrow: boolean;
  readonly failureReason: StudioWasmProbeFailureReason | null;
}

export interface StudioWasm64CapabilityReport {
  /** Exact provider selected before this capability check began. */
  readonly requestedRuntime: StudioWasmExactRuntimeSelection;
  /** True only after validation, instantiation and a real one-page bigint grow. */
  readonly isWasm64Supported: boolean;
  /** Reference evidence only; this never authorizes switching a Memory64 operation. */
  readonly isWasm32ReferenceSupported: boolean;
  /** SIMD128 module validation result. */
  readonly isSimdSupported: boolean;
  /** The requested provider when operational, otherwise unavailable. */
  readonly selectedRuntime: StudioWasmRuntimeSelection;
  readonly memory64: StudioWasmAddressProbeReport;
  readonly memory32: StudioWasmAddressProbeReport;
  /**
   * Deliberately null: a 128 KiB probe cannot predict a device's safe physical
   * allocation. Callers must supply a measured working-set budget.
   */
  readonly maxAllocatableMemoryGiB: null;
  /** Standardized web-embedding address-space ceiling, not allocatable RAM. */
  readonly webMemory64AddressSpaceLimitGiB: 16;
  readonly wasm32AddressSpaceLimitGiB: 4;
}

export interface StudioWasmCapabilityCheckOptions {
  /**
   * Test seam. `null` models a host without WebAssembly; omitted uses the global
   * namespace.
   */
  readonly webAssembly?: typeof WebAssembly | null;
  /** Defaults to the product Memory64 provider; Memory32 must be selected explicitly. */
  readonly selectedMode?: StudioWasmAddressType;
}

const cachedDefaultCapabilityReports = new Map<
  StudioWasmAddressType,
  StudioWasm64CapabilityReport
>();

interface StudioWasmMemoryLike {
  readonly buffer: ArrayBufferLike;
  grow(delta: number | bigint): number | bigint;
}

interface StudioMemory64Descriptor {
  readonly address: "i64";
  readonly initial: bigint;
  readonly maximum: bigint;
}

interface StudioMemory32Descriptor {
  readonly address: "i32";
  readonly initial: number;
  readonly maximum: number;
}

type StudioWasmMemoryConstructor = new (
  descriptor: StudioMemory64Descriptor | StudioMemory32Descriptor,
) => WebAssembly.Memory;

function resolveWebAssembly(
  override: typeof WebAssembly | null | undefined,
): typeof WebAssembly | null {
  if (override === null) return null;
  if (override !== undefined) return override;
  return typeof WebAssembly === "object" ? WebAssembly : null;
}

function failedProbe(
  addressType: StudioWasmAddressType,
  failureReason: StudioWasmProbeFailureReason,
  partial: Partial<StudioWasmAddressProbeReport> = {},
): StudioWasmAddressProbeReport {
  return Object.freeze({
    addressType,
    moduleValidated: false,
    instantiated: false,
    growSucceeded: false,
    operational: false,
    initialByteLength: 0,
    grownByteLength: 0,
    oldBufferDetachedAfterGrow: false,
    failureReason,
    ...partial,
  });
}

function isMemoryLike(value: unknown): value is StudioWasmMemoryLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StudioWasmMemoryLike>;
  return (
    typeof candidate.grow === "function" &&
    typeof candidate.buffer === "object" &&
    candidate.buffer !== null &&
    typeof candidate.buffer.byteLength === "number"
  );
}

function probeAddressType(
  webAssembly: typeof WebAssembly | null,
  addressType: StudioWasmAddressType,
): StudioWasmAddressProbeReport {
  if (!webAssembly) {
    return failedProbe(addressType, "webassembly-unavailable");
  }

  const bytes = addressType === "i64" ? MEMORY64_PROBE_MODULE : MEMORY32_PROBE_MODULE;
  let moduleValidated: boolean;
  try {
    moduleValidated = webAssembly.validate(bytes);
  } catch {
    return failedProbe(addressType, "module-not-validated");
  }
  if (!moduleValidated) {
    return failedProbe(addressType, "module-not-validated");
  }

  let instance: WebAssembly.Instance;
  try {
    const module = new webAssembly.Module(bytes);
    instance = new webAssembly.Instance(module);
  } catch {
    return failedProbe(addressType, "module-instantiation-failed", {
      moduleValidated: true,
    });
  }

  const memory = instance.exports.memory;
  if (!isMemoryLike(memory)) {
    return failedProbe(addressType, "memory-export-missing", {
      moduleValidated: true,
      instantiated: true,
    });
  }

  const initialBuffer = memory.buffer;
  const initialByteLength = initialBuffer.byteLength;
  if (initialByteLength !== Number(STUDIO_WASM_PAGE_BYTES)) {
    return failedProbe(addressType, "initial-size-mismatch", {
      moduleValidated: true,
      instantiated: true,
      initialByteLength,
    });
  }

  let previousPages: number | bigint;
  try {
    previousPages =
      addressType === "i64"
        ? (memory.grow as unknown as (delta: bigint) => bigint)(BigInt(1))
        : (memory.grow as unknown as (delta: number) => number)(1);
  } catch {
    return failedProbe(addressType, "grow-failed", {
      moduleValidated: true,
      instantiated: true,
      initialByteLength,
      oldBufferDetachedAfterGrow: initialBuffer.byteLength === 0,
    });
  }

  const expectedPreviousPages = addressType === "i64" ? BigInt(1) : 1;
  if (previousPages !== expectedPreviousPages) {
    return failedProbe(addressType, "grow-result-mismatch", {
      moduleValidated: true,
      instantiated: true,
      initialByteLength,
      grownByteLength: memory.buffer.byteLength,
      oldBufferDetachedAfterGrow: initialBuffer.byteLength === 0,
    });
  }

  const grownByteLength = memory.buffer.byteLength;
  if (grownByteLength !== Number(STUDIO_WASM_PAGE_BYTES * BigInt(2))) {
    return failedProbe(addressType, "grown-size-mismatch", {
      moduleValidated: true,
      instantiated: true,
      growSucceeded: true,
      initialByteLength,
      grownByteLength,
      oldBufferDetachedAfterGrow: initialBuffer.byteLength === 0,
    });
  }

  return Object.freeze({
    addressType,
    moduleValidated: true,
    instantiated: true,
    growSucceeded: true,
    operational: true,
    initialByteLength,
    grownByteLength,
    oldBufferDetachedAfterGrow: initialBuffer.byteLength === 0,
    failureReason: null,
  });
}

/**
 * Performs small, real module/allocate/grow probes. No large reservation or
 * speculative allocation is attempted.
 */
export function checkStudioWasm64Capability(
  options: StudioWasmCapabilityCheckOptions = {},
): StudioWasm64CapabilityReport {
  const selectedMode = options.selectedMode ?? "i64";
  const usesDefaultHost = options.webAssembly === undefined;
  const cached = cachedDefaultCapabilityReports.get(selectedMode);
  if (usesDefaultHost && cached) {
    return cached;
  }

  const webAssembly = resolveWebAssembly(options.webAssembly);
  const memory64 = probeAddressType(webAssembly, "i64");
  const memory32 = probeAddressType(webAssembly, "i32");

  let isSimdSupported = false;
  if (webAssembly) {
    try {
      isSimdSupported = webAssembly.validate(SIMD128_PROBE_MODULE);
    } catch {
      isSimdSupported = false;
    }
  }

  const requestedRuntime: StudioWasmExactRuntimeSelection = selectedMode === "i64"
    ? "memory64"
    : "memory32-requested";
  const requestedRuntimeOperational = selectedMode === "i64"
    ? memory64.operational
    : memory32.operational;
  const selectedRuntime: StudioWasmRuntimeSelection = requestedRuntimeOperational
    ? requestedRuntime
    : "unavailable";

  const report = Object.freeze({
    requestedRuntime,
    isWasm64Supported: memory64.operational,
    isWasm32ReferenceSupported: memory32.operational,
    isSimdSupported,
    selectedRuntime,
    memory64,
    memory32,
    maxAllocatableMemoryGiB: null,
    webMemory64AddressSpaceLimitGiB: 16,
    wasm32AddressSpaceLimitGiB: 4,
  });
  if (usesDefaultHost) {
    cachedDefaultCapabilityReports.set(selectedMode, report);
  }
  return report;
}

export interface StudioWasmMemoryRuntimeOptions extends StudioWasmCapabilityCheckOptions {
  /** Small by default; pages are committed only when explicitly requested. */
  readonly initialPages?: bigint;
  /**
   * Explicit resident working-set ceiling. This is not the document size; OPFS
   * and tile windows back data outside the resident set. When omitted, the
   * quality-first Memory64 path reserves 1 GiB while explicit memory32 uses a
   * smaller 256 MiB compatibility ceiling. Neither default is committed eagerly.
   */
  readonly maximumPages?: bigint;
}

export type StudioWasmMemoryRuntimeFailureReason =
  | "webassembly-unavailable"
  | "memory64-unsupported"
  | "memory32-unsupported"
  | "invalid-page-budget"
  | "address-space-limit-exceeded"
  | "memory-construction-failed";

export type StudioWasmMemoryRuntimeResult =
  | {
      readonly ok: true;
      readonly runtime: StudioWasmLinearMemoryRuntime;
      readonly capability: StudioWasm64CapabilityReport;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmMemoryRuntimeFailureReason;
      readonly capability: StudioWasm64CapabilityReport;
    };

export type StudioWasmMemoryGrowFailureReason =
  | "invalid-required-byte-length"
  | "working-set-limit-exceeded"
  | "grow-failed"
  | "grow-result-mismatch"
  | "grown-size-mismatch"
  | "runtime-poisoned-after-grow-validation";

export type StudioWasmMemoryGrowResult =
  | {
      readonly ok: true;
      readonly previousPages: bigint;
      readonly currentPages: bigint;
      readonly grownPages: bigint;
      readonly generation: number;
      readonly oldBufferDetached: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmMemoryGrowFailureReason;
      readonly currentPages: bigint;
      readonly maximumPages: bigint;
      readonly generation: number;
    };

export type StudioWasmByteViewFailureReason =
  | "invalid-range"
  | "range-outside-resident-memory"
  | "single-view-limit-exceeded"
  | "host-view-construction-failed"
  | "runtime-poisoned-after-grow-validation";

export type StudioWasmByteViewResult =
  | {
      readonly ok: true;
      readonly view: Uint8Array;
      readonly generation: number;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmByteViewFailureReason;
      readonly generation: number;
    };

function ceilPages(byteLength: bigint): bigint {
  return (byteLength + STUDIO_WASM_PAGE_BYTES - BigInt(1)) / STUDIO_WASM_PAGE_BYTES;
}

function isPositiveIntegerBigInt(value: bigint): boolean {
  return value > BigInt(0);
}

/**
 * Owns one bounded resident linear-memory working set.
 *
 * `memory.grow()` detaches existing fixed ArrayBuffer views. Consumers must use
 * the generation token and request a fresh view after every successful grow.
 */
export class StudioWasmLinearMemoryRuntime {
  /**
   * Exposed because a compiled kernel must be able to import this memory. Consumers
   * and imported Wasm code may therefore grow it outside `growToFit()`. Every public
   * observation path synchronizes buffer identity and byte length before returning,
   * coalescing any unseen external mutations into a new view generation.
   */
  public readonly memory: WebAssembly.Memory;
  public readonly addressType: StudioWasmAddressType;
  public readonly selection: Exclude<StudioWasmRuntimeSelection, "unavailable">;
  public readonly maximumPages: bigint;

  private viewGeneration = 0;
  private observedBuffer: ArrayBufferLike;
  private observedByteLength: number;
  private poisonedAfterGrowValidation = false;

  public constructor(input: {
    memory: WebAssembly.Memory;
    addressType: StudioWasmAddressType;
    selection: Exclude<StudioWasmRuntimeSelection, "unavailable">;
    maximumPages: bigint;
  }) {
    this.memory = input.memory;
    this.addressType = input.addressType;
    this.selection = input.selection;
    this.maximumPages = input.maximumPages;
    this.observedBuffer = input.memory.buffer;
    this.observedByteLength = this.observedBuffer.byteLength;
  }

  public get generation(): number {
    this.synchronizeObservedMemory();
    return this.viewGeneration;
  }

  public get currentPages(): bigint {
    this.synchronizeObservedMemory();
    return this.observedPages();
  }

  public get currentByteLength(): bigint {
    this.synchronizeObservedMemory();
    return BigInt(this.observedByteLength);
  }

  public growToFit(requiredByteLength: bigint): StudioWasmMemoryGrowResult {
    this.synchronizeObservedMemory();
    const currentPages = this.observedPages();
    if (this.poisonedAfterGrowValidation) {
      return {
        ok: false,
        reason: "runtime-poisoned-after-grow-validation",
        currentPages,
        maximumPages: this.maximumPages,
        generation: this.viewGeneration,
      };
    }
    if (requiredByteLength < BigInt(0)) {
      return {
        ok: false,
        reason: "invalid-required-byte-length",
        currentPages,
        maximumPages: this.maximumPages,
        generation: this.viewGeneration,
      };
    }

    const requiredPages = requiredByteLength === BigInt(0) ? BigInt(0) : ceilPages(requiredByteLength);
    if (requiredPages > this.maximumPages) {
      return {
        ok: false,
        reason: "working-set-limit-exceeded",
        currentPages,
        maximumPages: this.maximumPages,
        generation: this.viewGeneration,
      };
    }

    if (requiredPages <= currentPages) {
      return {
        ok: true,
        previousPages: currentPages,
        currentPages,
        grownPages: BigInt(0),
        generation: this.viewGeneration,
        oldBufferDetached: false,
      };
    }

    const deltaPages = requiredPages - currentPages;
    const oldBuffer = this.memory.buffer;
    let previousPageResult: number | bigint;
    try {
      previousPageResult =
        this.addressType === "i64"
          ? (this.memory.grow as unknown as (delta: bigint) => bigint)(deltaPages)
          : this.memory.grow(Number(deltaPages));
    } catch {
      if (this.synchronizeObservedMemory()) {
        // A conforming host does not mutate memory when grow throws. If an injected
        // host does, the runtime can no longer prove its page/result contract.
        this.poisonedAfterGrowValidation = true;
      }
      return {
        ok: false,
        reason: "grow-failed",
        currentPages: this.observedPages(),
        maximumPages: this.maximumPages,
        generation: this.viewGeneration,
      };
    }

    const generationBeforeGrow = this.viewGeneration;
    this.synchronizeObservedMemory();
    if (this.viewGeneration === generationBeforeGrow) {
      // A positive grow returned without throwing. Even a non-conforming injected
      // host that forgot to refresh its buffer must invalidate every prior view
      // before the return value and resulting size are validated below.
      this.viewGeneration += 1;
    }

    const previousPages =
      typeof previousPageResult === "bigint"
        ? previousPageResult
        : BigInt(previousPageResult);
    if (previousPages !== currentPages) {
      this.poisonedAfterGrowValidation = true;
      return {
        ok: false,
        reason: "grow-result-mismatch",
        currentPages: this.observedPages(),
        maximumPages: this.maximumPages,
        generation: this.viewGeneration,
      };
    }

    const grownPages = this.observedPages();
    if (grownPages !== requiredPages) {
      this.poisonedAfterGrowValidation = true;
      return {
        ok: false,
        reason: "grown-size-mismatch",
        currentPages: grownPages,
        maximumPages: this.maximumPages,
        generation: this.viewGeneration,
      };
    }

    return {
      ok: true,
      previousPages,
      currentPages: grownPages,
      grownPages: deltaPages,
      generation: this.viewGeneration,
      oldBufferDetached: oldBuffer.byteLength === 0,
    };
  }

  /**
   * Returns a fresh bounded JS view. Global document offsets must first be mapped
   * to a resident window; a giant monolithic TypedArray is intentionally refused.
   */
  public createByteView(
    residentAddressI64: bigint,
    byteLength: number,
  ): StudioWasmByteViewResult {
    this.synchronizeObservedMemory();
    if (this.poisonedAfterGrowValidation) {
      return {
        ok: false,
        reason: "runtime-poisoned-after-grow-validation",
        generation: this.viewGeneration,
      };
    }
    if (
      residentAddressI64 < BigInt(0) ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0
    ) {
      return {
        ok: false,
        reason: "invalid-range",
        generation: this.viewGeneration,
      };
    }
    if (byteLength > STUDIO_WASM64_MAX_SINGLE_VIEW_BYTES) {
      return {
        ok: false,
        reason: "single-view-limit-exceeded",
        generation: this.viewGeneration,
      };
    }

    const endAddressI64 = residentAddressI64 + BigInt(byteLength);
    if (
      residentAddressI64 > BigInt(Number.MAX_SAFE_INTEGER) ||
      endAddressI64 > BigInt(this.observedByteLength)
    ) {
      return {
        ok: false,
        reason: "range-outside-resident-memory",
        generation: this.viewGeneration,
      };
    }

    try {
      return {
        ok: true,
        view: new Uint8Array(
          this.memory.buffer,
          Number(residentAddressI64),
          byteLength,
        ),
        generation: this.viewGeneration,
      };
    } catch {
      return {
        ok: false,
        reason: "host-view-construction-failed",
        generation: this.viewGeneration,
      };
    }
  }

  private observedPages(): bigint {
    return BigInt(this.observedByteLength) / STUDIO_WASM_PAGE_BYTES;
  }

  /**
   * Detects both fixed-buffer replacement/detachment and a resizable buffer whose
   * identity remains stable while its byte length changes.
   */
  private synchronizeObservedMemory(): boolean {
    const currentBuffer = this.memory.buffer;
    const currentByteLength = currentBuffer.byteLength;
    if (
      currentBuffer === this.observedBuffer &&
      currentByteLength === this.observedByteLength
    ) {
      return false;
    }

    this.observedBuffer = currentBuffer;
    this.observedByteLength = currentByteLength;
    this.viewGeneration += 1;
    return true;
  }
}

/**
 * Creates one bounded, preselected runtime. An unsupported or failed Memory64
 * request never attempts Memory32 in the same operation.
 */
export function createStudioWasmMemoryRuntime(
  options: StudioWasmMemoryRuntimeOptions = {},
): StudioWasmMemoryRuntimeResult {
  const selectedMode = options.selectedMode ?? "i64";
  const capability = checkStudioWasm64Capability({
    webAssembly: options.webAssembly,
    selectedMode,
  });
  const webAssembly = resolveWebAssembly(options.webAssembly);
  if (!webAssembly) {
    return { ok: false, reason: "webassembly-unavailable", capability };
  }

  let addressType: StudioWasmAddressType;
  let selection: Exclude<StudioWasmRuntimeSelection, "unavailable">;

  if (selectedMode === "i64") {
    if (capability.isWasm64Supported) {
      addressType = "i64";
      selection = "memory64";
    } else {
      return { ok: false, reason: "memory64-unsupported", capability };
    }
  } else if (capability.isWasm32ReferenceSupported) {
    addressType = "i32";
    selection = "memory32-requested";
  } else {
    return { ok: false, reason: "memory32-unsupported", capability };
  }

  const initialPages = options.initialPages ?? BigInt(1);
  const maximumPages =
    options.maximumPages
    ?? (addressType === "i64"
      ? MEMORY64_DEFAULT_WORKING_SET_MAX_PAGES
      : MEMORY32_DEFAULT_WORKING_SET_MAX_PAGES);
  if (
    !isPositiveIntegerBigInt(initialPages) ||
    !isPositiveIntegerBigInt(maximumPages) ||
    maximumPages < initialPages
  ) {
    return { ok: false, reason: "invalid-page-budget", capability };
  }

  const addressSpaceMaxPages =
    addressType === "i64" ? WEB_MEMORY64_MAX_PAGES : WASM32_MAX_PAGES;
  if (maximumPages > addressSpaceMaxPages) {
    return {
      ok: false,
      reason: "address-space-limit-exceeded",
      capability,
    };
  }

  const MemoryConstructor =
    webAssembly.Memory as unknown as StudioWasmMemoryConstructor;
  let memory: WebAssembly.Memory;
  try {
    memory =
      addressType === "i64"
        ? new MemoryConstructor({
            address: "i64",
            initial: initialPages,
            maximum: maximumPages,
          })
        : new MemoryConstructor({
            address: "i32",
            initial: Number(initialPages),
            maximum: Number(maximumPages),
          });
  } catch {
    return {
      ok: false,
      reason: "memory-construction-failed",
      capability,
    };
  }

  return {
    ok: true,
    capability,
    runtime: new StudioWasmLinearMemoryRuntime({
      memory,
      addressType,
      selection,
      maximumPages,
    }),
  };
}

function alignUp(value: bigint, alignment: bigint): bigint {
  const remainder = value % alignment;
  return remainder === BigInt(0) ? value : value + alignment - remainder;
}

function toByteSizeI64(value: number | bigint): bigint {
  if (typeof value === "bigint") {
    if (value <= BigInt(0)) throw new RangeError("byteSize must be greater than zero");
    return value;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("byteSize must be a positive safe integer or bigint");
  }
  return BigInt(value);
}

function assertPowerOfTwo(value: bigint, label: string): void {
  if (value <= BigInt(0) || (value & (value - BigInt(1))) !== BigInt(0)) {
    throw new RangeError(`${label} must be a positive power of two`);
  }
}

export type StudioWasm64WindowAddressTier =
  | "wasm32-compatible"
  | "crosses-4gib"
  | "memory64-only";

export interface StudioWasm64ChunkWindow {
  readonly chunkIndexI64: bigint;
  readonly chunkBaseAddressI64: bigint;
  readonly globalAddressI64: bigint;
  readonly offsetInChunk: number;
  readonly byteLength: number;
  readonly byteLengthI64: bigint;
  readonly addressTier: StudioWasm64WindowAddressTier;
}

export interface StudioWasm64LayerAllocation {
  readonly layerId: string;
  readonly byteSize: bigint;
  readonly alignedByteSizeI64: bigint;
  readonly addressI64: bigint;
  readonly endAddressExclusiveI64: bigint;
  readonly firstChunkIndexI64: bigint;
  readonly lastChunkIndexI64: bigint;
  readonly crossesWasm32Boundary: boolean;
  readonly requiresMemory64Addressing: boolean;
}

export interface StudioWasm64MemoryManagerOptions {
  readonly startAddressI64?: bigint;
  readonly alignmentBytes?: bigint;
  readonly windowBytes?: number;
  /**
   * Logical window-map ceiling. The default follows the web Memory64 limit; this
   * remains separate from the much smaller resident working-set budget.
   */
  readonly maxVirtualAddressExclusiveI64?: bigint;
}

/**
 * Monotonic virtual allocator for OPFS/tile-backed large jobs.
 *
 * It never allocates a giant ArrayBuffer. Instead, it keeps global addresses as
 * bigint and exposes one Number-sized window at a time for Worker/WASM kernels.
 * This lets a layer safely cross 4 GiB without truncating offsets through JS
 * bitwise operators or Number arithmetic.
 */
export class StudioWasm64MemoryManager {
  private currentPointer: bigint;
  private readonly alignmentBytes: bigint;
  private readonly windowBytes: number;
  private readonly windowBytesI64: bigint;
  private readonly maxVirtualAddressExclusiveI64: bigint;
  private readonly allocations = new Map<string, StudioWasm64LayerAllocation>();
  private totalAllocatedBytesI64 = BigInt(0);

  public constructor(options: StudioWasm64MemoryManagerOptions = {}) {
    this.alignmentBytes = options.alignmentBytes ?? BigInt(64);
    assertPowerOfTwo(this.alignmentBytes, "alignmentBytes");

    this.windowBytes = options.windowBytes ?? STUDIO_WASM64_DEFAULT_WINDOW_BYTES;
    if (
      !Number.isSafeInteger(this.windowBytes) ||
      this.windowBytes <= 0 ||
      this.windowBytes > STUDIO_WASM64_MAX_SINGLE_VIEW_BYTES
    ) {
      throw new RangeError(
        `windowBytes must be a positive safe integer no larger than ${STUDIO_WASM64_MAX_SINGLE_VIEW_BYTES}`,
      );
    }
    this.windowBytesI64 = BigInt(this.windowBytes);
    assertPowerOfTwo(this.windowBytesI64, "windowBytes");

    this.maxVirtualAddressExclusiveI64 =
      options.maxVirtualAddressExclusiveI64 ??
      STUDIO_WEB_MEMORY64_ADDRESS_LIMIT_BYTES;
    if (this.maxVirtualAddressExclusiveI64 <= BigInt(0)) {
      throw new RangeError("maxVirtualAddressExclusiveI64 must be positive");
    }

    const startAddressI64 = options.startAddressI64 ?? BigInt(1024) * BigInt(1024);
    if (
      startAddressI64 < BigInt(0) ||
      startAddressI64 >= this.maxVirtualAddressExclusiveI64
    ) {
      throw new RangeError("startAddressI64 is outside the virtual address map");
    }
    const alignedStartAddressI64 = alignUp(
      startAddressI64,
      this.alignmentBytes,
    );
    if (alignedStartAddressI64 >= this.maxVirtualAddressExclusiveI64) {
      throw new RangeError(
        "aligned startAddressI64 is outside the virtual address map",
      );
    }
    this.currentPointer = alignedStartAddressI64;
  }

  public allocateLayerMemory(
    layerId: string,
    byteSize: number | bigint,
  ): StudioWasm64LayerAllocation {
    if (layerId.trim().length === 0) {
      throw new TypeError("layerId must not be empty");
    }
    if (this.allocations.has(layerId)) {
      throw new Error(`layer allocation already exists: ${layerId}`);
    }

    const byteSizeI64 = toByteSizeI64(byteSize);
    const addressI64 = alignUp(this.currentPointer, this.alignmentBytes);
    const alignedByteSizeI64 = alignUp(byteSizeI64, this.alignmentBytes);
    const endAddressExclusiveI64 = addressI64 + alignedByteSizeI64;
    if (
      endAddressExclusiveI64 < addressI64 ||
      endAddressExclusiveI64 > this.maxVirtualAddressExclusiveI64
    ) {
      throw new RangeError("allocation exceeds the configured virtual address map");
    }

    const payloadEndExclusiveI64 = addressI64 + byteSizeI64;
    const firstChunkIndexI64 = addressI64 / this.windowBytesI64;
    const lastChunkIndexI64 =
      (payloadEndExclusiveI64 - BigInt(1)) / this.windowBytesI64;
    const crossesWasm32Boundary =
      addressI64 < STUDIO_WASM32_ADDRESS_LIMIT_BYTES &&
      payloadEndExclusiveI64 > STUDIO_WASM32_ADDRESS_LIMIT_BYTES;

    const allocation = Object.freeze({
      layerId,
      byteSize: byteSizeI64,
      alignedByteSizeI64,
      addressI64,
      endAddressExclusiveI64: payloadEndExclusiveI64,
      firstChunkIndexI64,
      lastChunkIndexI64,
      crossesWasm32Boundary,
      requiresMemory64Addressing:
        payloadEndExclusiveI64 > STUDIO_WASM32_ADDRESS_LIMIT_BYTES,
    });
    this.currentPointer = endAddressExclusiveI64;
    this.totalAllocatedBytesI64 += byteSizeI64;
    this.allocations.set(layerId, allocation);
    return allocation;
  }

  public getAllocation(layerId: string): StudioWasm64LayerAllocation | null {
    return this.allocations.get(layerId) ?? null;
  }

  /**
   * Releases metadata only. The monotonic pointer is intentionally not rewound;
   * physical window cache eviction is owned by the OPFS/tile residency layer.
   */
  public releaseAllocation(layerId: string): boolean {
    const allocation = this.allocations.get(layerId);
    if (!allocation) return false;
    this.allocations.delete(layerId);
    this.totalAllocatedBytesI64 -= allocation.byteSize;
    return true;
  }

  public getTotalAllocatedBytes(): bigint {
    return this.totalAllocatedBytesI64;
  }

  public getWindowCountForRange(addressI64: bigint, byteSize: bigint): bigint {
    this.assertRange(addressI64, byteSize);
    const first = addressI64 / this.windowBytesI64;
    const last = (addressI64 + byteSize - BigInt(1)) / this.windowBytesI64;
    return last - first + BigInt(1);
  }

  public resolveNextWindow(
    globalAddressI64: bigint,
    remainingByteSizeI64: bigint,
  ): StudioWasm64ChunkWindow {
    this.assertRange(globalAddressI64, remainingByteSizeI64);
    const chunkIndexI64 = globalAddressI64 / this.windowBytesI64;
    const chunkBaseAddressI64 = chunkIndexI64 * this.windowBytesI64;
    const offsetInChunkI64 = globalAddressI64 - chunkBaseAddressI64;
    const availableInChunkI64 = this.windowBytesI64 - offsetInChunkI64;
    const byteLengthI64 =
      remainingByteSizeI64 < availableInChunkI64
        ? remainingByteSizeI64
        : availableInChunkI64;
    const endAddressExclusiveI64 = globalAddressI64 + byteLengthI64;

    const addressTier: StudioWasm64WindowAddressTier =
      globalAddressI64 >= STUDIO_WASM32_ADDRESS_LIMIT_BYTES
        ? "memory64-only"
        : endAddressExclusiveI64 > STUDIO_WASM32_ADDRESS_LIMIT_BYTES
          ? "crosses-4gib"
          : "wasm32-compatible";

    return Object.freeze({
      chunkIndexI64,
      chunkBaseAddressI64,
      globalAddressI64,
      offsetInChunk: Number(offsetInChunkI64),
      byteLength: Number(byteLengthI64),
      byteLengthI64,
      addressTier,
    });
  }

  public *iterateAllocationWindows(
    allocationOrLayerId: StudioWasm64LayerAllocation | string,
  ): Generator<StudioWasm64ChunkWindow, void, undefined> {
    const allocation =
      typeof allocationOrLayerId === "string"
        ? this.getAllocation(allocationOrLayerId)
        : allocationOrLayerId;
    if (!allocation) {
      throw new Error(`unknown layer allocation: ${allocationOrLayerId}`);
    }

    let addressI64 = allocation.addressI64;
    let remainingByteSizeI64 = allocation.byteSize;
    while (remainingByteSizeI64 > BigInt(0)) {
      const window = this.resolveNextWindow(
        addressI64,
        remainingByteSizeI64,
      );
      yield window;
      addressI64 += window.byteLengthI64;
      remainingByteSizeI64 -= window.byteLengthI64;
    }
  }

  private assertRange(addressI64: bigint, byteSizeI64: bigint): void {
    if (addressI64 < BigInt(0) || byteSizeI64 <= BigInt(0)) {
      throw new RangeError("window range must have a non-negative address and positive size");
    }
    const endAddressExclusiveI64 = addressI64 + byteSizeI64;
    if (
      endAddressExclusiveI64 < addressI64 ||
      endAddressExclusiveI64 > this.maxVirtualAddressExclusiveI64
    ) {
      throw new RangeError("window range exceeds the configured virtual address map");
    }
  }
}
