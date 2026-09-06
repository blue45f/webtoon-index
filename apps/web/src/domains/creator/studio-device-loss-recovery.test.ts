import { describe, expect, it } from "vitest";

import {
  STUDIO_DEVICE_LOSS_DEFAULT_BACKOFF,
  STUDIO_DEVICE_LOSS_PERMANENT_THRESHOLD,
  STUDIO_GPU_FAMILY_PROVIDER_IDS,
  createDeviceLossRecovery,
  createStudioTournamentDeviceLossPort,
  studioDeviceLossBackoffDelayMs,
  type StudioDeviceLossRecoveryOptions,
  type StudioDeviceLossTournamentPort,
  type StudioGpuDeviceLike,
} from "./studio-device-loss-recovery";
import {
  createStudioTournamentRuntime,
  installStudioTournamentRuntime,
} from "./studio-renderer-tournament-runtime";

/**
 * V12 §17.3 Device Loss contracts: on a real `lost` resolution the machine
 * discards in-flight work (epoch invalidation), announces selected-provider
 * unavailability, then re-acquires the same provider with exponential backoff.
 * The default never mutates tournament state; the legacy adapter remains
 * explicitly injectable and is tested separately. Staged commands are never
 * silently dropped, and disposal detaches every listener and timer.
 */

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

interface FakeDevice extends StudioGpuDeviceLike {
  lose(info?: { reason?: unknown; message?: unknown }): void;
  rejectLost(cause: unknown): void;
}

function createFakeDevice(): FakeDevice {
  let resolveLost!: (info?: { reason?: unknown; message?: unknown }) => void;
  let rejectLost!: (cause: unknown) => void;
  const lost = new Promise<{ reason?: unknown; message?: unknown } | undefined>(
    (resolve, reject) => {
      resolveLost = resolve;
      rejectLost = reject;
    },
  );
  return { lost, lose: (info) => resolveLost(info), rejectLost };
}

interface ScheduledTask {
  readonly delayMs: number;
  readonly run: () => void;
  cancelled: boolean;
}

/** Deterministic clock: records schedules; tests fire tasks explicitly. */
function createFakeClock(): {
  clock: {
    now(): number;
    schedule(callback: () => void, delayMs: number): unknown;
    cancel(handle: unknown): void;
  };
  tasks: ScheduledTask[];
  advanceNow(ms: number): void;
  /** Runs the next non-cancelled task and returns its scheduled delay. */
  fireNext(): number;
} {
  const tasks: ScheduledTask[] = [];
  let nowMs = 0;
  let cursor = 0;
  return {
    clock: {
      now: () => nowMs,
      schedule: (callback, delayMs) => {
        const task: ScheduledTask = { delayMs, run: callback, cancelled: false };
        tasks.push(task);
        return task;
      },
      cancel: (handle) => {
        (handle as ScheduledTask).cancelled = true;
      },
    },
    tasks,
    advanceNow: (ms) => {
      nowMs += ms;
    },
    fireNext: () => {
      while (cursor < tasks.length && tasks[cursor]!.cancelled) cursor += 1;
      const task = tasks[cursor];
      if (!task) throw new Error("no scheduled task to fire");
      cursor += 1;
      task.run();
      return task.delayMs;
    },
  };
}

function createFakeTournament(log?: string[]): StudioDeviceLossTournamentPort & {
  calls: Array<{ op: string; reason?: string }>;
} {
  const calls: Array<{ op: string; reason?: string }> = [];
  return {
    calls,
    killGpuProviders: (reason) => {
      calls.push({ op: "kill", reason });
      log?.push("kill");
    },
    reviveGpuProviders: () => {
      calls.push({ op: "revive" });
      log?.push("revive");
    },
    permanentlyDemoteGpuProviders: (reason) => {
      calls.push({ op: "permanent", reason });
      log?.push("permanent");
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

type Harness = ReturnType<typeof createHarness>;

function createHarness(
  overrides?: Partial<StudioDeviceLossRecoveryOptions<string, FakeDevice>>,
) {
  const log: string[] = [];
  const fakeClock = createFakeClock();
  const tournament = createFakeTournament(log);
  const demotions: Array<{
    state: string;
    permanent: boolean;
    reason: string;
    lossCount: number;
    stagedCommands: readonly string[];
  }> = [];
  const recoveries: Array<{
    attempts: number;
    elapsedMs: number;
    lossCount: number;
    deviceEpoch: number;
    stagedCommands: readonly string[];
  }> = [];
  const discards: Array<{ invalidatedEpoch: number; reason: string }> = [];
  const deviceQueue: Array<FakeDevice | null> = [];
  const recovery = createDeviceLossRecovery<string, FakeDevice>({
    clock: fakeClock.clock,
    tournament,
    requestDevice: () => Promise.resolve(deviceQueue.shift() ?? null),
    onDemote: (event) => {
      log.push(`demote:${event.state}`);
      demotions.push(event);
    },
    onRecover: (event) => {
      log.push("recover");
      recoveries.push(event);
    },
    onDiscardInFlight: (event) => {
      log.push("discard");
      discards.push(event);
    },
    ...overrides,
  });
  return {
    recovery,
    fakeClock,
    tournament,
    log,
    demotions,
    recoveries,
    discards,
    deviceQueue,
  };
}

/** Drives one full loss → backoff → recovery cycle on the harness. */
async function loseAndRecover(harness: Harness, device: FakeDevice): Promise<FakeDevice> {
  device.lose({ reason: "unknown", message: "cycle" });
  await flushMicrotasks();
  const next = createFakeDevice();
  harness.deviceQueue.push(next);
  harness.fakeClock.fireNext();
  await flushMicrotasks();
  return next;
}

/* ------------------------------------------------------------------ */
/* Backoff math                                                        */
/* ------------------------------------------------------------------ */

describe("studioDeviceLossBackoffDelayMs", () => {
  it("grows exponentially from the initial delay and caps at maxDelayMs", () => {
    const backoff = { initialDelayMs: 100, factor: 2, maxDelayMs: 800, maxAttempts: 6 };
    const delays = [1, 2, 3, 4, 5, 6].map((attempt) =>
      studioDeviceLossBackoffDelayMs(backoff, attempt),
    );
    expect(delays).toEqual([100, 200, 400, 800, 800, 800]);
  });

  it("clamps invalid attempt numbers to the first delay", () => {
    expect(
      studioDeviceLossBackoffDelayMs(STUDIO_DEVICE_LOSS_DEFAULT_BACKOFF, Number.NaN),
    ).toBe(STUDIO_DEVICE_LOSS_DEFAULT_BACKOFF.initialDelayMs);
    expect(studioDeviceLossBackoffDelayMs(STUDIO_DEVICE_LOSS_DEFAULT_BACKOFF, -3)).toBe(
      STUDIO_DEVICE_LOSS_DEFAULT_BACKOFF.initialDelayMs,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Loss handling order + epoch discard                                 */
/* ------------------------------------------------------------------ */

describe("device loss handling", () => {
  it("does not kill tournament providers through the default recovery port", async () => {
    const runtime = createStudioTournamentRuntime({ persistence: null });
    installStudioTournamentRuntime(runtime);
    const fakeClock = createFakeClock();
    const device = createFakeDevice();
    const recovery = createDeviceLossRecovery<string, FakeDevice>({
      clock: fakeClock.clock,
      requestDevice: () => Promise.resolve(null),
      onDemote: () => undefined,
      onRecover: () => undefined,
    });
    try {
      recovery.observe(device);
      device.lose({ reason: "destroyed" });
      await flushMicrotasks();
      for (const providerId of STUDIO_GPU_FAMILY_PROVIDER_IDS) {
        expect(runtime.killSwitch.isKilled(providerId)).toBe(false);
      }
    } finally {
      recovery.dispose();
      installStudioTournamentRuntime(null);
    }
  });

  it("starts healthy with a current epoch after observe", () => {
    const harness = createHarness();
    const epoch = harness.recovery.observe(createFakeDevice());
    expect(harness.recovery.state()).toBe("healthy");
    expect(harness.recovery.isEpochCurrent(epoch)).toBe(true);
  });

  it("on loss fires discard → tournament kill → fallback demotion, in order", async () => {
    const harness = createHarness();
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed", message: "device was destroyed" });
    await flushMicrotasks();
    expect(harness.log).toEqual(["discard", "kill", "demote:lost"]);
    expect(harness.recovery.state()).toBe("retrying");
    expect(harness.tournament.calls[0]).toEqual({
      op: "kill",
      reason: "gpu-device-loss: destroyed: device was destroyed",
    });
    expect(harness.demotions[0]).toMatchObject({
      state: "lost",
      permanent: false,
      lossCount: 1,
    });
  });

  it("invalidates the pre-loss epoch so in-flight results are discardable", async () => {
    const harness = createHarness();
    const device = createFakeDevice();
    const preLossEpoch = harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    expect(harness.discards).toEqual([
      { invalidatedEpoch: preLossEpoch, reason: "destroyed" },
    ]);
    expect(harness.recovery.isEpochCurrent(preLossEpoch)).toBe(false);
    // No epoch is current while the outage is in progress.
    expect(harness.recovery.isEpochCurrent(harness.recovery.currentEpoch())).toBe(false);
  });

  it("treats a rejected lost promise as a loss instead of ignoring it", async () => {
    const harness = createHarness();
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.rejectLost(new Error("driver reset"));
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("retrying");
    expect(harness.discards[0]?.reason).toBe("lost-promise-rejected: driver reset");
  });
});

/* ------------------------------------------------------------------ */
/* Backoff sequence + recovery                                         */
/* ------------------------------------------------------------------ */

describe("backoff re-acquisition", () => {
  it("schedules the exact exponential delay sequence on the injected clock", async () => {
    const harness = createHarness({
      backoff: { initialDelayMs: 100, factor: 2, maxDelayMs: 800, maxAttempts: 5 },
    });
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    const observedDelays: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      observedDelays.push(harness.fakeClock.fireNext()); // requestDevice → null
      await flushMicrotasks();
    }
    expect(observedDelays).toEqual([100, 200, 400, 800]);
    expect(harness.recovery.state()).toBe("retrying");
  });

  it("revives the tournament before announcing recovery, with measured elapsed time", async () => {
    const harness = createHarness();
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    // First attempt fails, second succeeds.
    harness.fakeClock.fireNext();
    await flushMicrotasks();
    harness.fakeClock.advanceNow(750);
    const revived = createFakeDevice();
    harness.deviceQueue.push(revived);
    harness.fakeClock.fireNext();
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("recovered");
    expect(harness.log).toEqual(["discard", "kill", "demote:lost", "revive", "recover"]);
    expect(harness.recoveries[0]).toMatchObject({
      attempts: 2,
      elapsedMs: 750,
      lossCount: 1,
    });
    expect(
      harness.recovery.isEpochCurrent(harness.recoveries[0]!.deviceEpoch),
    ).toBe(true);
  });

  it("counts a rejected requestDevice as a failed attempt and keeps backing off", async () => {
    const harness = createHarness({
      requestDevice: () => Promise.reject(new Error("adapter gone")),
      backoff: { initialDelayMs: 50, factor: 3, maxDelayMs: 5_000, maxAttempts: 4 },
    });
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    const delays = [harness.fakeClock.fireNext()];
    await flushMicrotasks();
    delays.push(harness.fakeClock.fireNext());
    await flushMicrotasks();
    expect(delays).toEqual([50, 150]);
    expect(harness.recovery.state()).toBe("retrying");
  });

  it("permanently demotes when every re-acquisition attempt is exhausted", async () => {
    const harness = createHarness({
      backoff: { initialDelayMs: 10, factor: 2, maxDelayMs: 40, maxAttempts: 2 },
    });
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    harness.fakeClock.fireNext();
    await flushMicrotasks();
    harness.fakeClock.fireNext();
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("permanently-demoted");
    expect(harness.tournament.calls.at(-1)).toMatchObject({ op: "permanent" });
    expect(harness.demotions.at(-1)).toMatchObject({
      state: "permanently-demoted",
      permanent: true,
    });
  });

  it("resubscribes the recovered device so a repeat loss starts a second cycle", async () => {
    const harness = createHarness();
    const first = createFakeDevice();
    harness.recovery.observe(first);
    const second = await loseAndRecover(harness, first);
    expect(harness.recovery.lossCount()).toBe(1);
    second.lose({ reason: "destroyed" });
    await flushMicrotasks();
    expect(harness.recovery.lossCount()).toBe(2);
    expect(harness.recovery.state()).toBe("retrying");
  });

  it("permanently demotes at the loss threshold (3) without scheduling a retry", async () => {
    const harness = createHarness();
    expect(STUDIO_DEVICE_LOSS_PERMANENT_THRESHOLD).toBe(3);
    let device = createFakeDevice();
    harness.recovery.observe(device);
    device = await loseAndRecover(harness, device); // loss 1 → recovered
    device = await loseAndRecover(harness, device); // loss 2 → recovered
    const scheduledBefore = harness.fakeClock.tasks.length;
    device.lose({ reason: "destroyed", message: "third strike" });
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("permanently-demoted");
    expect(harness.recovery.lossCount()).toBe(3);
    expect(harness.fakeClock.tasks.length).toBe(scheduledBefore); // no retry timer
    expect(harness.demotions.at(-1)).toMatchObject({
      state: "permanently-demoted",
      permanent: true,
      lossCount: 3,
    });
    // Terminal: observing a fresh device does not resurrect the GPU family.
    const callsBefore = harness.tournament.calls.length;
    harness.recovery.observe(createFakeDevice());
    expect(harness.tournament.calls.length).toBe(callsBefore);
    expect(harness.recovery.state()).toBe("permanently-demoted");
  });
});

/* ------------------------------------------------------------------ */
/* Staging queue — no silent loss                                      */
/* ------------------------------------------------------------------ */

describe("CPU staging queue", () => {
  it("stages commands only during an outage and drains them into onRecover", async () => {
    const harness = createHarness();
    const device = createFakeDevice();
    harness.recovery.observe(device);
    expect(harness.recovery.stageCommand("while-healthy")).toBe(false);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    expect(harness.recovery.stageCommand("stroke-a")).toBe(true);
    expect(harness.recovery.stageCommand("stroke-b")).toBe(true);
    expect(harness.recovery.stagedCount()).toBe(2);
    harness.deviceQueue.push(createFakeDevice());
    harness.fakeClock.fireNext();
    await flushMicrotasks();
    expect(harness.recoveries[0]?.stagedCommands).toEqual(["stroke-a", "stroke-b"]);
    expect(harness.recovery.stagedCount()).toBe(0);
  });

  it("hands staged commands to onDemote on permanent demotion instead of dropping them", async () => {
    const harness = createHarness({
      backoff: { initialDelayMs: 10, factor: 2, maxDelayMs: 40, maxAttempts: 1 },
    });
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    harness.recovery.stageCommand("stranded-stroke");
    harness.fakeClock.fireNext();
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("permanently-demoted");
    expect(harness.demotions.at(-1)?.stagedCommands).toEqual(["stranded-stroke"]);
    expect(harness.recovery.stagedCount()).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Listener lifecycle                                                  */
/* ------------------------------------------------------------------ */

describe("listener lifecycle", () => {
  it("ignores a stale lost signal from a device that was already replaced", async () => {
    const harness = createHarness();
    const stale = createFakeDevice();
    harness.recovery.observe(stale);
    harness.recovery.observe(createFakeDevice()); // replaces the subscription
    stale.lose({ reason: "destroyed" });
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("healthy");
    expect(harness.log).toEqual([]);
  });

  it("completes an outage through an externally observed device (revive + drain)", async () => {
    const harness = createHarness();
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    harness.recovery.stageCommand("external-path");
    harness.recovery.observe(createFakeDevice()); // fabric acquired its own device
    expect(harness.recovery.state()).toBe("recovered");
    expect(harness.log.slice(-2)).toEqual(["revive", "recover"]);
    expect(harness.recoveries[0]?.stagedCommands).toEqual(["external-path"]);
    // The pending retry timer was cancelled, not left to fire later.
    expect(harness.fakeClock.tasks[0]?.cancelled).toBe(true);
  });

  it("dispose cancels the pending retry, detaches lost listeners, and returns staged commands", async () => {
    const harness = createHarness();
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    harness.recovery.stageCommand("undelivered");
    const drained = harness.recovery.dispose();
    expect(drained).toEqual(["undelivered"]);
    expect(harness.fakeClock.tasks[0]?.cancelled).toBe(true);
    const logLength = harness.log.length;
    // A second device losing after dispose triggers nothing.
    expect(() => harness.recovery.observe(createFakeDevice())).toThrow(/disposed/);
    await flushMicrotasks();
    expect(harness.log.length).toBe(logLength);
    expect(harness.recovery.dispose()).toEqual([]); // idempotent
  });

  it("keeps recovering even when a demotion observer throws", async () => {
    const harness = createHarness({
      onDemote: () => {
        throw new Error("observer bug");
      },
    });
    const device = createFakeDevice();
    harness.recovery.observe(device);
    device.lose({ reason: "destroyed" });
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("retrying");
    harness.deviceQueue.push(createFakeDevice());
    harness.fakeClock.fireNext();
    await flushMicrotasks();
    expect(harness.recovery.state()).toBe("recovered");
  });
});

/* ------------------------------------------------------------------ */
/* Tournament port adapter — applyKillList wiring                      */
/* ------------------------------------------------------------------ */

describe("createStudioTournamentDeviceLossPort", () => {
  const GPU_WINNER = {
    providerId: "filter-lane-gpu-chain",
    expectedWarmMs: 1.2,
    decidedAtSample: 5,
  };
  const CPU_WINNER = {
    providerId: "filter-lane-worker",
    expectedWarmMs: 6.5,
    decidedAtSample: 4,
  };

  it("kills the GPU family through applyKillList and revives with winners restored", () => {
    const runtime = createStudioTournamentRuntime({ persistence: null });
    runtime.recordWinner("bucket-gpu", "dev-a", GPU_WINNER);
    runtime.recordWinner("bucket-cpu", "dev-a", CPU_WINNER);
    const port = createStudioTournamentDeviceLossPort({
      runtime,
      gpuProviderIds: ["filter-lane-gpu-chain"],
      winnerKeys: () => [
        { bucket: "bucket-gpu", deviceHash: "dev-a" },
        { bucket: "bucket-cpu", deviceHash: "dev-a" },
      ],
    });

    port.killGpuProviders("gpu-device-loss: destroyed");
    expect(runtime.killSwitch.isKilled("filter-lane-gpu-chain")).toBe(true);
    expect(runtime.winnerCache.get("bucket-gpu", "dev-a")).toBeNull();
    // Non-GPU winners are untouched by the kill.
    expect(runtime.winnerCache.get("bucket-cpu", "dev-a")).toEqual(CPU_WINNER);

    port.reviveGpuProviders();
    expect(runtime.killSwitch.isKilled("filter-lane-gpu-chain")).toBe(false);
    // Snapshot restored — a transient loss does not erase tournament wins.
    expect(runtime.winnerCache.get("bucket-gpu", "dev-a")).toEqual(GPU_WINNER);
  });

  it("permanent demotion leaves the family killed and its winners evicted", () => {
    const runtime = createStudioTournamentRuntime({ persistence: null });
    runtime.recordWinner("bucket-gpu", "dev-a", GPU_WINNER);
    const port = createStudioTournamentDeviceLossPort({
      runtime,
      gpuProviderIds: ["filter-lane-gpu-chain"],
      winnerKeys: () => [{ bucket: "bucket-gpu", deviceHash: "dev-a" }],
    });
    port.killGpuProviders("gpu-device-loss: destroyed");
    port.permanentlyDemoteGpuProviders("gpu-device-loss: permanent after 3 losses");
    expect(runtime.killSwitch.isKilled("filter-lane-gpu-chain")).toBe(true);
    expect(runtime.killSwitch.reasonFor("filter-lane-gpu-chain")).toContain("permanent");
    // Revive after permanent demotion restores nothing (snapshot cleared).
    port.reviveGpuProviders();
    expect(runtime.winnerCache.get("bucket-gpu", "dev-a")).toBeNull();
  });

  it("covers the known GPU-family providers by default", () => {
    expect(STUDIO_GPU_FAMILY_PROVIDER_IDS).toEqual([
      "filter-lane-gpu-chain",
      "stroke-route-gpu",
      "stroke-route-living-ink",
    ]);
    const runtime = createStudioTournamentRuntime({ persistence: null });
    const port = createStudioTournamentDeviceLossPort({ runtime });
    port.killGpuProviders("gpu-device-loss: destroyed");
    for (const providerId of STUDIO_GPU_FAMILY_PROVIDER_IDS) {
      expect(runtime.killSwitch.isKilled(providerId)).toBe(true);
    }
  });
});
