import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import { hashStudioHybridDccObjectTransform, type StudioHybridDccObjectTransform } from "./studio-hybrid-dcc-object-transform";
import { createStudioHybridDccTransformRuntime, type StudioHybridDccTransformRuntimeState } from "./studio-hybrid-dcc-transform-runtime";
import { resolveStudioHybridDccGizmoSnaps, type StudioHybridDccViewportPreferences } from "./studio-hybrid-dcc-viewport-interaction";

import type { StudioHybridDccTransformGestureSource } from "./studio-hybrid-dcc-transform-gesture";
import type { Camera, Group, Scene } from "three";

/** Own the native Three helper, listeners and public cancellation API outside React rendering. */
function mountTransformControls(
  camera: Camera, scene: Scene, canvas: HTMLCanvasElement, target: Group,
  navigation: { enabled: boolean } | null, latest: () => StudioHybridDccTransformRuntimeState,
) {
  const previousTouchAction = canvas.style.touchAction;
  const control = new TransformControls(camera, canvas);
  const helper = control.getHelper();
  const runtime = createStudioHybridDccTransformRuntime(control, target, latest, navigation);
  scene.add(helper);
  const host = canvas.ownerDocument.defaultView;
  let pointerId: number | null = null;
  let disposed = false;
  const rememberPointer = (event: PointerEvent) => { if (event.button === 0) pointerId = event.pointerId; };
  const releaseCapture = () => {
    if (pointerId !== null) {
      try {
        if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
      } catch { /* A cancelled pointer may already have released its capture. */ }
      pointerId = null;
    }
  };
  const cancel = (message: string) => { if (runtime.cancel(message)) releaseCapture(); };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || !runtime.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel("변형을 취소했습니다. 원본과 되돌리기 기록은 변경되지 않았습니다.");
  };
  const interrupted = () => cancel("중단된 변형을 취소하고 원본 위치로 복원했습니다.");
  const visibilityChanged = () => { if (canvas.ownerDocument.hidden) interrupted(); };
  host?.addEventListener("keydown", escape, true);
  host?.addEventListener("blur", interrupted);
  canvas.addEventListener("pointerdown", rememberPointer, true);
  canvas.addEventListener("pointercancel", interrupted);
  canvas.addEventListener("webglcontextlost", interrupted);
  canvas.ownerDocument.addEventListener("visibilitychange", visibilityChanged);
  return {
    configure(mode: "translate" | "rotate" | "scale", space: "world" | "local",
      snaps: ReturnType<typeof resolveStudioHybridDccGizmoSnaps>) {
      cancel("편집 대상이나 변환 설정이 바뀌어 진행 중인 드래그를 취소했습니다.");
      control.setMode(mode);
      control.setSpace(mode === "scale" ? "local" : space);
      control.setTranslationSnap(snaps.translationSnap);
      control.setRotationSnap(snaps.rotationSnap);
      control.setScaleSnap(snaps.scaleSnap);
      control.setSize(0.82);
      latest().invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host?.removeEventListener("keydown", escape, true);
      host?.removeEventListener("blur", interrupted);
      canvas.removeEventListener("pointerdown", rememberPointer, true);
      canvas.removeEventListener("pointercancel", interrupted);
      canvas.removeEventListener("webglcontextlost", interrupted);
      canvas.ownerDocument.removeEventListener("visibilitychange", visibilityChanged);
      runtime.dispose();
      releaseCapture();
      scene.remove(helper);
      const touchAction = canvas.style.touchAction;
      control.dispose();
      canvas.style.touchAction = touchAction === "none" ? previousTouchAction : touchAction;
    },
  };
}

/** Attach the exact canonical group. No implicit parent group may receive the user's transform. */
export function StudioHybridDccTransformGizmo({
  children, objectRef, source, mode, space, preferences, onCommit, onDraggingChange, onNotice,
}: {
  readonly children: ReactNode;
  readonly objectRef: RefObject<Group | null>;
  readonly source: StudioHybridDccTransformGestureSource;
  readonly mode: "translate" | "rotate" | "scale";
  readonly space: "world" | "local";
  readonly preferences: StudioHybridDccViewportPreferences;
  readonly onCommit: (assetId: string, transform: StudioHybridDccObjectTransform) => void;
  readonly onDraggingChange: (dragging: boolean) => void;
  readonly onNotice: (message: string) => void;
}) {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const navigation = useThree((state) => state.controls) as { enabled: boolean } | null;
  const invalidate = useThree((state) => state.invalidate);
  const latest = useRef<StudioHybridDccTransformRuntimeState>({ source, onCommit, onDraggingChange, onNotice, invalidate });
  useLayoutEffect(() => {
    latest.current = { source, onCommit, onDraggingChange, onNotice, invalidate };
  }, [source, onCommit, onDraggingChange, onNotice, invalidate]);
  const bindingRef = useRef<ReturnType<typeof mountTransformControls> | null>(null);
  const snaps = resolveStudioHybridDccGizmoSnaps(preferences);
  const { translationSnap, rotationSnap, scaleSnap } = snaps;
  const sourceKey = `${source.assetId}:${source.geometryStamp}:${hashStudioHybridDccObjectTransform(source.transform)}`;
  useEffect(() => {
    const target = objectRef.current;
    if (!target) return;
    const binding = mountTransformControls(camera, scene, gl.domElement, target, navigation, () => latest.current);
    bindingRef.current = binding;
    return () => {
      bindingRef.current = null;
      binding.dispose();
    };
  }, [camera, scene, gl, navigation, objectRef]);
  useEffect(() => {
    bindingRef.current?.configure(mode, space, { translationSnap, rotationSnap, scaleSnap });
  }, [sourceKey, mode, space, translationSnap, rotationSnap, scaleSnap, camera, scene, gl, navigation, objectRef]);
  return <>{children}</>;
}
