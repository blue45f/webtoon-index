/**
 * Live Ink Protocol V2 — typed control messages for the binary point channel.
 *
 * Ink deliberately does not ride the JSON cursor envelope: samples move as quantized binary
 * chunks (see `studio-live-ink-codec`) on a separately negotiated transport lane, while these
 * messages carry the stroke lifecycle around them. A peer whose transport did not negotiate the
 * `ink-v2` capability simply never receives ink traffic — remote strokes stay cursor-only and
 * there is NO approximate re-rendering fallback. Every parser here fails closed: an invalid,
 * replayed, cross-work or out-of-order message is dropped before it can touch renderer state.
 */

import {
  STUDIO_LIVE_MESSAGE_FUTURE_SKEW_MS,
  STUDIO_LIVE_MESSAGE_MAX_AGE_MS,
} from "./studio-live-collaboration-protocol";
import {
  STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES,
  type StudioLiveGesturePreviewBlendMode,
} from "./studio-live-gesture-preview";
import { decodeStudioLiveInkSamples } from "./studio-live-ink-codec";

export const STUDIO_LIVE_INK_PROTOCOL_VERSION = 2 as const;
export const STUDIO_LIVE_INK_SAMPLE_SCHEMA = "ink-v2" as const;
/** Transport lane capability name negotiated before any ink message may flow. */
export const STUDIO_LIVE_INK_CAPABILITY = "ink-v2" as const;
export const STUDIO_LIVE_INK_WIRE = "studio-live-ink" as const;
export const STUDIO_LIVE_INK_WIRE_VERSION = 1 as const;

export const STUDIO_LIVE_INK_MAX_SAMPLES_PER_CHUNK = 512;
export const STUDIO_LIVE_INK_MAX_SAMPLES_PER_PREDICTION = 64;
export const STUDIO_LIVE_INK_MAX_SAMPLES_PER_STROKE = 100_000;
export const STUDIO_LIVE_INK_CHUNK_MAX_BYTES = 64 * 1024;
export const STUDIO_LIVE_INK_PREDICTION_MAX_BYTES = 8 * 1024;
export const STUDIO_LIVE_INK_MAX_ACTIVE_STROKES = 8;
export const STUDIO_LIVE_INK_MAX_STROKE_WIDTH = 8_192;
export const STUDIO_LIVE_INK_MAX_SEED = 0xffff_ffff;

const MAX_ID_LENGTH = 160;
const MAX_COLOR_LENGTH = 64;
const MAX_SETTLED_STROKES = 256;
const SAMPLE_HASH_PATTERN = /^fnv1a32:[0-9a-f]{8}$/u;
const FORBIDDEN_RESOURCE_STRING = /(?:\b(?:https?|data|blob|file|javascript):|url\s*\()/iu;

export const STUDIO_LIVE_INK_CANCEL_REASONS = [
  "user",
  "timeout",
  "transport-error",
  "provider-mismatch",
  "coordinate-space-changed",
  "document-rebased",
] as const;

export type StudioLiveInkCancelReason = (typeof STUDIO_LIVE_INK_CANCEL_REASONS)[number];
export type StudioLiveInkBlendMode = StudioLiveGesturePreviewBlendMode;

/**
 * Exact renderer provenance of the authoring side. Receivers compare it against their own
 * provider before trusting chunk bytes; a mismatch must cancel, never approximate.
 */
export interface StudioLiveInkProviderFingerprint {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly buildHash: string;
}

export interface StudioLiveInkBegin {
  readonly kind: "ink:begin";
  readonly protocolVersion: typeof STUDIO_LIVE_INK_PROTOCOL_VERSION;
  readonly strokeId: string;
  readonly pageId: string;
  readonly layerId: string;
  readonly coordinateSpaceId: string;
  readonly coordinateSpaceRevision: number;
  readonly provider: StudioLiveInkProviderFingerprint;
  readonly brushPresetId: string;
  /** Hash of the brush contract the author rendered with; receivers verify before drawing. */
  readonly brushContractHash: string;
  readonly seed: number;
  readonly mode: "pen" | "eraser";
  readonly blendMode: StudioLiveInkBlendMode;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly sampleSchema: typeof STUDIO_LIVE_INK_SAMPLE_SCHEMA;
  readonly startedAt: number;
}

export interface StudioLiveInkChunk {
  readonly kind: "ink:chunk";
  readonly strokeId: string;
  /** 1-based, strictly +1 per chunk of one stroke. */
  readonly chunkSequence: number;
  readonly firstSampleIndex: number;
  readonly sampleCount: number;
  /** Binary `ink-v2` sample block (see studio-live-ink-codec). */
  readonly payload: ArrayBuffer;
}

export interface StudioLiveInkPrediction {
  readonly kind: "ink:prediction";
  readonly strokeId: string;
  /** Strictly increasing per stroke; gaps are legal because predictions are droppable. */
  readonly predictionSequence: number;
  /** Actual-sample index this speculative tail replaces from. */
  readonly replacesFromSampleIndex: number;
  readonly expiresAt: number;
  readonly sampleCount: number;
  readonly payload: ArrayBuffer;
}

export interface StudioLiveInkEnd {
  readonly kind: "ink:end";
  readonly strokeId: string;
  readonly lastChunkSequence: number;
  readonly totalActualSamples: number;
  /** `hashStudioLiveInkPayloads` digest over every actual chunk payload, in order. */
  readonly sampleHash: string;
  readonly crdtStrokeId: string;
}

export interface StudioLiveInkCancel {
  readonly kind: "ink:cancel";
  readonly strokeId: string;
  readonly reason: StudioLiveInkCancelReason;
}

export type StudioLiveInkMessage =
  | StudioLiveInkBegin
  | StudioLiveInkChunk
  | StudioLiveInkPrediction
  | StudioLiveInkEnd
  | StudioLiveInkCancel;

export type StudioLiveInkMessageKind = StudioLiveInkMessage["kind"];

/** Transport-neutral frame carrying one ink message on the binary lane. */
export interface StudioLiveInkWireMessage {
  readonly wire: typeof STUDIO_LIVE_INK_WIRE;
  readonly wireVersion: typeof STUDIO_LIVE_INK_WIRE_VERSION;
  readonly workId: string;
  readonly senderSessionId: string;
  readonly sentAt: number;
  readonly message: StudioLiveInkMessage;
}

export interface ParseStudioLiveInkWireMessageOptions {
  expectedWorkId: string;
  selfSessionId?: string | null;
  now?: number;
}

export class StudioLiveInkProtocolError extends Error {
  constructor(message = "유효하지 않은 실시간 잉크 메시지입니다.") {
    super(message);
    this.name = "StudioLiveInkProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 0x1f || (point >= 0x7f && point <= 0x9f)) return true;
  }
  return false;
}

function exactIdentifier(value: unknown, maximum = MAX_ID_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !containsControlCharacter(value)
  );
}

function isSafeColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_COLOR_LENGTH &&
    value === value.trim() &&
    !containsControlCharacter(value) &&
    !FORBIDDEN_RESOURCE_STRING.test(value)
  );
}

function isSafeIntegerRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

const BLEND_MODE_SET: ReadonlySet<string> = new Set(STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES);
const CANCEL_REASON_SET: ReadonlySet<string> = new Set(STUDIO_LIVE_INK_CANCEL_REASONS);

const BEGIN_KEYS = [
  "kind",
  "protocolVersion",
  "strokeId",
  "pageId",
  "layerId",
  "coordinateSpaceId",
  "coordinateSpaceRevision",
  "provider",
  "brushPresetId",
  "brushContractHash",
  "seed",
  "mode",
  "blendMode",
  "color",
  "width",
  "opacity",
  "sampleSchema",
  "startedAt",
] as const;
const PROVIDER_KEYS = ["providerId", "providerVersion", "buildHash"] as const;
const CHUNK_KEYS = [
  "kind",
  "strokeId",
  "chunkSequence",
  "firstSampleIndex",
  "sampleCount",
  "payload",
] as const;
const PREDICTION_KEYS = [
  "kind",
  "strokeId",
  "predictionSequence",
  "replacesFromSampleIndex",
  "expiresAt",
  "sampleCount",
  "payload",
] as const;
const END_KEYS = [
  "kind",
  "strokeId",
  "lastChunkSequence",
  "totalActualSamples",
  "sampleHash",
  "crdtStrokeId",
] as const;
const CANCEL_KEYS = ["kind", "strokeId", "reason"] as const;
const WIRE_KEYS = [
  "wire",
  "wireVersion",
  "workId",
  "senderSessionId",
  "sentAt",
  "message",
] as const;

function isProviderFingerprint(value: unknown): value is StudioLiveInkProviderFingerprint {
  return (
    isRecord(value) &&
    hasExactKeys(value, PROVIDER_KEYS) &&
    exactIdentifier(value.providerId) &&
    exactIdentifier(value.providerVersion) &&
    exactIdentifier(value.buildHash)
  );
}

function isInkBegin(value: Record<string, unknown>): value is Record<string, unknown> & StudioLiveInkBegin {
  return (
    hasExactKeys(value, BEGIN_KEYS) &&
    value.protocolVersion === STUDIO_LIVE_INK_PROTOCOL_VERSION &&
    exactIdentifier(value.strokeId) &&
    exactIdentifier(value.pageId) &&
    exactIdentifier(value.layerId) &&
    exactIdentifier(value.coordinateSpaceId) &&
    isSafeIntegerRange(value.coordinateSpaceRevision, 0, Number.MAX_SAFE_INTEGER) &&
    isProviderFingerprint(value.provider) &&
    exactIdentifier(value.brushPresetId) &&
    exactIdentifier(value.brushContractHash) &&
    isSafeIntegerRange(value.seed, 0, STUDIO_LIVE_INK_MAX_SEED) &&
    (value.mode === "pen" || value.mode === "eraser") &&
    typeof value.blendMode === "string" &&
    BLEND_MODE_SET.has(value.blendMode) &&
    isSafeColor(value.color) &&
    isFiniteRange(value.width, Number.EPSILON, STUDIO_LIVE_INK_MAX_STROKE_WIDTH) &&
    isFiniteRange(value.opacity, 0, 1) &&
    value.sampleSchema === STUDIO_LIVE_INK_SAMPLE_SCHEMA &&
    isSafeIntegerRange(value.startedAt, 0, Number.MAX_SAFE_INTEGER)
  );
}

/** Confirms the binary block decodes exactly and carries the advertised sample count. */
function isValidSamplePayload(
  payload: unknown,
  sampleCount: number,
  maximumBytes: number
): payload is ArrayBuffer {
  if (!(payload instanceof ArrayBuffer) || payload.byteLength > maximumBytes) return false;
  try {
    return decodeStudioLiveInkSamples(payload).samples.length === sampleCount;
  } catch {
    return false;
  }
}

function isInkChunk(value: Record<string, unknown>): value is Record<string, unknown> & StudioLiveInkChunk {
  return (
    hasExactKeys(value, CHUNK_KEYS) &&
    exactIdentifier(value.strokeId) &&
    isSafeIntegerRange(value.chunkSequence, 1, Number.MAX_SAFE_INTEGER) &&
    isSafeIntegerRange(value.firstSampleIndex, 0, STUDIO_LIVE_INK_MAX_SAMPLES_PER_STROKE - 1) &&
    isSafeIntegerRange(value.sampleCount, 1, STUDIO_LIVE_INK_MAX_SAMPLES_PER_CHUNK) &&
    (value.firstSampleIndex as number) + (value.sampleCount as number)
      <= STUDIO_LIVE_INK_MAX_SAMPLES_PER_STROKE &&
    isValidSamplePayload(value.payload, value.sampleCount as number, STUDIO_LIVE_INK_CHUNK_MAX_BYTES)
  );
}

function isInkPrediction(
  value: Record<string, unknown>
): value is Record<string, unknown> & StudioLiveInkPrediction {
  return (
    hasExactKeys(value, PREDICTION_KEYS) &&
    exactIdentifier(value.strokeId) &&
    isSafeIntegerRange(value.predictionSequence, 1, Number.MAX_SAFE_INTEGER) &&
    isSafeIntegerRange(value.replacesFromSampleIndex, 0, STUDIO_LIVE_INK_MAX_SAMPLES_PER_STROKE) &&
    isSafeIntegerRange(value.expiresAt, 0, Number.MAX_SAFE_INTEGER) &&
    isSafeIntegerRange(value.sampleCount, 1, STUDIO_LIVE_INK_MAX_SAMPLES_PER_PREDICTION) &&
    isValidSamplePayload(
      value.payload,
      value.sampleCount as number,
      STUDIO_LIVE_INK_PREDICTION_MAX_BYTES
    )
  );
}

function isInkEnd(value: Record<string, unknown>): value is Record<string, unknown> & StudioLiveInkEnd {
  return (
    hasExactKeys(value, END_KEYS) &&
    exactIdentifier(value.strokeId) &&
    isSafeIntegerRange(value.lastChunkSequence, 0, Number.MAX_SAFE_INTEGER) &&
    isSafeIntegerRange(value.totalActualSamples, 0, STUDIO_LIVE_INK_MAX_SAMPLES_PER_STROKE) &&
    typeof value.sampleHash === "string" &&
    SAMPLE_HASH_PATTERN.test(value.sampleHash) &&
    exactIdentifier(value.crdtStrokeId)
  );
}

function isInkCancel(value: Record<string, unknown>): value is Record<string, unknown> & StudioLiveInkCancel {
  return (
    hasExactKeys(value, CANCEL_KEYS) &&
    exactIdentifier(value.strokeId) &&
    typeof value.reason === "string" &&
    CANCEL_REASON_SET.has(value.reason)
  );
}

/**
 * Strictly validates one untrusted ink message. The chunk/prediction payload is fully decoded so
 * a successful parse also guarantees finite points, pressure 0..1, tilt −90..90°, twist 0..359°
 * and non-negative (hence monotonic) per-sample time deltas.
 */
export function parseStudioLiveInkMessage(value: unknown): StudioLiveInkMessage | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "ink:begin":
      return isInkBegin(value) ? (value as StudioLiveInkBegin) : null;
    case "ink:chunk":
      return isInkChunk(value) ? (value as StudioLiveInkChunk) : null;
    case "ink:prediction":
      return isInkPrediction(value) ? (value as StudioLiveInkPrediction) : null;
    case "ink:end":
      return isInkEnd(value) ? (value as StudioLiveInkEnd) : null;
    case "ink:cancel":
      return isInkCancel(value) ? (value as StudioLiveInkCancel) : null;
    default:
      return null;
  }
}

/** Cheap routing check for the binary lane; full validation follows in the wire parser. */
export function isStudioLiveInkWireCandidate(value: unknown): boolean {
  return isRecord(value) && value.wire === STUDIO_LIVE_INK_WIRE;
}

/**
 * Strictly validates one untrusted binary-lane frame. Cross-work, self-echoed, stale and
 * future-skewed frames are rejected before any per-stroke state can change.
 */
export function parseStudioLiveInkWireMessage(
  value: unknown,
  options: ParseStudioLiveInkWireMessageOptions
): StudioLiveInkWireMessage | null {
  if (!isRecord(value) || !hasExactKeys(value, WIRE_KEYS)) return null;
  if (
    value.wire !== STUDIO_LIVE_INK_WIRE ||
    value.wireVersion !== STUDIO_LIVE_INK_WIRE_VERSION ||
    !exactIdentifier(value.workId) ||
    value.workId !== options.expectedWorkId ||
    !exactIdentifier(value.senderSessionId) ||
    !isSafeIntegerRange(value.sentAt, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  const now = options.now ?? Date.now();
  if (
    value.sentAt < now - STUDIO_LIVE_MESSAGE_MAX_AGE_MS ||
    value.sentAt > now + STUDIO_LIVE_MESSAGE_FUTURE_SKEW_MS ||
    (options.selfSessionId != null && options.selfSessionId === value.senderSessionId)
  ) {
    return null;
  }
  if (parseStudioLiveInkMessage(value.message) === null) return null;
  return value as unknown as StudioLiveInkWireMessage;
}

export interface CreateStudioLiveInkWireMessageInput {
  workId: string;
  senderSessionId: string;
  sentAt: number;
  message: StudioLiveInkMessage;
}

/** Builds one frame and immediately re-parses it, so authoring bugs fail loud and closed. */
export function createStudioLiveInkWireMessage(
  input: CreateStudioLiveInkWireMessageInput
): StudioLiveInkWireMessage {
  const candidate: StudioLiveInkWireMessage = {
    wire: STUDIO_LIVE_INK_WIRE,
    wireVersion: STUDIO_LIVE_INK_WIRE_VERSION,
    workId: input.workId,
    senderSessionId: input.senderSessionId,
    sentAt: input.sentAt,
    message: input.message,
  };
  const parsed = parseStudioLiveInkWireMessage(candidate, {
    expectedWorkId: input.workId,
    now: input.sentAt,
  });
  if (!parsed) throw new StudioLiveInkProtocolError();
  return candidate;
}

interface ActiveInkStrokeState {
  nextChunkSequence: number;
  nextSampleIndex: number;
  lastPredictionSequence: number;
}

/**
 * Per-peer stroke lifecycle gate shared by the authoring and receiving sides. It enforces
 * begin-before-chunk, strictly `+1` chunk sequences, contiguous sample indices, per-stroke
 * sample caps, strictly increasing prediction sequences (gaps are legal — predictions may be
 * shed under backpressure) and exact end totals. `accept` returning false means fail closed:
 * refuse the send or drop the inbound message.
 */
export class StudioLiveInkStrokeTracker {
  private readonly active = new Map<string, ActiveInkStrokeState>();
  private readonly settled = new Set<string>();

  get activeStrokeCount(): number {
    return this.active.size;
  }

  clear(): void {
    this.active.clear();
    this.settled.clear();
  }

  accept(message: StudioLiveInkMessage): boolean {
    switch (message.kind) {
      case "ink:begin": {
        if (this.active.has(message.strokeId) || this.settled.has(message.strokeId)) return false;
        if (this.active.size >= STUDIO_LIVE_INK_MAX_ACTIVE_STROKES) return false;
        this.active.set(message.strokeId, {
          nextChunkSequence: 1,
          nextSampleIndex: 0,
          lastPredictionSequence: 0,
        });
        return true;
      }
      case "ink:chunk": {
        const state = this.active.get(message.strokeId);
        if (
          !state ||
          message.chunkSequence !== state.nextChunkSequence ||
          message.firstSampleIndex !== state.nextSampleIndex ||
          state.nextSampleIndex + message.sampleCount > STUDIO_LIVE_INK_MAX_SAMPLES_PER_STROKE
        ) {
          return false;
        }
        state.nextChunkSequence += 1;
        state.nextSampleIndex += message.sampleCount;
        return true;
      }
      case "ink:prediction": {
        const state = this.active.get(message.strokeId);
        if (
          !state ||
          message.predictionSequence <= state.lastPredictionSequence ||
          message.replacesFromSampleIndex > state.nextSampleIndex
        ) {
          return false;
        }
        state.lastPredictionSequence = message.predictionSequence;
        return true;
      }
      case "ink:end": {
        const state = this.active.get(message.strokeId);
        if (
          !state ||
          message.lastChunkSequence !== state.nextChunkSequence - 1 ||
          message.totalActualSamples !== state.nextSampleIndex
        ) {
          return false;
        }
        this.settle(message.strokeId);
        return true;
      }
      case "ink:cancel": {
        if (!this.active.has(message.strokeId)) return false;
        this.settle(message.strokeId);
        return true;
      }
    }
  }

  private settle(strokeId: string): void {
    this.active.delete(strokeId);
    this.settled.add(strokeId);
    if (this.settled.size <= MAX_SETTLED_STROKES) return;
    const oldest = this.settled.values().next().value;
    if (typeof oldest === "string") this.settled.delete(oldest);
  }
}
