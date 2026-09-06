/** Small reusable authoring actions. No mesh mutation, clipboard I/O or workspace state here. */
import {
  createStudioHybridDccIdentityTransform,
  normalizeStudioHybridDccObjectTransform,
  type StudioHybridDccObjectTransform,
  type StudioHybridDccVec3Tuple,
} from "./studio-hybrid-dcc-object-transform";

export type StudioHybridDccTransformPart = "all" | "position" | "rotationEulerRad" | "scale";
export type StudioHybridDccAlignAnchor = "min" | "center" | "max";
export interface StudioHybridDccWorldBounds {
  readonly min: StudioHybridDccVec3Tuple;
  readonly max: StudioHybridDccVec3Tuple;
}
export function copyStudioHybridDccTransformPart(
  target: StudioHybridDccObjectTransform,
  source: StudioHybridDccObjectTransform,
  part: StudioHybridDccTransformPart,
): StudioHybridDccObjectTransform {
  const to = normalizeStudioHybridDccObjectTransform(target);
  const from = normalizeStudioHybridDccObjectTransform(source);
  if (part === "all") return from;
  if (part !== "position" && part !== "rotationEulerRad" && part !== "scale") {
    throw new Error("지원하지 않는 변환 항목입니다.");
  }
  return normalizeStudioHybridDccObjectTransform({ ...to, [part]: from[part] });
}
export function resetStudioHybridDccTransformPart(
  target: StudioHybridDccObjectTransform,
  part: StudioHybridDccTransformPart,
): StudioHybridDccObjectTransform {
  return copyStudioHybridDccTransformPart(target, createStudioHybridDccIdentityTransform(), part);
}
export function mirrorStudioHybridDccTransformLocal(
  source: StudioHybridDccObjectTransform, axis: 0 | 1 | 2,
): StudioHybridDccObjectTransform {
  if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error("반전 축이 유효하지 않습니다.");
  const transform = normalizeStudioHybridDccObjectTransform(source);
  const scale: [number, number, number] = [...transform.scale];
  scale[axis] *= -1;
  return normalizeStudioHybridDccObjectTransform({ ...transform, scale });
}
function coordinate(bounds: StudioHybridDccWorldBounds, axis: 0 | 1 | 2, anchor: StudioHybridDccAlignAnchor): number {
  if (![0, 1, 2].every((index) => Object.hasOwn(bounds.min, index) && Object.hasOwn(bounds.max, index)
    && Number.isFinite(bounds.min[index]) && Number.isFinite(bounds.max[index])
    && bounds.min[index]! <= bounds.max[index]!)) throw new Error("유효한 월드 경계가 필요합니다.");
  if (anchor === "min") return bounds.min[axis];
  if (anchor === "max") return bounds.max[axis];
  if (anchor === "center") return bounds.min[axis] / 2 + bounds.max[axis] / 2;
  throw new Error("정렬 기준점이 유효하지 않습니다.");
}
/** Align one world AABB anchor to another; useful for floors, shelves and prop spacing. */
export function alignStudioHybridDccObjectBounds(
  source: StudioHybridDccObjectTransform,
  own: StudioHybridDccWorldBounds,
  reference: StudioHybridDccWorldBounds,
  axis: 0 | 1 | 2,
  ownAnchor: StudioHybridDccAlignAnchor,
  referenceAnchor: StudioHybridDccAlignAnchor,
  gap = 0,
): StudioHybridDccObjectTransform {
  if ((axis !== 0 && axis !== 1 && axis !== 2) || !Number.isFinite(gap)) {
    throw new Error("유효한 정렬 축과 간격이 필요합니다.");
  }
  const transform = normalizeStudioHybridDccObjectTransform(source);
  const delta = coordinate(reference, axis, referenceAnchor) + gap - coordinate(own, axis, ownAnchor);
  const position: [number, number, number] = [...transform.position];
  position[axis] += delta;
  return normalizeStudioHybridDccObjectTransform({ ...transform, position });
}
