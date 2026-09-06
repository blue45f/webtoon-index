import {
  Check,
  Eye,
  Layers,
  MousePointerClick,
  Pipette,
  ScanSearch,
  SlidersHorizontal,
} from "lucide-react";
import { useId, useRef } from "react";

import { normalizeHexColor } from "./studio-color-utils";
import {
  STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS,
  normalizeStudioEyedropperSettings,
} from "./studio-eyedropper";
import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  StudioContextPill,
} from "./studio-panel-ui";

import type {
  StudioEyedropperReferenceMode,
  StudioEyedropperSettings,
  StudioEyedropperTarget,
} from "./studio-eyedropper";
import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent, MutableRefObject, ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

type ReferencePresentation = Readonly<{
  id: StudioEyedropperReferenceMode;
  label: string;
  description: string;
  icon: LucideIcon;
}>;

const REFERENCE_OPTIONS: readonly ReferencePresentation[] = [
  {
    id: "merged",
    label: "표시색",
    description: "겹쳐 보이는 최종 색",
    icon: Eye,
  },
  {
    id: "active-layer",
    label: "현재 레이어",
    description: "선택한 레이어만",
    icon: Layers,
  },
  {
    id: "top-layer",
    label: "최상위 레이어",
    description: "포인터 아래 첫 불투명 레이어",
    icon: ScanSearch,
  },
] as const;

const AVERAGE_PRESETS = [
  { radius: 0, label: "정확히" },
  { radius: 1, label: "3×3" },
  { radius: 2, label: "5×5" },
  { radius: 5, label: "11×11" },
] as const;

const EXCLUSION_OPTIONS = [
  { key: "excludeLocked", label: "잠긴 레이어" },
  { key: "excludeText", label: "텍스트·말풍선" },
  { key: "excludeBackground", label: "용지·배경" },
  { key: "excludeDraft", label: "밑그림" },
  { key: "excludeReference", label: "참조 레이어" },
] as const satisfies ReadonlyArray<{
  key:
    | "excludeLocked"
    | "excludeText"
    | "excludeBackground"
    | "excludeDraft"
    | "excludeReference";
  label: string;
}>;

export type StudioEyedropperDisplaySample = Readonly<{
  hex: string;
  layerName?: string | null;
  reference?: StudioEyedropperReferenceMode;
}>;

export interface StudioEyedropperPanelProps {
  active: boolean;
  settings: Partial<StudioEyedropperSettings> | StudioEyedropperSettings;
  primaryColor: string;
  secondaryColor: string;
  recentColors?: readonly string[];
  lastSample?: StudioEyedropperDisplaySample | null;
  activeLayerName?: string | null;
  disabled?: boolean;
  onToggleActive: () => void;
  onSettingsChange: (settings: StudioEyedropperSettings) => void;
  onSelectRecentColor: (hex: string, target: StudioEyedropperTarget) => void;
}

function samplingAreaLabel(radius: number): string {
  if (radius <= 0) return "1픽셀 정확히";
  const edge = radius * 2 + 1;
  return `${edge}×${edge} 원형 평균`;
}

function referenceLabel(reference: StudioEyedropperReferenceMode): string {
  return REFERENCE_OPTIONS.find((option) => option.id === reference)?.label ?? "표시색";
}

function swatchStyle(color: string): { backgroundColor: string } {
  return { backgroundColor: normalizeHexColor(color) ?? "#808080" };
}

function ToggleRow({
  checked,
  disabled = false,
  label,
  description,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description?: string;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left",
        "pointer-coarse:min-h-11",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        disabled
          ? "cursor-not-allowed text-fg-3 opacity-45"
          : "text-fg-2 hover:bg-raised/70",
      )}
    >
      <span className="min-w-0">
        <span className="block text-[0.72rem] font-medium pointer-coarse:text-sm">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[0.65rem] leading-snug text-fg-3 pointer-coarse:text-xs">
            {description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150",
          checked
            ? "border-accent bg-accent"
            : "border-line-strong bg-canvas",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3.5 rounded-full bg-fg shadow-sm transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            checked ? "translate-x-[1.05rem]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

export function StudioEyedropperPanel({
  active,
  settings: settingsInput,
  primaryColor,
  secondaryColor,
  recentColors = [],
  lastSample = null,
  activeLayerName = null,
  disabled = false,
  onToggleActive,
  onSettingsChange,
  onSelectRecentColor,
}: StudioEyedropperPanelProps): ReactElement {
  const headingId = useId();
  const referenceRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const targetRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const settings = normalizeStudioEyedropperSettings(settingsInput);
  const layerExclusionsAvailable = settings.reference !== "merged";
  const selectedTargetColor = settings.target === "primary" ? primaryColor : secondaryColor;
  const safeLastSample = lastSample ? normalizeHexColor(lastSample.hex) : null;
  const dedupedRecentColors: string[] = [];
  for (const color of recentColors) {
    const normalized = normalizeHexColor(color);
    if (!normalized || dedupedRecentColors.includes(normalized)) continue;
    dedupedRecentColors.push(normalized);
    if (dedupedRecentColors.length >= 10) break;
  }

  const updateSettings = (patch: Partial<StudioEyedropperSettings>): void => {
    onSettingsChange(normalizeStudioEyedropperSettings({ ...settings, ...patch }));
  };

  const moveRadioFocus = <T extends string>(input: {
    event: KeyboardEvent<HTMLButtonElement>;
    currentIndex: number;
    options: readonly T[];
    refs: MutableRefObject<Array<HTMLButtonElement | null>>;
    select: (value: T) => void;
  }): void => {
    const { event, currentIndex, options, refs, select } = input;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = options.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : (currentIndex
          + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1)
          + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    select(next);
    refs.current[nextIndex]?.focus();
  };

  return (
    <section
      data-studio-eyedropper-panel="true"
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-line bg-card/50 p-2.5"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="flex items-center gap-1.5 text-xs font-semibold tracking-tight text-fg">
            <Pipette className="size-3.5 text-accent" aria-hidden />
            정밀 스포이드
          </h3>
          <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3 text-pretty pointer-coarse:text-sm">
            표시색 또는 레이어를 선택해 한 픽셀부터 넓은 평균색까지 채집합니다.
          </p>
        </div>
        <StudioContextPill tone={active ? "accent" : "neutral"}>
          {active ? "채집 중" : "I"}
        </StudioContextPill>
      </header>

      <button
        type="button"
        aria-pressed={active}
        aria-keyshortcuts="I"
        disabled={disabled}
        onClick={onToggleActive}
        className={cn(
          "flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold",
          "pointer-coarse:min-h-11 pointer-coarse:text-sm",
          STUDIO_EASE,
          STUDIO_FOCUS_RING,
          active
            ? "border-accent/55 bg-accent-soft text-accent"
            : "border-line bg-card text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg",
          "disabled:cursor-not-allowed disabled:opacity-45",
        )}
      >
        <MousePointerClick className="size-4" aria-hidden />
        {active ? "캔버스를 눌러 색 채집" : "캔버스 스포이드 켜기"}
      </button>
      <p className="text-center text-[0.65rem] leading-relaxed text-fg-3 pointer-coarse:text-xs">
        펜을 쓰는 중에는 <kbd className="rounded border border-line bg-canvas px-1 py-0.5 font-sans">Alt</kbd>를
        누른 채 클릭하면 잠시만 스포이드로 전환됩니다.
      </p>

      <fieldset disabled={disabled}>
        <legend className="mb-1.5 text-[0.7rem] font-medium text-fg-2 pointer-coarse:text-sm">참조 대상</legend>
        <div
          role="radiogroup"
          aria-label="스포이드 참조 대상"
          className="grid grid-cols-3 gap-1 rounded-xl border border-line/70 bg-canvas/65 p-1"
        >
          {REFERENCE_OPTIONS.map((option, index) => {
            const Icon = option.icon;
            const selected = settings.reference === option.id;
            return (
              <button
                key={option.id}
                ref={(node) => {
                  referenceRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${option.label} · ${option.description}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => updateSettings({ reference: option.id })}
                onKeyDown={(event) => moveRadioFocus({
                  event,
                  currentIndex: index,
                  options: REFERENCE_OPTIONS.map((entry) => entry.id),
                  refs: referenceRefs,
                  select: (reference) => updateSettings({ reference }),
                })}
                className={cn(
                  "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-center",
                  "pointer-coarse:min-h-16",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  selected
                    ? "bg-accent-soft text-fg ring-1 ring-accent/35"
                    : "text-fg-3 hover:bg-raised/75 hover:text-fg-2",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="max-w-full truncate text-[0.66rem] font-semibold pointer-coarse:text-xs">
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
        {settings.reference === "active-layer" ? (
          <p
            className={cn(
              "mt-1.5 rounded-lg px-2 py-1.5 text-[0.65rem] leading-relaxed pointer-coarse:text-xs",
              activeLayerName
                ? "bg-raised/50 text-fg-3"
                : "border border-warn/35 bg-warn/10 text-warn",
            )}
            role={activeLayerName ? undefined : "status"}
          >
            {activeLayerName ? `현재 레이어 · ${activeLayerName}` : "먼저 채집할 레이어를 선택해 주세요."}
          </p>
        ) : null}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="mb-1.5 text-[0.7rem] font-medium text-fg-2 pointer-coarse:text-sm">저장할 색</legend>
        <div role="radiogroup" aria-label="스포이드 색상 슬롯" className="grid grid-cols-2 gap-1.5">
          {(["primary", "secondary"] as const).map((target, index) => {
            const selected = settings.target === target;
            const targetColor = target === "primary" ? primaryColor : secondaryColor;
            const label = target === "primary" ? "주 색" : "보조 색";
            return (
              <button
                key={target}
                ref={(node) => {
                  targetRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                aria-label={`${label}에 채집 · 현재 ${targetColor}`}
                onClick={() => updateSettings({ target })}
                onKeyDown={(event) => moveRadioFocus({
                  event,
                  currentIndex: index,
                  options: ["primary", "secondary"] as const,
                  refs: targetRefs,
                  select: (nextTarget) => updateSettings({ target: nextTarget }),
                })}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-lg border px-2 text-left",
                  "pointer-coarse:min-h-11",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  selected
                    ? "border-accent/55 bg-accent-soft/50 text-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised",
                )}
              >
                <span
                  aria-hidden
                  className="size-5 shrink-0 rounded-md border border-line-strong shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.18)]"
                  style={swatchStyle(targetColor)}
                />
                <span className="min-w-0">
                  <span className="block text-[0.68rem] font-semibold pointer-coarse:text-sm">{label}</span>
                  <span className="block truncate font-mono text-[0.6rem] text-fg-3 pointer-coarse:text-xs">
                    {normalizeHexColor(targetColor) ?? targetColor}
                  </span>
                </span>
                {selected ? <Check className="ml-auto size-3.5 text-accent" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2 border-t border-line/60 pt-2.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${headingId}-average`} className="text-[0.7rem] font-medium text-fg-2 pointer-coarse:text-sm">
            평균 영역
          </label>
          <output
            htmlFor={`${headingId}-average`}
            className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[0.65rem] tabular-nums text-fg-2 pointer-coarse:text-xs"
          >
            {samplingAreaLabel(settings.averageRadius)}
          </output>
        </div>
        <input
          id={`${headingId}-average`}
          type="range"
          min={0}
          max={STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS}
          step={1}
          value={settings.averageRadius}
          disabled={disabled}
          aria-label={`스포이드 평균 반경 · ${settings.averageRadius}픽셀`}
          onChange={(event) => updateSettings({ averageRadius: Number(event.target.value) })}
          className="h-7 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:h-11"
        />
        <div className="grid grid-cols-4 gap-1" aria-label="평균 영역 빠른 선택">
          {AVERAGE_PRESETS.map((preset) => (
            <button
              key={preset.radius}
              type="button"
              aria-pressed={settings.averageRadius === preset.radius}
              disabled={disabled}
              onClick={() => updateSettings({ averageRadius: preset.radius })}
              className={cn(
                "min-h-8 rounded-lg border px-1 text-[0.65rem] font-medium pointer-coarse:min-h-11 pointer-coarse:text-xs",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                settings.averageRadius === preset.radius
                  ? "border-accent/55 bg-accent-soft text-accent"
                  : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg-2",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-0.5 border-t border-line/60 pt-2">
        <ToggleRow
          checked={settings.showLoupe}
          disabled={disabled}
          label="확대 루페"
          description="포인터 주변 픽셀과 채집 색을 함께 표시"
          onToggle={() => updateSettings({ showLoupe: !settings.showLoupe })}
        />
        <ToggleRow
          checked={settings.autoReturn}
          disabled={disabled}
          label="채집 후 이전 도구로"
          description="전용 스포이드로 한 번 고른 뒤 자동 복귀"
          onToggle={() => updateSettings({ autoReturn: !settings.autoReturn })}
        />
      </div>

      <details className="group border-t border-line/60 pt-2">
        <summary className={cn(
          "flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2 text-[0.7rem] font-medium text-fg-2",
          "pointer-coarse:min-h-11 pointer-coarse:text-sm [&::-webkit-details-marker]:hidden",
          STUDIO_EASE,
          STUDIO_FOCUS_RING,
          "hover:bg-raised/70",
        )}>
          <span className="inline-flex items-center gap-1.5">
            <SlidersHorizontal className="size-3.5" aria-hidden />
            제외 설정
          </span>
          <span className="text-[0.62rem] font-normal text-fg-3 pointer-coarse:text-xs">
            {layerExclusionsAvailable ? "레이어 참조에 적용" : "레이어 참조에서 사용"}
          </span>
        </summary>
        <fieldset
          disabled={disabled || !layerExclusionsAvailable}
          className="mt-1 space-y-0.5 rounded-lg bg-canvas/45 p-1"
        >
          <legend className="sr-only">스포이드에서 제외할 레이어</legend>
          {EXCLUSION_OPTIONS.map((option) => (
            <ToggleRow
              key={option.key}
              checked={settings[option.key]}
              disabled={disabled || !layerExclusionsAvailable}
              label={option.label}
              onToggle={() => updateSettings({ [option.key]: !settings[option.key] })}
            />
          ))}
          {!layerExclusionsAvailable ? (
            <p className="px-2 pb-1 text-[0.64rem] leading-relaxed text-fg-3 pointer-coarse:text-xs">
              표시색은 완성 화면 그대로 채집합니다. 제외 옵션은 현재·최상위 레이어에서 적용됩니다.
            </p>
          ) : null}
        </fieldset>
      </details>

      {safeLastSample ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl border border-accent/25 bg-accent-soft/20 p-2"
        >
          <span
            aria-hidden
            className="size-9 shrink-0 rounded-lg border border-line-strong shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.18)]"
            style={swatchStyle(safeLastSample)}
          />
          <span className="min-w-0">
            <span className="block text-[0.64rem] text-fg-3 pointer-coarse:text-xs">
              마지막 채집 · {referenceLabel(lastSample?.reference ?? settings.reference)}
            </span>
            <span className="block font-mono text-xs font-semibold uppercase text-fg pointer-coarse:text-sm">
              {safeLastSample}
            </span>
            {lastSample?.layerName ? (
              <span className="block truncate text-[0.62rem] text-fg-3 pointer-coarse:text-xs">
                {lastSample.layerName}
              </span>
            ) : null}
          </span>
          <span className="ml-auto text-right">
            <span className="block text-[0.6rem] text-fg-3 pointer-coarse:text-xs">{settings.target === "primary" ? "주 색" : "보조 색"}</span>
            <span className="block font-mono text-[0.62rem] text-fg-2 pointer-coarse:text-xs">
              {normalizeHexColor(selectedTargetColor) ?? selectedTargetColor}
            </span>
          </span>
        </div>
      ) : null}

      <div className="border-t border-line/60 pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-[0.7rem] font-medium text-fg-2 pointer-coarse:text-sm">최근 채집 색</p>
          <span className="text-[0.62rem] text-fg-3 pointer-coarse:text-xs">{dedupedRecentColors.length}/10</span>
        </div>
        {dedupedRecentColors.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="최근 스포이드 색상">
            {dedupedRecentColors.map((hex, index) => (
              <button
                key={hex}
                type="button"
                aria-label={`최근 채집 색 ${index + 1} ${hex} · ${settings.target === "primary" ? "주 색" : "보조 색"}에 적용`}
                disabled={disabled}
                onClick={() => onSelectRecentColor(hex, settings.target)}
                className={cn(
                  "group/recent relative size-8 rounded-lg border border-line-strong shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.16)]",
                  "pointer-coarse:size-11",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  "hover:-translate-y-px hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transform-none",
                )}
                style={swatchStyle(hex)}
              >
                <span className="sr-only">{hex}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line/80 px-2.5 py-2 text-[0.66rem] leading-relaxed text-fg-3 pointer-coarse:text-xs">
            캔버스에서 색을 고르면 최근 채집 색이 여기에 쌓입니다.
          </p>
        )}
      </div>
    </section>
  );
}
