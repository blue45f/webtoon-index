import { describe, expect, it, vi } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "../brush/studio-brush-dynamics";
import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";

import {
  createStudioEngineVNextBrushProviderGpuCompletion,
  STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
  StudioEngineVNextBrushProviderGpuBoundaryAdapter,
  type StudioEngineVNextBrushProviderGpuRequest,
} from "./studio-engine-vnext-brush-provider-gpu-boundary";
import {
  StudioEngineVNextBrushProviderRouter,
  type StudioEngineVNextBrushProvider,
  type StudioEngineVNextBrushProviderCapability,
  type StudioEngineVNextBrushProviderDescriptor,
  type StudioEngineVNextBrushProviderExecution,
} from "./studio-engine-vnext-brush-provider-router";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function canonicalPlan(
  commandSequence: number,
  kind: "texture" | "grain" | "wet" | "paint",
): StudioCanonicalBrushPlan {
  const plan: Record<string, unknown> = {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 11,
    commandSequence,
    strokeId: `specialist-stroke-${commandSequence}`,
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
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.2, 0.4, 0.8, 1],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: kind === "paint" ? 2 : 1,
      brushId: `specialist-${kind}`,
      engine: kind === "wet" ? "wet-media-v1" : "dab-v1",
      material: kind === "wet" ? "pigment" : "ink",
      tip: kind === "texture"
        ? {
          kind: "texture",
          assetId: "owned-tip",
          contentHash: `sha256:${"a".repeat(64)}`,
          channel: "alpha",
          width: 16,
          height: 16,
        }
        : {
          kind: "analytic",
          shape: "round",
          edgeSoftness: 0.1,
        },
      size: 8,
      flow: 0.8,
      hardness: 0.9,
      spacingRatio: 0.2,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: kind === "grain"
        ? {
          kind: "procedural-noise",
          assetId: null,
          contentHash: null,
          space: "document",
          scale: 2,
          depth: 0.5,
          contrast: 0.7,
          seed: 91,
        }
        : null,
      wetMedia: kind === "wet"
        ? {
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
        }
        : null,
      ...(kind === "paint"
        ? {
            paint: {
              model: "bounded-flow-v2",
              depositionAlpha: "flow-times-dab-opacity",
              accumulation: "source-over-stroke-local-rgba",
              finalCompositeOpacity: "plan-composite-opacity-once",
              surface: "bounded-sparse-rgba-tiles",
            },
            retainedDynamics: normalizeStudioBrushDynamicsSettings({
              depositPipeline: "causal-deposit-v3-segmented",
              seed: 202,
              spacingRatio: 0.145,
              scatterRatio: 0.04,
              width: {
                base: 8,
                mappings: [{ source: "pressure", from: 0.7, to: 1.25 }],
                jitter: { mode: "multiply", amount: 0.1 },
              },
            }),
          }
        : {}),
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
          x: 7,
          y: 5,
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
  const parsed = parseStudioCanonicalBrushPlan(plan, {
    sessionEpoch: 7,
    strokeEpoch: 11,
    lastAcceptedCommandSequence: commandSequence - 1,
  });
  if (!parsed.ok) {
    throw new Error(`Test canonical plan rejected: ${parsed.reason}:${parsed.path}`);
  }
  return parsed.value.plan;
}

function requirements(
  plan: StudioCanonicalBrushPlan,
): StudioEngineVNextBrushProviderGpuRequest["requirements"] {
  return Object.freeze([
    ...(plan.recipe.tip.kind === "texture" ? ["texture-tip" as const] : []),
    ...(plan.recipe.grain !== null ? ["grain" as const] : []),
    ...(
      plan.recipe.engine === "wet-media-v1" || plan.recipe.wetMedia !== null
        ? ["wet-media" as const]
        : []
    ),
    ...(plan.recipe.version === 2
      ? [
          ...(plan.recipe.retainedDynamics === null
            ? []
            : ["retained-dynamics" as const]),
          "stroke-local-compositor" as const,
        ]
      : []),
  ]);
}

function request(
  plan: StudioCanonicalBrushPlan,
  gpuRequestSequence: number,
): StudioEngineVNextBrushProviderGpuRequest {
  return Object.freeze({
    kind: "studio-engine-vnext-brush-provider-gpu/request",
    version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
    requestSequence: gpuRequestSequence,
    sessionEpoch: 7,
    strokeEpoch: 11,
    deviceEpoch: 5,
    resizeEpoch: 3,
    mode: "rebuild",
    rasterRect: Object.freeze({ x: 0, y: 0, width: 64, height: 64 }),
    strokeId: plan.strokeId,
    canonicalPlanHash: hashStudioCanonicalBrushPlan(plan),
    requirements: requirements(plan),
    canonicalPlan: plan,
  });
}

const SPECIALIST_CAPABILITIES = [
  "tip:analytic",
  "tip:texture",
  "grain:none",
  "grain:procedural",
  "media:dry",
  "media:wet",
  "color:linear-srgb",
  "porter-duff:source-over",
  "blend:normal",
  "paint:stroke-local",
  "dynamics:retained",
  "intent:professional",
] as const satisfies readonly StudioEngineVNextBrushProviderCapability[];

function provider(
  execute?: (
    execution: StudioEngineVNextBrushProviderExecution,
    signal: AbortSignal,
    descriptor: StudioEngineVNextBrushProviderDescriptor,
  ) => Promise<unknown> | unknown,
): {
  readonly provider: StudioEngineVNextBrushProvider;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly notifyDeviceLoss: ReturnType<typeof vi.fn>;
} {
  const descriptor = Object.freeze({
    id: "specialist-gpu",
    version: 3,
    priority: 100,
    capabilities: SPECIALIST_CAPABILITIES,
  });
  const executeMock = vi.fn(
    async (
      execution: StudioEngineVNextBrushProviderExecution,
      signal: AbortSignal,
    ) => (
      execute
        ? execute(execution, signal, descriptor)
        : createStudioEngineVNextBrushProviderGpuCompletion(
          descriptor,
          execution,
          {
            executionDigest: `gpu:${execution.globalRequestSequence}`,
            width: 64,
            height: 64,
            loweringVersion: 7,
            dabCount: execution.canonicalPlan.source.samples.length,
            batchCount: 1,
            batchOrder: [execution.canonicalPlan.composite.porterDuff],
          },
        )
    ),
  );
  const notifyDeviceLoss = vi.fn();
  return {
    provider: {
      descriptor,
      execute: executeMock,
      notifyDeviceLoss,
      dispose: vi.fn(),
    },
    execute: executeMock,
    notifyDeviceLoss,
  };
}

function boundary(fixture: ReturnType<typeof provider>) {
  const router = new StudioEngineVNextBrushProviderRouter({
    sessionEpoch: 7,
    deviceEpoch: 5,
    resizeEpoch: 3,
    providers: [fixture.provider],
  });
  return {
    router,
    boundary: new StudioEngineVNextBrushProviderGpuBoundaryAdapter(router),
  };
}

describe("StudioEngineVNextBrushProviderGpuBoundaryAdapter", () => {
  it("projects texture, grain, wet and paint-aware provider completions into exact WebGPU receipts", async () => {
    const fixture = provider();
    const subject = boundary(fixture);
    const controller = new AbortController();
    const plans = [
      canonicalPlan(1, "texture"),
      canonicalPlan(2, "grain"),
      canonicalPlan(3, "wet"),
      canonicalPlan(4, "paint"),
    ];

    const results = await Promise.all([
      subject.boundary.execute(request(plans[0]!, 41), controller.signal),
      subject.boundary.execute(request(plans[1]!, 87), controller.signal),
      subject.boundary.execute(request(plans[2]!, 103), controller.signal),
      subject.boundary.execute(request(plans[3]!, 144), controller.signal),
    ]);

    expect(results.map((result) => (
      result.status === "presented" ? "presented" : result.reason
    ))).toEqual(["presented", "presented", "presented", "presented"]);
    expect(results).toMatchObject([
      {
        status: "presented",
        receipt: {
          requestSequence: 41,
          strokeId: plans[0]!.strokeId,
          planFingerprint: expect.stringMatching(
            /^vnext-provider:specialist-gpu@3:/u,
          ),
        },
        proof: { globalRequestSequence: 1, providerLocalSequence: 1 },
      },
      {
        status: "presented",
        receipt: {
          requestSequence: 87,
          strokeId: plans[1]!.strokeId,
        },
        proof: { globalRequestSequence: 2, providerLocalSequence: 2 },
      },
      {
        status: "presented",
        receipt: {
          requestSequence: 103,
          strokeId: plans[2]!.strokeId,
        },
        proof: { globalRequestSequence: 3, providerLocalSequence: 3 },
      },
      {
        status: "presented",
        receipt: {
          requestSequence: 144,
          strokeId: plans[3]!.strokeId,
        },
        proof: { globalRequestSequence: 4, providerLocalSequence: 4 },
      },
    ]);
    expect(fixture.execute).toHaveBeenCalledTimes(4);
    expect(subject.router.snapshot().nextGlobalRequestSequence).toBe(5);
  });

  it("fails closed on forged provider proof and mismatched plain GPU output", async () => {
    let invocation = 0;
    const fixture = provider((execution, _signal, descriptor) => {
      invocation += 1;
      const completed = createStudioEngineVNextBrushProviderGpuCompletion(
        descriptor,
        execution,
        {
          executionDigest: `gpu:${execution.globalRequestSequence}`,
          width: 64,
          height: 64,
          loweringVersion: 7,
          dabCount: 2,
          batchCount: 1,
          batchOrder: ["source-over"],
        },
      );
      if (invocation === 1) {
        return {
          ...completed,
          proof: {
            ...completed.proof,
            providerLocalSequence: 999,
          },
        };
      }
      return {
        ...completed,
        output: {
          ...completed.output,
          canonicalPlanHash: "fnv1a32-utf16:forged",
        },
      };
    });
    const subject = boundary(fixture);
    const signal = new AbortController().signal;

    await expect(subject.boundary.execute(
      request(canonicalPlan(1, "texture"), 1),
      signal,
    )).resolves.toEqual({
      status: "rejected",
      reason: "provider-proof-mismatch",
      consumed: true,
    });
    await expect(subject.boundary.execute(
      request(canonicalPlan(2, "grain"), 2),
      signal,
    )).resolves.toEqual({
      status: "rejected",
      reason: "invalid-provider-output",
      consumed: true,
    });
  });

  it("propagates AbortSignal cancellation to an active provider", async () => {
    const started = deferred<void>();
    let providerSignal: AbortSignal | null = null;
    const fixture = provider((_execution, signal) => {
      providerSignal = signal;
      started.resolve(undefined);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const subject = boundary(fixture);
    const controller = new AbortController();
    const pending = subject.boundary.execute(
      request(canonicalPlan(1, "texture"), 8),
      controller.signal,
    );
    await started.promise;

    controller.abort(new Error("caller-cancelled"));

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "cancelled",
      consumed: true,
    });
    expect((providerSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("makes provider device loss terminal and propagates the incremented epoch", async () => {
    const started = deferred<void>();
    const fixture = provider((_execution, signal) => {
      started.resolve(undefined);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const subject = boundary(fixture);
    const pending = subject.boundary.execute(
      request(canonicalPlan(1, "wet"), 12),
      new AbortController().signal,
    );
    await started.promise;

    subject.boundary.notifyDeviceLoss("gpu-reset");

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "device-lost",
      consumed: true,
    });
    expect(fixture.notifyDeviceLoss).toHaveBeenCalledWith({
      deviceEpoch: 6,
      reason: "gpu-reset",
    });
    await expect(subject.boundary.execute(
      request(canonicalPlan(2, "wet"), 13),
      new AbortController().signal,
    )).resolves.toEqual({
      status: "rejected",
      reason: "device-lost",
      consumed: false,
    });
  });

  it("validates request, session, stroke, device, resize and canonical identities exactly", async () => {
    const fixture = provider();
    const subject = boundary(fixture);
    const valid = request(canonicalPlan(1, "grain"), 1);
    const cases = [
      {
        input: { ...valid, requestSequence: 0 },
        reason: "invalid-boundary-request",
      },
      {
        input: { ...valid, sessionEpoch: 8 },
        reason: "invalid-boundary-request",
      },
      {
        input: { ...valid, strokeEpoch: 12 },
        reason: "invalid-boundary-request",
      },
      {
        input: { ...valid, strokeId: "foreign-stroke" },
        reason: "invalid-boundary-request",
      },
      {
        input: { ...valid, deviceEpoch: 6 },
        reason: "device-epoch-mismatch",
      },
      {
        input: { ...valid, resizeEpoch: 4 },
        reason: "resize-epoch-mismatch",
      },
      {
        input: {
          ...valid,
          canonicalPlanHash: "fnv1a32-utf16:forged",
        },
        reason: "invalid-boundary-request",
      },
    ] as const;

    for (const candidate of cases) {
      await expect(subject.boundary.execute(
        candidate.input as StudioEngineVNextBrushProviderGpuRequest,
        new AbortController().signal,
      )).resolves.toEqual({
        status: "rejected",
        reason: candidate.reason,
        consumed: false,
      });
    }
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(subject.router.snapshot().nextGlobalRequestSequence).toBe(1);
    await expect(subject.boundary.execute(
      valid,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "presented",
      receipt: { requestSequence: 1 },
    });
  });
});
