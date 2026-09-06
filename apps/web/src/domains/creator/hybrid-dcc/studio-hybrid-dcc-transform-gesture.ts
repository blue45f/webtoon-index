/** A drag is disposable presentation state until one validated, non-stale mouse-up commit. */
import {
  hashStudioHybridDccObjectTransform,
  normalizeStudioHybridDccObjectTransform,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";

export interface StudioHybridDccTransformGestureSource {
  readonly assetId: string;
  readonly geometryStamp: string;
  readonly transform: StudioHybridDccObjectTransform;
}
export interface StudioHybridDccTransformGesture {
  readonly source: StudioHybridDccTransformGestureSource;
  readonly transformHash: string;
}
export type StudioHybridDccTransformGestureResult =
  | { readonly kind: "commit"; readonly assetId: string; readonly transform: StudioHybridDccObjectTransform }
  | { readonly kind: "unchanged" }
  | { readonly kind: "reject"; readonly message: string };

export function beginStudioHybridDccTransformGesture(
  source: StudioHybridDccTransformGestureSource,
): StudioHybridDccTransformGesture {
  if (!source.assetId || !source.geometryStamp) throw new Error("변형할 오브젝트의 원본 정보가 없습니다.");
  const transform = normalizeStudioHybridDccObjectTransform(source.transform);
  return { source: { ...source, transform }, transformHash: hashStudioHybridDccObjectTransform(transform) };
}
export function finishStudioHybridDccTransformGesture(
  gesture: StudioHybridDccTransformGesture,
  current: StudioHybridDccTransformGestureSource,
  candidate: unknown,
): StudioHybridDccTransformGestureResult {
  try {
    const source = normalizeStudioHybridDccObjectTransform(current.transform);
    if (gesture.source.assetId !== current.assetId
      || gesture.source.geometryStamp !== current.geometryStamp
      || gesture.transformHash !== hashStudioHybridDccObjectTransform(source)) {
      return { kind: "reject", message: "드래그 중 원본이 변경되어 변형을 취소했습니다." };
    }
    const transform = normalizeStudioHybridDccObjectTransform(candidate);
    // Exact equality keeps micro-edits meaningful; -0 is normalized by the canonical hash.
    if (gesture.transformHash === hashStudioHybridDccObjectTransform(transform)) return { kind: "unchanged" };
    return { kind: "commit", assetId: current.assetId, transform };
  } catch (error) {
    return { kind: "reject", message: `유효하지 않은 변형을 취소했습니다. ${error instanceof Error ? error.message : "입력을 확인하세요."}` };
  }
}
