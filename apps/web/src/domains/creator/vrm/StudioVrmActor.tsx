/**
 * Canvas VRM actor extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 */
import {
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import {
  HEAD_BONE_SMOOTHER,
  VrmBoneSmoother,
} from "./studio-vrm-bone-smoother";
import {
  applyExpressionWeightsToVrm,
  applyVrmCustomColors,
  applyVrmMaterialFx,
  repairVrmTexturedNearBlackLitFactors,
  applyPoserVisualState,
  type PoseBoneMap,
  type FingerRotationMap,
  type BodyScale,
  type VrmMaterialFx,
} from "./studio-vrm-poser-utils";
import type {
  StudioVrmPoseTranslations,
} from "./studio-vrm-scene-document";
import {
  createStudioVrmSurfacePaintTool,
  type StudioVrmSurfacePaintToolSnapshot,
} from "./studio-vrm-surface-paint-tool";
import type {
  StudioVrmTexturePaintRuntime,
} from "./studio-vrm-texture-paint-runtime";
import type {
  VrmTrackingData,
} from "./studio-vrm-webcam-tracking";
import {
  CANONICAL_LIMB_BONES,
  isStudioVrmTexturePaintBrushProductBlocked,
  LIMB_BONE_RE,
  LIMB_FADE_HALF_LIFE,
  LOOK_EXPRESSION_NAMES,
  ZERO_EULER,
} from "./StudioVrmPoserTypes";
import type {
  StudioVrmTexturePaintPanelSettings,
} from "./StudioVrmTexturePaintPanel";
import {
  VRM_FRAME_BASE_PRIORITY,
  applyLookAtToVrm,
  applyRotationToVrm,
  studioVrmTexturePaintHit,
  studioVrmTexturePaintPressure,
  studioVrmSurfacePaintPointerSample,
  studioVrmTexturePaintOneShotTapMoved,
  type StudioVrmTexturePaintPointerCaptureTarget,
  type StudioVrmTexturePaintPendingOneShotTap,
} from "./StudioVrmViewportUtils";

import type {
  VRM,
  VRMHumanBoneName,
} from "@pixiv/three-vrm";

export function VrmActor({
  bodyRotation,
  customBones,
  customYOffset,
  poseTranslations,
  expressionWeights,
  vrm,
  customColors,
  materialFx,
  webcamActive,
  trackingDataRef,
  idleAnimation,
  fingerEdits,
  bodyScale,
  rigRevision,
  texturePaintEnabled,
  texturePaintMutationBlockedRef,
  texturePaintRuntime,
  texturePaintSettings,
  texturePaintEyedropperActive,
  onTexturePaintColorSampled,
  onTexturePaintEyedropperComplete,
  onTexturePaintSurfaceStateChange,
}: {
  bodyRotation: number;
  customBones: PoseBoneMap;
  customYOffset: number;
  poseTranslations: StudioVrmPoseTranslations;
  expressionWeights: Record<string, number>;
  vrm: VRM;
  customColors: Record<string, string>;
  materialFx: VrmMaterialFx;
  webcamActive: boolean;
  trackingDataRef: React.RefObject<VrmTrackingData | null>;
  idleAnimation: boolean;
  fingerEdits: FingerRotationMap;
  bodyScale: BodyScale;
  rigRevision: number;
  texturePaintEnabled: boolean;
  texturePaintMutationBlockedRef: React.RefObject<boolean>;
  texturePaintRuntime: StudioVrmTexturePaintRuntime | null;
  texturePaintSettings: StudioVrmTexturePaintPanelSettings;
  texturePaintEyedropperActive: boolean;
  onTexturePaintColorSampled: (color: string) => void;
  onTexturePaintEyedropperComplete: () => void;
  onTexturePaintSurfaceStateChange: (
    snapshot: StudioVrmSurfacePaintToolSnapshot | null,
  ) => void;
}) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const texturePaintRuntimeRef = useRef(texturePaintRuntime);
  const texturePaintSettingsRef = useRef(texturePaintSettings);
  const texturePaintEnabledRef = useRef(texturePaintEnabled);
  const texturePaintEyedropperActiveRef = useRef(texturePaintEyedropperActive);
  const texturePaintColorSampledRef = useRef(onTexturePaintColorSampled);
  const texturePaintEyedropperCompleteRef = useRef(onTexturePaintEyedropperComplete);
  const texturePaintSurfaceStateChangeRef = useRef(onTexturePaintSurfaceStateChange);
  const texturePaintOneShotGenerationRef = useRef(0);
  const texturePaintOneShotAbortRef = useRef<AbortController | null>(null);
  const texturePaintOneShotBusyRef = useRef(false);
  const texturePaintPendingOneShotTapRef =
    useRef<StudioVrmTexturePaintPendingOneShotTap | null>(null);
  const texturePaintPointerIdRef = useRef<number | null>(null);
  const texturePaintCaptureTargetRef = useRef<{
    releasePointerCapture(pointerId: number): void;
  } | null>(null);
  const finishTexturePaintRef = useRef<(pointerId?: number) => void>(() => undefined);
  const cancelTexturePaintRef = useRef<(pointerId?: number) => void>(() => undefined);
  const texturePaintSurfacePointerIdRef = useRef<number | null>(null);
  const texturePaintSurfaceCaptureTargetRef = useRef<{
    releasePointerCapture(pointerId: number): void;
  } | null>(null);
  const finishTexturePaintSurfaceRef = useRef<(pointerId?: number) => void>(() => undefined);
  const cancelTexturePaintSurfaceRef = useRef<(
    reason: "disabled" | "device-failure" | "lost-capture" | "pointer-cancel" | "pointer-leave" | "tool-change" | "unmount" | "window-blur",
    pointerId?: number,
  ) => void>(() => undefined);
  const texturePaintSurfaceCameraPointRef = useRef(new THREE.Vector3());
  const [texturePaintSurfaceTool] = useState(() => createStudioVrmSurfacePaintTool({
    onSnapshot: (snapshot) => texturePaintSurfaceStateChangeRef.current(snapshot),
  }));

  const releaseTexturePaintPendingOneShotCapture = useCallback(
    (pending: StudioVrmTexturePaintPendingOneShotTap) => {
      const captureTarget = pending.captureTarget;
      pending.captureTarget = null;
      if (!captureTarget) return;
      try {
        captureTarget.releasePointerCapture(pending.pointerId);
      } catch {
        // Pointer cancellation or native pointerup may already have released capture.
      }
    },
    [],
  );

  const cancelTexturePaintPendingOneShotTap = useCallback(
    (matchingPointerId?: number): boolean => {
      const pending = texturePaintPendingOneShotTapRef.current;
      if (
        !pending
        || (matchingPointerId !== undefined && pending.pointerId !== matchingPointerId)
      ) {
        return false;
      }
      texturePaintPendingOneShotTapRef.current = null;
      releaseTexturePaintPendingOneShotCapture(pending);
      return true;
    },
    [releaseTexturePaintPendingOneShotCapture],
  );

  const runTexturePaintOneShot = useCallback(
    (pending: StudioVrmTexturePaintPendingOneShotTap) => {
      if (
        texturePaintMutationBlockedRef.current
        || !texturePaintEnabledRef.current
        || texturePaintRuntimeRef.current !== pending.runtime
        || texturePaintOneShotBusyRef.current
      ) {
        return;
      }

      const generation = texturePaintOneShotGenerationRef.current + 1;
      texturePaintOneShotGenerationRef.current = generation;
      texturePaintOneShotBusyRef.current = true;
      const controller = new AbortController();
      texturePaintOneShotAbortRef.current = controller;
      pending.runtime.clearError();
      const operation = pending.kind === "sample"
        ? pending.runtime.sampleBaseColor({
            hit: pending.hit,
            signal: controller.signal,
          })
        : pending.runtime.fillBaseColor({
            hit: pending.hit,
            color: pending.settings.color,
            tolerance: pending.settings.fillTolerance,
            scope: pending.settings.fillScope,
            signal: controller.signal,
          });

      void operation.then((result) => {
        if (generation !== texturePaintOneShotGenerationRef.current) return;
        if (pending.kind === "sample" && result.ok && typeof result.value !== "boolean") {
          texturePaintColorSampledRef.current(result.value.color);
          if (pending.explicitEyedropper) texturePaintEyedropperCompleteRef.current();
        }
        invalidate();
      }).catch(() => {
        if (generation === texturePaintOneShotGenerationRef.current) invalidate();
      }).finally(() => {
        if (generation === texturePaintOneShotGenerationRef.current) {
          if (texturePaintOneShotAbortRef.current === controller) {
            texturePaintOneShotAbortRef.current = null;
          }
          texturePaintOneShotBusyRef.current = false;
        }
      });
    },
    [invalidate, texturePaintMutationBlockedRef],
  );

  const finishTexturePaintPendingOneShotTap = useCallback(
    (
      pointerId: number,
      clientX: number,
      clientY: number,
    ): boolean => {
      const pending = texturePaintPendingOneShotTapRef.current;
      if (!pending || pending.pointerId !== pointerId) return false;
      texturePaintPendingOneShotTapRef.current = null;
      releaseTexturePaintPendingOneShotCapture(pending);
      if (studioVrmTexturePaintOneShotTapMoved(pending, clientX, clientY)) return true;
      runTexturePaintOneShot(pending);
      return true;
    },
    [releaseTexturePaintPendingOneShotCapture, runTexturePaintOneShot],
  );

  useEffect(() => {
    texturePaintRuntimeRef.current = texturePaintRuntime;
    texturePaintSettingsRef.current = texturePaintSettings;
    texturePaintEnabledRef.current = texturePaintEnabled;
    texturePaintEyedropperActiveRef.current = texturePaintEyedropperActive;
    texturePaintColorSampledRef.current = onTexturePaintColorSampled;
    texturePaintEyedropperCompleteRef.current = onTexturePaintEyedropperComplete;
    texturePaintSurfaceStateChangeRef.current = onTexturePaintSurfaceStateChange;
  }, [
    onTexturePaintColorSampled,
    onTexturePaintEyedropperComplete,
    onTexturePaintSurfaceStateChange,
    texturePaintEnabled,
    texturePaintEyedropperActive,
    texturePaintRuntime,
    texturePaintSettings,
  ]);

  useEffect(() => () => {
    cancelTexturePaintPendingOneShotTap();
    texturePaintOneShotGenerationRef.current += 1;
    texturePaintOneShotAbortRef.current?.abort();
    texturePaintOneShotAbortRef.current = null;
    texturePaintOneShotBusyRef.current = false;
    texturePaintSurfaceTool.cancel("unmount");
    texturePaintSurfaceTool.dispose();
    texturePaintSurfaceStateChangeRef.current(null);
  }, [cancelTexturePaintPendingOneShotTap, texturePaintSurfaceTool]);

  useEffect(() => {
    const releaseCapture = (pointerId: number) => {
      const captureTarget = texturePaintCaptureTargetRef.current;
      texturePaintCaptureTargetRef.current = null;
      if (!captureTarget) return;
      try {
        captureTarget.releasePointerCapture(pointerId);
      } catch {
        // The browser may already have released capture before the fallback event arrives.
      }
    };
    const finishTexturePaint = (matchingPointerId?: number) => {
      const pointerId = texturePaintPointerIdRef.current;
      if (
        pointerId === null
        || (matchingPointerId !== undefined && matchingPointerId !== pointerId)
      ) {
        return;
      }
      texturePaintPointerIdRef.current = null;
      releaseCapture(pointerId);
      const result = texturePaintRuntimeRef.current?.commitStroke(pointerId);
      if (result?.ok && result.value) invalidate();
    };
    const cancelTexturePaint = (matchingPointerId?: number) => {
      const pointerId = texturePaintPointerIdRef.current;
      if (
        pointerId === null
        || (matchingPointerId !== undefined && matchingPointerId !== pointerId)
      ) {
        return;
      }
      texturePaintPointerIdRef.current = null;
      releaseCapture(pointerId);
      const result = texturePaintRuntimeRef.current?.cancelStroke(pointerId);
      if (result?.ok && result.value) invalidate();
    };
    const releaseSurfaceCapture = (pointerId: number) => {
      const captureTarget = texturePaintSurfaceCaptureTargetRef.current;
      texturePaintSurfaceCaptureTargetRef.current = null;
      if (!captureTarget) return;
      try {
        captureTarget.releasePointerCapture(pointerId);
      } catch {
        // Native pointerup/lostpointercapture may already have released it.
      }
    };
    const finishTexturePaintSurface = (matchingPointerId?: number) => {
      const pointerId = texturePaintSurfacePointerIdRef.current;
      if (
        pointerId === null
        || (matchingPointerId !== undefined && matchingPointerId !== pointerId)
      ) {
        return;
      }
      texturePaintSurfacePointerIdRef.current = null;
      releaseSurfaceCapture(pointerId);
      void texturePaintSurfaceTool.finish(pointerId).then(() => invalidate());
    };
    const cancelTexturePaintSurface = (
      reason: "disabled" | "device-failure" | "lost-capture" | "pointer-cancel" | "pointer-leave" | "tool-change" | "unmount" | "window-blur",
      matchingPointerId?: number,
    ) => {
      const pointerId = texturePaintSurfacePointerIdRef.current;
      if (
        pointerId === null
        || (matchingPointerId !== undefined && matchingPointerId !== pointerId)
      ) {
        if (matchingPointerId === undefined) texturePaintSurfaceTool.cancel(reason);
        return;
      }
      texturePaintSurfacePointerIdRef.current = null;
      releaseSurfaceCapture(pointerId);
      if (texturePaintSurfaceTool.cancel(reason, pointerId)) invalidate();
    };
    finishTexturePaintRef.current = finishTexturePaint;
    cancelTexturePaintRef.current = cancelTexturePaint;
    finishTexturePaintSurfaceRef.current = finishTexturePaintSurface;
    cancelTexturePaintSurfaceRef.current = cancelTexturePaintSurface;

    const finishMatchingPointer = (event: PointerEvent) => {
      finishTexturePaintPendingOneShotTap(
        event.pointerId,
        event.clientX,
        event.clientY,
      );
      finishTexturePaint(event.pointerId);
      finishTexturePaintSurface(event.pointerId);
    };
    const cancelMatchingPointer = (event: PointerEvent) => {
      cancelTexturePaintPendingOneShotTap(event.pointerId);
      cancelTexturePaint(event.pointerId);
      cancelTexturePaintSurface("pointer-cancel", event.pointerId);
    };
    const cancelLostPointerCapture = (event: PointerEvent) => {
      cancelTexturePaintPendingOneShotTap(event.pointerId);
      cancelTexturePaint(event.pointerId);
      cancelTexturePaintSurface("lost-capture", event.pointerId);
    };
    const cancelPointerLeave = (event: PointerEvent) => {
      cancelTexturePaintSurface("pointer-leave", event.pointerId);
    };
    const cancelPendingTapOnMove = (event: PointerEvent) => {
      const pending = texturePaintPendingOneShotTapRef.current;
      if (
        pending
        && pending.pointerId === event.pointerId
        && studioVrmTexturePaintOneShotTapMoved(pending, event.clientX, event.clientY)
      ) {
        cancelTexturePaintPendingOneShotTap(event.pointerId);
      }
    };
    const cancelPendingTapOnAdditionalPointer = (event: PointerEvent) => {
      const pending = texturePaintPendingOneShotTapRef.current;
      if (pending && pending.pointerId !== event.pointerId) {
        cancelTexturePaintPendingOneShotTap();
      }
      const surfacePointerId = texturePaintSurfacePointerIdRef.current;
      if (surfacePointerId !== null && surfacePointerId !== event.pointerId) {
        cancelTexturePaintSurface("pointer-cancel", surfacePointerId);
      }
    };
    const cancelOnWindowBlur = () => {
      cancelTexturePaintPendingOneShotTap();
      cancelTexturePaint();
      cancelTexturePaintSurface("window-blur");
    };
    const cancelOnGraphicsDeviceFailure = () => {
      cancelTexturePaintPendingOneShotTap();
      cancelTexturePaint();
      cancelTexturePaintSurface("device-failure");
    };
    window.addEventListener("pointermove", cancelPendingTapOnMove, { passive: true });
    window.addEventListener("pointerup", finishMatchingPointer, { passive: true });
    window.addEventListener("pointercancel", cancelMatchingPointer, { passive: true });
    window.addEventListener("blur", cancelOnWindowBlur);
    gl.domElement.addEventListener(
      "pointerdown",
      cancelPendingTapOnAdditionalPointer,
      true,
    );
    gl.domElement.addEventListener("lostpointercapture", cancelLostPointerCapture);
    gl.domElement.addEventListener("pointerleave", cancelPointerLeave);
    gl.domElement.addEventListener("webglcontextlost", cancelOnGraphicsDeviceFailure);
    return () => {
      window.removeEventListener("pointermove", cancelPendingTapOnMove);
      window.removeEventListener("pointerup", finishMatchingPointer);
      window.removeEventListener("pointercancel", cancelMatchingPointer);
      window.removeEventListener("blur", cancelOnWindowBlur);
      gl.domElement.removeEventListener(
        "pointerdown",
        cancelPendingTapOnAdditionalPointer,
        true,
      );
      gl.domElement.removeEventListener("lostpointercapture", cancelLostPointerCapture);
      gl.domElement.removeEventListener("pointerleave", cancelPointerLeave);
      gl.domElement.removeEventListener("webglcontextlost", cancelOnGraphicsDeviceFailure);
      cancelTexturePaintPendingOneShotTap();
      cancelTexturePaint();
      cancelTexturePaintSurface("unmount");
      if (finishTexturePaintRef.current === finishTexturePaint) {
        finishTexturePaintRef.current = () => undefined;
      }
      if (cancelTexturePaintRef.current === cancelTexturePaint) {
        cancelTexturePaintRef.current = () => undefined;
      }
      if (finishTexturePaintSurfaceRef.current === finishTexturePaintSurface) {
        finishTexturePaintSurfaceRef.current = () => undefined;
      }
      if (cancelTexturePaintSurfaceRef.current === cancelTexturePaintSurface) {
        cancelTexturePaintSurfaceRef.current = () => undefined;
      }
    };
  }, [
    cancelTexturePaintPendingOneShotTap,
    finishTexturePaintPendingOneShotTap,
    gl,
    invalidate,
    texturePaintSurfaceTool,
  ]);

  useEffect(() => {
    cancelTexturePaintPendingOneShotTap();
    if (texturePaintSettings.tool !== "surface-brush") {
      cancelTexturePaintSurfaceRef.current("tool-change");
    }
  }, [
    cancelTexturePaintPendingOneShotTap,
    texturePaintEyedropperActive,
    texturePaintRuntime,
    texturePaintSettings.tool,
  ]);

  useEffect(() => {
    if (texturePaintEnabled) return;
    cancelTexturePaintPendingOneShotTap();
    cancelTexturePaintRef.current();
    cancelTexturePaintSurfaceRef.current("disabled");
    texturePaintOneShotGenerationRef.current += 1;
    texturePaintOneShotAbortRef.current?.abort();
    texturePaintOneShotAbortRef.current = null;
    texturePaintOneShotBusyRef.current = false;
  }, [cancelTexturePaintPendingOneShotTap, texturePaintEnabled]);

  useEffect(() => {
    applyPoserVisualState(vrm, {
      bones: customBones,
      yOffset: customYOffset,
      poseTranslations,
      fingerEdits,
      bodyScale,
    });
    applyExpressionWeightsToVrm(vrm, expressionWeights);
  }, [customBones, customYOffset, poseTranslations, expressionWeights, fingerEdits, bodyScale, rigRevision, vrm, webcamActive, idleAnimation]);

  useEffect(() => {
    applyRotationToVrm(vrm, bodyRotation);
  }, [bodyRotation, vrm]);

  useEffect(() => {
    applyVrmCustomColors(vrm, customColors);
    invalidate();
    // Re-run the repair after paint/material races settle on the next frame.
    const raf = requestAnimationFrame(() => {
      repairVrmTexturedNearBlackLitFactors(vrm);
      invalidate();
    });
    return () => cancelAnimationFrame(raf);
  }, [customColors, invalidate, vrm]);

  useEffect(() => {
    applyVrmMaterialFx(vrm, materialFx);
    invalidate();
  }, [materialFx, invalidate, vrm]);

  // 팔/다리 본 시간축 스무딩(프레임 간 상태 유지). 웹캠 토글마다 리셋해 stale 보간 방지.
  const boneSmootherRef = useRef<VrmBoneSmoother>(new VrmBoneSmoother());
  // head/neck 전용 스무더 — 시선이 머무는 비주얼 채널이라 지터 억제를 우선한 프리셋.
  const headSmootherRef = useRef<VrmBoneSmoother>(new VrmBoneSmoother(HEAD_BONE_SMOOTHER));
  useEffect(() => {
    const smoother = boneSmootherRef.current;
    const headSmoother = headSmootherRef.current;
    return () => {
      smoother.reset();
      headSmoother.reset();
    };
  }, [webcamActive]);

  useFrame((state, delta) => {
    const dVal = delta as number;
    const humanoid = vrm.humanoid;
    const expressionManager = vrm.expressionManager;

    if (webcamActive && trackingDataRef.current) {
      const data = trackingDataRef.current;
      if (humanoid) {
        const smoother = boneSmootherRef.current;
        const present = new Set<string>();
        Object.entries(data.bones).forEach(([boneName, rot]) => {
          const bone = humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
          if (!bone) return;
          // 팔/다리/발/손은 quaternion 슬러프로 스무딩(떨림 제거).
          // head/neck 은 One-Euro 채널 필터 위에 본 레벨 스무딩을 한 겹 더 —
          // 시선이 머무는 채널이라 잔여 지터까지 흡수한다.
          if (LIMB_BONE_RE.test(boneName)) {
            present.add(boneName);
            bone.quaternion.copy(smoother.smooth(boneName, rot, dVal));
          } else if (boneName === "head" || boneName === "neck") {
            bone.quaternion.copy(headSmootherRef.current.smooth(boneName, rot, dVal));
          } else {
            bone.rotation.set(rot[0], rot[1], rot[2]);
          }
        });
        // 추적이 끊긴 팔다리 본은 얼어붙지 않고 사용자 포즈(customBones, 기본 항등)로 부드럽게 복귀.
        for (const boneName of CANONICAL_LIMB_BONES) {
          if (present.has(boneName)) continue;
          const bone = humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
          if (!bone) continue;
          const rest = customBones[boneName]?.rotation ?? ZERO_EULER;
          const faded = smoother.fadeToward(boneName, rest, dVal, LIMB_FADE_HALF_LIFE);
          if (faded) bone.quaternion.copy(faded);
        }

        // 손가락 추적 결과 적용 — 팔다리와 같은 One-Euro quaternion 스무딩으로 떨림 제거.
        if (data.fingers) {
          for (const [boneName, rot] of Object.entries(data.fingers)) {
            const bone = humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
            if (bone) bone.quaternion.copy(smoother.smooth(boneName, rot, dVal));
          }
        }
      }

      if (expressionManager) {
        expressionManager.resetValues();
        // vrm.lookAt 이 있으면 시선은 lookAt 으로 직접 구동 — look* 표정과 이중 적용 방지.
        const useLookAt = !!vrm.lookAt && !!data.lookAt;
        Object.entries(data.expressions).forEach(([name, weight]) => {
          if (useLookAt && LOOK_EXPRESSION_NAMES.has(name)) return;
          if (expressionManager.getExpression(name)) {
            expressionManager.setValue(name, weight);
          }
        });
        expressionManager.update();
      }
      if (vrm.lookAt && data.lookAt) {
        applyLookAtToVrm(vrm, data.lookAt);
      }
    } else if (idleAnimation) {
      if (humanoid) {
        const time = state.clock.elapsedTime;
        // Breathing animation: chest and spine sine modulation
        const breath = Math.sin(time * 1.8) * 0.015;
        const breathSpine = Math.sin(time * 1.8 - 0.2) * 0.008;

        const chestBone = humanoid.getNormalizedBoneNode("chest");
        if (chestBone) {
          const baseRot = customBones.chest?.rotation || [0, 0, 0];
          chestBone.rotation.set(baseRot[0] + breath, baseRot[1], baseRot[2]);
        }
        const spineBone = humanoid.getNormalizedBoneNode("spine");
        if (spineBone) {
          const baseRot = customBones.spine?.rotation || [0, 0, 0];
          spineBone.rotation.set(baseRot[0] + breathSpine, baseRot[1], baseRot[2]);
        }

        // Auto-blink: 200ms blink duration every 4.5 seconds
        const cycle = time % 4.5;
        let blinkWeight = 0;
        if (cycle > 4.3) {
          const progress = (cycle - 4.3) / 0.2;
          blinkWeight = Math.sin(progress * Math.PI);
        }

        if (expressionManager) {
          expressionManager.resetValues();
          Object.entries(expressionWeights).forEach(([name, weight]) => {
            if (expressionManager.getExpression(name)) {
              expressionManager.setValue(name, weight);
            }
          });

          if (blinkWeight > 0) {
            expressionManager.setValue("blinkLeft", Math.max(blinkWeight, expressionWeights.blinkLeft || 0));
            expressionManager.setValue("blinkRight", Math.max(blinkWeight, expressionWeights.blinkRight || 0));
          }
          expressionManager.update();
        }
      }
    }

  }, VRM_FRAME_BASE_PRIORITY);

  const releaseFailedTexturePaintSurfacePointer = (pointerId: number) => {
    if (texturePaintSurfacePointerIdRef.current !== pointerId) return;
    texturePaintSurfacePointerIdRef.current = null;
    const captureTarget = texturePaintSurfaceCaptureTargetRef.current;
    texturePaintSurfaceCaptureTargetRef.current = null;
    if (!captureTarget) return;
    try {
      captureTarget.releasePointerCapture(pointerId);
    } catch {
      // A native pointerup/lostpointercapture may have won the race.
    }
  };

  const beginTexturePaint = (event: ThreeEvent<PointerEvent>) => {
    const existingPendingTap = texturePaintPendingOneShotTapRef.current;
    if (existingPendingTap) {
      if (existingPendingTap.pointerId !== event.pointerId) {
        cancelTexturePaintPendingOneShotTap();
      }
      return;
    }
    const runtime = texturePaintRuntimeRef.current;
    const hit = studioVrmTexturePaintHit(event);
    if (
      texturePaintMutationBlockedRef.current
      ||
      !texturePaintEnabledRef.current
      || !runtime
      || !hit
      || !event.isPrimary
      || event.button !== 0
      || texturePaintPointerIdRef.current !== null
      || texturePaintSurfacePointerIdRef.current !== null
      || ["collecting", "committing", "cancelling"].includes(
        texturePaintSurfaceTool.getSnapshot().status,
      )
      || texturePaintOneShotBusyRef.current
    ) {
      return;
    }

    event.stopPropagation();
    const settings = texturePaintSettingsRef.current;
    const explicitEyedropper = texturePaintEyedropperActiveRef.current;
    const oneShotKind =
      event.altKey || explicitEyedropper
        ? "sample"
        : settings.tool === "fill"
          ? "fill"
          : null;
    if (oneShotKind) {
      const captureTarget =
        event.currentTarget as unknown as StudioVrmTexturePaintPointerCaptureTarget;
      const pending: StudioVrmTexturePaintPendingOneShotTap = {
        kind: oneShotKind,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        hit,
        runtime,
        settings,
        explicitEyedropper,
        captureTarget: null,
      };
      texturePaintPendingOneShotTapRef.current = pending;
      try {
        captureTarget.setPointerCapture(event.pointerId);
        pending.captureTarget = captureTarget;
      } catch {
        // Window pointer listeners still finish/cancel the tap if capture is unavailable.
      }
      return;
    }
    if (isStudioVrmTexturePaintBrushProductBlocked(settings.tool)) return;
    if (settings.tool !== "surface-brush") return;

    runtime.clearError();
    const begin = texturePaintSurfaceTool.begin({
      runtime,
      settings: {
        color: settings.color,
        sizeCssPixels: settings.sizeTexels,
        opacity: settings.opacity,
        flow: settings.tuning.flow,
        hardness: settings.tuning.hardness,
        minSize: settings.tuning.minSize,
      },
      sample: studioVrmSurfacePaintPointerSample(
        event,
        "down",
        hit,
        camera,
        gl.domElement.getBoundingClientRect().height,
        texturePaintSurfaceCameraPointRef.current,
      ),
    });
    if (!begin.ok) return;

    texturePaintSurfacePointerIdRef.current = event.pointerId;
    const captureTarget =
      event.currentTarget as unknown as StudioVrmTexturePaintPointerCaptureTarget;
    texturePaintSurfaceCaptureTargetRef.current = captureTarget;
    try {
      captureTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window lifecycle listeners still finish or cancel an admitted stroke without capture.
      texturePaintSurfaceCaptureTargetRef.current = null;
    }
    invalidate();
  };

  const moveTexturePaint = (event: ThreeEvent<PointerEvent>) => {
    const pendingTap = texturePaintPendingOneShotTapRef.current;
    if (pendingTap?.pointerId === event.pointerId) {
      event.stopPropagation();
      if (studioVrmTexturePaintOneShotTapMoved(pendingTap, event.clientX, event.clientY)) {
        cancelTexturePaintPendingOneShotTap(event.pointerId);
      }
      return;
    }
    const surfacePointerId = texturePaintSurfacePointerIdRef.current;
    if (surfacePointerId !== null && event.pointerId === surfacePointerId) {
      event.stopPropagation();
      if (texturePaintMutationBlockedRef.current || !texturePaintEnabledRef.current) {
        cancelTexturePaintSurfaceRef.current("disabled", surfacePointerId);
        return;
      }
      const hit = studioVrmTexturePaintHit(event);
      if (!hit) return;
      const appended = texturePaintSurfaceTool.append(
        studioVrmSurfacePaintPointerSample(
          event,
          "move",
          hit,
          camera,
          gl.domElement.getBoundingClientRect().height,
          texturePaintSurfaceCameraPointRef.current,
        ),
      );
      if (!appended && texturePaintSurfaceTool.getSnapshot().status === "error") {
        releaseFailedTexturePaintSurfacePointer(surfacePointerId);
      }
      return;
    }
    const pointerId = texturePaintPointerIdRef.current;
    if (
      pointerId === null
      || event.pointerId !== pointerId
      || texturePaintMutationBlockedRef.current
      || !texturePaintEnabledRef.current
    ) {
      return;
    }
    const hit = studioVrmTexturePaintHit(event);
    if (!hit) return;
    event.stopPropagation();
    const result = texturePaintRuntimeRef.current?.moveStroke({
      pointerId,
      hit,
      pressure: studioVrmTexturePaintPressure(event),
    });
    if (result?.ok && result.value) invalidate();
  };

  const finishTexturePaint = (event: ThreeEvent<PointerEvent>) => {
    if (
      finishTexturePaintPendingOneShotTap(
        event.pointerId,
        event.clientX,
        event.clientY,
      )
    ) {
      event.stopPropagation();
      return;
    }
    if (texturePaintSurfacePointerIdRef.current === event.pointerId) {
      event.stopPropagation();
      const hit = studioVrmTexturePaintHit(event);
      if (hit) {
        texturePaintSurfaceTool.append(
          studioVrmSurfacePaintPointerSample(
            event,
            "up",
            hit,
            camera,
            gl.domElement.getBoundingClientRect().height,
            texturePaintSurfaceCameraPointRef.current,
          ),
        );
      }
      finishTexturePaintSurfaceRef.current(event.pointerId);
      return;
    }
    if (texturePaintPointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    finishTexturePaintRef.current(event.pointerId);
  };

  const cancelTexturePaint = (event: ThreeEvent<PointerEvent>) => {
    if (cancelTexturePaintPendingOneShotTap(event.pointerId)) {
      event.stopPropagation();
      return;
    }
    if (texturePaintSurfacePointerIdRef.current === event.pointerId) {
      event.stopPropagation();
      cancelTexturePaintSurfaceRef.current("pointer-cancel", event.pointerId);
      return;
    }
    if (texturePaintPointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    cancelTexturePaintRef.current(event.pointerId);
  };

  return (
    <primitive
      object={vrm.scene}
      onPointerDown={beginTexturePaint}
      onPointerMove={moveTexturePaint}
      onPointerUp={finishTexturePaint}
      onPointerCancel={cancelTexturePaint}
      onPointerLeave={(event: ThreeEvent<PointerEvent>) => {
        if (texturePaintSurfacePointerIdRef.current !== event.pointerId) return;
        event.stopPropagation();
        cancelTexturePaintSurfaceRef.current("pointer-leave", event.pointerId);
      }}
      onLostPointerCapture={cancelTexturePaint}
    />
  );
}
