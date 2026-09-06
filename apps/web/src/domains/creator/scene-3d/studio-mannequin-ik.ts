/**
 * Studio 3D 데생 인형 — 해석적 2본 IK(순수 수학 계층).
 *
 * 어깨-팔꿈치-손목 / 고관절-무릎-발목 체인을 폴 힌트와 관절 한계 클램프까지 포함해 한 번에
 * 푼다. Three.js/VRM 을 import 하지 않는 결정적 모듈이라 단위 테스트가 쉽고, 씬 계층
 * (studio-mannequin-scene.ts)이 월드→부모 프레임 변환 뒤 이 solver 를 호출한다.
 *
 * 프레임 규약: 입력은 전부 "상완/대퇴 관절의 부모 프레임" 좌표이고, rest 본 방향은 (0,−1,0)
 * 이다. 오일러는 three.js 기본과 같은 intrinsic XYZ(R = Rx·Ry·Rz) 순서다.
 * hinge 규약: 팔꿈치는 hingeSign −1(로컬 X 음수 = 앞굽힘), 무릎은 +1(X 양수 = 뒤굽힘).
 */

export type StudioMannequinIkVec3 = readonly [number, number, number];

const EPSILON = 1e-9;
const LENGTH_EPSILON = 1e-6;
/** end↔target 허용 오차(체인 길이 대비 비율). */
const REACH_TOLERANCE_RATIO = 1e-4;

type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

function isFiniteVec3(value: unknown): value is StudioMannequinIkVec3 {
  return Array.isArray(value)
    && value.length >= 3
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && Number.isFinite(value[2]);
}

function sub(a: StudioMannequinIkVec3, b: StudioMannequinIkVec3): StudioMannequinIkVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: StudioMannequinIkVec3, b: StudioMannequinIkVec3): StudioMannequinIkVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: StudioMannequinIkVec3, s: number): StudioMannequinIkVec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a: StudioMannequinIkVec3, b: StudioMannequinIkVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: StudioMannequinIkVec3, b: StudioMannequinIkVec3): StudioMannequinIkVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a: StudioMannequinIkVec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: StudioMannequinIkVec3): StudioMannequinIkVec3 | null {
  const len = length(a);
  if (!Number.isFinite(len) || len < EPSILON) return null;
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** 목표 방향과 가장 덜 평행한 월드축을 골라 결정적 수직 벡터를 만든다(하우스 패턴). */
function deterministicPerpendicular(axis: StudioMannequinIkVec3): StudioMannequinIkVec3 {
  const abs = [Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2])] as const;
  const seed: StudioMannequinIkVec3 =
    abs[0] <= abs[1] && abs[0] <= abs[2]
      ? [1, 0, 0]
      : abs[1] <= abs[2]
        ? [0, 1, 0]
        : [0, 0, 1];
  const projected = sub(seed, scale(axis, dot(seed, axis)));
  return normalize(projected) ?? [0, 1, 0];
}

// ── 행렬/오일러 (three.js 'XYZ' 규약과 일치) ────────────────────────────────

function matMul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function matApply(m: Mat3, v: StudioMannequinIkVec3): StudioMannequinIkVec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** R = Rx(x)·Ry(y)·Rz(z) — three.js Euler 'XYZ'(기본값)과 동일한 합성. */
export function studioMannequinMatrixFromEulerXyz(
  euler: StudioMannequinIkVec3,
): readonly number[] {
  const [x, y, z] = euler;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  const rx: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rz: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return matMul(matMul(rx, ry), rz);
}

/** three.js Euler.setFromRotationMatrix('XYZ')와 동일한 추출식. */
export function studioMannequinEulerXyzFromMatrix(
  matrix: readonly number[],
): StudioMannequinIkVec3 {
  const m = matrix as Mat3;
  const m13 = Math.min(1, Math.max(-1, m[2]));
  const y = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) {
    return [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])];
  }
  return [Math.atan2(m[7], m[4]), y, 0];
}

// ── 공개 계약 ───────────────────────────────────────────────────────────────

export interface StudioMannequinIkAxisLimits {
  readonly x?: readonly [number, number];
  readonly y?: readonly [number, number];
  readonly z?: readonly [number, number];
}

export interface StudioMannequinIkLimits {
  /** 상완/대퇴 관절 오일러 클램프 범위(rad). */
  readonly upper?: StudioMannequinIkAxisLimits;
  /** 팔꿈치/무릎 관절 오일러 클램프 범위(rad). */
  readonly lower?: StudioMannequinIkAxisLimits;
}

export interface StudioMannequinIkInput {
  /** 체인 루트(상완/대퇴 관절) 위치 — 부모 프레임. */
  readonly root: StudioMannequinIkVec3;
  readonly target: StudioMannequinIkVec3;
  /** 굽힘 방향 힌트(팔꿈치/무릎이 향할 쪽). 생략 시 결정적 수직 벡터로 대체. */
  readonly pole?: StudioMannequinIkVec3 | null;
  readonly upperLength: number;
  readonly lowerLength: number;
  /** 팔 −1, 다리 +1. 생략 시 +1. */
  readonly hingeSign?: 1 | -1;
}

export interface StudioMannequinIkResult {
  /** 상완/대퇴 관절 오일러(XYZ, rad) — 클램프 반영 최종값. */
  readonly upperEuler: StudioMannequinIkVec3;
  /** 팔꿈치/무릎 관절 오일러(XYZ, rad) — [hingeSign·θ, 0, 0] 형태. */
  readonly lowerEuler: StudioMannequinIkVec3;
  /** 최종 회전을 FK 로 적용한 팔꿈치/무릎 위치. */
  readonly middle: StudioMannequinIkVec3;
  /** 최종 회전을 FK 로 적용한 손목/발목 위치. */
  readonly end: StudioMannequinIkVec3;
  /** 클램프 전 목표가 도달 가능 반경(|u−l| ≤ d ≤ u+l) 안이었는지. */
  readonly reachable: boolean;
  /** 완전 신전/과수축 반경 클램프가 일어났는지. */
  readonly clampedAtExtension: boolean;
  /** 관절 한계 클램프가 결과를 바꿨는지. */
  readonly clampedByLimits: boolean;
  /** |end − target| — 호출자가 수렴 판단에 쓰는 값. */
  readonly endDistanceToTarget: number;
  /** endDistanceToTarget ≤ 체인 길이 비례 허용 오차. */
  readonly reached: boolean;
}

function clampAxisValue(
  value: number,
  axisRange: readonly [number, number] | undefined,
): number {
  if (!axisRange) return value;
  return Math.min(axisRange[1], Math.max(axisRange[0], value));
}

function clampEuler(
  euler: StudioMannequinIkVec3,
  limits: StudioMannequinIkAxisLimits | undefined,
): StudioMannequinIkVec3 {
  if (!limits) return euler;
  return [
    clampAxisValue(euler[0], limits.x),
    clampAxisValue(euler[1], limits.y),
    clampAxisValue(euler[2], limits.z),
  ];
}

function eulerChanged(a: StudioMannequinIkVec3, b: StudioMannequinIkVec3): boolean {
  return (
    Math.abs(a[0] - b[0]) > EPSILON ||
    Math.abs(a[1] - b[1]) > EPSILON ||
    Math.abs(a[2] - b[2]) > EPSILON
  );
}

/**
 * 해석적 2본 IK. 반환된 middle/end 는 항상 반환된 오일러의 FK 결과와 일치한다
 * (|middle−root| == upperLength, |end−middle| == lowerLength 불변).
 */
export function solveStudioMannequinTwoBoneIk(
  input: StudioMannequinIkInput,
  limits?: StudioMannequinIkLimits,
): StudioMannequinIkResult {
  const { upperLength, lowerLength } = input;
  if (
    !Number.isFinite(upperLength) || upperLength <= LENGTH_EPSILON ||
    !Number.isFinite(lowerLength) || lowerLength <= LENGTH_EPSILON
  ) {
    throw new RangeError("마네킹 IK 본 길이가 유효하지 않습니다.");
  }
  if (!isFiniteVec3(input.root) || !isFiniteVec3(input.target)) {
    throw new RangeError("마네킹 IK 좌표가 유한하지 않습니다.");
  }

  const hingeSign: 1 | -1 = input.hingeSign === -1 ? -1 : 1;
  const root = input.root;
  const toTarget = sub(input.target, root);
  const rawDistance = length(toTarget);

  // 목표가 루트와 겹치면 rest 본 방향(−Y)으로 결정적 폴백한다.
  const effDir = normalize(toTarget) ?? ([0, -1, 0] as const);

  const maxReach = upperLength + lowerLength;
  const minReach = Math.abs(upperLength - lowerLength);
  const reachable = rawDistance >= minReach - EPSILON && rawDistance <= maxReach + EPSILON;
  const distance = Math.min(
    maxReach - LENGTH_EPSILON,
    Math.max(Math.max(minReach + LENGTH_EPSILON, LENGTH_EPSILON), rawDistance),
  );
  const clampedAtExtension = Math.abs(distance - rawDistance) > LENGTH_EPSILON;

  const effTarget = add(root, scale(effDir, distance));

  // 폴 힌트를 목표 방향과 수직인 성분만 남긴다. 퇴화 시 결정적 수직 벡터.
  let poleDir: StudioMannequinIkVec3 | null = null;
  if (input.pole && isFiniteVec3(input.pole)) {
    const toPole = sub(input.pole, root);
    poleDir = normalize(sub(toPole, scale(effDir, dot(toPole, effDir))));
  }
  poleDir ??= deterministicPerpendicular(effDir);

  // 코사인 법칙으로 중간 관절 위치를 기하학적으로 결정한다.
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance)
    / (2 * distance);
  const lift = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const middleGeometric = add(add(root, scale(effDir, along)), scale(poleDir, lift));

  const upperDir = normalize(sub(middleGeometric, root)) ?? ([0, -1, 0] as const);
  const endDir = normalize(sub(effTarget, middleGeometric)) ?? upperDir;

  // 힌지 축: 굽힘 평면 법선. 직선 체인이면 폴 기반 폴백으로 결정성을 유지한다.
  let hingeAxis = normalize(cross(upperDir, endDir));
  hingeAxis ??= normalize(cross(upperDir, poleDir)) ?? deterministicPerpendicular(upperDir);

  // 상완 프레임: X'=hingeSign·축, Y'=−본방향, Z'=X'×Y' (오른손 좌표계).
  const xAxis = scale(hingeAxis, hingeSign);
  const yAxis = scale(upperDir, -1);
  const zAxis = normalize(cross(xAxis, yAxis)) ?? deterministicPerpendicular(yAxis);
  const upperMatrix: Mat3 = [
    xAxis[0], yAxis[0], zAxis[0],
    xAxis[1], yAxis[1], zAxis[1],
    xAxis[2], yAxis[2], zAxis[2],
  ];
  const upperEulerRaw = studioMannequinEulerXyzFromMatrix(upperMatrix);

  const bend = Math.acos(Math.min(1, Math.max(-1, dot(upperDir, endDir))));
  const lowerEulerRaw: StudioMannequinIkVec3 = [hingeSign * bend, 0, 0];

  const upperEuler = clampEuler(upperEulerRaw, limits?.upper);
  const lowerEuler = clampEuler(lowerEulerRaw, limits?.lower);
  const clampedByLimits =
    eulerChanged(upperEuler, upperEulerRaw) || eulerChanged(lowerEuler, lowerEulerRaw);

  // 최종 오일러를 FK 로 되돌려 middle/end 를 재계산한다 — 클램프 여부와 무관하게
  // "반환된 회전을 그대로 적용하면 반환된 위치가 나온다"는 계약을 지킨다.
  const upperFinal = studioMannequinMatrixFromEulerXyz(upperEuler) as Mat3;
  const lowerFinal = studioMannequinMatrixFromEulerXyz(lowerEuler) as Mat3;
  const middle = add(root, matApply(upperFinal, [0, -upperLength, 0]));
  const totalMatrix = matMul(upperFinal, lowerFinal);
  const end = add(middle, matApply(totalMatrix, [0, -lowerLength, 0]));

  const endDistanceToTarget = length(sub(end, input.target));
  const reached = endDistanceToTarget <= maxReach * REACH_TOLERANCE_RATIO;

  return {
    upperEuler,
    lowerEuler,
    middle,
    end,
    reachable,
    clampedAtExtension,
    clampedByLimits,
    endDistanceToTarget,
    reached,
  };
}
