import { sha256HexPortable } from "./studio-sha256";

/**
 * Document-open leader discipline for the Studio autosave document key.
 *
 * The durable journal already fences *writes* with an OPFS writer lease, but that lease is only
 * taken at the first checkpoint. Between opening a manuscript and its first autosave, two tabs on
 * the same origin believe they both own the document, and the loser silently forks into the second
 * persistence authority. This module moves the decision to document-open time using the Web Locks
 * API, which the browser releases automatically when a tab is destroyed — so a closed leader always
 * yields, and no expiry sweep of our own is needed.
 *
 * Rules encoded here:
 *  - The first tab to open a document key holds an exclusive Web Lock for as long as it stays open.
 *  - A later tab becomes a **follower**. It never steals leadership from a live leader, because the
 *    leader may hold unsaved work.
 *  - A follower queues a normal (blocking) lock request. It is granted only once the leader
 *    releases, which is exactly the hand-over the yield rule asks for.
 *  - Repeated opens of the same key inside one tab join the existing record by reference count.
 *    A tab must never contend with itself (React effect re-runs and key changes overlap the old and
 *    new session), otherwise a single tab would demote itself to read-only against its own document.
 */

export type StudioAutosaveDocumentRole = "leader" | "follower";

/** Why this tab leads. `uncontended` means the Web Locks API could not arbitrate. */
export type StudioAutosaveDocumentLeadershipBasis =
  | "web-lock"
  | "promoted-after-handover"
  | "locks-unavailable";

export interface StudioAutosaveDocumentLockManagerLike {
  request<T>(
    name: string,
    options: {
      readonly mode: "exclusive";
      readonly ifAvailable?: boolean;
      readonly signal?: AbortSignal;
    },
    callback: (lock: unknown) => T | PromiseLike<T>,
  ): Promise<T>;
}

export interface StudioAutosaveDocumentLease {
  readonly documentKey: string;
  readonly lockName: string;
  /** Live role. A follower flips to `leader` only after the previous leader released. */
  readonly role: StudioAutosaveDocumentRole;
  readonly basis: StudioAutosaveDocumentLeadershipBasis;
  /**
   * Resolves `true` once this tab holds leadership. Already-leading leases resolve immediately.
   * A `timeoutMs` of `0` polls the current state without waiting.
   */
  waitForLeadership(options?: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<boolean>;
  release(): Promise<void>;
}

export type StudioAutosaveDocumentLeadershipRegistry = Map<string, LeadershipRecord>;

const LOCK_NAME_PREFIX = "toonspectrum-studio-autosave-document";
const TEXT_ENCODER = new TextEncoder();

/**
 * The lock name is derived from a digest so the manuscript identity (user id, work id) never
 * appears in an origin-wide, enumerable Web Locks name. It is deliberately distinct from the
 * journal's `toonspectrum-opfs-recovery:` lock: this one is held for the whole tab lifetime, the
 * journal lock is short-lived, and they are always acquired in that order (document then journal),
 * so the nesting cannot deadlock.
 */
export function studioAutosaveDocumentLockName(autosaveKey: string): string {
  const digest = sha256HexPortable(TEXT_ENCODER.encode(autosaveKey));
  return `${LOCK_NAME_PREFIX}:${digest.slice(0, 48)}`;
}

interface LeadershipRecord {
  readonly lockName: string;
  role: StudioAutosaveDocumentRole;
  basis: StudioAutosaveDocumentLeadershipBasis;
  refCount: number;
  /** Settles the held-lock callback, which is what actually releases the Web Lock. */
  releaseHeldLock: (() => void) | null;
  /** Aborts the queued promotion request of a follower. */
  promotionAbort: AbortController | null;
  promotion: Promise<boolean>;
  resolvePromotion: (promoted: boolean) => void;
  registry: StudioAutosaveDocumentLeadershipRegistry;
}

const defaultRegistry: StudioAutosaveDocumentLeadershipRegistry = new Map();

/**
 * Same-tab overlapping opens (React effect re-run, Strict Mode, key change) must not race the
 * Web Lock. The registry only helps after the first attempt has written it; this gate covers the
 * window before that write so one tab cannot demote itself to a follower of its own request.
 */
const inflightByRegistry = new WeakMap<
  StudioAutosaveDocumentLeadershipRegistry,
  Map<string, Promise<StudioAutosaveDocumentLease>>
>();

function inflightFor(
  registry: StudioAutosaveDocumentLeadershipRegistry,
): Map<string, Promise<StudioAutosaveDocumentLease>> {
  let inflight = inflightByRegistry.get(registry);
  if (!inflight) {
    inflight = new Map();
    inflightByRegistry.set(registry, inflight);
  }
  return inflight;
}

/** Test seam: an isolated realm registry so specs do not share one tab-wide leadership map. */
export function createStudioAutosaveDocumentLeadershipRegistry():
StudioAutosaveDocumentLeadershipRegistry {
  return new Map();
}

type LockAttempt =
  | Readonly<{ outcome: "held"; release: () => void }>
  | Readonly<{ outcome: "unavailable" }>
  | Readonly<{ outcome: "failed"; cause: unknown }>;

/**
 * Takes the lock without ever awaiting `request()` itself — the returned promise only settles when
 * the callback settles, and the callback is intentionally held open for the tab's lifetime.
 */
function attemptExclusiveLock(
  locks: StudioAutosaveDocumentLockManagerLike,
  lockName: string,
): Promise<LockAttempt> {
  return new Promise<LockAttempt>((resolve) => {
    let settled = false;
    const settle = (attempt: LockAttempt): void => {
      if (settled) return;
      settled = true;
      resolve(attempt);
    };
    let releaseHeldLock: (() => void) | null = null;
    const held = new Promise<void>((resolveHeld) => {
      releaseHeldLock = () => resolveHeld();
    });
    void Promise.resolve(
      locks.request(lockName, { mode: "exclusive", ifAvailable: true }, (lock) => {
        if (lock === null || lock === undefined) {
          settle({ outcome: "unavailable" });
          return undefined;
        }
        settle({ outcome: "held", release: releaseHeldLock! });
        return held;
      }),
    ).then(
      () => settle({ outcome: "unavailable" }),
      (cause: unknown) => settle({ outcome: "failed", cause }),
    );
  });
}

/**
 * Queues a blocking request. It is granted only when the current leader releases, so a follower can
 * inherit the document without ever preempting live, possibly unsaved, work in the leading tab.
 */
function queuePromotion(
  locks: StudioAutosaveDocumentLockManagerLike,
  record: LeadershipRecord,
): void {
  const controller = new AbortController();
  record.promotionAbort = controller;
  void Promise.resolve(
    locks.request(
      record.lockName,
      { mode: "exclusive", signal: controller.signal },
      (lock) => {
        if (lock === null || lock === undefined) return undefined;
        const held = new Promise<void>((resolveHeld) => {
          record.releaseHeldLock = () => resolveHeld();
        });
        record.role = "leader";
        record.basis = "promoted-after-handover";
        record.promotionAbort = null;
        record.resolvePromotion(true);
        return held;
      },
    ),
  ).catch(() => {
    // An aborted or denied promotion simply leaves this tab a follower; the reload path in the
    // follower notice stays the artist's way forward.
  });
}

function createLease(record: LeadershipRecord, documentKey: string): StudioAutosaveDocumentLease {
  let released = false;
  return Object.freeze({
    documentKey,
    lockName: record.lockName,
    get role(): StudioAutosaveDocumentRole {
      return record.role;
    },
    get basis(): StudioAutosaveDocumentLeadershipBasis {
      return record.basis;
    },
    async waitForLeadership(options: {
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    } = {}): Promise<boolean> {
      if (record.role === "leader") return true;
      const timeoutMs = options.timeoutMs;
      if (timeoutMs === 0) return false;
      if (timeoutMs === undefined && options.signal === undefined) return record.promotion;
      return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let done = false;
        const finish = (value: boolean): void => {
          if (done) return;
          done = true;
          if (timer !== null) clearTimeout(timer);
          resolve(value);
        };
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => finish(record.role === "leader"), timeoutMs);
        }
        options.signal?.addEventListener("abort", () => finish(record.role === "leader"), {
          once: true,
        });
        void record.promotion.then((promoted) => finish(promoted));
      });
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      record.refCount -= 1;
      if (record.refCount > 0) return;
      record.registry.delete(record.lockName);
      record.promotionAbort?.abort();
      record.promotionAbort = null;
      record.releaseHeldLock?.();
      record.releaseHeldLock = null;
      record.resolvePromotion(false);
      // Yield to the microtask queue so a queued follower observes the release before the caller
      // continues — a same-tick re-open would otherwise race its own hand-over.
      await Promise.resolve();
    },
  });
}

function adoptRecord(
  record: LeadershipRecord,
  documentKey: string,
): StudioAutosaveDocumentLease {
  record.refCount += 1;
  return createLease(record, documentKey);
}

/**
 * Requests document leadership for `autosaveKey`.
 *
 * When the Web Locks API is missing the tab is reported as leader on the `locks-unavailable` basis:
 * this module must never make an environment worse than it already is, and the OPFS writer lease
 * still fences the actual checkpoint writes there.
 */
export async function requestStudioAutosaveDocumentLeadership(input: {
  readonly autosaveKey: string;
  readonly locks: StudioAutosaveDocumentLockManagerLike | null | undefined;
  readonly registry?: StudioAutosaveDocumentLeadershipRegistry;
}): Promise<StudioAutosaveDocumentLease> {
  if (input.autosaveKey.trim().length === 0) {
    throw new Error("자동저장 문서 leader 식별자가 비어 있습니다.");
  }
  const registry = input.registry ?? defaultRegistry;
  const lockName = studioAutosaveDocumentLockName(input.autosaveKey);
  const existing = registry.get(lockName);
  if (existing) return adoptRecord(existing, input.autosaveKey);

  const inflight = inflightFor(registry);
  const pending = inflight.get(lockName);
  if (pending) {
    try {
      await pending;
    } catch {
      // The in-flight open failed; this caller still needs its own attempt.
    }
    const after = registry.get(lockName);
    if (after) return adoptRecord(after, input.autosaveKey);
  }

  let settleInflight: (lease: StudioAutosaveDocumentLease) => void = () => undefined;
  let failInflight: (cause: unknown) => void = () => undefined;
  const gate = new Promise<StudioAutosaveDocumentLease>((resolve, reject) => {
    settleInflight = resolve;
    failInflight = reject;
  });
  inflight.set(lockName, gate);
  try {
    const lease = await acquireStudioAutosaveDocumentLeadership({
      autosaveKey: input.autosaveKey,
      locks: input.locks,
      registry,
      lockName,
    });
    settleInflight(lease);
    return lease;
  } catch (cause) {
    failInflight(cause);
    throw cause;
  } finally {
    if (inflight.get(lockName) === gate) inflight.delete(lockName);
  }
}

async function acquireStudioAutosaveDocumentLeadership(input: {
  readonly autosaveKey: string;
  readonly locks: StudioAutosaveDocumentLockManagerLike | null | undefined;
  readonly registry: StudioAutosaveDocumentLeadershipRegistry;
  readonly lockName: string;
}): Promise<StudioAutosaveDocumentLease> {
  const { registry, lockName } = input;
  const existing = registry.get(lockName);
  if (existing) return adoptRecord(existing, input.autosaveKey);

  let resolvePromotion: (promoted: boolean) => void = () => undefined;
  const promotion = new Promise<boolean>((resolve) => {
    resolvePromotion = resolve;
  });
  const record: LeadershipRecord = {
    lockName,
    role: "leader",
    basis: "locks-unavailable",
    refCount: 1,
    releaseHeldLock: null,
    promotionAbort: null,
    promotion,
    resolvePromotion,
    registry,
  };

  const locks = input.locks;
  if (!locks || typeof locks.request !== "function") {
    registry.set(lockName, record);
    resolvePromotion(true);
    return createLease(record, input.autosaveKey);
  }

  const attempt = await attemptExclusiveLock(locks, lockName);
  if (attempt.outcome === "held") {
    record.role = "leader";
    record.basis = "web-lock";
    record.releaseHeldLock = attempt.release;
    registry.set(lockName, record);
    resolvePromotion(true);
    return createLease(record, input.autosaveKey);
  }
  if (attempt.outcome === "failed") {
    registry.set(lockName, record);
    resolvePromotion(true);
    return createLease(record, input.autosaveKey);
  }
  record.role = "follower";
  record.basis = "web-lock";
  registry.set(lockName, record);
  queuePromotion(locks, record);
  return createLease(record, input.autosaveKey);
}

export interface StudioAutosaveDocumentLeadershipNotice {
  readonly tone: "good" | "warn";
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string | null;
  /** True only when this tab may persist. Save-safety chrome must not claim green otherwise. */
  readonly canPersist: boolean;
  /**
   * Persist leadership never fences the in-memory / CRDT drawing path. A second tab must still
   * be able to apply a local stroke while the first tab owns OPFS/SQLite.
   */
  readonly canDraw: boolean;
}

/**
 * Copy for the follower notice. Deliberately explicit: a silent read-only demotion is what let the
 * artist keep drawing into a tab whose strokes were never stored.
 */
export function presentStudioAutosaveDocumentLeadership(
  lease: Pick<StudioAutosaveDocumentLease, "role" | "basis">,
  options: { liveJam?: boolean } = {},
): StudioAutosaveDocumentLeadershipNotice {
  if (lease.role === "leader") {
    return Object.freeze({
      tone: "good" as const,
      title: "이 탭이 원고를 저장합니다",
      detail: options.liveJam
        ? "다른 탭에서도 바로 같이 그릴 수 있습니다. 이 탭이 이 기기 저장을 맡습니다."
        : "같은 원고를 연 다른 탭은 읽기 전용으로 열립니다.",
      actionLabel: null,
      canPersist: true,
      canDraw: true,
    });
  }
  if (options.liveJam) {
    return Object.freeze({
      tone: "good" as const,
      title: "다른 탭과 같이 그리는 중입니다",
      detail:
        "이 탭에서도 바로 그릴 수 있습니다. 커서와 획은 실시간으로 맞춰지고, 이 기기 저장은 먼저 연 탭이 맡습니다.",
      actionLabel: null,
      canPersist: false,
      canDraw: true,
    });
  }
  return Object.freeze({
    tone: "warn" as const,
    title: "이 원고는 다른 탭에서 편집 중입니다",
    detail:
      "먼저 연 탭이 저장을 맡고 있어 이 탭에서 그린 내용은 저장되지 않습니다."
      + " 먼저 연 탭을 닫은 뒤 새로고침하면 이 탭에서 이어서 편집할 수 있습니다.",
    actionLabel: "새로고침으로 다시 확인",
    canPersist: false,
    canDraw: true,
  });
}

/**
 * Persist leadership fences OPFS/SQLite only. Followers still apply local CRDT/document edits.
 */
export function studioAutosaveLeadershipAllowsLocalEdit(
  lease: Pick<StudioAutosaveDocumentLease, "role" | "basis"> | null,
): boolean {
  if (!lease) return true;
  return presentStudioAutosaveDocumentLeadership(lease, { liveJam: true }).canDraw;
}
