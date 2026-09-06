/**
 * Explicit product selection boundary for the RGBA16F WebGPU tile provider.
 *
 * V2 is the default because it preserves V1's exact validation, lowering, raster and readback
 * algorithm while retaining one physical atlas texture. A legacy V1 request remains available as
 * an explicit rollback. Creation never silently falls through from V2 to V1: the selected backend
 * either initializes or fails closed, matching ADR-0018's no-automatic-fallback rule.
 */

import {
  createStudioEngineWebGpuTileProviderV1,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
  type StudioEngineWebGpuTileProviderOptions,
  type StudioEngineWebGpuTileProviderReceipt,
  type StudioEngineWebGpuTileProviderRejectionReason,
  type StudioEngineWebGpuTileProviderRequest,
  type StudioEngineWebGpuTileProviderStats,
  type StudioEngineWebGpuTileProviderV1,
} from "./studio-engine-webgpu-tile-provider-v1";
import {
  createStudioEngineWebGpuTileProviderV2,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION,
  type StudioEngineWebGpuTileProviderV2Options,
  type StudioEngineWebGpuTileProviderV2Receipt,
  type StudioEngineWebGpuTileProviderV2Request,
  type StudioEngineWebGpuTileProviderV2Stats,
  type StudioEngineWebGpuTileProviderV2,
} from "./studio-engine-webgpu-tile-provider-v2-atlas";

import type {
  StudioEngineTileProviderDeltaBatch,
  StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";

export const STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_PRODUCTION_VERSION = 1 as const;
export const STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_DEFAULT_BACKEND =
  "webgpu-atlas-v2" as const;

export type StudioEngineWebGpuTileProviderBackend =
  | typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_DEFAULT_BACKEND
  | "webgpu-v1";

export interface StudioEngineWebGpuTileProviderProductionOptions
  extends StudioEngineWebGpuTileProviderOptions {
  /**
   * V2 is the default. `"webgpu-v1"` is an explicit operational rollback, not an automatic
   * fallback after a V2 failure.
   */
  readonly backend?: StudioEngineWebGpuTileProviderBackend;
  readonly maximumAtlasBytes?: number;
}

export interface StudioEngineWebGpuTileProviderProductionRequest {
  readonly kind: "studio-engine-webgpu-tile-provider-production-request";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_PRODUCTION_VERSION;
  readonly mode: "append" | "rebuild";
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly input: StudioEngineTileProviderInput;
}

export type StudioEngineWebGpuTileProviderProductionReceipt =
  | StudioEngineWebGpuTileProviderReceipt
  | StudioEngineWebGpuTileProviderV2Receipt;

export type StudioEngineWebGpuTileProviderProductionResult =
  | Readonly<{
      status: "completed";
      backend: StudioEngineWebGpuTileProviderBackend;
      receipt: StudioEngineWebGpuTileProviderProductionReceipt;
      batch: StudioEngineTileProviderDeltaBatch;
    }>
  | Readonly<{
      status: "rejected";
      backend: StudioEngineWebGpuTileProviderBackend;
      reason: StudioEngineWebGpuTileProviderRejectionReason;
    }>;

export interface StudioEngineWebGpuTileProviderProductionStats {
  readonly kind: "studio-engine-webgpu-tile-provider-production-stats";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_PRODUCTION_VERSION;
  readonly backend: StudioEngineWebGpuTileProviderBackend;
  readonly provider: StudioEngineWebGpuTileProviderStats | StudioEngineWebGpuTileProviderV2Stats;
}

export type StudioEngineWebGpuTileProviderProductionCreationResult =
  | Readonly<{
      status: "ready";
      backend: StudioEngineWebGpuTileProviderBackend;
      provider: StudioEngineWebGpuTileProviderProduction;
    }>
  | Readonly<{
      status: "failed";
      backend: StudioEngineWebGpuTileProviderBackend | null;
      reason:
        | "invalid-backend"
        | "initialization-failed"
        | "invalid-configuration"
        | "invalid-device"
        | "atlas-budget";
    }>;

type V1Factory = typeof createStudioEngineWebGpuTileProviderV1;
type V2Factory = typeof createStudioEngineWebGpuTileProviderV2;

export interface StudioEngineWebGpuTileProviderProductionFactories {
  readonly v1: V1Factory;
  readonly v2: V2Factory;
}

const DEFAULT_FACTORIES: StudioEngineWebGpuTileProviderProductionFactories =
  Object.freeze({
    v1: createStudioEngineWebGpuTileProviderV1,
    v2: createStudioEngineWebGpuTileProviderV2,
  });

function backendFrom(value: unknown): StudioEngineWebGpuTileProviderBackend | null {
  if (value === undefined) return STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_DEFAULT_BACKEND;
  return value === "webgpu-atlas-v2" || value === "webgpu-v1" ? value : null;
}

function validProductionRequest(
  request: StudioEngineWebGpuTileProviderProductionRequest,
): boolean {
  return Boolean(
    request
    && request.kind === "studio-engine-webgpu-tile-provider-production-request"
    && request.version === STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_PRODUCTION_VERSION,
  );
}

/** @internal Exported so tests can prove selection without fabricating a browser GPU. */
export function createStudioEngineWebGpuTileProviderProductionWithFactories(
  options: StudioEngineWebGpuTileProviderProductionOptions,
  factories: StudioEngineWebGpuTileProviderProductionFactories,
): StudioEngineWebGpuTileProviderProductionCreationResult {
  const backend = backendFrom(options?.backend);
  if (!backend) {
    return Object.freeze({
      status: "failed",
      backend: null,
      reason: "invalid-backend",
    });
  }

  if (backend === "webgpu-atlas-v2") {
    const v2Options: StudioEngineWebGpuTileProviderV2Options = {
      boundary: options.boundary,
      requestEpoch: options.requestEpoch,
      ...(options.initialDeviceEpoch === undefined
        ? {}
        : { initialDeviceEpoch: options.initialDeviceEpoch }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      ...(options.onDeviceLost === undefined
        ? {}
        : { onDeviceLost: options.onDeviceLost }),
      ...(options.maximumAtlasBytes === undefined
        ? {}
        : { maximumAtlasBytes: options.maximumAtlasBytes }),
    };
    const created = factories.v2(v2Options);
    if (created.status !== "ready") {
      return Object.freeze({
        status: "failed",
        backend,
        reason: created.reason,
      });
    }
    const provider = new StudioEngineWebGpuTileProviderProduction(
      backend,
      null,
      created.provider,
    );
    return Object.freeze({ status: "ready", backend, provider });
  }

  const created = factories.v1({
    boundary: options.boundary,
    requestEpoch: options.requestEpoch,
    ...(options.initialDeviceEpoch === undefined
      ? {}
      : { initialDeviceEpoch: options.initialDeviceEpoch }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.onDeviceLost === undefined
      ? {}
      : { onDeviceLost: options.onDeviceLost }),
  });
  if (created.status !== "ready") {
    return Object.freeze({
      status: "failed",
      backend,
      reason: created.reason,
    });
  }
  const provider = new StudioEngineWebGpuTileProviderProduction(
    backend,
    created.provider,
    null,
  );
  return Object.freeze({ status: "ready", backend, provider });
}

export function createStudioEngineWebGpuTileProviderProduction(
  options: StudioEngineWebGpuTileProviderProductionOptions,
): StudioEngineWebGpuTileProviderProductionCreationResult {
  return createStudioEngineWebGpuTileProviderProductionWithFactories(
    options,
    DEFAULT_FACTORIES,
  );
}

export class StudioEngineWebGpuTileProviderProduction {
  readonly #backend: StudioEngineWebGpuTileProviderBackend;
  readonly #v1: StudioEngineWebGpuTileProviderV1 | null;
  readonly #v2: StudioEngineWebGpuTileProviderV2 | null;
  #disposed = false;

  public constructor(
    backend: StudioEngineWebGpuTileProviderBackend,
    v1: StudioEngineWebGpuTileProviderV1 | null,
    v2: StudioEngineWebGpuTileProviderV2 | null,
  ) {
    if (
      (backend === "webgpu-v1" && (!v1 || v2))
      || (backend === "webgpu-atlas-v2" && (!v2 || v1))
    ) {
      throw new TypeError("invalid WebGPU tile-provider production selection");
    }
    this.#backend = backend;
    this.#v1 = v1;
    this.#v2 = v2;
  }

  public get backend(): StudioEngineWebGpuTileProviderBackend {
    return this.#backend;
  }

  public stats(): Readonly<StudioEngineWebGpuTileProviderProductionStats> {
    const provider = this.#v2?.stats() ?? this.#v1?.stats();
    if (!provider) throw new Error("tile provider is unavailable");
    return Object.freeze({
      kind: "studio-engine-webgpu-tile-provider-production-stats",
      version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_PRODUCTION_VERSION,
      backend: this.#backend,
      provider,
    });
  }

  public render(input: StudioEngineTileProviderInput): Promise<unknown> {
    if (this.#disposed) return Promise.resolve({ status: "rejected", reason: "disposed" });
    const provider = this.#v2 ?? this.#v1;
    if (!provider) return Promise.resolve({ status: "rejected", reason: "disposed" });
    return provider.render(input);
  }

  public async execute(
    request: StudioEngineWebGpuTileProviderProductionRequest,
    signal?: AbortSignal,
  ): Promise<StudioEngineWebGpuTileProviderProductionResult> {
    if (!validProductionRequest(request)) {
      return Object.freeze({
        status: "rejected",
        backend: this.#backend,
        reason: "invalid-request",
      });
    }
    if (this.#disposed) {
      return Object.freeze({
        status: "rejected",
        backend: this.#backend,
        reason: "disposed",
      });
    }

    if (this.#backend === "webgpu-atlas-v2") {
      const v2Request: StudioEngineWebGpuTileProviderV2Request = {
        kind: "studio-engine-webgpu-tile-provider-v2-request",
        version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION,
        mode: request.mode,
        requestEpoch: request.requestEpoch,
        deviceEpoch: request.deviceEpoch,
        requestSequence: request.requestSequence,
        input: request.input,
      };
      const result = await this.#v2!.execute(v2Request, signal);
      return result.status === "completed"
        ? Object.freeze({
            status: "completed",
            backend: this.#backend,
            receipt: result.receipt,
            batch: result.batch,
          })
        : Object.freeze({
            status: "rejected",
            backend: this.#backend,
            reason: result.reason,
          });
    }

    const v1Request: StudioEngineWebGpuTileProviderRequest = {
      kind: "studio-engine-webgpu-tile-provider-request",
      version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
      mode: request.mode,
      requestEpoch: request.requestEpoch,
      deviceEpoch: request.deviceEpoch,
      requestSequence: request.requestSequence,
      input: request.input,
    };
    const result = await this.#v1!.execute(v1Request, signal);
    return result.status === "completed"
      ? Object.freeze({
          status: "completed",
          backend: this.#backend,
          receipt: result.receipt,
          batch: result.batch,
        })
      : Object.freeze({
          status: "rejected",
          backend: this.#backend,
          reason: result.reason,
        });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#v2?.dispose();
    this.#v1?.dispose();
  }
}
