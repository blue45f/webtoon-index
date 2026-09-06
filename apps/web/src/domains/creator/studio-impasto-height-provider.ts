/**
 * Renderer-neutral signed impasto height oracle.
 *
 * The provider intentionally owns no canvas, renderer, worker, or GPU state.
 * It gives every future backend one deterministic Float32 reference for
 * pressure/velocity expression, textured height deposition, excavation,
 * flattening, and conservative plow redistribution.
 */

import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_IMPASTO_HEIGHT_PROVIDER_VERSION = 1 as const;

export const STUDIO_IMPASTO_HEIGHT_BUDGETS = Object.freeze({
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxCells: 16_777_216,
  maxDepositionCount: 16_384,
  maxBrushRadius: 2_048,
  maxPlowRadius: 256,
  maxDepthPerDeposition: 65_536,
  maxHeightMagnitude: 1_000_000,
  maxWorkUnits: 300_000_000,
  maxMemoryBytes: 512 * 1024 * 1024,
  maxIdentifierCharacters: 128,
} as const);

const FLOAT32_EPSILON = 2 ** -23;

export type StudioImpastoHeightMode =
  | "add-height"
  | "erase-height"
  | "excavate"
  | "flatten";

export interface StudioImpastoHeightFieldInput {
  readonly width: number;
  readonly height: number;
  /** Signed surface height, one Float32 value per cell. */
  readonly heights: Float32Array;
  /** Optional straight RGBA color, four Float32 values per cell. */
  readonly colors?: Float32Array;
  /** Optional perceptual roughness, one normalized Float32 value per cell. */
  readonly roughness?: Float32Array;
  /** Optional normalized stationary paper luminance, one value per cell. */
  readonly paperLuminance?: Float32Array;
  /** Optional normalized brush texture luminance, one value per cell. */
  readonly textureLuminance?: Float32Array;
}

export interface StudioImpastoExpressionCurve {
  readonly minimum: number;
  readonly invert: boolean;
  readonly exponent: number;
}

export interface StudioImpastoDepositionExpression {
  /**
   * Pressure is expressive by default. Supplying a curve changes its minimum,
   * direction and response exponent.
   */
  readonly pressure?: StudioImpastoExpressionCurve;
  /**
   * Velocity is opt-in because hardware reports velocity in different units.
   * The request must supply a normalized 0..1 velocity sample.
   */
  readonly velocity?: StudioImpastoExpressionCurve;
}

export interface StudioImpastoPlow {
  readonly strength: number;
  readonly radius: number;
}

export interface StudioImpastoBrushDeposition {
  readonly id: string;
  readonly mode: StudioImpastoHeightMode;
  /** Cell-space brush center. Integer coordinates address cell centers. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Required and positive for add-height and excavate. */
  readonly depth?: number;
  /** Required for flatten; erase-height always targets zero. */
  readonly targetHeight?: number;
  readonly hardness: number;
  readonly falloff: number;
  readonly flow: number;
  readonly pressure: number;
  readonly velocity: number;
  readonly expression?: StudioImpastoDepositionExpression;
  readonly paperStrength: number;
  readonly textureStrength: number;
  readonly invertPaperLuminance?: boolean;
  readonly invertTextureLuminance?: boolean;
  readonly depthJitter: number;
  readonly jitterSmoothing: number;
  readonly seed: number;
  /**
   * Moves additional positive material from the brush footprint into a
   * bounded outer ring. It is mass-neutral on top of the intentional brush
   * delta and is skipped when no in-bounds receiving ring exists.
   */
  readonly plow?: StudioImpastoPlow;
  /** Optional normalized straight RGBA paint for an existing color channel. */
  readonly color?: readonly [number, number, number, number];
  /** Optional normalized target for an existing roughness channel. */
  readonly roughness?: number;
}

export interface StudioImpastoHeightRequest {
  readonly epoch: number;
  readonly field: StudioImpastoHeightFieldInput;
  readonly depositions: readonly StudioImpastoBrushDeposition[];
  readonly maximumWorkUnits?: number;
  readonly maximumMemoryBytes?: number;
  readonly signal?: AbortSignal;
}

export interface StudioImpastoHeightFieldArtifact {
  readonly width: number;
  readonly height: number;
  readonly heights: Float32Array;
  readonly colors?: Float32Array;
  readonly roughness?: Float32Array;
}

export interface StudioImpastoHeightConservationReceipt {
  readonly beforeHeightSum: number;
  readonly intentionalHeightDelta: number;
  readonly plowRemovedHeight: number;
  readonly plowRedistributedHeight: number;
  readonly expectedAfterHeightSum: number;
  readonly afterHeightSum: number;
  readonly conservationError: number;
  /** Diagnostic difference from independently summing the final field. */
  readonly heightSummationResidual: number;
  readonly tolerance: number;
  readonly conserved: true;
}

export interface StudioImpastoHeightReceipt {
  readonly kind: "studio-impasto-height-receipt";
  readonly version: typeof STUDIO_IMPASTO_HEIGHT_PROVIDER_VERSION;
  readonly backend: "cpu-f32-oracle";
  readonly algorithm: "signed-textured-height-plow-v1";
  readonly epoch: number;
  readonly sequence: number;
  readonly width: number;
  readonly height: number;
  readonly depositionCount: number;
  readonly affectedCellWrites: number;
  readonly plowDepositionCount: number;
  readonly workUnits: number;
  readonly memoryBytes: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;
  readonly beforeHash: `sha256:${string}`;
  readonly afterHash: `sha256:${string}`;
  readonly colorPolicy: "updated-existing-channel" | "no-channel";
  readonly roughnessPolicy: "updated-existing-channel" | "no-channel";
  readonly conservation: StudioImpastoHeightConservationReceipt;
  readonly complete: true;
}

export interface StudioImpastoHeightArtifact {
  readonly kind: "studio-impasto-height-artifact";
  readonly version: typeof STUDIO_IMPASTO_HEIGHT_PROVIDER_VERSION;
  readonly field: StudioImpastoHeightFieldArtifact;
  readonly receipt: StudioImpastoHeightReceipt;
}

export class StudioImpastoHeightProviderError extends Error {
  constructor(
    readonly code:
      | "aborted"
      | "budget-exceeded"
      | "conservation-failed"
      | "disposed"
      | "epoch-mismatch"
      | "invalid-request"
      | "numeric-overflow",
    message: string,
  ) {
    super(message);
    this.name = "StudioImpastoHeightProviderError";
  }
}

export interface StudioImpastoHeightProvider {
  apply(request: StudioImpastoHeightRequest): StudioImpastoHeightArtifact;
  advanceEpoch(nextEpoch: number): void;
  snapshot(): Readonly<{
    state: "ready" | "disposed";
    epoch: number;
    sequence: number;
  }>;
  dispose(): void;
}

interface PreparedField {
  readonly width: number;
  readonly height: number;
  readonly heights: Float32Array;
  readonly colors?: Float32Array;
  readonly roughness?: Float32Array;
  readonly paperLuminance?: Float32Array;
  readonly textureLuminance?: Float32Array;
}

interface PreparedDeposition extends StudioImpastoBrushDeposition {
  readonly color?: readonly [number, number, number, number];
  readonly expression?: Readonly<{
    pressure?: Readonly<StudioImpastoExpressionCurve>;
    velocity?: Readonly<StudioImpastoExpressionCurve>;
  }>;
  readonly plow?: Readonly<StudioImpastoPlow>;
}

interface PreparedRequest {
  readonly field: PreparedField;
  readonly depositions: readonly PreparedDeposition[];
  readonly workUnits: number;
  readonly memoryBytes: number;
}

interface ApplyStatistics {
  intentionalHeightDelta: number;
  affectedCellWrites: number;
  plowDepositionCount: number;
  plowRemovedHeight: number;
  plowRedistributedHeight: number;
}

interface WeightedCell {
  readonly index: number;
  readonly weight: number;
}

interface PlowDonor {
  readonly index: number;
  readonly requestedMove: number;
}

function invalid(message: string): never {
  throw new StudioImpastoHeightProviderError("invalid-request", message);
}

function budget(message: string): never {
  throw new StudioImpastoHeightProviderError("budget-exceeded", message);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function normalized(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length
      <= STUDIO_IMPASTO_HEIGHT_BUDGETS.maxIdentifierCharacters
  );
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudioImpastoHeightProviderError(
      "aborted",
      "Impasto height operation was aborted.",
    );
  }
}

function finiteFloat32(
  value: unknown,
  expectedLength: number,
  label: string,
  range?: readonly [number, number],
): Float32Array {
  if (!(value instanceof Float32Array) || value.length !== expectedLength) {
    invalid(`${label} must be a Float32Array of length ${expectedLength}.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const component = value[index]!;
    if (
      !Number.isFinite(component)
      || (
        range !== undefined
        && (component < range[0] || component > range[1])
      )
    ) {
      invalid(`${label} contains an out-of-range or non-finite value.`);
    }
  }
  return value;
}

function validateCurve(
  value: StudioImpastoExpressionCurve | undefined,
  label: string,
): Readonly<StudioImpastoExpressionCurve> | undefined {
  if (value === undefined) return undefined;
  if (
    !value
    || !normalized(value.minimum)
    || typeof value.invert !== "boolean"
    || !finite(value.exponent)
    || value.exponent < 0.125
    || value.exponent > 16
  ) {
    invalid(`${label} is invalid.`);
  }
  return Object.freeze({
    minimum: value.minimum,
    invert: value.invert,
    exponent: value.exponent,
  });
}

function validateDeposition(
  deposition: StudioImpastoBrushDeposition,
): PreparedDeposition {
  if (
    !deposition
    || !validIdentifier(deposition.id)
    || !(
      deposition.mode === "add-height"
      || deposition.mode === "erase-height"
      || deposition.mode === "excavate"
      || deposition.mode === "flatten"
    )
    || !finite(deposition.x)
    || !finite(deposition.y)
    || !finite(deposition.radius)
    || deposition.radius <= 0
    || deposition.radius > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxBrushRadius
    || !normalized(deposition.hardness)
    || !finite(deposition.falloff)
    || deposition.falloff < 0.125
    || deposition.falloff > 16
    || !normalized(deposition.flow)
    || !normalized(deposition.pressure)
    || !normalized(deposition.velocity)
    || !normalized(deposition.paperStrength)
    || !normalized(deposition.textureStrength)
    || !normalized(deposition.depthJitter)
    || !normalized(deposition.jitterSmoothing)
    || !Number.isInteger(deposition.seed)
    || deposition.seed < 0
    || deposition.seed > 0xffff_ffff
    || (
      deposition.invertPaperLuminance !== undefined
      && typeof deposition.invertPaperLuminance !== "boolean"
    )
    || (
      deposition.invertTextureLuminance !== undefined
      && typeof deposition.invertTextureLuminance !== "boolean"
    )
  ) {
    invalid("Impasto deposition contains an invalid scalar or enum.");
  }
  const needsDepth = (
    deposition.mode === "add-height"
    || deposition.mode === "excavate"
  );
  if (
    needsDepth
    && (
      !finite(deposition.depth)
      || deposition.depth <= 0
      || deposition.depth
        > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxDepthPerDeposition
    )
  ) {
    invalid("Add-height and excavate depositions require bounded depth.");
  }
  if (
    !needsDepth
    && deposition.depth !== undefined
    && (!finite(deposition.depth) || deposition.depth < 0)
  ) {
    invalid("Optional depth must be finite and non-negative.");
  }
  if (
    deposition.mode === "flatten"
    && (
      !finite(deposition.targetHeight)
      || Math.abs(deposition.targetHeight)
        > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxHeightMagnitude
    )
  ) {
    invalid("Flatten depositions require a bounded target height.");
  }
  if (
    deposition.mode !== "flatten"
    && deposition.targetHeight !== undefined
    && !finite(deposition.targetHeight)
  ) {
    invalid("Optional targetHeight must be finite.");
  }

  let plow: Readonly<StudioImpastoPlow> | undefined;
  if (deposition.plow !== undefined) {
    if (
      !deposition.plow
      || !normalized(deposition.plow.strength)
      || !finite(deposition.plow.radius)
      || deposition.plow.radius <= 0
      || deposition.plow.radius
        > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxPlowRadius
    ) {
      invalid("Impasto plow parameters are invalid.");
    }
    plow = Object.freeze({
      strength: deposition.plow.strength,
      radius: deposition.plow.radius,
    });
  }

  let color: readonly [number, number, number, number] | undefined;
  if (deposition.color !== undefined) {
    if (
      !Array.isArray(deposition.color)
      || deposition.color.length !== 4
      || deposition.color.some((component) => !normalized(component))
    ) {
      invalid("Impasto deposition color must be normalized RGBA.");
    }
    color = Object.freeze([
      deposition.color[0],
      deposition.color[1],
      deposition.color[2],
      deposition.color[3],
    ]);
  }
  if (
    deposition.roughness !== undefined
    && !normalized(deposition.roughness)
  ) {
    invalid("Impasto deposition roughness must be normalized.");
  }

  if (
    deposition.expression !== undefined
    && (
      !deposition.expression
      || typeof deposition.expression !== "object"
    )
  ) {
    invalid("Impasto deposition expression must be an object.");
  }
  const pressure = validateCurve(
    deposition.expression?.pressure,
    "pressure expression",
  );
  const velocity = validateCurve(
    deposition.expression?.velocity,
    "velocity expression",
  );
  const expression = pressure === undefined && velocity === undefined
    ? undefined
    : Object.freeze({
        ...(pressure === undefined ? {} : { pressure }),
        ...(velocity === undefined ? {} : { velocity }),
      });

  return Object.freeze({
    id: deposition.id,
    mode: deposition.mode,
    x: deposition.x,
    y: deposition.y,
    radius: deposition.radius,
    ...(deposition.depth === undefined ? {} : { depth: deposition.depth }),
    ...(deposition.targetHeight === undefined
      ? {}
      : { targetHeight: deposition.targetHeight }),
    hardness: deposition.hardness,
    falloff: deposition.falloff,
    flow: deposition.flow,
    pressure: deposition.pressure,
    velocity: deposition.velocity,
    ...(expression === undefined ? {} : { expression }),
    paperStrength: deposition.paperStrength,
    textureStrength: deposition.textureStrength,
    ...(deposition.invertPaperLuminance === undefined
      ? {}
      : { invertPaperLuminance: deposition.invertPaperLuminance }),
    ...(deposition.invertTextureLuminance === undefined
      ? {}
      : { invertTextureLuminance: deposition.invertTextureLuminance }),
    depthJitter: deposition.depthJitter,
    jitterSmoothing: deposition.jitterSmoothing,
    seed: deposition.seed,
    ...(plow === undefined ? {} : { plow }),
    ...(color === undefined ? {} : { color }),
    ...(deposition.roughness === undefined
      ? {}
      : { roughness: deposition.roughness }),
  });
}

function clippedArea(
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  const minimumX = Math.max(0, Math.floor(x - radius));
  const maximumX = Math.min(width - 1, Math.ceil(x + radius));
  const minimumY = Math.max(0, Math.floor(y - radius));
  const maximumY = Math.min(height - 1, Math.ceil(y + radius));
  if (maximumX < minimumX || maximumY < minimumY) return 0;
  return (maximumX - minimumX + 1) * (maximumY - minimumY + 1);
}

function prepareRequest(
  request: StudioImpastoHeightRequest,
): PreparedRequest {
  if (
    !request
    || !positiveSafeInteger(request.epoch)
    || !request.field
    || !positiveSafeInteger(request.field.width)
    || !positiveSafeInteger(request.field.height)
    || request.field.width > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxWidth
    || request.field.height > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxHeight
    || !Array.isArray(request.depositions)
    || request.depositions.length === 0
    || request.depositions.length
      > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxDepositionCount
    || (
      request.maximumWorkUnits !== undefined
      && !positiveSafeInteger(request.maximumWorkUnits)
    )
    || (
      request.maximumMemoryBytes !== undefined
      && !positiveSafeInteger(request.maximumMemoryBytes)
    )
  ) {
    invalid("Impasto height request shape is invalid.");
  }
  const cellCount = request.field.width * request.field.height;
  if (
    !Number.isSafeInteger(cellCount)
    || cellCount > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxCells
  ) {
    budget("Impasto field exceeds the cell budget.");
  }
  const sourceHeights = finiteFloat32(
    request.field.heights,
    cellCount,
    "field.heights",
    [
      -STUDIO_IMPASTO_HEIGHT_BUDGETS.maxHeightMagnitude,
      STUDIO_IMPASTO_HEIGHT_BUDGETS.maxHeightMagnitude,
    ],
  );
  const sourceColors = request.field.colors === undefined
    ? undefined
    : finiteFloat32(
        request.field.colors,
        cellCount * 4,
        "field.colors",
        [0, 1],
      );
  const sourceRoughness = request.field.roughness === undefined
    ? undefined
    : finiteFloat32(
        request.field.roughness,
        cellCount,
        "field.roughness",
        [0, 1],
      );
  const sourcePaperLuminance = request.field.paperLuminance === undefined
    ? undefined
    : finiteFloat32(
        request.field.paperLuminance,
        cellCount,
        "field.paperLuminance",
        [0, 1],
      );
  const sourceTextureLuminance = request.field.textureLuminance === undefined
    ? undefined
    : finiteFloat32(
        request.field.textureLuminance,
        cellCount,
        "field.textureLuminance",
        [0, 1],
      );
  const ids = new Set<string>();
  const depositions: PreparedDeposition[] = [];
  const mutableScalarCount = (
    sourceHeights.length
    + (sourceColors?.length ?? 0)
    + (sourceRoughness?.length ?? 0)
  );
  const inputScalarCount = (
    mutableScalarCount
    + (sourcePaperLuminance?.length ?? 0)
    + (sourceTextureLuminance?.length ?? 0)
  );
  // Input validation, before/after hashing, before/after height summaries and
  // cloning are all real CPU work even when the brush footprint is tiny.
  let workUnits = (
    inputScalarCount
    + mutableScalarCount * 2
    + sourceHeights.length * 3
  );
  let maximumScratchCells = 0;
  for (const candidate of request.depositions) {
    const deposition = validateDeposition(candidate);
    if (ids.has(deposition.id)) {
      invalid("Impasto deposition identifiers must be unique and ordered.");
    }
    ids.add(deposition.id);
    depositions.push(deposition);
    const coreArea = clippedArea(
      request.field.width,
      request.field.height,
      deposition.x,
      deposition.y,
      deposition.radius,
    );
    const extendedRadius = deposition.radius + (deposition.plow?.radius ?? 0);
    const extendedArea = clippedArea(
      request.field.width,
      request.field.height,
      deposition.x,
      deposition.y,
      extendedRadius,
    );
    const depositionWork = coreArea * 3 + extendedArea;
    workUnits += depositionWork;
    maximumScratchCells = Math.max(
      maximumScratchCells,
      coreArea + extendedArea,
    );
  }
  const maximumWorkUnits = Math.min(
    request.maximumWorkUnits
      ?? STUDIO_IMPASTO_HEIGHT_BUDGETS.maxWorkUnits,
    STUDIO_IMPASTO_HEIGHT_BUDGETS.maxWorkUnits,
  );
  if (!Number.isSafeInteger(workUnits) || workUnits > maximumWorkUnits) {
    budget("Impasto request exceeds the work budget.");
  }

  const clonedBytes = (
    sourceHeights.byteLength
    + (sourceColors?.byteLength ?? 0)
    + (sourceRoughness?.byteLength ?? 0)
    + (sourcePaperLuminance?.byteLength ?? 0)
    + (sourceTextureLuminance?.byteLength ?? 0)
  );
  const hashBytes = (
    12
    + sourceHeights.byteLength
    + (sourceColors?.byteLength ?? 0)
    + (sourceRoughness?.byteLength ?? 0)
  );
  // A donor stores two numbers and a ring cell stores two numbers. The
  // estimate deliberately uses 64 bytes/cell to include JS object overhead.
  const scratchBytes = maximumScratchCells * 64;
  const memoryBytes = clonedBytes + hashBytes + scratchBytes;
  const maximumMemoryBytes = Math.min(
    request.maximumMemoryBytes
      ?? STUDIO_IMPASTO_HEIGHT_BUDGETS.maxMemoryBytes,
    STUDIO_IMPASTO_HEIGHT_BUDGETS.maxMemoryBytes,
  );
  if (
    !Number.isSafeInteger(memoryBytes)
    || memoryBytes > maximumMemoryBytes
  ) {
    budget("Impasto request exceeds the memory budget.");
  }

  const heights = new Float32Array(sourceHeights);
  const colors = sourceColors === undefined
    ? undefined
    : new Float32Array(sourceColors);
  const roughness = sourceRoughness === undefined
    ? undefined
    : new Float32Array(sourceRoughness);
  const paperLuminance = sourcePaperLuminance === undefined
    ? undefined
    : new Float32Array(sourcePaperLuminance);
  const textureLuminance = sourceTextureLuminance === undefined
    ? undefined
    : new Float32Array(sourceTextureLuminance);

  return {
    field: {
      width: request.field.width,
      height: request.field.height,
      heights,
      ...(colors === undefined ? {} : { colors }),
      ...(roughness === undefined ? {} : { roughness }),
      ...(paperLuminance === undefined ? {} : { paperLuminance }),
      ...(textureLuminance === undefined ? {} : { textureLuminance }),
    },
    depositions: Object.freeze(depositions),
    workUnits,
    memoryBytes,
  };
}

function setFloat32LittleEndian(
  bytes: Uint8Array,
  offset: number,
  values: Float32Array,
): number {
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(offset, values[index]!, true);
    offset += Float32Array.BYTES_PER_ELEMENT;
  }
  return offset;
}

function hashField(field: PreparedField): `sha256:${string}` {
  const byteLength = (
    12
    + field.heights.byteLength
    + (field.colors?.byteLength ?? 0)
    + (field.roughness?.byteLength ?? 0)
  );
  const bytes = new Uint8Array(byteLength);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, field.width, true);
  header.setUint32(4, field.height, true);
  header.setUint32(
    8,
    (field.colors === undefined ? 0 : 1)
      | (field.roughness === undefined ? 0 : 2),
    true,
  );
  let offset = setFloat32LittleEndian(bytes, 12, field.heights);
  if (field.colors !== undefined) {
    offset = setFloat32LittleEndian(bytes, offset, field.colors);
  }
  if (field.roughness !== undefined) {
    setFloat32LittleEndian(bytes, offset, field.roughness);
  }
  return `sha256:${sha256HexPortable(bytes)}`;
}

function heightSummary(heights: Float32Array): Readonly<{
  sum: number;
  minimum: number;
  maximum: number;
}> {
  let sum = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const height of heights) {
    sum += height;
    minimum = Math.min(minimum, height);
    maximum = Math.max(maximum, height);
  }
  return { sum, minimum, maximum };
}

function mixUint32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d);
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function noiseAt(seed: number, x: number, y: number): number {
  const mixed = mixUint32(
    seed
      ^ Math.imul(x | 0, 0x9e37_79b1)
      ^ Math.imul(y | 0, 0x85eb_ca77),
  );
  return (mixed / 0xffff_ffff) * 2 - 1;
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function seededJitter(
  seed: number,
  x: number,
  y: number,
  smoothing: number,
): number {
  if (smoothing <= 0) return noiseAt(seed, x, y);
  const scale = 1 + Math.floor(smoothing * 31);
  const latticeX = Math.floor(x / scale);
  const latticeY = Math.floor(y / scale);
  const localX = smoothStep((x - latticeX * scale) / scale);
  const localY = smoothStep((y - latticeY * scale) / scale);
  const top = (
    noiseAt(seed, latticeX, latticeY) * (1 - localX)
    + noiseAt(seed, latticeX + 1, latticeY) * localX
  );
  const bottom = (
    noiseAt(seed, latticeX, latticeY + 1) * (1 - localX)
    + noiseAt(seed, latticeX + 1, latticeY + 1) * localX
  );
  return top * (1 - localY) + bottom * localY;
}

function expressionValue(
  sample: number,
  curve: StudioImpastoExpressionCurve,
): number {
  const oriented = curve.invert ? 1 - sample : sample;
  return (
    curve.minimum
    + (1 - curve.minimum) * Math.pow(oriented, curve.exponent)
  );
}

function expressionFactor(deposition: PreparedDeposition): number {
  const pressureCurve = deposition.expression?.pressure ?? {
    minimum: 0,
    invert: false,
    exponent: 1,
  };
  const pressure = expressionValue(deposition.pressure, pressureCurve);
  const velocity = deposition.expression?.velocity === undefined
    ? 1
    : expressionValue(
        deposition.velocity,
        deposition.expression.velocity,
      );
  return pressure * velocity;
}

function radialCoverage(
  deposition: PreparedDeposition,
  x: number,
  y: number,
): number {
  const distance = Math.hypot(x - deposition.x, y - deposition.y);
  if (distance > deposition.radius) return 0;
  const normalizedDistance = distance / deposition.radius;
  if (normalizedDistance <= deposition.hardness) return 1;
  if (deposition.hardness >= 1) return 1;
  const fade = (
    (normalizedDistance - deposition.hardness)
    / (1 - deposition.hardness)
  );
  return Math.pow(1 - smoothStep(Math.min(1, fade)), deposition.falloff);
}

function luminanceFactor(
  value: number | undefined,
  strength: number,
  invert: boolean,
): number {
  if (value === undefined || strength <= 0) return 1;
  const oriented = invert ? 1 - value : value;
  return 1 + (oriented - 1) * strength;
}

function checkedHeight(value: number): number {
  const floatValue = Math.fround(value);
  if (
    !Number.isFinite(floatValue)
    || Math.abs(floatValue)
      > STUDIO_IMPASTO_HEIGHT_BUDGETS.maxHeightMagnitude
  ) {
    throw new StudioImpastoHeightProviderError(
      "numeric-overflow",
      "Impasto height exceeded the finite signed-height range.",
    );
  }
  return floatValue;
}

function blendOptionalChannels(
  field: PreparedField,
  deposition: PreparedDeposition,
  index: number,
  influence: number,
): void {
  if (field.colors !== undefined && deposition.color !== undefined) {
    const alpha = Math.min(1, influence * deposition.color[3]);
    const offset = index * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const before = field.colors[offset + channel]!;
      field.colors[offset + channel] = Math.fround(
        before + (deposition.color[channel]! - before) * alpha,
      );
    }
  }
  if (
    field.roughness !== undefined
    && deposition.roughness !== undefined
  ) {
    const before = field.roughness[index]!;
    field.roughness[index] = Math.fround(
      before + (deposition.roughness - before) * Math.min(1, influence),
    );
  }
}

function plowRing(
  field: PreparedField,
  deposition: PreparedDeposition,
): readonly WeightedCell[] {
  if (deposition.plow === undefined || deposition.plow.strength <= 0) {
    return [];
  }
  const outerRadius = deposition.radius + deposition.plow.radius;
  const minimumX = Math.max(0, Math.floor(deposition.x - outerRadius));
  const maximumX = Math.min(
    field.width - 1,
    Math.ceil(deposition.x + outerRadius),
  );
  const minimumY = Math.max(0, Math.floor(deposition.y - outerRadius));
  const maximumY = Math.min(
    field.height - 1,
    Math.ceil(deposition.y + outerRadius),
  );
  const cells: WeightedCell[] = [];
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const distance = Math.hypot(x - deposition.x, y - deposition.y);
      if (distance <= deposition.radius || distance > outerRadius) continue;
      const ringDistance = (
        (distance - deposition.radius)
        / deposition.plow.radius
      );
      const weight = Math.max(0.000_001, 1 - smoothStep(ringDistance));
      cells.push({ index: y * field.width + x, weight });
    }
  }
  return cells;
}

function redistributePlow(
  field: PreparedField,
  donors: readonly PlowDonor[],
  ring: readonly WeightedCell[],
): Readonly<{ removed: number; redistributed: number }> {
  if (donors.length === 0 || ring.length === 0) {
    return { removed: 0, redistributed: 0 };
  }
  let removed = 0;
  for (const donor of donors) {
    const before = field.heights[donor.index]!;
    const after = checkedHeight(before - donor.requestedMove);
    field.heights[donor.index] = after;
    removed += before - after;
  }
  if (removed <= 0) return { removed: 0, redistributed: 0 };

  let weightSum = 0;
  for (const receiver of ring) weightSum += receiver.weight;
  let redistributed = 0;
  let requestedRemaining = removed;
  for (let receiverIndex = 0; receiverIndex < ring.length; receiverIndex += 1) {
    const receiver = ring[receiverIndex]!;
    const requested = receiverIndex === ring.length - 1
      ? requestedRemaining
      : removed * (receiver.weight / weightSum);
    requestedRemaining -= requested;
    const before = field.heights[receiver.index]!;
    const after = checkedHeight(before + requested);
    field.heights[receiver.index] = after;
    redistributed += after - before;
  }

  const correction = removed - redistributed;
  if (correction !== 0) {
    const receiver = ring[ring.length - 1]!;
    const before = field.heights[receiver.index]!;
    const after = checkedHeight(before + correction);
    field.heights[receiver.index] = after;
    redistributed += after - before;
  }
  return { removed, redistributed };
}

function applyDeposition(
  field: PreparedField,
  deposition: PreparedDeposition,
  statistics: ApplyStatistics,
  signal?: AbortSignal,
): void {
  const expression = expressionFactor(deposition);
  const minimumX = Math.max(0, Math.floor(deposition.x - deposition.radius));
  const maximumX = Math.min(
    field.width - 1,
    Math.ceil(deposition.x + deposition.radius),
  );
  const minimumY = Math.max(0, Math.floor(deposition.y - deposition.radius));
  const maximumY = Math.min(
    field.height - 1,
    Math.ceil(deposition.y + deposition.radius),
  );
  const ring = plowRing(field, deposition);
  const donors: PlowDonor[] = [];
  let visited = 0;
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      visited += 1;
      if ((visited & 0x3ff) === 0) checkAbort(signal);
      const coverage = radialCoverage(deposition, x, y);
      if (coverage <= 0) continue;
      const index = y * field.width + x;
      const paper = luminanceFactor(
        field.paperLuminance?.[index],
        deposition.paperStrength,
        deposition.invertPaperLuminance ?? false,
      );
      const texture = luminanceFactor(
        field.textureLuminance?.[index],
        deposition.textureStrength,
        deposition.invertTextureLuminance ?? false,
      );
      const noise = seededJitter(
        deposition.seed,
        x,
        y,
        deposition.jitterSmoothing,
      );
      const jitter = Math.max(0, 1 + noise * deposition.depthJitter);
      const influence = (
        coverage
        * deposition.flow
        * expression
        * paper
        * texture
        * jitter
      );
      if (influence <= 0) continue;
      const before = field.heights[index]!;
      let requestedHeight: number;
      switch (deposition.mode) {
        case "add-height":
          requestedHeight = before + deposition.depth! * influence;
          break;
        case "excavate":
          requestedHeight = before - deposition.depth! * influence;
          break;
        case "erase-height":
          requestedHeight = before + (0 - before) * Math.min(1, influence);
          break;
        case "flatten":
          requestedHeight = (
            before
            + (deposition.targetHeight! - before) * Math.min(1, influence)
          );
          break;
      }
      const after = checkedHeight(requestedHeight);
      field.heights[index] = after;
      const actualDelta = after - before;
      statistics.intentionalHeightDelta += actualDelta;
      statistics.affectedCellWrites += 1;
      blendOptionalChannels(field, deposition, index, Math.min(1, influence));
      if (
        deposition.plow !== undefined
        && deposition.plow.strength > 0
        && ring.length > 0
        && actualDelta !== 0
      ) {
        donors.push({
          index,
          requestedMove: Math.abs(actualDelta) * deposition.plow.strength,
        });
      }
    }
  }
  checkAbort(signal);
  const plow = redistributePlow(field, donors, ring);
  if (plow.removed > 0) statistics.plowDepositionCount += 1;
  statistics.plowRemovedHeight += plow.removed;
  statistics.plowRedistributedHeight += plow.redistributed;
}

class StudioImpastoHeightProviderImplementation
implements StudioImpastoHeightProvider {
  private state: "ready" | "disposed" = "ready";

  private sequence = 0;

  constructor(private epoch: number) {
    if (!positiveSafeInteger(epoch)) {
      invalid("Impasto provider epoch must be a positive safe integer.");
    }
  }

  apply(request: StudioImpastoHeightRequest): StudioImpastoHeightArtifact {
    if (this.state === "disposed") {
      throw new StudioImpastoHeightProviderError(
        "disposed",
        "Impasto height provider has been disposed.",
      );
    }
    checkAbort(request?.signal);
    if (request?.epoch !== this.epoch) {
      throw new StudioImpastoHeightProviderError(
        "epoch-mismatch",
        "Impasto request does not belong to the current provider epoch.",
      );
    }
    const prepared = prepareRequest(request);
    const beforeHash = hashField(prepared.field);
    const before = heightSummary(prepared.field.heights);
    const statistics: ApplyStatistics = {
      intentionalHeightDelta: 0,
      affectedCellWrites: 0,
      plowDepositionCount: 0,
      plowRemovedHeight: 0,
      plowRedistributedHeight: 0,
    };
    for (
      let depositionIndex = 0;
      depositionIndex < prepared.depositions.length;
      depositionIndex += 1
    ) {
      checkAbort(request.signal);
      applyDeposition(
        prepared.field,
        prepared.depositions[depositionIndex]!,
        statistics,
        request.signal,
      );
    }
    checkAbort(request.signal);
    const after = heightSummary(prepared.field.heights);
    const expectedAfterHeightSum = (
      before.sum + statistics.intentionalHeightDelta
    );
    const conservationError = (
      statistics.plowRedistributedHeight
      - statistics.plowRemovedHeight
    );
    const heightSummationResidual = (
      after.sum - (expectedAfterHeightSum + conservationError)
    );
    const tolerance = Math.max(
      0.000_01,
      (
        Math.abs(statistics.intentionalHeightDelta)
        + statistics.plowRemovedHeight
        + statistics.plowRedistributedHeight
        + 1
      ) * FLOAT32_EPSILON * 8,
    );
    if (
      !Number.isFinite(conservationError)
      || !Number.isFinite(heightSummationResidual)
      || Math.max(
        Math.abs(conservationError),
        Math.abs(heightSummationResidual),
      ) > tolerance
    ) {
      throw new StudioImpastoHeightProviderError(
        "conservation-failed",
        "Conservative plow exceeded the signed-height tolerance.",
      );
    }

    const sequence = this.sequence + 1;
    const afterHash = hashField(prepared.field);
    const conservation: StudioImpastoHeightConservationReceipt = Object.freeze({
      beforeHeightSum: before.sum,
      intentionalHeightDelta: statistics.intentionalHeightDelta,
      plowRemovedHeight: statistics.plowRemovedHeight,
      plowRedistributedHeight: statistics.plowRedistributedHeight,
      expectedAfterHeightSum,
      afterHeightSum: after.sum,
      conservationError,
      heightSummationResidual,
      tolerance,
      conserved: true,
    });
    const receipt: StudioImpastoHeightReceipt = Object.freeze({
      kind: "studio-impasto-height-receipt",
      version: STUDIO_IMPASTO_HEIGHT_PROVIDER_VERSION,
      backend: "cpu-f32-oracle",
      algorithm: "signed-textured-height-plow-v1",
      epoch: this.epoch,
      sequence,
      width: prepared.field.width,
      height: prepared.field.height,
      depositionCount: prepared.depositions.length,
      affectedCellWrites: statistics.affectedCellWrites,
      plowDepositionCount: statistics.plowDepositionCount,
      workUnits: prepared.workUnits,
      memoryBytes: prepared.memoryBytes,
      minimumHeight: after.minimum,
      maximumHeight: after.maximum,
      beforeHash,
      afterHash,
      colorPolicy: prepared.field.colors === undefined
        ? "no-channel"
        : "updated-existing-channel",
      roughnessPolicy: prepared.field.roughness === undefined
        ? "no-channel"
        : "updated-existing-channel",
      conservation,
      complete: true,
    });
    this.sequence = sequence;
    return Object.freeze({
      kind: "studio-impasto-height-artifact",
      version: STUDIO_IMPASTO_HEIGHT_PROVIDER_VERSION,
      field: Object.freeze({
        width: prepared.field.width,
        height: prepared.field.height,
        heights: prepared.field.heights,
        ...(prepared.field.colors === undefined
          ? {}
          : { colors: prepared.field.colors }),
        ...(prepared.field.roughness === undefined
          ? {}
          : { roughness: prepared.field.roughness }),
      }),
      receipt,
    });
  }

  advanceEpoch(nextEpoch: number): void {
    if (this.state === "disposed") {
      throw new StudioImpastoHeightProviderError(
        "disposed",
        "Impasto height provider has been disposed.",
      );
    }
    if (!positiveSafeInteger(nextEpoch) || nextEpoch <= this.epoch) {
      invalid("Impasto provider epochs must advance monotonically.");
    }
    this.epoch = nextEpoch;
  }

  snapshot(): Readonly<{
    state: "ready" | "disposed";
    epoch: number;
    sequence: number;
  }> {
    return Object.freeze({
      state: this.state,
      epoch: this.epoch,
      sequence: this.sequence,
    });
  }

  dispose(): void {
    this.state = "disposed";
  }
}

export function createStudioImpastoHeightProvider(
  options: Readonly<{ epoch: number }>,
): StudioImpastoHeightProvider {
  if (!options || typeof options !== "object") {
    invalid("Impasto provider options are required.");
  }
  return new StudioImpastoHeightProviderImplementation(options.epoch);
}
