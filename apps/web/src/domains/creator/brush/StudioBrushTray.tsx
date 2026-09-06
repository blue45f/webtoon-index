/**
 * StudioBrushTray — compact recent/favorite shelf with a full-library exit.
 * Pure presentation; the complete searchable catalog lives in StudioBrushLibrarySheet.
 */
import { History, LayoutGrid, Star } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";

import { planNeonBrushPasses } from "../studio-fx-brush";
import { STUDIO_FOCUS_RING, STUDIO_EASE } from "../studio-panel-ui";

import {
  listStudioCoreQuickBrushCatalogItems,
  STUDIO_BRUSH_LISTED_CATALOG_COUNTS,
  studioBrushCatalogKindLabel,
} from "./studio-brush-catalog-core";
import { loadStudioListedBrushCatalogItems } from "./studio-brush-catalog-loader";
import {
  resolveStudioBrushEngineLaneLabelKo,
  studioBrushEngineLaneRowById,
} from "./studio-brush-engine-lane-catalog";
import { isStudioBrushPackCatalogId } from "./studio-brush-pack-id";
import {
  studioBrushChipSurface,
  studioBrushPreviewDashArray,
  studioBrushPreviewDotCenters,
  studioBrushPreviewOpacity,
  studioBrushPreviewPathD,
  studioBrushPreviewRibbonD,
  studioBrushPreviewStrokeWidth,
} from "./studio-brush-visual";
import { StudioBrushPresetIcon } from "./StudioBrushPresetIcon";

import type {
  StudioBrushTrayItem,
  StudioQuickBrushSource,
} from "../studio-creative-ux";

import { cn } from "@/shared/lib/utils";

export interface StudioBrushTrayProps {
  activeBrushId: string;
  onSelect: (item: StudioBrushTrayItem) => void;
  /** Combined core + procedural catalogue; omitted callers use the canonical built-in catalogue. */
  brushCatalogItems?: readonly StudioBrushTrayItem[];
  recentBrushIds?: readonly string[];
  favoriteBrushIds?: readonly string[];
  onOpenLibrary: (trigger: HTMLButtonElement) => void;
  libraryOpen?: boolean;
  className?: string;
  "aria-label"?: string;
}

const QUICK_SOURCE_LABEL: Record<StudioQuickBrushSource, string> = {
  favorite: "즐겨찾기",
  recent: "최근 사용",
  starter: "추천",
};

const PREVIEW_W = 40;
const PREVIEW_H = 18;

function BrushPreviewGlyph({
  item,
  active,
}: {
  item: StudioBrushTrayItem;
  active: boolean;
}): ReactElement {
  const surface = studioBrushChipSurface(item.mediaGroup);
  const strokeW = studioBrushPreviewStrokeWidth(item.previewWeight, item.previewStyle);
  const pathD = studioBrushPreviewPathD(item.previewStyle, PREVIEW_W, PREVIEW_H);
  const dash = studioBrushPreviewDashArray(item.previewStyle);
  const dots = studioBrushPreviewDotCenters(item.previewStyle, PREVIEW_W, PREVIEW_H);
  const previewOpacity = studioBrushPreviewOpacity(item.defaultOpacity);
  // 필압 테이퍼 리본: 균일 선 아이콘 대신 실제 획감(얇게 시작→부풀고→빠짐)을 보여준다.
  const ribbonD = studioBrushPreviewRibbonD(
    item.previewStyle,
    PREVIEW_W,
    PREVIEW_H,
    item.previewWeight
  );
  const ink = active ? "currentColor" : surface.ink;
  const neonPasses = item.previewStyle === "neon" ? planNeonBrushPasses(strokeW) : null;

  return (
    <svg
      aria-hidden
      width={PREVIEW_W}
      height={PREVIEW_H}
      viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
      className={cn("block drop-shadow-sm", active ? "text-on-accent" : "")}
      data-studio-brush-preview={item.previewStyle}
    >
      {/* Paper / canvas tooth under stroke */}
      <rect
        x={0.5}
        y={0.5}
        width={PREVIEW_W - 1}
        height={PREVIEW_H - 1}
        rx={3.5}
        fill={active ? "oklch(0.98 0.01 85 / 0.14)" : surface.paper}
        stroke={active ? "oklch(0.98 0.01 85 / 0.2)" : "oklch(0.4 0.012 64 / 0.35)"}
        strokeWidth={0.6}
      />
      {/* Subtle grain for texture media */}
      {(item.previewStyle === "texture"
        || item.previewStyle === "tone"
        || item.previewStyle === "dots"
        || item.previewStyle === "glitter") &&
        !active && (
          <g opacity={0.35} fill={surface.ink}>
            <circle cx={6} cy={4} r={0.4} />
            <circle cx={14} cy={12} r={0.35} />
            <circle cx={22} cy={5} r={0.4} />
            <circle cx={30} cy={11} r={0.35} />
          </g>
        )}
      {dots.length > 0 ? (
        <g fill={ink} opacity={previewOpacity}>
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} />
          ))}
        </g>
      ) : (
        neonPasses ? (
          <g data-studio-brush-preview-layer="neon">
            {neonPasses.map((pass, index) => (
              <path
                key={index}
                d={pathD}
                fill="none"
                stroke={pass.tone === "white-core" ? "oklch(0.97 0.015 85)" : ink}
                strokeWidth={Math.max(1, strokeW * pass.widthScale)}
                strokeLinecap="round"
                opacity={pass.opacity * previewOpacity}
              />
            ))}
          </g>
        ) : (
          <>
          {item.previewStyle === "soft" && (
            <path
              d={pathD}
              fill="none"
              stroke={ink}
              strokeWidth={strokeW * 1.85}
              strokeLinecap="round"
              opacity={0.25 * previewOpacity}
            />
          )}
          {item.previewStyle === "calligraphy" && (
            <path
              d={pathD}
              fill="none"
              stroke={ink}
              strokeWidth={strokeW * 0.55}
              strokeLinecap="round"
              opacity={0.32 * previewOpacity}
              transform="translate(0 1.2)"
            />
          )}
          {ribbonD ? (
            <path d={ribbonD} fill={ink} opacity={previewOpacity} />
          ) : (
            <path
              d={pathD}
              fill="none"
              stroke={ink}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={dash}
              opacity={previewOpacity}
            />
          )}
          </>
        )
      )}
    </svg>
  );
}

export function StudioBrushTray({
  activeBrushId,
  onSelect,
  brushCatalogItems,
  recentBrushIds = [],
  favoriteBrushIds = [],
  onOpenLibrary,
  libraryOpen = false,
  className,
  "aria-label": ariaLabel = "빠른 보조 도구 — 즐겨찾기, 최근 사용, 추천",
}: StudioBrushTrayProps): ReactElement {
  const [focusedBrushId, setFocusedBrushId] = useState<string | null>(null);
  const [deferredCatalogItems, setDeferredCatalogItems] =
    useState<readonly StudioBrushTrayItem[] | null>(null);
  const [failedProMetadataKey, setFailedProMetadataKey] = useState<string | null>(null);
  const proMetadataRequestKey = brushCatalogItems
    ? ""
    : [activeBrushId, ...favoriteBrushIds, ...recentBrushIds]
        .filter(isStudioBrushPackCatalogId)
        .join("\u0000");
  const needsProMetadata = proMetadataRequestKey.length > 0;

  useEffect(() => {
    if (!needsProMetadata) return;
    let live = true;
    // The tray is a LISTING lane: the listed (quarantine-filtered) inventory keeps a quarantined
    // favorite/MRU id from re-surfacing as a chip. Current-brush metadata resolution stays on the
    // unfiltered lane (`loadStudioBrushCatalogItemById` in StudioActiveBrushSummary).
    void loadStudioListedBrushCatalogItems()
      .then((items) => {
        if (live) setDeferredCatalogItems(items);
      })
      .catch(() => {
        if (live) setFailedProMetadataKey(proMetadataRequestKey);
      });
    return () => {
      live = false;
    };
  }, [needsProMetadata, proMetadataRequestKey]);

  const resolvedCatalogItems =
    brushCatalogItems ?? (needsProMetadata ? deferredCatalogItems ?? undefined : undefined);
  const proMetadataFailed =
    deferredCatalogItems === null && failedProMetadataKey === proMetadataRequestKey;
  const proMetadataLoading =
    needsProMetadata && deferredCatalogItems === null && !proMetadataFailed;
  const visible = listStudioCoreQuickBrushCatalogItems({
    catalogItems: resolvedCatalogItems,
    favoriteIds: favoriteBrushIds,
    recentIds: recentBrushIds,
  });
  const rovingBrushId = visible.some((item) => item.id === focusedBrushId)
    ? focusedBrushId
    : visible.some((item) => item.id === activeBrushId)
      ? activeBrushId
      : visible[0]?.id ?? null;

  function onBrushKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void {
    const lastIndex = visible.length - 1;
    let nextIndex: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    } else {
      return;
    }

    const nextBrush = visible[nextIndex];
    if (!nextBrush) return;
    event.preventDefault();
    setFocusedBrushId(nextBrush.id);
    const nextButton = event.currentTarget
      .closest('[role="listbox"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="option"]')[nextIndex];
    nextButton?.focus({ preventScroll: true });
    nextButton?.scrollIntoView?.({ block: "nearest" });
  }

  return (
    <div
      data-studio-brush-tray="true"
      data-studio-brush-surface-role="quick-subtools"
      data-studio-pro-catalog-state={
        needsProMetadata
          ? proMetadataFailed
            ? "error"
            : deferredCatalogItems
              ? "loaded"
              : "loading"
          : "core"
      }
      aria-busy={proMetadataLoading ? true : undefined}
      className={cn("flex min-w-0 max-w-full items-center gap-1", className)}
    >
      {proMetadataFailed ? (
        <span role="status" className="sr-only">
          프로 브러시 정보를 불러오지 못해 코어 브러시를 표시합니다. 라이브러리를 열어 다시
          시도할 수 있습니다.
        </span>
      ) : null}
      <div
        role="listbox"
        aria-label={ariaLabel}
        className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto py-0.5 [scrollbar-width:thin]"
      >
        {visible.map((item, itemIndex) => {
          const active = activeBrushId === item.id;
          const surface = studioBrushChipSurface(item.mediaGroup);
          const sourceLabel = QUICK_SOURCE_LABEL[item.quickSource];
          const kindLabel = studioBrushCatalogKindLabel(item);
          const engineLaneLabel = resolveStudioBrushEngineLaneLabelKo(item.id);
          const engineLane = studioBrushEngineLaneRowById(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              tabIndex={item.id === rovingBrushId ? 0 : -1}
              aria-label={`${sourceLabel} 브러시 ${item.name} · ${engineLaneLabel ? `${engineLaneLabel} · ` : ""}${kindLabel} — ${item.hint}`}
              title={`${sourceLabel} · ${engineLaneLabel ? `${engineLaneLabel} · ` : ""}${kindLabel} · ${item.name} — ${item.hint}`}
              onClick={() => onSelect(item)}
              onFocus={() => setFocusedBrushId(item.id)}
              onKeyDown={(event) => onBrushKeyDown(event, itemIndex)}
              data-studio-brush-chip={item.id}
              data-studio-brush-media={item.mediaGroup}
              data-studio-brush-kind={kindLabel}
              data-studio-brush-engine-lane={engineLane?.lane}
              data-studio-quick-source={item.quickSource}
              className={cn(
                // Icon + stroke preview tile (Ibis/Picsart/CSP)
                "relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent/60 bg-accent text-on-accent shadow-[0_2px_10px_oklch(0.72_0.185_42/0.28)]"
                  : "border-line/50 text-fg-2 hover:border-line/90 hover:bg-raised hover:text-fg hover:shadow-sm"
              )}
              style={
                active
                  ? undefined
                  : {
                      background: `linear-gradient(165deg, ${surface.tile} 0%, oklch(0.16 0.008 70 / 0.65) 100%)`,
                    }
              }
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 grid size-4 place-items-center rounded-md",
                  active ? "bg-on-accent/15 text-on-accent" : "bg-canvas/55 text-fg-2"
                )}
                data-studio-brush-chip-icon={item.id}
              >
                <StudioBrushPresetIcon brushId={item.id} size={10} strokeWidth={2} />
              </span>
              <BrushPreviewGlyph item={item} active={active} />
              {engineLaneLabel ? (
                <span
                  aria-hidden
                  data-studio-brush-engine-chip={engineLane?.lane}
                  title={`엔진: ${engineLaneLabel}`}
                  className={cn(
                    "absolute bottom-0.5 left-0.5 max-w-[2.4rem] truncate rounded px-0.5 text-[0.42rem] font-black leading-tight",
                    active
                      ? "bg-on-accent/20 text-on-accent"
                      : "bg-accent/20 text-accent"
                  )}
                >
                  {engineLaneLabel.replace(" ", "")}
                </span>
              ) : null}
              {item.quickSource !== "starter" ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute right-0.5 top-0.5 grid size-3.5 place-items-center rounded-full",
                    active ? "bg-on-accent/15 text-on-accent" : "bg-canvas/70 text-fg-2"
                  )}
                >
                  {item.quickSource === "favorite" ? (
                    <Star size={8} fill="currentColor" strokeWidth={1.5} />
                  ) : (
                    <History size={8} strokeWidth={2} />
                  )}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={(event) => onOpenLibrary(event.currentTarget)}
        aria-expanded={libraryOpen}
        aria-haspopup="dialog"
        aria-label="브러시 전체 라이브러리와 관리 열기"
        title={`전체 ${STUDIO_BRUSH_LISTED_CATALOG_COUNTS.paint}종 검색·분류·즐겨찾기·기본값 다시 적용`}
        data-studio-open-brush-library="true"
        className={cn(
          "flex h-11 shrink-0 items-center gap-1 rounded-xl border border-line/70 bg-card/80 px-2 text-[0.62rem] font-bold text-fg-2 hover:border-accent/40 hover:bg-raised hover:text-fg",
          STUDIO_EASE,
          STUDIO_FOCUS_RING
        )}
      >
        <LayoutGrid size={13} strokeWidth={1.75} aria-hidden />
        <span className="whitespace-nowrap">라이브러리</span>
      </button>
    </div>
  );
}
