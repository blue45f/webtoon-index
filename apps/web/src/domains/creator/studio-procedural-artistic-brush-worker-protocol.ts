import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
  estimateStudioProceduralArtisticBrushRasterMemory,
  type StudioProceduralArtisticBrushArtifact,
  type StudioProceduralArtisticBrushFailureReason,
  type StudioProceduralArtisticBrushParameter,
  type StudioProceduralArtisticBrushReceipt,
  type StudioProceduralArtisticBrushResult,
  type StudioProceduralArtisticBrushSample,
} from "./studio-procedural-artistic-brush-provider";

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION =
  1 as const;

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_TECHNIQUES =
  Object.freeze([
    "flow-field",
    "hatch",
    "mass",
    "watercolor-fill",
    "flat-wash",
  ] as const);

export type StudioProceduralArtisticBrushWorkerTechnique =
  (typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_TECHNIQUES)[number];

export interface StudioProceduralArtisticBrushWorkerRequest {
  readonly kind: "studio-procedural-artistic-brush/request";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly stage: "settled";
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly plan: Readonly<{
    readonly technique: StudioProceduralArtisticBrushWorkerTechnique;
    readonly presetId: string;
    readonly samples: readonly StudioProceduralArtisticBrushSample[];
    readonly parameters: Readonly<
      Record<string, StudioProceduralArtisticBrushParameter>
    >;
  }>;
}

export interface StudioProceduralArtisticBrushWorkerRenderMessage {
  readonly type: "studio-procedural-artistic-brush/render";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioProceduralArtisticBrushWorkerRequest;
}

export interface StudioProceduralArtisticBrushWorkerCapabilityProbe {
  readonly workerScope: "DedicatedWorkerGlobalScope";
  readonly dedicatedWorker: true;
  readonly offscreenCanvas: true;
  readonly webgl2: true;
  readonly privateSurface: true;
  readonly mainThreadFallback: false;
  readonly webglVersion: string;
}

export interface StudioProceduralArtisticBrushWorkerReadyMessage {
  readonly type: "studio-procedural-artistic-brush/ready";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION;
  readonly probe: StudioProceduralArtisticBrushWorkerCapabilityProbe;
}

export type StudioProceduralArtisticBrushWorkerUnavailableReason =
  | "dedicated-worker-unavailable"
  | "offscreen-canvas-unavailable"
  | "webgl2-unavailable";

export interface StudioProceduralArtisticBrushWorkerUnavailableMessage {
  readonly type: "studio-procedural-artistic-brush/unavailable";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION;
  readonly reason: StudioProceduralArtisticBrushWorkerUnavailableReason;
  readonly detail: string;
}

export interface StudioProceduralArtisticBrushWorkerResultMessage {
  readonly type: "studio-procedural-artistic-brush/result";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly result: StudioProceduralArtisticBrushResult;
}

export type StudioProceduralArtisticBrushWorkerExecutionFailureReason =
  | "invalid-message"
  | "provider-creation-failed"
  | "execution-failed";

export interface StudioProceduralArtisticBrushWorkerFailureMessage {
  readonly type: "studio-procedural-artistic-brush/failure";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION;
  readonly requestId: number | null;
  readonly reason: StudioProceduralArtisticBrushWorkerExecutionFailureReason;
  readonly detail: string;
}

export type StudioProceduralArtisticBrushWorkerOutboundMessage =
  | StudioProceduralArtisticBrushWorkerReadyMessage
  | StudioProceduralArtisticBrushWorkerUnavailableMessage
  | StudioProceduralArtisticBrushWorkerResultMessage
  | StudioProceduralArtisticBrushWorkerFailureMessage;

const REQUEST_KEYS = Object.freeze([
  "kind",
  "version",
  "requestSequence",
  "engineEpoch",
  "strokeId",
  "stage",
  "seed",
  "width",
  "height",
  "pixelRatio",
  "plan",
]);
const PLAN_KEYS = Object.freeze([
  "technique",
  "presetId",
  "samples",
  "parameters",
]);
const SAMPLE_KEYS = Object.freeze([
  "x",
  "y",
  "pressure",
  "tiltX",
  "tiltY",
  "timeMilliseconds",
]);
const ARTIFACT_KEYS = Object.freeze([
  "kind",
  "version",
  "width",
  "height",
  "encoding",
  "colorSpace",
  "alpha",
  "pixels",
  "receipt",
]);
const RECEIPT_KEYS = Object.freeze([
  "kind",
  "version",
  "requestSequence",
  "engineEpoch",
  "strokeId",
  "seed",
  "technique",
  "presetId",
  "width",
  "height",
  "outputBytes",
  "inputFingerprint",
  "pixelHash",
  "replayFingerprint",
  "adapter",
  "execution",
  "authority",
  "capabilitiesUsed",
  "complete",
]);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const PRODUCT_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const WATERCOLOR_FILL_PARAMETER_KEYS = Object.freeze([
  "angle",
  "color",
  "density",
  "opacity",
  "strength",
]);
const FLAT_WASH_PARAMETER_KEYS = Object.freeze([
  "color",
  "opacity",
]);
const FAILURE_REASONS = new Set<StudioProceduralArtisticBrushFailureReason>([
  "invalid-options",
  "invalid-request",
  "live-stage-forbidden",
  "epoch-mismatch",
  "backpressure",
  "runtime-unavailable",
  "invalid-runtime-adapter",
  "unsupported-capability",
  "surface-unavailable",
  "invalid-surface",
  "adapter-failed",
  "invalid-adapter-output",
  "aborted",
  "disposed",
]);
const CAPABILITIES = new Set(STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES);

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: unknown,
  required: readonly string[],
): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === required.length
    && required.every((key) => Object.hasOwn(value, key))
  );
}

function positiveInteger(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function uint32(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 0xffff_ffff
  );
}

function safeIdentifier(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && IDENTIFIER_PATTERN.test(value)
  );
}

function boundedDetail(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= 512
  );
}

function snapshotSamples(
  value: unknown,
): readonly StudioProceduralArtisticBrushSample[] | null {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxSamples
  ) return null;
  const samples: StudioProceduralArtisticBrushSample[] = [];
  for (const candidate of value) {
    if (!exactKeys(candidate, SAMPLE_KEYS)) return null;
    const { x, y, pressure, tiltX, tiltY, timeMilliseconds } = candidate;
    if (
      !finite(x)
      || !finite(y)
      || !finite(pressure)
      || pressure < 0
      || pressure > 1
      || !finite(tiltX)
      || tiltX < -90
      || tiltX > 90
      || !finite(tiltY)
      || tiltY < -90
      || tiltY > 90
      || !finite(timeMilliseconds)
      || timeMilliseconds < 0
    ) return null;
    samples.push(Object.freeze({
      x,
      y,
      pressure,
      tiltX,
      tiltY,
      timeMilliseconds,
    }));
  }
  return Object.freeze(samples);
}

function snapshotParameters(
  value: unknown,
): Readonly<Record<string, StudioProceduralArtisticBrushParameter>> | null {
  if (!plainRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxParameters) {
    return null;
  }
  const parameters: Record<
    string,
    StudioProceduralArtisticBrushParameter
  > = Object.create(null) as Record<
    string,
    StudioProceduralArtisticBrushParameter
  >;
  for (const key of keys.sort()) {
    const parameter = value[key];
    if (
      !safeIdentifier(
        key,
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS
          .maxParameterNameCodeUnits,
      )
      || (
        typeof parameter !== "boolean"
        && !finite(parameter)
        && !(
          typeof parameter === "string"
          && parameter.length
            <= STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS
              .maxParameterStringCodeUnits
        )
      )
    ) return null;
    parameters[key] = parameter;
  }
  return Object.freeze(parameters);
}

function exactParameterKeys(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(parameters);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(parameters, key));
}

function validTechniqueParameters(
  technique: StudioProceduralArtisticBrushWorkerTechnique,
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
): boolean {
  if (technique === "watercolor-fill") {
    return exactParameterKeys(
      parameters,
      WATERCOLOR_FILL_PARAMETER_KEYS,
    )
      && typeof parameters.color === "string"
      && PRODUCT_COLOR_PATTERN.test(parameters.color)
      && finite(parameters.angle)
      && parameters.angle >= -Math.PI * 2
      && parameters.angle <= Math.PI * 2
      && finite(parameters.density)
      && parameters.density >= 0
      && parameters.density <= 1
      && finite(parameters.opacity)
      && parameters.opacity >= 0
      && parameters.opacity <= 1
      && finite(parameters.strength)
      && parameters.strength >= 0
      && parameters.strength <= 1;
  }
  if (technique === "flat-wash") {
    return exactParameterKeys(parameters, FLAT_WASH_PARAMETER_KEYS)
      && typeof parameters.color === "string"
      && PRODUCT_COLOR_PATTERN.test(parameters.color)
      && finite(parameters.opacity)
      && parameters.opacity >= 0.01
      && parameters.opacity <= 1;
  }
  return true;
}

function expectedFillPresetId(
  technique: StudioProceduralArtisticBrushWorkerTechnique,
): string | null {
  switch (technique) {
    case "watercolor-fill":
      return "studio-procedural-watercolor-fill-v1";
    case "flat-wash":
      return "studio-procedural-flat-wash-v1";
    default:
      return null;
  }
}

function techniqueCapability(
  technique: StudioProceduralArtisticBrushWorkerTechnique,
): StudioProceduralArtisticBrushReceipt["capabilitiesUsed"][number] {
  switch (technique) {
    case "flow-field":
      return "procedural:flow-field";
    case "hatch":
      return "procedural:hatch";
    case "mass":
      return "procedural:mass";
    case "watercolor-fill":
      return "procedural:watercolor-fill";
    case "flat-wash":
      return "procedural:flat-wash";
  }
}

function snapshotRequest(
  value: unknown,
): StudioProceduralArtisticBrushWorkerRequest | null {
  if (!exactKeys(value, REQUEST_KEYS)) return null;
  const {
    kind,
    version,
    requestSequence,
    engineEpoch,
    strokeId,
    stage,
    seed,
    width,
    height,
    pixelRatio,
    plan,
  } = value;
  if (
    kind !== "studio-procedural-artistic-brush/request"
    || version !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION
    || !positiveInteger(requestSequence)
    || !positiveInteger(engineEpoch)
    || !safeIdentifier(
      strokeId,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || stage !== "settled"
    || !uint32(seed)
    || estimateStudioProceduralArtisticBrushRasterMemory(
      width,
      height,
    ) === null
    || !finite(pixelRatio)
    || pixelRatio <= 0
    || pixelRatio > 16
    || !exactKeys(plan, PLAN_KEYS)
  ) return null;
  const { technique, presetId, samples, parameters } = plan;
  if (
    typeof technique !== "string"
    || !STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_TECHNIQUES.includes(
      technique as StudioProceduralArtisticBrushWorkerTechnique,
    )
    || !safeIdentifier(
      presetId,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
  ) return null;
  const normalizedTechnique =
    technique as StudioProceduralArtisticBrushWorkerTechnique;
  const normalizedSamples = snapshotSamples(samples);
  const normalizedParameters = snapshotParameters(parameters);
  const fillPresetId = expectedFillPresetId(normalizedTechnique);
  if (
    !normalizedSamples
    || !normalizedParameters
    || !validTechniqueParameters(
      normalizedTechnique,
      normalizedParameters,
    )
    || (
      fillPresetId !== null
      && presetId !== fillPresetId
    )
    || estimateStudioProceduralArtisticBrushRasterMemory(
      width,
      height,
      normalizedTechnique,
    ) === null
  ) return null;
  return Object.freeze({
    kind: "studio-procedural-artistic-brush/request",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
    requestSequence,
    engineEpoch,
    strokeId,
    stage: "settled",
    seed,
    width: width as number,
    height: height as number,
    pixelRatio,
    plan: Object.freeze({
      technique: normalizedTechnique,
      presetId,
      samples: normalizedSamples,
      parameters: normalizedParameters,
    }),
  });
}

export function snapshotStudioProceduralArtisticBrushWorkerRenderMessage(
  value: unknown,
): StudioProceduralArtisticBrushWorkerRenderMessage | null {
  if (
    !exactKeys(value, ["type", "version", "requestId", "request"])
    || value.type !== "studio-procedural-artistic-brush/render"
    || value.version
      !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION
    || !positiveInteger(value.requestId)
  ) return null;
  const request = snapshotRequest(value.request);
  if (!request) return null;
  return Object.freeze({
    type: "studio-procedural-artistic-brush/render",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    requestId: value.requestId,
    request,
  });
}

function snapshotCapabilities(
  value: unknown,
): readonly StudioProceduralArtisticBrushReceipt["capabilitiesUsed"][number][]
  | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const output: StudioProceduralArtisticBrushReceipt[
    "capabilitiesUsed"
  ][number][] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== "string"
      || !CAPABILITIES.has(
        candidate as StudioProceduralArtisticBrushReceipt[
          "capabilitiesUsed"
        ][number],
      )
      || seen.has(candidate)
    ) return null;
    seen.add(candidate);
    output.push(candidate as StudioProceduralArtisticBrushReceipt[
      "capabilitiesUsed"
    ][number]);
  }
  return Object.freeze(output);
}

function snapshotReceipt(
  value: unknown,
): StudioProceduralArtisticBrushReceipt | null {
  if (!exactKeys(value, RECEIPT_KEYS)) return null;
  const capabilitiesUsed = snapshotCapabilities(value.capabilitiesUsed);
  const technique =
    typeof value.technique === "string"
    && STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_TECHNIQUES.includes(
      value.technique as StudioProceduralArtisticBrushWorkerTechnique,
    )
      ? value.technique as StudioProceduralArtisticBrushWorkerTechnique
      : null;
  if (
    value.kind !== "studio-procedural-artistic-brush/receipt"
    || value.version !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION
    || !positiveInteger(value.requestSequence)
    || !positiveInteger(value.engineEpoch)
    || !safeIdentifier(
      value.strokeId,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || !uint32(value.seed)
    || technique === null
    || !safeIdentifier(
      value.presetId,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || !positiveInteger(value.width)
    || !positiveInteger(value.height)
    || !positiveInteger(value.outputBytes)
    || typeof value.inputFingerprint !== "string"
    || !HASH_PATTERN.test(value.inputFingerprint)
    || typeof value.pixelHash !== "string"
    || !HASH_PATTERN.test(value.pixelHash)
    || typeof value.replayFingerprint !== "string"
    || !HASH_PATTERN.test(value.replayFingerprint)
    || !exactKeys(value.adapter, ["id", "version", "compatibility"])
    || value.adapter.id !== "p5-brush-standalone-worker"
    || !safeIdentifier(
      value.adapter.version,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || value.adapter.compatibility !== "p5.brush/standalone"
    || !exactKeys(
      value.execution,
      [
        "stage",
        "locality",
        "surface",
        "backend",
        "mainThreadFallback",
      ],
    )
    || value.execution.stage !== "settled"
    || value.execution.locality !== "dedicated-worker"
    || value.execution.surface !== "offscreen-canvas-webgl2"
    || value.execution.backend !== "webgl2"
    || value.execution.mainThreadFallback !== false
    || !exactKeys(
      value.authority,
      ["mainScene", "document", "history", "persistence", "output"],
    )
    || value.authority.mainScene !== false
    || value.authority.document !== false
    || value.authority.history !== false
    || value.authority.persistence !== false
    || value.authority.output !== "settled-raster-suggestion"
    || !capabilitiesUsed
    || !capabilitiesUsed.includes(techniqueCapability(technique))
    || (
      expectedFillPresetId(technique) !== null
      && value.presetId !== expectedFillPresetId(technique)
    )
    || value.complete !== true
  ) return null;
  return Object.freeze({
    kind: "studio-procedural-artistic-brush/receipt",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    strokeId: value.strokeId,
    seed: value.seed,
    technique,
    presetId: value.presetId,
    width: value.width,
    height: value.height,
    outputBytes: value.outputBytes,
    inputFingerprint:
      value.inputFingerprint as `sha256:${string}`,
    pixelHash: value.pixelHash as `sha256:${string}`,
    replayFingerprint:
      value.replayFingerprint as `sha256:${string}`,
    adapter: Object.freeze({
      id: "p5-brush-standalone-worker",
      version: value.adapter.version,
      compatibility: "p5.brush/standalone",
    }),
    execution: Object.freeze({
      stage: "settled",
      locality: "dedicated-worker",
      surface: "offscreen-canvas-webgl2",
      backend: "webgl2",
      mainThreadFallback: false,
    }),
    authority: Object.freeze({
      mainScene: false,
      document: false,
      history: false,
      persistence: false,
      output: "settled-raster-suggestion",
    }),
    capabilitiesUsed,
    complete: true,
  });
}

function snapshotArtifact(
  value: unknown,
): StudioProceduralArtisticBrushArtifact | null {
  if (
    !exactKeys(value, ARTIFACT_KEYS)
    || value.kind !== "studio-procedural-artistic-brush/artifact"
    || value.version !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION
    || !positiveInteger(value.width)
    || !positiveInteger(value.height)
    || value.encoding !== "rgba8-unorm"
    || value.colorSpace !== "srgb"
    || value.alpha !== "straight"
    || !(value.pixels instanceof Uint8ClampedArray)
    || value.pixels.byteOffset !== 0
    || value.pixels.byteLength !== value.pixels.buffer.byteLength
  ) return null;
  const receipt = snapshotReceipt(value.receipt);
  const expected = receipt
    ? estimateStudioProceduralArtisticBrushRasterMemory(
        value.width,
        value.height,
        receipt.technique,
      )
    : null;
  if (
    !expected
    || value.pixels.byteLength !== expected.outputBytes
    || !receipt
    || receipt.width !== value.width
    || receipt.height !== value.height
    || receipt.outputBytes !== value.pixels.byteLength
  ) return null;
  return Object.freeze({
    kind: "studio-procedural-artistic-brush/artifact",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
    width: value.width,
    height: value.height,
    encoding: "rgba8-unorm",
    colorSpace: "srgb",
    alpha: "straight",
    pixels: value.pixels,
    receipt,
  });
}

function snapshotResult(
  value: unknown,
): StudioProceduralArtisticBrushResult | null {
  if (!plainRecord(value) || value.consumed !== false) return null;
  if (value.status === "rejected") {
    if (
      !exactKeys(value, ["status", "consumed", "reason", "detail"])
      || typeof value.reason !== "string"
      || !FAILURE_REASONS.has(
        value.reason as StudioProceduralArtisticBrushFailureReason,
      )
      || !boundedDetail(value.detail)
    ) return null;
    return Object.freeze({
      status: "rejected",
      consumed: false,
      reason: value.reason as StudioProceduralArtisticBrushFailureReason,
      detail: value.detail,
    });
  }
  if (
    value.status !== "completed"
    || !exactKeys(value, ["status", "consumed", "artifact"])
  ) return null;
  const artifact = snapshotArtifact(value.artifact);
  if (!artifact) return null;
  return Object.freeze({
    status: "completed",
    consumed: false,
    artifact,
  });
}

function snapshotProbe(
  value: unknown,
): StudioProceduralArtisticBrushWorkerCapabilityProbe | null {
  if (
    !exactKeys(
      value,
      [
        "workerScope",
        "dedicatedWorker",
        "offscreenCanvas",
        "webgl2",
        "privateSurface",
        "mainThreadFallback",
        "webglVersion",
      ],
    )
    || value.workerScope !== "DedicatedWorkerGlobalScope"
    || value.dedicatedWorker !== true
    || value.offscreenCanvas !== true
    || value.webgl2 !== true
    || value.privateSurface !== true
    || value.mainThreadFallback !== false
    || typeof value.webglVersion !== "string"
    || value.webglVersion.length === 0
    || value.webglVersion.length > 160
  ) return null;
  return Object.freeze({
    workerScope: "DedicatedWorkerGlobalScope",
    dedicatedWorker: true,
    offscreenCanvas: true,
    webgl2: true,
    privateSurface: true,
    mainThreadFallback: false,
    webglVersion: value.webglVersion,
  });
}

export function snapshotStudioProceduralArtisticBrushWorkerOutboundMessage(
  value: unknown,
): StudioProceduralArtisticBrushWorkerOutboundMessage | null {
  if (
    !plainRecord(value)
    || value.version
      !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION
  ) return null;
  if (value.type === "studio-procedural-artistic-brush/ready") {
    if (!exactKeys(value, ["type", "version", "probe"])) return null;
    const probe = snapshotProbe(value.probe);
    return probe
      ? Object.freeze({
          type: "studio-procedural-artistic-brush/ready",
          version:
            STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
          probe,
        })
      : null;
  }
  if (value.type === "studio-procedural-artistic-brush/unavailable") {
    if (
      !exactKeys(value, ["type", "version", "reason", "detail"])
      || (
        value.reason !== "dedicated-worker-unavailable"
        && value.reason !== "offscreen-canvas-unavailable"
        && value.reason !== "webgl2-unavailable"
      )
      || !boundedDetail(value.detail)
    ) return null;
    return Object.freeze({
      type: "studio-procedural-artistic-brush/unavailable",
      version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
      reason: value.reason,
      detail: value.detail,
    });
  }
  if (value.type === "studio-procedural-artistic-brush/failure") {
    if (
      !exactKeys(
        value,
        ["type", "version", "requestId", "reason", "detail"],
      )
      || (
        value.requestId !== null
        && !positiveInteger(value.requestId)
      )
      || (
        value.reason !== "invalid-message"
        && value.reason !== "provider-creation-failed"
        && value.reason !== "execution-failed"
      )
      || !boundedDetail(value.detail)
    ) return null;
    return Object.freeze({
      type: "studio-procedural-artistic-brush/failure",
      version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
      reason: value.reason,
      detail: value.detail,
    });
  }
  if (
    value.type !== "studio-procedural-artistic-brush/result"
    || !exactKeys(
      value,
      [
        "type",
        "version",
        "requestId",
        "requestSequence",
        "engineEpoch",
        "result",
      ],
    )
    || !positiveInteger(value.requestId)
    || !positiveInteger(value.requestSequence)
    || !positiveInteger(value.engineEpoch)
  ) return null;
  const result = snapshotResult(value.result);
  if (!result) return null;
  return Object.freeze({
    type: "studio-procedural-artistic-brush/result",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    requestId: value.requestId,
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    result,
  });
}

export function studioProceduralArtisticBrushWorkerResultTransfers(
  message: StudioProceduralArtisticBrushWorkerResultMessage,
): Transferable[] {
  if (message.result.status !== "completed") return [];
  const { pixels } = message.result.artifact;
  if (
    !(pixels.buffer instanceof ArrayBuffer)
    || pixels.byteOffset !== 0
    || pixels.byteLength !== pixels.buffer.byteLength
  ) return [];
  return [pixels.buffer];
}
