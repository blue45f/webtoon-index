/**
 * Studio 3D 데생 인형 — 파라메트릭 마네킹 모델(순수 데이터 계층).
 *
 * 클립스튜디오의 데생 인형처럼 외부 에셋(VRM/GLB) 없이 신장·두신 비율·어깨/골반 너비·
 * 팔다리 길이·체형 블렌드만으로 관절 계층과 프리미티브(캡슐/구/박스) 스펙을 생성한다.
 * Three.js를 import하지 않는 결정적(pure) 모듈이라 단위 테스트와 직렬화가 안전하며,
 * 실제 메시 생성은 studio-mannequin-scene.ts 가 이 스펙을 소비해서 수행한다.
 *
 * 좌표 규약: 캐릭터는 +Z를 바라보고 +X가 캐릭터의 왼쪽 팔다리다. 모든 관절의 rest 회전은
 * 항등이고, 팔다리 본은 관절 로컬 −Y 방향으로, 몸통 본은 +Y 방향으로 뻗는다(IK 전제).
 */

export type StudioMannequinVec3 = readonly [number, number, number];

export const STUDIO_MANNEQUIN_JOINT_IDS = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
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

export type StudioMannequinJointId = (typeof STUDIO_MANNEQUIN_JOINT_IDS)[number];

export function isStudioMannequinJointId(value: unknown): value is StudioMannequinJointId {
  return typeof value === "string"
    && (STUDIO_MANNEQUIN_JOINT_IDS as readonly string[]).includes(value);
}

/** UI에 노출하는 관절 한글 라벨. */
export const STUDIO_MANNEQUIN_JOINT_LABELS: Readonly<Record<StudioMannequinJointId, string>> =
  Object.freeze({
    pelvis: "골반",
    spine: "허리",
    chest: "가슴",
    neck: "목",
    head: "머리",
    leftShoulder: "왼쪽 어깨(쇄골)",
    leftUpperArm: "왼쪽 위팔",
    leftLowerArm: "왼쪽 팔꿈치",
    leftHand: "왼쪽 손목",
    rightShoulder: "오른쪽 어깨(쇄골)",
    rightUpperArm: "오른쪽 위팔",
    rightLowerArm: "오른쪽 팔꿈치",
    rightHand: "오른쪽 손목",
    leftUpperLeg: "왼쪽 고관절",
    leftLowerLeg: "왼쪽 무릎",
    leftFoot: "왼쪽 발목",
    rightUpperLeg: "오른쪽 고관절",
    rightLowerLeg: "오른쪽 무릎",
    rightFoot: "오른쪽 발목",
  });

// ── 체형 파라미터 ────────────────────────────────────────────────────────────

export interface StudioMannequinBodyParams {
  /** 신장(cm). 120–200. */
  readonly heightCm: number;
  /** 두신 비율(머리 개수). 3–9. */
  readonly headCount: number;
  /** 어깨 너비 배율. 0.7–1.3. */
  readonly shoulderWidth: number;
  /** 골반 너비 배율. 0.7–1.3. */
  readonly pelvisWidth: number;
  /** 팔 길이 배율. 0.8–1.2. */
  readonly armLength: number;
  /** 다리 길이 배율(신장 고정, 다리/몸통 비율 재분배). 0.8–1.2. */
  readonly legLength: number;
  /** 체형 블렌드. 0=마른, 1=표준, 2=근육, 3=통통 (연속값). */
  readonly build: number;
  /** 턱/얼굴 너비 배율 (CSP 1.11.6/2.0 3D 헤드 모델). 0.7–1.3. 기본 1. */
  readonly faceWidth?: number;
  /** 턱 길이 배율. 0.7–1.3. 기본 1. */
  readonly chinLength?: number;
  /** 눈 크기 배율. 0.8–1.3. 기본 1. */
  readonly eyeScale?: number;
  /** 코 높이 배율. 0.8–1.3. 기본 1. */
  readonly noseHeight?: number;
}

export type StudioMannequinCoreParamKey =
  | "heightCm"
  | "headCount"
  | "shoulderWidth"
  | "pelvisWidth"
  | "armLength"
  | "legLength"
  | "build";

export type StudioMannequinHeadParamKey =
  | "faceWidth"
  | "chinLength"
  | "eyeScale"
  | "noseHeight";

export const STUDIO_MANNEQUIN_PARAM_RANGES = Object.freeze({
  heightCm: [120, 200],
  headCount: [3, 9],
  shoulderWidth: [0.7, 1.3],
  pelvisWidth: [0.7, 1.3],
  armLength: [0.8, 1.2],
  legLength: [0.8, 1.2],
  build: [0, 3],
} as const satisfies Record<StudioMannequinCoreParamKey, readonly [number, number]>);

export const STUDIO_MANNEQUIN_HEAD_PARAM_RANGES = Object.freeze({
  faceWidth: [0.7, 1.3],
  chinLength: [0.7, 1.3],
  eyeScale: [0.8, 1.3],
  noseHeight: [0.8, 1.3],
} as const satisfies Record<StudioMannequinHeadParamKey, readonly [number, number]>);

export const STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS: StudioMannequinBodyParams = Object.freeze({
  heightCm: 170,
  headCount: 7,
  shoulderWidth: 1,
  pelvisWidth: 1,
  armLength: 1,
  legLength: 1,
  build: 1,
});

export const STUDIO_MANNEQUIN_DEFAULT_HEAD_PARAMS = Object.freeze({
  faceWidth: 1,
  chinLength: 1,
  eyeScale: 1,
  noseHeight: 1,
});

export type StudioMannequinHeadPresetId =
  | "anime"
  | "realistic"
  | "chibi"
  | "sharp"
  | "round";

export const STUDIO_MANNEQUIN_HEAD_PRESETS: Readonly<
  Record<StudioMannequinHeadPresetId, { label: string; params: Partial<StudioMannequinBodyParams> }>
> = Object.freeze({
  anime: {
    label: "웹툰/애니형",
    params: Object.freeze({ faceWidth: 0.95, chinLength: 0.92, eyeScale: 1.15, noseHeight: 0.9 }),
  },
  realistic: {
    label: "실사/표준형",
    params: Object.freeze({ faceWidth: 1.0, chinLength: 1.0, eyeScale: 1.0, noseHeight: 1.0 }),
  },
  chibi: {
    label: "SD/치비형",
    params: Object.freeze({ faceWidth: 1.25, chinLength: 0.75, eyeScale: 1.25, noseHeight: 0.8 }),
  },
  sharp: {
    label: "날카로운 턱",
    params: Object.freeze({ faceWidth: 0.82, chinLength: 1.15, eyeScale: 1.05, noseHeight: 1.1 }),
  },
  round: {
    label: "둥근 얼굴",
    params: Object.freeze({ faceWidth: 1.15, chinLength: 0.85, eyeScale: 1.1, noseHeight: 0.95 }),
  },
});

export type StudioMannequinBodyPresetId =
  | "neutral"
  | "male"
  | "female"
  | "hero"
  | "chibi3"
  | "chibi4"
  | "model"
  | "slender"
  | "bodybuilder"
  | "child"
  | "anime7"
  | "petite"
  | "athletic"
  | "plusSize"
  | "mature"
  | "senior"
  | "stocky"
  | "dancer"
  | "fantasyGiant";

export const STUDIO_MANNEQUIN_BODY_PRESETS: Readonly<
  Record<StudioMannequinBodyPresetId, { label: string; params: StudioMannequinBodyParams }>
> = Object.freeze({
  neutral: {
    label: "중성 7등신",
    params: STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
  },
  male: {
    label: "남성 7.4등신",
    params: Object.freeze({
      heightCm: 178,
      headCount: 7.4,
      shoulderWidth: 1.12,
      pelvisWidth: 0.94,
      armLength: 1.02,
      legLength: 1,
      build: 1.6,
    }),
  },
  female: {
    label: "여성 6.8등신",
    params: Object.freeze({
      heightCm: 162,
      headCount: 6.8,
      shoulderWidth: 0.92,
      pelvisWidth: 1.08,
      armLength: 0.98,
      legLength: 1.02,
      build: 0.85,
    }),
  },
  hero: {
    label: "슈퍼히어로 8.5등신",
    params: Object.freeze({
      heightCm: 188,
      headCount: 8.5,
      shoulderWidth: 1.25,
      pelvisWidth: 0.9,
      armLength: 1.05,
      legLength: 1.1,
      build: 2.2,
    }),
  },
  chibi3: {
    label: "SD 3등신 꼬마",
    params: Object.freeze({
      heightCm: 125,
      headCount: 3.2,
      shoulderWidth: 0.78,
      pelvisWidth: 0.82,
      armLength: 0.85,
      legLength: 0.8,
      build: 2.6,
    }),
  },
  chibi4: {
    label: "SD 4등신 쁘띠",
    params: Object.freeze({
      heightCm: 135,
      headCount: 4.2,
      shoulderWidth: 0.82,
      pelvisWidth: 0.88,
      armLength: 0.9,
      legLength: 0.88,
      build: 1.2,
    }),
  },
  model: {
    label: "패션모델 9등신",
    params: Object.freeze({
      heightCm: 182,
      headCount: 8.8,
      shoulderWidth: 1.02,
      pelvisWidth: 0.96,
      armLength: 1.08,
      legLength: 1.18,
      build: 0.4,
    }),
  },
  slender: {
    label: "슬림 틴에이저 7.5등신",
    params: Object.freeze({
      heightCm: 168,
      headCount: 7.5,
      shoulderWidth: 0.88,
      pelvisWidth: 0.88,
      armLength: 0.98,
      legLength: 1.05,
      build: 0.2,
    }),
  },
  bodybuilder: {
    label: "보디빌더 7.2등신",
    params: Object.freeze({
      heightCm: 185,
      headCount: 7.2,
      shoulderWidth: 1.3,
      pelvisWidth: 0.95,
      armLength: 1.05,
      legLength: 0.95,
      build: 3.0,
    }),
  },
  child: {
    label: "어린이 5.5등신",
    params: Object.freeze({
      heightCm: 140,
      headCount: 5.5,
      shoulderWidth: 0.85,
      pelvisWidth: 0.88,
      armLength: 0.92,
      legLength: 0.92,
      build: 1.0,
    }),
  },
  anime7: {
    label: "애니메 7.5등신",
    params: Object.freeze({
      heightCm: 165,
      headCount: 7.5,
      shoulderWidth: 0.95,
      pelvisWidth: 1.02,
      armLength: 1.0,
      legLength: 1.08,
      build: 0.8,
    }),
  },
  petite: {
    label: "아담한 체형 6.3등신",
    params: Object.freeze({
      heightCm: 150,
      headCount: 6.3,
      shoulderWidth: 0.9,
      pelvisWidth: 1,
      armLength: 0.95,
      legLength: 0.98,
      build: 0.65,
    }),
  },
  athletic: {
    label: "운동형 7.4등신",
    params: Object.freeze({
      heightCm: 176,
      headCount: 7.4,
      shoulderWidth: 1.1,
      pelvisWidth: 1.02,
      armLength: 1.03,
      legLength: 1.04,
      build: 1.9,
    }),
  },
  plusSize: {
    label: "플러스 사이즈 6.6등신",
    params: Object.freeze({
      heightCm: 168,
      headCount: 6.6,
      shoulderWidth: 1.04,
      pelvisWidth: 1.18,
      armLength: 0.98,
      legLength: 0.98,
      build: 2.85,
    }),
  },
  mature: {
    label: "중장년 균형형 6.5등신",
    params: Object.freeze({
      heightCm: 164,
      headCount: 6.5,
      shoulderWidth: 0.96,
      pelvisWidth: 1.02,
      armLength: 0.94,
      legLength: 0.93,
      build: 1.35,
    }),
  },
  senior: {
    label: "고령 균형형 6.1등신",
    params: Object.freeze({
      heightCm: 156,
      headCount: 6.1,
      shoulderWidth: 0.9,
      pelvisWidth: 1.04,
      armLength: 0.91,
      legLength: 0.88,
      build: 1.15,
    }),
  },
  stocky: {
    label: "단단한 체형 6.2등신",
    params: Object.freeze({
      heightCm: 165,
      headCount: 6.2,
      shoulderWidth: 1.17,
      pelvisWidth: 1.1,
      armLength: 0.92,
      legLength: 0.9,
      build: 2.35,
    }),
  },
  dancer: {
    label: "무용수 8등신",
    params: Object.freeze({
      heightCm: 174,
      headCount: 8,
      shoulderWidth: 0.96,
      pelvisWidth: 0.96,
      armLength: 1.08,
      legLength: 1.14,
      build: 0.55,
    }),
  },
  fantasyGiant: {
    label: "판타지 거인 8.2등신",
    params: Object.freeze({
      heightCm: 200,
      headCount: 8.2,
      shoulderWidth: 1.28,
      pelvisWidth: 1.12,
      armLength: 1.13,
      legLength: 1.06,
      build: 2.65,
    }),
  },
});

export type StudioMannequinMaterialStyle =
  | "wood"
  | "clay"
  | "wireframe"
  | "shaded"
  | "magma"
  | "stencil"
  | "bronze"
  | "porcelain";

export const STUDIO_MANNEQUIN_MATERIAL_STYLES: readonly {
  id: StudioMannequinMaterialStyle;
  label: string;
  desc: string;
}[] = Object.freeze([
  { id: "wood", label: "목조 인형", desc: "따뜻한 나무 원목 질감의 표준 3D 데생 인형" },
  { id: "clay", label: "클레이", desc: "단색 석고상 형태의 무광 명암 체형" },
  { id: "wireframe", label: "와이어프레임", desc: "격자망 형태의 입체 투시 가이드 모드" },
  { id: "shaded", label: "2톤 셀 셰이딩", desc: "명확한 툰 음영 경계선 드로잉 가이드" },
  { id: "magma", label: "네온 마그마", desc: "고대비 발광 앰비언트 실루엣 모드" },
  { id: "stencil", label: "흑백 실루엣", desc: "외곽 형태 선명 추출용 스텐실 모드" },
  { id: "bronze", label: "청동 조각상", desc: "금속 하이라이트로 면 전환을 읽는 고전 조각 모드" },
  { id: "porcelain", label: "백자 인형", desc: "부드러운 반사와 밝은 명암을 보는 유광 백자 모드" },
]);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 알 수 없는 입력을 항상 유효한 파라미터로 정규화한다(방어적 파싱 공용 진입점). */
export function clampStudioMannequinBodyParams(input: unknown): StudioMannequinBodyParams {
  const source = (typeof input === "object" && input !== null
    ? input
    : {}) as Partial<Record<keyof StudioMannequinBodyParams, unknown>>;
  const result = {} as Record<keyof StudioMannequinBodyParams, number>;
  for (const key of Object.keys(STUDIO_MANNEQUIN_PARAM_RANGES) as StudioMannequinCoreParamKey[]) {
    const [min, max] = STUDIO_MANNEQUIN_PARAM_RANGES[key];
    result[key] = clampNumber(source[key], min, max, STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS[key]);
  }
  for (const key of Object.keys(STUDIO_MANNEQUIN_HEAD_PARAM_RANGES) as StudioMannequinHeadParamKey[]) {
    if (source[key] !== undefined) {
      const [min, max] = STUDIO_MANNEQUIN_HEAD_PARAM_RANGES[key];
      result[key] = clampNumber(source[key], min, max, STUDIO_MANNEQUIN_DEFAULT_HEAD_PARAMS[key]);
    }
  }
  return result as StudioMannequinBodyParams;
}

// ── 체형 블렌드(마른–표준–근육–통통) ────────────────────────────────────────

interface BuildProfile {
  readonly limbRadius: number;
  readonly torsoUpper: number;
  readonly torsoLower: number;
  readonly shoulder: number;
}

const BUILD_ANCHORS: readonly BuildProfile[] = Object.freeze([
  Object.freeze({ limbRadius: 0.82, torsoUpper: 0.86, torsoLower: 0.85, shoulder: 0.94 }),
  Object.freeze({ limbRadius: 1.0, torsoUpper: 1.0, torsoLower: 1.0, shoulder: 1.0 }),
  Object.freeze({ limbRadius: 1.12, torsoUpper: 1.18, torsoLower: 0.98, shoulder: 1.1 }),
  Object.freeze({ limbRadius: 1.22, torsoUpper: 1.12, torsoLower: 1.28, shoulder: 1.03 }),
]);

export function blendStudioMannequinBuild(build: number): BuildProfile {
  const clamped = clampNumber(build, 0, 3, 1);
  const lower = Math.min(2, Math.floor(clamped));
  const t = clamped - lower;
  const a = BUILD_ANCHORS[lower];
  const b = BUILD_ANCHORS[lower + 1];
  const mix = (from: number, to: number): number => from + (to - from) * t;
  return {
    limbRadius: mix(a.limbRadius, b.limbRadius),
    torsoUpper: mix(a.torsoUpper, b.torsoUpper),
    torsoLower: mix(a.torsoLower, b.torsoLower),
    shoulder: mix(a.shoulder, b.shoulder),
  };
}

// ── 관절 회전 한계 ──────────────────────────────────────────────────────────

export interface StudioMannequinJointLimit {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z: readonly [number, number];
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function range(minDeg: number, maxDeg: number): readonly [number, number] {
  return Object.freeze([radians(minDeg), radians(maxDeg)]) as unknown as readonly [number, number];
}

function limit(
  x: readonly [number, number],
  y: readonly [number, number],
  z: readonly [number, number],
): StudioMannequinJointLimit {
  return Object.freeze({ x, y, z });
}

function negateRange(value: readonly [number, number]): readonly [number, number] {
  return Object.freeze([-value[1], -value[0]]) as unknown as readonly [number, number];
}

/** 하우스 미러 계약(X 유지, Y/Z 부호 반전)으로 좌측 한계를 우측 한계로 변환한다. */
export function mirrorStudioMannequinJointLimit(
  value: StudioMannequinJointLimit,
): StudioMannequinJointLimit {
  return limit(value.x, negateRange(value.y), negateRange(value.z));
}

const CENTER_LIMITS: Readonly<Partial<Record<StudioMannequinJointId, StudioMannequinJointLimit>>> = {
  // 골반은 루트 방향이므로 눕기/엎드리기 같은 전신 자세를 위해 넉넉하게 허용한다.
  pelvis: limit(range(-120, 120), range(-180, 180), range(-90, 90)),
  spine: limit(range(-35, 45), range(-45, 45), range(-32, 32)),
  chest: limit(range(-32, 42), range(-48, 48), range(-32, 32)),
  neck: limit(range(-42, 42), range(-62, 62), range(-36, 36)),
  head: limit(range(-42, 48), range(-72, 72), range(-38, 38)),
};

// 좌측이 단일 진실 원천이고 우측은 아래에서 미러 생성한다(하우스 패턴).
const LEFT_LIMITS: Readonly<Partial<Record<StudioMannequinJointId, StudioMannequinJointLimit>>> = {
  leftShoulder: limit(range(-32, 32), range(-42, 42), range(-45, 32)),
  leftUpperArm: limit(range(-172, 172), range(-95, 95), range(-38, 178)),
  // 팔꿈치 굽힘은 음수 X(앞쪽) 방향 — IK hingeSign −1 규약과 일치한다.
  leftLowerArm: limit(range(-158, 6), range(-65, 65), range(-8, 8)),
  leftHand: limit(range(-65, 65), range(-35, 35), range(-82, 75)),
  leftUpperLeg: limit(range(-132, 42), range(-65, 65), range(-28, 82)),
  // 무릎 굽힘은 양수 X(뒤쪽) 방향 — IK hingeSign +1 규약과 일치한다.
  leftLowerLeg: limit(range(-6, 158), range(-28, 28), range(-10, 10)),
  leftFoot: limit(range(-52, 65), range(-32, 32), range(-32, 32)),
};

function buildLimitTable(): Readonly<Record<StudioMannequinJointId, StudioMannequinJointLimit>> {
  const table = { ...CENTER_LIMITS } as Partial<
    Record<StudioMannequinJointId, StudioMannequinJointLimit>
  >;
  for (const [leftId, value] of Object.entries(LEFT_LIMITS)) {
    table[leftId as StudioMannequinJointId] = value;
    const rightId = `right${leftId.slice("left".length)}` as StudioMannequinJointId;
    table[rightId] = mirrorStudioMannequinJointLimit(value);
  }
  return Object.freeze(table) as Readonly<
    Record<StudioMannequinJointId, StudioMannequinJointLimit>
  >;
}

export const STUDIO_MANNEQUIN_JOINT_LIMITS = buildLimitTable();

export const STUDIO_MANNEQUIN_FALLBACK_JOINT_LIMIT = limit(
  range(-180, 180),
  range(-180, 180),
  range(-180, 180),
);

export function getStudioMannequinJointLimit(jointId: unknown): StudioMannequinJointLimit {
  if (!isStudioMannequinJointId(jointId)) return STUDIO_MANNEQUIN_FALLBACK_JOINT_LIMIT;
  return STUDIO_MANNEQUIN_JOINT_LIMITS[jointId];
}

const FULL_TURN = Math.PI * 2;
const ANGLE_QUANTUM = 1e-6;

/** 표준 각 범위 [-PI, PI)로 접고 1e-6 rad 격자로 양자화해 직렬화 왕복을 안정화한다. */
export function canonicalizeStudioMannequinAngle(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  let folded = value;
  if (folded < -Math.PI || folded >= Math.PI) {
    folded = ((((folded + Math.PI) % FULL_TURN) + FULL_TURN) % FULL_TURN) - Math.PI;
  }
  const quantized = Math.round(folded / ANGLE_QUANTUM) * ANGLE_QUANTUM;
  return Object.is(quantized, -0) ? 0 : quantized;
}

function clampAxis(value: number, axisRange: readonly [number, number]): number {
  return Math.min(axisRange[1], Math.max(axisRange[0], value));
}

/** 슬라이더·IK·직렬화 공용 하드 클램프. 입력을 변형하지 않는다. */
export function clampStudioMannequinJointRotation(
  jointId: unknown,
  rotation: unknown,
): StudioMannequinVec3 {
  const source = Array.isArray(rotation) ? rotation : [];
  const jointLimit = getStudioMannequinJointLimit(jointId);
  return [
    clampAxis(canonicalizeStudioMannequinAngle(source[0]), jointLimit.x),
    clampAxis(canonicalizeStudioMannequinAngle(source[1]), jointLimit.y),
    clampAxis(canonicalizeStudioMannequinAngle(source[2]), jointLimit.z),
  ];
}

// ── 스펙(관절 계층 + 프리미티브) ────────────────────────────────────────────

export interface StudioMannequinJointSpec {
  readonly id: StudioMannequinJointId;
  readonly parentId: StudioMannequinJointId | null;
  /** 부모 관절 로컬 rest 오프셋(m). */
  readonly offset: StudioMannequinVec3;
}

export type StudioMannequinPrimitiveSpec =
  | {
      readonly kind: "capsule";
      readonly jointId: StudioMannequinJointId;
      readonly from: StudioMannequinVec3;
      readonly to: StudioMannequinVec3;
      readonly radius: number;
    }
  | {
      readonly kind: "sphere";
      readonly jointId: StudioMannequinJointId;
      readonly center: StudioMannequinVec3;
      readonly radius: number;
      /** 비균등 스케일(타원체). 생략 시 [1,1,1]. */
      readonly scale?: StudioMannequinVec3;
    }
  | {
      readonly kind: "box";
      readonly jointId: StudioMannequinJointId;
      readonly center: StudioMannequinVec3;
      readonly size: StudioMannequinVec3;
    };

export const STUDIO_MANNEQUIN_CHAIN_IDS = ["leftArm", "rightArm", "leftLeg", "rightLeg"] as const;
export type StudioMannequinChainId = (typeof STUDIO_MANNEQUIN_CHAIN_IDS)[number];

export interface StudioMannequinChainSpec {
  readonly id: StudioMannequinChainId;
  readonly rootJointId: StudioMannequinJointId;
  readonly midJointId: StudioMannequinJointId;
  readonly effectorJointId: StudioMannequinJointId;
  readonly upperLength: number;
  readonly lowerLength: number;
  /** 팔은 −1(앞굽힘), 다리는 +1(뒤굽힘). studio-mannequin-ik hinge 규약. */
  readonly hingeSign: 1 | -1;
  /** 루트 기준 기본 폴 힌트 방향(단위 벡터 아님, 부모 프레임). */
  readonly poleHint: StudioMannequinVec3;
}

export interface StudioMannequinSpec {
  readonly params: StudioMannequinBodyParams;
  /** 두신 단위(m) = heightM / headCount. */
  readonly headUnit: number;
  readonly heightM: number;
  readonly joints: readonly StudioMannequinJointSpec[];
  readonly primitives: readonly StudioMannequinPrimitiveSpec[];
  readonly chains: Readonly<Record<StudioMannequinChainId, StudioMannequinChainSpec>>;
}

function vec3(x: number, y: number, z: number): StudioMannequinVec3 {
  return [x, y, z];
}

/** 손바닥 끝에 길이가 다른 네 손가락과 바깥쪽 엄지를 붙인다. 좌우는 X축 미러다. */
function buildHandDigitPrimitives(
  jointId: "leftHand" | "rightHand",
  handLen: number,
  sideSign: 1 | -1,
): readonly StudioMannequinPrimitiveSpec[] {
  const fingers = [
    { x: -0.15, endY: -1.03 },
    { x: -0.05, endY: -1.11 },
    { x: 0.05, endY: -1.14 },
    { x: 0.15, endY: -1.07 },
  ] as const;
  return [
    ...fingers.map(({ x, endY }): StudioMannequinPrimitiveSpec => ({
      kind: "capsule",
      jointId,
      from: vec3(sideSign * x * handLen, -0.76 * handLen, 0.02 * handLen),
      to: vec3(sideSign * x * handLen, endY * handLen, 0.025 * handLen),
      radius: 0.045 * handLen,
    })),
    {
      kind: "capsule",
      jointId,
      from: vec3(sideSign * 0.19 * handLen, -0.46 * handLen, 0.025 * handLen),
      to: vec3(sideSign * 0.38 * handLen, -0.72 * handLen, 0.065 * handLen),
      radius: 0.06 * handLen,
    },
  ];
}

/**
 * 파라미터로부터 결정적 마네킹 스펙을 생성한다.
 * 불변식: rest 자세의 정수리 높이 == heightCm/100 (legLength가 다리/몸통 비율만 재분배).
 */
export function buildStudioMannequinSpec(input: unknown): StudioMannequinSpec {
  const params = clampStudioMannequinBodyParams(input);
  const heightM = params.heightCm / 100;
  const hu = heightM / params.headCount;
  const build = blendStudioMannequinBuild(params.build);

  const headLen = hu;
  const neckLen = 0.26 * hu;
  const available = heightM - headLen - neckLen;

  // 두신 비율이 클수록(등신이 높을수록) 다리 비중이 커지는 히로익 비례.
  const baseLegRatio = Math.min(0.6, Math.max(0.46, 0.53 + 0.012 * (params.headCount - 6.5)));
  const legRatio = Math.min(0.66, Math.max(0.4, baseLegRatio * params.legLength));
  const pelvisHeight = available * legRatio;
  const torsoLen = available - pelvisHeight;

  const ankleHeight = 0.32 * hu;
  const legSpan = pelvisHeight - ankleHeight;
  const upperLegLen = legSpan * 0.52;
  const lowerLegLen = legSpan * 0.48;

  const upperArmLen = 1.34 * hu * params.armLength;
  const foreArmLen = 1.06 * hu * params.armLength;
  const handLen = 0.58 * hu * params.armLength;

  const halfShoulder = 0.78 * hu * params.shoulderWidth * build.shoulder;
  const clavicleRoot = 0.16 * hu;
  const hipHalf = 0.33 * hu * params.pelvisWidth;

  const limbR = build.limbRadius;
  const footLen = 0.95 * hu;
  const pelvisRadius = 0.3 * hu * build.torsoLower;
  const chestRadius = 0.34 * hu * build.torsoUpper;

  const joints: StudioMannequinJointSpec[] = [
    { id: "pelvis", parentId: null, offset: vec3(0, pelvisHeight, 0) },
    { id: "spine", parentId: "pelvis", offset: vec3(0, 0.3 * torsoLen, 0) },
    { id: "chest", parentId: "spine", offset: vec3(0, 0.34 * torsoLen, 0) },
    { id: "neck", parentId: "chest", offset: vec3(0, 0.36 * torsoLen, 0) },
    { id: "head", parentId: "neck", offset: vec3(0, neckLen, 0) },

    { id: "leftShoulder", parentId: "chest", offset: vec3(clavicleRoot, 0.3 * torsoLen, 0) },
    { id: "leftUpperArm", parentId: "leftShoulder", offset: vec3(halfShoulder - clavicleRoot, 0, 0) },
    { id: "leftLowerArm", parentId: "leftUpperArm", offset: vec3(0, -upperArmLen, 0) },
    { id: "leftHand", parentId: "leftLowerArm", offset: vec3(0, -foreArmLen, 0) },

    { id: "rightShoulder", parentId: "chest", offset: vec3(-clavicleRoot, 0.3 * torsoLen, 0) },
    { id: "rightUpperArm", parentId: "rightShoulder", offset: vec3(-(halfShoulder - clavicleRoot), 0, 0) },
    { id: "rightLowerArm", parentId: "rightUpperArm", offset: vec3(0, -upperArmLen, 0) },
    { id: "rightHand", parentId: "rightLowerArm", offset: vec3(0, -foreArmLen, 0) },

    { id: "leftUpperLeg", parentId: "pelvis", offset: vec3(hipHalf, 0, 0) },
    { id: "leftLowerLeg", parentId: "leftUpperLeg", offset: vec3(0, -upperLegLen, 0) },
    { id: "leftFoot", parentId: "leftLowerLeg", offset: vec3(0, -lowerLegLen, 0) },

    { id: "rightUpperLeg", parentId: "pelvis", offset: vec3(-hipHalf, 0, 0) },
    { id: "rightLowerLeg", parentId: "rightUpperLeg", offset: vec3(0, -upperLegLen, 0) },
    { id: "rightFoot", parentId: "rightLowerLeg", offset: vec3(0, -lowerLegLen, 0) },
  ];

  const primitives: StudioMannequinPrimitiveSpec[] = [
    // 몸통 — 흉곽과 골반을 분리된 타원체로 만들어 데생 랜드마크와 실루엣을 읽기 쉽게 한다.
    {
      kind: "sphere",
      jointId: "pelvis",
      center: vec3(0, 0.04 * hu, 0),
      radius: pelvisRadius,
      scale: vec3(1.5 * params.pelvisWidth, 0.8, 0.92),
    },
    {
      kind: "capsule",
      jointId: "spine",
      from: vec3(0, 0, 0),
      to: vec3(0, 0.34 * torsoLen, 0),
      radius: 0.24 * hu * build.torsoLower,
    },
    {
      kind: "sphere",
      jointId: "chest",
      center: vec3(0, 0.175 * torsoLen, 0),
      radius: chestRadius,
      scale: vec3(
        1.32 * params.shoulderWidth,
        (0.31 * torsoLen) / (2 * chestRadius),
        0.72,
      ),
    },
    // 쇄골
    {
      kind: "capsule",
      jointId: "leftShoulder",
      from: vec3(0, 0, 0),
      to: vec3(halfShoulder - clavicleRoot, 0, 0),
      radius: 0.1 * hu * limbR,
    },
    {
      kind: "capsule",
      jointId: "rightShoulder",
      from: vec3(0, 0, 0),
      to: vec3(-(halfShoulder - clavicleRoot), 0, 0),
      radius: 0.1 * hu * limbR,
    },
    // 목·머리 — 머리 타원체의 정수리가 정확히 신장과 일치한다(스테이처 불변식).
    { kind: "capsule", jointId: "neck", from: vec3(0, 0, 0), to: vec3(0, neckLen, 0), radius: 0.11 * hu },
    {
      kind: "sphere",
      jointId: "head",
      center: vec3(0, headLen * 0.5, 0),
      radius: headLen * 0.5,
      scale: vec3(0.78, 1, 0.85),
    },
    // 코·귀 방향 가이드 — 별도 얼굴 골격 없이도 +Z 시선과 머리 회전을 즉시 읽을 수 있다.
    {
      kind: "sphere",
      jointId: "head",
      center: vec3(0, headLen * 0.52, headLen * 0.43),
      radius: 0.06 * hu,
      scale: vec3(0.55, 0.72, 1.15),
    },
    {
      kind: "sphere",
      jointId: "head",
      center: vec3(0.4 * hu, headLen * 0.52, 0),
      radius: 0.065 * hu,
      scale: vec3(0.45, 0.8, 0.55),
    },
    // 눈 돌출부 — 코와 함께 +Z 시선 방향, 좌우 기울기와 머리 회전을 빠르게 읽게 한다.
    {
      kind: "sphere",
      jointId: "head",
      center: vec3(0.17 * hu, headLen * 0.59, headLen * 0.395),
      radius: 0.055 * hu,
      scale: vec3(1, 0.72, 0.38),
    },
    {
      kind: "sphere",
      jointId: "head",
      center: vec3(-0.17 * hu, headLen * 0.59, headLen * 0.395),
      radius: 0.055 * hu,
      scale: vec3(1, 0.72, 0.38),
    },
    {
      kind: "sphere",
      jointId: "head",
      center: vec3(-0.4 * hu, headLen * 0.52, 0),
      radius: 0.065 * hu,
      scale: vec3(0.45, 0.8, 0.55),
    },
    // 팔 — 관절구와 손바닥 타원체를 겹쳐 관절 굽힘과 손 방향을 명확히 표시한다.
    { kind: "sphere", jointId: "leftUpperArm", center: vec3(0, 0, 0), radius: 0.14 * hu * limbR },
    { kind: "capsule", jointId: "leftUpperArm", from: vec3(0, 0, 0), to: vec3(0, -upperArmLen, 0), radius: 0.115 * hu * limbR },
    { kind: "sphere", jointId: "leftLowerArm", center: vec3(0, 0, 0), radius: 0.12 * hu * limbR },
    { kind: "capsule", jointId: "leftLowerArm", from: vec3(0, 0, 0), to: vec3(0, -foreArmLen, 0), radius: 0.095 * hu * limbR },
    { kind: "sphere", jointId: "leftHand", center: vec3(0, 0, 0), radius: 0.095 * hu },
    { kind: "sphere", jointId: "leftHand", center: vec3(0, -handLen * 0.5, 0), radius: handLen * 0.5, scale: vec3(0.45, 1, 0.28) },
    ...buildHandDigitPrimitives("leftHand", handLen, 1),
    { kind: "sphere", jointId: "rightUpperArm", center: vec3(0, 0, 0), radius: 0.14 * hu * limbR },
    { kind: "capsule", jointId: "rightUpperArm", from: vec3(0, 0, 0), to: vec3(0, -upperArmLen, 0), radius: 0.115 * hu * limbR },
    { kind: "sphere", jointId: "rightLowerArm", center: vec3(0, 0, 0), radius: 0.12 * hu * limbR },
    { kind: "capsule", jointId: "rightLowerArm", from: vec3(0, 0, 0), to: vec3(0, -foreArmLen, 0), radius: 0.095 * hu * limbR },
    { kind: "sphere", jointId: "rightHand", center: vec3(0, 0, 0), radius: 0.095 * hu },
    { kind: "sphere", jointId: "rightHand", center: vec3(0, -handLen * 0.5, 0), radius: handLen * 0.5, scale: vec3(0.45, 1, 0.28) },
    ...buildHandDigitPrimitives("rightHand", handLen, -1),
    // 다리 — 고관절·무릎·발목 관절구와 둥근 발 볼륨.
    { kind: "sphere", jointId: "leftUpperLeg", center: vec3(0, 0, 0), radius: 0.18 * hu * limbR },
    { kind: "capsule", jointId: "leftUpperLeg", from: vec3(0, 0, 0), to: vec3(0, -upperLegLen, 0), radius: 0.155 * hu * limbR },
    { kind: "sphere", jointId: "leftLowerLeg", center: vec3(0, 0, 0), radius: 0.15 * hu * limbR },
    { kind: "capsule", jointId: "leftLowerLeg", from: vec3(0, 0, 0), to: vec3(0, -lowerLegLen, 0), radius: 0.115 * hu * limbR },
    {
      kind: "sphere",
      jointId: "leftFoot",
      center: vec3(0, -ankleHeight * 0.5, footLen * 0.22),
      radius: footLen * 0.5,
      scale: vec3((0.26 * hu) / footLen, ankleHeight / footLen, 1),
    },
    { kind: "sphere", jointId: "leftFoot", center: vec3(0, 0, 0), radius: 0.105 * hu * limbR },
    { kind: "sphere", jointId: "rightUpperLeg", center: vec3(0, 0, 0), radius: 0.18 * hu * limbR },
    { kind: "capsule", jointId: "rightUpperLeg", from: vec3(0, 0, 0), to: vec3(0, -upperLegLen, 0), radius: 0.155 * hu * limbR },
    { kind: "sphere", jointId: "rightLowerLeg", center: vec3(0, 0, 0), radius: 0.15 * hu * limbR },
    { kind: "capsule", jointId: "rightLowerLeg", from: vec3(0, 0, 0), to: vec3(0, -lowerLegLen, 0), radius: 0.115 * hu * limbR },
    {
      kind: "sphere",
      jointId: "rightFoot",
      center: vec3(0, -ankleHeight * 0.5, footLen * 0.22),
      radius: footLen * 0.5,
      scale: vec3((0.26 * hu) / footLen, ankleHeight / footLen, 1),
    },
    { kind: "sphere", jointId: "rightFoot", center: vec3(0, 0, 0), radius: 0.105 * hu * limbR },
  ];

  const chains: Record<StudioMannequinChainId, StudioMannequinChainSpec> = {
    leftArm: {
      id: "leftArm",
      rootJointId: "leftUpperArm",
      midJointId: "leftLowerArm",
      effectorJointId: "leftHand",
      upperLength: upperArmLen,
      lowerLength: foreArmLen,
      hingeSign: -1,
      poleHint: vec3(0.25, -0.3, -0.9),
    },
    rightArm: {
      id: "rightArm",
      rootJointId: "rightUpperArm",
      midJointId: "rightLowerArm",
      effectorJointId: "rightHand",
      upperLength: upperArmLen,
      lowerLength: foreArmLen,
      hingeSign: -1,
      poleHint: vec3(-0.25, -0.3, -0.9),
    },
    leftLeg: {
      id: "leftLeg",
      rootJointId: "leftUpperLeg",
      midJointId: "leftLowerLeg",
      effectorJointId: "leftFoot",
      upperLength: upperLegLen,
      lowerLength: lowerLegLen,
      hingeSign: 1,
      poleHint: vec3(0.1, -0.3, 0.95),
    },
    rightLeg: {
      id: "rightLeg",
      rootJointId: "rightUpperLeg",
      midJointId: "rightLowerLeg",
      effectorJointId: "rightFoot",
      upperLength: upperLegLen,
      lowerLength: lowerLegLen,
      hingeSign: 1,
      poleHint: vec3(-0.1, -0.3, 0.95),
    },
  };

  return {
    params,
    headUnit: hu,
    heightM,
    joints,
    primitives,
    chains,
  };
}

/** rest 자세 기준 관절 월드 위치(회전 전부 항등이므로 오프셋 합). */
export function studioMannequinRestJointPosition(
  spec: StudioMannequinSpec,
  jointId: StudioMannequinJointId,
): StudioMannequinVec3 {
  const byId = new Map(spec.joints.map((joint) => [joint.id, joint]));
  let current = byId.get(jointId);
  let x = 0;
  let y = 0;
  let z = 0;
  let guard = 0;
  while (current && guard < 32) {
    x += current.offset[0];
    y += current.offset[1];
    z += current.offset[2];
    current = current.parentId ? byId.get(current.parentId) : undefined;
    guard += 1;
  }
  return [x, y, z];
}

/** rest 자세의 정수리 높이(m). 테스트가 heightM 과의 일치를 검증하는 불변식이다. */
export function studioMannequinRestStature(spec: StudioMannequinSpec): number {
  const headTop = spec.primitives
    .filter((primitive) => primitive.kind === "sphere" && primitive.jointId === "head")
    .map((primitive) => {
      const sphere = primitive as Extract<StudioMannequinPrimitiveSpec, { kind: "sphere" }>;
      const jointY = studioMannequinRestJointPosition(spec, sphere.jointId)[1];
      const scaleY = sphere.scale ? sphere.scale[1] : 1;
      return jointY + sphere.center[1] + sphere.radius * scaleY;
    });
  return headTop.length > 0 ? Math.max(...headTop) : 0;
}
