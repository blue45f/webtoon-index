import {
  HysteresisPolicy,
  ProviderCostModel,
  RemoteKillSwitch,
  WinnerCache,
  createFuzzyNeighborhoodGate,
  runShadowComparison,
  type ShadowComparisonReport,
  type VisualEquivalenceGate,
  type WinnerCacheEntry,
} from "@toonspectrum/studio-engine-registry";

/**
 * V12 §5 runtime wiring — RUNTIME_RENDERER_TOURNAMENT + SHADOW_RENDERING.
 *
 * The tournament primitives (WinnerCache, ProviderCostModel, RemoteKillSwitch,
 * runShadowComparison) live in @toonspectrum/studio-engine-registry as pure
 * mechanisms. This module gives them a browser runtime without touching React:
 *
 * - winner decisions persist through an async TournamentPersistencePort.
 *   The product installs the SQLite/OPFS adapter; without it the runtime is
 *   explicitly memory-only and never opens localStorage/IndexedDB;
 * - hydration is a one-shot boot step (`hydrate()`); every synchronous
 *   observation path — selectFilterLane included — reads only the already-loaded
 *   in-memory state;
 * - cost samples come exclusively from real measurements (recordRenderSample
 *   drops invalid values instead of fabricating estimates);
 * - the remote kill switch is fed by injected config (default: nothing killed)
 *   and killing a provider also evicts its cached wins;
 * - shadow samples run through an injected idle scheduler and can only observe
 *   the production result, never change it (exceptions surface as
 *   report.error only);
 * - selectFilterLane projects the winner cache + kill switch into
 *   observation-only candidate evidence. Product filter and stroke execution
 *   never consume this ordering as a retry or provider-substitution path.
 *
 * Hot-path contract: everything here is pure functions or plain module state.
 * No React imports, no renders, no timers.
 */

/* ------------------------------------------------------------------ */
/* Persistence port — async, adapter-agnostic                          */
/* ------------------------------------------------------------------ */

/** Legacy key used only inside SQLite's kv table during structured-row migration. */
export const STUDIO_TOURNAMENT_WINNER_STORAGE_KEY =
  "toonspectrum-studio-v12-tournament-winners-v1";
export const STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION = 1;

export interface PersistedWinnerEntry extends WinnerCacheEntry {
  bucket: string;
  deviceHash: string;
}

export interface PersistedTournamentStateV1 {
  version: typeof STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION;
  entries: PersistedWinnerEntry[];
}

/**
 * Async persistence seam for tournament winner state. The product adapter is
 * SQLite/OPFS and is injected at boot. `load` resolves null when no valid row
 * exists; `save` rejects on write failure — the runtime converts that into a
 * calm false while exposing the adapter's non-durable status separately.
 */
export interface TournamentPersistencePort {
  load(): Promise<PersistedTournamentStateV1 | null>;
  save(state: PersistedTournamentStateV1): Promise<void>;
  /** Non-blocking durable sink for accepted real render samples. */
  recordSample?(sample: StudioTournamentRenderSampleEvent): void | Promise<void>;
  /** Current persistence truth. SQLite adapters update it after lazy open. */
  status?(): StudioTournamentPersistenceStatus;
}

export type TournamentPersistenceFactory = () => TournamentPersistencePort | null;

function isValidPersistedEntry(value: unknown): value is PersistedWinnerEntry {
  if (typeof value !== "object" || value === null) return false;
  const { bucket, deviceHash, providerId, expectedWarmMs, decidedAtSample } =
    value as Record<string, unknown>;
  return (
    typeof bucket === "string" &&
    bucket.length > 0 &&
    typeof deviceHash === "string" &&
    deviceHash.length > 0 &&
    typeof providerId === "string" &&
    providerId.length > 0 &&
    typeof expectedWarmMs === "number" &&
    Number.isFinite(expectedWarmMs) &&
    expectedWarmMs >= 0 &&
    typeof decidedAtSample === "number" &&
    Number.isFinite(decidedAtSample) &&
    decidedAtSample >= 0
  );
}

/**
 * Validates an untrusted payload (JSON, DB row, …) into persisted tournament
 * state. Foreign schema versions and malformed payloads resolve to null,
 * malformed entries are dropped — adapters share this instead of re-deriving
 * the schema. Never throws.
 */
export function parsePersistedTournamentState(
  payload: unknown,
): PersistedTournamentStateV1 | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { version, entries } = payload as { version?: unknown; entries?: unknown };
  if (version !== STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION) return null;
  if (!Array.isArray(entries)) return null;
  return {
    version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
    entries: entries.filter(isValidPersistedEntry).map((entry) => ({
      bucket: entry.bucket,
      deviceHash: entry.deviceHash,
      providerId: entry.providerId,
      expectedWarmMs: entry.expectedWarmMs,
      decidedAtSample: entry.decidedAtSample,
    })),
  };
}

export type StudioTournamentPersistenceMode =
  | "initializing-sqlite"
  | "sqlite-opfs"
  | "memory-only";

export interface StudioTournamentPersistenceStatus {
  mode: StudioTournamentPersistenceMode;
  durable: boolean;
  reason: string | null;
}

const MEMORY_ONLY_TOURNAMENT_STATUS: Readonly<StudioTournamentPersistenceStatus> =
  Object.freeze({
    mode: "memory-only",
    durable: false,
    reason: "SQLite/OPFS tournament persistence is not installed",
  });

/* ------------------------------------------------------------------ */
/* Default adapter injection point                                     */
/* ------------------------------------------------------------------ */

let defaultPersistenceFactory: TournamentPersistenceFactory | null = null;

/**
 * Boot-time injection point for the default persistence adapter: a richer
 * store (the SQLite/OPFS adapter in its own module) installs its factory here
 * and every runtime constructed afterwards without an explicit `persistence`
 * option uses it. `null` restores explicit memory-only operation.
 */
export function installDefaultTournamentPersistence(
  factory: TournamentPersistenceFactory | null,
): void {
  defaultPersistenceFactory = factory;
}

/** Resolves the installed SQLite adapter, or null for explicit memory-only mode. */
export function resolveDefaultTournamentPersistence(): TournamentPersistencePort | null {
  if (defaultPersistenceFactory) return defaultPersistenceFactory();
  return null;
}

/* ------------------------------------------------------------------ */
/* Device identity                                                     */
/* ------------------------------------------------------------------ */

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface StudioDeviceIdentity {
  userAgent?: string;
  hardwareConcurrency?: number;
  devicePixelRatio?: number;
}

/** Stable winner-cache partition key; deterministic for a given identity. */
export function computeStudioDeviceHash(identity?: StudioDeviceIdentity): string {
  const nav = (
    globalThis as {
      navigator?: { userAgent?: string; hardwareConcurrency?: number };
    }
  ).navigator;
  const userAgent = identity?.userAgent ?? nav?.userAgent ?? "ssr";
  const cores = identity?.hardwareConcurrency ?? nav?.hardwareConcurrency ?? 0;
  const dpr =
    identity?.devicePixelRatio ??
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio ??
    1;
  return fnv1a(`${userAgent}|c${cores}|d${dpr}`);
}

/* ------------------------------------------------------------------ */
/* Runtime — winner cache + cost model + kill switch, one seam         */
/* ------------------------------------------------------------------ */

export interface StudioTournamentKillEntry {
  providerId: string;
  reason: string;
}

/** One accepted real render measurement, as seen by recordRenderSample. */
export interface StudioTournamentRenderSampleEvent {
  providerId: string;
  bucket: string;
  ms: number;
}

export interface StudioMeasuredTournamentCandidate {
  providerId: string;
  /** Pixels produced by this provider for the exact same accepted request. */
  pixels: Uint8Array;
}

export interface StudioMeasuredTournamentRequest {
  bucket: string;
  width: number;
  height: number;
  referenceProviderId: string;
  /** Hard-bounded by evaluateMeasuredTournament to 2-3 candidates. */
  candidates: readonly StudioMeasuredTournamentCandidate[];
  /** A winner is never created or changed while a pen stroke owns the surface. */
  penDown?: boolean;
  gate?: VisualEquivalenceGate;
}

export type StudioMeasuredTournamentDecision =
  | "initial-winner"
  | "retained"
  | "hysteresis-hold"
  | "pen-down-hold"
  | "switched"
  | "insufficient-evidence";

export interface StudioMeasuredTournamentResult {
  decision: StudioMeasuredTournamentDecision;
  winnerId: string | null;
  changed: boolean;
  visual: Record<string, { pass: boolean; mismatchPct: number }>;
  expectedGainPct: number | null;
}

export interface StudioTournamentRuntimeOptions {
  /**
   * Persistence port. `undefined` = currently installed default adapter
   * (SQLite/OPFS when boot installed it, otherwise explicit memory-only);
   * `null` = in-memory only.
   */
  persistence?: TournamentPersistencePort | null;
  /** Injected remote kill config. Default: empty (nothing killed). */
  killList?: readonly StudioTournamentKillEntry[];
  deviceHash?: string;
  /**
   * Observer for samples the cost model accepted (e.g. the SQLite
   * cost_samples sink). Invalid samples are dropped before it fires, and
   * observer failures never affect the hot path or the recorded sample.
   */
  onRenderSample?: (sample: StudioTournamentRenderSampleEvent) => void;
}

export class StudioRendererTournamentRuntime {
  readonly winnerCache = new WinnerCache();
  readonly costModel = new ProviderCostModel();
  readonly killSwitch = new RemoteKillSwitch();
  readonly deviceHash: string;

  private readonly persistence: TournamentPersistencePort | null;
  private readonly persisted = new Map<string, PersistedWinnerEntry>();
  private readonly onRenderSample:
    | ((sample: StudioTournamentRenderSampleEvent) => void)
    | null;
  private hydration: Promise<boolean> | null = null;

  constructor(options?: StudioTournamentRuntimeOptions) {
    this.persistence =
      options?.persistence === undefined
        ? resolveDefaultTournamentPersistence()
        : options.persistence;
    this.onRenderSample = options?.onRenderSample ?? null;
    this.deviceHash = options?.deviceHash ?? computeStudioDeviceHash();
    const killList = options?.killList ?? [];
    for (const kill of killList) {
      this.applyKillList([kill.providerId], kill.reason);
    }
  }

  /** Observable persistence truth; callers never infer durability from hydrate(). */
  persistenceStatus(): StudioTournamentPersistenceStatus {
    if (!this.persistence) return { ...MEMORY_ONLY_TOURNAMENT_STATUS };
    return this.persistence.status?.() ?? {
      mode: "memory-only",
      durable: false,
      reason: "Tournament persistence adapter does not expose durable status",
    };
  }

  private static persistKey(bucket: string, deviceHash: string): string {
    return `${bucket}::${deviceHash}`;
  }

  /**
   * One-shot boot hydration: loads persisted winners into the in-memory cache
   * exactly once (repeat calls reuse the first load). Killed providers are
   * never resurrected, decisions recorded before the load resolved win over
   * stale disk state, and every load failure resolves false — never throws.
   */
  hydrate(): Promise<boolean> {
    this.hydration ??= this.hydrateOnce();
    return this.hydration;
  }

  private async hydrateOnce(): Promise<boolean> {
    if (!this.persistence) return false;
    let state: PersistedTournamentStateV1 | null;
    try {
      state = await this.persistence.load();
    } catch {
      return false;
    }
    if (!state) return false;
    let hydrated = false;
    for (const entry of state.entries) {
      // Ports are typed, but their bytes come from disk — revalidate.
      if (!isValidPersistedEntry(entry)) continue;
      if (this.killSwitch.isKilled(entry.providerId)) continue;
      if (this.winnerCache.get(entry.bucket, entry.deviceHash)) continue;
      this.persisted.set(
        StudioRendererTournamentRuntime.persistKey(entry.bucket, entry.deviceHash),
        entry,
      );
      this.winnerCache.set(entry.bucket, entry.deviceHash, {
        providerId: entry.providerId,
        expectedWarmMs: entry.expectedWarmMs,
        decidedAtSample: entry.decidedAtSample,
      });
      hydrated = true;
    }
    return hydrated;
  }

  /** Records a tournament decision in the cache and the persistable index. */
  recordWinner(bucket: string, deviceHash: string, entry: WinnerCacheEntry): void {
    this.winnerCache.set(bucket, deviceHash, entry);
    this.persisted.set(StudioRendererTournamentRuntime.persistKey(bucket, deviceHash), {
      bucket,
      deviceHash,
      ...entry,
    });
  }

  /**
   * Explicit persistence — the caller decides when (never a debounce inside
   * this module). Resolves false when there is no port or the adapter
   * rejected (quota, privacy mode, backend down); never throws.
   */
  async persist(): Promise<boolean> {
    if (!this.persistence) return false;
    const state: PersistedTournamentStateV1 = {
      version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
      entries: [...this.persisted.values()],
    };
    try {
      await this.persistence.save(state);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Accumulates one real warm-render measurement. Invalid values (NaN,
   * negative, Infinity) are dropped and reported as false — the cost model
   * only ever contains measurements, never fabricated estimates.
   */
  recordRenderSample(providerId: string, bucket: string, ms: number): boolean {
    if (!Number.isFinite(ms) || ms < 0) return false;
    this.costModel.record(providerId, bucket, { warmMs: ms });
    const sample = { providerId, bucket, ms };
    try {
      const pending = this.persistence?.recordSample?.(sample);
      if (pending) void Promise.resolve(pending).catch(() => undefined);
    } catch {
      // Durable telemetry never owns the render path.
    }
    if (this.onRenderSample) {
      try {
        this.onRenderSample(sample);
      } catch {
        // Observer hygiene never affects the hot path or the recorded sample.
      }
    }
    return true;
  }

  /**
   * Resolves a bounded product tournament from already-completed real renders.
   * Timing samples must have entered `recordRenderSample` first; this method
   * never invents a missing estimate and never invokes a renderer itself.
   */
  evaluateMeasuredTournament(
    request: StudioMeasuredTournamentRequest,
  ): StudioMeasuredTournamentResult {
    if (request.candidates.length < 2 || request.candidates.length > 3) {
      throw new RangeError("measured tournament requires 2-3 bounded candidates");
    }
    const unique = new Map(
      request.candidates.map((candidate) => [candidate.providerId, candidate]),
    );
    if (unique.size !== request.candidates.length) {
      throw new RangeError("measured tournament candidates must have unique providers");
    }
    const reference = unique.get(request.referenceProviderId);
    if (!reference) {
      throw new RangeError("measured tournament reference provider is missing");
    }
    const expectedBytes = request.width * request.height * 4;
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes <= 0 ||
      request.candidates.some((candidate) => candidate.pixels.byteLength !== expectedBytes)
    ) {
      throw new RangeError("measured tournament pixel dimensions are inconsistent");
    }

    const gate = request.gate ?? createFuzzyNeighborhoodGate();
    const visual = new Map<string, { pass: boolean; mismatchPct: number }>();
    visual.set(reference.providerId, { pass: true, mismatchPct: 0 });
    for (const candidate of request.candidates) {
      if (candidate.providerId === reference.providerId) continue;
      visual.set(
        candidate.providerId,
        gate(
          candidate.pixels,
          reference.pixels,
          request.width,
          request.height,
        ),
      );
    }

    const sampled = request.candidates.flatMap((candidate) => {
      if (this.killSwitch.isKilled(candidate.providerId)) return [];
      const estimate = this.costModel.estimate(candidate.providerId, request.bucket);
      if (estimate?.warmP50Ms === null || estimate?.warmP50Ms === undefined) return [];
      return [{ providerId: candidate.providerId, warmMs: estimate.warmP50Ms }];
    });
    // A one-sided sample is telemetry, not a tournament. At least two visual-
    // comparable providers must have real measurements before any winner changes.
    if (sampled.length < 2) {
      return {
        decision: "insufficient-evidence",
        winnerId: this.winnerCache.get(request.bucket, this.deviceHash)?.providerId ?? null,
        changed: false,
        visual: Object.fromEntries(visual),
        expectedGainPct: null,
      };
    }
    const measured = sampled.filter(
      (candidate) => visual.get(candidate.providerId)?.pass === true,
    );
    if (measured.length === 0) {
      return {
        decision: "insufficient-evidence",
        winnerId: this.winnerCache.get(request.bucket, this.deviceHash)?.providerId ?? null,
        changed: false,
        visual: Object.fromEntries(visual),
        expectedGainPct: null,
      };
    }

    const incumbent = this.winnerCache.get(request.bucket, this.deviceHash);
    if (request.penDown === true) {
      return {
        decision: "pen-down-hold",
        winnerId: incumbent?.providerId ?? null,
        changed: false,
        visual: Object.fromEntries(visual),
        expectedGainPct: null,
      };
    }
    const best = measured.reduce((winner, candidate) =>
      candidate.warmMs < winner.warmMs ? candidate : winner,
    );

    if (!incumbent) {
      this.recordWinner(request.bucket, this.deviceHash, {
        providerId: best.providerId,
        expectedWarmMs: best.warmMs,
        decidedAtSample: this.costModel.sampleCount(best.providerId, request.bucket),
      });
      return {
        decision: "initial-winner",
        winnerId: best.providerId,
        changed: true,
        visual: Object.fromEntries(visual),
        expectedGainPct: null,
      };
    }

    const measuredIncumbent = measured.find(
      (candidate) => candidate.providerId === incumbent.providerId,
    );
    if (!measuredIncumbent || best.providerId === incumbent.providerId) {
      return {
        decision: measuredIncumbent ? "retained" : "insufficient-evidence",
        winnerId: incumbent.providerId,
        changed: false,
        visual: Object.fromEntries(visual),
        expectedGainPct: null,
      };
    }
    const switchDecision = new HysteresisPolicy(12).evaluate({
      incumbentWarmMs: measuredIncumbent.warmMs,
      challengerWarmMs: best.warmMs,
      penDown: false,
    });
    if (!switchDecision.allow) {
      return {
        decision: "hysteresis-hold",
        winnerId: incumbent.providerId,
        changed: false,
        visual: Object.fromEntries(visual),
        expectedGainPct: switchDecision.expectedGainPct,
      };
    }
    this.recordWinner(request.bucket, this.deviceHash, {
      providerId: best.providerId,
      expectedWarmMs: best.warmMs,
      decidedAtSample: this.costModel.sampleCount(best.providerId, request.bucket),
    });
    return {
      decision: "switched",
      winnerId: best.providerId,
      changed: true,
      visual: Object.fromEntries(visual),
      expectedGainPct: switchDecision.expectedGainPct,
    };
  }

  /**
   * Applies an injected remote kill list: the providers leave candidacy
   * immediately and every cached win they hold (in-memory and persistable)
   * is evicted so a stale winner cannot resurrect them.
   */
  applyKillList(
    providerIds: readonly string[],
    reason: string,
  ): { killed: string[]; evictedWinners: number } {
    const killed: string[] = [];
    let evictedWinners = 0;
    for (const providerId of providerIds) {
      this.killSwitch.kill(providerId, reason);
      killed.push(providerId);
      evictedWinners += this.winnerCache.evictProvider(providerId);
      for (const [key, entry] of this.persisted) {
        if (entry.providerId === providerId) this.persisted.delete(key);
      }
    }
    return { killed, evictedWinners };
  }
}

export function createStudioTournamentRuntime(
  options?: StudioTournamentRuntimeOptions,
): StudioRendererTournamentRuntime {
  return new StudioRendererTournamentRuntime(options);
}

/* ------------------------------------------------------------------ */
/* Shared runtime instance (module state, no React)                    */
/* ------------------------------------------------------------------ */

let sharedRuntime: StudioRendererTournamentRuntime | null = null;

/**
 * Lazily constructed shared runtime used by the studio's real call paths.
 * First access kicks off the one-shot async hydration; synchronous callers
 * keep reading the in-memory state and pick up persisted winners once the
 * load resolves (boot hydration pattern — no await on any decision path).
 */
export function getStudioTournamentRuntime(): StudioRendererTournamentRuntime {
  if (!sharedRuntime) {
    sharedRuntime = createStudioTournamentRuntime();
    void sharedRuntime.hydrate();
  }
  return sharedRuntime;
}

/**
 * Non-creating, non-hydrating view of the shared runtime — null until
 * something has actually booted it.
 *
 * Decision paths that must stay free of I/O use this instead of
 * {@link getStudioTournamentRuntime}: creating the runtime kicks off
 * hydration, and hydration is what pulls the persistence adapter (and, with
 * the SQLite/OPFS adapter installed, its ~865 KB wasm) over the network. A
 * null runtime is not a correctness problem — an unbooted tournament has an
 * empty winner cache and nothing killed, which is exactly the neutral
 * observation state.
 */
export function peekStudioTournamentRuntime(): StudioRendererTournamentRuntime | null {
  return sharedRuntime;
}

/**
 * Replaces the shared runtime (e.g. boot code injecting a remote kill list,
 * or tests injecting fake persistence). `null` restores lazy default
 * creation. The caller owns hydration of an injected runtime.
 */
export function installStudioTournamentRuntime(
  runtime: StudioRendererTournamentRuntime | null,
): void {
  sharedRuntime = runtime;
}

/* ------------------------------------------------------------------ */
/* Shadow sampling runner                                              */
/* ------------------------------------------------------------------ */

/** Idle-callback-shaped scheduler; injected so tests control timing. */
export type ShadowSampleScheduler = (task: () => void) => void;

export interface ScheduleShadowSampleOptions {
  scheduler: ShadowSampleScheduler;
  winnerRender: () => Uint8Array | Promise<Uint8Array>;
  shadowRender: () => Uint8Array | Promise<Uint8Array>;
  width: number;
  height: number;
  onReport: (report: ShadowComparisonReport) => void;
  /** Defaults to the registry's fuzzy neighborhood gate. */
  gate?: VisualEquivalenceGate;
}

/**
 * Runs the production (winner) render immediately and returns its pixels by
 * reference, untouched. The shadow comparison is deferred onto the injected
 * scheduler and reuses runShadowComparison, so shadow work can only observe
 * the winner; every shadow-side exception surfaces exclusively as
 * `report.error` — never as a thrown error and never as a change to the
 * production result.
 */
export function scheduleShadowSample(
  options: ScheduleShadowSampleOptions,
): Promise<Uint8Array> {
  const gate = options.gate ?? createFuzzyNeighborhoodGate();
  const winnerPixels = Promise.resolve().then(options.winnerRender);
  options.scheduler(() => {
    runShadowComparison({
      // Reuses the already-started production render — no double render, and
      // the gate sees the exact same buffer the caller received.
      winnerRender: () => winnerPixels,
      shadowRender: options.shadowRender,
      gate,
      width: options.width,
      height: options.height,
      onReport: options.onReport,
    }).catch((error: unknown) => {
      // Reached only when the production render itself rejected (the caller
      // already sees that rejection through the returned promise); the shadow
      // side still reports instead of throwing.
      try {
        options.onReport({
          gate: null,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Observer hygiene never affects production output.
      }
    });
  });
  return winnerPixels;
}

/* ------------------------------------------------------------------ */
/* Candidate observation — never product execution authority           */
/* ------------------------------------------------------------------ */

export interface SelectFilterLaneInput<TLane extends string> {
  /** Observation candidates in their baseline evidence order. */
  lanes: readonly TLane[];
  bucket: string;
  deviceHash: string;
  winnerCache: WinnerCache;
  killSwitch: RemoteKillSwitch;
  laneProviderId: (lane: TLane) => string;
}

export interface SelectFilterLaneResult<TLane extends string> {
  /** Surviving observation candidates. Empty means no provider is available. */
  lanes: TLane[];
  /** Lanes whose providers are currently killed. */
  killedLanes: TLane[];
  /** Lane the winner cache moved (or confirmed) at the head, if any. */
  promotedLane: TLane | null;
  /** Explicit fail-closed outcome when every supplied provider is killed. */
  unavailableReason: "all-providers-killed" | null;
}

/**
 * Pure, observation-only projection of already-hydrated in-memory tournament
 * state onto a candidate list (no I/O, no awaits):
 * 1. killed providers leave the candidate set. If every supplied provider is
 *    killed, the result is empty and explicitly unavailable; no provider is
 *    resurrected;
 * 2. a cached winner for this bucket/device moves its lane to the head. A
 *    winner that is killed or not in the candidate set promotes nothing.
 * With an empty cache and no kills the input order is returned unchanged.
 */
export function selectFilterLane<TLane extends string>(
  input: SelectFilterLaneInput<TLane>,
): SelectFilterLaneResult<TLane> {
  const killedLanes = input.lanes.filter((lane) =>
    input.killSwitch.isKilled(input.laneProviderId(lane)),
  );
  let lanes = input.lanes.filter(
    (lane) => !input.killSwitch.isKilled(input.laneProviderId(lane)),
  );

  if (lanes.length === 0 && input.lanes.length > 0) {
    return {
      lanes: [],
      killedLanes,
      promotedLane: null,
      unavailableReason: "all-providers-killed",
    };
  }

  const winner = input.winnerCache.get(input.bucket, input.deviceHash);
  let promotedLane: TLane | null = null;
  if (winner) {
    const winnerLane = lanes.find(
      (lane) => input.laneProviderId(lane) === winner.providerId,
    );
    if (winnerLane !== undefined) {
      promotedLane = winnerLane;
      if (lanes[0] !== winnerLane) {
        lanes = [winnerLane, ...lanes.filter((lane) => lane !== winnerLane)];
      }
    }
  }

  return { lanes, killedLanes, promotedLane, unavailableReason: null };
}
