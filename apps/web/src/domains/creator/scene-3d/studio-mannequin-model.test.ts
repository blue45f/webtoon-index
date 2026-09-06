import { describe, expect, it } from "vitest";

import {
  STUDIO_MANNEQUIN_BODY_PRESETS,
  STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
  STUDIO_MANNEQUIN_JOINT_IDS,
  STUDIO_MANNEQUIN_JOINT_LIMITS,
  STUDIO_MANNEQUIN_MATERIAL_STYLES,
  STUDIO_MANNEQUIN_PARAM_RANGES,
  buildStudioMannequinSpec,
  canonicalizeStudioMannequinAngle,
  clampStudioMannequinBodyParams,
  clampStudioMannequinJointRotation,
  getStudioMannequinJointLimit,
  mirrorStudioMannequinJointLimit,
  studioMannequinRestJointPosition,
  studioMannequinRestStature,
  type StudioMannequinBodyParams,
} from "./studio-mannequin-model";

const STATURE_EPSILON = 1e-9;

function params(overrides: Partial<StudioMannequinBodyParams> = {}): StudioMannequinBodyParams {
  return { ...STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS, ...overrides };
}

describe("studio-mannequin-model 비례 수학", () => {
  it("두신 단위는 신장/두신 비율이고 머리 프리미티브 길이와 일치한다", () => {
    const spec = buildStudioMannequinSpec(params({ heightCm: 180, headCount: 6 }));
    expect(spec.headUnit).toBeCloseTo(1.8 / 6, 12);

    const head = spec.primitives.find(
      (primitive) => primitive.kind === "sphere" && primitive.jointId === "head",
    );
    expect(head).toBeDefined();
    if (head?.kind === "sphere") {
      // 정수리~턱 길이 = 지름(스케일 Y 1) = 두신 단위.
      expect(head.radius * 2).toBeCloseTo(spec.headUnit, 12);
    }
  });

  it("rest 자세 정수리 높이는 파라미터와 무관하게 신장과 일치한다(불변식)", () => {
    const cases: StudioMannequinBodyParams[] = [
      params(),
      params({ headCount: 4 }),
      params({ headCount: 9, heightCm: 200 }),
      params({ legLength: 0.8 }),
      params({ legLength: 1.2, armLength: 1.2 }),
      params({ build: 0 }),
      params({ build: 3, shoulderWidth: 1.3, pelvisWidth: 1.3 }),
      ...Object.values(STUDIO_MANNEQUIN_BODY_PRESETS).map((preset) => preset.params),
    ];
    for (const bodyParams of cases) {
      const spec = buildStudioMannequinSpec(bodyParams);
      expect(Math.abs(studioMannequinRestStature(spec) - spec.heightM)).toBeLessThan(
        STATURE_EPSILON,
      );
    }
  });

  it("두신 비율이 커지면 같은 신장에서 두신 단위는 줄고 다리 비중은 커진다", () => {
    const low = buildStudioMannequinSpec(params({ headCount: 5 }));
    const high = buildStudioMannequinSpec(params({ headCount: 9 }));
    expect(high.headUnit).toBeLessThan(low.headUnit);

    const lowHip = studioMannequinRestJointPosition(low, "pelvis")[1] / low.heightM;
    const highHip = studioMannequinRestJointPosition(high, "pelvis")[1] / high.heightM;
    expect(highHip).toBeGreaterThan(lowHip);
  });

  it("legLength 는 신장을 바꾸지 않고 다리/몸통 비율만 재분배한다", () => {
    const short = buildStudioMannequinSpec(params({ legLength: 0.8 }));
    const long = buildStudioMannequinSpec(params({ legLength: 1.2 }));
    expect(studioMannequinRestJointPosition(long, "pelvis")[1]).toBeGreaterThan(
      studioMannequinRestJointPosition(short, "pelvis")[1],
    );
    expect(studioMannequinRestStature(short)).toBeCloseTo(short.heightM, 9);
    expect(studioMannequinRestStature(long)).toBeCloseTo(long.heightM, 9);
  });

  it("armLength 는 체인 본 길이를 비례 확장한다", () => {
    const base = buildStudioMannequinSpec(params({ armLength: 1 }));
    const stretched = buildStudioMannequinSpec(params({ armLength: 1.2 }));
    expect(stretched.chains.leftArm.upperLength).toBeCloseTo(
      base.chains.leftArm.upperLength * 1.2,
      12,
    );
    expect(stretched.chains.leftArm.lowerLength).toBeCloseTo(
      base.chains.leftArm.lowerLength * 1.2,
      12,
    );
  });

  it("체인 길이는 관절 오프셋과 정합한다", () => {
    const spec = buildStudioMannequinSpec(params());
    const lowerArm = spec.joints.find((joint) => joint.id === "leftLowerArm");
    const hand = spec.joints.find((joint) => joint.id === "leftHand");
    expect(Math.abs(lowerArm!.offset[1])).toBeCloseTo(spec.chains.leftArm.upperLength, 12);
    expect(Math.abs(hand!.offset[1])).toBeCloseTo(spec.chains.leftArm.lowerLength, 12);

    const lowerLeg = spec.joints.find((joint) => joint.id === "leftLowerLeg");
    const foot = spec.joints.find((joint) => joint.id === "leftFoot");
    expect(Math.abs(lowerLeg!.offset[1])).toBeCloseTo(spec.chains.leftLeg.upperLength, 12);
    expect(Math.abs(foot!.offset[1])).toBeCloseTo(spec.chains.leftLeg.lowerLength, 12);
  });

  it("남성 프리셋 어깨는 여성 프리셋보다 넓다", () => {
    const male = buildStudioMannequinSpec(STUDIO_MANNEQUIN_BODY_PRESETS.male.params);
    const female = buildStudioMannequinSpec(STUDIO_MANNEQUIN_BODY_PRESETS.female.params);
    const shoulderX = (spec: ReturnType<typeof buildStudioMannequinSpec>) =>
      studioMannequinRestJointPosition(spec, "leftUpperArm")[0] / spec.heightM;
    expect(shoulderX(male)).toBeGreaterThan(shoulderX(female));
  });

  it("모든 체형 프리셋은 클램프 왕복에서 조용히 변형되지 않는다", () => {
    for (const [presetId, preset] of Object.entries(STUDIO_MANNEQUIN_BODY_PRESETS)) {
      expect(clampStudioMannequinBodyParams(preset.params), presetId).toEqual(preset.params);
    }
    expect(buildStudioMannequinSpec(STUDIO_MANNEQUIN_BODY_PRESETS.chibi3.params).params.headCount)
      .toBe(3.2);
  });

  it("고령·단단한 체형·무용수·판타지 거인 프리셋을 서로 다른 실루엣으로 제공한다", () => {
    const presets = STUDIO_MANNEQUIN_BODY_PRESETS;
    expect(Object.keys(presets)).toEqual(expect.arrayContaining([
      "senior",
      "stocky",
      "dancer",
      "fantasyGiant",
    ]));
    expect(presets.senior.params.legLength).toBeLessThan(presets.dancer.params.legLength);
    expect(presets.stocky.params.shoulderWidth).toBeGreaterThan(presets.dancer.params.shoulderWidth);
    expect(presets.fantasyGiant.params.heightCm).toBe(200);

    const signatures = ["senior", "stocky", "dancer", "fantasyGiant"].map((id) => {
      const preset = presets[id as keyof typeof presets];
      const spec = buildStudioMannequinSpec(preset.params);
      return JSON.stringify({
        params: spec.params,
        pelvis: studioMannequinRestJointPosition(spec, "pelvis"),
        shoulder: studioMannequinRestJointPosition(spec, "leftUpperArm"),
      });
    });
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("어깨·팔꿈치·손목·고관절·무릎·발목에 데생용 관절구를 만든다", () => {
    const spec = buildStudioMannequinSpec(params());
    const jointBallIds = [
      "leftUpperArm",
      "leftLowerArm",
      "leftHand",
      "rightUpperArm",
      "rightLowerArm",
      "rightHand",
      "leftUpperLeg",
      "leftLowerLeg",
      "leftFoot",
      "rightUpperLeg",
      "rightLowerLeg",
      "rightFoot",
    ] as const;
    for (const jointId of jointBallIds) {
      expect(
        spec.primitives.some((primitive) =>
          primitive.kind === "sphere"
          && primitive.jointId === jointId
          && primitive.center.every((value) => value === 0)
          && primitive.radius > 0),
        jointId,
      ).toBe(true);
    }
  });

  it("손과 발은 방향을 읽기 쉬운 비균등 타원체이고 양발 바닥은 y=0이다", () => {
    const spec = buildStudioMannequinSpec(params());
    for (const handId of ["leftHand", "rightHand"] as const) {
      const palm = spec.primitives.find((primitive) =>
        primitive.kind === "sphere"
        && primitive.jointId === handId
        && primitive.center[1] < 0);
      expect(palm?.kind).toBe("sphere");
      if (palm?.kind === "sphere") {
        expect(palm.scale?.[0]).not.toBe(palm.scale?.[1]);
        expect(palm.scale?.[2]).not.toBe(palm.scale?.[1]);
      }
    }

    for (const footId of ["leftFoot", "rightFoot"] as const) {
      const foot = spec.primitives.find((primitive) =>
        primitive.kind === "sphere"
        && primitive.jointId === footId
        && primitive.center[1] < 0);
      expect(foot?.kind).toBe("sphere");
      if (foot?.kind !== "sphere" || !foot.scale) continue;
      const footJointY = studioMannequinRestJointPosition(spec, footId)[1];
      expect(footJointY + foot.center[1] - foot.radius * foot.scale[1]).toBeCloseTo(0, 12);
    }
  });

  it("각 손은 네 손가락과 엄지 캡슐을 가지며 좌우 디테일이 X축 미러다", () => {
    const spec = buildStudioMannequinSpec(params());
    const digits = (jointId: "leftHand" | "rightHand") => spec.primitives.filter(
      (primitive) => primitive.kind === "capsule" && primitive.jointId === jointId,
    );
    const left = digits("leftHand");
    const right = digits("rightHand");
    expect(left).toHaveLength(5);
    expect(right).toHaveLength(5);

    for (let index = 0; index < left.length; index += 1) {
      const leftDigit = left[index];
      const rightDigit = right[index];
      if (leftDigit?.kind !== "capsule" || rightDigit?.kind !== "capsule") continue;
      expect(rightDigit.from).toEqual([-leftDigit.from[0], leftDigit.from[1], leftDigit.from[2]]);
      expect(rightDigit.to).toEqual([-leftDigit.to[0], leftDigit.to[1], leftDigit.to[2]]);
      expect(rightDigit.radius).toBe(leftDigit.radius);
    }
  });

  it("두 눈 가이드는 좌우 대칭이고 머리와 함께 정수리 신장 불변식을 보존한다", () => {
    const spec = buildStudioMannequinSpec(params());
    const eyes = spec.primitives.filter((primitive) =>
      primitive.kind === "sphere"
      && primitive.jointId === "head"
      && primitive.scale?.[2] === 0.38,
    );
    expect(eyes).toHaveLength(2);
    if (eyes[0]?.kind === "sphere" && eyes[1]?.kind === "sphere") {
      expect(eyes[0].center[0]).toBe(-eyes[1].center[0]);
      expect(eyes[0].center.slice(1)).toEqual(eyes[1].center.slice(1));
    }
    expect(studioMannequinRestStature(spec)).toBeCloseTo(spec.heightM, 12);
  });
});

describe("studio-mannequin-model 재질 다양성", () => {
  it("청동과 백자를 포함한 재질 id/label이 중복 없이 노출된다", () => {
    const ids = STUDIO_MANNEQUIN_MATERIAL_STYLES.map((style) => style.id);
    const labels = STUDIO_MANNEQUIN_MATERIAL_STYLES.map((style) => style.label);
    expect(ids).toEqual(expect.arrayContaining(["bronze", "porcelain"]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("studio-mannequin-model 파라미터 클램프", () => {
  it("범위 밖·비수치 입력을 항상 유효한 값으로 정규화한다", () => {
    const clamped = clampStudioMannequinBodyParams({
      heightCm: 999,
      headCount: -3,
      shoulderWidth: Number.NaN,
      pelvisWidth: Number.POSITIVE_INFINITY,
      armLength: "wide",
      legLength: 0,
      build: 100,
    });
    expect(clamped.heightCm).toBe(STUDIO_MANNEQUIN_PARAM_RANGES.heightCm[1]);
    expect(clamped.headCount).toBe(STUDIO_MANNEQUIN_PARAM_RANGES.headCount[0]);
    expect(clamped.shoulderWidth).toBe(STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS.shoulderWidth);
    // 비유한값(Infinity/NaN)은 클램프가 아니라 기본값 폴백 — 손상 입력이 극단값이 되지 않게.
    expect(clamped.pelvisWidth).toBe(STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS.pelvisWidth);
    expect(clamped.armLength).toBe(STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS.armLength);
    expect(clamped.legLength).toBe(STUDIO_MANNEQUIN_PARAM_RANGES.legLength[0]);
    expect(clamped.build).toBe(STUDIO_MANNEQUIN_PARAM_RANGES.build[1]);
  });

  it("null/비객체 입력은 기본 파라미터가 된다", () => {
    expect(clampStudioMannequinBodyParams(null)).toEqual(STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS);
    expect(clampStudioMannequinBodyParams("x")).toEqual(STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS);
  });
});

describe("studio-mannequin-model 결정성", () => {
  it("같은 파라미터는 항상 동일한 스펙을 만든다", () => {
    const input = STUDIO_MANNEQUIN_BODY_PRESETS.male.params;
    const first = buildStudioMannequinSpec(input);
    const second = buildStudioMannequinSpec(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("studio-mannequin-model 관절 한계", () => {
  it("모든 관절에 한계가 정의되어 있다", () => {
    for (const jointId of STUDIO_MANNEQUIN_JOINT_IDS) {
      const jointLimit = STUDIO_MANNEQUIN_JOINT_LIMITS[jointId];
      expect(jointLimit).toBeDefined();
      for (const axis of ["x", "y", "z"] as const) {
        expect(jointLimit[axis][0]).toBeLessThanOrEqual(jointLimit[axis][1]);
      }
    }
  });

  it("우측 한계는 좌측의 미러다(X 유지, Y/Z 반전)", () => {
    const left = STUDIO_MANNEQUIN_JOINT_LIMITS.leftUpperArm;
    const right = STUDIO_MANNEQUIN_JOINT_LIMITS.rightUpperArm;
    expect(right).toEqual(mirrorStudioMannequinJointLimit(left));
    expect(right.x).toEqual(left.x);
    expect(right.z[0]).toBeCloseTo(-left.z[1], 12);
    expect(right.z[1]).toBeCloseTo(-left.z[0], 12);
  });

  it("클램프는 한계를 벗어난 회전을 잘라내고 비정상 입력을 0으로 만든다", () => {
    const clamped = clampStudioMannequinJointRotation("leftLowerLeg", [-Math.PI, 99, "x"]);
    const jointLimit = getStudioMannequinJointLimit("leftLowerLeg");
    expect(clamped[0]).toBeCloseTo(jointLimit.x[0], 9);
    expect(clamped[1]).toBeLessThanOrEqual(jointLimit.y[1]);
    expect(clamped[2]).toBe(0);
  });

  it("알 수 없는 관절은 보수적 폴백 한계를 쓴다", () => {
    const fallback = getStudioMannequinJointLimit("tail");
    expect(fallback.x[0]).toBeCloseTo(-Math.PI, 9);
    expect(fallback.x[1]).toBeCloseTo(Math.PI, 9);
  });

  it("표준 각도 접기는 결정적이고 -0 을 만들지 않는다", () => {
    expect(canonicalizeStudioMannequinAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 5);
    expect(Object.is(canonicalizeStudioMannequinAngle(-0), -0)).toBe(false);
    expect(canonicalizeStudioMannequinAngle(Number.NaN)).toBe(0);
  });
});
