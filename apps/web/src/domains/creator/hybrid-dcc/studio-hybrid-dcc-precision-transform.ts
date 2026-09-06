/** Renderer-free precision commands. Every result is one canonical, reversible object TRS. */
import {
  inverseTransformStudioHybridDccPoint,
  normalizeStudioHybridDccObjectTransform,
  STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_LIMITS,
  transformStudioHybridDccPoint,
  type StudioHybridDccObjectTransform,
  type StudioHybridDccVec3Tuple,
} from "./studio-hybrid-dcc-object-transform";

export type StudioHybridDccPrecisionAxis = "x" | "y" | "z" | "all";
export type StudioHybridDccPrecisionKind = "translate" | "rotate" | "scale" | "dimension";
export interface StudioHybridDccPrecisionBounds {
  readonly min: StudioHybridDccVec3Tuple;
  readonly max: StudioHybridDccVec3Tuple;
}
export interface StudioHybridDccPrecisionCommand {
  readonly kind: StudioHybridDccPrecisionKind;
  readonly axis: StudioHybridDccPrecisionAxis;
  readonly space: "world" | "local";
  /** Metres for translate/dimension, radians for rotation, unitless multiplier for scale. */
  readonly value: number;
  /** World-space pivot. Omitted means the object's own origin. */
  readonly pivot?: StudioHybridDccVec3Tuple;
}

type Quaternion = readonly [number, number, number, number];
const ZERO: StudioHybridDccVec3Tuple = [0, 0, 0];
const ONE: StudioHybridDccVec3Tuple = [1, 1, 1];
const AXES = { x: 0, y: 1, z: 2 } as const;

function finiteVector(value: StudioHybridDccVec3Tuple): void {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error("피벗과 경계에는 유한한 XYZ 좌표가 필요합니다.");
  }
}
function validateBounds(bounds: StudioHybridDccPrecisionBounds): void {
  finiteVector(bounds.min);
  finiteVector(bounds.max);
  if (bounds.min.some((value, index) => value > bounds.max[index]!)) {
    throw new Error("오브젝트 경계의 최솟값이 최댓값보다 큽니다.");
  }
}
function add(a: StudioHybridDccVec3Tuple, b: StudioHybridDccVec3Tuple): StudioHybridDccVec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function subtract(a: StudioHybridDccVec3Tuple, b: StudioHybridDccVec3Tuple): StudioHybridDccVec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function conjugate(q: Quaternion): Quaternion { return [-q[0], -q[1], -q[2], q[3]]; }
function quaternionFromEuler(euler: StudioHybridDccVec3Tuple): Quaternion {
  const [x, y, z] = euler;
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}
function eulerFromQuaternion(q: Quaternion): StudioHybridDccVec3Tuple {
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error("회전이 유효하지 않습니다.");
  const [x, y, z, w] = q.map((value) => value / length) as [number, number, number, number];
  const m13 = Math.max(-1, Math.min(1, 2 * (x * z + w * y)));
  const ry = Math.asin(m13);
  if (Math.abs(m13) < 1 - 1e-12) {
    return [
      Math.atan2(2 * (w * x - y * z), 1 - 2 * (x * x + y * y)),
      ry,
      Math.atan2(2 * (w * z - x * y), 1 - 2 * (y * y + z * z)),
    ];
  }
  return [Math.atan2(2 * (y * z + w * x), 1 - 2 * (x * x + z * z)), ry, 0];
}
function rotatePoint(point: StudioHybridDccVec3Tuple, q: Quaternion): StudioHybridDccVec3Tuple {
  const result = multiply(multiply(q, [...point, 0]), conjugate(q));
  return [result[0], result[1], result[2]];
}
function scaledAboutPivot(
  transform: StudioHybridDccObjectTransform,
  factors: StudioHybridDccVec3Tuple,
  pivot: StudioHybridDccVec3Tuple,
): StudioHybridDccObjectTransform {
  // Scale along object-local axes about a world-space pivot without baking or introducing shear.
  const rotationOnly = { ...transform, position: ZERO, scale: ONE };
  const offset = inverseTransformStudioHybridDccPoint(subtract(transform.position, pivot), rotationOnly);
  const scaledOffset: StudioHybridDccVec3Tuple = [
    offset[0] * factors[0], offset[1] * factors[1], offset[2] * factors[2],
  ];
  return normalizeStudioHybridDccObjectTransform({
    ...transform,
    position: add(pivot, transformStudioHybridDccPoint(scaledOffset, rotationOnly)),
    scale: [
      transform.scale[0] * factors[0],
      transform.scale[1] * factors[1],
      transform.scale[2] * factors[2],
    ],
  });
}

export function applyStudioHybridDccPrecisionCommand(
  source: StudioHybridDccObjectTransform,
  command: StudioHybridDccPrecisionCommand,
  bounds?: StudioHybridDccPrecisionBounds,
): StudioHybridDccObjectTransform {
  const transform = normalizeStudioHybridDccObjectTransform(source);
  if (!Number.isFinite(command.value)) throw new Error("유한한 변환 값이 필요합니다.");
  if (!["translate", "rotate", "scale", "dimension"].includes(command.kind)
    || !["x", "y", "z", "all"].includes(command.axis)
    || !["world", "local"].includes(command.space)) {
    throw new Error("지원하지 않는 변환 종류, 축 또는 좌표계입니다.");
  }
  const pivot = command.pivot ?? transform.position;
  finiteVector(pivot);
  if (pivot.some((value) => Math.abs(value) > 1_000_000)) {
    throw new Error("피벗은 ±1,000,000 m 범위 안에 있어야 합니다.");
  }
  if (command.axis === "all" && command.kind !== "scale") {
    throw new Error("이 변환에는 X, Y, Z 중 하나의 축을 선택하세요.");
  }
  const axisIndex = command.axis === "all" ? 0 : AXES[command.axis];
  if (command.kind === "translate") {
    const delta: [number, number, number] = [0, 0, 0];
    delta[axisIndex] = command.value;
    const worldDelta = command.space === "local"
      ? transformStudioHybridDccPoint(delta, { ...transform, position: ZERO, scale: ONE })
      : delta;
    return normalizeStudioHybridDccObjectTransform({ ...transform, position: add(transform.position, worldDelta) });
  }
  if (command.kind === "rotate") {
    if (Math.abs(command.value) > STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_LIMITS.maxRotationMagnitude) {
      throw new Error("회전 증분이 안전 범위를 벗어났습니다.");
    }
    const current = quaternionFromEuler(transform.rotationEulerRad);
    const delta: [number, number, number, number] = [0, 0, 0, Math.cos(command.value / 2)];
    delta[axisIndex] = Math.sin(command.value / 2);
    const worldDelta = command.space === "world" ? delta : multiply(multiply(current, delta), conjugate(current));
    const next = command.space === "world" ? multiply(delta, current) : multiply(current, delta);
    return normalizeStudioHybridDccObjectTransform({
      ...transform,
      rotationEulerRad: eulerFromQuaternion(next),
      position: add(pivot, rotatePoint(subtract(transform.position, pivot), worldDelta)),
    });
  }
  if (command.kind === "dimension") {
    if (!bounds) throw new Error("화면에 표시된 메시의 경계가 필요합니다.");
    validateBounds(bounds);
    const span = bounds.max[axisIndex]! - bounds.min[axisIndex]!;
    if (span < 1e-9 || command.value <= 0) {
      throw new Error("치수와 현재 축의 길이는 0보다 커야 합니다.");
    }
    const factor = command.value / span;
    return scaledAboutPivot(transform, [factor, factor, factor], pivot);
  }
  if (command.axis !== "all" && command.space === "world") {
    throw new Error("전단 변형을 방지하기 위해 비균일 크기 조절은 로컬 축을 사용하세요.");
  }
  const factors: [number, number, number] = command.axis === "all"
    ? [command.value, command.value, command.value] : [1, 1, 1];
  if (command.axis !== "all") factors[axisIndex] = command.value;
  return scaledAboutPivot(transform, factors, pivot);
}

/** Exact bounds of rendered vertices, not the overly conservative rotated local bounding box. */
export function measureStudioHybridDccPrecisionBounds(
  positions: ArrayLike<number>,
  source: StudioHybridDccObjectTransform,
): StudioHybridDccPrecisionBounds {
  if (!Number.isSafeInteger(positions.length) || positions.length === 0
    || positions.length % 3 !== 0 || positions.length > 750_000) {
    throw new Error("정밀 측정은 최대 250,000개의 유효한 정점을 지원합니다.");
  }
  const transform = normalizeStudioHybridDccObjectTransform(source);
  const linear = { ...transform, position: ZERO };
  const bx = transformStudioHybridDccPoint([1, 0, 0], linear);
  const by = transformStudioHybridDccPoint([0, 1, 0], linear);
  const bz = transformStudioHybridDccPoint([0, 0, 1], linear);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!, y = positions[index + 1]!, z = positions[index + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error("측정할 정점에 유한하지 않은 좌표가 있습니다.");
    }
    const wx = transform.position[0] + bx[0] * x + by[0] * y + bz[0] * z;
    const wy = transform.position[1] + bx[1] * x + by[1] * y + bz[1] * z;
    const wz = transform.position[2] + bx[2] * x + by[2] * y + bz[2] * z;
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) {
      throw new Error("측정 결과가 안전 범위를 벗어났습니다.");
    }
    min[0] = Math.min(min[0], wx); max[0] = Math.max(max[0], wx);
    min[1] = Math.min(min[1], wy); max[1] = Math.max(max[1], wy);
    min[2] = Math.min(min[2], wz); max[2] = Math.max(max[2], wz);
  }
  return { min, max };
}

export function alignStudioHybridDccPrecisionBounds(
  source: StudioHybridDccObjectTransform,
  bounds: StudioHybridDccPrecisionBounds,
  target: "ground" | "center",
): StudioHybridDccObjectTransform {
  const transform = normalizeStudioHybridDccObjectTransform(source);
  validateBounds(bounds);
  if (target !== "ground" && target !== "center") throw new Error("지원하지 않는 정렬입니다.");
  const delta: StudioHybridDccVec3Tuple = target === "ground"
    ? [0, -bounds.min[1], 0]
    : [-(bounds.min[0] + bounds.max[0]) / 2,
        -(bounds.min[1] + bounds.max[1]) / 2,
        -(bounds.min[2] + bounds.max[2]) / 2];
  return normalizeStudioHybridDccObjectTransform({ ...transform, position: add(transform.position, delta) });
}

/** Explicit absolute world-grid snap. Symmetric half ties avoid a negative-coordinate bias. */
export function snapStudioHybridDccPrecisionToGrid(
  source: StudioHybridDccObjectTransform,
  step: number,
): StudioHybridDccObjectTransform {
  const transform = normalizeStudioHybridDccObjectTransform(source);
  if (!Number.isFinite(step) || step < 1e-6 || step > 1_000_000) {
    throw new Error("그리드 간격은 0.000001~1,000,000 m여야 합니다.");
  }
  const snap = (value: number) => {
    const ratio = Math.abs(value) / step;
    const result = Math.sign(value) * Math.round(ratio + Number.EPSILON * Math.max(1, ratio)) * step;
    return Object.is(result, -0) ? 0 : result;
  };
  return normalizeStudioHybridDccObjectTransform({
    ...transform,
    position: transform.position.map(snap),
  });
}
