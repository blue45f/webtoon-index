/**
 * Renderer-neutral individual-fiber bristle/rake brush CPU oracle.
 *
 * The implementation owns no display, host, or scheduling handles. It turns a
 * canonical arc-length replay into a stable bundle topology and an interleaved
 * Float32 deposition stream that later CPU or accelerated renderers can lower.
 * All stochastic-looking variation comes from the explicit recipe seed.
 */

import {
  hashStudioFiberBristleRequestFlow,
} from "./studio-fiber-bristle-brush-integrity";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_FIBER_BRISTLE_RECIPE_VERSION = 1 as const;
export const STUDIO_FIBER_BRISTLE_ORACLE_VERSION = 1 as const;
export const STUDIO_FIBER_BRISTLE_PROVIDER_REVISION = 1 as const;

export const STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE = 8 as const;
export const STUDIO_FIBER_BRISTLE_DEPOSITION_STRIDE = 15 as const;

export const STUDIO_FIBER_BRISTLE_HARD_LIMITS = Object.freeze({
  maximumFibers: 512,
  maximumInputSamples: 16_384,
  maximumStations: 262_144,
  maximumDepositions: 8_388_608,
  maximumWorkUnits: 134_217_728,
  maximumResidentBytes: 768 * 1024 * 1024,
  maximumActiveStrokes: 128,
  maximumRetainedSamples: 262_144,
  maximumIdentifierCodeUnits: 192,
  maximumPathLength: 16_777_216,
  maximumJsonCodeUnits: 1_048_576,
} as const);

export type StudioFiberBristleBundleShape = "elliptical" | "fan" | "flat";

export interface StudioFiberBristleSampleInput {
  readonly x: number;
  readonly y: number;
  readonly timeMilliseconds: number;
  readonly pressure: number;
  /** Radians from perpendicular contact, in [0, PI / 2]. */
  readonly tiltRadians: number;
  /** Brush barrel direction in radians. */
  readonly azimuthRadians: number;
  /** Optional scene-linear surface color sampled by the caller. */
  readonly pickupColor?: readonly [red: number, green: number, blue: number];
}

interface StudioFiberBristlePaperRecipe {
  readonly scale: number;
  readonly dropout: number;
}

interface StudioFiberBristleReloadRecipe {
  readonly mode: "none" | "periodic";
  readonly intervalDistance: number;
  readonly amount: number;
}

interface StudioFiberBristlePickupRecipe {
  readonly enabled: boolean;
  readonly rate: number;
}

interface StudioFiberBristleDirtyRecipe {
  readonly color: readonly [red: number, green: number, blue: number];
  readonly mix: number;
}

export interface StudioFiberBristleBrushRecipeInput {
  readonly seed: number;
  readonly bundleShape: StudioFiberBristleBundleShape;
  readonly fiberCount: number;
  readonly diameter: number;
  readonly fiberLength: number;
  readonly stiffness: number;
  readonly stationSpacing: number;
  readonly baseWidth: number;
  readonly baseOpacity: number;
  readonly baseColor: readonly [red: number, green: number, blue: number];
  readonly pressureWidth: number;
  readonly pressureSplay: number;
  readonly tiltSplay: number;
  readonly lagMilliseconds: number;
  readonly bendGain: number;
  readonly maximumBend: number;
  readonly initialLoad: number;
  readonly loadVariation: number;
  readonly depletionPerUnit: number;
  readonly velocityOpacity: number;
  readonly paper: StudioFiberBristlePaperRecipe;
  readonly reload: StudioFiberBristleReloadRecipe;
  readonly pickup: StudioFiberBristlePickupRecipe;
  readonly dirty: StudioFiberBristleDirtyRecipe;
}

export interface StudioFiberBristleBrushRecipe
  extends StudioFiberBristleBrushRecipeInput {
  readonly kind: "studio-fiber-bristle-brush-recipe";
  readonly version: typeof STUDIO_FIBER_BRISTLE_RECIPE_VERSION;
  readonly fingerprint: `sha256:${string}`;
}

export type StudioFiberBristleRecipeCreationResult =
  | Readonly<{ status: "ready"; recipe: StudioFiberBristleBrushRecipe }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-recipe";
      path: string;
    }>;

export interface StudioFiberBristleOracleBudgets {
  readonly maximumFibers?: number;
  readonly maximumInputSamples?: number;
  readonly maximumStations?: number;
  readonly maximumDepositions?: number;
  readonly maximumWorkUnits?: number;
  readonly maximumResidentBytes?: number;
}

export interface StudioFiberBristleCpuOracleReceipt {
  readonly kind: "studio-fiber-bristle-cpu-oracle-receipt";
  readonly version: typeof STUDIO_FIBER_BRISTLE_ORACLE_VERSION;
  readonly backend: "cpu-f32-individual-fiber";
  readonly integration: "bounded-lag-arc-length-v1";
  readonly recipeFingerprint: `sha256:${string}`;
  readonly replayHash: `sha256:${string}`;
  readonly topologyHash: `sha256:${string}`;
  readonly depositionHash: `sha256:${string}`;
  readonly artifactHash: `sha256:${string}`;
  readonly inputSampleCount: number;
  readonly canonicalSampleCount: number;
  readonly stationCount: number;
  readonly fiberCount: number;
  readonly depositionCount: number;
  readonly contactDepositionCount: number;
  readonly droppedDepositionCount: number;
  readonly pathLength: number;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly endpoint: readonly [x: number, y: number];
  readonly complete: true;
}

export interface StudioFiberBristleBrushArtifact {
  readonly kind: "studio-fiber-bristle-brush-artifact";
  readonly version: typeof STUDIO_FIBER_BRISTLE_ORACLE_VERSION;
  /**
   * Per fiber: root lateral, root longitudinal, stiffness, length scale,
   * initial load, fan angle, tooth phase x, tooth phase y.
   */
  readonly fiberTopology: Float32Array;
  /**
   * Per deposition: start x/y, end x/y, width, opacity, red/green/blue,
   * remaining load, contact, fiber index, station index, arc distance, speed.
   */
  readonly depositions: Float32Array;
  readonly finalLoads: Float32Array;
  readonly finalColors: Float32Array;
  readonly receipt: StudioFiberBristleCpuOracleReceipt;
}

export interface StudioFiberBristleCpuOracleOptions
  extends StudioFiberBristleOracleBudgets {
  readonly signal?: AbortSignal;
}

export interface StudioFiberBristleProviderOptions
  extends StudioFiberBristleOracleBudgets {
  readonly initialEngineEpoch?: number;
  readonly maximumActiveStrokes?: number;
  readonly maximumRetainedSamples?: number;
}

export interface StudioFiberBristleRenderRequest {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly operation: "replace" | "append";
  readonly recipe: StudioFiberBristleBrushRecipe;
  readonly samples: readonly StudioFiberBristleSampleInput[];
  readonly signal?: AbortSignal;
}

export interface StudioFiberBristleRenderReceipt {
  readonly kind: "studio-fiber-bristle-render-receipt";
  readonly providerRevision: typeof STUDIO_FIBER_BRISTLE_PROVIDER_REVISION;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly operation: "replace" | "append";
  readonly requestFlowHash: `sha256:${string}`;
  readonly artifact: StudioFiberBristleBrushArtifact;
  readonly receiptHash: `sha256:${string}`;
  readonly complete: true;
}

export type StudioFiberBristleProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioFiberBristleBrushProvider;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options";
      path: string;
    }>;

export type StudioFiberBristleErrorCode =
  | "invalid-recipe"
  | "invalid-samples"
  | "invalid-request"
  | "budget-exceeded"
  | "missing-stroke"
  | "recipe-mismatch"
  | "request-sequence"
  | "engine-epoch"
  | "aborted"
  | "disposed";

export class StudioFiberBristleBrushError extends Error {
  public constructor(
    readonly code: StudioFiberBristleErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "StudioFiberBristleBrushError";
  }
}

interface NormalizedBudgets {
  readonly maximumFibers: number;
  readonly maximumInputSamples: number;
  readonly maximumStations: number;
  readonly maximumDepositions: number;
  readonly maximumWorkUnits: number;
  readonly maximumResidentBytes: number;
}

interface NormalizedProviderOptions extends NormalizedBudgets {
  readonly initialEngineEpoch: number;
  readonly maximumActiveStrokes: number;
  readonly maximumRetainedSamples: number;
}

interface CanonicalSample {
  readonly x: number;
  readonly y: number;
  readonly timeMilliseconds: number;
  readonly pressure: number;
  readonly tiltRadians: number;
  readonly azimuthRadians: number;
  readonly pickupColor: readonly [number, number, number] | null;
}

interface ResampledStation extends CanonicalSample {
  readonly arcDistance: number;
  readonly tangentX: number;
  readonly tangentY: number;
  readonly speed: number;
}

interface FiberDefinition {
  readonly rootLateral: number;
  readonly rootLongitudinal: number;
  readonly stiffness: number;
  readonly lengthScale: number;
  readonly initialLoad: number;
  readonly fanAngle: number;
  readonly toothPhaseX: number;
  readonly toothPhaseY: number;
}

interface RetainedStroke {
  readonly recipe: StudioFiberBristleBrushRecipe;
  readonly samples: readonly CanonicalSample[];
  readonly replayHash: `sha256:${string}`;
}

const RECIPE_INPUT_KEYS = Object.freeze([
  "seed",
  "bundleShape",
  "fiberCount",
  "diameter",
  "fiberLength",
  "stiffness",
  "stationSpacing",
  "baseWidth",
  "baseOpacity",
  "baseColor",
  "pressureWidth",
  "pressureSplay",
  "tiltSplay",
  "lagMilliseconds",
  "bendGain",
  "maximumBend",
  "initialLoad",
  "loadVariation",
  "depletionPerUnit",
  "velocityOpacity",
  "paper",
  "reload",
  "pickup",
  "dirty",
]);
const RECIPE_KEYS = Object.freeze([
  "kind",
  "version",
  ...RECIPE_INPUT_KEYS,
  "fingerprint",
]);
const SAMPLE_KEYS = Object.freeze([
  "x",
  "y",
  "timeMilliseconds",
  "pressure",
  "tiltRadians",
  "azimuthRadians",
]);
const REQUEST_KEYS = Object.freeze([
  "requestSequence",
  "engineEpoch",
  "strokeId",
  "operation",
  "recipe",
  "samples",
]);
const PROVIDER_OPTION_KEYS = Object.freeze([
  "initialEngineEpoch",
  "maximumFibers",
  "maximumInputSamples",
  "maximumStations",
  "maximumDepositions",
  "maximumWorkUnits",
  "maximumResidentBytes",
  "maximumActiveStrokes",
  "maximumRetainedSamples",
]);

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function validColor(
  value: unknown,
): value is readonly [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => inRange(component, 0, 64));
}

function cloneColor(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  return Object.freeze([value[0], value[1], value[2]]);
}

function hashJson(value: unknown): `sha256:${string}` {
  const json = JSON.stringify(value);
  if (json.length > STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumJsonCodeUnits) {
    throw new StudioFiberBristleBrushError(
      "budget-exceeded",
      "Canonical replay JSON exceeds the integrity budget.",
    );
  }
  return `sha256:${sha256HexPortable(new TextEncoder().encode(json))}`;
}

function hashFloat32(value: Float32Array): `sha256:${string}` {
  const bytes = new Uint8Array(value.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      value[index] ?? 0,
      true,
    );
  }
  return `sha256:${sha256HexPortable(bytes)}`;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function f32(value: number): number {
  return Math.fround(Number.isFinite(value) ? value : 0);
}

function wrapAngle(value: number): number {
  let result = value % (Math.PI * 2);
  if (result > Math.PI) result -= Math.PI * 2;
  if (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function interpolateAngle(start: number, end: number, ratio: number): number {
  return wrapAngle(start + wrapAngle(end - start) * ratio);
}

function mixColor(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  ratio: number,
): readonly [number, number, number] {
  return [
    start[0] + (end[0] - start[0]) * ratio,
    start[1] + (end[1] - start[1]) * ratio,
    start[2] + (end[2] - start[2]) * ratio,
  ];
}

function canonicalRecipeValue(
  input: StudioFiberBristleBrushRecipeInput,
): Omit<StudioFiberBristleBrushRecipe, "fingerprint"> {
  return {
    kind: "studio-fiber-bristle-brush-recipe",
    version: STUDIO_FIBER_BRISTLE_RECIPE_VERSION,
    seed: input.seed >>> 0,
    bundleShape: input.bundleShape,
    fiberCount: input.fiberCount,
    diameter: input.diameter,
    fiberLength: input.fiberLength,
    stiffness: input.stiffness,
    stationSpacing: input.stationSpacing,
    baseWidth: input.baseWidth,
    baseOpacity: input.baseOpacity,
    baseColor: cloneColor(input.baseColor),
    pressureWidth: input.pressureWidth,
    pressureSplay: input.pressureSplay,
    tiltSplay: input.tiltSplay,
    lagMilliseconds: input.lagMilliseconds,
    bendGain: input.bendGain,
    maximumBend: input.maximumBend,
    initialLoad: input.initialLoad,
    loadVariation: input.loadVariation,
    depletionPerUnit: input.depletionPerUnit,
    velocityOpacity: input.velocityOpacity,
    paper: Object.freeze({
      scale: input.paper.scale,
      dropout: input.paper.dropout,
    }),
    reload: Object.freeze({
      mode: input.reload.mode,
      intervalDistance: input.reload.intervalDistance,
      amount: input.reload.amount,
    }),
    pickup: Object.freeze({
      enabled: input.pickup.enabled,
      rate: input.pickup.rate,
    }),
    dirty: Object.freeze({
      color: cloneColor(input.dirty.color),
      mix: input.dirty.mix,
    }),
  };
}

function validateRecipeInput(
  value: unknown,
): value is StudioFiberBristleBrushRecipeInput {
  if (!exactKeys(value, RECIPE_INPUT_KEYS)) return false;
  if (
    !safeInteger(value.seed, 0, 0xffff_ffff)
    || !(
      value.bundleShape === "elliptical"
      || value.bundleShape === "fan"
      || value.bundleShape === "flat"
    )
    || !safeInteger(
      value.fiberCount,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumFibers,
    )
    || !inRange(value.diameter, 0.125, 4_096)
    || !inRange(value.fiberLength, 0, 4_096)
    || !inRange(value.stiffness, 0.01, 1)
    || !inRange(value.stationSpacing, 0.03125, 256)
    || !inRange(value.baseWidth, 0.03125, 1_024)
    || !inRange(value.baseOpacity, 0, 1)
    || !validColor(value.baseColor)
    || !inRange(value.pressureWidth, 0, 4)
    || !inRange(value.pressureSplay, 0, 4)
    || !inRange(value.tiltSplay, 0, 4)
    || !inRange(value.lagMilliseconds, 0, 2_000)
    || !inRange(value.bendGain, 0, 8)
    || !inRange(value.maximumBend, 0, 8_192)
    || !inRange(value.initialLoad, 0, 1)
    || !inRange(value.loadVariation, 0, 1)
    || !inRange(value.depletionPerUnit, 0, 64)
    || !inRange(value.velocityOpacity, 0, 64)
  ) return false;
  if (
    !exactKeys(value.paper, ["scale", "dropout"])
    || !inRange(value.paper.scale, 0.03125, 8_192)
    || !inRange(value.paper.dropout, 0, 1)
  ) return false;
  if (
    !exactKeys(value.reload, ["mode", "intervalDistance", "amount"])
    || !(value.reload.mode === "none" || value.reload.mode === "periodic")
    || !inRange(value.reload.intervalDistance, 0.03125, 16_777_216)
    || !inRange(value.reload.amount, 0, 1)
  ) return false;
  if (
    !exactKeys(value.pickup, ["enabled", "rate"])
    || typeof value.pickup.enabled !== "boolean"
    || !inRange(value.pickup.rate, 0, 1)
  ) return false;
  return exactKeys(value.dirty, ["color", "mix"])
    && validColor(value.dirty.color)
    && inRange(value.dirty.mix, 0, 1);
}

export function createStudioFiberBristleBrushRecipe(
  input: StudioFiberBristleBrushRecipeInput,
): StudioFiberBristleRecipeCreationResult {
  if (!validateRecipeInput(input)) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$",
    });
  }
  const canonical = canonicalRecipeValue(input);
  const recipe = Object.freeze({
    ...canonical,
    fingerprint: hashJson(canonical),
  });
  return Object.freeze({ status: "ready", recipe });
}

export function parseStudioFiberBristleBrushRecipe(
  value: unknown,
): StudioFiberBristleBrushRecipe | null {
  if (
    !exactKeys(value, RECIPE_KEYS)
    || value.kind !== "studio-fiber-bristle-brush-recipe"
    || value.version !== STUDIO_FIBER_BRISTLE_RECIPE_VERSION
    || typeof value.fingerprint !== "string"
  ) return null;
  const input: Record<string, unknown> = {};
  for (const key of RECIPE_INPUT_KEYS) input[key] = value[key];
  if (!validateRecipeInput(input)) return null;
  const result = createStudioFiberBristleBrushRecipe(
    input as unknown as StudioFiberBristleBrushRecipeInput,
  );
  return result.status === "ready"
    && result.recipe.fingerprint === value.fingerprint
    ? result.recipe
    : null;
}

function normalizeBudgets(
  options: StudioFiberBristleOracleBudgets,
): NormalizedBudgets | null {
  const budgets = {
    maximumFibers:
      options.maximumFibers
      ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumFibers,
    maximumInputSamples:
      options.maximumInputSamples
      ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumInputSamples,
    maximumStations:
      options.maximumStations
      ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumStations,
    maximumDepositions:
      options.maximumDepositions
      ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumDepositions,
    maximumWorkUnits:
      options.maximumWorkUnits
      ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumWorkUnits,
    maximumResidentBytes:
      options.maximumResidentBytes
      ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumResidentBytes,
  };
  if (
    !safeInteger(
      budgets.maximumFibers,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumFibers,
    )
    || !safeInteger(
      budgets.maximumInputSamples,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumInputSamples,
    )
    || !safeInteger(
      budgets.maximumStations,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumStations,
    )
    || !safeInteger(
      budgets.maximumDepositions,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumDepositions,
    )
    || !safeInteger(
      budgets.maximumWorkUnits,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumWorkUnits,
    )
    || !safeInteger(
      budgets.maximumResidentBytes,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumResidentBytes,
    )
  ) return null;
  return Object.freeze(budgets);
}

function cloneSample(
  value: StudioFiberBristleSampleInput,
  index: number,
): CanonicalSample {
  if (
    !exactKeys(value, SAMPLE_KEYS, ["pickupColor"])
    || !finite(value.x)
    || !finite(value.y)
    || !inRange(value.timeMilliseconds, 0, Number.MAX_SAFE_INTEGER)
    || !inRange(value.pressure, 0, 1)
    || !inRange(value.tiltRadians, 0, Math.PI / 2)
    || !inRange(value.azimuthRadians, -Math.PI * 2, Math.PI * 2)
    || (
      value.pickupColor !== undefined
      && value.pickupColor !== null
      && !validColor(value.pickupColor)
    )
  ) {
    throw new StudioFiberBristleBrushError(
      "invalid-samples",
      "Stroke sample is malformed.",
      `$.samples[${index}]`,
    );
  }
  return Object.freeze({
    x: value.x,
    y: value.y,
    timeMilliseconds: value.timeMilliseconds,
    pressure: value.pressure,
    tiltRadians: value.tiltRadians,
    azimuthRadians: wrapAngle(value.azimuthRadians),
    pickupColor: value.pickupColor === undefined || value.pickupColor === null
      ? null
      : cloneColor(value.pickupColor),
  });
}

function cloneAndCanonicalizeSamples(
  samples: readonly StudioFiberBristleSampleInput[] | readonly CanonicalSample[],
  maximumInputSamples: number,
): readonly CanonicalSample[] {
  if (
    !Array.isArray(samples)
    || samples.length < 1
    || samples.length > maximumInputSamples
  ) {
    throw new StudioFiberBristleBrushError(
      samples.length > maximumInputSamples
        ? "budget-exceeded"
        : "invalid-samples",
      "Stroke sample count is outside the allowed range.",
      "$.samples",
    );
  }
  const result: CanonicalSample[] = [];
  let previousTime = -1;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = cloneSample(
      samples[index] as StudioFiberBristleSampleInput,
      index,
    );
    if (sample.timeMilliseconds < previousTime) {
      throw new StudioFiberBristleBrushError(
        "invalid-samples",
        "Stroke sample times must be monotonically non-decreasing.",
        `$.samples[${index}].timeMilliseconds`,
      );
    }
    previousTime = sample.timeMilliseconds;
    const previous = result.at(-1);
    if (
      previous
      && sample.x === previous.x
      && sample.y === previous.y
      && sample.timeMilliseconds === previous.timeMilliseconds
      && sample.pressure === previous.pressure
      && sample.tiltRadians === previous.tiltRadians
      && sample.azimuthRadians === previous.azimuthRadians
      && (
        (
          sample.pickupColor === null
          && previous.pickupColor === null
        )
        || (
          sample.pickupColor !== null
          && previous.pickupColor !== null
          && sample.pickupColor.every(
            (component, componentIndex) =>
              component === previous.pickupColor?.[componentIndex],
          )
        )
      )
    ) continue;
    if (previous && sample.x === previous.x && sample.y === previous.y) {
      result[result.length - 1] = sample;
    } else {
      result.push(sample);
    }
  }
  if (result.length === 0) {
    throw new StudioFiberBristleBrushError(
      "invalid-samples",
      "Stroke replay contains no canonical sample.",
      "$.samples",
    );
  }
  return Object.freeze(result);
}

function interpolatePickup(
  start: CanonicalSample,
  end: CanonicalSample,
  ratio: number,
): readonly [number, number, number] | null {
  if (start.pickupColor && end.pickupColor) {
    return mixColor(start.pickupColor, end.pickupColor, ratio);
  }
  if (ratio < 0.5) return start.pickupColor;
  return end.pickupColor;
}

function resampleStroke(
  samples: readonly CanonicalSample[],
  spacing: number,
  maximumStations: number,
): Readonly<{
  stations: readonly ResampledStation[];
  pathLength: number;
}> {
  const cumulative = new Float64Array(samples.length);
  let pathLength = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    pathLength += Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    if (
      !Number.isFinite(pathLength)
      || pathLength > STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumPathLength
    ) {
      throw new StudioFiberBristleBrushError(
        "budget-exceeded",
        "Stroke path length exceeds the oracle budget.",
        "$.samples",
      );
    }
    cumulative[index] = pathLength;
  }
  const targetDistances: number[] = [0];
  if (pathLength > 0) {
    for (
      let distance = spacing;
      distance < pathLength;
      distance += spacing
    ) {
      targetDistances.push(distance);
      if (targetDistances.length >= maximumStations) {
        throw new StudioFiberBristleBrushError(
          "budget-exceeded",
          "Resampled station count exceeds the oracle budget.",
        );
      }
    }
    targetDistances.push(pathLength);
  }
  if (targetDistances.length > maximumStations) {
    throw new StudioFiberBristleBrushError(
      "budget-exceeded",
      "Resampled station count exceeds the oracle budget.",
    );
  }

  const stations: ResampledStation[] = [];
  let segment = 0;
  for (
    let targetIndex = 0;
    targetIndex < targetDistances.length;
    targetIndex += 1
  ) {
    const distance = targetDistances[targetIndex];
    while (
      segment + 1 < samples.length - 1
      && (cumulative[segment + 1] ?? 0) < distance
    ) segment += 1;
    const start = samples[segment];
    const end = samples[Math.min(segment + 1, samples.length - 1)];
    const segmentStart = cumulative[segment] ?? 0;
    const segmentEnd = cumulative[Math.min(segment + 1, samples.length - 1)]
      ?? segmentStart;
    const ratio = segmentEnd > segmentStart
      ? clamp((distance - segmentStart) / (segmentEnd - segmentStart))
      : 0;
    stations.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      timeMilliseconds:
        start.timeMilliseconds
        + (end.timeMilliseconds - start.timeMilliseconds) * ratio,
      pressure: start.pressure + (end.pressure - start.pressure) * ratio,
      tiltRadians:
        start.tiltRadians
        + (end.tiltRadians - start.tiltRadians) * ratio,
      azimuthRadians: interpolateAngle(
        start.azimuthRadians,
        end.azimuthRadians,
        ratio,
      ),
      pickupColor: interpolatePickup(start, end, ratio),
      arcDistance: distance,
      tangentX: 0,
      tangentY: 0,
      speed: 0,
    });
  }

  for (let index = 0; index < stations.length; index += 1) {
    const current = stations[index];
    const previous = stations[Math.max(0, index - 1)];
    const next = stations[Math.min(stations.length - 1, index + 1)];
    let tangentX = next.x - previous.x;
    let tangentY = next.y - previous.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength > 0) {
      tangentX /= tangentLength;
      tangentY /= tangentLength;
    } else {
      tangentX = Math.cos(current.azimuthRadians);
      tangentY = Math.sin(current.azimuthRadians);
    }
    const localDistance = index === 0
      ? 0
      : current.arcDistance - previous.arcDistance;
    const elapsed = index === 0
      ? 0
      : current.timeMilliseconds - previous.timeMilliseconds;
    const speed = localDistance / Math.max(0.25, elapsed);
    stations[index] = Object.freeze({
      ...current,
      tangentX,
      tangentY,
      speed,
    });
  }
  return Object.freeze({
    stations: Object.freeze(stations),
    pathLength,
  });
}

function mixUint32(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb_352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846c_a68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function seededUnit(seed: number, index: number, channel: number): number {
  const value = mixUint32(
    (seed ^ Math.imul(index + 1, 0x9e37_79b1)
      ^ Math.imul(channel + 17, 0x85eb_ca6b)) >>> 0,
  );
  return value / 0x1_0000_0000;
}

function generateFiberBundle(
  recipe: StudioFiberBristleBrushRecipe,
): readonly FiberDefinition[] {
  const fibers: FiberDefinition[] = [];
  const halfDiameter = recipe.diameter * 0.5;
  for (let index = 0; index < recipe.fiberCount; index += 1) {
    const normalized = recipe.fiberCount === 1
      ? 0
      : index / (recipe.fiberCount - 1) * 2 - 1;
    const jitter = seededUnit(recipe.seed, index, 0) - 0.5;
    let rootLateral = normalized * halfDiameter;
    let rootLongitudinal: number;
    let fanAngle = 0;
    if (recipe.bundleShape === "elliptical") {
      const radius = Math.sqrt((index + 0.5) / recipe.fiberCount);
      const angle =
        index * Math.PI * (3 - Math.sqrt(5))
        + seededUnit(recipe.seed, index, 1) * 0.35;
      rootLateral = Math.cos(angle) * radius * halfDiameter;
      rootLongitudinal =
        Math.sin(angle) * radius * halfDiameter * 0.45;
    } else if (recipe.bundleShape === "fan") {
      rootLateral += jitter * recipe.diameter / recipe.fiberCount;
      rootLongitudinal = (
        seededUnit(recipe.seed, index, 1) - 0.5
      ) * recipe.diameter * 0.12;
      fanAngle = normalized * 0.55
        + (seededUnit(recipe.seed, index, 2) - 0.5) * 0.08;
    } else {
      rootLateral += jitter * recipe.diameter / recipe.fiberCount;
      rootLongitudinal = (
        seededUnit(recipe.seed, index, 1) - 0.5
      ) * recipe.diameter * 0.08;
    }
    fibers.push(Object.freeze({
      rootLateral,
      rootLongitudinal,
      stiffness: clamp(
        recipe.stiffness
        * (0.8 + seededUnit(recipe.seed, index, 3) * 0.4),
        0.01,
        1,
      ),
      lengthScale: 0.75 + seededUnit(recipe.seed, index, 4) * 0.5,
      initialLoad: clamp(
        recipe.initialLoad
        * (
          1
          + (seededUnit(recipe.seed, index, 5) * 2 - 1)
            * recipe.loadVariation
        ),
      ),
      fanAngle,
      toothPhaseX: seededUnit(recipe.seed, index, 6) * 65_536,
      toothPhaseY: seededUnit(recipe.seed, index, 7) * 65_536,
    }));
  }
  return Object.freeze(fibers);
}

function topologyArray(
  fibers: readonly FiberDefinition[],
): Float32Array {
  const output = new Float32Array(
    fibers.length * STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE,
  );
  for (let index = 0; index < fibers.length; index += 1) {
    const fiber = fibers[index];
    const offset = index * STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE;
    output[offset] = f32(fiber.rootLateral);
    output[offset + 1] = f32(fiber.rootLongitudinal);
    output[offset + 2] = f32(fiber.stiffness);
    output[offset + 3] = f32(fiber.lengthScale);
    output[offset + 4] = f32(fiber.initialLoad);
    output[offset + 5] = f32(fiber.fanAngle);
    output[offset + 6] = f32(fiber.toothPhaseX);
    output[offset + 7] = f32(fiber.toothPhaseY);
  }
  return output;
}

function spatialToothContact(
  x: number,
  y: number,
  phaseX: number,
  phaseY: number,
  scale: number,
  dropout: number,
  seed: number,
  fiberIndex: number,
): number {
  if (dropout <= 0) return 1;
  if (dropout >= 1) return 0;
  const gridX = Math.floor(x / scale + phaseX);
  const gridY = Math.floor(y / scale + phaseY);
  const noise = mixUint32(
    seed
    ^ Math.imul(gridX, 0x1f12_3bb5)
    ^ Math.imul(gridY, 0x5f35_6495)
    ^ Math.imul(fiberIndex + 1, 0x9e37_79b1),
  ) / 0x1_0000_0000;
  return noise < dropout ? 0 : 1;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new StudioFiberBristleBrushError(
      "aborted",
      "Fiber bristle rendering was aborted.",
    );
  }
}

function hashCanonicalReplay(
  recipe: StudioFiberBristleBrushRecipe,
  stations: readonly ResampledStation[],
): `sha256:${string}` {
  const stride = 13;
  const bytes = new Uint8Array(
    stations.length * stride * Float64Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(bytes.buffer);
  for (let stationIndex = 0; stationIndex < stations.length; stationIndex += 1) {
    const station = stations[stationIndex];
    const pickup = station.pickupColor ?? [-1, -1, -1];
    const values = [
      station.x,
      station.y,
      station.timeMilliseconds,
      station.pressure,
      station.tiltRadians,
      station.azimuthRadians,
      pickup[0],
      pickup[1],
      pickup[2],
      station.arcDistance,
      station.tangentX,
      station.tangentY,
      station.speed,
    ];
    for (let component = 0; component < stride; component += 1) {
      view.setFloat64(
        (stationIndex * stride + component)
          * Float64Array.BYTES_PER_ELEMENT,
        values[component] ?? 0,
        true,
      );
    }
  }
  const stationHash = `sha256:${sha256HexPortable(bytes)}` as const;
  return hashJson({
    recipeFingerprint: recipe.fingerprint,
    stationCount: stations.length,
    stationHash,
  });
}

function preflight(
  recipe: StudioFiberBristleBrushRecipe,
  inputSampleCount: number,
  canonicalSamples: readonly CanonicalSample[],
  budgets: NormalizedBudgets,
): Readonly<{
  stations: readonly ResampledStation[];
  pathLength: number;
  depositionCount: number;
  workUnits: number;
  residentBytes: number;
}> {
  if (
    recipe.fiberCount > budgets.maximumFibers
    || inputSampleCount > budgets.maximumInputSamples
  ) {
    throw new StudioFiberBristleBrushError(
      "budget-exceeded",
      "Fiber or input sample budget exceeded.",
    );
  }
  const resampled = resampleStroke(
    canonicalSamples,
    recipe.stationSpacing,
    budgets.maximumStations,
  );
  const depositionCount = resampled.stations.length * recipe.fiberCount;
  const workUnits = depositionCount * 12 + canonicalSamples.length * 4;
  const depositionBytes =
    depositionCount
    * STUDIO_FIBER_BRISTLE_DEPOSITION_STRIDE
    * Float32Array.BYTES_PER_ELEMENT;
  const residentBytes =
    depositionBytes * 2
    + recipe.fiberCount
      * (STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE + 7)
      * Float32Array.BYTES_PER_ELEMENT
    + resampled.stations.length * 13 * Float64Array.BYTES_PER_ELEMENT
    + canonicalSamples.length * 9 * Float64Array.BYTES_PER_ELEMENT;
  if (
    depositionCount > budgets.maximumDepositions
    || workUnits > budgets.maximumWorkUnits
    || residentBytes > budgets.maximumResidentBytes
  ) {
    throw new StudioFiberBristleBrushError(
      "budget-exceeded",
      "Fiber deposition work or resident memory budget exceeded.",
    );
  }
  return Object.freeze({
    ...resampled,
    depositionCount,
    workUnits,
    residentBytes,
  });
}

function renderPrepared(
  recipe: StudioFiberBristleBrushRecipe,
  canonicalSamples: readonly CanonicalSample[],
  inputSampleCount: number,
  budgets: NormalizedBudgets,
  signal?: AbortSignal,
): StudioFiberBristleBrushArtifact {
  throwIfAborted(signal);
  const prepared = preflight(
    recipe,
    inputSampleCount,
    canonicalSamples,
    budgets,
  );
  const fibers = generateFiberBundle(recipe);
  const fiberTopology = topologyArray(fibers);
  const depositions = new Float32Array(
    prepared.depositionCount * STUDIO_FIBER_BRISTLE_DEPOSITION_STRIDE,
  );
  const finalLoads = new Float32Array(recipe.fiberCount);
  const finalColors = new Float32Array(recipe.fiberCount * 3);
  const previousX = new Float64Array(recipe.fiberCount);
  const previousY = new Float64Array(recipe.fiberCount);
  const loads = new Float64Array(recipe.fiberCount);
  const colors = new Float64Array(recipe.fiberCount * 3);
  const nextReload = new Float64Array(recipe.fiberCount);
  let contactDepositionCount = 0;
  let droppedDepositionCount = 0;

  for (let fiberIndex = 0; fiberIndex < fibers.length; fiberIndex += 1) {
    const fiber = fibers[fiberIndex];
    loads[fiberIndex] = fiber.initialLoad;
    const initial = mixColor(
      recipe.baseColor,
      recipe.dirty.color,
      recipe.dirty.mix,
    );
    colors[fiberIndex * 3] = initial[0];
    colors[fiberIndex * 3 + 1] = initial[1];
    colors[fiberIndex * 3 + 2] = initial[2];
    nextReload[fiberIndex] = recipe.reload.intervalDistance;
  }

  for (
    let stationIndex = 0;
    stationIndex < prepared.stations.length;
    stationIndex += 1
  ) {
    if ((stationIndex & 255) === 0) throwIfAborted(signal);
    const station = prepared.stations[stationIndex];
    const previousStation =
      prepared.stations[Math.max(0, stationIndex - 1)];
    const elapsedMilliseconds = stationIndex === 0
      ? 0
      : clamp(
        station.timeMilliseconds - previousStation.timeMilliseconds,
        0.25,
        64,
      );
    const tiltAmount = Math.sin(station.tiltRadians);
    const orientationX = tiltAmount > 0.000_001
      ? Math.cos(station.azimuthRadians)
      : station.tangentX;
    const orientationY = tiltAmount > 0.000_001
      ? Math.sin(station.azimuthRadians)
      : station.tangentY;
    const normalX = -orientationY;
    const normalY = orientationX;

    for (
      let fiberIndex = 0;
      fiberIndex < fibers.length;
      fiberIndex += 1
    ) {
      const fiber = fibers[fiberIndex];
      if (
        recipe.reload.mode === "periodic"
        && station.arcDistance >= nextReload[fiberIndex]
      ) {
        const reloadCount =
          Math.floor(
            (station.arcDistance - nextReload[fiberIndex])
              / recipe.reload.intervalDistance,
          ) + 1;
        loads[fiberIndex] = clamp(
          loads[fiberIndex] + reloadCount * recipe.reload.amount,
        );
        nextReload[fiberIndex] +=
          reloadCount * recipe.reload.intervalDistance;
      }

      const splay =
        1
        + station.pressure * recipe.pressureSplay
        + tiltAmount * recipe.tiltSplay;
      const lateral = fiber.rootLateral * splay;
      const longitudinal =
        fiber.rootLongitudinal
        + Math.sin(fiber.fanAngle) * recipe.fiberLength * fiber.lengthScale;
      const rootX =
        station.x + normalX * lateral + orientationX * longitudinal;
      const rootY =
        station.y + normalY * lateral + orientationY * longitudinal;
      const lagDistance = Math.min(
        recipe.maximumBend,
        station.speed
          * recipe.lagMilliseconds
          * recipe.bendGain
          * (1.05 - fiber.stiffness),
      );
      const fanX =
        Math.cos(fiber.fanAngle) * recipe.fiberLength * fiber.lengthScale;
      const fanY =
        Math.sin(fiber.fanAngle) * recipe.fiberLength * fiber.lengthScale;
      const desiredX =
        rootX
        + orientationX * fanX
        + normalX * fanY
        - station.tangentX * lagDistance;
      const desiredY =
        rootY
        + orientationY * fanX
        + normalY * fanY
        - station.tangentY * lagDistance;
      const first = stationIndex === 0;
      let startX = first ? desiredX : previousX[fiberIndex];
      let startY = first ? desiredY : previousY[fiberIndex];
      const timeConstant =
        recipe.lagMilliseconds * (1.05 - fiber.stiffness);
      const integration = first || timeConstant <= 0
        ? 1
        : elapsedMilliseconds / (elapsedMilliseconds + timeConstant);
      let deltaX = (desiredX - startX) * integration;
      let deltaY = (desiredY - startY) * integration;
      const maximumStep =
        recipe.stationSpacing * 4
        + recipe.diameter
        + recipe.maximumBend;
      const stepLength = Math.hypot(deltaX, deltaY);
      if (stepLength > maximumStep && stepLength > 0) {
        const ratio = maximumStep / stepLength;
        deltaX *= ratio;
        deltaY *= ratio;
      }
      const endX = startX + deltaX;
      const endY = startY + deltaY;
      if (first) {
        startX = endX;
        startY = endY;
      }
      previousX[fiberIndex] = endX;
      previousY[fiberIndex] = endY;

      const edge = Math.abs(fiber.rootLateral)
        / Math.max(recipe.diameter * 0.5, 0.000_001);
      const rawContact = clamp(
        station.pressure * (1.15 - edge * 0.25)
        + tiltAmount * (0.15 + edge * 0.2),
      );
      const toothContact = spatialToothContact(
        endX,
        endY,
        fiber.toothPhaseX,
        fiber.toothPhaseY,
        recipe.paper.scale,
        recipe.paper.dropout,
        recipe.seed,
        fiberIndex,
      );
      const contact = rawContact * toothContact;
      if (contact > 0) contactDepositionCount += 1;
      if (rawContact > 0 && toothContact === 0) {
        droppedDepositionCount += 1;
      }

      const colorOffset = fiberIndex * 3;
      if (
        recipe.pickup.enabled
        && station.pickupColor
        && contact > 0
      ) {
        const pickupMix = clamp(recipe.pickup.rate * contact);
        colors[colorOffset] +=
          (station.pickupColor[0] - colors[colorOffset]) * pickupMix;
        colors[colorOffset + 1] +=
          (station.pickupColor[1] - colors[colorOffset + 1]) * pickupMix;
        colors[colorOffset + 2] +=
          (station.pickupColor[2] - colors[colorOffset + 2]) * pickupMix;
      }

      const pressureWidth = Math.max(
        0.05,
        1 + (station.pressure - 0.5) * recipe.pressureWidth,
      );
      const width =
        recipe.baseWidth
        * pressureWidth
        * (0.85 + fiber.lengthScale * 0.15);
      const speedOpacity = 1 / (1 + station.speed * recipe.velocityOpacity);
      const availableLoad = clamp(loads[fiberIndex]);
      const opacity =
        recipe.baseOpacity
        * contact
        * speedOpacity
        * availableLoad;
      const segmentLength = Math.hypot(endX - startX, endY - startY);
      loads[fiberIndex] = clamp(
        loads[fiberIndex]
        - recipe.depletionPerUnit
          * segmentLength
          * contact
          * (0.25 + opacity * 0.75),
      );

      const depositionIndex =
        (stationIndex * fibers.length + fiberIndex)
        * STUDIO_FIBER_BRISTLE_DEPOSITION_STRIDE;
      depositions[depositionIndex] = f32(startX);
      depositions[depositionIndex + 1] = f32(startY);
      depositions[depositionIndex + 2] = f32(endX);
      depositions[depositionIndex + 3] = f32(endY);
      depositions[depositionIndex + 4] = f32(width);
      depositions[depositionIndex + 5] = f32(opacity);
      depositions[depositionIndex + 6] = f32(colors[colorOffset]);
      depositions[depositionIndex + 7] = f32(colors[colorOffset + 1]);
      depositions[depositionIndex + 8] = f32(colors[colorOffset + 2]);
      depositions[depositionIndex + 9] = f32(loads[fiberIndex]);
      depositions[depositionIndex + 10] = f32(contact);
      depositions[depositionIndex + 11] = f32(fiberIndex);
      depositions[depositionIndex + 12] = f32(stationIndex);
      depositions[depositionIndex + 13] = f32(station.arcDistance);
      depositions[depositionIndex + 14] = f32(station.speed);
    }
  }

  for (let fiberIndex = 0; fiberIndex < fibers.length; fiberIndex += 1) {
    finalLoads[fiberIndex] = f32(loads[fiberIndex]);
    finalColors[fiberIndex * 3] = f32(colors[fiberIndex * 3]);
    finalColors[fiberIndex * 3 + 1] = f32(colors[fiberIndex * 3 + 1]);
    finalColors[fiberIndex * 3 + 2] = f32(colors[fiberIndex * 3 + 2]);
  }

  const replayHash = hashCanonicalReplay(recipe, prepared.stations);
  const topologyHash = hashFloat32(fiberTopology);
  const depositionHash = hashFloat32(depositions);
  const artifactHash = hashJson({
    replayHash,
    topologyHash,
    depositionHash,
    finalLoadsHash: hashFloat32(finalLoads),
    finalColorsHash: hashFloat32(finalColors),
  });
  const endpoint = canonicalSamples.at(-1);
  if (!endpoint) {
    throw new StudioFiberBristleBrushError(
      "invalid-samples",
      "Canonical replay unexpectedly lost its endpoint.",
    );
  }
  const receipt = Object.freeze({
    kind: "studio-fiber-bristle-cpu-oracle-receipt" as const,
    version: STUDIO_FIBER_BRISTLE_ORACLE_VERSION,
    backend: "cpu-f32-individual-fiber" as const,
    integration: "bounded-lag-arc-length-v1" as const,
    recipeFingerprint: recipe.fingerprint,
    replayHash,
    topologyHash,
    depositionHash,
    artifactHash,
    inputSampleCount,
    canonicalSampleCount: canonicalSamples.length,
    stationCount: prepared.stations.length,
    fiberCount: recipe.fiberCount,
    depositionCount: prepared.depositionCount,
    contactDepositionCount,
    droppedDepositionCount,
    pathLength: prepared.pathLength,
    workUnits: prepared.workUnits,
    residentBytes: prepared.residentBytes,
    endpoint: Object.freeze([endpoint.x, endpoint.y]) as readonly [
      number,
      number,
    ],
    complete: true as const,
  });
  return Object.freeze({
    kind: "studio-fiber-bristle-brush-artifact" as const,
    version: STUDIO_FIBER_BRISTLE_ORACLE_VERSION,
    fiberTopology,
    depositions,
    finalLoads,
    finalColors,
    receipt,
  });
}

export function renderStudioFiberBristleBrushCpuOracle(
  recipeValue: StudioFiberBristleBrushRecipe,
  samples: readonly StudioFiberBristleSampleInput[],
  options: StudioFiberBristleCpuOracleOptions = {},
): StudioFiberBristleBrushArtifact {
  const recipe = parseStudioFiberBristleBrushRecipe(recipeValue);
  if (!recipe) {
    throw new StudioFiberBristleBrushError(
      "invalid-recipe",
      "Fiber bristle recipe failed integrity validation.",
      "$.recipe",
    );
  }
  const budgets = normalizeBudgets(options);
  if (!budgets) {
    throw new StudioFiberBristleBrushError(
      "invalid-request",
      "Fiber bristle oracle budgets are invalid.",
      "$.options",
    );
  }
  throwIfAborted(options.signal);
  const canonicalSamples = cloneAndCanonicalizeSamples(
    samples,
    budgets.maximumInputSamples,
  );
  return renderPrepared(
    recipe,
    canonicalSamples,
    samples.length,
    budgets,
    options.signal,
  );
}

function mergeAppendSamples(
  retained: readonly CanonicalSample[],
  appended: readonly CanonicalSample[],
  maximumInputSamples: number,
): readonly CanonicalSample[] {
  const merged: CanonicalSample[] = [...retained];
  const last = merged.at(-1);
  let start = 0;
  const firstAppend = appended[0];
  if (
    last
    && firstAppend
    && last.x === firstAppend.x
    && last.y === firstAppend.y
    && last.timeMilliseconds === firstAppend.timeMilliseconds
    && last.pressure === firstAppend.pressure
    && last.tiltRadians === firstAppend.tiltRadians
    && last.azimuthRadians === firstAppend.azimuthRadians
  ) start = 1;
  merged.push(...appended.slice(start));
  return cloneAndCanonicalizeSamples(merged, maximumInputSamples);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length
      <= STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumIdentifierCodeUnits;
}

function normalizeProviderOptions(
  options: StudioFiberBristleProviderOptions,
): NormalizedProviderOptions | null {
  if (!exactKeys(options, [], PROVIDER_OPTION_KEYS)) return null;
  const budgets = normalizeBudgets(options);
  if (!budgets) return null;
  const initialEngineEpoch = options.initialEngineEpoch ?? 1;
  const maximumActiveStrokes =
    options.maximumActiveStrokes
    ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumActiveStrokes;
  const maximumRetainedSamples =
    options.maximumRetainedSamples
    ?? STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumRetainedSamples;
  if (
    !safeInteger(initialEngineEpoch, 1, Number.MAX_SAFE_INTEGER - 1)
    || !safeInteger(
      maximumActiveStrokes,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumActiveStrokes,
    )
    || !safeInteger(
      maximumRetainedSamples,
      1,
      STUDIO_FIBER_BRISTLE_HARD_LIMITS.maximumRetainedSamples,
    )
  ) return null;
  return Object.freeze({
    ...budgets,
    initialEngineEpoch,
    maximumActiveStrokes,
    maximumRetainedSamples,
  });
}

export class StudioFiberBristleBrushProvider {
  readonly #options: NormalizedProviderOptions;
  readonly #strokes = new Map<string, RetainedStroke>();
  #engineEpoch: number;
  #lastRequestSequence = 0;
  #retainedSampleCount = 0;
  #disposed = false;
  #operationReserved = false;

  public constructor(options: NormalizedProviderOptions) {
    this.#options = options;
    this.#engineEpoch = options.initialEngineEpoch;
  }

  public async render(
    request: StudioFiberBristleRenderRequest,
  ): Promise<StudioFiberBristleRenderReceipt> {
    if (this.#disposed) {
      throw new StudioFiberBristleBrushError(
        "disposed",
        "Fiber bristle provider is disposed.",
      );
    }
    if (this.#operationReserved) {
      throw new StudioFiberBristleBrushError(
        "request-sequence",
        "Fiber bristle provider already has an admitted operation.",
      );
    }
    this.#operationReserved = true;
    try {
    if (
      !exactKeys(request, REQUEST_KEYS, ["signal"])
      || !safeInteger(
        request.requestSequence,
        1,
        Number.MAX_SAFE_INTEGER,
      )
      || !safeInteger(request.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
      || !validIdentifier(request.strokeId)
      || !(request.operation === "replace" || request.operation === "append")
      || (
        request.signal !== undefined
        && typeof request.signal.aborted !== "boolean"
      )
    ) {
      throw new StudioFiberBristleBrushError(
        "invalid-request",
        "Fiber bristle render request is malformed.",
        "$",
      );
    }
    const requestSequence = request.requestSequence;
    const engineEpoch = request.engineEpoch;
    const strokeId = request.strokeId;
    const operation = request.operation;
    if (engineEpoch !== this.#engineEpoch) {
      throw new StudioFiberBristleBrushError(
        "engine-epoch",
        "Fiber bristle request targets a stale engine epoch.",
        "$.engineEpoch",
      );
    }
    if (requestSequence <= this.#lastRequestSequence) {
      throw new StudioFiberBristleBrushError(
        "request-sequence",
        "Fiber bristle request sequence must increase monotonically.",
        "$.requestSequence",
      );
    }
    throwIfAborted(request.signal);
    const recipe = parseStudioFiberBristleBrushRecipe(request.recipe);
    if (!recipe) {
      throw new StudioFiberBristleBrushError(
        "invalid-recipe",
        "Fiber bristle recipe failed integrity validation.",
        "$.recipe",
      );
    }
    const requestSamples = request.samples;
    const incoming = cloneAndCanonicalizeSamples(
      requestSamples,
      this.#options.maximumInputSamples,
    );
    const retained = this.#strokes.get(strokeId);
    if (operation === "append" && !retained) {
      throw new StudioFiberBristleBrushError(
        "missing-stroke",
        "Append requires a retained stroke.",
        "$.strokeId",
      );
    }
    if (
      operation === "append"
      && retained?.recipe.fingerprint !== recipe.fingerprint
    ) {
      throw new StudioFiberBristleBrushError(
        "recipe-mismatch",
        "Append must use the retained stroke recipe.",
        "$.recipe",
      );
    }
    if (
      operation === "replace"
      && !retained
      && this.#strokes.size >= this.#options.maximumActiveStrokes
    ) {
      throw new StudioFiberBristleBrushError(
        "budget-exceeded",
        "Active stroke budget exceeded.",
      );
    }
    const combined = operation === "append" && retained
      ? mergeAppendSamples(
        retained.samples,
        incoming,
        this.#options.maximumInputSamples,
      )
      : incoming;
    const retainedWithoutCurrent =
      this.#retainedSampleCount - (retained?.samples.length ?? 0);
    if (
      retainedWithoutCurrent + combined.length
      > this.#options.maximumRetainedSamples
    ) {
      throw new StudioFiberBristleBrushError(
        "budget-exceeded",
        "Retained replay sample budget exceeded.",
      );
    }
    const artifact = renderPrepared(
      recipe,
      combined,
      combined.length,
      this.#options,
      request.signal,
    );
    throwIfAborted(request.signal);
    if (this.#disposed) {
      throw new StudioFiberBristleBrushError(
        "disposed",
        "Fiber bristle provider was disposed during rendering.",
      );
    }
    if (engineEpoch !== this.#engineEpoch) {
      throw new StudioFiberBristleBrushError(
        "engine-epoch",
        "Fiber bristle engine epoch changed during rendering.",
        "$.engineEpoch",
      );
    }
    if (requestSequence <= this.#lastRequestSequence) {
      throw new StudioFiberBristleBrushError(
        "request-sequence",
        "Fiber bristle request was superseded during rendering.",
        "$.requestSequence",
      );
    }
    const requestFlowHash = hashStudioFiberBristleRequestFlow({
      requestSequence,
      engineEpoch,
      strokeId,
      operation,
      recipeFingerprint: recipe.fingerprint,
      previousReplayHash:
        operation === "append" ? retained?.replayHash ?? null : null,
      samples: incoming,
    });
    this.#lastRequestSequence = requestSequence;
    this.#retainedSampleCount = retainedWithoutCurrent + combined.length;
    this.#strokes.set(
      strokeId,
      Object.freeze({
        recipe,
        samples: combined,
        replayHash: artifact.receipt.replayHash,
      }),
    );
    const receiptHash = hashJson({
      providerRevision: STUDIO_FIBER_BRISTLE_PROVIDER_REVISION,
      requestSequence,
      engineEpoch,
      strokeId,
      operation,
      requestFlowHash,
      artifactHash: artifact.receipt.artifactHash,
    });
    return Object.freeze({
      kind: "studio-fiber-bristle-render-receipt",
      providerRevision: STUDIO_FIBER_BRISTLE_PROVIDER_REVISION,
      requestSequence,
      engineEpoch,
      strokeId,
      operation,
      requestFlowHash,
      artifact,
      receiptHash,
      complete: true,
    });
    } finally {
      this.#operationReserved = false;
    }
  }

  public releaseStroke(strokeId: string): boolean {
    if (this.#disposed) return false;
    const retained = this.#strokes.get(strokeId);
    if (!retained) return false;
    this.#retainedSampleCount -= retained.samples.length;
    return this.#strokes.delete(strokeId);
  }

  public advanceEngineEpoch(): number {
    if (this.#disposed) {
      throw new StudioFiberBristleBrushError(
        "disposed",
        "Fiber bristle provider is disposed.",
      );
    }
    if (this.#engineEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new StudioFiberBristleBrushError(
        "engine-epoch",
        "Fiber bristle engine epoch is exhausted.",
      );
    }
    this.#engineEpoch += 1;
    this.#lastRequestSequence = 0;
    this.#retainedSampleCount = 0;
    this.#strokes.clear();
    return this.#engineEpoch;
  }

  public snapshot(): Readonly<{
    state: "ready" | "disposed";
    engineEpoch: number;
    lastRequestSequence: number;
    activeStrokeCount: number;
    retainedSampleCount: number;
  }> {
    return Object.freeze({
      state: this.#disposed ? "disposed" : "ready",
      engineEpoch: this.#engineEpoch,
      lastRequestSequence: this.#lastRequestSequence,
      activeStrokeCount: this.#strokes.size,
      retainedSampleCount: this.#retainedSampleCount,
    });
  }

  public dispose(): void {
    this.#disposed = true;
    this.#lastRequestSequence = 0;
    this.#retainedSampleCount = 0;
    this.#strokes.clear();
  }
}

export function createStudioFiberBristleBrushProvider(
  options: StudioFiberBristleProviderOptions = {},
): StudioFiberBristleProviderCreationResult {
  const normalized = normalizeProviderOptions(options);
  if (!normalized) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
  }
  return Object.freeze({
    status: "ready",
    provider: new StudioFiberBristleBrushProvider(normalized),
  });
}
