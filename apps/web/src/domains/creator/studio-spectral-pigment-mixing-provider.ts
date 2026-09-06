import { sha256HexPortable } from "./studio-sha256";

/**
 * Clean-room spectral pigment mixing provider.
 *
 * This module intentionally accepts caller-owned spectral reflectance curves instead of
 * embedding proprietary paint measurements. Opaque mixtures use the public Kubelka-Munk K/S
 * transform. Finite paint thickness is evaluated with the two-flux layer equation on a unit
 * scattering basis, so transparent glazes and opaque paint share one deterministic model.
 *
 * All color values are deterministic, renderer-neutral and independent from DOM/canvas APIs.
 */

export const STUDIO_SPECTRAL_PIGMENT_RECIPE_VERSION = 1 as const;
export const STUDIO_SPECTRAL_PIGMENT_PROVIDER_REVISION = 1 as const;
export const STUDIO_SPECTRAL_PIGMENT_RECEIPT_VERSION = 1 as const;
export const STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT = 31 as const;
export const STUDIO_SPECTRAL_PIGMENT_MIN_WAVELENGTH_NM = 400 as const;
export const STUDIO_SPECTRAL_PIGMENT_WAVELENGTH_STEP_NM = 10 as const;
export const STUDIO_SPECTRAL_PIGMENT_COLOR_CONTRACT =
  "scene-linear-srgb-unbounded" as const;
export const STUDIO_SPECTRAL_PIGMENT_MODEL =
  "kubelka-munk-two-flux-spectral" as const;

export const STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS = Object.freeze({
  maximumPigments: 64,
  maximumReflectance: 1,
  maximumWeight: 1_000_000,
  maximumConcentration: 64,
  maximumOpticalThickness: 64,
  maximumRecipeJsonCodeUnits: 262_144,
  minimumReflectanceForKs: 1 / 65_536,
} as const);

export type StudioSpectralPigmentIlluminant =
  | "equal-energy"
  | "daylight-6504k-planckian-approximation";

export interface StudioSpectralPigmentInput {
  readonly id: string;
  readonly reflectance: ArrayLike<number>;
  readonly weight: number;
  readonly concentration?: number;
}

export interface StudioSpectralPigmentRecipeInput {
  readonly pigments: readonly StudioSpectralPigmentInput[];
  readonly substrateReflectance?: ArrayLike<number>;
  readonly opticalThickness?: number;
  readonly illuminant?: StudioSpectralPigmentIlluminant;
}

export interface StudioSpectralPigment {
  readonly id: string;
  readonly reflectance: readonly number[];
  readonly weight: number;
  readonly concentration: number;
}

export interface StudioSpectralPigmentRecipe {
  readonly kind: "studio-spectral-pigment-recipe";
  readonly version: typeof STUDIO_SPECTRAL_PIGMENT_RECIPE_VERSION;
  readonly model: typeof STUDIO_SPECTRAL_PIGMENT_MODEL;
  readonly colorContract: typeof STUDIO_SPECTRAL_PIGMENT_COLOR_CONTRACT;
  readonly wavelengthRangeNm: readonly [
    minimum: typeof STUDIO_SPECTRAL_PIGMENT_MIN_WAVELENGTH_NM,
    maximum: 700,
    step: typeof STUDIO_SPECTRAL_PIGMENT_WAVELENGTH_STEP_NM,
  ];
  readonly pigments: readonly StudioSpectralPigment[];
  readonly substrateReflectance: readonly number[];
  readonly opticalThickness: number;
  readonly illuminant: StudioSpectralPigmentIlluminant;
  readonly fingerprint: `sha256:${string}`;
}

export type StudioSpectralPigmentRecipeCreationResult =
  | Readonly<{ status: "ready"; recipe: StudioSpectralPigmentRecipe }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-recipe";
      path: string;
    }>;

export interface StudioSpectralPigmentMixArtifact {
  readonly kind: "studio-spectral-pigment-mix-artifact";
  readonly version: 1;
  readonly colorContract: typeof STUDIO_SPECTRAL_PIGMENT_COLOR_CONTRACT;
  /** Mixed reflectance at 400..700 nm, inclusive, in 10 nm steps. */
  readonly reflectance: Float32Array;
  readonly xyz: readonly [x: number, y: number, z: number];
  /** Unbounded scene-linear sRGB. Negative or >1 components preserve gamut information. */
  readonly sceneLinearRgb: readonly [red: number, green: number, blue: number];
  /** Convenience preview only; each component is clamped to [0, 1]. */
  readonly displayLinearRgbClamped: readonly [
    red: number,
    green: number,
    blue: number,
  ];
  readonly reflectanceHash: `sha256:${string}`;
}

export interface StudioSpectralPigmentMixReceipt {
  readonly kind: "studio-spectral-pigment-mix-receipt";
  readonly version: typeof STUDIO_SPECTRAL_PIGMENT_RECEIPT_VERSION;
  readonly providerRevision: typeof STUDIO_SPECTRAL_PIGMENT_PROVIDER_REVISION;
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly model: typeof STUDIO_SPECTRAL_PIGMENT_MODEL;
  readonly opaqueMixture: "kubelka-munk-k-over-s";
  readonly finiteThickness: "kubelka-munk-two-flux-unit-scattering";
  readonly observer: "cie-1931-2deg-analytic-fit";
  readonly illuminant: StudioSpectralPigmentIlluminant;
  readonly normalizedEffectiveWeights: readonly number[];
  readonly artifact: StudioSpectralPigmentMixArtifact;
  readonly receiptHash: `sha256:${string}`;
  readonly complete: true;
}

export interface StudioSpectralPigmentMixRequest {
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly recipe: StudioSpectralPigmentRecipe;
  readonly signal?: AbortSignal;
}

export interface StudioSpectralPigmentProviderOptions {
  readonly initialDeviceEpoch?: number;
  readonly maximumPigments?: number;
}

export type StudioSpectralPigmentProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioSpectralPigmentProvider;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options";
      path: string;
    }>;

export type StudioSpectralPigmentErrorCode =
  | "invalid-recipe"
  | "invalid-request"
  | "budget-exceeded"
  | "request-sequence"
  | "device-epoch"
  | "aborted"
  | "disposed";

export class StudioSpectralPigmentError extends Error {
  public constructor(
    readonly code: StudioSpectralPigmentErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "StudioSpectralPigmentError";
  }
}

interface ObserverSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const DEFAULT_SUBSTRATE = Object.freeze(
  Array.from(
    { length: STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT },
    () => 1,
  ),
);

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function safeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function cloneReflectance(
  value: unknown,
): readonly number[] | null {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value !== "object"
    || !("length" in value)
    || value.length !== STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT
  ) {
    return null;
  }
  const result: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const sample = (value as ArrayLike<unknown>)[index];
    if (
      !finiteInRange(
        sample,
        0,
        STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumReflectance,
      )
    ) {
      return null;
    }
    result.push(sample);
  }
  return Object.freeze(result);
}

function fingerprintJson(value: unknown): `sha256:${string}` {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return `sha256:${sha256HexPortable(bytes)}`;
}

function hashFloat32(value: Float32Array): `sha256:${string}` {
  const bytes = new Uint8Array(value.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      value[index],
      true,
    );
  }
  return `sha256:${sha256HexPortable(bytes)}`;
}

function canonicalRecipeValue(
  pigments: readonly StudioSpectralPigment[],
  substrateReflectance: readonly number[],
  opticalThickness: number,
  illuminant: StudioSpectralPigmentIlluminant,
): Omit<StudioSpectralPigmentRecipe, "fingerprint"> {
  return {
    kind: "studio-spectral-pigment-recipe",
    version: STUDIO_SPECTRAL_PIGMENT_RECIPE_VERSION,
    model: STUDIO_SPECTRAL_PIGMENT_MODEL,
    colorContract: STUDIO_SPECTRAL_PIGMENT_COLOR_CONTRACT,
    wavelengthRangeNm: Object.freeze([
      STUDIO_SPECTRAL_PIGMENT_MIN_WAVELENGTH_NM,
      700,
      STUDIO_SPECTRAL_PIGMENT_WAVELENGTH_STEP_NM,
    ]),
    pigments,
    substrateReflectance,
    opticalThickness,
    illuminant,
  };
}

export function createStudioSpectralPigmentRecipe(
  input: StudioSpectralPigmentRecipeInput,
): StudioSpectralPigmentRecipeCreationResult {
  if (
    !isPlainRecord(input)
    || !hasExactKeys(input, ["pigments"], [
      "substrateReflectance",
      "opticalThickness",
      "illuminant",
    ])
    || !Array.isArray(input.pigments)
    || input.pigments.length < 1
    || input.pigments.length
      > STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumPigments
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$",
    });
  }

  const pigments: StudioSpectralPigment[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < input.pigments.length; index += 1) {
    const item = input.pigments[index];
    const path = `$.pigments[${index}]`;
    const concentration = isPlainRecord(item)
      ? item.concentration ?? 1
      : undefined;
    if (
      !isPlainRecord(item)
      || !hasExactKeys(item, ["id", "reflectance", "weight"], [
        "concentration",
      ])
      || typeof item.id !== "string"
      || item.id.length < 1
      || item.id.length > 128
      || ids.has(item.id)
      || !finiteInRange(
        item.weight,
        Number.EPSILON,
        STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumWeight,
      )
      || !finiteInRange(
        concentration,
        Number.EPSILON,
        STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumConcentration,
      )
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-recipe",
        path,
      });
    }
    const reflectance = cloneReflectance(item.reflectance);
    if (!reflectance) {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-recipe",
        path: `${path}.reflectance`,
      });
    }
    ids.add(item.id);
    pigments.push(Object.freeze({
      id: item.id,
      reflectance,
      weight: item.weight,
      concentration,
    }));
  }

  const substrateReflectance = input.substrateReflectance === undefined
    ? DEFAULT_SUBSTRATE
    : cloneReflectance(input.substrateReflectance);
  if (!substrateReflectance) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$.substrateReflectance",
    });
  }

  const opticalThickness = input.opticalThickness ?? 64;
  if (
    !finiteInRange(
      opticalThickness,
      0,
      STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumOpticalThickness,
    )
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$.opticalThickness",
    });
  }

  const illuminant = input.illuminant
    ?? "daylight-6504k-planckian-approximation";
  if (
    illuminant !== "equal-energy"
    && illuminant !== "daylight-6504k-planckian-approximation"
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$.illuminant",
    });
  }

  const withoutFingerprint = canonicalRecipeValue(
    Object.freeze(pigments),
    substrateReflectance,
    opticalThickness,
    illuminant,
  );
  const fingerprint = fingerprintJson(withoutFingerprint);
  const recipe = Object.freeze({
    ...withoutFingerprint,
    fingerprint,
  });
  if (
    JSON.stringify(recipe).length
    > STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumRecipeJsonCodeUnits
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$",
    });
  }
  return Object.freeze({ status: "ready", recipe });
}

export function serializeStudioSpectralPigmentRecipe(
  recipe: StudioSpectralPigmentRecipe,
): string | null {
  const parsed = parseStudioSpectralPigmentRecipe(recipe);
  return parsed ? JSON.stringify(parsed) : null;
}

export function parseStudioSpectralPigmentRecipe(
  value: unknown,
): StudioSpectralPigmentRecipe | null {
  let candidate = value;
  if (typeof candidate === "string") {
    if (
      candidate.length
      > STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumRecipeJsonCodeUnits
    ) {
      return null;
    }
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (
    !isPlainRecord(candidate)
    || !hasExactKeys(candidate, [
      "kind",
      "version",
      "model",
      "colorContract",
      "wavelengthRangeNm",
      "pigments",
      "substrateReflectance",
      "opticalThickness",
      "illuminant",
      "fingerprint",
    ])
    || candidate.kind !== "studio-spectral-pigment-recipe"
    || candidate.version !== STUDIO_SPECTRAL_PIGMENT_RECIPE_VERSION
    || candidate.model !== STUDIO_SPECTRAL_PIGMENT_MODEL
    || candidate.colorContract !== STUDIO_SPECTRAL_PIGMENT_COLOR_CONTRACT
    || !Array.isArray(candidate.wavelengthRangeNm)
    || candidate.wavelengthRangeNm.length !== 3
    || candidate.wavelengthRangeNm[0]
      !== STUDIO_SPECTRAL_PIGMENT_MIN_WAVELENGTH_NM
    || candidate.wavelengthRangeNm[1] !== 700
    || candidate.wavelengthRangeNm[2]
      !== STUDIO_SPECTRAL_PIGMENT_WAVELENGTH_STEP_NM
    || typeof candidate.fingerprint !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(candidate.fingerprint)
  ) {
    return null;
  }
  const created = createStudioSpectralPigmentRecipe({
    pigments: candidate.pigments as readonly StudioSpectralPigmentInput[],
    substrateReflectance:
      candidate.substrateReflectance as ArrayLike<number>,
    opticalThickness: candidate.opticalThickness as number,
    illuminant: candidate.illuminant as StudioSpectralPigmentIlluminant,
  });
  if (
    created.status !== "ready"
    || created.recipe.fingerprint !== candidate.fingerprint
  ) {
    return null;
  }
  return created.recipe;
}

function cie1931AnalyticObserver(wavelengthNm: number): ObserverSample {
  const x1 = (wavelengthNm - 442)
    * (wavelengthNm < 442 ? 0.0624 : 0.0374);
  const x2 = (wavelengthNm - 599.8)
    * (wavelengthNm < 599.8 ? 0.0264 : 0.0323);
  const x3 = (wavelengthNm - 501.1)
    * (wavelengthNm < 501.1 ? 0.049 : 0.0382);
  const x = 0.362 * Math.exp(-0.5 * x1 * x1)
    + 1.056 * Math.exp(-0.5 * x2 * x2)
    - 0.065 * Math.exp(-0.5 * x3 * x3);

  const y1 = (wavelengthNm - 568.8)
    * (wavelengthNm < 568.8 ? 0.0213 : 0.0247);
  const y2 = (wavelengthNm - 530.9)
    * (wavelengthNm < 530.9 ? 0.0613 : 0.0322);
  const y = 0.821 * Math.exp(-0.5 * y1 * y1)
    + 0.286 * Math.exp(-0.5 * y2 * y2);

  const z1 = (wavelengthNm - 437)
    * (wavelengthNm < 437 ? 0.0845 : 0.0278);
  const z2 = (wavelengthNm - 459)
    * (wavelengthNm < 459 ? 0.0385 : 0.0725);
  const z = 1.217 * Math.exp(-0.5 * z1 * z1)
    + 0.681 * Math.exp(-0.5 * z2 * z2);
  return { x: Math.max(0, x), y: Math.max(0, y), z: Math.max(0, z) };
}

function illuminantPower(
  wavelengthNm: number,
  illuminant: StudioSpectralPigmentIlluminant,
): number {
  if (illuminant === "equal-energy") return 1;
  const wavelengthMeters = wavelengthNm * 1e-9;
  const temperatureKelvin = 6_504;
  const c2 = 0.014_387_768_77;
  const denominator = wavelengthMeters ** 5
    * Math.expm1(c2 / (wavelengthMeters * temperatureKelvin));
  return 1 / denominator;
}

function reflectanceToKs(reflectance: number): number {
  const r = Math.max(
    STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.minimumReflectanceForKs,
    Math.min(1, reflectance),
  );
  const oneMinus = 1 - r;
  return (oneMinus * oneMinus) / (2 * r);
}

function ksToReflectance(ks: number): number {
  return Math.max(
    0,
    Math.min(1, 1 + ks - Math.sqrt(ks * ks + 2 * ks)),
  );
}

function finiteLayerReflectance(
  ks: number,
  substrateReflectance: number,
  opticalThickness: number,
): number {
  if (opticalThickness === 0) return substrateReflectance;
  const a = 1 + ks;
  const bSquared = Math.max(0, a * a - 1);
  if (bSquared < 1e-12) {
    const substrateGap = 1 - substrateReflectance;
    return (
      substrateReflectance + opticalThickness * substrateGap
    ) / (
      1 + opticalThickness * substrateGap
    );
  }
  const b = Math.sqrt(bSquared);
  const argument = b * opticalThickness;
  if (argument > 20) return ksToReflectance(ks);
  // Algebraically divide the two-flux expression by b*coth(bSX). This keeps
  // zero and extremely thin layers finite instead of forming Infinity/Infinity.
  const inverseTransfer = Math.tanh(argument) / b;
  const numerator = substrateReflectance
    + inverseTransfer * (1 - substrateReflectance * a);
  const denominator = 1
    + inverseTransfer * (a - substrateReflectance);
  return Math.max(0, Math.min(1, numerator / denominator));
}

function spectrumToXyz(
  reflectance: Float32Array,
  illuminant: StudioSpectralPigmentIlluminant,
): readonly [x: number, y: number, z: number] {
  let x = 0;
  let y = 0;
  let z = 0;
  let whiteX = 0;
  let whiteY = 0;
  let whiteZ = 0;
  for (let index = 0; index < reflectance.length; index += 1) {
    const wavelength = STUDIO_SPECTRAL_PIGMENT_MIN_WAVELENGTH_NM
      + index * STUDIO_SPECTRAL_PIGMENT_WAVELENGTH_STEP_NM;
    const observer = cie1931AnalyticObserver(wavelength);
    const power = illuminantPower(wavelength, illuminant);
    const sample = reflectance[index];
    x += sample * power * observer.x;
    y += sample * power * observer.y;
    z += sample * power * observer.z;
    whiteX += power * observer.x;
    whiteY += power * observer.y;
    whiteZ += power * observer.z;
  }
  // Normalize the analytic observer/illuminant white to the D65 matrix white.
  return Object.freeze([
    whiteX > 0 ? x / whiteX * 0.95047 : 0,
    whiteY > 0 ? y / whiteY : 0,
    whiteZ > 0 ? z / whiteZ * 1.08883 : 0,
  ]);
}

function xyzToLinearSrgb(
  xyz: readonly [number, number, number],
): readonly [red: number, green: number, blue: number] {
  const [x, y, z] = xyz;
  return Object.freeze([
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ]);
}

function normalizedEffectiveWeights(
  recipe: StudioSpectralPigmentRecipe,
): readonly number[] {
  const effective = recipe.pigments.map(
    (pigment) => pigment.weight * pigment.concentration,
  );
  const total = effective.reduce((sum, value) => sum + value, 0);
  return Object.freeze(effective.map((value) => value / total));
}

export function mixStudioSpectralPigmentRecipe(
  recipe: StudioSpectralPigmentRecipe,
): Readonly<{
  artifact: StudioSpectralPigmentMixArtifact;
  normalizedEffectiveWeights: readonly number[];
}> {
  const parsed = parseStudioSpectralPigmentRecipe(recipe);
  if (!parsed) {
    throw new StudioSpectralPigmentError(
      "invalid-recipe",
      "The spectral pigment recipe is malformed or fingerprint-drifted.",
      "$.recipe",
    );
  }
  const weights = normalizedEffectiveWeights(parsed);
  const reflectance = new Float32Array(
    STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT,
  );
  for (let sampleIndex = 0; sampleIndex < reflectance.length; sampleIndex += 1) {
    let mixedKs = 0;
    for (
      let pigmentIndex = 0;
      pigmentIndex < parsed.pigments.length;
      pigmentIndex += 1
    ) {
      mixedKs += weights[pigmentIndex]
        * reflectanceToKs(
          parsed.pigments[pigmentIndex].reflectance[sampleIndex],
        );
    }
    reflectance[sampleIndex] = finiteLayerReflectance(
      mixedKs,
      parsed.substrateReflectance[sampleIndex],
      parsed.opticalThickness,
    );
  }

  const xyz = spectrumToXyz(reflectance, parsed.illuminant);
  const sceneLinearRgb = xyzToLinearSrgb(xyz);
  const displayLinearRgbClamped = Object.freeze(
    sceneLinearRgb.map((component) => Math.min(1, Math.max(0, component))),
  ) as readonly [number, number, number];
  const artifact = Object.freeze({
    kind: "studio-spectral-pigment-mix-artifact" as const,
    version: 1 as const,
    colorContract: STUDIO_SPECTRAL_PIGMENT_COLOR_CONTRACT,
    reflectance,
    xyz,
    sceneLinearRgb,
    displayLinearRgbClamped,
    reflectanceHash: hashFloat32(reflectance),
  });
  return Object.freeze({ artifact, normalizedEffectiveWeights: weights });
}

function receiptHashValue(
  requestSequence: number,
  deviceEpoch: number,
  recipeFingerprint: `sha256:${string}`,
  normalizedWeights: readonly number[],
  artifact: StudioSpectralPigmentMixArtifact,
): `sha256:${string}` {
  return fingerprintJson({
    version: STUDIO_SPECTRAL_PIGMENT_RECEIPT_VERSION,
    providerRevision: STUDIO_SPECTRAL_PIGMENT_PROVIDER_REVISION,
    requestSequence,
    deviceEpoch,
    recipeFingerprint,
    normalizedWeights,
    reflectanceHash: artifact.reflectanceHash,
    xyz: artifact.xyz,
    sceneLinearRgb: artifact.sceneLinearRgb,
  });
}

export class StudioSpectralPigmentProvider {
  readonly #maximumPigments: number;
  #deviceEpoch: number;
  #lastRequestSequence = -1;
  #disposed = false;

  public constructor(options: Required<StudioSpectralPigmentProviderOptions>) {
    this.#deviceEpoch = options.initialDeviceEpoch;
    this.#maximumPigments = options.maximumPigments;
  }

  public get deviceEpoch(): number {
    return this.#deviceEpoch;
  }

  public advanceDeviceEpoch(): number {
    if (this.#disposed) {
      throw new StudioSpectralPigmentError(
        "disposed",
        "The spectral pigment provider is disposed.",
      );
    }
    this.#deviceEpoch += 1;
    this.#lastRequestSequence = -1;
    return this.#deviceEpoch;
  }

  public async mix(
    request: StudioSpectralPigmentMixRequest,
  ): Promise<StudioSpectralPigmentMixReceipt> {
    if (this.#disposed) {
      throw new StudioSpectralPigmentError(
        "disposed",
        "The spectral pigment provider is disposed.",
      );
    }
    if (request.signal?.aborted) {
      throw new StudioSpectralPigmentError(
        "aborted",
        "The spectral pigment request was aborted.",
      );
    }
    if (
      !safeIntegerInRange(request.requestSequence, 0, Number.MAX_SAFE_INTEGER)
    ) {
      throw new StudioSpectralPigmentError(
        "invalid-request",
        "requestSequence must be a non-negative safe integer.",
        "$.requestSequence",
      );
    }
    if (request.deviceEpoch !== this.#deviceEpoch) {
      throw new StudioSpectralPigmentError(
        "device-epoch",
        "The request targets a stale provider epoch.",
        "$.deviceEpoch",
      );
    }
    if (request.requestSequence <= this.#lastRequestSequence) {
      throw new StudioSpectralPigmentError(
        "request-sequence",
        "requestSequence must increase monotonically within an epoch.",
        "$.requestSequence",
      );
    }
    const parsed = parseStudioSpectralPigmentRecipe(request.recipe);
    if (!parsed) {
      throw new StudioSpectralPigmentError(
        "invalid-recipe",
        "The spectral pigment recipe is invalid.",
        "$.recipe",
      );
    }
    if (parsed.pigments.length > this.#maximumPigments) {
      throw new StudioSpectralPigmentError(
        "budget-exceeded",
        "The request exceeds the provider pigment budget.",
        "$.recipe.pigments",
      );
    }
    this.#lastRequestSequence = request.requestSequence;
    const mixed = mixStudioSpectralPigmentRecipe(parsed);
    if (request.signal?.aborted) {
      throw new StudioSpectralPigmentError(
        "aborted",
        "The spectral pigment request was aborted.",
      );
    }
    const receiptHash = receiptHashValue(
      request.requestSequence,
      request.deviceEpoch,
      parsed.fingerprint,
      mixed.normalizedEffectiveWeights,
      mixed.artifact,
    );
    return Object.freeze({
      kind: "studio-spectral-pigment-mix-receipt",
      version: STUDIO_SPECTRAL_PIGMENT_RECEIPT_VERSION,
      providerRevision: STUDIO_SPECTRAL_PIGMENT_PROVIDER_REVISION,
      requestSequence: request.requestSequence,
      deviceEpoch: request.deviceEpoch,
      recipeFingerprint: parsed.fingerprint,
      model: STUDIO_SPECTRAL_PIGMENT_MODEL,
      opaqueMixture: "kubelka-munk-k-over-s",
      finiteThickness: "kubelka-munk-two-flux-unit-scattering",
      observer: "cie-1931-2deg-analytic-fit",
      illuminant: parsed.illuminant,
      normalizedEffectiveWeights: mixed.normalizedEffectiveWeights,
      artifact: mixed.artifact,
      receiptHash,
      complete: true,
    });
  }

  public dispose(): void {
    this.#disposed = true;
    this.#lastRequestSequence = -1;
  }
}

export function createStudioSpectralPigmentProvider(
  options: StudioSpectralPigmentProviderOptions = {},
): StudioSpectralPigmentProviderCreationResult {
  const initialDeviceEpoch = options.initialDeviceEpoch ?? 0;
  const maximumPigments = options.maximumPigments ?? 32;
  if (
    !safeIntegerInRange(initialDeviceEpoch, 0, Number.MAX_SAFE_INTEGER - 1)
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "$.initialDeviceEpoch",
    });
  }
  if (
    !safeIntegerInRange(
      maximumPigments,
      1,
      STUDIO_SPECTRAL_PIGMENT_HARD_LIMITS.maximumPigments,
    )
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "$.maximumPigments",
    });
  }
  return Object.freeze({
    status: "ready",
    provider: new StudioSpectralPigmentProvider({
      initialDeviceEpoch,
      maximumPigments,
    }),
  });
}
