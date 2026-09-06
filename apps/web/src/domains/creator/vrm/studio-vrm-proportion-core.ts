/**
 * 체형 비율(프로포션) 편집 코어 — VRM 휴머노이드 본 세트 위에서 캐릭터의 키·두신비·사지 길이를
 * 결정적으로 계산하는 순수 모듈.
 *
 * 웹툰 작가는 캐릭터의 "키"와 "두신비"를 한 번 정해두면 모든 컷에서 같은 비율로 유지되기를
 * 원한다. 이 모듈은 그 비율을 **엔진 비의존 데이터**로만 표현한다: three.js / @pixiv/three-vrm
 * 런타임 객체를 전혀 참조하지 않으므로 헤드리스로 검증 가능하고, 장래의 WebGPU/Babylon 어댑터도
 * 같은 계약을 재사용할 수 있다(studio-humanoid-bones 와 동일한 방침).
 *
 * ---------------------------------------------------------------------------
 * 스케일 전파(skew) 문제와 이 모듈이 택한 해법
 * ---------------------------------------------------------------------------
 * 부모 본에 비균등 스케일(예: `scale.y = 1.3`)을 주면 그 스케일이 자식으로 상속되고, 자식이
 * 회전해 있으면 스킨 메시가 전단(shear)되어 찌그러진다. 팔을 길게 하려고 upperArm 을 Y 로
 * 1.3배 늘리면 팔뚝이 굵어지거나 손이 비스듬히 눌린다. 자식마다 역스케일을 물려 보정하는
 * 방식(child-scale compensation)은 회전이 섞이는 순간 수학적으로 복원 불가능하다.
 *
 * 그래서 이 모듈은 **관절을 이동시키고, 본을 늘리지 않는다(translate joints, never stretch)**.
 *
 *  1. 길이 파라미터(키·팔·다리·몸통·목)는 전부 **자식 관절의 로컬 위치 이동**으로 표현한다.
 *     three.js 에서 자식의 `position` 이 곧 부모 본 세그먼트의 길이이므로, 자식을 밀면 세그먼트가
 *     길어지고 그 아래 체인 전체가 함께 따라간다 → 관절이 벌어질 수 없다(구조적으로 gap 불가).
 *  2. 크기 파라미터(두신비=머리, 손, 발)만 **균등 스케일**을 쓴다. 균등 스케일은 회전과 교환
 *     가능하므로 전단이 발생하지 않는다. 머리→눈·턱, 손→손가락, 발→발가락처럼 "서브트리 전체가
 *     같이 커져야 하는" 말단에만 적용한다(상속이 곧 의도).
 *  3. 연산 타입 {@link StudioVrmProportionOp} 의 `scale` 은 **스칼라 하나**다. 비균등 스케일은
 *     타입 수준에서 표현할 자체가 불가능하므로 skew 는 설계상 발생할 수 없다.
 *  4. 그 결과 "스케일된 조상 아래에 이동된 자손이 있는" 상황이 아예 생기지 않는다. 이 불변식은
 *     {@link validateStudioVrmProportionPlan} 이 검사한다(회귀 방지용 방어선).
 *
 * ---------------------------------------------------------------------------
 * 중립(neutral) 및 왕복 정확성
 * ---------------------------------------------------------------------------
 * 모든 파라미터의 중립값은 정확히 `1.0`이다. 플랜은 **누적이 아니라 rest 대비 절대값**이므로,
 * 어떤 비율을 적용한 뒤 다시 중립으로 되돌리면 rest 트랜스폼이 비트 단위로 복원된다
 * (`rest * (1 - 1)` 은 부동소수점에서도 정확히 0). 통합 레이어는 반드시
 * `position = restPosition + translateLocal` 형태로 **캐시된 rest 기준 절대 대입**을 해야 하며,
 * `+=` 누적을 하면 이 보장이 깨진다.
 *
 * 휴머노이드 유효성: 플랜은 {@link STUDIO_HUMANOID_BONE_NAMES} 안의 본만 참조하고, 본을
 * 추가·삭제·개명하지 않으며 **회전은 절대 건드리지 않는다**. 따라서 비율 변경 이전에 작성된
 * 포즈(회전 기반)는 변경 이후에도 그대로 적용된다.
 */

import { STUDIO_HUMANOID_BONE_NAMES, type StudioHumanoidBoneName } from "../studio-humanoid-bones";

export const STUDIO_VRM_PROPORTION_VERSION = 1 as const;

/** VRM 1.0 이 필수로 요구하는 휴머노이드 본. 스냅샷 검증 기준(개명·삭제 금지 대상). */
export const STUDIO_VRM_REQUIRED_HUMANOID_BONES = Object.freeze([
  "hips",
  "spine",
  "head",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
] as const) as readonly StudioHumanoidBoneName[];

export const STUDIO_VRM_PROPORTION_KEYS = Object.freeze([
  "overallHeight",
  "headBodyRatio",
  "armLength",
  "legLength",
  "torsoLength",
  "shoulderWidth",
  "handScale",
  "footScale",
  "neckLength",
] as const);

export type StudioVrmProportionKey = (typeof STUDIO_VRM_PROPORTION_KEYS)[number];

/**
 * 캐릭터 1인의 체형 비율. 모든 값은 rest 대비 **정규화 배수**이고 중립은 정확히 `1.0`이다.
 *
 * - `overallHeight` — 전체 신장(관절 간격). 두신비는 바뀌지 않는다(머리도 같은 배수로 커짐).
 * - `headBodyRatio` — 머리 크기 배수. 값이 커질수록 두신 수는 **작아진다**(SD·치비 방향).
 *   두신 수와의 환산은 {@link resolveStudioVrmProportionMetrics} / {@link solveStudioVrmHeadBodyRatioForHeadUnits}.
 * - `armLength` / `legLength` — 위팔+아래팔 / 허벅지+정강이 세그먼트 길이.
 * - `torsoLength` — hips→neck 몸통 세그먼트 길이.
 * - `neckLength` — neck→head 세그먼트 길이.
 * - `shoulderWidth` — 쇄골+어깨 좌우 오프셋(팔 자체 길이는 불변).
 * - `handScale` / `footScale` — 손·발 서브트리 균등 배수(손가락·발가락 포함).
 */
export type StudioVrmProportions = {
  readonly version: typeof STUDIO_VRM_PROPORTION_VERSION;
  readonly presetId?: string;
  readonly overallHeight: number;
  readonly headBodyRatio: number;
  readonly armLength: number;
  readonly legLength: number;
  readonly torsoLength: number;
  readonly shoulderWidth: number;
  readonly handScale: number;
  readonly footScale: number;
  readonly neckLength: number;
};

export type StudioVrmProportionLimit = {
  readonly label: string;
  readonly hint: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
};

/** 슬라이더 UI 와 방어적 클램프가 공유하는 단일 소스. 중립은 언제나 1.0 이며 모든 구간에 포함된다. */
export const STUDIO_VRM_PROPORTION_LIMITS: Readonly<
  Record<StudioVrmProportionKey, StudioVrmProportionLimit>
> = Object.freeze({
  overallHeight: { label: "전체 키", hint: "관절 간격 전체 배수(두신비 불변)", min: 0.55, max: 1.6, step: 0.01, unit: "×" },
  headBodyRatio: { label: "두신비(머리 크기)", hint: "클수록 머리가 커지고 두신 수가 줄어듭니다", min: 0.5, max: 3.6, step: 0.01, unit: "×" },
  armLength: { label: "팔 길이", hint: "위팔+아래팔", min: 0.6, max: 1.45, step: 0.01, unit: "×" },
  legLength: { label: "다리 길이", hint: "허벅지+정강이", min: 0.55, max: 1.55, step: 0.01, unit: "×" },
  torsoLength: { label: "몸통 길이", hint: "골반→목 밑", min: 0.7, max: 1.35, step: 0.01, unit: "×" },
  shoulderWidth: { label: "어깨 너비", hint: "쇄골 좌우 오프셋", min: 0.7, max: 1.4, step: 0.01, unit: "×" },
  handScale: { label: "손 크기", hint: "손가락까지 균등", min: 0.6, max: 1.6, step: 0.01, unit: "×" },
  footScale: { label: "발 크기", hint: "발가락까지 균등", min: 0.6, max: 1.6, step: 0.01, unit: "×" },
  neckLength: { label: "목 길이", hint: "목→머리 관절", min: 0.3, max: 1.8, step: 0.01, unit: "×" },
});

/** 모든 파라미터가 정확히 1.0 인 중립 상태. */
export const NEUTRAL_STUDIO_VRM_PROPORTIONS: StudioVrmProportions = Object.freeze({
  version: STUDIO_VRM_PROPORTION_VERSION,
  overallHeight: 1,
  headBodyRatio: 1,
  armLength: 1,
  legLength: 1,
  torsoLength: 1,
  shoulderWidth: 1,
  handScale: 1,
  footScale: 1,
  neckLength: 1,
});

export type StudioVrmVec3 = readonly [number, number, number];

/** rest 자세에서의 본 한 개 — 이름·부모·부모 로컬 오프셋(길이는 이 벡터의 크기). */
export type StudioVrmBoneRest = {
  readonly name: StudioHumanoidBoneName;
  readonly parent: StudioHumanoidBoneName | null;
  /** 부모 본 로컬 좌표계에서의 rest 위치. 세그먼트 길이 = 이 벡터의 노름. */
  readonly restOffset: StudioVrmVec3;
};

/**
 * 엔진 비의존 rest 골격 스냅샷. three.js 없이 테스트 가능하도록 평범한 데이터만 담는다.
 * `headLength` 는 head 관절에서 정수리까지의 거리(본이 아니라 바운딩으로 측정)이며,
 * 두신비 계산의 유일한 머리 길이 기준이다.
 */
export type StudioVrmBoneHierarchySnapshot = {
  readonly bones: readonly StudioVrmBoneRest[];
  readonly headLength: number;
};

/** 플랜 한 줄 — `scale` 은 **스칼라 균등 배수**라 비균등(=전단) 스케일을 표현할 수 없다. */
export type StudioVrmProportionOp = {
  readonly boneName: StudioHumanoidBoneName;
  /** 균등 스케일 배수. 1 = 변화 없음. */
  readonly scale: number;
  /** 부모 로컬 좌표계에서 rest 위치에 **더할** 델타. [0,0,0] = 변화 없음. */
  readonly translateLocal: StudioVrmVec3;
};

export type StudioVrmProportionPlan = readonly StudioVrmProportionOp[];

/** 플랜 적용 후 각 본의 로컬 절대 트랜스폼(통합 레이어가 그대로 대입하면 된다). */
export type StudioVrmProportionBoneTarget = {
  readonly boneName: StudioHumanoidBoneName;
  readonly position: StudioVrmVec3;
  readonly scale: number;
};

/** 플랜을 전개한 월드(모델 루트 기준) 관절 위치·누적 스케일. */
export type StudioVrmProportionSkeletonNode = {
  readonly boneName: StudioHumanoidBoneName;
  readonly worldPosition: StudioVrmVec3;
  /** 조상 누적 균등 스케일. 의도된 상속(머리·손·발 서브트리) 외에는 항상 1 이어야 한다. */
  readonly worldScale: number;
};

export type StudioVrmProportionSkeleton = ReadonlyMap<
  StudioHumanoidBoneName,
  StudioVrmProportionSkeletonNode
>;

export type StudioVrmProportionMetrics = {
  /** 바닥(모델 루트 y=0)부터 정수리까지. */
  readonly totalHeight: number;
  /** 스케일이 반영된 머리 길이(head 관절→정수리). */
  readonly headLength: number;
  /** 두신 수 = totalHeight / headLength. 8 = 8두신. */
  readonly headUnits: number;
  /** 발목(=발 본) 관절의 지면 높이. */
  readonly footHeight: number;
  readonly hipsHeight: number;
  /** 고관절→발목 직선 길이(골반 폭 제외). */
  readonly legLength: number;
  /** 어깨 관절→손목 직선 길이(쇄골 제외). */
  readonly armLength: number;
  /** 좌우 어깨 관절 간 거리. */
  readonly shoulderSpan: number;
};

/* -------------------------------------------------------------------------- */
/* 파라미터가 어떤 본의 오프셋을 늘리는지에 대한 단일 매핑                       */
/* -------------------------------------------------------------------------- */

/** 몸통 세그먼트: 각 본의 오프셋이 "부모→자기" 구간이므로 neck 오프셋까지가 몸통이다. */
const TORSO_SEGMENT_BONES: readonly StudioHumanoidBoneName[] = ["spine", "chest", "upperChest", "neck"];
/** 목 세그먼트: head 의 오프셋이 곧 neck→head 거리다. */
const NECK_SEGMENT_BONES: readonly StudioHumanoidBoneName[] = ["head"];
/** 팔 세그먼트: lowerArm 오프셋 = 위팔, hand 오프셋 = 아래팔. */
const ARM_SEGMENT_BONES: readonly StudioHumanoidBoneName[] = [
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
];
/** 어깨 폭: 쇄골 오프셋과 어깨→위팔 오프셋(좌우 방향). */
const SHOULDER_SPAN_BONES: readonly StudioHumanoidBoneName[] = [
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
];
/** 다리 세그먼트: lowerLeg 오프셋 = 허벅지, foot 오프셋 = 정강이. */
const LEG_SEGMENT_BONES: readonly StudioHumanoidBoneName[] = [
  "leftLowerLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot",
];
/** 골반 폭: 키 배수만 적용(별도 파라미터 없음). */
const HIP_SPAN_BONES: readonly StudioHumanoidBoneName[] = ["leftUpperLeg", "rightUpperLeg"];

const HAND_BONES: readonly StudioHumanoidBoneName[] = ["leftHand", "rightHand"];
const FOOT_BONES: readonly StudioHumanoidBoneName[] = ["leftFoot", "rightFoot"];

/**
 * 균등 스케일이 붙는 서브트리의 뿌리. 이 아래(손가락·발가락·눈·턱)는 **어떤 연산도 만들지 않는다**:
 * 뿌리의 균등 스케일이 이미 오프셋까지 포함해 서브트리 전체를 정확히 키우므로, 여기에 길이 이동을
 * 또 얹으면 배수가 두 번 곱해지고(=손가락이 손보다 더 늘어남) 검증기의 불변식도 깨진다.
 */
/**
 * 이 런타임이 **균등 스케일을 주는** 본들. 그 아래 서브트리는 뿌리의 스케일이 통째로 옮긴다.
 *
 * 값이 아니라 **소속**이라는 점이 중요하다. `overallHeight 1.25` 와 `headBodyRatio 0.8` 처럼
 * 서로 상쇄하는 편집에서는 `head` 의 배율이 정확히 1 이 되지만, 그렇다고 `head` 가 스케일을
 * 받지 않는 본이 되는 것은 아니다. 결과 배율로 소속을 되짚으면 그런 조합에서 판정이 뒤집힌다.
 */
export const STUDIO_VRM_UNIFORM_SCALE_SUBTREE_ROOTS: readonly StudioHumanoidBoneName[] = [
  "head",
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
];

const BONE_ORDER = new Map<StudioHumanoidBoneName, number>(
  STUDIO_HUMANOID_BONE_NAMES.map((name, index) => [name, index])
);
const BONE_NAME_SET = new Set<string>(STUDIO_HUMANOID_BONE_NAMES);
const ZERO_VEC3: StudioVrmVec3 = Object.freeze([0, 0, 0]) as StudioVrmVec3;
const MAX_BONE_DEPTH = 64;

function has(list: readonly StudioHumanoidBoneName[], name: StudioHumanoidBoneName) {
  return list.includes(name);
}

/* -------------------------------------------------------------------------- */
/* 레퍼런스 rest 스냅샷                                                        */
/* -------------------------------------------------------------------------- */

type RestEntry = readonly [StudioHumanoidBoneName, StudioHumanoidBoneName | null, StudioVrmVec3];

function mirror(entry: RestEntry): RestEntry {
  const [name, parent, offset] = entry;
  const flipped = name.replace(/^left/u, "right") as StudioHumanoidBoneName;
  const flippedParent = (parent ? parent.replace(/^left/u, "right") : null) as
    | StudioHumanoidBoneName
    | null;
  // `-0` 이 생기지 않게 0 은 0 으로 둔다(왕복 동일성 비교에서 `-0 !== 0` 로 잡히는 것을 막는다).
  const x = offset[0] === 0 ? 0 : -offset[0];
  return [flipped, flippedParent, [x, offset[1], offset[2]]];
}

type FingerChain = {
  readonly finger: string;
  readonly segments: readonly string[];
  /** 손바닥에서 손가락 뿌리까지의 Z 방향 벌어짐. */
  readonly spread: number;
  /** 마디 길이(뿌리→끝). */
  readonly lengths: readonly number[];
};

const FINGER_CHAINS: readonly FingerChain[] = [
  { finger: "Thumb", segments: ["Metacarpal", "Proximal", "Distal"], spread: -0.022, lengths: [0.028, 0.032, 0.026] },
  { finger: "Index", segments: ["Proximal", "Intermediate", "Distal"], spread: 0.018, lengths: [0.075, 0.032, 0.022] },
  { finger: "Middle", segments: ["Proximal", "Intermediate", "Distal"], spread: 0.004, lengths: [0.078, 0.035, 0.024] },
  { finger: "Ring", segments: ["Proximal", "Intermediate", "Distal"], spread: -0.012, lengths: [0.072, 0.032, 0.022] },
  { finger: "Little", segments: ["Proximal", "Intermediate", "Distal"], spread: -0.028, lengths: [0.062, 0.026, 0.019] },
];

function buildLeftFingerEntries(): RestEntry[] {
  const entries: RestEntry[] = [];
  for (const chain of FINGER_CHAINS) {
    let parent: StudioHumanoidBoneName = "leftHand";
    chain.segments.forEach((segment, index) => {
      const name = `left${chain.finger}${segment}` as StudioHumanoidBoneName;
      const offset: StudioVrmVec3 =
        index === 0 ? [0.03, 0, chain.spread] : [chain.lengths[index - 1], 0, 0];
      entries.push([name, parent, offset]);
      parent = name;
    });
  }
  return entries;
}

const LEFT_REFERENCE_ENTRIES: readonly RestEntry[] = [
  ["leftShoulder", "upperChest", [0.045, 0.05, 0]],
  ["leftUpperArm", "leftShoulder", [0.11, 0, 0]],
  ["leftLowerArm", "leftUpperArm", [0.27, 0, 0]],
  ["leftHand", "leftLowerArm", [0.24, 0, 0]],
  ["leftUpperLeg", "hips", [0.09, 0, 0]],
  ["leftLowerLeg", "leftUpperLeg", [0, -0.45, 0]],
  ["leftFoot", "leftLowerLeg", [0, -0.41, 0]],
  ["leftToes", "leftFoot", [0, -0.05, 0.11]],
  ["leftEye", "head", [0.032, 0.09, 0.07]],
  ...buildLeftFingerEntries(),
];

const CENTER_REFERENCE_ENTRIES: readonly RestEntry[] = [
  ["hips", null, [0, 0.95, 0]],
  ["spine", "hips", [0, 0.11, 0]],
  ["chest", "spine", [0, 0.1, 0]],
  ["upperChest", "chest", [0, 0.1, 0]],
  ["neck", "upperChest", [0, 0.06, 0]],
  ["head", "neck", [0, 0.08, 0]],
  ["jaw", "head", [0, 0.03, 0.04]],
];

/**
 * 기준 rest 골격 — 신장 1.60 m, **정확히 8두신**(정수리 1.60 m, 머리 길이 0.20 m).
 *
 * 수직 누적: 발목 0.09 + 다리 0.86 + 몸통 0.37 + 목 0.08 = head 관절 1.40 m,
 * 여기에 머리 0.20 m 를 더해 1.60 m. 따라서 중립(모든 파라미터 1.0) = 8두신이며,
 * 프리셋의 두신 목표값은 전부 이 스냅샷 기준으로 해석된다. 실제 VRM 이 로드되면 통합
 * 레이어가 그 모델의 실측 스냅샷을 넘기므로, 이 상수는 모델이 없을 때의 폴백이자
 * 프리셋 수치의 문서화된 기준선 역할만 한다.
 */
export const STUDIO_VRM_REFERENCE_BONE_SNAPSHOT: StudioVrmBoneHierarchySnapshot = Object.freeze({
  headLength: 0.2,
  bones: Object.freeze(
    [
      ...CENTER_REFERENCE_ENTRIES,
      ...LEFT_REFERENCE_ENTRIES,
      ...LEFT_REFERENCE_ENTRIES.map(mirror),
    ]
      .map(([name, parent, restOffset]): StudioVrmBoneRest => ({
        name,
        parent,
        restOffset: Object.freeze([...restOffset]) as StudioVrmVec3,
      }))
      .sort((a, b) => (BONE_ORDER.get(a.name) ?? 0) - (BONE_ORDER.get(b.name) ?? 0))
  ),
}) as StudioVrmBoneHierarchySnapshot;

/* -------------------------------------------------------------------------- */
/* 정규화 / 직렬화                                                             */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumeric(value: unknown): number {
  // `Number([])===0`, `Number(true)===1` 같은 느슨한 강제 변환은 손상된 저장본을 조용히
  // 그럴듯한 값으로 바꿔버린다. 숫자와 "숫자 문자열"만 받아들이고 나머지는 무효로 본다.
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

function clampParam(value: unknown, key: StudioVrmProportionKey): number {
  const limit = STUDIO_VRM_PROPORTION_LIMITS[key];
  const numeric = toNumeric(value);
  if (!Number.isFinite(numeric)) return 1;
  if (numeric <= limit.min) return limit.min;
  if (numeric >= limit.max) return limit.max;
  return numeric;
}

/** 어떤 입력이든(널·문자열·손상된 객체·알 수 없는 필드) 던지지 않고 유효한 상태로 정규화한다. */
export function sanitizeStudioVrmProportions(raw: unknown): StudioVrmProportions {
  const source = asRecord(raw);
  const presetId =
    typeof source.presetId === "string" && source.presetId.trim()
      ? source.presetId.trim().slice(0, 64)
      : undefined;

  return {
    version: STUDIO_VRM_PROPORTION_VERSION,
    ...(presetId ? { presetId } : {}),
    overallHeight: clampParam(source.overallHeight, "overallHeight"),
    headBodyRatio: clampParam(source.headBodyRatio, "headBodyRatio"),
    armLength: clampParam(source.armLength, "armLength"),
    legLength: clampParam(source.legLength, "legLength"),
    torsoLength: clampParam(source.torsoLength, "torsoLength"),
    shoulderWidth: clampParam(source.shoulderWidth, "shoulderWidth"),
    handScale: clampParam(source.handScale, "handScale"),
    footScale: clampParam(source.footScale, "footScale"),
    neckLength: clampParam(source.neckLength, "neckLength"),
  };
}

/** JSON 문자열도 받는 읽기 경계. 파싱 실패 시 중립으로 폴백한다(절대 throw 하지 않는다). */
export function parseStudioVrmProportions(raw: unknown): StudioVrmProportions {
  if (typeof raw === "string") {
    try {
      return sanitizeStudioVrmProportions(JSON.parse(raw));
    } catch {
      return sanitizeStudioVrmProportions(undefined);
    }
  }
  return sanitizeStudioVrmProportions(raw);
}

/** 저장 경계 — 정규화된 평범한 객체만 내보낸다(알 수 없는 필드는 소거). */
export function serializeStudioVrmProportions(raw: unknown): StudioVrmProportions {
  return sanitizeStudioVrmProportions(raw);
}

/* -------------------------------------------------------------------------- */
/* 플랜 해석                                                                   */
/* -------------------------------------------------------------------------- */

function isFiniteVec3(value: StudioVrmVec3 | undefined): value is StudioVrmVec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number" && Number.isFinite(component))
  );
}

function indexSnapshot(snapshot: StudioVrmBoneHierarchySnapshot) {
  const byName = new Map<StudioHumanoidBoneName, StudioVrmBoneRest>();
  for (const bone of snapshot.bones ?? []) {
    if (!bone || !BONE_NAME_SET.has(bone.name)) continue;
    if (!isFiniteVec3(bone.restOffset)) continue;
    if (byName.has(bone.name)) continue;
    byName.set(bone.name, bone);
  }
  return byName;
}

/** 이 본의 rest 오프셋에 적용될 길이 배수(=자식 관절 이동량). */
function segmentFactor(name: StudioHumanoidBoneName, p: StudioVrmProportions): number {
  if (has(TORSO_SEGMENT_BONES, name)) return p.torsoLength;
  if (has(NECK_SEGMENT_BONES, name)) return p.neckLength;
  if (has(ARM_SEGMENT_BONES, name)) return p.armLength;
  if (has(SHOULDER_SPAN_BONES, name)) return p.shoulderWidth;
  if (has(LEG_SEGMENT_BONES, name)) return p.legLength;
  if (has(HIP_SPAN_BONES, name)) return 1;
  return 1;
}

/** 균등 스케일이 붙는 말단 서브트리(머리·손·발)만 1 이 아닌 값을 돌려준다. */
function uniformScaleFactor(name: StudioHumanoidBoneName, p: StudioVrmProportions): number {
  if (name === "head") return p.headBodyRatio * p.overallHeight;
  if (has(HAND_BONES, name)) return p.handScale * p.overallHeight;
  if (has(FOOT_BONES, name)) return p.footScale * p.overallHeight;
  return 1;
}

/** 이 본이 균등 스케일 서브트리(머리·손·발) **내부**에 있는지. 뿌리 자신은 포함하지 않는다. */
function isInsideUniformScaleSubtree(
  byName: Map<StudioHumanoidBoneName, StudioVrmBoneRest>,
  name: StudioHumanoidBoneName
): boolean {
  let cursor = byName.get(name)?.parent ?? null;
  for (let depth = 0; depth < MAX_BONE_DEPTH && cursor; depth += 1) {
    if (has(STUDIO_VRM_UNIFORM_SCALE_SUBTREE_ROOTS, cursor)) return true;
    cursor = byName.get(cursor)?.parent ?? null;
  }
  return false;
}

function scaleVec(offset: StudioVrmVec3, factor: number): StudioVrmVec3 {
  return [offset[0] * factor, offset[1] * factor, offset[2] * factor];
}

function chainLengthY(
  byName: Map<StudioHumanoidBoneName, StudioVrmBoneRest>,
  from: StudioHumanoidBoneName,
  to: StudioHumanoidBoneName
): number {
  // from(조상) → to(자손) 사이 rest 오프셋 Y 누적. 체인이 끊기면 0.
  let total = 0;
  let cursor: StudioHumanoidBoneName | null = to;
  for (let depth = 0; depth < MAX_BONE_DEPTH && cursor; depth += 1) {
    if (cursor === from) return total;
    const bone: StudioVrmBoneRest | undefined = byName.get(cursor);
    if (!bone) return 0;
    total += bone.restOffset[1];
    cursor = bone.parent;
  }
  return 0;
}

function hipsTargetOffset(
  byName: Map<StudioHumanoidBoneName, StudioVrmBoneRest>,
  hips: StudioVrmBoneRest,
  p: StudioVrmProportions
): StudioVrmVec3 {
  // 다리가 길어지거나 발이 커지면 발바닥이 바닥을 뚫으므로 hips 를 그만큼 들어올린다.
  // 각 항이 `rest * (factor - 1)` 꼴이라 중립에서는 정확히 0 이 된다.
  const ankleName: StudioHumanoidBoneName = byName.has("leftFoot") ? "leftFoot" : "rightFoot";
  const legDropY = chainLengthY(byName, "hips", ankleName); // 보통 음수(아래로 내려감)
  const ankleHeight = hips.restOffset[1] + legDropY;
  const legRest = -legDropY;

  const deltaY =
    ankleHeight * (p.footScale * p.overallHeight - 1) + legRest * (p.legLength * p.overallHeight - 1);

  return [
    hips.restOffset[0] * (p.overallHeight - 1),
    deltaY,
    hips.restOffset[2] * (p.overallHeight - 1),
  ];
}

/**
 * 비율 → 본별 연산 플랜. 순수 함수이며 스냅샷에 실제 존재하는 본에 대해서만,
 * {@link STUDIO_HUMANOID_BONE_NAMES} 순서로 결정적으로 연산을 만든다.
 * 항등(스케일 1 + 이동 0) 연산은 제거되므로 **중립 비율의 플랜은 빈 배열**이다.
 */
export function resolveVrmProportionPlan(
  proportions: unknown,
  snapshot: StudioVrmBoneHierarchySnapshot = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT
): StudioVrmProportionPlan {
  const p = sanitizeStudioVrmProportions(proportions);
  const byName = indexSnapshot(snapshot);
  const ops: StudioVrmProportionOp[] = [];

  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    const bone = byName.get(name);
    if (!bone) continue;
    // 머리·손·발 서브트리 내부는 뿌리의 균등 스케일이 이미 전부 처리한다.
    if (isInsideUniformScaleSubtree(byName, name)) continue;

    const scale = uniformScaleFactor(name, p);
    const translateLocal =
      name === "hips"
        ? hipsTargetOffset(byName, bone, p)
        : scaleVec(bone.restOffset, segmentFactor(name, p) * p.overallHeight - 1);

    const isIdentity =
      scale === 1 && translateLocal[0] === 0 && translateLocal[1] === 0 && translateLocal[2] === 0;
    if (isIdentity) continue;

    ops.push({ boneName: name, scale, translateLocal });
  }

  return Object.freeze(ops);
}

/**
 * 플랜을 rest 에 합성한 **로컬 절대 트랜스폼**. 통합 레이어는 이 값을 그대로 대입하면 되고,
 * 그래서 중립 복귀가 정확히 rest 로 돌아온다(누적 오차 없음).
 */
export function resolveVrmProportionBoneTargets(
  proportions: unknown,
  snapshot: StudioVrmBoneHierarchySnapshot = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT
): readonly StudioVrmProportionBoneTarget[] {
  const byName = indexSnapshot(snapshot);
  const plan = resolveVrmProportionPlan(proportions, snapshot);
  const opByBone = new Map(plan.map((op) => [op.boneName, op]));

  const targets: StudioVrmProportionBoneTarget[] = [];
  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    const bone = byName.get(name);
    if (!bone) continue;
    const op = opByBone.get(name);
    const delta = op?.translateLocal ?? ZERO_VEC3;
    // 델타가 0 이면 rest 값을 **그대로** 돌려준다. `-0 + 0 === 0` 같은 부동소수점 잡음이 섞이면
    // "중립 복귀 = 원본 트랜스폼 복원" 보장이 비트 단위에서 깨진다.
    targets.push({
      boneName: name,
      position: [
        delta[0] === 0 ? bone.restOffset[0] : bone.restOffset[0] + delta[0],
        delta[1] === 0 ? bone.restOffset[1] : bone.restOffset[1] + delta[1],
        delta[2] === 0 ? bone.restOffset[2] : bone.restOffset[2] + delta[2],
      ],
      scale: op?.scale ?? 1,
    });
  }
  return Object.freeze(targets);
}

/**
 * 플랜을 전개해 모델 루트 기준 관절 위치와 **누적 월드 스케일**을 구한다.
 * 자식 관절은 부모의 누적 스케일이 곱해진 위치에 놓이므로, 관절이 벌어지는 일은 구조적으로 없다.
 */
export function resolveVrmProportionSkeleton(
  proportions: unknown,
  snapshot: StudioVrmBoneHierarchySnapshot = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT
): StudioVrmProportionSkeleton {
  const targets = new Map(
    resolveVrmProportionBoneTargets(proportions, snapshot).map((target) => [target.boneName, target])
  );
  const byName = indexSnapshot(snapshot);
  const resolved = new Map<StudioHumanoidBoneName, StudioVrmProportionSkeletonNode>();

  const resolve = (
    name: StudioHumanoidBoneName,
    depth: number
  ): StudioVrmProportionSkeletonNode | null => {
    const cached = resolved.get(name);
    if (cached) return cached;
    if (depth > MAX_BONE_DEPTH) return null;
    const bone = byName.get(name);
    const target = targets.get(name);
    if (!bone || !target) return null;

    const parent = bone.parent ? resolve(bone.parent, depth + 1) : null;
    const parentScale = parent?.worldScale ?? 1;
    const parentPosition = parent?.worldPosition ?? ZERO_VEC3;

    const node: StudioVrmProportionSkeletonNode = {
      boneName: name,
      worldPosition: [
        parentPosition[0] + target.position[0] * parentScale,
        parentPosition[1] + target.position[1] * parentScale,
        parentPosition[2] + target.position[2] * parentScale,
      ],
      worldScale: parentScale * target.scale,
    };
    resolved.set(name, node);
    return node;
  };

  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    if (byName.has(name)) resolve(name, 0);
  }
  return resolved;
}

function distance(a: StudioVrmVec3, b: StudioVrmVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** rest 오프셋의 길이(=이 본이 부모로부터 떨어진 거리). */
export function studioVrmRestBoneLength(bone: StudioVrmBoneRest): number {
  return Math.hypot(bone.restOffset[0], bone.restOffset[1], bone.restOffset[2]);
}

/**
 * 플랜을 전개한 골격에서 실측 지표(신장·두신 수 등)를 계산한다.
 * 두신 수는 공식을 중복 구현하지 않고 항상 해석된 골격에서 유도한다.
 */
export function resolveStudioVrmProportionMetrics(
  proportions: unknown,
  snapshot: StudioVrmBoneHierarchySnapshot = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT
): StudioVrmProportionMetrics {
  const skeleton = resolveVrmProportionSkeleton(proportions, snapshot);
  const head = skeleton.get("head");
  const hips = skeleton.get("hips");
  const foot = skeleton.get("leftFoot") ?? skeleton.get("rightFoot");
  const shoulder = skeleton.get("leftShoulder") ?? skeleton.get("leftUpperArm");
  const otherShoulder = skeleton.get("rightShoulder") ?? skeleton.get("rightUpperArm");
  const upperArm = skeleton.get("leftUpperArm");
  const upperLeg = skeleton.get("leftUpperLeg") ?? skeleton.get("rightUpperLeg");
  const hand = skeleton.get("leftHand");

  const restHeadLength = Number.isFinite(snapshot.headLength) ? Math.max(0, snapshot.headLength) : 0;
  const headLength = restHeadLength * (head?.worldScale ?? 1);
  const totalHeight = (head?.worldPosition[1] ?? 0) + headLength;

  return {
    totalHeight,
    headLength,
    headUnits: headLength > 0 ? totalHeight / headLength : 0,
    footHeight: foot?.worldPosition[1] ?? 0,
    hipsHeight: hips?.worldPosition[1] ?? 0,
    legLength: upperLeg && foot ? distance(upperLeg.worldPosition, foot.worldPosition) : 0,
    armLength: upperArm && hand ? distance(upperArm.worldPosition, hand.worldPosition) : 0,
    shoulderSpan:
      shoulder && otherShoulder ? distance(shoulder.worldPosition, otherShoulder.worldPosition) : 0,
  };
}

/**
 * 목표 두신 수(예: 3두신 SD)를 만드는 `headBodyRatio` 를 닫힌 형태로 역산한다.
 *
 * 머리 크기는 head 관절 위치에 영향을 주지 않으므로 몸 높이 `B` 는 headBodyRatio 와 무관하다.
 * `U = (B + s·h) / (s·h) = B/(s·h) + 1` 이므로 `s = B / (h·(U - 1))`.
 */
export function solveStudioVrmHeadBodyRatioForHeadUnits(
  targetHeadUnits: number,
  base: unknown = NEUTRAL_STUDIO_VRM_PROPORTIONS,
  snapshot: StudioVrmBoneHierarchySnapshot = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT
): number {
  const p = sanitizeStudioVrmProportions(base);
  const units = Number.isFinite(targetHeadUnits) ? Math.min(14, Math.max(1.6, targetHeadUnits)) : 8;
  const probe = resolveStudioVrmProportionMetrics({ ...p, headBodyRatio: 1 }, snapshot);
  const unitHeadLength = probe.headLength;
  if (!(unitHeadLength > 0)) return 1;
  const bodyHeight = probe.totalHeight - unitHeadLength;
  return clampParam(bodyHeight / (unitHeadLength * (units - 1)), "headBodyRatio");
}

/* -------------------------------------------------------------------------- */
/* 검증                                                                        */
/* -------------------------------------------------------------------------- */

export type StudioVrmProportionPlanIssue = {
  readonly code:
    | "unknown-bone"
    | "missing-bone"
    | "non-finite"
    | "non-positive-scale"
    | "scaled-ancestor-of-translated-bone"
    | "missing-required-bone";
  readonly boneName: string;
  readonly message: string;
};

/**
 * 플랜의 안전 불변식을 검사한다. 특히 `scaled-ancestor-of-translated-bone` 은 이 모듈의 핵심
 * 설계(균등 스케일은 말단 서브트리에만)를 깨뜨리는 회귀를 잡는 방어선이다 — 스케일된 조상 아래
 * 이동 연산이 생기면 그 이동량이 조상 스케일만큼 증폭되어 관절이 어긋난다.
 */
export function validateStudioVrmProportionPlan(
  plan: StudioVrmProportionPlan,
  snapshot: StudioVrmBoneHierarchySnapshot = STUDIO_VRM_REFERENCE_BONE_SNAPSHOT
): readonly StudioVrmProportionPlanIssue[] {
  const byName = indexSnapshot(snapshot);
  const issues: StudioVrmProportionPlanIssue[] = [];
  const scaledBones = new Set<StudioHumanoidBoneName>();

  for (const bone of STUDIO_VRM_REQUIRED_HUMANOID_BONES) {
    if (!byName.has(bone)) {
      issues.push({
        code: "missing-required-bone",
        boneName: bone,
        message: `VRM 필수 본 ${bone} 이(가) 스냅샷에 없습니다.`,
      });
    }
  }

  for (const op of plan) {
    if (!BONE_NAME_SET.has(op.boneName)) {
      issues.push({
        code: "unknown-bone",
        boneName: String(op.boneName),
        message: "휴머노이드 허용 목록 밖의 본입니다.",
      });
      continue;
    }
    if (!byName.has(op.boneName)) {
      issues.push({
        code: "missing-bone",
        boneName: op.boneName,
        message: "스냅샷에 없는 본에 대한 연산입니다.",
      });
    }
    if (!Number.isFinite(op.scale) || !isFiniteVec3(op.translateLocal)) {
      issues.push({ code: "non-finite", boneName: op.boneName, message: "유한하지 않은 수치입니다." });
      continue;
    }
    if (op.scale <= 0) {
      issues.push({
        code: "non-positive-scale",
        boneName: op.boneName,
        message: "스케일은 0보다 커야 합니다.",
      });
    }
    if (op.scale !== 1) scaledBones.add(op.boneName);
  }

  const isTranslated = (op: StudioVrmProportionOp) =>
    op.translateLocal[0] !== 0 || op.translateLocal[1] !== 0 || op.translateLocal[2] !== 0;

  for (const op of plan) {
    if (!isTranslated(op)) continue;
    const bone = byName.get(op.boneName);
    // 자식의 로컬 이동은 **부모** 좌표계에서 일어난다. 따라서 부모 이상에 스케일이 걸려 있으면
    // 의도한 것보다 증폭된다.
    let cursor = bone?.parent ?? null;
    for (let depth = 0; depth < MAX_BONE_DEPTH && cursor; depth += 1) {
      if (scaledBones.has(cursor)) {
        issues.push({
          code: "scaled-ancestor-of-translated-bone",
          boneName: op.boneName,
          message: `${cursor} 에 균등 스케일이 걸린 상태에서 ${op.boneName} 을(를) 이동합니다.`,
        });
        break;
      }
      cursor = byName.get(cursor)?.parent ?? null;
    }
  }

  return Object.freeze(issues);
}

/* -------------------------------------------------------------------------- */
/* 프리셋                                                                      */
/* -------------------------------------------------------------------------- */

export type StudioVrmProportionPreset = {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
  readonly hint: string;
  /** 이 프리셋이 겨냥한 두신 수(레퍼런스 스냅샷 기준). */
  readonly targetHeadUnits: number;
  readonly proportions: StudioVrmProportions;
};

type PresetSeed = Partial<Omit<StudioVrmProportions, "version" | "presetId" | "headBodyRatio">>;

function makePreset(
  id: string,
  label: string,
  emoji: string,
  hint: string,
  targetHeadUnits: number,
  seed: PresetSeed = {}
): StudioVrmProportionPreset {
  const base = sanitizeStudioVrmProportions({ ...NEUTRAL_STUDIO_VRM_PROPORTIONS, ...seed });
  // 역산 결과를 소수점 6자리로 고정한다. 부동소수점 잔차(1.0000000000000002 같은 값)가 프리셋
  // 상수로 굳어지면 "중립 = 8두신 리얼" 이라는 계약이 눈에 보이지 않게 깨진다.
  const headBodyRatio = Math.round(solveStudioVrmHeadBodyRatioForHeadUnits(targetHeadUnits, base) * 1e6) / 1e6;
  return Object.freeze({
    id,
    label,
    emoji,
    hint,
    targetHeadUnits,
    proportions: sanitizeStudioVrmProportions({ ...base, headBodyRatio, presetId: id }),
  });
}

/**
 * 만화 작화용 두신 프리셋. `headBodyRatio` 는 레퍼런스 스냅샷(8두신/1.60 m) 기준으로 목표 두신
 * 수에서 정확히 역산한 값이며, 결과 수치는 다음과 같다(테스트가 이 숫자를 고정한다).
 *
 * | id          | 두신 | headBodyRatio | 신장(m) | 다리 | 몸통 | 목   | 팔   | 손 / 발     |
 * |-------------|------|---------------|---------|------|------|------|------|-------------|
 * | realistic-8 | 8    | 1.000000      | 1.600   | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 / 1.00 |
 * | webtoon-7   | 7    | 1.166667      | 1.633   | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 / 1.00 |
 * | shonen-6    | 6    | 1.391400      | 1.670   | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 / 1.00 |
 * | cartoon-5   | 5    | 1.640750      | 1.641   | 0.92 | 0.97 | 0.85 | 0.93 | 1.06 / 1.05 |
 * | mini-4      | 4    | 1.987667      | 1.590   | 0.80 | 0.94 | 0.70 | 0.84 | 1.14 / 1.12 |
 * | sd-chibi-3  | 3    | 2.507000      | 1.504   | 0.62 | 0.88 | 0.45 | 0.70 | 1.20 / 1.20 |
 * | runway-9    | 9    | 0.909750      | 1.638   | 1.06 | 1.00 | 1.05 | 1.03 | 1.00 / 1.00 |
 *
 * 신장은 `overallHeight` 를 곱하기 전 값이다(머리가 커지면 정수리도 올라가므로 SD 프리셋의
 * 신장이 8두신보다 조금 작다). 실제 장면에서는 `overallHeight` 로 캐릭터별 키를 따로 잡는다.
 */
export const STUDIO_VRM_PROPORTION_PRESETS: readonly StudioVrmProportionPreset[] = Object.freeze([
  makePreset("realistic-8", "8두신 리얼", "🧍", "실사 비율. 극화·성인극에 쓰는 기준선", 8),
  makePreset("webtoon-7", "7두신 웹툰", "📱", "세로 스크롤 웹툰 주인공의 표준 비율", 7),
  makePreset("shonen-6", "6두신 소년만화", "⚡", "액션이 잘 읽히는 단단한 비율", 6, {
    legLength: 0.99,
    shoulderWidth: 1.03,
  }),
  makePreset("cartoon-5", "5두신 카툰", "🎈", "코믹·개그 톤의 둥근 비율", 5, {
    legLength: 0.92,
    torsoLength: 0.97,
    neckLength: 0.85,
    armLength: 0.93,
    shoulderWidth: 0.96,
    handScale: 1.06,
    footScale: 1.05,
  }),
  makePreset("mini-4", "4두신 미니", "🧸", "미니 캐릭터·굿즈 컷", 4, {
    legLength: 0.8,
    torsoLength: 0.94,
    neckLength: 0.7,
    armLength: 0.84,
    shoulderWidth: 0.92,
    handScale: 1.14,
    footScale: 1.12,
  }),
  makePreset("sd-chibi-3", "3두신 SD 치비", "🍡", "SD 치비. 개그 컷·이모티콘", 3, {
    legLength: 0.62,
    torsoLength: 0.88,
    neckLength: 0.45,
    armLength: 0.7,
    shoulderWidth: 0.88,
    handScale: 1.2,
    footScale: 1.2,
  }),
  makePreset("runway-9", "9두신 런웨이", "👗", "패션·판타지용 과장된 장신 비율", 9, {
    legLength: 1.06,
    neckLength: 1.05,
    armLength: 1.03,
  }),
]);

/** 프리셋 id 로 상태를 만든다. 없는 id 는 중립으로 폴백한다. */
export function createStudioVrmProportions(presetId?: string): StudioVrmProportions {
  if (!presetId) return sanitizeStudioVrmProportions(NEUTRAL_STUDIO_VRM_PROPORTIONS);
  const preset = STUDIO_VRM_PROPORTION_PRESETS.find((entry) => entry.id === presetId);
  return sanitizeStudioVrmProportions(preset?.proportions ?? NEUTRAL_STUDIO_VRM_PROPORTIONS);
}

/* -------------------------------------------------------------------------- */
/* 통합 계약(StudioVrmPoser 측에서 지켜야 하는 순서)                            */
/* -------------------------------------------------------------------------- */

/**
 * 이 코어는 three.js 를 모른다. 렌더 레이어(StudioVrmPoser / StudioVrmProportionRig)는
 * 아래 계약을 지켜야 한다.
 *
 * 1. **raw 본에 쓴다.** `humanoid.getRawBoneNode(name)` 로 얻은 노드의 `position`/`scale` 만
 *    바꾼다. 정규화 리그(`getNormalizedBoneNode`)는 `applyPoseToVrm` 이 매번
 *    `resetNormalizedPose()` 로 되돌리므로 비율이 지워진다. 반대로 `VRMHumanoidRig.update()` 는
 *    raw 본의 `quaternion`(과 hips `position`)만 덮어쓰므로, raw 의 `scale` 과 hips 외 `position`
 *    편집은 포즈 적용 후에도 살아남는다.
 * 2. **rest 캐시 기준 절대 대입.** 모델 로드 직후 raw 본의 `position`/`scale` 을 캐시해 두고
 *    `position = rest + translateLocal`, `scale = (s, s, s)` 로 **대입**한다. `+=` 누적은
 *    중립 복귀의 비트 단위 복원 보장을 깬다.
 * 3. **rest 자세에서 적용하고, 정규화 리그를 재구축한다.** 정규화 리그는 생성 시점의 raw 월드
 *    위치를 오프셋으로 굳혀 두므로, 비율을 바꾼 뒤에는 `vrm.humanoid.copy(vrm.humanoid)` 로
 *    재구축해야 IK·핸들·본 오버레이가 새 골격을 본다. 순서:
 *      `resetNormalizedPose()` → raw 에 비율 적용 → `humanoid.copy(humanoid)`
 *      → `springBoneManager?.setInitState()` → 기존 `applyPoseToVrm(...)` 재적용.
 * 4. **스프링본·소품·의상.** 위 3 의 `setInitState()` 로 흔들림 본 초기 상태를 다시 잡고,
 *    본에 포털로 붙은 워드로브/소품은 부모 본의 균등 스케일을 그대로 상속하므로 별도 처리가 없다.
 * 5. **bodyScale 과의 관계.** 기존 `applyBodyScale` 은 `vrm.scene.scale` 에 (w, h, w) 를 걸어
 *    씬 전체를 비균등으로 눌러 늘린다. `overallHeight` 는 그와 달리 골격 내부에서 관절 간격을
 *    바꾸므로 메시가 눌리지 않는다. 두 값은 곱해지므로 패널은 비율 편집을 켤 때
 *    `bodyScale.height` 를 1 로 되돌리도록 안내하는 편이 좋다.
 */
export const STUDIO_VRM_PROPORTION_INTEGRATION_CONTRACT = Object.freeze({
  boneAccess: "raw",
  writeMode: "absolute-from-rest-cache",
  applyOrder: [
    "resetNormalizedPose",
    "writeRawProportionTargets",
    "rebuildNormalizedRig",
    "springBoneSetInitState",
    "reapplyPose",
  ],
} as const);

/** 두신 수를 사람이 읽는 라벨로("6.0두신"). */
export function formatStudioVrmHeadUnits(headUnits: number): string {
  if (!Number.isFinite(headUnits) || headUnits <= 0) return "—";
  return `${(Math.round(headUnits * 10) / 10).toFixed(1)}두신`;
}
