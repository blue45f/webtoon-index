import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_TECHNIQUE_METADATA,
  planStudioProceduralArtisticBrushRequest,
  type StudioProceduralArtisticBrushPlanInput,
  type StudioProceduralArtisticBrushPlanTechnique,
} from "./studio-procedural-artistic-brush-plan";
import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES,
  createStudioProceduralArtisticBrushProvider,
  type StudioProceduralArtisticBrushAdapter,
  type StudioProceduralArtisticBrushAdapterInput,
  type StudioProceduralArtisticBrushAdapterOutput,
  type StudioProceduralArtisticSurfaceFactory,
} from "./studio-procedural-artistic-brush-provider";

function input(
  overrides: Partial<StudioProceduralArtisticBrushPlanInput> = {},
): StudioProceduralArtisticBrushPlanInput {
  return {
    technique: "flow-field",
    color: "#336699",
    density: 64,
    angle: 35,
    weight: 2.4,
    strength: 0.78,
    seed: 0x1234_abcd,
    width: 320,
    height: 240,
    pixelRatio: 2,
    requestSequence: 3,
    engineEpoch: 7,
    strokeId: "stroke-procedural-3",
    ...overrides,
  };
}

function success(overrides: Partial<StudioProceduralArtisticBrushPlanInput> = {}) {
  const result = planStudioProceduralArtisticBrushRequest(input(overrides));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("studio procedural artistic brush plan", () => {
  it.each([
    [
      "flow-field",
      "흐름장",
      "절차적 흐름장",
      "유기적인 흐름의 결정적 선 질감 레이어",
    ],
    [
      "hatch",
      "해칭",
      "절차적 해칭",
      "일정한 밀도와 방향의 결정적 해칭 패턴 레이어",
    ],
    [
      "mass",
      "매스",
      "절차적 매스",
      "목탄처럼 밀도와 농담이 있는 덩어리 질감 레이어",
    ],
    [
      "watercolor-fill",
      "수채 채움",
      "절차적 수채 채움",
      "종이결과 가장자리 번짐이 살아 있는 결정적 수채 면 레이어",
    ],
    [
      "flat-wash",
      "플랫 워시",
      "절차적 플랫 워시",
      "균일한 투명도로 넓은 색면을 채우는 결정적 워시 레이어",
    ],
  ] as const)(
    "creates a settled %s request with Korean display metadata",
    (technique, label, outputName, description) => {
      const result = success({ technique });
      expect(result.request).toMatchObject({
        kind: "studio-procedural-artistic-brush/request",
        version: 1,
        requestSequence: 3,
        engineEpoch: 7,
        stage: "settled",
        seed: 0x1234_abcd,
        width: 320,
        height: 240,
        pixelRatio: 2,
        plan: {
          technique,
          presetId: `studio-procedural-${technique}-v1`,
        },
      });
      expect(result.display.techniqueLabel).toBe(label);
      expect(result.display.name).toContain(outputName);
      expect(result.display.name).toContain(String(0x1234_abcd));
      expect(result.display.description).toBe(description);
      expect(
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_TECHNIQUE_METADATA[technique].label,
      ).toBe(label);
      expect(
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_TECHNIQUE_METADATA[technique]
          .description,
      ).toBe(description);
    },
  );

  it("maps panel semantics to adapter parameters instead of forwarding raw values", () => {
    const flow = success({ technique: "flow-field" });
    expect(flow.request.plan.parameters).toEqual({
      brush: "HB",
      color: "#336699",
      curvature: 0.78,
      field: "waves",
      fieldTime: 41.741,
      weight: 2.4,
    });

    const hatch = success({
      technique: "hatch",
      density: 100,
      angle: 90,
    });
    expect(hatch.request.plan.parameters).toEqual({
      angle: 1.5708,
      brush: "pen",
      color: "#336699",
      continuous: false,
      distance: 2,
      gradient: 0.08,
      randomness: 0.06,
      weight: 2.4,
    });

    const sparseHatch = success({ technique: "hatch", density: 1 });
    expect(sparseHatch.request.plan.parameters.distance).toBe(24);

    const mass = success({ technique: "mass", density: 100, strength: 1 });
    expect(mass.request.plan.parameters).toEqual({
      brush: "charcoal",
      color: "#336699",
      gradient: 0.08,
      outline: false,
      precision: 1,
      strength: 1,
    });

    const watercolor = success({
      technique: "watercolor-fill",
      density: 64,
      angle: 35,
      strength: 0.78,
    });
    expect(watercolor.request.plan.parameters).toEqual({
      angle: 0.6109,
      color: "#336699",
      density: 0.64,
      opacity: 0.72,
      strength: 0.78,
    });

    const flatWash = success({
      technique: "flat-wash",
      density: 100,
      angle: 180,
      weight: 32,
      strength: 0,
    });
    expect(flatWash.request.plan.parameters).toEqual({
      color: "#336699",
      opacity: 0.01,
    });
    expect(flatWash.display.settingsSummary).toBe(
      `불투명도 1% · 시드 ${0x1234_abcd}`,
    );
    expect(flatWash.display.settingsSummary).not.toMatch(
      /밀도|방향|굵기/u,
    );
  });

  it("generates deterministic seed-sensitive geometry within provider bounds", () => {
    for (const technique of [
      "flow-field",
      "hatch",
      "mass",
      "watercolor-fill",
      "flat-wash",
    ] as const satisfies readonly StudioProceduralArtisticBrushPlanTechnique[]) {
      const first = success({ technique, seed: 91 });
      const replay = success({ technique, seed: 91 });
      const changed = success({ technique, seed: 92 });
      expect(replay.request.plan.samples).toEqual(first.request.plan.samples);
      expect(changed.request.plan.samples).not.toEqual(
        first.request.plan.samples,
      );
      expect(first.request.plan.samples.length).toBeGreaterThanOrEqual(
        technique === "flow-field" ? 2 : 3,
      );
      expect(first.request.plan.samples.length).toBeLessThanOrEqual(
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxGeneratedSamples,
      );
      for (const generated of first.request.plan.samples) {
        expect(generated.x).toBeGreaterThanOrEqual(0);
        expect(generated.x).toBeLessThanOrEqual(first.request.width);
        expect(generated.y).toBeGreaterThanOrEqual(0);
        expect(generated.y).toBeLessThanOrEqual(first.request.height);
        expect(generated.pressure).toBeGreaterThan(0);
        expect(generated.pressure).toBeLessThanOrEqual(1);
        expect(generated.tiltX).toBeGreaterThanOrEqual(-90);
        expect(generated.tiltX).toBeLessThanOrEqual(90);
        expect(generated.tiltY).toBeGreaterThanOrEqual(-90);
        expect(generated.tiltY).toBeLessThanOrEqual(90);
      }
    }
  });

  it("accepts the conservative maximum raster but rejects smaller hard-budget overflows", () => {
    expect(success({
      width: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxDimension,
      height: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PLAN_LIMITS.maxDimension,
    }).request.width).toBe(4_096);

    for (const overrides of [
      { width: 31 },
      { height: 31 },
      { width: 4_097 },
      { height: 4_097 },
    ]) {
      const result = planStudioProceduralArtisticBrushRequest(
        input(overrides),
      );
      expect(result).toMatchObject({
        ok: false,
        code: "dimension-budget-exceeded",
      });
    }
  });

  it("applies the eight-frame composited-fill admission boundary", () => {
    for (const technique of [
      "watercolor-fill",
      "flat-wash",
    ] as const) {
      const accepted = success({
        technique,
        width: 4_096,
        height: 3_072,
      });
      expect(accepted.request).toMatchObject({
        width: 4_096,
        height: 3_072,
        plan: {
          technique,
          presetId:
            `studio-procedural-${technique}-v1`,
        },
      });
      expect(planStudioProceduralArtisticBrushRequest(input({
        technique,
        width: 4_096,
        height: 3_073,
      }))).toMatchObject({
        ok: false,
        code: "dimension-budget-exceeded",
        path: "$.width",
      });
    }
  });

  it.each([
    [{ technique: "custom-tip" }, "invalid-technique", "$.technique"],
    [{ color: "red" }, "invalid-color", "$.color"],
    [{ color: "#12345" }, "invalid-color", "$.color"],
    [{ density: 0 }, "invalid-density", "$.density"],
    [{ density: Number.NaN }, "invalid-density", "$.density"],
    [{ angle: 181 }, "invalid-angle", "$.angle"],
    [{ weight: 0 }, "invalid-weight", "$.weight"],
    [{ strength: 1.01 }, "invalid-strength", "$.strength"],
    [{ seed: -1 }, "invalid-seed", "$.seed"],
    [{ seed: 0x1_0000_0000 }, "invalid-seed", "$.seed"],
    [{ width: 32.5 }, "invalid-dimensions", "$.width"],
    [{ pixelRatio: 0 }, "invalid-pixel-ratio", "$.pixelRatio"],
    [{ pixelRatio: 4.1 }, "invalid-pixel-ratio", "$.pixelRatio"],
    [{ requestSequence: 0 }, "invalid-request-sequence", "$.requestSequence"],
    [{ engineEpoch: 0 }, "invalid-engine-epoch", "$.engineEpoch"],
    [{ strokeId: "획 id" }, "invalid-stroke-id", "$.strokeId"],
    [{ signal: {} }, "invalid-signal", "$.signal"],
  ])("rejects invalid setting %j with a stable field path", (overrides, code, path) => {
    const result = planStudioProceduralArtisticBrushRequest({
      ...input(),
      ...overrides,
    });
    expect(result).toMatchObject({ ok: false, code, path });
  });

  it("rejects unknown fields and accessors without invoking a getter", () => {
    const unknown = planStudioProceduralArtisticBrushRequest({
      ...input(),
      hiddenEngineState: true,
    });
    expect(unknown).toMatchObject({
      ok: false,
      code: "unknown-field",
      path: "$.hiddenEngineState",
    });

    const getter = vi.fn(() => "flow-field");
    const hostile = { ...input() } as Record<string, unknown>;
    Object.defineProperty(hostile, "technique", {
      enumerable: true,
      get: getter,
    });
    const result = planStudioProceduralArtisticBrushRequest(hostile);
    expect(result).toMatchObject({
      ok: false,
      code: "not-plain-data",
      path: "$.technique",
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("preserves a caller AbortSignal and freezes all generated request data", () => {
    const controller = new AbortController();
    const result = success({ signal: controller.signal });
    expect(result.request.signal).toBe(controller.signal);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.request)).toBe(true);
    expect(Object.isFrozen(result.request.plan)).toBe(true);
    expect(Object.isFrozen(result.request.plan.samples)).toBe(true);
    expect(Object.isFrozen(result.request.plan.parameters)).toBe(true);
  });

  it("is accepted by the production provider normalizer as a completed request", async () => {
    const adapter: StudioProceduralArtisticBrushAdapter = {
      descriptor: {
        id: "plan-test-adapter",
        version: "1.0.0",
        compatibility: "p5.brush/standalone",
        executionStage: "settled-only",
        executionLocality: "dedicated-worker",
        surface: "offscreen-canvas-webgl2",
        deterministicSeed: true,
        mainSceneAuthority: false,
        capabilities: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES,
      },
      renderSettled: (
        adapterInput: StudioProceduralArtisticBrushAdapterInput,
      ): StudioProceduralArtisticBrushAdapterOutput => ({
        kind: "studio-procedural-artistic-brush/adapter-output",
        width: adapterInput.width,
        height: adapterInput.height,
        seed: adapterInput.seed,
        backend: "webgl2",
        executionStage: "settled",
        complete: true,
        pixels: new Uint8Array(
          adapterInput.width * adapterInput.height * 4,
        ),
        capabilitiesUsed: [
          adapterInput.plan.technique === "flow-field"
            ? "procedural:flow-field"
            : adapterInput.plan.technique === "hatch"
              ? "procedural:hatch"
              : adapterInput.plan.technique === "mass"
                ? "procedural:mass"
                : adapterInput.plan.technique === "watercolor-fill"
                  ? "procedural:watercolor-fill"
                  : "procedural:flat-wash",
        ],
      }),
    };
    const providerCreation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: () => adapter,
      createSurface: (({ width, height }) => ({
        kind: "offscreen-canvas-webgl2",
        executionLocality: "dedicated-worker",
        transferredFromMainThread: false,
        width,
        height,
        canvas: {},
        context: {},
        dispose: vi.fn(),
      })) satisfies StudioProceduralArtisticSurfaceFactory,
    });
    expect(providerCreation.status).toBe("ready");
    if (providerCreation.status !== "ready") {
      throw new Error(providerCreation.path);
    }

    for (const technique of [
      "flow-field",
      "hatch",
      "mass",
      "watercolor-fill",
      "flat-wash",
    ] as const) {
      const planned = success({
        technique,
        width: 64,
        height: 48,
        requestSequence: technique === "flow-field"
          ? 1
          : technique === "hatch"
            ? 2
            : 3,
      });
      const rendered = await providerCreation.provider.render(planned.request);
      expect(rendered.status).toBe("completed");
    }
  });
});
