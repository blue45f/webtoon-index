/**
 * Authoritative selection geometry panel. Canvas handles stay primary; exact values remain folded
 * until requested, preserving the inspector density budget while keeping DCC-grade transforms one
 * disclosure away.
 */
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { STUDIO_INSPECTOR_CANONICAL_LABELS } from "./studio-inspector-density";
import {
  scrollStudioInspectorTargetIntoView,
  useStudioInspectorFocusRequest,
} from "./studio-inspector-focus-effect";
import {
  readStudioInspectorSectionOpen,
  writeStudioInspectorSectionOpen,
} from "./studio-inspector-section-state";
import {
  STUDIO_SELECTION_GEOMETRY_SECTION_ID,
  studioSelectionGeometrySummary,
} from "./studio-selection-geometry-summary";
import { StudioTransformField } from "./StudioTransformField";
import { StudioTransformGeometryFields } from "./StudioTransformGeometryFields";
import { StudioTransformPrecisionControls } from "./StudioTransformPrecisionControls";

import type {
  StudioFigmaSelectionLayoutMetrics,
  StudioFigmaSelectionLayoutPatch,
  StudioSelectionResizeAnchor,
} from "./studio-selection-transform-advanced";

import { cn } from "@/shared/lib/utils";

export interface StudioFigmaDesignPanelProps {
  readonly metrics: StudioFigmaSelectionLayoutMetrics | null;
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
  readonly onChange: (patch: StudioFigmaSelectionLayoutPatch) => void;
  readonly onFlipHorizontal?: () => void;
  readonly onFlipVertical?: () => void;
  readonly onZoomToSelection?: () => void;
  readonly className?: string;
  readonly defaultGeometryOpen?: boolean;
}

export function StudioFigmaDesignPanel({
  metrics,
  disabled = false,
  disabledReason = null,
  onChange,
  onFlipHorizontal,
  onFlipVertical,
  onZoomToSelection,
  className,
  defaultGeometryOpen = false,
}: StudioFigmaDesignPanelProps) {
  const rootRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const gridId = useId();
  const [open, setOpen] = useState(() =>
    readStudioInspectorSectionOpen(STUDIO_SELECTION_GEOMETRY_SECTION_ID, defaultGeometryOpen),
  );
  const [focusHighlighted, setFocusHighlighted] = useState(false);
  const [resizeAnchor, setResizeAnchor] = useState<StudioSelectionResizeAnchor>("top-left");
  const [scaleStrokeWidth, setScaleStrokeWidth] = useState(false);

  useStudioInspectorFocusRequest("selection.geometry", () => {
    setOpen(true);
    setFocusHighlighted(true);
    scrollStudioInspectorTargetIntoView(rootRef.current);
    globalThis.requestAnimationFrame?.(() => headerRef.current?.focus({ preventScroll: true }));
  });
  useEffect(() => {
    if (!focusHighlighted) return;
    const timeout = globalThis.setTimeout(() => setFocusHighlighted(false), 1_600);
    return () => globalThis.clearTimeout(timeout);
  }, [focusHighlighted]);
  const selectionKey = metrics?.selectionKey ?? null;
  useEffect(() => {
    // Proportional line weight changes authored ink, so it never survives a selection change.
    setScaleStrokeWidth(false);
  }, [selectionKey]);

  if (!metrics) return null;
  const multi = metrics.elementCount > 1;
  const precisionControls = metrics.precisionControls === true;
  const interactionDisabledReason = disabled
    ? disabledReason ?? "현재 편집 상태에서는 선택 대상을 변경할 수 없어요."
    : null;
  const widthDisabled = disabled || (!precisionControls && multi) || !metrics.supportsWidth;
  const heightDisabled = disabled || (!precisionControls && multi) || !metrics.supportsHeight;
  const rotationDisabled = disabled || (!precisionControls && multi) || !metrics.supportsRotation;
  const aspectLocked = metrics.aspectLocked ?? false;
  const supportsAspectLock = metrics.supportsAspectLock === true;
  const showAspectLockControl = multi || metrics.showAspectLockControl === true;
  const showStrokeWidthControl = multi && metrics.hasStrokeWidthSensitiveMember === true;
  const strokeWidthPolicy = scaleStrokeWidth ? "scale" : "preserve";

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    writeStudioInspectorSectionOpen(STUDIO_SELECTION_GEOMETRY_SECTION_ID, next);
  };

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      data-studio-figma-design-panel="true"
      data-studio-selection-scope={multi ? "multiple" : "single"}
      data-inspector-section="selection.geometry"
      data-inspector-section-open={open ? "true" : "false"}
      data-inspector-section-highlighted={focusHighlighted ? "true" : undefined}
      aria-label="위치와 크기"
      className={cn(
        "rounded-xl border border-line/80 bg-panel/50 p-2.5 shadow-[inset_0_1px_0_oklch(0.98_0.01_85/0.04)] transition-[background-color,box-shadow] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        focusHighlighted && "bg-accent-soft/55 shadow-[0_0_0_2px_oklch(0.72_0.185_42/0.55)]",
        className,
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)] items-end gap-2">
        <div className="min-w-0">
          <p className="text-xs font-extrabold tracking-tight text-fg">
            {multi ? `${metrics.elementCount}개 선택 · 공통 속성` : "선택 대상"}
          </p>
          <p className="truncate text-[0.6875rem] font-medium text-fg-3">
            {multi
              ? precisionControls
                ? "위치·크기·회전·불투명도를 묶음 전체에 적용합니다"
                : "위치와 불투명도는 묶음 전체에 함께 적용됩니다"
              : "위치·크기는 캔버스 핸들 또는 아래 변형에서"}
          </p>
        </div>
        <StudioTransformField
          key={`opacity:${metrics.selectionKey}`}
          label={STUDIO_INSPECTOR_CANONICAL_LABELS.opacity}
          controlId="selection.opacity"
          priority="essential"
          value={Math.round(metrics.opacity * 100)}
          disabled={disabled || !metrics.supportsOpacity}
          disabledReason={
            interactionDisabledReason
            ?? (metrics.supportsOpacity ? null : "프레임이 포함된 선택은 불투명도를 함께 바꿀 수 없어요.")
          }
          mixed={metrics.opacityMixed}
          step={1}
          coarseStep={10}
          fineStep={0.1}
          min={0}
          max={100}
          suffix="%"
          percentMode="absolute"
          onCommit={(percent) => onChange({ opacity: percent / 100 })}
        />
      </div>

      <button
        ref={headerRef}
        type="button"
        aria-expanded={open}
        aria-controls={gridId}
        onClick={toggleOpen}
        data-inspector-priority="chrome"
        data-studio-selection-geometry-toggle="true"
        className={cn(
          "mt-2 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-line/70 bg-card/60 px-2 py-1 text-left transition-colors hover:border-line-strong hover:bg-raised lg:min-h-9 pointer-coarse:min-h-11",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs font-bold text-fg">변형</span>
          <span
            className="truncate text-[0.6875rem] font-medium tabular-nums text-fg-3"
            data-studio-selection-geometry-summary="true"
          >
            {studioSelectionGeometrySummary(metrics)}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={open ? "shrink-0 rotate-180 transition-transform" : "shrink-0 transition-transform"}
        />
      </button>

      <div id={gridId} hidden={!open}>
        {open ? (
          <div className="mt-2">
            {precisionControls ? (
              <StudioTransformPrecisionControls
                disabled={disabled}
                interactionDisabledReason={interactionDisabledReason}
                supportsWidth={metrics.supportsWidth}
                supportsHeight={metrics.supportsHeight}
                sizeDisabledReason={metrics.sizeDisabledReason}
                resizeAnchor={resizeAnchor}
                onResizeAnchorChange={setResizeAnchor}
                showAspectLockControl={showAspectLockControl}
                aspectLocked={aspectLocked}
                multi={multi}
                supportsAspectLock={supportsAspectLock}
                onToggleAspectLock={() => onChange({ lockAspect: !aspectLocked })}
                showStrokeWidthControl={showStrokeWidthControl}
                scaleStrokeWidth={scaleStrokeWidth}
                onToggleStrokeWidth={() => setScaleStrokeWidth((current) => !current)}
              />
            ) : null}
            <StudioTransformGeometryFields
              metrics={metrics}
              disabled={disabled}
              interactionDisabledReason={interactionDisabledReason}
              precisionControls={precisionControls}
              multi={multi}
              widthDisabled={widthDisabled}
              heightDisabled={heightDisabled}
              rotationDisabled={rotationDisabled}
              resizeAnchor={resizeAnchor}
              strokeWidthPolicy={strokeWidthPolicy}
              onChange={onChange}
              onZoomToSelection={onZoomToSelection}
              onFlipHorizontal={onFlipHorizontal}
              onFlipVertical={onFlipVertical}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
