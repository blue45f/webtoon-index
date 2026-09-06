import {
  AlertTriangle,
  PaintBucket,
  Paintbrush,
  Pipette,
  Redo2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { StudioVrmTextureFillScope } from "./studio-vrm-texture-fill";
import type { StudioVrmTexturePaintBlendMode } from "./studio-vrm-texture-paint-ops";
import type {
  StudioStampBrushKind,
  StudioStampBrushTuning,
} from "../brush/studio-brush-stamp-engine";

import { cn } from "@/shared/lib/utils";

export interface StudioVrmTexturePaintPanelSettings {
  readonly tool: "surface-brush" | "brush" | "fill";
  readonly brushKind: StudioStampBrushKind;
  readonly color: string;
  /** Surface-brush diameter in CSS pixels (legacy key kept for scene compatibility). */
  readonly sizeTexels: number;
  readonly opacity: number;
  readonly blend: StudioVrmTexturePaintBlendMode;
  readonly fillScope: StudioVrmTextureFillScope;
  readonly fillTolerance: number;
  readonly tuning: Required<StudioStampBrushTuning>;
}

export interface StudioVrmTexturePaintPanelProps {
  readonly hidden: boolean;
  readonly disabled: boolean;
  readonly settings: StudioVrmTexturePaintPanelSettings;
  readonly activeTargetId: string | null;
  readonly activeTextureLabel: string | null;
  readonly surfaceBrushUnavailableReason: string;
  readonly status: string;
  readonly restoreError?: string | null;
  readonly strokeActive: boolean;
  readonly targetCount: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly eyedropperActive: boolean;
  readonly onSettingsChange: (
    update: Partial<Omit<StudioVrmTexturePaintPanelSettings, "tuning">> & {
      tuning?: Partial<StudioVrmTexturePaintPanelSettings["tuning"]>;
    },
  ) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onEyedropperToggle: () => void;
  readonly onResetActiveTexture: () => void;
  readonly onRetryRestore?: () => void;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

interface StudioVrmTexturePaintColorDraft {
  readonly sourceColor: string;
  readonly value: string;
}

export function StudioVrmTexturePaintPanel({
  hidden,
  disabled,
  settings,
  activeTargetId,
  activeTextureLabel,
  surfaceBrushUnavailableReason,
  status,
  restoreError,
  strokeActive,
  targetCount,
  canUndo,
  canRedo,
  eyedropperActive,
  onSettingsChange,
  onUndo,
  onRedo,
  onEyedropperToggle,
  onResetActiveTexture,
  onRetryRestore,
}: StudioVrmTexturePaintPanelProps) {
  const editingDisabled = disabled || strokeActive;
  const hasActiveTexture = activeTargetId !== null;
  const [resetConfirmationTarget, setResetConfirmationTarget] = useState<string | null>(null);
  const resetArmed =
    activeTargetId !== null && resetConfirmationTarget === activeTargetId;
  useEffect(() => {
    setResetConfirmationTarget(null);
  }, [activeTargetId]);
  useEffect(() => {
    if (resetConfirmationTarget === null) return;
    const timer = window.setTimeout(() => setResetConfirmationTarget(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [resetConfirmationTarget]);
  const settingsColor = settings.color.toUpperCase();
  const [colorDraftState, setColorDraftState] = useState<StudioVrmTexturePaintColorDraft>(
    () => ({
      sourceColor: settingsColor,
      value: settingsColor,
    }),
  );
  const colorDraft =
    colorDraftState.sourceColor === settingsColor
      ? colorDraftState.value
      : settingsColor;
  const colorDraftIsValid = HEX_COLOR.test(colorDraft);
  const updateColorDraft = (value: string) => {
    setColorDraftState({
      sourceColor: settingsColor,
      value: value.toUpperCase(),
    });
  };
  const resetColorDraft = () => {
    setColorDraftState({
      sourceColor: settingsColor,
      value: settingsColor,
    });
  };
  const commitColorDraft = () => {
    if (!colorDraftIsValid) {
      resetColorDraft();
      return;
    }
    const color = colorDraft.toLowerCase();
    setColorDraftState({
      sourceColor: settingsColor,
      value: colorDraft.toUpperCase(),
    });
    if (color !== settings.color.toLowerCase()) {
      onSettingsChange({ color });
    }
  };

  return (
    <section
      id="vrm-character-section-surface"
      role="tabpanel"
      aria-labelledby="vrm-character-subtab-surface"
      hidden={hidden}
      className="space-y-4"
    >
      <div className="border-b border-line pb-3">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/35 bg-accent-soft text-accent">
            <Paintbrush size={17} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-fg">3D 표면 페인트</h3>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
              모델 표면을 따라 직접 그리거나 ColorDrop으로 연결 영역을 채웁니다. 스포이드 버튼
              또는 Alt+클릭으로 baseColor 색을 가져오며, 결과는 삽입 이미지와 캡처에 바로 반영됩니다.
            </p>
          </div>
        </div>
        <div
          className={cn(
            "mt-3 flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[0.68rem]",
            status
              ? "border-accent/30 bg-accent-soft/35 text-fg-2"
              : "border-line bg-card/60 text-fg-3",
          )}
          role="status"
          aria-live="polite"
        >
          <span className="min-w-0">
            <span className="block truncate font-bold text-fg">
              {activeTextureLabel ?? "칠할 표면을 선택하세요"}
            </span>
            <span className="mt-0.5 block leading-relaxed">
              {status || "뷰포트에서 옷·피부·머리 표면을 누르면 해당 텍스처가 선택됩니다."}
            </span>
          </span>
          <span className="shrink-0 tabular-nums" aria-label={`편집 중인 텍스처 ${targetCount}개`}>
            {targetCount}개 텍스처
          </span>
        </div>
        {restoreError && onRetryRestore ? (
          <div
            className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-bad/45 bg-[oklch(0.66_0.20_25/0.10)] px-3 py-2.5 text-[0.68rem] text-fg-2"
            role="alert"
          >
            <span className="flex min-w-0 items-start gap-2 leading-relaxed">
              <AlertTriangle className="mt-0.5 shrink-0 text-bad" size={14} aria-hidden />
              <span>
                <span className="block font-bold text-fg">원본 텍스처 복원이 중단됐습니다.</span>
                <span className="mt-0.5 block">{restoreError}</span>
              </span>
            </span>
            <button
              type="button"
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-bad/45 bg-card px-2.5 font-bold text-bad transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={onRetryRestore}
            >
              <RotateCcw size={13} aria-hidden />
              다시 시도
            </button>
          </div>
        ) : null}
      </div>

      <fieldset disabled={editingDisabled} className="space-y-2 disabled:opacity-60">
        <legend className="mb-2 text-xs font-bold text-fg">표면 도구</legend>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="표면 페인트 도구">
          <button
            type="button"
            aria-pressed={settings.tool === "surface-brush"}
            title="3D 모델 표면을 따라 직접 그립니다. 필압과 기울기는 로컬 UV 브러시에 반영됩니다."
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-[0.68rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              settings.tool === "surface-brush"
                ? "border-accent/60 bg-accent-soft text-accent"
                : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
            )}
            onClick={() => onSettingsChange({ tool: "surface-brush" })}
          >
            <Paintbrush size={14} aria-hidden />
            표면 브러시
          </button>
          <button
            type="button"
            aria-pressed={settings.tool === "fill"}
            title="표면의 비슷한 색 영역을 서버 전송 없이 로컬 Worker에서 채웁니다."
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-[0.68rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              settings.tool === "fill"
                ? "border-accent/60 bg-accent-soft text-accent"
                : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
            )}
            onClick={() => onSettingsChange({ tool: "fill" })}
          >
            <PaintBucket size={14} aria-hidden />
            ColorDrop
          </button>
        </div>
        <p className="text-[0.64rem] leading-relaxed text-fg-3">
          {settings.tool === "surface-brush"
            ? "모델 위를 드래그해 직접 그립니다. 필압은 굵기에 반영되고 한 번의 제스처가 하나의 실행 취소 단계가 됩니다."
            : "표면을 한 번 눌러 채웁니다. 계산은 기기 안에서 처리되며 텍스처 경계를 넘어 번지지 않습니다."}
        </p>
      </fieldset>

      <div
        id="vrm-surface-brush-capability-note"
        hidden={settings.tool !== "surface-brush"}
        className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft/35 px-3 py-2.5 text-[0.64rem] leading-relaxed text-fg-2"
        role="note"
        data-testid="vrm-surface-brush-capability"
      >
        <Paintbrush size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0">
          <span className="block font-bold text-fg">직접 그리기 지원 범위</span>
          {surfaceBrushUnavailableReason}
        </span>
      </div>

      <div className="space-y-3 border-t border-line pt-3">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
          <label htmlFor="vrm-surface-paint-color" className="text-xs font-bold text-fg">
            색상
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <input
              id="vrm-surface-paint-color"
              type="color"
              value={settings.color}
              disabled={editingDisabled}
              aria-label="표면 페인트 색상 선택"
              className="size-11 shrink-0 cursor-pointer rounded-lg border border-line bg-card p-1 disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) => {
                updateColorDraft(event.target.value);
                onSettingsChange({ color: event.target.value });
              }}
            />
            <button
              type="button"
              disabled={editingDisabled}
              aria-label={eyedropperActive ? "표면 스포이드 취소" : "표면 스포이드"}
              aria-pressed={eyedropperActive}
              title="한 번 눌러 표면 색을 선택합니다. 데스크톱에서는 Alt+클릭으로 잠시 사용할 수 있습니다."
              className={cn(
                "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                eyedropperActive
                  ? "border-accent/60 bg-accent-soft text-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
              )}
              onClick={onEyedropperToggle}
            >
              <Pipette size={17} aria-hidden />
            </button>
            <input
              type="text"
              value={colorDraft}
              disabled={editingDisabled}
              inputMode="text"
              maxLength={7}
              pattern="#[0-9A-Fa-f]{6}"
              aria-label="표면 페인트 HEX 색상"
              aria-describedby="vrm-surface-paint-hex-hint"
              aria-invalid={!colorDraftIsValid}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 text-xs font-semibold uppercase tabular-nums text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) => updateColorDraft(event.target.value)}
              onBlur={commitColorDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitColorDraft();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  resetColorDraft();
                }
              }}
            />
            <span id="vrm-surface-paint-hex-hint" className="sr-only">
              7자리 HEX 색상을 입력한 뒤 Enter를 누르거나 입력란 밖으로 이동하세요.
            </span>
          </div>
        </div>

        <div
          hidden={settings.tool !== "surface-brush"}
          className="space-y-3"
          data-testid="vrm-surface-brush-controls"
        >
          <label
            htmlFor="vrm-surface-brush-size"
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
          >
            <span className="font-semibold text-fg-2">크기</span>
            <input
              id="vrm-surface-brush-size"
              type="range"
              min="2"
              max="192"
              step="1"
              value={settings.sizeTexels}
              disabled={editingDisabled}
              aria-label="표면 브러시 크기"
              aria-valuetext={`${Math.round(settings.sizeTexels)} px`}
              className="h-2 min-w-0 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) => onSettingsChange({ sizeTexels: Number(event.target.value) })}
            />
            <output
              htmlFor="vrm-surface-brush-size"
              className="text-right text-[0.68rem] tabular-nums text-fg-3"
            >
              {Math.round(settings.sizeTexels)} px
            </output>
          </label>

          <label
            htmlFor="vrm-surface-brush-opacity"
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
          >
            <span className="font-semibold text-fg-2">불투명도</span>
            <input
              id="vrm-surface-brush-opacity"
              type="range"
              min="0.01"
              max="1"
              step="0.01"
              value={settings.opacity}
              disabled={editingDisabled}
              aria-label="표면 브러시 불투명도"
              aria-valuetext={`${Math.round(settings.opacity * 100)}%`}
              className="h-2 min-w-0 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) => onSettingsChange({ opacity: Number(event.target.value) })}
            />
            <output
              htmlFor="vrm-surface-brush-opacity"
              className="text-right text-[0.68rem] tabular-nums text-fg-3"
            >
              {Math.round(settings.opacity * 100)}%
            </output>
          </label>

          <label
            htmlFor="vrm-surface-brush-flow"
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
          >
            <span className="font-semibold text-fg-2">도포량</span>
            <input
              id="vrm-surface-brush-flow"
              type="range"
              min="0.01"
              max="1"
              step="0.01"
              value={settings.tuning.flow}
              disabled={editingDisabled}
              aria-label="표면 브러시 도포량"
              aria-valuetext={`${Math.round(settings.tuning.flow * 100)}%`}
              className="h-2 min-w-0 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) =>
                onSettingsChange({ tuning: { flow: Number(event.target.value) } })}
            />
            <output
              htmlFor="vrm-surface-brush-flow"
              className="text-right text-[0.68rem] tabular-nums text-fg-3"
            >
              {Math.round(settings.tuning.flow * 100)}%
            </output>
          </label>

          <label
            htmlFor="vrm-surface-brush-hardness"
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
          >
            <span className="font-semibold text-fg-2">경도</span>
            <input
              id="vrm-surface-brush-hardness"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={settings.tuning.hardness}
              disabled={editingDisabled}
              aria-label="표면 브러시 경도"
              aria-valuetext={`${Math.round(settings.tuning.hardness * 100)}%`}
              className="h-2 min-w-0 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) =>
                onSettingsChange({ tuning: { hardness: Number(event.target.value) } })}
            />
            <output
              htmlFor="vrm-surface-brush-hardness"
              className="text-right text-[0.68rem] tabular-nums text-fg-3"
            >
              {Math.round(settings.tuning.hardness * 100)}%
            </output>
          </label>

          <label
            htmlFor="vrm-surface-brush-min-size"
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
          >
            <span className="font-semibold text-fg-2">최소 굵기</span>
            <input
              id="vrm-surface-brush-min-size"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={settings.tuning.minSize}
              disabled={editingDisabled}
              aria-label="표면 브러시 최소 굵기"
              aria-valuetext={`${Math.round(settings.tuning.minSize * 100)}%`}
              className="h-2 min-w-0 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) =>
                onSettingsChange({ tuning: { minSize: Number(event.target.value) } })}
            />
            <output
              htmlFor="vrm-surface-brush-min-size"
              className="text-right text-[0.68rem] tabular-nums text-fg-3"
            >
              {Math.round(settings.tuning.minSize * 100)}%
            </output>
          </label>

          <p className="text-[0.62rem] leading-relaxed text-fg-3">
            현재 제품 경로는 round 촉과 혼색 없음만 지원합니다. 미지원 촉·혼색은 자동 대체하지 않습니다.
          </p>
        </div>

        <div hidden={settings.tool !== "fill"} className="space-y-3">
        <label htmlFor="vrm-surface-fill-tolerance" className="grid grid-cols-[3rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
          <span className="font-semibold text-fg-2">허용치</span>
          <input
            id="vrm-surface-fill-tolerance"
            type="range"
            min="0"
            max="255"
            step="1"
            value={settings.fillTolerance}
            disabled={editingDisabled}
            aria-label="ColorDrop 색상 허용치"
            className="h-2 min-w-0 accent-accent disabled:cursor-not-allowed disabled:opacity-45"
            onChange={(event) =>
              onSettingsChange({ fillTolerance: Number(event.target.value) })}
          />
          <output htmlFor="vrm-surface-fill-tolerance" className="text-right text-[0.68rem] tabular-nums text-fg-3">
            {Math.round(settings.fillTolerance)}
          </output>
        </label>
        <fieldset disabled={editingDisabled} className="space-y-2 disabled:opacity-60">
          <legend className="text-xs font-semibold text-fg-2">채울 범위</legend>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="ColorDrop 채울 범위">
            {([
              ["contiguous", "연결 영역"],
              ["whole-material", "텍스처 전체"],
            ] as const).map(([scope, label]) => (
              <button
                key={scope}
                type="button"
                aria-pressed={settings.fillScope === scope}
                className={cn(
                  "min-h-11 rounded-lg border px-2 text-[0.66rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                  settings.fillScope === scope
                    ? "border-accent/60 bg-accent-soft text-accent"
                    : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                )}
                onClick={() => onSettingsChange({ fillScope: scope })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[0.62rem] leading-relaxed text-fg-3">
            {settings.fillScope === "contiguous"
              ? "누른 지점과 이어진 비슷한 색만 채웁니다."
              : "현재 텍스처 전체에서 비슷한 색을 찾습니다. 떨어진 UV 조각도 함께 바뀔 수 있습니다."}
          </p>
        </fieldset>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-line pt-3">
        <button
          type="button"
          disabled={disabled || strokeActive || !canUndo}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-[0.68rem] font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onUndo}
        >
          <Undo2 size={14} aria-hidden />
          취소
        </button>
        <button
          type="button"
          disabled={disabled || strokeActive || !canRedo}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-[0.68rem] font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onRedo}
        >
          <Redo2 size={14} aria-hidden />
          재실행
        </button>
        <button
          type="button"
          disabled={disabled || strokeActive || !hasActiveTexture}
          aria-pressed={resetArmed}
          title={resetArmed
            ? "한 번 더 누르면 선택한 텍스처를 원본으로 복원하고 편집 기록을 비웁니다."
            : "원본 복원은 되돌릴 수 없습니다. 실수를 막기 위해 두 번 눌러 확인합니다."}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-[0.68rem] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            resetArmed
              ? "border-bad/60 bg-[oklch(0.66_0.20_25/0.12)] text-bad"
              : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
          )}
          onClick={() => {
            if (!resetArmed) {
              setResetConfirmationTarget(activeTargetId);
              return;
            }
            setResetConfirmationTarget(null);
            onResetActiveTexture();
          }}
        >
          <RotateCcw size={14} aria-hidden />
          {resetArmed ? "한 번 더" : "원본"}
        </button>
      </div>
    </section>
  );
}
