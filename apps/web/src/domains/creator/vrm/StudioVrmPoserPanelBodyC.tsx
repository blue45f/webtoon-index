/**
  type LightingParams,
  type StudioVrmCostumeMeshEntry,
  type VrmMaterialFx,
 * Studio VRM poser view slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this component destructures the original local names.
 */
import {
  Camera,
  ChevronDown,
  Paintbrush,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import * as THREE from "three";

import {
  COSTUME_SLOT_LABELS,
  COSTUME_PALETTES,
  type CostumeSlot,
} from "./studio-vrm-costume";
import {
  STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH,
} from "./studio-vrm-creative-sqlite-repository";
import {
  CAMERA_PRESETS,
  ENV_VARIANTS,
  HAND_SHAPE_PRESETS,
} from "./studio-vrm-poser-catalogs";
import {
  cx,
} from "./studio-vrm-poser-helpers";
import {
  applyVrmMaterialFx,
  DEFAULT_VRM_MATERIAL_FX,
} from "./studio-vrm-poser-utils";
import {
  STUDIO_VRM_LIGHTING_QUICK_PRESETS,
} from "./studio-vrm-poser-ux";
import {
  StudioVrmBroadcastPreviewPanel,
} from "./StudioVrmBroadcastPreview";
import type {
  LightingTone,
} from "./StudioVrmLighting";
import {
  CONTROL_BUTTON,
} from "./StudioVrmPoserTypes";
import {
  StudioVrmPropPanel,
} from "./StudioVrmPropPanel";

import type { StudioVrmCostumeMeshEntry } from "./studio-vrm-costume-runtime";
import type { LightingParams, VrmMaterialFx  } from "./studio-vrm-poser-utils";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";

export function StudioVrmPoserPanelBodyC({ h }: { h: StudioVrmPoserHost }) {
  const {
    error,
    vrm,
    activeCameraId,
    setActiveCameraId,
    bodyRotation,
    broadcastBackgroundId,
    setBroadcastBackgroundId,
    broadcastPreviewError,
    setBroadcastPreviewError,
    isCapturing,
    isThumbnailCapturing,
    fingerEdits,
    setFingerEdits,
    lighting,
    setLighting,
    envVariant,
    setEnvVariant,
    transparentBackground,
    setTransparentBackground,
    insertBackgroundColor,
    setInsertBackgroundColor,
    fullStateName,
    setFullStateName,
    savedFullStates,
    materialFx,
    setMaterialFx,
    isSharingPose,
    lightingTone,
    setLightingTone,
    vrmCreativePersistenceStatus,
    vrmPropItems,
    setVrmPropItems,
    selectedVrmPropUid,
    setSelectedVrmPropUid,
    costumeState,
    costumeMeshes,
    selectedCostumeKey,
    setSelectedCostumeKey,
    effectivePropRigMetrics,
    idleAnimation,
    setIdleAnimation,
    webcamActive,
    vrmRef,
    broadcastPreviewDisabledReason,
    handleBroadcastPreviewStart,
    hideOnTab,
    hideOnCharacterSection,
    hasMToonMaterial,
    vrmCreativeReadOnly,
    handleCopyFullState,
    handlePasteFullState,
    handleSaveFullLocal,
    handleDeleteFullLocal,
    handleLoadFullLocal,
    applyLightingQuickPreset,
    updateFingerCurl,
    applyHandPosePreset,
    handleBodyRotationChange,
    isCostumeAutoHidden,
    toggleCostumeMesh,
    recolorCostumeMesh,
    recolorCostumeSlot,
    resetCostume,
    addVrmProp,
    updateVrmProp,
    removeVrmProp,
  } = h;
  return (
              <>
              <section hidden={hideOnTab("scene")}>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-fg">
                  <Camera size={15} className="text-accent" aria-hidden />
                  카메라
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  {CAMERA_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={cx(
                        CONTROL_BUTTON,
                        activeCameraId === preset.id
                          ? "border-accent/55 bg-accent-soft text-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                      )}
                      onClick={() => setActiveCameraId(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <label className="mt-4 block rounded-xl border border-line bg-card/65 px-3 py-3">
                  <span className="flex items-center justify-between gap-3 text-xs font-semibold text-fg-2">
                    <span className="flex items-center gap-1.5">
                      <RotateCcw size={14} className="text-accent" aria-hidden />
                      캐릭터 회전
                    </span>
                    <span className="numeral text-fg-3">{Math.round(THREE.MathUtils.radToDeg(bodyRotation))}°</span>
                  </span>
                  <input
                    className="mt-3 w-full accent-accent"
                    aria-label="캐릭터 회전"
                    disabled={!vrm}
                    max="180"
                    min="-180"
                    step="1"
                    type="range"
                    value={Math.round(THREE.MathUtils.radToDeg(bodyRotation))}
                    onChange={handleBodyRotationChange}
                  />
                </label>
              </section>

              <section hidden={hideOnTab("scene")} className="mt-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-fg">
                  <WandSparkles size={15} className="text-accent" aria-hidden />
                  조명 연출
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: "morning", label: "아침" },
                    { id: "sunset", label: "노을" },
                    { id: "night", label: "밤" },
                    { id: "studio", label: "스튜디오" },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={cx(
                        CONTROL_BUTTON,
                        lightingTone === preset.id
                          ? "border-accent/55 bg-accent-soft text-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                      )}
                      onClick={() => setLightingTone(preset.id as LightingTone)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <p className="mb-1.5 mt-3 text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">퀵 라이팅</p>
                <div className="grid grid-cols-2 gap-2">
                  {STUDIO_VRM_LIGHTING_QUICK_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.hint}
                      className="min-h-[3rem] rounded-xl border border-line bg-card px-3 py-2 text-left transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onClick={() => applyLightingQuickPreset(preset.id)}
                    >
                      <span className="block text-xs font-bold text-fg">{preset.label}</span>
                      <span className="mt-0.5 block text-[0.65rem] leading-snug text-fg-3">{preset.hint}</span>
                    </button>
                  ))}
                </div>
              </section>

              <div hidden={hideOnTab("scene")}>
                <StudioVrmBroadcastPreviewPanel
                  backgroundId={broadcastBackgroundId}
                  disabledReason={broadcastPreviewDisabledReason}
                  error={broadcastPreviewError || null}
                  onBackgroundChange={(backgroundId) => {
                    setBroadcastBackgroundId(backgroundId);
                    setBroadcastPreviewError("");
                  }}
                  onStart={handleBroadcastPreviewStart}
                />
              </div>

              {/* ── 고도화 컨트롤 (body scale, lighting+, env, full state) ── */}
              <details hidden={hideOnTab("scene")} className="group mt-4 rounded-xl border border-line bg-card/45 p-3">
                <summary className="mb-3 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Sliders size={15} className="text-accent" aria-hidden />
                  세부 조정 · 상태 저장
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="space-y-3.5">
                  {/* 조명 미세 조정 */}
                  <div className="space-y-1.5">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">조명 미세 조정</p>
                    <label className="flex items-center gap-2 text-xs text-fg-2">
                      <span className="w-12 shrink-0 font-medium">밝기</span>
                      <input type="range" min="0.2" max="3" step="0.05" value={lighting.intensity} onChange={e => setLighting((l: LightingParams) => ({...l, intensity: parseFloat(e.target.value)}))} className="h-2 flex-1 accent-accent" />
                      <span className="w-11 shrink-0 text-right tabular-nums text-fg-3">{lighting.intensity.toFixed(1)}</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-fg-2">
                      <span className="w-12 shrink-0 font-medium">색온도</span>
                      <input type="range" min="0" max="1" step="0.05" value={lighting.colorTemp} onChange={e => setLighting((l: LightingParams) => ({...l, colorTemp: parseFloat(e.target.value)}))} className="h-2 flex-1 accent-accent" />
                      <span className="w-11 shrink-0 text-right tabular-nums text-fg-3">{lighting.colorTemp < 0.45 ? "차갑게" : lighting.colorTemp > 0.55 ? "따뜻하게" : "중간"}</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-fg-2">
                      <span className="w-12 shrink-0 font-medium">방향</span>
                      <input type="range" min="-180" max="180" step="5" value={lighting.directionDeg} onChange={e => setLighting((l: LightingParams) => ({...l, directionDeg: parseFloat(e.target.value)}))} className="h-2 flex-1 accent-accent" />
                      <span className="w-11 shrink-0 text-right tabular-nums text-fg-3">{Math.round(lighting.directionDeg)}°</span>
                    </label>
                  </div>

                  {/* 배경 환경 */}
                  <div className="space-y-1.5 border-t border-line/45 pt-3">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">배경 환경</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ENV_VARIANTS.map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setEnvVariant(id)}
                          className={cx(
                            "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                            envVariant === id ? "border-accent/55 bg-accent-soft text-accent" : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="mt-2 flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={transparentBackground}
                        disabled={isCapturing || isSharingPose || isThumbnailCapturing}
                        onChange={(event) => setTransparentBackground(event.target.checked)}
                        className="mt-0.5 size-4 accent-accent"
                      />
                      <span className="block text-xs font-bold text-fg">
                        캐릭터만 투명 추출
                        <span className="mt-0.5 block text-[0.68rem] font-normal leading-relaxed text-fg-3">
                          삽입 PNG에서 바닥·벽 환경을 빼고 캐릭터(및 소품)만 남깁니다. 끄면 단색
                          배경색으로 불투명하게 넣습니다.
                        </span>
                      </span>
                    </label>
                    {!transparentBackground && (
                      <label className="mt-1.5 flex items-center gap-2 text-xs text-fg-2">
                        <span className="w-14 shrink-0 font-medium">배경색</span>
                        <input
                          type="color"
                          value={insertBackgroundColor}
                          disabled={isCapturing || isSharingPose || isThumbnailCapturing}
                          onChange={(event) => setInsertBackgroundColor(event.target.value)}
                          className="h-8 w-12 cursor-pointer rounded border border-line bg-card p-0.5"
                          aria-label="삽입 배경색"
                        />
                        <span className="tabular-nums text-fg-3">{insertBackgroundColor}</span>
                      </label>
                    )}
                  </div>

                  {/* 손가락 굽힘 + 손모양 프리셋 */}
                  <div className="space-y-2 border-t border-line/45 pt-3">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">손가락 굽힘 (검지)</p>
                    <label className="flex items-center gap-2 text-xs text-fg-2">
                      <span className="w-12 shrink-0 font-medium">왼손</span>
                      <input type="range" min="0" max="60" step="1" value={Math.round(THREE.MathUtils.radToDeg(fingerEdits.leftIndexProximal?.[2] || 0))} onChange={e => updateFingerCurl('left', Number(e.target.value))} className="h-2 flex-1 accent-accent" />
                      <span className="w-11 shrink-0 text-right tabular-nums text-fg-3">{Math.round(THREE.MathUtils.radToDeg(fingerEdits.leftIndexProximal?.[2] || 0))}°</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-fg-2">
                      <span className="w-12 shrink-0 font-medium">오른손</span>
                      <input type="range" min="0" max="60" step="1" value={Math.round(THREE.MathUtils.radToDeg(fingerEdits.rightIndexProximal?.[2] || 0))} onChange={e => updateFingerCurl('right', Number(e.target.value))} className="h-2 flex-1 accent-accent" />
                      <span className="w-11 shrink-0 text-right tabular-nums text-fg-3">{Math.round(THREE.MathUtils.radToDeg(fingerEdits.rightIndexProximal?.[2] || 0))}°</span>
                    </label>
                    {(["left", "right"] as const).map((side) => (
                      <div key={side} className="flex flex-wrap items-center gap-1.5">
                        <span className="w-16 shrink-0 whitespace-nowrap text-[0.66rem] font-semibold text-fg-2">{side === "left" ? "왼손 모양" : "오른손 모양"}</span>
                        {HAND_SHAPE_PRESETS.map((p) => (
                          <button key={p.id} type="button" onClick={() => applyHandPosePreset(side, p.id)} className="rounded-lg border border-line bg-card px-2 py-0.5 text-[0.66rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg">{p.label}</button>
                        ))}
                      </div>
                    ))}
                    <button type="button" onClick={() => setFingerEdits({})} className="rounded-lg border border-line bg-card px-2 py-1 text-[0.66rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-accent">손가락 초기화</button>
                  </div>

                  {/* 전체 상태 저장 · 불러오기 */}
                  <div className="space-y-2 border-t border-line/45 pt-3">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wider text-fg-3">전체 상태 저장 · 불러오기</p>
                    <p className="text-[0.68rem] leading-relaxed text-fg-3">포즈 · 비율 · 손가락 · 의상 · 조명 · 소품을 한 번에 저장하고 불러옵니다.</p>
                    {vrmCreativePersistenceStatus === "memory" ? (
                      <p className="text-[0.65rem] leading-relaxed text-warn">
                        현재 탭 메모리 임시 · 새로고침 시 저장되지 않은 전체 상태가 사라집니다.
                      </p>
                    ) : null}
                    <div className="flex gap-1.5">
                      <input
                        value={fullStateName}
                        onChange={(event) => setFullStateName(event.target.value)}
                        placeholder="상태 이름"
                        aria-label="저장할 3D 캐릭터 상태 이름"
                        maxLength={STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH}
                        disabled={vrmCreativeReadOnly}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1 text-xs text-fg placeholder:text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      />
                      <button
                        type="button"
                        onClick={handleSaveFullLocal}
                        disabled={vrmCreativeReadOnly}
                        className="shrink-0 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-1 text-[0.68rem] font-bold text-accent transition-colors hover:bg-accent-soft disabled:opacity-45"
                      >
                        저장
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={handleCopyFullState} className="flex-1 rounded-lg border border-line bg-card px-2 py-1 text-[0.68rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg">복사</button>
                      <button type="button" onClick={handlePasteFullState} className="flex-1 rounded-lg border border-line bg-card px-2 py-1 text-[0.68rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg">붙여넣기</button>
                    </div>
                    {Object.keys(savedFullStates).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {Object.keys(savedFullStates).map((name) => (
                          <span key={name} className="inline-flex items-center rounded-lg border border-line bg-card">
                            <button
                              type="button"
                              onClick={() => handleLoadFullLocal(name)}
                              className="px-2 py-0.5 text-[0.66rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg"
                            >
                              {name}
                            </button>
                            <button
                              type="button"
                              disabled={vrmCreativeReadOnly}
                              onClick={() => handleDeleteFullLocal(name)}
                              className="grid size-7 place-items-center border-l border-line text-fg-3 hover:text-bad disabled:opacity-45"
                              aria-label={`${name} 전체 포저 상태 삭제`}
                            >
                              <Trash2 size={11} aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </details>

              {/* ── 자연스러운 애니메이션 효과 ─────────────────────────── */}
              <details hidden={hideOnTab("pose")} className="group mt-4 rounded-xl border border-line bg-card/45 p-3">
                <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Sparkles size={15} className="text-accent" aria-hidden />
                  생동감 연출 (대기 모션)
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                  캐릭터가 정지해 있지 않고 자연스럽게 숨을 쉬고 눈을 깜빡이도록 설정하여 씬을 생생하게 연출합니다.
                </p>
                <div className="flex items-center justify-between text-xs text-fg-2 bg-card/40 border border-line/60 rounded-lg p-2.5">
                  <span className="font-semibold">자연스러운 대기 모션 (숨쉬기 & 눈 깜빡임)</span>
                  <input
                    type="checkbox"
                    className="accent-accent size-4 cursor-pointer"
                    checked={idleAnimation}
                    disabled={webcamActive}
                    onChange={(e) => setIdleAnimation(e.target.checked)}
                    title={webcamActive ? "웹캠 트래킹 중에는 비활성화됩니다" : "대기 애니메이션 토글"}
                  />
                </div>
                {webcamActive && (
                  <p className="mt-1.5 text-[0.68rem] text-accent font-semibold leading-relaxed">
                    ℹ️ 웹캠 실시간 페이스 트래킹이 활성화되어 대기 모션이 자동으로 일시 중지되었습니다.
                  </p>
                )}
              </details>

              {/* ── 본 부착 소품(손/머리/몸) ───────────────────────────── */}
              <div hidden={hideOnTab("props")} className="mt-4">
                <StudioVrmPropPanel
                  vrmReady={Boolean(vrm)}
                  rigMetrics={effectivePropRigMetrics}
                  items={vrmPropItems}
                  selectedUid={selectedVrmPropUid}
                  onSelect={setSelectedVrmPropUid}
                  onAdd={addVrmProp}
                  onUpdate={updateVrmProp}
                  onRemove={removeVrmProp}
                  onClear={() => {
                    setVrmPropItems([]);
                    setSelectedVrmPropUid(null);
                  }}
                />
              </div>

              {/* ── 의상 분리 토글 / 리컬러 ─────────────────────────────── */}
              <details hidden={hideOnCharacterSection("appearance")} className="group mt-4 rounded-xl border border-line bg-card/45 p-3">
                <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Sliders size={15} className="text-accent" aria-hidden />
                  의상 분리 · 부분 채색
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                {costumeMeshes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line/70 bg-card/40 px-2.5 py-2 text-[0.68rem] text-fg-3">
                    {vrm ? "이 모델은 의상 분리 정보가 없어요." : "모델을 먼저 불러오세요."}
                  </p>
                ) : (
                  <>
                    <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                      탐지된 의상 메시를 슬롯별로 표시/숨김 토글하거나 색을 바꿉니다. 피부·얼굴·머리는 보호됩니다.
                    </p>
                    {(Object.keys(COSTUME_SLOT_LABELS) as CostumeSlot[]).map((slot) => {
                      const meshesInSlot = costumeMeshes.filter((m: StudioVrmCostumeMeshEntry) => m.slot === slot);
                      if (meshesInSlot.length === 0) return null;
                      return (
                        <div key={slot} className="mb-3 border-b border-line/35 pb-2.5 last:border-0">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <p className="text-[0.66rem] font-bold text-fg-2">{COSTUME_SLOT_LABELS[slot]}</p>
                            <div className="flex items-center gap-1">
                              {COSTUME_PALETTES.slice(0, 6).map((pal) => (
                                <button
                                  key={pal.id}
                                  type="button"
                                  title={`${pal.label} (${COSTUME_SLOT_LABELS[slot]} 전체)`}
                                  className="size-4 rounded-full border border-line/70"
                                  style={{ backgroundColor: pal.color }}
                                  onClick={() => recolorCostumeSlot(slot, pal.color)}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1">
                            {meshesInSlot.map((entry: StudioVrmCostumeMeshEntry) => {
                              const hidden = costumeState.hidden.includes(entry.key);
                              const autoHidden = isCostumeAutoHidden(entry.key);
                              const recolor = costumeState.recolor[entry.key];
                              const isOpen = selectedCostumeKey === entry.key;
                              return (
                                <div key={entry.key} className="rounded-lg border border-line bg-card/60 px-2 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={autoHidden}
                                      title={autoHidden ? "몸 맞춤 워드로브가 같은 부위의 원본 의상을 자동으로 숨겼습니다." : undefined}
                                      className={cx(
                                        "rounded px-1.5 py-0.5 text-[0.64rem] font-semibold transition-colors disabled:cursor-help",
                                        hidden || autoHidden ? "bg-card text-fg-3 line-through" : "bg-accent-soft text-accent"
                                      )}
                                      onClick={() => toggleCostumeMesh(entry.key)}
                                    >
                                      {autoHidden ? "자동 숨김" : hidden ? "숨김" : "표시"}
                                    </button>
                                    <span className="flex-1 truncate text-[0.68rem] text-fg-2" title={entry.label}>
                                      {entry.label}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-[0.64rem] text-fg-3 hover:underline"
                                      onClick={() => setSelectedCostumeKey(isOpen ? null : entry.key)}
                                    >
                                      색상
                                    </button>
                                  </div>
                                  {isOpen && (
                                    <div className="mt-1.5 flex items-center gap-2">
                                      <input
                                        type="color"
                                        value={recolor ?? "#ffffff"}
                                        aria-label={`${entry.label} 의상 색상`}
                                        onChange={(e) => recolorCostumeMesh(entry.key, e.target.value)}
                                        className="size-6 cursor-pointer rounded border border-line bg-transparent p-0"
                                      />
                                      <button
                                        type="button"
                                        className="rounded border border-line bg-card px-2 py-0.5 text-[0.64rem] text-fg-2 hover:bg-raised"
                                        onClick={() => recolorCostumeMesh(entry.key, null)}
                                      >
                                        원래 색
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="mt-1 w-full rounded-lg border border-line bg-card py-1.5 text-xs text-fg hover:bg-raised"
                      onClick={resetCostume}
                    >
                      의상 초기화
                    </button>
                  </>
                )}
              </details>

              {/* ── 재질 효과(MToon 셰이딩/외곽선/림라이트) ─────────────────── */}
              <details hidden={hideOnCharacterSection("appearance")} className="group mt-4 rounded-xl border border-line bg-card/45 p-3">
                <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Paintbrush size={15} className="text-accent" aria-hidden />
                  재질 효과 (그림자 · 외곽선 · 림라이트)
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mb-3 text-[0.68rem] leading-relaxed text-fg-3">
                  베이스 색과 별개로 셀 셰이딩 스타일을 바꿔보세요. MToon 재질을 쓰는 모델에서만 보여요.
                </p>
                {!hasMToonMaterial ? (
                  <p className="rounded-lg border border-dashed border-line/70 bg-card/40 px-2.5 py-2 text-[0.68rem] text-fg-3">
                    {vrm ? "이 모델은 MToon 재질이 아니라 재질 효과를 지원하지 않아요." : "모델을 먼저 불러오세요."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {[
                      { key: "shadeColor" as const, label: "그림자 색" },
                      { key: "outlineColor" as const, label: "외곽선 색" },
                      { key: "rimColor" as const, label: "림 라이트 색" },
                      { key: "emissiveColor" as const, label: "발광 색" },
                    ].map((row) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[0.65rem] font-semibold text-fg-2">{row.label}</span>
                        <input
                          type="color"
                          value={materialFx[row.key] ?? "#ffffff"}
                          disabled={!vrm}
                          aria-label={row.label}
                          onChange={(e) => {
                            const hex = e.target.value;
                            setMaterialFx((prev: VrmMaterialFx) => ({ ...prev, [row.key]: hex }));
                          }}
                          className="size-6 cursor-pointer rounded border border-line bg-transparent p-0"
                        />
                        <button
                          type="button"
                          disabled={!vrm || !materialFx[row.key]}
                          onClick={() => setMaterialFx((prev: VrmMaterialFx) => ({ ...prev, [row.key]: null }))}
                          className="rounded border border-line bg-card px-2 py-0.5 text-[0.64rem] text-fg-2 hover:bg-raised disabled:opacity-40"
                        >
                          끄기
                        </button>
                      </div>
                    ))}
                    <label className="flex items-center gap-2 text-[0.65rem] text-fg-3">
                      <span className="w-16 shrink-0 font-semibold text-fg-2">림 강도</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={materialFx.rimIntensity}
                        disabled={!vrm || !materialFx.rimColor}
                        onChange={(e) => setMaterialFx((prev: VrmMaterialFx) => ({ ...prev, rimIntensity: Number(e.target.value) }))}
                        className="h-2 flex-1 accent-accent"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[0.65rem] text-fg-3">
                      <span className="w-16 shrink-0 font-semibold text-fg-2">발광 강도</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={materialFx.emissiveIntensity}
                        disabled={!vrm || !materialFx.emissiveColor}
                        onChange={(e) => setMaterialFx((prev: VrmMaterialFx) => ({ ...prev, emissiveIntensity: Number(e.target.value) }))}
                        className="h-2 flex-1 accent-accent"
                      />
                    </label>
                  </div>
                )}
                <button
                  type="button"
                  className="mt-3 w-full rounded-lg border border-line bg-card py-1.5 text-xs text-fg hover:bg-raised disabled:opacity-45"
                  disabled={!vrm}
                  onClick={() => {
                    setMaterialFx(DEFAULT_VRM_MATERIAL_FX);
                    if (vrmRef.current) applyVrmMaterialFx(vrmRef.current, DEFAULT_VRM_MATERIAL_FX);
                  }}
                >
                  재질 효과 초기화
                </button>
              </details>

              </>
  );
}
