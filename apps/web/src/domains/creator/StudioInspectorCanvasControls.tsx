/**
 * 페이지 ▸ 캔버스.
 *
 * 기본 6개만 상시 노출하고 나머지 17개는 CSP 팔레트식 접기 뒤로 들어간다.
 * 접힌 섹션은 열린 상태를 기억하고, 값이 설정돼 있으면 헤더 배지로 알린다.
 */

import { Droplets } from "lucide-react";
import { useId } from "react";

import { BG_PRESETS, CANVAS_W, type BgPreset } from "./studio-assets";
import { GRADIENT_PRESETS, gradientToBgGrad } from "./studio-gradients";
import { normalizeSurfaceColor, surfaceGradientsMatch } from "./studio-inspector-surface-selection";
import { MAGIC_RESIZE_DEFAULT_STRATEGY } from "./studio-magic-resize";
import {
  STUDIO_TEMPLATE_GUTTER_MAX,
  STUDIO_TEMPLATE_GUTTER_MIN,
  STUDIO_TEMPLATE_GUTTER_STEP,
  type StudioTemplateGutterUnavailableReason,
} from "./studio-template-gutter-layout";
import { StudioInspectorSection } from "./StudioInspectorSection";
import { StudioMagicResizePanel } from "./StudioMagicResizePanel";
import { StudioPaperSurfacePicker } from "./StudioPaperSurfacePicker";
import { StudioPercentGuideControls } from "./StudioPercentGuideControls";

import type { PaperGrainKind } from "./brush/studio-paper-texture";
import type { MagicResizePreset, MagicResizeStrategy } from "./studio-magic-resize";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export interface StudioInspectorUserGuide {
  readonly id: string;
  readonly type: "v" | "h";
  readonly pos: number;
}

export interface StudioInspectorCanvasControlsProps {
  readonly background: string;
  readonly backgroundGradient: readonly string[] | null;
  readonly canvasHeight: number;
  readonly controlsDisabled: boolean;
  readonly controlsDisabledReason: string | null | undefined;
  readonly gridSize: number;
  readonly showAlignmentGuides: boolean;
  readonly hidden: boolean;
  readonly magicResizeStrategy: MagicResizeStrategy;
  readonly masterEditMode: boolean;
  readonly panelGutter: number;
  readonly panelId?: string;
  readonly panelLabelledBy?: string;
  /** Active document paper grain (brush granulation surface). */
  readonly paperGrainKind: PaperGrainKind;
  /** Stage paper-grain fill visibility (default true when unset on page). */
  readonly paperGrainVisible: boolean;
  readonly showGrid: boolean;
  readonly showWebtoonGuides: boolean;
  readonly snapEnabled: boolean;
  readonly templateGutterUnavailableReason: StudioTemplateGutterUnavailableReason | null;
  readonly userGuides: readonly StudioInspectorUserGuide[];
  readonly webtoonGuides: typeof import("./studio-webtoon-guides") | null;
  readonly webtoonTheme: "classic" | "soft" | "vivid";
  readonly onAddUserGuide: (type: "v" | "h", pos?: number) => void;
  readonly onApplyBackgroundPreset: (preset: BgPreset) => void;
  readonly onApplyMagicResizePreset: (preset: MagicResizePreset) => void;
  readonly onBackgroundChange: (color: string) => void;
  readonly onCanvasHeightDelta: (delta: number) => void;
  readonly onClearUserGuides: () => void;
  readonly onDeleteUserGuide: (id: string) => void;
  readonly onShowAlignmentGuidesChange: (visible: boolean) => void;
  readonly onGradientChange: (gradient: string[]) => void;
  readonly onGridSizeChange: (size: number) => void;
  readonly onMagicResizeStrategyChange: (strategy: MagicResizeStrategy) => void;
  readonly onMoveUserGuide: (id: string, pos: number) => void;
  readonly onOpenBackgroundEditor: () => void;
  readonly onPanelGutterChange: (gutter: number) => void;
  readonly onPaperGrainKindChange: (kind: PaperGrainKind) => void;
  readonly onPaperGrainVisibleChange: (visible: boolean) => void;
  readonly onApplyPaperTintBackground: () => void;
  readonly onShowGridChange: (visible: boolean) => void;
  readonly onShowWebtoonGuidesChange: (visible: boolean) => void;
  readonly onSnapEnabledChange: (enabled: boolean) => void;
  readonly onWarmWebtoonGuides: () => void;
  readonly onWebtoonThemeChange: (theme: "classic" | "soft" | "vivid") => void;
}

function localizeText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function templateGutterUnavailableCopy(
  t: (key: string) => string,
  reason: StudioTemplateGutterUnavailableReason,
): string {
  const korean = {
    "no-template": "패널 템플릿을 적용하면 전체 패널의 여백을 한 번에 조절할 수 있어요.",
    "no-panels": "빈 캔버스에는 여백을 조절할 패널이 없어요.",
    "unsupported-topology": "이 템플릿의 비정형 패널 배치는 자동 여백 조절을 지원하지 않아요.",
  } as const;
  const english = {
    "no-template": "Apply a panel template to adjust all panel gaps together.",
    "no-panels": "A blank canvas has no panel gaps to adjust.",
    "unsupported-topology": "Automatic gap adjustment is unavailable for this template's irregular panel layout.",
  } as const;
  const probeKey = "studio.settings.tool.select";
  const probe = t(probeKey);
  const hasStudioLocalePack = probe !== probeKey && !probe.startsWith("studio.");
  return hasStudioLocalePack && probe !== "선택" ? english[reason] : korean[reason];
}

/**
 * 밀도 토큰 — 이 패널은 행마다 `mt-2`/`mt-3` 를 손으로 붙이고 라벨 크기도
 * `text-sm`/`text-xs` 가 섞여 있었다. 인스펙터 나머지 크롬은 `text-xs` 한 단계이므로
 * 여기로 통일하고, 터치에서 44px·마우스에서 32px 인 행 높이를 한 곳에서 준다.
 */
const rowClass =
  "flex min-h-11 items-center justify-between gap-2 text-xs text-fg-2 lg:min-h-8 pointer-coarse:min-h-11";
const checkboxClass =
  "size-3.5 shrink-0 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60";
const stepperClass =
  "grid min-h-9 min-w-9 place-items-center rounded border border-line text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11";
/** 스와치는 눈에 보이는 크기(24px)를 유지하고 손가락 대상만 44px 로 넓힌다. */
const swatchButtonClass =
  "grid size-11 place-items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 lg:size-7 pointer-coarse:size-11";
const addGuideClass =
  "min-h-9 flex-1 cursor-pointer rounded border border-line bg-card text-[0.68rem] font-semibold text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11";

export function StudioInspectorCanvasControls({
  background,
  backgroundGradient,
  canvasHeight,
  controlsDisabled,
  controlsDisabledReason,
  showAlignmentGuides,
  gridSize,
  hidden,
  magicResizeStrategy,
  masterEditMode,
  panelGutter,
  panelId,
  panelLabelledBy,
  paperGrainKind,
  paperGrainVisible,
  showGrid,
  showWebtoonGuides,
  snapEnabled,
  templateGutterUnavailableReason,
  userGuides,
  webtoonGuides,
  webtoonTheme,
  onAddUserGuide,
  onApplyBackgroundPreset,
  onApplyMagicResizePreset,
  onBackgroundChange,
  onCanvasHeightDelta,
  onClearUserGuides,
  onDeleteUserGuide,
  onGradientChange,
  onGridSizeChange,
  onMagicResizeStrategyChange,
  onMoveUserGuide,
  onOpenBackgroundEditor,
  onPanelGutterChange,
  onPaperGrainKindChange,
  onPaperGrainVisibleChange,
  onApplyPaperTintBackground,
  onShowAlignmentGuidesChange,
  onShowGridChange,
  onShowWebtoonGuidesChange,
  onSnapEnabledChange,
  onWarmWebtoonGuides,
  onWebtoonThemeChange,
}: StudioInspectorCanvasControlsProps) {
  const t = useT();
  const panelGutterReasonId = useId();
  const fixedAmount = 240;
  const panelGutterDisabledReason = controlsDisabled
    ? controlsDisabledReason ?? "문서 설정이 잠겨 있어 패널 여백을 변경할 수 없어요."
    : templateGutterUnavailableReason
      ? templateGutterUnavailableCopy(t, templateGutterUnavailableReason)
      : null;
  const guideAxisLabel = (type: StudioInspectorUserGuide["type"]) =>
    localizeText(t, type === "v" ? "세로" : "가로", `studio.canvas.guideType.${type === "v" ? "vertical" : "horizontal"}`);
  const hasBackgroundGradient = backgroundGradient?.length === 2;
  const hasCustomBackground = hasBackgroundGradient || normalizeSurfaceColor(background) !== "#ffffff";

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={panelLabelledBy}
      aria-label={panelLabelledBy ? undefined : localizeText(t, "캔버스 설정", "studio.canvas.aria")}
      hidden={hidden}
      className="rounded-xl border border-line bg-panel/40 p-3"
    >
      <p className="mb-1.5 text-xs font-semibold text-fg-3">{localizeText(t, "캔버스", "studio.canvas.section")}</p>

      {/* ---- 기본 티어: 매 컷 확인하는 다섯 가지만 접지 않는다 (density 표 참조) ---- */}
      <div className="space-y-0.5">
        <label className={rowClass}>
          {localizeText(t, "배경색", "studio.canvas.background")}
          <input
            type="color"
            value={background}
            onChange={(event) => onBackgroundChange(event.currentTarget.value)}
            disabled={controlsDisabled}
            className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>

        <div className={rowClass}>
          <span>{localizeText(t, "높이", "studio.canvas.height")}</span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={localizeText(t, "높이 240px 줄이기", "studio.canvas.heightDecrease").replace("{amount}", String(fixedAmount))}
              disabled={controlsDisabled}
              onClick={() => onCanvasHeightDelta(-fixedAmount)}
              className={stepperClass}
            >
              −
            </button>
            <span
              className="numeral w-12 text-center text-xs"
              aria-label={localizeText(t, "높이 240px", "studio.canvas.heightValue").replace("{height}", String(canvasHeight))}
            >
              {canvasHeight}
            </span>
            <button
              type="button"
              aria-label={localizeText(t, "높이 240px 늘리기", "studio.canvas.heightIncrease").replace("{amount}", String(fixedAmount))}
              disabled={controlsDisabled}
              onClick={() => onCanvasHeightDelta(fixedAmount)}
              className={stepperClass}
            >
              +
            </button>
          </span>
        </div>

        <label className={rowClass}>
          {localizeText(t, "그리드 격자 표시", "studio.canvas.showGrid")}
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(event) => onShowGridChange(event.currentTarget.checked)}
              disabled={controlsDisabled}
              className={checkboxClass}
            />
            {showGrid && (
              <select
                value={gridSize}
                onChange={(event) => onGridSizeChange(Number(event.currentTarget.value))}
                disabled={controlsDisabled}
                aria-label={localizeText(t, "그리드 간격", "studio.canvas.gridSize")}
                className="min-h-9 rounded border border-line bg-card px-1 text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {[20, 30, 40, 50, 60, 80].map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            )}
          </span>
        </label>

        <label className={rowClass}>
          <span>
            {localizeText(t, "정렬 가이드 (스냅)", "studio.canvas.snapGuide")}
            <span aria-hidden className="ml-1.5 text-fg-3">
              ({snapEnabled ? t("studio.settings.state.on") : t("studio.settings.state.off")})
            </span>
          </span>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(event) => onSnapEnabledChange(event.currentTarget.checked)}
            disabled={controlsDisabled}
            aria-label={`${localizeText(t, "정렬 가이드 (스냅)", "studio.canvas.snapGuide")} (${snapEnabled ? t("studio.settings.state.on") : t("studio.settings.state.off")})`}
            className={checkboxClass}
          />
        </label>

        <label className={rowClass}>
          {localizeText(t, "웹툰 규격 가이드", "studio.canvas.webtoonGuide")}
          <input
            type="checkbox"
            checked={showWebtoonGuides}
            onChange={(event) => onShowWebtoonGuidesChange(event.currentTarget.checked)}
            onPointerEnter={onWarmWebtoonGuides}
            onFocus={onWarmWebtoonGuides}
            disabled={controlsDisabled}
            className={checkboxClass}
          />
        </label>
        {showWebtoonGuides && (
          <div className="rounded-md border border-line bg-card px-2 py-1.5 text-[0.68rem] leading-snug text-fg-3">
            {webtoonGuides
              ? (() => {
                  const length = webtoonGuides.episodeLengthLabel(canvasHeight);
                  return (
                    <>
                      <span className="font-semibold text-fg-2">{length.label}</span> · {length.tier}
                      <br />
                      {localizeText(
                        t,
                        "파란 점선 = 플랫폼 표준폭(네이버 690·카카오 720), 붉은 음영 = 세이프영역.",
                        "studio.canvas.webtoonGuideLegend",
                      )}
                    </>
                  );
                })()
              : localizeText(
                  t,
                  "웹툰 규격 가이드를 여는 중...",
                  "studio.canvas.webtoonGuideLoading",
                )}
          </div>
        )}
      </div>

      {/* ---- 접히는 티어 ---- */}
      <StudioInspectorSection
        sectionId="canvas.surface"
        activeCount={(paperGrainVisible ? 1 : 0) + (hasCustomBackground ? 1 : 0)}
        loadingLabel={localizeText(t, "배경·종이 질감을 여는 중...", "studio.canvas.surfaceLoading")}
      >
        <StudioPaperSurfacePicker
          controlsDisabled={controlsDisabled}
          paperGrainKind={paperGrainKind}
          paperGrainVisible={paperGrainVisible}
          onPaperGrainKindChange={onPaperGrainKindChange}
          onPaperGrainVisibleChange={onPaperGrainVisibleChange}
          onApplyPaperTintBackground={onApplyPaperTintBackground}
        />
        <div className="flex flex-wrap gap-1.5">
          {BG_PRESETS.map((preset) => {
            const isSelected = preset.grad
              ? surfaceGradientsMatch(backgroundGradient, preset.grad)
              : !hasBackgroundGradient && normalizeSurfaceColor(background) === normalizeSurfaceColor(preset.fill);
            return (
              <button
                key={preset.id}
                type="button"
                disabled={controlsDisabled}
                onClick={() => onApplyBackgroundPreset(preset)}
                title={localizeText(t, `배경 ${preset.label}`, "studio.canvas.backgroundPresetAria").replace("{label}", preset.label)}
                aria-label={localizeText(t, `배경 ${preset.label}`, "studio.canvas.backgroundPresetAria").replace("{label}", preset.label)}
                aria-pressed={isSelected}
                className={cn(swatchButtonClass, isSelected && "bg-accent-soft ring-2 ring-inset ring-accent")}
              >
                <span
                  aria-hidden
                  className="block size-6 rounded-md border border-line"
                  style={{
                    background: preset.grad
                      ? `linear-gradient(${preset.grad[0]}, ${preset.grad[1]})`
                      : preset.fill,
                  }}
                />
              </button>
            );
          })}
        </div>
        <div>
          <p className="mb-1 text-[0.68rem] font-medium text-fg-3">{localizeText(t, "그라디언트 배경", "studio.canvas.gradient")}</p>
          <div className="flex flex-wrap gap-1.5">
            {GRADIENT_PRESETS.map((preset) => {
              const [start, end] = gradientToBgGrad(preset);
              const isSelected = surfaceGradientsMatch(backgroundGradient, [start, end]);
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => onGradientChange(gradientToBgGrad(preset))}
                  title={preset.tip}
                  aria-label={localizeText(t, `그라디언트 ${preset.label}`, "studio.canvas.gradientPresetAria").replace("{label}", preset.label)}
                  aria-pressed={isSelected}
                  className={cn(swatchButtonClass, isSelected && "bg-accent-soft ring-2 ring-inset ring-accent")}
                >
                  <span
                    aria-hidden
                    className="block size-6 rounded-md border border-line"
                    style={{ background: `linear-gradient(${start}, ${end})` }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={onOpenBackgroundEditor}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-accent/30 bg-accent-soft px-2 text-[0.7rem] font-bold text-accent hover:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-9"
        >
          <Droplets size={13} aria-hidden />
          {localizeText(t, "배경 편집기 · 리사이저 열기", "studio.canvas.openBackgroundEditor")}
        </button>
      </StudioInspectorSection>

      <StudioInspectorSection
        sectionId="canvas.resize"
        activeCount={magicResizeStrategy === MAGIC_RESIZE_DEFAULT_STRATEGY ? 0 : 1}
        loadingLabel={localizeText(t, "크기·여백을 여는 중...", "studio.canvas.resizeLoading")}
      >
        {!masterEditMode && (
          <StudioMagicResizePanel
            currentSize={{ width: CANVAS_W, height: canvasHeight }}
            disabled={controlsDisabled}
            strategy={magicResizeStrategy}
            onStrategyChange={onMagicResizeStrategyChange}
            onApplyPreset={onApplyMagicResizePreset}
          />
        )}
        <div>
          <label className={rowClass}>
            {localizeText(t, "패널 여백 (Gutter)", "studio.canvas.panelGutter")}
            <span className="flex items-center gap-1.5">
              <input
                type="range"
                min={STUDIO_TEMPLATE_GUTTER_MIN}
                max={STUDIO_TEMPLATE_GUTTER_MAX}
                step={STUDIO_TEMPLATE_GUTTER_STEP}
                value={panelGutter}
                onChange={(event) => onPanelGutterChange(Number(event.currentTarget.value))}
                aria-describedby={panelGutterDisabledReason ? panelGutterReasonId : undefined}
                className="w-24 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={panelGutterDisabledReason !== null}
              />
              <span className="w-5 text-right text-xs tabular-nums text-fg-3">{panelGutter}</span>
            </span>
          </label>
          {panelGutterDisabledReason && (
            <p
              id={panelGutterReasonId}
              data-studio-panel-gutter-reason
              className="mt-1 text-[0.68rem] leading-relaxed text-fg-3"
            >
              {panelGutterDisabledReason}
            </p>
          )}
        </div>
      </StudioInspectorSection>

      <StudioInspectorSection
        sectionId="canvas.guide-lines"
        activeCount={(showAlignmentGuides ? 1 : 0) + (userGuides.length > 0 ? 1 : 0)}
        loadingLabel={localizeText(t, "가이드선을 여는 중...", "studio.canvas.guideLinesLoading")}
      >
        <label className={rowClass}>
          <span>
            {localizeText(t, "정렬 가이드", "studio.settings.grids.alignGuideLabel")}
            <span aria-hidden className="ml-1.5 text-fg-3">
              ({showAlignmentGuides ? t("studio.settings.state.on") : t("studio.settings.state.off")})
            </span>
          </span>
          <input
            type="checkbox"
            checked={showAlignmentGuides}
            onChange={(event) => onShowAlignmentGuidesChange(event.currentTarget.checked)}
            disabled={controlsDisabled}
            aria-label={`${localizeText(t, "정렬 가이드", "studio.settings.grids.alignGuideLabel")} (${showAlignmentGuides ? t("studio.settings.state.on") : t("studio.settings.state.off")})`}
            className={checkboxClass}
          />
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={() => onAddUserGuide("v")}
            className={addGuideClass}
          >
            {localizeText(t, "+ 세로 가이드", "studio.canvas.addVerticalGuide")}
          </button>
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={() => onAddUserGuide("h")}
            className={addGuideClass}
          >
            {localizeText(t, "+ 가로 가이드", "studio.canvas.addHorizontalGuide")}
          </button>
        </div>

        <StudioPercentGuideControls
          canvasHeight={canvasHeight}
          disabled={controlsDisabled}
          onAddGuide={onAddUserGuide}
        />

        {userGuides.length > 0 && (
          <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-line bg-card/30 p-2">
            {userGuides.map((guide, index) => (
              <div
                key={guide.id}
                className="flex items-center justify-between gap-1.5 text-[0.65rem]"
              >
                <span className="font-medium text-fg-2">
                  {`${guideAxisLabel(guide.type)} ${t("studio.canvas.guideLabel")} #${index + 1} (${Math.round(guide.pos)}px)`}
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="range"
                    min={0}
                    max={guide.type === "v" ? CANVAS_W : canvasHeight}
                    value={guide.pos}
                    aria-label={`${guideAxisLabel(guide.type)} ${t("studio.canvas.guideLabel")} #${index + 1} ${t("studio.canvas.guidesPosition")}`}
                    onChange={(event) =>
                      onMoveUserGuide(guide.id, Number(event.currentTarget.value))
                    }
                    disabled={controlsDisabled}
                    className="h-2 w-16 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() => onDeleteUserGuide(guide.id)}
                    className="ml-1 grid min-h-9 cursor-pointer place-items-center px-1 text-[9px] text-bad hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {localizeText(t, "삭제", "studio.canvas.guidesDelete")}
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={onClearUserGuides}
              className="min-h-9 w-full cursor-pointer border-t border-line/30 text-center text-[9px] text-bad-light hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {localizeText(t, "모든 가이드 삭제", "studio.canvas.guidesDeleteAll")}
            </button>
          </div>
        )}
      </StudioInspectorSection>

      <StudioInspectorSection
        sectionId="canvas.style"
        activeCount={webtoonTheme === "classic" ? 0 : 1}
        loadingLabel={localizeText(t, "연출 스타일을 여는 중...", "studio.canvas.styleLoading")}
      >
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-card p-0.5">
          {(["classic", "soft", "vivid"] as const).map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => onWebtoonThemeChange(style)}
              disabled={controlsDisabled}
              aria-pressed={webtoonTheme === style}
              className={cn(
                "min-h-9 rounded text-[0.66rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11",
                webtoonTheme === style
                  ? "bg-accent text-on-accent"
                  : "text-fg-2 hover:bg-raised"
              )}
            >
              {style === "classic"
                ? localizeText(t, "출판만화", "studio.canvas.webtoonTheme.classic")
                : style === "soft"
                  ? localizeText(t, "소프트", "studio.canvas.webtoonTheme.soft")
                  : localizeText(t, "비비드", "studio.canvas.webtoonTheme.vivid")}
            </button>
          ))}
        </div>
      </StudioInspectorSection>
    </div>
  );
}
