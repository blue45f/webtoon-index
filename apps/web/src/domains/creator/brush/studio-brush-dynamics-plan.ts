import {
  clamp,
  clamp01,
  cloneDualBrush,
  cloneTip,
  cloneTipLayers,
  cloneTaper,
  finiteNumber,
  INTERNAL_DEFAULT_SETTINGS,
  normalizeSignedDegrees,
  normalizeStudioBrushDynamicsSample,
  normalizeStudioBrushDynamicsSettings,
  normalizeUnsignedDegrees,
  resolveNormalizedStudioBrushDynamics,
  studioBrushTaperFactors,
  uint32,
} from "./studio-brush-dynamics-normalize";
import {
  applyStudioDynamicBrushMinimumDiameterRatio,
  DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS,
  MAX_POINTER_SPEED,
  STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS,
  STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE,
  studioDynamicBrushContactFactor,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioBrushDynamicsRecipe,
  type StudioBrushDynamicsSample,
  type StudioDynamicBrushDab,
  type StudioDynamicBrushPlan,
  type StudioDynamicBrushPlanInput,
  type StudioDynamicBrushSegmentStartFrame,
} from "./studio-brush-dynamics-types";

const MAX_COORDINATE_ABS = 1_000_000;
const POINT_EPSILON = 1e-6;

interface SanitizedStrokePoint {
  x: number;
  y: number;
  sourceProgress: number;
}

interface StrokeStation extends SanitizedStrokePoint {
  direction: number;
  progress: number;
}

function safeCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, -MAX_COORDINATE_ABS, MAX_COORDINATE_ABS)
    : null;
}

function sanitizeStrokePoints(value: unknown): SanitizedStrokePoint[] {
  if (!Array.isArray(value)) return [];
  const sourcePairCount = Math.floor(value.length / 2);
  const points: SanitizedStrokePoint[] = [];
  const epsilonSq = POINT_EPSILON * POINT_EPSILON;
  for (let pairIndex = 0; pairIndex < sourcePairCount; pairIndex++) {
    const x = safeCoordinate(value[pairIndex * 2]);
    const y = safeCoordinate(value[pairIndex * 2 + 1]);
    if (x === null || y === null) continue;
    const sourceProgress = sourcePairCount <= 1 ? 0 : pairIndex / (sourcePairCount - 1);
    const previous = points.at(-1);
    if (previous) {
      const dx = x - previous.x;
      const dy = y - previous.y;
      if (dx * dx + dy * dy <= epsilonSq) {
        // Keep the most recent exact endpoint and associated stylus progress for zero-length runs.
        previous.x = x;
        previous.y = y;
        previous.sourceProgress = sourceProgress;
        continue;
      }
    }
    points.push({ x, y, sourceProgress });
  }
  return points;
}

function cumulativeLengths(points: readonly SanitizedStrokePoint[]): Float64Array {
  const cumulative = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    cumulative[index] = cumulative[index - 1]! + Math.sqrt(dx * dx + dy * dy);
  }
  return cumulative;
}

/**
 * Creates a forward-only arc-length sampler.
 *
 * Planned dab distances are strictly increasing. Binary-searching the whole source path for every
 * dab made an active airbrush frame O(D log N) after already paying O(N) for cumulative lengths,
 * and that cost grew perceptibly during long strokes. One segment cursor produces byte-identical
 * interpolation in O(N + D). A defensive reset preserves deterministic behavior if a future caller
 * ever supplies a regressing distance.
 */
function createStationAtDistanceSampler(
  points: readonly SanitizedStrokePoint[],
  cumulative: Float64Array,
  totalLength: number
): (rawDistance: number) => StrokeStation {
  let upperIndex = 1;
  let previousDistance = 0;
  return (rawDistance: number): StrokeStation => {
    if (points.length === 1 || totalLength <= POINT_EPSILON) {
      return { ...points[0]!, direction: 0, progress: 0 };
    }

    const distance = clamp(rawDistance, 0, totalLength);
    if (distance < previousDistance) upperIndex = 1;
    previousDistance = distance;
    if (distance <= POINT_EPSILON) {
      upperIndex = 1;
    } else if (totalLength - distance <= POINT_EPSILON) {
      upperIndex = points.length - 1;
    } else {
      while (
        upperIndex < points.length - 1
        && cumulative[upperIndex]! < distance
      ) {
        upperIndex += 1;
      }
    }

    const lowerIndex = upperIndex - 1;
    const start = points[lowerIndex]!;
    const end = points[upperIndex]!;
    const segmentStart = cumulative[lowerIndex]!;
    const segmentLength = cumulative[upperIndex]! - segmentStart;
    const amount = segmentLength > POINT_EPSILON
      ? clamp01((distance - segmentStart) / segmentLength)
      : 0;
    return {
      x: distance <= POINT_EPSILON
        ? points[0]!.x
        : totalLength - distance <= POINT_EPSILON
          ? points.at(-1)!.x
          : start.x + (end.x - start.x) * amount,
      y: distance <= POINT_EPSILON
        ? points[0]!.y
        : totalLength - distance <= POINT_EPSILON
          ? points.at(-1)!.y
          : start.y + (end.y - start.y) * amount,
      sourceProgress: start.sourceProgress + (end.sourceProgress - start.sourceProgress) * amount,
      direction: normalizeSignedDegrees(
        Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
      ),
      progress: distance / totalLength,
    };
  };
}

function sampleNumberAtProgress(
  values: unknown,
  progress: number,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  if (values.length === 1) return clamp(finiteNumber(values[0], fallback), min, max);
  const position = clamp01(progress) * (values.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(values.length - 1, Math.ceil(position));
  const amount = position - lowerIndex;
  const lower = clamp(finiteNumber(values[lowerIndex], fallback), min, max);
  const upper = clamp(finiteNumber(values[upperIndex], lower), min, max);
  return clamp(lower + (upper - lower) * amount, min, max);
}

function sampleCircularDegreesAtProgress(
  values: unknown,
  progress: number,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Array.isArray(values) || values.length === 0) return normalizeSignedDegrees(fallback);
  if (values.length === 1) return normalizeSignedDegrees(clamp(finiteNumber(values[0], fallback), min, max));
  const position = clamp01(progress) * (values.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(values.length - 1, Math.ceil(position));
  const amount = position - lowerIndex;
  const lower = clamp(finiteNumber(values[lowerIndex], fallback), min, max);
  const upper = clamp(finiteNumber(values[upperIndex], lower), min, max);
  const delta = normalizeSignedDegrees(upper - lower);
  return normalizeSignedDegrees(lower + delta * amount);
}

function sampleTwistAtProgress(values: unknown, progress: number): number {
  return normalizeUnsignedDegrees(sampleCircularDegreesAtProgress(values, progress, 0, 0, 359));
}

function sampleForStation(
  station: StrokeStation,
  stampIndex: number,
  input: Partial<StudioDynamicBrushPlanInput>,
  settings: NormalizedStudioBrushDynamicsSettings
): StudioBrushDynamicsSample {
  const sourceProgress = station.sourceProgress;
  const direction = Array.isArray(input.directions) && input.directions.length > 0
    ? sampleCircularDegreesAtProgress(input.directions, sourceProgress, station.direction, -180, 180)
    : station.direction;
  return {
    pressure: sampleNumberAtProgress(input.pressures, sourceProgress, settings.fallbackPressure, 0, 1),
    tangentialPressure: sampleNumberAtProgress(input.tangentialPressures, sourceProgress, 0, -1, 1),
    speed: sampleNumberAtProgress(input.speeds, sourceProgress, 0, 0, MAX_POINTER_SPEED),
    tiltX: sampleNumberAtProgress(input.tiltXs, sourceProgress, 0, -90, 90),
    tiltY: sampleNumberAtProgress(input.tiltYs, sourceProgress, 0, -90, 90),
    twist: sampleTwistAtProgress(input.twists, sourceProgress),
    direction,
    stampIndex,
  };
}

function settingsForPlan(
  input: Partial<StudioDynamicBrushPlanInput>,
  normalizedSettings?: NormalizedStudioBrushDynamicsSettings,
  detachSettings = true
): NormalizedStudioBrushDynamicsSettings {
  const settings = normalizedSettings ?? normalizeStudioBrushDynamicsSettings(input.settings);
  const width = clamp(
    finiteNumber(input.baseWidth, INTERNAL_DEFAULT_SETTINGS.width.base),
    settings.width.min,
    settings.width.max
  );
  const opacity = clamp(
    finiteNumber(input.baseOpacity, INTERNAL_DEFAULT_SETTINGS.opacity.base),
    settings.opacity.min,
    settings.opacity.max
  );
  const spacing = settings.spacingRatio === null
    ? settings.spacing.base
    : clamp(width * settings.spacingRatio, settings.spacing.min, settings.spacing.max);
  const scatter = settings.scatterRatio === null
    ? settings.scatter.base
    : clamp(width * settings.scatterRatio, settings.scatter.min, settings.scatter.max);
  if (!detachSettings) {
    // The normalized renderer helper returns only dabs and never exposes this plan-local value.
    // Keep immutable nested settings by reference instead of cloning every mapping/tip/grain field
    // on each active-draft frame.
    return {
      ...settings,
      seed: uint32(input.seed, settings.seed),
      width: { ...settings.width, base: width },
      opacity: { ...settings.opacity, base: opacity },
      spacing: { ...settings.spacing, base: spacing },
      scatter: { ...settings.scatter, base: scatter },
    };
  }
  return {
    ...settings,
    seed: uint32(input.seed, settings.seed),
    taper: cloneTaper(settings.taper),
    tip: cloneTip(settings.tip),
    colorDynamics: { ...settings.colorDynamics },
    grain: { ...settings.grain },
    tipLayers: cloneTipLayers(settings.tipLayers),
    ...(settings.dualBrush ? { dualBrush: cloneDualBrush(settings.dualBrush) } : {}),
    width: { ...settings.width, base: width },
    opacity: { ...settings.opacity, base: opacity },
    spacing: { ...settings.spacing, base: spacing },
    scatter: { ...settings.scatter, base: scatter },
  };
}

/**
 * Per-dab segment receipts are frozen only outside production builds. The freeze is a dev/test
 * invariant guard (carriers must treat the shared receipt as immutable), and its per-dab cost is
 * measurable in the planner hot loop; prod emits the exact same object shape and values without
 * paying for it. Optional chaining keeps plain-Node tooling (tsx scripts) working where
 * `import.meta.env` is absent, and the module-level constant keeps the env lookup off the loop.
 */
const FREEZE_SEGMENT_FRAMES = import.meta.env?.DEV === true;

/**
 * Converts a stroke to deterministic, arc-length-spaced particle dabs.
 *
 * When maxDabs >= 2, both unscattered source endpoints are retained even if the plan is capped.
 * Scatter intentionally moves rendered x/y; sourceX/sourceY always expose the exact path station.
 */
function planStudioDynamicBrushFromInput(
  input: Partial<StudioDynamicBrushPlanInput>,
  normalizedSettings?: NormalizedStudioBrushDynamicsSettings,
  detachSettings = true
): StudioDynamicBrushPlan {
  const settings = settingsForPlan(input, normalizedSettings, detachSettings);
  const points = sanitizeStrokePoints(input.points);
  if (points.length === 0) {
    return { dabs: [], sourcePointCount: 0, totalLength: 0, capped: false, settings };
  }

  const cumulative = cumulativeLengths(points);
  const totalLength = cumulative.at(-1) ?? 0;
  const maxDabs = Math.trunc(clamp(
    finiteNumber(input.maxDabs, DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS),
    STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE.min,
    STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE.max
  ));
  interface PlannedDynamicBrushStation {
    readonly distance: number;
    readonly station: StrokeStation;
    readonly recipe: StudioBrushDynamicsRecipe;
  }
  const buildStations = (
    fitWholePathToBudget: boolean,
    reusableStations?: readonly PlannedDynamicBrushStation[]
  ): PlannedDynamicBrushStation[] => {
    const stationAtDistance = createStationAtDistanceSampler(
      points,
      cumulative,
      totalLength
    );
    const stationPlanAt = (
      distance: number,
      index: number
    ): PlannedDynamicBrushStation => {
      // A planned station is a pure function of its exact (distance, stampIndex) pair for this
      // fixed input/settings closure, so the bounded second pass reuses first-pass stations
      // byte-identically wherever natural spacing still wins over the budget floor, instead of
      // re-resolving the shared prefix's samples and recipes. Skipping the arc-length sampler for
      // reused stations is safe: its cursor only ever starts at or below the queried segment, and
      // per-pass distances stay strictly increasing.
      const reusableStation = reusableStations?.[index];
      if (reusableStation && reusableStation.distance === distance) return reusableStation;
      const station = stationAtDistance(distance);
      const sample = normalizeStudioBrushDynamicsSample(
        sampleForStation(station, index, input, settings),
        settings
      );
      return {
        distance,
        station,
        recipe: resolveNormalizedStudioBrushDynamics(sample, settings),
      };
    };
    const planned = [stationPlanAt(0, 0)];
    if (points.length <= 1 || totalLength <= POINT_EPSILON) return planned;

    while (planned.length < maxDabs) {
      const current = planned.at(-1)!;
      const currentDistance = current.distance;
      const naturalSpacing = Math.max(
        STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.spacing.min,
        current.recipe.spacing
      );
      // A capped stroke used to keep all natural dabs near the start and replace only the final one
      // with the endpoint, leaving a many-thousand-pixel hole. On the bounded second pass, reserve
      // enough progress for every remaining station (including the endpoint). Natural spacing still
      // wins wherever pressure/speed/jitter asks for a wider interval, so variable-spacing character
      // survives while the hard cap remains O(maxDabs).
      const remainingStationSlots = maxDabs - planned.length;
      const budgetSpacing = fitWholePathToBudget && remainingStationSlots > 0
        ? (totalLength - currentDistance) / remainingStationSlots
        : 0;
      const nextDistance = currentDistance + Math.max(naturalSpacing, budgetSpacing);
      if (nextDistance >= totalLength - POINT_EPSILON) {
        if (totalLength - currentDistance > POINT_EPSILON) {
          planned.push(stationPlanAt(totalLength, planned.length));
        }
        break;
      }
      planned.push(stationPlanAt(nextDistance, planned.length));
    }
    return planned;
  };

  const naturalStations = buildStations(false);
  const capped = totalLength > POINT_EPSILON
    && totalLength - naturalStations.at(-1)!.distance > POINT_EPSILON;
  // Preserve byte-for-byte natural spacing for ordinary strokes. Only a plan proven to exceed the
  // cap pays for the bounded redistribution pass. A one-dab budget cannot retain both endpoints and
  // intentionally keeps the start, matching the public maxDabs=1 contract.
  const plannedStations = capped && maxDabs >= 2
    ? buildStations(true, naturalStations)
    : naturalStations;

  // Point taps and zero-length runs have no travel axis, so shared start/end taper would
  // incorrectly force the minimum tip size on the only dab.
  const applyStrokeTaper = totalLength > POINT_EPSILON;
  let previousSegmentFrame: StudioDynamicBrushSegmentStartFrame | undefined;
  const dabs = plannedStations.map(({ station, recipe, distance }, index): StudioDynamicBrushDab => {
    const taper = applyStrokeTaper
      ? studioBrushTaperFactors(station.progress, settings.taper)
      : { size: 1, opacity: 1 };
    // Width mappings and taper resolve first; the persisted minimum then constrains geometry only.
    // Opacity/flow keep the untouched canonical pressure so a light stylus contact can remain
    // optically delicate without becoming an unusably sub-pixel tip.
    const size = clamp(
      applyStudioDynamicBrushMinimumDiameterRatio(
        recipe.size * taper.size,
        settings.width.base,
        settings.minimumDiameterRatio
      ),
      STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.width.min,
      STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.width.max
    );
    const opacity = clamp01(recipe.opacity * taper.opacity);
    const distanceFromPrevious = index === 0
      ? 0
      : Math.max(0, distance - plannedStations[index - 1]!.distance);
    const contactFactor = studioDynamicBrushContactFactor(
      size,
      opacity,
      recipe.flow,
    );
    const contactLoadFromStrokeStart = previousSegmentFrame
      ? (
          (previousSegmentFrame.contactLoadFromStrokeStart ?? 0)
          + distanceFromPrevious
            * (
              (previousSegmentFrame.contactFactor ?? contactFactor)
              + contactFactor
            ) / 2
        )
      : 0;
    const dab: StudioDynamicBrushDab = {
      index,
      progress: station.progress,
      sourceX: station.x,
      sourceY: station.y,
      direction: station.direction,
      distanceFromPrevious,
      distanceFromStrokeStart: distance,
      contactLoadFromStrokeStart,
      contactFactor,
      ...(previousSegmentFrame
        ? { segmentStartFrame: previousSegmentFrame }
        : {}),
      x: station.x + recipe.scatterOffsetX,
      y: station.y + recipe.scatterOffsetY,
      size,
      opacity,
      flow: recipe.flow,
      spacing: recipe.spacing,
      scatter: recipe.scatter,
      angle: recipe.angle,
      roundness: recipe.roundness,
    };
    const segmentFrame: StudioDynamicBrushSegmentStartFrame = {
      index,
      sourceX: station.x,
      sourceY: station.y,
      direction: station.direction,
      size,
      roundness: recipe.roundness,
      distanceFromStrokeStart: distance,
      contactLoadFromStrokeStart,
      contactFactor,
    };
    previousSegmentFrame = FREEZE_SEGMENT_FRAMES ? Object.freeze(segmentFrame) : segmentFrame;
    return dab;
  });

  return { dabs, sourcePointCount: points.length, totalLength, capped, settings };
}

/** Validates arbitrary settings and converts a stroke to deterministic render dabs. */
export function planStudioDynamicBrush(
  rawInput?: Partial<StudioDynamicBrushPlanInput> | null
): StudioDynamicBrushPlan {
  return planStudioDynamicBrushFromInput(rawInput ?? {});
}

/** Renderer convenience alias when only dabs are needed. */
export function planStudioDynamicBrushDabs(
  input?: Partial<StudioDynamicBrushPlanInput> | null
): StudioDynamicBrushDab[] {
  return planStudioDynamicBrush(input).dabs;
}

/**
 * Hot renderer path for settings that already crossed the normalization boundary. This skips a
 * second walk over every mapping/tip/grain field while retaining the same detached planner output.
 */
export function planNormalizedStudioDynamicBrushDabs(
  input: Omit<Partial<StudioDynamicBrushPlanInput>, "settings"> | null | undefined,
  settings: NormalizedStudioBrushDynamicsSettings
): StudioDynamicBrushDab[] {
  return planStudioDynamicBrushFromInput(input ?? {}, settings, false).dabs;
}
