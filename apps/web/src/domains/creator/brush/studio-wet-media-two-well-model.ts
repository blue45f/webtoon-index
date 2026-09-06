/**
 * Provider-neutral wet-media brush state.
 *
 * This is a clean-room implementation of the publicly observable two-well workflow used by
 * professional mixer brushes: a persistent reservoir supplies loaded pigment while a separate
 * pickup well receives pigment sampled from the canvas. It deliberately owns no pixels, DOM
 * objects, vendor preset data, or GPU handles. A renderer applies the returned mass deltas to its
 * canonical pigment/water fields and can replay the same contacts in a Worker or on the GPU.
 *
 * Pigment colours are mixed in optical-density space instead of by naïve encoded-RGB averaging.
 * Contact integration uses exponential response curves, so splitting one contact into multiple
 * smaller contacts does not change reservoir depletion in the no-pickup case.
 */

export const STUDIO_WET_MEDIA_TWO_WELL_VERSION = 1 as const;

export const STUDIO_WET_MEDIA_TWO_WELL_LIMITS = Object.freeze({
  maxMass: 1_048_576,
  maxCapacity: 65_536,
  maxContactMeasure: 65_536,
  maxRate: 256,
} as const);

export type StudioWetMediaLinearRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

export interface StudioWetMediaTwoWellSettings {
  readonly kind: "studio-wet-media-two-well-settings";
  readonly version: typeof STUDIO_WET_MEDIA_TWO_WELL_VERSION;
  readonly model: "optical-density-pigment-v1";
  /** Canvas pickup response. Equivalent contacts compose without a frame-rate dependency. */
  readonly wetness: number;
  /** Initial fraction of the reservoir pigment capacity. */
  readonly load: number;
  /** 0 uses the reservoir, 1 uses the pickup well, intermediate values mix both wells. */
  readonly mix: number;
  readonly pickupRate: number;
  readonly depositionRate: number;
  readonly reservoirPigmentCapacity: number;
  readonly reservoirWaterCapacity: number;
  readonly pickupPigmentCapacity: number;
  readonly pickupWaterCapacity: number;
  readonly autoReloadAtStrokeStart: boolean;
  readonly autoCleanAtStrokeStart: boolean;
}

export interface StudioWetMediaWell {
  readonly color: StudioWetMediaLinearRgba;
  readonly pigmentMass: number;
  readonly waterMass: number;
}

export interface StudioWetMediaTwoWellState {
  readonly kind: "studio-wet-media-two-well-state";
  readonly version: typeof STUDIO_WET_MEDIA_TWO_WELL_VERSION;
  readonly strokeSequence: number;
  readonly lastContactSequence: number | null;
  readonly reservoir: StudioWetMediaWell;
  readonly pickup: StudioWetMediaWell;
}

export interface StudioWetMediaCanvasSample {
  readonly color: StudioWetMediaLinearRgba;
  /** Removable mobile pigment under the contact footprint. */
  readonly availablePigmentMass: number;
  /** Removable surface water under the contact footprint. */
  readonly availableWaterMass: number;
}

export interface StudioWetMediaContact {
  readonly sequence: number;
  /**
   * Dimensionless integrated footprint. Callers derive this from travelled distance, elapsed
   * fixed ticks, and brush diameter; it is not a wall-clock duration.
   */
  readonly contactMeasure: number;
  readonly pressure: number;
  readonly flow: number;
  readonly canvas: StudioWetMediaCanvasSample;
}

export interface StudioWetMediaMassDelta {
  readonly color: StudioWetMediaLinearRgba;
  readonly pigmentMass: number;
  readonly waterMass: number;
}

export interface StudioWetMediaContactResult {
  readonly state: StudioWetMediaTwoWellState;
  /** Mass the renderer removes from the mobile canvas fields before deposition. */
  readonly pickupFromCanvas: StudioWetMediaMassDelta;
  /** Mass the renderer adds to the mobile canvas fields after pickup. */
  readonly depositionToCanvas: StudioWetMediaMassDelta;
  readonly receipt: {
    readonly kind: "studio-wet-media-two-well-contact-receipt";
    readonly version: typeof STUDIO_WET_MEDIA_TWO_WELL_VERSION;
    readonly sequence: number;
    readonly pigmentMassBefore: number;
    readonly pigmentMassAfter: number;
    readonly waterMassBefore: number;
    readonly waterMassAfter: number;
    readonly pigmentConservationError: number;
    readonly waterConservationError: number;
  };
}

export type StudioWetMediaTwoWellFailureReason =
  | "not-plain-data"
  | "unknown-field"
  | "invalid-field"
  | "unsupported-version"
  | "sequence-regression"
  | "mass-budget-exceeded";

export type StudioWetMediaTwoWellResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      reason: StudioWetMediaTwoWellFailureReason;
      path: string;
    }>;

type UnknownRecord = Record<string, unknown>;

const SETTINGS_KEYS = [
  "kind",
  "version",
  "model",
  "wetness",
  "load",
  "mix",
  "pickupRate",
  "depositionRate",
  "reservoirPigmentCapacity",
  "reservoirWaterCapacity",
  "pickupPigmentCapacity",
  "pickupWaterCapacity",
  "autoReloadAtStrokeStart",
  "autoCleanAtStrokeStart",
] as const;

const STATE_KEYS = [
  "kind",
  "version",
  "strokeSequence",
  "lastContactSequence",
  "reservoir",
  "pickup",
] as const;

const WELL_KEYS = ["color", "pigmentMass", "waterMass"] as const;
const CANVAS_KEYS = ["color", "availablePigmentMass", "availableWaterMass"] as const;
const CONTACT_KEYS = ["sequence", "contactMeasure", "pressure", "flow", "canvas"] as const;

function failure(
  reason: StudioWetMediaTwoWellFailureReason,
  path: string,
): StudioWetMediaTwoWellResult<never> {
  return Object.freeze({ ok: false, reason, path });
}

function exactDataRecord(
  input: unknown,
  keys: readonly string[],
  path: string,
): StudioWetMediaTwoWellResult<UnknownRecord> {
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
  return { ok: true, value: input as UnknownRecord };
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function inspectColor(
  input: unknown,
  path: string,
): StudioWetMediaTwoWellResult<StudioWetMediaLinearRgba> {
  if (!Array.isArray(input)) return failure("invalid-field", path);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== 4) {
    return failure("invalid-field", path);
  }
  const channels: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !finiteInRange(descriptor.value, 0, 1)) {
      return failure("invalid-field", `${path}[${index}]`);
    }
    channels.push(Object.is(descriptor.value, -0) ? 0 : descriptor.value);
  }
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== "string"
      || (key !== "length" && key !== "0" && key !== "1" && key !== "2" && key !== "3")
    ) {
      return failure("unknown-field", `${path}.${String(key)}`);
    }
  }
  return {
    ok: true,
    value: Object.freeze([
      channels[0]!,
      channels[1]!,
      channels[2]!,
      channels[3]!,
    ]),
  };
}

function inspectWell(
  input: unknown,
  path: string,
  pigmentCapacity: number,
  waterCapacity: number,
): StudioWetMediaTwoWellResult<StudioWetMediaWell> {
  const record = exactDataRecord(input, WELL_KEYS, path);
  if (!record.ok) return record;
  const color = inspectColor(record.value.color, `${path}.color`);
  if (!color.ok) return color;
  if (!finiteInRange(record.value.pigmentMass, 0, pigmentCapacity)) {
    return failure("invalid-field", `${path}.pigmentMass`);
  }
  if (!finiteInRange(record.value.waterMass, 0, waterCapacity)) {
    return failure("invalid-field", `${path}.waterMass`);
  }
  return {
    ok: true,
    value: freezeWell(
      color.value,
      record.value.pigmentMass,
      record.value.waterMass,
    ),
  };
}

function freezeColor(color: StudioWetMediaLinearRgba): StudioWetMediaLinearRgba {
  return Object.freeze([color[0], color[1], color[2], color[3]]);
}

function freezeWell(
  color: StudioWetMediaLinearRgba,
  pigmentMass: number,
  waterMass: number,
): StudioWetMediaWell {
  return Object.freeze({
    color: freezeColor(color),
    pigmentMass: Object.is(pigmentMass, -0) ? 0 : pigmentMass,
    waterMass: Object.is(waterMass, -0) ? 0 : waterMass,
  });
}

function freezeState(
  strokeSequence: number,
  lastContactSequence: number | null,
  reservoir: StudioWetMediaWell,
  pickup: StudioWetMediaWell,
): StudioWetMediaTwoWellState {
  return Object.freeze({
    kind: "studio-wet-media-two-well-state",
    version: STUDIO_WET_MEDIA_TWO_WELL_VERSION,
    strokeSequence,
    lastContactSequence,
    reservoir: freezeWell(
      reservoir.color,
      reservoir.pigmentMass,
      reservoir.waterMass,
    ),
    pickup: freezeWell(pickup.color, pickup.pigmentMass, pickup.waterMass),
  });
}

function canonicalSettings(
  record: UnknownRecord,
): StudioWetMediaTwoWellSettings {
  return Object.freeze({
    kind: "studio-wet-media-two-well-settings",
    version: STUDIO_WET_MEDIA_TWO_WELL_VERSION,
    model: "optical-density-pigment-v1",
    wetness: record.wetness as number,
    load: record.load as number,
    mix: record.mix as number,
    pickupRate: record.pickupRate as number,
    depositionRate: record.depositionRate as number,
    reservoirPigmentCapacity: record.reservoirPigmentCapacity as number,
    reservoirWaterCapacity: record.reservoirWaterCapacity as number,
    pickupPigmentCapacity: record.pickupPigmentCapacity as number,
    pickupWaterCapacity: record.pickupWaterCapacity as number,
    autoReloadAtStrokeStart: record.autoReloadAtStrokeStart as boolean,
    autoCleanAtStrokeStart: record.autoCleanAtStrokeStart as boolean,
  });
}

export function parseStudioWetMediaTwoWellSettings(
  input: unknown,
): StudioWetMediaTwoWellResult<StudioWetMediaTwoWellSettings> {
  const record = exactDataRecord(input, SETTINGS_KEYS, "$");
  if (!record.ok) return record;
  if (record.value.version !== STUDIO_WET_MEDIA_TWO_WELL_VERSION) {
    return failure("unsupported-version", "$.version");
  }
  if (
    record.value.kind !== "studio-wet-media-two-well-settings"
    || record.value.model !== "optical-density-pigment-v1"
  ) {
    return failure("invalid-field", "$.kind");
  }
  for (const key of ["wetness", "load", "mix"] as const) {
    if (!finiteInRange(record.value[key], 0, 1)) {
      return failure("invalid-field", `$.${key}`);
    }
  }
  for (const key of ["pickupRate", "depositionRate"] as const) {
    if (!finiteInRange(record.value[key], 0, STUDIO_WET_MEDIA_TWO_WELL_LIMITS.maxRate)) {
      return failure("invalid-field", `$.${key}`);
    }
  }
  for (
    const key of [
      "reservoirPigmentCapacity",
      "reservoirWaterCapacity",
      "pickupPigmentCapacity",
      "pickupWaterCapacity",
    ] as const
  ) {
    if (!finiteInRange(record.value[key], 0, STUDIO_WET_MEDIA_TWO_WELL_LIMITS.maxCapacity)) {
      return failure("invalid-field", `$.${key}`);
    }
  }
  if (
    typeof record.value.autoReloadAtStrokeStart !== "boolean"
    || typeof record.value.autoCleanAtStrokeStart !== "boolean"
  ) {
    return failure("invalid-field", "$.autoReloadAtStrokeStart");
  }
  return { ok: true, value: canonicalSettings(record.value) };
}

export function parseStudioWetMediaTwoWellState(
  input: unknown,
  settingsInput: unknown,
): StudioWetMediaTwoWellResult<StudioWetMediaTwoWellState> {
  const settings = parseStudioWetMediaTwoWellSettings(settingsInput);
  if (!settings.ok) return settings;
  const record = exactDataRecord(input, STATE_KEYS, "$");
  if (!record.ok) return record;
  if (record.value.version !== STUDIO_WET_MEDIA_TWO_WELL_VERSION) {
    return failure("unsupported-version", "$.version");
  }
  if (
    record.value.kind !== "studio-wet-media-two-well-state"
    || !nonNegativeSafeInteger(record.value.strokeSequence)
    || (
      record.value.lastContactSequence !== null
      && !nonNegativeSafeInteger(record.value.lastContactSequence)
    )
  ) {
    return failure("invalid-field", "$.strokeSequence");
  }
  const reservoir = inspectWell(
    record.value.reservoir,
    "$.reservoir",
    settings.value.reservoirPigmentCapacity,
    settings.value.reservoirWaterCapacity,
  );
  if (!reservoir.ok) return reservoir;
  const pickup = inspectWell(
    record.value.pickup,
    "$.pickup",
    settings.value.pickupPigmentCapacity,
    settings.value.pickupWaterCapacity,
  );
  if (!pickup.ok) return pickup;
  return {
    ok: true,
    value: freezeState(
      record.value.strokeSequence,
      record.value.lastContactSequence,
      reservoir.value,
      pickup.value,
    ),
  };
}

function opticalDensityMix(
  left: StudioWetMediaLinearRgba,
  leftMass: number,
  right: StudioWetMediaLinearRgba,
  rightMass: number,
): StudioWetMediaLinearRgba {
  const totalMass = leftMass + rightMass;
  if (totalMass <= 0) return freezeColor(left);
  const leftWeight = leftMass / totalMass;
  const rightWeight = rightMass / totalMass;
  const epsilon = 1 / 65_536;
  const mixed = [0, 0, 0] as number[];
  for (let channel = 0; channel < 3; channel += 1) {
    const leftDensity = -Math.log(Math.max(epsilon, left[channel]!));
    const rightDensity = -Math.log(Math.max(epsilon, right[channel]!));
    mixed[channel] = Math.exp(
      -(leftDensity * leftWeight + rightDensity * rightWeight),
    );
  }
  return Object.freeze([
    mixed[0]!,
    mixed[1]!,
    mixed[2]!,
    Math.min(1, left[3] * leftWeight + right[3] * rightWeight),
  ]);
}

function response(rate: number, measure: number): number {
  return rate <= 0 || measure <= 0 ? 0 : -Math.expm1(-rate * measure);
}

function removeMass(
  well: StudioWetMediaWell,
  pigmentMass: number,
  waterMass: number,
): StudioWetMediaWell {
  return freezeWell(
    well.color,
    Math.max(0, well.pigmentMass - pigmentMass),
    Math.max(0, well.waterMass - waterMass),
  );
}

function mixIntoWell(
  well: StudioWetMediaWell,
  color: StudioWetMediaLinearRgba,
  pigmentMass: number,
  waterMass: number,
): StudioWetMediaWell {
  return freezeWell(
    pigmentMass > 0
      ? opticalDensityMix(well.color, well.pigmentMass, color, pigmentMass)
      : well.color,
    well.pigmentMass + pigmentMass,
    well.waterMass + waterMass,
  );
}

function selectedWithdrawals(
  reservoirMass: number,
  pickupMass: number,
  mix: number,
  fraction: number,
): readonly [reservoir: number, pickup: number] {
  if (fraction <= 0) return [0, 0];
  if (mix <= 0) return [reservoirMass * fraction, 0];
  if (mix >= 1) return [0, pickupMass * fraction];
  const reservoirWeight = reservoirMass * (1 - mix);
  const pickupWeight = pickupMass * mix;
  const weightTotal = reservoirWeight + pickupWeight;
  if (weightTotal <= 0) return [0, 0];
  const reservoirShare = reservoirWeight / weightTotal;
  const pickupShare = pickupWeight / weightTotal;
  const requested = (reservoirMass + pickupMass) * fraction;
  const maximum = Math.min(
    reservoirShare > 0 ? reservoirMass / reservoirShare : Number.POSITIVE_INFINITY,
    pickupShare > 0 ? pickupMass / pickupShare : Number.POSITIVE_INFINITY,
  );
  const total = Math.min(requested, maximum);
  return [total * reservoirShare, total * pickupShare];
}

export function createStudioWetMediaTwoWellState(
  settingsInput: unknown,
  loadedColorInput: unknown,
): StudioWetMediaTwoWellResult<StudioWetMediaTwoWellState> {
  const settings = parseStudioWetMediaTwoWellSettings(settingsInput);
  if (!settings.ok) return settings;
  const loadedColor = inspectColor(loadedColorInput, "$.loadedColor");
  if (!loadedColor.ok) return loadedColor;
  return {
    ok: true,
    value: freezeState(
      0,
      null,
      freezeWell(
        loadedColor.value,
        settings.value.reservoirPigmentCapacity * settings.value.load,
        settings.value.reservoirWaterCapacity * settings.value.wetness,
      ),
      freezeWell(loadedColor.value, 0, 0),
    ),
  };
}

export function beginStudioWetMediaStroke(
  settingsInput: unknown,
  stateInput: unknown,
  loadedColorInput: unknown,
): StudioWetMediaTwoWellResult<StudioWetMediaTwoWellState> {
  const settings = parseStudioWetMediaTwoWellSettings(settingsInput);
  if (!settings.ok) return settings;
  const state = parseStudioWetMediaTwoWellState(stateInput, settings.value);
  if (!state.ok) return state;
  const loadedColor = inspectColor(loadedColorInput, "$.loadedColor");
  if (!loadedColor.ok) return loadedColor;
  if (state.value.strokeSequence === Number.MAX_SAFE_INTEGER) {
    return failure("mass-budget-exceeded", "$.strokeSequence");
  }
  const reservoir = settings.value.autoReloadAtStrokeStart
    ? freezeWell(
        loadedColor.value,
        settings.value.reservoirPigmentCapacity * settings.value.load,
        settings.value.reservoirWaterCapacity * settings.value.wetness,
      )
    : state.value.reservoir;
  const pickup = settings.value.autoCleanAtStrokeStart
    ? freezeWell(loadedColor.value, 0, 0)
    : state.value.pickup;
  return {
    ok: true,
    value: freezeState(
      state.value.strokeSequence + 1,
      null,
      reservoir,
      pickup,
    ),
  };
}

function inspectContact(
  input: unknown,
): StudioWetMediaTwoWellResult<StudioWetMediaContact> {
  const record = exactDataRecord(input, CONTACT_KEYS, "$.contact");
  if (!record.ok) return record;
  if (
    !nonNegativeSafeInteger(record.value.sequence)
    || !finiteInRange(
      record.value.contactMeasure,
      0,
      STUDIO_WET_MEDIA_TWO_WELL_LIMITS.maxContactMeasure,
    )
    || !finiteInRange(record.value.pressure, 0, 1)
    || !finiteInRange(record.value.flow, 0, 1)
  ) {
    return failure("invalid-field", "$.contact");
  }
  const canvas = exactDataRecord(record.value.canvas, CANVAS_KEYS, "$.contact.canvas");
  if (!canvas.ok) return canvas;
  const color = inspectColor(canvas.value.color, "$.contact.canvas.color");
  if (!color.ok) return color;
  if (
    !finiteInRange(
      canvas.value.availablePigmentMass,
      0,
      STUDIO_WET_MEDIA_TWO_WELL_LIMITS.maxMass,
    )
    || !finiteInRange(
      canvas.value.availableWaterMass,
      0,
      STUDIO_WET_MEDIA_TWO_WELL_LIMITS.maxMass,
    )
  ) {
    return failure("invalid-field", "$.contact.canvas");
  }
  return {
    ok: true,
    value: Object.freeze({
      sequence: record.value.sequence,
      contactMeasure: record.value.contactMeasure,
      pressure: record.value.pressure,
      flow: record.value.flow,
      canvas: Object.freeze({
        color: color.value,
        availablePigmentMass: canvas.value.availablePigmentMass,
        availableWaterMass: canvas.value.availableWaterMass,
      }),
    }),
  };
}

export function advanceStudioWetMediaTwoWellContact(
  settingsInput: unknown,
  stateInput: unknown,
  contactInput: unknown,
): StudioWetMediaTwoWellResult<StudioWetMediaContactResult> {
  const settings = parseStudioWetMediaTwoWellSettings(settingsInput);
  if (!settings.ok) return settings;
  const state = parseStudioWetMediaTwoWellState(stateInput, settings.value);
  if (!state.ok) return state;
  const contact = inspectContact(contactInput);
  if (!contact.ok) return contact;
  if (
    state.value.lastContactSequence !== null
    && contact.value.sequence <= state.value.lastContactSequence
  ) {
    return failure("sequence-regression", "$.contact.sequence");
  }

  const pigmentBefore =
    state.value.reservoir.pigmentMass
    + state.value.pickup.pigmentMass
    + contact.value.canvas.availablePigmentMass;
  const waterBefore =
    state.value.reservoir.waterMass
    + state.value.pickup.waterMass
    + contact.value.canvas.availableWaterMass;

  const activeMeasure =
    contact.value.contactMeasure
    * contact.value.pressure
    * contact.value.flow;
  const pickupFraction = response(
    settings.value.pickupRate * settings.value.wetness,
    activeMeasure,
  );
  const pickedPigment = Math.min(
    contact.value.canvas.availablePigmentMass * pickupFraction,
    settings.value.pickupPigmentCapacity - state.value.pickup.pigmentMass,
  );
  const pickedWater = Math.min(
    contact.value.canvas.availableWaterMass * pickupFraction,
    settings.value.pickupWaterCapacity - state.value.pickup.waterMass,
  );
  const pickupAfterSampling = mixIntoWell(
    state.value.pickup,
    contact.value.canvas.color,
    pickedPigment,
    pickedWater,
  );

  const depositionFraction = response(
    settings.value.depositionRate,
    activeMeasure,
  );
  const [reservoirPigmentOut, pickupPigmentOut] = selectedWithdrawals(
    state.value.reservoir.pigmentMass,
    pickupAfterSampling.pigmentMass,
    settings.value.mix,
    depositionFraction,
  );
  const [reservoirWaterOut, pickupWaterOut] = selectedWithdrawals(
    state.value.reservoir.waterMass,
    pickupAfterSampling.waterMass,
    settings.value.mix,
    depositionFraction,
  );
  const depositedPigment = reservoirPigmentOut + pickupPigmentOut;
  const depositedWater = reservoirWaterOut + pickupWaterOut;
  const depositedBaseColor = opticalDensityMix(
    state.value.reservoir.color,
    reservoirPigmentOut,
    pickupAfterSampling.color,
    pickupPigmentOut,
  );
  const opacity = depositedPigment <= 0
    ? 0
    : 1 - Math.exp(-depositedPigment / Math.max(0.25, 1 + depositedWater));
  const depositedColor = freezeColor([
    depositedBaseColor[0],
    depositedBaseColor[1],
    depositedBaseColor[2],
    opacity,
  ]);

  const nextReservoir = removeMass(
    state.value.reservoir,
    reservoirPigmentOut,
    reservoirWaterOut,
  );
  const nextPickup = removeMass(
    pickupAfterSampling,
    pickupPigmentOut,
    pickupWaterOut,
  );
  const pigmentAfter =
    nextReservoir.pigmentMass
    + nextPickup.pigmentMass
    + contact.value.canvas.availablePigmentMass
    - pickedPigment
    + depositedPigment;
  const waterAfter =
    nextReservoir.waterMass
    + nextPickup.waterMass
    + contact.value.canvas.availableWaterMass
    - pickedWater
    + depositedWater;

  const result: StudioWetMediaContactResult = Object.freeze({
    state: freezeState(
      state.value.strokeSequence,
      contact.value.sequence,
      nextReservoir,
      nextPickup,
    ),
    pickupFromCanvas: Object.freeze({
      color: freezeColor(contact.value.canvas.color),
      pigmentMass: pickedPigment,
      waterMass: pickedWater,
    }),
    depositionToCanvas: Object.freeze({
      color: depositedColor,
      pigmentMass: depositedPigment,
      waterMass: depositedWater,
    }),
    receipt: Object.freeze({
      kind: "studio-wet-media-two-well-contact-receipt",
      version: STUDIO_WET_MEDIA_TWO_WELL_VERSION,
      sequence: contact.value.sequence,
      pigmentMassBefore: pigmentBefore,
      pigmentMassAfter: pigmentAfter,
      waterMassBefore: waterBefore,
      waterMassAfter: waterAfter,
      pigmentConservationError: pigmentAfter - pigmentBefore,
      waterConservationError: waterAfter - waterBefore,
    }),
  });
  return { ok: true, value: result };
}
