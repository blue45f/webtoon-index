import {
  normalizeStudioBg3dArtifactCaptureRequestV2,
  normalizeStudioBg3dArtifactCaptureResultV2,
  type StudioBg3dArtifactCaptureRequestV2,
  type StudioBg3dArtifactCaptureResultV2,
} from "./studio-bg3d-artifact-capture-v2";
import {
  normalizeStudioBg3dPhysicsWorld,
  type StudioBg3dPhysicsWorld,
} from "./studio-bg3d-physics";
import {
  STUDIO_BG3D_RUNTIME_CATALOG,
  type StudioBg3dRuntimeCapability,
  type StudioBg3dRuntimeId,
} from "./studio-bg3d-runtime-topology";
import {
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  normalizeStudioBg3dWebtoonFxCaptureRequest,
  type StudioBg3dWebtoonFxCaptureRequest,
} from "./studio-bg3d-webtoon-fx";

import type { StudioBg3dGlbValidationSuccess } from "./studio-bg3d-glb-validation";

export type StudioBg3dRuntimeBoundaryErrorCode =
  | "invalid-snapshot"
  | "missing-verified-asset"
  | "asset-metadata-mismatch"
  | "adapter-already-registered"
  | "adapter-not-registered"
  | "capability-unavailable"
  | "invalid-request"
  | "invalid-result"
  | "aborted"
  | "registry-disposed";

export class StudioBg3dRuntimeBoundaryError extends Error {
  constructor(readonly code: StudioBg3dRuntimeBoundaryErrorCode) {
    super(code);
    this.name = "StudioBg3dRuntimeBoundaryError";
  }
}

export interface StudioBg3dRuntimeAssetSnapshot {
  readonly attachmentId: string;
  readonly hash: string;
  readonly byteSize: number;
  /** Always returns a fresh copy; adapters can never mutate the coordinator's verified snapshot. */
  readVerifiedBytes(): Uint8Array;
}

export interface StudioBg3dRuntimeSnapshot {
  readonly canonicalDocumentJson: string;
  readonly assets: readonly StudioBg3dRuntimeAssetSnapshot[];
  readonly totalAssetBytes: number;
}

const trustedRuntimeSnapshots = new WeakSet<object>();

export function createStudioBg3dRuntimeSnapshot(
  document: StudioBg3dSceneDocument,
  verificationByAttachmentId: ReadonlyMap<string, StudioBg3dGlbValidationSuccess>,
): StudioBg3dRuntimeSnapshot {
  const canonicalDocumentJson = serializeStudioBg3dSceneDocument(document);
  if (!canonicalDocumentJson || !parseStudioBg3dSceneDocument(canonicalDocumentJson)) {
    throw new StudioBg3dRuntimeBoundaryError("invalid-snapshot");
  }
  const assets: StudioBg3dRuntimeAssetSnapshot[] = [];
  let totalAssetBytes = 0;
  for (const attachment of document.attachments) {
    const verification = verificationByAttachmentId.get(attachment.id);
    if (!verification) throw new StudioBg3dRuntimeBoundaryError("missing-verified-asset");
    if (
      verification.verifiedSha256 !== attachment.hash ||
      verification.verifiedBytes.byteLength !== attachment.byteSize ||
      verification.metrics.byteSize !== attachment.byteSize
    ) {
      throw new StudioBg3dRuntimeBoundaryError("asset-metadata-mismatch");
    }
    const ownedBytes = Uint8Array.from(verification.verifiedBytes);
    totalAssetBytes += ownedBytes.byteLength;
    assets.push(Object.freeze({
      attachmentId: attachment.id,
      hash: attachment.hash,
      byteSize: ownedBytes.byteLength,
      readVerifiedBytes: () => Uint8Array.from(ownedBytes),
    }));
  }
  const snapshot = Object.freeze({
    canonicalDocumentJson,
    assets: Object.freeze(assets),
    totalAssetBytes,
  });
  trustedRuntimeSnapshots.add(snapshot);
  return snapshot;
}

export type StudioBg3dSpecialistRequest =
  | { readonly kind: "runtime-metrics" }
  | { readonly kind: "capture"; readonly width: number; readonly height: number }
  | StudioBg3dArtifactCaptureRequestV2
  | StudioBg3dWebtoonFxCaptureRequest
  | {
    readonly kind: "physics-preview";
    readonly durationSeconds: number;
    readonly stepSeconds: number;
    readonly gravity: readonly [number, number, number];
    readonly world?: StudioBg3dPhysicsWorld;
  }
  | { readonly kind: "material-conformance"; readonly width: number; readonly height: number }
  | { readonly kind: "splat-preview"; readonly width: number; readonly height: number }
  | { readonly kind: "geospatial-frame"; readonly width: number; readonly height: number }
  | { readonly kind: "point-cloud-frame"; readonly width: number; readonly height: number }
  | { readonly kind: "geospatial-data-frame"; readonly width: number; readonly height: number }
  | { readonly kind: "vector-map-frame"; readonly width: number; readonly height: number }
  | { readonly kind: "bim-section"; readonly width: number; readonly height: number }
  | { readonly kind: "xr-runtime-metrics" }
  | { readonly kind: "scientific-isosurface"; readonly isoValue: number };

type StudioBg3dMetricValue = number | string | boolean | null;

export type StudioBg3dSpecialistResult =
  | {
    readonly kind: "metrics";
    readonly values: Readonly<Record<string, StudioBg3dMetricValue>>;
  }
  | {
    readonly kind: "capture";
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
    readonly depthFloat32?: Float32Array;
  }
  | StudioBg3dArtifactCaptureResultV2
  | {
    readonly kind: "transforms";
    readonly samples: readonly {
      readonly nodeId: string;
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number, number];
    }[];
  };

export interface StudioBg3dRuntimeAdapterJob {
  readonly id: string;
  readonly snapshot: StudioBg3dRuntimeSnapshot;
  readonly request: StudioBg3dSpecialistRequest;
  readonly signal: AbortSignal;
}

export interface StudioBg3dRuntimeAdapter {
  readonly runtimeId: StudioBg3dRuntimeId;
  readonly capabilities: ReadonlySet<StudioBg3dRuntimeCapability>;
  runIsolated(job: StudioBg3dRuntimeAdapterJob): Promise<StudioBg3dSpecialistResult>;
  dispose(): void | Promise<void>;
}

function runtimeBoundaryError(code: StudioBg3dRuntimeBoundaryErrorCode): StudioBg3dRuntimeBoundaryError {
  return new StudioBg3dRuntimeBoundaryError(code);
}

function validDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0 && value <= 16_384;
}

const MAX_RASTER_PIXELS = 16_777_216;
const MAX_METRIC_STRING_LENGTH = 4_096;
const MAX_TRANSFORM_POSITION = 1_000_000;
const MIN_QUATERNION_LENGTH = 1e-8;
const MAX_PHYSICS_BODY_SUBSTEPS = 2_000_000;
const MAX_PHYSICS_TRIANGLE_TESTS = 50_000_000;

function validRasterSize(width: unknown, height: unknown): width is number {
  return validDimension(width) && validDimension(height)
    && width <= Math.floor(MAX_RASTER_PIXELS / height);
}

function isTrustedRuntimeSnapshot(value: unknown): value is StudioBg3dRuntimeSnapshot {
  return typeof value === "object" && value !== null && trustedRuntimeSnapshots.has(value);
}

function validRequest(request: unknown): request is StudioBg3dSpecialistRequest {
  if (!request || typeof request !== "object") return false;
  const candidate = request as Record<string, unknown>;
  switch (candidate.kind) {
    case "runtime-metrics":
      return true;
    case "capture":
    case "material-conformance":
    case "splat-preview":
    case "geospatial-frame":
    case "point-cloud-frame":
    case "geospatial-data-frame":
    case "vector-map-frame":
    case "bim-section":
      return validRasterSize(candidate.width, candidate.height);
    case "artifact-capture-v2":
      return normalizeStudioBg3dArtifactCaptureRequestV2(request) !== null;
    case "webtoon-fx-capture": {
      const normalized = normalizeStudioBg3dWebtoonFxCaptureRequest(request);
      return Boolean(normalized && validRasterSize(normalized.width, normalized.height));
    }
    case "xr-runtime-metrics":
      return true;
    case "physics-preview":
      return typeof candidate.durationSeconds === "number" &&
        Number.isFinite(candidate.durationSeconds) && candidate.durationSeconds > 0 &&
        candidate.durationSeconds <= 60 &&
        typeof candidate.stepSeconds === "number" && Number.isFinite(candidate.stepSeconds) &&
        candidate.stepSeconds >= 1 / 240 && candidate.stepSeconds <= 1 / 15 &&
        Array.isArray(candidate.gravity) && candidate.gravity.length === 3 &&
        candidate.gravity.every((value: unknown) =>
          typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000
        ) &&
        (candidate.world === undefined || normalizeStudioBg3dPhysicsWorld(candidate.world) !== null);
    case "scientific-isosurface":
      return typeof candidate.isoValue === "number" && Number.isFinite(candidate.isoValue);
    default:
      return false;
  }
}

function snapshotRequest(
  request: StudioBg3dSpecialistRequest,
  snapshot: StudioBg3dRuntimeSnapshot,
): StudioBg3dSpecialistRequest | null {
  try {
    if (!validRequest(request)) return null;
    switch (request.kind) {
      case "runtime-metrics":
      case "xr-runtime-metrics":
        return Object.freeze({ kind: request.kind });
      case "capture":
      case "material-conformance":
      case "splat-preview":
      case "geospatial-frame":
      case "point-cloud-frame":
      case "geospatial-data-frame":
      case "vector-map-frame":
      case "bim-section":
        return Object.freeze({ kind: request.kind, width: request.width, height: request.height });
      case "artifact-capture-v2":
        return normalizeStudioBg3dArtifactCaptureRequestV2(request);
      case "webtoon-fx-capture":
        return normalizeStudioBg3dWebtoonFxCaptureRequest(request);
      case "scientific-isosurface":
        return Object.freeze({ kind: request.kind, isoValue: request.isoValue });
      case "physics-preview": {
        const document = parseStudioBg3dSceneDocument(snapshot.canonicalDocumentJson);
        if (!document) return null;
        const world = request.world
          ? normalizeStudioBg3dPhysicsWorld(request.world, document)
          : undefined;
        if (request.world && !world) return null;
        const steps = Math.ceil(request.durationSeconds / request.stepSeconds);
        const bodyCount = world?.bodies.length ?? document.nodes.length;
        const solverSubsteps = world?.solverSubsteps ?? 1;
        if (steps * solverSubsteps * bodyCount > MAX_PHYSICS_BODY_SUBSTEPS) return null;
        const dynamicBodyCount = world?.bodies.filter((body) => body.motion === "dynamic").length ?? 0;
        const triangleCount = world?.bodies.reduce((total, body) =>
          total + (body.collider.kind === "triangle-mesh" ? body.collider.triangleCount : 0), 0
        ) ?? 0;
        if (
          triangleCount > 0 &&
          steps * solverSubsteps * Math.max(1, dynamicBodyCount) * triangleCount >
            MAX_PHYSICS_TRIANGLE_TESTS
        ) return null;
        return Object.freeze({
          kind: request.kind,
          durationSeconds: request.durationSeconds,
          stepSeconds: request.stepSeconds,
          gravity: Object.freeze([...request.gravity]) as readonly [number, number, number],
          ...(world ? { world } : {}),
        });
      }
    }
  } catch {
    return null;
  }
}

/**
 * Produces the exact immutable request value accepted by the runtime boundary.
 *
 * Multi-runtime coordinators use this once before the first attempt so every fallback receives the
 * same transaction even when the caller still owns a mutable input object.
 */
export function snapshotStudioBg3dSpecialistRequest(
  request: StudioBg3dSpecialistRequest,
  snapshot: StudioBg3dRuntimeSnapshot,
): StudioBg3dSpecialistRequest | null {
  return snapshotRequest(request, snapshot);
}

function sanitizeResult(
  result: StudioBg3dSpecialistResult,
  request: StudioBg3dSpecialistRequest,
): StudioBg3dSpecialistResult {
  if (!result || typeof result !== "object") throw runtimeBoundaryError("invalid-result");
  if (request.kind === "artifact-capture-v2") {
    const normalized = normalizeStudioBg3dArtifactCaptureResultV2(result);
    if (
      !normalized ||
      normalized.width !== request.width ||
      normalized.height !== request.height ||
      normalized.artifacts.length !== request.artifacts.length
    ) {
      throw runtimeBoundaryError("invalid-result");
    }
    const requestedProfiles = new Map(
      request.artifacts.map((artifact) => [artifact.kind, artifact.profile] as const),
    );
    if (normalized.artifacts.some((artifact) =>
      artifact.profile !== requestedProfiles.get(artifact.kind)
    )) {
      throw runtimeBoundaryError("invalid-result");
    }
    return normalized;
  }
  if (request.kind === "webtoon-fx-capture" && result.kind !== "capture") {
    throw runtimeBoundaryError("invalid-result");
  }
  if (result.kind === "metrics") {
    const entries = Object.entries(result.values ?? {});
    if (
      entries.length > 128 ||
      entries.some(([key, value]) =>
        !key || key.length > 64 ||
        !(value === null || typeof value === "string" || typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))) ||
        (typeof value === "string" && value.length > MAX_METRIC_STRING_LENGTH)
      )
    ) {
      throw runtimeBoundaryError("invalid-result");
    }
    return Object.freeze({ kind: "metrics", values: Object.freeze(Object.fromEntries(entries)) });
  }
  if (result.kind === "capture") {
    if (!validRasterSize(result.width, result.height)) {
      throw runtimeBoundaryError("invalid-result");
    }
    if (
      request.kind === "webtoon-fx-capture" &&
      (
        result.width !== request.width ||
        result.height !== request.height ||
        (request.includeDepth && !(result.depthFloat32 instanceof Float32Array))
      )
    ) {
      throw runtimeBoundaryError("invalid-result");
    }
    const pixels = result.width * result.height;
    if (!(result.rgba instanceof Uint8Array) || result.rgba.byteLength !== pixels * 4) {
      throw runtimeBoundaryError("invalid-result");
    }
    if (
      result.depthFloat32 !== undefined &&
      (
        !(result.depthFloat32 instanceof Float32Array) ||
        result.depthFloat32.length !== pixels ||
        result.depthFloat32.some((value) =>
          !Number.isFinite(value) || value < 0 || value > 1
        )
      )
    ) {
      throw runtimeBoundaryError("invalid-result");
    }
    return Object.freeze({
      kind: "capture",
      width: result.width,
      height: result.height,
      rgba: Uint8Array.from(result.rgba),
      ...(result.depthFloat32 ? { depthFloat32: Float32Array.from(result.depthFloat32) } : {}),
    });
  }
  if (result.kind === "transforms") {
    if (!Array.isArray(result.samples) || result.samples.length > 512) {
      throw runtimeBoundaryError("invalid-result");
    }
    const ids = new Set<string>();
    const samples = result.samples.map((sample) => {
      if (
        !sample || typeof sample.nodeId !== "string" || !sample.nodeId || sample.nodeId.length > 128 ||
        ids.has(sample.nodeId) || !Array.isArray(sample.position) || sample.position.length !== 3 ||
        !Array.isArray(sample.rotation) || sample.rotation.length !== 4 ||
        [...sample.position, ...sample.rotation].some((value) => !Number.isFinite(value)) ||
        sample.position.some((value: number) => Math.abs(value) > MAX_TRANSFORM_POSITION)
      ) {
        throw runtimeBoundaryError("invalid-result");
      }
      const rotationLength = Math.hypot(...sample.rotation);
      if (!Number.isFinite(rotationLength) || rotationLength < MIN_QUATERNION_LENGTH) {
        throw runtimeBoundaryError("invalid-result");
      }
      ids.add(sample.nodeId);
      return Object.freeze({
        nodeId: sample.nodeId,
        position: Object.freeze([...sample.position]) as unknown as readonly [number, number, number],
        rotation: Object.freeze(sample.rotation.map((value: number) => value / rotationLength)) as unknown as
          readonly [number, number, number, number],
      });
    });
    return Object.freeze({ kind: "transforms", samples: Object.freeze(samples) });
  }
  throw runtimeBoundaryError("invalid-result");
}

function requiredCapabilitiesForRequest(
  request: StudioBg3dSpecialistRequest,
): readonly StudioBg3dRuntimeCapability[] {
  switch (request.kind) {
    case "runtime-metrics": return [];
    case "capture": return ["capture-rgba-depth"];
    case "artifact-capture-v2": return ["capture-rgba-depth", "multi-artifact-capture"];
    case "webtoon-fx-capture": return ["capture-rgba-depth", "webtoon-scene-fx"];
    case "physics-preview": return ["physics"];
    case "material-conformance": return ["material-conformance"];
    case "splat-preview": return ["gaussian-splatting"];
    case "geospatial-frame": return ["geospatial-streaming"];
    case "point-cloud-frame": return ["point-cloud-streaming"];
    case "geospatial-data-frame": return ["geospatial-data-layers"];
    case "vector-map-frame": return ["vector-map-streaming"];
    case "bim-section": return ["bim-semantic-model"];
    case "xr-runtime-metrics": return ["webxr", "wasm-runtime"];
    case "scientific-isosurface": return ["scientific-volume"];
  }
}

interface StudioBg3dRegisteredRuntimeAdapter {
  readonly adapter: StudioBg3dRuntimeAdapter;
  readonly capabilities: ReadonlySet<StudioBg3dRuntimeCapability>;
}

/** Registry serializes jobs per adapter so two specialist scenes never share mutable engine state. */
export class StudioBg3dRuntimeAdapterRegistry {
  readonly #adapters = new Map<StudioBg3dRuntimeId, StudioBg3dRegisteredRuntimeAdapter>();
  readonly #queues = new Map<StudioBg3dRuntimeId, Promise<void>>();
  #disposed = false;
  #disposePromise: Promise<void> | undefined;

  register(adapter: StudioBg3dRuntimeAdapter): void {
    if (this.#disposed) throw runtimeBoundaryError("registry-disposed");
    const descriptor = STUDIO_BG3D_RUNTIME_CATALOG[adapter.runtimeId];
    if (!descriptor) throw runtimeBoundaryError("invalid-request");
    if (this.#adapters.has(adapter.runtimeId)) throw runtimeBoundaryError("adapter-already-registered");
    const capabilities = new Set(adapter.capabilities);
    if ([...capabilities].some((capability) => !descriptor.capabilities.has(capability))) {
      throw runtimeBoundaryError("capability-unavailable");
    }
    this.#adapters.set(adapter.runtimeId, {
      adapter,
      capabilities,
    });
  }

  registeredRuntimeIds(): readonly StudioBg3dRuntimeId[] {
    return Object.freeze([...this.#adapters.keys()]);
  }

  async run(
    runtimeId: StudioBg3dRuntimeId,
    id: string,
    snapshot: StudioBg3dRuntimeSnapshot,
    request: StudioBg3dSpecialistRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<StudioBg3dSpecialistResult> {
    if (this.#disposed) throw runtimeBoundaryError("registry-disposed");
    const registration = this.#adapters.get(runtimeId);
    if (!registration) throw runtimeBoundaryError("adapter-not-registered");
    if (!isTrustedRuntimeSnapshot(snapshot)) throw runtimeBoundaryError("invalid-snapshot");
    const requestSnapshot = snapshotRequest(request, snapshot);
    if (!id || id.length > 128 || !requestSnapshot) throw runtimeBoundaryError("invalid-request");
    if (
      requiredCapabilitiesForRequest(requestSnapshot)
        .some((capability) => !registration.capabilities.has(capability))
    ) {
      throw runtimeBoundaryError("capability-unavailable");
    }
    const previous = this.#queues.get(runtimeId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const queued = new Promise<void>((resolve) => { release = resolve; });
    this.#queues.set(runtimeId, previous.catch(() => undefined).then(() => queued));
    await previous.catch(() => undefined);
    try {
      if (signal.aborted) throw runtimeBoundaryError("aborted");
      const result = await registration.adapter.runIsolated({
        id,
        snapshot,
        request: requestSnapshot,
        signal,
      });
      if (signal.aborted) throw runtimeBoundaryError("aborted");
      return sanitizeResult(result, requestSnapshot);
    } finally {
      release?.();
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#disposePromise = (async () => {
      await Promise.allSettled([...this.#queues.values()]);
      await Promise.allSettled(
        [...this.#adapters.values()].map(({ adapter }) =>
          Promise.resolve().then(() => adapter.dispose())),
      );
      this.#adapters.clear();
      this.#queues.clear();
    })();
    await this.#disposePromise;
  }
}
