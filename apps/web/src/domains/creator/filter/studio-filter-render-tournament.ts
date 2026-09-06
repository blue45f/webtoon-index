import {
  peekStudioTournamentRuntime,
  type StudioMeasuredTournamentResult,
  type StudioRendererTournamentRuntime,
} from "../studio-renderer-tournament-runtime";

/**
 * Product filter tournament orchestration.
 *
 * The visible render is already complete when this function is called. Its
 * elapsed time is recorded immediately when the runtime exists. At most one
 * challenger for the same request runs later on an idle callback; therefore
 * the tournament never delays presentation and an optional GPU challenger
 * readback is never on the interactive hot path.
 */

export const STUDIO_FILTER_TOURNAMENT_MAX_PIXELS = 4 * 1024 * 1024;
export const STUDIO_FILTER_TOURNAMENT_MAX_ACTIVE_RACES = 2;
export const STUDIO_FILTER_TOURNAMENT_MAX_RACES_PER_BUCKET = 3;
const COMPLETED_RACE_KEY_LIMIT = 64;

export type StudioFilterTournamentScheduler = (task: () => void) => void;
export type StudioFilterTournamentPixels = Uint8Array | Uint8ClampedArray;

export interface StudioFilterTournamentCandidateResult {
  pixels: StudioFilterTournamentPixels;
}

export interface ScheduleStudioFilterRenderTournamentInput {
  bucket: string;
  requestKey: string;
  width: number;
  height: number;
  penDown: boolean;
  production: {
    providerId: string;
    elapsedMs: number;
    pixels: StudioFilterTournamentPixels;
  };
  challenger: {
    providerId: string;
    render(signal: AbortSignal): Promise<StudioFilterTournamentCandidateResult>;
  };
  /** Worker/CPU reference for the visual equivalence gate. */
  referenceProviderId: string;
  signal?: AbortSignal;
  scheduler?: StudioFilterTournamentScheduler;
  now?: () => number;
  resolveRuntime?: () => Promise<StudioRendererTournamentRuntime | null>;
  onDecision?: (result: StudioMeasuredTournamentResult) => void;
}

export interface ScheduleStudioFilterRenderTournamentResult {
  productionSampleRecorded: boolean;
  shadowScheduled: boolean;
  reason:
    | "scheduled"
    | "pen-down"
    | "pixel-budget"
    | "duplicate"
    | "bucket-budget"
    | "concurrency-budget"
    | "provider-killed"
    | "invalid-production-sample";
}

const racesByBucket = new Map<string, number>();
const pendingRaceKeys = new Set<string>();
const completedRaceKeys = new Set<string>();
let activeRaces = 0;

function defaultScheduler(task: () => void): void {
  const idle = (
    globalThis as {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => unknown;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") idle(task, { timeout: 4_000 });
  else globalThis.setTimeout(task, 0);
}

async function resolveProductRuntime(): Promise<StudioRendererTournamentRuntime | null> {
  const existing = peekStudioTournamentRuntime();
  if (existing) return existing;
  try {
    const bootstrap = await import("../studio-tournament-persistence-bootstrap");
    await bootstrap.bootStudioTournamentPersistence();
  } catch {
    // The bootstrap owns explicit persistence status/reporting. No alternate
    // browser store is opened here.
  }
  return peekStudioTournamentRuntime();
}

function raceKeyOf(input: ScheduleStudioFilterRenderTournamentInput): string {
  return [
    input.bucket,
    input.requestKey,
    input.production.providerId,
    input.challenger.providerId,
  ].join("::");
}

function asUint8View(pixels: StudioFilterTournamentPixels): Uint8Array {
  return pixels instanceof Uint8Array
    ? pixels
    : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}

function rememberCompleted(key: string): void {
  completedRaceKeys.add(key);
  while (completedRaceKeys.size > COMPLETED_RACE_KEY_LIMIT) {
    const oldest = completedRaceKeys.values().next().value as string | undefined;
    if (oldest === undefined) break;
    completedRaceKeys.delete(oldest);
  }
}

/** Test/session reset seam; product code never calls it. */
export function resetStudioFilterRenderTournamentForTests(): void {
  racesByBucket.clear();
  pendingRaceKeys.clear();
  completedRaceKeys.clear();
  activeRaces = 0;
}

export function scheduleStudioFilterRenderTournament(
  input: ScheduleStudioFilterRenderTournamentInput,
): ScheduleStudioFilterRenderTournamentResult {
  const immediateRuntime = peekStudioTournamentRuntime();
  const productionSampleRecorded =
    immediateRuntime?.recordRenderSample(
      input.production.providerId,
      input.bucket,
      input.production.elapsedMs,
    ) ?? false;
  if (!Number.isFinite(input.production.elapsedMs) || input.production.elapsedMs < 0) {
    return {
      productionSampleRecorded: false,
      shadowScheduled: false,
      reason: "invalid-production-sample",
    };
  }
  if (input.penDown) {
    return { productionSampleRecorded, shadowScheduled: false, reason: "pen-down" };
  }
  const pixelCount = input.width * input.height;
  if (
    !Number.isSafeInteger(pixelCount) ||
    pixelCount <= 0 ||
    pixelCount > STUDIO_FILTER_TOURNAMENT_MAX_PIXELS ||
    input.production.pixels.byteLength !== pixelCount * 4
  ) {
    return { productionSampleRecorded, shadowScheduled: false, reason: "pixel-budget" };
  }
  if (
    immediateRuntime?.killSwitch.isKilled(input.production.providerId) === true ||
    immediateRuntime?.killSwitch.isKilled(input.challenger.providerId) === true
  ) {
    return { productionSampleRecorded, shadowScheduled: false, reason: "provider-killed" };
  }

  const raceKey = raceKeyOf(input);
  if (pendingRaceKeys.has(raceKey) || completedRaceKeys.has(raceKey)) {
    return { productionSampleRecorded, shadowScheduled: false, reason: "duplicate" };
  }
  if (
    (racesByBucket.get(input.bucket) ?? 0) >=
    STUDIO_FILTER_TOURNAMENT_MAX_RACES_PER_BUCKET
  ) {
    return { productionSampleRecorded, shadowScheduled: false, reason: "bucket-budget" };
  }
  if (activeRaces >= STUDIO_FILTER_TOURNAMENT_MAX_ACTIVE_RACES) {
    return {
      productionSampleRecorded,
      shadowScheduled: false,
      reason: "concurrency-budget",
    };
  }

  pendingRaceKeys.add(raceKey);
  activeRaces += 1;
  racesByBucket.set(input.bucket, (racesByBucket.get(input.bucket) ?? 0) + 1);
  const scheduler = input.scheduler ?? defaultScheduler;
  const now = input.now ?? (() => globalThis.performance.now());
  const resolveRuntime = input.resolveRuntime ?? resolveProductRuntime;
  scheduler(() => {
    void (async () => {
      try {
        if (input.signal?.aborted) return;
        const runtime = immediateRuntime ?? (await resolveRuntime());
        if (!runtime || input.signal?.aborted) return;
        if (!productionSampleRecorded) {
          runtime.recordRenderSample(
            input.production.providerId,
            input.bucket,
            input.production.elapsedMs,
          );
        }
        if (
          runtime.killSwitch.isKilled(input.production.providerId) ||
          runtime.killSwitch.isKilled(input.challenger.providerId)
        ) {
          return;
        }

        const controller = new AbortController();
        const abort = (): void => controller.abort();
        input.signal?.addEventListener("abort", abort, { once: true });
        try {
          const startedAt = now();
          const challenger = await input.challenger.render(controller.signal);
          const elapsedMs = now() - startedAt;
          if (controller.signal.aborted || input.signal?.aborted) return;
          if (challenger.pixels.byteLength !== pixelCount * 4) return;
          if (!runtime.recordRenderSample(
            input.challenger.providerId,
            input.bucket,
            elapsedMs,
          )) {
            return;
          }
          const decision = runtime.evaluateMeasuredTournament({
            bucket: input.bucket,
            width: input.width,
            height: input.height,
            referenceProviderId: input.referenceProviderId,
            candidates: [
              {
                providerId: input.production.providerId,
                pixels: asUint8View(input.production.pixels),
              },
              {
                providerId: input.challenger.providerId,
                pixels: asUint8View(challenger.pixels),
              },
            ],
            penDown: input.penDown,
          });
          input.onDecision?.(decision);
          if (decision.changed) {
            // This callback is already idle/shadow work. Persistence remains
            // outside the visible-render promise and cannot delay presentation.
            void runtime.persist();
          }
        } finally {
          input.signal?.removeEventListener("abort", abort);
        }
      } catch {
        // Shadow/tournament work is observational. Failure preserves the
        // already-presented production pixels and selected provider decision.
      } finally {
        pendingRaceKeys.delete(raceKey);
        rememberCompleted(raceKey);
        activeRaces = Math.max(0, activeRaces - 1);
      }
    })();
  });

  return { productionSampleRecorded, shadowScheduled: true, reason: "scheduled" };
}
