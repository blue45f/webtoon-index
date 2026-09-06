import {
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
  STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS,
  STUDIO_LIVE_GESTURE_PREVIEW_LIMITS,
  copyStudioLiveGesturePreviewPayload,
  parseStudioLiveGesturePreviewPayload,
  type StudioLiveGesturePreviewBase,
  type StudioLiveGesturePreviewOperation,
  type StudioLiveGesturePreviewPayload,
  type StudioLiveGesturePreviewRendererSnapshot,
  type StudioLiveGesturePreviewRetouch,
  type StudioLiveGesturePreviewSamples,
  type StudioLiveGesturePreviewShape,
} from "./studio-live-gesture-preview";

export const STUDIO_LIVE_GESTURE_PREVIEW_TTL_MS = 3_000;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_PEERS = 64;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_ACTIVE_GESTURES = 64;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_GESTURES_PER_PEER = 2;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_GESTURES = 64;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_SAMPLES =
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_TOMBSTONES = 128;
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_AUTHORITATIVE_WITNESSES = 128;

const STUDIO_LIVE_GESTURE_PREVIEW_PRUNE_INTERVAL_MS = 1_000;

type StudioLiveGesturePreviewVisiblePhase = "begin" | "append" | "replace" | "end";

export interface StudioLiveGesturePreviewSnapshotEntry {
  readonly key: string;
  readonly senderSessionId: string;
  readonly gestureId: string;
  readonly pageId: string;
  readonly seq: number;
  readonly lastPhase: StudioLiveGesturePreviewVisiblePhase;
  readonly operation: StudioLiveGesturePreviewOperation;
  readonly base?: StudioLiveGesturePreviewBase;
  readonly renderer?: StudioLiveGesturePreviewRendererSnapshot;
  readonly samples?: StudioLiveGesturePreviewSamples;
  readonly shape?: StudioLiveGesturePreviewShape;
  readonly retouch?: StudioLiveGesturePreviewRetouch;
  readonly sampleCount: number;
  readonly updatedAt: number;
}

export type StudioLiveGesturePreviewSnapshot = readonly StudioLiveGesturePreviewSnapshotEntry[];

export type StudioLiveGesturePreviewRejectReason =
  | "invalid-payload"
  | "invalid-sender"
  | "inactive-page"
  | "missing-begin"
  | "sequence"
  | "identity"
  | "unexpected-phase"
  | "unaligned-suffix"
  | "channel-schema"
  | "retouch-schema"
  | "sample-cap"
  | "peer-cap"
  | "gesture-cap"
  | "peer-gesture-cap";

export type StudioLiveGesturePreviewApplyResult =
  | { readonly status: "applied" }
  | { readonly status: "duplicate" }
  | {
      readonly status: "rejected";
      readonly reason: StudioLiveGesturePreviewRejectReason;
    };

export interface StudioLiveGesturePreviewStoreLimits {
  readonly maxPeers: number;
  readonly maxActiveGestures: number;
  readonly maxGesturesPerPeer: number;
  readonly maxSamplesPerGesture: number;
  readonly maxTotalSamples: number;
  readonly maxSettlingGestures: number;
  readonly maxSettlingSamples: number;
  readonly maxTombstones: number;
  readonly maxAuthoritativeWitnesses: number;
}

export interface StudioLiveGesturePreviewStoreScheduler {
  now(): number;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface StudioLiveGesturePreviewStoreOptions {
  /** Undefined accepts every page until the owner establishes a visible-page boundary. */
  readonly pageId?: string | null;
  readonly limits?: Partial<StudioLiveGesturePreviewStoreLimits>;
  readonly scheduler?: StudioLiveGesturePreviewStoreScheduler;
}

interface ActiveGesture {
  readonly snapshot: StudioLiveGesturePreviewSnapshotEntry;
  readonly lastPayloadFingerprint: string;
  readonly sampleChannelSchema: string | null;
}

interface GestureTombstone {
  readonly senderSessionId: string;
  readonly gestureId: string;
  readonly pageId: string;
  readonly seq: number;
  readonly payloadFingerprint: string;
  readonly updatedAt: number;
}

interface AuthoritativeProjectionWitness {
  readonly pageId: string;
  readonly gestureId: string;
  readonly senderSessionId: string | null;
  readonly updatedAt: number;
}

const EMPTY_GESTURE_PREVIEW_SNAPSHOT: StudioLiveGesturePreviewSnapshot = Object.freeze([]);

const DEFAULT_GESTURE_PREVIEW_LIMITS: StudioLiveGesturePreviewStoreLimits = Object.freeze({
  maxPeers: STUDIO_LIVE_GESTURE_PREVIEW_MAX_PEERS,
  maxActiveGestures: STUDIO_LIVE_GESTURE_PREVIEW_MAX_ACTIVE_GESTURES,
  maxGesturesPerPeer: STUDIO_LIVE_GESTURE_PREVIEW_MAX_GESTURES_PER_PEER,
  maxSamplesPerGesture: STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
  // A single malicious room cannot allocate the per-gesture maximum for every active peer.
  maxTotalSamples: STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
  maxSettlingGestures: STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_GESTURES,
  maxSettlingSamples: STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_SAMPLES,
  maxTombstones: STUDIO_LIVE_GESTURE_PREVIEW_MAX_TOMBSTONES,
  maxAuthoritativeWitnesses:
    STUDIO_LIVE_GESTURE_PREVIEW_MAX_AUTHORITATIVE_WITNESSES,
});

const DEFAULT_GESTURE_PREVIEW_SCHEDULER: StudioLiveGesturePreviewStoreScheduler = {
  now: () => Date.now(),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
  },
};

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(value ?? fallback)));
}

function resolveLimits(
  overrides: Partial<StudioLiveGesturePreviewStoreLimits> | undefined,
): StudioLiveGesturePreviewStoreLimits {
  const maxActiveGestures = boundedPositiveInteger(
    overrides?.maxActiveGestures,
    DEFAULT_GESTURE_PREVIEW_LIMITS.maxActiveGestures,
    STUDIO_LIVE_GESTURE_PREVIEW_MAX_ACTIVE_GESTURES,
  );
  const maxSamplesPerGesture = boundedPositiveInteger(
    overrides?.maxSamplesPerGesture,
    DEFAULT_GESTURE_PREVIEW_LIMITS.maxSamplesPerGesture,
    STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
  );
  return Object.freeze({
    maxPeers: boundedPositiveInteger(
      overrides?.maxPeers,
      DEFAULT_GESTURE_PREVIEW_LIMITS.maxPeers,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_PEERS,
    ),
    maxActiveGestures,
    maxGesturesPerPeer: boundedPositiveInteger(
      overrides?.maxGesturesPerPeer,
      DEFAULT_GESTURE_PREVIEW_LIMITS.maxGesturesPerPeer,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_GESTURES_PER_PEER,
    ),
    maxSamplesPerGesture,
    maxTotalSamples: boundedPositiveInteger(
      overrides?.maxTotalSamples,
      DEFAULT_GESTURE_PREVIEW_LIMITS.maxTotalSamples,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE * maxActiveGestures,
    ),
    maxSettlingGestures: boundedPositiveInteger(
      overrides?.maxSettlingGestures,
      DEFAULT_GESTURE_PREVIEW_LIMITS.maxSettlingGestures,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_GESTURES,
    ),
    maxSettlingSamples: boundedPositiveInteger(
      overrides?.maxSettlingSamples,
      DEFAULT_GESTURE_PREVIEW_LIMITS.maxSettlingSamples,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_SAMPLES,
    ),
    maxTombstones: boundedPositiveInteger(
      overrides?.maxTombstones,
      DEFAULT_GESTURE_PREVIEW_LIMITS.maxTombstones,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_TOMBSTONES,
    ),
    maxAuthoritativeWitnesses: boundedPositiveInteger(
      overrides?.maxAuthoritativeWitnesses,
      DEFAULT_GESTURE_PREVIEW_LIMITS.maxAuthoritativeWitnesses,
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_AUTHORITATIVE_WITNESSES,
    ),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJsonValue(child)]),
  );
}

function payloadFingerprint(payload: StudioLiveGesturePreviewPayload): string {
  return JSON.stringify(canonicalJsonValue(payload));
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 0x1f || (point >= 0x7f && point <= 0x9f)) return true;
  }
  return false;
}

function isSafePreviewIdentifier(value: string): boolean {
  return value.length > 0
    && value.length <= STUDIO_LIVE_GESTURE_PREVIEW_LIMITS.identifierLength
    && value === value.trim()
    && !containsControlCharacter(value);
}

export function studioLiveGesturePreviewKey(
  senderSessionId: string,
  gestureId: string,
): string {
  return `${senderSessionId.length}:${senderSessionId}${gestureId}`;
}

function authoritativeProjectionWitnessKey(pageId: string, gestureId: string): string {
  return `${pageId.length}:${pageId}${gestureId}`;
}

function sampleCount(samples: StudioLiveGesturePreviewSamples | undefined): number {
  return samples ? samples.points.length / 2 : 0;
}

function retouchSampleCount(retouch: StudioLiveGesturePreviewRetouch | undefined): number {
  return retouch ? retouch.points.length / 2 : 0;
}

function sampleChannelSchema(samples: StudioLiveGesturePreviewSamples): string {
  return STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS
    .filter((key) => samples[key] !== undefined)
    .join("|");
}

function appendSamples(
  current: StudioLiveGesturePreviewSamples | undefined,
  suffix: StudioLiveGesturePreviewSamples,
): StudioLiveGesturePreviewSamples {
  const next: Record<string, unknown> = {
    startIndex: 0,
    points: [...(current?.points ?? []), ...suffix.points],
  };
  for (const key of STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS) {
    const channel = suffix[key];
    if (channel === undefined) continue;
    next[key] = [...((current?.[key] as readonly number[] | undefined) ?? []), ...channel];
  }
  return deepFreeze(next as unknown as StudioLiveGesturePreviewSamples);
}

function sampleTimeSuffixIsMonotonic(
  current: StudioLiveGesturePreviewSamples | undefined,
  suffix: StudioLiveGesturePreviewSamples,
): boolean {
  const prior = current?.sampleTimeOffsets;
  const next = suffix.sampleTimeOffsets;
  if (!prior || prior.length === 0 || !next || next.length === 0) return true;
  return next[0]! >= prior[prior.length - 1]!;
}

function sameRetouchSchema(
  current: StudioLiveGesturePreviewRetouch,
  suffix: StudioLiveGesturePreviewRetouch,
): boolean {
  return current.tool === suffix.tool
    && current.radiusNorm === suffix.radiusNorm
    && current.strength === suffix.strength;
}

function appendRetouch(
  current: StudioLiveGesturePreviewRetouch | undefined,
  suffix: StudioLiveGesturePreviewRetouch,
): StudioLiveGesturePreviewRetouch {
  return deepFreeze({
    ...suffix,
    startIndex: 0,
    points: [...(current?.points ?? []), ...suffix.points],
  });
}

/**
 * Transport-neutral bounded reducer for ephemeral remote gesture previews.
 *
 * The store owns no React or room subscription. A future adapter may feed parsed transport events
 * into `apply`, reconcile presence/page boundaries, and use `subscribe/getSnapshot` as an external
 * store. Any sequence or suffix ambiguity removes the affected gesture instead of approximating it.
 */
export class StudioLiveGesturePreviewStore {
  private readonly active = new Map<string, ActiveGesture>();
  private readonly tombstones = new Map<string, GestureTombstone>();
  private readonly authoritativeWitnesses = new Map<
    string,
    AuthoritativeProjectionWitness
  >();
  private readonly listeners = new Set<() => void>();
  private readonly limits: StudioLiveGesturePreviewStoreLimits;
  private readonly scheduler: StudioLiveGesturePreviewStoreScheduler;
  private snapshot: StudioLiveGesturePreviewSnapshot = EMPTY_GESTURE_PREVIEW_SNAPSHOT;
  private pruneTimer: unknown = null;
  private activePageId: string | null | undefined;

  constructor(options: StudioLiveGesturePreviewStoreOptions = {}) {
    this.activePageId = options.pageId;
    this.limits = resolveLimits(options.limits);
    this.scheduler = options.scheduler ?? DEFAULT_GESTURE_PREVIEW_SCHEDULER;
  }

  readonly getSnapshot = (): StudioLiveGesturePreviewSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      if (this.pruneExpired(this.scheduler.now())) this.publishSnapshot();
      this.pruneTimer = this.scheduler.setInterval(
        () => {
          if (this.pruneExpired(this.scheduler.now())) this.publishSnapshot();
        },
        STUDIO_LIVE_GESTURE_PREVIEW_PRUNE_INTERVAL_MS,
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.pruneTimer !== null) {
        this.scheduler.clearInterval(this.pruneTimer);
        this.pruneTimer = null;
      }
    };
  };

  ingest(senderSessionId: string, value: unknown): StudioLiveGesturePreviewApplyResult {
    const payload = parseStudioLiveGesturePreviewPayload(value);
    if (!payload) return { status: "rejected", reason: "invalid-payload" };
    return this.apply(senderSessionId, payload);
  }

  apply(
    senderSessionId: string,
    input: StudioLiveGesturePreviewPayload,
  ): StudioLiveGesturePreviewApplyResult {
    if (!isSafePreviewIdentifier(senderSessionId)) {
      return { status: "rejected", reason: "invalid-sender" };
    }
    const now = this.scheduler.now();
    let visibleChanged = this.pruneExpired(now);
    const payload = deepFreeze(copyStudioLiveGesturePreviewPayload(input));
    const fingerprint = payloadFingerprint(payload);
    const key = studioLiveGesturePreviewKey(senderSessionId, payload.gestureId);
    const finish = (
      result: StudioLiveGesturePreviewApplyResult,
      changed = false,
    ): StudioLiveGesturePreviewApplyResult => {
      if (visibleChanged || changed) this.publishSnapshot();
      visibleChanged = false;
      return result;
    };
    const reject = (
      reason: StudioLiveGesturePreviewRejectReason,
    ): StudioLiveGesturePreviewApplyResult => {
      const changed = this.active.delete(key);
      this.clearMatchingAuthoritativeWitness(
        payload.pageId,
        payload.gestureId,
        senderSessionId,
      );
      this.addTombstone(key, {
        senderSessionId,
        gestureId: payload.gestureId,
        pageId: payload.pageId,
        seq: payload.seq,
        payloadFingerprint: fingerprint,
        updatedAt: now,
      });
      return finish({ status: "rejected", reason }, changed);
    };

    const current = this.active.get(key);
    const tombstone = this.tombstones.get(key);
    if (current) {
      // Old dual-route packets are harmless no-ops. In particular, they must not refresh the
      // active entry's TTL or replace its last-payload fingerprint.
      if (payload.seq < current.snapshot.seq) return finish({ status: "duplicate" });
      if (payload.seq === current.snapshot.seq) {
        return fingerprint === current.lastPayloadFingerprint
          ? finish({ status: "duplicate" })
          : reject("sequence");
      }
      if (payload.seq !== current.snapshot.seq + 1) return reject("sequence");
      if (
        payload.gestureId !== current.snapshot.gestureId
        || payload.pageId !== current.snapshot.pageId
        || payload.operation !== current.snapshot.operation
      ) return reject("identity");
      if (payload.phase === "begin") return reject("unexpected-phase");
      if (current.snapshot.lastPhase === "end") return reject("unexpected-phase");
    } else {
      if (tombstone) {
        if (
          payload.seq === tombstone.seq
          && fingerprint === tombstone.payloadFingerprint
        ) return finish({ status: "duplicate" });
        return finish({ status: "rejected", reason: "sequence" });
      }
      if (payload.phase !== "begin") return reject("missing-begin");
      if (payload.seq !== 1) return reject("sequence");
    }

    if (
      this.activePageId !== undefined
      && (this.activePageId === null || payload.pageId !== this.activePageId)
    ) return reject("inactive-page");

    if (payload.phase === "begin") {
      const witnessKey = authoritativeProjectionWitnessKey(
        payload.pageId,
        payload.gestureId,
      );
      const witness = this.authoritativeWitnesses.get(witnessKey);
      if (
        witness
        && (
          witness.senderSessionId === null
          || witness.senderSessionId === senderSessionId
        )
      ) {
        this.authoritativeWitnesses.delete(witnessKey);
        this.addTombstone(key, {
          senderSessionId,
          gestureId: payload.gestureId,
          pageId: payload.pageId,
          seq: payload.seq,
          payloadFingerprint: fingerprint,
          updatedAt: now,
        });
        return finish({ status: "applied" });
      }
      // Settling entries remain visible until an authoritative receipt, their own bounded budget,
      // or TTL cleanup retires them. They never consume active-gesture caps.
      const activeGestures = [...this.active.values()].filter(
        (gesture) => gesture.snapshot.lastPhase !== "end",
      );
      const senderAlreadyActive = activeGestures.some(
        (gesture) => gesture.snapshot.senderSessionId === senderSessionId,
      );
      const activeSenderCount = new Set(
        activeGestures.map((gesture) => gesture.snapshot.senderSessionId),
      ).size;
      if (!senderAlreadyActive && activeSenderCount >= this.limits.maxPeers) {
        return reject("peer-cap");
      }
      if (activeGestures.length >= this.limits.maxActiveGestures) {
        return reject("gesture-cap");
      }
      if (
        activeGestures.filter(
          (gesture) => gesture.snapshot.senderSessionId === senderSessionId,
        ).length >= this.limits.maxGesturesPerPeer
      ) {
        return reject("peer-gesture-cap");
      }
      if (payload.samples && payload.samples.startIndex !== 0) {
        return reject("unaligned-suffix");
      }
      if (payload.retouch && payload.retouch.startIndex !== 0) {
        return reject("unaligned-suffix");
      }
      const count = sampleCount(payload.samples) + retouchSampleCount(payload.retouch);
      if (!this.samplesFit(0, count)) return reject("sample-cap");
      const snapshot = deepFreeze({
        key,
        senderSessionId,
        gestureId: payload.gestureId,
        pageId: payload.pageId,
        seq: payload.seq,
        lastPhase: "begin" as const,
        operation: payload.operation,
        ...(payload.base ? { base: payload.base } : {}),
        ...(payload.renderer ? { renderer: payload.renderer } : {}),
        ...(payload.samples ? { samples: payload.samples } : {}),
        ...(payload.shape ? { shape: payload.shape } : {}),
        ...(payload.retouch ? { retouch: payload.retouch } : {}),
        sampleCount: count,
        updatedAt: now,
      });
      this.active.set(key, {
        snapshot,
        lastPayloadFingerprint: fingerprint,
        sampleChannelSchema: payload.samples ? sampleChannelSchema(payload.samples) : null,
      });
      return finish({ status: "applied" }, true);
    }

    if (!current) return reject("missing-begin");

    if (payload.phase === "append") {
      if (payload.samples) {
        if (current.snapshot.shape || current.snapshot.retouch) return reject("identity");
        if (payload.samples.startIndex !== current.snapshot.sampleCount) {
          return reject("unaligned-suffix");
        }
        const schema = sampleChannelSchema(payload.samples);
        if (
          current.sampleChannelSchema !== null
          && schema !== current.sampleChannelSchema
        ) return reject("channel-schema");
        if (!sampleTimeSuffixIsMonotonic(current.snapshot.samples, payload.samples)) {
          return reject("unaligned-suffix");
        }
        const nextCount = current.snapshot.sampleCount + sampleCount(payload.samples);
        if (!this.samplesFit(current.snapshot.sampleCount, nextCount)) {
          return reject("sample-cap");
        }
        const samples = appendSamples(current.snapshot.samples, payload.samples);
        const snapshot = deepFreeze({
          ...current.snapshot,
          seq: payload.seq,
          lastPhase: "append" as const,
          samples,
          sampleCount: nextCount,
          updatedAt: now,
        });
        this.active.set(key, {
          snapshot,
          lastPayloadFingerprint: fingerprint,
          sampleChannelSchema: current.sampleChannelSchema ?? schema,
        });
        return finish({ status: "applied" }, true);
      }

      if (payload.retouch) {
        if (current.snapshot.shape || current.snapshot.samples) return reject("identity");
        if (payload.retouch.startIndex !== current.snapshot.sampleCount) {
          return reject("unaligned-suffix");
        }
        if (
          current.snapshot.retouch
          && !sameRetouchSchema(current.snapshot.retouch, payload.retouch)
        ) return reject("retouch-schema");
        const nextCount = current.snapshot.sampleCount + retouchSampleCount(payload.retouch);
        if (!this.samplesFit(current.snapshot.sampleCount, nextCount)) {
          return reject("sample-cap");
        }
        const retouch = appendRetouch(current.snapshot.retouch, payload.retouch);
        const snapshot = deepFreeze({
          ...current.snapshot,
          seq: payload.seq,
          lastPhase: "append" as const,
          retouch,
          sampleCount: nextCount,
          updatedAt: now,
        });
        this.active.set(key, {
          snapshot,
          lastPayloadFingerprint: fingerprint,
          sampleChannelSchema: null,
        });
        return finish({ status: "applied" }, true);
      }

      return reject("unexpected-phase");
    }

    if (payload.phase === "replace") {
      if (!payload.shape || !current.snapshot.shape) return reject("unexpected-phase");
      if (payload.shape.kind !== current.snapshot.shape.kind) return reject("identity");
      const snapshot = deepFreeze({
        ...current.snapshot,
        seq: payload.seq,
        lastPhase: "replace" as const,
        shape: payload.shape,
        updatedAt: now,
      });
      this.active.set(key, {
        snapshot,
        lastPayloadFingerprint: fingerprint,
        sampleChannelSchema: null,
      });
      return finish({ status: "applied" }, true);
    }

    if (payload.phase === "end") {
      const witnessKey = authoritativeProjectionWitnessKey(
        payload.pageId,
        payload.gestureId,
      );
      const witness = this.authoritativeWitnesses.get(witnessKey);
      const authoritativeAlreadyProjected = Boolean(
        witness
        && (
          witness.senderSessionId === null
          || witness.senderSessionId === senderSessionId
        ),
      );
      if (authoritativeAlreadyProjected || !this.makeSettlingRoom(
        current.snapshot.sampleCount,
        now,
      )) {
        if (authoritativeAlreadyProjected) this.authoritativeWitnesses.delete(witnessKey);
        this.active.delete(key);
        this.addTombstone(key, {
          senderSessionId,
          gestureId: payload.gestureId,
          pageId: payload.pageId,
          seq: payload.seq,
          payloadFingerprint: fingerprint,
          updatedAt: now,
        });
        return finish({ status: "applied" }, true);
      }
      const snapshot = deepFreeze({
        ...current.snapshot,
        seq: payload.seq,
        lastPhase: "end" as const,
        updatedAt: now,
      });
      this.active.set(key, {
        snapshot,
        lastPayloadFingerprint: fingerprint,
        sampleChannelSchema: current.sampleChannelSchema,
      });
      return finish({ status: "applied" }, true);
    }

    this.active.delete(key);
    this.clearMatchingAuthoritativeWitness(
      payload.pageId,
      payload.gestureId,
      senderSessionId,
    );
    this.addTombstone(key, {
      senderSessionId,
      gestureId: payload.gestureId,
      pageId: payload.pageId,
      seq: payload.seq,
      payloadFingerprint: fingerprint,
      updatedAt: now,
    });
    return finish({ status: "applied" }, true);
  }

  /**
   * Records that the authoritative projection for a preview id has reached the retained layer.
   * The adapter must call this only for an id it correlated to an eligible preview begin.
   */
  markAuthoritativeProjection(pageId: string, gestureId: string): boolean {
    if (
      !isSafePreviewIdentifier(pageId)
      || !isSafePreviewIdentifier(gestureId)
      || (
        this.activePageId !== undefined
        && (this.activePageId === null || this.activePageId !== pageId)
      )
    ) return false;

    const now = this.scheduler.now();
    const expiredVisible = this.pruneExpired(now);
    const matching = [...this.active.entries()].filter(
      ([, gesture]) => gesture.snapshot.pageId === pageId
        && gesture.snapshot.gestureId === gestureId,
    );
    const witnessKey = authoritativeProjectionWitnessKey(pageId, gestureId);

    if (matching.length > 0) {
      // Once the authoritative slot is actually painted, keeping either an active or terminal
      // source-over preview would double its alpha (and an eraser would destination-out twice).
      this.retireGestures(matching, now);
      this.authoritativeWitnesses.delete(witnessKey);
    } else {
      const alreadyTombstoned = [...this.tombstones.values()].some(
        (tombstone) => tombstone.pageId === pageId && tombstone.gestureId === gestureId,
      );
      if (alreadyTombstoned) {
        this.authoritativeWitnesses.delete(witnessKey);
      } else {
        // Commit-before-preview delivery is possible on dual transport routes. Keep only a short,
        // bounded witness so a later end can retire without a blank speculative handoff.
        this.addAuthoritativeWitness(witnessKey, {
          pageId,
          gestureId,
          senderSessionId: null,
          updatedAt: now,
        });
      }
    }

    if (expiredVisible || matching.length > 0) this.publishSnapshot();
    return true;
  }

  /** Drops previews and tombstones for peers no longer present in the room. */
  retainPresentSenders(senderSessionIds: Iterable<string>): number {
    const retained = new Set(senderSessionIds);
    let removed = 0;
    for (const [key, gesture] of this.active) {
      if (retained.has(gesture.snapshot.senderSessionId)) continue;
      this.active.delete(key);
      removed += 1;
    }
    for (const [key, tombstone] of this.tombstones) {
      if (!retained.has(tombstone.senderSessionId)) this.tombstones.delete(key);
    }
    for (const [key, witness] of this.authoritativeWitnesses) {
      if (
        witness.senderSessionId !== null
          ? !retained.has(witness.senderSessionId)
          : retained.size === 0
      ) this.authoritativeWitnesses.delete(key);
    }
    if (removed > 0) this.publishSnapshot();
    return removed;
  }

  /** Clears stale-page previews atomically when the viewport follows another page. */
  setActivePage(pageId: string | null): number {
    if (this.activePageId === pageId) return 0;
    this.activePageId = pageId;
    let removed = 0;
    for (const [key, gesture] of this.active) {
      if (pageId !== null && gesture.snapshot.pageId === pageId) continue;
      this.active.delete(key);
      removed += 1;
    }
    for (const [key, tombstone] of this.tombstones) {
      if (pageId !== null && tombstone.pageId === pageId) continue;
      this.tombstones.delete(key);
    }
    for (const [key, witness] of this.authoritativeWitnesses) {
      if (pageId !== null && witness.pageId === pageId) continue;
      this.authoritativeWitnesses.delete(key);
    }
    if (removed > 0) this.publishSnapshot();
    return removed;
  }

  /** A non-ready transport cannot keep destructive or paint previews on screen. */
  clearForTransportLoss(): number {
    const removed = this.active.size;
    this.active.clear();
    this.tombstones.clear();
    this.authoritativeWitnesses.clear();
    if (removed > 0) this.publishSnapshot();
    return removed;
  }

  dispose(): void {
    if (this.pruneTimer !== null) this.scheduler.clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    this.listeners.clear();
    this.active.clear();
    this.tombstones.clear();
    this.authoritativeWitnesses.clear();
    this.snapshot = EMPTY_GESTURE_PREVIEW_SNAPSHOT;
  }

  private samplesFit(
    currentGestureSamples: number,
    nextGestureSamples: number,
  ): boolean {
    if (nextGestureSamples > this.limits.maxSamplesPerGesture) return false;
    let total = 0;
    for (const gesture of this.active.values()) {
      if (gesture.snapshot.lastPhase !== "end") total += gesture.snapshot.sampleCount;
    }
    return total - currentGestureSamples + nextGestureSamples
      <= this.limits.maxTotalSamples;
  }

  private makeSettlingRoom(nextGestureSamples: number, now: number): boolean {
    if (nextGestureSamples > this.limits.maxSettlingSamples) return false;
    const settling = [...this.active.entries()]
      .filter(([, gesture]) => gesture.snapshot.lastPhase === "end")
      .sort(([leftKey, left], [rightKey, right]) => (
        left.snapshot.updatedAt - right.snapshot.updatedAt
        || leftKey.localeCompare(rightKey)
      ));
    let total = settling.reduce(
      (sum, [, gesture]) => sum + gesture.snapshot.sampleCount,
      0,
    );
    while (
      settling.length >= this.limits.maxSettlingGestures
      || total + nextGestureSamples > this.limits.maxSettlingSamples
    ) {
      const oldest = settling.shift();
      if (!oldest) return false;
      total -= oldest[1].snapshot.sampleCount;
      this.retireGestures([oldest], now);
    }
    return true;
  }

  private retireGestures(
    gestures: readonly (readonly [string, ActiveGesture])[],
    now: number,
  ): void {
    for (const [key, gesture] of gestures) {
      this.active.delete(key);
      this.addTombstone(key, {
        senderSessionId: gesture.snapshot.senderSessionId,
        gestureId: gesture.snapshot.gestureId,
        pageId: gesture.snapshot.pageId,
        seq: gesture.snapshot.seq,
        payloadFingerprint: gesture.lastPayloadFingerprint,
        updatedAt: now,
      });
    }
  }

  private addAuthoritativeWitness(
    key: string,
    witness: AuthoritativeProjectionWitness,
  ): void {
    this.authoritativeWitnesses.delete(key);
    this.authoritativeWitnesses.set(key, witness);
    while (this.authoritativeWitnesses.size > this.limits.maxAuthoritativeWitnesses) {
      const oldestKey = this.authoritativeWitnesses.keys().next().value as
        | string
        | undefined;
      if (oldestKey === undefined) break;
      this.authoritativeWitnesses.delete(oldestKey);
    }
  }

  private clearMatchingAuthoritativeWitness(
    pageId: string,
    gestureId: string,
    senderSessionId: string,
  ): void {
    const key = authoritativeProjectionWitnessKey(pageId, gestureId);
    const witness = this.authoritativeWitnesses.get(key);
    if (
      witness
      && (
        witness.senderSessionId === null
        || witness.senderSessionId === senderSessionId
      )
    ) this.authoritativeWitnesses.delete(key);
  }

  private addTombstone(key: string, tombstone: GestureTombstone): void {
    this.tombstones.delete(key);
    this.tombstones.set(key, tombstone);
    while (this.tombstones.size > this.limits.maxTombstones) {
      const oldestKey = this.tombstones.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.tombstones.delete(oldestKey);
    }
  }

  private pruneExpired(now: number): boolean {
    let changed = false;
    for (const [key, gesture] of this.active) {
      if (now - gesture.snapshot.updatedAt <= STUDIO_LIVE_GESTURE_PREVIEW_TTL_MS) continue;
      this.active.delete(key);
      this.addTombstone(key, {
        senderSessionId: gesture.snapshot.senderSessionId,
        gestureId: gesture.snapshot.gestureId,
        pageId: gesture.snapshot.pageId,
        seq: gesture.snapshot.seq,
        payloadFingerprint: gesture.lastPayloadFingerprint,
        updatedAt: now,
      });
      changed = true;
    }
    for (const [key, tombstone] of this.tombstones) {
      if (now - tombstone.updatedAt > STUDIO_LIVE_GESTURE_PREVIEW_TTL_MS) {
        this.tombstones.delete(key);
      }
    }
    for (const [key, witness] of this.authoritativeWitnesses) {
      if (now - witness.updatedAt > STUDIO_LIVE_GESTURE_PREVIEW_TTL_MS) {
        this.authoritativeWitnesses.delete(key);
      }
    }
    return changed;
  }

  private publishSnapshot(): void {
    this.snapshot = this.active.size === 0
      ? EMPTY_GESTURE_PREVIEW_SNAPSHOT
      : Object.freeze([...this.active.values()].map((gesture) => gesture.snapshot));
    for (const listener of [...this.listeners]) listener();
  }
}
