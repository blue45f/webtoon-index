/**
 * Strict, transport-neutral contract for speculative Studio gesture previews.
 *
 * The payload is intentionally separate from cursor presence and from the durable CRDT document.
 * It carries only the bounded renderer inputs needed to draw a disposable preview. Raster bytes,
 * URLs, arbitrary renderer extensions, document text, and asset payloads are never admitted.
 */

export const STUDIO_LIVE_GESTURE_PREVIEW_VERSION = 1 as const;
export const STUDIO_LIVE_GESTURE_PREVIEW_KIND = "preview:gesture" as const;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES = 64 * 1_024;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE = 512;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE = 100_000;

export const STUDIO_LIVE_GESTURE_PREVIEW_PHASES = [
  "begin",
  "append",
  "replace",
  "end",
  "cancel",
] as const;

export const STUDIO_LIVE_GESTURE_PREVIEW_OPERATIONS = [
  "draw",
  "erase",
  "shape",
  "lasso-fill",
  "retouch",
] as const;

export const STUDIO_LIVE_GESTURE_PREVIEW_DRAW_KINDS = [
  "freehand",
  "line",
  "rect",
  "ellipse",
  "star",
  "arrow",
  "triangle",
  "polygon",
] as const;

export const STUDIO_LIVE_GESTURE_PREVIEW_SHAPE_KINDS = [
  "line",
  "rect",
  "ellipse",
  "star",
  "arrow",
  "triangle",
  "polygon",
] as const;

export const STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES = [
  "normal",
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export const STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS = [
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
  "altitudeAngles",
  "azimuthAngles",
  "contactWidths",
  "contactHeights",
  "sampleTimeOffsets",
] as const;

export const STUDIO_LIVE_GESTURE_PREVIEW_LIMITS = Object.freeze({
  identifierLength: 160,
  rendererTextLength: 160,
  colorLength: 64,
  coordinateMagnitude: 10_000_000,
  strokeWidth: 8_192,
  sampleSpacing: 8_192,
  speed: 1_000_000,
  contactSize: 8_192,
  sampleTimeOffsetMs: 600_000,
  retouchRadiusNorm: 4,
  brushSeed: 0xffff_ffff,
} as const);

export type StudioLiveGesturePreviewPhase =
  (typeof STUDIO_LIVE_GESTURE_PREVIEW_PHASES)[number];
export type StudioLiveGesturePreviewOperation =
  (typeof STUDIO_LIVE_GESTURE_PREVIEW_OPERATIONS)[number];
export type StudioLiveGesturePreviewDrawKind =
  (typeof STUDIO_LIVE_GESTURE_PREVIEW_DRAW_KINDS)[number];
export type StudioLiveGesturePreviewShapeKind =
  (typeof STUDIO_LIVE_GESTURE_PREVIEW_SHAPE_KINDS)[number];
export type StudioLiveGesturePreviewBlendMode =
  (typeof STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES)[number];
export type StudioLiveGesturePreviewSampleChannelKey =
  (typeof STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS)[number];

export interface StudioLiveGesturePreviewBase {
  readonly documentGeneration: number;
  readonly targetElementId?: string;
  readonly targetRevision?: string;
}

export interface StudioLiveGesturePreviewBrushTip {
  readonly tiltEnabled: boolean;
  readonly angleDeg: number;
  readonly roundness: number;
}

export interface StudioLiveGesturePreviewStrokeStyle {
  readonly dash: "solid" | "dash" | "longDash" | "dot" | "dashDot" | "sparse";
  readonly lineCap: "butt" | "round" | "square";
  readonly arrowStart: "none" | "arrow" | "dot";
  readonly arrowEnd: "none" | "arrow" | "dot";
}

export interface StudioLiveGesturePreviewShapeParams {
  readonly starPoints: number;
  readonly starInnerRatio: number;
  readonly polygonSides: number;
  readonly cornerRadius: number;
}

export interface StudioLiveGesturePreviewSketch {
  readonly enabled: boolean;
  readonly roughness: number;
  readonly bowing: number;
  readonly fillStyle: "hachure" | "solid" | "cross-hatch" | "zigzag";
}

export interface StudioLiveGesturePreviewSymmetry {
  readonly type: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
  readonly centerX: number;
  readonly centerY: number;
  readonly radialCount?: number;
}

/**
 * V1 deliberately admits only the stable routing subset of brush dynamics. Custom alpha maps,
 * grain assets, arbitrary engine programs, and extension dictionaries stay on the deterministic
 * retained fallback until a separately versioned contract can validate them field-by-field.
 */
export interface StudioLiveGesturePreviewBrushDynamics {
  readonly version: 1;
  readonly presetId: "ink-particle" | "airbrush" | "dry-media";
  readonly seed: number;
  readonly fallbackPressure: number;
  readonly minimumDiameterRatio?: number;
  readonly spacingRatio?: number | null;
  readonly scatterRatio?: number | null;
}

export interface StudioLiveGesturePreviewRendererSnapshot {
  readonly kind: StudioLiveGesturePreviewDrawKind;
  readonly mode: "pen" | "eraser";
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly opacity?: number;
  readonly fill?: string;
  readonly brush?: string;
  readonly brushCatalogId?: string;
  readonly brushCatalogName?: string;
  readonly sampleSpacing?: number;
  readonly blendMode?: StudioLiveGesturePreviewBlendMode;
  readonly paintModel?: "layered-flow-v1" | "bounded-flow-v2";
  readonly pressureModel?:
    | "linear-full-v1"
    | "linear-residual-v2"
    | "linear-residual-path-v3";
  readonly materialPressureModel?: "canonical-material-v1";
  readonly materialMinimumDiameterRatio?: number;
  readonly watercolorPipeline?: "causal-walker-v2";
  readonly stampPipeline?: "causal-walker-v2";
  readonly brushTip?: StudioLiveGesturePreviewBrushTip;
  readonly strokeStyle?: StudioLiveGesturePreviewStrokeStyle;
  readonly shapeParams?: StudioLiveGesturePreviewShapeParams;
  readonly sketch?: StudioLiveGesturePreviewSketch;
  readonly symmetry?: StudioLiveGesturePreviewSymmetry;
  readonly brushDynamics?: StudioLiveGesturePreviewBrushDynamics;
}

export interface StudioLiveGesturePreviewSamples {
  readonly startIndex: number;
  /** Flattened document coordinates: [x0, y0, x1, y1, ...]. */
  readonly points: readonly number[];
  readonly pressures?: readonly number[];
  readonly tiltXs?: readonly number[];
  readonly tiltYs?: readonly number[];
  readonly twists?: readonly number[];
  readonly speeds?: readonly number[];
  readonly tangentialPressures?: readonly number[];
  readonly altitudeAngles?: readonly number[];
  readonly azimuthAngles?: readonly number[];
  readonly contactWidths?: readonly number[];
  readonly contactHeights?: readonly number[];
  readonly sampleTimeOffsets?: readonly number[];
}

export interface StudioLiveGesturePreviewShape {
  readonly kind: StudioLiveGesturePreviewShapeKind;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface StudioLiveGesturePreviewRetouch {
  readonly tool: "smudge";
  readonly startIndex: number;
  /** Flattened target-local normalized coordinates. */
  readonly points: readonly number[];
  readonly radiusNorm: number;
  readonly strength: number;
}

export interface StudioLiveGesturePreviewPayload {
  readonly version: typeof STUDIO_LIVE_GESTURE_PREVIEW_VERSION;
  /** Reuses the durable CRDT stroke id for draw/erase/shape/lasso gestures. */
  readonly gestureId: string;
  readonly pageId: string;
  /** Sender-generated gesture-local sequence. Begin is 1; every later packet is exactly +1. */
  readonly seq: number;
  readonly phase: StudioLiveGesturePreviewPhase;
  readonly operation: StudioLiveGesturePreviewOperation;
  readonly base?: StudioLiveGesturePreviewBase;
  readonly renderer?: StudioLiveGesturePreviewRendererSnapshot;
  readonly samples?: StudioLiveGesturePreviewSamples;
  readonly shape?: StudioLiveGesturePreviewShape;
  readonly retouch?: StudioLiveGesturePreviewRetouch;
}

export class StudioLiveGesturePreviewError extends Error {
  constructor(message = "유효하지 않은 실시간 제스처 미리보기입니다.") {
    super(message);
    this.name = "StudioLiveGesturePreviewError";
  }
}

type PlainRecord = Record<string, unknown>;

const PHASE_SET: ReadonlySet<string> = new Set(STUDIO_LIVE_GESTURE_PREVIEW_PHASES);
const OPERATION_SET: ReadonlySet<string> = new Set(STUDIO_LIVE_GESTURE_PREVIEW_OPERATIONS);
const DRAW_KIND_SET: ReadonlySet<string> = new Set(STUDIO_LIVE_GESTURE_PREVIEW_DRAW_KINDS);
const SHAPE_KIND_SET: ReadonlySet<string> = new Set(STUDIO_LIVE_GESTURE_PREVIEW_SHAPE_KINDS);
const BLEND_MODE_SET: ReadonlySet<string> = new Set(STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES);
const FORBIDDEN_RESOURCE_STRING = /(?:\b(?:https?|data|blob|file|javascript):|url\s*\()/iu;

const PAYLOAD_KEYS = new Set([
  "version",
  "gestureId",
  "pageId",
  "seq",
  "phase",
  "operation",
  "base",
  "renderer",
  "samples",
  "shape",
  "retouch",
]);
const BASE_KEYS = new Set(["documentGeneration", "targetElementId", "targetRevision"]);
const RENDERER_KEYS = new Set([
  "kind",
  "mode",
  "stroke",
  "strokeWidth",
  "opacity",
  "fill",
  "brush",
  "brushCatalogId",
  "brushCatalogName",
  "sampleSpacing",
  "blendMode",
  "paintModel",
  "pressureModel",
  "materialPressureModel",
  "materialMinimumDiameterRatio",
  "watercolorPipeline",
  "stampPipeline",
  "brushTip",
  "strokeStyle",
  "shapeParams",
  "sketch",
  "symmetry",
  "brushDynamics",
]);
const SAMPLE_KEYS = new Set([
  "startIndex",
  "points",
  ...STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS,
]);
const SHAPE_KEYS = new Set(["kind", "x0", "y0", "x1", "y1"]);
const RETOUCH_KEYS = new Set(["tool", "startIndex", "points", "radiusNorm", "strength"]);
const BRUSH_TIP_KEYS = new Set(["tiltEnabled", "angleDeg", "roundness"]);
const STROKE_STYLE_KEYS = new Set(["dash", "lineCap", "arrowStart", "arrowEnd"]);
const SHAPE_PARAM_KEYS = new Set([
  "starPoints",
  "starInnerRatio",
  "polygonSides",
  "cornerRadius",
]);
const SKETCH_KEYS = new Set(["enabled", "roughness", "bowing", "fillStyle"]);
const SYMMETRY_KEYS = new Set(["type", "centerX", "centerY", "radialCount"]);
const BRUSH_DYNAMICS_KEYS = new Set([
  "version",
  "presetId",
  "seed",
  "fallbackPressure",
  "minimumDiameterRatio",
  "spacingRatio",
  "scatterRatio",
]);

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: PlainRecord,
  required: readonly string[],
  allowed: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 0x1f || (point >= 0x7f && point <= 0x9f)) return true;
  }
  return false;
}

function isSafeString(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value === value.trim()
    && !containsControlCharacter(value)
    && !FORBIDDEN_RESOURCE_STRING.test(value);
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function isSafeIntegerRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isFiniteArray(
  value: unknown,
  expectedLength: number,
  minimum: number,
  maximum: number,
): value is number[] {
  if (!Array.isArray(value) || value.length !== expectedLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!isFiniteRange(value[index], minimum, maximum)) return false;
  }
  return true;
}

function isMonotonic(values: readonly number[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! < values[index - 1]!) return false;
  }
  return true;
}

function isBase(value: unknown): value is StudioLiveGesturePreviewBase {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["documentGeneration"], BASE_KEYS)) {
    return false;
  }
  if (!isSafeIntegerRange(value.documentGeneration, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (
    Object.hasOwn(value, "targetElementId")
    && !isSafeString(value.targetElementId, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.identifierLength)
  ) return false;
  if (
    Object.hasOwn(value, "targetRevision")
    && !isSafeString(value.targetRevision, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.identifierLength)
  ) return false;
  return true;
}

function isBrushTip(value: unknown): value is StudioLiveGesturePreviewBrushTip {
  return isPlainRecord(value)
    && hasExactKeys(value, ["tiltEnabled", "angleDeg", "roundness"], BRUSH_TIP_KEYS)
    && typeof value.tiltEnabled === "boolean"
    && isFiniteRange(value.angleDeg, -360, 360)
    && isFiniteRange(value.roundness, 0.01, 1);
}

function isStrokeStyle(value: unknown): value is StudioLiveGesturePreviewStrokeStyle {
  return isPlainRecord(value)
    && hasExactKeys(
      value,
      ["dash", "lineCap", "arrowStart", "arrowEnd"],
      STROKE_STYLE_KEYS,
    )
    && ["solid", "dash", "longDash", "dot", "dashDot", "sparse"].includes(
      value.dash as string,
    )
    && ["butt", "round", "square"].includes(value.lineCap as string)
    && ["none", "arrow", "dot"].includes(value.arrowStart as string)
    && ["none", "arrow", "dot"].includes(value.arrowEnd as string);
}

function isShapeParams(value: unknown): value is StudioLiveGesturePreviewShapeParams {
  return isPlainRecord(value)
    && hasExactKeys(
      value,
      ["starPoints", "starInnerRatio", "polygonSides", "cornerRadius"],
      SHAPE_PARAM_KEYS,
    )
    && isSafeIntegerRange(value.starPoints, 3, 12)
    && isFiniteRange(value.starInnerRatio, 0.1, 0.9)
    && isSafeIntegerRange(value.polygonSides, 3, 12)
    && isFiniteRange(value.cornerRadius, 0, 120);
}

function isSketch(value: unknown): value is StudioLiveGesturePreviewSketch {
  return isPlainRecord(value)
    && hasExactKeys(value, ["enabled", "roughness", "bowing", "fillStyle"], SKETCH_KEYS)
    && typeof value.enabled === "boolean"
    && isFiniteRange(value.roughness, 0.5, 3)
    && isFiniteRange(value.bowing, 0, 6)
    && ["hachure", "solid", "cross-hatch", "zigzag"].includes(value.fillStyle as string);
}

function isSymmetry(value: unknown): value is StudioLiveGesturePreviewSymmetry {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["type", "centerX", "centerY"], SYMMETRY_KEYS)
    || !["none", "vertical", "horizontal", "radial", "kaleidoscope", "silk"].includes(
      value.type as string,
    )
    || !isFiniteRange(
      value.centerX,
      -STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
      STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
    )
    || !isFiniteRange(
      value.centerY,
      -STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
      STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
    )
  ) return false;
  const radial = value.type === "radial" || value.type === "kaleidoscope" || value.type === "silk";
  if (radial) return isSafeIntegerRange(value.radialCount, 1, 32);
  return !Object.hasOwn(value, "radialCount");
}

function isBrushDynamics(value: unknown): value is StudioLiveGesturePreviewBrushDynamics {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(
      value,
      ["version", "presetId", "seed", "fallbackPressure"],
      BRUSH_DYNAMICS_KEYS,
    )
    || value.version !== 1
    || !["ink-particle", "airbrush", "dry-media"].includes(value.presetId as string)
    || !isSafeIntegerRange(value.seed, 0, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.brushSeed)
    || !isFiniteRange(value.fallbackPressure, 0, 1)
  ) return false;
  if (
    Object.hasOwn(value, "minimumDiameterRatio")
    && !isFiniteRange(value.minimumDiameterRatio, 0, 1)
  ) return false;
  if (
    Object.hasOwn(value, "spacingRatio")
    && value.spacingRatio !== null
    && !isFiniteRange(value.spacingRatio, 0.01, 16)
  ) return false;
  if (
    Object.hasOwn(value, "scatterRatio")
    && value.scatterRatio !== null
    && !isFiniteRange(value.scatterRatio, 0, 16)
  ) return false;
  return true;
}

function isRenderer(value: unknown): value is StudioLiveGesturePreviewRendererSnapshot {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["kind", "mode", "stroke", "strokeWidth"], RENDERER_KEYS)
    || typeof value.kind !== "string"
    || !DRAW_KIND_SET.has(value.kind)
    || (value.mode !== "pen" && value.mode !== "eraser")
    || !isSafeString(value.stroke, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.colorLength)
    || !isFiniteRange(value.strokeWidth, Number.EPSILON, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.strokeWidth)
  ) return false;
  if (Object.hasOwn(value, "opacity") && !isFiniteRange(value.opacity, 0, 1)) return false;
  if (
    Object.hasOwn(value, "fill")
    && !isSafeString(value.fill, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.colorLength)
  ) return false;
  for (const key of ["brush", "brushCatalogId"] as const) {
    if (
      Object.hasOwn(value, key)
      && !isSafeString(value[key], STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.identifierLength)
    ) return false;
  }
  if (
    Object.hasOwn(value, "brushCatalogName")
    && !isSafeString(value.brushCatalogName, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.rendererTextLength)
  ) return false;
  if (
    Object.hasOwn(value, "sampleSpacing")
    && !isFiniteRange(value.sampleSpacing, 0, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.sampleSpacing)
  ) return false;
  if (
    Object.hasOwn(value, "blendMode")
    && (typeof value.blendMode !== "string" || !BLEND_MODE_SET.has(value.blendMode))
  ) return false;
  if (
    Object.hasOwn(value, "paintModel")
    && value.paintModel !== "layered-flow-v1"
    && value.paintModel !== "bounded-flow-v2"
  ) return false;
  if (
    Object.hasOwn(value, "pressureModel")
    && value.pressureModel !== "linear-full-v1"
    && value.pressureModel !== "linear-residual-v2"
    && value.pressureModel !== "linear-residual-path-v3"
  ) return false;
  if (
    Object.hasOwn(value, "materialPressureModel")
    && value.materialPressureModel !== "canonical-material-v1"
  ) return false;
  if (
    Object.hasOwn(value, "materialMinimumDiameterRatio")
    && !isFiniteRange(value.materialMinimumDiameterRatio, 0, 1)
  ) return false;
  if (
    Object.hasOwn(value, "watercolorPipeline")
    && value.watercolorPipeline !== "causal-walker-v2"
  ) return false;
  if (
    Object.hasOwn(value, "stampPipeline")
    && value.stampPipeline !== "causal-walker-v2"
  ) return false;
  if (Object.hasOwn(value, "brushTip") && !isBrushTip(value.brushTip)) return false;
  if (Object.hasOwn(value, "strokeStyle") && !isStrokeStyle(value.strokeStyle)) return false;
  if (Object.hasOwn(value, "shapeParams") && !isShapeParams(value.shapeParams)) return false;
  if (Object.hasOwn(value, "sketch") && !isSketch(value.sketch)) return false;
  if (Object.hasOwn(value, "symmetry") && !isSymmetry(value.symmetry)) return false;
  if (Object.hasOwn(value, "brushDynamics") && !isBrushDynamics(value.brushDynamics)) return false;
  return true;
}

function isSamples(value: unknown): value is StudioLiveGesturePreviewSamples {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["startIndex", "points"], SAMPLE_KEYS)
    || !isSafeIntegerRange(
      value.startIndex,
      0,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
    )
    || !Array.isArray(value.points)
    || value.points.length < 2
    || value.points.length % 2 !== 0
  ) return false;
  const sampleCount = value.points.length / 2;
  if (sampleCount > STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE) return false;
  if (value.startIndex + sampleCount > STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE) {
    return false;
  }
  if (
    !isFiniteArray(
      value.points,
      value.points.length,
      -STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
      STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
    )
  ) return false;

  const ranges: Record<StudioLiveGesturePreviewSampleChannelKey, readonly [number, number]> = {
    pressures: [0, 1],
    tiltXs: [-90, 90],
    tiltYs: [-90, 90],
    twists: [0, 359],
    speeds: [0, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.speed],
    tangentialPressures: [-1, 1],
    altitudeAngles: [0, Math.PI / 2],
    azimuthAngles: [0, Math.PI * 2],
    contactWidths: [0, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.contactSize],
    contactHeights: [0, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.contactSize],
    sampleTimeOffsets: [0, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.sampleTimeOffsetMs],
  };
  for (const key of STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const [minimum, maximum] = ranges[key];
    if (!isFiniteArray(value[key], sampleCount, minimum, maximum)) return false;
  }
  const sampleTimeOffsets = value.sampleTimeOffsets;
  return sampleTimeOffsets === undefined
    || (Array.isArray(sampleTimeOffsets) && isMonotonic(sampleTimeOffsets));
}

function isShape(value: unknown): value is StudioLiveGesturePreviewShape {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["kind", "x0", "y0", "x1", "y1"], SHAPE_KEYS)
    || typeof value.kind !== "string"
    || !SHAPE_KIND_SET.has(value.kind)
  ) return false;
  return [value.x0, value.y0, value.x1, value.y1].every((coordinate) =>
    isFiniteRange(
      coordinate,
      -STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
      STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.coordinateMagnitude,
    ));
}

function isRetouch(value: unknown): value is StudioLiveGesturePreviewRetouch {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(
      value,
      ["tool", "startIndex", "points", "radiusNorm", "strength"],
      RETOUCH_KEYS,
    )
    || value.tool !== "smudge"
    || !isSafeIntegerRange(
      value.startIndex,
      0,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
    )
    || !Array.isArray(value.points)
    || value.points.length < 2
    || value.points.length % 2 !== 0
  ) return false;
  const sampleCount = value.points.length / 2;
  return sampleCount <= STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE
    && value.startIndex + sampleCount <= STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE
    && isFiniteArray(value.points, value.points.length, 0, 1)
    && isFiniteRange(
      value.radiusNorm,
      Number.EPSILON,
      STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.retouchRadiusNorm,
    )
    && isFiniteRange(value.strength, 0, 1);
}

function rendererMatchesOperation(
  renderer: StudioLiveGesturePreviewRendererSnapshot,
  operation: StudioLiveGesturePreviewOperation,
  shape?: StudioLiveGesturePreviewShape,
): boolean {
  switch (operation) {
    case "draw":
      return renderer.kind === "freehand" && renderer.mode === "pen" && renderer.fill === undefined;
    case "erase":
      return renderer.kind === "freehand" && renderer.mode === "eraser" && renderer.fill === undefined;
    case "lasso-fill":
      return renderer.kind === "freehand" && renderer.mode === "pen" && renderer.fill !== undefined;
    case "shape":
      return renderer.kind !== "freehand"
        && renderer.mode === "pen"
        && shape?.kind === renderer.kind;
    case "retouch":
      return false;
  }
}

function payloadFieldsMatchPhase(value: PlainRecord): boolean {
  const phase = value.phase as StudioLiveGesturePreviewPhase;
  const operation = value.operation as StudioLiveGesturePreviewOperation;
  const base = value.base as StudioLiveGesturePreviewBase | undefined;
  const renderer = value.renderer as StudioLiveGesturePreviewRendererSnapshot | undefined;
  const samples = value.samples as StudioLiveGesturePreviewSamples | undefined;
  const shape = value.shape as StudioLiveGesturePreviewShape | undefined;
  const retouch = value.retouch as StudioLiveGesturePreviewRetouch | undefined;

  switch (phase) {
    case "begin":
      if (value.seq !== 1) return false;
      if (operation === "retouch") {
        return Boolean(
          base?.targetElementId
          && base.targetRevision
          && retouch
          && retouch.startIndex === 0
          && renderer === undefined
          && samples === undefined
          && shape === undefined,
        );
      }
      if (!renderer || !rendererMatchesOperation(renderer, operation, shape)) return false;
      if (operation === "shape") {
        return shape !== undefined && samples === undefined && retouch === undefined;
      }
      return samples !== undefined
        && samples.startIndex === 0
        && shape === undefined
        && retouch === undefined;
    case "append":
      if (base !== undefined || renderer !== undefined || shape !== undefined) return false;
      if (operation === "retouch") return retouch !== undefined && samples === undefined;
      return operation !== "shape" && samples !== undefined && retouch === undefined;
    case "replace":
      return operation === "shape"
        && base === undefined
        && renderer === undefined
        && samples === undefined
        && shape !== undefined
        && retouch === undefined;
    case "end":
    case "cancel":
      return base === undefined
        && renderer === undefined
        && samples === undefined
        && shape === undefined
        && retouch === undefined;
  }
}

function serializedByteLength(value: StudioLiveGesturePreviewPayload): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

export function isStudioLiveGesturePreviewPayload(
  value: unknown,
): value is StudioLiveGesturePreviewPayload {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(
      value,
      ["version", "gestureId", "pageId", "seq", "phase", "operation"],
      PAYLOAD_KEYS,
    )
    || value.version !== STUDIO_LIVE_GESTURE_PREVIEW_VERSION
    || !isSafeString(value.gestureId, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.identifierLength)
    || !isSafeString(value.pageId, STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.identifierLength)
    || !isSafeIntegerRange(value.seq, 1, Number.MAX_SAFE_INTEGER)
    || typeof value.phase !== "string"
    || !PHASE_SET.has(value.phase)
    || typeof value.operation !== "string"
    || !OPERATION_SET.has(value.operation)
  ) return false;
  if (Object.hasOwn(value, "base") && !isBase(value.base)) return false;
  if (Object.hasOwn(value, "renderer") && !isRenderer(value.renderer)) return false;
  if (Object.hasOwn(value, "samples") && !isSamples(value.samples)) return false;
  if (Object.hasOwn(value, "shape") && !isShape(value.shape)) return false;
  if (Object.hasOwn(value, "retouch") && !isRetouch(value.retouch)) return false;
  if (!payloadFieldsMatchPhase(value)) return false;
  const bytes = serializedByteLength(value as unknown as StudioLiveGesturePreviewPayload);
  return bytes !== null && bytes <= STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES;
}

function copySamples(
  samples: StudioLiveGesturePreviewSamples,
): StudioLiveGesturePreviewSamples {
  return {
    startIndex: samples.startIndex,
    points: [...samples.points],
    ...(samples.pressures ? { pressures: [...samples.pressures] } : {}),
    ...(samples.tiltXs ? { tiltXs: [...samples.tiltXs] } : {}),
    ...(samples.tiltYs ? { tiltYs: [...samples.tiltYs] } : {}),
    ...(samples.twists ? { twists: [...samples.twists] } : {}),
    ...(samples.speeds ? { speeds: [...samples.speeds] } : {}),
    ...(samples.tangentialPressures
      ? { tangentialPressures: [...samples.tangentialPressures] }
      : {}),
    ...(samples.altitudeAngles ? { altitudeAngles: [...samples.altitudeAngles] } : {}),
    ...(samples.azimuthAngles ? { azimuthAngles: [...samples.azimuthAngles] } : {}),
    ...(samples.contactWidths ? { contactWidths: [...samples.contactWidths] } : {}),
    ...(samples.contactHeights ? { contactHeights: [...samples.contactHeights] } : {}),
    ...(samples.sampleTimeOffsets
      ? { sampleTimeOffsets: [...samples.sampleTimeOffsets] }
      : {}),
  };
}

function copyRenderer(
  renderer: StudioLiveGesturePreviewRendererSnapshot,
): StudioLiveGesturePreviewRendererSnapshot {
  return {
    ...renderer,
    ...(renderer.brushTip ? { brushTip: { ...renderer.brushTip } } : {}),
    ...(renderer.strokeStyle ? { strokeStyle: { ...renderer.strokeStyle } } : {}),
    ...(renderer.shapeParams ? { shapeParams: { ...renderer.shapeParams } } : {}),
    ...(renderer.sketch ? { sketch: { ...renderer.sketch } } : {}),
    ...(renderer.symmetry ? { symmetry: { ...renderer.symmetry } } : {}),
    ...(renderer.brushDynamics ? { brushDynamics: { ...renderer.brushDynamics } } : {}),
  };
}

/** Returns a detached copy suitable for an immutable external preview store. */
export function copyStudioLiveGesturePreviewPayload(
  payload: StudioLiveGesturePreviewPayload,
): StudioLiveGesturePreviewPayload {
  return {
    version: payload.version,
    gestureId: payload.gestureId,
    pageId: payload.pageId,
    seq: payload.seq,
    phase: payload.phase,
    operation: payload.operation,
    ...(payload.base ? { base: { ...payload.base } } : {}),
    ...(payload.renderer ? { renderer: copyRenderer(payload.renderer) } : {}),
    ...(payload.samples ? { samples: copySamples(payload.samples) } : {}),
    ...(payload.shape ? { shape: { ...payload.shape } } : {}),
    ...(payload.retouch
      ? { retouch: { ...payload.retouch, points: [...payload.retouch.points] } }
      : {}),
  };
}

/** Parses untrusted input and returns a detached payload, or null without partial normalization. */
export function parseStudioLiveGesturePreviewPayload(
  value: unknown,
): StudioLiveGesturePreviewPayload | null {
  return isStudioLiveGesturePreviewPayload(value)
    ? copyStudioLiveGesturePreviewPayload(value)
    : null;
}

export function assertStudioLiveGesturePreviewPayload(
  value: unknown,
): asserts value is StudioLiveGesturePreviewPayload {
  if (!isStudioLiveGesturePreviewPayload(value)) throw new StudioLiveGesturePreviewError();
}
