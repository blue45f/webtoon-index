/**
 * Renderer-independent runtime topology policy.
 *
 * A runtime owns one interactive scene/canvas. A second engine may only run as an explicitly
 * isolated specialist that receives the canonical SceneDocument plus verified GLB byte snapshots;
 * engine objects, GPU resources, object URLs, and mutable scene graphs never cross the boundary.
 */

export type StudioBg3dRuntimeId =
  | "three-webgl"
  | "three-webgpu"
  | "three-spark-webgl-lab"
  | "babylon-webgl-lab"
  | "babylon-webgpu-lab"
  | "playcanvas-webgl-lab"
  | "playcanvas-webgpu-lab"
  | "filament-webgl-lab"
  | "cesium-webgl-lab"
  | "xeokit-webgl-lab"
  | "potree-webgl-lab"
  | "deckgl-webgl-lab"
  | "maplibre-webgl-lab"
  | "wonderland-wasm-webgl-lab"
  | "vtk-webgl-lab";

export type StudioBg3dRuntimeCapability =
  | "interactive-editing"
  | "capture-rgba-depth"
  | "multi-artifact-capture"
  | "skinning"
  | "morph-targets"
  | "webgl"
  | "webgpu"
  | "physics"
  | "webxr"
  | "thin-instancing"
  | "progressive-gltf"
  | "webtoon-scene-fx"
  | "compute"
  | "gaussian-splatting"
  | "material-conformance"
  | "geospatial-streaming"
  | "bim-semantic-model"
  | "point-cloud-streaming"
  | "geospatial-data-layers"
  | "vector-map-streaming"
  | "wasm-runtime"
  | "scientific-volume";

export interface StudioBg3dRuntimeDescriptor {
  readonly id: StudioBg3dRuntimeId;
  readonly family:
    | "three"
    | "babylon"
    | "playcanvas"
    | "filament"
    | "cesium"
    | "xeokit"
    | "potree"
    | "deckgl"
    | "maplibre"
    | "wonderland"
    | "vtk";
  readonly maturity: "production" | "lab";
  readonly capabilities: ReadonlySet<StudioBg3dRuntimeCapability>;
  /** Measured/estimated first-activation gzip bytes; used only as a conservative policy gate. */
  readonly activationGzipBytes: number;
}

class StudioBg3dReadonlySet<T> implements ReadonlySet<T> {
  readonly #values: Set<T>;

  constructor(values: readonly T[]) {
    this.#values = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: T): boolean {
    return this.#values.has(value);
  }

  entries(): SetIterator<[T, T]> {
    return this.#values.entries();
  }

  keys(): SetIterator<T> {
    return this.#values.keys();
  }

  values(): SetIterator<T> {
    return this.#values.values();
  }

  forEach(
    callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void,
    thisArg?: unknown,
  ): void {
    this.#values.forEach((value) => callbackfn.call(thisArg, value, value, this));
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.#values[Symbol.iterator]();
  }

  union<U>(other: ReadonlySetLike<U>): Set<T | U> {
    const result = new Set<T | U>(this.#values);
    visitSetLike(other, (value) => result.add(value));
    return result;
  }

  intersection<U>(other: ReadonlySetLike<U>): Set<T & U> {
    const result = new Set<T & U>();
    for (const value of this.#values) {
      if ((other as ReadonlySetLike<unknown>).has(value)) result.add(value as T & U);
    }
    return result;
  }

  difference<U>(other: ReadonlySetLike<U>): Set<T> {
    const result = new Set<T>();
    for (const value of this.#values) {
      if (!(other as ReadonlySetLike<unknown>).has(value)) result.add(value);
    }
    return result;
  }

  symmetricDifference<U>(other: ReadonlySetLike<U>): Set<T | U> {
    const result = new Set<T | U>();
    for (const value of this.#values) {
      if (!(other as ReadonlySetLike<unknown>).has(value)) result.add(value);
    }
    visitSetLike(other, (value) => {
      if (!this.#values.has(value as unknown as T)) result.add(value);
    });
    return result;
  }

  isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
    for (const value of this.#values) {
      if (!other.has(value)) return false;
    }
    return true;
  }

  isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
    let result = true;
    visitSetLike(other, (value) => {
      if (!this.#values.has(value as T)) result = false;
    });
    return result;
  }

  isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
    for (const value of this.#values) {
      if (other.has(value)) return false;
    }
    return true;
  }
}

/** ES2025 Set-like keys() is only an Iterator, not necessarily an IterableIterator. */
function visitSetLike<T>(other: ReadonlySetLike<T>, visit: (value: T) => void): void {
  const iterator = other.keys();
  for (let next = iterator.next(); !next.done; next = iterator.next()) visit(next.value);
}

function runtimeCapabilities(
  values: readonly StudioBg3dRuntimeCapability[],
): ReadonlySet<StudioBg3dRuntimeCapability> {
  return new StudioBg3dReadonlySet(values);
}

export const STUDIO_BG3D_RUNTIME_CATALOG: Readonly<Record<
  StudioBg3dRuntimeId,
  StudioBg3dRuntimeDescriptor
>> = Object.freeze({
  "three-webgl": Object.freeze({
    id: "three-webgl",
    family: "three",
    maturity: "production",
    capabilities: runtimeCapabilities([
      "interactive-editing",
      "capture-rgba-depth",
      "skinning",
      "morph-targets",
      "webgl",
      "webxr",
    ]),
    activationGzipBytes: 80_000,
  }),
  "three-webgpu": Object.freeze({
    id: "three-webgpu",
    family: "three",
    maturity: "production",
    capabilities: runtimeCapabilities([
      "interactive-editing",
      "capture-rgba-depth",
      "skinning",
      "morph-targets",
      "webgpu",
      "compute",
    ]),
    // Vite 8 production measurement of the `three/webgpu` graph: 197,119 gzip bytes; keep ~6%
    // policy headroom. WebXR stays off the capability list until Three's WebGPU XR path matches
    // the WebGL session bridge this editor already ships.
    activationGzipBytes: 210_000,
  }),
  "three-spark-webgl-lab": Object.freeze({
    id: "three-spark-webgl-lab",
    family: "three",
    maturity: "lab",
    capabilities: runtimeCapabilities(["webgl", "gaussian-splatting"]),
    // Conservative gate until an isolated Spark corpus produces a manifest measurement.
    activationGzipBytes: 160_000,
  }),
  "babylon-webgl-lab": Object.freeze({
    id: "babylon-webgl-lab",
    family: "babylon",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "capture-rgba-depth",
      "multi-artifact-capture",
      "skinning",
      "morph-targets",
      "webgl",
      "physics",
      "webxr",
      "thin-instancing",
      "progressive-gltf",
      "webtoon-scene-fx",
    ]),
    activationGzipBytes: 306_000,
  }),
  "babylon-webgpu-lab": Object.freeze({
    id: "babylon-webgpu-lab",
    family: "babylon",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "capture-rgba-depth",
      "multi-artifact-capture",
      "skinning",
      "morph-targets",
      "webgpu",
      "physics",
      "webxr",
      "thin-instancing",
      "progressive-gltf",
      "webtoon-scene-fx",
    ]),
    activationGzipBytes: 271_000,
  }),
  "playcanvas-webgl-lab": Object.freeze({
    id: "playcanvas-webgl-lab",
    family: "playcanvas",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "interactive-editing",
      "capture-rgba-depth",
      "skinning",
      "morph-targets",
      "webgl",
      "thin-instancing",
      "progressive-gltf",
      "gaussian-splatting",
    ]),
    activationGzipBytes: 230_000,
  }),
  "playcanvas-webgpu-lab": Object.freeze({
    id: "playcanvas-webgpu-lab",
    family: "playcanvas",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "interactive-editing",
      "skinning",
      "morph-targets",
      "webgpu",
      "thin-instancing",
      "progressive-gltf",
      "compute",
      "gaussian-splatting",
    ]),
    activationGzipBytes: 260_000,
  }),
  "filament-webgl-lab": Object.freeze({
    id: "filament-webgl-lab",
    family: "filament",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "capture-rgba-depth",
      "skinning",
      "morph-targets",
      "webgl",
      "material-conformance",
    ]),
    activationGzipBytes: 350_000,
  }),
  "cesium-webgl-lab": Object.freeze({
    id: "cesium-webgl-lab",
    family: "cesium",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "webgl",
      "geospatial-streaming",
    ]),
    activationGzipBytes: 500_000,
  }),
  "xeokit-webgl-lab": Object.freeze({
    id: "xeokit-webgl-lab",
    family: "xeokit",
    maturity: "lab",
    capabilities: runtimeCapabilities(["webgl", "bim-semantic-model"]),
    // Estimated ceiling only; licensing and an XKT/IFC corpus gate any adapter installation.
    activationGzipBytes: 500_000,
  }),
  "potree-webgl-lab": Object.freeze({
    id: "potree-webgl-lab",
    family: "potree",
    maturity: "lab",
    capabilities: runtimeCapabilities(["webgl", "point-cloud-streaming"]),
    activationGzipBytes: 500_000,
  }),
  "deckgl-webgl-lab": Object.freeze({
    id: "deckgl-webgl-lab",
    family: "deckgl",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "webgl",
      "geospatial-data-layers",
    ]),
    activationGzipBytes: 450_000,
  }),
  "maplibre-webgl-lab": Object.freeze({
    id: "maplibre-webgl-lab",
    family: "maplibre",
    maturity: "lab",
    capabilities: runtimeCapabilities(["webgl", "vector-map-streaming"]),
    activationGzipBytes: 350_000,
  }),
  "wonderland-wasm-webgl-lab": Object.freeze({
    id: "wonderland-wasm-webgl-lab",
    family: "wonderland",
    maturity: "lab",
    capabilities: runtimeCapabilities(["webgl", "webxr", "wasm-runtime"]),
    activationGzipBytes: 400_000,
  }),
  "vtk-webgl-lab": Object.freeze({
    id: "vtk-webgl-lab",
    family: "vtk",
    maturity: "lab",
    capabilities: runtimeCapabilities([
      "webgl",
      "scientific-volume",
    ]),
    activationGzipBytes: 450_000,
  }),
});

export interface StudioBg3dSpecialistJobRequest {
  readonly id: string;
  readonly requiredCapabilities: readonly StudioBg3dRuntimeCapability[];
}

export interface StudioBg3dRuntimeTopologyRequest {
  /** Adapters actually registered by the current build/feature flags. */
  readonly availableRuntimeIds: readonly StudioBg3dRuntimeId[];
  readonly primaryCapabilities: readonly StudioBg3dRuntimeCapability[];
  readonly specialistJobs?: readonly StudioBg3dSpecialistJobRequest[];
  readonly allowLabRuntimes: boolean;
  readonly webgpuSupported: boolean;
  readonly maximumActivationGzipBytes: number;
  /**
   * Runtime the caller has already selected for this session (see `studio-bg3d-engine-selection`).
   * It wins the primary slot only when it is available, eligible, and supports every required
   * capability. An unavailable explicit selection is terminal for this plan; it is never
   * substituted with another runtime.
   */
  readonly preferredPrimaryRuntimeId?: StudioBg3dRuntimeId;
}

export type StudioBg3dRuntimeTopologyDiagnostic =
  | "invalid-request"
  | "no-primary-runtime"
  | "specialist-unavailable"
  | "lab-runtime-disabled"
  | "webgpu-unavailable"
  | "activation-budget-exceeded"
  | "preferred-runtime-unavailable";

export interface StudioBg3dSpecialistAssignment {
  readonly jobId: string;
  readonly runtimeId: StudioBg3dRuntimeId;
  /** True means a separate scene/canvas or headless task; never a shared mutable scene graph. */
  readonly isolated: boolean;
}

export interface StudioBg3dRuntimeTopologyPlan {
  readonly ok: boolean;
  readonly primaryRuntimeId: StudioBg3dRuntimeId | null;
  readonly specialists: readonly StudioBg3dSpecialistAssignment[];
  readonly totalActivationGzipBytes: number;
  readonly diagnostics: readonly StudioBg3dRuntimeTopologyDiagnostic[];
  readonly boundary: "scene-document+verified-glb-snapshots";
  readonly singleInteractiveOwner: true;
}

function uniqueCapabilities(
  capabilities: readonly StudioBg3dRuntimeCapability[],
): readonly StudioBg3dRuntimeCapability[] | null {
  if (!Array.isArray(capabilities)) return null;
  return [...new Set(capabilities)];
}

function supports(
  runtime: StudioBg3dRuntimeDescriptor,
  capabilities: readonly StudioBg3dRuntimeCapability[],
): boolean {
  return capabilities.every((capability) => runtime.capabilities.has(capability));
}

function eligibleRuntime(
  runtime: StudioBg3dRuntimeDescriptor,
  request: StudioBg3dRuntimeTopologyRequest,
  diagnostics: StudioBg3dRuntimeTopologyDiagnostic[],
): boolean {
  if (runtime.maturity === "lab" && !request.allowLabRuntimes) {
    diagnostics.push("lab-runtime-disabled");
    return false;
  }
  if (runtime.capabilities.has("webgpu") && !request.webgpuSupported) {
    diagnostics.push("webgpu-unavailable");
    return false;
  }
  if (runtime.activationGzipBytes > request.maximumActivationGzipBytes) {
    diagnostics.push("activation-budget-exceeded");
    return false;
  }
  return true;
}

function runtimePreference(runtime: StudioBg3dRuntimeDescriptor): readonly number[] {
  return [
    runtime.maturity === "production" ? 0 : 1,
    runtime.family === "three" ? 0 : 1,
    runtime.activationGzipBytes,
  ];
}

function compareRuntime(
  left: StudioBg3dRuntimeDescriptor,
  right: StudioBg3dRuntimeDescriptor,
): number {
  const leftPreference = runtimePreference(left);
  const rightPreference = runtimePreference(right);
  for (let index = 0; index < leftPreference.length; index += 1) {
    const difference = (leftPreference[index] ?? 0) - (rightPreference[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.id.localeCompare(right.id);
}

function deduplicatedDiagnostics(
  diagnostics: readonly StudioBg3dRuntimeTopologyDiagnostic[],
): readonly StudioBg3dRuntimeTopologyDiagnostic[] {
  return Object.freeze([...new Set(diagnostics)]);
}

function isRuntimeId(value: unknown): value is StudioBg3dRuntimeId {
  return typeof value === "string" && Object.hasOwn(STUDIO_BG3D_RUNTIME_CATALOG, value);
}

export function planStudioBg3dRuntimeTopology(
  request: StudioBg3dRuntimeTopologyRequest,
): StudioBg3dRuntimeTopologyPlan {
  const invalidPlan = (): StudioBg3dRuntimeTopologyPlan => Object.freeze({
    ok: false,
    primaryRuntimeId: null,
    specialists: Object.freeze([]),
    totalActivationGzipBytes: 0,
    diagnostics: Object.freeze<StudioBg3dRuntimeTopologyDiagnostic[]>(["invalid-request"]),
    boundary: "scene-document+verified-glb-snapshots",
    singleInteractiveOwner: true,
  });
  if (
    !request ||
    !Array.isArray(request.availableRuntimeIds) ||
    !Number.isSafeInteger(request.maximumActivationGzipBytes) ||
    request.maximumActivationGzipBytes <= 0 ||
    typeof request.allowLabRuntimes !== "boolean" ||
    typeof request.webgpuSupported !== "boolean"
  ) {
    return invalidPlan();
  }
  const primaryCapabilities = uniqueCapabilities(request.primaryCapabilities);
  if (!primaryCapabilities || !primaryCapabilities.includes("interactive-editing")) return invalidPlan();

  const diagnostics: StudioBg3dRuntimeTopologyDiagnostic[] = [];
  const available = [...new Set(request.availableRuntimeIds.filter(isRuntimeId))]
    .map((id) => STUDIO_BG3D_RUNTIME_CATALOG[id])
    .filter((runtime): runtime is StudioBg3dRuntimeDescriptor => Boolean(runtime))
    .filter((runtime) => eligibleRuntime(runtime, request, diagnostics));
  const primaryCandidates = available.filter((runtime) => supports(runtime, primaryCapabilities));
  const preferred = request.preferredPrimaryRuntimeId === undefined
    ? undefined
    : primaryCandidates.find((runtime) => runtime.id === request.preferredPrimaryRuntimeId);
  if (request.preferredPrimaryRuntimeId !== undefined && !preferred) {
    diagnostics.push("preferred-runtime-unavailable");
    diagnostics.push("no-primary-runtime");
    return Object.freeze({
      ok: false,
      primaryRuntimeId: null,
      specialists: Object.freeze([]),
      totalActivationGzipBytes: 0,
      diagnostics: deduplicatedDiagnostics(diagnostics),
      boundary: "scene-document+verified-glb-snapshots",
      singleInteractiveOwner: true,
    });
  }
  const primary = preferred ?? primaryCandidates.sort(compareRuntime)[0];
  if (!primary) {
    diagnostics.push("no-primary-runtime");
    return Object.freeze({
      ok: false,
      primaryRuntimeId: null,
      specialists: Object.freeze([]),
      totalActivationGzipBytes: 0,
      diagnostics: deduplicatedDiagnostics(diagnostics),
      boundary: "scene-document+verified-glb-snapshots",
      singleInteractiveOwner: true,
    });
  }

  const assignments: StudioBg3dSpecialistAssignment[] = [];
  const activated = new Set<StudioBg3dRuntimeId>([primary.id]);
  for (const job of request.specialistJobs ?? []) {
    const required = uniqueCapabilities(job?.requiredCapabilities);
    if (!job || typeof job.id !== "string" || job.id.length === 0 || !required) {
      diagnostics.push("specialist-unavailable");
      continue;
    }
    if (supports(primary, required)) {
      assignments.push(Object.freeze({ jobId: job.id, runtimeId: primary.id, isolated: false }));
      continue;
    }
    const specialist = available
      .filter((runtime) => runtime.id !== primary.id && supports(runtime, required))
      .sort(compareRuntime)[0];
    if (!specialist) {
      diagnostics.push("specialist-unavailable");
      continue;
    }
    const alreadyActivatedBytes = [...activated].reduce(
      (total, id) => total + STUDIO_BG3D_RUNTIME_CATALOG[id].activationGzipBytes,
      0,
    );
    if (
      !activated.has(specialist.id) &&
      alreadyActivatedBytes + specialist.activationGzipBytes > request.maximumActivationGzipBytes
    ) {
      diagnostics.push("activation-budget-exceeded", "specialist-unavailable");
      continue;
    }
    activated.add(specialist.id);
    assignments.push(Object.freeze({ jobId: job.id, runtimeId: specialist.id, isolated: true }));
  }

  const totalActivationGzipBytes = [...activated].reduce(
    (total, id) => total + STUDIO_BG3D_RUNTIME_CATALOG[id].activationGzipBytes,
    0,
  );
  return Object.freeze({
    ok: true,
    primaryRuntimeId: primary.id,
    specialists: Object.freeze(assignments),
    totalActivationGzipBytes,
    diagnostics: deduplicatedDiagnostics(diagnostics),
    boundary: "scene-document+verified-glb-snapshots",
    singleInteractiveOwner: true,
  });
}
