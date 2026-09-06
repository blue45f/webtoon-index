import {
  downloadStudioWorkAsset,
  StudioWorkAssetRequestError,
} from "./studio-work-asset-client";

import type { StudioWorkAssetReference } from "./studio-work-asset-client";
import type {
  StudioWorkAssetHydrationState,
  StudioWorkAssetHydratorDependencies,
  StudioWorkAssetHydratorObserveOptions,
  StudioWorkAssetHydratorRuntime,
  StudioWorkAssetPlaceholder,
} from "./studio-work-asset-hydrator";
import type { StudioWorkAssetManifest } from "@/shared/lib/studio-work-asset-contract";

import {
  STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES,
  studioWorkAssetReferenceKey,
  studioWorkAssetSourceUri,
} from "@/shared/lib/studio-work-asset-contract";

const DEFAULT_MAXIMUM_CONCURRENT_HYDRATIONS = 4;
const DEFAULT_MAXIMUM_RESIDENT_BYTES = 96 * 1024 * 1024;

function placeholder(reference: StudioWorkAssetReference): StudioWorkAssetPlaceholder {
  return {
    ...reference,
    label: reference.elementType === "image"
      ? "이미지 에셋 불러오는 중"
      : reference.elementType === "vrm"
        ? "VRM 에셋 불러오는 중"
        : "3D 배경 에셋 불러오는 중",
  };
}

function aborted(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function hydrationError(error: unknown): Pick<Extract<StudioWorkAssetHydrationState, { status: "error" }>, "code" | "message"> {
  if (error instanceof StudioWorkAssetRequestError) {
    if (error.status === 403) return { code: "forbidden", message: "이 작품 에셋을 볼 권한이 없습니다." };
    if (error.status === 404) return { code: "missing", message: "공동 작업 에셋 원본을 찾을 수 없습니다." };
    if (error.status === null) return { code: "invalid", message: error.message };
    return { code: "network", message: error.message };
  }
  return {
    code: "network",
    message: error instanceof Error ? error.message : "공동 작업 에셋을 불러오지 못했습니다.",
  };
}

function calculateResidentByteCost(
  manifest: StudioWorkAssetManifest,
  blobSize: number
): number {
  if (!Number.isSafeInteger(blobSize) || blobSize < 1 || blobSize !== manifest.byteSize) {
    throw new Error("공동 작업 에셋의 선언 크기와 실제 크기가 다릅니다.");
  }
  if (manifest.elementType !== "image") return blobSize;
  const intrinsic = manifest.intrinsicImage;
  const decoded = intrinsic?.decodedRgbaBytes;
  if (
    !intrinsic || typeof decoded !== "number" || !Number.isSafeInteger(decoded) || decoded < 4 ||
    decoded > STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES ||
    decoded !== intrinsic.width * intrinsic.height * 4
  ) {
    throw new Error("공동 작업 이미지의 RGBA 디코드 크기 정보가 올바르지 않습니다.");
  }
  const total = blobSize + decoded;
  if (!Number.isSafeInteger(total)) {
    throw new Error("공동 작업 이미지의 메모리 비용이 안전 범위를 넘었습니다.");
  }
  return total;
}

/** Heavy request/resource owner loaded only after the façade observes a non-empty frontier. */
class StudioWorkAssetHydratorRuntimeImplementation implements StudioWorkAssetHydratorRuntime {
  private workId: string | null;
  private generation = 0;
  private version = 0;
  private readonly states = new Map<string, StudioWorkAssetHydrationState>();
  private readonly controllers = new Map<string, { controller: AbortController; generation: number }>();
  private pending = new Map<string, StudioWorkAssetReference>();
  private priorityKeys = new Set<string>();
  private readonly resident = new Map<string, { byteLength: number; sequence: number }>();
  private residentBytes = 0;
  private readySequence = 0;
  private readonly listeners = new Set<() => void>();
  private readonly download: NonNullable<StudioWorkAssetHydratorDependencies["download"]>;
  private readonly createObjectUrl: NonNullable<StudioWorkAssetHydratorDependencies["createObjectUrl"]>;
  private readonly revokeObjectUrl: NonNullable<StudioWorkAssetHydratorDependencies["revokeObjectUrl"]>;
  private readonly maximumConcurrent: number;
  private readonly maximumResidentBytes: number;

  constructor(
    workId: string | null,
    dependencies: StudioWorkAssetHydratorDependencies
  ) {
    this.workId = workId;
    this.download = dependencies.download ?? downloadStudioWorkAsset;
    this.createObjectUrl = dependencies.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = dependencies.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    const requestedConcurrency = dependencies.maximumConcurrent;
    this.maximumConcurrent = Number.isSafeInteger(requestedConcurrency) && (requestedConcurrency ?? 0) > 0
      ? requestedConcurrency as number
      : DEFAULT_MAXIMUM_CONCURRENT_HYDRATIONS;
    const requestedResidentBytes = dependencies.maximumResidentBytes;
    this.maximumResidentBytes = Number.isSafeInteger(requestedResidentBytes) &&
      (requestedResidentBytes ?? 0) > 0
      ? requestedResidentBytes as number
      : DEFAULT_MAXIMUM_RESIDENT_BYTES;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(reference: StudioWorkAssetReference): StudioWorkAssetHydrationState | null {
    return this.states.get(studioWorkAssetReferenceKey(reference)) ?? null;
  }

  readySources(): ReadonlyMap<string, Extract<StudioWorkAssetHydrationState, { status: "ready" }>["source"]> {
    const sources = new Map<string, Extract<StudioWorkAssetHydrationState, { status: "ready" }>["source"]>();
    for (const state of this.states.values()) {
      if (state.status === "ready") sources.set(state.reference.assetId, state.source);
    }
    return sources;
  }

  resourceUrl(reference: StudioWorkAssetReference): string | null {
    const state = this.get(reference);
    return state?.status === "ready" ? state.resourceUrl : null;
  }

  setWorkId(workId: string | null): void {
    if (workId === this.workId) return;
    this.clear();
    this.workId = workId;
    this.emit();
  }

  observe(
    references: readonly StudioWorkAssetReference[],
    options: StudioWorkAssetHydratorObserveOptions = {}
  ): void {
    const allReferences = new Map<string, StudioWorkAssetReference>();
    for (const reference of references) {
      allReferences.set(studioWorkAssetReferenceKey(reference), reference);
    }
    const nextPriorityKeys = new Set(
      (options.priorityReferences ?? [])
        .map((reference) => studioWorkAssetReferenceKey(reference))
        .filter((key) => allReferences.has(key))
    );
    const unique = new Map<string, StudioWorkAssetReference>();
    for (const reference of options.priorityReferences ?? []) {
      const key = studioWorkAssetReferenceKey(reference);
      if (allReferences.has(key)) unique.set(key, reference);
    }
    for (const [key, reference] of allReferences) unique.set(key, reference);
    const previousPriorityKeys = this.priorityKeys;
    this.priorityKeys = nextPriorityKeys;
    let changed = false;

    for (const [key, state] of this.states) {
      if (unique.has(key)) continue;
      this.controllers.get(key)?.controller.abort();
      this.controllers.delete(key);
      this.pending.delete(key);
      if (state.status === "ready") this.releaseReadyResource(key, state.resourceUrl);
      this.states.delete(key);
      changed = true;
    }
    for (const [key, reference] of unique) {
      const state = this.states.get(key);
      if (!state) {
        this.queue(reference);
        changed = true;
        continue;
      }
      if (
        state.status === "error" && state.code === "resource" &&
        nextPriorityKeys.has(key) && !previousPriorityKeys.has(key)
      ) {
        this.queue(reference);
        changed = true;
      }
    }
    const orderedPending = new Map<string, StudioWorkAssetReference>();
    for (const [key] of unique) {
      const pendingReference = this.pending.get(key);
      if (pendingReference) orderedPending.set(key, pendingReference);
    }
    this.pending = orderedPending;
    this.drain();
    if (changed) this.emit();
  }

  retry(reference: StudioWorkAssetReference): void {
    const key = studioWorkAssetReferenceKey(reference);
    this.controllers.get(key)?.controller.abort();
    this.controllers.delete(key);
    const previous = this.states.get(key);
    if (previous?.status === "ready") this.releaseReadyResource(key, previous.resourceUrl);
    this.queue(reference);
    this.drain();
    this.emit();
  }

  dispose(): void {
    this.clear();
    this.listeners.clear();
  }

  private clear(): void {
    this.generation += 1;
    for (const { controller } of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.pending.clear();
    this.priorityKeys.clear();
    for (const [key, state] of this.states) {
      if (state.status === "ready") this.releaseReadyResource(key, state.resourceUrl);
    }
    this.states.clear();
  }

  private queue(reference: StudioWorkAssetReference): void {
    const key = studioWorkAssetReferenceKey(reference);
    this.pending.set(key, reference);
    this.states.set(key, { status: "loading", reference, placeholder: placeholder(reference) });
  }

  private drain(): void {
    while (this.controllers.size < this.maximumConcurrent) {
      const next = this.pending.entries().next().value as
        | [string, StudioWorkAssetReference]
        | undefined;
      if (!next) return;
      const [key, reference] = next;
      this.pending.delete(key);
      if (this.controllers.has(key)) continue;
      this.start(reference);
    }
  }

  private start(reference: StudioWorkAssetReference): void {
    const workId = this.workId;
    const key = studioWorkAssetReferenceKey(reference);
    const requestGeneration = this.generation;
    const controller = new AbortController();
    this.controllers.set(key, { controller, generation: requestGeneration });
    this.states.set(key, { status: "loading", reference, placeholder: placeholder(reference) });
    if (!workId) {
      this.controllers.delete(key);
      this.states.set(key, {
        status: "error",
        reference,
        placeholder: placeholder(reference),
        code: "missing",
        message: "저장된 작품에서만 공동 에셋을 불러올 수 있습니다.",
      });
      return;
    }

    void this.download(workId, reference, controller.signal)
      .then(({ manifest, blob }) => {
        const current = this.controllers.get(key);
        if (
          controller.signal.aborted ||
          requestGeneration !== this.generation ||
          current?.controller !== controller ||
          current.generation !== requestGeneration
        ) return;
        if (
          manifest.assetId !== reference.assetId ||
          manifest.elementType !== reference.elementType ||
          manifest.descriptor.element.id !== reference.assetId ||
          manifest.descriptor.element.type !== reference.elementType
        ) {
          throw new StudioWorkAssetRequestError("공동 작업 에셋 식별자가 요청과 다릅니다.", null);
        }
        let residentByteCost: number;
        try {
          residentByteCost = calculateResidentByteCost(manifest, blob.size);
        } catch (error) {
          throw new StudioWorkAssetRequestError(
            error instanceof Error ? error.message : "공동 작업 에셋 메모리 정보가 올바르지 않습니다.",
            null
          );
        }
        if (!this.reserveResidentBytes(key, residentByteCost)) {
          this.states.set(key, {
            status: "error",
            reference,
            placeholder: placeholder(reference),
            code: "resource",
            message: "현재 페이지 에셋이 메모리 보호 한도를 넘어 일부 원본을 보류했습니다.",
          });
          this.emit();
          return;
        }
        const resourceUrl = this.createObjectUrl(blob);
        if (
          controller.signal.aborted ||
          requestGeneration !== this.generation ||
          this.controllers.get(key)?.controller !== controller
        ) {
          this.revokeObjectUrl(resourceUrl);
          this.releaseResidentBytes(key);
          return;
        }
        this.residentBytes += residentByteCost;
        this.resident.set(key, {
          byteLength: residentByteCost,
          sequence: ++this.readySequence,
        });
        this.states.set(key, {
          status: "ready",
          reference,
          manifest,
          // Persistent page state receives only the stable opaque URI. Renderers resolve it
          // through `resourceUrl(reference)` for this hydrator lifetime, so blob URLs cannot leak
          // into autosave, revision snapshots, exports, or CRDT updates.
          source: { ...manifest.descriptor.element, src: studioWorkAssetSourceUri(reference) },
          resourceUrl,
        });
        this.emit();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || aborted(error) || requestGeneration !== this.generation) return;
        if (this.controllers.get(key)?.controller !== controller) return;
        this.states.set(key, {
          status: "error",
          reference,
          placeholder: placeholder(reference),
          ...hydrationError(error),
        });
        this.emit();
      })
      .finally(() => {
        if (this.controllers.get(key)?.controller === controller) this.controllers.delete(key);
        this.drain();
      });
  }

  private reserveResidentBytes(incomingKey: string, byteLength: number): boolean {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > this.maximumResidentBytes) {
      return false;
    }
    const evictable = [...this.resident.entries()]
      .filter(([key]) => key !== incomingKey && !this.priorityKeys.has(key))
      .sort((left, right) => left[1].sequence - right[1].sequence);
    for (const [key] of evictable) {
      if (this.residentBytes + byteLength <= this.maximumResidentBytes) break;
      const state = this.states.get(key);
      if (state?.status !== "ready") continue;
      this.releaseReadyResource(key, state.resourceUrl);
      this.states.set(key, {
        status: "error",
        reference: state.reference,
        placeholder: placeholder(state.reference),
        code: "resource",
        message: "다른 페이지의 에셋을 메모리 보호를 위해 잠시 해제했습니다.",
      });
    }
    return this.residentBytes + byteLength <= this.maximumResidentBytes;
  }

  private releaseResidentBytes(key: string): void {
    const record = this.resident.get(key);
    if (!record) return;
    this.resident.delete(key);
    this.residentBytes = Math.max(0, this.residentBytes - record.byteLength);
  }

  private releaseReadyResource(key: string, resourceUrl: string): void {
    this.revokeObjectUrl(resourceUrl);
    this.releaseResidentBytes(key);
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export function createStudioWorkAssetHydratorRuntime(
  workId: string | null,
  dependencies: StudioWorkAssetHydratorDependencies
): StudioWorkAssetHydratorRuntime {
  return new StudioWorkAssetHydratorRuntimeImplementation(
    workId,
    dependencies
  );
}
