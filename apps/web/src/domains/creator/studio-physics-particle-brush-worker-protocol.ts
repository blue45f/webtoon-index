import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioPhysicsParticleBrushArtifact,
  StudioPhysicsParticleBrushErrorCode,
  StudioPhysicsParticleBrushRecipe,
  StudioPhysicsParticleBrushReceipt,
  StudioPhysicsParticleBrushRequest,
  StudioPhysicsParticleConnectorArtifact,
  StudioPhysicsParticleDepositionArtifact,
  StudioPhysicsParticleFlowField,
  StudioPhysicsParticlePathArtifact,
  StudioPhysicsParticleStrokeSample,
} from "./studio-physics-particle-brush-provider";

export const STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE = 6 as const;

const MEBIBYTE = 1_048_576;
const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export const STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS = Object.freeze({
  maxInputBytes: 320 * MEBIBYTE,
  maxOutputBytes: 320 * MEBIBYTE,
  maxResidentBytes: 512 * MEBIBYTE,
  maxSamples: 100_000,
  maxParticles: 256,
  maxSpawnStations: 100_000,
  maxStepsPerSpawn: 256,
  maxFlowCells: 4_194_304,
  maxPathPoints: 4_000_000,
  maxConnectorSegments: 4_000_000,
  maxWorkUnits: 24_000_000,
  maxFailureDetailCharacters: 512,
} as const);

const MAX_ARTIFACT_HASH_PLANE_BYTES = Math.max(
  STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxPathPoints * 2
    * Float32Array.BYTES_PER_ELEMENT,
  STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxConnectorSegments * 4
    * Float32Array.BYTES_PER_ELEMENT,
  STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSpawnStations * 8
    * Float32Array.BYTES_PER_ELEMENT,
);
const COOPERATIVE_COPY_BYTES = MEBIBYTE;
const MAX_SYNCHRONOUS_HASH_BYTES = MEBIBYTE;

export interface StudioPhysicsParticleWorkerSnapshotOptions {
  readonly signal?: AbortSignal;
  readonly isCurrent?: () => boolean;
}

class StudioPhysicsParticleWorkerSnapshotCancelled extends Error {}

function assertSnapshotCurrent(
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): void {
  if (options.signal?.aborted || options.isCurrent?.() === false) {
    throw new StudioPhysicsParticleWorkerSnapshotCancelled();
  }
}

function yieldToEventLoop(
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): Promise<void> {
  assertSnapshotCurrent(options);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (cancelTimer: boolean): void => {
      if (settled) return;
      settled = true;
      if (cancelTimer && timer !== null) clearTimeout(timer);
      try {
        options.signal?.removeEventListener("abort", onAbort);
      } catch {
        // The caller-visible snapshot state remains authoritative.
      }
      resolve();
    };
    const onAbort = (): void => finish(true);
    timer = setTimeout(() => finish(false), 0);
    try {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      reject(error);
      return;
    }
    if (options.signal?.aborted || options.isCurrent?.() === false) finish(true);
  });
}

async function copyFloat32Cooperatively(
  source: Float32Array,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
  predicate: (value: number, index: number) => boolean =
    (value) => Number.isFinite(value),
): Promise<Float32Array | null> {
  assertSnapshotCurrent(options);
  const output = new Float32Array(source.length);
  const chunkElements = COOPERATIVE_COPY_BYTES / Float32Array.BYTES_PER_ELEMENT;
  for (let offset = 0; offset < source.length; offset += chunkElements) {
    const end = Math.min(source.length, offset + chunkElements);
    for (let index = offset; index < end; index += 1) {
      const value = source[index];
      if (!predicate(value, index)) return null;
      output[index] = value;
    }
    if (end < source.length) {
      await yieldToEventLoop(options);
      assertSnapshotCurrent(options);
    }
  }
  return output;
}

async function copyUint32Cooperatively(
  source: Uint32Array,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): Promise<Uint32Array> {
  assertSnapshotCurrent(options);
  const output = new Uint32Array(source.length);
  const chunkElements = COOPERATIVE_COPY_BYTES / Uint32Array.BYTES_PER_ELEMENT;
  for (let offset = 0; offset < source.length; offset += chunkElements) {
    const end = Math.min(source.length, offset + chunkElements);
    output.set(source.subarray(offset, end), offset);
    if (end < source.length) {
      await yieldToEventLoop(options);
      assertSnapshotCurrent(options);
    }
  }
  return output;
}

export interface StudioPhysicsParticleWorkerWireFlowField {
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  readonly cellSize: number;
  readonly heights: Float32Array;
}

export interface StudioPhysicsParticleWorkerWireRequest {
  readonly requestEpoch: number;
  readonly recipe: StudioPhysicsParticleBrushRecipe;
  /** Interleaved x/y/pressure/speed/tilt-x/tilt-y. */
  readonly samples: Float32Array;
  readonly flowField?: StudioPhysicsParticleWorkerWireFlowField;
  readonly append?: Readonly<{
    previous: StudioPhysicsParticleBrushArtifact;
  }>;
}

export type StudioPhysicsParticleWorkerBoundaryFailureReason =
  | "aborted"
  | "backpressure"
  | "disposed"
  | "execution-failed"
  | "invalid-message"
  | "invalid-result"
  | "operation-timeout"
  | "protocol-error"
  | "startup-timeout"
  | "worker-unavailable";

export interface StudioPhysicsParticleWorkerOnlyReceipt {
  readonly kind: "studio-physics-particle-worker-only-receipt";
  readonly execution: "dedicated-worker";
  readonly mainThreadComputationFallback: false;
  readonly workerTerminated: boolean;
  readonly complete: false;
  readonly reason: StudioPhysicsParticleWorkerBoundaryFailureReason;
}

export interface StudioPhysicsParticleWorkerBoundaryFailure {
  readonly status: "worker-failed";
  readonly reason: StudioPhysicsParticleWorkerBoundaryFailureReason;
  readonly detail: string;
  readonly fallback: StudioPhysicsParticleWorkerOnlyReceipt;
}

export interface StudioPhysicsParticleWorkerCompleted {
  readonly status: "completed";
  readonly receipt: StudioPhysicsParticleBrushReceipt;
}

export interface StudioPhysicsParticleWorkerRejected {
  readonly status: "rejected";
  readonly reason:
    | StudioPhysicsParticleBrushErrorCode
    | "stale-epoch";
}

export interface StudioPhysicsParticleWorkerCancelled {
  readonly status: "cancelled";
}

export type StudioPhysicsParticleWorkerResult =
  | StudioPhysicsParticleWorkerCompleted
  | StudioPhysicsParticleWorkerRejected
  | StudioPhysicsParticleWorkerCancelled
  | StudioPhysicsParticleWorkerBoundaryFailure;

export interface StudioPhysicsParticleWorkerExecuteMessage {
  readonly type: "studio-physics-particle/execute";
  readonly version: typeof STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly workerSequence: number;
  readonly request: StudioPhysicsParticleWorkerWireRequest;
}

export interface StudioPhysicsParticleWorkerCancelMessage {
  readonly type: "studio-physics-particle/cancel";
  readonly version: typeof STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface StudioPhysicsParticleWorkerReleaseMessage {
  readonly type: "studio-physics-particle/release";
  readonly version: typeof STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface StudioPhysicsParticleWorkerAdvanceEpochMessage {
  readonly type: "studio-physics-particle/advance-epoch";
  readonly version: typeof STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION;
  readonly epoch: number;
}

export type StudioPhysicsParticleWorkerInboundMessage =
  | StudioPhysicsParticleWorkerExecuteMessage
  | StudioPhysicsParticleWorkerCancelMessage
  | StudioPhysicsParticleWorkerReleaseMessage
  | StudioPhysicsParticleWorkerAdvanceEpochMessage;

export interface StudioPhysicsParticleWorkerReadyMessage {
  readonly type: "studio-physics-particle/ready";
  readonly version: typeof STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION;
  readonly epoch: number;
  readonly workerSequence: 0;
}

export interface StudioPhysicsParticleWorkerResultMessage {
  readonly type: "studio-physics-particle/result";
  readonly version: typeof STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly requestEpoch: number;
  readonly workerSequence: number;
  readonly result: StudioPhysicsParticleWorkerResult;
}

export type StudioPhysicsParticleWorkerOutboundMessage =
  | StudioPhysicsParticleWorkerReadyMessage
  | StudioPhysicsParticleWorkerResultMessage;

export type StudioPhysicsParticleWorkerRequestSnapshot =
  | Readonly<{
    ok: true;
    request: StudioPhysicsParticleWorkerWireRequest;
    inputBytes: number;
    maximumOutputBytes: number;
    residentBytes: number;
    workUnits: number;
    spawnCount: number;
    pathPointCount: number;
    connectorSegmentCount: number;
    recipeFingerprint: `sha256:${string}`;
    strokeFingerprint: `sha256:${string}`;
    flowFieldHash: `sha256:${string}` | null;
    replayFingerprint: `sha256:${string}`;
  }>
  | Readonly<{
    ok: false;
    reason: "invalid-request" | "budget-exceeded";
  }>;

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteFloat32(value: unknown): value is Float32Array {
  return value instanceof Float32Array
    && value.buffer instanceof ArrayBuffer
    && value.every(Number.isFinite);
}

function ownedUint32(value: unknown): value is Uint32Array {
  return value instanceof Uint32Array
    && value.buffer instanceof ArrayBuffer;
}

function hashBytes(value: ArrayBufferView): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  )}`;
}

function hashText(value: string): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(value))}`;
}

async function hashBytesCooperatively(
  value: ArrayBufferView,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): Promise<`sha256:${string}`> {
  assertSnapshotCurrent(options);
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.byteLength <= MAX_SYNCHRONOUS_HASH_BYTES) return hashBytes(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new TypeError(
      "Large particle Worker snapshots require asynchronous SHA-256",
    );
  }
  const source = bytes.buffer instanceof ArrayBuffer
    ? bytes as Uint8Array<ArrayBuffer>
    : new Uint8Array(bytes);
  const digest = await subtle.digest("SHA-256", source);
  assertSnapshotCurrent(options);
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `sha256:${hex}`;
}

function normalizedExpressionForFingerprint(
  value: unknown,
): Readonly<{
  source: "constant" | "pressure" | "speed" | "tilt";
  minimum: number;
  maximum: number;
  invert: boolean;
}> {
  const input = plainRecord(value) ? value : {};
  const source = (
    input.source === "pressure"
    || input.source === "speed"
    || input.source === "tilt"
  )
    ? input.source
    : "constant";
  return Object.freeze({
    source,
    minimum: finite(input.minimum) ? input.minimum : 1,
    maximum: finite(input.maximum) ? input.maximum : 1,
    invert: Boolean(input.invert),
  });
}

function normalizedRecipeFingerprint(
  recipe: StudioPhysicsParticleBrushRecipe,
): `sha256:${string}` {
  const expressions = plainRecord(recipe.common.expressions)
    ? recipe.common.expressions
    : {};
  const common = Object.freeze({
    count: recipe.common.count,
    spawnSpacing: recipe.common.spawnSpacing,
    fixedTimeStepSeconds: recipe.common.fixedTimeStepSeconds,
    globalChaos: recipe.common.globalChaos,
    localChaos: recipe.common.localChaos,
    chaosSmoothing: recipe.common.chaosSmoothing,
    damping: recipe.common.damping,
    dampingJitter: recipe.common.dampingJitter,
    directionalForce: recipe.common.directionalForce,
    forceDirectionRadians: recipe.common.forceDirectionRadians,
    baseRadius: recipe.common.baseRadius,
    baseAlpha: recipe.common.baseAlpha,
    baseWeight: recipe.common.baseWeight,
    baseGlow: recipe.common.baseGlow,
    expressions: Object.freeze({
      radius: normalizedExpressionForFingerprint(expressions.radius),
      alpha: normalizedExpressionForFingerprint(expressions.alpha),
      weight: normalizedExpressionForFingerprint(expressions.weight),
      glow: normalizedExpressionForFingerprint(expressions.glow),
      force: normalizedExpressionForFingerprint(expressions.force),
      chaos: normalizedExpressionForFingerprint(expressions.chaos),
    }),
  });
  const orbital = recipe.mode === "orbital" && recipe.orbital
    ? Object.freeze({
      steps: recipe.orbital.steps,
      velocity: recipe.orbital.velocity,
      acceleration: recipe.orbital.acceleration,
      spin: recipe.orbital.spin,
      orbitRadius: recipe.orbital.orbitRadius,
      orbitRadiusJitter: recipe.orbital.orbitRadiusJitter,
    })
    : null;
  const flow = recipe.mode === "flow" && recipe.flow
    ? Object.freeze({
      lifetimeSteps: recipe.flow.lifetimeSteps,
      velocity: recipe.flow.velocity,
      positionJitter: recipe.flow.positionJitter,
      flowHeightGain: recipe.flow.flowHeightGain,
      flowTangentGain: recipe.flow.flowTangentGain,
    })
    : null;
  const springNet = recipe.mode === "spring-net" && recipe.springNet
    ? Object.freeze({
      topology: recipe.springNet.topology,
      steps: recipe.springNet.steps,
      initialRadius: recipe.springNet.initialRadius,
      stiffness: recipe.springNet.stiffness,
      springDamping: recipe.springNet.springDamping,
      restLength: recipe.springNet.restLength,
      restLengthJitter: recipe.springNet.restLengthJitter,
      emitConnectors: Boolean(recipe.springNet.emitConnectors),
      connectorAlpha: recipe.springNet.connectorAlpha ?? 0.5,
      connectorWeight: recipe.springNet.connectorWeight ?? 1,
      connectorGlow: recipe.springNet.connectorGlow ?? 0,
    })
    : null;
  return hashText(JSON.stringify({
    mode: recipe.mode,
    seed: recipe.seed,
    common,
    orbital,
    flow,
    springNet,
  }));
}

function canonicalWireStations(
  samples: Float32Array,
  spawnSpacing: number,
): Float32Array {
  const stride = STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE;
  const retainedOffsets: number[] = [];
  for (let offset = 0; offset < samples.length; offset += stride) {
    const previousOffset = retainedOffsets.at(-1);
    if (
      previousOffset !== undefined
      && Math.hypot(
        samples[offset] - samples[previousOffset],
        samples[offset + 1] - samples[previousOffset + 1],
      ) <= 1e-7
    ) {
      retainedOffsets[retainedOffsets.length - 1] = offset;
    } else {
      retainedOffsets.push(offset);
    }
  }
  if (retainedOffsets.length < 2) return new Float32Array();
  const cumulative = new Float64Array(retainedOffsets.length);
  let totalLength = 0;
  for (let index = 1; index < retainedOffsets.length; index += 1) {
    const previous = retainedOffsets[index - 1];
    const current = retainedOffsets[index];
    totalLength += Math.hypot(
      samples[current] - samples[previous],
      samples[current + 1] - samples[previous + 1],
    );
    cumulative[index] = totalLength;
  }
  const spawnCount = Math.floor(
    (totalLength + spawnSpacing * 1e-9) / spawnSpacing,
  ) + 1;
  const stations = new Float32Array(spawnCount * 8);
  let segment = 0;
  for (let spawn = 0; spawn < spawnCount; spawn += 1) {
    const distance = Math.min(totalLength, spawn * spawnSpacing);
    while (
      segment + 1 < cumulative.length - 1
      && cumulative[segment + 1] < distance
    ) segment += 1;
    const start = retainedOffsets[segment];
    const end = retainedOffsets[segment + 1];
    const segmentLength = cumulative[segment + 1] - cumulative[segment];
    const amount = segmentLength <= 1e-7
      ? 0
      : Math.min(
        1,
        Math.max(0, (distance - cumulative[segment]) / segmentLength),
      );
    const dx = samples[end] - samples[start];
    const dy = samples[end + 1] - samples[start + 1];
    const inverseLength = 1 / Math.max(1e-7, Math.hypot(dx, dy));
    const stationOffset = spawn * 8;
    stations[stationOffset] = Math.fround(samples[start] + dx * amount);
    stations[stationOffset + 1] =
      Math.fround(samples[start + 1] + dy * amount);
    stations[stationOffset + 2] = Math.fround(dx * inverseLength);
    stations[stationOffset + 3] = Math.fround(dy * inverseLength);
    for (let channel = 2; channel < stride; channel += 1) {
      stations[stationOffset + channel + 2] = Math.fround(
        samples[start + channel]
          + (samples[end + channel] - samples[start + channel]) * amount,
      );
    }
  }
  return stations;
}

async function canonicalWireStationsCooperatively(
  samples: Float32Array,
  spawnSpacing: number,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): Promise<
  | Readonly<{ ok: true; stations: Float32Array; totalLength: number }>
  | Readonly<{ ok: false; reason: "invalid-request" | "budget-exceeded" }>
> {
  const stride = STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE;
  const sampleCount = samples.length / stride;
  const sampleChunk = Math.max(
    1,
    Math.floor(COOPERATIVE_COPY_BYTES / (stride * Float32Array.BYTES_PER_ELEMENT)),
  );
  const retainedOffsets = new Uint32Array(sampleCount);
  let retainedCount = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const offset = sampleIndex * stride;
    const previousOffset = retainedCount > 0
      ? retainedOffsets[retainedCount - 1]
      : undefined;
    if (
      previousOffset !== undefined
      && Math.hypot(
        samples[offset] - samples[previousOffset],
        samples[offset + 1] - samples[previousOffset + 1],
      ) <= 1e-7
    ) {
      retainedOffsets[retainedCount - 1] = offset;
    } else {
      retainedOffsets[retainedCount] = offset;
      retainedCount += 1;
    }
    if (
      sampleIndex + 1 < sampleCount
      && (sampleIndex + 1) % sampleChunk === 0
    ) {
      await yieldToEventLoop(options);
      assertSnapshotCurrent(options);
    }
  }
  if (retainedCount < 2) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }

  const cumulative = new Float64Array(retainedCount);
  let totalLength = 0;
  for (let index = 1; index < retainedCount; index += 1) {
    const previous = retainedOffsets[index - 1];
    const current = retainedOffsets[index];
    totalLength += Math.hypot(
      samples[current] - samples[previous],
      samples[current + 1] - samples[previous + 1],
    );
    cumulative[index] = totalLength;
    if (index + 1 < retainedCount && (index + 1) % sampleChunk === 0) {
      await yieldToEventLoop(options);
      assertSnapshotCurrent(options);
    }
  }
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const spawnCount = Math.floor(
    (totalLength + spawnSpacing * 1e-9) / spawnSpacing,
  ) + 1;
  if (
    !positiveInteger(spawnCount)
    || spawnCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSpawnStations
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });

  const stations = new Float32Array(spawnCount * 8);
  const stationChunk = Math.max(
    1,
    Math.floor(COOPERATIVE_COPY_BYTES / (8 * Float32Array.BYTES_PER_ELEMENT)),
  );
  let segment = 0;
  for (let spawn = 0; spawn < spawnCount; spawn += 1) {
    const distance = Math.min(totalLength, spawn * spawnSpacing);
    while (
      segment + 1 < retainedCount - 1
      && cumulative[segment + 1] < distance
    ) segment += 1;
    const start = retainedOffsets[segment];
    const end = retainedOffsets[segment + 1];
    const segmentLength = cumulative[segment + 1] - cumulative[segment];
    const amount = segmentLength <= 1e-7
      ? 0
      : Math.min(
        1,
        Math.max(0, (distance - cumulative[segment]) / segmentLength),
      );
    const dx = samples[end] - samples[start];
    const dy = samples[end + 1] - samples[start + 1];
    const inverseLength = 1 / Math.max(1e-7, Math.hypot(dx, dy));
    const stationOffset = spawn * 8;
    stations[stationOffset] = Math.fround(samples[start] + dx * amount);
    stations[stationOffset + 1] =
      Math.fround(samples[start + 1] + dy * amount);
    stations[stationOffset + 2] = Math.fround(dx * inverseLength);
    stations[stationOffset + 3] = Math.fround(dy * inverseLength);
    for (let channel = 2; channel < stride; channel += 1) {
      stations[stationOffset + channel + 2] = Math.fround(
        samples[start + channel]
          + (samples[end + channel] - samples[start + channel]) * amount,
      );
    }
    if (spawn + 1 < spawnCount && (spawn + 1) % stationChunk === 0) {
      await yieldToEventLoop(options);
      assertSnapshotCurrent(options);
    }
  }
  assertSnapshotCurrent(options);
  return Object.freeze({ ok: true, stations, totalLength });
}

function flowFieldFingerprint(
  flowField: StudioPhysicsParticleWorkerWireFlowField | undefined,
): `sha256:${string}` | null {
  if (!flowField) return null;
  const heightsHash = hashBytes(flowField.heights);
  return hashText(JSON.stringify({
    width: flowField.width,
    height: flowField.height,
    originX: flowField.originX,
    originY: flowField.originY,
    cellSize: flowField.cellSize,
    heightsHash,
  }));
}

function replayFingerprintFor(
  recipeFingerprint: `sha256:${string}`,
  strokeFingerprint: `sha256:${string}`,
  flowFieldHash: `sha256:${string}` | null,
): `sha256:${string}` {
  return hashText(JSON.stringify({
    revision: 1,
    appendPolicy: "prefix-validated-fixed-station-exact",
    recipeFingerprint,
    strokeFingerprint,
    flowFieldHash,
  }));
}

function ownedTransferBuffer(value: ArrayBufferView): ArrayBuffer {
  if (!(value.buffer instanceof ArrayBuffer)) {
    throw new TypeError("Particle Worker transfer buffer is not owned");
  }
  return value.buffer;
}

function clonePlain(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 8) return null;
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry, depth + 1));
  }
  if (!plainRecord(value)) return null;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = clonePlain(entry, depth + 1);
    if (cloned === null && entry !== null) return null;
    copy[key] = cloned;
  }
  return copy;
}

function snapshotRecipe(
  value: unknown,
): StudioPhysicsParticleBrushRecipe | null {
  if (
    !plainRecord(value)
    || !onlyKeys(
      value,
      ["mode", "seed", "common"],
      ["orbital", "flow", "springNet"],
    )
    || (
      value.mode !== "orbital"
      && value.mode !== "flow"
      && value.mode !== "spring-net"
    )
    || !nonNegativeInteger(value.seed)
    || value.seed > 0xffff_ffff
    || !plainRecord(value.common)
    || !onlyKeys(
      value.common,
      [
        "count",
        "spawnSpacing",
        "fixedTimeStepSeconds",
        "globalChaos",
        "localChaos",
        "chaosSmoothing",
        "damping",
        "dampingJitter",
        "directionalForce",
        "forceDirectionRadians",
        "baseRadius",
        "baseAlpha",
        "baseWeight",
        "baseGlow",
      ],
      ["expressions"],
    )
    || !positiveInteger(value.common.count)
    || value.common.count > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxParticles
    || !finite(value.common.spawnSpacing)
    || value.common.spawnSpacing <= 0
    || !finite(value.common.fixedTimeStepSeconds)
    || value.common.fixedTimeStepSeconds <= 0
  ) return null;
  for (const key of [
    "globalChaos",
    "localChaos",
    "chaosSmoothing",
    "damping",
    "dampingJitter",
    "directionalForce",
    "forceDirectionRadians",
    "baseRadius",
    "baseAlpha",
    "baseWeight",
    "baseGlow",
  ]) {
    if (!finite(value.common[key])) return null;
  }
  if (
    value.common.expressions !== undefined
    && !plainRecord(value.common.expressions)
  ) return null;
  const modeKey = value.mode === "spring-net" ? "springNet" : value.mode;
  const settings = value[modeKey];
  if (!plainRecord(settings)) return null;
  const stepValue = value.mode === "flow"
    ? settings.lifetimeSteps
    : settings.steps;
  if (
    !positiveInteger(stepValue)
    || stepValue > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxStepsPerSpawn
  ) return null;
  const cloned = clonePlain(value);
  return plainRecord(cloned)
    ? cloned as unknown as StudioPhysicsParticleBrushRecipe
    : null;
}

function outputBytesFor(
  spawnCount: number,
  pathPointCount: number,
  connectorSegmentCount: number,
): number {
  return spawnCount * 8 * 4
    + pathPointCount * 44
    + connectorSegmentCount * 36;
}

function maximumArtifactPlaneBytes(
  spawnCount: number,
  pathPointCount: number,
  connectorSegmentCount: number,
): number {
  return Math.max(
    spawnCount * 8 * Float32Array.BYTES_PER_ELEMENT,
    pathPointCount * 2 * Float32Array.BYTES_PER_ELEMENT,
    pathPointCount * Uint32Array.BYTES_PER_ELEMENT,
    connectorSegmentCount * 4 * Float32Array.BYTES_PER_ELEMENT,
    connectorSegmentCount * Uint32Array.BYTES_PER_ELEMENT,
  );
}

function springEdgeCount(
  count: number,
  recipe: StudioPhysicsParticleBrushRecipe,
): number {
  if (recipe.mode !== "spring-net" || !recipe.springNet?.emitConnectors) return 0;
  return recipe.springNet.topology === "ring" ? count : Math.max(0, count - 1);
}

function packedStrokeLength(samples: Float32Array): number {
  let length = 0;
  for (
    let offset = STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE;
    offset < samples.length;
    offset += STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE
  ) {
    length += Math.hypot(
      samples[offset] - samples[offset - STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE],
      samples[offset + 1]
        - samples[offset + 1 - STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE],
    );
  }
  return length;
}

function artifactDataHash(
  artifact: StudioPhysicsParticleBrushArtifact,
): `sha256:${string}` {
  const hashes: string[] = [
    hashBytes(artifact.emitterStations),
    hashBytes(artifact.path.positions),
    hashBytes(artifact.path.particleIndices),
    hashBytes(artifact.path.spawnIndices),
    hashBytes(artifact.path.stepIndices),
    hashBytes(artifact.deposition.positions),
    hashBytes(artifact.deposition.radius),
    hashBytes(artifact.deposition.alpha),
    hashBytes(artifact.deposition.weight),
    hashBytes(artifact.deposition.glow),
  ];
  if (artifact.connectors) {
    hashes.push(
      hashBytes(artifact.connectors.segments),
      hashBytes(artifact.connectors.spawnIndices),
      hashBytes(artifact.connectors.stepIndices),
      hashBytes(artifact.connectors.alpha),
      hashBytes(artifact.connectors.weight),
      hashBytes(artifact.connectors.glow),
    );
  } else hashes.push("connectors:null");
  return hashText(hashes.join("\n"));
}

function computedArtifactHash(
  artifact: StudioPhysicsParticleBrushArtifact,
): `sha256:${string}` {
  return hashText(
    `${artifact.replayFingerprint}\n${artifactDataHash(artifact)}`,
  );
}

function copyArtifact(
  value: unknown,
  expectedOutputBytes?: number,
): StudioPhysicsParticleBrushArtifact | null {
  try {
    if (!plainRecord(value)) return null;
    const kind = value.kind;
    const revision = value.revision;
    const mode = value.mode;
    const appendPolicy = value.appendPolicy;
    const seed = value.seed;
    const count = value.count;
    const fixedTimeStepSeconds = value.fixedTimeStepSeconds;
    const spawnCount = value.spawnCount;
    const stepsPerSpawn = value.stepsPerSpawn;
    const outputBytes = value.outputBytes;
    const recipeFingerprint = value.recipeFingerprint;
    const strokeFingerprint = value.strokeFingerprint;
    const flowFieldHash = value.flowFieldHash;
    const replayFingerprint = value.replayFingerprint;
    const artifactHash = value.artifactHash;
    const compositingInput = value.compositing;
    if (
      kind !== "studio-physics-particle-brush-artifact"
      || revision !== 1
      || (mode !== "orbital" && mode !== "flow" && mode !== "spring-net")
      || appendPolicy !== "prefix-validated-fixed-station-exact"
      || !nonNegativeInteger(seed)
      || !positiveInteger(count)
      || count > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxParticles
      || !finite(fixedTimeStepSeconds)
      || fixedTimeStepSeconds <= 0
      || !positiveInteger(spawnCount)
      || spawnCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSpawnStations
      || !positiveInteger(stepsPerSpawn)
      || stepsPerSpawn
        > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxStepsPerSpawn
      || !nonNegativeInteger(outputBytes)
      || outputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
      || (
        expectedOutputBytes !== undefined
        && outputBytes !== expectedOutputBytes
      )
      || typeof recipeFingerprint !== "string"
      || !SHA_PATTERN.test(recipeFingerprint)
      || typeof strokeFingerprint !== "string"
      || !SHA_PATTERN.test(strokeFingerprint)
      || (
        flowFieldHash !== null
        && (
          typeof flowFieldHash !== "string"
          || !SHA_PATTERN.test(flowFieldHash)
        )
      )
      || typeof replayFingerprint !== "string"
      || !SHA_PATTERN.test(replayFingerprint)
      || typeof artifactHash !== "string"
      || !SHA_PATTERN.test(artifactHash)
      || !plainRecord(compositingInput)
      || compositingInput.alpha !== "straight-unassociated-coverage"
      || compositingInput.weight !== "normalized-path-weight"
      || compositingInput.glow !== "additive-linear-energy"
      || compositingInput.connectorAlpha
        !== "straight-unassociated-coverage"
    ) return null;
    const pointCount = spawnCount * count * stepsPerSpawn;
    if (
      !Number.isSafeInteger(pointCount)
      || pointCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxPathPoints
    ) return null;

    const emitterStations = value.emitterStations;
    const pathInput = value.path;
    const depositionInput = value.deposition;
    const connectorsInput = value.connectors;
    if (!plainRecord(pathInput) || !plainRecord(depositionInput)) return null;
    const pathPositions = pathInput.positions;
    const pathParticleIndices = pathInput.particleIndices;
    const pathSpawnIndices = pathInput.spawnIndices;
    const pathStepIndices = pathInput.stepIndices;
    const depositionPositions = depositionInput.positions;
    const depositionRadius = depositionInput.radius;
    const depositionAlpha = depositionInput.alpha;
    const depositionWeight = depositionInput.weight;
    const depositionGlow = depositionInput.glow;
    if (
      !finiteFloat32(emitterStations)
      || emitterStations.length !== spawnCount * 8
      || !finiteFloat32(pathPositions)
      || !ownedUint32(pathParticleIndices)
      || !ownedUint32(pathSpawnIndices)
      || !ownedUint32(pathStepIndices)
      || !finiteFloat32(depositionPositions)
      || !finiteFloat32(depositionRadius)
      || !finiteFloat32(depositionAlpha)
      || !finiteFloat32(depositionWeight)
      || !finiteFloat32(depositionGlow)
      || pathPositions.length !== pointCount * 2
      || pathParticleIndices.length !== pointCount
      || pathSpawnIndices.length !== pointCount
      || pathStepIndices.length !== pointCount
      || depositionPositions.length !== pointCount * 2
      || depositionRadius.length !== pointCount
      || depositionAlpha.length !== pointCount
      || depositionWeight.length !== pointCount
      || depositionGlow.length !== pointCount
      || depositionAlpha.some((entry) => entry < 0 || entry > 1)
      || depositionRadius.some((entry) => entry < 0)
      || depositionWeight.some((entry) => entry < 0)
      || depositionGlow.some((entry) => entry < 0)
    ) return null;

    let connectorCount = 0;
    let connectorSource: StudioPhysicsParticleConnectorArtifact | null = null;
    if (connectorsInput !== null) {
      if (!plainRecord(connectorsInput)) return null;
      const segments = connectorsInput.segments;
      const spawnIndices = connectorsInput.spawnIndices;
      const stepIndices = connectorsInput.stepIndices;
      const alpha = connectorsInput.alpha;
      const weight = connectorsInput.weight;
      const glow = connectorsInput.glow;
      if (
        !finiteFloat32(segments)
        || !ownedUint32(spawnIndices)
        || !ownedUint32(stepIndices)
        || !finiteFloat32(alpha)
        || !finiteFloat32(weight)
        || !finiteFloat32(glow)
        || segments.length % 4 !== 0
      ) return null;
      connectorCount = segments.length / 4;
      if (
        connectorCount
          > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxConnectorSegments
        || spawnIndices.length !== connectorCount
        || stepIndices.length !== connectorCount
        || alpha.length !== connectorCount
        || weight.length !== connectorCount
        || glow.length !== connectorCount
      ) return null;
      connectorSource = Object.freeze({
        segments,
        spawnIndices,
        stepIndices,
        alpha,
        weight,
        glow,
      });
    }
    const computedOutputBytes = outputBytesFor(
      spawnCount,
      pointCount,
      connectorCount,
    );
    if (computedOutputBytes !== outputBytes) return null;

    const connectors = connectorSource
      ? Object.freeze({
        segments: new Float32Array(connectorSource.segments),
        spawnIndices: new Uint32Array(connectorSource.spawnIndices),
        stepIndices: new Uint32Array(connectorSource.stepIndices),
        alpha: new Float32Array(connectorSource.alpha),
        weight: new Float32Array(connectorSource.weight),
        glow: new Float32Array(connectorSource.glow),
      })
      : null;
    const ownedEmitterStations = new Float32Array(emitterStations);
    const path: StudioPhysicsParticlePathArtifact = Object.freeze({
      positions: new Float32Array(pathPositions),
      particleIndices: new Uint32Array(pathParticleIndices),
      spawnIndices: new Uint32Array(pathSpawnIndices),
      stepIndices: new Uint32Array(pathStepIndices),
    });
    const deposition: StudioPhysicsParticleDepositionArtifact = Object.freeze({
      positions: new Float32Array(depositionPositions),
      radius: new Float32Array(depositionRadius),
      alpha: new Float32Array(depositionAlpha),
      weight: new Float32Array(depositionWeight),
      glow: new Float32Array(depositionGlow),
    });
    const artifact = Object.freeze({
      kind,
      revision,
      mode,
      appendPolicy,
      seed,
      count,
      fixedTimeStepSeconds,
      spawnCount,
      stepsPerSpawn,
      emitterStations: ownedEmitterStations,
      path,
      deposition,
      connectors,
      compositing: Object.freeze({
        alpha: "straight-unassociated-coverage" as const,
        weight: "normalized-path-weight" as const,
        glow: "additive-linear-energy" as const,
        connectorAlpha: "straight-unassociated-coverage" as const,
      }),
      recipeFingerprint:
        recipeFingerprint as `sha256:${string}`,
      strokeFingerprint:
        strokeFingerprint as `sha256:${string}`,
      flowFieldHash:
        flowFieldHash as `sha256:${string}` | null,
      replayFingerprint:
        replayFingerprint as `sha256:${string}`,
      artifactHash: artifactHash as `sha256:${string}`,
      outputBytes,
    });
    if (
      hashBytes(ownedEmitterStations) !== artifact.strokeFingerprint
      || computedArtifactHash(artifact) !== artifact.artifactHash
    ) return null;
    return artifact;
  } catch {
    return null;
  }
}

async function copyArtifactCooperatively(
  value: unknown,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
  expectedOutputBytes?: number,
): Promise<StudioPhysicsParticleBrushArtifact | null> {
  assertSnapshotCurrent(options);
  if (!plainRecord(value)) return null;
  try {
    const kind = value.kind;
    const revision = value.revision;
    const mode = value.mode;
    const appendPolicy = value.appendPolicy;
    const seed = value.seed;
    const count = value.count;
    const fixedTimeStepSeconds = value.fixedTimeStepSeconds;
    const spawnCount = value.spawnCount;
    const stepsPerSpawn = value.stepsPerSpawn;
    const outputBytes = value.outputBytes;
    const recipeFingerprint = value.recipeFingerprint;
    const strokeFingerprint = value.strokeFingerprint;
    const flowFieldHash = value.flowFieldHash;
    const replayFingerprint = value.replayFingerprint;
    const artifactHash = value.artifactHash;
    const compositingInput = value.compositing;
    if (
      kind !== "studio-physics-particle-brush-artifact"
      || revision !== 1
      || (mode !== "orbital" && mode !== "flow" && mode !== "spring-net")
      || appendPolicy !== "prefix-validated-fixed-station-exact"
      || !nonNegativeInteger(seed)
      || !positiveInteger(count)
      || count > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxParticles
      || !finite(fixedTimeStepSeconds)
      || fixedTimeStepSeconds <= 0
      || !positiveInteger(spawnCount)
      || spawnCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSpawnStations
      || !positiveInteger(stepsPerSpawn)
      || stepsPerSpawn > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxStepsPerSpawn
      || !nonNegativeInteger(outputBytes)
      || outputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
      || (
        expectedOutputBytes !== undefined
        && outputBytes !== expectedOutputBytes
      )
      || typeof recipeFingerprint !== "string"
      || !SHA_PATTERN.test(recipeFingerprint)
      || typeof strokeFingerprint !== "string"
      || !SHA_PATTERN.test(strokeFingerprint)
      || (
        flowFieldHash !== null
        && (
          typeof flowFieldHash !== "string"
          || !SHA_PATTERN.test(flowFieldHash)
        )
      )
      || typeof replayFingerprint !== "string"
      || !SHA_PATTERN.test(replayFingerprint)
      || typeof artifactHash !== "string"
      || !SHA_PATTERN.test(artifactHash)
      || !plainRecord(compositingInput)
      || compositingInput.alpha !== "straight-unassociated-coverage"
      || compositingInput.weight !== "normalized-path-weight"
      || compositingInput.glow !== "additive-linear-energy"
      || compositingInput.connectorAlpha
        !== "straight-unassociated-coverage"
    ) return null;
    const pointCount = spawnCount * count * stepsPerSpawn;
    if (
      !Number.isSafeInteger(pointCount)
      || pointCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxPathPoints
    ) return null;
    const emitterSource = value.emitterStations;
    const pathInput = value.path;
    const depositionInput = value.deposition;
    const connectorsInput = value.connectors;
    if (
      !(emitterSource instanceof Float32Array)
      || !(emitterSource.buffer instanceof ArrayBuffer)
      || emitterSource.length !== spawnCount * 8
      || !plainRecord(pathInput)
      || !plainRecord(depositionInput)
    ) return null;
    const pathPositionsSource = pathInput.positions;
    const pathParticleSource = pathInput.particleIndices;
    const pathSpawnSource = pathInput.spawnIndices;
    const pathStepSource = pathInput.stepIndices;
    const depositionPositionsSource = depositionInput.positions;
    const depositionRadiusSource = depositionInput.radius;
    const depositionAlphaSource = depositionInput.alpha;
    const depositionWeightSource = depositionInput.weight;
    const depositionGlowSource = depositionInput.glow;
    if (
      !(pathPositionsSource instanceof Float32Array)
      || !(pathPositionsSource.buffer instanceof ArrayBuffer)
      || pathPositionsSource.length !== pointCount * 2
      || !(pathParticleSource instanceof Uint32Array)
      || !(pathParticleSource.buffer instanceof ArrayBuffer)
      || pathParticleSource.length !== pointCount
      || !(pathSpawnSource instanceof Uint32Array)
      || !(pathSpawnSource.buffer instanceof ArrayBuffer)
      || pathSpawnSource.length !== pointCount
      || !(pathStepSource instanceof Uint32Array)
      || !(pathStepSource.buffer instanceof ArrayBuffer)
      || pathStepSource.length !== pointCount
      || !(depositionPositionsSource instanceof Float32Array)
      || !(depositionPositionsSource.buffer instanceof ArrayBuffer)
      || depositionPositionsSource.length !== pointCount * 2
      || !(depositionRadiusSource instanceof Float32Array)
      || !(depositionRadiusSource.buffer instanceof ArrayBuffer)
      || depositionRadiusSource.length !== pointCount
      || !(depositionAlphaSource instanceof Float32Array)
      || !(depositionAlphaSource.buffer instanceof ArrayBuffer)
      || depositionAlphaSource.length !== pointCount
      || !(depositionWeightSource instanceof Float32Array)
      || !(depositionWeightSource.buffer instanceof ArrayBuffer)
      || depositionWeightSource.length !== pointCount
      || !(depositionGlowSource instanceof Float32Array)
      || !(depositionGlowSource.buffer instanceof ArrayBuffer)
      || depositionGlowSource.length !== pointCount
    ) return null;
    let connectorCount = 0;
    let connectorSources: Readonly<{
      segments: Float32Array;
      spawnIndices: Uint32Array;
      stepIndices: Uint32Array;
      alpha: Float32Array;
      weight: Float32Array;
      glow: Float32Array;
    }> | null = null;
    if (connectorsInput !== null) {
      if (!plainRecord(connectorsInput)) return null;
      const segments = connectorsInput.segments;
      const spawnIndices = connectorsInput.spawnIndices;
      const stepIndices = connectorsInput.stepIndices;
      const alpha = connectorsInput.alpha;
      const weight = connectorsInput.weight;
      const glow = connectorsInput.glow;
      if (
        !(segments instanceof Float32Array)
        || !(segments.buffer instanceof ArrayBuffer)
        || segments.length % 4 !== 0
      ) return null;
      connectorCount = segments.length / 4;
      if (
        connectorCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxConnectorSegments
        || !(spawnIndices instanceof Uint32Array)
        || !(spawnIndices.buffer instanceof ArrayBuffer)
        || spawnIndices.length !== connectorCount
        || !(stepIndices instanceof Uint32Array)
        || !(stepIndices.buffer instanceof ArrayBuffer)
        || stepIndices.length !== connectorCount
        || !(alpha instanceof Float32Array)
        || !(alpha.buffer instanceof ArrayBuffer)
        || alpha.length !== connectorCount
        || !(weight instanceof Float32Array)
        || !(weight.buffer instanceof ArrayBuffer)
        || weight.length !== connectorCount
        || !(glow instanceof Float32Array)
        || !(glow.buffer instanceof ArrayBuffer)
        || glow.length !== connectorCount
      ) return null;
      connectorSources = { segments, spawnIndices, stepIndices, alpha, weight, glow };
    }
    if (
      outputBytesFor(spawnCount, pointCount, connectorCount) !== outputBytes
    ) return null;

    const emitterStations = await copyFloat32Cooperatively(
      emitterSource,
      options,
    );
    const pathPositions = await copyFloat32Cooperatively(
      pathPositionsSource,
      options,
    );
    const depositionPositions = await copyFloat32Cooperatively(
      depositionPositionsSource,
      options,
    );
    const depositionRadius = await copyFloat32Cooperatively(
      depositionRadiusSource,
      options,
      (entry) => Number.isFinite(entry) && entry >= 0,
    );
    const depositionAlpha = await copyFloat32Cooperatively(
      depositionAlphaSource,
      options,
      (entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1,
    );
    const depositionWeight = await copyFloat32Cooperatively(
      depositionWeightSource,
      options,
      (entry) => Number.isFinite(entry) && entry >= 0,
    );
    const depositionGlow = await copyFloat32Cooperatively(
      depositionGlowSource,
      options,
      (entry) => Number.isFinite(entry) && entry >= 0,
    );
    if (
      !emitterStations
      || !pathPositions
      || !depositionPositions
      || !depositionRadius
      || !depositionAlpha
      || !depositionWeight
      || !depositionGlow
    ) return null;
    const path = Object.freeze({
      positions: pathPositions,
      particleIndices: await copyUint32Cooperatively(pathParticleSource, options),
      spawnIndices: await copyUint32Cooperatively(pathSpawnSource, options),
      stepIndices: await copyUint32Cooperatively(pathStepSource, options),
    });
    const deposition = Object.freeze({
      positions: depositionPositions,
      radius: depositionRadius,
      alpha: depositionAlpha,
      weight: depositionWeight,
      glow: depositionGlow,
    });
    let connectors: StudioPhysicsParticleConnectorArtifact | null = null;
    if (connectorSources) {
      const segments = await copyFloat32Cooperatively(
        connectorSources.segments,
        options,
      );
      const alpha = await copyFloat32Cooperatively(
        connectorSources.alpha,
        options,
      );
      const weight = await copyFloat32Cooperatively(
        connectorSources.weight,
        options,
      );
      const glow = await copyFloat32Cooperatively(
        connectorSources.glow,
        options,
      );
      if (!segments || !alpha || !weight || !glow) return null;
      connectors = Object.freeze({
        segments,
        spawnIndices: await copyUint32Cooperatively(
          connectorSources.spawnIndices,
          options,
        ),
        stepIndices: await copyUint32Cooperatively(
          connectorSources.stepIndices,
          options,
        ),
        alpha,
        weight,
        glow,
      });
    }
    const artifact = Object.freeze({
      kind,
      revision,
      mode,
      appendPolicy,
      seed,
      count,
      fixedTimeStepSeconds,
      spawnCount,
      stepsPerSpawn,
      emitterStations,
      path,
      deposition,
      connectors,
      compositing: Object.freeze({
        alpha: "straight-unassociated-coverage" as const,
        weight: "normalized-path-weight" as const,
        glow: "additive-linear-energy" as const,
        connectorAlpha: "straight-unassociated-coverage" as const,
      }),
      recipeFingerprint: recipeFingerprint as `sha256:${string}`,
      strokeFingerprint: strokeFingerprint as `sha256:${string}`,
      flowFieldHash: flowFieldHash as `sha256:${string}` | null,
      replayFingerprint: replayFingerprint as `sha256:${string}`,
      artifactHash: artifactHash as `sha256:${string}`,
      outputBytes,
    });
    const hashes: string[] = [];
    for (const plane of [
      artifact.emitterStations,
      artifact.path.positions,
      artifact.path.particleIndices,
      artifact.path.spawnIndices,
      artifact.path.stepIndices,
      artifact.deposition.positions,
      artifact.deposition.radius,
      artifact.deposition.alpha,
      artifact.deposition.weight,
      artifact.deposition.glow,
    ]) hashes.push(await hashBytesCooperatively(plane, options));
    if (artifact.connectors) {
      for (const plane of [
        artifact.connectors.segments,
        artifact.connectors.spawnIndices,
        artifact.connectors.stepIndices,
        artifact.connectors.alpha,
        artifact.connectors.weight,
        artifact.connectors.glow,
      ]) hashes.push(await hashBytesCooperatively(plane, options));
    } else hashes.push("connectors:null");
    if (
      await hashBytesCooperatively(artifact.emitterStations, options)
        !== artifact.strokeFingerprint
      || hashText(
        `${artifact.replayFingerprint}\n${hashText(hashes.join("\n"))}`,
      ) !== artifact.artifactHash
    ) return null;
    return artifact;
  } catch (error) {
    if (error instanceof StudioPhysicsParticleWorkerSnapshotCancelled) {
      throw error;
    }
    return null;
  }
}

function artifactTransfers(
  artifact: StudioPhysicsParticleBrushArtifact,
): Transferable[] {
  const buffers: ArrayBuffer[] = [
    ownedTransferBuffer(artifact.emitterStations),
    ownedTransferBuffer(artifact.path.positions),
    ownedTransferBuffer(artifact.path.particleIndices),
    ownedTransferBuffer(artifact.path.spawnIndices),
    ownedTransferBuffer(artifact.path.stepIndices),
    ownedTransferBuffer(artifact.deposition.positions),
    ownedTransferBuffer(artifact.deposition.radius),
    ownedTransferBuffer(artifact.deposition.alpha),
    ownedTransferBuffer(artifact.deposition.weight),
    ownedTransferBuffer(artifact.deposition.glow),
  ];
  if (artifact.connectors) {
    buffers.push(
      ownedTransferBuffer(artifact.connectors.segments),
      ownedTransferBuffer(artifact.connectors.spawnIndices),
      ownedTransferBuffer(artifact.connectors.stepIndices),
      ownedTransferBuffer(artifact.connectors.alpha),
      ownedTransferBuffer(artifact.connectors.weight),
      ownedTransferBuffer(artifact.connectors.glow),
    );
  }
  return [...new Set(buffers)];
}

export function packStudioPhysicsParticleWorkerSamples(
  samples: readonly StudioPhysicsParticleStrokeSample[],
): Float32Array {
  if (
    !Array.isArray(samples)
    || samples.length < 2
    || samples.length > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSamples
  ) {
    throw new TypeError("Particle Worker samples are outside their budget");
  }
  const packed = new Float32Array(
    samples.length * STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE,
  );
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const values = [
      sample?.x,
      sample?.y,
      sample?.pressure ?? 1,
      sample?.speed ?? 0,
      sample?.tiltX ?? 0,
      sample?.tiltY ?? 0,
    ];
    if (
      !values.every(finite)
      || values[2] < 0
      || values[2] > 1
      || values[3] < 0
      || values[3] > 1
      || values[4] < -1
      || values[4] > 1
      || values[5] < -1
      || values[5] > 1
    ) throw new TypeError("Particle Worker sample values are invalid");
    packed.set(values, index * STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE);
  }
  return packed;
}

function copyFlowField(
  value: unknown,
): StudioPhysicsParticleWorkerWireFlowField | null {
  try {
    if (
      !plainRecord(value)
      || !onlyKeys(
        value,
        ["width", "height", "originX", "originY", "cellSize", "heights"],
      )
    ) return null;
    const width = value.width;
    const height = value.height;
    const originX = value.originX;
    const originY = value.originY;
    const cellSize = value.cellSize;
    if (
      !positiveInteger(width)
      || !positiveInteger(height)
      || width < 2
      || height < 2
      || !finite(originX)
      || !finite(originY)
      || !finite(cellSize)
      || cellSize <= 0
    ) return null;
    const cellCount = width * height;
    if (
      !Number.isSafeInteger(cellCount)
      || cellCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxFlowCells
    ) return null;
    const heights = value.heights;
    if (
      !(heights instanceof Float32Array)
      || !(heights.buffer instanceof ArrayBuffer)
      || heights.length !== cellCount
      || heights.byteLength
        !== cellCount * Float32Array.BYTES_PER_ELEMENT
      || !heights.every(Number.isFinite)
    ) return null;
    return Object.freeze({
      width,
      height,
      originX,
      originY,
      cellSize,
      heights: new Float32Array(heights),
    });
  } catch {
    return null;
  }
}

async function copyFlowFieldCooperatively(
  value: unknown,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): Promise<StudioPhysicsParticleWorkerWireFlowField | null> {
  assertSnapshotCurrent(options);
  try {
    if (
      !plainRecord(value)
      || !onlyKeys(
        value,
        ["width", "height", "originX", "originY", "cellSize", "heights"],
      )
    ) return null;
    const width = value.width;
    const height = value.height;
    const originX = value.originX;
    const originY = value.originY;
    const cellSize = value.cellSize;
    if (
      !positiveInteger(width)
      || !positiveInteger(height)
      || width < 2
      || height < 2
      || !finite(originX)
      || !finite(originY)
      || !finite(cellSize)
      || cellSize <= 0
    ) return null;
    const cellCount = width * height;
    if (
      !Number.isSafeInteger(cellCount)
      || cellCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxFlowCells
    ) return null;
    const source = value.heights;
    if (
      !(source instanceof Float32Array)
      || !(source.buffer instanceof ArrayBuffer)
      || source.length !== cellCount
      || source.byteLength !== cellCount * Float32Array.BYTES_PER_ELEMENT
    ) return null;
    const heights = await copyFloat32Cooperatively(source, options);
    if (!heights) return null;
    assertSnapshotCurrent(options);
    return Object.freeze({
      width,
      height,
      originX,
      originY,
      cellSize,
      heights,
    });
  } catch (error) {
    if (error instanceof StudioPhysicsParticleWorkerSnapshotCancelled) {
      throw error;
    }
    return null;
  }
}

export function snapshotStudioPhysicsParticleWorkerRequest(
  value: unknown,
): StudioPhysicsParticleWorkerRequestSnapshot {
  if (!plainRecord(value)) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  let requestEpoch: unknown;
  let recipeInput: unknown;
  let samplesInput: unknown;
  let flowFieldInput: unknown;
  let appendValue: unknown;
  try {
    if (!onlyKeys(
      value,
      ["requestEpoch", "recipe", "samples"],
      ["flowField", "append"],
    )) return Object.freeze({ ok: false, reason: "invalid-request" });
    requestEpoch = value.requestEpoch;
    recipeInput = value.recipe;
    samplesInput = value.samples;
    flowFieldInput = value.flowField;
    appendValue = value.append;
  } catch {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  if (
    !positiveInteger(requestEpoch)
    || !(samplesInput instanceof Float32Array)
    || !(samplesInput.buffer instanceof ArrayBuffer)
    || samplesInput.length
      % STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE !== 0
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  const sampleCount = samplesInput.length
    / STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE;
  if (
    sampleCount < 2
    || sampleCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSamples
  ) {
    return Object.freeze({
      ok: false,
      reason: sampleCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSamples
        ? "budget-exceeded"
        : "invalid-request",
    });
  }
  if (!samplesInput.every(Number.isFinite)) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const samples = new Float32Array(samplesInput);
  for (
    let offset = 0;
    offset < samples.length;
    offset += STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE
  ) {
    if (
      samples[offset + 2] < 0
      || samples[offset + 2] > 1
      || samples[offset + 3] < 0
      || samples[offset + 3] > 1
      || samples[offset + 4] < -1
      || samples[offset + 4] > 1
      || samples[offset + 5] < -1
      || samples[offset + 5] > 1
    ) return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const recipe = snapshotRecipe(recipeInput);
  if (!recipe) return Object.freeze({ ok: false, reason: "invalid-request" });
  let flowField: StudioPhysicsParticleWorkerWireFlowField | undefined;
  if (flowFieldInput !== undefined) {
    const copied = copyFlowField(flowFieldInput);
    if (!copied) return Object.freeze({ ok: false, reason: "invalid-request" });
    flowField = copied;
  }
  let appendInput: Readonly<Record<string, unknown>> | undefined;
  let previousInput: unknown;
  let previousOutputBytes = 0;
  if (appendValue !== undefined) {
    if (
      !plainRecord(appendValue)
      || !onlyKeys(appendValue, ["previous"])
    ) return Object.freeze({ ok: false, reason: "invalid-request" });
    appendInput = appendValue;
    previousInput = appendInput.previous;
    if (!plainRecord(previousInput)) {
      return Object.freeze({ ok: false, reason: "invalid-request" });
    }
    try {
      const declaredBytes = previousInput.outputBytes;
      if (
        !nonNegativeInteger(declaredBytes)
        || declaredBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
      ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
      previousOutputBytes = declaredBytes;
    } catch {
      return Object.freeze({ ok: false, reason: "invalid-request" });
    }
  }
  const strokeLength = packedStrokeLength(samples);
  if (!Number.isFinite(strokeLength) || strokeLength <= 0) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const spawnCount = Math.floor(
    (strokeLength + recipe.common.spawnSpacing * 1e-9)
      / recipe.common.spawnSpacing,
  ) + 1;
  const steps = recipe.mode === "flow"
    ? recipe.flow?.lifetimeSteps ?? 0
    : recipe.mode === "orbital"
      ? recipe.orbital?.steps ?? 0
      : recipe.springNet?.steps ?? 0;
  if (
    !positiveInteger(spawnCount)
    || spawnCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSpawnStations
    || !positiveInteger(steps)
    || steps > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxStepsPerSpawn
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  const pathPointCount = spawnCount * recipe.common.count * steps;
  const edgeCount = springEdgeCount(recipe.common.count, recipe);
  const connectorSegmentCount = spawnCount * edgeCount * steps;
  const workUnits = pathPointCount + connectorSegmentCount;
  const maximumOutputBytes = outputBytesFor(
    spawnCount,
    pathPointCount,
    connectorSegmentCount,
  );
  if (
    !Number.isSafeInteger(pathPointCount)
    || pathPointCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxPathPoints
    || !Number.isSafeInteger(connectorSegmentCount)
    || connectorSegmentCount
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxConnectorSegments
    || !Number.isSafeInteger(workUnits)
    || workUnits > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxWorkUnits
    || !Number.isSafeInteger(maximumOutputBytes)
    || maximumOutputBytes
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  const inputBytes = samples.byteLength
    + (flowField?.heights.byteLength ?? 0)
    + previousOutputBytes;
  const flowBytes = flowField?.heights.byteLength ?? 0;
  const stationScratchBytes = spawnCount * 8 * Float32Array.BYTES_PER_ELEMENT;
  const sampleScratchBytes = sampleCount * 7 * Float64Array.BYTES_PER_ELEMENT;
  const stateScratchBytes = recipe.common.count
      * 9
      * Float64Array.BYTES_PER_ELEMENT
    + edgeCount * Float64Array.BYTES_PER_ELEMENT;
  const hashScratchBytes = Math.max(
    flowBytes,
    previousOutputBytes,
    maximumArtifactPlaneBytes(
      spawnCount,
      pathPointCount,
      connectorSegmentCount,
    ),
  );
  const residentBytes = inputBytes * 2
    + previousOutputBytes
    + flowBytes
    + maximumOutputBytes * 2
    + stationScratchBytes
    + sampleScratchBytes
    + stateScratchBytes
    + hashScratchBytes;
  if (
    !Number.isSafeInteger(inputBytes)
    || inputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxInputBytes
    || !Number.isSafeInteger(residentBytes)
    || residentBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  let append:
    Readonly<{ previous: StudioPhysicsParticleBrushArtifact }>
    | undefined;
  if (appendInput) {
    const previous = copyArtifact(previousInput, previousOutputBytes);
    if (!previous) return Object.freeze({ ok: false, reason: "invalid-request" });
    if (
      previous.mode !== recipe.mode
      || previous.seed !== recipe.seed
      || previous.count !== recipe.common.count
      || previous.stepsPerSpawn !== steps
      || previous.spawnCount > spawnCount
    ) return Object.freeze({ ok: false, reason: "invalid-request" });
    append = Object.freeze({ previous });
  }
  const canonicalStations = canonicalWireStations(
    samples,
    recipe.common.spawnSpacing,
  );
  if (canonicalStations.length !== spawnCount * 8) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const recipeFingerprint = normalizedRecipeFingerprint(recipe);
  const strokeFingerprint = hashBytes(canonicalStations);
  const flowFieldHash = flowFieldFingerprint(flowField);
  const replayFingerprint = replayFingerprintFor(
    recipeFingerprint,
    strokeFingerprint,
    flowFieldHash,
  );
  return Object.freeze({
    ok: true,
    request: Object.freeze({
      requestEpoch,
      recipe,
      samples,
      ...(flowField ? { flowField } : {}),
      ...(append ? { append } : {}),
    }),
    inputBytes,
    maximumOutputBytes,
    residentBytes,
    workUnits,
    spawnCount,
    pathPointCount,
    connectorSegmentCount,
    recipeFingerprint,
    strokeFingerprint,
    flowFieldHash,
    replayFingerprint,
  });
}

async function snapshotStudioPhysicsParticleWorkerBaseCooperatively(
  input: Readonly<{
    requestEpoch: unknown;
    recipe: unknown;
    samples: unknown;
    flowField: unknown;
  }>,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): Promise<StudioPhysicsParticleWorkerRequestSnapshot> {
  assertSnapshotCurrent(options);
  const { requestEpoch, recipe: recipeInput, samples: samplesInput } = input;
  if (
    !positiveInteger(requestEpoch)
    || !(samplesInput instanceof Float32Array)
    || !(samplesInput.buffer instanceof ArrayBuffer)
    || samplesInput.length
      % STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE !== 0
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  const sampleCount = samplesInput.length
    / STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE;
  if (
    sampleCount < 2
    || sampleCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSamples
  ) {
    return Object.freeze({
      ok: false,
      reason: sampleCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxSamples
        ? "budget-exceeded"
        : "invalid-request",
    });
  }

  const recipe = snapshotRecipe(recipeInput);
  if (!recipe) return Object.freeze({ ok: false, reason: "invalid-request" });
  const samples = await copyFloat32Cooperatively(
    samplesInput,
    options,
    (entry, index) => {
      if (!Number.isFinite(entry)) return false;
      const channel = index % STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE;
      if (channel === 2 || channel === 3) return entry >= 0 && entry <= 1;
      if (channel === 4 || channel === 5) return entry >= -1 && entry <= 1;
      return true;
    },
  );
  if (!samples) return Object.freeze({ ok: false, reason: "invalid-request" });
  assertSnapshotCurrent(options);

  let flowField: StudioPhysicsParticleWorkerWireFlowField | undefined;
  if (input.flowField !== undefined) {
    const copied = await copyFlowFieldCooperatively(input.flowField, options);
    if (!copied) return Object.freeze({ ok: false, reason: "invalid-request" });
    flowField = copied;
  }
  const stationSnapshot = await canonicalWireStationsCooperatively(
    samples,
    recipe.common.spawnSpacing,
    options,
  );
  if (!stationSnapshot.ok) return stationSnapshot;
  const { stations: canonicalStations } = stationSnapshot;
  const spawnCount = canonicalStations.length / 8;
  const steps = recipe.mode === "flow"
    ? recipe.flow?.lifetimeSteps ?? 0
    : recipe.mode === "orbital"
      ? recipe.orbital?.steps ?? 0
      : recipe.springNet?.steps ?? 0;
  if (
    !positiveInteger(steps)
    || steps > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxStepsPerSpawn
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  const pathPointCount = spawnCount * recipe.common.count * steps;
  const edgeCount = springEdgeCount(recipe.common.count, recipe);
  const connectorSegmentCount = spawnCount * edgeCount * steps;
  const workUnits = pathPointCount + connectorSegmentCount;
  const maximumOutputBytes = outputBytesFor(
    spawnCount,
    pathPointCount,
    connectorSegmentCount,
  );
  if (
    !Number.isSafeInteger(pathPointCount)
    || pathPointCount > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxPathPoints
    || !Number.isSafeInteger(connectorSegmentCount)
    || connectorSegmentCount
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxConnectorSegments
    || !Number.isSafeInteger(workUnits)
    || workUnits > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxWorkUnits
    || !Number.isSafeInteger(maximumOutputBytes)
    || maximumOutputBytes
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });

  const flowBytes = flowField?.heights.byteLength ?? 0;
  const inputBytes = samples.byteLength + flowBytes;
  const stationScratchBytes =
    spawnCount * 8 * Float32Array.BYTES_PER_ELEMENT;
  const sampleScratchBytes =
    sampleCount * 7 * Float64Array.BYTES_PER_ELEMENT;
  const stateScratchBytes = recipe.common.count
      * 9
      * Float64Array.BYTES_PER_ELEMENT
    + edgeCount * Float64Array.BYTES_PER_ELEMENT;
  const hashScratchBytes = Math.max(
    flowBytes,
    maximumArtifactPlaneBytes(
      spawnCount,
      pathPointCount,
      connectorSegmentCount,
    ),
  );
  const residentBytes = inputBytes * 2
    + flowBytes
    + maximumOutputBytes * 2
    + stationScratchBytes
    + sampleScratchBytes
    + stateScratchBytes
    + hashScratchBytes;
  if (
    !Number.isSafeInteger(inputBytes)
    || inputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxInputBytes
    || !Number.isSafeInteger(residentBytes)
    || residentBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });

  const recipeFingerprint = normalizedRecipeFingerprint(recipe);
  const strokeFingerprint = await hashBytesCooperatively(
    canonicalStations,
    options,
  );
  let flowFieldHash: `sha256:${string}` | null = null;
  if (flowField) {
    const heightsHash = await hashBytesCooperatively(flowField.heights, options);
    flowFieldHash = hashText(JSON.stringify({
      width: flowField.width,
      height: flowField.height,
      originX: flowField.originX,
      originY: flowField.originY,
      cellSize: flowField.cellSize,
      heightsHash,
    }));
  }
  assertSnapshotCurrent(options);
  const replayFingerprint = replayFingerprintFor(
    recipeFingerprint,
    strokeFingerprint,
    flowFieldHash,
  );
  return Object.freeze({
    ok: true,
    request: Object.freeze({
      requestEpoch,
      recipe,
      samples,
      ...(flowField ? { flowField } : {}),
    }),
    inputBytes,
    maximumOutputBytes,
    residentBytes,
    workUnits,
    spawnCount,
    pathPointCount,
    connectorSegmentCount,
    recipeFingerprint,
    strokeFingerprint,
    flowFieldHash,
    replayFingerprint,
  });
}

export async function snapshotStudioPhysicsParticleWorkerRequestCooperatively(
  value: unknown,
  options: StudioPhysicsParticleWorkerSnapshotOptions = {},
): Promise<StudioPhysicsParticleWorkerRequestSnapshot> {
  assertSnapshotCurrent(options);
  if (!plainRecord(value)) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  let requestEpoch: unknown;
  let recipe: unknown;
  let samples: unknown;
  let flowField: unknown;
  let append: unknown;
  try {
    if (!onlyKeys(
      value,
      ["requestEpoch", "recipe", "samples"],
      ["flowField", "append"],
    )) return Object.freeze({ ok: false, reason: "invalid-request" });
    requestEpoch = value.requestEpoch;
    recipe = value.recipe;
    samples = value.samples;
    flowField = value.flowField;
    append = value.append;
  } catch {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  assertSnapshotCurrent(options);
  const base = await snapshotStudioPhysicsParticleWorkerBaseCooperatively({
    requestEpoch,
    recipe,
    samples,
    flowField,
  }, options);
  assertSnapshotCurrent(options);
  if (!base.ok || append === undefined) return base;
  if (!plainRecord(append) || !onlyKeys(append, ["previous"])) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const previousInput = append.previous;
  if (!plainRecord(previousInput)) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  let previousOutputBytes: unknown;
  try {
    previousOutputBytes = previousInput.outputBytes;
  } catch {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  if (
    !nonNegativeInteger(previousOutputBytes)
    || previousOutputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  const flowBytes = base.request.flowField?.heights.byteLength ?? 0;
  const stationScratchBytes =
    base.spawnCount * 8 * Float32Array.BYTES_PER_ELEMENT;
  const sampleCount =
    base.request.samples.length / STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE;
  const sampleScratchBytes =
    sampleCount * 7 * Float64Array.BYTES_PER_ELEMENT;
  const edgeCount = springEdgeCount(
    base.request.recipe.common.count,
    base.request.recipe,
  );
  const stateScratchBytes = base.request.recipe.common.count
      * 9
      * Float64Array.BYTES_PER_ELEMENT
    + edgeCount * Float64Array.BYTES_PER_ELEMENT;
  const inputBytes = base.inputBytes + previousOutputBytes;
  const hashScratchBytes = Math.max(
    flowBytes,
    previousOutputBytes,
    maximumArtifactPlaneBytes(
      base.spawnCount,
      base.pathPointCount,
      base.connectorSegmentCount,
    ),
  );
  const residentBytes = inputBytes * 2
    + previousOutputBytes
    + flowBytes
    + base.maximumOutputBytes * 2
    + stationScratchBytes
    + sampleScratchBytes
    + stateScratchBytes
    + hashScratchBytes;
  if (
    !Number.isSafeInteger(inputBytes)
    || inputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxInputBytes
    || !Number.isSafeInteger(residentBytes)
    || residentBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  const previous = await copyArtifactCooperatively(
    previousInput,
    options,
    previousOutputBytes,
  );
  if (
    !previous
    || previous.mode !== base.request.recipe.mode
    || previous.seed !== base.request.recipe.seed
    || previous.count !== base.request.recipe.common.count
    || previous.stepsPerSpawn !== (
      base.request.recipe.mode === "flow"
        ? base.request.recipe.flow?.lifetimeSteps
        : base.request.recipe.mode === "orbital"
          ? base.request.recipe.orbital?.steps
          : base.request.recipe.springNet?.steps
    )
    || previous.spawnCount > base.spawnCount
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  return Object.freeze({
    ...base,
    request: Object.freeze({
      ...base.request,
      append: Object.freeze({ previous }),
    }),
    inputBytes,
    residentBytes,
  });
}

export function studioPhysicsParticleWorkerRequestTransfers(
  message: StudioPhysicsParticleWorkerExecuteMessage,
): Transferable[] {
  const buffers: ArrayBuffer[] = [
    ownedTransferBuffer(message.request.samples),
  ];
  if (message.request.flowField) {
    buffers.push(ownedTransferBuffer(message.request.flowField.heights));
  }
  if (message.request.append) {
    buffers.push(...artifactTransfers(message.request.append.previous) as ArrayBuffer[]);
  }
  return [...new Set(buffers)];
}

export function studioPhysicsParticleWireRequestToProviderRequest(
  request: StudioPhysicsParticleWorkerWireRequest,
  signal: AbortSignal,
): StudioPhysicsParticleBrushRequest {
  const samples: StudioPhysicsParticleStrokeSample[] = [];
  for (
    let offset = 0;
    offset < request.samples.length;
    offset += STUDIO_PHYSICS_PARTICLE_WORKER_SAMPLE_STRIDE
  ) {
    samples.push(Object.freeze({
      x: request.samples[offset],
      y: request.samples[offset + 1],
      pressure: request.samples[offset + 2],
      speed: request.samples[offset + 3],
      tiltX: request.samples[offset + 4],
      tiltY: request.samples[offset + 5],
    }));
  }
  let flowField: StudioPhysicsParticleFlowField | undefined;
  if (request.flowField) {
    flowField = Object.freeze({
      ...request.flowField,
      heights: request.flowField.heights,
    });
  }
  return Object.freeze({
    recipe: request.recipe,
    samples: Object.freeze(samples),
    ...(flowField ? { flowField } : {}),
    ...(request.append ? { append: request.append } : {}),
    epoch: request.requestEpoch,
    signal,
  });
}

function copyReceipt(
  value: unknown,
): StudioPhysicsParticleBrushReceipt | null {
  if (
    !plainRecord(value)
    || value.kind !== "studio-physics-particle-brush-receipt"
    || value.revision !== 1
    || value.status !== "complete"
    || (value.execution !== "rebuild" && value.execution !== "append")
    || value.appendPolicy !== "prefix-validated-fixed-station-exact"
    || (
      value.appendSourceArtifactHash !== null
      && (
        typeof value.appendSourceArtifactHash !== "string"
        || !SHA_PATTERN.test(value.appendSourceArtifactHash)
      )
    )
    || !positiveInteger(value.epoch)
    || !positiveInteger(value.sequence)
    || (
      value.mode !== "orbital"
      && value.mode !== "flow"
      && value.mode !== "spring-net"
    )
    || !nonNegativeInteger(value.seed)
    || !positiveInteger(value.inputSamples)
    || !positiveInteger(value.spawnCount)
    || !nonNegativeInteger(value.appendedSpawnCount)
    || !positiveInteger(value.pathPointCount)
    || !nonNegativeInteger(value.connectorSegmentCount)
    || !positiveInteger(value.workUnits)
    || !positiveInteger(value.outputBytes)
    || !positiveInteger(value.peakResidentBytes)
    || typeof value.recipeFingerprint !== "string"
    || !SHA_PATTERN.test(value.recipeFingerprint)
    || typeof value.strokeFingerprint !== "string"
    || !SHA_PATTERN.test(value.strokeFingerprint)
    || (
      value.flowFieldHash !== null
      && (
        typeof value.flowFieldHash !== "string"
        || !SHA_PATTERN.test(value.flowFieldHash)
      )
    )
    || typeof value.replayFingerprint !== "string"
    || !SHA_PATTERN.test(value.replayFingerprint)
    || typeof value.artifactHash !== "string"
    || !SHA_PATTERN.test(value.artifactHash)
    || value.failureCode !== null
    || typeof value.receiptHash !== "string"
    || !SHA_PATTERN.test(value.receiptHash)
  ) return null;
  const outputSnapshotResidentBytes = value.outputBytes * 2
    + Math.min(value.outputBytes, MAX_ARTIFACT_HASH_PLANE_BYTES);
  if (
    !Number.isSafeInteger(outputSnapshotResidentBytes)
    || outputSnapshotResidentBytes
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
  ) return null;
  const artifact = copyArtifact(value.artifact);
  if (!artifact) return null;
  const connectorSegmentCount = artifact.connectors
    ? artifact.connectors.segments.length / 4
    : 0;
  const pathPointCount = artifact.path.positions.length / 2;
  if (
    value.mode !== artifact.mode
    || value.seed !== artifact.seed
    || value.spawnCount !== artifact.spawnCount
    || value.pathPointCount !== pathPointCount
    || value.connectorSegmentCount !== connectorSegmentCount
    || value.workUnits !== pathPointCount + connectorSegmentCount
    || value.outputBytes !== artifact.outputBytes
    || value.outputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
    || value.peakResidentBytes
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
    || value.recipeFingerprint !== artifact.recipeFingerprint
    || value.strokeFingerprint !== artifact.strokeFingerprint
    || value.flowFieldHash !== artifact.flowFieldHash
    || value.replayFingerprint !== artifact.replayFingerprint
    || value.artifactHash !== artifact.artifactHash
  ) return null;
  const record = Object.freeze({
    kind: "studio-physics-particle-brush-receipt" as const,
    revision: 1 as const,
    status: "complete" as const,
    execution: value.execution,
    appendPolicy: "prefix-validated-fixed-station-exact" as const,
    appendSourceArtifactHash:
      value.appendSourceArtifactHash as `sha256:${string}` | null,
    epoch: value.epoch,
    sequence: value.sequence,
    mode: value.mode,
    seed: value.seed,
    inputSamples: value.inputSamples,
    spawnCount: value.spawnCount,
    appendedSpawnCount: value.appendedSpawnCount,
    pathPointCount: value.pathPointCount,
    connectorSegmentCount: value.connectorSegmentCount,
    workUnits: value.workUnits,
    outputBytes: value.outputBytes,
    peakResidentBytes: value.peakResidentBytes,
    recipeFingerprint:
      value.recipeFingerprint as `sha256:${string}`,
    strokeFingerprint:
      value.strokeFingerprint as `sha256:${string}`,
    flowFieldHash:
      value.flowFieldHash as `sha256:${string}` | null,
    replayFingerprint:
      value.replayFingerprint as `sha256:${string}`,
    artifactHash:
      value.artifactHash as `sha256:${string}`,
    failureCode: null,
  });
  if (hashText(JSON.stringify(record)) !== value.receiptHash) return null;
  return Object.freeze({
    ...record,
    receiptHash: value.receiptHash as `sha256:${string}`,
    artifact,
  });
}

async function copyReceiptCooperatively(
  value: unknown,
  options: StudioPhysicsParticleWorkerSnapshotOptions,
): Promise<StudioPhysicsParticleBrushReceipt | null> {
  assertSnapshotCurrent(options);
  if (
    !plainRecord(value)
    || value.kind !== "studio-physics-particle-brush-receipt"
    || value.revision !== 1
    || value.status !== "complete"
    || (value.execution !== "rebuild" && value.execution !== "append")
    || value.appendPolicy !== "prefix-validated-fixed-station-exact"
    || (
      value.appendSourceArtifactHash !== null
      && (
        typeof value.appendSourceArtifactHash !== "string"
        || !SHA_PATTERN.test(value.appendSourceArtifactHash)
      )
    )
    || !positiveInteger(value.epoch)
    || !positiveInteger(value.sequence)
    || (
      value.mode !== "orbital"
      && value.mode !== "flow"
      && value.mode !== "spring-net"
    )
    || !nonNegativeInteger(value.seed)
    || !positiveInteger(value.inputSamples)
    || !positiveInteger(value.spawnCount)
    || !nonNegativeInteger(value.appendedSpawnCount)
    || !positiveInteger(value.pathPointCount)
    || !nonNegativeInteger(value.connectorSegmentCount)
    || !positiveInteger(value.workUnits)
    || !positiveInteger(value.outputBytes)
    || !positiveInteger(value.peakResidentBytes)
    || typeof value.recipeFingerprint !== "string"
    || !SHA_PATTERN.test(value.recipeFingerprint)
    || typeof value.strokeFingerprint !== "string"
    || !SHA_PATTERN.test(value.strokeFingerprint)
    || (
      value.flowFieldHash !== null
      && (
        typeof value.flowFieldHash !== "string"
        || !SHA_PATTERN.test(value.flowFieldHash)
      )
    )
    || typeof value.replayFingerprint !== "string"
    || !SHA_PATTERN.test(value.replayFingerprint)
    || typeof value.artifactHash !== "string"
    || !SHA_PATTERN.test(value.artifactHash)
    || value.failureCode !== null
    || typeof value.receiptHash !== "string"
    || !SHA_PATTERN.test(value.receiptHash)
  ) return null;
  const outputSnapshotResidentBytes = value.outputBytes * 2
    + Math.min(value.outputBytes, MAX_ARTIFACT_HASH_PLANE_BYTES);
  if (
    !Number.isSafeInteger(outputSnapshotResidentBytes)
    || outputSnapshotResidentBytes
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
  ) return null;
  const artifact = await copyArtifactCooperatively(
    value.artifact,
    options,
    value.outputBytes,
  );
  if (!artifact) return null;
  const connectorSegmentCount = artifact.connectors
    ? artifact.connectors.segments.length / 4
    : 0;
  const pathPointCount = artifact.path.positions.length / 2;
  if (
    value.mode !== artifact.mode
    || value.seed !== artifact.seed
    || value.spawnCount !== artifact.spawnCount
    || value.pathPointCount !== pathPointCount
    || value.connectorSegmentCount !== connectorSegmentCount
    || value.workUnits !== pathPointCount + connectorSegmentCount
    || value.outputBytes !== artifact.outputBytes
    || value.outputBytes > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxOutputBytes
    || value.peakResidentBytes
      > STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
    || value.recipeFingerprint !== artifact.recipeFingerprint
    || value.strokeFingerprint !== artifact.strokeFingerprint
    || value.flowFieldHash !== artifact.flowFieldHash
    || value.replayFingerprint !== artifact.replayFingerprint
    || value.artifactHash !== artifact.artifactHash
  ) return null;
  const record = Object.freeze({
    kind: "studio-physics-particle-brush-receipt" as const,
    revision: 1 as const,
    status: "complete" as const,
    execution: value.execution,
    appendPolicy: "prefix-validated-fixed-station-exact" as const,
    appendSourceArtifactHash:
      value.appendSourceArtifactHash as `sha256:${string}` | null,
    epoch: value.epoch,
    sequence: value.sequence,
    mode: value.mode,
    seed: value.seed,
    inputSamples: value.inputSamples,
    spawnCount: value.spawnCount,
    appendedSpawnCount: value.appendedSpawnCount,
    pathPointCount: value.pathPointCount,
    connectorSegmentCount: value.connectorSegmentCount,
    workUnits: value.workUnits,
    outputBytes: value.outputBytes,
    peakResidentBytes: value.peakResidentBytes,
    recipeFingerprint: value.recipeFingerprint as `sha256:${string}`,
    strokeFingerprint: value.strokeFingerprint as `sha256:${string}`,
    flowFieldHash: value.flowFieldHash as `sha256:${string}` | null,
    replayFingerprint: value.replayFingerprint as `sha256:${string}`,
    artifactHash: value.artifactHash as `sha256:${string}`,
    failureCode: null,
  });
  if (hashText(JSON.stringify(record)) !== value.receiptHash) return null;
  return Object.freeze({
    ...record,
    receiptHash: value.receiptHash as `sha256:${string}`,
    artifact,
  });
}

export async function snapshotStudioPhysicsParticleWorkerResultCooperatively(
  value: unknown,
  options: StudioPhysicsParticleWorkerSnapshotOptions = {},
): Promise<StudioPhysicsParticleWorkerResult | null> {
  assertSnapshotCurrent(options);
  if (!plainRecord(value)) return null;
  if (value.status === "completed" && onlyKeys(value, ["status", "receipt"])) {
    const receipt = await copyReceiptCooperatively(value.receipt, options);
    return receipt
      ? Object.freeze({ status: "completed" as const, receipt })
      : null;
  }
  return snapshotStudioPhysicsParticleWorkerResult(value);
}

function rejectionReason(
  value: unknown,
): value is StudioPhysicsParticleWorkerRejected["reason"] {
  return value === "invalid-request"
    || value === "budget-exceeded"
    || value === "append-mismatch"
    || value === "integrity-mismatch"
    || value === "epoch-mismatch"
    || value === "backpressure"
    || value === "aborted"
    || value === "disposed"
    || value === "simulation-failed"
    || value === "stale-epoch";
}

function boundaryReason(
  value: unknown,
): value is StudioPhysicsParticleWorkerBoundaryFailureReason {
  return value === "aborted"
    || value === "backpressure"
    || value === "disposed"
    || value === "execution-failed"
    || value === "invalid-message"
    || value === "invalid-result"
    || value === "operation-timeout"
    || value === "protocol-error"
    || value === "startup-timeout"
    || value === "worker-unavailable";
}

export function studioPhysicsParticleWorkerFailure(
  reason: StudioPhysicsParticleWorkerBoundaryFailureReason,
  detail: string,
  workerTerminated = false,
): StudioPhysicsParticleWorkerBoundaryFailure {
  return Object.freeze({
    status: "worker-failed",
    reason,
    detail: detail.slice(
      0,
      STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxFailureDetailCharacters,
    ),
    fallback: Object.freeze({
      kind: "studio-physics-particle-worker-only-receipt",
      execution: "dedicated-worker",
      mainThreadComputationFallback: false,
      workerTerminated,
      complete: false,
      reason,
    }),
  });
}

export function snapshotStudioPhysicsParticleWorkerResult(
  value: unknown,
): StudioPhysicsParticleWorkerResult | null {
  if (!plainRecord(value)) return null;
  if (value.status === "completed" && onlyKeys(value, ["status", "receipt"])) {
    const receipt = copyReceipt(value.receipt);
    return receipt
      ? Object.freeze({ status: "completed" as const, receipt })
      : null;
  }
  if (
    value.status === "rejected"
    && onlyKeys(value, ["status", "reason"])
    && rejectionReason(value.reason)
  ) return Object.freeze({ status: "rejected", reason: value.reason });
  if (value.status === "cancelled" && onlyKeys(value, ["status"])) {
    return Object.freeze({ status: "cancelled" });
  }
  if (
    value.status === "worker-failed"
    && onlyKeys(value, ["status", "reason", "detail", "fallback"])
    && boundaryReason(value.reason)
    && typeof value.detail === "string"
    && value.detail.length
      <= STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxFailureDetailCharacters
    && plainRecord(value.fallback)
    && value.fallback.kind === "studio-physics-particle-worker-only-receipt"
    && value.fallback.execution === "dedicated-worker"
    && value.fallback.mainThreadComputationFallback === false
    && typeof value.fallback.workerTerminated === "boolean"
    && value.fallback.complete === false
    && value.fallback.reason === value.reason
  ) {
    return studioPhysicsParticleWorkerFailure(
      value.reason,
      value.detail,
      value.fallback.workerTerminated,
    );
  }
  return null;
}

export function snapshotStudioPhysicsParticleWorkerInboundMessage(
  value: unknown,
): StudioPhysicsParticleWorkerInboundMessage | null {
  if (
    !plainRecord(value)
    || value.version !== STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) return null;
  if (
    value.type === "studio-physics-particle/execute"
    && onlyKeys(
      value,
      ["type", "version", "requestId", "workerSequence", "request"],
    )
    && positiveInteger(value.requestId)
    && positiveInteger(value.workerSequence)
  ) {
    const snapshot = snapshotStudioPhysicsParticleWorkerRequest(
      value.request,
    );
    if (!snapshot.ok) return null;
    return Object.freeze({
      type: "studio-physics-particle/execute",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
      workerSequence: value.workerSequence,
      request: snapshot.request,
    });
  }
  if (
    (
      value.type === "studio-physics-particle/cancel"
      || value.type === "studio-physics-particle/release"
    )
    && onlyKeys(value, ["type", "version", "requestId"])
    && positiveInteger(value.requestId)
  ) {
    return Object.freeze({
      type: value.type,
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  }
  if (
    value.type === "studio-physics-particle/advance-epoch"
    && onlyKeys(value, ["type", "version", "epoch"])
    && positiveInteger(value.epoch)
  ) {
    return Object.freeze({
      type: "studio-physics-particle/advance-epoch",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      epoch: value.epoch,
    });
  }
  return null;
}

export function snapshotStudioPhysicsParticleWorkerOutboundMessage(
  value: unknown,
): StudioPhysicsParticleWorkerOutboundMessage | null {
  if (
    !plainRecord(value)
    || value.version !== STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) return null;
  if (
    value.type === "studio-physics-particle/ready"
    && onlyKeys(value, ["type", "version", "epoch", "workerSequence"])
    && nonNegativeInteger(value.epoch)
    && value.workerSequence === 0
  ) {
    return Object.freeze({
      type: "studio-physics-particle/ready",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      epoch: value.epoch,
      workerSequence: 0,
    });
  }
  if (
    value.type === "studio-physics-particle/result"
    && onlyKeys(
      value,
      [
        "type",
        "version",
        "requestId",
        "requestEpoch",
        "workerSequence",
        "result",
      ],
    )
    && positiveInteger(value.requestId)
    && positiveInteger(value.requestEpoch)
    && positiveInteger(value.workerSequence)
  ) {
    const result = snapshotStudioPhysicsParticleWorkerResult(value.result);
    if (!result) return null;
    return Object.freeze({
      type: "studio-physics-particle/result",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
      requestEpoch: value.requestEpoch,
      workerSequence: value.workerSequence,
      result,
    });
  }
  return null;
}

export async function snapshotStudioPhysicsParticleWorkerOutboundMessageCooperatively(
  value: unknown,
  options: StudioPhysicsParticleWorkerSnapshotOptions = {},
): Promise<StudioPhysicsParticleWorkerOutboundMessage | null> {
  assertSnapshotCurrent(options);
  if (
    !plainRecord(value)
    || value.version !== STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) return null;
  if (value.type === "studio-physics-particle/ready") {
    return snapshotStudioPhysicsParticleWorkerOutboundMessage(value);
  }
  if (
    value.type === "studio-physics-particle/result"
    && plainRecord(value.result)
    && value.result.status === "completed"
    && plainRecord(value.result.receipt)
    && nonNegativeInteger(value.result.receipt.outputBytes)
    && value.result.receipt.outputBytes <= COOPERATIVE_COPY_BYTES
  ) {
    return snapshotStudioPhysicsParticleWorkerOutboundMessage(value);
  }
  if (
    value.type === "studio-physics-particle/result"
    && onlyKeys(
      value,
      [
        "type",
        "version",
        "requestId",
        "requestEpoch",
        "workerSequence",
        "result",
      ],
    )
    && positiveInteger(value.requestId)
    && positiveInteger(value.requestEpoch)
    && positiveInteger(value.workerSequence)
  ) {
    const result =
      await snapshotStudioPhysicsParticleWorkerResultCooperatively(
        value.result,
        options,
      );
    if (!result) return null;
    return Object.freeze({
      type: "studio-physics-particle/result",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
      requestEpoch: value.requestEpoch,
      workerSequence: value.workerSequence,
      result,
    });
  }
  return null;
}

export function studioPhysicsParticleWorkerResultTransfers(
  message: StudioPhysicsParticleWorkerResultMessage,
): Transferable[] {
  if (message.result.status !== "completed") return [];
  const artifact = message.result.receipt.artifact;
  return artifact ? artifactTransfers(artifact) : [];
}
