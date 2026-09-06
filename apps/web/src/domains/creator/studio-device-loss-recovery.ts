import { studioStrokeRouteProviderId } from "./brush/studio-stroke-route-tournament";
import { studioFilterLaneProviderId } from "./filter/studio-filter-island-plan";
import {
  getStudioTournamentRuntime,
  type StudioRendererTournamentRuntime,
} from "./studio-renderer-tournament-runtime";

import type { WinnerCacheEntry } from "@toonspectrum/studio-engine-registry";

/**
 * V12 §17.3 Device Loss — pure, injection-only recovery state machine.
 *
 * On a real `GPUDevice.lost` resolution this module drives, in order:
 * 1. discard signal for in-flight GPU work (`device_epoch` invalidation —
 *    §17.3 "GPU resource는 device_epoch로 표시");
 * 2. immediate unavailable notice for the already-selected GPU provider;
 * 3. no tournament mutation and no alternate-provider selection by default;
 * 4. exponential-backoff device re-acquisition on the injected clock. Success
 *    revives the killed providers (restoring their snapshotted winner-cache
 *    entries only when a legacy caller explicitly injects the tournament adapter) and hands back every
 *    command staged during the outage. Repeated losses feed a permanent
 *    demotion counter: at the threshold (default 3) the machine parks in
 *    `permanently-demoted` and the GPU family stays killed for the session.
 *
 * State machine: healthy → lost → retrying → recovered | permanently-demoted.
 * `recovered` behaves as healthy for subsequent losses.
 *
 * No silent loss: staged commands are always surfaced (onRecover on revival,
 * onDemote on permanent demotion, the return value of dispose()) — never
 * dropped inside this module. Callback exceptions are contained so a broken
 * observer can never stall the recovery loop itself.
 *
 * Hot-path contract: no React, no timers of its own (clock injected), no I/O.
 * The GPU fabric (studio-gpu-fabric.ts, separate slice) wires the listener; it
 * only needs `observe(device)` / `dispose()` plus the injected callbacks.
 */

/* ------------------------------------------------------------------ */
/* Injected surfaces                                                   */
/* ------------------------------------------------------------------ */

/** Structural slice of GPUDevice this module needs — nothing else. */
export interface StudioGpuDeviceLike {
  readonly lost: PromiseLike<{ reason?: unknown; message?: unknown } | undefined>;
}

/** Injected clock: deterministic in tests, wall clock + setTimeout in prod. */
export interface StudioDeviceLossClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface StudioDeviceLossBackoff {
  /** Delay before the first re-acquisition attempt. */
  readonly initialDelayMs: number;
  /** Exponential growth factor between attempts. */
  readonly factor: number;
  /** Ceiling for any single delay. */
  readonly maxDelayMs: number;
  /** Attempts before the machine gives up permanently. */
  readonly maxAttempts: number;
}

export const STUDIO_DEVICE_LOSS_DEFAULT_BACKOFF: StudioDeviceLossBackoff =
  Object.freeze({
    initialDelayMs: 250,
    factor: 2,
    maxDelayMs: 4_000,
    maxAttempts: 6,
  });

/** §17.3 재로스 반복 임계 — at this many losses the demotion is permanent. */
export const STUDIO_DEVICE_LOSS_PERMANENT_THRESHOLD = 3;

/**
 * Delay before re-acquisition attempt `attempt` (1-based):
 * initial · factor^(attempt-1), capped at maxDelayMs. Non-positive/invalid
 * attempts clamp to the first delay — total and deterministic.
 */
export function studioDeviceLossBackoffDelayMs(
  backoff: StudioDeviceLossBackoff,
  attempt: number,
): number {
  const step =
    Number.isFinite(attempt) && attempt > 1 ? Math.floor(attempt) - 1 : 0;
  return Math.min(backoff.maxDelayMs, backoff.initialDelayMs * backoff.factor ** step);
}

/* ------------------------------------------------------------------ */
/* Tournament port — applyKillList reuse behind an injectable seam     */
/* ------------------------------------------------------------------ */

/**
 * Legacy availability-mirroring seam for the renderer tournament. Product recovery uses the
 * no-substitution port below; explicit migration/diagnostic callers may inject an adapter.
 */
export interface StudioDeviceLossTournamentPort {
  /** ② Temporary kill of the GPU-family providers (idempotent per loss). */
  killGpuProviders(reason: string): void;
  /** Revive after a successful re-acquisition; restores snapshotted winners. */
  reviveGpuProviders(): void;
  /** Terminal kill — providers stay out, winner evictions stay. */
  permanentlyDemoteGpuProviders(reason: string): void;
}

/**
 * Default no-substitution port. Device recovery may retry the same provider, but it must not
 * alter tournament state in a way that silently selects CPU/Worker/Canvas for a later operation.
 * The tournament adapter below remains opt-in for diagnostic and legacy migrations only.
 */
export const STUDIO_DEVICE_LOSS_NO_FALLBACK_TOURNAMENT_PORT:
  StudioDeviceLossTournamentPort = Object.freeze({
  killGpuProviders: () => undefined,
  reviveGpuProviders: () => undefined,
  permanentlyDemoteGpuProviders: () => undefined,
});

/**
 * GPU-family tournament provider ids known today: the filter island's
 * gpu-chain lane and the WebGPU stroke surfaces (gpu, living-ink). The list
 * is a default, not a registry — callers with more providers inject their own.
 */
export const STUDIO_GPU_FAMILY_PROVIDER_IDS: readonly string[] = Object.freeze([
  studioFilterLaneProviderId("gpu-chain"),
  studioStrokeRouteProviderId("gpu"),
  studioStrokeRouteProviderId("living-ink"),
]);

/** Winner-cache key a snapshot can be taken for (bucket × device hash). */
export interface StudioTournamentWinnerKey {
  readonly bucket: string;
  readonly deviceHash: string;
}

export interface StudioTournamentDeviceLossPortOptions {
  /** Defaults to the shared runtime (getStudioTournamentRuntime). */
  runtime?: StudioRendererTournamentRuntime;
  /** Defaults to STUDIO_GPU_FAMILY_PROVIDER_IDS. */
  gpuProviderIds?: readonly string[];
  /**
   * Winner-cache keys to snapshot before the kill (applyKillList evicts the
   * killed providers' wins). Snapshotted GPU wins are restored on revive so a
   * transient device loss does not erase tournament conclusions. Without this
   * the revive still works — the GPU family just re-wins from scratch.
   */
  winnerKeys?: () => readonly StudioTournamentWinnerKey[];
}

interface SnapshottedWinner extends StudioTournamentWinnerKey {
  readonly entry: WinnerCacheEntry;
}

/**
 * Default adapter: projects the port onto StudioRendererTournamentRuntime.
 * Kill goes through `applyKillList` (kills + evicts cached wins); revive goes
 * through the kill switch and re-records the snapshotted winners.
 */
export function createStudioTournamentDeviceLossPort(
  options?: StudioTournamentDeviceLossPortOptions,
): StudioDeviceLossTournamentPort {
  const gpuProviderIds = options?.gpuProviderIds ?? STUDIO_GPU_FAMILY_PROVIDER_IDS;
  const resolveRuntime = (): StudioRendererTournamentRuntime =>
    options?.runtime ?? getStudioTournamentRuntime();
  let snapshot: SnapshottedWinner[] = [];

  const snapshotGpuWinners = (runtime: StudioRendererTournamentRuntime): void => {
    if (!options?.winnerKeys) return;
    const gpuIds = new Set(gpuProviderIds);
    const taken: SnapshottedWinner[] = [];
    for (const key of options.winnerKeys()) {
      const entry = runtime.winnerCache.get(key.bucket, key.deviceHash);
      if (entry && gpuIds.has(entry.providerId)) {
        taken.push({ bucket: key.bucket, deviceHash: key.deviceHash, entry });
      }
    }
    // A repeat loss while already killed sees no cached GPU wins; keep the
    // snapshot from the first kill instead of overwriting it with nothing.
    if (taken.length > 0) snapshot = taken;
  };

  return {
    killGpuProviders: (reason) => {
      const runtime = resolveRuntime();
      snapshotGpuWinners(runtime);
      runtime.applyKillList(gpuProviderIds, reason);
    },
    reviveGpuProviders: () => {
      const runtime = resolveRuntime();
      for (const providerId of gpuProviderIds) {
        runtime.killSwitch.revive(providerId);
      }
      for (const winner of snapshot) {
        runtime.recordWinner(winner.bucket, winner.deviceHash, winner.entry);
      }
      snapshot = [];
    },
    permanentlyDemoteGpuProviders: (reason) => {
      snapshot = [];
      resolveRuntime().applyKillList(gpuProviderIds, reason);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type StudioDeviceLossState =
  | "healthy"
  | "lost"
  | "retrying"
  | "recovered"
  | "permanently-demoted";

/** ① In-flight GPU results carrying `invalidatedEpoch` must be discarded. */
export interface StudioDeviceLossDiscardEvent {
  readonly invalidatedEpoch: number;
  readonly reason: string;
}

export interface StudioDeviceLossDemotionEvent<TCommand = unknown> {
  readonly state: "lost" | "permanently-demoted";
  readonly permanent: boolean;
  readonly reason: string;
  readonly lossCount: number;
  /**
   * Commands staged during the outage. Non-empty only on permanent demotion
   * (a successful recovery drains them through onRecover instead). The host
   * may preserve or explicitly retry them; this event never authorizes another
   * provider to replay them.
   */
  readonly stagedCommands: readonly TCommand[];
}

export interface StudioDeviceLossRecoveryEvent<
  TCommand = unknown,
  TDevice extends StudioGpuDeviceLike = StudioGpuDeviceLike,
> {
  readonly device: TDevice;
  /** Re-acquisition attempts consumed for this recovery (1-based count). */
  readonly attempts: number;
  /** Injected-clock time from loss detection to recovery. */
  readonly elapsedMs: number;
  readonly lossCount: number;
  /** Fresh epoch — resources built before it are invalid (§17.3). */
  readonly deviceEpoch: number;
  /** CPU staging queue drained for replay on the revived device (§17.3). */
  readonly stagedCommands: readonly TCommand[];
}

/* ------------------------------------------------------------------ */
/* Recovery machine                                                    */
/* ------------------------------------------------------------------ */

export interface StudioDeviceLossRecoveryOptions<
  TCommand = unknown,
  TDevice extends StudioGpuDeviceLike = StudioGpuDeviceLike,
> {
  /** Compatibility callback name: announces selected-provider unavailability only. */
  onDemote: (event: StudioDeviceLossDemotionEvent<TCommand>) => void;
  /** ④ Revive notice after successful backoff re-acquisition. */
  onRecover: (event: StudioDeviceLossRecoveryEvent<TCommand, TDevice>) => void;
  clock: StudioDeviceLossClock;
  /**
   * Device re-acquisition attempt. Resolving null (or rejecting) counts as a
   * failed attempt and continues the backoff. Defaults to
   * navigator.gpu.requestAdapter → requestDevice.
   */
  requestDevice?: (context: {
    lossCount: number;
    attempt: number;
  }) => Promise<TDevice | null>;
  /** ① In-flight result discard signal. Optional but strongly recommended. */
  onDiscardInFlight?: (event: StudioDeviceLossDiscardEvent) => void;
  /**
   * Defaults to a no-op, no-substitution port. The legacy tournament adapter is opt-in and must
   * not be used by product renderer bindings.
   */
  tournament?: StudioDeviceLossTournamentPort;
  backoff?: Partial<StudioDeviceLossBackoff>;
  /** Losses before permanent demotion. Default 3 (§17.3 임계). */
  permanentDemotionThreshold?: number;
}

export interface StudioDeviceLossRecovery<
  TCommand = unknown,
  TDevice extends StudioGpuDeviceLike = StudioGpuDeviceLike,
> {
  /**
   * Subscribes the device's `lost` promise and returns the new device epoch.
   * During an outage an externally acquired device completes the recovery
   * (revive + staged drain) exactly like an internal re-acquisition.
   * Inert while permanently demoted; throws after dispose().
   */
  observe(device: TDevice): number;
  state(): StudioDeviceLossState;
  currentEpoch(): number;
  /** True only when `epoch` is the live epoch and no outage is in progress. */
  isEpochCurrent(epoch: number): boolean;
  lossCount(): number;
  /**
   * §17.3 CPU staging queue: while the device is lost/retrying the command is
   * staged (returns true); when healthy it is not (returns false — submit
   * directly). Staged commands surface via onRecover/onDemote/dispose.
   */
  stageCommand(command: TCommand): boolean;
  stagedCount(): number;
  /**
   * Detaches everything: cancels the pending retry timer, ignores any later
   * `lost` resolutions, and returns the still-staged commands so the caller
   * can persist or replay them — nothing is silently dropped.
   */
  dispose(): readonly TCommand[];
}

function normalizeLostInfo(info: { reason?: unknown; message?: unknown } | undefined): string {
  const reason = typeof info?.reason === "string" && info.reason.length > 0 ? info.reason : "unknown";
  const message = typeof info?.message === "string" && info.message.length > 0 ? info.message : "";
  return message.length > 0 ? `${reason}: ${message}` : reason;
}

function defaultRequestDevice<TDevice extends StudioGpuDeviceLike>(): Promise<TDevice | null> {
  interface NavigatorGpuLike {
    gpu?: {
      requestAdapter(): Promise<{ requestDevice(): Promise<TDevice> } | null>;
    };
  }
  const gpu = (globalThis as { navigator?: NavigatorGpuLike }).navigator?.gpu;
  if (!gpu) return Promise.resolve(null);
  return gpu
    .requestAdapter()
    .then((adapter) => (adapter ? adapter.requestDevice() : null))
    .catch(() => null);
}

export function createDeviceLossRecovery<
  TCommand = unknown,
  TDevice extends StudioGpuDeviceLike = StudioGpuDeviceLike,
>(
  options: StudioDeviceLossRecoveryOptions<TCommand, TDevice>,
): StudioDeviceLossRecovery<TCommand, TDevice> {
  const clock = options.clock;
  const tournament = options.tournament ?? STUDIO_DEVICE_LOSS_NO_FALLBACK_TOURNAMENT_PORT;
  const requestDevice =
    options.requestDevice ?? (() => defaultRequestDevice<TDevice>());
  const backoff: StudioDeviceLossBackoff = {
    ...STUDIO_DEVICE_LOSS_DEFAULT_BACKOFF,
    ...options.backoff,
  };
  const permanentThreshold =
    options.permanentDemotionThreshold ?? STUDIO_DEVICE_LOSS_PERMANENT_THRESHOLD;

  let state: StudioDeviceLossState = "healthy";
  let epoch = 0;
  /** Guards stale `lost` resolutions from devices that were replaced. */
  let generation = 0;
  let losses = 0;
  let disposed = false;
  let retryHandle: unknown = null;
  let attempts = 0;
  let lossStartedAt = 0;
  let staged: TCommand[] = [];

  /** Callback hygiene: a throwing observer must never stall recovery. */
  const guard = (run: () => void): void => {
    try {
      run();
    } catch {
      // Contained on purpose — the recovery loop itself is the priority.
    }
  };

  const drainStaged = (): readonly TCommand[] => {
    const drained = staged;
    staged = [];
    return drained;
  };

  const subscribe = (device: TDevice): number => {
    generation += 1;
    const subscribedGeneration = generation;
    epoch += 1;
    void device.lost.then(
      (info) => handleLost(subscribedGeneration, normalizeLostInfo(info ?? undefined)),
      (cause: unknown) =>
        handleLost(
          subscribedGeneration,
          `lost-promise-rejected: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    );
    return epoch;
  };

  const enterPermanentDemotion = (reason: string): void => {
    state = "permanently-demoted";
    tournament.permanentlyDemoteGpuProviders(reason);
    const drained = drainStaged();
    guard(() =>
      options.onDemote({
        state: "permanently-demoted",
        permanent: true,
        reason,
        lossCount: losses,
        stagedCommands: drained,
      }),
    );
  };

  const scheduleAttempt = (attemptNumber: number): void => {
    const delayMs = studioDeviceLossBackoffDelayMs(backoff, attemptNumber);
    retryHandle = clock.schedule(() => {
      retryHandle = null;
      runAttempt(attemptNumber);
    }, delayMs);
  };

  const completeRecovery = (device: TDevice, attemptsUsed: number): void => {
    if (retryHandle !== null) {
      clock.cancel(retryHandle);
      retryHandle = null;
    }
    state = "recovered";
    const deviceEpoch = subscribe(device);
    tournament.reviveGpuProviders();
    const drained = drainStaged();
    guard(() =>
      options.onRecover({
        device,
        attempts: attemptsUsed,
        elapsedMs: clock.now() - lossStartedAt,
        lossCount: losses,
        deviceEpoch,
        stagedCommands: drained,
      }),
    );
  };

  const handleAttemptFailure = (): void => {
    if (disposed || state !== "retrying") return;
    if (attempts >= backoff.maxAttempts) {
      enterPermanentDemotion(
        `gpu-device-loss: re-acquisition exhausted after ${attempts} attempts`,
      );
      return;
    }
    scheduleAttempt(attempts + 1);
  };

  const runAttempt = (attemptNumber: number): void => {
    if (disposed || state !== "retrying") return;
    attempts = attemptNumber;
    void requestDevice({ lossCount: losses, attempt: attemptNumber }).then(
      (device) => {
        if (disposed || state !== "retrying") return;
        if (device === null) {
          handleAttemptFailure();
          return;
        }
        completeRecovery(device, attemptNumber);
      },
      () => handleAttemptFailure(),
    );
  };

  const handleLost = (lostGeneration: number, reason: string): void => {
    if (disposed) return;
    if (lostGeneration !== generation) return; // replaced device — stale signal
    if (state === "permanently-demoted") return;
    losses += 1;
    // ① Invalidate the epoch first: in-flight results must be discarded before recovery starts.
    const invalidatedEpoch = epoch;
    epoch += 1;
    if (options.onDiscardInFlight) {
      const discard = options.onDiscardInFlight;
      guard(() => discard({ invalidatedEpoch, reason }));
    }
    if (losses >= permanentThreshold) {
      tournament.killGpuProviders(`gpu-device-loss: ${reason}`);
      enterPermanentDemotion(
        `gpu-device-loss: permanent after ${losses} losses (${reason})`,
      );
      return;
    }
    // ② Notify the selected-provider outage. The default port does not mutate tournament state;
    //    an explicitly injected legacy port may still mirror availability for migration tests.
    state = "lost";
    tournament.killGpuProviders(`gpu-device-loss: ${reason}`);
    guard(() =>
      options.onDemote({
        state: "lost",
        permanent: false,
        reason,
        lossCount: losses,
        stagedCommands: [],
      }),
    );
    // ④ Backoff re-acquisition on the injected clock.
    state = "retrying";
    attempts = 0;
    lossStartedAt = clock.now();
    scheduleAttempt(1);
  };

  return {
    observe: (device) => {
      if (disposed) {
        throw new Error("device-loss recovery already disposed");
      }
      if (state === "permanently-demoted") return epoch;
      if (state === "lost" || state === "retrying") {
        // Externally supplied device during an outage counts as a recovery.
        completeRecovery(device, attempts);
        return epoch;
      }
      return subscribe(device);
    },
    state: () => state,
    currentEpoch: () => epoch,
    isEpochCurrent: (candidate) =>
      !disposed &&
      (state === "healthy" || state === "recovered") &&
      candidate === epoch,
    lossCount: () => losses,
    stageCommand: (command) => {
      if (disposed) return false;
      if (state !== "lost" && state !== "retrying") return false;
      staged.push(command);
      return true;
    },
    stagedCount: () => staged.length,
    dispose: () => {
      if (disposed) return [];
      disposed = true;
      if (retryHandle !== null) {
        clock.cancel(retryHandle);
        retryHandle = null;
      }
      generation += 1; // pending lost promises become stale
      return drainStaged();
    },
  };
}
