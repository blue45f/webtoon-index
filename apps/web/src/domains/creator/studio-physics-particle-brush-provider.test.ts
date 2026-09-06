import { describe, expect, it, vi } from "vitest";

import {
  createStudioPhysicsParticleBrushProvider,
  StudioPhysicsParticleBrushError,
  type StudioPhysicsParticleBrushArtifact,
  type StudioPhysicsParticleBrushRecipe,
  type StudioPhysicsParticleBrushRequest,
  type StudioPhysicsParticleBrushReceipt,
  type StudioPhysicsParticleStrokeSample,
} from "./studio-physics-particle-brush-provider";

function commonSettings() {
  return {
    count: 3,
    spawnSpacing: 5,
    fixedTimeStepSeconds: 1 / 60,
    globalChaos: 0.5,
    localChaos: 0.25,
    chaosSmoothing: 0.65,
    damping: 0.2,
    dampingJitter: 0.1,
    directionalForce: 0.75,
    forceDirectionRadians: Math.PI / 4,
    baseRadius: 2,
    baseAlpha: 0.8,
    baseWeight: 2,
    baseGlow: 0.5,
    expressions: {
      radius: { source: "pressure" as const, minimum: 0.5, maximum: 1.5 },
      alpha: { source: "pressure" as const, minimum: 0, maximum: 1 },
      weight: { source: "tilt" as const, minimum: 0.25, maximum: 1 },
      glow: { source: "speed" as const, minimum: 0, maximum: 2 },
      force: { source: "pressure" as const, minimum: 0.5, maximum: 1.5 },
      chaos: { source: "speed" as const, minimum: 0.5, maximum: 1.5 },
    },
  };
}

function orbitalRecipe(
  overrides: Partial<StudioPhysicsParticleBrushRecipe> = {},
): StudioPhysicsParticleBrushRecipe {
  return {
    mode: "orbital",
    seed: 123_456,
    common: commonSettings(),
    orbital: {
      steps: 4,
      velocity: 8,
      acceleration: -2,
      spin: 1.25,
      orbitRadius: 3,
      orbitRadiusJitter: 0.2,
    },
    ...overrides,
  };
}

function flowRecipe(): StudioPhysicsParticleBrushRecipe {
  return {
    mode: "flow",
    seed: 77,
    common: commonSettings(),
    flow: {
      lifetimeSteps: 5,
      velocity: 12,
      positionJitter: 2,
      flowHeightGain: 4,
      flowTangentGain: 3,
    },
  };
}

function springRecipe(
  topology: "radial" | "chain" | "ring" = "ring",
): StudioPhysicsParticleBrushRecipe {
  return {
    mode: "spring-net",
    seed: 999,
    common: { ...commonSettings(), count: 4 },
    springNet: {
      topology,
      steps: 4,
      initialRadius: 5,
      stiffness: 12,
      springDamping: 0.75,
      restLength: 3,
      restLengthJitter: 0.2,
      emitConnectors: true,
      connectorAlpha: 0.35,
      connectorWeight: 1.5,
      connectorGlow: 0.2,
    },
  };
}

function cooperativeRecipe(): StudioPhysicsParticleBrushRecipe {
  return {
    ...orbitalRecipe(),
    common: {
      ...commonSettings(),
      count: 64,
      spawnSpacing: 1,
    },
    orbital: {
      ...orbitalRecipe().orbital!,
      steps: 32,
    },
  };
}

const SPARSE_SAMPLES: readonly StudioPhysicsParticleStrokeSample[] = [
  { x: 0, y: 0, pressure: 0.25, speed: 0.2, tiltX: 0, tiltY: 0 },
  { x: 10, y: 0, pressure: 0.75, speed: 0.8, tiltX: 1, tiltY: 0 },
];

function artifactOf(
  receipt: StudioPhysicsParticleBrushReceipt,
): StudioPhysicsParticleBrushArtifact {
  if (!receipt.artifact) throw new Error("Expected a complete artifact.");
  return receipt.artifact;
}

function expectFinite(values: Float32Array): void {
  expect([...values].every(Number.isFinite)).toBe(true);
}

function request(
  recipe: StudioPhysicsParticleBrushRecipe = orbitalRecipe(),
  overrides: Partial<StudioPhysicsParticleBrushRequest> = {},
): StudioPhysicsParticleBrushRequest {
  return {
    recipe,
    samples: SPARSE_SAMPLES,
    epoch: 0,
    ...overrides,
  };
}

describe("Studio physics particle brush CPU oracle", () => {
  it("renders deterministic orbital paths with exact expression metadata", async () => {
    const first = await createStudioPhysicsParticleBrushProvider()
      .render(request());
    const second = await createStudioPhysicsParticleBrushProvider()
      .render(request());
    const artifact = artifactOf(first);

    expect(first).toMatchObject({
      status: "complete",
      execution: "rebuild",
      mode: "orbital",
      spawnCount: 3,
      appendedSpawnCount: 3,
      pathPointCount: 36,
      connectorSegmentCount: 0,
      failureCode: null,
    });
    expect(artifact.path.positions).toBeInstanceOf(Float32Array);
    expect(artifact.path.particleIndices).toBeInstanceOf(Uint32Array);
    expect(artifact.deposition.alpha).toBeInstanceOf(Float32Array);
    expect(artifact.connectors).toBeNull();
    expect(artifact.compositing).toEqual({
      alpha: "straight-unassociated-coverage",
      weight: "normalized-path-weight",
      glow: "additive-linear-energy",
      connectorAlpha: "straight-unassociated-coverage",
    });
    expect(artifact.deposition.radius[0]).toBe(Math.fround(1.5));
    expect(artifact.deposition.alpha[0]).toBe(Math.fround(0.2));
    expect(artifact.deposition.weight[0]).toBe(Math.fround(0.5));
    expect(artifact.deposition.glow[0]).toBe(Math.fround(0.2));
    expectFinite(artifact.path.positions);
    expectFinite(artifact.deposition.radius);
    expect(artifact.artifactHash).toBe(artifactOf(second).artifactHash);
    expect(artifact.replayFingerprint).toBe(
      artifactOf(second).replayFingerprint,
    );
    expect(first.receiptHash).toBe(second.receiptHash);
  });

  it("is independent from redundant input-event density", async () => {
    const denseSamples: readonly StudioPhysicsParticleStrokeSample[] = [
      SPARSE_SAMPLES[0],
      {
        x: 2.5,
        y: 0,
        pressure: 0.375,
        speed: 0.35,
        tiltX: 0.25,
        tiltY: 0,
      },
      {
        x: 5,
        y: 0,
        pressure: 0.5,
        speed: 0.5,
        tiltX: 0.5,
        tiltY: 0,
      },
      {
        x: 7.5,
        y: 0,
        pressure: 0.625,
        speed: 0.65,
        tiltX: 0.75,
        tiltY: 0,
      },
      SPARSE_SAMPLES[1],
    ];
    const sparse = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(request()),
    );
    const dense = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(
        request(orbitalRecipe(), { samples: denseSamples }),
      ),
    );

    expect(dense.strokeFingerprint).toBe(sparse.strokeFingerprint);
    expect(dense.replayFingerprint).toBe(sparse.replayFingerprint);
    expect(dense.artifactHash).toBe(sparse.artifactHash);
    expect(dense.emitterStations).toEqual(sparse.emitterStations);
    expect(dense.path.positions).toEqual(sparse.path.positions);
  });

  it("uses caller-owned height fields through gradient and tangent forces without retaining them", async () => {
    const heights = new Float32Array([
      0, 1, 2,
      1, 2, 3,
      2, 3, 4,
    ]);
    const flowField = {
      width: 3,
      height: 3,
      originX: 0,
      originY: -5,
      cellSize: 5,
      heights,
    };
    const provider = createStudioPhysicsParticleBrushProvider();
    const pending = provider.render(request(flowRecipe(), { flowField }));
    heights.fill(1_000);
    const withFlow = artifactOf(await pending);
    const withoutFlow = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(
        request(flowRecipe()),
      ),
    );

    expect(withFlow.flowFieldHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(withFlow.path.positions).not.toEqual(withoutFlow.path.positions);
    expectFinite(withFlow.path.positions);
    expectFinite(withFlow.deposition.alpha);
    expect(withFlow.deposition.alpha[0]).toBeGreaterThan(
      withFlow.deposition.alpha.at(-1) ?? 1,
    );
    expect(withFlow.path.positions.length).toBe(3 * 5 * 3 * 2);
  });

  it.each([
    ["radial", 3],
    ["chain", 3],
    ["ring", 4],
  ] as const)(
    "emits %s spring-net connector topology and independent connector metadata",
    async (topology, edgesPerStep) => {
      const receipt = await createStudioPhysicsParticleBrushProvider()
        .render(request(springRecipe(topology)));
      const artifact = artifactOf(receipt);
      const connectors = artifact.connectors;
      expect(connectors).not.toBeNull();
      if (!connectors) throw new Error("Expected spring connectors.");
      expect(receipt.connectorSegmentCount).toBe(3 * 4 * edgesPerStep);
      expect(connectors.segments.length).toBe(
        receipt.connectorSegmentCount * 4,
      );
      expect([...new Set(connectors.alpha)]).toEqual([Math.fround(0.35)]);
      expect([...new Set(connectors.weight)]).toEqual([Math.fround(1.5)]);
      expect([...new Set(connectors.glow)]).toEqual([Math.fround(0.2)]);
      expect(connectors.spawnIndices.at(-1)).toBe(2);
      expect(connectors.stepIndices.at(-1)).toBe(3);
      expectFinite(artifact.path.positions);
      expectFinite(connectors.segments);
    },
  );

  it("changes deterministic replay when the seed changes", async () => {
    const first = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(request()),
    );
    const second = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(
        request(orbitalRecipe({ seed: 123_457 })),
      ),
    );
    expect(first.recipeFingerprint).not.toBe(second.recipeFingerprint);
    expect(first.artifactHash).not.toBe(second.artifactHash);
    expect(first.path.positions).not.toEqual(second.path.positions);
  });

  it.each([
    ["orbital", orbitalRecipe()],
    ["flow", flowRecipe()],
    ["spring-net", springRecipe()],
  ] as const)(
    "provides exact prefix-validated %s append/rebuild parity",
    async (_mode, recipe) => {
      const partialSamples = [
        SPARSE_SAMPLES[0],
        {
          x: 5,
          y: 0,
          pressure: 0.5,
          speed: 0.5,
          tiltX: 0.5,
          tiltY: 0,
        },
      ];
      const partial = artifactOf(
        await createStudioPhysicsParticleBrushProvider().render(
          request(recipe, { samples: partialSamples }),
        ),
      );
      const appendedReceipt = await createStudioPhysicsParticleBrushProvider()
        .render(request(recipe, {
          append: { previous: partial },
        }));
      const rebuiltReceipt = await createStudioPhysicsParticleBrushProvider()
        .render(request(recipe));
      const appended = artifactOf(appendedReceipt);
      const rebuilt = artifactOf(rebuiltReceipt);

      expect(appendedReceipt).toMatchObject({
        status: "complete",
        execution: "append",
        appendPolicy: "prefix-validated-fixed-station-exact",
        appendSourceArtifactHash: partial.artifactHash,
        spawnCount: 3,
        appendedSpawnCount: 1,
      });
      expect(rebuiltReceipt.appendSourceArtifactHash).toBeNull();
      expect(appended.artifactHash).toBe(rebuilt.artifactHash);
      expect(appended.replayFingerprint).toBe(rebuilt.replayFingerprint);
      expect(appended.path).toEqual(rebuilt.path);
      expect(appended.deposition).toEqual(rebuilt.deposition);
      expect(appended.connectors).toEqual(rebuilt.connectors);
    },
  );

  it("fails closed when an append prefix or previous artifact hash was changed", async () => {
    const partial = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(
        request(orbitalRecipe(), {
          samples: [SPARSE_SAMPLES[0], { ...SPARSE_SAMPLES[1], x: 5 }],
        }),
      ),
    );
    await expect(
      createStudioPhysicsParticleBrushProvider().render(
        request(orbitalRecipe(), {
          samples: [
            { ...SPARSE_SAMPLES[0], y: 1 },
            { ...SPARSE_SAMPLES[1], y: 1 },
          ],
          append: { previous: partial },
        }),
      ),
    ).rejects.toMatchObject({ code: "append-mismatch" });

    partial.path.positions[0] += 1;
    await expect(
      createStudioPhysicsParticleBrushProvider().render(
        request(orbitalRecipe(), { append: { previous: partial } }),
      ),
    ).rejects.toMatchObject({ code: "integrity-mismatch" });
  });

  it.each([
    orbitalRecipe({ common: { ...commonSettings(), count: 257 } }),
    orbitalRecipe({ common: { ...commonSettings(), spawnSpacing: 0 } }),
    orbitalRecipe({ seed: Number.NaN }),
  ])("rejects malformed or excessive recipes before simulation", async (recipe) => {
    const provider = createStudioPhysicsParticleBrushProvider();
    await expect(provider.render(request(recipe))).rejects.toBeInstanceOf(
      StudioPhysicsParticleBrushError,
    );
    expect(provider.snapshot()).toMatchObject({ sequence: 0, active: false });
  });

  it("fails input and fixed-work budgets before admitting a simulation", async () => {
    const provider = createStudioPhysicsParticleBrushProvider();
    const excessiveInput = new Array(100_001).fill(SPARSE_SAMPLES[0]);
    await expect(
      provider.render(request(orbitalRecipe(), { samples: excessiveInput })),
    ).rejects.toMatchObject({ code: "budget-exceeded" });
    await expect(
      provider.render(request(
        orbitalRecipe({
          common: { ...commonSettings(), spawnSpacing: 0.01 },
        }),
        {
          samples: [
            { ...SPARSE_SAMPLES[0], x: 0 },
            { ...SPARSE_SAMPLES[1], x: 1_000_000_000 },
          ],
        },
      )),
    ).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(provider.snapshot()).toMatchObject({ sequence: 0, active: false });
  });

  it("returns fail-closed receipts for abort, stale epoch, and dispose", async () => {
    const abortController = new AbortController();
    const abortProvider = createStudioPhysicsParticleBrushProvider();
    const aborted = abortProvider.render(
      request(orbitalRecipe(), { signal: abortController.signal }),
    );
    abortController.abort();
    await expect(aborted).rejects.toMatchObject({
      code: "aborted",
      receipt: { status: "fail-closed", failureCode: "aborted" },
    });

    const staleProvider = createStudioPhysicsParticleBrushProvider({ epoch: 4 });
    const stale = staleProvider.render(
      request(orbitalRecipe(), { epoch: 4 }),
    );
    staleProvider.setEpoch(5);
    await expect(stale).rejects.toMatchObject({
      code: "epoch-mismatch",
      receipt: { status: "fail-closed", failureCode: "epoch-mismatch" },
    });

    const disposedProvider = createStudioPhysicsParticleBrushProvider();
    const disposed = disposedProvider.render(request());
    disposedProvider.dispose();
    await expect(disposed).rejects.toMatchObject({
      code: "disposed",
      receipt: { status: "fail-closed", failureCode: "disposed" },
    });
    expect(disposedProvider.snapshot()).toMatchObject({
      state: "disposed",
      active: false,
    });
  });

  it("backpressures concurrent simulations and advances admitted sequences only", async () => {
    const provider = createStudioPhysicsParticleBrushProvider();
    const first = provider.render(request());
    await expect(provider.render(request())).rejects.toMatchObject({
      code: "backpressure",
    });
    const firstReceipt = await first;
    const secondReceipt = await provider.render(request());
    expect(firstReceipt.sequence).toBe(1);
    expect(secondReceipt.sequence).toBe(2);
  });

  it("returns detached typed-array artifacts and stable receipt hashes", async () => {
    const mutableSamples = SPARSE_SAMPLES.map((sample) => ({ ...sample }));
    const baseRecipe = orbitalRecipe();
    const mutableRecipe = {
      ...baseRecipe,
      common: { ...baseRecipe.common },
    };
    const provider = createStudioPhysicsParticleBrushProvider();
    const pending = provider.render(
      request(mutableRecipe, { samples: mutableSamples }),
    );
    mutableSamples[0].x = 999;
    mutableRecipe.common.count = 1;
    const receipt = await pending;
    const artifact = artifactOf(receipt);

    expect(receipt.spawnCount).toBe(3);
    expect(artifact.count).toBe(3);
    expect(artifact.emitterStations[0]).toBe(0);
    expect(artifact.path.positions.buffer).not.toBe(
      artifact.deposition.positions.buffer,
    );
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("keeps ordinary strokes off the cooperative host-timer path", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    try {
      await expect(
        createStudioPhysicsParticleBrushProvider().render(request()),
      ).resolves.toMatchObject({ status: "complete" });
      expect(timeout).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it("recovers from hostile AbortSignal registration and cleanup methods", async () => {
    const addFailureProvider = createStudioPhysicsParticleBrushProvider();
    const addFailureSignal = {
      aborted: false,
      addEventListener(): never {
        throw new Error("hostile add");
      },
      removeEventListener(): never {
        throw new Error("hostile remove");
      },
    } as unknown as AbortSignal;
    await expect(
      addFailureProvider.render(request(orbitalRecipe(), {
        signal: addFailureSignal,
      })),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(addFailureProvider.snapshot()).toMatchObject({
      sequence: 0,
      active: false,
    });
    await expect(addFailureProvider.render(request())).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
    });

    const removeFailureProvider = createStudioPhysicsParticleBrushProvider();
    const removeFailureSignal = {
      aborted: false,
      addEventListener(): void {
        // Registration succeeds; cleanup is intentionally hostile.
      },
      removeEventListener(): never {
        throw new Error("hostile remove");
      },
    } as unknown as AbortSignal;
    await expect(
      removeFailureProvider.render(request(orbitalRecipe(), {
        signal: removeFailureSignal,
      })),
    ).resolves.toMatchObject({ status: "complete", sequence: 1 });
    expect(removeFailureProvider.snapshot()).toMatchObject({
      active: false,
    });
    await expect(
      removeFailureProvider.render(request()),
    ).resolves.toMatchObject({ status: "complete", sequence: 2 });
  });

  it("rechecks abort state after registration and rolls provisional ownership back", async () => {
    const provider = createStudioPhysicsParticleBrushProvider();
    const external = new AbortController();
    const originalAdd = external.signal.addEventListener;
    Object.defineProperty(external.signal, "addEventListener", {
      configurable: true,
      value(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void {
        external.abort();
        originalAdd.call(this, type, listener, options);
      },
    });

    await expect(provider.render(request(orbitalRecipe(), {
      signal: external.signal,
    }))).rejects.toMatchObject({ code: "aborted" });
    expect(provider.snapshot()).toMatchObject({
      active: false,
      sequence: 0,
    });
    await expect(provider.render(request())).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
    });
  });

  it("claims provisional ownership before caller-controlled request and signal callbacks", async () => {
    const provider = createStudioPhysicsParticleBrushProvider();
    let getterReentry:
      | Promise<StudioPhysicsParticleBrushReceipt>
      | undefined;
    const getterRequest = {
      recipe: orbitalRecipe(),
      samples: SPARSE_SAMPLES,
      epoch: 0,
      get signal(): undefined {
        getterReentry = provider.render(request());
        return undefined;
      },
    };
    await expect(provider.render(getterRequest)).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
    });
    await expect(getterReentry).rejects.toMatchObject({
      code: "backpressure",
    });

    let addReentry:
      | Promise<StudioPhysicsParticleBrushReceipt>
      | undefined;
    const callbackSignal = {
      aborted: false,
      addEventListener(): void {
        addReentry = provider.render(request());
      },
      removeEventListener(): void {},
    } as unknown as AbortSignal;
    await expect(provider.render(request(orbitalRecipe(), {
      signal: callbackSignal,
    }))).resolves.toMatchObject({ status: "complete", sequence: 2 });
    await expect(addReentry).rejects.toMatchObject({
      code: "backpressure",
    });
    expect(provider.snapshot()).toMatchObject({
      active: false,
      sequence: 2,
    });
  });

  it("rejects malformed signal contracts before admission", async () => {
    const provider = createStudioPhysicsParticleBrushProvider();
    await expect(provider.render(request(orbitalRecipe(), {
      signal: {
        aborted: false,
      } as unknown as AbortSignal,
    }))).rejects.toMatchObject({ code: "invalid-request" });
    expect(provider.snapshot()).toMatchObject({
      active: false,
      sequence: 0,
    });
    await expect(provider.render(request())).resolves.toMatchObject({
      status: "complete",
      sequence: 1,
    });
  });

  it("rejects hostile oversized flow metadata before touching its payload", async () => {
    let payloadTouched = false;
    const hostileFlow = {
      width: 65_536,
      height: 65_536,
      originX: 0,
      originY: 0,
      cellSize: 1,
      get heights(): Float32Array {
        payloadTouched = true;
        throw new Error("payload must not be cloned or hashed");
      },
    } as StudioPhysicsParticleBrushRequest["flowField"];
    const provider = createStudioPhysicsParticleBrushProvider();
    await expect(provider.render(request(flowRecipe(), {
      flowField: hostileFlow,
    }))).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(payloadTouched).toBe(false);
    expect(provider.snapshot()).toMatchObject({
      active: false,
      sequence: 0,
    });
  });

  it("rejects hostile previous byte metadata before touching artifact arrays", async () => {
    const partial = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(
        request(orbitalRecipe(), {
          samples: [
            SPARSE_SAMPLES[0],
            {
              x: 5,
              y: 0,
              pressure: 0.5,
              speed: 0.5,
              tiltX: 0.5,
              tiltY: 0,
            },
          ],
        }),
      ),
    );
    let arraysTouched = false;
    const hostile = {
      ...partial,
      outputBytes: partial.outputBytes + 4,
    };
    Object.defineProperty(hostile, "emitterStations", {
      configurable: true,
      get(): never {
        arraysTouched = true;
        throw new Error("array must not be cloned or hashed");
      },
    });
    Object.defineProperty(hostile, "path", {
      configurable: true,
      get(): never {
        arraysTouched = true;
        throw new Error("array must not be cloned or hashed");
      },
    });
    const provider = createStudioPhysicsParticleBrushProvider();
    await expect(provider.render(request(orbitalRecipe(), {
      append: {
        previous: hostile as StudioPhysicsParticleBrushArtifact,
      },
    }))).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(arraysTouched).toBe(false);
    expect(provider.snapshot()).toMatchObject({
      active: false,
      sequence: 0,
    });
  });

  it("captures each previous artifact plane once before clone and integrity checks", async () => {
    const partial = artifactOf(
      await createStudioPhysicsParticleBrushProvider().render(
        request(orbitalRecipe(), {
          samples: [
            SPARSE_SAMPLES[0],
            {
              x: 5,
              y: 0,
              pressure: 0.5,
              speed: 0.5,
              tiltX: 0.5,
              tiltY: 0,
            },
          ],
        }),
      ),
    );
    const guarded = { ...partial };
    let pathReads = 0;
    Object.defineProperty(guarded, "path", {
      configurable: true,
      enumerable: true,
      get(): StudioPhysicsParticleBrushArtifact["path"] {
        pathReads += 1;
        if (pathReads > 1) throw new Error("path getter was read twice");
        return partial.path;
      },
    });
    const appended = await createStudioPhysicsParticleBrushProvider().render(
      request(orbitalRecipe(), {
        append: {
          previous: guarded as StudioPhysicsParticleBrushArtifact,
        },
      }),
    );
    const rebuilt = await createStudioPhysicsParticleBrushProvider().render(
      request(),
    );
    expect(pathReads).toBe(1);
    expect(appended.artifactHash).toBe(rebuilt.artifactHash);
    expect(appended.artifact?.path.positions).toEqual(
      rebuilt.artifact?.path.positions,
    );
  });

  it("observes abort after cooperative simulation work and recovers", async () => {
    const provider = createStudioPhysicsParticleBrushProvider();
    const controller = new AbortController();
    const pending = provider.render(request(cooperativeRecipe(), {
      samples: [
        { ...SPARSE_SAMPLES[0], x: 0 },
        { ...SPARSE_SAMPLES[1], x: 200 },
      ],
      signal: controller.signal,
    }));
    setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toMatchObject({
      code: "aborted",
      receipt: { status: "fail-closed", failureCode: "aborted" },
    });
    expect(provider.snapshot()).toMatchObject({
      state: "ready",
      active: false,
      sequence: 1,
    });
    await expect(provider.render(request())).resolves.toMatchObject({
      status: "complete",
      sequence: 2,
    });
  });

  it("keeps large artifact hashing abortible after the final simulation yield", async () => {
    const provider = createStudioPhysicsParticleBrushProvider();
    const controller = new AbortController();
    const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
    let cooperativeYieldCount = 0;
    const timeout = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (handler, delay, ...arguments_) => {
        cooperativeYieldCount += 1;
        const result = originalSetTimeout(handler, delay, ...arguments_);
        if (cooperativeYieldCount === 3) {
          originalSetTimeout(() => controller.abort(), 0);
        }
        return result;
      },
    );
    try {
      await expect(provider.render(request(cooperativeRecipe(), {
        samples: [
          { ...SPARSE_SAMPLES[0], x: 0 },
          { ...SPARSE_SAMPLES[1], x: 200 },
        ],
        signal: controller.signal,
      }))).rejects.toMatchObject({
        code: "aborted",
        receipt: { status: "fail-closed", failureCode: "aborted" },
      });
      expect(cooperativeYieldCount).toBe(3);
      expect(provider.snapshot()).toMatchObject({
        active: false,
        sequence: 1,
      });
    } finally {
      timeout.mockRestore();
    }
  });

  it("observes epoch and dispose transitions during cooperative work", async () => {
    const samples = [
      { ...SPARSE_SAMPLES[0], x: 0 },
      { ...SPARSE_SAMPLES[1], x: 200 },
    ];
    const epochProvider = createStudioPhysicsParticleBrushProvider();
    const stale = epochProvider.render(request(cooperativeRecipe(), {
      samples,
    }));
    setTimeout(() => epochProvider.setEpoch(1), 0);
    await expect(stale).rejects.toMatchObject({
      code: "epoch-mismatch",
      receipt: {
        status: "fail-closed",
        failureCode: "epoch-mismatch",
      },
    });
    expect(epochProvider.snapshot()).toMatchObject({
      epoch: 1,
      active: false,
      sequence: 1,
    });
    await expect(epochProvider.render(request(orbitalRecipe(), {
      epoch: 1,
    }))).resolves.toMatchObject({ status: "complete", sequence: 2 });

    const disposedProvider = createStudioPhysicsParticleBrushProvider();
    const disposed = disposedProvider.render(request(cooperativeRecipe(), {
      samples,
    }));
    setTimeout(() => disposedProvider.dispose(), 0);
    await expect(disposed).rejects.toMatchObject({
      code: "disposed",
      receipt: { status: "fail-closed", failureCode: "disposed" },
    });
    expect(disposedProvider.snapshot()).toMatchObject({
      state: "disposed",
      active: false,
      sequence: 1,
    });
  });

  it("cancels and settles a pending cooperative timer without advancing fake time", async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    try {
      const provider = createStudioPhysicsParticleBrushProvider();
      const pending = provider.render(request(cooperativeRecipe(), {
        samples: [
          { ...SPARSE_SAMPLES[0], x: 0 },
          { ...SPARSE_SAMPLES[1], x: 200 },
        ],
      }));

      expect(vi.getTimerCount()).toBeGreaterThan(0);
      provider.dispose();
      await expect(pending).rejects.toMatchObject({
        code: "disposed",
        receipt: { status: "fail-closed", failureCode: "disposed" },
      });
      expect(clear).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(provider.snapshot()).toMatchObject({
        state: "disposed",
        active: false,
      });
    } finally {
      clear.mockRestore();
      vi.useRealTimers();
    }
  });
});
