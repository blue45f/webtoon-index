import { describe, expect, it, vi } from "vitest";

import { STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION } from "./studio-living-ink-execution-protocol";
import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import {
  StudioLivingInkStudioCoordinator,
  type StudioLivingInkCoordinatorProvider,
  type StudioLivingInkStrokeRecipeSnapshot,
} from "./studio-living-ink-studio-coordinator";

import type {
  StudioLivingInkExecutionApplied,
  StudioLivingInkExecutionApplyOptions,
  StudioLivingInkExecutionApplyResult,
  StudioLivingInkExecutionConfig,
  StudioLivingInkExecutionFrame,
  StudioLivingInkExecutionReceipt,
} from "./studio-living-ink-execution-protocol";
import type { StudioLivingInkOperation } from "./studio-living-ink-field";

const config: StudioLivingInkExecutionConfig = {
  displayWidth: 128,
  displayHeight: 128,
  fieldWidth: 64,
  fieldHeight: 64,
  coarseBase: 128,
  seed: 17,
  displayMode: "composite",
  material: {
    ...DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
    flow: 0.5,
    bleed: 0.5,
    dryRate: 0.5,
    paperFiber: 0.5,
    granulation: 0.5,
  },
};
const backend = "webgl2" as const;

const recipe: StudioLivingInkStrokeRecipeSnapshot = {
  mode: "ink",
  tool: "brush",
  baseWidth: 5,
  fieldScale: 1,
  waterLoad: 0.5,
  pigmentLoad: 0.5,
  color: [0.1, 0.2, 0.3, 1],
  pointerSource: "pen",
  selection: null,
};

function receipt(
  requestId: number,
  operation: StudioLivingInkOperation | null,
  displaySha256: `sha256:${string}` = `sha256:${"1".repeat(64)}`,
): StudioLivingInkExecutionReceipt {
  return {
    kind: "studio-living-ink-execution-receipt",
    version: 1,
    engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
    requestId,
    revision: requestId,
    operationKind: operation?.kind ?? "restore",
    backend: "webgl2-offscreen-half-float",
    displaySha256,
    operationSha256: `sha256:${"2".repeat(64)}`,
    dirtyBounds: { x: 0, y: 0, width: 64, height: 64 },
    dirtyTileCount: 1,
    passCount: 1,
    pressureIterations: 10,
    simulationTicks: operation?.kind === "advance" ? operation.fixedTicks : 1,
    elapsedMilliseconds: 1,
    fixedPigmentPolicy: "immutable",
    dryingWindowSeconds: 2,
    fixDurationSeconds: 1.2,
    determinism: "same-runtime-replay",
    crossDeviceBitExact: false,
    cpuOperationHashCrossDeviceDeterministic: true,
    canonicalFrameAuthority: "first-rendered-rgba8-frame",
    replayValidation: "bounded-visual-parity",
    displayReadbackOrientation: "webgl-bottom-left-row-major",
    gpuError: 0,
    readbackFormat: "rgba8-staging-fbo",
    imageOwnership: "caller-must-close",
    contextRecovery: "worker-rebuild-journal-replay",
  };
}

function frame(
  requestId: number,
  operation: StudioLivingInkOperation | null = null,
  displaySha256?: `sha256:${string}`,
) {
  const close = vi.fn();
  const image = { width: 128, height: 128, close } as unknown as ImageBitmap;
  return {
    frame: { image, receipt: receipt(requestId, operation, displaySha256) } satisfies StudioLivingInkExecutionFrame,
    close,
  };
}

class FakeProvider implements StudioLivingInkCoordinatorProvider {
  readonly operations: StudioLivingInkOperation[] = [];
  readonly disposed = vi.fn(async () => undefined);
  readonly returnedFrames: ReturnType<typeof frame>[] = [];
  readonly simulationAcks: StudioLivingInkExecutionApplied[] = [];
  renderCount = 0;
  pendingApply: Promise<void> | null = null;

  async apply(
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions = {},
  ): Promise<StudioLivingInkExecutionApplyResult> {
    this.operations.push(structuredClone(operation));
    await this.pendingApply;
    if (options.present === false) {
      const applied: StudioLivingInkExecutionApplied = {
        kind: "living-ink/applied",
        version: 1,
        engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
        requestId: this.operations.length,
        revision: this.operations.length,
        operationKind: operation.kind,
        operationSha256: `sha256:${"2".repeat(64)}`,
        backend: "webgl2-offscreen-half-float",
        dirtyBounds: { x: 0, y: 0, width: 64, height: 64 },
        dirtyTileCount: 1,
        passCount: 1,
        pressureIterations: options.quality === "settle" ? 22 : 10,
        simulationTicks: operation.kind === "advance" ? operation.fixedTicks : 1,
        elapsedMilliseconds: 1,
        presented: false,
        displayReadbackCount: 0,
        imageBitmapCount: 0,
      };
      this.simulationAcks.push(applied);
      return applied;
    }
    const next = frame(this.operations.length, operation);
    this.returnedFrames.push(next);
    return next.frame;
  }

  async render(): Promise<StudioLivingInkExecutionFrame> {
    this.renderCount += 1;
    let hash = 0x811c9dc5;
    const serialized = JSON.stringify(this.operations);
    for (let index = 0; index < serialized.length; index += 1) {
      hash ^= serialized.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const digest = hash.toString(16).padStart(8, "0").repeat(8) as `${string}`;
    const next = frame(this.operations.length + 1, null, `sha256:${digest}`);
    this.returnedFrames.push(next);
    return next.frame;
  }

  dispose(): Promise<void> {
    return this.disposed();
  }
}

function sample(index: number) {
  return { x: index, y: 10, pressure: 0.5, timeMs: index * 8 };
}

async function activated(
  provider: FakeProvider,
  callbacks: Partial<ConstructorParameters<typeof StudioLivingInkStudioCoordinator>[0]> = {},
) {
  const coordinator = new StudioLivingInkStudioCoordinator({
    providerFactory: async () => provider,
    ...callbacks,
  });
  await expect(coordinator.activate({ pageId: "page-1", backend, config })).resolves.toBe(true);
  return coordinator;
}

describe("StudioLivingInkStudioCoordinator", () => {
  it("passes one explicit provider selection into the product factory", async () => {
    const provider = new FakeProvider();
    const factory = vi.fn(async () => provider);
    const coordinator = new StudioLivingInkStudioCoordinator({ providerFactory: factory });
    await expect(coordinator.activate({
      pageId: "page-webgpu",
      backend: "webgpu",
      config,
    })).resolves.toBe(true);
    expect(factory).toHaveBeenCalledWith(config, "webgpu");
  });

  it("fails closed before replay when the selected provider differs from the persisted receipt", async () => {
    const provider = new FakeProvider();
    const factory = vi.fn(async () => provider);
    const coordinator = new StudioLivingInkStudioCoordinator({ providerFactory: factory });
    await expect(coordinator.activate({
      pageId: "page-mismatch",
      backend: "webgpu",
      config,
      expectedFinalReceipt: receipt(1, null),
    })).resolves.toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(coordinator.state).toBe("failed");
  });

  it("keeps a continuous, non-duplicated interpolation anchor across 65+ authoritative samples", async () => {
    const provider = new FakeProvider();
    const coordinator = await activated(provider);
    expect(coordinator.admitStroke({ pageId: "page-1", strokeId: "stroke-1", recipe })).toBe(true);
    expect(coordinator.pinActiveRoute("stroke-1", "route-1")).toBe(true);

    expect(coordinator.append("stroke-1", "route-1", Array.from({ length: 70 }, (_, index) => sample(index)))).toBe(true);
    const work = await coordinator.finishStroke("stroke-1", "route-1");

    const deposits = provider.operations.filter((operation) => operation.kind === "ink");
    expect(deposits).toHaveLength(9);
    expect(deposits[0]?.marks[0]?.x).toBe(0);
    expect(deposits[0]?.marks.filter((mark) => mark.x === 0 && mark.y === 10)).toHaveLength(1);
    // Operation 2 starts between the previous canonical chunk tail (7) and sample 8, proving the
    // segment is rasterized without depositing station 7 twice.
    expect(deposits[1]?.marks[0]?.x).toBeGreaterThan(7);
    expect(deposits[1]?.marks[0]?.x).toBeLessThanOrEqual(8);
    expect(deposits[2]?.marks[0]?.x).toBeGreaterThan(15);
    expect(deposits[2]?.marks[0]?.x).toBeLessThanOrEqual(16);
    expect(provider.operations.at(-1)).toMatchObject({ kind: "advance", fixedTicks: 120 });
    expect(work.journal).toHaveLength(10);
    expect(provider.simulationAcks).toHaveLength(10);
    // Nine chunks and pointer-up settle entered one queue turn. The settle invalidates all older
    // interactive readbacks, so only the final canonical frame is read back.
    expect(provider.renderCount).toBe(1);
    work.frame.image.close();
  });

  it("never reads the GPU field back while pointer chunks are still arriving", async () => {
    const provider = new FakeProvider();
    const coordinator = await activated(provider);
    coordinator.admitStroke({ pageId: "page-1", strokeId: "hot-path", recipe });
    coordinator.pinActiveRoute("hot-path", "route-hot-path");

    expect(coordinator.append(
      "hot-path",
      "route-hot-path",
      Array.from({ length: 8 }, (_, index) => sample(index)),
    )).toBe(true);
    await vi.waitFor(() => expect(provider.simulationAcks).toHaveLength(1));
    expect(provider.renderCount).toBe(0);

    expect(coordinator.append(
      "hot-path",
      "route-hot-path",
      Array.from({ length: 8 }, (_, index) => sample(index + 8)),
    )).toBe(true);
    await vi.waitFor(() => expect(provider.simulationAcks).toHaveLength(2));
    expect(provider.renderCount).toBe(0);

    const work = await coordinator.finishStroke("hot-path", "route-hot-path");
    expect(provider.renderCount).toBe(1);
    work.frame.image.close();
  });

  it("removes only the synthetic bridge anchor and preserves a real same-position dwell", async () => {
    const provider = new FakeProvider();
    const coordinator = await activated(provider);
    coordinator.admitStroke({ pageId: "page-1", strokeId: "dwell-1", recipe });
    coordinator.pinActiveRoute("dwell-1", "route-dwell");
    const samples = [
      ...Array.from({ length: 8 }, (_, index) => ({
        x: index,
        y: 10,
        pressure: 0.4,
        timeMs: index * 8,
      })),
      { x: 7, y: 10, pressure: 0.9, timeMs: 72 },
      { x: 8, y: 10, pressure: 0.9, timeMs: 80 },
    ];
    expect(coordinator.append("dwell-1", "route-dwell", samples)).toBe(true);
    const work = await coordinator.finishStroke("dwell-1", "route-dwell");
    const deposits = provider.operations.filter((operation) => operation.kind === "ink");
    expect(deposits).toHaveLength(2);
    expect(deposits[1]?.marks[0]).toMatchObject({ x: 7, y: 10, pressure: 0.9 });
    work.frame.image.close();
  });

  it("produces the same operation boundaries and final hash for 1/7/32/all input grouping", async () => {
    const run = async (groupSize: number) => {
      const provider = new FakeProvider();
      const coordinator = await activated(provider);
      coordinator.admitStroke({ pageId: "page-1", strokeId: "stroke-1", recipe });
      coordinator.pinActiveRoute("stroke-1", "route-1");
      const samples = Array.from({ length: 70 }, (_, index) => sample(index));
      for (let start = 0; start < samples.length; start += groupSize) {
        expect(coordinator.append("stroke-1", "route-1", samples.slice(start, start + groupSize))).toBe(true);
      }
      const work = await coordinator.finishStroke("stroke-1", "route-1");
      const result = { journal: work.journal, hash: work.frame.receipt.displaySha256 };
      work.frame.image.close();
      return result;
    };
    const grouped = await Promise.all([1, 7, 32, 70].map(run));
    for (const result of grouped.slice(1)) {
      expect(result.journal).toEqual(grouped[0]?.journal);
      expect(result.hash).toBe(grouped[0]?.hash);
    }
  });

  it.each(["ink", "water"] as const)(
    "fails %s closed before a 4097+ mark pointer jump can truncate the retained stroke",
    async (mode) => {
      const provider = new FakeProvider();
      const diagnostic = vi.fn();
      const coordinator = await activated(provider, { onCapacityDiagnostic: diagnostic });
      const jumpRecipe: StudioLivingInkStrokeRecipeSnapshot = {
        ...recipe,
        mode,
        baseWidth: 0.5,
        fieldScale: 1,
        pigmentLoad: mode === "water" ? 0 : recipe.pigmentLoad,
      };
      expect(coordinator.admitStroke({
        pageId: "page-1",
        strokeId: `${mode}-jump`,
        recipe: jumpRecipe,
      })).toBe(true);
      expect(coordinator.pinActiveRoute(`${mode}-jump`, `${mode}-route`)).toBe(true);
      const samples = [
        { x: 0, y: 0, pressure: 0.4, timeMs: 0 },
        { x: 2_048, y: 0, pressure: 0.7, timeMs: 16 },
        ...Array.from({ length: 6 }, (_, index) => ({
          x: 2_048 + index + 1,
          y: 0,
          pressure: 0.7,
          timeMs: 24 + index * 8,
        })),
      ];

      expect(coordinator.append(`${mode}-jump`, `${mode}-route`, samples)).toBe(false);
      expect(coordinator.capacityDiagnostic).toContain("잘린 물리 획을 저장하지 않고");
      expect(diagnostic).toHaveBeenCalledTimes(1);
      expect(provider.operations).toHaveLength(0);
      await expect(coordinator.finishStroke(
        `${mode}-jump`,
        `${mode}-route`,
      )).rejects.toThrow(/mark 한도/);
    },
  );

  it("owns admission, append, bounded settle, acceptance, and replay as one positive lifecycle", async () => {
    const first = new FakeProvider();
    const coordinator = await activated(first);
    expect(coordinator.admitStroke({ pageId: "page-1", strokeId: "stroke-1", recipe })).toBe(true);
    expect(coordinator.pinActiveRoute("stroke-1", "route-1")).toBe(true);
    expect(coordinator.append("stroke-1", "route-1", [sample(0), sample(1)])).toBe(true);
    const work = await coordinator.finishStroke("stroke-1", "route-1");
    expect(coordinator.acceptFinishedStroke(work)).toBe(true);
    work.frame.image.close();

    const replay = new FakeProvider();
    const reopened = new StudioLivingInkStudioCoordinator({ providerFactory: async () => replay });
    await expect(reopened.activate({
      pageId: "page-1",
      backend,
      config,
      journal: work.journal,
    })).resolves.toBe(true);
    expect(replay.operations).toEqual(work.journal);
    expect(replay.simulationAcks).toHaveLength(work.journal.length);
    expect(replay.simulationAcks.at(-1)).toMatchObject({
      operationKind: "advance",
      pressureIterations: 22,
    });
    expect(replay.renderCount).toBe(0);
    expect(replay.returnedFrames).toHaveLength(0);
  });

  it("routes water, Fix, and Clear through journaled, receipted operations", async () => {
    const provider = new FakeProvider();
    const coordinator = await activated(provider);
    const waterRecipe = { ...recipe, mode: "water" as const, pigmentLoad: 0, waterLoad: 0.9 };
    coordinator.admitStroke({ pageId: "page-1", strokeId: "water-1", recipe: waterRecipe });
    coordinator.pinActiveRoute("water-1", "route-water");
    coordinator.append("water-1", "route-water", Array.from({ length: 9 }, (_, index) => sample(index)));
    const waterWork = await coordinator.finishStroke("water-1", "route-water");
    expect(waterWork.journal.map(({ kind }) => kind)).toEqual(["water", "water", "advance"]);
    expect(waterWork.journal[0]).toMatchObject({ tool: "water-brush" });
    const firstWater = waterWork.journal[0];
    expect(firstWater?.kind).toBe("water");
    if (firstWater?.kind === "water") {
      expect(firstWater.marks.filter((mark) => mark.x === 0 && mark.y === 10)).toHaveLength(1);
    }
    expect(coordinator.acceptFinishedStroke(waterWork)).toBe(true);
    waterWork.frame.image.close();

    const fixWork = await coordinator.applyAction({
      routeKey: "action-fix",
      kind: "fix",
      scope: "all",
      selection: null,
    });
    expect(fixWork.journal.at(-1)).toMatchObject({
      kind: "fix",
      scope: "all",
      selection: null,
    });
    expect(coordinator.acceptAction(fixWork)).toBe(true);
    fixWork.frame.image.close();

    const clearWork = await coordinator.applyAction({
      routeKey: "action-clear",
      kind: "clear",
      scope: "all",
      selection: null,
    });
    expect(clearWork.journal.at(-1)).toMatchObject({
      kind: "clear",
      scope: "all",
      selection: null,
    });
    expect(coordinator.acceptAction(clearWork)).toBe(true);
    clearWork.frame.image.close();

    const replay = new FakeProvider();
    const reopened = new StudioLivingInkStudioCoordinator({ providerFactory: async () => replay });
    await expect(reopened.activate({
      pageId: "page-1",
      backend,
      config,
      journal: clearWork.journal,
      expectedFinalReceipt: clearWork.frame.receipt,
    })).resolves.toBe(true);
    expect(replay.operations).toEqual(clearWork.journal);
    expect(replay.operations.map(({ kind }) => kind)).toContain("fix");
  });

  it("revokes an in-flight provider before page switch without waiting for its hung operation", async () => {
    let releaseApply!: () => void;
    const oldProvider = new FakeProvider();
    oldProvider.pendingApply = new Promise<void>((resolve) => { releaseApply = resolve; });
    const nextProvider = new FakeProvider();
    const providers = [oldProvider, nextProvider];
    const coordinator = new StudioLivingInkStudioCoordinator({
      providerFactory: async () => providers.shift()!,
    });
    await coordinator.activate({ pageId: "page-1", backend, config });
    coordinator.admitStroke({ pageId: "page-1", strokeId: "stroke-1", recipe });
    coordinator.pinActiveRoute("stroke-1", "route-1");
    coordinator.append("stroke-1", "route-1", [sample(0), sample(1)]);
    await Promise.resolve();

    const switching = coordinator.activate({ pageId: "page-2", backend, config });
    await Promise.resolve();
    await expect(switching).resolves.toBe(true);
    expect(oldProvider.disposed).toHaveBeenCalledTimes(1);
    expect(coordinator.pageId).toBe("page-2");
    expect(coordinator.state).toBe("ready");
    expect(nextProvider.operations).toHaveLength(0);
    releaseApply();
    await Promise.resolve();
  });

  it("fails closed and disposes the candidate when replay receipt validation mismatches", async () => {
    const provider = new FakeProvider();
    const coordinator = new StudioLivingInkStudioCoordinator({
      providerFactory: async () => provider,
    });
    await expect(coordinator.activate({
      pageId: "page-1",
      backend,
      config,
      expectedFinalReceipt: receipt(9, null),
    })).resolves.toBe(false);
    expect(coordinator.state).toBe("failed");
    expect(provider.disposed).toHaveBeenCalledTimes(1);
  });

  it("revokes provider authority after a committed-document acceptance failure", async () => {
    const provider = new FakeProvider();
    const stateChange = vi.fn();
    const coordinator = await activated(provider, { onStateChange: stateChange });
    await coordinator.failClosed("canonical acceptance failed");

    expect(coordinator.state).toBe("failed");
    expect(provider.disposed).toHaveBeenCalledTimes(1);
    expect(stateChange).toHaveBeenLastCalledWith("failed", "canonical acceptance failed");
    expect(coordinator.admitStroke({ pageId: "page-1", strokeId: "blocked", recipe })).toBe(false);
  });

  it("disposes immediately without waiting for a hung in-flight operation", async () => {
    let releaseApply!: () => void;
    const provider = new FakeProvider();
    provider.pendingApply = new Promise<void>((resolve) => { releaseApply = resolve; });
    const coordinator = await activated(provider);
    coordinator.admitStroke({ pageId: "page-1", strokeId: "stroke-1", recipe });
    coordinator.pinActiveRoute("stroke-1", "route-1");
    coordinator.append("stroke-1", "route-1", [sample(0), sample(1)]);
    await Promise.resolve();

    const disposing = coordinator.dispose();
    await Promise.resolve();
    await expect(disposing).resolves.toBeUndefined();
    expect(provider.disposed).toHaveBeenCalledTimes(1);
    expect(coordinator.state).toBe("unavailable");
    releaseApply();
    await Promise.resolve();
  });

  it("invalidates and disposes a provider that finishes loading after physical mode is disabled", async () => {
    let resolveProvider!: (provider: FakeProvider) => void;
    const provider = new FakeProvider();
    const coordinator = new StudioLivingInkStudioCoordinator({
      providerFactory: () => new Promise<StudioLivingInkCoordinatorProvider>((resolve) => {
        resolveProvider = resolve;
      }),
    });

    const activation = coordinator.activate({ pageId: "page-1", backend, config });
    await Promise.resolve();
    expect(coordinator.state).toBe("loading");

    await expect(coordinator.dispose()).resolves.toBeUndefined();
    expect(coordinator.state).toBe("unavailable");
    expect(coordinator.pageId).toBeNull();

    resolveProvider(provider);
    await expect(activation).resolves.toBe(false);
    expect(provider.disposed).toHaveBeenCalledTimes(1);
    expect(coordinator.state).toBe("unavailable");
    expect(coordinator.pageId).toBeNull();
  });

  it("disposes the loading provider immediately when physical replay is disabled mid-operation", async () => {
    let releaseReplay!: () => void;
    const provider = new FakeProvider();
    provider.pendingApply = new Promise<void>((resolve) => { releaseReplay = resolve; });
    const coordinator = new StudioLivingInkStudioCoordinator({
      providerFactory: async () => provider,
    });
    const journal: StudioLivingInkOperation[] = [{
      kind: "advance",
      version: 1,
      sequence: 1,
      fixedTicks: 1,
    }];

    const activation = coordinator.activate({ pageId: "page-1", backend, config, journal });
    while (provider.operations.length === 0) await Promise.resolve();
    expect(coordinator.state).toBe("loading");

    await expect(coordinator.dispose()).resolves.toBeUndefined();
    expect(provider.disposed).toHaveBeenCalledTimes(1);
    expect(coordinator.state).toBe("unavailable");

    releaseReplay();
    await expect(activation).resolves.toBe(false);
    expect(provider.disposed).toHaveBeenCalledTimes(1);
    expect(coordinator.state).toBe("unavailable");
  });

  it("cancels and rebuilds committed authority without waiting for a hung apply", async () => {
    let releaseApply!: () => void;
    const oldProvider = new FakeProvider();
    oldProvider.pendingApply = new Promise<void>((resolve) => { releaseApply = resolve; });
    const rebuiltProvider = new FakeProvider();
    const providers = [oldProvider, rebuiltProvider];
    const coordinator = new StudioLivingInkStudioCoordinator({
      providerFactory: async () => providers.shift()!,
    });
    await coordinator.activate({ pageId: "page-1", backend, config });
    coordinator.admitStroke({ pageId: "page-1", strokeId: "stroke-1", recipe });
    coordinator.pinActiveRoute("stroke-1", "route-1");
    coordinator.append("stroke-1", "route-1", [sample(0), sample(1)]);
    await Promise.resolve();

    await expect(coordinator.cancelStroke("stroke-1")).resolves.toBeUndefined();
    expect(oldProvider.disposed).toHaveBeenCalledTimes(1);
    expect(coordinator.state).toBe("ready");
    expect(rebuiltProvider.operations).toHaveLength(0);
    releaseApply();
    await Promise.resolve();
  });

  it("does not let a stale action rebuild or overwrite the page selected during its hung apply", async () => {
    let releaseApply!: () => void;
    const oldProvider = new FakeProvider();
    oldProvider.pendingApply = new Promise<void>((resolve) => { releaseApply = resolve; });
    const nextProvider = new FakeProvider();
    const providers = [oldProvider, nextProvider];
    const coordinator = new StudioLivingInkStudioCoordinator({
      providerFactory: async () => providers.shift()!,
    });
    await coordinator.activate({ pageId: "page-1", backend, config });
    const action = coordinator.applyAction({
      routeKey: "stale-clear",
      kind: "clear",
      scope: "all",
      selection: null,
    });
    await Promise.resolve();

    await expect(coordinator.activate({ pageId: "page-2", backend, config })).resolves.toBe(true);
    releaseApply();
    await expect(action).rejects.toThrow(/route changed/);
    expect(coordinator.pageId).toBe("page-2");
    expect(coordinator.state).toBe("ready");
    expect(nextProvider.operations).toHaveLength(0);
  });

  it("fails closed with an explicit capacity diagnostic before a permanent journal can overflow", async () => {
    const provider = new FakeProvider();
    const diagnostic = vi.fn();
    const journal = Array.from({ length: 384 }, (_, index): StudioLivingInkOperation => ({
      kind: "advance",
      version: 1,
      sequence: index + 1,
      fixedTicks: 1,
    }));
    const coordinator = new StudioLivingInkStudioCoordinator({
      providerFactory: async () => provider,
      onCapacityDiagnostic: diagnostic,
    });
    await coordinator.activate({ pageId: "page-1", backend, config, journal });
    expect(coordinator.admitStroke({ pageId: "page-1", strokeId: "stroke-1", recipe })).toBe(false);
    expect(coordinator.capacityDiagnostic).toContain("기록 용량");
    expect(diagnostic).toHaveBeenCalledTimes(1);
  });
});
