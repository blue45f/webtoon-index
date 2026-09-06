import {
  STUDIO_WASM64_MAX_SINGLE_VIEW_BYTES,
  STUDIO_WASM_PAGE_BYTES,
  type StudioWasmByteViewFailureReason,
  type StudioWasmMemoryGrowFailureReason,
  StudioWasmLinearMemoryRuntime,
} from "./studio-wasm64-memory-governor";

import type {
  StudioLargeDocumentWorkingSetWindow,
} from "./studio-large-document-address-space";

/**
 * Ranged reads stay small even when the logical document address is hundreds of
 * GiB. This is a transfer/kernel boundary, not the resident working-set limit.
 */
export const STUDIO_LARGE_DOCUMENT_MAX_HYDRATION_CHUNK_BYTES =
  64 * 1024 * 1024;

const MAX_SAFE_BYTE_LENGTH = BigInt(Number.MAX_SAFE_INTEGER);

export interface StudioLargeDocumentMemory64RuntimeOptions {
  readonly runtime: StudioWasmLinearMemoryRuntime;
  /**
   * Physical resident ceiling. Logical document bytes outside the active window
   * remain in the range source (for example OPFS).
   */
  readonly maxResidentBytes: number | bigint;
  /** Defaults to 64 MiB and can only be made smaller. */
  readonly chunkBytes?: number;
}

export type StudioLargeDocumentWindowActivationFailureReason =
  | "invalid-window"
  | "number-safe-range-exceeded"
  | "resident-budget-exceeded"
  | "runtime-grow-failed"
  | "resident-view-creation-failed";

export interface StudioLargeDocumentResidentHandle {
  readonly epoch: number;
  readonly generation: number;
  readonly window: StudioLargeDocumentWorkingSetWindow;
  readonly globalByteOffset: bigint;
  readonly globalByteEndExclusive: bigint;
  readonly residentByteOffset: bigint;
  readonly byteLength: bigint;
  /**
   * The actual bounded view over WebAssembly.Memory. It becomes stale after a
   * grow or a newer working-set activation; call `isHandleCurrent` before use.
   */
  readonly residentView: Uint8Array;
}

export type StudioLargeDocumentWindowActivationResult =
  | {
      readonly ok: true;
      readonly handle: StudioLargeDocumentResidentHandle;
    }
  | {
      readonly ok: false;
      readonly reason: StudioLargeDocumentWindowActivationFailureReason;
      readonly growReason?: StudioWasmMemoryGrowFailureReason;
      readonly viewReason?: StudioWasmByteViewFailureReason;
    };

export type StudioLargeDocumentAddressMappingResult =
  | {
      readonly ok: true;
      readonly address: bigint;
    }
  | {
      readonly ok: false;
      readonly reason: "stale-handle" | "address-outside-window";
    };

export interface StudioLargeDocumentResidentViewHandle {
  readonly epoch: number;
  readonly generation: number;
  readonly globalByteOffset: bigint;
  readonly residentByteOffset: bigint;
  readonly byteLength: number;
  readonly view: Uint8Array;
  readonly owner: StudioLargeDocumentResidentHandle;
}

export type StudioLargeDocumentResidentViewResult =
  | {
      readonly ok: true;
      readonly viewHandle: StudioLargeDocumentResidentViewHandle;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "stale-handle"
        | "invalid-range"
        | "range-outside-window"
        | "resident-view-creation-failed";
      readonly viewReason?: StudioWasmByteViewFailureReason;
    };

export interface StudioLargeDocumentResidentChunk
  extends StudioLargeDocumentResidentViewHandle {
  readonly chunkIndex: number;
}

export class StudioLargeDocumentMemory64RuntimeError extends Error {
  public readonly reason:
    | "stale-handle"
    | "invalid-range"
    | "range-outside-window"
    | "resident-view-creation-failed";

  public constructor(
    reason: StudioLargeDocumentMemory64RuntimeError["reason"],
  ) {
    super(`Large-document resident chunk iteration failed: ${reason}`);
    this.name = "StudioLargeDocumentMemory64RuntimeError";
    this.reason = reason;
  }
}

export interface StudioLargeDocumentRangeReadRequest {
  readonly globalByteOffset: bigint;
  readonly byteLength: number;
  readonly signal?: AbortSignal;
}

export interface StudioLargeDocumentAsyncRangeSource {
  readRange(
    request: StudioLargeDocumentRangeReadRequest,
  ): Promise<ArrayBufferLike | ArrayBufferView>;
}

export type StudioLargeDocumentHydrationFailureReason =
  | "stale-handle"
  | "aborted"
  | "staging-buffer-allocation-failed"
  | "source-read-failed"
  | "source-byte-length-mismatch"
  | "resident-view-creation-failed";

export type StudioLargeDocumentHydrationResult =
  | {
      readonly ok: true;
      readonly viewHandle: StudioLargeDocumentResidentViewHandle;
      readonly chunksHydrated: number;
      readonly bytesHydrated: bigint;
    }
  | {
      readonly ok: false;
      readonly reason: StudioLargeDocumentHydrationFailureReason;
      readonly failedGlobalByteOffset?: bigint;
      readonly expectedByteLength?: number;
      readonly actualByteLength?: number;
      readonly cause?: unknown;
    };

interface StudioLargeDocumentResolvedRange {
  readonly globalByteOffset: bigint;
  readonly residentByteOffset: bigint;
  readonly byteLength: bigint;
}

interface StudioLargeDocumentChunkDescriptor {
  readonly chunkIndex: number;
  readonly globalByteOffset: bigint;
  readonly residentByteOffset: bigint;
  readonly byteLength: number;
}

function toPositiveSafeByteLength(value: number | bigint): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return BigInt(value);
  }
  if (value <= BigInt(0) || value > MAX_SAFE_BYTE_LENGTH) return null;
  return value;
}

function isValidWorkingSetWindow(
  window: StudioLargeDocumentWorkingSetWindow,
): boolean {
  if (
    typeof window.focusSlotIndex !== "bigint"
    || typeof window.firstSlotIndex !== "bigint"
    || typeof window.lastSlotIndexExclusive !== "bigint"
    || typeof window.tileCount !== "bigint"
    || typeof window.byteOffset !== "bigint"
    || typeof window.byteLength !== "bigint"
    || typeof window.byteEndExclusive !== "bigint"
  ) {
    return false;
  }
  if (
    window.firstSlotIndex < BigInt(0)
    || window.tileCount <= BigInt(0)
    || window.byteOffset < BigInt(0)
    || window.byteLength <= BigInt(0)
  ) {
    return false;
  }
  return (
    window.lastSlotIndexExclusive
      === window.firstSlotIndex + window.tileCount
    && window.focusSlotIndex >= window.firstSlotIndex
    && window.focusSlotIndex < window.lastSlotIndexExclusive
    && window.byteEndExclusive === window.byteOffset + window.byteLength
  );
}

function asUint8Array(
  payload: ArrayBufferLike | ArrayBufferView,
): Uint8Array | null {
  try {
    if (ArrayBuffer.isView(payload)) {
      return new Uint8Array(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
      );
    }
    return new Uint8Array(payload);
  } catch {
    return null;
  }
}

/**
 * Maps one logical BigInt working-set window onto offset zero of an actual
 * Memory64/Memory32 WebAssembly.Memory. The logical address is never narrowed;
 * only the bounded resident offset and chunk byte length become Number values.
 */
export class StudioLargeDocumentMemory64Runtime {
  public readonly runtime: StudioWasmLinearMemoryRuntime;
  public readonly maxResidentBytes: bigint;
  public readonly chunkBytes: number;

  private activeHandle: StudioLargeDocumentResidentHandle | null = null;
  private activeEpoch = 0;

  public constructor(options: StudioLargeDocumentMemory64RuntimeOptions) {
    const maxResidentBytes = toPositiveSafeByteLength(
      options.maxResidentBytes,
    );
    if (maxResidentBytes === null) {
      throw new RangeError(
        "maxResidentBytes must be a positive Number-safe integer",
      );
    }
    const runtimeBudgetBytes =
      options.runtime.maximumPages * STUDIO_WASM_PAGE_BYTES;
    if (
      maxResidentBytes > runtimeBudgetBytes
      || maxResidentBytes > BigInt(STUDIO_WASM64_MAX_SINGLE_VIEW_BYTES)
    ) {
      throw new RangeError(
        "maxResidentBytes exceeds the runtime or bounded-view budget",
      );
    }

    const chunkBytes =
      options.chunkBytes
      ?? STUDIO_LARGE_DOCUMENT_MAX_HYDRATION_CHUNK_BYTES;
    if (
      !Number.isSafeInteger(chunkBytes)
      || chunkBytes <= 0
      || chunkBytes > STUDIO_LARGE_DOCUMENT_MAX_HYDRATION_CHUNK_BYTES
    ) {
      throw new RangeError(
        `chunkBytes must be between 1 and ${STUDIO_LARGE_DOCUMENT_MAX_HYDRATION_CHUNK_BYTES}`,
      );
    }

    this.runtime = options.runtime;
    this.maxResidentBytes = maxResidentBytes;
    this.chunkBytes = chunkBytes;
  }

  public get epoch(): number {
    return this.activeEpoch;
  }

  public activateWindow(
    window: StudioLargeDocumentWorkingSetWindow,
  ): StudioLargeDocumentWindowActivationResult {
    if (!isValidWorkingSetWindow(window)) {
      return { ok: false, reason: "invalid-window" };
    }
    if (window.byteLength > MAX_SAFE_BYTE_LENGTH) {
      return { ok: false, reason: "number-safe-range-exceeded" };
    }
    if (window.byteLength > this.maxResidentBytes) {
      return { ok: false, reason: "resident-budget-exceeded" };
    }

    // A valid replacement attempt invalidates the former lease before grow:
    // even a host-side partial grow failure must never leave a detached view
    // appearing current.
    this.activeEpoch += 1;
    const epoch = this.activeEpoch;
    this.activeHandle = null;

    const grow = this.runtime.growToFit(window.byteLength);
    if (!grow.ok) {
      return {
        ok: false,
        reason: "runtime-grow-failed",
        growReason: grow.reason,
      };
    }

    const residentView = this.runtime.createByteView(
      BigInt(0),
      Number(window.byteLength),
    );
    if (!residentView.ok) {
      return {
        ok: false,
        reason: "resident-view-creation-failed",
        viewReason: residentView.reason,
      };
    }

    const handle = Object.freeze({
      epoch,
      generation: residentView.generation,
      window,
      globalByteOffset: window.byteOffset,
      globalByteEndExclusive: window.byteEndExclusive,
      residentByteOffset: BigInt(0),
      byteLength: window.byteLength,
      residentView: residentView.view,
    });
    this.activeHandle = handle;
    return { ok: true, handle };
  }

  public invalidateActiveWindow(): void {
    this.activeEpoch += 1;
    this.activeHandle = null;
  }

  public isHandleCurrent(
    handle: StudioLargeDocumentResidentHandle,
  ): boolean {
    return (
      this.activeHandle === handle
      && handle.epoch === this.activeEpoch
      && handle.generation === this.runtime.generation
      && handle.residentView.buffer === this.runtime.memory.buffer
    );
  }

  public isViewHandleCurrent(
    viewHandle: StudioLargeDocumentResidentViewHandle,
  ): boolean {
    return (
      this.isHandleCurrent(viewHandle.owner)
      && viewHandle.epoch === this.activeEpoch
      && viewHandle.generation === this.runtime.generation
      && viewHandle.view.buffer === this.runtime.memory.buffer
    );
  }

  public globalToResident(
    handle: StudioLargeDocumentResidentHandle,
    globalAddress: bigint,
  ): StudioLargeDocumentAddressMappingResult {
    if (!this.isHandleCurrent(handle)) {
      return { ok: false, reason: "stale-handle" };
    }
    if (
      globalAddress < handle.globalByteOffset
      || globalAddress >= handle.globalByteEndExclusive
    ) {
      return { ok: false, reason: "address-outside-window" };
    }
    return {
      ok: true,
      address: globalAddress - handle.globalByteOffset,
    };
  }

  public residentToGlobal(
    handle: StudioLargeDocumentResidentHandle,
    residentAddress: bigint,
  ): StudioLargeDocumentAddressMappingResult {
    if (!this.isHandleCurrent(handle)) {
      return { ok: false, reason: "stale-handle" };
    }
    if (
      residentAddress < BigInt(0)
      || residentAddress >= handle.byteLength
    ) {
      return { ok: false, reason: "address-outside-window" };
    }
    return {
      ok: true,
      address: handle.globalByteOffset + residentAddress,
    };
  }

  public createResidentView(
    handle: StudioLargeDocumentResidentHandle,
    globalByteOffset: bigint,
    byteLength: number,
  ): StudioLargeDocumentResidentViewResult {
    if (!this.isHandleCurrent(handle)) {
      return { ok: false, reason: "stale-handle" };
    }
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
      return { ok: false, reason: "invalid-range" };
    }

    const resolvedRange = this.resolveRange(
      handle,
      globalByteOffset,
      BigInt(byteLength),
    );
    if (!resolvedRange) {
      return { ok: false, reason: "range-outside-window" };
    }
    const residentView = this.runtime.createByteView(
      resolvedRange.residentByteOffset,
      byteLength,
    );
    if (!residentView.ok) {
      return {
        ok: false,
        reason: "resident-view-creation-failed",
        viewReason: residentView.reason,
      };
    }
    if (!this.isHandleCurrent(handle)) {
      return { ok: false, reason: "stale-handle" };
    }
    return {
      ok: true,
      viewHandle: Object.freeze({
        epoch: handle.epoch,
        generation: residentView.generation,
        globalByteOffset,
        residentByteOffset: resolvedRange.residentByteOffset,
        byteLength,
        view: residentView.view,
        owner: handle,
      }),
    };
  }

  public *iterateChunks(
    handle: StudioLargeDocumentResidentHandle,
    range: {
      readonly globalByteOffset?: bigint;
      readonly byteLength?: bigint;
    } = {},
  ): Generator<StudioLargeDocumentResidentChunk, void, undefined> {
    if (!this.isHandleCurrent(handle)) {
      throw new StudioLargeDocumentMemory64RuntimeError("stale-handle");
    }
    const globalByteOffset =
      range.globalByteOffset ?? handle.globalByteOffset;
    const byteLength =
      range.byteLength
      ?? (handle.globalByteEndExclusive - globalByteOffset);
    const resolvedRange = this.resolveRange(
      handle,
      globalByteOffset,
      byteLength,
    );
    if (!resolvedRange) {
      throw new StudioLargeDocumentMemory64RuntimeError(
        byteLength <= BigInt(0) ? "invalid-range" : "range-outside-window",
      );
    }

    for (const chunk of this.describeChunks(resolvedRange)) {
      const viewResult = this.createResidentView(
        handle,
        chunk.globalByteOffset,
        chunk.byteLength,
      );
      if (!viewResult.ok) {
        throw new StudioLargeDocumentMemory64RuntimeError(viewResult.reason);
      }
      yield Object.freeze({
        ...viewResult.viewHandle,
        chunkIndex: chunk.chunkIndex,
      });
    }
  }

  /**
   * Reads the complete window into a staging buffer first. Abort or stale epoch
   * results never mutate the published resident memory. The synchronous final
   * copy occurs only after the last epoch/generation check.
   */
  public async hydrateWindow(
    handle: StudioLargeDocumentResidentHandle,
    source: StudioLargeDocumentAsyncRangeSource,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<StudioLargeDocumentHydrationResult> {
    const signal = options.signal;
    const earlyFailure = this.hydrationInterruption(handle, signal);
    if (earlyFailure) return earlyFailure;

    let staging: Uint8Array;
    try {
      staging = new Uint8Array(Number(handle.byteLength));
    } catch (cause) {
      return {
        ok: false,
        reason: "staging-buffer-allocation-failed",
        cause,
      };
    }

    const fullRange: StudioLargeDocumentResolvedRange = {
      globalByteOffset: handle.globalByteOffset,
      residentByteOffset: BigInt(0),
      byteLength: handle.byteLength,
    };
    const chunks = this.describeChunks(fullRange);
    let chunksHydrated = 0;

    for (const chunk of chunks) {
      const beforeRead = this.hydrationInterruption(handle, signal);
      if (beforeRead) return beforeRead;

      let payload: ArrayBufferLike | ArrayBufferView;
      try {
        payload = await source.readRange({
          globalByteOffset: chunk.globalByteOffset,
          byteLength: chunk.byteLength,
          ...(signal ? { signal } : {}),
        });
      } catch (cause) {
        const interrupted = this.hydrationInterruption(handle, signal);
        if (interrupted) return interrupted;
        return {
          ok: false,
          reason: "source-read-failed",
          failedGlobalByteOffset: chunk.globalByteOffset,
          cause,
        };
      }

      const afterRead = this.hydrationInterruption(handle, signal);
      if (afterRead) return afterRead;
      const sourceBytes = asUint8Array(payload);
      if (!sourceBytes || sourceBytes.byteLength !== chunk.byteLength) {
        return {
          ok: false,
          reason: "source-byte-length-mismatch",
          failedGlobalByteOffset: chunk.globalByteOffset,
          expectedByteLength: chunk.byteLength,
          actualByteLength: sourceBytes?.byteLength,
        };
      }
      staging.set(sourceBytes, Number(chunk.residentByteOffset));
      chunksHydrated += 1;
    }

    const beforePublish = this.hydrationInterruption(handle, signal);
    if (beforePublish) return beforePublish;
    const destination = this.createResidentView(
      handle,
      handle.globalByteOffset,
      Number(handle.byteLength),
    );
    if (!destination.ok) {
      return {
        ok: false,
        reason:
          destination.reason === "stale-handle"
            ? "stale-handle"
            : "resident-view-creation-failed",
      };
    }

    destination.viewHandle.view.set(staging);
    return {
      ok: true,
      viewHandle: destination.viewHandle,
      chunksHydrated,
      bytesHydrated: handle.byteLength,
    };
  }

  private resolveRange(
    handle: StudioLargeDocumentResidentHandle,
    globalByteOffset: bigint,
    byteLength: bigint,
  ): StudioLargeDocumentResolvedRange | null {
    if (
      typeof globalByteOffset !== "bigint"
      || typeof byteLength !== "bigint"
      || byteLength <= BigInt(0)
      || globalByteOffset < handle.globalByteOffset
    ) {
      return null;
    }
    const globalByteEndExclusive = globalByteOffset + byteLength;
    if (
      globalByteEndExclusive < globalByteOffset
      || globalByteEndExclusive > handle.globalByteEndExclusive
    ) {
      return null;
    }
    return {
      globalByteOffset,
      residentByteOffset: globalByteOffset - handle.globalByteOffset,
      byteLength,
    };
  }

  private *describeChunks(
    range: StudioLargeDocumentResolvedRange,
  ): Generator<StudioLargeDocumentChunkDescriptor, void, undefined> {
    let globalByteOffset = range.globalByteOffset;
    let residentByteOffset = range.residentByteOffset;
    let remainingBytes = range.byteLength;
    let chunkIndex = 0;
    const chunkLimit = BigInt(this.chunkBytes);

    while (remainingBytes > BigInt(0)) {
      const byteLengthI64 =
        remainingBytes < chunkLimit ? remainingBytes : chunkLimit;
      const byteLength = Number(byteLengthI64);
      yield Object.freeze({
        chunkIndex,
        globalByteOffset,
        residentByteOffset,
        byteLength,
      });
      globalByteOffset += byteLengthI64;
      residentByteOffset += byteLengthI64;
      remainingBytes -= byteLengthI64;
      chunkIndex += 1;
    }
  }

  private hydrationInterruption(
    handle: StudioLargeDocumentResidentHandle,
    signal: AbortSignal | undefined,
  ): Extract<
    StudioLargeDocumentHydrationResult,
    { readonly ok: false }
  > | null {
    if (signal?.aborted) {
      return { ok: false, reason: "aborted" };
    }
    if (!this.isHandleCurrent(handle)) {
      return { ok: false, reason: "stale-handle" };
    }
    return null;
  }
}
