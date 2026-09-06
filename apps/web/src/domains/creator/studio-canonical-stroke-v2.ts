/**
 * Renderer-neutral input authority for the next Studio stroke pipeline.
 *
 * V2 deliberately lives beside the persisted v1 brush plan. Raw transport samples, accepted
 * authoritative samples and replaceable predictions remain separate, while every retained input
 * channel is normalized into plain, frozen data before a curve or material planner can consume it.
 */

export const STUDIO_CANONICAL_STROKE_V2_VERSION = 2 as const;

export const STUDIO_CANONICAL_STROKE_V2_BUDGETS = Object.freeze({
  maxIdentifierCharacters: 128,
  maxCoordinateAbsolute: 1_000_000,
  maxContactDimension: 65_536,
  maxRawSamples: 65_536,
  maxAuthoritativeSamples: 65_536,
  maxPredictedSamples: 1_024,
  maxTotalSamples: 132_096,
} as const);

export const STUDIO_CANONICAL_STROKE_V2_SAMPLE_FLAGS = Object.freeze({
  coalesced: 1 << 0,
  primary: 1 << 1,
  rulerDirectional: 1 << 2,
  rulerPerspective: 1 << 3,
  rulerIsometric: 1 << 4,
  rulerSnapApplied: 1 << 5,
  objectSnapApplied: 1 << 6,
} as const);

export type StudioCanonicalStrokeSampleRoleV2 =
  | "raw"
  | "authoritative"
  | "predicted";

export type StudioCanonicalStrokePointerTypeV2 =
  | "mouse"
  | "pen"
  | "touch"
  | "unknown";

export interface StudioCanonicalStrokeSampleCandidateV2 {
  readonly role: StudioCanonicalStrokeSampleRoleV2;
  readonly sequence: number;
  readonly sourceTimeMilliseconds: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  /** Optional at the old-producer boundary; normalized samples always contain these channels. */
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  readonly twist: number;
  readonly contactWidth?: number;
  readonly contactHeight?: number;
  /**
   * Per-gesture PointerEvent identity. It is not a persistent hardware/device identifier.
   * Persistent device identifiers are intentionally absent from the canonical schema.
   */
  readonly pointerId: number;
  readonly pointerType: StudioCanonicalStrokePointerTypeV2;
  /** PointerEvent.button, including -1 for events with no changed button. */
  readonly button: number;
  /** PointerEvent.buttons bit field. */
  readonly buttons: number;
  /** Stable transport/ruler/snap flags. Unknown bits are preserved. */
  readonly flags: number;
}

export interface StudioCanonicalStrokeSampleV2
  extends StudioCanonicalStrokeSampleCandidateV2 {
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly contactWidth: number;
  readonly contactHeight: number;
  /** Monotonic time relative to the pointer-down clock origin. */
  readonly timeMilliseconds: number;
}

export interface StudioCanonicalStrokeV2 {
  readonly kind: "studio-canonical-stroke";
  readonly version: typeof STUDIO_CANONICAL_STROKE_V2_VERSION;
  readonly strokeId: string;
  readonly coordinateSpace: "document-css-px";
  readonly timeOriginMilliseconds: number;
  readonly pointerId: number;
  readonly streams: Readonly<{
    raw: readonly StudioCanonicalStrokeSampleV2[];
    authoritative: readonly StudioCanonicalStrokeSampleV2[];
    predicted: readonly StudioCanonicalStrokeSampleV2[];
  }>;
}

export interface StudioCanonicalStrokeInputV2 {
  readonly strokeId: string;
  readonly timeOriginMilliseconds: number;
  readonly samples: readonly StudioCanonicalStrokeSampleCandidateV2[];
}

export type StudioCanonicalStrokeV2FailureReason =
  | "budget-exceeded"
  | "conflicting-duplicate"
  | "invalid-identifier"
  | "invalid-sample"
  | "invalid-time-origin"
  | "missing-authoritative-sample"
  | "pointer-mismatch"
  | "predicted-prefix"
  | "sample-order";

export type StudioCanonicalStrokeV2Result =
  | Readonly<{ ok: true; value: StudioCanonicalStrokeV2 }>
  | Readonly<{
      ok: false;
      reason: StudioCanonicalStrokeV2FailureReason;
      sampleIndex?: number;
    }>;

interface StreamState {
  readonly samples: StudioCanonicalStrokeSampleV2[];
  readonly bySequence: Map<number, StudioCanonicalStrokeSampleV2>;
  lastSequence: number;
  lastTimeMilliseconds: number;
}

const POINTER_TYPES = new Set<StudioCanonicalStrokePointerTypeV2>([
  "mouse",
  "pen",
  "touch",
  "unknown",
]);

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function unsignedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function uint32(value: unknown): value is number {
  return unsignedSafeInteger(value) && (value as number) <= 0xffff_ffff;
}

function optionalFiniteInRange(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined || value === null) return fallback;
  return finiteInRange(value, minimum, maximum) ? canonicalNumber(value) : null;
}

function optionalFullTurn(
  value: unknown,
  fallback: number,
  fullTurn: number,
): number | null {
  const bounded = optionalFiniteInRange(value, fallback, 0, fullTurn);
  if (bounded === null) return null;
  return bounded === fullTurn ? 0 : bounded;
}

function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}

interface NormalizedStudioCanonicalStrokeSampleCandidateV2
  extends StudioCanonicalStrokeSampleCandidateV2 {
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly contactWidth: number;
  readonly contactHeight: number;
}

function normalizeSampleCandidate(
  sample: StudioCanonicalStrokeSampleCandidateV2,
): NormalizedStudioCanonicalStrokeSampleCandidateV2 | null {
  const altitudeAngle = optionalFiniteInRange(
    sample.altitudeAngle,
    Math.PI / 2,
    0,
    Math.PI / 2,
  );
  const azimuthAngle = optionalFullTurn(sample.azimuthAngle, 0, Math.PI * 2);
  const contactWidth = optionalFiniteInRange(
    sample.contactWidth,
    1,
    0,
    STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxContactDimension,
  );
  const contactHeight = optionalFiniteInRange(
    sample.contactHeight,
    1,
    0,
    STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxContactDimension,
  );
  if (
    altitudeAngle === null
    || azimuthAngle === null
    || contactWidth === null
    || contactHeight === null
  ) return null;
  if (!(
    (sample.role === "raw"
      || sample.role === "authoritative"
      || sample.role === "predicted")
    && unsignedSafeInteger(sample.sequence)
    && finiteInRange(sample.sourceTimeMilliseconds, 0, Number.MAX_SAFE_INTEGER)
    && finiteInRange(
      sample.x,
      -STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxCoordinateAbsolute,
      STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxCoordinateAbsolute,
    )
    && finiteInRange(
      sample.y,
      -STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxCoordinateAbsolute,
      STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxCoordinateAbsolute,
    )
    && finiteInRange(sample.pressure, 0, 1)
    && finiteInRange(sample.tangentialPressure, -1, 1)
    && finiteInRange(sample.tiltX, -90, 90)
    && finiteInRange(sample.tiltY, -90, 90)
    && finiteInRange(sample.twist, 0, 360 - Number.EPSILON)
    && unsignedSafeInteger(sample.pointerId)
    && POINTER_TYPES.has(sample.pointerType)
    && Number.isInteger(sample.button)
    && sample.button >= -1
    && sample.button <= 31
    && uint32(sample.buttons)
    && uint32(sample.flags)
  )) return null;
  return {
    ...sample,
    altitudeAngle,
    azimuthAngle,
    contactWidth,
    contactHeight,
  };
}

function sameCandidate(
  left: StudioCanonicalStrokeSampleV2,
  right: NormalizedStudioCanonicalStrokeSampleCandidateV2,
): boolean {
  return left.role === right.role
    && left.sequence === right.sequence
    && left.sourceTimeMilliseconds === right.sourceTimeMilliseconds
    && left.x === right.x
    && left.y === right.y
    && left.pressure === right.pressure
    && left.tangentialPressure === right.tangentialPressure
    && left.tiltX === right.tiltX
    && left.tiltY === right.tiltY
    && left.altitudeAngle === right.altitudeAngle
    && left.azimuthAngle === right.azimuthAngle
    && left.twist === right.twist
    && left.contactWidth === right.contactWidth
    && left.contactHeight === right.contactHeight
    && left.pointerId === right.pointerId
    && left.pointerType === right.pointerType
    && left.button === right.button
    && left.buttons === right.buttons
    && left.flags === right.flags;
}

function freezeSamples(
  samples: readonly StudioCanonicalStrokeSampleV2[],
): readonly StudioCanonicalStrokeSampleV2[] {
  for (const sample of samples) Object.freeze(sample);
  return Object.freeze(samples);
}

function failed(
  reason: StudioCanonicalStrokeV2FailureReason,
  sampleIndex?: number,
): StudioCanonicalStrokeV2Result {
  return sampleIndex === undefined
    ? Object.freeze({ ok: false, reason })
    : Object.freeze({ ok: false, reason, sampleIndex });
}

/**
 * Normalizes one bounded candidate batch.
 *
 * Exact same-role sequence duplicates are removed deterministically. Conflicting duplicates,
 * reverse sequence order and invalid numeric data fail closed. Browser clock regressions retain
 * their source timestamp but clamp the normalized channel to the preceding time in that stream.
 */
export function normalizeStudioCanonicalStrokeV2(
  input: StudioCanonicalStrokeInputV2,
): StudioCanonicalStrokeV2Result {
  try {
    if (
      typeof input.strokeId !== "string"
      || input.strokeId.length === 0
      || input.strokeId.length
        > STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxIdentifierCharacters
    ) return failed("invalid-identifier");
    if (!finiteInRange(input.timeOriginMilliseconds, 0, Number.MAX_SAFE_INTEGER)) {
      return failed("invalid-time-origin");
    }
    if (
      !isArrayValue(input.samples)
      || input.samples.length
        > STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxTotalSamples
    ) return failed("budget-exceeded");

    const states: Record<StudioCanonicalStrokeSampleRoleV2, StreamState> = {
      raw: { samples: [], bySequence: new Map(), lastSequence: -1, lastTimeMilliseconds: 0 },
      authoritative: {
        samples: [],
        bySequence: new Map(),
        lastSequence: -1,
        lastTimeMilliseconds: 0,
      },
      predicted: {
        samples: [],
        bySequence: new Map(),
        lastSequence: -1,
        lastTimeMilliseconds: 0,
      },
    };
    let pointerId: number | null = null;

    for (let sampleIndex = 0; sampleIndex < input.samples.length; sampleIndex += 1) {
      const candidate = input.samples[sampleIndex];
      if (!candidate) {
        return failed("invalid-sample", sampleIndex);
      }
      const normalizedCandidate = normalizeSampleCandidate(candidate);
      if (!normalizedCandidate) {
        return failed("invalid-sample", sampleIndex);
      }
      if (pointerId === null) pointerId = normalizedCandidate.pointerId;
      else if (pointerId !== normalizedCandidate.pointerId) {
        return failed("pointer-mismatch", sampleIndex);
      }

      const state = states[normalizedCandidate.role];
      const duplicate = state.bySequence.get(normalizedCandidate.sequence);
      if (duplicate) {
        if (!sameCandidate(duplicate, normalizedCandidate)) {
          return failed("conflicting-duplicate", sampleIndex);
        }
        continue;
      }
      if (normalizedCandidate.sequence < state.lastSequence) {
        return failed("sample-order", sampleIndex);
      }

      const relativeTime = Math.max(
        0,
        normalizedCandidate.sourceTimeMilliseconds - input.timeOriginMilliseconds,
      );
      const sample: StudioCanonicalStrokeSampleV2 = {
        ...normalizedCandidate,
        sourceTimeMilliseconds: canonicalNumber(
          normalizedCandidate.sourceTimeMilliseconds,
        ),
        x: canonicalNumber(normalizedCandidate.x),
        y: canonicalNumber(normalizedCandidate.y),
        pressure: canonicalNumber(normalizedCandidate.pressure),
        tangentialPressure: canonicalNumber(
          normalizedCandidate.tangentialPressure,
        ),
        tiltX: canonicalNumber(normalizedCandidate.tiltX),
        tiltY: canonicalNumber(normalizedCandidate.tiltY),
        altitudeAngle: canonicalNumber(normalizedCandidate.altitudeAngle),
        azimuthAngle: canonicalNumber(normalizedCandidate.azimuthAngle),
        twist: canonicalNumber(normalizedCandidate.twist),
        contactWidth: canonicalNumber(normalizedCandidate.contactWidth),
        contactHeight: canonicalNumber(normalizedCandidate.contactHeight),
        timeMilliseconds: canonicalNumber(Math.max(state.lastTimeMilliseconds, relativeTime)),
      };
      state.samples.push(sample);
      state.bySequence.set(sample.sequence, sample);
      state.lastSequence = sample.sequence;
      state.lastTimeMilliseconds = sample.timeMilliseconds;
    }

    const { authoritative, predicted, raw } = states;
    if (authoritative.samples.length === 0) {
      return failed("missing-authoritative-sample");
    }
    if (
      raw.samples.length > STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxRawSamples
      || authoritative.samples.length
        > STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxAuthoritativeSamples
      || predicted.samples.length
        > STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxPredictedSamples
    ) return failed("budget-exceeded");

    const authoritativeLast = authoritative.samples.at(-1)!;
    const predictedFirst = predicted.samples[0];
    if (
      predictedFirst
      && (
        predictedFirst.sequence <= authoritativeLast.sequence
        || predictedFirst.timeMilliseconds < authoritativeLast.timeMilliseconds
      )
    ) return failed("predicted-prefix");

    const streams = Object.freeze({
      raw: freezeSamples(raw.samples),
      authoritative: freezeSamples(authoritative.samples),
      predicted: freezeSamples(predicted.samples),
    });
    const value: StudioCanonicalStrokeV2 = Object.freeze({
      kind: "studio-canonical-stroke",
      version: STUDIO_CANONICAL_STROKE_V2_VERSION,
      strokeId: input.strokeId,
      coordinateSpace: "document-css-px",
      timeOriginMilliseconds: canonicalNumber(input.timeOriginMilliseconds),
      pointerId: pointerId ?? authoritativeLast.pointerId,
      streams,
    });
    return Object.freeze({ ok: true, value });
  } catch {
    return failed("invalid-sample");
  }
}

function candidateFromCanonical(
  sample: StudioCanonicalStrokeSampleV2,
): StudioCanonicalStrokeSampleCandidateV2 {
  return {
    role: sample.role,
    sequence: sample.sequence,
    sourceTimeMilliseconds: sample.sourceTimeMilliseconds,
    x: sample.x,
    y: sample.y,
    pressure: sample.pressure,
    tangentialPressure: sample.tangentialPressure,
    tiltX: sample.tiltX,
    tiltY: sample.tiltY,
    altitudeAngle: sample.altitudeAngle,
    azimuthAngle: sample.azimuthAngle,
    twist: sample.twist,
    contactWidth: sample.contactWidth,
    contactHeight: sample.contactHeight,
    pointerId: sample.pointerId,
    pointerType: sample.pointerType,
    button: sample.button,
    buttons: sample.buttons,
    flags: sample.flags,
  };
}

/** Replaces, rather than appends to, the transient prediction stream. */
export function replaceStudioCanonicalStrokePredictedSuffixV2(
  stroke: StudioCanonicalStrokeV2,
  predicted: readonly StudioCanonicalStrokeSampleCandidateV2[],
): StudioCanonicalStrokeV2Result {
  for (let sampleIndex = 0; sampleIndex < predicted.length; sampleIndex += 1) {
    if (predicted[sampleIndex]?.role !== "predicted") {
      return failed("invalid-sample", sampleIndex);
    }
  }
  return normalizeStudioCanonicalStrokeV2({
    strokeId: stroke.strokeId,
    timeOriginMilliseconds: stroke.timeOriginMilliseconds,
    samples: [
      ...stroke.streams.raw.map(candidateFromCanonical),
      ...stroke.streams.authoritative.map(candidateFromCanonical),
      ...predicted,
    ],
  });
}
