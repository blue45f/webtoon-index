import { describe, expect, it } from "vitest";

import {
  buildBodySilhouette,
  type BodySilhouette,
  type BodySilhouetteSample,
} from "./studio-vrm-body-silhouette";
import {
  buildStudioVrmGarmentFitInputSignature,
  createStudioVrmGarmentEvaluationReceipt,
  inspectStudioVrmGarmentFit,
} from "./studio-vrm-garment-fit";
import {
  FALLBACK_WARDROBE_METRICS,
  WARDROBE_FIT_MAX,
  WARDROBE_FIT_MIN,
  createWardrobeEquip,
  measuredTorsoClearanceM,
  wardrobeItemById,
  type WardrobeEquip,
  type WardrobeMetrics,
  type WardrobeState,
} from "./studio-vrm-wardrobe";

const MEASURED_METRICS: WardrobeMetrics = {
  ...FALLBACK_WARDROBE_METRICS,
  source: "raw-rig",
};

/**
 * 링마다 네 모서리(±halfWidth, ±halfDepth)만 찍는다. 모든 표본의 중심 거리가 같아서 분위수가
 * 어디에 떨어지든 반폭·반깊이가 정확히 주어진 값이 되므로, 기준 반경을 리터럴로 못박을 수 있다.
 */
function measuredTorso(halfWidthAt: (t: number) => number, halfDepth = 0.07): BodySilhouette {
  const samples: BodySilhouetteSample[] = [];
  for (let index = 0; index < 12; index += 1) {
    const t = (index + 0.5) / 12;
    const halfWidth = halfWidthAt(t);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      samples.push(
        { t, x: halfWidth, z: halfDepth },
        { t, x: halfWidth, z: -halfDepth },
        { t, x: -halfWidth, z: halfDepth },
        { t, x: -halfWidth, z: -halfDepth },
      );
    }
  }
  const silhouette = buildBodySilhouette(samples, 12);
  if (!silhouette) throw new Error("fixture silhouette must measure");
  return silhouette;
}

/** 골격은 MEASURED_METRICS와 같고 몸만 다른 두 실측 — 가슴(t≥0.5)과 골반(t<0.5)을 따로 준다. */
const SLIM_METRICS: WardrobeMetrics = {
  ...MEASURED_METRICS,
  torso: measuredTorso((t) => (t >= 0.5 ? 0.1 : 0.13)),
};
const BROAD_METRICS: WardrobeMetrics = {
  ...MEASURED_METRICS,
  torso: measuredTorso((t) => (t >= 0.5 ? 0.21 : 0.19)),
};

function equip(itemId: string, patch: Partial<WardrobeEquip> = {}): WardrobeEquip {
  const base = createWardrobeEquip(itemId);
  if (!base) throw new Error(`missing wardrobe fixture: ${itemId}`);
  return { ...base, ...patch };
}

describe("Studio VRM garment fit runtime", () => {
  it("자동 맞춤은 authored fit을 바꾸지 않고 몸 관통 여유를 화면 셸에 적용한다", () => {
    const wardrobe: WardrobeState = {
      top: equip("shirt", { fit: 0.8, fitMode: "auto" }),
    };
    const report = inspectStudioVrmGarmentFit(wardrobe, MEASURED_METRICS);

    expect(report.status).toBe("ready");
    expect(report.slots.top?.authoredFit).toBe(0.8);
    expect(report.slots.top?.effectiveFit).toBeGreaterThan(0.8);
    expect(report.slots.top?.effectiveFit).toBe(report.slots.top?.suggestedFit);
    expect(report.autoAdjusted).toBe(true);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "auto-adjusted",
      severity: "info",
      slots: ["top"],
    }));
  });

  it("직접 맞춤에서 여유가 부족하면 부위와 권장 fit을 경고한다", () => {
    const report = inspectStudioVrmGarmentFit({
      top: equip("shirt", { fit: 0.8, fitMode: "manual" }),
    }, MEASURED_METRICS);

    const issue = report.issues.find((entry) => entry.code === "body-clearance");
    expect(report.status).toBe("warning");
    expect(issue?.slots).toEqual(["top"]);
    expect(issue?.regions).toEqual(expect.arrayContaining(["torso", "arms"]));
    expect(issue?.estimatedPenetrationM).toBeGreaterThan(0);
    expect(issue?.suggestedFit).toBeGreaterThan(0.8);
  });

  it("겉옷 자동 맞춤은 안쪽 상의보다 바깥 레이어 여유를 확보한다", () => {
    const report = inspectStudioVrmGarmentFit({
      top: equip("shirt", { fit: 1.2, fitMode: "manual" }),
      outer: equip("blazer", { fit: 0.9, fitMode: "auto" }),
    }, MEASURED_METRICS);

    expect(report.slots.outer?.effectiveFit).toBeGreaterThan(0.9);
    expect(report.issues.some((issue) => issue.code === "layer-clearance" && issue.severity === "warning")).toBe(false);
  });

  it("겉옷 직접 맞춤은 상의와의 레이어 관통을 숨기지 않는다", () => {
    const report = inspectStudioVrmGarmentFit({
      top: equip("shirt", { fit: 1.2, fitMode: "manual" }),
      outer: equip("blazer", { fit: 0.9, fitMode: "manual" }),
    }, MEASURED_METRICS);

    expect(report.status).toBe("warning");
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "layer-clearance",
      severity: "warning",
      slots: ["top", "outer"],
    }));
  });

  it("fit을 키우면 같은 의상의 추정 몸 관통량이 단조 감소한다", () => {
    const penetrations = [0.8, 0.9, 1, 1.1].map((fit) => inspectStudioVrmGarmentFit({
      top: equip("shirt", { fit, fitMode: "manual" }),
    }, MEASURED_METRICS).maxEstimatedPenetrationM);

    for (let index = 1; index < penetrations.length; index += 1) {
      expect(penetrations[index]).toBeLessThanOrEqual(penetrations[index - 1]!);
    }
  });

  it("폴백 측정은 결과를 ready로 과장하지 않는다", () => {
    const report = inspectStudioVrmGarmentFit({ top: equip("shirt") }, FALLBACK_WARDROBE_METRICS);
    expect(report.status).toBe("warning");
    expect(report.metricSource).toBe("fallback");
    expect(report.issues[0]?.code).toBe("metric-fallback");
  });

  it("입력 서명은 슬롯 순서와 색·직물 표현 변경에 흔들리지 않고 fit 변경은 감지한다", () => {
    const first: WardrobeState = {
      outer: equip("blazer", { color: "#112233", fabricId: "wool" }),
      top: equip("shirt"),
    };
    const reordered: WardrobeState = {
      top: equip("shirt", { color: "#abcdef", fabricId: "satin" }),
      outer: equip("blazer", { color: "#ffffff", fabricId: "leather" }),
    };
    expect(buildStudioVrmGarmentFitInputSignature(first, MEASURED_METRICS))
      .toBe(buildStudioVrmGarmentFitInputSignature(reordered, MEASURED_METRICS));

    const changed = { ...first, outer: equip("blazer", { fit: 1.1 }) };
    expect(buildStudioVrmGarmentFitInputSignature(changed, MEASURED_METRICS))
      .not.toBe(buildStudioVrmGarmentFitInputSignature(first, MEASURED_METRICS));
  });

  it("평가 영수증은 모델·포즈·세대와 진단을 복제해 고정한다", () => {
    const report = inspectStudioVrmGarmentFit({ top: equip("shirt") }, MEASURED_METRICS);
    const receipt = createStudioVrmGarmentEvaluationReceipt({
      modelId: "sample-vrm",
      poseSignature: "pose:abc",
      generation: 4.9,
      report,
    });

    expect(receipt).toEqual(expect.objectContaining({
      kind: "studio-vrm-garment-evaluation-receipt",
      version: 1,
      solver: "analytic-layer-fit-v1",
      modelId: "sample-vrm",
      poseSignature: "pose:abc",
      generation: 4,
      inputSignature: report.signature,
    }));
    expect(receipt.issues).not.toBe(report.issues);
  });

  it("실측이 없으면 기준 반경은 예전 골격 공식 그대로다", () => {
    expect(MEASURED_METRICS.torso).toBeNull();
    const report = inspectStudioVrmGarmentFit({
      top: equip("shirt"),
      bottom: equip("jeans"),
      shoes: equip("boots"),
    }, MEASURED_METRICS);

    expect(report.slots.top?.referenceRadiusM).toBe(0.1792);
    expect(report.slots.bottom?.referenceRadiusM).toBe(0.1615);
    expect(report.slots.shoes?.referenceRadiusM).toBe(0.08);
  });

  it("골격이 같아도 실측 몸통이 다르면 기준 반경과 서명이 갈린다", () => {
    const wardrobe: WardrobeState = { top: equip("shirt", { fit: 1, fitMode: "manual" }) };
    const slim = inspectStudioVrmGarmentFit(wardrobe, SLIM_METRICS);
    const broad = inspectStudioVrmGarmentFit(wardrobe, BROAD_METRICS);
    const skeleton = inspectStudioVrmGarmentFit(wardrobe, MEASURED_METRICS);

    expect(slim.slots.top?.referenceRadiusM).toBe(0.1);
    expect(broad.slots.top?.referenceRadiusM).toBe(0.21);
    // 셋의 골격은 완전히 같다. 예전 공식이면 세 값이 모두 0.1792로 붙어 있었다.
    expect(skeleton.slots.top?.referenceRadiusM).toBe(0.1792);
    expect(new Set([slim.signature, broad.signature, skeleton.signature]).size).toBe(3);
  });

  it("상의 기준 반경은 골반이 아니라 가슴 구간에서 나온다", () => {
    const report = inspectStudioVrmGarmentFit({
      top: equip("shirt"),
      bottom: equip("jeans"),
    }, SLIM_METRICS);

    // 이 몸은 가슴(0.1)보다 골반(0.13)이 넓다 — 상의가 실루엣 전체 최대폭을 쓰면 0.13이 된다.
    expect(report.slots.top?.referenceRadiusM).toBe(0.1);
    expect(report.slots.bottom?.referenceRadiusM).toBe(0.13);
  });

  it("신발 기준 반경은 실측 몸통과 무관하다 — 발은 몸통 실루엣 밖이다", () => {
    const wardrobe: WardrobeState = { shoes: equip("boots") };
    const skeleton = inspectStudioVrmGarmentFit(wardrobe, MEASURED_METRICS);
    const measured = inspectStudioVrmGarmentFit(wardrobe, BROAD_METRICS);

    expect(measured.slots.shoes?.referenceRadiusM).toBe(0.08);
    expect(measured.slots.shoes?.referenceRadiusM).toBe(skeleton.slots.shoes?.referenceRadiusM);
    // 반경이 같아도 몸은 달라졌다. 캐시가 그 차이를 못 보면 안 된다.
    expect(measured.signature).not.toBe(skeleton.signature);
  });

  it("깊이만 다른 실측도 서명을 가른다 — 반경이 같다고 같은 몸이 아니다", () => {
    const shallow: WardrobeMetrics = { ...MEASURED_METRICS, torso: measuredTorso(() => 0.12, 0.06) };
    const deep: WardrobeMetrics = { ...MEASURED_METRICS, torso: measuredTorso(() => 0.12, 0.1) };
    const wardrobe: WardrobeState = { top: equip("shirt") };

    expect(inspectStudioVrmGarmentFit(wardrobe, shallow).slots.top?.referenceRadiusM)
      .toBe(inspectStudioVrmGarmentFit(wardrobe, deep).slots.top?.referenceRadiusM);
    expect(buildStudioVrmGarmentFitInputSignature(wardrobe, shallow))
      .not.toBe(buildStudioVrmGarmentFitInputSignature(wardrobe, deep));
  });

  it("같은 실측을 두 번 넣으면 같은 서명과 같은 반경이 나온다", () => {
    const wardrobe: WardrobeState = { top: equip("shirt"), bottom: equip("pleated") };
    const first = inspectStudioVrmGarmentFit(wardrobe, SLIM_METRICS);
    const second = inspectStudioVrmGarmentFit(wardrobe, SLIM_METRICS);

    expect(second.signature).toBe(first.signature);
    expect(second.slots).toEqual(first.slots);
  });

  it("깨진 실측은 골격 폴백과 완전히 같은 결과를 낸다", () => {
    // 링이 MIN_VALID_RINGS에 못 미쳐 sanitize가 버리는 실루엣 — 재단도 영수증도 실측을 주장하면 안 된다.
    const brokenTorso: BodySilhouette = {
      version: 1,
      source: "measured",
      rings: [
        { t: 0.2, halfWidth: 0.2, halfDepth: 0.1, centerX: 0, centerZ: 0 },
        { t: 0.8, halfWidth: 0.2, halfDepth: 0.1, centerX: 0, centerZ: 0 },
      ],
      sampleCount: 16,
      measuredRingCount: 2,
    };
    const wardrobe: WardrobeState = { top: equip("shirt") };
    const broken = inspectStudioVrmGarmentFit(wardrobe, { ...MEASURED_METRICS, torso: brokenTorso });
    const skeleton = inspectStudioVrmGarmentFit(wardrobe, MEASURED_METRICS);

    expect(broken.slots.top?.referenceRadiusM).toBe(0.1792);
    expect(broken.signature).toBe(skeleton.signature);
  });

  it("실측 몸통은 최소 fit에서도 관통 경고가 뜨지 않는다 — 재단이 여유를 보장하기 때문", () => {
    // 실측 재단은 셸을 "몸 + 여유분"으로 만들고 fit은 그 여유분에만 곱한다. 그래서 fit을 끝까지
    // 줄여도 셸은 몸 바깥에 남는다. 예전 보고서는 fit을 반경 배율로 모델링해 여기서 있지도 않은
    // 관통을 경고했다 — 없는 문제를 알리는 경고는 있는 문제를 놓치는 경고보다 나을 것이 없다.
    for (const metrics of [SLIM_METRICS, BROAD_METRICS]) {
      const tight = inspectStudioVrmGarmentFit({
        top: equip("shirt", { fit: WARDROBE_FIT_MIN, fitMode: "manual" }),
      }, metrics);
      expect(tight.issues.some((issue) => issue.code === "body-clearance")).toBe(false);
      expect(tight.maxEstimatedPenetrationM).toBe(0);
      expect(tight.slots.top?.estimatedBodyClearanceM ?? 0).toBeGreaterThan(0);
    }
  });

  it("골격 폴백에서는 낀 의상 경고가 그대로 살아 있다", () => {
    // 실측이 없는 몸에서는 셸이 여전히 반경 전체에 fit을 곱하므로 관통이 실제로 가능하다.
    const tight = inspectStudioVrmGarmentFit({
      top: equip("shirt", { fit: WARDROBE_FIT_MIN, fitMode: "manual" }),
    }, MEASURED_METRICS);
    expect(tight.status).toBe("warning");
    expect(tight.issues.some((issue) => issue.code === "body-clearance")).toBe(true);
    expect(tight.maxEstimatedPenetrationM).toBeGreaterThan(0);
  });

  it("몸이 넓어지면 상의 기준 반경도 넓어진다", () => {
    const slim = inspectStudioVrmGarmentFit({ top: equip("shirt") }, SLIM_METRICS);
    const broad = inspectStudioVrmGarmentFit({ top: equip("shirt") }, BROAD_METRICS);
    expect(broad.slots.top?.referenceRadiusM ?? 0).toBeGreaterThan(slim.slots.top?.referenceRadiusM ?? 0);
  });
});

describe("실측 몸에서의 여유분 모델", () => {
  /** 재단이 실제로 남긴 여유 — 보고서가 이 값과 어긋나면 없는 경고를 띄우거나 있는 경고를 놓친다. */
  function cutClearance(itemId: string, metrics: WardrobeMetrics, fit: number): number {
    const value = measuredTorsoClearanceM(itemId, metrics, fit);
    if (value === null) throw new Error("측정된 몸에서는 재단 여유를 읽을 수 있어야 한다");
    return value;
  }

  it("보고서의 몸 여유가 재단이 실제로 남긴 여유와 같다", () => {
    for (const fit of [WARDROBE_FIT_MIN, 1, WARDROBE_FIT_MAX]) {
      const report = inspectStudioVrmGarmentFit(
        { top: equip("shirt", { fit, fitMode: "manual" }) },
        BROAD_METRICS,
      );
      expect(report.slots.top?.estimatedBodyClearanceM).toBeCloseTo(
        cutClearance("shirt", BROAD_METRICS, fit),
        6,
      );
    }
  });

  it("fit 한 칸이 벌어 주는 폭은 반경이 아니라 여유분 크기다", () => {
    const low = cutClearance("shirt", BROAD_METRICS, 1);
    const high = cutClearance("shirt", BROAD_METRICS, 1.2);
    const perStep = (high - low) / 0.2;
    // 반경 배율 모델이라면 기준 반경(≈0.21m)만큼 움직였을 것이다. 실제 지렛대는 그 1/5 이하다.
    expect(perStep).toBeLessThan(referenceRadiusForBroadChest() / 4);
    expect(perStep).toBeGreaterThan(0);
  });

  it("옷이 몸을 파고들지 않는 한 몸 여유는 언제나 양수다", () => {
    for (const metrics of [SLIM_METRICS, BROAD_METRICS]) {
      for (const itemId of ["shirt", "tshirt", "hoodie", "blazer"]) {
        expect(cutClearance(itemId, metrics, WARDROBE_FIT_MIN)).toBeGreaterThan(0);
      }
    }
  });

  it("측정이 없으면 예전 선형 모델을 그대로 쓴다", () => {
    const report = inspectStudioVrmGarmentFit(
      { top: equip("shirt", { fit: 0.8, fitMode: "manual" }) },
      MEASURED_METRICS,
    );
    const item = wardrobeItemById("shirt");
    if (!item) throw new Error("shirt fixture");
    // 0.1792 = 골격 기준 반경(shoulderW 0.32 × 0.56).
    expect(report.slots.top?.estimatedBodyClearanceM).toBeCloseTo(
      item.fitProfile.baseBodyClearanceM + (0.8 - 1) * 0.1792,
      6,
    );
  });
});

/** BROAD_METRICS 가슴 반폭 + 여유 — 위 테스트가 "반경 배율이 아니다"를 견주는 기준. */
function referenceRadiusForBroadChest(): number {
  return 0.21;
}
