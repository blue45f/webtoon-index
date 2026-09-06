/**
  type PropInstance,
  type StudioVrmTexturePaintPanelSettings,
 * Studio VRM poser view slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this component destructures the original local names.
 */
import {
  OrbitControls,
} from "@react-three/drei/core/OrbitControls.js";
import {
  Canvas,
} from "@react-three/fiber";
import {
  AlertTriangle,
  Loader2,
  Maximize2,
  Redo2,
  RotateCw,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as THREE from "three";

import {
  StudioToolHintTarget,
} from "../StudioToolHint";

import {
  enabledStudioVrmIkPolesSceneLocal,
  enabledStudioVrmIkTargetsSceneLocal,
} from "./studio-vrm-ik-constraints";
import {
  cx,
} from "./studio-vrm-poser-helpers";
import {
  SCENE_PROPS,
  SceneProp3D,
} from "./studio-vrm-procedural-scene-props";
import {
  WARDROBE_SLOTS,
} from "./studio-vrm-wardrobe";
import { VrmActor } from "./StudioVrmActor";
import {
  StudioVrmAvatarForge,
} from "./StudioVrmAvatarForge";
import {
  StudioVrmBroadcastPreviewBridge,
} from "./StudioVrmBroadcastPreview";
import { StudioVrmGripContactRefine } from "./StudioVrmGripContactRefine";
import {
  StudioVrmJointHandles,
} from "./StudioVrmJointHandles";
import {
  VrmLighting,
} from "./StudioVrmLighting";
import {
  VrmPoseBoneOverlay,
} from "./StudioVrmPoseBoneOverlay";
import {
  CONTROL_BUTTON,
  VIEWPORT_BTN,
  VRM_VIEWPORT_HINTS,
} from "./StudioVrmPoserTypes";
import {
  ViewportController,
  CameraDirector,
  StudioVrmMannequinMaterial,
  StudioVrmTexturePaintInvalidateBridge,
  StudioVrmViewportReadyFrame, CaptureBridge 
} from "./StudioVrmViewportHelpers";
import {
  StudioVrmPropAttachment,
  StudioVrmRuntimeCommit,
  StudioVrmWardrobeAttachment,
} from "./StudioVrmWardrobePropsProjection";

import type { PropInstance } from "./studio-vrm-props";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { StudioVrmTexturePaintPanelSettings } from "./StudioVrmTexturePaintPanel";
import type {
  VRM,
} from "@pixiv/three-vrm";

export function StudioVrmPoserViewport({ h, presentation = "poser" }: {
  h: StudioVrmPoserHost;
  /** Shaper supplies accessible chrome and uses the available panel instead of a nested portrait. */
  presentation?: "poser" | "shaper";
}) {
  const {
    viewportInstructionsId,
    status,
    error,
    vrm,
    customBones,
    customYOffset,
    poseTranslations,
    ikConstraints,
    lockedPoseBones,
    showPoseBoneOverlay,
    selectedViewportPoseBone,
    viewportHandIkEnabled,
    isViewportHandIkDragging,
    expressionWeights,
    activeCameraId,
    activePanelTab,
    texturePaintSettings,
    setTexturePaintSettings,
    texturePaintEyedropperActive,
    setTexturePaintEyedropperActive,
    texturePaintRuntime,
    setTexturePaintSurfaceToolSnapshot,
    bodyRotation,
    mannequinMode,
    jointHandlesVisible,
    selectedJointHandle,
    selectedIkPole,
    ikHandleDragMode,
    ikHandleAxisLock,
    jointHandleInteracting,
    setJointHandleInteracting,
    jointHandleSessionGeneration,
    turntable,
    setTurntable,
    broadcastPreviewReceipt,
    broadcastCanvasDpr,
    broadcastPreviewActive,
    turntableHint,
    viewResetNonce,
    viewportHinted,
    setViewportHinted,
    broadcastViewportHostRef,
    isCapturing,
    isThumbnailCapturing,
    installedModelId,
    bodyScale,
    avatarForgeState,
    avatarForgeReferencePreviewActive,
    avatarForgeFaceController,
    proportionRigRevision,
    fingerEdits,
    lighting,
    envVariant,
    customColors,
    materialFx,
    isSharingPose,
    lightingTone,
    activeProps,
    propAttachments,
    vrmPropItems,
    wardrobeState,
    wardrobeMetrics,
    effectivePropRigMetrics,
    wardrobeFitReport,
    physicsPreview,
    idleAnimation,
    webcamActive,
    trackingDataRef,
    texturePaintMutationBlockedRef,
    persistentIkReconciling,
    groundShadowRef,
    envRootRef,
    handlePanelTabChange,
    handleCharacterSectionChange,
    handleViewportReady,
    handleTexturePaintInvalidateReady,
    handleTexturePaintColorSampled,
    zoomViewport,
    handleViewReset,
    handleJointHandleSelect,
    handleJointHandlePoleSelect,
    previewJointHandleIk,
    handleJointHandleIkCommit,
    previewJointHandlePole,
    handleJointHandlePoleCommit,
    handleJointHandleIkRollback,
    texturePaintModeSelected,
    texturePaintInteractionEnabled,
    texturePaintStrokeActive,
    viewportCanUndo,
    viewportCanRedo,
    viewportCameraInteractionLocked,
    doUndo,
    doRedo,
    vrmFrameLoop,
    handleBroadcastPreviewRuntimeError,
    effectiveFingerEdits,
    onCaptureUpdate,
    activeCamera,
    handleSampleLoad,
    selectViewportPoseBone,
    handleViewportHandIkDrag,
    handleWardrobeSurfaceReceipt,
    handleWardrobeXpbdCaptureSyncChange,
  } = h;
  const frameless = broadcastPreviewActive || presentation === "shaper";
  return (
          <section
            aria-hidden={broadcastPreviewActive || undefined}
            className="relative min-h-0 overflow-hidden bg-card lg:min-h-0"
            inert={broadcastPreviewActive ? true : undefined}
          >
            <div
              aria-hidden
              className="absolute inset-0 opacity-80 [background-image:linear-gradient(45deg,oklch(0.75_0.01_80/0.16)_25%,transparent_25%),linear-gradient(-45deg,oklch(0.75_0.01_80/0.16)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,oklch(0.75_0.01_80/0.16)_75%),linear-gradient(-45deg,transparent_75%,oklch(0.75_0.01_80/0.16)_75%)] [background-position:0_0,0_12px,12px_-12px,-12px_0] [background-size:24px_24px]"
            />
            <div
              className={cx(
                "relative mx-auto flex h-full min-h-0 w-full items-center justify-center",
                frameless
                  ? "max-h-none max-w-none p-0 lg:min-h-0"
                  : "max-h-full max-w-[min(82vw,720px)] p-2 sm:p-5 lg:max-h-[calc(100dvh-12rem)] lg:min-h-[420px]",
              )}
            >
              <div
                ref={broadcastViewportHostRef}
                className={cx(
                  "relative h-full min-h-0 overflow-hidden bg-transparent",
                  frameless
                    ? "max-h-none w-full rounded-none border-0 shadow-none lg:min-h-0"
                    : "aspect-[9/13] max-h-full w-auto rounded-xl border border-line/80 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.04)] lg:min-h-[390px]",
                )}
                style={{
                  cursor: texturePaintInteractionEnabled
                    ? texturePaintEyedropperActive
                      ? "crosshair"
                      : texturePaintSettings.tool === "fill"
                        ? "cell"
                        : "crosshair"
                    : undefined,
                }}
              >
                <p id={viewportInstructionsId} className="sr-only">
                  {texturePaintModeSelected
                    ? "3D 캐릭터 표면 페인트 모드입니다. 캐릭터 회전은 잠겨 있습니다. B로 직접 그리기, F로 ColorDrop, I로 스포이드를 선택합니다. 직접 그리기는 검증된 round 촉으로 UV 경계를 안전하게 나누고, 한 번의 제스처를 하나의 실행 취소 단계로 저장합니다."
                    : "3D 캐릭터 편집 뷰포트입니다. 포인터로 끌어 캐릭터를 회전하고, 휠·핀치 또는 뷰포트 오른쪽의 확대·축소 버튼으로 시점을 조절하세요."}
                </p>
                <Canvas
                  role="group"
                  tabIndex={0}
                  aria-keyshortcuts="B F I"
                  aria-label={
                    texturePaintModeSelected
                      ? "3D 캐릭터 표면 페인트 뷰포트"
                      : "3D 캐릭터 편집 뷰포트"
                  }
                  aria-describedby={viewportInstructionsId}
                  onKeyDown={(event) => {
                    if (
                      !texturePaintInteractionEnabled
                      || texturePaintStrokeActive
                      || event.metaKey
                      || event.ctrlKey
                      || event.altKey
                    ) {
                      return;
                    }
                    const key = event.key.toLowerCase();
                    if (key === "i") {
                      event.preventDefault();
                      setTexturePaintEyedropperActive((active: boolean) => !active);
                    } else if (key === "b") {
                      event.preventDefault();
                      setTexturePaintEyedropperActive(false);
                      setTexturePaintSettings((current: StudioVrmTexturePaintPanelSettings) => ({
                        ...current,
                        tool: "surface-brush",
                      }));
                    } else if (key === "f") {
                      event.preventDefault();
                      setTexturePaintEyedropperActive(false);
                      setTexturePaintSettings((current: StudioVrmTexturePaintPanelSettings) => ({
                        ...current,
                        tool: "fill",
                      }));
                    }
                  }}
                  camera={{ fov: activeCamera.fov, position: new THREE.Vector3(...activeCamera.position), near: 0.1, far: 20 }}
                  className="h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                  dpr={broadcastPreviewActive ? broadcastCanvasDpr : [1, 2]}
                  frameloop={vrmFrameLoop}
                  gl={{ alpha: true, antialias: true }}
                  onCreated={({ gl }) => {
                    gl.outputColorSpace = THREE.SRGBColorSpace;
                    gl.toneMapping = THREE.ACESFilmicToneMapping;
                    gl.toneMappingExposure = 1.0;
                    gl.setClearColor(0x000000, 0);
                    gl.setClearAlpha(0);
                  }}
                >
                  <CaptureBridge onCaptureUpdate={onCaptureUpdate} />
                  {broadcastPreviewReceipt ? (
                    <StudioVrmBroadcastPreviewBridge
                      receipt={broadcastPreviewReceipt}
                      environmentRef={envRootRef}
                      groundRef={groundShadowRef}
                      onError={handleBroadcastPreviewRuntimeError}
                    />
                  ) : null}
                  <StudioVrmViewportReadyFrame
                    revision={`${installedModelId ?? "empty"}:${status}:${texturePaintModeSelected ? "surface" : "standard"}`}
                  />
                  <StudioVrmTexturePaintInvalidateBridge
                    onReady={handleTexturePaintInvalidateReady}
                  />
                  <CameraDirector
                    presetId={activeCameraId}
                    resetNonce={viewResetNonce}
                    vrm={vrm}
                    interactionLocked={viewportCameraInteractionLocked || broadcastPreviewActive}
                  />
                  <ViewportController onReady={handleViewportReady} />
                  <VrmLighting
                    tone={lightingTone}
                    lighting={lighting}
                    env={envVariant}
                    envRootRef={envRootRef}
                  />
                  {vrm ? (
                    <VrmActor
                      bodyRotation={bodyRotation}
                      customBones={customBones}
                      customYOffset={customYOffset}
                      poseTranslations={poseTranslations}
                      expressionWeights={expressionWeights}
                      vrm={vrm}
                      customColors={customColors}
                      materialFx={materialFx}
                      webcamActive={webcamActive}
                      trackingDataRef={trackingDataRef}
                      idleAnimation={idleAnimation}
                      fingerEdits={effectiveFingerEdits}
                      bodyScale={bodyScale}
                      rigRevision={proportionRigRevision}
                      texturePaintEnabled={texturePaintInteractionEnabled}
                      texturePaintMutationBlockedRef={texturePaintMutationBlockedRef}
                      texturePaintRuntime={texturePaintRuntime}
                      texturePaintSettings={texturePaintSettings}
                      texturePaintEyedropperActive={texturePaintEyedropperActive}
                      onTexturePaintColorSampled={handleTexturePaintColorSampled}
                      onTexturePaintEyedropperComplete={() =>
                        setTexturePaintEyedropperActive(false)}
                      onTexturePaintSurfaceStateChange={setTexturePaintSurfaceToolSnapshot}
                    />
                  ) : null}
                  {vrm && showPoseBoneOverlay && !texturePaintModeSelected && !isCapturing && !isSharingPose && !isThumbnailCapturing && !webcamActive && !broadcastPreviewActive ? (
                    <VrmPoseBoneOverlay
                      vrm={vrm}
                      selectedBone={selectedViewportPoseBone}
                      lockedBones={lockedPoseBones}
                      handIkEnabled={viewportHandIkEnabled}
                      onSelect={selectViewportPoseBone}
                      onDrag={handleViewportHandIkDrag}
                    />
                  ) : null}
                  {vrm ? (
                    <StudioVrmAvatarForge
                      vrm={vrm}
                      state={avatarForgeReferencePreviewActive?.state ?? avatarForgeState}
                      rigRevision={proportionRigRevision}
                      faceController={avatarForgeFaceController}
                    />
                  ) : null}
                  {vrm ? (
                    <StudioVrmMannequinMaterial
                      vrm={vrm}
                      enabled={mannequinMode}
                      customColors={customColors}
                      materialFx={materialFx}
                    />
                  ) : null}
                  {vrm ? (
                    <StudioVrmJointHandles
                      key={`${jointHandleSessionGeneration}:${proportionRigRevision}`}
                      vrm={vrm}
                      visible={
                        jointHandlesVisible
                        && activePanelTab === "pose"
                        && !broadcastPreviewActive
                        && !isCapturing
                        && !isSharingPose
                        && !isThumbnailCapturing
                        && !persistentIkReconciling
                      }
                      effectorSceneTargets={enabledStudioVrmIkTargetsSceneLocal(ikConstraints)}
                      poleSceneTargets={enabledStudioVrmIkPolesSceneLocal(ikConstraints)}
                      selectedBone={selectedJointHandle}
                      selectedPole={selectedIkPole}
                      dragMode={ikHandleDragMode}
                      axisLock={ikHandleAxisLock}
                      disabled={webcamActive || idleAnimation || isCapturing || persistentIkReconciling}
                      onSelectBone={handleJointHandleSelect}
                      onSelectPole={handleJointHandlePoleSelect}
                      onEffectorPreview={previewJointHandleIk}
                      onEffectorCommit={handleJointHandleIkCommit}
                      onEffectorRollback={handleJointHandleIkRollback}
                      onPolePreview={previewJointHandlePole}
                      onPoleCommit={handleJointHandlePoleCommit}
                      onPoleRollback={handleJointHandleIkRollback}
                      onInteractionActiveChange={setJointHandleInteracting}
                    />
                  ) : null}
                  {vrm
                    ? vrmPropItems.map((item: PropInstance) => (
                        <StudioVrmPropAttachment
                          key={`${proportionRigRevision}:${item.uid}`}
                          vrm={vrm}
                          instance={item}
                          metrics={effectivePropRigMetrics}
                          rigRevision={proportionRigRevision}
                        />
                      ))
                    : null}
                  {vrm && vrmPropItems.length > 0 ? (
                    <StudioVrmGripContactRefine
                      vrm={vrm}
                      items={vrmPropItems}
                      metrics={effectivePropRigMetrics}
                      rigRevision={proportionRigRevision}
                      lockedBones={lockedPoseBones}
                      disabled={webcamActive || broadcastPreviewActive || persistentIkReconciling || jointHandleInteracting || isViewportHandIkDragging || texturePaintInteractionEnabled}
                    />
                  ) : null}
                  {vrm ? (
                    <StudioVrmRuntimeCommit
                      vrm={vrm}
                      physicsPreview={physicsPreview}
                      webcamActive={webcamActive}
                    />
                  ) : null}
                  {vrm && wardrobeMetrics
                    ? WARDROBE_SLOTS.map((slot) => {
                        const equip = wardrobeState[slot];
                        const fit = wardrobeFitReport.slots[slot];
                        return equip ? (
                          <StudioVrmWardrobeAttachment
                            key={`${proportionRigRevision}:${slot}`}
                            vrm={vrm}
                            slot={slot}
                            equip={equip}
                            metrics={wardrobeMetrics}
                            effectiveFit={fit?.effectiveFit ?? equip.fit}
                            rigRevision={proportionRigRevision}
                            onSurfaceReceipt={handleWardrobeSurfaceReceipt}
                            onXpbdCaptureSyncChange={handleWardrobeXpbdCaptureSyncChange}
                          />
                        ) : null;
                      })
                    : null}
                  {activeProps.map((propId: string) => {
                    const propDef = SCENE_PROPS.find((p) => p.id === propId);
                    if (!propDef) return null;
                    return (
                      <SceneProp3D
                        key={propId}
                        propId={propId}
                        vrm={vrm}
                        config={propAttachments[propId]}
                        defaultPosition={propDef.position}
                        defaultScale={propDef.scale}
                      />
                    );
                  })}
                  <mesh ref={groundShadowRef} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.48, 0.82, 1]} renderOrder={-1}>
                    <circleGeometry args={[1, 72]} />
                    <meshBasicMaterial color="#3c2b20" transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
                  </mesh>
                  <OrbitControls
                    makeDefault
                    enabled={
                      !isViewportHandIkDragging
                      && !jointHandleInteracting
                      && !texturePaintStrokeActive
                      && !viewportCameraInteractionLocked
                      && !broadcastPreviewActive
                    }
                    enableRotate={!texturePaintInteractionEnabled}
                    enableDamping
                    dampingFactor={0.08}
                    enablePan={false}
                    autoRotate={
                      turntable
                      && !texturePaintModeSelected
                      && !jointHandleInteracting
                      && !isViewportHandIkDragging
                      && !viewportCameraInteractionLocked
                      && !broadcastPreviewActive
                    }
                    autoRotateSpeed={1.6}
                    minDistance={1.3}
                    maxDistance={5.2}
                    target={[activeCamera.target[0], activeCamera.target[1], activeCamera.target[2]]}
                    onStart={() => setViewportHinted(true)}
                  />
                </Canvas>

                {vrm && !broadcastPreviewActive && presentation === "poser" ? (
                  <>
                    <div className="absolute left-2.5 top-2.5 z-10 flex flex-col gap-1.5">
                      <StudioToolHintTarget
                        hint={VRM_VIEWPORT_HINTS.undo}
                        disabled={!viewportCanUndo}
                        unavailableReason={
                          texturePaintStrokeActive
                            ? "표면 페인트 획을 마친 뒤 실행 취소할 수 있습니다."
                            : !viewportCanUndo
                              ? "되돌릴 캐릭터 변경이 없습니다."
                              : undefined
                        }
                        preferredSide="right"
                      >
                        <button
                          type="button"
                          aria-label="실행 취소"
                          disabled={!viewportCanUndo}
                          className={cx(VIEWPORT_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
                          onClick={doUndo}
                        >
                          <Undo2 size={16} aria-hidden />
                        </button>
                      </StudioToolHintTarget>
                      <StudioToolHintTarget
                        hint={VRM_VIEWPORT_HINTS.redo}
                        disabled={!viewportCanRedo}
                        unavailableReason={
                          texturePaintStrokeActive
                            ? "표면 페인트 획을 마친 뒤 다시 실행할 수 있습니다."
                            : !viewportCanRedo
                              ? "다시 적용할 캐릭터 변경이 없습니다."
                              : undefined
                        }
                        preferredSide="right"
                      >
                        <button
                          type="button"
                          aria-label="다시 실행"
                          disabled={!viewportCanRedo}
                          className={cx(VIEWPORT_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
                          onClick={doRedo}
                        >
                          <Redo2 size={16} aria-hidden />
                        </button>
                      </StudioToolHintTarget>
                    </div>
                    <div className="absolute right-2.5 top-2.5 z-10 flex flex-col gap-1.5">
                      <StudioToolHintTarget
                        hint={VRM_VIEWPORT_HINTS.zoomIn}
                        disabled={viewportCameraInteractionLocked}
                        unavailableReason={viewportCameraInteractionLocked ? "3D 캡처 중에는 카메라를 고정합니다." : undefined}
                        preferredSide="left"
                      >
                        <button type="button" aria-label="확대" disabled={viewportCameraInteractionLocked} className={VIEWPORT_BTN} onClick={() => zoomViewport(0.82)}>
                          <ZoomIn size={16} aria-hidden />
                        </button>
                      </StudioToolHintTarget>
                      <StudioToolHintTarget
                        hint={VRM_VIEWPORT_HINTS.zoomOut}
                        disabled={viewportCameraInteractionLocked}
                        unavailableReason={viewportCameraInteractionLocked ? "3D 캡처 중에는 카메라를 고정합니다." : undefined}
                        preferredSide="left"
                      >
                        <button type="button" aria-label="축소" disabled={viewportCameraInteractionLocked} className={VIEWPORT_BTN} onClick={() => zoomViewport(1.22)}>
                          <ZoomOut size={16} aria-hidden />
                        </button>
                      </StudioToolHintTarget>
                      <StudioToolHintTarget
                        hint={VRM_VIEWPORT_HINTS.resetView}
                        disabled={viewportCameraInteractionLocked}
                        unavailableReason={viewportCameraInteractionLocked ? "3D 캡처 중에는 카메라를 고정합니다." : undefined}
                        preferredSide="left"
                      >
                        <button type="button" aria-label="시점 초기화" disabled={viewportCameraInteractionLocked} className={VIEWPORT_BTN} onClick={handleViewReset}>
                          <Maximize2 size={16} aria-hidden />
                        </button>
                      </StudioToolHintTarget>
                      <StudioToolHintTarget
                        hint={turntableHint}
                        disabled={texturePaintModeSelected || viewportCameraInteractionLocked}
                        unavailableReason={
                          viewportCameraInteractionLocked
                            ? "3D 캡처 중에는 카메라를 고정합니다."
                          : texturePaintModeSelected
                            ? "표면 페인트 중에는 캐릭터가 움직이지 않도록 턴테이블을 잠급니다."
                            : undefined
                        }
                        preferredSide="left"
                      >
                        <button
                          type="button"
                          aria-label={turntable ? "턴테이블 회전 중지" : "턴테이블 회전 시작"}
                          aria-pressed={turntable}
                          disabled={texturePaintModeSelected || viewportCameraInteractionLocked}
                          className={cx(
                            VIEWPORT_BTN,
                            turntable && "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent",
                            "disabled:cursor-not-allowed disabled:opacity-40",
                          )}
                          onClick={() => {
                            setTurntable((v: boolean) => !v);
                            setViewportHinted(true);
                          }}
                        >
                          <RotateCw size={16} aria-hidden className={turntable ? "animate-spin [animation-duration:3s]" : ""} />
                        </button>
                      </StudioToolHintTarget>
                    </div>
                    {texturePaintModeSelected || !viewportHinted ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
                        <span
                          className={cx(
                            "rounded-full border px-3 py-1 text-[0.66rem] font-medium shadow-sm backdrop-blur",
                            texturePaintModeSelected
                              ? "border-accent/40 bg-panel/92 text-fg-2"
                              : "border-line/70 bg-panel/85 text-fg-3",
                          )}
                        >
                          {texturePaintModeSelected
                            ? "표면 칠하기 · 회전 잠김 · 휠·핀치 또는 우측 줌 버튼"
                            : "끌어서 회전 · 휠·핀치로 확대/축소"}
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {status === "empty" && presentation === "poser" ? (
                  <div className="absolute inset-0 grid place-items-center bg-card/50 p-6 text-center backdrop-blur-[1px]">
                    <div className="max-w-[22rem]">
                      <div className="mx-auto grid size-12 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
                        <Upload size={22} aria-hidden />
                      </div>
                      <p className="mt-4 text-sm font-bold text-fg">VRM 모델을 불러와 장면을 시작하세요.</p>
                      <p className="mt-2 text-xs leading-relaxed text-fg-3">
                        내 .vrm 파일을 업로드하거나 모델 라이브러리에서 준비된 모델을 선택하세요. 불러온 뒤 조형, 포즈, 의상과 소품을 자유롭게 편집할 수 있습니다.
                      </p>
                      <div className="mt-4 flex justify-center gap-2">
                        <button
                          type="button"
                          className={cx(CONTROL_BUTTON, "border-accent/50 bg-accent text-on-accent")}
                          onClick={() => {
                            handlePanelTabChange("character");
                            handleCharacterSectionChange("library");
                          }}
                        >
                          <Upload size={14} aria-hidden />
                          모델 라이브러리
                        </button>
                        <button type="button" className={cx(CONTROL_BUTTON, "border-line bg-panel text-fg-2 hover:bg-raised hover:text-fg")} onClick={handleSampleLoad}>
                          루미 불러오기
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {status === "loading" ? (
                  <div className="absolute inset-0 grid place-items-center bg-card/45 p-6 text-center backdrop-blur-sm" role="status" aria-live="polite">
                    <div>
                      <Loader2 className="mx-auto animate-spin text-accent" size={30} aria-hidden />
                      <p className="mt-3 text-sm font-semibold text-fg">VRM을 불러오는 중입니다.</p>
                    </div>
                  </div>
                ) : null}

                {status === "error" ? (
                  <div className="absolute inset-x-3 bottom-3 rounded-xl border border-line bg-panel/95 p-3 text-sm shadow-xl backdrop-blur" role="alert">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 shrink-0 text-accent" size={16} aria-hidden />
                      <div>
                        <p className="font-semibold text-fg">불러오기에 실패했습니다.</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{error || "파일 형식 또는 경로를 확인해 주세요."}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
  );
}
