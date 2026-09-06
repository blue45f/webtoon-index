import {
  Atom,
  Check,
  CirclePause,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { cn } from "../../../shared/lib/utils";

import type {
  StudioBg3dPhysicsGravityPreset,
  StudioBg3dPhysicsPhase,
} from "./studio-bg3d-physics-ui";
import type { RefObject } from "react";

const DURATION_OPTIONS = [2, 4, 8] as const;
const GRAVITY_OPTIONS: ReadonlyArray<{
  id: StudioBg3dPhysicsGravityPreset;
  label: string;
  detail: string;
}> = [
  { id: "earth", label: "지구", detail: "자연스러운 낙하" },
  { id: "moon", label: "달", detail: "느리고 가벼운 낙하" },
  { id: "zero", label: "무중력", detail: "중력 없이 충돌만" },
];

const PHASE_LABELS: Readonly<Record<StudioBg3dPhysicsPhase, string>> = Object.freeze({
  idle: "준비",
  loading: "계산 중",
  running: "재생 중",
  paused: "일시정지",
  complete: "재생 완료",
  baking: "적용 중",
  error: "확인 필요",
});

interface StudioBg3dPhysicsPanelProps {
  selectedCount: number;
  durationSeconds: 2 | 4 | 8;
  gravityPreset: StudioBg3dPhysicsGravityPreset;
  groundEnabled: boolean;
  phase: StudioBg3dPhysicsPhase;
  progress: number;
  unavailableReason: string | null;
  errorMessage: string | null;
  startButtonRef?: RefObject<HTMLButtonElement | null>;
  onDurationChange(duration: 2 | 4 | 8): void;
  onGravityPresetChange(preset: StudioBg3dPhysicsGravityPreset): void;
  onGroundEnabledChange(enabled: boolean): void;
  onStart(): void;
}

export function StudioBg3dPhysicsPanel({
  selectedCount,
  durationSeconds,
  gravityPreset,
  groundEnabled,
  phase,
  progress,
  unavailableReason,
  errorMessage,
  startButtonRef,
  onDurationChange,
  onGravityPresetChange,
  onGroundEnabledChange,
  onStart,
}: StudioBg3dPhysicsPanelProps) {
  const sessionActive = phase === "loading" || phase === "running" || phase === "paused" ||
    phase === "complete" || phase === "baking";
  const startDisabled = selectedCount === 0 || unavailableReason !== null || sessionActive;
  const safeProgress = Math.min(1, Math.max(0, progress));
  const progressPercent = Math.round(safeProgress * 100);

  return (
    <section
      aria-labelledby="bg3d-physics-title"
      data-testid="bg3d-physics-panel"
      className="relative overflow-hidden rounded-2xl border border-accent/35 bg-gradient-to-br from-accent-soft via-card to-panel p-3.5 shadow-[0_12px_36px_-28px_var(--color-accent)]"
    >
      <div className="pointer-events-none absolute -right-10 -top-12 size-28 rounded-full bg-accent/10 blur-2xl" aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/35 bg-accent/10 text-accent shadow-inner">
            <Atom size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 id="bg3d-physics-title" className="text-sm font-extrabold tracking-[-0.01em] text-fg">
              물리 배치 미리보기
            </h3>
            <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
              선택한 소품을 떨어뜨려 바닥과 주변 오브젝트에 자연스럽게 놓습니다.
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-1 text-[0.62rem] font-bold",
            phase === "error"
              ? "border-bad/40 bg-bad/10 text-bad"
              : sessionActive
                ? "border-accent/45 bg-accent/10 text-accent"
                : "border-line bg-panel/75 text-fg-3",
          )}
        >
          {PHASE_LABELS[phase]}
        </span>
      </div>

      <div className="relative mt-3 flex items-center justify-between rounded-xl border border-line/80 bg-panel/70 px-3 py-2">
        <span className="text-[0.68rem] font-semibold text-fg-3">동적 오브젝트</span>
        <strong className="text-xs text-fg">
          {selectedCount > 0 ? `${selectedCount}개 선택` : "선택 필요"}
        </strong>
      </div>

      {!sessionActive ? (
        <div className="relative mt-3 space-y-3">
          <fieldset>
            <legend className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-bold text-fg-2">
              <Gauge size={13} className="text-accent" aria-hidden />
              미리보기 길이
            </legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel/80 p-1">
              {DURATION_OPTIONS.map((duration) => (
                <button
                  key={duration}
                  type="button"
                  aria-pressed={durationSeconds === duration}
                  onClick={() => onDurationChange(duration)}
                  className={cn(
                    "min-h-11 rounded-lg px-2 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:min-h-9 pointer-coarse:min-h-11",
                    durationSeconds === duration
                      ? "bg-accent text-on-accent shadow-sm"
                      : "text-fg-3 hover:bg-raised hover:text-fg",
                  )}
                >
                  {duration}초
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-[0.68rem] font-bold text-fg-2">중력</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {GRAVITY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={gravityPreset === option.id}
                  title={option.detail}
                  onClick={() => onGravityPresetChange(option.id)}
                  className={cn(
                    "min-h-11 rounded-xl border px-1.5 py-1.5 text-[0.68rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    gravityPreset === option.id
                      ? "border-accent/55 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-panel/75 px-3 py-2 text-xs font-semibold text-fg-2">
            <span>
              바닥 충돌
              <span className="mt-0.5 block text-[0.64rem] font-normal text-fg-3">Y=0 기준 투명 바닥</span>
            </span>
            <input
              type="checkbox"
              checked={groundEnabled}
              onChange={(event) => onGroundEnabledChange(event.target.checked)}
              className="size-4 accent-accent"
            />
          </label>

          <button
            ref={startButtonRef}
            type="button"
            data-testid="bg3d-physics-start"
            disabled={startDisabled}
            onClick={onStart}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-accent/60 bg-accent px-3 text-xs font-extrabold text-on-accent shadow-sm transition-[filter,transform] hover:brightness-105 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Sparkles size={15} aria-hidden />
            선택 오브젝트 시뮬레이션
          </button>
        </div>
      ) : (
        <div className="relative mt-3 rounded-xl border border-accent/25 bg-panel/75 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3 text-[0.68rem] font-semibold">
            <span className="text-fg-2">{phase === "loading" ? "결정론적 물리 계산" : "뷰포트에서 결과 확인"}</span>
            <span className="tabular-nums text-accent">{progressPercent}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-100 motion-reduce:transition-none"
              style={{ width: `${safeProgress * 100}%` }}
            />
          </div>
          <p className="mt-2 text-[0.64rem] leading-relaxed text-fg-3">
            임시 결과는 저장되지 않습니다. 화면 아래 도구에서 초기화하거나 현재 자세를 적용하세요.
          </p>
        </div>
      )}

      <div className="relative mt-2 min-h-4 text-[0.66rem] leading-relaxed" aria-live="polite" aria-atomic="true">
        {errorMessage ? (
          <p role="alert" className="text-bad">{errorMessage}</p>
        ) : unavailableReason ? (
          <p className="text-fg-3">{unavailableReason}</p>
        ) : selectedCount === 0 ? (
          <p className="text-fg-3">레이어 또는 화면에서 독립된 오브젝트를 먼저 선택하세요.</p>
        ) : (
          <p className="flex items-center gap-1 text-fg-3">
            <Check size={12} className="text-accent" aria-hidden />
            현재 선택은 물리 미리보기에 사용할 수 있습니다.
          </p>
        )}
      </div>
    </section>
  );
}

interface StudioBg3dPhysicsTransportProps {
  phase: StudioBg3dPhysicsPhase;
  progress: number;
  currentSeconds: number;
  durationSeconds: number;
  currentActionRef?: RefObject<HTMLButtonElement | null>;
  onPause(): void;
  onResume(): void;
  onReset(): void;
  onBake(): void;
}

export function StudioBg3dPhysicsTransport({
  phase,
  progress,
  currentSeconds,
  durationSeconds,
  currentActionRef,
  onPause,
  onResume,
  onReset,
  onBake,
}: StudioBg3dPhysicsTransportProps) {
  const visible = phase === "loading" || phase === "running" || phase === "paused" ||
    phase === "complete" || phase === "baking";
  if (!visible) return null;

  const safeProgress = Math.min(1, Math.max(0, progress));
  const progressPercent = Math.round(safeProgress * 100);
  const canControl = phase !== "loading" && phase !== "baking";
  const canBake = canControl && safeProgress > 0;
  const replaying = phase === "complete";
  const playPauseLabel = phase === "running"
    ? "물리 미리보기 일시정지"
    : replaying
      ? "물리 미리보기 처음부터 다시 재생"
      : "물리 미리보기 재생";

  return (
    <div
      role="toolbar"
      aria-label="3D 물리 미리보기 재생 도구"
      data-testid="bg3d-physics-transport"
      className="pointer-events-auto absolute inset-x-2 bottom-3 z-30 mx-auto flex max-w-[min(34rem,calc(100%-1rem))] items-center gap-1.5 rounded-2xl border border-line/90 bg-panel/95 p-1.5 shadow-2xl backdrop-blur-xl sm:gap-2 sm:p-2"
    >
      <div
        role="progressbar"
        aria-label="물리 미리보기 진행률"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progressPercent}
        aria-valuetext={`${PHASE_LABELS[phase]} · ${currentSeconds.toFixed(1)}초 / ${durationSeconds.toFixed(1)}초 · ${progressPercent}퍼센트`}
        className="sr-only"
      />
      <div className="hidden min-w-0 flex-1 px-2 sm:block">
        <div className="flex items-center justify-between gap-3 text-[0.66rem] font-bold text-fg-2">
          <span>{PHASE_LABELS[phase]}</span>
          <span className="tabular-nums text-fg-3">
            {currentSeconds.toFixed(1)} / {durationSeconds.toFixed(1)}초
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${safeProgress * 100}%` }} />
        </div>
      </div>

      <button
        ref={canControl ? currentActionRef : null}
        type="button"
        data-testid="bg3d-physics-play-pause"
        aria-label={playPauseLabel}
        aria-pressed={phase === "running"}
        disabled={!canControl}
        onClick={phase === "running" ? onPause : onResume}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-xs font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {phase === "loading" || phase === "baking" ? (
          <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : phase === "running" ? (
          <CirclePause size={16} aria-hidden />
        ) : (
          <Play size={16} aria-hidden />
        )}
        <span className="hidden md:inline">
          {phase === "running" ? "일시정지" : replaying ? "다시 재생" : "재생"}
        </span>
      </button>

      <button
        ref={!canControl && phase === "loading" ? currentActionRef : null}
        type="button"
        data-testid="bg3d-physics-reset"
        aria-label={phase === "loading" ? "물리 미리보기 계산 취소" : "물리 미리보기 초기화"}
        disabled={phase === "baking"}
        onClick={onReset}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-xs font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <RotateCcw size={16} aria-hidden />
        <span className="hidden md:inline">{phase === "loading" ? "취소" : "초기화"}</span>
      </button>

      <button
        type="button"
        data-testid="bg3d-physics-bake"
        aria-label="현재 물리 자세를 장면에 적용"
        disabled={!canBake}
        onClick={onBake}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-accent/60 bg-accent px-3 text-xs font-extrabold text-on-accent transition-[filter,transform] hover:brightness-105 active:translate-y-px disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <Check size={16} aria-hidden />
        <span className="hidden min-[390px]:inline">현재 자세 적용</span>
      </button>
    </div>
  );
}
