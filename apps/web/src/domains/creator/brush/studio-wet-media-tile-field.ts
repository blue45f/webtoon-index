/**
 * Deterministic, provider-neutral wet-media tile field.
 *
 * The model owns plain numeric fields only. It has no DOM, Canvas, GPU, Worker, timer, or vendor
 * preset dependency, so the same fixed-tick evolution can be replayed by a CPU oracle, Worker, or
 * compute provider. Public arrays are copied and frozen. Every internal transport step is a
 * pairwise transfer (or a phase transfer inside one cell), which makes conservation accounting
 * explicit.
 *
 * Pigment colour is stored as additive optical-density load plus a separate pigment mass. This
 * avoids encoded-RGB averaging while keeping pigment mass independently auditable.
 */

export const STUDIO_WET_MEDIA_TILE_FIELD_VERSION = 1 as const;

export const STUDIO_WET_MEDIA_TILE_FIELD_LIMITS = Object.freeze({
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxCells: 1_048_576,
  maxTicksPerAdvance: 256,
  maxTick: 2_147_483_647,
  maxCellMass: 1_048_576,
  maxDepositionOperations: 16_384,
  maxOpticalDensity: 16,
} as const);

export const STUDIO_WET_MEDIA_CUT = Object.freeze({
  north: 1,
  east: 2,
  south: 4,
  west: 8,
} as const);

export interface StudioWetMediaTileFieldSettings {
  readonly kind: "studio-wet-media-tile-field-settings";
  readonly version: typeof STUDIO_WET_MEDIA_TILE_FIELD_VERSION;
  readonly model: "fixed-step-anisotropic-paper-v1";
  readonly width: number;
  readonly height: number;
  /** Pairwise surface-water exchange per fixed tick. */
  readonly waterDiffusionRate: number;
  /** Pairwise mobile-pigment exchange per fixed tick. */
  readonly pigmentDiffusionRate: number;
  /** 0 is isotropic; values approaching 1 increasingly follow the paper fibre direction. */
  readonly anisotropy: number;
  readonly absorptionRate: number;
  readonly surfaceEvaporationRate: number;
  readonly paperEvaporationRate: number;
  readonly fixationRate: number;
  readonly edgePoolingRate: number;
  readonly rewetRate: number;
  readonly backrunRate: number;
  readonly rewetEnergyDecay: number;
  readonly dryThreshold: number;
  readonly maxCellWater: number;
  readonly maxCellPigment: number;
}

export interface StudioWetMediaTileFieldPaper {
  readonly kind: "studio-wet-media-tile-field-paper";
  readonly version: typeof STUDIO_WET_MEDIA_TILE_FIELD_VERSION;
  /** Per-cell paper intake response in [0, 1]. */
  readonly absorption: readonly number[];
  /** Per-cell undirected fibre axis, expressed in radians in [-PI, PI]. */
  readonly fiberDirectionRadians: readonly number[];
  /** 1 participates in the simulation; 0 is a cut-out cell. */
  readonly activeMask: readonly number[];
  /** Per-cell N/E/S/W bit mask. A set bit closes that edge. */
  readonly cutBoundaryMask: readonly number[];
}

export type StudioWetMediaOpticalDensityField = readonly [
  red: readonly number[],
  green: readonly number[],
  blue: readonly number[],
];

export interface StudioWetMediaTileFieldState {
  readonly kind: "studio-wet-media-tile-field-state";
  readonly version: typeof STUDIO_WET_MEDIA_TILE_FIELD_VERSION;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly absorption: readonly number[];
  readonly fiberDirectionRadians: readonly number[];
  readonly activeMask: readonly number[];
  readonly cutBoundaryMask: readonly number[];
  readonly surfaceWater: readonly number[];
  readonly absorbedPaperWater: readonly number[];
  readonly mobilePigmentMass: readonly number[];
  readonly fixedPigmentMass: readonly number[];
  readonly mobilePigmentOpticalDensity: StudioWetMediaOpticalDensityField;
  readonly fixedPigmentOpticalDensity: StudioWetMediaOpticalDensityField;
  /** Transient pressure wave created by adding water to a dry cell. */
  readonly rewetEnergy: readonly number[];
}

export type StudioWetMediaLinearRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

/**
 * Per-channel optical-density bleed multipliers (InkWash §06 chromatography).
 * `[1, 1, 1]` is lockstep RGB — the historical default so existing oracles stay byte-stable.
 * Rates above 1 let that dye species outrun the pigment-mass front.
 */
export type StudioWetMediaPigmentChannelRates = readonly [
  red: number,
  green: number,
  blue: number,
];

export const STUDIO_WET_MEDIA_LOCKSTEP_PIGMENT_CHANNEL_RATES =
  Object.freeze([1, 1, 1]) as StudioWetMediaPigmentChannelRates;

/**
 * A signed delta maps directly onto a two-well brush contact:
 * - pickupFromCanvas becomes negative water/pigment deltas;
 * - depositionToCanvas becomes positive water/pigment deltas.
 */
export interface StudioWetMediaTileFieldDeposition {
  readonly cellIndex: number;
  readonly waterMassDelta: number;
  readonly pigmentMassDelta: number;
  readonly color: StudioWetMediaLinearRgba;
}

export interface StudioWetMediaTileFieldDepositionReceipt {
  readonly kind: "studio-wet-media-tile-field-deposition-receipt";
  readonly version: typeof STUDIO_WET_MEDIA_TILE_FIELD_VERSION;
  readonly tick: number;
  readonly operationCount: number;
  readonly waterMassBefore: number;
  readonly waterMassAfter: number;
  readonly appliedWaterMassDelta: number;
  readonly waterConservationError: number;
  readonly pigmentMassBefore: number;
  readonly pigmentMassAfter: number;
  readonly appliedPigmentMassDelta: number;
  readonly pigmentConservationError: number;
  readonly opticalDensityBefore: readonly [number, number, number];
  readonly opticalDensityAfter: readonly [number, number, number];
  readonly appliedOpticalDensityDelta: readonly [number, number, number];
  readonly opticalDensityConservationError: readonly [number, number, number];
}

export interface StudioWetMediaTileFieldAdvanceReceipt {
  readonly kind: "studio-wet-media-tile-field-advance-receipt";
  readonly version: typeof STUDIO_WET_MEDIA_TILE_FIELD_VERSION;
  readonly tickBefore: number;
  readonly tickAfter: number;
  readonly fixedTicks: number;
  readonly surfaceWaterBefore: number;
  readonly surfaceWaterAfter: number;
  readonly absorbedPaperWaterBefore: number;
  readonly absorbedPaperWaterAfter: number;
  readonly waterEvaporated: number;
  readonly waterConservationError: number;
  readonly mobilePigmentBefore: number;
  readonly mobilePigmentAfter: number;
  readonly fixedPigmentBefore: number;
  readonly fixedPigmentAfter: number;
  readonly pigmentFixed: number;
  readonly pigmentReactivated: number;
  readonly pigmentConservationError: number;
  readonly opticalDensityBefore: readonly [number, number, number];
  readonly opticalDensityAfter: readonly [number, number, number];
  readonly opticalDensityConservationError: readonly [number, number, number];
  readonly edgePooledWater: number;
  readonly edgePooledPigment: number;
  readonly backrunWaterMoved: number;
  readonly backrunPigmentMoved: number;
}

export interface StudioWetMediaTileFieldDepositionResult {
  readonly state: StudioWetMediaTileFieldState;
  readonly receipt: StudioWetMediaTileFieldDepositionReceipt;
}

export interface StudioWetMediaTileFieldAdvanceResult {
  readonly state: StudioWetMediaTileFieldState;
  readonly receipt: StudioWetMediaTileFieldAdvanceReceipt;
}

export type StudioWetMediaTileFieldFailureReason =
  | "not-plain-data"
  | "unknown-field"
  | "invalid-field"
  | "unsupported-version"
  | "dimension-mismatch"
  | "cell-budget-exceeded"
  | "tick-budget-exceeded"
  | "mass-budget-exceeded"
  | "insufficient-mobile-mass";

export type StudioWetMediaTileFieldResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      reason: StudioWetMediaTileFieldFailureReason;
      path: string;
    }>;

type UnknownRecord = Record<string, unknown>;

interface MutableField {
  readonly width: number;
  readonly height: number;
  tick: number;
  readonly absorption: number[];
  readonly fiberDirectionRadians: number[];
  readonly activeMask: number[];
  readonly cutBoundaryMask: number[];
  readonly surfaceWater: number[];
  readonly absorbedPaperWater: number[];
  readonly mobilePigmentMass: number[];
  readonly fixedPigmentMass: number[];
  readonly mobilePigmentOpticalDensity: [number[], number[], number[]];
  readonly fixedPigmentOpticalDensity: [number[], number[], number[]];
  readonly rewetEnergy: number[];
}

interface TickMetrics {
  waterEvaporated: number;
  pigmentFixed: number;
  pigmentReactivated: number;
  edgePooledWater: number;
  edgePooledPigment: number;
  backrunWaterMoved: number;
  backrunPigmentMoved: number;
}

const SETTINGS_KEYS = [
  "kind",
  "version",
  "model",
  "width",
  "height",
  "waterDiffusionRate",
  "pigmentDiffusionRate",
  "anisotropy",
  "absorptionRate",
  "surfaceEvaporationRate",
  "paperEvaporationRate",
  "fixationRate",
  "edgePoolingRate",
  "rewetRate",
  "backrunRate",
  "rewetEnergyDecay",
  "dryThreshold",
  "maxCellWater",
  "maxCellPigment",
] as const;

const PAPER_KEYS = [
  "kind",
  "version",
  "absorption",
  "fiberDirectionRadians",
  "activeMask",
  "cutBoundaryMask",
] as const;

const STATE_KEYS = [
  "kind",
  "version",
  "width",
  "height",
  "tick",
  "absorption",
  "fiberDirectionRadians",
  "activeMask",
  "cutBoundaryMask",
  "surfaceWater",
  "absorbedPaperWater",
  "mobilePigmentMass",
  "fixedPigmentMass",
  "mobilePigmentOpticalDensity",
  "fixedPigmentOpticalDensity",
  "rewetEnergy",
] as const;

const DEPOSITION_KEYS = [
  "cellIndex",
  "waterMassDelta",
  "pigmentMassDelta",
  "color",
] as const;

function failure(
  reason: StudioWetMediaTileFieldFailureReason,
  path: string,
): StudioWetMediaTileFieldResult<never> {
  return Object.freeze({ ok: false, reason, path });
}

function success<T>(value: T): StudioWetMediaTileFieldResult<T> {
  return Object.freeze({ ok: true, value });
}

function exactDataRecord(
  input: unknown,
  keys: readonly string[],
  path: string,
): StudioWetMediaTileFieldResult<UnknownRecord> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return failure("not-plain-data", path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return failure("not-plain-data", path);
  }
  const allowed = new Set(keys);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      return failure("unknown-field", `${path}.${String(key)}`);
    }
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) {
      return failure("invalid-field", `${path}.${key}`);
    }
  }
  return success(input as UnknownRecord);
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function safeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function inspectNumericArray(
  input: unknown,
  length: number,
  minimum: number,
  maximum: number,
  path: string,
  integer = false,
): StudioWetMediaTileFieldResult<readonly number[]> {
  if (!Array.isArray(input)) return failure("invalid-field", path);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== length) {
    return failure("dimension-mismatch", path);
  }
  const values = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (
      !descriptor
      || !("value" in descriptor)
      || !finiteInRange(descriptor.value, minimum, maximum)
      || (integer && !Number.isSafeInteger(descriptor.value))
    ) {
      return failure("invalid-field", `${path}[${index}]`);
    }
    values[index] = canonicalNumber(descriptor.value);
  }
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== "string"
      || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
      || (key !== "length" && Number(key) >= length)
    ) {
      return failure("unknown-field", `${path}.${String(key)}`);
    }
  }
  return success(Object.freeze(values));
}

function inspectColor(
  input: unknown,
  path: string,
): StudioWetMediaTileFieldResult<StudioWetMediaLinearRgba> {
  const channels = inspectNumericArray(input, 4, 0, 1, path);
  if (!channels.ok) return channels;
  return success(Object.freeze([
    channels.value[0]!,
    channels.value[1]!,
    channels.value[2]!,
    channels.value[3]!,
  ]));
}

function inspectOpticalDensityField(
  input: unknown,
  length: number,
  maximum: number,
  path: string,
): StudioWetMediaTileFieldResult<StudioWetMediaOpticalDensityField> {
  if (!Array.isArray(input)) return failure("invalid-field", path);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== 3) {
    return failure("dimension-mismatch", path);
  }
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== "string"
      || (key !== "length" && key !== "0" && key !== "1" && key !== "2")
    ) {
      return failure("unknown-field", `${path}.${String(key)}`);
    }
  }
  const channels: Array<readonly number[]> = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(channel));
    if (!descriptor || !("value" in descriptor)) {
      return failure("invalid-field", `${path}[${channel}]`);
    }
    const field = inspectNumericArray(
      descriptor.value,
      length,
      0,
      maximum,
      `${path}[${channel}]`,
    );
    if (!field.ok) return field;
    channels.push(field.value);
  }
  return success(Object.freeze([
    channels[0]!,
    channels[1]!,
    channels[2]!,
  ]));
}

function freezeArray(values: readonly number[]): readonly number[] {
  return Object.freeze(Array.from(values, canonicalNumber));
}

function freezeOpticalDensity(
  values: readonly [readonly number[], readonly number[], readonly number[]],
): StudioWetMediaOpticalDensityField {
  return Object.freeze([
    freezeArray(values[0]),
    freezeArray(values[1]),
    freezeArray(values[2]),
  ]);
}

function freezeState(field: MutableField): StudioWetMediaTileFieldState {
  return Object.freeze({
    kind: "studio-wet-media-tile-field-state",
    version: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    width: field.width,
    height: field.height,
    tick: field.tick,
    absorption: freezeArray(field.absorption),
    fiberDirectionRadians: freezeArray(field.fiberDirectionRadians),
    activeMask: freezeArray(field.activeMask),
    cutBoundaryMask: freezeArray(field.cutBoundaryMask),
    surfaceWater: freezeArray(field.surfaceWater),
    absorbedPaperWater: freezeArray(field.absorbedPaperWater),
    mobilePigmentMass: freezeArray(field.mobilePigmentMass),
    fixedPigmentMass: freezeArray(field.fixedPigmentMass),
    mobilePigmentOpticalDensity: freezeOpticalDensity(
      field.mobilePigmentOpticalDensity,
    ),
    fixedPigmentOpticalDensity: freezeOpticalDensity(
      field.fixedPigmentOpticalDensity,
    ),
    rewetEnergy: freezeArray(field.rewetEnergy),
  });
}

function mutableFromState(state: StudioWetMediaTileFieldState): MutableField {
  return {
    width: state.width,
    height: state.height,
    tick: state.tick,
    absorption: Array.from(state.absorption),
    fiberDirectionRadians: Array.from(state.fiberDirectionRadians),
    activeMask: Array.from(state.activeMask),
    cutBoundaryMask: Array.from(state.cutBoundaryMask),
    surfaceWater: Array.from(state.surfaceWater),
    absorbedPaperWater: Array.from(state.absorbedPaperWater),
    mobilePigmentMass: Array.from(state.mobilePigmentMass),
    fixedPigmentMass: Array.from(state.fixedPigmentMass),
    mobilePigmentOpticalDensity: [
      Array.from(state.mobilePigmentOpticalDensity[0]),
      Array.from(state.mobilePigmentOpticalDensity[1]),
      Array.from(state.mobilePigmentOpticalDensity[2]),
    ],
    fixedPigmentOpticalDensity: [
      Array.from(state.fixedPigmentOpticalDensity[0]),
      Array.from(state.fixedPigmentOpticalDensity[1]),
      Array.from(state.fixedPigmentOpticalDensity[2]),
    ],
    rewetEnergy: Array.from(state.rewetEnergy),
  };
}

function dimensions(settings: StudioWetMediaTileFieldSettings): number {
  return settings.width * settings.height;
}

export function parseStudioWetMediaTileFieldSettings(
  input: unknown,
): StudioWetMediaTileFieldResult<StudioWetMediaTileFieldSettings> {
  const record = exactDataRecord(input, SETTINGS_KEYS, "$");
  if (!record.ok) return record;
  if (record.value.version !== STUDIO_WET_MEDIA_TILE_FIELD_VERSION) {
    return failure("unsupported-version", "$.version");
  }
  if (
    record.value.kind !== "studio-wet-media-tile-field-settings"
    || record.value.model !== "fixed-step-anisotropic-paper-v1"
  ) {
    return failure("invalid-field", "$.kind");
  }
  if (
    !safeIntegerInRange(
      record.value.width,
      1,
      STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxWidth,
    )
    || !safeIntegerInRange(
      record.value.height,
      1,
      STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxHeight,
    )
  ) {
    return failure("invalid-field", "$.width");
  }
  if (
    record.value.width * record.value.height
    > STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxCells
  ) {
    return failure("cell-budget-exceeded", "$.width");
  }
  for (
    const key of [
      "waterDiffusionRate",
      "pigmentDiffusionRate",
      "edgePoolingRate",
      "backrunRate",
    ] as const
  ) {
    if (!finiteInRange(record.value[key], 0, 0.25)) {
      return failure("invalid-field", `$.${key}`);
    }
  }
  for (
    const key of [
      "absorptionRate",
      "surfaceEvaporationRate",
      "paperEvaporationRate",
      "fixationRate",
      "rewetRate",
      "rewetEnergyDecay",
    ] as const
  ) {
    if (!finiteInRange(record.value[key], 0, 1)) {
      return failure("invalid-field", `$.${key}`);
    }
  }
  if (!finiteInRange(record.value.anisotropy, 0, 0.95)) {
    return failure("invalid-field", "$.anisotropy");
  }
  for (const key of ["dryThreshold", "maxCellWater", "maxCellPigment"] as const) {
    if (
      !finiteInRange(
        record.value[key],
        key === "dryThreshold" ? Number.MIN_VALUE : 0,
        STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxCellMass,
      )
    ) {
      return failure("invalid-field", `$.${key}`);
    }
  }
  if (
    (record.value.maxCellWater as number) <= 0
    || (record.value.maxCellPigment as number) <= 0
    || (record.value.dryThreshold as number) > (record.value.maxCellWater as number)
  ) {
    return failure("invalid-field", "$.maxCellWater");
  }

  return success(Object.freeze({
    kind: "studio-wet-media-tile-field-settings",
    version: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    model: "fixed-step-anisotropic-paper-v1",
    width: record.value.width,
    height: record.value.height,
    waterDiffusionRate: canonicalNumber(record.value.waterDiffusionRate as number),
    pigmentDiffusionRate: canonicalNumber(record.value.pigmentDiffusionRate as number),
    anisotropy: canonicalNumber(record.value.anisotropy as number),
    absorptionRate: canonicalNumber(record.value.absorptionRate as number),
    surfaceEvaporationRate: canonicalNumber(
      record.value.surfaceEvaporationRate as number,
    ),
    paperEvaporationRate: canonicalNumber(record.value.paperEvaporationRate as number),
    fixationRate: canonicalNumber(record.value.fixationRate as number),
    edgePoolingRate: canonicalNumber(record.value.edgePoolingRate as number),
    rewetRate: canonicalNumber(record.value.rewetRate as number),
    backrunRate: canonicalNumber(record.value.backrunRate as number),
    rewetEnergyDecay: canonicalNumber(record.value.rewetEnergyDecay as number),
    dryThreshold: canonicalNumber(record.value.dryThreshold as number),
    maxCellWater: canonicalNumber(record.value.maxCellWater as number),
    maxCellPigment: canonicalNumber(record.value.maxCellPigment as number),
  }));
}

export function parseStudioWetMediaTileFieldPaper(
  input: unknown,
  settingsInput: unknown,
): StudioWetMediaTileFieldResult<StudioWetMediaTileFieldPaper> {
  const settings = parseStudioWetMediaTileFieldSettings(settingsInput);
  if (!settings.ok) return settings;
  const record = exactDataRecord(input, PAPER_KEYS, "$");
  if (!record.ok) return record;
  if (record.value.version !== STUDIO_WET_MEDIA_TILE_FIELD_VERSION) {
    return failure("unsupported-version", "$.version");
  }
  if (record.value.kind !== "studio-wet-media-tile-field-paper") {
    return failure("invalid-field", "$.kind");
  }
  const cellCount = dimensions(settings.value);
  const absorption = inspectNumericArray(
    record.value.absorption,
    cellCount,
    0,
    1,
    "$.absorption",
  );
  if (!absorption.ok) return absorption;
  const fibre = inspectNumericArray(
    record.value.fiberDirectionRadians,
    cellCount,
    -Math.PI,
    Math.PI,
    "$.fiberDirectionRadians",
  );
  if (!fibre.ok) return fibre;
  const active = inspectNumericArray(
    record.value.activeMask,
    cellCount,
    0,
    1,
    "$.activeMask",
    true,
  );
  if (!active.ok) return active;
  const cuts = inspectNumericArray(
    record.value.cutBoundaryMask,
    cellCount,
    0,
    15,
    "$.cutBoundaryMask",
    true,
  );
  if (!cuts.ok) return cuts;
  return success(Object.freeze({
    kind: "studio-wet-media-tile-field-paper",
    version: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    absorption: absorption.value,
    fiberDirectionRadians: fibre.value,
    activeMask: active.value,
    cutBoundaryMask: cuts.value,
  }));
}

export function parseStudioWetMediaTileFieldState(
  input: unknown,
  settingsInput: unknown,
): StudioWetMediaTileFieldResult<StudioWetMediaTileFieldState> {
  const settings = parseStudioWetMediaTileFieldSettings(settingsInput);
  if (!settings.ok) return settings;
  const record = exactDataRecord(input, STATE_KEYS, "$");
  if (!record.ok) return record;
  if (record.value.version !== STUDIO_WET_MEDIA_TILE_FIELD_VERSION) {
    return failure("unsupported-version", "$.version");
  }
  if (record.value.kind !== "studio-wet-media-tile-field-state") {
    return failure("invalid-field", "$.kind");
  }
  if (
    record.value.width !== settings.value.width
    || record.value.height !== settings.value.height
  ) {
    return failure("dimension-mismatch", "$.width");
  }
  if (
    !safeIntegerInRange(
      record.value.tick,
      0,
      STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxTick,
    )
  ) {
    return failure("invalid-field", "$.tick");
  }
  const cellCount = dimensions(settings.value);
  const maximumOpticalDensity =
    settings.value.maxCellPigment
    * STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxOpticalDensity;

  const absorption = inspectNumericArray(
    record.value.absorption,
    cellCount,
    0,
    1,
    "$.absorption",
  );
  if (!absorption.ok) return absorption;
  const fibre = inspectNumericArray(
    record.value.fiberDirectionRadians,
    cellCount,
    -Math.PI,
    Math.PI,
    "$.fiberDirectionRadians",
  );
  if (!fibre.ok) return fibre;
  const active = inspectNumericArray(
    record.value.activeMask,
    cellCount,
    0,
    1,
    "$.activeMask",
    true,
  );
  if (!active.ok) return active;
  const cuts = inspectNumericArray(
    record.value.cutBoundaryMask,
    cellCount,
    0,
    15,
    "$.cutBoundaryMask",
    true,
  );
  if (!cuts.ok) return cuts;
  const surface = inspectNumericArray(
    record.value.surfaceWater,
    cellCount,
    0,
    settings.value.maxCellWater,
    "$.surfaceWater",
  );
  if (!surface.ok) return surface;
  const paperWater = inspectNumericArray(
    record.value.absorbedPaperWater,
    cellCount,
    0,
    settings.value.maxCellWater,
    "$.absorbedPaperWater",
  );
  if (!paperWater.ok) return paperWater;
  const mobileMass = inspectNumericArray(
    record.value.mobilePigmentMass,
    cellCount,
    0,
    settings.value.maxCellPigment,
    "$.mobilePigmentMass",
  );
  if (!mobileMass.ok) return mobileMass;
  const fixedMass = inspectNumericArray(
    record.value.fixedPigmentMass,
    cellCount,
    0,
    settings.value.maxCellPigment,
    "$.fixedPigmentMass",
  );
  if (!fixedMass.ok) return fixedMass;
  const mobileDensity = inspectOpticalDensityField(
    record.value.mobilePigmentOpticalDensity,
    cellCount,
    maximumOpticalDensity,
    "$.mobilePigmentOpticalDensity",
  );
  if (!mobileDensity.ok) return mobileDensity;
  const fixedDensity = inspectOpticalDensityField(
    record.value.fixedPigmentOpticalDensity,
    cellCount,
    maximumOpticalDensity,
    "$.fixedPigmentOpticalDensity",
  );
  if (!fixedDensity.ok) return fixedDensity;
  const energy = inspectNumericArray(
    record.value.rewetEnergy,
    cellCount,
    0,
    settings.value.maxCellWater,
    "$.rewetEnergy",
  );
  if (!energy.ok) return energy;

  for (let index = 0; index < cellCount; index += 1) {
    if (
      mobileMass.value[index]! + fixedMass.value[index]!
      > settings.value.maxCellPigment
    ) {
      return failure("mass-budget-exceeded", `$.mobilePigmentMass[${index}]`);
    }
    if (
      active.value[index] === 0
      && (
        surface.value[index] !== 0
        || paperWater.value[index] !== 0
        || mobileMass.value[index] !== 0
        || fixedMass.value[index] !== 0
        || energy.value[index] !== 0
      )
    ) {
      return failure("invalid-field", `$.activeMask[${index}]`);
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const mobileMaximum =
        mobileMass.value[index]!
        * STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxOpticalDensity;
      const fixedMaximum =
        fixedMass.value[index]!
        * STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxOpticalDensity;
      const mobileTolerance = Math.max(1e-12, mobileMaximum * 1e-12);
      const fixedTolerance = Math.max(1e-12, fixedMaximum * 1e-12);
      if (
        mobileDensity.value[channel][index]!
        > mobileMaximum + mobileTolerance
      ) {
        return failure(
          "invalid-field",
          `$.mobilePigmentOpticalDensity[${channel}][${index}]`,
        );
      }
      if (
        fixedDensity.value[channel][index]!
        > fixedMaximum + fixedTolerance
      ) {
        return failure(
          "invalid-field",
          `$.fixedPigmentOpticalDensity[${channel}][${index}]`,
        );
      }
    }
  }

  return success(Object.freeze({
    kind: "studio-wet-media-tile-field-state",
    version: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    width: settings.value.width,
    height: settings.value.height,
    tick: record.value.tick,
    absorption: absorption.value,
    fiberDirectionRadians: fibre.value,
    activeMask: active.value,
    cutBoundaryMask: cuts.value,
    surfaceWater: surface.value,
    absorbedPaperWater: paperWater.value,
    mobilePigmentMass: mobileMass.value,
    fixedPigmentMass: fixedMass.value,
    mobilePigmentOpticalDensity: mobileDensity.value,
    fixedPigmentOpticalDensity: fixedDensity.value,
    rewetEnergy: energy.value,
  }));
}

export function createStudioWetMediaTileField(
  settingsInput: unknown,
  paperInput: unknown,
): StudioWetMediaTileFieldResult<StudioWetMediaTileFieldState> {
  const settings = parseStudioWetMediaTileFieldSettings(settingsInput);
  if (!settings.ok) return settings;
  const paper = parseStudioWetMediaTileFieldPaper(paperInput, settings.value);
  if (!paper.ok) return paper;
  const cellCount = dimensions(settings.value);
  const zeros = (): number[] => new Array<number>(cellCount).fill(0);
  return success(freezeState({
    width: settings.value.width,
    height: settings.value.height,
    tick: 0,
    absorption: Array.from(paper.value.absorption),
    fiberDirectionRadians: Array.from(paper.value.fiberDirectionRadians),
    activeMask: Array.from(paper.value.activeMask),
    cutBoundaryMask: Array.from(paper.value.cutBoundaryMask),
    surfaceWater: zeros(),
    absorbedPaperWater: zeros(),
    mobilePigmentMass: zeros(),
    fixedPigmentMass: zeros(),
    mobilePigmentOpticalDensity: [zeros(), zeros(), zeros()],
    fixedPigmentOpticalDensity: [zeros(), zeros(), zeros()],
    rewetEnergy: zeros(),
  }));
}

function total(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}

function totalOpticalDensity(
  mobile: StudioWetMediaOpticalDensityField | [number[], number[], number[]],
  fixed: StudioWetMediaOpticalDensityField | [number[], number[], number[]],
): readonly [number, number, number] {
  return Object.freeze([
    total(mobile[0]) + total(fixed[0]),
    total(mobile[1]) + total(fixed[1]),
    total(mobile[2]) + total(fixed[2]),
  ]);
}

function inspectDepositions(
  input: unknown,
  settings: StudioWetMediaTileFieldSettings,
): StudioWetMediaTileFieldResult<readonly StudioWetMediaTileFieldDeposition[]> {
  if (!Array.isArray(input)) return failure("invalid-field", "$.depositions");
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (
    !lengthDescriptor
    || !("value" in lengthDescriptor)
    || !safeIntegerInRange(
      lengthDescriptor.value,
      0,
      STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxDepositionOperations,
    )
  ) {
    return failure("mass-budget-exceeded", "$.depositions.length");
  }
  const operations: StudioWetMediaTileFieldDeposition[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) {
      return failure("invalid-field", `$.depositions[${index}]`);
    }
    const record = exactDataRecord(
      descriptor.value,
      DEPOSITION_KEYS,
      `$.depositions[${index}]`,
    );
    if (!record.ok) return record;
    if (
      !safeIntegerInRange(
        record.value.cellIndex,
        0,
        dimensions(settings) - 1,
      )
      || !finiteInRange(
        record.value.waterMassDelta,
        -settings.maxCellWater,
        settings.maxCellWater,
      )
      || !finiteInRange(
        record.value.pigmentMassDelta,
        -settings.maxCellPigment,
        settings.maxCellPigment,
      )
    ) {
      return failure("invalid-field", `$.depositions[${index}]`);
    }
    const color = inspectColor(record.value.color, `$.depositions[${index}].color`);
    if (!color.ok) return color;
    operations.push(Object.freeze({
      cellIndex: record.value.cellIndex,
      waterMassDelta: canonicalNumber(record.value.waterMassDelta as number),
      pigmentMassDelta: canonicalNumber(record.value.pigmentMassDelta as number),
      color: color.value,
    }));
  }
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== "string"
      || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
      || (key !== "length" && Number(key) >= lengthDescriptor.value)
    ) {
      return failure("unknown-field", `$.depositions.${String(key)}`);
    }
  }
  return success(Object.freeze(operations));
}

function densityFromReflectance(channel: number): number {
  return -Math.log(
    Math.max(
      Math.exp(-STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxOpticalDensity),
      channel,
    ),
  );
}

function removePigment(
  mass: number[],
  density: [number[], number[], number[]],
  index: number,
  amount: number,
): readonly [number, number, number] {
  const before = mass[index]!;
  if (amount <= 0 || before <= 0) return Object.freeze([0, 0, 0]);
  const fraction = Math.min(1, amount / before);
  const removed: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const channelAmount = density[channel][index]! * fraction;
    density[channel][index] = Math.max(0, density[channel][index]! - channelAmount);
    removed[channel] = channelAmount;
  }
  mass[index] = Math.max(0, before - amount);
  return Object.freeze(removed);
}

function addPigment(
  mass: number[],
  density: [number[], number[], number[]],
  index: number,
  amount: number,
  color: StudioWetMediaLinearRgba,
): readonly [number, number, number] {
  const added: [number, number, number] = [0, 0, 0];
  mass[index] = mass[index]! + amount;
  for (let channel = 0; channel < 3; channel += 1) {
    const channelAmount = densityFromReflectance(color[channel]!) * amount;
    density[channel][index] = density[channel][index]! + channelAmount;
    added[channel] = channelAmount;
  }
  return Object.freeze(added);
}

export function applyStudioWetMediaTileFieldDepositions(
  settingsInput: unknown,
  stateInput: unknown,
  depositionsInput: unknown,
): StudioWetMediaTileFieldResult<StudioWetMediaTileFieldDepositionResult> {
  const settings = parseStudioWetMediaTileFieldSettings(settingsInput);
  if (!settings.ok) return settings;
  const state = parseStudioWetMediaTileFieldState(stateInput, settings.value);
  if (!state.ok) return state;
  const depositions = inspectDepositions(depositionsInput, settings.value);
  if (!depositions.ok) return depositions;

  const mutable = mutableFromState(state.value);
  const waterBefore = total(mutable.surfaceWater) + total(mutable.absorbedPaperWater);
  const pigmentBefore =
    total(mutable.mobilePigmentMass) + total(mutable.fixedPigmentMass);
  const densityBefore = totalOpticalDensity(
    mutable.mobilePigmentOpticalDensity,
    mutable.fixedPigmentOpticalDensity,
  );
  let waterDelta = 0;
  let pigmentDelta = 0;
  const densityDelta: [number, number, number] = [0, 0, 0];

  for (let operationIndex = 0; operationIndex < depositions.value.length; operationIndex += 1) {
    const operation = depositions.value[operationIndex]!;
    const index = operation.cellIndex;
    if (mutable.activeMask[index] !== 1) {
      return failure("invalid-field", `$.depositions[${operationIndex}].cellIndex`);
    }

    const nextSurface = mutable.surfaceWater[index]! + operation.waterMassDelta;
    if (nextSurface < 0) {
      return failure(
        "insufficient-mobile-mass",
        `$.depositions[${operationIndex}].waterMassDelta`,
      );
    }
    if (nextSurface > settings.value.maxCellWater) {
      return failure(
        "mass-budget-exceeded",
        `$.depositions[${operationIndex}].waterMassDelta`,
      );
    }
    const totalCellPigment =
      mutable.mobilePigmentMass[index]! + mutable.fixedPigmentMass[index]!;
    if (
      operation.pigmentMassDelta < 0
      && -operation.pigmentMassDelta > mutable.mobilePigmentMass[index]!
    ) {
      return failure(
        "insufficient-mobile-mass",
        `$.depositions[${operationIndex}].pigmentMassDelta`,
      );
    }
    if (
      operation.pigmentMassDelta > 0
      && totalCellPigment + operation.pigmentMassDelta > settings.value.maxCellPigment
    ) {
      return failure(
        "mass-budget-exceeded",
        `$.depositions[${operationIndex}].pigmentMassDelta`,
      );
    }

    const wasDry = mutable.surfaceWater[index]! <= settings.value.dryThreshold;
    mutable.surfaceWater[index] = nextSurface;
    waterDelta += operation.waterMassDelta;
    if (operation.waterMassDelta > 0 && wasDry) {
      mutable.rewetEnergy[index] = Math.min(
        settings.value.maxCellWater,
        mutable.rewetEnergy[index]! + operation.waterMassDelta,
      );
    }

    if (operation.pigmentMassDelta > 0) {
      const added = addPigment(
        mutable.mobilePigmentMass,
        mutable.mobilePigmentOpticalDensity,
        index,
        operation.pigmentMassDelta,
        operation.color,
      );
      for (let channel = 0; channel < 3; channel += 1) {
        densityDelta[channel] += added[channel]!;
      }
    } else if (operation.pigmentMassDelta < 0) {
      const removed = removePigment(
        mutable.mobilePigmentMass,
        mutable.mobilePigmentOpticalDensity,
        index,
        -operation.pigmentMassDelta,
      );
      for (let channel = 0; channel < 3; channel += 1) {
        densityDelta[channel] -= removed[channel]!;
      }
    }
    pigmentDelta += operation.pigmentMassDelta;
  }

  const frozenState = freezeState(mutable);
  const waterAfter =
    total(frozenState.surfaceWater) + total(frozenState.absorbedPaperWater);
  const pigmentAfter =
    total(frozenState.mobilePigmentMass) + total(frozenState.fixedPigmentMass);
  const densityAfter = totalOpticalDensity(
    frozenState.mobilePigmentOpticalDensity,
    frozenState.fixedPigmentOpticalDensity,
  );
  const densityError = Object.freeze([
    densityAfter[0] - densityBefore[0] - densityDelta[0],
    densityAfter[1] - densityBefore[1] - densityDelta[1],
    densityAfter[2] - densityBefore[2] - densityDelta[2],
  ]) as readonly [number, number, number];
  const receipt: StudioWetMediaTileFieldDepositionReceipt = Object.freeze({
    kind: "studio-wet-media-tile-field-deposition-receipt",
    version: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    tick: frozenState.tick,
    operationCount: depositions.value.length,
    waterMassBefore: waterBefore,
    waterMassAfter: waterAfter,
    appliedWaterMassDelta: waterDelta,
    waterConservationError: waterAfter - waterBefore - waterDelta,
    pigmentMassBefore: pigmentBefore,
    pigmentMassAfter: pigmentAfter,
    appliedPigmentMassDelta: pigmentDelta,
    pigmentConservationError: pigmentAfter - pigmentBefore - pigmentDelta,
    opticalDensityBefore: densityBefore,
    opticalDensityAfter: densityAfter,
    appliedOpticalDensityDelta: Object.freeze([
      densityDelta[0],
      densityDelta[1],
      densityDelta[2],
    ]) as readonly [number, number, number],
    opticalDensityConservationError: densityError,
  });
  return success(Object.freeze({ state: frozenState, receipt }));
}

function edgeOpen(
  field: MutableField,
  left: number,
  right: number,
  leftCut: number,
  rightCut: number,
): boolean {
  return field.activeMask[left] === 1
    && field.activeMask[right] === 1
    && (field.cutBoundaryMask[left]! & leftCut) === 0
    && (field.cutBoundaryMask[right]! & rightCut) === 0;
}

function forEachOpenPair(
  field: MutableField,
  visit: (
    left: number,
    right: number,
    axisX: number,
    axisY: number,
  ) => void,
): void {
  for (let y = 0; y < field.height; y += 1) {
    const row = y * field.width;
    for (let x = 0; x + 1 < field.width; x += 1) {
      const left = row + x;
      const right = left + 1;
      if (
        edgeOpen(
          field,
          left,
          right,
          STUDIO_WET_MEDIA_CUT.east,
          STUDIO_WET_MEDIA_CUT.west,
        )
      ) {
        visit(left, right, 1, 0);
      }
    }
  }
  for (let y = 0; y + 1 < field.height; y += 1) {
    const row = y * field.width;
    const nextRow = row + field.width;
    for (let x = 0; x < field.width; x += 1) {
      const top = row + x;
      const bottom = nextRow + x;
      if (
        edgeOpen(
          field,
          top,
          bottom,
          STUDIO_WET_MEDIA_CUT.south,
          STUDIO_WET_MEDIA_CUT.north,
        )
      ) {
        visit(top, bottom, 0, 1);
      }
    }
  }
}

function pairConductance(
  field: MutableField,
  left: number,
  right: number,
  axisX: number,
  axisY: number,
  anisotropy: number,
): number {
  if (anisotropy <= 0) return 1;
  const leftAngle = field.fiberDirectionRadians[left]!;
  const rightAngle = field.fiberDirectionRadians[right]!;
  const leftAlignment =
    (Math.cos(leftAngle) * axisX + Math.sin(leftAngle) * axisY) ** 2;
  const rightAlignment =
    (Math.cos(rightAngle) * axisX + Math.sin(rightAngle) * axisY) ** 2;
  const alignment = (leftAlignment + rightAlignment) / 2;
  return 1 - anisotropy + 2 * anisotropy * alignment;
}

function transferScalar(
  values: number[],
  from: number,
  to: number,
  requested: number,
  destinationMaximum = Number.POSITIVE_INFINITY,
): number {
  const destinationCapacity = Math.max(0, destinationMaximum - values[to]!);
  const amount = Math.min(
    Math.max(0, requested),
    values[from]!,
    destinationCapacity,
  );
  if (amount <= 0) return 0;
  values[from] = Math.max(0, values[from]! - amount);
  values[to] = values[to]! + amount;
  return amount;
}

function parsePigmentChannelRates(
  input: unknown,
): StudioWetMediaTileFieldResult<StudioWetMediaPigmentChannelRates> {
  if (input === undefined) {
    return success(STUDIO_WET_MEDIA_LOCKSTEP_PIGMENT_CHANNEL_RATES);
  }
  const parsed = inspectNumericArray(input, 3, 0, 8, "$.pigmentChannelRates");
  if (!parsed.ok) return parsed;
  return success(Object.freeze([
    parsed.value[0]!,
    parsed.value[1]!,
    parsed.value[2]!,
  ]));
}

function transferOpticalDensityChannel(
  density: [number[], number[], number[]],
  mass: number[],
  channel: number,
  from: number,
  to: number,
  requested: number,
): number {
  const destinationCapacity = Math.max(
    0,
    mass[to]! * STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxOpticalDensity
    - density[channel][to]!,
  );
  const amount = Math.min(
    Math.max(0, requested),
    density[channel][from]!,
    destinationCapacity,
  );
  if (amount <= 0) return 0;
  density[channel][from] = Math.max(0, density[channel][from]! - amount);
  density[channel][to] = density[channel][to]! + amount;
  return amount;
}

function transferPigment(
  mass: number[],
  density: [number[], number[], number[]],
  from: number,
  to: number,
  requested: number,
  destinationMaximum = Number.POSITIVE_INFINITY,
): number {
  const before = mass[from]!;
  const destinationCapacity = Math.max(0, destinationMaximum - mass[to]!);
  const amount = Math.min(
    Math.max(0, requested),
    before,
    destinationCapacity,
  );
  if (amount <= 0 || before <= 0) return 0;
  const fraction = amount / before;
  mass[from] = Math.max(0, before - amount);
  mass[to] = mass[to]! + amount;
  for (let channel = 0; channel < 3; channel += 1) {
    const moved = density[channel][from]! * fraction;
    density[channel][from] = Math.max(0, density[channel][from]! - moved);
    density[channel][to] = density[channel][to]! + moved;
  }
  return amount;
}

function diffuseWater(
  field: MutableField,
  settings: StudioWetMediaTileFieldSettings,
): void {
  forEachOpenPair(field, (left, right, axisX, axisY) => {
    const difference = field.surfaceWater[left]! - field.surfaceWater[right]!;
    if (difference === 0) return;
    const coefficient = Math.min(
      0.49,
      settings.waterDiffusionRate
      * pairConductance(
        field,
        left,
        right,
        axisX,
        axisY,
        settings.anisotropy,
      ),
    );
    const requested = Math.abs(difference) * coefficient;
    if (difference > 0) {
      transferScalar(
        field.surfaceWater,
        left,
        right,
        requested,
        settings.maxCellWater,
      );
    } else {
      transferScalar(
        field.surfaceWater,
        right,
        left,
        requested,
        settings.maxCellWater,
      );
    }
  });
}

function diffuseMobilePigment(
  field: MutableField,
  settings: StudioWetMediaTileFieldSettings,
  channelRates: StudioWetMediaPigmentChannelRates,
): void {
  forEachOpenPair(field, (left, right, axisX, axisY) => {
    const wetMobility = Math.min(
      1,
      (
        field.surfaceWater[left]!
        + field.surfaceWater[right]!
      ) / (2 * settings.dryThreshold),
    );
    if (wetMobility <= 0) return;
    const coefficient = Math.min(
      0.49,
      settings.pigmentDiffusionRate
      * wetMobility
      * pairConductance(
        field,
        left,
        right,
        axisX,
        axisY,
        settings.anisotropy,
      ),
    );
    if (coefficient <= 0) return;

    const massDifference =
      field.mobilePigmentMass[left]! - field.mobilePigmentMass[right]!;
    if (massDifference !== 0) {
      const requested = Math.abs(massDifference) * coefficient;
      if (massDifference > 0) {
        transferPigment(
          field.mobilePigmentMass,
          field.mobilePigmentOpticalDensity,
          left,
          right,
          requested,
          settings.maxCellPigment - field.fixedPigmentMass[right]!,
        );
      } else {
        transferPigment(
          field.mobilePigmentMass,
          field.mobilePigmentOpticalDensity,
          right,
          left,
          requested,
          settings.maxCellPigment - field.fixedPigmentMass[left]!,
        );
      }
    }

    // Faster dye species (rate > 1) outrun the lockstep mass front. Rates ≤ 1
    // stay with the carrier so lockstep `[1,1,1]` remains the historical step.
    for (let channel = 0; channel < 3; channel += 1) {
      const extraRate = channelRates[channel]! - 1;
      if (extraRate <= 0) continue;
      const densityDifference =
        field.mobilePigmentOpticalDensity[channel][left]!
        - field.mobilePigmentOpticalDensity[channel][right]!;
      if (densityDifference === 0) continue;
      const requested = Math.abs(densityDifference) * coefficient * extraRate;
      if (densityDifference > 0) {
        transferOpticalDensityChannel(
          field.mobilePigmentOpticalDensity,
          field.mobilePigmentMass,
          channel,
          left,
          right,
          requested,
        );
      } else {
        transferOpticalDensityChannel(
          field.mobilePigmentOpticalDensity,
          field.mobilePigmentMass,
          channel,
          right,
          left,
          requested,
        );
      }
    }
  });
}

function applyBackrun(
  field: MutableField,
  settings: StudioWetMediaTileFieldSettings,
  metrics: TickMetrics,
): void {
  if (settings.backrunRate <= 0) return;
  forEachOpenPair(field, (left, right, axisX, axisY) => {
    const difference = field.rewetEnergy[left]! - field.rewetEnergy[right]!;
    if (difference === 0) return;
    const from = difference > 0 ? left : right;
    const to = difference > 0 ? right : left;
    const conductance = pairConductance(
      field,
      left,
      right,
      axisX,
      axisY,
      settings.anisotropy,
    );
    const energyRequested = Math.abs(difference)
      * settings.backrunRate
      * conductance;
    const waterBefore = field.surfaceWater[from]!;
    const waterMoved = transferScalar(
      field.surfaceWater,
      from,
      to,
      Math.min(energyRequested, waterBefore),
      settings.maxCellWater,
    );
    const pigmentMoved = waterBefore <= 0
      ? 0
      : transferPigment(
          field.mobilePigmentMass,
          field.mobilePigmentOpticalDensity,
          from,
          to,
          field.mobilePigmentMass[from]! * Math.min(1, waterMoved / waterBefore),
          settings.maxCellPigment - field.fixedPigmentMass[to]!,
        );
    transferScalar(
      field.rewetEnergy,
      from,
      to,
      energyRequested,
      settings.maxCellWater,
    );
    metrics.backrunWaterMoved += waterMoved;
    metrics.backrunPigmentMoved += pigmentMoved;
  });
}

function openDegree(field: MutableField, index: number): number {
  if (field.activeMask[index] !== 1) return 0;
  const x = index % field.width;
  const y = Math.floor(index / field.width);
  let degree = 0;
  if (
    y > 0
    && edgeOpen(
      field,
      index,
      index - field.width,
      STUDIO_WET_MEDIA_CUT.north,
      STUDIO_WET_MEDIA_CUT.south,
    )
  ) degree += 1;
  if (
    x + 1 < field.width
    && edgeOpen(
      field,
      index,
      index + 1,
      STUDIO_WET_MEDIA_CUT.east,
      STUDIO_WET_MEDIA_CUT.west,
    )
  ) degree += 1;
  if (
    y + 1 < field.height
    && edgeOpen(
      field,
      index,
      index + field.width,
      STUDIO_WET_MEDIA_CUT.south,
      STUDIO_WET_MEDIA_CUT.north,
    )
  ) degree += 1;
  if (
    x > 0
    && edgeOpen(
      field,
      index,
      index - 1,
      STUDIO_WET_MEDIA_CUT.west,
      STUDIO_WET_MEDIA_CUT.east,
    )
  ) degree += 1;
  return degree;
}

function applyEdgePooling(
  field: MutableField,
  settings: StudioWetMediaTileFieldSettings,
  metrics: TickMetrics,
): void {
  if (settings.edgePoolingRate <= 0) return;
  const degrees = field.activeMask.map((_, index) => openDegree(field, index));
  forEachOpenPair(field, (left, right) => {
    const leftAffinity = 4 - degrees[left]!;
    const rightAffinity = 4 - degrees[right]!;
    if (leftAffinity === rightAffinity) return;
    const from = leftAffinity < rightAffinity ? left : right;
    const to = leftAffinity < rightAffinity ? right : left;
    const affinityDifference = Math.abs(leftAffinity - rightAffinity) / 4;
    const waterBefore = field.surfaceWater[from]!;
    const requested =
      waterBefore * settings.edgePoolingRate * affinityDifference;
    const waterMoved = transferScalar(
      field.surfaceWater,
      from,
      to,
      requested,
      settings.maxCellWater,
    );
    const pigmentMoved = waterBefore <= 0
      ? 0
      : transferPigment(
          field.mobilePigmentMass,
          field.mobilePigmentOpticalDensity,
          from,
          to,
          field.mobilePigmentMass[from]! * Math.min(1, waterMoved / waterBefore),
          settings.maxCellPigment - field.fixedPigmentMass[to]!,
        );
    metrics.edgePooledWater += waterMoved;
    metrics.edgePooledPigment += pigmentMoved;
  });
}

function transferPigmentPhase(
  sourceMass: number[],
  sourceDensity: [number[], number[], number[]],
  destinationMass: number[],
  destinationDensity: [number[], number[], number[]],
  index: number,
  requested: number,
): number {
  const before = sourceMass[index]!;
  const amount = Math.min(Math.max(0, requested), before);
  if (amount <= 0 || before <= 0) return 0;
  const fraction = amount / before;
  sourceMass[index] = Math.max(0, before - amount);
  destinationMass[index] = destinationMass[index]! + amount;
  for (let channel = 0; channel < 3; channel += 1) {
    const moved = sourceDensity[channel][index]! * fraction;
    sourceDensity[channel][index] = Math.max(
      0,
      sourceDensity[channel][index]! - moved,
    );
    destinationDensity[channel][index] =
      destinationDensity[channel][index]! + moved;
  }
  return amount;
}

function applyCellPhases(
  field: MutableField,
  settings: StudioWetMediaTileFieldSettings,
  metrics: TickMetrics,
): void {
  for (let index = 0; index < field.surfaceWater.length; index += 1) {
    if (field.activeMask[index] !== 1) continue;

    const absorptionCapacity =
      settings.maxCellWater - field.absorbedPaperWater[index]!;
    const absorbed = Math.min(
      field.surfaceWater[index]!
      * settings.absorptionRate
      * field.absorption[index]!,
      absorptionCapacity,
    );
    field.surfaceWater[index] = Math.max(0, field.surfaceWater[index]! - absorbed);
    field.absorbedPaperWater[index] =
      field.absorbedPaperWater[index]! + absorbed;

    const wetActivation = Math.min(
      1,
      (
        field.surfaceWater[index]!
        + field.rewetEnergy[index]!
      ) / settings.dryThreshold,
    );
    const reactivated = transferPigmentPhase(
      field.fixedPigmentMass,
      field.fixedPigmentOpticalDensity,
      field.mobilePigmentMass,
      field.mobilePigmentOpticalDensity,
      index,
      field.fixedPigmentMass[index]! * settings.rewetRate * wetActivation,
    );
    metrics.pigmentReactivated += reactivated;

    const dryness = 1 - Math.min(
      1,
      field.surfaceWater[index]! / settings.dryThreshold,
    );
    const fixed = transferPigmentPhase(
      field.mobilePigmentMass,
      field.mobilePigmentOpticalDensity,
      field.fixedPigmentMass,
      field.fixedPigmentOpticalDensity,
      index,
      field.mobilePigmentMass[index]! * settings.fixationRate * dryness,
    );
    metrics.pigmentFixed += fixed;

    const surfaceEvaporated =
      field.surfaceWater[index]! * settings.surfaceEvaporationRate;
    const paperEvaporated =
      field.absorbedPaperWater[index]! * settings.paperEvaporationRate;
    field.surfaceWater[index] = Math.max(
      0,
      field.surfaceWater[index]! - surfaceEvaporated,
    );
    field.absorbedPaperWater[index] = Math.max(
      0,
      field.absorbedPaperWater[index]! - paperEvaporated,
    );
    metrics.waterEvaporated += surfaceEvaporated + paperEvaporated;
    field.rewetEnergy[index] =
      field.rewetEnergy[index]! * (1 - settings.rewetEnergyDecay);
  }
}

function advanceOneTick(
  field: MutableField,
  settings: StudioWetMediaTileFieldSettings,
  metrics: TickMetrics,
  channelRates: StudioWetMediaPigmentChannelRates,
): void {
  diffuseWater(field, settings);
  diffuseMobilePigment(field, settings, channelRates);
  applyBackrun(field, settings, metrics);
  applyEdgePooling(field, settings, metrics);
  applyCellPhases(field, settings, metrics);
  field.tick += 1;
}

export function advanceStudioWetMediaTileField(
  settingsInput: unknown,
  stateInput: unknown,
  fixedTicksInput: unknown,
  pigmentChannelRatesInput?: unknown,
): StudioWetMediaTileFieldResult<StudioWetMediaTileFieldAdvanceResult> {
  const settings = parseStudioWetMediaTileFieldSettings(settingsInput);
  if (!settings.ok) return settings;
  const state = parseStudioWetMediaTileFieldState(stateInput, settings.value);
  if (!state.ok) return state;
  const channelRates = parsePigmentChannelRates(pigmentChannelRatesInput);
  if (!channelRates.ok) return channelRates;
  if (
    !safeIntegerInRange(
      fixedTicksInput,
      1,
      STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxTicksPerAdvance,
    )
  ) {
    return failure("tick-budget-exceeded", "$.fixedTicks");
  }
  if (
    state.value.tick + fixedTicksInput
    > STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxTick
  ) {
    return failure("tick-budget-exceeded", "$.fixedTicks");
  }

  const mutable = mutableFromState(state.value);
  const surfaceBefore = total(mutable.surfaceWater);
  const paperWaterBefore = total(mutable.absorbedPaperWater);
  const mobileBefore = total(mutable.mobilePigmentMass);
  const fixedBefore = total(mutable.fixedPigmentMass);
  const densityBefore = totalOpticalDensity(
    mutable.mobilePigmentOpticalDensity,
    mutable.fixedPigmentOpticalDensity,
  );
  const metrics: TickMetrics = {
    waterEvaporated: 0,
    pigmentFixed: 0,
    pigmentReactivated: 0,
    edgePooledWater: 0,
    edgePooledPigment: 0,
    backrunWaterMoved: 0,
    backrunPigmentMoved: 0,
  };

  for (let tick = 0; tick < fixedTicksInput; tick += 1) {
    advanceOneTick(mutable, settings.value, metrics, channelRates.value);
  }

  const frozenState = freezeState(mutable);
  const surfaceAfter = total(frozenState.surfaceWater);
  const paperWaterAfter = total(frozenState.absorbedPaperWater);
  const mobileAfter = total(frozenState.mobilePigmentMass);
  const fixedAfter = total(frozenState.fixedPigmentMass);
  const densityAfter = totalOpticalDensity(
    frozenState.mobilePigmentOpticalDensity,
    frozenState.fixedPigmentOpticalDensity,
  );
  const densityError = Object.freeze([
    densityAfter[0] - densityBefore[0],
    densityAfter[1] - densityBefore[1],
    densityAfter[2] - densityBefore[2],
  ]) as readonly [number, number, number];
  const receipt: StudioWetMediaTileFieldAdvanceReceipt = Object.freeze({
    kind: "studio-wet-media-tile-field-advance-receipt",
    version: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    tickBefore: state.value.tick,
    tickAfter: frozenState.tick,
    fixedTicks: fixedTicksInput,
    surfaceWaterBefore: surfaceBefore,
    surfaceWaterAfter: surfaceAfter,
    absorbedPaperWaterBefore: paperWaterBefore,
    absorbedPaperWaterAfter: paperWaterAfter,
    waterEvaporated: metrics.waterEvaporated,
    waterConservationError:
      surfaceAfter
      + paperWaterAfter
      + metrics.waterEvaporated
      - surfaceBefore
      - paperWaterBefore,
    mobilePigmentBefore: mobileBefore,
    mobilePigmentAfter: mobileAfter,
    fixedPigmentBefore: fixedBefore,
    fixedPigmentAfter: fixedAfter,
    pigmentFixed: metrics.pigmentFixed,
    pigmentReactivated: metrics.pigmentReactivated,
    pigmentConservationError:
      mobileAfter + fixedAfter - mobileBefore - fixedBefore,
    opticalDensityBefore: densityBefore,
    opticalDensityAfter: densityAfter,
    opticalDensityConservationError: densityError,
    edgePooledWater: metrics.edgePooledWater,
    edgePooledPigment: metrics.edgePooledPigment,
    backrunWaterMoved: metrics.backrunWaterMoved,
    backrunPigmentMoved: metrics.backrunPigmentMoved,
  });
  return success(Object.freeze({ state: frozenState, receipt }));
}
