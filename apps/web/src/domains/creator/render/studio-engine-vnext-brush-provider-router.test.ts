import { describe, expect, it, vi, type Mock } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "../brush/studio-brush-dynamics";

import {
  STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS,
  StudioEngineVNextBrushProviderRouter,
  type StudioEngineVNextBrushProvider,
  type StudioEngineVNextBrushProviderCapability,
  type StudioEngineVNextBrushProviderDescriptor,
  type StudioEngineVNextBrushProviderExecution,
} from "./studio-engine-vnext-brush-provider-router";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason?: unknown) => void;
}

interface TestProvider extends StudioEngineVNextBrushProvider {
  readonly executions: StudioEngineVNextBrushProviderExecution[];
  readonly execute: Mock<(
    execution: StudioEngineVNextBrushProviderExecution,
    signal: AbortSignal,
  ) => Promise<unknown>>;
  readonly notifyDeviceLoss: Mock<(
    input: Readonly<{ deviceEpoch: number; reason: string }>,
  ) => void>;
  readonly dispose: Mock<() => void>;
}

const ANALYTIC_CAPABILITIES = [
  "tip:analytic",
  "grain:none",
  "media:dry",
  "color:linear-srgb",
  "porter-duff:source-over",
  "blend:normal",
  "intent:canonical",
] as const satisfies readonly StudioEngineVNextBrushProviderCapability[];

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function brushPlan(
  commandSequence = 1,
  overrides: Readonly<{
    tip?: unknown;
    grain?: unknown;
    engine?: "dab-v1" | "wet-media-v1";
    material?: "ink" | "pigment";
    wetMedia?: unknown;
    colorSpace?: "linear-srgb" | "linear-display-p3";
    porterDuff?: "source-over" | "destination-out";
    blendMode?:
      | "normal"
      | "multiply"
      | "screen"
      | "overlay"
      | "darken"
      | "lighten";
  }> = {},
): Record<string, unknown> {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 11,
    commandSequence,
    strokeId: `provider-router-stroke-${commandSequence}`,
    seed: commandSequence,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: overrides.colorSpace ?? "linear-srgb",
      alphaMode: "straight",
      components: [0.1, 0.2, 0.3, 1],
    },
    composite: {
      porterDuff: overrides.porterDuff ?? "source-over",
      blendMode: overrides.blendMode ?? "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: `provider-router-brush-${commandSequence}`,
      engine: overrides.engine ?? "dab-v1",
      material: overrides.material ?? "ink",
      tip: overrides.tip ?? {
        kind: "analytic",
        shape: "round",
        edgeSoftness: 0.1,
      },
      size: 4,
      flow: 1,
      hardness: 1,
      spacingRatio: 0.2,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: overrides.grain ?? null,
      wetMedia: overrides.wetMedia ?? null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 2,
      samples: [
        {
          role: "authoritative",
          sequence: 1,
          x: 1,
          y: 1,
          pressure: 0.5,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 1,
          pointerId: 1,
          flags: 0,
        },
        {
          role: "authoritative",
          sequence: 2,
          x: 4,
          y: 3,
          pressure: 1,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 2,
          pointerId: 1,
          flags: 0,
        },
      ],
    },
  };
}

function request(
  requestSequence = 1,
  overrides: Readonly<{
    intent?: "canonical" | "professional" | "bristle-rake";
    canonicalPlan?: unknown;
    extension?: unknown;
    sessionEpoch?: number;
    deviceEpoch?: number;
    resizeEpoch?: number;
  }> = {},
): Record<string, unknown> {
  const intent = overrides.intent ?? "canonical";
  return {
    kind: "studio-engine-vnext-brush-provider/request",
    version: 1,
    requestSequence,
    sessionEpoch: overrides.sessionEpoch ?? 7,
    strokeEpoch: 11,
    deviceEpoch: overrides.deviceEpoch ?? 5,
    resizeEpoch: overrides.resizeEpoch ?? 3,
    intent,
    canonicalPlan:
      overrides.canonicalPlan ?? brushPlan(requestSequence),
    extension:
      overrides.extension ?? (intent === "canonical"
        ? null
        : { specialist: intent }),
  };
}

function completedResult(
  descriptor: StudioEngineVNextBrushProviderDescriptor,
  execution: StudioEngineVNextBrushProviderExecution,
  overrides: Readonly<{
    proof?: Readonly<Record<string, unknown>>;
    output?: unknown;
  }> = {},
): Record<string, unknown> {
  return {
    status: "completed",
    proof: overrides.proof ?? {
      kind: "studio-engine-vnext-brush-provider/proof",
      version: 1,
      providerId: execution.providerId,
      providerVersion: execution.providerVersion,
      providerPriority: descriptor.priority,
      globalRequestSequence: execution.globalRequestSequence,
      providerLocalSequence: execution.providerLocalSequence,
      sessionEpoch: execution.sessionEpoch,
      strokeEpoch: execution.strokeEpoch,
      deviceEpoch: execution.deviceEpoch,
      resizeEpoch: execution.resizeEpoch,
      canonicalPlanHash: execution.canonicalPlanHash,
      requiredCapabilities: execution.requiredCapabilities,
      executionDigest:
        `digest:${descriptor.id}:${execution.providerLocalSequence}`,
    },
    output: overrides.output ?? {
      providerId: descriptor.id,
      providerLocalSequence: execution.providerLocalSequence,
    },
  };
}

function testProvider(
  id: string,
  capabilities: readonly StudioEngineVNextBrushProviderCapability[],
  options: Readonly<{
    priority?: number;
    execute?: (
      execution: StudioEngineVNextBrushProviderExecution,
      signal: AbortSignal,
      descriptor: StudioEngineVNextBrushProviderDescriptor,
    ) => Promise<unknown> | unknown;
  }> = {},
): TestProvider {
  const descriptor = {
    id,
    version: 1,
    priority: options.priority ?? 10,
    capabilities: [...capabilities],
  };
  const executions: StudioEngineVNextBrushProviderExecution[] = [];
  const execute = vi.fn(
    async (
      execution: StudioEngineVNextBrushProviderExecution,
      signal: AbortSignal,
    ) => {
      executions.push(execution);
      return options.execute
        ? options.execute(execution, signal, descriptor)
        : completedResult(descriptor, execution);
    },
  );
  return {
    descriptor,
    executions,
    execute,
    notifyDeviceLoss: vi.fn(),
    dispose: vi.fn(),
  };
}

function router(
  providers: readonly StudioEngineVNextBrushProvider[],
  maxPendingRequests?: number,
): StudioEngineVNextBrushProviderRouter {
  return new StudioEngineVNextBrushProviderRouter({
    sessionEpoch: 7,
    deviceEpoch: 5,
    resizeEpoch: 3,
    providers,
    ...(maxPendingRequests === undefined ? {} : { maxPendingRequests }),
  });
}

function texturedPlan(commandSequence: number): Record<string, unknown> {
  return brushPlan(commandSequence, {
    tip: {
      kind: "texture",
      assetId: "textured-tip",
      contentHash: `sha256:${"a".repeat(64)}`,
      channel: "alpha",
      width: 16,
      height: 16,
    },
    grain: {
      kind: "texture",
      assetId: "paper-grain",
      contentHash: `sha256:${"b".repeat(64)}`,
      space: "document",
      scale: 4,
      depth: 0.3,
      contrast: 0.5,
      seed: 9,
    },
  });
}

function wetPlan(commandSequence: number): Record<string, unknown> {
  return brushPlan(commandSequence, {
    engine: "wet-media-v1",
    material: "pigment",
    wetMedia: {
      model: "pigment-water-v1",
      fieldScale: 2,
      fixedRateHz: 120,
      simulationSteps: 8,
      absorption: 0.2,
      bleed: 0.3,
      dryingRate: 0.4,
      edgeDarkening: 0.5,
      fixationRate: 0.2,
      granulation: 0.3,
      paperRoughness: 0.4,
      pigmentLoad: 0.8,
      waterLoad: 0.7,
      wetnessLoad: 0.9,
    },
  });
}

function boundedFlowPlan(commandSequence: number): Record<string, unknown> {
  const result = brushPlan(commandSequence, {
    material: "ink",
  });
  const recipe = (result.recipe as Record<string, unknown>);
  recipe.version = 2;
  recipe.paint = {
    model: "bounded-flow-v2",
    depositionAlpha: "flow-times-dab-opacity",
    accumulation: "source-over-stroke-local-rgba",
    finalCompositeOpacity: "plan-composite-opacity-once",
    surface: "bounded-sparse-rgba-tiles",
  };
  recipe.retainedDynamics = normalizeStudioBrushDynamicsSettings({
    depositPipeline: "causal-deposit-v3-segmented",
    seed: 202,
    spacingRatio: 0.145,
    scatterRatio: 0.04,
    tip: { shape: "soft", softness: 0.42 },
    width: {
      base: 4,
      mappings: [{ source: "pressure", from: 0.7, to: 1.25 }],
      jitter: { mode: "multiply", amount: 0.1 },
    },
  });
  return result;
}

describe("StudioEngineVNextBrushProviderRouter", () => {
  it("requires explicit stroke-local paint and retained-dynamics capabilities for recipe v2", async () => {
    const legacyOnly = testProvider("legacy-only", ANALYTIC_CAPABILITIES);
    const unsupported = router([legacyOnly]);
    await expect(unsupported.submit(request(1, {
      canonicalPlan: boundedFlowPlan(1),
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "unsupported",
      consumed: false,
    });
    expect(legacyOnly.execute).not.toHaveBeenCalled();

    const paintAware = testProvider("paint-aware", [
      ...ANALYTIC_CAPABILITIES,
      "paint:stroke-local",
      "dynamics:retained",
    ]);
    const supported = router([paintAware]);
    await expect(supported.submit(request(1, {
      canonicalPlan: boundedFlowPlan(1),
    }))).resolves.toMatchObject({
      status: "completed",
      consumed: true,
      proof: {
        providerId: "paint-aware",
        requiredCapabilities: [
          "tip:analytic",
          "grain:none",
          "media:dry",
          "color:linear-srgb",
          "porter-duff:source-over",
          "blend:normal",
          "paint:stroke-local",
          "dynamics:retained",
          "intent:canonical",
        ],
      },
    });
  });

  it("routes analytic, textured, wet, and bristle intents deterministically", async () => {
    const analytic = testProvider("analytic", ANALYTIC_CAPABILITIES);
    const textured = testProvider("textured", [
      "tip:texture",
      "grain:texture",
      "media:dry",
      "color:linear-srgb",
      "porter-duff:source-over",
      "blend:normal",
      "intent:professional",
    ]);
    const wet = testProvider("wet", [
      "tip:analytic",
      "grain:none",
      "media:wet",
      "color:linear-srgb",
      "porter-duff:source-over",
      "blend:normal",
      "intent:canonical",
    ]);
    const bristle = testProvider("bristle", [
      "tip:analytic",
      "grain:none",
      "media:dry",
      "color:linear-srgb",
      "porter-duff:source-over",
      "blend:normal",
      "intent:bristle-rake",
    ]);
    const subject = router([wet, textured, analytic, bristle]);

    const first = await subject.submit(request(1));
    const second = await subject.submit(request(2, {
      intent: "professional",
      canonicalPlan: texturedPlan(2),
    }));
    const third = await subject.submit(request(3));
    const fourth = await subject.submit(request(4, {
      canonicalPlan: wetPlan(4),
    }));
    const fifth = await subject.submit(request(5, {
      intent: "bristle-rake",
    }));

    expect([
      first,
      second,
      third,
      fourth,
      fifth,
    ]).toMatchObject([
      { status: "completed", proof: {
        providerId: "analytic",
        globalRequestSequence: 1,
        providerLocalSequence: 1,
      } },
      { status: "completed", proof: {
        providerId: "textured",
        globalRequestSequence: 2,
        providerLocalSequence: 1,
      } },
      { status: "completed", proof: {
        providerId: "analytic",
        globalRequestSequence: 3,
        providerLocalSequence: 2,
      } },
      { status: "completed", proof: {
        providerId: "wet",
        globalRequestSequence: 4,
        providerLocalSequence: 1,
      } },
      { status: "completed", proof: {
        providerId: "bristle",
        globalRequestSequence: 5,
        providerLocalSequence: 1,
      } },
    ]);
    expect(textured.executions[0]?.requiredCapabilities).toEqual([
      "tip:texture",
      "grain:texture",
      "media:dry",
      "color:linear-srgb",
      "porter-duff:source-over",
      "blend:normal",
      "intent:professional",
    ]);
    expect(subject.snapshot().providers).toMatchObject([
      { descriptor: { id: "analytic" }, nextLocalSequence: 3 },
      { descriptor: { id: "bristle" }, nextLocalSequence: 2 },
      { descriptor: { id: "textured" }, nextLocalSequence: 2 },
      { descriptor: { id: "wet" }, nextLocalSequence: 2 },
    ]);
  });

  it("freezes canonical provider descriptors and capability order", () => {
    const provider = testProvider("immutable", [
      "intent:canonical",
      "blend:normal",
      "tip:analytic",
      "grain:none",
      "media:dry",
      "color:linear-srgb",
      "porter-duff:source-over",
    ]);
    const subject = router([provider]);
    (provider.descriptor.capabilities as
      StudioEngineVNextBrushProviderCapability[]).push("media:wet");
    const [descriptor] = subject.descriptors();

    expect(descriptor?.capabilities).toEqual(ANALYTIC_CAPABILITIES);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor?.capabilities)).toBe(true);
    expect(Object.isFrozen(subject.descriptors())).toBe(true);
    expect(() => {
      (descriptor?.capabilities as StudioEngineVNextBrushProviderCapability[])
        .push("media:wet");
    }).toThrow();
  });

  it("does not consume unsupported or ambiguous preflight requests", async () => {
    const analytic = testProvider("analytic", ANALYTIC_CAPABILITIES);
    const unsupported = router([analytic]);

    await expect(unsupported.submit(request(1, {
      canonicalPlan: wetPlan(1),
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "unsupported",
      consumed: false,
    });
    expect(unsupported.snapshot().nextGlobalRequestSequence).toBe(1);
    await expect(unsupported.submit(request(1))).resolves.toMatchObject({
      status: "completed",
      proof: { globalRequestSequence: 1 },
    });

    const left = testProvider("left", ANALYTIC_CAPABILITIES, { priority: 50 });
    const right = testProvider("right", ANALYTIC_CAPABILITIES, {
      priority: 50,
    });
    const lower = testProvider("lower", ANALYTIC_CAPABILITIES, {
      priority: 49,
    });
    const ambiguous = router([left, lower, right]);
    await expect(ambiguous.submit(request(1))).resolves.toMatchObject({
      status: "rejected",
      reason: "ambiguous-provider",
      consumed: false,
    });
    expect(ambiguous.snapshot().nextGlobalRequestSequence).toBe(1);
    expect(left.execute).not.toHaveBeenCalled();
    expect(right.execute).not.toHaveBeenCalled();
    expect(lower.execute).not.toHaveBeenCalled();
  });

  it("rejects duplicate and accessor-backed providers without invoking getters", () => {
    const one = testProvider("duplicate", ANALYTIC_CAPABILITIES);
    const two = testProvider("duplicate", ANALYTIC_CAPABILITIES);
    expect(() => router([one, two])).toThrow(/duplicate/u);

    const getter = vi.fn(() => one.descriptor);
    const hostile = {
      execute: vi.fn(),
    };
    Object.defineProperty(hostile, "descriptor", {
      enumerable: true,
      get: getter,
    });
    expect(() => router([
      hostile as unknown as StudioEngineVNextBrushProvider,
    ])).toThrow(/descriptor/u);
    expect(getter).not.toHaveBeenCalled();

    const executeGetter = vi.fn(() => vi.fn());
    const hostileExecute = { descriptor: one.descriptor };
    Object.defineProperty(hostileExecute, "execute", {
      enumerable: true,
      get: executeGetter,
    });
    expect(() => router([
      hostileExecute as unknown as StudioEngineVNextBrushProvider,
    ])).toThrow(/execute/u);
    expect(executeGetter).not.toHaveBeenCalled();

    const optionGetter = vi.fn(() => 7);
    const hostileOptions = {
      deviceEpoch: 5,
      resizeEpoch: 3,
      providers: [one],
    };
    Object.defineProperty(hostileOptions, "sessionEpoch", {
      enumerable: true,
      get: optionGetter,
    });
    expect(() => new StudioEngineVNextBrushProviderRouter(
      hostileOptions as unknown as ConstructorParameters<
        typeof StudioEngineVNextBrushProviderRouter
      >[0],
    )).toThrow(/options/u);
    expect(optionGetter).not.toHaveBeenCalled();
  });

  it("fails closed on accessors, unknown keys, symbols, cycles, and depth", async () => {
    const provider = testProvider("strict", ANALYTIC_CAPABILITIES);
    const subject = router([provider]);

    const extensionGetter = vi.fn(() => null);
    const hostileRequest = request(1);
    Object.defineProperty(hostileRequest, "extension", {
      enumerable: true,
      configurable: true,
      get: extensionGetter,
    });
    await expect(subject.submit(hostileRequest)).resolves.toMatchObject({
      reason: "invalid-request",
      consumed: false,
    });
    expect(extensionGetter).not.toHaveBeenCalled();

    await expect(subject.submit({
      ...request(1),
      unknown: true,
    })).resolves.toMatchObject({ reason: "invalid-request" });
    const symbolRequest = request(1);
    Object.defineProperty(symbolRequest, Symbol("hidden"), {
      enumerable: true,
      value: true,
    });
    await expect(subject.submit(symbolRequest)).resolves.toMatchObject({
      reason: "invalid-request",
    });

    const commandGetter = vi.fn(() => 1);
    const hostilePlan = brushPlan(1);
    Object.defineProperty(hostilePlan, "commandSequence", {
      enumerable: true,
      configurable: true,
      get: commandGetter,
    });
    await expect(subject.submit(request(1, {
      canonicalPlan: hostilePlan,
    }))).resolves.toMatchObject({ reason: "invalid-request" });
    expect(commandGetter).not.toHaveBeenCalled();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(subject.submit(request(1, {
      intent: "professional",
      extension: cyclic,
    }))).resolves.toMatchObject({ reason: "invalid-request" });

    let deep: Record<string, unknown> = { value: "leaf" };
    for (
      let index = 0;
      index
        <= STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxExtensionDepth;
      index += 1
    ) {
      deep = { child: deep };
    }
    await expect(subject.submit(request(1, {
      intent: "professional",
      extension: deep,
    }))).resolves.toMatchObject({ reason: "invalid-request" });
    await expect(subject.submit(request(1, {
      intent: "professional",
      extension: "x".repeat(
        STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS
          .maxExtensionCodeUnits + 1,
      ),
    }))).resolves.toMatchObject({ reason: "invalid-request" });
    await expect(subject.submit(request(1, {
      intent: "professional",
      extension: new Array(
        STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxArrayLength + 1,
      ).fill(0),
    }))).resolves.toMatchObject({ reason: "invalid-request" });

    await expect(subject.submit(request(1, {
      extension: { hiddenSemantics: true },
    }))).resolves.toMatchObject({ reason: "invalid-request" });
    expect(subject.snapshot().nextGlobalRequestSequence).toBe(1);
  });

  it("validates submit options without invoking signal accessors", async () => {
    const provider = testProvider("signal-safe", ANALYTIC_CAPABILITIES);
    const subject = router([provider]);
    const signalGetter = vi.fn(() => new AbortController().signal);
    const options = {};
    Object.defineProperty(options, "signal", {
      enumerable: true,
      get: signalGetter,
    });

    await expect(subject.submit(request(1), options)).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-request",
      consumed: false,
    });
    expect(signalGetter).not.toHaveBeenCalled();
    await expect(subject.submit(request(1), {
      signal: {} as AbortSignal,
    })).resolves.toMatchObject({ reason: "invalid-request" });
    const aborted = new AbortController();
    aborted.abort(new Error("preflight"));
    await expect(subject.submit(request(1), {
      signal: aborted.signal,
    })).resolves.toMatchObject({
      reason: "cancelled",
      consumed: false,
    });
    expect(subject.snapshot().nextGlobalRequestSequence).toBe(1);
  });

  it("detaches and freezes extension and provider output snapshots", async () => {
    const gate = deferred<void>();
    const provider = testProvider("snapshot", [
      ...ANALYTIC_CAPABILITIES.filter(
        capability => capability !== "intent:canonical",
      ),
      "intent:professional",
    ], {
      execute: async (execution, _signal, descriptor) => {
        await gate.promise;
        return completedResult(descriptor, execution, {
          output: {
            z: [3, 2, 1],
            a: { stable: true },
          },
        });
      },
    });
    const subject = router([provider]);
    const extension = {
      z: ["original"],
      a: { pressureModel: "curve-v1" },
    };
    const resultPromise = subject.submit(request(1, {
      intent: "professional",
      extension,
    }));
    extension.z[0] = "mutated";
    extension.a.pressureModel = "mutated";
    gate.resolve();
    const result = await resultPromise;
    const [captured] = provider.executions;

    expect(captured?.extension).toEqual({
      a: { pressureModel: "curve-v1" },
      z: ["original"],
    });
    expect(Object.isFrozen(captured?.extension)).toBe(true);
    expect(result).toMatchObject({
      status: "completed",
      output: { a: { stable: true }, z: [3, 2, 1] },
    });
    if (result.status === "completed") {
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.proof)).toBe(true);
      expect(Object.isFrozen(result.output)).toBe(true);
      expect(Object.isFrozen(
        (result.output as unknown as { z: readonly number[] }).z,
      )).toBe(true);
    }
  });

  it("serializes work, applies backpressure, and permits exact retry", async () => {
    const gates: Deferred<void>[] = [];
    let concurrent = 0;
    let maximumConcurrent = 0;
    const provider = testProvider("serial", ANALYTIC_CAPABILITIES, {
      execute: async (execution, _signal, descriptor) => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
        concurrent -= 1;
        return completedResult(descriptor, execution);
      },
    });
    const subject = router([provider], 2);

    const first = subject.submit(request(1));
    const second = subject.submit(request(2));
    await vi.waitFor(() => {
      expect(provider.executions).toHaveLength(1);
    });
    await expect(subject.submit(request(3))).resolves.toMatchObject({
      status: "rejected",
      reason: "backpressure",
      consumed: false,
    });
    expect(subject.snapshot()).toMatchObject({
      nextGlobalRequestSequence: 3,
      activeRequestSequence: 1,
      queuedRequestSequences: [2],
    });

    gates[0]?.resolve();
    await vi.waitFor(() => {
      expect(provider.executions).toHaveLength(2);
    });
    gates[1]?.resolve();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: "completed" },
      { status: "completed" },
    ]);

    const third = subject.submit(request(3));
    await vi.waitFor(() => {
      expect(provider.executions).toHaveLength(3);
    });
    gates[2]?.resolve();
    await expect(third).resolves.toMatchObject({
      status: "completed",
      proof: { providerLocalSequence: 3 },
    });
    expect(maximumConcurrent).toBe(1);
  });

  it("cancels queued and active work while preserving consumed sequences", async () => {
    const gate = deferred<unknown>();
    const provider = testProvider("cancel", ANALYTIC_CAPABILITIES, {
      execute: () => gate.promise,
    });
    const subject = router([provider]);
    const first = subject.submit(request(1));
    const second = subject.submit(request(2));
    await vi.waitFor(() => {
      expect(provider.executions).toHaveLength(1);
    });

    expect(subject.cancel(2)).toBe(true);
    await expect(second).resolves.toMatchObject({
      status: "rejected",
      reason: "cancelled",
      consumed: true,
      globalRequestSequence: 2,
    });
    expect(subject.cancel(1)).toBe(true);
    await expect(first).resolves.toMatchObject({
      status: "rejected",
      reason: "cancelled",
      consumed: true,
      globalRequestSequence: 1,
    });
    expect(subject.cancel(99)).toBe(false);
    expect(subject.snapshot()).toMatchObject({
      nextGlobalRequestSequence: 3,
      activeRequestSequence: 1,
      queuedRequestSequences: [],
    });
    gate.resolve(null);
    await vi.waitFor(() => {
      expect(subject.snapshot()).toMatchObject({
        activeRequestSequence: null,
        queuedRequestSequences: [],
      });
    });
  });

  it("consumes provider failures and rejects forged or accessor proofs", async () => {
    const proofGetter = vi.fn();
    let call = 0;
    const provider = testProvider("proof", ANALYTIC_CAPABILITIES, {
      execute: (execution, _signal, descriptor) => {
        call += 1;
        if (call === 1) throw new Error("provider failure");
        if (call === 2) {
          const valid = completedResult(descriptor, execution);
          return {
            ...valid,
            proof: {
              ...(valid.proof as Record<string, unknown>),
              providerLocalSequence: 999,
            },
          };
        }
        if (call === 3) {
          const result = {
            status: "completed",
            output: null,
          } as Record<string, unknown>;
          Object.defineProperty(result, "proof", {
            enumerable: true,
            get: proofGetter,
          });
          return result;
        }
        return completedResult(descriptor, execution);
      },
    });
    const subject = router([provider]);

    await expect(subject.submit(request(1))).resolves.toMatchObject({
      reason: "provider-failed",
      consumed: true,
      globalRequestSequence: 1,
    });
    await expect(subject.submit(request(2))).resolves.toMatchObject({
      reason: "provider-proof-mismatch",
      consumed: true,
      globalRequestSequence: 2,
    });
    await expect(subject.submit(request(3))).resolves.toMatchObject({
      reason: "provider-proof-mismatch",
      consumed: true,
      globalRequestSequence: 3,
    });
    expect(proofGetter).not.toHaveBeenCalled();
    await expect(subject.submit(request(4))).resolves.toMatchObject({
      status: "completed",
      proof: {
        globalRequestSequence: 4,
        providerLocalSequence: 4,
      },
    });
    expect(subject.snapshot().nextGlobalRequestSequence).toBe(5);
  });

  it("makes device loss terminal under one incremented common epoch", async () => {
    const gate = deferred<unknown>();
    const provider = testProvider("device", ANALYTIC_CAPABILITIES, {
      execute: () => gate.promise,
    });
    const subject = router([provider]);
    const first = subject.submit(request(1));
    const second = subject.submit(request(2));
    await vi.waitFor(() => {
      expect(provider.executions).toHaveLength(1);
    });

    subject.notifyDeviceLoss("gpu-reset");
    await expect(first).resolves.toMatchObject({
      reason: "device-lost",
      consumed: true,
    });
    await expect(second).resolves.toMatchObject({
      reason: "device-lost",
      consumed: true,
    });
    expect(provider.notifyDeviceLoss).toHaveBeenCalledWith({
      deviceEpoch: 6,
      reason: "gpu-reset",
    });
    expect(subject.snapshot()).toMatchObject({
      phase: "device-lost",
      deviceEpoch: 6,
      nextGlobalRequestSequence: 3,
      activeRequestSequence: null,
    });
    await expect(subject.submit(request(3, {
      deviceEpoch: 6,
    }))).resolves.toMatchObject({
      reason: "device-lost",
      consumed: false,
    });
    subject.notifyDeviceLoss("ignored");
    expect(provider.notifyDeviceLoss).toHaveBeenCalledTimes(1);
    gate.resolve(null);
  });

  it("keeps a terminal device epoch safe at integer exhaustion", () => {
    const provider = testProvider("epoch-overflow", ANALYTIC_CAPABILITIES);
    const subject = new StudioEngineVNextBrushProviderRouter({
      sessionEpoch: 7,
      deviceEpoch: Number.MAX_SAFE_INTEGER,
      resizeEpoch: 3,
      providers: [provider],
    });

    subject.notifyDeviceLoss("epoch-exhausted");

    expect(subject.snapshot()).toMatchObject({
      phase: "device-lost",
      deviceEpoch: Number.MAX_SAFE_INTEGER,
    });
    expect(provider.notifyDeviceLoss).toHaveBeenCalledWith({
      deviceEpoch: Number.MAX_SAFE_INTEGER,
      reason: "epoch-exhausted",
    });
  });

  it("disposes active and queued work exactly once", async () => {
    const gate = deferred<unknown>();
    const provider = testProvider("dispose", ANALYTIC_CAPABILITIES, {
      execute: () => gate.promise,
    });
    const subject = router([provider]);
    const first = subject.submit(request(1));
    const second = subject.submit(request(2));
    await vi.waitFor(() => {
      expect(provider.executions).toHaveLength(1);
    });

    const disposal = subject.dispose();
    expect(subject.dispose()).toBe(disposal);
    await expect(first).resolves.toMatchObject({
      reason: "disposed",
      consumed: true,
    });
    await expect(second).resolves.toMatchObject({
      reason: "disposed",
      consumed: true,
    });
    await disposal;
    expect(provider.dispose).toHaveBeenCalledTimes(1);
    expect(subject.snapshot()).toMatchObject({
      phase: "disposed",
      activeRequestSequence: null,
      queuedRequestSequences: [],
    });
    await expect(subject.submit(request(3))).resolves.toMatchObject({
      reason: "disposed",
      consumed: false,
    });
    gate.resolve(null);
  });

  it("fails closed on sequence and epoch mismatches without consumption", async () => {
    const provider = testProvider("epochs", ANALYTIC_CAPABILITIES);
    const subject = router([provider]);
    await expect(subject.submit(request(2))).resolves.toMatchObject({
      reason: "request-sequence-gap",
      consumed: false,
    });
    const foreignSessionPlan = brushPlan(1);
    foreignSessionPlan.sessionEpoch = 8;
    await expect(subject.submit(request(1, {
      sessionEpoch: 8,
      canonicalPlan: foreignSessionPlan,
    }))).resolves.toMatchObject({
      reason: "session-epoch-mismatch",
      consumed: false,
    });
    await expect(subject.submit(request(1, {
      deviceEpoch: 6,
    }))).resolves.toMatchObject({
      reason: "device-epoch-mismatch",
      consumed: false,
    });
    await expect(subject.submit(request(1, {
      resizeEpoch: 4,
    }))).resolves.toMatchObject({
      reason: "resize-epoch-mismatch",
      consumed: false,
    });
    await expect(subject.submit(request(1))).resolves.toMatchObject({
      status: "completed",
    });
    await expect(subject.submit(request(1))).resolves.toMatchObject({
      reason: "request-sequence-conflict",
      consumed: false,
    });
  });
});
