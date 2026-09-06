import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { resolveStudioBrushBehaviorPresentation } from "./brush/studio-brush-behavior-ui";
import {
  studioCoreBrushCatalogItemById,
  studioBrushCatalogKindLabel,
} from "./brush/studio-brush-catalog-core";
import { loadStudioBrushCatalogItemById } from "./brush/studio-brush-catalog-loader";
import { isStudioBrushPackCatalogId } from "./brush/studio-brush-pack-id";
import { describeStudioBrushRuntimeSemantics } from "./brush/studio-brush-semantic-quality";
import { STUDIO_STABILIZER_MODES } from "./brush/studio-stroke-stabilizer";
import { StudioBrushPresetIcon } from "./brush/StudioBrushPresetIcon";

import type { StudioBrushCatalogItem } from "./brush/studio-brush-catalog-core";
import type { StudioStabilizerMode } from "./brush/studio-stroke-stabilizer";
import type { StudioBrushTrayItem } from "./studio-creative-ux";

import { cn } from "@/shared/lib/utils";

function studioBrushTipLabel(item: StudioBrushTrayItem | null): string {
  switch (item?.previewStyle) {
    case "calligraphy":
      return "납작 촉";
    case "soft":
      return "부드러운 촉";
    case "texture":
      return "질감 촉";
    case "dots":
    case "glitter":
      return "입자 촉";
    case "tone":
      return "톤 촉";
    case "oil":
      return "유화 촉";
    case "neon":
    case "glow":
      return "발광 촉";
    case "dashed":
      return "건식 촉";
    default:
      return "원형 촉";
  }
}

function studioBrushRuntimeId(
  item: StudioBrushTrayItem | null,
  fallbackBrushId: string,
): string {
  const candidate = (item as { runtimeBrushId?: unknown } | null)?.runtimeBrushId;
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate
    : fallbackBrushId;
}

function studioStabilizerSummary(
  mode: StudioStabilizerMode,
  stabilizer: number,
): string {
  const label =
    STUDIO_STABILIZER_MODES.find((candidate) => candidate.id === mode)?.label
    ?? mode;
  return stabilizer <= 0 ? "보정 끔" : `${label} ${Math.round(stabilizer)}`;
}

export interface StudioActiveBrushSummaryProps {
  brushId: string;
  brushName: string;
  brushCatalogItems?: readonly StudioBrushTrayItem[];
  color: string;
  opacity: number;
  stabilizer: number;
  stabilizerMode: StudioStabilizerMode;
  strokeWidth: number;
  tipAngle?: number;
  tipRoundness?: number;
  trailing?: ReactNode;
  className?: string;
  label?: string;
}

/**
 * One compact, shared reading of the currently active brush.
 *
 * It mirrors the familiar paint-app hierarchy: tool identity first, then the
 * handful of properties that materially change the next stroke. Detailed
 * dynamics remain in Brush Studio instead of making every picker scroll.
 */
export function StudioActiveBrushSummary({
  brushId,
  brushName,
  brushCatalogItems,
  color,
  opacity,
  stabilizer,
  stabilizerMode,
  strokeWidth,
  tipAngle = 0,
  tipRoundness = 1,
  trailing,
  className,
  label = "현재 브러시",
}: StudioActiveBrushSummaryProps): ReactElement {
  const [deferredMetadata, setDeferredMetadata] = useState<{
    brushId: string;
    item: StudioBrushCatalogItem | null;
    status: "loaded" | "error";
  } | null>(null);
  const injectedCatalogItem =
    brushCatalogItems?.find((item) => item.id === brushId) ?? null;
  const coreCatalogItem = studioCoreBrushCatalogItemById(brushId);
  const needsProMetadata =
    !injectedCatalogItem
    && !coreCatalogItem
    && isStudioBrushPackCatalogId(brushId);
  const deferredCatalogItem =
    deferredMetadata?.brushId === brushId && deferredMetadata.status === "loaded"
      ? deferredMetadata.item
      : null;
  const catalogItem = injectedCatalogItem ?? coreCatalogItem ?? deferredCatalogItem;
  const metadataFailed =
    needsProMetadata
    && deferredMetadata?.brushId === brushId
    && deferredMetadata.status === "error";
  const mediaLabel = catalogItem
    ? studioBrushCatalogKindLabel(catalogItem)
    : needsProMetadata
      ? "프로 브러시"
      : "사용자";
  const runtimeBrushId = studioBrushRuntimeId(catalogItem, brushId);
  const runtimeSemantics = describeStudioBrushRuntimeSemantics(brushId, runtimeBrushId);
  const tipLabel = runtimeSemantics?.tipLabelKo
    ?? (catalogItem
      ? studioBrushTipLabel(catalogItem)
      : needsProMetadata
        ? metadataFailed
          ? "세부 정보 지연"
          : "정보 불러오는 중"
        : studioBrushTipLabel(null));
  const behavior = resolveStudioBrushBehaviorPresentation(brushId);
  const calligraphy = catalogItem?.previewStyle === "calligraphy";
  const summaryTitle = runtimeSemantics
    ? `${behavior.hintKo} 실제 엔진: ${runtimeSemantics.summaryKo}.`
    : behavior.hintKo;

  useEffect(() => {
    if (!needsProMetadata) return;
    let live = true;
    void loadStudioBrushCatalogItemById(brushId)
      .then((item) => {
        if (live) setDeferredMetadata({ brushId, item, status: "loaded" });
      })
      .catch(() => {
        if (live) setDeferredMetadata({ brushId, item: null, status: "error" });
      });
    return () => {
      live = false;
    };
  }, [brushId, needsProMetadata]);

  return (
    <div
      data-studio-active-brush-summary="true"
      data-studio-brush-behavior={behavior.kind}
      data-studio-brush-metadata-state={
        needsProMetadata ? (metadataFailed ? "error" : catalogItem ? "loaded" : "loading") : "ready"
      }
      data-studio-brush-runtime-id={runtimeSemantics?.runtimeBrushId}
      data-studio-brush-runtime-engine={runtimeSemantics?.engine}
      data-studio-brush-runtime-tip={runtimeSemantics?.tip}
      data-studio-brush-runtime-texture={runtimeSemantics?.texture}
      data-studio-brush-runtime-dynamics={runtimeSemantics?.dynamics}
      data-studio-brush-semantic-source={
        runtimeSemantics ? "runtime-contract" : "preview-fallback"
      }
      aria-busy={needsProMetadata && !metadataFailed && !catalogItem ? true : undefined}
      title={summaryTitle}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-xl border border-line/70 bg-card/75 p-2",
        className,
      )}
    >
      <span
        aria-hidden
        className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-line/70 bg-raised text-fg shadow-inner"
      >
        <StudioBrushPresetIcon brushId={brushId} size={19} strokeWidth={1.85} />
        <span
          className="absolute bottom-1 right-1 size-2.5 rounded-full border border-panel shadow-sm"
          style={{ backgroundColor: color }}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[0.58rem] font-semibold uppercase tracking-wide text-fg-3">
            {label}
          </span>
          <span aria-live="polite" className="truncate text-xs font-bold text-fg">
            {brushName}
          </span>
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[0.6rem] leading-none text-fg-3">
          <span
            className={cn(
              "rounded-md px-1.5 py-1 font-semibold",
              behavior.kind === "wash"
                ? "bg-accent-soft text-accent"
                : "bg-raised text-fg-2",
            )}
            data-studio-brush-behavior-chip={behavior.kind}
          >
            {behavior.labelKo}
          </span>
          <span className="rounded-md bg-raised px-1.5 py-1 font-semibold text-fg-2">
            {mediaLabel} · {tipLabel}
          </span>
          {runtimeSemantics ? (
            <span
              className="rounded-md bg-raised px-1.5 py-1 font-semibold text-fg-2"
              data-studio-brush-runtime-chip="true"
            >
              {runtimeSemantics.textureLabelKo} · {runtimeSemantics.dynamicsLabelKo}
            </span>
          ) : null}
          <span className="rounded-md bg-raised px-1.5 py-1 tabular-nums">
            {Math.round(strokeWidth * 10) / 10}px
          </span>
          <span className="rounded-md bg-raised px-1.5 py-1 tabular-nums">
            농도 {Math.round(opacity * 100)}%
          </span>
          <span className="rounded-md bg-raised px-1.5 py-1">
            {studioStabilizerSummary(stabilizerMode, stabilizer)}
          </span>
          {calligraphy ? (
            <span className="rounded-md bg-raised px-1.5 py-1 tabular-nums">
              촉 {Math.round(tipAngle)}° · 원형도 {Math.round(tipRoundness * 100)}%
            </span>
          ) : null}
        </span>
      </span>

      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  );
}
