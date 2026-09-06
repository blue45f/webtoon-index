/**
 * Deterministic Living Ink operation boundary.
 *
 * The tile field remains a deterministic CPU planning/validation/undo oracle; accepted RGBA8 GPU
 * frames plus their operation journal own pixel-visible save/replay. This layer gives product code
 * explicit ink, water, fixation, clear and fixed-tick operations without leaking mutable arrays.
 * Every accepted operation is atomic: cancellation or a field-budget failure returns the original
 * immutable session. The same operation vocabulary is consumed by the GPU pass protocol.
 */

import {
  advanceStudioWetMediaTileField,
  applyStudioWetMediaTileFieldDepositions,
  createStudioWetMediaTileField,
  parseStudioWetMediaTileFieldSettings,
  parseStudioWetMediaTileFieldState,
  STUDIO_WET_MEDIA_CUT,
  STUDIO_WET_MEDIA_TILE_FIELD_LIMITS,
  type StudioWetMediaLinearRgba,
  type StudioWetMediaTileFieldDeposition,
  type StudioWetMediaTileFieldPaper,
  type StudioWetMediaTileFieldSettings,
  type StudioWetMediaTileFieldState,
} from "./brush/studio-wet-media-tile-field";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_LIVING_INK_FIELD_VERSION = 1 as const;
export const STUDIO_LIVING_INK_FIELD_KIND = "toonspectrum.living-ink-field" as const;
/** Shared Beer-Lambert extinction used by both the CPU snapshot oracle and WebGL2 display/fix. */
export const STUDIO_LIVING_INK_WHITE_GOUACHE_EXTINCTION = 2.35 as const;
export const STUDIO_LIVING_INK_WHITE_GOUACHE_LOAD_GAIN = 2.4 as const;
export const STUDIO_LIVING_INK_REFLECTANCE_RANGE = Object.freeze({
  minimum: 0.015,
  maximum: 0.985,
} as const);

/** One conversion for CPU canonical deposition and GPU operation replay, including near-black. */
export function studioLivingInkOpticalDensityFromReflectance(reflectance: number): number {
  return -Math.log(Math.min(
    STUDIO_LIVING_INK_REFLECTANCE_RANGE.maximum,
    Math.max(STUDIO_LIVING_INK_REFLECTANCE_RANGE.minimum, reflectance),
  ));
}

/**
 * Linear-light channel → the reflectance encoding the *display resolve actually writes*.
 *
 * The resolve ends at `outColor = paper * exp(-opticalDensity)` and hands those numbers straight to
 * an RGBA8 surface — no `pow(x, 1/2.2)` anywhere — and its paper constant (0.965, 0.956, 0.932) is
 * likewise authored as display code values, not as linear reflectance. So `exp(-density)` is read
 * back by the browser as an sRGB code, and a pigment whose density came from a *linear* reflectance
 * can never reproduce the colour the artist picked: the picked mid-tones land one transfer function
 * too dark, and the pure channels land on the 0.015 floor where every saturated hue collapses onto
 * whichever channel happens to survive.
 *
 * Product code hands the recipe colour over already linearised, so the pigment model re-encodes it
 * here. Then `exp(-a) === picked colour` in the same space the surface stores, and one coat of
 * pigment is exactly the swatch the artist clicked.
 */
export function studioLivingInkDisplayReflectance(linearChannel: number): number {
  const linear = Math.min(1, Math.max(0, linearChannel));
  return linear <= 0.003_130_8 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
}

/** Absorbance of one coat of the picked colour, in the encoding the display resolve writes. */
export function studioLivingInkPigmentOpticalDensity(linearChannel: number): number {
  return studioLivingInkOpticalDensityFromReflectance(
    studioLivingInkDisplayReflectance(linearChannel),
  );
}

/**
 * One coat of pigment — the deposition calibration that binds a stroke to its palette colour.
 *
 * `studioLivingInkPigmentOpticalDensity` returns the absorbance that reproduces the picked colour
 * at unit optical depth, so the only remaining job is to keep the *accumulated* depth of a single
 * pass near one. Two things used to break that, and both are corrected at deposition rather than in
 * the resolve, because the resolve's plume/granulation/drying-front gains are the wash's physics and
 * must keep their shape:
 *
 * 1. Deposition was per *pointer sample*: each appended batch merged another full-strength capsule
 *    union into the mobile well, so a slow stroke stacked depth in proportion to the sampling rate.
 *    `studioLivingInkPigmentCoatFactor` divides each batch by the path length it actually covered,
 *    measured against the Gaussian capsule's own reach, so one pass over a pixel is one coat no
 *    matter how the samples were grouped or how fast the hand moved.
 * 2. The end-to-end field-to-surface transfer is not unity: capsule maximum-union, pressure/speed
 *    load, capillary reconstruction and transparent surface coverage all change the visible coat.
 *    `resolveGain` is the measured normalization divisor for that complete path, not a taste knob.
 *    It is allowed below one when the physical field carries less than one visible coat.
 */
export const STUDIO_LIVING_INK_PIGMENT_COAT = Object.freeze({
  /** Gaussian falloff the deposit splat uses for pigment capsules. */
  falloff: 3.25,
  /** ∫exp(-falloff·x²/r²)dx / r = √(π/falloff): how far one capsule keeps contributing. */
  profileReach: Math.sqrt(Math.PI / 3.25),
  /** A dwell or a tap still lays pigment; it just cannot lay a full pass per sample. */
  minimumCoat: 0.2,
  /**
   * Measured resolve gain that one coat has to be divided by.
   *
   * The earlier value 6 was measured before the resolve became a transparent wash surface and
   * before linear palette colours were re-encoded to display reflectance. Keeping it after those
   * changes diluted the reviewed browser stroke to 16.77 mean code values of bloom difference and
   * erased edge/granulation gates. The current 0.5 divisor is measured on the complete shipped path:
   * WebGL2/WebGPU retain distinct near-black and chromatic channels while the strict InkWash oracle
   * again sees >63 code values of bloom difference, visible sediment and bounded edge deposition.
   */
  resolveGain: 0.5,
} as const);

/**
 * Fraction of one coat a deposition batch may lay, given the path length it covers.
 *
 * A batch of capsules of radius `r` laid along `pathLengthCells` keeps contributing to a pixel for
 * `profileReach · r` cells in each direction, so a pixel sees roughly `reach / pathLength` batches.
 * Scaling each batch by `pathLength / reach` cancels that exactly, leaving one coat per pass and
 * making the result independent of pointer sampling rate and of how samples were batched.
 */
export function studioLivingInkPigmentCoatFactor(
  pathLengthCells: number,
  radiusCells: number,
): number {
  const reach = STUDIO_LIVING_INK_PIGMENT_COAT.profileReach * Math.max(radiusCells, 1e-3);
  if (!Number.isFinite(pathLengthCells) || pathLengthCells <= 0) return 1;
  return Math.min(
    1,
    Math.max(STUDIO_LIVING_INK_PIGMENT_COAT.minimumCoat, pathLengthCells / reach),
  );
}

/**
 * How the display resolve turns a wash into a *surface* rather than a sheet of paper.
 *
 * The resolve output is committed to the document as one page-sized image, so its alpha channel is
 * the only thing that keeps an untouched webtoon page pure white. Both backends share these numbers
 * so the WGSL and GLSL resolves cannot drift apart on where the paper stops.
 */
export const STUDIO_LIVING_INK_SURFACE_COVERAGE = Object.freeze({
  /** Beer-Lambert style presence: pigment/white/water this far above zero already reads as wash. */
  presenceGain: 24,
  /** Below this alpha the un-premultiply is unstable and the pixel is bare page anyway. */
  alphaEpsilon: 0.0005,
} as const);

/** Minimal geometry both GPU runtimes read off a deposition mark. */
export interface StudioLivingInkMarkGeometry {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * Path length a deposition batch covers, including the gap back to the previous batch's last mark.
 * A stroke arrives as a run of suffix operations, so ignoring that gap would read every batch as a
 * standing dab and re-lay a full coat per pointer sample.
 */
export function studioLivingInkDepositionPathLength(
  marks: readonly StudioLivingInkMarkGeometry[],
  previous: Readonly<{ x: number; y: number }> | null,
): number {
  let total = 0;
  let lastX = previous?.x ?? null;
  let lastY = previous?.y ?? null;
  for (const mark of marks) {
    if (lastX !== null && lastY !== null) {
      total += Math.hypot(mark.x - lastX, mark.y - lastY);
    }
    lastX = mark.x;
    lastY = mark.y;
  }
  return total;
}

/** Representative capsule radius of a batch, used as the coat normalisation's reach. */
export function studioLivingInkMeanMarkRadius(
  marks: readonly StudioLivingInkMarkGeometry[],
): number {
  if (marks.length === 0) return 1;
  let total = 0;
  for (const mark of marks) total += Math.max(0, mark.radius);
  return total / marks.length;
}

/**
 * InkWash §06 chromatography coefficients. The WebGL2 pigment pass uploads the same numbers via
 * `studioLivingInkChromaBleedMultipliers` each step — keep this object as the single numeric source.
 */
export const STUDIO_LIVING_INK_CHROMA_COEFFS = Object.freeze({
  redGain: 0.85,
  greenGain: 0.15,
  blueLoss: 0.65,
  blueFloor: 0.25,
} as const);

/**
 * Default InkWash chromatography amount on the CPU oracle. Kept in lockstep with
 * `DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS.chromaticSeparation` (gpu-protocol imports this
 * file, so the number is authored here).
 */
export const STUDIO_LIVING_INK_DEFAULT_CHROMATIC_SEPARATION = 0.08 as const;

/**
 * InkWash §06 brush-tip scrub bleed: `base + gain * footprint` multiplies the wet bleed rate.
 * Uploaded as uniforms by the WebGL2 pigment pass (not re-derived in GLSL).
 */
export const STUDIO_LIVING_INK_BRUSH_BLEED = Object.freeze({
  base: 0.25,
  gain: 1.3,
  diffusionDtScale: 9,
  diffusionCeiling: 0.28,
  channelCeiling: 0.92,
  whiteChannelGain: 1.05,
} as const);

/**
 * InkWash §06 chromatography: per-channel optical-density bleed rates.
 * Red-absorbing dye (reads cyan-blue) escapes fastest; blue-absorbing dye drags.
 * Shared by the WebGL2 pigment pass (uniforms) and unit tests.
 */
export function studioLivingInkChromaBleedMultipliers(
  chromaticSeparation: number,
): readonly [number, number, number] {
  const chroma = Math.min(1, Math.max(0, chromaticSeparation));
  const { redGain, greenGain, blueLoss, blueFloor } = STUDIO_LIVING_INK_CHROMA_COEFFS;
  return Object.freeze([
    1 + redGain * chroma,
    1 + greenGain * chroma,
    Math.max(blueFloor, 1 - blueLoss * chroma),
  ]);
}

/**
 * Brush-tip scrubbing boost from InkWash §06: bleed runs ~5× faster under the bristles.
 * `brushFootprint` is a unit gaussian (0 outside the tip); returns the scalar multiplier on bleed.
 */
export function studioLivingInkBrushBleedBoost(brushFootprint: number): number {
  const footprint = Math.min(1, Math.max(0, brushFootprint));
  return STUDIO_LIVING_INK_BRUSH_BLEED.base + STUDIO_LIVING_INK_BRUSH_BLEED.gain * footprint;
}

/**
 * CPU ink-wash step: the living-ink tile field with InkWash §06 per-channel bleed rates.
 * Dry cells stay put because the tile field gates mobility on surface water; overlapping
 * deposits add optical density (Beer–Lambert) rather than averaging RGB.
 */
export function advanceStudioInkWashField(
  settingsInput: unknown,
  stateInput: unknown,
  fixedTicksInput: unknown,
  chromaticSeparation: number = STUDIO_LIVING_INK_DEFAULT_CHROMATIC_SEPARATION,
): ReturnType<typeof advanceStudioWetMediaTileField> {
  return advanceStudioWetMediaTileField(
    settingsInput,
    stateInput,
    fixedTicksInput,
    studioLivingInkChromaBleedMultipliers(chromaticSeparation),
  );
}

/**
 * Per-channel diffusion blend amounts for one pigment step. The WebGL2 pigment fragment samples
 * the same rates through uniforms computed here each tick — formula drift fails unit tests.
 */
export function studioLivingInkPigmentDiffusionRates(input: Readonly<{
  bleed: number;
  mobility: number;
  dt: number;
  brushFootprint: number;
  chromaticSeparation: number;
}>): readonly [number, number, number, number] {
  const bleed = Math.min(1, Math.max(0, input.bleed));
  const mobility = Math.min(1, Math.max(0, input.mobility));
  const dt = Math.max(0, input.dt);
  const brushBleed = studioLivingInkBrushBleedBoost(input.brushFootprint);
  const chroma = studioLivingInkChromaBleedMultipliers(input.chromaticSeparation);
  const { diffusionDtScale, diffusionCeiling, channelCeiling, whiteChannelGain } =
    STUDIO_LIVING_INK_BRUSH_BLEED;
  const diffusion = Math.min(
    diffusionCeiling,
    Math.max(0, bleed * brushBleed * mobility * dt * diffusionDtScale),
  );
  return Object.freeze([
    Math.min(channelCeiling, Math.max(0, diffusion * chroma[0])),
    Math.min(channelCeiling, Math.max(0, diffusion * chroma[1])),
    Math.min(channelCeiling, Math.max(0, diffusion * chroma[2])),
    Math.min(channelCeiling, Math.max(0, diffusion * whiteChannelGain)),
  ]);
}

export const STUDIO_LIVING_INK_LIMITS = Object.freeze({
  maxCpuCells: 262_144,
  maxMarksPerOperation: 4_096,
  maxGeneratedDepositions: STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxDepositionOperations,
  maxBrushRadiusCells: 96,
  maxSpeedCellsPerSecond: 100_000,
  maxSnapshotBytes: 128 * 1_024 * 1_024,
  maxWhiteTransportCellWork: 8_388_608,
  cooperativeMarkBatch: 16,
  cooperativeCellBatch: 8_192,
} as const);

export interface StudioLivingInkBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioLivingInkSelectionMask {
  readonly kind: "studio-living-ink-selection-mask";
  readonly version: typeof STUDIO_LIVING_INK_FIELD_VERSION;
  readonly bounds: StudioLivingInkBounds;
  /** Row-major alpha coverage. Values are finite and in [0, 1]. */
  readonly coverage: readonly number[];
}

export interface StudioLivingInkMark {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly pressure: number;
  readonly speed: number;
  /** Nominal mass before pressure, speed and selection coverage are applied. */
  readonly waterMass: number;
  readonly pigmentMass: number;
  readonly color: StudioWetMediaLinearRgba;
}

export interface StudioLivingWaterMark {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly pressure: number;
  readonly speed: number;
  readonly waterMass: number;
}

interface StudioLivingInkOperationBase {
  readonly version: typeof STUDIO_LIVING_INK_FIELD_VERSION;
  readonly sequence: number;
}

export interface StudioLivingInkDepositOperation extends StudioLivingInkOperationBase {
  readonly kind: "ink";
  readonly tool: "pen" | "brush" | "pigment-water-brush" | "white-gouache";
  readonly marks: readonly StudioLivingInkMark[];
  readonly selection: StudioLivingInkSelectionMask | null;
}

export interface StudioLivingInkWaterOperation extends StudioLivingInkOperationBase {
  readonly kind: "water";
  readonly tool: "water-brush";
  readonly marks: readonly StudioLivingWaterMark[];
  readonly selection: StudioLivingInkSelectionMask | null;
}

export interface StudioLivingInkFixOperation extends StudioLivingInkOperationBase {
  readonly kind: "fix";
  readonly scope: "all" | "selection";
  readonly selection: StudioLivingInkSelectionMask | null;
}

export interface StudioLivingInkClearOperation extends StudioLivingInkOperationBase {
  readonly kind: "clear";
  readonly scope: "all" | "selection";
  readonly selection: StudioLivingInkSelectionMask | null;
}

export interface StudioLivingInkAdvanceOperation extends StudioLivingInkOperationBase {
  readonly kind: "advance";
  readonly fixedTicks: number;
}

export type StudioLivingInkOperation =
  | StudioLivingInkDepositOperation
  | StudioLivingInkWaterOperation
  | StudioLivingInkFixOperation
  | StudioLivingInkClearOperation
  | StudioLivingInkAdvanceOperation;

export interface StudioLivingInkSession {
  readonly kind: typeof STUDIO_LIVING_INK_FIELD_KIND;
  readonly version: typeof STUDIO_LIVING_INK_FIELD_VERSION;
  readonly revision: number;
  readonly nextSequence: number;
  /** Fixed pigment never returns to the mobile well after an explicit fix. */
  readonly fixedPigmentPolicy: "immutable";
  readonly settings: StudioWetMediaTileFieldSettings;
  readonly state: StudioWetMediaTileFieldState;
  /**
   * Mobile opaque-white coverage is independent from dark pigment optical density. It must remain
   * in the canonical session until Fix consumes it, otherwise save/reopen and undo would silently
   * lose a white-gouache stroke that the GPU still displays.
   */
  readonly mobileWhiteGouacheCoverage: readonly number[];
}

export interface StudioLivingInkOperationReceipt {
  readonly kind: "studio-living-ink-operation-receipt";
  readonly version: typeof STUDIO_LIVING_INK_FIELD_VERSION;
  readonly sequence: number;
  readonly operationKind: StudioLivingInkOperation["kind"];
  readonly operationSha256: `sha256:${string}`;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly tickBefore: number;
  readonly tickAfter: number;
  readonly dirtyBounds: StudioLivingInkBounds | null;
  readonly generatedDepositions: number;
  readonly estimatedCellWork: number;
  readonly fixedPigmentPolicy: "immutable";
}

export interface StudioLivingInkUndoPayload {
  readonly kind: "studio-living-ink-undo";
  readonly version: typeof STUDIO_LIVING_INK_FIELD_VERSION;
  readonly sequence: number;
  readonly expectedSession: StudioLivingInkSession;
  readonly previousSession: StudioLivingInkSession;
}

export interface StudioLivingInkAppliedOperation {
  readonly session: StudioLivingInkSession;
  readonly receipt: StudioLivingInkOperationReceipt;
  readonly undo: StudioLivingInkUndoPayload;
}

export type StudioLivingInkFailureReason =
  | "invalid-session"
  | "invalid-operation"
  | "sequence-mismatch"
  | "budget-exceeded"
  | "aborted"
  | "field-rejected"
  | "integrity-mismatch";

export type StudioLivingInkResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: StudioLivingInkFailureReason; path: string }>;

export interface StudioLivingInkOperationOptions {
  readonly signal?: Pick<AbortSignal, "aborted"> | null;
  /** Tests and Workers can inject a scheduler; the default yields a macrotask between batches. */
  readonly yieldControl?: () => Promise<void>;
}

export interface StudioLivingInkSnapshotReceipt {
  readonly kind: "studio-living-ink-snapshot-receipt";
  readonly version: typeof STUDIO_LIVING_INK_FIELD_VERSION;
  readonly byteLength: number;
  readonly cellCount: number;
  readonly revision: number;
  readonly tick: number;
  readonly sha256: `sha256:${string}`;
}

export interface StudioLivingInkEncodedSnapshot {
  readonly bytes: Uint8Array;
  readonly receipt: StudioLivingInkSnapshotReceipt;
}

interface RasterizedMarks {
  readonly depositions: readonly StudioWetMediaTileFieldDeposition[];
  readonly whiteCoverageDepositions: readonly Readonly<{
    readonly cellIndex: number;
    readonly coverageDelta: number;
  }>[];
  readonly dirtyBounds: StudioLivingInkBounds | null;
  readonly estimatedCellWork: number;
}

const TRUSTED_SESSIONS = new WeakSet<object>();

function trustedSession(session: StudioLivingInkSession): StudioLivingInkSession {
  TRUSTED_SESSIONS.add(session);
  return session;
}

function failure<T>(
  reason: StudioLivingInkFailureReason,
  path: string,
): StudioLivingInkResult<T> {
  return Object.freeze({ ok: false, reason, path });
}

function success<T>(value: T): StudioLivingInkResult<T> {
  return Object.freeze({ ok: true, value });
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function aborted(signal?: Pick<AbortSignal, "aborted"> | null): boolean {
  try {
    return signal?.aborted === true;
  } catch {
    return true;
  }
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

async function cooperativeYield(options: StudioLivingInkOperationOptions): Promise<boolean> {
  await (options.yieldControl ?? defaultYieldControl)();
  return aborted(options.signal);
}

function normalizeSession(input: unknown): StudioLivingInkResult<StudioLivingInkSession> {
  if (
    input !== null
    && typeof input === "object"
    && TRUSTED_SESSIONS.has(input)
  ) return success(input as StudioLivingInkSession);
  if (
    !isPlainRecord(input)
    || !hasExactKeys(input, [
      "kind",
      "version",
      "revision",
      "nextSequence",
      "fixedPigmentPolicy",
      "settings",
      "state",
      "mobileWhiteGouacheCoverage",
    ])
    || input.kind !== STUDIO_LIVING_INK_FIELD_KIND
    || input.version !== STUDIO_LIVING_INK_FIELD_VERSION
    || input.fixedPigmentPolicy !== "immutable"
    || !safeInteger(input.revision, 0, Number.MAX_SAFE_INTEGER - 1)
    || !safeInteger(input.nextSequence, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return failure("invalid-session", "$.session");
  }
  const settings = parseStudioWetMediaTileFieldSettings(input.settings);
  if (!settings.ok) return failure("invalid-session", `$.settings${settings.path.slice(1)}`);
  const cells = settings.value.width * settings.value.height;
  if (cells > STUDIO_LIVING_INK_LIMITS.maxCpuCells) {
    return failure("budget-exceeded", "$.settings.width");
  }
  const state = parseStudioWetMediaTileFieldState(input.state, settings.value);
  if (!state.ok) return failure("invalid-session", `$.state${state.path.slice(1)}`);
  if (!Array.isArray(input.mobileWhiteGouacheCoverage)) {
    return failure("invalid-session", "$.mobileWhiteGouacheCoverage");
  }
  if (input.mobileWhiteGouacheCoverage.length !== cells) {
    return failure("invalid-session", "$.mobileWhiteGouacheCoverage.length");
  }
  const mobileWhiteGouacheCoverage = new Array<number>(cells);
  for (let index = 0; index < cells; index += 1) {
    const value = input.mobileWhiteGouacheCoverage[index];
    if (!finite(value, 0, settings.value.maxCellPigment)) {
      return failure("invalid-session", `$.mobileWhiteGouacheCoverage[${index}]`);
    }
    if (state.value.activeMask[index] === 0 && value !== 0) {
      return failure("invalid-session", `$.mobileWhiteGouacheCoverage[${index}]`);
    }
    mobileWhiteGouacheCoverage[index] = Object.is(value, -0) ? 0 : value;
  }
  return success(trustedSession(Object.freeze({
    kind: STUDIO_LIVING_INK_FIELD_KIND,
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    revision: input.revision,
    nextSequence: input.nextSequence,
    fixedPigmentPolicy: "immutable",
    settings: settings.value,
    state: state.value,
    mobileWhiteGouacheCoverage: Object.freeze(mobileWhiteGouacheCoverage),
  })));
}

function normalizeBounds(
  input: unknown,
  settings: StudioWetMediaTileFieldSettings,
  path: string,
): StudioLivingInkResult<StudioLivingInkBounds> {
  if (
    !isPlainRecord(input)
    || !hasExactKeys(input, ["x", "y", "width", "height"])
    || !safeInteger(input.x, 0, settings.width - 1)
    || !safeInteger(input.y, 0, settings.height - 1)
    || !safeInteger(input.width, 1, settings.width)
    || !safeInteger(input.height, 1, settings.height)
    || input.x + input.width > settings.width
    || input.y + input.height > settings.height
  ) {
    return failure("invalid-operation", path);
  }
  return success(Object.freeze({
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
  }));
}

function normalizeSelection(
  input: unknown,
  settings: StudioWetMediaTileFieldSettings,
  path: string,
): StudioLivingInkResult<StudioLivingInkSelectionMask | null> {
  if (input === null) return success(null);
  if (
    !isPlainRecord(input)
    || !hasExactKeys(input, ["kind", "version", "bounds", "coverage"])
    || input.kind !== "studio-living-ink-selection-mask"
    || input.version !== STUDIO_LIVING_INK_FIELD_VERSION
    || !Array.isArray(input.coverage)
  ) {
    return failure("invalid-operation", path);
  }
  const bounds = normalizeBounds(input.bounds, settings, `${path}.bounds`);
  if (!bounds.ok) return bounds;
  const expected = bounds.value.width * bounds.value.height;
  if (input.coverage.length !== expected || expected > STUDIO_LIVING_INK_LIMITS.maxCpuCells) {
    return failure("budget-exceeded", `${path}.coverage`);
  }
  const coverage = new Array<number>(expected);
  for (let index = 0; index < expected; index += 1) {
    const value = input.coverage[index];
    if (!finite(value, 0, 1)) return failure("invalid-operation", `${path}.coverage[${index}]`);
    coverage[index] = Object.is(value, -0) ? 0 : value;
  }
  return success(Object.freeze({
    kind: "studio-living-ink-selection-mask",
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    bounds: bounds.value,
    coverage: Object.freeze(coverage),
  }));
}

function coverageAt(
  selection: StudioLivingInkSelectionMask | null,
  x: number,
  y: number,
): number {
  if (!selection) return 1;
  const { bounds } = selection;
  if (
    x < bounds.x
    || y < bounds.y
    || x >= bounds.x + bounds.width
    || y >= bounds.y + bounds.height
  ) return 0;
  return selection.coverage[
    (y - bounds.y) * bounds.width + (x - bounds.x)
  ] ?? 0;
}

function expandBounds(
  current: StudioLivingInkBounds | null,
  x: number,
  y: number,
): StudioLivingInkBounds {
  if (!current) return { x, y, width: 1, height: 1 };
  const left = Math.min(current.x, x);
  const top = Math.min(current.y, y);
  const right = Math.max(current.x + current.width - 1, x);
  const bottom = Math.max(current.y + current.height - 1, y);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function validColor(value: unknown): value is StudioWetMediaLinearRgba {
  return Array.isArray(value)
    && value.length === 4
    && value.every((channel) => finite(channel, 0, 1));
}

function validMark(
  mark: unknown,
  settings: StudioWetMediaTileFieldSettings,
  waterOnly: boolean,
): mark is StudioLivingInkMark | StudioLivingWaterMark {
  if (!isPlainRecord(mark)) return false;
  const expected = waterOnly
    ? ["x", "y", "radius", "pressure", "speed", "waterMass"]
    : ["x", "y", "radius", "pressure", "speed", "waterMass", "pigmentMass", "color"];
  return hasExactKeys(mark, expected)
    && finite(mark.x, -STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells, settings.width + STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells)
    && finite(mark.y, -STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells, settings.height + STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells)
    && finite(mark.radius, 0.25, STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells)
    && finite(mark.pressure, 0, 1)
    && finite(mark.speed, 0, STUDIO_LIVING_INK_LIMITS.maxSpeedCellsPerSecond)
    && finite(mark.waterMass, 0, settings.maxCellWater)
    && (waterOnly || (
      finite(mark.pigmentMass, 0, settings.maxCellPigment)
      && validColor(mark.color)
    ));
}

function toolDynamics(
  tool: "pen" | "brush" | "pigment-water-brush" | "white-gouache" | "water-brush",
  pressure: number,
  speed: number,
): Readonly<{ radius: number; load: number }> {
  const normalizedSpeed = tool === "pen" ? speed / 1_400 : speed / 2_400;
  const speedRetention = 1 / (1 + normalizedSpeed);
  if (tool === "pen") {
    return Object.freeze({
      radius: 0.42 + pressure * 0.58,
      load: (0.12 + pressure * 0.88) * (0.48 + speedRetention * 0.52),
    });
  }
  const rootPressure = Math.sqrt(pressure);
  if (tool === "white-gouache") {
    return Object.freeze({
      radius: 0.72 + rootPressure * 0.38,
      load: (0.5 + pressure * 0.5) * (0.72 + speedRetention * 0.28),
    });
  }
  if (tool === "pigment-water-brush") {
    return Object.freeze({
      radius: 0.68 + rootPressure * 0.52,
      load: (0.22 + pressure * 0.78) * (0.52 + speedRetention * 0.48),
    });
  }
  return Object.freeze({
    radius: 0.62 + rootPressure * 0.48,
    load: (0.28 + pressure * 0.72) * (0.56 + speedRetention * 0.44),
  });
}

async function rasterizeMarks(
  session: StudioLivingInkSession,
  operation: StudioLivingInkDepositOperation | StudioLivingInkWaterOperation,
  selection: StudioLivingInkSelectionMask | null,
  options: StudioLivingInkOperationOptions,
): Promise<StudioLivingInkResult<RasterizedMarks>> {
  if (
    !Array.isArray(operation.marks)
    || operation.marks.length > STUDIO_LIVING_INK_LIMITS.maxMarksPerOperation
  ) return failure("budget-exceeded", "$.operation.marks");

  const waterOnly = operation.kind === "water";
  const whiteGouache = operation.kind === "ink" && operation.tool === "white-gouache";
  const depositions: StudioWetMediaTileFieldDeposition[] = [];
  const whiteCoverageDepositions: Array<Readonly<{
    cellIndex: number;
    coverageDelta: number;
  }>> = [];
  let dirtyBounds: StudioLivingInkBounds | null = null;
  let estimatedCellWork = 0;

  for (let markIndex = 0; markIndex < operation.marks.length; markIndex += 1) {
    if (aborted(options.signal)) return failure("aborted", "$.operation");
    const mark = operation.marks[markIndex];
    if (!validMark(mark, session.settings, waterOnly)) {
      return failure("invalid-operation", `$.operation.marks[${markIndex}]`);
    }
    const dynamics = toolDynamics(operation.tool, mark.pressure, mark.speed);
    const radius = mark.radius * dynamics.radius;
    const left = Math.max(0, Math.floor(mark.x - radius));
    const top = Math.max(0, Math.floor(mark.y - radius));
    const right = Math.min(session.settings.width - 1, Math.ceil(mark.x + radius));
    const bottom = Math.min(session.settings.height - 1, Math.ceil(mark.y + radius));
    const candidates: Array<Readonly<{ x: number; y: number; weight: number; coverage: number }>> = [];
    let kernelWeight = 0;

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        estimatedCellWork += 1;
        const dx = x + 0.5 - mark.x;
        const dy = y + 0.5 - mark.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > radius * radius) continue;
        const weight = Math.exp(-2.75 * distanceSquared / Math.max(0.0625, radius * radius));
        kernelWeight += weight;
        const maskCoverage = coverageAt(selection, x, y);
        const cellIndex = y * session.settings.width + x;
        if (maskCoverage > 0 && session.state.activeMask[cellIndex] === 1) {
          candidates.push({ x, y, weight, coverage: maskCoverage });
        }
      }
    }
    if (kernelWeight > 0) {
      const sourceColor = waterOnly ? null : (mark as StudioLivingInkMark).color;
      const color: StudioWetMediaLinearRgba = waterOnly
        ? Object.freeze([0, 0, 0, 0])
        : Object.freeze([
            Math.min(STUDIO_LIVING_INK_REFLECTANCE_RANGE.maximum, Math.max(STUDIO_LIVING_INK_REFLECTANCE_RANGE.minimum, sourceColor![0])),
            Math.min(STUDIO_LIVING_INK_REFLECTANCE_RANGE.maximum, Math.max(STUDIO_LIVING_INK_REFLECTANCE_RANGE.minimum, sourceColor![1])),
            Math.min(STUDIO_LIVING_INK_REFLECTANCE_RANGE.maximum, Math.max(STUDIO_LIVING_INK_REFLECTANCE_RANGE.minimum, sourceColor![2])),
            sourceColor![3],
          ]) as StudioWetMediaLinearRgba;
      const alpha = waterOnly ? 1 : color[3];
      for (const candidate of candidates) {
        if (depositions.length >= STUDIO_LIVING_INK_LIMITS.maxGeneratedDepositions) {
          return failure("budget-exceeded", "$.operation.marks");
        }
        const share = candidate.weight * candidate.coverage / kernelWeight;
        const cellIndex = candidate.y * session.settings.width + candidate.x;
        const pigmentLoad = waterOnly
          ? 0
          : (mark as StudioLivingInkMark).pigmentMass
            * dynamics.load
            * alpha
            * share
            * (whiteGouache ? STUDIO_LIVING_INK_WHITE_GOUACHE_LOAD_GAIN : 1);
        depositions.push(Object.freeze({
          cellIndex,
          waterMassDelta: mark.waterMass * dynamics.load * share,
          // Opaque white is a transmittance/coverage well, not a near-zero dark optical density.
          pigmentMassDelta: whiteGouache ? 0 : pigmentLoad,
          color,
        }));
        if (whiteGouache && pigmentLoad > 0) {
          whiteCoverageDepositions.push(Object.freeze({
            cellIndex,
            coverageDelta: pigmentLoad,
          }));
        }
        dirtyBounds = expandBounds(dirtyBounds, candidate.x, candidate.y);
      }
    }
    if (
      markIndex + 1 < operation.marks.length
      && (markIndex + 1) % STUDIO_LIVING_INK_LIMITS.cooperativeMarkBatch === 0
      && await cooperativeYield(options)
    ) return failure("aborted", "$.operation");
  }
  return success(Object.freeze({
    depositions: Object.freeze(depositions),
    whiteCoverageDepositions: Object.freeze(whiteCoverageDepositions),
    dirtyBounds: dirtyBounds ? Object.freeze(dirtyBounds) : null,
    estimatedCellWork,
  }));
}

function buildSession(
  previous: StudioLivingInkSession,
  state: StudioWetMediaTileFieldState,
  mobileWhiteGouacheCoverage = previous.mobileWhiteGouacheCoverage,
): StudioLivingInkSession {
  return trustedSession(Object.freeze({
    kind: STUDIO_LIVING_INK_FIELD_KIND,
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    revision: previous.revision + 1,
    nextSequence: previous.nextSequence + 1,
    fixedPigmentPolicy: "immutable",
    settings: previous.settings,
    state,
    mobileWhiteGouacheCoverage,
  }));
}

function applyWhiteCoverageDepositions(
  session: StudioLivingInkSession,
  depositions: RasterizedMarks["whiteCoverageDepositions"],
): readonly number[] {
  if (depositions.length === 0) return session.mobileWhiteGouacheCoverage;
  const next = Array.from(session.mobileWhiteGouacheCoverage);
  for (const deposition of depositions) {
    next[deposition.cellIndex] = Math.min(
      session.settings.maxCellPigment,
      (next[deposition.cellIndex] ?? 0) + deposition.coverageDelta,
    );
  }
  return Object.freeze(next);
}

function livingInkPairOpen(
  state: StudioWetMediaTileFieldState,
  left: number,
  right: number,
  leftCut: number,
  rightCut: number,
): boolean {
  return state.activeMask[left] === 1
    && state.activeMask[right] === 1
    && ((state.cutBoundaryMask[left] ?? 0) & leftCut) === 0
    && ((state.cutBoundaryMask[right] ?? 0) & rightCut) === 0;
}

/**
 * Moves the opaque-white scalar through the CPU oracle's conservative, anisotropic open-edge
 * diffusion family. GPU replay additionally has velocity/chromatography advection, so parity is
 * bounded rather than bit-exact. Selection is baked into deposition; active/cut masks remain hard
 * transport boundaries. The extra scalar work has an explicit budget and cooperative abort points.
 */
async function advanceMobileWhiteGouacheCoverage(
  session: StudioLivingInkSession,
  evolvedState: StudioWetMediaTileFieldState,
  fixedTicks: number,
  options: StudioLivingInkOperationOptions,
): Promise<StudioLivingInkResult<Readonly<{
  coverage: readonly number[];
  estimatedCellWork: number;
}>>> {
  if (!session.mobileWhiteGouacheCoverage.some((coverage) => coverage > 0)) {
    return success(Object.freeze({
      coverage: session.mobileWhiteGouacheCoverage,
      estimatedCellWork: 0,
    }));
  }
  const maximumWork = session.settings.width * session.settings.height * fixedTicks * 2;
  if (maximumWork > STUDIO_LIVING_INK_LIMITS.maxWhiteTransportCellWork) {
    return failure("budget-exceeded", "$.operation.fixedTicks");
  }
  const values = Array.from(session.mobileWhiteGouacheCoverage);
  const { settings, state } = session;
  let estimatedCellWork = 0;
  const transfer = (left: number, right: number, axisX: number, axisY: number): void => {
    const difference = (values[left] ?? 0) - (values[right] ?? 0);
    if (difference === 0) return;
    const wetMobility = Math.min(1, (
      (state.surfaceWater[left] ?? 0)
      + (state.surfaceWater[right] ?? 0)
      + (evolvedState.surfaceWater[left] ?? 0)
      + (evolvedState.surfaceWater[right] ?? 0)
    ) / (4 * settings.dryThreshold));
    if (wetMobility <= 0) return;
    const leftAngle = state.fiberDirectionRadians[left] ?? 0;
    const rightAngle = state.fiberDirectionRadians[right] ?? 0;
    const alignment = (
      (Math.cos(leftAngle) * axisX + Math.sin(leftAngle) * axisY) ** 2
      + (Math.cos(rightAngle) * axisX + Math.sin(rightAngle) * axisY) ** 2
    ) / 2;
    const conductance = settings.anisotropy <= 0
      ? 1
      : 1 - settings.anisotropy + 2 * settings.anisotropy * alignment;
    const coefficient = Math.min(
      0.49,
      settings.pigmentDiffusionRate * wetMobility * conductance,
    );
    const from = difference > 0 ? left : right;
    const to = difference > 0 ? right : left;
    const amount = Math.min(
      Math.abs(difference) * coefficient,
      values[from] ?? 0,
      settings.maxCellPigment - (values[to] ?? 0),
    );
    if (amount <= 0) return;
    values[from] = Math.max(0, (values[from] ?? 0) - amount);
    values[to] = (values[to] ?? 0) + amount;
  };

  for (let tick = 0; tick < fixedTicks; tick += 1) {
    for (let y = 0; y < settings.height; y += 1) {
      const row = y * settings.width;
      for (let x = 0; x + 1 < settings.width; x += 1) {
        const left = row + x;
        const right = left + 1;
        estimatedCellWork += 1;
        if (livingInkPairOpen(
          state,
          left,
          right,
          STUDIO_WET_MEDIA_CUT.east,
          STUDIO_WET_MEDIA_CUT.west,
        )) transfer(left, right, 1, 0);
        if (
          estimatedCellWork % STUDIO_LIVING_INK_LIMITS.cooperativeCellBatch === 0
          && await cooperativeYield(options)
        ) return failure("aborted", "$.operation");
      }
    }
    for (let y = 0; y + 1 < settings.height; y += 1) {
      const row = y * settings.width;
      const nextRow = row + settings.width;
      for (let x = 0; x < settings.width; x += 1) {
        const top = row + x;
        const bottom = nextRow + x;
        estimatedCellWork += 1;
        if (livingInkPairOpen(
          state,
          top,
          bottom,
          STUDIO_WET_MEDIA_CUT.south,
          STUDIO_WET_MEDIA_CUT.north,
        )) transfer(top, bottom, 0, 1);
        if (
          estimatedCellWork % STUDIO_LIVING_INK_LIMITS.cooperativeCellBatch === 0
          && await cooperativeYield(options)
        ) return failure("aborted", "$.operation");
      }
    }
  }
  if (aborted(options.signal)) return failure("aborted", "$.operation");
  return success(Object.freeze({
    coverage: Object.freeze(values),
    estimatedCellWork,
  }));
}

async function applyFixOrClear(
  session: StudioLivingInkSession,
  operation: StudioLivingInkFixOperation | StudioLivingInkClearOperation,
  selection: StudioLivingInkSelectionMask | null,
  options: StudioLivingInkOperationOptions,
): Promise<StudioLivingInkResult<Readonly<{
  state: StudioWetMediaTileFieldState;
  mobileWhiteGouacheCoverage: readonly number[];
  dirtyBounds: StudioLivingInkBounds;
  estimatedCellWork: number;
}>>> {
  const cells = session.settings.width * session.settings.height;
  const source = session.state;
  const surfaceWater = Array.from(source.surfaceWater);
  const absorbedPaperWater = Array.from(source.absorbedPaperWater);
  const mobilePigmentMass = Array.from(source.mobilePigmentMass);
  const fixedPigmentMass = Array.from(source.fixedPigmentMass);
  const mobileDensity = source.mobilePigmentOpticalDensity.map((channel) => Array.from(channel)) as [number[], number[], number[]];
  const fixedDensity = source.fixedPigmentOpticalDensity.map((channel) => Array.from(channel)) as [number[], number[], number[]];
  const rewetEnergy = Array.from(source.rewetEnergy);
  const mobileWhiteGouacheCoverage = Array.from(session.mobileWhiteGouacheCoverage);

  for (let index = 0; index < cells; index += 1) {
    const x = index % session.settings.width;
    const y = Math.floor(index / session.settings.width);
    const coverage = operation.scope === "all" ? 1 : coverageAt(selection, x, y);
    if (coverage > 0) {
      const keep = 1 - coverage;
      if (operation.kind === "fix") {
        const acceptedWhite = (mobileWhiteGouacheCoverage[index] ?? 0) * coverage;
        if (acceptedWhite > 0) {
          const bleachCoverage = 1 - Math.exp(
            -STUDIO_LIVING_INK_WHITE_GOUACHE_EXTINCTION * acceptedWhite,
          );
          for (let channel = 0; channel < 3; channel += 1) {
            const previousDensity = fixedDensity[channel][index] ?? 0;
            const previousTransmittance = Math.exp(-previousDensity);
            const bleachedTransmittance = previousTransmittance * (1 - bleachCoverage)
              + bleachCoverage;
            fixedDensity[channel][index] = -Math.log(
              Math.min(1, Math.max(1e-5, bleachedTransmittance)),
            );
          }
        }
        const mobileMass = mobilePigmentMass[index] ?? 0;
        fixedPigmentMass[index] = (fixedPigmentMass[index] ?? 0) + mobileMass * coverage;
        mobilePigmentMass[index] = mobileMass * keep;
        for (let channel = 0; channel < 3; channel += 1) {
          const mobile = mobileDensity[channel][index] ?? 0;
          fixedDensity[channel][index] = (fixedDensity[channel][index] ?? 0) + mobile * coverage;
          mobileDensity[channel][index] = mobile * keep;
        }
        mobileWhiteGouacheCoverage[index] = (mobileWhiteGouacheCoverage[index] ?? 0) * keep;
      } else {
        mobilePigmentMass[index] = (mobilePigmentMass[index] ?? 0) * keep;
        fixedPigmentMass[index] = (fixedPigmentMass[index] ?? 0) * keep;
        for (let channel = 0; channel < 3; channel += 1) {
          mobileDensity[channel][index] = (mobileDensity[channel][index] ?? 0) * keep;
          fixedDensity[channel][index] = (fixedDensity[channel][index] ?? 0) * keep;
        }
        mobileWhiteGouacheCoverage[index] = (mobileWhiteGouacheCoverage[index] ?? 0) * keep;
      }
      surfaceWater[index] = (surfaceWater[index] ?? 0) * keep;
      absorbedPaperWater[index] = (absorbedPaperWater[index] ?? 0) * keep;
      rewetEnergy[index] = (rewetEnergy[index] ?? 0) * keep;
    }
    if (
      index + 1 < cells
      && (index + 1) % STUDIO_LIVING_INK_LIMITS.cooperativeCellBatch === 0
      && await cooperativeYield(options)
    ) return failure("aborted", "$.operation");
  }
  if (aborted(options.signal)) return failure("aborted", "$.operation");
  const parsed = parseStudioWetMediaTileFieldState({
    ...source,
    surfaceWater,
    absorbedPaperWater,
    mobilePigmentMass,
    fixedPigmentMass,
    mobilePigmentOpticalDensity: mobileDensity,
    fixedPigmentOpticalDensity: fixedDensity,
    rewetEnergy,
  }, session.settings);
  if (!parsed.ok) return failure("field-rejected", parsed.path);
  return success(Object.freeze({
    state: parsed.value,
    mobileWhiteGouacheCoverage: Object.freeze(mobileWhiteGouacheCoverage),
    dirtyBounds: Object.freeze(operation.scope === "all"
      ? { x: 0, y: 0, width: session.settings.width, height: session.settings.height }
      : selection!.bounds),
    estimatedCellWork: cells,
  }));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function operationHash(operation: StudioLivingInkOperation): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(canonicalJson(operation)))}`;
}

function operationReceipt(
  previous: StudioLivingInkSession,
  next: StudioLivingInkSession,
  operation: StudioLivingInkOperation,
  dirtyBounds: StudioLivingInkBounds | null,
  generatedDepositions: number,
  estimatedCellWork: number,
): StudioLivingInkOperationReceipt {
  return Object.freeze({
    kind: "studio-living-ink-operation-receipt",
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    sequence: operation.sequence,
    operationKind: operation.kind,
    operationSha256: operationHash(operation),
    revisionBefore: previous.revision,
    revisionAfter: next.revision,
    tickBefore: previous.state.tick,
    tickAfter: next.state.tick,
    dirtyBounds,
    generatedDepositions,
    estimatedCellWork,
    fixedPigmentPolicy: "immutable",
  });
}

function appliedResult(
  previous: StudioLivingInkSession,
  next: StudioLivingInkSession,
  operation: StudioLivingInkOperation,
  dirtyBounds: StudioLivingInkBounds | null,
  generatedDepositions: number,
  estimatedCellWork: number,
): StudioLivingInkResult<StudioLivingInkAppliedOperation> {
  return success(Object.freeze({
    session: next,
    receipt: operationReceipt(
      previous,
      next,
      operation,
      dirtyBounds,
      generatedDepositions,
      estimatedCellWork,
    ),
    undo: Object.freeze({
      kind: "studio-living-ink-undo",
      version: STUDIO_LIVING_INK_FIELD_VERSION,
      sequence: operation.sequence,
      expectedSession: next,
      previousSession: previous,
    }),
  }));
}

export function createStudioLivingInkSession(
  settingsInput: unknown,
  paperInput: StudioWetMediaTileFieldPaper | unknown,
): StudioLivingInkResult<StudioLivingInkSession> {
  const settings = parseStudioWetMediaTileFieldSettings(settingsInput);
  if (!settings.ok) return failure("invalid-session", `$.settings${settings.path.slice(1)}`);
  if (settings.value.width * settings.value.height > STUDIO_LIVING_INK_LIMITS.maxCpuCells) {
    return failure("budget-exceeded", "$.settings.width");
  }
  const field = createStudioWetMediaTileField(settings.value, paperInput);
  if (!field.ok) return failure("invalid-session", `$.paper${field.path.slice(1)}`);
  return success(trustedSession(Object.freeze({
    kind: STUDIO_LIVING_INK_FIELD_KIND,
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    revision: 0,
    nextSequence: 1,
    fixedPigmentPolicy: "immutable",
    settings: settings.value,
    state: field.value,
    mobileWhiteGouacheCoverage: Object.freeze(new Array<number>(
      settings.value.width * settings.value.height,
    ).fill(0)),
  })));
}

/** Applies one atomic operation. The original session is always usable after any failure. */
export async function applyStudioLivingInkOperation(
  sessionInput: unknown,
  operationInput: unknown,
  options: StudioLivingInkOperationOptions = {},
): Promise<StudioLivingInkResult<StudioLivingInkAppliedOperation>> {
  const normalizedSession = normalizeSession(sessionInput);
  if (!normalizedSession.ok) return normalizedSession;
  const session = normalizedSession.value;
  if (aborted(options.signal)) return failure("aborted", "$.operation");
  if (!isPlainRecord(operationInput) || operationInput.version !== STUDIO_LIVING_INK_FIELD_VERSION) {
    return failure("invalid-operation", "$.operation");
  }
  if (operationInput.sequence !== session.nextSequence) {
    return failure("sequence-mismatch", "$.operation.sequence");
  }
  const operation = operationInput as unknown as StudioLivingInkOperation;

  if (operation.kind === "ink" || operation.kind === "water") {
    const exactKeys = operation.kind === "ink"
      ? ["kind", "version", "sequence", "tool", "marks", "selection"]
      : ["kind", "version", "sequence", "tool", "marks", "selection"];
    if (
      !hasExactKeys(operationInput, exactKeys)
      || (
        operation.kind === "ink"
        && operation.tool !== "pen"
        && operation.tool !== "brush"
        && operation.tool !== "pigment-water-brush"
        && operation.tool !== "white-gouache"
      )
      || (operation.kind === "water" && operation.tool !== "water-brush")
    ) return failure("invalid-operation", "$.operation.tool");
    const selection = normalizeSelection(operation.selection, session.settings, "$.operation.selection");
    if (!selection.ok) return selection;
    const rasterized = await rasterizeMarks(session, operation, selection.value, options);
    if (!rasterized.ok) return rasterized;
    if (aborted(options.signal)) return failure("aborted", "$.operation");
    const deposited = applyStudioWetMediaTileFieldDepositions(
      session.settings,
      session.state,
      rasterized.value.depositions,
    );
    if (!deposited.ok) return failure("field-rejected", deposited.path);
    const next = buildSession(
      session,
      deposited.value.state,
      applyWhiteCoverageDepositions(session, rasterized.value.whiteCoverageDepositions),
    );
    return appliedResult(
      session,
      next,
      operation,
      rasterized.value.dirtyBounds,
      rasterized.value.depositions.length,
      rasterized.value.estimatedCellWork,
    );
  }

  if (operation.kind === "fix" || operation.kind === "clear") {
    if (!hasExactKeys(operationInput, ["kind", "version", "sequence", "scope", "selection"])) {
      return failure("invalid-operation", "$.operation");
    }
    if (operation.scope !== "all" && operation.scope !== "selection") {
      return failure("invalid-operation", "$.operation.scope");
    }
    const selection = normalizeSelection(operation.selection, session.settings, "$.operation.selection");
    if (!selection.ok) return selection;
    if (
      (operation.scope === "selection" && !selection.value)
      || (operation.scope === "all" && selection.value)
    ) return failure("invalid-operation", "$.operation.selection");
    const transformed = await applyFixOrClear(session, operation, selection.value, options);
    if (!transformed.ok) return transformed;
    const next = buildSession(
      session,
      transformed.value.state,
      transformed.value.mobileWhiteGouacheCoverage,
    );
    return appliedResult(
      session,
      next,
      operation,
      transformed.value.dirtyBounds,
      0,
      transformed.value.estimatedCellWork,
    );
  }

  if (operation.kind === "advance") {
    if (
      !hasExactKeys(operationInput, ["kind", "version", "sequence", "fixedTicks"])
      || !safeInteger(
        operation.fixedTicks,
        1,
        STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxTicksPerAdvance,
      )
    ) return failure("invalid-operation", "$.operation.fixedTicks");
    if (
      session.mobileWhiteGouacheCoverage.some((coverage) => coverage > 0)
      && session.settings.width * session.settings.height * operation.fixedTicks * 2
        > STUDIO_LIVING_INK_LIMITS.maxWhiteTransportCellWork
    ) return failure("budget-exceeded", "$.operation.fixedTicks");
    const immutableFixedSettings = Object.freeze({ ...session.settings, rewetRate: 0 });
    const advanced = advanceStudioInkWashField(
      immutableFixedSettings,
      session.state,
      operation.fixedTicks,
      STUDIO_LIVING_INK_DEFAULT_CHROMATIC_SEPARATION,
    );
    if (!advanced.ok) return failure("field-rejected", advanced.path);
    if (aborted(options.signal)) return failure("aborted", "$.operation");
    const advancedWhite = await advanceMobileWhiteGouacheCoverage(
      session,
      advanced.value.state,
      operation.fixedTicks,
      options,
    );
    if (!advancedWhite.ok) return advancedWhite;
    const next = buildSession(
      session,
      advanced.value.state,
      advancedWhite.value.coverage,
    );
    return appliedResult(
      session,
      next,
      operation,
      { x: 0, y: 0, width: session.settings.width, height: session.settings.height },
      0,
      session.settings.width * session.settings.height * operation.fixedTicks
        + advancedWhite.value.estimatedCellWork,
    );
  }

  return failure("invalid-operation", "$.operation.kind");
}

/** In-memory undo is exact and O(1): immutable state arrays are never copied again. */
export function undoStudioLivingInkOperation(
  currentSession: StudioLivingInkSession,
  undo: StudioLivingInkUndoPayload,
): StudioLivingInkResult<StudioLivingInkSession> {
  if (
    undo.kind !== "studio-living-ink-undo"
    || undo.version !== STUDIO_LIVING_INK_FIELD_VERSION
    || currentSession !== undo.expectedSession
  ) return failure("integrity-mismatch", "$.undo.expectedSession");
  return success(undo.previousSession);
}

function canonicalSnapshotValue(session: StudioLivingInkSession): Readonly<Record<string, unknown>> {
  return Object.freeze({
    fixedPigmentPolicy: session.fixedPigmentPolicy,
    kind: session.kind,
    nextSequence: session.nextSequence,
    revision: session.revision,
    settings: session.settings,
    state: session.state,
    mobileWhiteGouacheCoverage: session.mobileWhiteGouacheCoverage,
    version: session.version,
  });
}

export function encodeStudioLivingInkSnapshot(
  sessionInput: unknown,
  maximumBytes = STUDIO_LIVING_INK_LIMITS.maxSnapshotBytes,
): StudioLivingInkResult<StudioLivingInkEncodedSnapshot> {
  const session = normalizeSession(sessionInput);
  if (!session.ok) return session;
  if (!safeInteger(maximumBytes, 1, STUDIO_LIVING_INK_LIMITS.maxSnapshotBytes)) {
    return failure("budget-exceeded", "$.maximumBytes");
  }
  const bytes = new TextEncoder().encode(canonicalJson(canonicalSnapshotValue(session.value)));
  if (bytes.byteLength > maximumBytes) return failure("budget-exceeded", "$.snapshot");
  const receipt: StudioLivingInkSnapshotReceipt = Object.freeze({
    kind: "studio-living-ink-snapshot-receipt",
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    byteLength: bytes.byteLength,
    cellCount: session.value.settings.width * session.value.settings.height,
    revision: session.value.revision,
    tick: session.value.state.tick,
    sha256: `sha256:${sha256HexPortable(bytes)}`,
  });
  return success(Object.freeze({ bytes, receipt }));
}

export function decodeStudioLivingInkSnapshot(
  bytes: Uint8Array,
  expectedSha256?: `sha256:${string}`,
): StudioLivingInkResult<StudioLivingInkSession> {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 2
    || bytes.byteLength > STUDIO_LIVING_INK_LIMITS.maxSnapshotBytes
  ) return failure("budget-exceeded", "$.snapshot");
  const digest = `sha256:${sha256HexPortable(bytes)}` as const;
  if (expectedSha256 && digest !== expectedSha256) {
    return failure("integrity-mismatch", "$.snapshot.sha256");
  }
  let parsed: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    return failure("invalid-session", "$.snapshot");
  }
  const session = normalizeSession(parsed);
  if (!session.ok) return session;
  const canonical = canonicalJson(canonicalSnapshotValue(session.value));
  if (canonical !== text) return failure("integrity-mismatch", "$.snapshot.canonical");
  return session;
}

export interface StudioLivingInkStrokeRecipe {
  readonly fieldScale: number;
  readonly baseWidth: number;
  readonly waterLoad: number;
  readonly pigmentLoad: number;
  readonly color: StudioWetMediaLinearRgba;
  readonly tool: "pen" | "brush" | "pigment-water-brush" | "white-gouache";
}

export interface StudioLivingInkStrokeSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly timeMs: number;
}

/**
 * Exact preflight for the mark carrier below. A caller must never infer completion from a
 * truncated mark array: if one pointer segment would exceed the Worker request contract the
 * product route fails closed and preserves the complete retained-vector stroke instead.
 */
export function estimateStudioLivingInkStrokeMarkCount(
  recipe: Pick<StudioLivingInkStrokeRecipe, "baseWidth" | "fieldScale">,
  samples: readonly StudioLivingInkStrokeSample[],
): number {
  if (samples.length === 0) return 0;
  const radius = Math.max(0.25, recipe.baseWidth * recipe.fieldScale * 0.5);
  const maximumStep = Math.max(0.5, radius * 0.28);
  let count = 0;
  for (let index = 0; index < samples.length; index += 1) {
    if (index === 0) {
      count += 1;
      continue;
    }
    const current = samples[index]!;
    const previous = samples[index - 1]!;
    count += Math.max(1, Math.ceil(Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    ) / maximumStep));
    if (count > STUDIO_LIVING_INK_LIMITS.maxMarksPerOperation) return count;
  }
  return count;
}

/**
 * Adapter for the current wet-brush replay: it converts coalesced pressure samples to overlapping
 * field marks, preventing visible station gaps while retaining speed-dependent loading.
 */
export function createStudioLivingInkStrokeOperation(
  sequence: number,
  recipe: StudioLivingInkStrokeRecipe,
  samples: readonly StudioLivingInkStrokeSample[],
  selection: StudioLivingInkSelectionMask | null = null,
): StudioLivingInkDepositOperation {
  const expectedMarks = estimateStudioLivingInkStrokeMarkCount(recipe, samples);
  if (expectedMarks > STUDIO_LIVING_INK_LIMITS.maxMarksPerOperation) {
    throw new RangeError(
      `Living Ink operation requires ${expectedMarks} marks; maximum is ${STUDIO_LIVING_INK_LIMITS.maxMarksPerOperation}.`,
    );
  }
  const marks: StudioLivingInkMark[] = [];
  const radius = Math.max(0.25, recipe.baseWidth * recipe.fieldScale * 0.5);
  const maximumStep = Math.max(0.5, radius * 0.28);
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index]!;
    const previous = samples[Math.max(0, index - 1)]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    const durationSeconds = Math.max(1 / 1_000, (current.timeMs - previous.timeMs) / 1_000);
    const speed = index === 0 ? 0 : distance / durationSeconds;
    const steps = index === 0 ? 0 : Math.max(1, Math.ceil(distance / maximumStep));
    for (let step = index === 0 ? 0 : 1; step <= steps; step += 1) {
      const ratio = steps === 0 ? 0 : step / steps;
      const pressure = previous.pressure + (current.pressure - previous.pressure) * ratio;
      marks.push(Object.freeze({
        x: previous.x + dx * ratio,
        y: previous.y + dy * ratio,
        radius,
        pressure: Math.min(1, Math.max(0, pressure)),
        speed,
        waterMass: recipe.waterLoad,
        pigmentMass: recipe.pigmentLoad,
        color: recipe.color,
      }));
    }
  }
  return Object.freeze({
    kind: "ink",
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    sequence,
    tool: recipe.tool,
    marks: Object.freeze(marks),
    selection,
  });
}
