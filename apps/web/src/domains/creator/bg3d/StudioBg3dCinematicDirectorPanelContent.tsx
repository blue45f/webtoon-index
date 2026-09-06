import {
  Activity,
  BrainCircuit,
  Camera,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Pause,
  Play,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  WEBTOON_SHOT_ANGLE_PRESETS,
  createShotBookmark,
  createShotDeckPlaybackPlan,
  type CameraShakePreset,
  type CameraShakeConfig,
  type WebtoonPanelAspect,
  type WebtoonShotAngleKind,
  type WebtoonShotBookmark,
  type WebtoonShotTransitionEasing,
} from "../scene-3d/studio-3d-camera-cinematic-director";

import {
  analyzeStudioBg3dShotContinuity,
  formatStudioBg3dShotContinuitySummary,
} from "./studio-bg3d-shot-continuity";

import type {
  StudioBg3dCameraSettings,
  StudioBg3dShot,
} from "./studio-bg3d-scene-document";

const DEFAULT_DIRECTOR_CAMERA: StudioBg3dCameraSettings = Object.freeze({
  position: [0, 1.6, 6] as const,
  target: [0, 1.4, 0] as const,
  fovDegrees: 45,
  projection: "perspective",
  nearClip: 0.01,
  up: [0, 1, 0] as const,
});

const TRANSITION_LABELS: Readonly<Record<WebtoonShotTransitionEasing, string>> = Object.freeze({
  linear: "직선",
  "ease-in-out": "부드럽게",
  "spring-punch": "펀치",
  "whip-pan": "휩 팬",
});

function bookmarkToShot(bookmark: WebtoonShotBookmark): StudioBg3dShot {
  const rollRadians = (bookmark.dutchRollDegrees * Math.PI) / 180;
  return {
    id: bookmark.id,
    name: bookmark.name,
    camera: {
      position: bookmark.position,
      target: bookmark.target,
      fovDegrees: bookmark.fov,
      projection: "perspective",
      nearClip: 0.01,
      up: [Math.sin(rollRadians), Math.cos(rollRadians), 0],
    },
  };
}

export interface StudioBg3dCinematicDirectorPanelProps {
  readonly disabled?: boolean;
  readonly baseCamera?: StudioBg3dCameraSettings;
  /** Real SceneDocument shots. When omitted, the panel runs a self-contained rehearsal deck. */
  readonly productionShots?: readonly StudioBg3dShot[];
  readonly onCaptureCurrentShot?: () => void;
  readonly onApplyProductionShot?: (shotId: string) => void;
  readonly onMoveProductionShot?: (shotId: string, targetIndex: number) => void;
  readonly onRemoveProductionShot?: (shotId: string) => void;
  readonly onApplyShotBookmark?: (bookmark: WebtoonShotBookmark) => void;
  readonly onTriggerShake?: (config: CameraShakeConfig) => void;
  readonly onUseCurrentFrameAsAiReference?: () => void;
  readonly aiReferenceBusy?: boolean;
}

let cinematicBookmarkCounter = 100;

export function StudioBg3dCinematicDirectorPanel({
  disabled = false,
  baseCamera = DEFAULT_DIRECTOR_CAMERA,
  productionShots,
  onCaptureCurrentShot,
  onApplyProductionShot,
  onMoveProductionShot,
  onRemoveProductionShot,
  onApplyShotBookmark,
  onTriggerShake,
  onUseCurrentFrameAsAiReference,
  aiReferenceBusy = false,
}: StudioBg3dCinematicDirectorPanelProps): React.JSX.Element {
  const [selectedAngle, setSelectedAngle] = useState<WebtoonShotAngleKind>("eye-level-dialogue");
  const [selectedShake, setSelectedShake] = useState<CameraShakePreset>("none");
  const [shakeIntensity, setShakeIntensity] = useState(1.0);
  const [transitionSeconds, setTransitionSeconds] = useState(0.8);
  const [holdSeconds, setHoldSeconds] = useState(1.2);
  const [easing, setEasing] = useState<WebtoonShotTransitionEasing>("ease-in-out");
  const [panelAspect, setPanelAspect] = useState<WebtoonPanelAspect>("9:16");
  const [localBookmarks, setLocalBookmarks] = useState<readonly WebtoonShotBookmark[]>([
    createShotBookmark("cut-1", "01화 오프닝 - 전경", 1, "wide-establishing"),
    createShotBookmark("cut-2", "01화 주인공 등장", 2, "low-angle-heroic"),
    createShotBookmark("cut-3", "01화 결투 대치", 3, "dutch-tilt-tension"),
  ]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeDeckIndex, setActiveDeckIndex] = useState(0);

  const productionMode = productionShots !== undefined;
  const continuityShots = useMemo<readonly StudioBg3dShot[]>(
    () => productionShots ?? localBookmarks.map(bookmarkToShot),
    [localBookmarks, productionShots],
  );
  const continuityReport = useMemo(
    () => analyzeStudioBg3dShotContinuity(baseCamera, continuityShots),
    [baseCamera, continuityShots],
  );
  const localPlaybackPlan = useMemo(
    () => createShotDeckPlaybackPlan(localBookmarks),
    [localBookmarks],
  );
  const transitionByTargetId = useMemo(
    () => new Map(continuityReport.transitions.map((transition) => [transition.toShotId, transition])),
    [continuityReport.transitions],
  );

  const applyDeckShot = useCallback((index: number) => {
    if (productionMode) {
      const shot = productionShots?.[index];
      if (shot) onApplyProductionShot?.(shot.id);
      return;
    }
    const bookmark = localBookmarks[index];
    if (bookmark) onApplyShotBookmark?.(bookmark);
  }, [localBookmarks, onApplyProductionShot, onApplyShotBookmark, productionMode, productionShots]);

  useEffect(() => {
    if (!isPlaying || continuityShots.length === 0) return undefined;
    applyDeckShot(activeDeckIndex);
    const localBookmark = productionMode ? undefined : localBookmarks[activeDeckIndex];
    const delayMs = productionMode
      ? 1_200
      : Math.max(
        300,
        ((localBookmark?.transitionSeconds ?? 0.8) + (localBookmark?.holdSeconds ?? 1.2)) * 1_000,
      );
    const timer = window.setTimeout(() => {
      if (activeDeckIndex >= continuityShots.length - 1) {
        setIsPlaying(false);
        return;
      }
      setActiveDeckIndex((current) => current + 1);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [activeDeckIndex, applyDeckShot, continuityShots.length, isPlaying, localBookmarks, productionMode]);

  useEffect(() => {
    if (activeDeckIndex < continuityShots.length) return;
    setActiveDeckIndex(Math.max(0, continuityShots.length - 1));
    setIsPlaying(false);
  }, [activeDeckIndex, continuityShots.length]);

  const shotOptions = {
    transitionSeconds,
    holdSeconds,
    easing,
    panelAspect,
    safeFramePercent: 90,
  } as const;

  const handleAddBookmark = () => {
    if (productionMode) {
      onCaptureCurrentShot?.();
      return;
    }
    cinematicBookmarkCounter += 1;
    const nextCutIndex = localBookmarks.length + 1;
    const bookmark = createShotBookmark(
      `cut-${cinematicBookmarkCounter}`,
      `01화 컷 ${nextCutIndex}`,
      nextCutIndex,
      selectedAngle,
      [0, 1, 0],
      shotOptions,
    );
    setLocalBookmarks((current) => [...current, bookmark]);
    onApplyShotBookmark?.(bookmark);
  };

  const handleTriggerShake = (preset: CameraShakePreset) => {
    setSelectedShake(preset);
    onTriggerShake?.({
      preset,
      intensity: shakeIntensity,
      frequency: 15,
      decayRate: 1.5,
    });
  };

  const handleMoveShot = (index: number, targetIndex: number) => {
    const shot = continuityShots[index];
    if (!shot || targetIndex < 0 || targetIndex >= continuityShots.length) return;
    if (productionMode) {
      onMoveProductionShot?.(shot.id, targetIndex);
      return;
    }
    setLocalBookmarks((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(targetIndex, 0, moved);
      return next.map((bookmark, bookmarkIndex) => ({
        ...bookmark,
        episodePanelIndex: bookmarkIndex + 1,
      }));
    });
  };

  const handleRemoveShot = (index: number) => {
    const shot = continuityShots[index];
    if (!shot) return;
    if (productionMode) {
      onRemoveProductionShot?.(shot.id);
      return;
    }
    setLocalBookmarks((current) => current
      .filter((bookmark) => bookmark.id !== shot.id)
      .map((bookmark, bookmarkIndex) => ({
        ...bookmark,
        episodePanelIndex: bookmarkIndex + 1,
      })));
  };

  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (continuityShots.length === 0) return;
    setActiveDeckIndex(0);
    setIsPlaying(true);
  };

  const continuityTone = continuityReport.criticalCount > 0
    ? "border-bad/45 bg-bad/10 text-bad"
    : continuityReport.warningCount > 0
      ? "border-warn/45 bg-warn/10 text-warn"
      : "border-good/45 bg-good/10 text-good";

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex items-center gap-1.5 font-bold text-fg">
          <Clapperboard className="size-4 text-accent" />
          <span>시네마틱 카메라 & 컷 디렉터</span>
          <span className="rounded bg-raised px-1.5 py-0.5 text-[0.58rem] font-semibold text-fg-3">
            {productionMode ? "장면 연동" : "리허설 덱"}
          </span>
        </div>
        <button
          type="button"
          disabled={disabled || (productionMode && !onCaptureCurrentShot)}
          onClick={handleAddBookmark}
          className="flex min-h-8 items-center gap-1 rounded bg-accent/15 px-2 py-1 text-[0.68rem] font-bold text-accent transition-all hover:bg-accent/25 disabled:opacity-45"
        >
          <Save className="size-3" />
          <span>{productionMode ? "현재 장면을 컷으로 저장" : "현재 설정으로 컷 추가"}</span>
        </button>
      </div>

      <section className="grid gap-2 rounded-lg border border-line bg-card p-2.5" aria-label="카메라 전환 설정">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.68rem] font-bold text-fg-2">카메라 전환</span>
          <span className="numeral text-[0.6rem] text-fg-3">
            {productionMode ? `${continuityShots.length}컷` : `${localPlaybackPlan.totalSeconds.toFixed(1)}초 / ${continuityShots.length}컷`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-[0.62rem] font-semibold text-fg-3">
            이동 시간
            <input
              type="number"
              min="0"
              max="8"
              step="0.1"
              value={transitionSeconds}
              disabled={disabled}
              onChange={(event) => setTransitionSeconds(Number(event.target.value))}
              className="mt-1 min-h-8 w-full rounded border border-line bg-raised px-2 text-fg"
            />
          </label>
          <label className="text-[0.62rem] font-semibold text-fg-3">
            컷 유지
            <input
              type="number"
              min="0.1"
              max="20"
              step="0.1"
              value={holdSeconds}
              disabled={disabled}
              onChange={(event) => setHoldSeconds(Number(event.target.value))}
              className="mt-1 min-h-8 w-full rounded border border-line bg-raised px-2 text-fg"
            />
          </label>
          <label className="text-[0.62rem] font-semibold text-fg-3">
            전환 곡선
            <select
              value={easing}
              disabled={disabled}
              onChange={(event) => setEasing(event.target.value as WebtoonShotTransitionEasing)}
              className="mt-1 min-h-8 w-full rounded border border-line bg-raised px-2 text-fg"
            >
              {(Object.keys(TRANSITION_LABELS) as WebtoonShotTransitionEasing[]).map((value) => (
                <option key={value} value={value}>{TRANSITION_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label className="text-[0.62rem] font-semibold text-fg-3">
            컷 비율
            <select
              value={panelAspect}
              disabled={disabled}
              onChange={(event) => setPanelAspect(event.target.value as WebtoonPanelAspect)}
              className="mt-1 min-h-8 w-full rounded border border-line bg-raised px-2 text-fg"
            >
              {(["9:16", "4:5", "1:1", "16:9", "21:9"] as const).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-1.5" aria-label="웹툰 연출 앵글 프리셋">
        <span className="text-[0.68rem] font-medium text-fg-3">웹툰 연출 앵글 프리셋</span>
        <div className="grid grid-cols-2 gap-1.5">
          {WEBTOON_SHOT_ANGLE_PRESETS.map((preset) => (
            <button
              key={preset.kind}
              type="button"
              disabled={disabled}
              onClick={() => {
                setSelectedAngle(preset.kind);
                cinematicBookmarkCounter += 1;
                const bookmark = createShotBookmark(
                  `preview-${cinematicBookmarkCounter}`,
                  preset.label,
                  1,
                  preset.kind,
                  [0, 1, 0],
                  shotOptions,
                );
                onApplyShotBookmark?.(bookmark);
              }}
              className={`flex flex-col items-start rounded-lg border p-2 text-left transition-all disabled:opacity-45 ${
                selectedAngle === preset.kind
                  ? "border-accent bg-accent/10 font-bold text-accent shadow-sm"
                  : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
              }`}
            >
              <span className="flex items-center gap-1">
                <Camera className="size-3 text-accent" />
                <span className="text-[0.72rem] leading-tight">{preset.label}</span>
              </span>
              <span className="mt-0.5 line-clamp-1 text-[0.62rem] text-fg-3">{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={`rounded-lg border p-2.5 ${continuityTone}`} aria-label="컷 연속성 검사">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[0.7rem] font-bold">
            {continuityReport.criticalCount > 0 || continuityReport.warningCount > 0 ? (
              <TriangleAlert className="size-3.5" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            컷 연속성 검사
          </span>
          <output className="numeral text-[0.68rem] font-bold" aria-live="polite">
            {formatStudioBg3dShotContinuitySummary(continuityReport)}
          </output>
        </div>
        {continuityReport.transitions.some((transition) => transition.issues.length > 0) ? (
          <div className="mt-2 grid gap-1">
            {continuityReport.transitions
              .filter((transition) => transition.issues.length > 0)
              .slice(0, 3)
              .map((transition) => (
                <p key={`${transition.fromShotId}:${transition.toShotId}`} className="text-[0.59rem] leading-relaxed">
                  <strong>{transition.fromShotName} → {transition.toShotName}</strong>
                  {" · "}{transition.issues[0]?.label}
                </p>
              ))}
          </div>
        ) : (
          <p className="mt-1 text-[0.59rem]">180도 축·화각·카메라 이동에서 큰 단절이 감지되지 않았습니다.</p>
        )}
      </section>

      <section className="flex flex-col gap-1.5" aria-label="저장된 웹툰 컷 덱">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.68rem] font-medium text-fg-3">저장된 웹툰 컷 덱</span>
          <button
            type="button"
            disabled={disabled || continuityShots.length === 0}
            onClick={togglePlayback}
            className="flex min-h-8 items-center gap-1 rounded border border-line bg-raised px-2 text-[0.62rem] font-bold text-fg-2 hover:text-fg disabled:opacity-45"
          >
            {isPlaying ? <Pause className="size-3" /> : <Play className="size-3" />}
            {isPlaying ? "미리보기 정지" : "컷 순서 미리보기"}
          </button>
        </div>
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {continuityShots.map((shot, index) => {
            const incoming = transitionByTargetId.get(shot.id);
            const critical = incoming?.issues.some((entry) => entry.severity === "critical") ?? false;
            const warning = incoming?.issues.some((entry) => entry.severity === "warning") ?? false;
            return (
              <div
                key={shot.id}
                className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs ${
                  activeDeckIndex === index && isPlaying
                    ? "border-accent bg-accent/10"
                    : critical
                      ? "border-bad/40 bg-bad/5"
                      : warning
                        ? "border-warn/40 bg-warn/5"
                        : "border-line bg-card"
                }`}
              >
                <span className="rounded bg-raised px-1 py-0.5 font-mono text-[0.62rem] font-bold text-fg-2">
                  #{index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{shot.name}</span>
                {incoming?.issues[0] ? (
                  <span className={`max-w-28 truncate text-[0.55rem] ${critical ? "text-bad" : warning ? "text-warn" : "text-fg-3"}`}>
                    {incoming.issues[0].label}
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`${shot.name} 위로 이동`}
                  disabled={disabled || index === 0 || (productionMode && !onMoveProductionShot)}
                  onClick={() => handleMoveShot(index, index - 1)}
                  className="rounded p-1 text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-30"
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label={`${shot.name} 아래로 이동`}
                  disabled={disabled || index === continuityShots.length - 1 || (productionMode && !onMoveProductionShot)}
                  onClick={() => handleMoveShot(index, index + 1)}
                  className="rounded p-1 text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-30"
                >
                  <ChevronDown className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={disabled || (productionMode ? !onApplyProductionShot : !onApplyShotBookmark)}
                  onClick={() => {
                    setActiveDeckIndex(index);
                    applyDeckShot(index);
                  }}
                  className="flex min-h-7 items-center gap-1 rounded bg-raised px-2 text-[0.6rem] text-accent hover:bg-accent hover:text-accent-fg disabled:opacity-40"
                >
                  <Play className="size-2.5" />
                  이동
                </button>
                <button
                  type="button"
                  aria-label={`${shot.name} 삭제`}
                  disabled={disabled || (productionMode && !onRemoveProductionShot)}
                  onClick={() => handleRemoveShot(index)}
                  className="rounded p-1 text-fg-3 hover:bg-bad/10 hover:text-bad disabled:opacity-30"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {onUseCurrentFrameAsAiReference ? (
        <button
          type="button"
          disabled={disabled || aiReferenceBusy}
          aria-busy={aiReferenceBusy}
          onClick={onUseCurrentFrameAsAiReference}
          className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-cool/45 bg-cool/10 text-[0.68rem] font-bold text-cool hover:bg-cool/15 disabled:opacity-45"
        >
          <BrainCircuit className={`size-3.5 ${aiReferenceBusy ? "animate-pulse motion-reduce:animate-none" : ""}`} />
          {aiReferenceBusy ? "현재 컷 참조 준비 중" : "현재 컷을 AI 구도·포즈 참조로 보내기"}
        </button>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5" aria-label="카메라 셰이크">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[0.7rem] font-bold text-fg">
            <Activity className="size-3.5 text-accent" />
            카메라 셰이크 연출
          </span>
          <label className="flex items-center gap-1.5 text-[0.62rem] text-fg-3">
            강도
            <input
              aria-label="카메라 셰이크 강도"
              type="range"
              min="0.2"
              max="2"
              step="0.1"
              value={shakeIntensity}
              disabled={disabled}
              onChange={(event) => setShakeIntensity(Number(event.target.value))}
              className="h-1.5 w-16 accent-accent"
            />
            <span className="numeral w-7 text-right text-fg">{shakeIntensity.toFixed(1)}x</span>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {[
            { id: "handheld-subtle" as const, label: "일상 핸드헬드" },
            { id: "earthquake-rumble" as const, label: "지진/붕괴 진동" },
            { id: "explosive-shockwave" as const, label: "폭발 충격파" },
            { id: "heartbeat-throb" as const, label: "심박 긴장" },
            { id: "running-footstep" as const, label: "질주 바운스" },
            { id: "none" as const, label: "셰이크 멈춤" },
          ].map((shake) => (
            <button
              key={shake.id}
              type="button"
              disabled={disabled}
              onClick={() => handleTriggerShake(shake.id)}
              className={`min-h-8 rounded border px-1.5 py-1 text-[0.62rem] font-medium transition-all disabled:opacity-45 ${
                selectedShake === shake.id
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line bg-raised text-fg-2 hover:text-fg"
              }`}
            >
              {shake.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
