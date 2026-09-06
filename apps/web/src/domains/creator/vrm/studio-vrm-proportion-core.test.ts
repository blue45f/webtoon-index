import { describe, expect, it } from "vitest";

import { STUDIO_HUMANOID_BONE_NAMES, type StudioHumanoidBoneName } from "../studio-humanoid-bones";

import {
  NEUTRAL_STUDIO_VRM_PROPORTIONS,
  STUDIO_VRM_PROPORTION_KEYS,
  STUDIO_VRM_PROPORTION_LIMITS,
  STUDIO_VRM_PROPORTION_PRESETS,
  STUDIO_VRM_REFERENCE_BONE_SNAPSHOT,
  STUDIO_VRM_REQUIRED_HUMANOID_BONES,
  createStudioVrmProportions,
  formatStudioVrmHeadUnits,
  parseStudioVrmProportions,
  resolveStudioVrmProportionMetrics,
  resolveVrmProportionBoneTargets,
  resolveVrmProportionPlan,
  resolveVrmProportionSkeleton,
  sanitizeStudioVrmProportions,
  serializeStudioVrmProportions,
  solveStudioVrmHeadBodyRatioForHeadUnits,
  studioVrmRestBoneLength,
  validateStudioVrmProportionPlan,
  type StudioVrmBoneHierarchySnapshot,
  type StudioVrmBoneRest,
  type StudioVrmProportionOp,
  type StudioVrmProportions,
  type StudioVrmVec3,
} from "./studio-vrm-proportion-core";

const REFERENCE = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT;

function restBone(name: StudioHumanoidBoneName): StudioVrmBoneRest {
  const bone = REFERENCE.bones.find((entry) => entry.name === name);
  if (!bone) throw new Error(`reference snapshot missing ${name}`);
  return bone;
}

function planByBone(plan: readonly StudioVrmProportionOp[]) {
  return new Map(plan.map((op) => [op.boneName, op]));
}

function op(plan: readonly StudioVrmProportionOp[], name: StudioHumanoidBoneName) {
  return planByBone(plan).get(name);
}

function withProportions(patch: Partial<StudioVrmProportions>): StudioVrmProportions {
  return sanitizeStudioVrmProportions({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...patch });
}

function worldPosition(
  proportions: StudioVrmProportions,
  name: StudioHumanoidBoneName,
  snapshot: StudioVrmBoneHierarchySnapshot = REFERENCE
): StudioVrmVec3 {
  const node = resolveVrmProportionSkeleton(proportions, snapshot).get(name);
  if (!node) throw new Error(`skeleton missing ${name}`);
  return node.worldPosition;
}

function worldScale(
  proportions: StudioVrmProportions,
  name: StudioHumanoidBoneName,
  snapshot: StudioVrmBoneHierarchySnapshot = REFERENCE
): number {
  const node = resolveVrmProportionSkeleton(proportions, snapshot).get(name);
  if (!node) throw new Error(`skeleton missing ${name}`);
  return node.worldScale;
}

function segmentLength(
  proportions: StudioVrmProportions,
  parent: StudioHumanoidBoneName,
  child: StudioHumanoidBoneName
): number {
  const a = worldPosition(proportions, parent);
  const b = worldPosition(proportions, child);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* -------------------------------------------------------------------------- */

describe("파라미터 정규화·클램프", () => {
  it("중립 상수는 모든 파라미터가 정확히 1.0 이다", () => {
    for (const key of STUDIO_VRM_PROPORTION_KEYS) {
      expect(NEUTRAL_STUDIO_VRM_PROPORTIONS[key]).toBe(1);
    }
    expect(NEUTRAL_STUDIO_VRM_PROPORTIONS.version).toBe(1);
  });

  it("모든 파라미터의 허용 구간은 중립 1.0 을 포함한다", () => {
    for (const key of STUDIO_VRM_PROPORTION_KEYS) {
      const limit = STUDIO_VRM_PROPORTION_LIMITS[key];
      expect(limit.min).toBeLessThan(1);
      expect(limit.max).toBeGreaterThan(1);
      expect(limit.step).toBeGreaterThan(0);
    }
  });

  it("구간 밖 값은 경계로 클램프된다", () => {
    const high = sanitizeStudioVrmProportions({
      overallHeight: 99,
      headBodyRatio: 1000,
      legLength: 42,
      neckLength: 9,
    });
    expect(high.overallHeight).toBe(STUDIO_VRM_PROPORTION_LIMITS.overallHeight.max);
    expect(high.headBodyRatio).toBe(STUDIO_VRM_PROPORTION_LIMITS.headBodyRatio.max);
    expect(high.legLength).toBe(STUDIO_VRM_PROPORTION_LIMITS.legLength.max);
    expect(high.neckLength).toBe(STUDIO_VRM_PROPORTION_LIMITS.neckLength.max);

    const low = sanitizeStudioVrmProportions({
      overallHeight: -12,
      headBodyRatio: 0,
      armLength: -0.0001,
      footScale: Number.MIN_SAFE_INTEGER,
    });
    expect(low.overallHeight).toBe(STUDIO_VRM_PROPORTION_LIMITS.overallHeight.min);
    expect(low.headBodyRatio).toBe(STUDIO_VRM_PROPORTION_LIMITS.headBodyRatio.min);
    expect(low.armLength).toBe(STUDIO_VRM_PROPORTION_LIMITS.armLength.min);
    expect(low.footScale).toBe(STUDIO_VRM_PROPORTION_LIMITS.footScale.min);
  });

  it("유한하지 않거나 수치가 아닌 값은 중립 1.0 으로 대체된다", () => {
    const parsed = sanitizeStudioVrmProportions({
      overallHeight: Number.NaN,
      headBodyRatio: Number.POSITIVE_INFINITY,
      armLength: "아주 길게",
      legLength: null,
      torsoLength: undefined,
      shoulderWidth: {},
      handScale: [],
      footScale: true,
      neckLength: () => 3,
    });
    for (const key of STUDIO_VRM_PROPORTION_KEYS) {
      expect(parsed[key]).toBe(1);
    }
  });

  it("숫자로 강제 변환 가능한 문자열은 수용하고 클램프한다", () => {
    expect(sanitizeStudioVrmProportions({ overallHeight: "1.25" }).overallHeight).toBe(1.25);
    expect(sanitizeStudioVrmProportions({ overallHeight: "9999" }).overallHeight).toBe(
      STUDIO_VRM_PROPORTION_LIMITS.overallHeight.max
    );
  });

  it("presetId 는 문자열일 때만 남고 길이를 제한한다", () => {
    expect(sanitizeStudioVrmProportions({ presetId: "  sd-chibi-3  " }).presetId).toBe("sd-chibi-3");
    expect(sanitizeStudioVrmProportions({ presetId: 42 }).presetId).toBeUndefined();
    expect(sanitizeStudioVrmProportions({ presetId: "   " }).presetId).toBeUndefined();
    expect(sanitizeStudioVrmProportions({ presetId: "x".repeat(500) }).presetId).toHaveLength(64);
  });
});

/* -------------------------------------------------------------------------- */

describe("플랜 해석 수치", () => {
  it("중립 비율은 연산이 하나도 없는 빈 플랜을 만든다", () => {
    expect(resolveVrmProportionPlan(NEUTRAL_STUDIO_VRM_PROPORTIONS)).toEqual([]);
  });

  it("다리 길이는 허벅지·정강이 관절을 이동시키고 hips 를 들어올린다", () => {
    // 허벅지 0.45 · 정강이 0.41 · 발목 높이 0.09 (레퍼런스 스냅샷)
    const plan = resolveVrmProportionPlan(withProportions({ legLength: 1.5 }));
    expect(op(plan, "leftLowerLeg")?.translateLocal[1]).toBeCloseTo(-0.45 * 0.5, 12);
    expect(op(plan, "leftFoot")?.translateLocal[1]).toBeCloseTo(-0.41 * 0.5, 12);
    expect(op(plan, "rightLowerLeg")?.translateLocal[1]).toBeCloseTo(-0.45 * 0.5, 12);
    // 발바닥을 바닥에 유지하려면 hips 가 늘어난 다리 길이만큼 올라가야 한다.
    expect(op(plan, "hips")?.translateLocal[1]).toBeCloseTo(0.86 * 0.5, 12);
    // 길이 변경은 절대 스케일을 쓰지 않는다.
    expect(op(plan, "leftLowerLeg")?.scale).toBe(1);
    expect(op(plan, "leftFoot")?.scale).toBe(1);
  });

  it("몸통 길이는 spine·chest·upperChest·neck 오프셋만 늘린다", () => {
    const plan = resolveVrmProportionPlan(withProportions({ torsoLength: 1.2 }));
    expect(op(plan, "spine")?.translateLocal[1]).toBeCloseTo(0.11 * 0.2, 12);
    expect(op(plan, "chest")?.translateLocal[1]).toBeCloseTo(0.1 * 0.2, 12);
    expect(op(plan, "upperChest")?.translateLocal[1]).toBeCloseTo(0.1 * 0.2, 12);
    expect(op(plan, "neck")?.translateLocal[1]).toBeCloseTo(0.06 * 0.2, 12);
    expect(op(plan, "head")).toBeUndefined();
    expect(op(plan, "hips")).toBeUndefined();
  });

  it("목 길이는 head 관절만 이동시킨다", () => {
    const plan = resolveVrmProportionPlan(withProportions({ neckLength: 0.5 }));
    expect(plan).toHaveLength(1);
    expect(op(plan, "head")?.translateLocal[1]).toBeCloseTo(0.08 * -0.5, 12);
    expect(op(plan, "head")?.scale).toBe(1);
  });

  it("팔 길이는 위팔(lowerArm 오프셋)·아래팔(hand 오프셋)을 늘린다", () => {
    const plan = resolveVrmProportionPlan(withProportions({ armLength: 1.25 }));
    expect(op(plan, "leftLowerArm")?.translateLocal[0]).toBeCloseTo(0.27 * 0.25, 12);
    expect(op(plan, "leftHand")?.translateLocal[0]).toBeCloseTo(0.24 * 0.25, 12);
    // 좌우 대칭: 오른쪽은 부호가 반대다.
    expect(op(plan, "rightLowerArm")?.translateLocal[0]).toBeCloseTo(-0.27 * 0.25, 12);
    expect(op(plan, "leftShoulder")).toBeUndefined();
  });

  it("어깨 너비는 쇄골·어깨 오프셋만 넓히고 팔 길이는 보존한다", () => {
    const wide = withProportions({ shoulderWidth: 1.4 });
    const plan = resolveVrmProportionPlan(wide);
    expect(op(plan, "leftShoulder")?.translateLocal[0]).toBeCloseTo(0.045 * 0.4, 12);
    expect(op(plan, "leftUpperArm")?.translateLocal[0]).toBeCloseTo(0.11 * 0.4, 12);
    expect(op(plan, "leftLowerArm")).toBeUndefined();

    const neutralArm = resolveStudioVrmProportionMetrics(NEUTRAL_STUDIO_VRM_PROPORTIONS).armLength;
    expect(resolveStudioVrmProportionMetrics(wide).armLength).toBeCloseTo(neutralArm, 12);
    expect(resolveStudioVrmProportionMetrics(wide).shoulderSpan).toBeCloseTo(0.09 * 1.4, 12);
  });

  it("손·발 크기는 균등 스케일 연산으로만 표현된다", () => {
    const plan = resolveVrmProportionPlan(withProportions({ handScale: 1.3, footScale: 0.8 }));
    expect(op(plan, "leftHand")?.scale).toBeCloseTo(1.3, 12);
    expect(op(plan, "rightHand")?.scale).toBeCloseTo(1.3, 12);
    expect(op(plan, "leftFoot")?.scale).toBeCloseTo(0.8, 12);
    expect(op(plan, "leftHand")?.translateLocal).toEqual([0, 0, 0]);
    // 발이 작아지면 발목이 내려와야 발바닥이 바닥에 붙는다.
    expect(op(plan, "hips")?.translateLocal[1]).toBeCloseTo(0.09 * -0.2, 12);
  });

  it("두신비는 head 본의 균등 스케일이다", () => {
    const plan = resolveVrmProportionPlan(withProportions({ headBodyRatio: 2 }));
    expect(plan).toHaveLength(1);
    expect(op(plan, "head")?.scale).toBe(2);
    expect(op(plan, "head")?.translateLocal).toEqual([0, 0, 0]);
  });

  it("전체 키는 관절 간격과 말단 스케일을 함께 키우고 두신비는 보존한다", () => {
    const tall = withProportions({ overallHeight: 1.25 });
    const metrics = resolveStudioVrmProportionMetrics(tall);
    const neutral = resolveStudioVrmProportionMetrics(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    expect(metrics.totalHeight).toBeCloseTo(neutral.totalHeight * 1.25, 12);
    expect(metrics.headUnits).toBeCloseTo(neutral.headUnits, 12);
    expect(worldScale(tall, "leftHand")).toBeCloseTo(1.25, 12);
    expect(worldScale(tall, "head")).toBeCloseTo(1.25, 12);
  });

  it("다리·발이 어떻게 바뀌어도 발목 높이는 발 크기에만 비례한다(발바닥 접지)", () => {
    for (const legLength of [0.6, 1, 1.4]) {
      for (const footScale of [0.7, 1, 1.5]) {
        const metrics = resolveStudioVrmProportionMetrics(withProportions({ legLength, footScale }));
        expect(metrics.footHeight).toBeCloseTo(0.09 * footScale, 12);
        expect(metrics.legLength).toBeCloseTo(0.86 * legLength, 12);
      }
    }
  });

  it("플랜은 휴머노이드 허용 목록 밖의 본을 절대 참조하지 않는다", () => {
    const allowed = new Set<string>(STUDIO_HUMANOID_BONE_NAMES);
    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      for (const entry of resolveVrmProportionPlan(preset.proportions)) {
        expect(allowed.has(entry.boneName)).toBe(true);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("스케일 전파와 전단(skew) 방지", () => {
  const chibi = createStudioVrmProportions("sd-chibi-3");

  it("균등 스케일은 머리·손·발에만 붙고 나머지 본은 항상 1 이다", () => {
    const scaled = new Set(
      resolveVrmProportionPlan(chibi)
        .filter((entry) => entry.scale !== 1)
        .map((entry) => entry.boneName)
    );
    expect([...scaled].sort()).toEqual(["head", "leftFoot", "leftHand", "rightFoot", "rightHand"]);
  });

  it("자식 본의 월드 스케일은 의도한 상속만 받는다", () => {
    const p = withProportions({ headBodyRatio: 2.5, handScale: 1.3, footScale: 0.8, legLength: 1.4, armLength: 0.7 });

    // 의도된 상속: 서브트리 전체가 같이 커진다.
    expect(worldScale(p, "head")).toBeCloseTo(2.5, 12);
    expect(worldScale(p, "leftEye")).toBeCloseTo(2.5, 12);
    expect(worldScale(p, "jaw")).toBeCloseTo(2.5, 12);
    expect(worldScale(p, "leftHand")).toBeCloseTo(1.3, 12);
    expect(worldScale(p, "leftIndexProximal")).toBeCloseTo(1.3, 12);
    expect(worldScale(p, "leftThumbDistal")).toBeCloseTo(1.3, 12);
    expect(worldScale(p, "leftFoot")).toBeCloseTo(0.8, 12);
    expect(worldScale(p, "leftToes")).toBeCloseTo(0.8, 12);

    // 길이 편집을 아무리 해도 몸통·팔·다리 본에는 스케일이 새지 않는다.
    for (const bone of [
      "hips",
      "spine",
      "chest",
      "upperChest",
      "neck",
      "leftShoulder",
      "leftUpperArm",
      "leftLowerArm",
      "leftUpperLeg",
      "leftLowerLeg",
    ] as const) {
      expect(worldScale(p, bone)).toBe(1);
    }
  });

  it("대조군: 본을 늘리는 순진한 방식은 이중 스케일과 비균등 월드 스케일을 만든다", () => {
    const legLength = 1.5;

    // 순진한 방식 — 허벅지/정강이 본에 scale.y = legLength 를 준다.
    // 자식이 부모 스케일을 상속하므로 정강이는 legLength 가 두 번 곱해지고,
    // 발은 (x=1, y=legLength^2) 인 **비균등** 월드 스케일을 물려받아 전단이 생긴다.
    const naiveThigh = 0.45 * legLength;
    const naiveShin = 0.41 * legLength * legLength;
    const naiveFootWorldScale = { x: 1, y: legLength * legLength };
    expect(naiveThigh + naiveShin).not.toBeCloseTo(0.86 * legLength, 6);
    expect(naiveFootWorldScale.x).not.toBeCloseTo(naiveFootWorldScale.y, 6);

    // 이 모듈의 방식 — 관절 이동. 세그먼트는 정확히 의도한 배수, 발 스케일은 균등(=1).
    const ours = withProportions({ legLength });
    expect(segmentLength(ours, "leftUpperLeg", "leftLowerLeg")).toBeCloseTo(0.45 * legLength, 12);
    expect(segmentLength(ours, "leftLowerLeg", "leftFoot")).toBeCloseTo(0.41 * legLength, 12);
    expect(resolveStudioVrmProportionMetrics(ours).legLength).toBeCloseTo(0.86 * legLength, 12);
    expect(worldScale(ours, "leftFoot")).toBe(1);
  });

  it("균등 스케일 서브트리 내부(손가락·발가락·눈·턱)에는 연산이 생기지 않는다", () => {
    // 회귀 방지: 전체 키를 올릴 때 뿌리 스케일과 자손 이동이 함께 적용되면 배수가 두 번 곱해진다.
    const plan = resolveVrmProportionPlan(withProportions({ overallHeight: 1.4, handScale: 1.2 }));
    const touched = new Set(plan.map((entry) => entry.boneName));
    for (const bone of [
      "leftIndexProximal",
      "leftThumbDistal",
      "rightLittleIntermediate",
      "leftToes",
      "leftEye",
      "jaw",
    ] as const) {
      expect(touched.has(bone)).toBe(false);
    }
  });

  it("전체 키를 올려도 손가락 마디는 정확히 한 번만 확대된다", () => {
    const p = withProportions({ overallHeight: 1.4, handScale: 1.2 });
    const expected = 1.4 * 1.2;
    expect(worldScale(p, "leftIndexProximal")).toBeCloseTo(expected, 12);
    expect(segmentLength(p, "leftIndexProximal", "leftIndexIntermediate")).toBeCloseTo(
      studioVrmRestBoneLength(restBone("leftIndexIntermediate")) * expected,
      12
    );
  });

  it("연산 타입은 스칼라 스케일 하나만 가지므로 비균등 스케일을 표현할 수 없다", () => {
    for (const entry of resolveVrmProportionPlan(chibi)) {
      expect(typeof entry.scale).toBe("number");
      expect(entry.scale).toBeGreaterThan(0);
      expect(entry.translateLocal).toHaveLength(3);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("관절 연결성(gap 없음)", () => {
  const extreme = withProportions({
    legLength: 0.6,
    armLength: 1.4,
    torsoLength: 1.3,
    neckLength: 1.7,
    shoulderWidth: 1.35,
    handScale: 1.55,
    footScale: 1.5,
    headBodyRatio: 2.4,
    overallHeight: 1.3,
  });

  it("각 세그먼트의 월드 길이는 rest 길이 × 의도한 배수와 정확히 일치한다", () => {
    const h = 1.3;
    expect(segmentLength(extreme, "leftUpperLeg", "leftLowerLeg")).toBeCloseTo(0.45 * 0.6 * h, 12);
    expect(segmentLength(extreme, "leftLowerLeg", "leftFoot")).toBeCloseTo(0.41 * 0.6 * h, 12);
    expect(segmentLength(extreme, "leftUpperArm", "leftLowerArm")).toBeCloseTo(0.27 * 1.4 * h, 12);
    expect(segmentLength(extreme, "leftLowerArm", "leftHand")).toBeCloseTo(0.24 * 1.4 * h, 12);
    expect(segmentLength(extreme, "hips", "spine")).toBeCloseTo(0.11 * 1.3 * h, 12);
    expect(segmentLength(extreme, "neck", "head")).toBeCloseTo(0.08 * 1.7 * h, 12);
  });

  it("체인 전체 길이는 세그먼트 합과 같다(관절이 벌어지거나 겹치지 않는다)", () => {
    const hip = worldPosition(extreme, "leftUpperLeg");
    const ankle = worldPosition(extreme, "leftFoot");
    const straight = Math.hypot(hip[0] - ankle[0], hip[1] - ankle[1], hip[2] - ankle[2]);
    const sum =
      segmentLength(extreme, "leftUpperLeg", "leftLowerLeg") +
      segmentLength(extreme, "leftLowerLeg", "leftFoot");
    expect(straight).toBeCloseTo(sum, 12);
  });

  it("스케일된 서브트리(손·발)의 자식도 부모에 정확히 붙어 있다", () => {
    const handScaleWorld = worldScale(extreme, "leftHand");
    const footScaleWorld = worldScale(extreme, "leftFoot");
    expect(segmentLength(extreme, "leftHand", "leftIndexProximal")).toBeCloseTo(
      studioVrmRestBoneLength(restBone("leftIndexProximal")) * handScaleWorld,
      12
    );
    expect(segmentLength(extreme, "leftFoot", "leftToes")).toBeCloseTo(
      studioVrmRestBoneLength(restBone("leftToes")) * footScaleWorld,
      12
    );
  });

  it("검증기는 정상 플랜에서 어떤 문제도 보고하지 않는다", () => {
    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      expect(validateStudioVrmProportionPlan(resolveVrmProportionPlan(preset.proportions))).toEqual([]);
    }
    expect(validateStudioVrmProportionPlan(resolveVrmProportionPlan(extreme))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("중립 왕복 정확성", () => {
  it("중립 타깃은 rest 오프셋과 비트 단위로 동일하다", () => {
    for (const target of resolveVrmProportionBoneTargets(NEUTRAL_STUDIO_VRM_PROPORTIONS)) {
      const rest = restBone(target.boneName);
      expect(target.scale).toBe(1);
      expect(target.position[0]).toBe(rest.restOffset[0]);
      expect(target.position[1]).toBe(rest.restOffset[1]);
      expect(target.position[2]).toBe(rest.restOffset[2]);
    }
  });

  it("비율을 적용한 뒤 중립으로 되돌리면 원래 트랜스폼이 정확히 복원된다", () => {
    // 통합 레이어가 하는 일을 그대로 흉내낸다: rest 캐시 기준 **절대 대입**.
    type MockBone = { position: [number, number, number]; scale: number };
    const store = new Map<StudioHumanoidBoneName, MockBone>(
      REFERENCE.bones.map((bone) => [
        bone.name,
        { position: [...bone.restOffset] as [number, number, number], scale: 1 },
      ])
    );
    const apply = (proportions: StudioVrmProportions) => {
      for (const target of resolveVrmProportionBoneTargets(proportions)) {
        const bone = store.get(target.boneName);
        if (!bone) continue;
        bone.position = [...target.position] as [number, number, number];
        bone.scale = target.scale;
      }
    };

    apply(createStudioVrmProportions("sd-chibi-3"));
    apply(createStudioVrmProportions("runway-9"));
    apply(withProportions({ overallHeight: 1.6, legLength: 0.55 }));
    apply(NEUTRAL_STUDIO_VRM_PROPORTIONS);

    for (const bone of REFERENCE.bones) {
      const restored = store.get(bone.name);
      expect(restored?.scale).toBe(1);
      expect(restored?.position[0]).toBe(bone.restOffset[0]);
      expect(restored?.position[1]).toBe(bone.restOffset[1]);
      expect(restored?.position[2]).toBe(bone.restOffset[2]);
    }
  });

  it("중립 왕복 후 지표도 원래 값 그대로다", () => {
    const before = resolveStudioVrmProportionMetrics(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    resolveStudioVrmProportionMetrics(createStudioVrmProportions("mini-4"));
    const after = resolveStudioVrmProportionMetrics(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    expect(after).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */

describe("두신 지표와 프리셋", () => {
  it("레퍼런스 스냅샷의 중립 상태는 정확히 8두신 / 1.60 m 다", () => {
    const metrics = resolveStudioVrmProportionMetrics(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    expect(metrics.totalHeight).toBeCloseTo(1.6, 9);
    expect(metrics.headLength).toBeCloseTo(0.2, 12);
    expect(metrics.headUnits).toBeCloseTo(8, 9);
    expect(metrics.hipsHeight).toBeCloseTo(0.95, 12);
    expect(metrics.footHeight).toBeCloseTo(0.09, 12);
    expect(metrics.legLength).toBeCloseTo(0.86, 12);
    expect(metrics.armLength).toBeCloseTo(0.51, 12);
  });

  it("각 프리셋은 목표 두신 수를 실제로 만들어낸다", () => {
    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      const metrics = resolveStudioVrmProportionMetrics(preset.proportions);
      expect(metrics.headUnits).toBeCloseTo(preset.targetHeadUnits, 4);
      expect(preset.proportions.presetId).toBe(preset.id);
    }
  });

  it("프리셋의 headBodyRatio 수치는 문서화된 값으로 고정된다", () => {
    const byId = new Map(STUDIO_VRM_PROPORTION_PRESETS.map((preset) => [preset.id, preset]));
    expect(byId.get("realistic-8")?.proportions.headBodyRatio).toBe(1);
    expect(byId.get("webtoon-7")?.proportions.headBodyRatio).toBe(1.166667);
    expect(byId.get("shonen-6")?.proportions.headBodyRatio).toBe(1.3914);
    expect(byId.get("cartoon-5")?.proportions.headBodyRatio).toBe(1.64075);
    expect(byId.get("mini-4")?.proportions.headBodyRatio).toBe(1.987667);
    expect(byId.get("sd-chibi-3")?.proportions.headBodyRatio).toBe(2.507);
    expect(byId.get("runway-9")?.proportions.headBodyRatio).toBe(0.90975);
  });

  it("SD 프리셋은 머리를 키우면서 사지를 줄인다", () => {
    const chibi = createStudioVrmProportions("sd-chibi-3");
    expect(chibi.headBodyRatio).toBeGreaterThan(2);
    expect(chibi.legLength).toBeLessThan(0.7);
    expect(chibi.armLength).toBeLessThan(0.8);
    expect(chibi.neckLength).toBeLessThan(0.5);
    expect(chibi.handScale).toBeGreaterThan(1);
  });

  it("프리셋 id 는 유일하고 모든 값이 허용 구간 안에 있다", () => {
    const ids = STUDIO_VRM_PROPORTION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      for (const key of STUDIO_VRM_PROPORTION_KEYS) {
        const limit = STUDIO_VRM_PROPORTION_LIMITS[key];
        expect(preset.proportions[key]).toBeGreaterThanOrEqual(limit.min);
        expect(preset.proportions[key]).toBeLessThanOrEqual(limit.max);
      }
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.hint.length).toBeGreaterThan(0);
    }
  });

  it("createStudioVrmProportions 는 알 수 없는 id 를 중립으로 폴백한다", () => {
    expect(createStudioVrmProportions()).toEqual(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    expect(createStudioVrmProportions("존재하지-않음")).toEqual(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    expect(createStudioVrmProportions("mini-4").headBodyRatio).toBe(1.987667);
  });

  it("두신 역산은 왕복한다", () => {
    // 도달 가능한 구간(headBodyRatio 상한 3.6 ⇒ 최소 약 2.94두신)만 왕복을 요구한다.
    for (const units of [3, 4.5, 6, 7, 8, 9, 12]) {
      const headBodyRatio = solveStudioVrmHeadBodyRatioForHeadUnits(units);
      const metrics = resolveStudioVrmProportionMetrics(withProportions({ headBodyRatio }));
      expect(metrics.headUnits).toBeCloseTo(units, 9);
    }
  });

  it("두신 역산은 비정상 입력에서도 유효 범위를 지킨다", () => {
    const limit = STUDIO_VRM_PROPORTION_LIMITS.headBodyRatio;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3, 0, 1, 500]) {
      const solved = solveStudioVrmHeadBodyRatioForHeadUnits(bad);
      expect(Number.isFinite(solved)).toBe(true);
      expect(solved).toBeGreaterThanOrEqual(limit.min);
      expect(solved).toBeLessThanOrEqual(limit.max);
    }
  });

  it("두신 라벨은 소수 한 자리로 표기된다", () => {
    expect(formatStudioVrmHeadUnits(8)).toBe("8.0두신");
    expect(formatStudioVrmHeadUnits(2.96)).toBe("3.0두신");
    expect(formatStudioVrmHeadUnits(Number.NaN)).toBe("—");
    expect(formatStudioVrmHeadUnits(0)).toBe("—");
  });
});

/* -------------------------------------------------------------------------- */

describe("직렬화", () => {
  it("JSON 왕복이 값을 보존한다", () => {
    const source = createStudioVrmProportions("cartoon-5");
    const restored = parseStudioVrmProportions(JSON.stringify(serializeStudioVrmProportions(source)));
    expect(restored).toEqual(source);
  });

  it("객체를 그대로 넘겨도 파싱된다", () => {
    const source = createStudioVrmProportions("webtoon-7");
    expect(parseStudioVrmProportions(source)).toEqual(source);
  });

  it("손상되거나 알 수 없는 입력에도 던지지 않고 중립으로 회복한다", () => {
    const corrupt: unknown[] = [
      undefined,
      null,
      "",
      "not json at all",
      "{oops",
      "[1,2,3]",
      42,
      [],
      { version: 99, overallHeight: "NaN", 알수없는필드: true },
      { face: { headWidth: 1.2 } },
      JSON.stringify({ overallHeight: null, headBodyRatio: "x" }),
      '{"__proto__":{"polluted":true},"legLength":1.2}',
    ];
    for (const raw of corrupt) {
      const parsed = parseStudioVrmProportions(raw);
      expect(parsed.version).toBe(1);
      for (const key of STUDIO_VRM_PROPORTION_KEYS) {
        expect(Number.isFinite(parsed[key])).toBe(true);
        expect(parsed[key]).toBeGreaterThanOrEqual(STUDIO_VRM_PROPORTION_LIMITS[key].min);
        expect(parsed[key]).toBeLessThanOrEqual(STUDIO_VRM_PROPORTION_LIMITS[key].max);
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("직렬화 결과에는 알 수 없는 필드가 남지 않는다", () => {
    const serialized = serializeStudioVrmProportions({
      overallHeight: 1.1,
      악성필드: "drop me",
      nested: { a: 1 },
    });
    expect(Object.keys(serialized).sort()).toEqual(
      ["version", ...STUDIO_VRM_PROPORTION_KEYS].sort()
    );
  });

  it("손상된 저장본도 플랜을 만들 수 있다", () => {
    const plan = resolveVrmProportionPlan("완전히 망가진 값");
    expect(plan).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("결정성과 스냅샷 강건성", () => {
  const preset = createStudioVrmProportions("mini-4");

  it("같은 입력은 항상 같은 플랜을 만든다", () => {
    expect(resolveVrmProportionPlan(preset)).toEqual(resolveVrmProportionPlan(preset));
    expect(resolveVrmProportionBoneTargets(preset)).toEqual(resolveVrmProportionBoneTargets(preset));
    expect(resolveStudioVrmProportionMetrics(preset)).toEqual(
      resolveStudioVrmProportionMetrics(preset)
    );
  });

  it("연산 순서는 스냅샷 입력 순서와 무관하게 휴머노이드 표준 순서를 따른다", () => {
    const shuffled: StudioVrmBoneHierarchySnapshot = {
      headLength: REFERENCE.headLength,
      bones: [...REFERENCE.bones].reverse(),
    };
    const expectedOrder = resolveVrmProportionPlan(preset).map((entry) => entry.boneName);
    expect(resolveVrmProportionPlan(preset, shuffled).map((entry) => entry.boneName)).toEqual(
      expectedOrder
    );
    const canonicalOrder = STUDIO_HUMANOID_BONE_NAMES.filter((name) => expectedOrder.includes(name));
    expect(expectedOrder).toEqual([...canonicalOrder]);
  });

  it("선택 본(upperChest·toes·눈·턱)이 없는 모델도 처리한다", () => {
    const optional = new Set(["upperChest", "leftToes", "rightToes", "leftEye", "rightEye", "jaw"]);
    const reduced: StudioVrmBoneHierarchySnapshot = {
      headLength: REFERENCE.headLength,
      bones: REFERENCE.bones
        .filter((bone) => !optional.has(bone.name))
        // upperChest 가 없는 리그에서는 목·쇄골이 chest 에 직결된다.
        .map((bone) =>
          bone.parent === "upperChest" ? { ...bone, parent: "chest" as StudioHumanoidBoneName } : bone
        ),
    };
    const plan = resolveVrmProportionPlan(createStudioVrmProportions("sd-chibi-3"), reduced);
    expect(plan.some((entry) => entry.boneName === "upperChest")).toBe(false);
    expect(plan.some((entry) => entry.boneName === "neck")).toBe(true);
    expect(validateStudioVrmProportionPlan(plan, reduced)).toEqual([]);

    const metrics = resolveStudioVrmProportionMetrics(
      createStudioVrmProportions("sd-chibi-3"),
      reduced
    );
    expect(Number.isFinite(metrics.headUnits)).toBe(true);
    expect(metrics.headUnits).toBeGreaterThan(2);
  });

  it("손상된 스냅샷 항목은 조용히 무시된다", () => {
    const dirty = {
      headLength: Number.NaN,
      bones: [
        ...REFERENCE.bones,
        { name: "notABone", parent: "hips", restOffset: [1, 1, 1] },
        { name: "chest", parent: "spine", restOffset: [Number.NaN, 0, 0] },
        null,
      ],
    } as unknown as StudioVrmBoneHierarchySnapshot;
    const plan = resolveVrmProportionPlan(createStudioVrmProportions("cartoon-5"), dirty);
    expect(plan.some((entry) => String(entry.boneName) === "notABone")).toBe(false);
    for (const entry of plan) {
      expect(Number.isFinite(entry.scale)).toBe(true);
      expect(entry.translateLocal.every((component) => Number.isFinite(component))).toBe(true);
    }
    // headLength 가 손상되면 두신 수는 0(=측정 불가)으로 떨어지고 예외는 나지 않는다.
    expect(resolveStudioVrmProportionMetrics(NEUTRAL_STUDIO_VRM_PROPORTIONS, dirty).headUnits).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("휴머노이드 유효성 검증", () => {
  it("필수 본이 빠진 스냅샷을 보고한다", () => {
    const broken: StudioVrmBoneHierarchySnapshot = {
      headLength: REFERENCE.headLength,
      bones: REFERENCE.bones.filter((bone) => bone.name !== "leftHand" && bone.name !== "head"),
    };
    const issues = validateStudioVrmProportionPlan(resolveVrmProportionPlan(NEUTRAL_STUDIO_VRM_PROPORTIONS), broken);
    const missing = issues.filter((issue) => issue.code === "missing-required-bone").map((i) => i.boneName);
    expect(missing).toContain("leftHand");
    expect(missing).toContain("head");
    expect(STUDIO_VRM_REQUIRED_HUMANOID_BONES).toHaveLength(15);
  });

  it("스케일된 조상 아래의 이동 연산을 위반으로 잡는다", () => {
    // 손이 스케일된 상태에서 손가락을 이동시키면 이동량이 손 스케일만큼 증폭된다.
    // 이 모듈의 리졸버는 이런 플랜을 만들지 않지만, 회귀 방어선으로 검사한다.
    const illegal: StudioVrmProportionOp[] = [
      { boneName: "leftHand", scale: 1.4, translateLocal: [0, 0, 0] },
      { boneName: "leftIndexProximal", scale: 1, translateLocal: [0.01, 0, 0] },
    ];
    const issues = validateStudioVrmProportionPlan(illegal);
    expect(issues.map((issue) => issue.code)).toContain("scaled-ancestor-of-translated-bone");
    expect(issues[0]?.boneName).toBe("leftIndexProximal");
  });

  it("허용 목록 밖 본과 비정상 수치를 보고한다", () => {
    const illegal = [
      { boneName: "evilBone", scale: 1, translateLocal: [1, 0, 0] },
      { boneName: "spine", scale: Number.NaN, translateLocal: [0, 0, 0] },
      { boneName: "chest", scale: 0, translateLocal: [0, 0, 0] },
    ] as unknown as StudioVrmProportionOp[];
    const codes = validateStudioVrmProportionPlan(illegal).map((issue) => issue.code);
    expect(codes).toContain("unknown-bone");
    expect(codes).toContain("non-finite");
    expect(codes).toContain("non-positive-scale");
  });

  it("본을 추가·삭제하지 않는다 — 타깃 집합은 스냅샷 본 집합과 정확히 같다", () => {
    const targets = resolveVrmProportionBoneTargets(createStudioVrmProportions("sd-chibi-3"));
    expect(targets.map((target) => target.boneName).sort()).toEqual(
      REFERENCE.bones.map((bone) => bone.name).sort()
    );
  });
});
