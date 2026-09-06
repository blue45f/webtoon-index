import {
  isStudioLiveCursorCleared,
  type StudioLiveEnvelope,
} from "./studio-live-collaboration-protocol";
import {
  createStudioLocalLiveTransport,
  type StudioLiveTransport,
  type StudioLiveTransportContext,
  type StudioLiveTransportFactory,
} from "./studio-live-collaboration-transport";
import {
  clearStudioLiveCursorQuality,
  publishStudioLiveCursorQuality,
  resolveStudioLiveCursorCadence,
  type StudioLiveCursorCadencePlan,
  type StudioLiveCursorNetworkProfile,
} from "./studio-live-cursor-quality";

export const STUDIO_LIVE_CURSOR_CAPTURE_INTERVAL_MS = 16;
export const STUDIO_LIVE_CURSOR_DIAGNOSTICS_INTERVAL_MS = 1_000;

type StudioCursorEnvelope = StudioLiveEnvelope<"cursor:update">;

export interface StudioAdaptiveCursorTransportDependencies {
  readonly baseFactory?: StudioLiveTransportFactory;
  readonly getPeerCount?: () => number;
  readonly getVisibility?: () => "visible" | "hidden";
  readonly getNetworkProfile?: () => StudioLiveCursorNetworkProfile;
  readonly now?: () => number;
  readonly setTimeout?: (handler: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly diagnosticsIntervalMs?: number;
}

interface StudioAdaptiveCursorCounters {
  acceptedCount: number;
  sentCount: number;
  coalescedCount: number;
  compactedCount: number;
  failedCount: number;
}

function defaultVisibility(): "visible" | "hidden" {
  return typeof document !== "undefined" && document.visibilityState === "hidden"
    ? "hidden"
    : "visible";
}

function defaultNetworkProfile(): StudioLiveCursorNetworkProfile {
  if (typeof navigator === "undefined") {
    return { saveData: false, effectiveType: null };
  }
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return {
    saveData: connection?.saveData === true,
    effectiveType:
      typeof connection?.effectiveType === "string"
        ? connection.effectiveType
        : null,
  };
}

function boundedDiagnosticsInterval(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return STUDIO_LIVE_CURSOR_DIAGNOSTICS_INTERVAL_MS;
  }
  return Math.min(10_000, Math.max(100, Math.round(value)));
}

function cursorEnvelope(value: StudioLiveEnvelope): StudioCursorEnvelope | null {
  return value.kind === "cursor:update" ? (value as StudioCursorEnvelope) : null;
}

function compactCursorEnvelope(
  envelope: StudioCursorEnvelope,
  plan: StudioLiveCursorCadencePlan,
): { envelope: StudioCursorEnvelope; compacted: boolean } {
  if (!plan.compactPoints || !envelope.payload.points?.length) {
    return { envelope, compacted: false };
  }
  return {
    envelope: {
      ...envelope,
      payload: {
        ...envelope.payload,
        points: undefined,
      },
    },
    compacted: true,
  };
}

/**
 * Decorates either the authenticated server transport or the local BroadcastChannel transport.
 * Only disposable cursor envelopes are scheduled here; presence, locks, chat, voice, signaling,
 * durable CRDT updates, and binary ink preserve the original authority path and ordering.
 */
class StudioAdaptiveCursorTransport implements StudioLiveTransport {
  readonly mode: StudioLiveTransport["mode"];
  readonly crdtFanout?: StudioLiveTransport["crdtFanout"];
  readonly canonicalSessionId?: StudioLiveTransport["canonicalSessionId"];
  readonly transportSessionId?: StudioLiveTransport["transportSessionId"];
  readonly subscribeControl?: StudioLiveTransport["subscribeControl"];
  readonly acquireLock?: StudioLiveTransport["acquireLock"];
  readonly releaseLock?: StudioLiveTransport["releaseLock"];
  readonly requestCrdtSync?: StudioLiveTransport["requestCrdtSync"];
  readonly respondCrdtSync?: StudioLiveTransport["respondCrdtSync"];
  readonly publishCrdtUpdate?: StudioLiveTransport["publishCrdtUpdate"];
  readonly subscribeCrdt?: StudioLiveTransport["subscribeCrdt"];
  readonly sendInk?: StudioLiveTransport["sendInk"];
  readonly subscribeInk?: StudioLiveTransport["subscribeInk"];

  private readonly workId: string;
  private readonly inner: StudioLiveTransport;
  private readonly getPeerCount: () => number;
  private readonly getVisibility: () => "visible" | "hidden";
  private readonly getNetworkProfile: () => StudioLiveCursorNetworkProfile;
  private readonly now: () => number;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly diagnosticsIntervalMs: number;
  private readonly counters: StudioAdaptiveCursorCounters = {
    acceptedCount: 0,
    sentCount: 0,
    coalescedCount: 0,
    compactedCount: 0,
    failedCount: 0,
  };

  private pendingCursor: StudioCursorEnvelope | null = null;
  private pendingTimer: unknown = null;
  private pendingDueAt: number | null = null;
  private lastCursorSentAt = Number.NEGATIVE_INFINITY;
  private lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
  private lastDiagnosticsPlanKey = "none";
  private lastPlan: StudioLiveCursorCadencePlan | null = null;
  private closed = false;

  constructor(
    context: StudioLiveTransportContext,
    inner: StudioLiveTransport,
    dependencies: StudioAdaptiveCursorTransportDependencies,
  ) {
    this.workId = context.workId;
    this.inner = inner;
    this.mode = inner.mode;
    this.crdtFanout = inner.crdtFanout;
    this.canonicalSessionId = inner.canonicalSessionId?.bind(inner);
    this.transportSessionId = inner.transportSessionId?.bind(inner);
    this.subscribeControl = inner.subscribeControl?.bind(inner);
    this.acquireLock = inner.acquireLock?.bind(inner);
    this.releaseLock = inner.releaseLock?.bind(inner);
    this.requestCrdtSync = inner.requestCrdtSync?.bind(inner);
    this.respondCrdtSync = inner.respondCrdtSync?.bind(inner);
    this.publishCrdtUpdate = inner.publishCrdtUpdate?.bind(inner);
    this.subscribeCrdt = inner.subscribeCrdt?.bind(inner);
    this.sendInk = inner.sendInk?.bind(inner);
    this.subscribeInk = inner.subscribeInk?.bind(inner);
    this.getPeerCount = dependencies.getPeerCount ?? (() => 0);
    this.getVisibility = dependencies.getVisibility ?? defaultVisibility;
    this.getNetworkProfile = dependencies.getNetworkProfile ?? defaultNetworkProfile;
    this.now = dependencies.now ?? Date.now;
    this.scheduleTimeout =
      dependencies.setTimeout
      ?? ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout =
      dependencies.clearTimeout
      ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.diagnosticsIntervalMs = boundedDiagnosticsInterval(
      dependencies.diagnosticsIntervalMs,
    );
  }

  get ready(): boolean {
    return !this.closed && this.inner.ready;
  }

  get binaryLaneCapabilities(): readonly string[] | undefined {
    return this.inner.binaryLaneCapabilities;
  }

  connect(): Promise<void> {
    return this.inner.connect();
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.ready) return false;
    const cursor = cursorEnvelope(envelope);
    if (!cursor) {
      // Envelope sequences are monotonic per sender. A delayed cursor must cross the wire before a
      // later non-cursor sequence, or be discarded, so receivers never reject it as stale replay.
      this.flushPendingCursor("barrier");
      return this.inner.send(envelope);
    }

    this.counters.acceptedCount += 1;
    if (isStudioLiveCursorCleared(cursor.payload)) {
      this.dropPendingCursor();
      const sent = this.sendCursorNow(cursor, this.resolvePlan(cursor), false);
      this.emitDiagnostics(true);
      return sent;
    }

    const plan = this.resolvePlan(cursor);
    const now = this.now();
    if (
      this.pendingCursor === null
      && now - this.lastCursorSentAt >= plan.cadenceMs
    ) {
      const sent = this.sendCursorNow(cursor, plan, true);
      this.emitDiagnostics(sent === false);
      return sent || this.pendingCursor !== null;
    }

    if (this.pendingCursor) this.counters.coalescedCount += 1;
    this.pendingCursor = cursor;
    this.lastPlan = plan;
    this.schedulePendingCursor(plan, now);
    this.emitDiagnostics();
    return true;
  }

  subscribe(listener: (value: unknown) => void): () => void {
    return this.inner.subscribe(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dropPendingCursor();
    clearStudioLiveCursorQuality(this.workId);
    this.inner.close();
  }

  private resolvePlan(envelope: StudioCursorEnvelope): StudioLiveCursorCadencePlan {
    return resolveStudioLiveCursorCadence({
      drawing: envelope.payload.drawing === true,
      peerCount: this.getPeerCount(),
      visibility: this.getVisibility(),
      network: this.getNetworkProfile(),
    });
  }

  private schedulePendingCursor(
    plan: StudioLiveCursorCadencePlan,
    now = this.now(),
    minimumDelayMs = 0,
  ): void {
    const notBefore = now + Math.max(0, minimumDelayMs);
    const dueAt = Number.isFinite(this.lastCursorSentAt)
      ? Math.max(notBefore, this.lastCursorSentAt + plan.cadenceMs)
      : Math.max(notBefore, now + plan.cadenceMs);
    if (this.pendingTimer !== null && this.pendingDueAt === dueAt) return;
    if (this.pendingTimer !== null) this.cancelTimeout(this.pendingTimer);
    this.pendingDueAt = dueAt;
    this.pendingTimer = this.scheduleTimeout(() => {
      this.pendingTimer = null;
      this.pendingDueAt = null;
      this.flushPendingCursor("timer");
    }, Math.max(0, dueAt - now));
  }

  private flushPendingCursor(reason: "timer" | "barrier"): boolean {
    if (this.pendingTimer !== null) {
      this.cancelTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingDueAt = null;
    }
    const pending = this.pendingCursor;
    this.pendingCursor = null;
    if (!pending) return true;
    if (!this.ready) {
      this.counters.failedCount += 1;
      this.emitDiagnostics(true);
      return false;
    }
    const plan = this.resolvePlan(pending);
    const sent = this.sendCursorNow(pending, plan, reason === "timer");
    if (!sent && reason === "barrier") {
      // A later durable/control sequence is about to be sent. Retrying this older disposable
      // cursor afterwards would violate receiver replay protection, so fail closed and drop it.
      this.pendingCursor = null;
      this.emitDiagnostics(true);
    }
    return sent;
  }

  private sendCursorNow(
    envelope: StudioCursorEnvelope,
    plan: StudioLiveCursorCadencePlan,
    retryOnFailure: boolean,
  ): boolean {
    this.lastPlan = plan;
    const prepared = compactCursorEnvelope(envelope, plan);
    if (prepared.compacted) this.counters.compactedCount += 1;
    const sent = this.inner.send(prepared.envelope);
    if (sent) {
      this.lastCursorSentAt = this.now();
      this.counters.sentCount += 1;
      return true;
    }

    this.counters.failedCount += 1;
    if (
      retryOnFailure
      && this.ready
      && !isStudioLiveCursorCleared(envelope.payload)
    ) {
      this.pendingCursor = envelope;
      this.schedulePendingCursor(plan, this.now(), plan.cadenceMs);
    }
    return false;
  }

  private dropPendingCursor(): void {
    if (this.pendingTimer !== null) this.cancelTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pendingDueAt = null;
    this.pendingCursor = null;
  }

  private emitDiagnostics(force = false): void {
    const plan = this.lastPlan;
    if (!plan) return;
    const now = this.now();
    const planKey = getCadenceKey(plan);
    const cadenceChanged = planKey !== this.lastDiagnosticsPlanKey;
    if (
      !force
      && !cadenceChanged
      && now - this.lastDiagnosticsAt < this.diagnosticsIntervalMs
    ) return;
    this.lastDiagnosticsAt = now;
    this.lastDiagnosticsPlanKey = planKey;
    publishStudioLiveCursorQuality({
      workId: this.workId,
      ...plan,
      peerCount: boundedPeerCount(this.getPeerCount()),
      pending: this.pendingCursor !== null,
      ...this.counters,
      updatedAt: now,
    });
  }
}

function boundedPeerCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function getCadenceKey(plan: StudioLiveCursorCadencePlan | null): string {
  return plan
    ? `${plan.cadenceMs}:${plan.tier}:${plan.reason}:${plan.compactPoints ? 1 : 0}`
    : "none";
}

export function createStudioAdaptiveCursorTransportFactory(
  dependencies: StudioAdaptiveCursorTransportDependencies = {},
): StudioLiveTransportFactory {
  const baseFactory = dependencies.baseFactory ?? createStudioLocalLiveTransport;
  return (context) => new StudioAdaptiveCursorTransport(
    context,
    baseFactory(context),
    dependencies,
  );
}
