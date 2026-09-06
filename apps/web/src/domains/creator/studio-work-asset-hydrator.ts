import type {
  DownloadedStudioWorkAsset,
  StudioWorkAssetReference,
} from "./studio-work-asset-client";
import type { StudioWorkAssetManifest } from "@/shared/lib/studio-work-asset-contract";

import {
  STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES,
  studioWorkAssetReferenceKey,
} from "@/shared/lib/studio-work-asset-contract";

export type StudioWorkAssetHydrationErrorCode =
  | "forbidden"
  | "missing"
  | "invalid"
  | "network"
  | "resource";

export interface StudioWorkAssetPlaceholder {
  assetId: string;
  elementType: StudioWorkAssetReference["elementType"];
  label: string;
}

export type StudioWorkAssetHydratedSource = StudioWorkAssetManifest["descriptor"]["element"] & {
  src: string;
};

export type StudioWorkAssetHydrationState =
  | {
      status: "loading";
      reference: StudioWorkAssetReference;
      placeholder: StudioWorkAssetPlaceholder;
    }
  | {
      status: "ready";
      reference: StudioWorkAssetReference;
      manifest: StudioWorkAssetManifest;
      source: StudioWorkAssetHydratedSource;
      /** Ephemeral render URL. Never serialize this value into the project or CRDT document. */
      resourceUrl: string;
    }
  | {
      status: "error";
      reference: StudioWorkAssetReference;
      placeholder: StudioWorkAssetPlaceholder;
      code: StudioWorkAssetHydrationErrorCode;
      message: string;
    };

export interface StudioWorkAssetHydratorRuntime {
  subscribe(listener: () => void): () => void;
  get(reference: StudioWorkAssetReference): StudioWorkAssetHydrationState | null;
  readySources(): ReadonlyMap<string, StudioWorkAssetHydratedSource>;
  resourceUrl(reference: StudioWorkAssetReference): string | null;
  setWorkId(workId: string | null): void;
  observe(
    references: readonly StudioWorkAssetReference[],
    options?: StudioWorkAssetHydratorObserveOptions
  ): void;
  retry(reference: StudioWorkAssetReference): void;
  dispose(): void;
}

export interface StudioWorkAssetHydratorRuntimeModule {
  createStudioWorkAssetHydratorRuntime(
    workId: string | null,
    dependencies: StudioWorkAssetHydratorDependencies
  ): StudioWorkAssetHydratorRuntime;
}

export interface StudioWorkAssetHydratorDependencies {
  download?: (
    workId: string,
    reference: StudioWorkAssetReference,
    signal: AbortSignal
  ) => Promise<DownloadedStudioWorkAsset>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  maximumConcurrent?: number;
  maximumResidentBytes?: number;
  /** Test/host seam for deterministic chunk-load failure and lifetime fencing. */
  loadRuntime?: () => Promise<StudioWorkAssetHydratorRuntimeModule>;
}

export interface StudioWorkAssetHydratorObserveOptions {
  /** Current-page references receive queue priority and may evict background-page resources. */
  priorityReferences?: readonly StudioWorkAssetReference[];
}

/**
 * Object URLs retain the compressed Blob and image decoders retain an RGBA surface. Charge both
 * so an innocuous-looking compressed upload cannot bypass the resident-memory budget.
 */
export function studioWorkAssetResidentByteCost(
  manifest: StudioWorkAssetManifest,
  blobSize: number
): number {
  if (
    !Number.isSafeInteger(blobSize) || blobSize < 1 ||
    blobSize !== manifest.byteSize
  ) {
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

function bootstrapState(
  reference: StudioWorkAssetReference,
  hasWork: boolean
): StudioWorkAssetHydrationState {
  if (hasWork) return { status: "loading", reference, placeholder: placeholder(reference) };
  return {
    status: "error",
    reference,
    placeholder: placeholder(reference),
    code: "missing",
    message: "저장된 작품에서만 공동 에셋을 불러올 수 있습니다.",
  };
}

const loadDefaultRuntime = (): Promise<StudioWorkAssetHydratorRuntimeModule> =>
  import("./studio-work-asset-hydrator-runtime");

interface StudioWorkAssetHydratorObservation {
  references: readonly StudioWorkAssetReference[];
  options: StudioWorkAssetHydratorObserveOptions;
}

/**
 * Stable synchronous façade for React. The request/client graph stays outside Studio's static
 * closure until a saved work first observes a non-empty asset frontier. Placeholder state and the
 * useSyncExternalStore snapshot remain synchronous while that runtime chunk is loading.
 */
export class StudioWorkAssetHydrator {
  private workId: string | null;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly bootstrapStates = new Map<string, StudioWorkAssetHydrationState>();
  private readonly dependencies: StudioWorkAssetHydratorDependencies;
  private readonly loadRuntime: () => Promise<StudioWorkAssetHydratorRuntimeModule>;
  private observation: StudioWorkAssetHydratorObservation | null = null;
  private runtime: StudioWorkAssetHydratorRuntime | null = null;
  private unsubscribeRuntime: (() => void) | null = null;
  private runtimeLoad: Promise<StudioWorkAssetHydratorRuntimeModule> | false | null = null;
  private disposed = false;

  constructor(workId: string | null, dependencies: StudioWorkAssetHydratorDependencies = {}) {
    this.workId = workId;
    this.dependencies = dependencies;
    this.loadRuntime = dependencies.loadRuntime ?? loadDefaultRuntime;
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  get(reference: StudioWorkAssetReference): StudioWorkAssetHydrationState | null {
    return this.runtime?.get(reference) ??
      this.bootstrapStates.get(studioWorkAssetReferenceKey(reference)) ?? null;
  }

  readySources(): ReadonlyMap<string, StudioWorkAssetHydratedSource> {
    if (this.runtime) return this.runtime.readySources();
    return new Map();
  }

  resourceUrl(reference: StudioWorkAssetReference): string | null {
    return this.runtime?.resourceUrl(reference) ?? null;
  }

  setWorkId(workId: string | null): void {
    if (this.disposed || workId === this.workId) return;
    this.workId = workId;
    this.observation = null;
    if (this.runtimeLoad === false) this.runtimeLoad = null;
    this.bootstrapStates.clear();
    if (this.runtime) {
      this.runtime.setWorkId(workId);
      return;
    }
    this.emit();
  }

  observe(
    references: readonly StudioWorkAssetReference[],
    options: StudioWorkAssetHydratorObserveOptions = {}
  ): void {
    if (this.disposed) return;
    if (references.length > STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK) {
      throw new Error("공동 작업 에셋 참조 수가 안전 한도를 넘었습니다.");
    }
    if (this.runtime) {
      this.runtime.observe(references, options);
      return;
    }

    const unique = new Map<string, StudioWorkAssetReference>();
    for (const reference of references) {
      unique.set(studioWorkAssetReferenceKey(reference), reference);
    }
    const priorityReferences = [...(options.priorityReferences ?? [])];
    const uniqueReferences = [...unique.values()];
    this.observation = {
      references: uniqueReferences,
      options: priorityReferences.length > 0 ? { priorityReferences } : {},
    };
    let changed = false;
    for (const key of this.bootstrapStates.keys()) {
      if (unique.has(key)) continue;
      this.bootstrapStates.delete(key);
      changed = true;
    }
    for (const [key, reference] of unique) {
      if (this.bootstrapStates.has(key)) continue;
      this.bootstrapStates.set(key, bootstrapState(reference, Boolean(this.workId)));
      changed = true;
    }
    if (unique.size === 0 && this.runtimeLoad === false) this.runtimeLoad = null;
    if (changed) this.emit();
    if (unique.size > 0 && this.workId) this.ensureRuntime();
  }

  retry(reference: StudioWorkAssetReference): void {
    if (this.disposed) return;
    if (this.runtime) {
      this.runtime.retry(reference);
      return;
    }
    const key = studioWorkAssetReferenceKey(reference);
    const desired = new Map(
      this.observation?.references.map((candidate) => [studioWorkAssetReferenceKey(candidate), candidate])
    );
    desired.set(key, reference);
    this.observation = {
      references: [...desired.values()],
      options: this.observation?.options ?? {},
    };
    if (this.runtimeLoad === false) this.runtimeLoad = null;
    this.bootstrapStates.set(key, bootstrapState(reference, Boolean(this.workId)));
    this.emit();
    if (this.workId) this.ensureRuntime();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtimeLoad = null;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = null;
    this.runtime?.dispose();
    this.runtime = null;
    this.observation = null;
    this.bootstrapStates.clear();
    this.listeners.clear();
  }

  private ensureRuntime(): void {
    if (
      this.disposed || this.runtime || this.runtimeLoad !== null ||
      !this.workId || !this.observation || this.observation.references.length === 0
    ) return;
    let runtimeLoad: Promise<StudioWorkAssetHydratorRuntimeModule>;
    try {
      runtimeLoad = this.loadRuntime();
    } catch (error) {
      this.runtimeLoad = false;
      this.failRuntimeLoad(error);
      return;
    }
    this.runtimeLoad = runtimeLoad;
    void runtimeLoad.then(
        (runtimeModule) => {
          if (this.disposed || this.runtimeLoad !== runtimeLoad) return;
          this.runtimeLoad = null;
          try {
            this.activateRuntime(runtimeModule);
          } catch (error) {
            this.runtimeLoad = false;
            this.failRuntimeLoad(error);
          }
        },
        (error: unknown) => {
          if (this.disposed || this.runtimeLoad !== runtimeLoad) return;
          this.runtimeLoad = false;
          this.failRuntimeLoad(error);
        }
      );
  }

  private activateRuntime(runtimeModule: StudioWorkAssetHydratorRuntimeModule): void {
    const observation = this.observation;
    if (!this.workId || !observation || observation.references.length === 0) return;
    const runtime = runtimeModule.createStudioWorkAssetHydratorRuntime(
      this.workId,
      this.dependencies
    );
    try {
      runtime.observe(observation.references, observation.options);
    } catch (error) {
      runtime.dispose();
      throw error;
    }
    if (this.disposed) {
      runtime.dispose();
      return;
    }
    this.runtime = runtime;
    this.bootstrapStates.clear();
    this.unsubscribeRuntime = runtime.subscribe(() => this.emit());
  }

  private failRuntimeLoad(error: unknown): void {
    if (this.disposed || this.runtime) return;
    const message = error instanceof Error
      ? error.message
      : "공동 작업 에셋 실행 모듈을 불러오지 못했습니다.";
    const references = this.observation?.references ?? [];
    for (const reference of references) {
      this.bootstrapStates.set(studioWorkAssetReferenceKey(reference), {
        status: "error",
        reference,
        placeholder: placeholder(reference),
        code: "network",
        message,
      });
    }
    if (references.length > 0) this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
