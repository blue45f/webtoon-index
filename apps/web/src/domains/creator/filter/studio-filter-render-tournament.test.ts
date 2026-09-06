import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";
import {
  createStudioTournamentRuntime,
  installStudioTournamentRuntime,
  type PersistedTournamentStateV1,
  type TournamentPersistencePort,
} from "../studio-renderer-tournament-runtime";
import { createSqliteTournamentPersistence } from "../studio-tournament-sqlite-persistence";

import {
  resetStudioFilterRenderTournamentForTests,
  scheduleStudioFilterRenderTournament,
} from "./studio-filter-render-tournament";

const GPU = "filter-lane-gpu-chain";
const WORKER = "filter-lane-worker";
const PIXELS = new Uint8Array([10, 20, 30, 255]);

function manualScheduler(): {
  tasks: Array<() => void>;
  run(): Promise<void>;
} {
  const tasks: Array<() => void> = [];
  return {
    tasks,
    async run() {
      for (const task of tasks.splice(0)) task();
      await vi.waitFor(() => expect(tasks).toHaveLength(0));
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    },
  };
}

function request(overrides: Partial<Parameters<typeof scheduleStudioFilterRenderTournament>[0]> = {}) {
  return {
    bucket: "studio-filter-island|gpu1|p10|s1",
    requestKey: "src|filter|64|64",
    width: 1,
    height: 1,
    penDown: false,
    production: { providerId: GPU, elapsedMs: 2, pixels: PIXELS },
    challenger: {
      providerId: WORKER,
      render: vi.fn(async () => ({ pixels: PIXELS })),
    },
    referenceProviderId: WORKER,
    ...overrides,
  };
}

afterEach(() => {
  installStudioTournamentRuntime(null);
  resetStudioFilterRenderTournamentForTests();
});

describe("product filter render tournament", () => {
  it("records the accepted visible render immediately and races only on idle", async () => {
    const scheduler = manualScheduler();
    const saves: PersistedTournamentStateV1[] = [];
    const port: TournamentPersistencePort = {
      load: () => Promise.resolve(null),
      save: (state) => {
        saves.push(state);
        return Promise.resolve();
      },
      status: () => ({ mode: "sqlite-opfs", durable: true, reason: null }),
    };
    const runtime = createStudioTournamentRuntime({
      persistence: port,
      deviceHash: "dev-a",
    });
    installStudioTournamentRuntime(runtime);
    let clock = 10;
    const input = request({
      scheduler: (task) => scheduler.tasks.push(task),
      now: () => {
        const value = clock;
        clock += 5;
        return value;
      },
    });

    const scheduled = scheduleStudioFilterRenderTournament(input);
    expect(scheduled).toEqual({
      productionSampleRecorded: true,
      shadowScheduled: true,
      reason: "scheduled",
    });
    expect(runtime.costModel.sampleCount(GPU, input.bucket)).toBe(1);
    expect(input.challenger.render).not.toHaveBeenCalled();
    expect(runtime.winnerCache.get(input.bucket, "dev-a")).toBeNull();

    await scheduler.run();
    await vi.waitFor(() => {
      expect(runtime.winnerCache.get(input.bucket, "dev-a")?.providerId).toBe(GPU);
    });
    expect(input.challenger.render).toHaveBeenCalledOnce();
    expect(runtime.costModel.sampleCount(WORKER, input.bucket)).toBe(1);
    await vi.waitFor(() => expect(saves).toHaveLength(1));
  });

  it("boots a new install on idle and can create its first samples and winner", async () => {
    const scheduler = manualScheduler();
    const runtime = createStudioTournamentRuntime({ persistence: null, deviceHash: "dev-new" });
    const input = request({
      scheduler: (task) => scheduler.tasks.push(task),
      resolveRuntime: async () => {
        installStudioTournamentRuntime(runtime);
        return runtime;
      },
      now: (() => {
        let value = 0;
        return () => (value += 4);
      })(),
    });
    expect(scheduleStudioFilterRenderTournament(input).productionSampleRecorded).toBe(false);
    await scheduler.run();
    await vi.waitFor(() => {
      expect(runtime.costModel.sampleCount(GPU, input.bucket)).toBe(1);
      expect(runtime.costModel.sampleCount(WORKER, input.bucket)).toBe(1);
      expect(runtime.winnerCache.get(input.bucket, "dev-new")).not.toBeNull();
    });
  });

  it("writes product render samples and the accepted winner to real SQLite tables", async () => {
    const scheduler = manualScheduler();
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const runtime = createStudioTournamentRuntime({
      persistence: createSqliteTournamentPersistence({
        openDatabase: () => Promise.resolve(database),
      }),
      deviceHash: "dev-sqlite",
    });
    installStudioTournamentRuntime(runtime);
    let value = 0;
    const input = request({
      scheduler: (task) => scheduler.tasks.push(task),
      now: () => (value += 5),
    });

    scheduleStudioFilterRenderTournament(input);
    await scheduler.run();
    await vi.waitFor(async () => {
      expect(await database.listCostSamples(GPU, input.bucket)).toHaveLength(1);
      expect(await database.listCostSamples(WORKER, input.bucket)).toHaveLength(1);
      expect(await database.getTournamentWinner(input.bucket, "dev-sqlite")).toMatchObject({
        bucket: input.bucket,
        providerId: GPU,
      });
    });
    await database.close();
  });

  it("keeps the visual reference when the faster challenger diverges", async () => {
    const scheduler = manualScheduler();
    const runtime = createStudioTournamentRuntime({ persistence: null, deviceHash: "dev-a" });
    installStudioTournamentRuntime(runtime);
    let value = 0;
    const input = request({
      production: { providerId: WORKER, elapsedMs: 8, pixels: PIXELS },
      challenger: {
        providerId: GPU,
        render: vi.fn(async () => ({ pixels: new Uint8Array([255, 255, 255, 255]) })),
      },
      scheduler: (task) => scheduler.tasks.push(task),
      now: () => (value += 1),
    });
    scheduleStudioFilterRenderTournament(input);
    await scheduler.run();
    await vi.waitFor(() => {
      expect(runtime.winnerCache.get(input.bucket, "dev-a")?.providerId).toBe(WORKER);
    });
  });

  it("does not start a shadow or change a winner while pen-down", () => {
    const scheduler = manualScheduler();
    const runtime = createStudioTournamentRuntime({ persistence: null, deviceHash: "dev-a" });
    installStudioTournamentRuntime(runtime);
    const input = request({
      penDown: true,
      scheduler: (task) => scheduler.tasks.push(task),
    });
    expect(scheduleStudioFilterRenderTournament(input)).toMatchObject({
      productionSampleRecorded: true,
      shadowScheduled: false,
      reason: "pen-down",
    });
    expect(scheduler.tasks).toHaveLength(0);
    expect(runtime.winnerCache.get(input.bucket, "dev-a")).toBeNull();
  });

  it("keeps kill-switch denial ahead of observation-only challenger scheduling", () => {
    const scheduler = manualScheduler();
    const runtime = createStudioTournamentRuntime({ persistence: null, deviceHash: "dev-a" });
    runtime.applyKillList([WORKER], "remote fault");
    installStudioTournamentRuntime(runtime);
    const input = request({ scheduler: (task) => scheduler.tasks.push(task) });
    expect(scheduleStudioFilterRenderTournament(input).reason).toBe("provider-killed");
    expect(scheduler.tasks).toHaveLength(0);
    expect(runtime.winnerCache.get(input.bucket, "dev-a")).toBeNull();
  });

  it("bounds duplicate requests and never treats a failed challenger as a winner", async () => {
    const scheduler = manualScheduler();
    const runtime = createStudioTournamentRuntime({ persistence: null, deviceHash: "dev-a" });
    installStudioTournamentRuntime(runtime);
    const input = request({
      scheduler: (task) => scheduler.tasks.push(task),
      challenger: {
        providerId: WORKER,
        render: vi.fn(async () => Promise.reject(new Error("worker failed"))),
      },
    });
    expect(scheduleStudioFilterRenderTournament(input).reason).toBe("scheduled");
    expect(scheduleStudioFilterRenderTournament(input).reason).toBe("duplicate");
    await scheduler.run();
    expect(runtime.winnerCache.get(input.bucket, "dev-a")).toBeNull();
  });
});
