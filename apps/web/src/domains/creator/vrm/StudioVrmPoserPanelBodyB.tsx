/**
 * Studio VRM poser view slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this component destructures the original local names.
 */
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  PersonStanding,
  Shirt,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import * as THREE from "three";

import {
  POSER_FINGER_BONES,
} from "../studio-pose-presets";

import {
  getStudioVrmJointLimit,
} from "./studio-vrm-joint-limits";
import {
  BONE_CATEGORIES,
  BONE_LABELS,
  COSTUME_PRESETS,
} from "./studio-vrm-poser-catalogs";
import {
  cx,
  findPoseById,
  resolveStudioVrmJointHandleBone,
} from "./studio-vrm-poser-helpers";
import {
  applyVrmCustomColors,
  getPoseBoneRotation,
  ZERO_ROTATION,
} from "./studio-vrm-poser-utils";
import {
  WARDROBE_SLOTS,
  WARDROBE_SLOT_LABELS,
  WARDROBE_FABRICS,
  SELECTABLE_WARDROBE_SETS,
  WARDROBE_FIT_MIN,
  WARDROBE_FIT_MAX,
  selectableWardrobeItemsBySlot,
  wardrobeItemById,
  type WardrobeEquip,
} from "./studio-vrm-wardrobe";
import {
  VrmColorControl,
} from "./StudioVrmColorControl";
import { DEFAULT_VRM_CUSTOM_COLORS } from "./StudioVrmPoserTypes";

import type { FingerRotationMap, PoseBoneMap } from "./studio-vrm-poser-utils";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { CustomPose } from "./StudioVrmPoserTypes";
import type { SharedAssetCatalogItem } from "@/src/infrastructure/creator-client";
import type {
  VRM,
} from "@pixiv/three-vrm";

export function StudioVrmPoserPanelBodyB({ h }: { h: StudioVrmPoserHost }) {
  const {
    vrm,
    activePoseId,
    customBones,
    setCustomBones,
    customYOffset,
    activeCategory,
    setActiveCategory,
    jointLimitsEnabled,
    setJointLimitsEnabled,
    lockedPoseBones,
    showPoseBoneOverlay,
    setShowPoseBoneOverlay,
    selectedViewportPoseBone,
    setSelectedViewportPoseBone,
    viewportHandIkEnabled,
    setViewportHandIkEnabled,
    setIsViewportHandIkDragging,
    mannequinMode,
    setMannequinMode,
    selectedJointHandle,
    setSelectedJointHandle,
    isCapturing,
    isThumbnailCapturing,
    bodyScale,
    setBodyScale,
    fingerEdits,
    setFingerEdits,
    customColors,
    setCustomColors,
    isSharingPose,
    sharedPoses,
    sharedPosesStatus,
    setSharedPoseLibraryOpen,
    setSharedPoseReloadToken,
    sharedPoseNextOffset,
    sharedPoseHasMore,
    sharedPoseSelectionAssetId,
    savedPoses,
    wardrobeState,
    wardrobeSurfaceReceipts,
    wardrobeAutoHide,
    wardrobeFitReport,
    wardrobeInteractionLocked,
    idleAnimation,
    webcamActive,
    vrmRef,
    manualPoseDetailsRef,
    persistentIkReconciling,
    loadMoreSharedPoses,
    handleSelectSharedPose,
    handleDeleteSharedPose,
    handleBakeCurrentPoseForManualEditing,
    hideOnTab,
    hideOnCharacterSection,
    handleSharePoseToServer,
    handleResetActivePose,
    handleMirrorPose,
    handleStraightenUpperBody,
    togglePoseBoneLock,
    handleBoneRotationChange,
    handleYOffsetChange,
    equipWardrobeItem,
    updateWardrobeEquip,
    equipWardrobeSetById,
    clearWardrobe,
    applyWardrobeFitSuggestions,
    toggleWardrobeAutoHide,
  } = h;
  return (
              <>
              <details
                hidden={hideOnTab("pose")}
                className="group rounded-xl border border-line bg-card/45 p-3"
                onToggle={(event) => setSharedPoseLibraryOpen(event.currentTarget.open)}
              >
                <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Sparkles size={15} className="text-accent" aria-hidden />
                  서버 공유 포즈 라이브러리
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    disabled={
                      !vrm
                      || (!isSharingPose && (
                        persistentIkReconciling
                        || webcamActive
                        || idleAnimation
                        || isCapturing
                        || isThumbnailCapturing
                      ))
                    }
                    onClick={() => void handleSharePoseToServer()}
                    className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft/40 px-2 py-1 text-[0.68rem] font-bold text-accent hover:bg-accent-soft disabled:opacity-45"
                  >
                    {isSharingPose ? <Loader2 className="animate-spin" size={11} /> : <Upload size={11} />}
                    {isSharingPose ? "공유 취소" : "포즈 서버에 공유"}
                  </button>
                </div>
                <p className="mb-3 text-[0.68rem] leading-relaxed text-fg-3">
                  다른 웹툰 작가들이 공유한 포즈를 내 캐릭터에 즉시 입히고, 나만의 멋진 포즈를 서버에 올려 공유하세요!
                </p>

                {sharedPosesStatus === "error" ? (
                  <div className="rounded-xl border border-warn/35 bg-warn/10 px-3 py-3 text-center text-xs text-fg-2" role="status">
                    <p>공유 포즈 서버에 연결하지 못했습니다. 로컬 포즈 편집은 계속 사용할 수 있습니다.</p>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center rounded-lg border border-line bg-card px-2 py-1 text-[0.68rem] font-bold text-fg hover:bg-raised"
                      onClick={() => setSharedPoseReloadToken((token: number) => token + 1)}
                    >
                      다시 시도
                    </button>
                  </div>
                ) : sharedPosesStatus === "loading" && sharedPoses.length === 0 ? (
                  <div className="rounded-xl border border-line bg-card/60 px-3 py-4 text-center text-xs text-fg-3">
                    공유된 포즈를 불러오는 중입니다...
                  </div>
                ) : sharedPoses.length === 0 ? (
                  <p className="text-center py-4 text-[0.68rem] text-fg-3/60 italic bg-card/20 rounded-xl border border-dashed border-line/55">
                    서버에 등록된 공유 포즈가 없습니다. 첫 포즈를 공유해 보세요!
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 lg:max-h-[220px] lg:overflow-y-auto lg:pr-1">
                    {sharedPoses.map((asset: SharedAssetCatalogItem) => {
                      const isActive = activePoseId === `shared-${asset.id}`;
                      return (
                        <div
                          key={asset.id}
                          className={cx(
                            "relative flex min-h-[4rem] flex-col justify-between rounded-xl border p-2 text-left transition-colors",
                            isActive
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-card text-fg-2 hover:bg-raised"
                          )}
                        >
                            <button
                              type="button"
                              className="flex h-full w-full flex-col justify-between rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                              disabled={!vrm || sharedPoseSelectionAssetId === asset.id}
                              onClick={() => handleSelectSharedPose(asset)}
                            >
                            <div className="min-w-0">
                              <span className="block text-[0.7rem] font-bold truncate pr-4 text-fg" title={asset.name.replace("[3D_POSE] ", "")}>
                                {asset.name.replace("[3D_POSE] ", "")}
                              </span>
                              <span className="block text-[0.68rem] text-fg-3 truncate">
                                작성자: {asset.author?.name || "익명"}
                              </span>
                            </div>
                            <span className="mt-1 block text-[0.68rem] text-fg-3 font-semibold">
                              다운로드 {asset.downloads}회
                            </span>
                              {sharedPoseSelectionAssetId === asset.id ? (
                                <span className="mt-1 block text-[0.64rem] text-accent">적용 중…</span>
                              ) : null}
                          </button>
                          {asset.isOwner && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSharedPose(asset, e)}
                              className="absolute right-2 top-2 grid size-5 place-items-center rounded-md text-fg-3 hover:bg-raised hover:text-bad"
                              aria-label="포즈 삭제"
                              title="서버에서 삭제"
                            >
                              <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
                {sharedPoseHasMore && sharedPoseNextOffset !== null ? (
                  <button
                    type="button"
                    className="mt-1 inline-flex w-full items-center justify-center rounded-lg border border-accent/40 bg-accent-soft/30 px-2 py-1.5 text-[0.68rem] font-bold text-accent hover:bg-accent-soft disabled:opacity-45"
                    disabled={sharedPosesStatus === "loading"}
                    onClick={() => void loadMoreSharedPoses()}
                  >
                    {sharedPosesStatus === "loading" ? "추가 항목 불러오는 중..." : "더 보기"}
                  </button>
                ) : null}
              </details>

              <section
                id="vrm-character-section-wardrobe"
                role="tabpanel"
                aria-labelledby="vrm-character-subtab-wardrobe"
                aria-busy={wardrobeInteractionLocked || undefined}
                hidden={hideOnCharacterSection("wardrobe")}
                className="rounded-xl border border-line bg-card/45 p-3"
              >
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold text-fg">
                  <Shirt size={14} className="text-accent" aria-hidden />
                  몸 맞춤 3D 워드로브
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.68rem] font-bold text-accent">Body Fit v2</span>
                  <span className="rounded-full bg-good/12 px-1.5 py-0.5 text-[0.68rem] font-bold text-good">Skin v1</span>
                </h3>
                <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                  실제 스킨 골격의 체형을 다시 재고, 팔꿈치·무릎을 지나는 옷은 같은 골격의 혼합 웨이트로 부드럽게 변형합니다. 안쪽 옷보다 겉옷이 바깥에 오도록 여유도 맞춥니다. 천 물리는 다음 실험 단계이며 지금은 안정적인 포즈 변형과 겹침 예방에 집중합니다.
                </p>

                {Object.keys(wardrobeState).length > 0 ? (
                  <div
                    data-testid="wardrobe-fit-status"
                    className={cx(
                      "mb-3 rounded-xl border px-2.5 py-2",
                      wardrobeFitReport.status === "ready"
                        ? "border-good/35 bg-good/10"
                        : wardrobeFitReport.status === "warning"
                          ? "border-warn/40 bg-warn/10"
                          : "border-line bg-card",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {wardrobeFitReport.status === "ready" ? (
                        <Sparkles size={14} className="mt-0.5 shrink-0 text-good" aria-hidden />
                      ) : (
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.7rem] font-bold text-fg">
                          {wardrobeFitReport.status === "ready"
                            ? wardrobeFitReport.autoAdjusted ? "자동 여유 적용됨" : "맞춤 양호"
                            : wardrobeFitReport.status === "warning" ? "맞춤 확인 필요" : "체형 측정 대기 중"}
                        </p>
                        <p className="mt-0.5 text-[0.64rem] leading-relaxed text-fg-3">
                          {wardrobeFitReport.issues[0]?.message
                            ?? "몸과 의상 레이어 사이에 권장 여유가 확보되었습니다."}
                        </p>
                      </div>
                    </div>
                    {wardrobeFitReport.issues.some((issue: { severity: string; suggestedFit?: string | null }) => issue.severity === "warning" && issue.suggestedFit !== undefined) ? (
                      <button
                        type="button"
                        disabled={wardrobeInteractionLocked}
                        className="mt-2 min-h-9 w-full rounded-lg border border-warn/40 bg-card px-2 text-[0.66rem] font-bold text-fg hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                        onClick={applyWardrobeFitSuggestions}
                      >
                        권장 여유값 적용
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* 원클릭 코디 세트 */}
                <div className="mb-3 space-y-1.5 border-b border-line/35 pb-3">
                  <p className="text-[0.65rem] font-bold text-fg-2">원클릭 코디 세트</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SELECTABLE_WARDROBE_SETS.map((set) => (
                      <button
                        key={set.id}
                        type="button"
                        disabled={!vrm || wardrobeInteractionLocked}
                        onClick={() => equipWardrobeSetById(set.id)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-card px-2 py-1.5 text-left text-[0.68rem] font-medium text-fg transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="text-xs" aria-hidden>{set.emoji}</span>
                        <span className="truncate">{set.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 슬롯별 장착 */}
                <div className="space-y-2.5">
                  {WARDROBE_SLOTS.map((slot) => {
                    const equip = wardrobeState[slot];
                    const equippedDef = equip ? wardrobeItemById(equip.itemId) : undefined;
                    const slotFit = wardrobeFitReport.slots[slot];
                    const surfaceReceipt = wardrobeSurfaceReceipts[slot];
                    return (
                      <div key={slot} className="rounded-lg border border-line/60 bg-card/60 p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <p className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[0.65rem] font-bold text-fg-2">
                            {WARDROBE_SLOT_LABELS[slot]}
                            {equippedDef ? <span className="ml-1 font-semibold text-accent">{equippedDef.label}</span> : null}
                            {equip && surfaceReceipt ? (
                              <span
                                data-testid={`wardrobe-surface-${slot}`}
                                data-garment-runtime={surfaceReceipt.mode}
                                className={cx(
                                  "rounded-full px-1.5 py-0.5 text-[0.58rem] font-bold",
                                  surfaceReceipt.mode === "skinned-shell-v1"
                                    ? "bg-good/12 text-good"
                                    : surfaceReceipt.mode === "xpbd-skirt-v1"
                                      ? "bg-accent/12 text-accent"
                                      : "bg-warn/12 text-warn",
                                )}
                                title={surfaceReceipt.mode === "xpbd-skirt-v1"
                                  ? `신체 캡슐 충돌 · 정점 ${surfaceReceipt.vertexCount.toLocaleString("ko-KR")}개 · 자기 충돌은 아직 지원하지 않습니다.`
                                  : surfaceReceipt.mode === "skinned-shell-v1"
                                    ? `${surfaceReceipt.boneCount}개 관절 · 혼합 정점 ${surfaceReceipt.blendedVertexCount.toLocaleString("ko-KR")}개`
                                    : "이 VRM의 골격 구조에서는 안정적인 기존 부착 방식으로 표시합니다."}
                              >
                                {surfaceReceipt.mode === "xpbd-skirt-v1"
                                  ? "천 물리 · 자기충돌 X"
                                  : surfaceReceipt.mode === "skinned-shell-v1"
                                    ? "관절 스키닝"
                                    : "호환 장착"}
                              </span>
                            ) : null}
                          </p>
                          {equip ? (
                            <button
                              type="button"
                              disabled={wardrobeInteractionLocked}
                              onClick={() => equipWardrobeItem(slot, null)}
                              className="rounded-md px-1.5 py-0.5 text-[0.68rem] font-semibold text-fg-3 hover:bg-raised hover:text-bad disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              해제
                            </button>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {selectableWardrobeItemsBySlot(slot).map((item) => {
                            const active = equip?.itemId === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                disabled={!vrm || wardrobeInteractionLocked}
                                aria-pressed={active}
                                title={item.hint}
                                onClick={() => equipWardrobeItem(slot, active ? null : item.id)}
                                className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[0.66rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                  active ? "border-accent bg-accent/15 text-fg" : "border-line bg-card text-fg-2 hover:bg-raised"
                                }`}
                              >
                                <span className="text-sm" aria-hidden>{item.emoji}</span>
                                <span className="w-full truncate text-center">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        {equip ? (
                          <div className="mt-2 space-y-2 border-t border-line/40 pt-2">
                            <div className="grid grid-cols-[auto_1fr] gap-2">
                              <label className="flex min-h-11 items-center gap-1 text-[0.68rem] font-semibold text-fg-2">
                                색
                                <input
                                  type="color"
                                  disabled={wardrobeInteractionLocked}
                                  value={equip.color}
                                  onChange={(e) => updateWardrobeEquip(slot, { color: e.target.value })}
                                  className="size-8 cursor-pointer rounded border border-line bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:size-11"
                                  aria-label={`${WARDROBE_SLOT_LABELS[slot]} 색상`}
                                />
                              </label>
                              <label className="flex min-w-0 items-center gap-1.5 text-[0.68rem] font-semibold text-fg-2">
                                소재
                                <select
                                  disabled={wardrobeInteractionLocked}
                                  value={equip.fabricId}
                                  onChange={(event) => updateWardrobeEquip(slot, { fabricId: event.target.value as WardrobeEquip["fabricId"] })}
                                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-card px-2 text-[0.68rem] text-fg focus:border-accent focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                                  aria-label={`${WARDROBE_SLOT_LABELS[slot]} 소재`}
                                >
                                  {WARDROBE_FABRICS.map((fabric) => (
                                    <option key={fabric.id} value={fabric.id}>{fabric.label}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[0.66rem] font-semibold text-fg-2">몸 맞춤</span>
                              <div className="grid grid-cols-2 rounded-lg border border-line bg-card p-0.5" role="group" aria-label={`${WARDROBE_SLOT_LABELS[slot]} 몸 맞춤 방식`}>
                                {(["auto", "manual"] as const).map((mode) => (
                                  <button
                                    key={mode}
                                    type="button"
                                    disabled={wardrobeInteractionLocked}
                                    aria-pressed={equip.fitMode === mode}
                                    onClick={() => updateWardrobeEquip(slot, { fitMode: mode })}
                                    className={cx(
                                      "min-h-8 rounded-md px-2 text-[0.64rem] font-bold disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-10",
                                      equip.fitMode === mode ? "bg-accent text-on-accent" : "text-fg-3 hover:bg-raised",
                                    )}
                                  >
                                    {mode === "auto" ? "자동" : "직접"}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <label className="flex items-center gap-1.5 text-[0.68rem] font-semibold text-fg-2">
                              여유
                              <input
                                type="range"
                                disabled={wardrobeInteractionLocked}
                                min={WARDROBE_FIT_MIN}
                                max={WARDROBE_FIT_MAX}
                                step={0.02}
                                value={equip.fit}
                                onChange={(e) => updateWardrobeEquip(slot, { fit: Number(e.target.value) })}
                                className="h-2 flex-1 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
                                aria-label={`${WARDROBE_SLOT_LABELS[slot]} 기본 여유`}
                              />
                              <span className="w-9 text-right tabular-nums text-fg-3">{Math.round(equip.fit * 100)}%</span>
                            </label>
                            {slotFit && Math.abs(slotFit.effectiveFit - equip.fit) > 0.001 ? (
                              <p className="rounded-md bg-accent-soft/45 px-2 py-1 text-[0.62rem] leading-relaxed text-accent">
                                겹침을 막기 위해 화면에는 {Math.round(slotFit.effectiveFit * 100)}% 여유로 표시됩니다. 저장된 기본값은 바뀌지 않습니다.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-card/60 p-2">
                  <div className="min-w-0">
                    <p className="text-[0.68rem] font-semibold text-fg-2">원본 의상 겹침 방지</p>
                    <p className="mt-0.5 text-[0.61rem] leading-relaxed text-fg-3">같은 부위의 VRM 원본 옷만 자동으로 숨깁니다.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={wardrobeAutoHide}
                    aria-label="같은 부위 기존 의상 자동 숨김"
                    disabled={wardrobeInteractionLocked}
                    onClick={toggleWardrobeAutoHide}
                    className={cx(
                      "min-h-9 shrink-0 rounded-lg border px-2.5 text-[0.66rem] font-bold disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11",
                      wardrobeAutoHide
                        ? "border-accent/55 bg-accent text-on-accent"
                        : "border-line bg-card text-fg-2 hover:bg-raised",
                    )}
                  >
                    {wardrobeAutoHide ? "사용 중" : "꺼짐"}
                  </button>
                  <button
                    type="button"
                    disabled={!vrm || Object.keys(wardrobeState).length === 0 || wardrobeInteractionLocked}
                    onClick={clearWardrobe}
                    className="min-h-9 rounded-lg border border-line bg-card px-2 text-[0.65rem] text-fg hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                  >
                    전체 해제
                  </button>
                </div>
              </section>

              <section
                id="vrm-character-section-appearance"
                role="tabpanel"
                aria-labelledby="vrm-character-subtab-appearance"
              hidden={hideOnCharacterSection("appearance")}
              className="rounded-xl border border-line bg-card/45 p-3"
              >
                <div className="mb-4 rounded-xl border border-accent/25 bg-accent-soft/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 text-xs font-bold text-fg">
                        <PersonStanding size={14} className="text-accent" aria-hidden />
                        중립 데생 인형 보기
                      </h3>
                      <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                        캐릭터의 텍스처와 발광을 숨기고 명암·실루엣·관절만 확인합니다. 원래 외형은 언제든 복원됩니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={mannequinMode}
                      aria-label="중립 데생 인형 보기"
                      disabled={!vrm}
                      className={cx(
                        "min-h-9 shrink-0 rounded-lg border px-2.5 text-[0.68rem] font-bold disabled:opacity-45",
                        mannequinMode
                          ? "border-accent/55 bg-accent text-on-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised"
                      )}
                      onClick={() => setMannequinMode((current: boolean) => !current)}
                    >
                      {mannequinMode ? "사용 중" : "켜기"}
                    </button>
                  </div>
                </div>
                {bodyScale.height !== 1 || bodyScale.width !== 1 ? (
                  <div className="mb-4 rounded-xl border border-warning/35 bg-warning/10 p-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-bold text-fg">
                      <UserRound size={14} className="text-warning" aria-hidden />
                      이전 문서의 장면 배율
                    </h3>
                    <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                      이 문서는 예전 키 {bodyScale.height.toFixed(2)}× · 체격 {bodyScale.width.toFixed(2)}× 값을 그대로 재생합니다. 새 문서의 체형은 아바타 조형 &gt; 체형에서 관절 비율 하나로 편집합니다.
                    </p>
                    <button
                      type="button"
                      disabled={!vrm || isCapturing}
                      className="mt-2 min-h-9 rounded-lg border border-warning/45 bg-card px-2.5 text-[0.64rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45 pointer-coarse:min-h-11"
                      onClick={() => setBodyScale({ height: 1, width: 1 })}
                    >
                      새 체형 편집으로 전환
                    </button>
                  </div>
                ) : null}

                <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold text-fg">
                  <Sliders size={14} className="text-accent" aria-hidden />
                  의상 및 신체 색상 변경
                </h3>
                <p className="mb-3 text-[0.68rem] leading-relaxed text-fg-3">
                  캐릭터의 부위별 색상을 자유롭게 변경해 보세요.
                </p>

                {/* 의상 테마 프리셋 */}
                <div className="mb-4 space-y-1.5 border-b border-line/35 pb-3">
                  <p className="text-[0.65rem] font-bold text-fg-2">테마 추천 의상셋</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {COSTUME_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!vrm}
                        onClick={() => {
                          setCustomColors(p.colors);
                          if (vrmRef.current) {
                            applyVrmCustomColors(vrmRef.current, p.colors);
                          }
                          // 테마 채색과 함께 대응하는 3D 의상 세트도 실장착한다(색놀이→진짜 옷).
                          equipWardrobeSetById(p.id);
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2 py-1.5 text-left text-[0.68rem] font-medium text-fg hover:bg-raised disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <span className="text-xs">{p.emoji}</span>
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <p className="mb-2 text-[0.65rem] font-bold text-fg-2">부위별 정밀 채색</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { key: "tops", label: "상의/드레스" },
                    { key: "bottoms", label: "하의/신발" },
                    { key: "hair", label: "머리카락" },
                    { key: "body", label: "피부(몸)" },
                    { key: "face", label: "얼굴" },
                  ].map((part) => (
                    <div key={part.key} className="flex min-w-0 flex-col gap-1">
                      <span className="text-[0.65rem] font-semibold text-fg-2">{part.label}</span>
                      <VrmColorControl
                        label={part.label}
                        value={customColors[part.key] || "#ffffff"}
                        disabled={!vrm}
                        onChange={(hex) => setCustomColors((prev: Record<string, string>) => ({ ...prev, [part.key]: hex }))}
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-3 w-full rounded-lg border border-line bg-card py-1.5 text-xs text-fg hover:bg-raised disabled:opacity-45"
                  disabled={!vrm}
                  onClick={() => {
                    setCustomColors({ ...DEFAULT_VRM_CUSTOM_COLORS });
                  }}
                >
                  색상 초기화
                </button>
              </section>

              <details ref={manualPoseDetailsRef} hidden={hideOnTab("pose")} className="group rounded-xl border border-line bg-card/45 p-3">
                <summary className="mb-2.5 flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Sliders size={14} className="text-accent" aria-hidden />
                  관절 미세 조정 (Manual Pose)
                  <ChevronDown size={13} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>

                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-line/55 bg-panel/40 p-2">
                  <p className="text-[0.65rem] leading-relaxed text-fg-3">
                    방향 기반 프리셋을 현재 보이는 회전값으로 변환하면 슬라이더와 관절 핸들이 정확히 이어집니다.
                  </p>
                  <button
                    type="button"
                    disabled={!vrm || webcamActive || idleAnimation || isCapturing}
                    onClick={handleBakeCurrentPoseForManualEditing}
                    className="shrink-0 rounded-lg border border-line bg-card px-2 py-1 text-[0.65rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
                  >
                    현재 자세 동기화
                  </button>
                </div>
                
                <div className="mb-3 grid gap-2 rounded-lg border border-line/60 bg-panel/35 p-2.5">
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-[0.68rem] font-semibold text-fg-2">
                    <span>
                      관절 안전 범위
                      <span className="ml-1 font-normal text-fg-3">과회전 방지 · 필요 시 해제</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={jointLimitsEnabled}
                      onChange={(event) => setJointLimitsEnabled(event.target.checked)}
                      className="size-3.5 accent-accent"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-[0.68rem] font-semibold text-fg-2">
                    <span>
                      3D 관절 점 선택
                      <span className="ml-1 font-normal text-fg-3">뷰포트에서 관절을 눌러 바로 찾기</span>
                    </span>
                    <input
                      type="checkbox"
                      disabled={!vrm || webcamActive}
                      checked={showPoseBoneOverlay}
                      onChange={(event) => {
                        setShowPoseBoneOverlay(event.target.checked);
                        if (!event.target.checked) {
                          setViewportHandIkEnabled(false);
                          setIsViewportHandIkDragging(false);
                        }
                      }}
                      className="size-3.5 accent-accent"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-[0.68rem] font-semibold text-fg-2">
                    <span>
                      손목 IK 드래그
                      <span className="ml-1 font-normal text-fg-3">초록 손목 점을 화면 평면에서 이동</span>
                    </span>
                    <input
                      type="checkbox"
                      disabled={!vrm || webcamActive}
                      checked={viewportHandIkEnabled}
                      onChange={(event) => {
                        setViewportHandIkEnabled(event.target.checked);
                        if (event.target.checked) setShowPoseBoneOverlay(true);
                        else setIsViewportHandIkDragging(false);
                      }}
                      className="size-3.5 accent-accent"
                    />
                  </label>
                  {showPoseBoneOverlay ? (
                    <p className="text-[0.62rem] leading-relaxed text-fg-3">
                      파랑은 선택, 초록 손목은 IK 드래그, 주황은 잠금, 강조색은 현재 선택입니다. 관절 점은 최종 PNG에 포함되지 않습니다.
                    </p>
                  ) : null}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      disabled={!vrm}
                      onClick={() => handleMirrorPose("arms")}
                      className="rounded-md border border-line bg-card px-2 py-1 text-[0.66rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
                    >
                      팔만 반전
                    </button>
                    <button
                      type="button"
                      disabled={!vrm}
                      onClick={() => handleMirrorPose("legs")}
                      className="rounded-md border border-line bg-card px-2 py-1 text-[0.66rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
                    >
                      다리만 반전
                    </button>
                    <button
                      type="button"
                      disabled={!vrm}
                      onClick={handleStraightenUpperBody}
                      className="rounded-md border border-line bg-card px-2 py-1 text-[0.66rem] font-bold text-fg-2 hover:bg-raised disabled:opacity-45"
                    >
                      상체·목 펴기
                    </button>
                  </div>
                </div>

                <div className="mb-3 flex flex-wrap gap-1">
                  {BONE_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={cx(
                        "rounded-lg border px-2 py-1 text-[0.68rem] font-bold transition-colors",
                        activeCategory === cat.id
                          ? "border-accent/60 bg-accent-soft text-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised"
                      )}
                      onClick={() => setActiveCategory(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-3.5">
                  {(() => {
                    const cat = BONE_CATEGORIES.find((c) => c.id === activeCategory);
                    if (!cat) return null;
                    return cat.bones.map((boneName) => {
                      const label = BONE_LABELS[boneName] || boneName;
                      const isFinger = POSER_FINGER_BONES.includes(boneName);
                      const rot = isFinger
                        ? (fingerEdits[boneName] || [0, 0, 0])
                        : getPoseBoneRotation(customBones[boneName]);
                      const [xRad, yRad, zRad] = rot as [number, number, number];
                      const xDeg = Math.round(THREE.MathUtils.radToDeg(xRad));
                      const yDeg = Math.round(THREE.MathUtils.radToDeg(yRad));
                      const zDeg = Math.round(THREE.MathUtils.radToDeg(zRad));
                      const locked = lockedPoseBones.includes(boneName);
                      const jointLimit = getStudioVrmJointLimit(boneName);
                      const axisBounds = jointLimitsEnabled
                        ? [jointLimit.x, jointLimit.y, jointLimit.z].map((axis) => ({
                            min: Math.ceil(THREE.MathUtils.radToDeg(axis.hardMin)),
                            max: Math.floor(THREE.MathUtils.radToDeg(axis.hardMax)),
                          }))
                        : [0, 1, 2].map(() => ({ min: -180, max: 180 }));

                      return (
                        <div
                          key={boneName}
                          id={`vrm-manual-bone-${boneName}`}
                          data-vrm-pose-bone={boneName}
                          className={cx(
                            "rounded-lg border bg-panel/40 p-2.5 transition-colors",
                            selectedViewportPoseBone === boneName || selectedJointHandle === boneName
                              ? "border-accent/70 ring-1 ring-accent/25"
                              : "border-line/60",
                          )}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="text-left text-[0.7rem] font-bold text-fg-2 hover:text-accent"
                              onClick={() => setSelectedViewportPoseBone(boneName)}
                            >
                              {label}
                            </button>
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-[0.68rem] text-fg-3 hover:text-accent"
                                disabled={!vrm}
                                aria-pressed={locked}
                                onClick={() => togglePoseBoneLock(boneName)}
                              >
                                {locked ? "잠금 해제" : "잠금"}
                              </button>
                              <button
                                type="button"
                                className="text-[0.68rem] text-accent hover:underline animate-fade-in"
                                disabled={!vrm || locked}
                                onClick={() => {
                                  if (isFinger) {
                                    setFingerEdits((prev: FingerRotationMap) => {
                                      const next = { ...prev };
                                      delete next[boneName];
                                      return next;
                                    });
                                  } else {
                                    setCustomBones((prev: PoseBoneMap) => {
                                      return { ...prev, [boneName]: { rotation: ZERO_ROTATION } };
                                    });
                                  }
                                }}
                              >
                                초기화
                              </button>
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2 text-[0.65rem] text-fg-3">
                            <span className="w-8 shrink-0">앞/뒤:</span>
                            <input
                              type="range"
                              min={axisBounds[0].min}
                              max={axisBounds[0].max}
                              value={xDeg}
                              disabled={!vrm || locked}
                              aria-label={`${label} 앞뒤 회전`}
                              className="h-2 flex-1 accent-accent"
                              onFocus={() => {
                                const handleBone = resolveStudioVrmJointHandleBone(boneName);
                                if (handleBone) setSelectedJointHandle(handleBone);
                              }}
                              onChange={(e) => handleBoneRotationChange(boneName, 0, Number(e.target.value))}
                            />
                            <span className="w-8 text-right numeral">{xDeg}°</span>
                          </div>

                          <div className="mt-1.5 flex items-center gap-2 text-[0.65rem] text-fg-3">
                            <span className="w-8 shrink-0">뒤틀기:</span>
                            <input
                              type="range"
                              min={axisBounds[1].min}
                              max={axisBounds[1].max}
                              value={yDeg}
                              disabled={!vrm || locked}
                              aria-label={`${label} 뒤틀기 회전`}
                              className="h-2 flex-1 accent-accent"
                              onFocus={() => {
                                const handleBone = resolveStudioVrmJointHandleBone(boneName);
                                if (handleBone) setSelectedJointHandle(handleBone);
                              }}
                              onChange={(e) => handleBoneRotationChange(boneName, 1, Number(e.target.value))}
                            />
                            <span className="w-8 text-right numeral">{yDeg}°</span>
                          </div>

                          <div className="mt-1.5 flex items-center gap-2 text-[0.65rem] text-fg-3">
                            <span className="w-8 shrink-0">안/밖:</span>
                            <input
                              type="range"
                              min={axisBounds[2].min}
                              max={axisBounds[2].max}
                              value={zDeg}
                              disabled={!vrm || locked}
                              aria-label={`${label} 안팎 회전`}
                              className="h-2 flex-1 accent-accent"
                              onFocus={() => {
                                const handleBone = resolveStudioVrmJointHandleBone(boneName);
                                if (handleBone) setSelectedJointHandle(handleBone);
                              }}
                              onChange={(e) => handleBoneRotationChange(boneName, 2, Number(e.target.value))}
                            />
                            <span className="w-8 text-right numeral">{zDeg}°</span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
                
                <div className="mt-4 border-t border-line/60 pt-3">
                  <label className="block">
                    <span className="flex items-center justify-between text-[0.68rem] font-semibold text-fg-2">
                      <span>캐릭터 높이 조정 (Y-Offset)</span>
                      <span className="numeral text-fg-3">{customYOffset.toFixed(2)}m</span>
                    </span>
                    <input
                      type="range"
                      min="-0.30"
                      max="0.30"
                      step="0.01"
                      aria-label="캐릭터 높이 조정 (Y-Offset)"
                      value={customYOffset}
                      disabled={!vrm}
                      className="mt-2 w-full accent-accent"
                      onChange={(e) => handleYOffsetChange(Number(e.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="mt-3 w-full rounded-lg border border-line bg-card py-1.5 text-xs text-fg hover:bg-raised disabled:opacity-45"
                    disabled={
                      !vrm ||
                      (activePoseId.startsWith("custom-")
                        ? !savedPoses.some((pose: CustomPose) => pose.id === activePoseId)
                        : findPoseById(activePoseId) === null)
                    }
                    onClick={handleResetActivePose}
                  >
                    {activePoseId.startsWith("pose-material:")
                      ? "범용 소재 목록에서 다시 적용"
                      : "현재 프리셋 포즈로 재설정"}
                  </button>
                </div>
              </details>
              </>
  );
}
