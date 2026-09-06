import {
  replayStudioRasterCrdtPixels,
  type StudioRasterReplayRuntimeDependencies,
  type StudioRasterReplayRuntimeResult,
} from "../live/studio-crdt-raster-replay-runtime";
import { downloadStudioRasterAsset } from "../render/studio-raster-asset-client";

import type { StudioCrdtDocument } from "../live/studio-crdt-document";
import type {
  StudioRasterOperationLog,
  StudioRasterSurfaceSpec,
} from "@/shared/lib/studio-crdt-raster-ops";

import {
  isStudioFilterMaskSurfaceId,
  isStudioFilterMaskSurfaceSpec,
} from "@/shared/lib/studio-filter-mask-surface-contract";

export const STUDIO_FILTER_MASK_MAX_CONCURRENT_HYDRATIONS = 2;
export const STUDIO_FILTER_MASK_MAX_OBSERVED_SURFACES = 256;
export const STUDIO_FILTER_MASK_DEFAULT_RESIDENT_BYTES = 192 * 1_024 * 1_024;
export const STUDIO_FILTER_MASK_MAX_RESIDENT_BYTES = 512 * 1_024 * 1_024;

export type StudioFilterMaskSurfaceHydrationErrorCode =
  | "invalid"
  | "missing"
  | "network"
  | "resource";

export type StudioFilterMaskSurfaceHydrationState =
  | {
      readonly status: "loading";
      readonly surfaceId: string;
    }
  | {
      readonly status: "ready";
      readonly surfaceId: string;
      readonly width: number;
      readonly height: number;
      /** Ephemeral render URL. Never write this value into page history, CRDT, or a project file. */
      readonly resourceUrl: string;
      readonly byteLength: number;
    }
  | {
      readonly status: "error";
      readonly surfaceId: string;
      readonly code: StudioFilterMaskSurfaceHydrationErrorCode;
      readonly message: string;
    };

export interface StudioFilterMaskSurfaceDocumentReader {
  getRasterOperationLogAsync(
    surfaceId: string,
    options?: { signal?: AbortSignal }
  ): Promise<StudioRasterOperationLog | null>;
}

export interface StudioFilterMaskSurfaceHydratorDependencies {
  readonly replay?: typeof replayStudioRasterCrdtPixels;
  readonly download?: StudioRasterReplayRuntimeDependencies["download"];
  readonly materializePng?: (
    result: StudioRasterReplayRuntimeResult,
    signal: AbortSignal
  ) => Promise<Blob>;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly maximumConcurrent?: number;
  readonly maximumResidentBytes?: number;
}

interface ActiveHydration {
  readonly controller: AbortController;
  readonly generation: number;
}

interface ResidentResource {
  readonly byteLength: number;
  readonly sequence: number;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("필터 마스크 표면 복원이 취소되었습니다.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "name" in error
    && error.name === "AbortError"
  );
}

function hydrationError(
  error: unknown
): Pick<
  Extract<StudioFilterMaskSurfaceHydrationState, { status: "error" }>,
  "code" | "message"
> {
  const message = error instanceof Error
    ? error.message
    : "필터 마스크 표면을 불러오지 못했습니다.";
  if (/찾을 수|없습니다|missing|404/iu.test(message)) {
    return { code: "missing", message };
  }
  if (/메모리|예산|resource|canvas/iu.test(message)) {
    return { code: "resource", message };
  }
  if (/형식|올바르지|불변|Magic|마스크|surface|래스터/iu.test(message)) {
    return { code: "invalid", message };
  }
  return { code: "network", message };
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number
): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 && (value ?? 0) <= maximum
    ? value as number
    : fallback;
}

function assertHydratableMagicLog(
  surfaceId: string,
  log: StudioRasterOperationLog
): StudioRasterSurfaceSpec {
  if (
    !isStudioFilterMaskSurfaceId(surfaceId)
    || log.surface.surfaceId !== surfaceId
    || !isStudioFilterMaskSurfaceSpec(log.surface)
  ) {
    throw new Error("Magic 필터 마스크 surface 계약이 올바르지 않습니다.");
  }
  if (
    log.operations.length !== 1
    || log.undoOperations.length !== 0
    || log.undoAcknowledgements.length !== 0
  ) {
    throw new Error("Magic 필터 마스크 v1은 하나의 불변 paint 작업만 허용합니다.");
  }
  const operation = log.operations[0]!;
  if (
    operation.intent !== "paint"
    || operation.patches.length < 1
    || operation.patches.length > 16
    || operation.patches.some((patch) => (
      patch.selectionMask !== undefined
      || patch.effect.kind !== "composite"
      || patch.effect.blendMode !== "source-over"
      || patch.effect.payload.mediaType !== "image/png"
    ))
  ) {
    throw new Error("Magic 필터 마스크 v1 래스터 작업이 허용된 합성 형식이 아닙니다.");
  }
  return log.surface;
}

function assertMaterializedMagicPixels(result: StudioRasterReplayRuntimeResult): void {
  if (
    result.conflictedOperationIds.length !== 0
    || result.undoneOperationIds.length !== 0
    || result.appliedOperationIds.length !== 1
  ) {
    throw new Error("Magic 필터 마스크 래스터 재생이 하나의 확정 결과로 수렴하지 않았습니다.");
  }
  for (const tile of result.tiles) {
    const rgba = tile.copyRgba();
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const alpha = rgba[offset + 3]!;
      if (
        (alpha !== 0 && alpha !== 255)
        || (
          alpha === 255
          && (rgba[offset] !== 255 || rgba[offset + 1] !== 255 || rgba[offset + 2] !== 255)
        )
      ) {
        throw new Error("Magic 필터 마스크 픽셀이 white/binary-alpha 계약을 위반했습니다.");
      }
    }
  }
}

type FilterMaskCanvas =
  | {
      readonly kind: "offscreen";
      readonly canvas: OffscreenCanvas;
      readonly context: OffscreenCanvasRenderingContext2D;
    }
  | {
      readonly kind: "html";
      readonly canvas: HTMLCanvasElement;
      readonly context: CanvasRenderingContext2D;
    };

function createFilterMaskCanvas(width: number, height: number): FilterMaskCanvas {
  if (typeof globalThis.OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    if (context) return { kind: "offscreen", canvas, context };
  }
  if (
    typeof globalThis.document === "object"
    && typeof globalThis.document.createElement === "function"
  ) {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (context) return { kind: "html", canvas, context };
  }
  throw new Error("필터 마스크 PNG를 만들 Canvas2D 표면을 사용할 수 없습니다.");
}

function htmlCanvasToPngBlob(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    canvas.toBlob((blob) => {
      if (signal.aborted) {
        reject(abortError(signal));
      } else if (!blob || blob.type !== "image/png" || blob.size < 1) {
        reject(new Error("필터 마스크 PNG 인코딩에 실패했습니다."));
      } else {
        resolve(blob);
      }
    }, "image/png");
  });
}

/**
 * Materializes a verified sparse replay into one portable PNG. The returned Blob is transient;
 * callers own its lifetime and must never place an object URL derived from it into authored state.
 */
export async function materializeStudioFilterMaskReplayPng(
  result: StudioRasterReplayRuntimeResult,
  signal: AbortSignal
): Promise<Blob> {
  throwIfAborted(signal);
  if (!isStudioFilterMaskSurfaceSpec(result.surface)) {
    throw new Error("필터 마스크 재생 surface가 Magic v1 계약과 다릅니다.");
  }
  assertMaterializedMagicPixels(result);
  const surface = createFilterMaskCanvas(result.surface.width, result.surface.height);
  surface.context.clearRect(0, 0, result.surface.width, result.surface.height);
  for (const tile of result.tiles) {
    throwIfAborted(signal);
    if (
      tile.surfaceId !== result.surface.surfaceId
      || tile.width < 1
      || tile.height < 1
    ) {
      throw new Error("필터 마스크 재생 타일의 표면 또는 크기가 올바르지 않습니다.");
    }
    const image = surface.context.createImageData(tile.width, tile.height);
    image.data.set(tile.copyRgba());
    surface.context.putImageData(
      image,
      tile.tileX * result.surface.tileSize,
      tile.tileY * result.surface.tileSize
    );
  }
  throwIfAborted(signal);
  const blob = surface.kind === "offscreen"
    ? await surface.canvas.convertToBlob({ type: "image/png" })
    : await htmlCanvasToPngBlob(surface.canvas, signal);
  throwIfAborted(signal);
  if (blob.type !== "image/png" || blob.size < 1) {
    throw new Error("필터 마스크 materializer가 유효한 PNG를 만들지 못했습니다.");
  }
  return blob;
}

/**
 * Scope-owned external store for immutable Magic filter-mask surfaces. It exposes only ephemeral
 * Blob URLs and revokes every URL on eviction, retry, work/document rotation, and disposal.
 */
export class StudioFilterMaskSurfaceHydrator {
  private workId: string | null = null;
  private document: StudioFilterMaskSurfaceDocumentReader | null = null;
  private generation = 0;
  private version = 0;
  private readySequence = 0;
  private residentBytes = 0;
  private pending = new Map<string, true>();
  private priorityIds = new Set<string>();
  private readonly states = new Map<string, StudioFilterMaskSurfaceHydrationState>();
  private readonly active = new Map<string, ActiveHydration>();
  private readonly resident = new Map<string, ResidentResource>();
  private readonly listeners = new Set<() => void>();
  private readonly replay: typeof replayStudioRasterCrdtPixels;
  private readonly download: StudioRasterReplayRuntimeDependencies["download"];
  private readonly materializePng: NonNullable<
    StudioFilterMaskSurfaceHydratorDependencies["materializePng"]
  >;
  private readonly createObjectUrl: NonNullable<
    StudioFilterMaskSurfaceHydratorDependencies["createObjectUrl"]
  >;
  private readonly revokeObjectUrl: NonNullable<
    StudioFilterMaskSurfaceHydratorDependencies["revokeObjectUrl"]
  >;
  private readonly maximumConcurrent: number;
  private readonly maximumResidentBytes: number;

  constructor(dependencies: StudioFilterMaskSurfaceHydratorDependencies = {}) {
    this.replay = dependencies.replay ?? replayStudioRasterCrdtPixels;
    this.download = dependencies.download ?? (async (reference, signal) => (
      await downloadStudioRasterAsset(this.requireWorkId(), reference, signal)
    ).bytes);
    this.materializePng = dependencies.materializePng ?? materializeStudioFilterMaskReplayPng;
    this.createObjectUrl = dependencies.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = dependencies.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.maximumConcurrent = boundedPositiveInteger(
      dependencies.maximumConcurrent,
      STUDIO_FILTER_MASK_MAX_CONCURRENT_HYDRATIONS,
      STUDIO_FILTER_MASK_MAX_CONCURRENT_HYDRATIONS
    );
    this.maximumResidentBytes = boundedPositiveInteger(
      dependencies.maximumResidentBytes,
      STUDIO_FILTER_MASK_DEFAULT_RESIDENT_BYTES,
      STUDIO_FILTER_MASK_MAX_RESIDENT_BYTES
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  get(surfaceId: string): StudioFilterMaskSurfaceHydrationState | null {
    return this.states.get(surfaceId) ?? null;
  }

  resourceUrl(surfaceId: string): string | null {
    const state = this.get(surfaceId);
    return state?.status === "ready" ? state.resourceUrl : null;
  }

  setScope(
    workId: string | null,
    document: StudioCrdtDocument | StudioFilterMaskSurfaceDocumentReader | null
  ): void {
    if (workId === this.workId && document === this.document) return;
    this.clear();
    this.workId = workId;
    this.document = document;
    this.emit();
  }

  observe(
    surfaceIds: readonly string[],
    options: { readonly prioritySurfaceIds?: readonly string[] } = {}
  ): void {
    const unique = [...new Set(surfaceIds.filter(isStudioFilterMaskSurfaceId))];
    if (unique.length > STUDIO_FILTER_MASK_MAX_OBSERVED_SURFACES) {
      throw new Error("동시에 복원할 필터 마스크 surface 수가 안전 한도를 넘었습니다.");
    }
    const allowed = new Set(unique);
    const nextPriority = new Set(
      (options.prioritySurfaceIds ?? []).filter((surfaceId) => allowed.has(surfaceId))
    );
    const previousPriority = this.priorityIds;
    this.priorityIds = nextPriority;
    let changed = false;

    for (const [surfaceId, state] of this.states) {
      if (allowed.has(surfaceId)) continue;
      this.active.get(surfaceId)?.controller.abort();
      this.active.delete(surfaceId);
      this.pending.delete(surfaceId);
      if (state.status === "ready") this.releaseReady(surfaceId, state.resourceUrl);
      this.states.delete(surfaceId);
      changed = true;
    }
    for (const surfaceId of unique) {
      const state = this.states.get(surfaceId);
      if (!state) {
        this.queue(surfaceId);
        changed = true;
      } else if (
        state.status === "error"
        && state.code === "resource"
        && nextPriority.has(surfaceId)
        && !previousPriority.has(surfaceId)
      ) {
        this.queue(surfaceId);
        changed = true;
      }
    }
    const reordered = new Map<string, true>();
    for (const surfaceId of options.prioritySurfaceIds ?? []) {
      if (this.pending.has(surfaceId)) reordered.set(surfaceId, true);
    }
    for (const surfaceId of unique) {
      if (this.pending.has(surfaceId)) reordered.set(surfaceId, true);
    }
    this.pending = reordered;
    this.drain();
    if (changed) this.emit();
  }

  retry(surfaceId: string): void {
    if (!isStudioFilterMaskSurfaceId(surfaceId)) return;
    this.active.get(surfaceId)?.controller.abort();
    this.active.delete(surfaceId);
    const state = this.states.get(surfaceId);
    if (state?.status === "ready") this.releaseReady(surfaceId, state.resourceUrl);
    this.queue(surfaceId);
    this.drain();
    this.emit();
  }

  dispose(): void {
    this.clear();
    this.listeners.clear();
  }

  private requireWorkId(): string {
    if (!this.workId) throw new Error("저장된 작품에서만 필터 마스크 표면을 복원할 수 있습니다.");
    return this.workId;
  }

  private clear(): void {
    this.generation += 1;
    for (const { controller } of this.active.values()) controller.abort();
    this.active.clear();
    this.pending.clear();
    this.priorityIds.clear();
    for (const [surfaceId, state] of this.states) {
      if (state.status === "ready") this.releaseReady(surfaceId, state.resourceUrl);
    }
    this.states.clear();
  }

  private queue(surfaceId: string): void {
    this.pending.set(surfaceId, true);
    this.states.set(surfaceId, { status: "loading", surfaceId });
  }

  private drain(): void {
    while (this.active.size < this.maximumConcurrent) {
      const next = this.pending.keys().next().value as string | undefined;
      if (!next) return;
      this.pending.delete(next);
      if (!this.active.has(next)) this.start(next);
    }
  }

  private start(surfaceId: string): void {
    const workId = this.workId;
    const document = this.document;
    const generation = this.generation;
    const controller = new AbortController();
    this.active.set(surfaceId, { controller, generation });
    this.states.set(surfaceId, { status: "loading", surfaceId });
    if (!workId || !document) {
      this.active.delete(surfaceId);
      this.states.set(surfaceId, {
        status: "error",
        surfaceId,
        code: "missing",
        message: "저장된 공동 작품에서만 필터 마스크 표면을 복원할 수 있습니다.",
      });
      this.emit();
      this.drain();
      return;
    }

    void document.getRasterOperationLogAsync(surfaceId, { signal: controller.signal })
      .then(async (log) => {
        throwIfAborted(controller.signal);
        if (!log) throw new Error("필터 마스크 래스터 로그를 찾을 수 없습니다.");
        const surface = assertHydratableMagicLog(surfaceId, log);
        const result = await this.replay({
          workId,
          log,
          signal: controller.signal,
          concurrency: 2,
          maxResidentBytes: this.maximumResidentBytes,
        }, {
          download: this.download,
        });
        throwIfAborted(controller.signal);
        if (
          result.surface.surfaceId !== surface.surfaceId
          || result.surface.width !== surface.width
          || result.surface.height !== surface.height
        ) {
          throw new Error("필터 마스크 재생 결과가 요청한 surface와 다릅니다.");
        }
        const blob = await this.materializePng(result, controller.signal);
        throwIfAborted(controller.signal);
        return { blob, surface };
      })
      .then(({ blob, surface }) => {
        if (!this.isCurrent(surfaceId, controller, generation)) return;
        const residentByteLength = surface.width * surface.height * 4 + blob.size;
        if (!this.reserve(surfaceId, residentByteLength)) {
          this.states.set(surfaceId, {
            status: "error",
            surfaceId,
            code: "resource",
            message: "필터 마스크 표면이 현재 브라우저의 메모리 보호 한도를 넘었습니다.",
          });
          this.emit();
          return;
        }
        const resourceUrl = this.createObjectUrl(blob);
        if (!this.isCurrent(surfaceId, controller, generation)) {
          this.revokeObjectUrl(resourceUrl);
          return;
        }
        this.residentBytes += residentByteLength;
        this.resident.set(surfaceId, {
          byteLength: residentByteLength,
          sequence: ++this.readySequence,
        });
        this.states.set(surfaceId, {
          status: "ready",
          surfaceId,
          width: surface.width,
          height: surface.height,
          resourceUrl,
          byteLength: blob.size,
        });
        this.emit();
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted
          || isAbortError(error)
          || !this.isCurrent(surfaceId, controller, generation)
        ) return;
        this.states.set(surfaceId, {
          status: "error",
          surfaceId,
          ...hydrationError(error),
        });
        this.emit();
      })
      .finally(() => {
        if (this.active.get(surfaceId)?.controller === controller) {
          this.active.delete(surfaceId);
        }
        this.drain();
      });
  }

  private isCurrent(
    surfaceId: string,
    controller: AbortController,
    generation: number
  ): boolean {
    const active = this.active.get(surfaceId);
    return (
      !controller.signal.aborted
      && generation === this.generation
      && active?.controller === controller
      && active.generation === generation
    );
  }

  private reserve(incomingId: string, byteLength: number): boolean {
    if (
      !Number.isSafeInteger(byteLength)
      || byteLength < 1
      || byteLength > this.maximumResidentBytes
    ) return false;
    const evictable = [...this.resident.entries()]
      .filter(([surfaceId]) => (
        surfaceId !== incomingId && !this.priorityIds.has(surfaceId)
      ))
      .sort((left, right) => left[1].sequence - right[1].sequence);
    for (const [surfaceId] of evictable) {
      if (this.residentBytes + byteLength <= this.maximumResidentBytes) break;
      const state = this.states.get(surfaceId);
      if (state?.status !== "ready") continue;
      this.releaseReady(surfaceId, state.resourceUrl);
      this.states.set(surfaceId, {
        status: "error",
        surfaceId,
        code: "resource",
        message: "다른 페이지의 필터 마스크를 메모리 보호를 위해 잠시 해제했습니다.",
      });
    }
    return this.residentBytes + byteLength <= this.maximumResidentBytes;
  }

  private releaseReady(surfaceId: string, resourceUrl: string): void {
    this.revokeObjectUrl(resourceUrl);
    const resident = this.resident.get(surfaceId);
    if (!resident) return;
    this.resident.delete(surfaceId);
    this.residentBytes = Math.max(0, this.residentBytes - resident.byteLength);
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
