/** Renderer-independent gesture lifecycle. The supplied target is the canonical object, not a wrapper. */
import {
  normalizeStudioHybridDccObjectTransform,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";
import {
  beginStudioHybridDccTransformGesture,
  finishStudioHybridDccTransformGesture,
  type StudioHybridDccTransformGesture,
  type StudioHybridDccTransformGestureSource,
} from "./studio-hybrid-dcc-transform-gesture";

interface Vector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  set(x: number, y: number, z: number): unknown;
}
export interface StudioHybridDccTransformTarget {
  readonly position: Vector;
  readonly rotation: Vector & { set(x: number, y: number, z: number, order?: "XYZ"): unknown };
  readonly scale: Vector;
  updateMatrixWorld(force: boolean): void;
}
export type StudioHybridDccTransformRuntimeEvent = "mouseDown" | "mouseUp" | "change" | "dragging-changed";
export interface StudioHybridDccTransformControl<T extends StudioHybridDccTransformTarget> {
  readonly dragging: boolean;
  attach(target: T): unknown;
  detach(): unknown;
  /** Three.js public termination API. It may synchronously dispatch mouseUp. */
  pointerUp(pointer: null): void;
  addEventListener(event: StudioHybridDccTransformRuntimeEvent, listener: () => void): void;
  removeEventListener(event: StudioHybridDccTransformRuntimeEvent, listener: () => void): void;
}
export interface StudioHybridDccTransformRuntimeState {
  readonly source: StudioHybridDccTransformGestureSource;
  readonly onCommit: (assetId: string, transform: StudioHybridDccObjectTransform) => void;
  readonly onDraggingChange: (dragging: boolean) => void;
  readonly onNotice: (message: string) => void;
  readonly invalidate: () => void;
}

function restore(target: StudioHybridDccTransformTarget, source: StudioHybridDccObjectTransform): void {
  const transform = normalizeStudioHybridDccObjectTransform(source);
  target.position.set(...transform.position);
  target.rotation.set(...transform.rotationEulerRad, "XYZ");
  target.scale.set(...transform.scale);
  target.updateMatrixWorld(true);
}

/** One owner for cancellation, original-state validation, orbit leasing and exactly-once dispatch. */
export function createStudioHybridDccTransformRuntime<T extends StudioHybridDccTransformTarget>(
  control: StudioHybridDccTransformControl<T>,
  target: T,
  latest: () => StudioHybridDccTransformRuntimeState,
  navigation: { enabled: boolean } | null = null,
) {
  let gesture: StudioHybridDccTransformGesture | null = null;
  let orbitEnabledBefore: boolean | null = null;
  let disposed = false;
  const releaseOrbit = () => {
    if (navigation && orbitEnabledBefore !== null) {
      // Do not overwrite a later owner's explicit enable operation.
      if (navigation.enabled === false) navigation.enabled = orbitEnabledBefore;
      orbitEnabledBefore = null;
    }
  };
  const draggingChanged = () => {
    if (control.dragging && !disposed) {
      if (navigation && orbitEnabledBefore === null) {
        orbitEnabledBefore = navigation.enabled;
        navigation.enabled = false;
      }
    } else releaseOrbit();
  };
  const changed = () => { if (!disposed) latest().invalidate(); };
  const restoreLatest = () => {
    try { restore(target, latest().source.transform); }
    catch (error) { latest().onNotice(error instanceof Error ? error.message : "원본 변환을 복원하지 못했습니다."); }
  };
  const cancel = (message = "") => {
    if (!gesture && !control.dragging) return false;
    // Clear BEFORE pointerUp: a synchronous mouseUp during cancellation must never commit.
    gesture = null;
    control.pointerUp(null);
    releaseOrbit();
    restoreLatest();
    latest().onDraggingChange(false);
    if (message) latest().onNotice(message);
    latest().invalidate();
    return true;
  };
  const begin = () => {
    if (disposed) return;
    try {
      gesture = beginStudioHybridDccTransformGesture(latest().source);
      draggingChanged();
      latest().onDraggingChange(true);
      latest().onNotice("변형 중 · Esc 취소");
    } catch (error) {
      cancel();
      latest().onNotice(error instanceof Error ? error.message : "변형을 시작하지 못했습니다.");
    }
  };
  const finish = () => {
    const started = gesture;
    if (!started || disposed) return;
    gesture = null;
    const state = latest();
    const result = finishStudioHybridDccTransformGesture(started, state.source, {
      revision: 1,
      position: [target.position.x, target.position.y, target.position.z],
      rotationEulerRad: [target.rotation.x, target.rotation.y, target.rotation.z],
      scale: [target.scale.x, target.scale.y, target.scale.z],
    });
    // A failed asynchronous document command must not leave an uncommitted display pose behind.
    restoreLatest();
    state.onDraggingChange(false);
    releaseOrbit();
    if (result.kind === "commit") {
      try {
        state.onCommit(result.assetId, result.transform);
        state.onNotice("변형을 적용 요청했습니다. 실행 결과는 편집기 상태에서 확인하세요.");
      } catch (error) {
        restoreLatest();
        state.onNotice(error instanceof Error ? error.message : "변형 적용에 실패했습니다.");
      }
    } else state.onNotice(result.kind === "reject" ? result.message : "변경 없음 · 편집 기록을 추가하지 않았습니다.");
    state.invalidate();
  };
  control.attach(target);
  control.addEventListener("mouseDown", begin);
  control.addEventListener("mouseUp", finish);
  control.addEventListener("change", changed);
  control.addEventListener("dragging-changed", draggingChanged);
  return {
    get active() { return !disposed && (gesture !== null || control.dragging); },
    cancel,
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      control.removeEventListener("mouseDown", begin);
      control.removeEventListener("mouseUp", finish);
      control.removeEventListener("change", changed);
      control.removeEventListener("dragging-changed", draggingChanged);
      releaseOrbit();
      control.detach();
    },
  };
}
