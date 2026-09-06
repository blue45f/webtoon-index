import { useCallback, useEffect, useRef } from "react";

import { evaluateWebtoonShotEasing } from "../scene-3d/studio-3d-camera-cinematic-director";

import {
  createStudioBg3dCameraUpForDutchRoll,
  readStudioBg3dCameraDutchRollDegrees,
} from "./studio-bg3d-camera-orientation";
import { useStudioBg3dProSuiteRuntime } from "./studio-bg3d-pro-suite-runtime-context";
import { StudioBg3dCinematicDirectorPanel as StudioBg3dCinematicDirectorPanelContent } from "./StudioBg3dCinematicDirectorPanelContent";
import {
  StudioBg3dProductionIntentPanel,
  StudioBg3dProductionWorkflowPanel,
} from "./StudioBg3dProductionWorkflowBoundary";

import type { StudioBg3dCameraSettings } from "./studio-bg3d-scene-document";
import type { StudioBg3dCinematicDirectorPanelProps } from "./StudioBg3dCinematicDirectorPanelContent";
import type { WebtoonShotBookmark } from "../scene-3d/studio-3d-camera-cinematic-director";

export type { StudioBg3dCinematicDirectorPanelProps } from "./StudioBg3dCinematicDirectorPanelContent";

const CAMERA_PREVIEW_FRAME_INTERVAL_MS = 1_000 / 30;

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function cameraFromBookmark(
  baseCamera: StudioBg3dCameraSettings,
  bookmark: WebtoonShotBookmark,
): StudioBg3dCameraSettings {
  const target = [
    baseCamera.target[0],
    baseCamera.target[1],
    baseCamera.target[2],
  ] as const;
  const position = [
    target[0] + bookmark.position[0] - bookmark.target[0],
    target[1] + bookmark.position[1] - bookmark.target[1],
    target[2] + bookmark.position[2] - bookmark.target[2],
  ] as const;
  const up = createStudioBg3dCameraUpForDutchRoll(
    { position, target },
    bookmark.dutchRollDegrees,
  ) ?? [0, 1, 0] as const;

  return {
    ...baseCamera,
    position,
    target,
    fovDegrees: bookmark.fov,
    projection: "perspective",
    zoom: 1,
    lensShift: [0, 0],
    up,
  };
}

function interpolateCamera(
  from: StudioBg3dCameraSettings,
  to: StudioBg3dCameraSettings,
  bookmark: WebtoonShotBookmark,
  rawProgress: number,
): StudioBg3dCameraSettings {
  const progress = evaluateWebtoonShotEasing(bookmark.easing, rawProgress);
  const position = [
    lerp(from.position[0], to.position[0], progress),
    lerp(from.position[1], to.position[1], progress),
    lerp(from.position[2], to.position[2], progress),
  ] as const;
  const target = [
    lerp(from.target[0], to.target[0], progress),
    lerp(from.target[1], to.target[1], progress),
    lerp(from.target[2], to.target[2], progress),
  ] as const;
  const fromRoll = readStudioBg3dCameraDutchRollDegrees(from);
  const rollDelta = normalizeDegrees(bookmark.dutchRollDegrees - fromRoll);
  const roll = normalizeDegrees(fromRoll + rollDelta * progress);
  const up = createStudioBg3dCameraUpForDutchRoll({ position, target }, roll) ?? to.up;
  const fromLensShift = from.lensShift ?? [0, 0];
  const toLensShift = to.lensShift ?? [0, 0];

  return {
    ...from,
    position,
    target,
    fovDegrees: lerp(from.fovDegrees, to.fovDegrees, progress),
    projection: "perspective",
    zoom: lerp(from.zoom ?? 1, to.zoom ?? 1, progress),
    lensShift: [
      lerp(fromLensShift[0], toLensShift[0], progress),
      lerp(fromLensShift[1], toLensShift[1], progress),
    ],
    ...(up ? { up } : {}),
  };
}

function prefersReducedCameraMotion(): boolean {
  return typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Resolves production scene commands from the nearest 3D editor shell while preserving direct prop
 * injection for tests and standalone rehearsals. Explicit props always win over context values.
 */
export function StudioBg3dCinematicDirectorPanel(
  props: StudioBg3dCinematicDirectorPanelProps,
) {
  const runtime = useStudioBg3dProSuiteRuntime();
  const animationFrameRef = useRef<number | null>(null);
  const transitionActiveRef = useRef(false);
  const finishCameraPreviewRef = useRef<(() => void) | undefined>(undefined);
  const {
    disabled,
    baseCamera,
    productionShots,
    onCaptureCurrentShot,
    onApplyProductionShot,
    onMoveProductionShot,
    onRemoveProductionShot,
    onApplyShotBookmark,
    onUseCurrentFrameAsAiReference,
    aiReferenceBusy,
    ...rest
  } = props;
  const resolvedDisabled = disabled ?? runtime?.disabled ?? false;
  const resolvedBaseCamera = baseCamera ?? runtime?.baseCamera;
  const resolvedShots = productionShots ?? runtime?.productionShots;
  const resolvedCapture = onCaptureCurrentShot ?? runtime?.onCaptureCurrentShot;
  const resolvedApply = onApplyProductionShot ?? runtime?.onApplyProductionShot;
  const resolvedMove = onMoveProductionShot ?? runtime?.onMoveProductionShot;
  const resolvedRemove = onRemoveProductionShot ?? runtime?.onRemoveProductionShot;
  const runtimeApplyCameraView = runtime?.onApplyCameraView;
  const runtimePreviewCameraView = runtime?.onPreviewCameraView;
  const runtimeFinishCameraPreview = runtime?.onFinishCameraViewPreview;
  finishCameraPreviewRef.current = runtimeFinishCameraPreview;

  const cancelPreviewAnimation = useCallback((finish: boolean) => {
    if (
      animationFrameRef.current !== null &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = null;
    if (finish && transitionActiveRef.current) finishCameraPreviewRef.current?.();
    transitionActiveRef.current = false;
  }, []);

  useEffect(() => () => cancelPreviewAnimation(false), [cancelPreviewAnimation]);

  useEffect(() => {
    if (resolvedDisabled) cancelPreviewAnimation(true);
  }, [cancelPreviewAnimation, resolvedDisabled]);

  const applyRuntimeBookmark = useCallback((bookmark: WebtoonShotBookmark) => {
    if (!runtimeApplyCameraView || !resolvedBaseCamera) return;
    const targetCamera = cameraFromBookmark(resolvedBaseCamera, bookmark);
    const durationMs = Math.max(0, Math.min(8_000, bookmark.transitionSeconds * 1_000));
    const canAnimate =
      durationMs >= CAMERA_PREVIEW_FRAME_INTERVAL_MS &&
      resolvedBaseCamera.projection !== "orthographic" &&
      !prefersReducedCameraMotion() &&
      typeof globalThis.requestAnimationFrame === "function" &&
      runtimePreviewCameraView !== undefined &&
      runtimeFinishCameraPreview !== undefined;

    cancelPreviewAnimation(true);
    if (!canAnimate) {
      runtimeApplyCameraView(targetCamera);
      return;
    }

    const fromCamera = resolvedBaseCamera;
    let startedAt: number | null = null;
    let lastPreviewAt = Number.NEGATIVE_INFINITY;
    transitionActiveRef.current = true;

    const animate = (timestamp: number) => {
      startedAt ??= timestamp;
      const rawProgress = Math.max(0, Math.min(1, (timestamp - startedAt) / durationMs));
      const shouldPreview =
        rawProgress >= 1 || timestamp - lastPreviewAt >= CAMERA_PREVIEW_FRAME_INTERVAL_MS;
      if (shouldPreview) {
        runtimePreviewCameraView(
          rawProgress >= 1
            ? targetCamera
            : interpolateCamera(fromCamera, targetCamera, bookmark, rawProgress),
        );
        lastPreviewAt = timestamp;
      }
      if (rawProgress >= 1) {
        animationFrameRef.current = null;
        transitionActiveRef.current = false;
        finishCameraPreviewRef.current?.();
        return;
      }
      animationFrameRef.current = globalThis.requestAnimationFrame(animate);
    };

    animationFrameRef.current = globalThis.requestAnimationFrame(animate);
  }, [
    cancelPreviewAnimation,
    resolvedBaseCamera,
    runtimeApplyCameraView,
    runtimeFinishCameraPreview,
    runtimePreviewCameraView,
  ]);
  const resolvedBookmark = onApplyShotBookmark ?? (
    runtimeApplyCameraView && resolvedBaseCamera ? applyRuntimeBookmark : undefined
  );
  const aiReferenceBlocked = runtime?.aiReferenceDisabled ?? false;
  const resolvedAiReference = aiReferenceBlocked
    ? undefined
    : onUseCurrentFrameAsAiReference ?? runtime?.onUseCurrentFrameAsAiReference;

  return (
    <>
      <StudioBg3dProductionIntentPanel />
      <StudioBg3dProductionWorkflowPanel variant="director" />
      <StudioBg3dCinematicDirectorPanelContent
        {...rest}
        disabled={resolvedDisabled}
        aiReferenceBusy={aiReferenceBusy ?? runtime?.aiReferenceBusy ?? false}
        {...(resolvedBaseCamera ? { baseCamera: resolvedBaseCamera } : {})}
        {...(resolvedShots ? { productionShots: resolvedShots } : {})}
        {...(resolvedCapture ? { onCaptureCurrentShot: resolvedCapture } : {})}
        {...(resolvedApply ? { onApplyProductionShot: resolvedApply } : {})}
        {...(resolvedMove ? { onMoveProductionShot: resolvedMove } : {})}
        {...(resolvedRemove ? { onRemoveProductionShot: resolvedRemove } : {})}
        {...(resolvedBookmark ? { onApplyShotBookmark: resolvedBookmark } : {})}
        {...(resolvedAiReference
          ? { onUseCurrentFrameAsAiReference: resolvedAiReference }
          : {})}
      />
    </>
  );
}
