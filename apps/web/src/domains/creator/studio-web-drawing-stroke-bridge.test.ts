import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
} from "./brush/studio-brush-dynamics";
import {
  auditStudioWebDrawingBridgePlan,
  classifyStudioWebDrawingBrushFamily,
  isStudioWebDrawingBrushId,
  planStudioWebAwareDynamicBrushDabs,
  planStudioWebDrawingDynamicDabs,
  planStudioWebDrawingKitOwnedDabs,
  recommendStudioWebDrawingLiveMaxDabs,
  sliceStudioDynamicDabsForLiveFrame,
  studioWebDrawingKitOwnsStrokeGeometry,
  STUDIO_WEB_DRAWING_ALL_BRUSH_IDS,
  STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS,
  STUDIO_WEB_DRAWING_LIVE_MARK_BUDGET_DEFAULT,
} from "./studio-web-drawing-stroke-bridge";

const POINTS = Object.freeze([100, 100, 120, 108, 150, 120, 180, 140, 200, 160]);
const PRESSURES = Object.freeze([0.4, 0.7, 0.9, 0.55, 0.35]);

describe("studio web drawing stroke bridge", () => {
  it("lists every competitive+coloring+assist web brush", () => {
    expect(STUDIO_WEB_DRAWING_ALL_BRUSH_IDS.length).toBeGreaterThanOrEqual(25);
    expect(isStudioWebDrawingBrushId("web-multi-agent")).toBe(true);
    expect(isStudioWebDrawingBrushId("web-cross-hatch-pen")).toBe(true);
    expect(isStudioWebDrawingBrushId("pen")).toBe(false);
  });

  it("maps web kit samples into dynamic dabs for each web brush", () => {
    for (const brushId of STUDIO_WEB_DRAWING_ALL_BRUSH_IDS) {
      const settings = studioBrushDynamicsSettingsForBrushId(brushId);
      expect(settings, brushId).not.toBeNull();
      const dabs = planStudioWebDrawingDynamicDabs(
        {
          brushId,
          points: POINTS,
          pressures: PRESSURES,
          baseWidth: 10,
          baseOpacity: 1,
          seed: 7,
          maxDabs: 512,
          centerX: 150,
          centerY: 130,
        },
        settings!,
      );
      expect(dabs, brushId).not.toBeNull();
      expect(dabs!.length, brushId).toBeGreaterThan(0);
      expect(dabs!.every((d) => d.size > 0 && d.opacity > 0), brushId).toBe(true);
    }
  });

  it("keeps interpolated spacing under the stamp threshold across huge sparse gaps", () => {
    // P2 회귀: 이전 512 스텝 상한은 세로 수천 px 캔버스의 희소 2점 직선 획(간격 6000px)에서
    // 보간 간격을 threshold(1–3px)의 몇 배로 벌려, 좁은 치즐 스탬프(web-calligraphy-ribbon,
    // 몸통 폭 ≈ 0.18 × baseWidth)가 라이브·커밋·SVG 모두에서 끊긴 몸통을 남겼다.
    const brushId = "web-calligraphy-ribbon";
    const settings = studioBrushDynamicsSettingsForBrushId(brushId);
    expect(settings).not.toBeNull();
    const baseWidth = 30;
    const dabs = planStudioWebDrawingDynamicDabs(
      {
        brushId,
        points: [100, 100, 100, 6_100],
        pressures: [0.6, 0.6],
        baseWidth,
        baseOpacity: 1,
        seed: 7,
        maxDabs: 8_192,
        centerX: 100,
        centerY: 3_100,
      },
      settings!,
    );
    expect(dabs).not.toBeNull();
    expect(dabs!.length).toBeGreaterThan(2);
    let maxConsecutiveGap = 0;
    for (let i = 1; i < dabs!.length; i++) {
      maxConsecutiveGap = Math.max(
        maxConsecutiveGap,
        Math.hypot(dabs![i]!.x - dabs![i - 1]!.x, dabs![i]!.y - dabs![i - 1]!.y),
      );
    }
    // 치즐 몸통 폭(0.18 × 30 = 5.4px)보다 촘촘해야 몸통이 이어진다. 512 상한에서는 경로
    // 간격이 6000/512 ≈ 11.7px 로 이 단언이 깨진다.
    expect(maxConsecutiveGap).toBeLessThan(0.18 * baseWidth);
  });

  it("falls through to ordinary dynamics for non-web brushes", () => {
    const settings = studioBrushDynamicsSettingsForBrushId("airbrush")!;
    const dabs = planStudioWebAwareDynamicBrushDabs(
      {
        brushId: "airbrush",
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 20,
        baseOpacity: 1,
        seed: 1,
        maxDabs: 64,
        settings,
      },
      (input, s) => planNormalizedStudioDynamicBrushDabs(input, s),
    );
    expect(dabs.length).toBeGreaterThan(0);
    expect(planStudioWebDrawingDynamicDabs({
      brushId: "airbrush",
      points: POINTS,
    }, settings)).toBeNull();
  });

  it("respects maxDabs budget on multi-agent swarm", () => {
    const settings = studioBrushDynamicsSettingsForBrushId("web-multi-agent")!;
    const dabs = planStudioWebDrawingDynamicDabs(
      {
        brushId: "web-multi-agent",
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 8,
        maxDabs: 12,
        seed: 3,
      },
      settings,
    );
    expect(dabs).not.toBeNull();
    expect(dabs!.length).toBeLessThanOrEqual(12);
  });

  it("classifies kit families and audits sample→dab budget arithmetic", () => {
    expect(classifyStudioWebDrawingBrushFamily("web-multi-agent")).toBe(
      "competitive",
    );
    expect(classifyStudioWebDrawingBrushFamily("web-hatch-color")).toBe(
      "coloring",
    );
    expect(classifyStudioWebDrawingBrushFamily("web-kaleido-ink")).toBe(
      "assist",
    );
    expect(classifyStudioWebDrawingBrushFamily("pen")).toBe("none");

    const full = auditStudioWebDrawingBridgePlan({
      brushId: "web-multi-agent",
      points: POINTS,
      pressures: PRESSURES,
      baseWidth: 8,
      seed: 3,
      maxDabs: 8_192,
    });
    expect(full.family).toBe("competitive");
    expect(full.empty).toBe(false);
    expect(full.sampleCount).toBeGreaterThan(0);
    expect(full.dabCount).toBe(full.sampleCount);
    expect(full.budgetLimited).toBe(false);
    expect(full.stride).toBe(1);

    const limited = auditStudioWebDrawingBridgePlan({
      brushId: "web-multi-agent",
      points: POINTS,
      pressures: PRESSURES,
      baseWidth: 8,
      seed: 3,
      maxDabs: 12,
    });
    expect(limited.family).toBe("competitive");
    expect(limited.dabCount).toBeLessThanOrEqual(12);
    expect(limited.budgetLimited).toBe(true);
    expect(limited.stride).toBeGreaterThanOrEqual(1);
    // Audit dab count must match the planner's emitted length for the same input.
    const settings = studioBrushDynamicsSettingsForBrushId("web-multi-agent")!;
    const dabs = planStudioWebDrawingDynamicDabs(
      {
        brushId: "web-multi-agent",
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 8,
        seed: 3,
        maxDabs: 12,
      },
      settings,
    );
    expect(dabs!.length).toBe(limited.dabCount);

    const nonWeb = auditStudioWebDrawingBridgePlan({
      brushId: "pen",
      points: POINTS,
    });
    expect(nonWeb.family).toBe("none");
    expect(nonWeb.empty).toBe(true);
    expect(nonWeb.dabCount).toBe(0);
  });

  it("recommends a live maxDabs ceiling under the mark budget for swarm brushes", () => {
    const uncapped = recommendStudioWebDrawingLiveMaxDabs({
      brushId: "web-multi-agent",
      points: POINTS,
      pressures: PRESSURES,
      baseWidth: 8,
      seed: 3,
      markBudget: STUDIO_WEB_DRAWING_LIVE_MARK_BUDGET_DEFAULT,
      maxDabs: 65_536,
    });
    expect(uncapped.family).toBe("competitive");
    expect(uncapped.empty).toBe(false);
    expect(uncapped.uncappedDabCount).toBeGreaterThan(0);
    expect(uncapped.maxDabs).toBeLessThanOrEqual(
      STUDIO_WEB_DRAWING_LIVE_MARK_BUDGET_DEFAULT,
    );
    expect(uncapped.maxDabs).toBeLessThanOrEqual(uncapped.uncappedDabCount);

    const tight = recommendStudioWebDrawingLiveMaxDabs({
      brushId: "web-multi-agent",
      points: POINTS,
      pressures: PRESSURES,
      baseWidth: 8,
      seed: 3,
      markBudget: 16,
      marksPerDab: 4,
      maxDabs: 65_536,
    });
    expect(tight.maxDabs).toBeLessThanOrEqual(4); // 16/4
    expect(tight.capped).toBe(true);

    const nonWeb = recommendStudioWebDrawingLiveMaxDabs({
      brushId: "pen",
      points: POINTS,
    });
    expect(nonWeb.empty).toBe(true);
    expect(nonWeb.family).toBe("none");
  });

  it("slices live dabs to a hard ceiling without reallocating when under budget", () => {
    const settings = studioBrushDynamicsSettingsForBrushId("web-multi-agent")!;
    const dabs = planStudioWebDrawingDynamicDabs(
      {
        brushId: "web-multi-agent",
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 8,
        seed: 3,
        maxDabs: 64,
      },
      settings,
    )!;
    expect(dabs.length).toBeGreaterThan(4);

    const under = sliceStudioDynamicDabsForLiveFrame(dabs, dabs.length + 10);
    expect(under.sliced).toBe(false);
    expect(under.dropped).toBe(0);
    expect(under.dabs).toBe(dabs);
    expect(under.preservedEndpoint).toBe(false);

    const over = sliceStudioDynamicDabsForLiveFrame(dabs, 5);
    expect(over.sliced).toBe(true);
    expect(over.dabs).toHaveLength(5);
    expect(over.dropped).toBe(dabs.length - 5);
    expect(over.dabs[0]).toBe(dabs[0]);
    // Endpoint preserved: last output dab is the planned tip, not a mid-path station.
    expect(over.preservedEndpoint).toBe(true);
    expect(over.dabs[over.dabs.length - 1]).toBe(dabs[dabs.length - 1]);

    const tipOnly = sliceStudioDynamicDabsForLiveFrame(dabs, 1);
    expect(tipOnly.dabs).toHaveLength(1);
    expect(tipOnly.dabs[0]).toBe(dabs[dabs.length - 1]);
    expect(tipOnly.preservedEndpoint).toBe(true);
  });

  it("owns kit geometry except intrinsic-symmetry folds and non-web brushes", () => {
    const ownedId = STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS[0];
    expect(ownedId).toBeDefined();
    expect(studioWebDrawingKitOwnsStrokeGeometry(ownedId)).toBe(true);
    expect(studioWebDrawingKitOwnsStrokeGeometry("web-mirror-ink")).toBe(false);
    expect(studioWebDrawingKitOwnsStrokeGeometry("web-kaleido-ink")).toBe(false);
    expect(studioWebDrawingKitOwnsStrokeGeometry("pen")).toBe(false);

    expect(
      STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS.every((id) =>
        (STUDIO_WEB_DRAWING_ALL_BRUSH_IDS as readonly string[]).includes(id),
      ),
    ).toBe(true);
    expect(STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS).not.toContain("web-mirror-ink");
    expect(STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS).not.toContain("web-kaleido-ink");

    const ownedSettings = studioBrushDynamicsSettingsForBrushId(ownedId!)!;
    const owned = planStudioWebDrawingKitOwnedDabs(
      {
        brushId: ownedId,
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 10,
        baseOpacity: 1,
        seed: 7,
        maxDabs: 512,
      },
      ownedSettings,
    );
    expect(owned).not.toBeNull();
    expect(owned!.length).toBeGreaterThan(0);
    expect(owned!.every((dab) => dab.size > 0 && dab.opacity > 0)).toBe(true);

    const mirrorSettings = studioBrushDynamicsSettingsForBrushId("web-mirror-ink")!;
    expect(planStudioWebDrawingKitOwnedDabs(
      {
        brushId: "web-mirror-ink",
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 10,
        seed: 7,
      },
      mirrorSettings,
    )).toBeNull();

    const kaleidoSettings = studioBrushDynamicsSettingsForBrushId("web-kaleido-ink")!;
    expect(planStudioWebDrawingKitOwnedDabs(
      {
        brushId: "web-kaleido-ink",
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 10,
        seed: 7,
      },
      kaleidoSettings,
    )).toBeNull();

    const penSettings = studioBrushDynamicsSettingsForBrushId("pen")!;
    expect(planStudioWebDrawingKitOwnedDabs(
      {
        brushId: "pen",
        points: POINTS,
        pressures: PRESSURES,
        baseWidth: 10,
        seed: 7,
      },
      penSettings,
    )).toBeNull();
  });

  it("routes committed, live, and SVG surfaces through the kit-owned planner", () => {
    for (const [path, expected] of [
      ["./studio-dynamic-brush-render-plan.ts", "planStudioWebDrawingKitOwnedDabs"],
      ["./live/studio-live-dynamic-brush-overlay.ts", "planStudioWebDrawingKitOwnedDabs"],
      ["./export/studio-svg-export.ts", "planStudioWebDrawingKitOwnedDabs"],
    ] as const) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, path).toContain(expected);
      expect(source, path).not.toMatch(
        /planStudioWebDrawingDynamicDabs\(/,
      );
    }
    const live = readFileSync(
      new URL("./live/studio-live-dynamic-brush-overlay.ts", import.meta.url),
      "utf8",
    );
    expect(live).toContain("studioWebDrawingKitOwnsStrokeGeometry");
  });
});
