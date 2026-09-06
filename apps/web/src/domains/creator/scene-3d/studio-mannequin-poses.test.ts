import { describe, expect, it } from "vitest";

import {
  clampStudioMannequinJointRotation,
  isStudioMannequinJointId,
  STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
  STUDIO_MANNEQUIN_PARAM_RANGES,
} from "./studio-mannequin-model";
import {
  STUDIO_MANNEQUIN_POSE_DOC_KIND,
  STUDIO_MANNEQUIN_POSE_DOC_VERSION,
  STUDIO_MANNEQUIN_POSE_PRESETS,
  createStudioMannequinRestPose,
  findStudioMannequinPosePreset,
  mirrorStudioMannequinPose,
  normalizeStudioMannequinPose,
  parseStudioMannequinPose,
  parseStudioMannequinState,
  serializeStudioMannequinPose,
  serializeStudioMannequinState,
} from "./studio-mannequin-poses";

const LIMIT_EPSILON = 1e-5;

describe("studio-mannequin-poses 프리셋 라이브러리", () => {
  it("프리셋이 12개 이상이고 id 가 유일하며 한글 라벨을 가진다", () => {
    expect(STUDIO_MANNEQUIN_POSE_PRESETS.length).toBeGreaterThanOrEqual(12);
    const ids = STUDIO_MANNEQUIN_POSE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of STUDIO_MANNEQUIN_POSE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it("모든 프리셋 각도는 관절 한계 안에서 저작되었다", () => {
    for (const preset of STUDIO_MANNEQUIN_POSE_PRESETS) {
      for (const [jointId, rotation] of Object.entries(preset.pose.joints)) {
        expect(isStudioMannequinJointId(jointId)).toBe(true);
        const clamped = clampStudioMannequinJointRotation(jointId, rotation);
        for (let axis = 0; axis < 3; axis += 1) {
          expect(
            Math.abs(clamped[axis] - rotation![axis]),
            `${preset.id}.${jointId}[${axis}] 이 한계를 벗어났습니다`,
          ).toBeLessThan(LIMIT_EPSILON);
        }
      }
    }
  });

  it("id 조회는 존재하는 프리셋만 반환한다", () => {
    expect(findStudioMannequinPosePreset("wave")?.label).toBe("손흔들기");
    expect(findStudioMannequinPosePreset("no-such-pose")).toBeNull();
    expect(findStudioMannequinPosePreset(42)).toBeNull();
  });
});

describe("studio-mannequin-poses 미러", () => {
  it("두 번 미러하면 원본 포즈로 돌아온다(involution)", () => {
    for (const preset of STUDIO_MANNEQUIN_POSE_PRESETS) {
      const normalized = normalizeStudioMannequinPose(preset.pose);
      const roundTrip = normalizeStudioMannequinPose(
        mirrorStudioMannequinPose(mirrorStudioMannequinPose(normalized)),
      );
      expect(roundTrip).toEqual(normalized);
    }
  });

  it("좌우 관절을 스왑하고 Y/Z 를 반전한다", () => {
    const punch = findStudioMannequinPosePreset("punch")!;
    const mirrored = mirrorStudioMannequinPose(punch.pose);
    const original = punch.pose.joints.rightUpperArm!;
    const swapped = mirrored.joints.leftUpperArm!;
    expect(swapped[0]).toBeCloseTo(original[0], 12);
    expect(swapped[1]).toBeCloseTo(-original[1], 12);
    expect(swapped[2]).toBeCloseTo(-original[2], 12);
  });

  it("골반 오프셋의 X 축을 반전한다", () => {
    const mirrored = mirrorStudioMannequinPose({
      joints: {},
      pelvisOffset: [0.3, -0.4, 0.1],
    });
    expect(mirrored.pelvisOffset).toEqual([-0.3, -0.4, 0.1]);
  });
});

describe("studio-mannequin-poses 직렬화", () => {
  it("serialize→parse 왕복은 정규화된 포즈와 동일하다", () => {
    for (const preset of STUDIO_MANNEQUIN_POSE_PRESETS) {
      const serialized = serializeStudioMannequinPose(preset.pose);
      const parsed = parseStudioMannequinPose(serialized);
      expect(parsed).toEqual(normalizeStudioMannequinPose(preset.pose));
    }
  });

  it("버전드 문서 계약을 강제한다", () => {
    const serialized = serializeStudioMannequinPose(createStudioMannequinRestPose());
    const document = JSON.parse(serialized) as Record<string, unknown>;
    expect(document.kind).toBe(STUDIO_MANNEQUIN_POSE_DOC_KIND);
    expect(document.version).toBe(STUDIO_MANNEQUIN_POSE_DOC_VERSION);

    expect(parseStudioMannequinPose(JSON.stringify({ ...document, kind: "other" }))).toBeNull();
    expect(parseStudioMannequinPose(JSON.stringify({ ...document, version: 99 }))).toBeNull();
  });

  it("깨진 입력·과대 입력·비 JSON 을 방어한다", () => {
    expect(parseStudioMannequinPose("not-json{")).toBeNull();
    expect(parseStudioMannequinPose(null)).toBeNull();
    expect(parseStudioMannequinPose(17)).toBeNull();
    expect(parseStudioMannequinPose(`{"a":"${"x".repeat(20_000)}"}`)).toBeNull();
  });

  it("알 수 없는 관절·비정상 각도·항등 회전을 정규화한다", () => {
    // __proto__ 를 실제 own key 로 담기 위해 원시 JSON 문자열을 쓴다(리터럴은 프로토타입 설정).
    const parsed = parseStudioMannequinPose(
      `{"kind":"${STUDIO_MANNEQUIN_POSE_DOC_KIND}","version":${STUDIO_MANNEQUIN_POSE_DOC_VERSION},`
        + '"joints":{"head":[0.1,0,0],"tail":[1,1,1],"__proto__":[1,1,1],"spine":[0,0,0],'
        + '"leftHand":[null,"x",99]},"pelvisOffset":[99,null,-99]}',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.joints.head?.[0]).toBeCloseTo(0.1, 6);
    expect("tail" in parsed!.joints).toBe(false);
    // 항등 회전은 canonical 표현에서 생략된다.
    expect("spine" in parsed!.joints).toBe(false);
    // NaN→0, 접힌 각도는 한계로 클램프.
    const leftHand = parsed!.joints.leftHand;
    expect(leftHand?.[0]).toBe(0);
    expect(leftHand?.[1]).toBe(0);
    expect(Number.isFinite(leftHand?.[2])).toBe(true);
    // 골반 오프셋은 ±2m 로 클램프.
    expect(parsed!.pelvisOffset[0]).toBe(2);
    expect(parsed!.pelvisOffset[1]).toBe(0);
    expect(parsed!.pelvisOffset[2]).toBe(-2);
  });

  it("직렬화 출력은 결정적이다(같은 포즈 → 같은 문자열)", () => {
    const pose = findStudioMannequinPosePreset("run")!.pose;
    expect(serializeStudioMannequinPose(pose)).toBe(serializeStudioMannequinPose(pose));
    // 관절 키 순서가 달라도 canonical 순서로 직렬화된다.
    const reordered = {
      joints: Object.fromEntries(Object.entries(pose.joints).reverse()),
      pelvisOffset: pose.pelvisOffset,
    };
    expect(serializeStudioMannequinPose(reordered)).toBe(serializeStudioMannequinPose(pose));
  });
});

describe("studio-mannequin-poses 세션 상태 영속", () => {
  it("체형+포즈 상태 왕복에서 파라미터가 클램프된다", () => {
    const serialized = serializeStudioMannequinState({
      params: { ...STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS, heightCm: 500, build: -9 },
      pose: findStudioMannequinPosePreset("sit-chair")!.pose,
    });
    const parsed = parseStudioMannequinState(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.params.heightCm).toBe(STUDIO_MANNEQUIN_PARAM_RANGES.heightCm[1]);
    expect(parsed!.params.build).toBe(STUDIO_MANNEQUIN_PARAM_RANGES.build[0]);
    expect(parsed!.pose).toEqual(
      normalizeStudioMannequinPose(findStudioMannequinPosePreset("sit-chair")!.pose),
    );
  });

  it("깨진 상태 문서는 null 을 반환한다(호출자가 기본값 사용)", () => {
    expect(parseStudioMannequinState(null)).toBeNull();
    expect(parseStudioMannequinState("garbage")).toBeNull();
    expect(parseStudioMannequinState(JSON.stringify({ kind: "studio-mannequin-state" }))).toBeNull();
  });
});
