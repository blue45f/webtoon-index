/**
  type CustomPose,
  type ExpressionAction,
  type StudioVrmIkConstraint,
 * Studio VRM poser view slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this component destructures the original local names.
 */
import {
  FlipHorizontal2,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";

import {
  EXPRESSION_PRESETS,
  EXTRA_POSE_PRESETS,
  NATURAL_IDLE_POSES,
} from "../studio-pose-presets";

import {
  removeStudioVrmIkConstraint,
} from "./studio-vrm-ik-constraints";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  cloneStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import {
  CHARACTER_PANEL_SECTIONS,
  STUDIO_VRM_IK_AXIS_LOCKS,
  STUDIO_VRM_IK_DRAG_MODES,
} from "./studio-vrm-poser-catalogs";
import {
  cx,
  getExpressionCategory,
} from "./studio-vrm-poser-helpers";
import {
  applyExpressionWeightsToVrm,
  POSE_PRESETS,
  applyPoserVisualState,
} from "./studio-vrm-poser-utils";
import {
  filterStudioVrmPosesByBucket,
  STUDIO_VRM_POSE_BUCKETS,
  studioVrmPoseBucketCountLabel,
} from "./studio-vrm-poser-ux";
import {
  formatStudioVrmHeadUnits,
} from "./studio-vrm-proportion-core";
import {
  StudioVrmAvatarForgePanel,
} from "./StudioVrmAvatarForgePanel";
import {
  inspectStudioVrmSemanticFaceMorphProfile,
} from "./studio-vrm-semantic-face-morph";
import {
  StudioVrmAvatarReferenceRecommendationsPanel,
} from "./StudioVrmAvatarReferenceRecommendationsPanel";
import {
  StudioVrmCharacterLibraryPanel,
} from "./StudioVrmCharacterLibraryPanel";
import {
  StudioVrmPhotoPoseScanner,
} from "./StudioVrmPhotoPoseScanner";
import {
  StudioVrmPoseMaterialPanel,
} from "./StudioVrmPoseMaterialPanel";
import {
  STUDIO_VRM_SURFACE_BRUSH_UNAVAILABLE_REASON,
} from "./StudioVrmPoserTypes";
import {
  StudioVrmRigAssistPanel,
} from "./StudioVrmRigAssistPanel";
import {
  StudioVrmTexturePaintPanel,
} from "./StudioVrmTexturePaintPanel";
import {
  studioVrmAvatarReferenceCatalogueDiagnosticMessage,
} from "./useStudioVrmAvatarReferenceCatalogue";

import type { ExpressionAction } from "./studio-vrm-poser-catalogs";
import type { StudioVrmIkConstraint } from "./studio-vrm-scene-document";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { CustomPose } from "./StudioVrmPoserTypes";
import type {
  VRM,
} from "@pixiv/three-vrm";

export function StudioVrmPoserPanelBodyA({ h }: { h: StudioVrmPoserHost }) {
  const {
    status,
    vrm,
    activePoseId,
    customBones,
    customYOffset,
    setCustomYOffset,
    poseTranslations,
    setPoseTranslations,
    ikConstraints,
    rigJointProfile,
    setRigJointProfile,
    fullBodyIkEnabled,
    setFullBodyIkEnabled,
    footPlantEnabled,
    setFootPlantEnabled,
    rigFloorHeight,
    setRigFloorHeight,
    activeExpressionId,
    setActiveExpressionId,
    expressionWeights,
    setExpressionWeights,
    activeExpressionCategory,
    setActiveExpressionCategory,
    activePanelTab,
    activeCharacterSection,
    avatarForgeReferenceSurfaceActive,
    avatarForgeReferenceCatalogue,
    texturePaintSettings,
    texturePaintEyedropperActive,
    setTexturePaintEyedropperActive,
    texturePaintRuntime,
    texturePaintSnapshot,
    texturePaintPersistenceStatus,
    setTexturePaintPersistenceStatus,
    texturePaintPersistenceError,
    setTexturePaintPersistenceError,
    setTexturePaintRestoreRetryToken,
    poseQuery,
    setPoseQuery,
    poseBucket,
    setPoseBucket,
    recentPoseState,
    recentCharacterState,
    jointHandlesVisible,
    setJointHandlesVisible,
    selectedIkPole,
    setSelectedIkPole,
    ikHandleDragMode,
    setIkHandleDragMode,
    ikHandleAxisLock,
    setIkHandleAxisLock,
    jointHandleInteracting,
    jointHandleStatus,
    setJointHandleStatus,
    canUndo,
    canRedo,
    isCapturing,
    isThumbnailCapturing,
    libraryEntries,
    libraryNextCursor,
    isLoadingLibraryPage,
    libraryStatus,
    libraryError,
    activeModelId,
    isUploading,
    deletingModelId,
    bodyScale,
    avatarForgeState,
    setAvatarForgeReferencePreview,
    avatarForgeReferencePreviewActive,
    proportionRigStatus,
    proportionRigMessage,
    proportionRigReceipt,
    proportionHeadMeasurement,
    detectedOriginalHairCount,
    fingerEdits,
    isSharingPose,
    savedPoses,
    vrmCreativePersistenceStatus,
    vrmCreativePersistenceMessage,
    preserveExpression,
    setPreserveExpression,
    idleAnimation,
    webcamActive,
    vrmRef,
    texturePaintRestoreAbortRef,
    panelScrollRef,
    persistentIkReconciling,
    handleCharacterSectionChange,
    handleCharacterTabKeyDown,
    handleTexturePaintSettingsChange,
    handleTexturePaintUndo,
    handleTexturePaintRedo,
    handleTexturePaintReset,
    cancelJointIkTransaction,
    texturePaintDisabledReason,
    texturePaintStrokeActive,
    texturePaintTargetLabel,
    texturePaintStatus,
    poseMaterialRuntimeDisabled,
    portableLockedPoseBones,
    handleCapturePoseMaterial,
    handleApplyPoseMaterial,
    handlePoseMaterialProvenanceInvalidated,
    effectiveFingerEdits,
    avatarForgeReferenceInteractionBlocked,
    handleAvatarForgeReferencePreview,
    handleAvatarForgeReferenceApply,
    handleAvatarForgeChange,
    allPoseListItems,
    poseQ,
    poseMatches,
    poseResultCount,
    hideOnTab,
    hideOnCharacterSection,
    availableExpressionActions,
    vrmCreativeReadOnly,
    handleSavePose,
    handleDeletePose,
    handleCustomPoseSelect,
    handleCopyPose,
    handlePastePose,
    handleExportPoses,
    handleImportPoses,
    handleDeleteEntry,
    handleFileChange,
    handleGeneratedVrmFile,
    loadModelFromLibraryEntry,
    handleLoadMoreVrmLibrary,
    handleRetryVrmLibraryRefresh,
    handleVisibleVrmThumbnailWindow,
    handlePoseSelect,
    handlePhotoPoseApply,
    handleMirrorPose,
    commitIkConstraintSettings,
    handleExpressionSelect,
    handleExpressionPresetSelect,
    updateExpressionWeight,
  } = h;
  const semanticFaceMorphProfile = useMemo(
    () => inspectStudioVrmSemanticFaceMorphProfile(vrm),
    [vrm],
  );
  return (
              <>
              {activePanelTab === "character" ? (
                <div className="sticky -top-4 z-20 -mx-4 -mt-4 border-b border-line bg-panel/95 px-4 py-2 backdrop-blur sm:-mx-5 sm:px-5">
                  <div role="tablist" aria-label="캐릭터 빌더 단계" className="grid grid-cols-5 gap-1">
                    {CHARACTER_PANEL_SECTIONS.map((section) => {
                      const SectionIcon = section.icon;
                      const selected = activeCharacterSection === section.id;
                      return (
                        <button
                          key={section.id}
                          id={`vrm-character-subtab-${section.id}`}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          aria-controls={`vrm-character-section-${section.id}`}
                          tabIndex={selected ? 0 : -1}
                          onKeyDown={handleCharacterTabKeyDown}
                          className={cx(
                            "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 text-[0.64rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                            selected
                              ? "border-accent/55 bg-accent-soft text-accent"
                              : "border-transparent text-fg-3 hover:bg-raised hover:text-fg"
                          )}
                          onClick={() => handleCharacterSectionChange(section.id)}
                        >
                          <SectionIcon size={14} aria-hidden />
                          <span className="truncate">{section.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <StudioVrmCharacterLibraryPanel
                hidden={hideOnCharacterSection("library")}
                entries={libraryEntries}
                recentCharacterIds={recentCharacterState.ids}
                libraryStatus={libraryStatus}
                libraryError={libraryError}
                activeModelId={activeModelId}
                deletingModelId={deletingModelId}
                modelStatus={status}
                isUploading={isUploading}
                hasMoreEntries={libraryNextCursor !== null}
                isLoadingMore={isLoadingLibraryPage}
                onFileChange={handleFileChange}
                onLoadMore={handleLoadMoreVrmLibrary}
                onRetry={handleRetryVrmLibraryRefresh}
                onSelect={loadModelFromLibraryEntry}
                onDelete={handleDeleteEntry}
                onVisibleWindowChange={handleVisibleVrmThumbnailWindow}
                onCollapse={() => {
                  panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />

              <section
                id="vrm-character-section-forge"
                role="tabpanel"
                aria-labelledby="vrm-character-subtab-forge"
                hidden={hideOnCharacterSection("forge")}
              >
                <StudioVrmAvatarForgePanel
                  state={avatarForgeState}
                  sculptSessionId={activeModelId}
                  disabled={
                    isCapturing
                    || isSharingPose
                    || isThumbnailCapturing
                    || proportionRigStatus === "applying"
                    || proportionRigStatus === "reload-required"
                  }
                  onGeneratedFile={(file) => {
                    void handleGeneratedVrmFile(file);
                  }}
                  detectedOriginalHairCount={detectedOriginalHairCount}
                  proportionMetrics={proportionRigReceipt?.metrics ?? null}
                  proportionMetricsLabel={
                    (
                      proportionRigReceipt?.headMeasurement?.source
                      ?? proportionHeadMeasurement?.source
                    ) === "eye-landmarks"
                      ? "눈 랜드마크 기반 모델 추정"
                      : "모델 경계 기반 추정"
                  }
                  proportionPresetNote={
                    proportionRigReceipt?.presetResolution?.clamped
                      ? `${proportionRigReceipt.presetResolution.targetHeadUnits}두신 목표를 이 모델의 안전 범위에서 ${formatStudioVrmHeadUnits(proportionRigReceipt.presetResolution.achievedHeadUnits)}까지 적용했습니다.`
                      : null
                  }
                  proportionUnavailableReason={
                    proportionRigStatus === "unavailable" || proportionRigStatus === "reload-required"
                      ? proportionRigMessage || "리그 준비 상태를 확인할 수 없습니다."
                      : null
                  }
                  semanticFaceMorphProfile={semanticFaceMorphProfile}
                  onChange={handleAvatarForgeChange}
                />
                <div className="mt-3">
                  <StudioVrmAvatarReferenceRecommendationsPanel
                    catalogue={
                      avatarForgeReferenceSurfaceActive
                        ? avatarForgeReferenceCatalogue.catalogue
                        : null
                    }
                    catalogueStatus={
                      avatarForgeReferenceSurfaceActive
                        ? avatarForgeReferenceCatalogue.status
                        : "idle"
                    }
                    catalogueUnavailableReason={
                      avatarForgeReferenceCatalogue.status === "unavailable"
                        ? studioVrmAvatarReferenceCatalogueDiagnosticMessage(
                            avatarForgeReferenceCatalogue.diagnosticCode,
                          )
                        : undefined
                    }
                    disabled={avatarForgeReferenceInteractionBlocked()}
                    previewingPresetId={avatarForgeReferencePreviewActive?.presetId ?? null}
                    onCatalogueRetry={avatarForgeReferenceCatalogue.retry}
                    onPreview={handleAvatarForgeReferencePreview}
                    onPreviewClear={() => setAvatarForgeReferencePreview(null)}
                    onApply={handleAvatarForgeReferenceApply}
                  />
                </div>
              </section>

              <StudioVrmTexturePaintPanel
                hidden={hideOnCharacterSection("surface")}
                disabled={!texturePaintRuntime || texturePaintDisabledReason.length > 0}
                settings={texturePaintSettings}
                activeTargetId={texturePaintSnapshot?.activeTargetId ?? null}
                activeTextureLabel={texturePaintTargetLabel}
                surfaceBrushUnavailableReason={STUDIO_VRM_SURFACE_BRUSH_UNAVAILABLE_REASON}
                status={texturePaintStatus}
                restoreError={
                  texturePaintPersistenceStatus === "error"
                    ? texturePaintPersistenceError || "저장된 표면 페인팅을 복원하지 못했습니다."
                    : null
                }
                strokeActive={texturePaintStrokeActive}
                targetCount={texturePaintSnapshot?.targets.length ?? 0}
                canUndo={(texturePaintSnapshot?.history.undoCount ?? 0) > 0}
                canRedo={(texturePaintSnapshot?.history.redoCount ?? 0) > 0}
                eyedropperActive={texturePaintEyedropperActive}
                onSettingsChange={handleTexturePaintSettingsChange}
                onUndo={handleTexturePaintUndo}
                onRedo={handleTexturePaintRedo}
                onEyedropperToggle={() =>
                  setTexturePaintEyedropperActive((active: boolean) => !active)}
                onResetActiveTexture={handleTexturePaintReset}
                onRetryRestore={() => {
                  texturePaintRestoreAbortRef.current?.abort();
                  setTexturePaintPersistenceError("");
                  setTexturePaintPersistenceStatus("restoring");
                  setTexturePaintRestoreRetryToken((token: number) => token + 1);
                }}
              />

              <section hidden={hideOnTab("face")}>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-fg">
                  <Sparkles size={15} className="text-accent" aria-hidden />
                  표정
                </h3>
                {availableExpressionActions.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {availableExpressionActions.map((action: ExpressionAction) => (
                      <button
                        key={action.id}
                        type="button"
                        className={cx(
                          "min-h-[3rem] rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                          activeExpressionId === action.id
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        disabled={!vrm}
                        onClick={() => handleExpressionSelect(action)}
                      >
                        <span className="block truncate text-xs font-bold">{action.label}</span>
                        <span className="mt-0.5 block text-[0.68rem] text-fg-3">{action.tone}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-line bg-card/45 px-3 py-4 text-xs leading-relaxed text-fg-3">
                    이 VRM에는 사용할 수 있는 표정 프리셋이 없습니다.
                  </p>
                )}

                {/* 표정 조합 프리셋(studio-pose-presets) — 여러 blendshape를 섞은 만화식 표정을 원클릭 적용 */}
                <div className="mt-3 border-t border-line/45 pt-3">
                  <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">원클릭 표정 조합 ({EXPRESSION_PRESETS.length})</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {EXPRESSION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.tone}
                        className={cx(
                          "flex min-h-[3.4rem] flex-col items-center justify-center gap-0.5 rounded-xl border px-1.5 py-1.5 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                          activeExpressionId === `preset:${preset.id}`
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        disabled={!vrm}
                        onClick={() => handleExpressionPresetSelect(preset)}
                      >
                        <span className="text-base leading-none" aria-hidden>{preset.emoji}</span>
                        <span className="block w-full truncate text-[0.66rem] font-bold">{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section hidden={hideOnTab("face")} className="rounded-xl border border-line bg-card/45 p-3">
                <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold text-fg">
                  <Sliders size={14} className="text-accent" aria-hidden />
                  표정 세부 조절 (Blendshape Mix)
                </h3>
                <p className="mb-3 text-[0.68rem] leading-relaxed text-fg-3">
                  각 표정 슬라이더를 조절하여 여러 표정을 믹스해 보세요.
                </p>

                <div className="mb-3 flex flex-wrap gap-1">
                  {[
                    { id: "emotion", label: "감정" },
                    { id: "eye", label: "눈/시선" },
                    { id: "mouth", label: "입모양" },
                    { id: "custom", label: "기타/커스텀" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={cx(
                        "rounded-lg border px-2 py-1 text-[0.68rem] font-bold transition-colors",
                        activeExpressionCategory === cat.id
                          ? "border-accent/60 bg-accent-soft text-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised"
                      )}
                      onClick={() => setActiveExpressionCategory(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {(() => {
                  const filteredActions = availableExpressionActions.filter(
                    (action: ExpressionAction) => action.name !== null && getExpressionCategory(action) === activeExpressionCategory
                  );

                  if (filteredActions.length > 0) {
                    return (
                      <div className="space-y-2.5">
                        {filteredActions.map((action: ExpressionAction) => {
                          const name = action.name!;
                          const weight = expressionWeights[name] ?? 0;
                          // "기타/커스텀" 카테고리엔 제작자가 스냅(0/1)으로 표시해 둔 표정(isBinary)이
                          // 섞여 있을 수 있어, 슬라이더 대신 켜기/끄기 토글로 보여준다.
                          const isBinary = vrm?.expressionManager?.getExpression(name)?.isBinary ?? false;
                          return (
                            <div key={name} className="flex items-center gap-2 text-[0.65rem] text-fg-3">
                              <span className="w-20 shrink-0 truncate font-semibold text-fg-2" title={action.label}>
                                {action.label}:
                              </span>
                              {isBinary ? (
                                <button
                                  type="button"
                                  disabled={!vrm}
                                  onClick={() => updateExpressionWeight(name, weight > 0 ? 0 : 1)}
                                  className={cx(
                                    "h-2 flex-1 rounded-full border transition-colors",
                                    weight > 0 ? "border-accent bg-accent" : "border-line bg-card"
                                  )}
                                  aria-pressed={weight > 0}
                                  aria-label={`${action.label} 켜기/끄기`}
                                />
                              ) : (
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={weight}
                                  disabled={!vrm}
                                  aria-label={`${action.label} 표정 강도`}
                                  className="h-2 flex-1 accent-accent"
                                  onChange={(e) => updateExpressionWeight(name, Number(e.target.value))}
                                />
                              )}
                              <span className="w-8 text-right numeral">{Math.round(weight * 100)}%</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  return (
                    <p className="text-center py-2 text-[0.68rem] text-fg-3">이 카테고리에 해당하는 표정이 없습니다.</p>
                  );
                })()}

                <button
                  type="button"
                  className="mt-3 w-full rounded-lg border border-line bg-card py-1.5 text-xs text-fg hover:bg-raised disabled:opacity-45"
                  disabled={!vrm || Object.keys(expressionWeights).length === 0}
                  onClick={() => {
                    setExpressionWeights({});
                    setActiveExpressionId("neutral");
                    if (vrmRef.current) {
                      applyExpressionWeightsToVrm(vrmRef.current, {});
                    }
                  }}
                >
                  표정 믹스 초기화
                </button>
              </section>

              <section hidden={hideOnTab("pose")}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                    <UserRound size={15} className="text-accent" aria-hidden />
                    포즈
                  </h3>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={!vrm}
                      onClick={() => handleMirrorPose("all")}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-[0.68rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
                      title="현재 포즈를 좌우로 반전"
                    >
                      <FlipHorizontal2 size={11} aria-hidden /> 반전
                    </button>
                    <button
                      type="button"
                      disabled={!vrm}
                      onClick={handleCopyPose}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-[0.68rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
                      title="클립보드로 포즈 데이터 복사"
                    >
                      복사
                    </button>
                    <button
                      type="button"
                      disabled={!vrm}
                      onClick={handlePastePose}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-[0.68rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
                      title="클립보드 포즈 데이터 붙여넣기"
                    >
                      붙여넣기
                    </button>
                    <button
                      type="button"
                      disabled={!vrm || vrmCreativeReadOnly}
                      onClick={handleSavePose}
                      className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft/40 px-2 py-1 text-[0.68rem] font-bold text-accent hover:bg-accent-soft disabled:opacity-45"
                    >
                      <Sparkles size={11} /> 저장
                    </button>
                  </div>
                </div>

                <div className="mb-3 rounded-xl border border-accent/25 bg-accent-soft/20 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[0.7rem] font-bold text-fg">뷰포트 관절 핸들 · 손발 IK</p>
                      <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">
                        손·발 마름모는 목표를, 주황색 P는 팔꿈치·무릎 방향을 조절합니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={jointHandlesVisible}
                      disabled={!vrm}
                      onClick={() => {
                        setJointHandlesVisible((visible: boolean) => !visible);
                        setJointHandleStatus("");
                      }}
                      className={cx(
                        "min-h-11 min-w-11 shrink-0 rounded-lg border px-2.5 py-1.5 text-[0.68rem] font-bold transition-colors disabled:opacity-45",
                        jointHandlesVisible
                          ? "border-accent/60 bg-accent-soft text-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised",
                      )}
                    >
                      {jointHandlesVisible ? "핸들 켜짐" : "핸들 꺼짐"}
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[0.62rem] font-bold text-fg-3">이동 방식</p>
                      <div
                        className="flex max-w-full gap-1 overflow-x-auto"
                        role="group"
                        aria-label="IK 핸들 이동 방식"
                      >
                        {STUDIO_VRM_IK_DRAG_MODES.map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            aria-pressed={ikHandleDragMode === mode.id}
                            disabled={!vrm || jointHandleInteracting}
                            title={mode.description}
                            onClick={() => {
                              cancelJointIkTransaction();
                              setIkHandleDragMode(mode.id);
                              setJointHandleStatus(
                                mode.id === "depth"
                                  ? "깊이 이동 · 위로 끌면 멀리, 아래로 끌면 가까이 이동합니다."
                                  : "화면 이동 · 현재 화면과 나란한 평면에서 움직입니다.",
                              );
                            }}
                            className={cx(
                              "min-h-11 min-w-11 flex-1 rounded-lg border px-2 text-[0.66rem] font-bold transition-colors disabled:opacity-45",
                              ikHandleDragMode === mode.id
                                ? "border-accent/60 bg-accent-soft text-accent"
                                : "border-line bg-card text-fg-2 hover:bg-raised",
                            )}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[0.62rem] font-bold text-fg-3">축 제한</p>
                      <div
                        className="flex max-w-full gap-1 overflow-x-auto"
                        role="group"
                        aria-label="IK 핸들 축 제한"
                      >
                        {STUDIO_VRM_IK_AXIS_LOCKS.map((axis) => (
                          <button
                            key={axis.id}
                            type="button"
                            aria-pressed={ikHandleAxisLock === axis.id}
                            disabled={!vrm || jointHandleInteracting}
                            title={axis.description}
                            onClick={() => {
                              cancelJointIkTransaction();
                              setIkHandleAxisLock(axis.id);
                              setJointHandleStatus(`IK 핸들 ${axis.description} 모드입니다.`);
                            }}
                            className={cx(
                              "min-h-11 min-w-11 flex-1 rounded-lg border px-2 text-[0.66rem] font-bold transition-colors disabled:opacity-45",
                              ikHandleAxisLock === axis.id
                                ? "border-accent/60 bg-accent-soft text-accent"
                                : "border-line bg-card text-fg-2 hover:bg-raised",
                            )}
                          >
                            {axis.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {webcamActive || idleAnimation ? (
                    <p className="mt-1.5 text-[0.65rem] text-warn" role="status">
                      실시간 추적 또는 대기 애니메이션을 끄면 관절 핸들을 편집할 수 있습니다.
                    </p>
                  ) : null}
                  {jointHandleStatus ? (
                    <p className="mt-1.5 text-[0.65rem] leading-relaxed text-fg-2" role="status" aria-live="polite">
                      {jointHandleStatus}
                    </p>
                  ) : null}
                </div>

                <StudioVrmRigAssistPanel
                  disabled={!vrm || webcamActive || idleAnimation || isCapturing || persistentIkReconciling}
                  jointProfile={rigJointProfile}
                  fullBodyIk={fullBodyIkEnabled}
                  footPlant={footPlantEnabled}
                  floorHeight={rigFloorHeight}
                  rootYOffset={customYOffset}
                  translations={poseTranslations}
                  ikConstraints={ikConstraints}
                  onJointProfileChange={(profile) => {
                    cancelJointIkTransaction();
                    setRigJointProfile(profile);
                    setJointHandleStatus("");
                  }}
                  onFullBodyIkChange={(enabled) => {
                    cancelJointIkTransaction();
                    setFullBodyIkEnabled(enabled);
                    setJointHandleStatus("");
                  }}
                  onFootPlantChange={(enabled) => {
                    cancelJointIkTransaction();
                    setFootPlantEnabled(enabled);
                    setJointHandleStatus("");
                  }}
                  onFloorHeightChange={(height) => {
                    cancelJointIkTransaction();
                    setRigFloorHeight(height);
                    setJointHandleStatus("");
                  }}
                  onResetTranslations={() => {
                    cancelJointIkTransaction({ restoreBaseline: false });
                    const cleared = cloneStudioVrmPoseTranslations(
                      EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
                    );
                    setPoseTranslations(cleared);
                    setCustomYOffset(0);
                    const currentVrm = vrmRef.current;
                    if (currentVrm) {
                      applyPoserVisualState(currentVrm, {
                        bones: customBones,
                        yOffset: 0,
                        poseTranslations: cleared,
                        fingerEdits: effectiveFingerEdits,
                        bodyScale,
                      });
                    }
                    setJointHandleStatus("저장된 root·골반·척추 이동을 초기화했습니다.");
                  }}
                  onConstraintEnabledChange={(effector, enabled) => {
                    commitIkConstraintSettings(
                      ikConstraints.map((constraint: StudioVrmIkConstraint) => (
                        constraint.effector === effector ? { ...constraint, enabled } : constraint
                      )),
                      enabled ? "고정점을 다시 활성화했습니다." : "고정점을 계산과 화면에서 제외했습니다.",
                    );
                  }}
                  onConstraintLockedChange={(effector, locked) => {
                    commitIkConstraintSettings(
                      ikConstraints.map((constraint: StudioVrmIkConstraint) => (
                        constraint.effector === effector ? { ...constraint, locked } : constraint
                      )),
                      locked ? "다른 포즈 편집 중에도 고정점을 유지합니다." : "고정점 유지 잠금을 해제했습니다.",
                    );
                  }}
                  onConstraintRemove={(effector) => {
                    if (selectedIkPole === effector) setSelectedIkPole(null);
                    commitIkConstraintSettings(
                      removeStudioVrmIkConstraint(ikConstraints, effector),
                      "손·발 고정점을 삭제했습니다.",
                    );
                  }}
                />

                <label className="mb-3 flex items-center gap-2 text-xs text-fg-2 cursor-pointer bg-card/30 border border-line/50 p-2 rounded-lg hover:bg-raised/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={preserveExpression}
                    onChange={(e) => setPreserveExpression(e.target.checked)}
                    className="size-3.5 accent-accent cursor-pointer"
                  />
                  <span className="font-medium">포즈 적용 시 캐릭터 표정 유지</span>
                </label>

                <StudioVrmPhotoPoseScanner
                  disabled={poseMaterialRuntimeDisabled}
                  onApply={handlePhotoPoseApply}
                />

                <StudioVrmPoseMaterialPanel
                  disabled={poseMaterialRuntimeDisabled}
                  activeMaterialId={
                    activePoseId.startsWith("pose-material:")
                      ? activePoseId.slice("pose-material:".length)
                      : null
                  }
                  lockedBoneCount={portableLockedPoseBones().length}
                  onCapture={handleCapturePoseMaterial}
                  onApply={handleApplyPoseMaterial}
                  onMaterialDeleted={handlePoseMaterialProvenanceInvalidated}
                  onMaterialReplaced={handlePoseMaterialProvenanceInvalidated}
                />

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {STUDIO_VRM_POSE_BUCKETS.map((bucket) => {
                    const count =
                      bucket.id === "all"
                        ? allPoseListItems.length
                        : filterStudioVrmPosesByBucket(allPoseListItems, bucket.id, recentPoseState.ids).length;
                    return (
                      <button
                        key={bucket.id}
                        type="button"
                        title={`${bucket.hint} · ${studioVrmPoseBucketCountLabel(bucket.id, count)}`}
                        aria-pressed={poseBucket === bucket.id}
                        className={cx(
                          "min-h-8 rounded-full border px-2.5 text-[0.65rem] font-bold transition-colors",
                          poseBucket === bucket.id
                            ? "border-accent/55 bg-accent text-on-accent"
                            : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        onClick={() => setPoseBucket(bucket.id)}
                      >
                        {bucket.label}
                        <span className="ml-1 opacity-75">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="relative mb-3">
                  <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
                  <input
                    type="search"
                    value={poseQuery}
                    onChange={(e) => setPoseQuery(e.target.value)}
                    placeholder="포즈 검색 (이름 · 분위기)"
                    aria-label="포즈 검색"
                    className="w-full rounded-lg border border-line bg-card py-1.5 pl-8 pr-3 text-xs text-fg placeholder:text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  />
                </div>
                {poseResultCount === 0 ? (
                  <p className="rounded-xl border border-dashed border-line/55 bg-card/20 py-4 text-center text-[0.68rem] italic text-fg-3">
                    {poseQ
                      ? `“${poseQuery}” 검색 결과가 없습니다.`
                      : poseBucket === "recent"
                        ? "최근에 쓴 포즈가 없습니다. 포즈를 선택하면 여기에 쌓입니다."
                        : "이 분류에 맞는 포즈가 없습니다."}
                  </p>
                ) : null}

                <div className={cx("grid grid-cols-2 gap-2", poseQ && !POSE_PRESETS.some(poseMatches) && "hidden")}>
                  {POSE_PRESETS.filter(poseMatches).map((pose) => (
                    <button
                      key={pose.id}
                      type="button"
                      className={cx(
                        "min-h-[3.2rem] rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                        activePoseId === pose.id
                          ? "border-accent/55 bg-accent-soft text-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                      )}
                      disabled={!vrm}
                      onClick={() => handlePoseSelect(pose.id)}
                    >
                      <span className="block text-xs font-bold">{pose.label}</span>
                      <span className="mt-0.5 block text-[0.68rem] text-fg-3">{pose.tone}</span>
                    </button>
                  ))}
                </div>

                {/* 자연 아이들 포즈 — 캐릭터 스폰 시 자동 적용되는 비대칭 컨트라포스토 대기 */}
                <div className={cx("mt-3.5 border-t border-line/45 pt-3", poseQ && !NATURAL_IDLE_POSES.some(poseMatches) && "hidden")}>
                  <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">자연 대기 · 스폰 포즈 ({poseQ ? NATURAL_IDLE_POSES.filter(poseMatches).length : NATURAL_IDLE_POSES.length})</p>
                  <div className="grid grid-cols-2 gap-2">
                    {NATURAL_IDLE_POSES.filter(poseMatches).map((pose) => (
                      <button
                        key={pose.id}
                        type="button"
                        className={cx(
                          "min-h-[3.2rem] rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                          activePoseId === pose.id
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        disabled={!vrm}
                        onClick={() => handlePoseSelect(pose.id)}
                      >
                        <span className="block text-xs font-bold">{pose.label}</span>
                        <span className="mt-0.5 block text-[0.68rem] text-fg-3">{pose.tone}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 확장 포즈 프리셋(studio-pose-presets) — 코미Po!식 상황별 포즈 팩 */}
                <div className={cx("mt-3.5 border-t border-line/45 pt-3", poseQ && !EXTRA_POSE_PRESETS.some(poseMatches) && "hidden")}>
                  <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">확장 포즈 팩 ({poseQ ? EXTRA_POSE_PRESETS.filter(poseMatches).length : EXTRA_POSE_PRESETS.length})</p>
                  <div className="grid grid-cols-2 gap-2">
                    {EXTRA_POSE_PRESETS.filter(poseMatches).map((pose) => (
                      <button
                        key={pose.id}
                        type="button"
                        className={cx(
                          "min-h-[3.2rem] rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                          activePoseId === pose.id
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        disabled={!vrm}
                        onClick={() => handlePoseSelect(pose.id)}
                      >
                        <span className="block text-xs font-bold">{pose.label}</span>
                        <span className="mt-0.5 block text-[0.68rem] text-fg-3">{pose.tone}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={cx("mt-3.5 space-y-2 border-t border-line/45 pt-3", poseQ && !savedPoses.some(poseMatches) && "hidden")}>
                  <div className="flex items-center justify-between">
                    <p className="text-[0.65rem] font-bold text-fg-3 uppercase tracking-wider">내가 만든 포즈 ({savedPoses.length})</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={handleExportPoses}
                        disabled={savedPoses.length === 0}
                        className="inline-flex items-center rounded border border-line bg-card px-1.5 py-0.5 text-[0.68rem] font-bold text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"
                        title="JSON 파일로 백업 내보내기"
                      >
                        내보내기
                      </button>
                      <button
                        type="button"
                        onClick={handleImportPoses}
                        disabled={vrmCreativeReadOnly}
                        className="inline-flex items-center rounded border border-line bg-card px-1.5 py-0.5 text-[0.68rem] font-bold text-fg-2 hover:bg-raised hover:text-fg"
                        title="JSON 포즈 파일 가져오기"
                      >
                        가져오기
                      </button>
                    </div>
                  </div>

                  {vrmCreativePersistenceMessage ? (
                    <p
                      className={cx(
                        "rounded-lg border px-2.5 py-2 text-[0.65rem] leading-relaxed",
                        vrmCreativePersistenceStatus === "memory"
                          || vrmCreativePersistenceStatus === "read-error"
                          ? "border-warn/35 bg-warn/10 text-warn"
                          : "border-line/55 bg-card/35 text-fg-3",
                      )}
                      role="status"
                      aria-live="polite"
                      data-studio-vrm-creative-authority={vrmCreativePersistenceStatus}
                    >
                      {vrmCreativePersistenceMessage}
                    </p>
                  ) : null}
                  
                  {savedPoses.length === 0 ? (
                    <p className="text-center py-4 text-[0.68rem] text-fg-3/60 italic bg-card/20 rounded-xl border border-dashed border-line/55">
                      저장된 커스텀 포즈가 없습니다.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {savedPoses.filter((pose: CustomPose) => poseMatches(pose)).map((pose: CustomPose) => (
                        <div
                          key={pose.id}
                          className={cx(
                            "relative flex min-h-[3.2rem] flex-col justify-center rounded-xl border px-3 py-2 text-left transition-colors",
                            activePoseId === pose.id
                              ? "border-accent/55 bg-accent-soft text-accent"
                              : "border-line bg-card text-fg-2"
                          )}
                        >
                          <button
                            type="button"
                            className="w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            disabled={!vrm}
                            onClick={() => handleCustomPoseSelect(pose)}
                          >
                            <span className="block text-xs font-bold truncate pr-5">{pose.label}</span>
                            <span className="mt-0.5 block text-[0.65rem] text-fg-3">Y-Offset: {pose.yOffset.toFixed(2)}m</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeletePose(pose.id, e)}
                            disabled={vrmCreativeReadOnly}
                            className="absolute right-2 top-2 grid size-5 place-items-center rounded-md text-fg-3 hover:bg-raised hover:text-bad"
                            aria-label="포즈 삭제"
                            title="삭제"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
              </>
  );
}
