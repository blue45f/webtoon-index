import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import {
  createStudioBg3dEditableThreeClone,
  sampleStudioBg3dAnimationActionAtTime,
  type BgCustomModelInstance,
  type StudioBg3dEditableThreeClone,
} from "../studio-background-3d-model";

import { resolveStudioBg3dAnimationSchedule } from "./studio-bg3d-animation-scheduler";
import {
  isStudioBg3dAnimationOnceComplete,
  resolveStudioBg3dAnimationTime,
} from "./studio-bg3d-animation-time";
import {
  applyStudioBg3dProjectionAwareZoom,
  applyStudioBg3dViewToThreeCamera,
  type BgViewportApi,
} from "./studio-bg3d-camera-application";
import {
  STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
  createStudioBg3dCameraUpForDutchRoll,
  resolveStudioBg3dCameraNearClip,
  resolveStudioBg3dCameraUpVector,
} from "./studio-bg3d-camera-orientation";
import { registerStudioBg3dCaptureExcludedObject } from "./studio-bg3d-capture-exclusion";
import { CAMERA_PRESETS, DEFAULT_CAMERA_TARGET } from "./studio-bg3d-editor-derivations";
import {
  advanceStudioBg3dFrameQuality,
  createStudioBg3dFrameQualityState,
  STUDIO_BG3D_FRAME_QUALITY_WARMUP_SAMPLES,
} from "./studio-bg3d-frame-quality-governor";
import { projectStudioBg3dLodDiameterCssPx } from "./studio-bg3d-lod-selection";
import { isBgObjectVisible } from "./studio-bg3d-object-ops";
import {
  StudioBg3dPrimitiveGeometryPool,
  synchronizeStudioBg3dRootMatrix,
} from "./studio-bg3d-render-optimization";
import { buildStudioBg3dScaleGuideParts } from "./studio-bg3d-scale-guide";
import {
  computeStudioBg3dSectionPlane,
  type StudioBg3dSectionPlaneState,
} from "./studio-bg3d-section-plane";
import {
  resolveStudioBg3dSurfaceMaterialProps,
  spreadStudioBg3dSurfaceMaterialProps,
} from "./studio-bg3d-surface-presets";
import {
  createStudioBg3dThreeStaticInstanceBatch,
  type StudioBg3dThreeInstancingSuccess,
} from "./studio-bg3d-three-instancing";
import { applyStudioBg3dThreeRenderSettings } from "./studio-bg3d-three-render-settings";

import type { BgPrimitive } from "../studio-background-3d-primitives";
import type { StudioBg3dPlacementPreviewState } from "./studio-bg3d-placement-session";
import type { StudioBg3dRigPoseBakeSnapshot } from "./studio-bg3d-rig-pose-bake";
import type {
  StudioBg3dAnimationPlayback,
  StudioBg3dCameraSettings,
  StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

/** Imported model metadata the placement preview ghost renders before the instance exists. */
export interface StudioBg3dPlacementPreviewAsset {
  readonly modelId: string;
  readonly name: string;
  /** Bounds after import normalization and auto-fit, before instance transform. */
  readonly size: readonly [number, number, number];
  /** Bottom-center insertion point in the cached model root's local/world-at-identity space. */
  readonly localInsertionPoint: readonly [number, number, number];
}

/** Keeps persisted exposure/tone-mapping authoritative after R3F creates or reuses WebGLRenderer. */
/**
 * Re-projects the document's colour/tone contract whenever it changes, for whichever Three
 * renderer the engine-selection policy put in charge of this canvas.
 */
export function StudioBg3dThreeRenderSettingsController({
  render,
}: {
  readonly render: StudioBg3dSceneDocument["render"];
}) {
  const gl = useThree((state) => state.gl);
  useLayoutEffect(() => {
    applyStudioBg3dThreeRenderSettings(gl, render);
  }, [gl, render]);
  return null;
}

/* 장면 배경이 없는 흰색 모드와 절차적 파노라마 생성 전 프레임의 안전한 clear color를 적용한다. */
export function SkyClearColorController({
  clearColor,
  alpha = 1,
}: {
  clearColor: string;
  alpha?: number;
}) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.setClearColor(clearColor, alpha);
  }, [alpha, gl, clearColor]);
  return null;
}

type OrbitLike = { target?: THREE.Vector3; update?: () => void } | null;

/* Owns imperative camera/control updates so rerenders never reset the user's Orbit target. */
export function BgViewportController({ onReady }: { onReady: (api: BgViewportApi | null) => void }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitLike;
  const viewportSize = useThree((s) => s.size);

  useEffect(() => {
    if (controls?.target) {
      controls.target.set(DEFAULT_CAMERA_TARGET[0], DEFAULT_CAMERA_TARGET[1], DEFAULT_CAMERA_TARGET[2]);
      controls.update?.();
    }
  }, [controls]);

  useEffect(() => {
    const readView = (): StudioBg3dCameraSettings => {
      const target = controls?.target ?? new THREE.Vector3(...DEFAULT_CAMERA_TARGET);
      const fovDegrees = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
      const position = camera.position.toArray() as [number, number, number];
      const targetTuple = target.toArray() as [number, number, number];
      const up = resolveStudioBg3dCameraUpVector({
        position,
        target: targetTuple,
        up: camera.up.toArray() as [number, number, number],
      });
      const lensShift = camera.view?.enabled && camera.view.fullWidth > 0 && camera.view.fullHeight > 0
        ? [
            camera.view.offsetX / camera.view.fullWidth,
            camera.view.offsetY / camera.view.fullHeight,
          ] as const
        : null;
      return {
        position,
        target: targetTuple,
        fovDegrees,
        projection: camera instanceof THREE.OrthographicCamera ? "orthographic" : "perspective",
        zoom: camera.zoom,
        nearClip: resolveStudioBg3dCameraNearClip(camera.near),
        up,
        ...(lensShift ? { lensShift } : {}),
      };
    };
    onReady({
      zoomBy: (factor) => applyStudioBg3dProjectionAwareZoom(
        camera,
        controls,
        factor,
        DEFAULT_CAMERA_TARGET,
      ),
      applyPreset: (presetId) => {
        const preset = CAMERA_PRESETS[presetId];
        if (!preset) return false;
        const currentView = readView();
        const up = createStudioBg3dCameraUpForDutchRoll({
          position: preset.position,
          target: preset.target,
        }, 0);
        if (!up) return false;
        return applyStudioBg3dViewToThreeCamera(camera, controls, {
          ...currentView,
          position: preset.position,
          target: preset.target,
          up,
          ...(presetId === "default"
            ? { nearClip: STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP }
            : {}),
        });
      },
      applyView: (view) => applyStudioBg3dViewToThreeCamera(camera, controls, view),
      readView,
      readFramingState: () => {
        const viewportAspect = viewportSize.width / viewportSize.height;
        if (!Number.isFinite(viewportAspect) || viewportAspect <= 0) return null;
        const view = readView();
        if (!(camera instanceof THREE.OrthographicCamera)) {
          return { view, viewportAspect };
        }
        const width = Math.abs(camera.right - camera.left);
        const height = Math.abs(camera.top - camera.bottom);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          return null;
        }
        return {
          view,
          viewportAspect,
          orthographicFrustumAtZoomOne: { width, height },
        };
      },
      focusOn: (position: [number, number, number]) => {
        const newTarget = new THREE.Vector3(...position);
        if (controls?.target) {
          const offset = camera.position.clone().sub(controls.target);
          controls.target.copy(newTarget);
          camera.position.copy(newTarget).add(offset);
          camera.updateMatrixWorld();
          controls.update?.();
        } else {
          camera.lookAt(newTarget);
        }
      },
    });
    return () => onReady(null);
  }, [camera, controls, onReady, viewportSize.height, viewportSize.width]);

  return null;
}

/* 뷰포트 공간감을 위한 그리드+바닥 원반. 씬 데이터(primitives)에는 절대 포함되지 않고
   내보내기(라인아트 캡처) 시에는 항상 숨긴다 — 참조용 뷰포트 보조물일 뿐 결과물이 아니다. */
export function BgGroundHelper({ visible }: { visible: boolean }) {
  return (
    <group
      ref={registerStudioBg3dCaptureExcludedObject}
      userData={{ studioBg3dGroundSurfaceId: "stage-plane" }}
      visible={visible}
    >
      <gridHelper args={[40, 40, "#c7ccd6", "#e7e9ee"]} position={[0, -0.001, 0]} />
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[0, -0.002, 0]}>
        <circleGeometry args={[9, 40]} />
        <meshStandardMaterial
          color="#eef1f5"
          metalness={0}
          opacity={0.76}
          roughness={0.94}
          transparent
        />
      </mesh>
    </group>
  );
}

/** 태양 릭 시간 슬라이더 표기(24h "HH:MM"). 0.25h 스텝 외 임의 소수도 안전하게 반올림한다. */

/* Applies the pure section equation to renderer clipping state and clears it on teardown. */
function applyBg3dSectionClippingPlanes(
  gl: THREE.WebGLRenderer,
  state: StudioBg3dSectionPlaneState,
): void {
  const equation = computeStudioBg3dSectionPlane(state);
  gl.clippingPlanes = equation
    ? [
        new THREE.Plane(
          new THREE.Vector3(equation.normal[0], equation.normal[1], equation.normal[2]),
          equation.constant,
        ),
      ]
    : [];
}

function clearBg3dSectionClippingPlanes(gl: THREE.WebGLRenderer): void {
  gl.clippingPlanes = [];
}

export function BgSectionPlaneController({ state }: { state: StudioBg3dSectionPlaneState }) {
  const gl = useThree((s) => s.gl);
  const { enabled, axis, offset, flip } = state;
  useEffect(() => {
    applyBg3dSectionClippingPlanes(gl, { enabled, axis, offset, flip });
    return () => clearBg3dSectionClippingPlanes(gl);
  }, [gl, enabled, axis, offset, flip]);
  return null;
}

/* 160cm non-captured, non-raycast scale guide for judging scene proportions. */
const BG_SCALE_GUIDE_PARTS = buildStudioBg3dScaleGuideParts();

export function BgScaleGuide({ visible }: { visible: boolean }) {
  return (
    <group ref={registerStudioBg3dCaptureExcludedObject} visible={visible} position={[0, 0, 0]}>
      {BG_SCALE_GUIDE_PARTS.map((part) => (
        <mesh
          key={part.name}
          raycast={() => null}
          position={[part.position[0], part.position[1], part.position[2]]}
          scale={[part.scale[0], part.scale[1], part.scale[2]]}
        >
          {part.shape === "sphere" ? (
            <sphereGeometry args={[0.5, 16, 12]} />
          ) : (
            <boxGeometry args={[1, 1, 1]} />
          )}
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.45} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function BgPlacementPreview({
  asset,
  preview,
}: {
  asset: StudioBg3dPlacementPreviewAsset;
  preview: StudioBg3dPlacementPreviewState;
}) {
  const safeSize = asset.size.map((value) => (
    Number.isFinite(value) ? Math.max(0.08, Math.abs(value)) : 0.08
  )) as [number, number, number];
  const halfHeight = safeSize[1] / 2;
  const { worldNormal, worldPosition, yawDegrees } = preview.placement;
  const normal = new THREE.Vector3(...worldNormal).normalize();
  const orientation = new THREE.Quaternion()
    .setFromAxisAngle(normal, THREE.MathUtils.degToRad(-yawDegrees))
    .multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
  const center: [number, number, number] = [
    worldPosition[0] + worldNormal[0] * halfHeight,
    worldPosition[1] + worldNormal[1] * halfHeight,
    worldPosition[2] + worldNormal[2] * halfHeight,
  ];

  return (
    <group
      ref={registerStudioBg3dCaptureExcludedObject}
      position={center}
      quaternion={orientation}
    >
      <mesh raycast={() => null} renderOrder={20}>
        <boxGeometry args={safeSize} />
        <meshBasicMaterial
          color={0xf97316}
          depthWrite={false}
          opacity={0.16}
          transparent
        />
      </mesh>
      <mesh raycast={() => null} renderOrder={21}>
        <boxGeometry args={safeSize} />
        <meshBasicMaterial
          color={0xc2410c}
          depthWrite={false}
          opacity={0.92}
          transparent
          wireframe
        />
      </mesh>
    </group>
  );
}

/** Reporting cadence for the engine panel's frame-time readout. */
const FRAME_TIME_REPORT_INTERVAL_MS = 500;

export function BgAdaptiveDprController({
  targetFps,
  paused,
  onScaleChange,
  onFrameTimeChange,
}: {
  targetFps: number;
  paused: boolean;
  onScaleChange: (scale: number) => void;
  /**
   * Smoothed frame time for the engine status surface, or null while it would be misleading —
   * before warm-up and whenever the governor is paused for capture or an immersive session. The
   * governor already computes this, so no second per-frame subscriber is added for it.
   */
  onFrameTimeChange?: (frameTimeMs: number | null) => void;
}) {
  const governorRef = useRef(createStudioBg3dFrameQualityState(targetFps));
  const scaleChangeRef = useRef(onScaleChange);
  const frameTimeChangeRef = useRef(onFrameTimeChange);
  const lastReportRef = useRef({ atMs: 0, value: null as number | null });
  useEffect(() => {
    scaleChangeRef.current = onScaleChange;
  }, [onScaleChange]);
  useEffect(() => {
    frameTimeChangeRef.current = onFrameTimeChange;
  }, [onFrameTimeChange]);
  useEffect(() => {
    governorRef.current = createStudioBg3dFrameQualityState(targetFps);
    scaleChangeRef.current(1);
  }, [targetFps]);
  useFrame((state, deltaSeconds) => {
    // Demand-frame gaps measure artist input cadence, not GPU throughput.
    const effectivePaused = paused || state.frameloop !== "always";
    const previous = governorRef.current;
    const next = advanceStudioBg3dFrameQuality(previous, {
      deltaSeconds,
      targetFps,
      paused: effectivePaused,
    });
    governorRef.current = next;
    if (next.dprScale !== previous.dprScale) scaleChangeRef.current(next.dprScale);

    const report = frameTimeChangeRef.current;
    if (!report) return;
    const nowMs = state.clock.elapsedTime * 1_000;
    const last = lastReportRef.current;
    if (nowMs - last.atMs < FRAME_TIME_REPORT_INTERVAL_MS) return;
    const value = effectivePaused || next.acceptedSamples < STUDIO_BG3D_FRAME_QUALITY_WARMUP_SAMPLES
      ? null
      : Math.round(next.smoothedFrameMs * 10) / 10;
    lastReportRef.current = { atMs: nowMs, value };
    if (value !== last.value) report(value);
  });
  return null;
}

interface BgPrimitiveMeshProps {
  prim: BgPrimitive;
  geometryPool: StudioBg3dPrimitiveGeometryPool;
  lineArt: boolean;
  showEdges: boolean;
  selected: boolean;
  onSelect: (id: string, isMulti: boolean) => void;
  onSurfacePick: (id: string, event: ThreeEvent<MouseEvent>) => boolean;
  onSurfacePreview?: (event: ThreeEvent<PointerEvent>) => void;
  registerRef: (id: string, obj: THREE.Group | null) => void;
  children?: React.ReactNode;
}

/* Keeps the fill mesh visible in line-art mode for hidden-line depth and raycast selection. */
export function BgPrimitiveMesh({ prim, geometryPool, lineArt, showEdges, selected, onSelect, onSurfacePick, onSurfacePreview, registerRef, children }: BgPrimitiveMeshProps) {
  const { geometry, edges } = geometryPool.get(prim.kind);
  const groupRef = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (groupRef.current) synchronizeStudioBg3dRootMatrix(groupRef.current, selected);
  }, [prim.position, prim.rotation, prim.scale, selected]);
  useEffect(() => {
    registerRef(prim.id, groupRef.current);
    return () => registerRef(prim.id, null);
  }, [prim.id, registerRef]);

  const visible = isBgObjectVisible(prim);

  return (
    <group
      ref={groupRef}
      position={prim.position}
      rotation={prim.rotation}
      scale={prim.scale}
      userData={{ studioBg3dEntityId: prim.id, studioBg3dEntityKind: "primitive" }}
      visible={visible}
      onClick={(e) => {
        e.stopPropagation();
        if (onSurfacePick(prim.id, e)) return;
        onSelect(prim.id, e.shiftKey || e.metaKey || e.ctrlKey);
      }}
      onPointerMove={onSurfacePreview}
    >
      <mesh geometry={geometry} castShadow receiveShadow>
        {lineArt ? (
          <meshBasicMaterial color="#ffffff" polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
        ) : (
          <meshStandardMaterial
            color={prim.color}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            {...spreadStudioBg3dSurfaceMaterialProps(resolveStudioBg3dSurfaceMaterialProps(prim.materialOverride))}
            side={prim.materialOverride?.doubleSided ? THREE.DoubleSide : THREE.FrontSide}
          />
        )}
      </mesh>
      {showEdges ? (
        <lineSegments ref={registerStudioBg3dCaptureExcludedObject} geometry={edges}>
          <lineBasicMaterial color="#000000" />
        </lineSegments>
      ) : null}
      {children}
    </group>
  );
}

interface BgCustomModelMeshProps {
  instance: BgCustomModelInstance;
  cachedRoot: THREE.Object3D | undefined;
  animations: readonly THREE.AnimationClip[];
  selected: boolean;
  capturing: boolean;
  targetFps: number;
  lodBias: number;
  onSelect: (id: string, isMulti: boolean) => void;
  onSurfacePick: (id: string, event: ThreeEvent<MouseEvent>) => boolean;
  onSurfacePreview?: (event: ThreeEvent<PointerEvent>) => void;
  registerRef: (id: string, obj: THREE.Group | null) => void;
  registerAnimationTime: (id: string, reader: (() => number) | null) => void;
  registerRigBake: (id: string, reader: StudioBg3dRigBakeReader | null) => void;
  onAnimationComplete: (id: string, timeSeconds: number) => void;
  onCloneStatus: (
    ids: readonly string[],
    status: "pending" | "ready" | "failed",
  ) => void;
  children?: React.ReactNode;
}

export type StudioBg3dRigBakeReader = () => StudioBg3dRigPoseBakeSnapshot | null;

function studioBg3dMatricesDiffer(
  left: THREE.Matrix4 | null,
  right: THREE.Matrix4,
  epsilon = 1e-10,
): boolean {
  if (!left) return true;
  return left.elements.some((value, index) =>
    Math.abs(value - (right.elements[index] ?? Number.NaN)) > epsilon
  );
}

export function BgCustomModelMesh({ instance, cachedRoot, animations, selected, capturing, targetFps, lodBias, onSelect, onSurfacePick, onSurfacePreview, registerRef, registerAnimationTime, registerRigBake, onAnimationComplete, onCloneStatus, children }: BgCustomModelMeshProps) {
  // Geometry/textures stay cache-owned, while each render instance owns cloned materials so its
  // adjustments cannot leak into sibling placements or the verified source cache.
  const [editableClone, setEditableClone] = useState<StudioBg3dEditableThreeClone | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const lastConstraintWorldMatrixRef = useRef<THREE.Matrix4 | null>(null);
  useLayoutEffect(() => {
    if (groupRef.current) synchronizeStudioBg3dRootMatrix(groupRef.current, selected);
  }, [instance.position, instance.rotation, instance.scale, selected]);
  const localBoundsRef = useRef(new THREE.Sphere(new THREE.Vector3(), 1));
  const worldBoundsRef = useRef(new THREE.Sphere(new THREE.Vector3(), 1));
  const projectionMatrixRef = useRef(new THREE.Matrix4());
  const frustumRef = useRef(new THREE.Frustum());
  const cameraSpaceCenterRef = useRef(new THREE.Vector3());
  const previousProjectedLodReasonRef = useRef<"near" | "far" | "very-far" | null>(null);
  const animationRunRef = useRef<{
    readonly mixer: THREE.AnimationMixer;
    readonly action: THREE.AnimationAction;
    readonly playback: StudioBg3dAnimationPlayback;
    readonly durationSeconds: number;
    sampledTimeSeconds: number;
    completed: boolean;
    startElapsedSeconds: number | null;
    lastSampleElapsedSeconds: number;
  } | null>(null);
  const poseRef = useRef(instance.pose);
  poseRef.current = instance.pose;
  const morphRef = useRef(instance.morph);
  morphRef.current = instance.morph;
  const animationRef = useRef(instance.animation);
  animationRef.current = instance.animation;
  const constraintsRef = useRef(instance.constraints);
  constraintsRef.current = instance.constraints;
  const onCloneStatusRef = useRef(onCloneStatus);
  useEffect(() => {
    onCloneStatusRef.current = onCloneStatus;
  });
  useEffect(() => {
    let active = true;
    setEditableClone(null);
    onCloneStatusRef.current([instance.id], "pending");
    if (!cachedRoot) {
      return () => {
        active = false;
      };
    }
    void createStudioBg3dEditableThreeClone(cachedRoot)
      .then((next) => {
        if (!active) {
          next.dispose();
          return;
        }
        setEditableClone(next);
      })
      .catch(() => {
        if (!active) return;
        onCloneStatusRef.current([instance.id], "failed");
      });
    return () => {
      active = false;
      onCloneStatusRef.current([instance.id], "pending");
    };
  }, [cachedRoot, instance.id]);

  useEffect(() => () => editableClone?.dispose(), [editableClone]);
  useEffect(() => {
    lastConstraintWorldMatrixRef.current = null;
    previousProjectedLodReasonRef.current = null;
  }, [editableClone]);
  useEffect(() => {
    editableClone?.applyMaterialOverride(instance.materialOverride);
  }, [editableClone, instance.materialOverride]);
  useEffect(() => {
    animationRunRef.current?.mixer.stopAllAction();
    animationRunRef.current = null;
    const playback = instance.animation;
    const clip = playback ? (animations[playback.clipIndex] ?? animations[0]) : undefined;
    if (!editableClone || !playback || !clip) return;
    const mixer = new THREE.AnimationMixer(editableClone.root);
    const action = mixer.clipAction(clip);
    action.enabled = true;
    // The Studio clock resolves repeat/ping-pong into an absolute clip-local time. Keeping the
    // Three action paused in LoopOnce prevents Three from applying a second loop transform.
    action.clampWhenFinished = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.setEffectiveWeight(playback.weight);
    action.play();
    action.paused = true;
    const durationSeconds = Math.max(0, Number.isFinite(clip.duration) ? clip.duration : 0);
    editableClone.poseController.restoreRestPose();
    editableClone.morphController.restoreRestWeights();
    const sampledTimeSeconds = sampleStudioBg3dAnimationActionAtTime(mixer, action, resolveStudioBg3dAnimationTime({
      baseTimeSeconds: playback.timeSeconds,
      elapsedSeconds: 0,
      timeScale: playback.timeScale,
      durationSeconds,
      loop: playback.loop,
    }));
    editableClone.poseController.applyToCurrentPose(poseRef.current);
    editableClone.poseController.applyConstraints(constraintsRef.current);
    editableClone.morphController.applyToCurrentWeights(morphRef.current);
    const run = {
      mixer,
      action,
      playback,
      durationSeconds,
      sampledTimeSeconds,
      completed: false,
      startElapsedSeconds: null,
      lastSampleElapsedSeconds: Number.NEGATIVE_INFINITY,
    };
    animationRunRef.current = run;
    registerAnimationTime(instance.id, () => run.sampledTimeSeconds);
    return () => {
      registerAnimationTime(instance.id, null);
      mixer.stopAllAction();
      mixer.uncacheRoot(editableClone.root);
      if (animationRunRef.current?.mixer === mixer) animationRunRef.current = null;
    };
  }, [animations, editableClone, instance.animation, instance.id, registerAnimationTime]);
  useEffect(() => {
    if (!editableClone) {
      registerRigBake(instance.id, null);
      return;
    }
    const reader: StudioBg3dRigBakeReader = () => {
      const pose = editableClone.poseController.captureConstraintBakePose();
      if (!pose) return null;
      const sampledTimeSeconds = animationRunRef.current?.sampledTimeSeconds ??
        animationRef.current?.timeSeconds ?? 0;
      if (!Number.isFinite(sampledTimeSeconds) || sampledTimeSeconds < 0) return null;
      return { pose, sampledTimeSeconds };
    };
    registerRigBake(instance.id, reader);
    // Clone readiness means every command exposed by the inspector, including rig bake, already
    // has its live reader registered. This avoids an enabled-button/passive-effect race.
    onCloneStatusRef.current([instance.id], "ready");
    return () => registerRigBake(instance.id, null);
  }, [editableClone, instance.id, registerRigBake]);
  useEffect(() => {
    const group = groupRef.current;
    if (!editableClone || !group) return;
    group.updateWorldMatrix(true, true);
    const worldBounds = new THREE.Box3().setFromObject(editableClone.root)
      .getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(worldBounds.radius) || worldBounds.radius <= 0) {
      localBoundsRef.current.set(new THREE.Vector3(), 1);
      return;
    }
    const inverseGroup = group.matrixWorld.clone().invert();
    worldBounds.applyMatrix4(inverseGroup);
    // Skinning can move vertices outside the rest-pose geometry bounds; a conservative margin keeps
    // near-edge characters updating instead of visibly popping when they re-enter the frustum.
    worldBounds.radius *= 1.5;
    localBoundsRef.current.copy(worldBounds);
  }, [editableClone]);
  useEffect(() => {
    if (!editableClone) return;
    const run = animationRunRef.current;
    if (run) {
      editableClone.poseController.removeAppliedPoseOffsets();
      editableClone.morphController.removeAppliedWeightOffsets();
      run.sampledTimeSeconds = sampleStudioBg3dAnimationActionAtTime(
        run.mixer,
        run.action,
        run.sampledTimeSeconds,
      );
      editableClone.poseController.applyToCurrentPose(instance.pose);
      editableClone.poseController.applyConstraints(instance.constraints);
      editableClone.morphController.applyToCurrentWeights(instance.morph);
    } else {
      editableClone.poseController.applyFromRestPose(instance.pose);
      editableClone.poseController.applyConstraints(instance.constraints);
      editableClone.morphController.applyFromRestWeights(instance.morph);
    }
    const group = groupRef.current;
    if (group) {
      group.updateWorldMatrix(true, false);
      lastConstraintWorldMatrixRef.current = group.matrixWorld.clone();
    }
  }, [editableClone, instance.animation, instance.constraints, instance.morph, instance.pose]);
  useFrame(({ clock, camera, size }) => {
    const run = animationRunRef.current;
    if (!editableClone) return;
    const group = groupRef.current;
    if (!group) return;
    group.updateWorldMatrix(true, false);
    const rootTransformChanged = studioBg3dMatricesDiffer(
      lastConstraintWorldMatrixRef.current,
      group.matrixWorld,
    );
    if (!run?.playback.playing) {
      if (rootTransformChanged && constraintsRef.current?.enabled) {
        if (run) {
          editableClone.poseController.removeAppliedPoseOffsets();
          editableClone.morphController.removeAppliedWeightOffsets();
          run.sampledTimeSeconds = sampleStudioBg3dAnimationActionAtTime(
            run.mixer,
            run.action,
            run.sampledTimeSeconds,
          );
          editableClone.poseController.applyToCurrentPose(poseRef.current);
          editableClone.poseController.applyConstraints(constraintsRef.current);
          editableClone.morphController.applyToCurrentWeights(morphRef.current);
        } else {
          editableClone.poseController.applyFromRestPose(poseRef.current);
          editableClone.poseController.applyConstraints(constraintsRef.current);
          editableClone.morphController.applyFromRestWeights(morphRef.current);
        }
      }
      lastConstraintWorldMatrixRef.current = group.matrixWorld.clone();
      return;
    }
    lastConstraintWorldMatrixRef.current = group.matrixWorld.clone();
    run.startElapsedSeconds ??= clock.elapsedTime;
    const elapsed = clock.elapsedTime - run.startElapsedSeconds;
    const timing = {
      baseTimeSeconds: run.playback.timeSeconds,
      elapsedSeconds: elapsed,
      timeScale: run.playback.timeScale,
      durationSeconds: run.durationSeconds,
      loop: run.playback.loop,
    } as const;
    const timeSeconds = resolveStudioBg3dAnimationTime(timing);
    let visibleInHierarchy = true;
    for (let object: THREE.Object3D | null = group; object; object = object.parent) {
      if (!object.visible) {
        visibleInHierarchy = false;
        break;
      }
    }
    worldBoundsRef.current.copy(localBoundsRef.current).applyMatrix4(group.matrixWorld);
    camera.updateWorldMatrix(true, false);
    projectionMatrixRef.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustumRef.current.setFromProjectionMatrix(projectionMatrixRef.current);
    cameraSpaceCenterRef.current.copy(worldBoundsRef.current.center)
      .applyMatrix4(camera.matrixWorldInverse);
    const projectedLod = projectStudioBg3dLodDiameterCssPx({
      worldRadius: worldBoundsRef.current.radius,
      viewDepth: -cameraSpaceCenterRef.current.z,
      verticalProjectionScale: camera.projectionMatrix.elements[5] ?? Number.NaN,
      viewportCssHeight: size.height,
      perspective: camera instanceof THREE.PerspectiveCamera,
      nearPlane: camera.near,
    });
    const schedule = resolveStudioBg3dAnimationSchedule({
      visibleInHierarchy,
      inCameraFrustum: frustumRef.current.intersectsSphere(worldBoundsRef.current),
      capturing,
      selected,
      targetFps,
      lodBias,
      projectedDiameterCssPx: projectedLod?.projectedDiameterCssPx,
      projectedForceHighestDetail: projectedLod?.forceHighestDetail,
      previousProjectedLodReason: previousProjectedLodReasonRef.current,
      distanceToCamera: camera.position.distanceTo(worldBoundsRef.current.center),
      boundingRadius: worldBoundsRef.current.radius,
    });
    if (
      schedule.reason === "near" || schedule.reason === "far" ||
      schedule.reason === "very-far"
    ) previousProjectedLodReasonRef.current = schedule.reason;
    if (
      schedule.suspended ||
      clock.elapsedTime - run.lastSampleElapsedSeconds < schedule.minimumIntervalSeconds
    ) {
      return;
    }
    run.lastSampleElapsedSeconds = clock.elapsedTime;
    editableClone.poseController.removeAppliedPoseOffsets();
    editableClone.morphController.removeAppliedWeightOffsets();
    run.sampledTimeSeconds = sampleStudioBg3dAnimationActionAtTime(
      run.mixer,
      run.action,
      timeSeconds,
    );
    editableClone.poseController.applyToCurrentPose(poseRef.current);
    editableClone.poseController.applyConstraints(constraintsRef.current);
    editableClone.morphController.applyToCurrentWeights(morphRef.current);
    if (!run.completed && isStudioBg3dAnimationOnceComplete(timing)) {
      run.completed = true;
      onAnimationComplete(instance.id, timeSeconds);
    }
  });

  useEffect(() => {
    registerRef(instance.id, groupRef.current);
    return () => registerRef(instance.id, null);
  }, [instance.id, registerRef]);

  const visible = isBgObjectVisible(instance);

  return (
    <group
      ref={groupRef}
      position={instance.position}
      rotation={instance.rotation}
      scale={instance.scale}
      userData={{ studioBg3dEntityId: instance.id, studioBg3dEntityKind: "model" }}
      visible={visible}
      onClick={(e) => {
        e.stopPropagation();
        if (onSurfacePick(instance.id, e)) return;
        onSelect(instance.id, e.shiftKey || e.metaKey || e.ctrlKey);
      }}
      onPointerMove={onSurfacePreview}
    >
      {editableClone ? <primitive object={editableClone.root} /> : null}
      {children}
    </group>
  );
}

export function BgCustomModelInstanceBatch({
  batchKey,
  sourceRoot,
  instances,
  onSelect,
  onSurfacePick,
  onSurfacePreview,
  onCloneStatus,
  onUnavailable,
}: {
  batchKey: string;
  sourceRoot: THREE.Object3D;
  instances: readonly BgCustomModelInstance[];
  onSelect: (id: string, isMulti: boolean) => void;
  onSurfacePick: (id: string, event: ThreeEvent<MouseEvent>) => boolean;
  onSurfacePreview?: (event: ThreeEvent<PointerEvent>) => void;
  onCloneStatus: (
    ids: readonly string[],
    status: "pending" | "ready" | "failed",
  ) => void;
  onUnavailable: () => void;
}) {
  const instancesRef = useRef(instances);
  instancesRef.current = instances;
  const [batch, setBatch] = useState<StudioBg3dThreeInstancingSuccess | null>(null);
  const cloneStatus = useEffectEvent(onCloneStatus);
  const unavailable = useEffectEvent(onUnavailable);
  useEffect(() => {
    const currentInstances = instancesRef.current;
    const instanceIds = currentInstances.map((instance) => instance.id);
    cloneStatus(instanceIds, "pending");
    const result = createStudioBg3dThreeStaticInstanceBatch(
      sourceRoot,
      currentInstances.map((instance) => ({
        id: instance.id,
        position: instance.position,
        rotation: instance.rotation,
        scale: instance.scale,
      })),
    );
    if (!result.ok) {
      setBatch(null);
      unavailable();
      return;
    }
    setBatch(result);
    cloneStatus(instanceIds, "ready");
    return () => {
      result.dispose();
      cloneStatus(instanceIds, "pending");
    };
  }, [batchKey, sourceRoot]);
  if (!batch) return null;
  return (
    <group
      userData={{
        studioBg3dResolveInstanceId: (instanceId: number) =>
          batch.resolveInstanceId(instanceId),
      }}
    >
      <primitive
        object={batch.root}
        dispose={null}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          const id = batch.resolveInstanceId(event.instanceId);
          if (!id) return;
          event.stopPropagation();
          if (onSurfacePick(id, event)) return;
          onSelect(id, event.shiftKey || event.metaKey || event.ctrlKey);
        }}
        onPointerMove={onSurfacePreview}
      />
    </group>
  );
}
