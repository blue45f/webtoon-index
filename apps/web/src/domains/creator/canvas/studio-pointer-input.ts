/**
 * Browser PointerEvent samples are intentionally consumed through this small, deterministic
 * boundary before they reach the Studio drawing model.  In particular, predicted samples are
 * preview-only: advancing the authoritative session with one would make an undo snapshot contain
 * pixels the pen never actually visited.
 */

export interface StudioPointerEventLike {
  pointerId?: unknown;
  pointerType?: unknown;
  isPrimary?: unknown;
  button?: unknown;
  /** Bitmask: 1 = left. Present on PointerEvent/MouseEvent during drag. */
  buttons?: unknown;
  clientX?: unknown;
  clientY?: unknown;
  pressure?: unknown;
  tangentialPressure?: unknown;
  tiltX?: unknown;
  tiltY?: unknown;
  altitudeAngle?: unknown;
  azimuthAngle?: unknown;
  twist?: unknown;
  width?: unknown;
  height?: unknown;
  timeStamp?: unknown;
  getCoalescedEvents?: unknown;
  getPredictedEvents?: unknown;
}

export const STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS = Object.freeze({
  maxClientCoordinateAbsolute: 1_000_000,
  maxContactDimension: 65_536,
  maxPointerId: 0xffff_ffff,
  maxSourceTimeMilliseconds: Number.MAX_SAFE_INTEGER,
} as const);

export type StudioPointerSampleAuthorityV2 =
  | "authoritative"
  | "predicted-preview";

/**
 * Plain, renderer-neutral Pointer Events channels.
 *
 * `pointerId` identifies only the active pointer stream. It is not a hardware/device identifier,
 * and this contract intentionally has no `persistentDeviceId` or vendor-specific fields.
 */
export interface StudioNormalizedPointerSampleChannelsV2 {
  readonly authority: StudioPointerSampleAuthorityV2;
  readonly persistence: "durable" | "preview-only";
  readonly pointerId: number;
  readonly pointerType: "pen" | "touch" | "mouse" | "unknown";
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  /** Pointer Events altitude in radians: 0 (parallel) through PI / 2 (perpendicular). */
  readonly altitudeAngle: number;
  /** Pointer Events clockwise azimuth in radians, normalized to [0, 2 * PI). */
  readonly azimuthAngle: number;
  /** Pointer Events clockwise barrel rotation in degrees, normalized to [0, 360). */
  readonly twist: number;
  /** Contact geometry in CSS pixels. */
  readonly contactWidth: number;
  readonly contactHeight: number;
  /** Browser event timestamp. Durable only when `authority === "authoritative"`. */
  readonly sourceTimeMilliseconds: number;
}

export type StudioPointerSampleChannelsV2FailureReason =
  | "invalid-contact-geometry"
  | "invalid-coordinate"
  | "invalid-orientation"
  | "invalid-pointer"
  | "invalid-pressure"
  | "invalid-timestamp";

export type StudioPointerSampleChannelsV2Result =
  | Readonly<{
      ok: true;
      value: StudioNormalizedPointerSampleChannelsV2;
    }>
  | Readonly<{
      ok: false;
      reason: StudioPointerSampleChannelsV2FailureReason;
    }>;

export interface StudioStrokePointerSession {
  readonly pointerId: number;
  readonly pointerType: "pen" | "touch" | "mouse" | "unknown";
  /**
   * Durable ink follows the processed Pointer Events stream. Its coalesced list restores hardware
   * samples without the extra jitter/duplicate topology of a parallel raw-update subscription.
   */
  readonly moveTransport: "pointermove";
  /** Exact normalized identity of the last stored sample, used only for adjacent deduplication. */
  readonly lastAuthoritativeSample: StudioPointerSampleIdentity;
  /**
   * Identities exposed by the immediately preceding processed delivery, in native order.
   *
   * Browser coalescing windows commonly overlap (`[a,b,c]` then `[b,c,d]`). Remembering one
   * ordered delivery lets us remove only the contiguous replay prefix. It is deliberately not a
   * whole-stroke set: reduced/zero-timestamp devices must be able to revisit the same coordinate
   * later in the delivery or after moving away.
   */
  readonly previousAuthoritativeDelivery: readonly StudioPointerSampleIdentity[];
}

export interface StudioPointerSampleIdentity {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly timeStamp: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly twist: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioStrokePointerBatch<T extends StudioPointerEventLike> {
  /** Hardware-backed samples safe to store in the document, in browser delivery order. */
  readonly authoritative: readonly T[];
  /** Forward estimates safe only for the transient preview. */
  readonly predicted: readonly T[];
  readonly session: StudioStrokePointerSession;
  /** Hot-path counters used by correctness/performance tests and optional input telemetry. */
  readonly diagnostics: StudioStrokePointerBatchDiagnostics;
}

export interface StudioStrokePointerBatchDiagnostics {
  /** Valid hardware candidates exposed by the browser, before replay/duplicate filtering. */
  readonly authoritativeCandidateCount: number;
  readonly authoritativeAcceptedCount: number;
  /** Adjacent exact identities repeated inside one delivery or at the authoritative endpoint. */
  readonly duplicateCount: number;
  /** Exact identities replayed from the immediately preceding coalesced delivery. */
  readonly overlapReplayCount: number;
  /** Equality comparisons spent finding the ordered overlap; bounded linearly by both deliveries. */
  readonly overlapComparisonCount: number;
  /** New coordinates whose native timestamp moved backwards. Geometry remains in delivery order. */
  readonly authoritativeTimeRegressionCount: number;
  /** Largest accepted hardware gap in CSS pixels, including the prior authoritative endpoint. */
  readonly maximumAuthoritativeGap: number;
  readonly predictedAcceptedCount: number;
  readonly predictedDuplicateCount: number;
  /** Predictions behind the authoritative timestamp are suppressed instead of kinking the tip. */
  readonly predictedBehindAuthorityCount: number;
}

export interface StudioPointerCaptureTarget {
  setPointerCapture?: (pointerId: number) => void;
  hasPointerCapture?: (pointerId: number) => boolean;
  releasePointerCapture?: (pointerId: number) => void;
}

export interface StudioStrokeMoveTransportClaim {
  readonly accepted: boolean;
  readonly session: StudioStrokePointerSession;
}

export type StudioPointerCaptureLossOutcome = "foreign" | "retain" | "finish";

const LEGACY_POINTER_ID = 1;
const PREVIOUS_DELIVERY_SAMPLE_LIMIT = 128;
const QUARTER_TURN_RADIANS = Math.PI / 2;
const FULL_TURN_RADIANS = Math.PI * 2;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function optionalBoundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) return null;
  return canonicalNumber(value);
}

function normalizedFullTurn(
  value: unknown,
  fallback: number,
  fullTurn: number,
): number | null {
  const bounded = optionalBoundedNumber(value, fallback, 0, fullTurn);
  if (bounded === null) return null;
  return bounded === fullTurn ? 0 : bounded;
}

/**
 * Converts one Pointer Events sample into bounded plain data without retaining a DOM object.
 *
 * Missing optional channels receive the defaults defined by PointerEvent construction
 * (neutral orientation/pressure, 1 CSS-pixel contact). Explicit malformed or out-of-range values
 * fail closed. Prediction authority is encoded separately and can never be mistaken for durable
 * input by a serializer.
 */
export function normalizeStudioPointerSampleChannelsV2(
  event: StudioPointerEventLike,
  authority: StudioPointerSampleAuthorityV2,
): StudioPointerSampleChannelsV2Result {
  try {
    if (authority !== "authoritative" && authority !== "predicted-preview") {
      return Object.freeze({ ok: false, reason: "invalid-pointer" });
    }
    const pointerId = event.pointerId === undefined || event.pointerId === null
      ? LEGACY_POINTER_ID
      : event.pointerId;
    if (
      typeof pointerId !== "number"
      || !Number.isSafeInteger(pointerId)
      || pointerId < 0
      || pointerId > STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxPointerId
    ) {
      return Object.freeze({ ok: false, reason: "invalid-pointer" });
    }

    const clientX = optionalBoundedNumber(
      event.clientX,
      Number.NaN,
      -STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxClientCoordinateAbsolute,
      STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxClientCoordinateAbsolute,
    );
    const clientY = optionalBoundedNumber(
      event.clientY,
      Number.NaN,
      -STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxClientCoordinateAbsolute,
      STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxClientCoordinateAbsolute,
    );
    if (clientX === null || clientY === null || Number.isNaN(clientX) || Number.isNaN(clientY)) {
      return Object.freeze({ ok: false, reason: "invalid-coordinate" });
    }

    const pressure = optionalBoundedNumber(event.pressure, 0, 0, 1);
    const tangentialPressure = optionalBoundedNumber(
      event.tangentialPressure,
      0,
      -1,
      1,
    );
    if (pressure === null || tangentialPressure === null) {
      return Object.freeze({ ok: false, reason: "invalid-pressure" });
    }

    const tiltX = optionalBoundedNumber(event.tiltX, 0, -90, 90);
    const tiltY = optionalBoundedNumber(event.tiltY, 0, -90, 90);
    const altitudeAngle = optionalBoundedNumber(
      event.altitudeAngle,
      QUARTER_TURN_RADIANS,
      0,
      QUARTER_TURN_RADIANS,
    );
    const azimuthAngle = normalizedFullTurn(
      event.azimuthAngle,
      0,
      FULL_TURN_RADIANS,
    );
    const twist = normalizedFullTurn(event.twist, 0, 360);
    if (
      tiltX === null
      || tiltY === null
      || altitudeAngle === null
      || azimuthAngle === null
      || twist === null
    ) {
      return Object.freeze({ ok: false, reason: "invalid-orientation" });
    }

    const contactWidth = optionalBoundedNumber(
      event.width,
      1,
      0,
      STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxContactDimension,
    );
    const contactHeight = optionalBoundedNumber(
      event.height,
      1,
      0,
      STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxContactDimension,
    );
    if (contactWidth === null || contactHeight === null) {
      return Object.freeze({ ok: false, reason: "invalid-contact-geometry" });
    }

    const sourceTimeMilliseconds = optionalBoundedNumber(
      event.timeStamp,
      0,
      0,
      STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxSourceTimeMilliseconds,
    );
    if (sourceTimeMilliseconds === null) {
      return Object.freeze({ ok: false, reason: "invalid-timestamp" });
    }

    const value: StudioNormalizedPointerSampleChannelsV2 = Object.freeze({
      authority,
      persistence: authority === "authoritative" ? "durable" : "preview-only",
      pointerId,
      pointerType: pointerTypeOf(event),
      clientX,
      clientY,
      pressure,
      tangentialPressure,
      tiltX,
      tiltY,
      altitudeAngle,
      azimuthAngle,
      twist,
      contactWidth,
      contactHeight,
      sourceTimeMilliseconds,
    });
    return Object.freeze({ ok: true, value });
  } catch {
    return Object.freeze({ ok: false, reason: "invalid-pointer" });
  }
}

function pointerIdOf(event: StudioPointerEventLike, fallback = LEGACY_POINTER_ID): number {
  if (event.pointerId === undefined || event.pointerId === null) return fallback;
  const value = finiteNumber(event.pointerId, Number.NaN);
  return Number.isInteger(value) && value >= 0 ? value : Number.NaN;
}

function pointerTypeOf(event: StudioPointerEventLike): StudioStrokePointerSession["pointerType"] {
  if (typeof event.pointerType !== "string") return "unknown";
  const value = event.pointerType.toLowerCase();
  return value === "pen" || value === "touch" || value === "mouse" ? value : "unknown";
}

function pointerSampleIdentity(
  event: StudioPointerEventLike,
  pointerId: number
): StudioPointerSampleIdentity {
  // Do not deduplicate by timestamp alone. Safari and some tablet drivers legitimately emit a
  // run of distinct coordinates with timestamp=0 (or the same reduced-precision timestamp).
  return {
    pointerId,
    pointerType: typeof event.pointerType === "string" ? event.pointerType.toLowerCase() : "",
    timeStamp: finiteNumber(event.timeStamp, 0),
    clientX: finiteNumber(event.clientX, 0),
    clientY: finiteNumber(event.clientY, 0),
    pressure: finiteNumber(event.pressure, 0),
    tangentialPressure: finiteNumber(event.tangentialPressure, 0),
    tiltX: finiteNumber(event.tiltX, 0),
    tiltY: finiteNumber(event.tiltY, 0),
    altitudeAngle: finiteNumber(event.altitudeAngle, 0),
    azimuthAngle: finiteNumber(event.azimuthAngle, 0),
    twist: finiteNumber(event.twist, 0),
    width: finiteNumber(event.width, 0),
    height: finiteNumber(event.height, 0),
  };
}

function samePointerSampleIdentity(
  left: StudioPointerSampleIdentity,
  right: StudioPointerSampleIdentity
): boolean {
  return left === right || (
    left.pointerId === right.pointerId
    && left.pointerType === right.pointerType
    && left.timeStamp === right.timeStamp
    && left.clientX === right.clientX
    && left.clientY === right.clientY
    && left.pressure === right.pressure
    && left.tangentialPressure === right.tangentialPressure
    && left.tiltX === right.tiltX
    && left.tiltY === right.tiltY
    && left.altitudeAngle === right.altitudeAngle
    && left.azimuthAngle === right.azimuthAngle
    && left.twist === right.twist
    && left.width === right.width
    && left.height === right.height
  );
}

function includesPointerSampleIdentity(
  identities: readonly StudioPointerSampleIdentity[],
  candidate: StudioPointerSampleIdentity
): boolean {
  for (const identity of identities) {
    if (samePointerSampleIdentity(identity, candidate)) return true;
  }
  return false;
}

function boundedPointerDelivery(
  identities: readonly StudioPointerSampleIdentity[]
): readonly StudioPointerSampleIdentity[] {
  return identities.length <= PREVIOUS_DELIVERY_SAMPLE_LIMIT
    ? identities
    : identities.slice(identities.length - PREVIOUS_DELIVERY_SAMPLE_LIMIT);
}

/**
 * Returns the longest previous-delivery suffix that is the current-delivery prefix.
 *
 * Matching an identity anywhere in the previous/current arrays dropped genuine loop-backs and
 * tight curves, especially on privacy-reduced clocks where many samples share timestamp 0. A
 * browser replay is ordered and contiguous, so only this suffix/prefix shape is safe to suppress.
 * KMP keeps the pointer hot path linear even for the maximum 128-sample defensive window.
 */
function overlappingDeliveryPrefixLength(
  previous: readonly StudioPointerSampleIdentity[],
  current: readonly StudioPointerSampleIdentity[]
): Readonly<{ length: number; comparisons: number }> {
  if (previous.length === 0 || current.length === 0) {
    return { length: 0, comparisons: 0 };
  }
  // No overlap can be longer than the retained previous delivery. Avoid allocating/scanning a
  // hostile or broken polyfill's arbitrarily large coalesced list just to classify its prefix.
  const pattern = current.length <= previous.length
    ? current
    : current.slice(0, previous.length);
  let comparisons = 0;
  const same = (
    left: StudioPointerSampleIdentity,
    right: StudioPointerSampleIdentity
  ) => {
    comparisons += 1;
    return samePointerSampleIdentity(left, right);
  };
  // The ordinary browser stream is non-overlapping. Any suffix/prefix replay must place the
  // previous endpoint somewhere in the bounded current prefix; reject the common case without
  // allocating a KMP prefix table.
  const previousEndpoint = previous[previous.length - 1]!;
  let endpointCanOverlap = false;
  for (const identity of pattern) {
    if (same(previousEndpoint, identity)) {
      endpointCanOverlap = true;
      break;
    }
  }
  if (!endpointCanOverlap) return { length: 0, comparisons };
  const prefix = new Array<number>(pattern.length).fill(0);
  for (let index = 1, matched = 0; index < pattern.length; index += 1) {
    while (
      matched > 0
      && !same(pattern[index]!, pattern[matched]!)
    ) {
      matched = prefix[matched - 1]!;
    }
    if (same(pattern[index]!, pattern[matched]!)) matched += 1;
    prefix[index] = matched;
  }

  let matched = 0;
  for (let index = 0; index < previous.length; index += 1) {
    while (
      matched > 0
      && !same(previous[index]!, pattern[matched]!)
    ) {
      matched = prefix[matched - 1]!;
    }
    if (same(previous[index]!, pattern[matched]!)) matched += 1;
    if (matched === pattern.length && index < previous.length - 1) {
      matched = prefix[matched - 1]!;
    }
  }
  return { length: matched, comparisons };
}

/**
 * Related-event APIs are browser/plugin boundaries even when the dispatched parent is trusted.
 * A broken polyfill or embedded webview can return an Array containing nulls, primitives, or
 * partial objects. Require the identity and coordinates needed by the drawing pipeline before a
 * candidate can reach pointer matching or Konva's pointer-position adapter.
 */
function isUsableStudioRelatedPointerEvent(value: unknown): value is StudioPointerEventLike {
  if (!value || typeof value !== "object") return false;
  try {
    const event = value as StudioPointerEventLike;
    const pointerId = event.pointerId;
    return (pointerId === undefined || pointerId === null || Number.isFinite(pointerIdOf(event, Number.NaN)))
      && typeof event.clientX === "number"
      && Number.isFinite(event.clientX)
      && typeof event.clientY === "number"
      && Number.isFinite(event.clientY);
  } catch {
    // Defensive against hostile or partially detached objects with throwing property accessors.
    return false;
  }
}

/**
 * Related samples can come from browser/polyfill-owned arrays rather than the trusted dispatched
 * event. Match and read every optional stylus channel inside one exception boundary so one broken
 * getter cannot abort the authoritative parent fallback.
 */
function safeRelatedPointerSampleIdentity(
  session: StudioStrokePointerSession,
  event: StudioPointerEventLike
): StudioPointerSampleIdentity | null {
  try {
    if (!isStudioStrokePointerEvent(session, event)) return null;
    return pointerSampleIdentity(event, session.pointerId);
  } catch {
    return null;
  }
}

function safeRelatedEvents<T extends StudioPointerEventLike>(
  event: T,
  methodName: "getCoalescedEvents" | "getPredictedEvents"
): readonly T[] {
  const method = event[methodName];
  if (typeof method !== "function") return [];
  try {
    const result = (method as (this: T) => unknown).call(event);
    return Array.isArray(result)
      ? result.filter(isUsableStudioRelatedPointerEvent) as T[]
      : [];
  } catch {
    // Safari versions, embedded webviews and test doubles may expose a method that still throws.
    // The dispatched event remains a complete standards-compatible fallback.
    return [];
  }
}

/**
 * True when the left primary contact is down.
 * Mouse: button 0 on pointerdown; buttons bitmask 1 during drag.
 * Pen/touch: button 0 on down; some drivers omit buttons mid-stroke.
 */
export function isStudioLeftContactDown(event: StudioPointerEventLike): boolean {
  const button = finiteNumber(event.button, 0);
  // Reject middle (1) and right (2) explicitly. -1 is used on some move events.
  if (button === 1 || button === 2) return false;
  if (typeof event.buttons === "number" && Number.isFinite(event.buttons)) {
    // buttons === 0 means released (mouse left the drag without up in some edge cases).
    if (event.buttons === 0) return false;
    return (event.buttons & 1) === 1;
  }
  // pointerdown without buttons field: require primary button index 0.
  return button === 0 || button === -1;
}

/** Starts one primary, left-contact drawing session. Secondary touch and barrel/right clicks lose. */
export function beginStudioStrokePointerSession(
  event: StudioPointerEventLike
): StudioStrokePointerSession | null {
  if (event.isPrimary === false) return null;
  // Mouse/pen/touch must start on left contact only (context menu / barrel stay free).
  // Some pen drivers emit `button: -1` on contact; honor that as active left contact.
  if (!isStudioLeftContactDown(event)) return null;
  const pointerId = pointerIdOf(event);
  if (!Number.isFinite(pointerId)) return null;
  const initialSample = pointerSampleIdentity(event, pointerId);
  return {
    pointerId,
    pointerType: pointerTypeOf(event),
    moveTransport: "pointermove",
    lastAuthoritativeSample: initialSample,
    previousAuthoritativeDelivery: [initialSample],
  };
}

/** True only when this event belongs to the pen/finger/mouse that opened the stroke. */
export function isStudioStrokePointerEvent(
  session: StudioStrokePointerSession | null | undefined,
  event: StudioPointerEventLike
): boolean {
  return Boolean(session && pointerIdOf(event, session.pointerId) === session.pointerId);
}

/**
 * Mouse can release outside the canvas without a reliable pointerup if capture fails.
 * When buttons reports 0 mid-stroke for mouse/unknown, the stroke must end.
 * Pen/touch often omit a reliable buttons mask — never force-end those on buttons alone.
 */
export function shouldEndStudioStrokeForReleasedContact(
  session: StudioStrokePointerSession | null | undefined,
  event: StudioPointerEventLike
): boolean {
  if (!session || !isStudioStrokePointerEvent(session, event)) return false;
  if (session.pointerType !== "mouse" && session.pointerType !== "unknown") return false;
  if (typeof event.buttons !== "number" || !Number.isFinite(event.buttons)) return false;
  return event.buttons === 0;
}

/**
 * Losing DOM pointer capture is transport degradation, not a cancellation signal. The global
 * pointerup/cancel safety listeners still own the gesture. A mouse loss that already reports
 * buttons=0 can be finalized from the last authoritative sample; every other matching loss keeps
 * the session alive until a real end signal arrives.
 */
export function resolveStudioPointerCaptureLoss(
  session: StudioStrokePointerSession | null | undefined,
  event: StudioPointerEventLike
): StudioPointerCaptureLossOutcome {
  if (!session || !isStudioStrokePointerEvent(session, event)) return "foreign";
  return shouldEndStudioStrokeForReleasedContact(session, event) ? "finish" : "retain";
}

/**
 * A capture-phase `window` blur listener also observes focus leaving a descendant control. That is
 * an ordinary focus transfer (for example, toolbar button -> canvas), not a browser-window abort.
 */
export function isStudioTopLevelWindowBlur(
  eventTarget: unknown,
  windowTarget: unknown
): boolean {
  return eventTarget === windowTarget;
}

/** Keep already-rendered mouse/pen ink when the browser transport itself is interrupted. */
export function shouldPreserveStudioStrokeOnTransportAbort(
  session: StudioStrokePointerSession | null | undefined
): boolean {
  return Boolean(session && session.pointerType !== "touch");
}

/**
 * Browsers and embedded webviews may cancel a mouse or pen stream after showing valid ink. Keep
 * that last authoritative prefix instead of deleting it. Touch cancellation remains destructive
 * because it normally means the gesture was promoted to scrolling, pinch zoom, or palm rejection.
 */
export function shouldCommitStudioStrokeOnPointerCancel(
  session: StudioStrokePointerSession | null | undefined,
  event: StudioPointerEventLike
): boolean {
  if (!session || !isStudioStrokePointerEvent(session, event)) return false;
  return shouldPreserveStudioStrokeOnTransportAbort(session);
}

/** A second finger transitions a finger stroke into navigation; pen + touch remains palm-safe. */
export function shouldCancelStudioFingerStrokeForAdditionalContact(
  session: StudioStrokePointerSession | null | undefined,
  event: StudioPointerEventLike
): boolean {
  if (!session || session.pointerType !== "touch" || pointerTypeOf(event) !== "touch") return false;
  const pointerId = pointerIdOf(event, session.pointerId);
  return Number.isFinite(pointerId) && pointerId !== session.pointerId;
}

/**
 * Keeps durable ink on processed pointermove. `pointerrawupdate` can arrive at a different cadence
 * from the processed/coalesced stream and must never poison a session or suppress its next move.
 * This mirrors Magma's public input path and leaves raw updates available for future preview-only
 * telemetry without allowing two native transports to own the same pixels.
 */
export function claimStudioStrokeMoveTransport(
  session: StudioStrokePointerSession,
  event: StudioPointerEventLike,
  eventType: "pointermove" | "pointerrawupdate"
): StudioStrokeMoveTransportClaim {
  if (!isStudioStrokePointerEvent(session, event)) {
    return { accepted: false, session };
  }
  return {
    accepted: eventType === "pointermove",
    session,
  };
}

/**
 * Restores either coalesced hardware samples or the dispatched-event fallback, and keeps predicted
 * samples on a separate preview-only channel. The processed parent is never treated as an extra
 * hardware point when a coalesced list exists.
 *
 * Browser delivery order is preserved rather than timestamp-sorted. Reduced timer precision can
 * produce equal timestamps, while reordering those points would visibly kink the stroke.
 */
export function collectStudioStrokePointerBatch<T extends StudioPointerEventLike>(
  session: StudioStrokePointerSession,
  event: T,
  options: {
    includePredicted?: boolean;
    /** Normal pointerup owns exactly its dispatched endpoint, never stale move coalescing. */
    authoritativeSource?: "coalesced-or-parent" | "parent-only";
  } = {}
): StudioStrokePointerBatch<T> {
  if (!isStudioStrokePointerEvent(session, event)) {
    return {
      authoritative: [],
      predicted: [],
      session,
      diagnostics: {
        authoritativeCandidateCount: 0,
        authoritativeAcceptedCount: 0,
        duplicateCount: 0,
        overlapReplayCount: 0,
        overlapComparisonCount: 0,
        authoritativeTimeRegressionCount: 0,
        maximumAuthoritativeGap: 0,
        predictedAcceptedCount: 0,
        predictedDuplicateCount: 0,
        predictedBehindAuthorityCount: 0,
      },
    };
  }

  const authoritative: T[] = [];
  let previousSample = session.lastAuthoritativeSample;
  const previousDelivery = session.previousAuthoritativeDelivery ?? [previousSample];
  const currentDelivery: StudioPointerSampleIdentity[] = [];
  let authoritativeCandidateCount = 0;
  let duplicateCount = 0;
  let overlapReplayCount = 0;
  let authoritativeTimeRegressionCount = 0;
  let maximumAuthoritativeGap = 0;
  const coalesced = options.authoritativeSource === "parent-only"
    ? []
    : safeRelatedEvents(event, "getCoalescedEvents");
  // A trusted parent pointer event is the processed aggregate of its coalesced list, not an extra
  // hardware sample. Consume one representation only; empty/throwing APIs fall back to parent.
  const candidates = coalesced.length > 0 ? coalesced : [event];
  const authoritativeSamples: T[] = [];
  for (const candidate of candidates) {
    const identity = candidate === event
      ? pointerSampleIdentity(candidate, session.pointerId)
      : safeRelatedPointerSampleIdentity(session, candidate);
    if (identity === null) continue;
    authoritativeCandidateCount += 1;
    currentDelivery.push(identity);
    authoritativeSamples.push(candidate);
  }
  const overlap = overlappingDeliveryPrefixLength(
    previousDelivery,
    currentDelivery
  );
  for (let candidateIndex = 0; candidateIndex < authoritativeSamples.length; candidateIndex += 1) {
    const identity = currentDelivery[candidateIndex]!;
    if (candidateIndex < overlap.length) {
      overlapReplayCount += 1;
      continue;
    }
    if (samePointerSampleIdentity(identity, previousSample)) {
      duplicateCount += 1;
      continue;
    }
    if (identity.timeStamp < previousSample.timeStamp) {
      authoritativeTimeRegressionCount += 1;
    }
    maximumAuthoritativeGap = Math.max(
      maximumAuthoritativeGap,
      Math.hypot(
        identity.clientX - previousSample.clientX,
        identity.clientY - previousSample.clientY
      )
    );
    authoritative.push(authoritativeSamples[candidateIndex]!);
    previousSample = identity;
  }

  // A malformed implementation can return a non-empty list containing only foreign or otherwise
  // unusable entries. In that case the matching dispatched event is still the standards-complete
  // fallback. Preserve the usual adjacent dedupe rule so a repeated parent does not invent ink.
  if (coalesced.length > 0 && authoritative.length === 0) {
    const parentIdentity = pointerSampleIdentity(event, session.pointerId);
    authoritativeCandidateCount += 1;
    currentDelivery.push(parentIdentity);
    if (!samePointerSampleIdentity(parentIdentity, previousSample)) {
      if (parentIdentity.timeStamp < previousSample.timeStamp) {
        authoritativeTimeRegressionCount += 1;
      }
      maximumAuthoritativeGap = Math.max(
        maximumAuthoritativeGap,
        Math.hypot(
          parentIdentity.clientX - previousSample.clientX,
          parentIdentity.clientY - previousSample.clientY
        )
      );
      authoritative.push(event);
      previousSample = parentIdentity;
    }
  }

  const nextSession: StudioStrokePointerSession = {
    ...session,
    lastAuthoritativeSample: previousSample,
    previousAuthoritativeDelivery: currentDelivery.length > 0
      ? boundedPointerDelivery(currentDelivery)
      : previousDelivery,
  };

  const predicted: T[] = [];
  let predictedDuplicateCount = 0;
  let predictedBehindAuthorityCount = 0;
  if (options.includePredicted) {
    let previousPredictedSample = previousSample;
    const predictedDelivery: StudioPointerSampleIdentity[] = [];
    for (const candidate of safeRelatedEvents(event, "getPredictedEvents")) {
      const identity = safeRelatedPointerSampleIdentity(session, candidate);
      if (identity === null) continue;
      const previousPredictedIdentity = predictedDelivery.at(-1);
      predictedDelivery.push(identity);
      if (
        (previousPredictedIdentity !== undefined
          && samePointerSampleIdentity(identity, previousPredictedIdentity))
        || samePointerSampleIdentity(identity, previousPredictedSample)
        || includesPointerSampleIdentity(currentDelivery, identity)
      ) {
        predictedDuplicateCount += 1;
        continue;
      }
      if (identity.timeStamp < previousSample.timeStamp) {
        predictedBehindAuthorityCount += 1;
        continue;
      }
      predicted.push(candidate);
      previousPredictedSample = identity;
    }
  }

  return {
    authoritative,
    predicted,
    session: nextSession,
    diagnostics: {
      authoritativeCandidateCount,
      authoritativeAcceptedCount: authoritative.length,
      duplicateCount,
      overlapReplayCount,
      overlapComparisonCount: overlap.comparisons,
      authoritativeTimeRegressionCount,
      maximumAuthoritativeGap,
      predictedAcceptedCount: predicted.length,
      predictedDuplicateCount,
      predictedBehindAuthorityCount,
    },
  };
}

/** Pointer capture is a progressive enhancement; unsupported/detached DOM nodes fail closed. */
export function tryCaptureStudioStrokePointer(
  target: StudioPointerCaptureTarget | null | undefined,
  pointerId: number
): boolean {
  if (typeof target?.setPointerCapture !== "function") return false;
  try {
    target.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}

/** Releases only a capture still owned by the target and tolerates browser detach races. */
export function tryReleaseStudioStrokePointer(
  target: StudioPointerCaptureTarget | null | undefined,
  pointerId: number
): boolean {
  if (typeof target?.releasePointerCapture !== "function") return false;
  try {
    if (typeof target.hasPointerCapture === "function" && !target.hasPointerCapture(pointerId)) {
      return false;
    }
    target.releasePointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}
