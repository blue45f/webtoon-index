/**
 * StudioBrushLibrarySheet — searchable built-in brush catalog popover.
 * Search · category · favorites · recent · render-faithful preview tiles.
 */
import {
  Grid2X2,
  LoaderCircle,
  RotateCcw,
  Rows3,
  Search,
  Star,
  Waves,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import { DEFAULT_STUDIO_BRUSH_CATALOG_FLOATING_LAYOUT } from "../studio-detachable-panels";
import { planGlowBrushPasses, planNeonBrushPasses } from "../studio-fx-brush";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "../studio-panel-ui";
import {
  StudioEraserQuickPicker,
  type StudioEraserQuickPickerId,
} from "../StudioEraserQuickPicker";
import { StudioFloatingSurface } from "../StudioFloatingSurface";
import { useStudioFloatingSurfaceLayout } from "../use-studio-floating-surface-layout";

import {
  filterStudioBrushCatalogItems,
  STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
  studioBrushCatalogItemById,
  studioBrushCatalogKindLabel,
} from "./studio-brush-catalog";
import {
  resolveStudioBrushEngineLaneLabelKo,
  studioBrushEngineLaneRowById,
} from "./studio-brush-engine-lane-catalog";
import { isStudioBrushMaterialGroup } from "./studio-brush-material-group";
import { isStudioBrushPackCatalogId } from "./studio-brush-pack-id";
import {
  materializeStudioBrushCatalogSelection,
  preloadStudioBrushCatalogSelection,
} from "./studio-brush-selection";
import {
  studioBrushChipSurface,
  studioBrushPreviewDashArray,
  studioBrushPreviewDotCenters,
  studioBrushPreviewOpacity,
  studioBrushPreviewPathD,
  studioBrushPreviewRibbonD,
  studioBrushPreviewStrokeWidth,
} from "./studio-brush-visual";
import { STUDIO_BRUSH_LIBRARY_TABS } from "./studio-draw-ux";
import { StudioBrushPresetIcon } from "./StudioBrushPresetIcon";


import type { StudioToolOperation } from "../studio-brush";
import type { StudioBrushCatalogItem } from "./studio-brush-catalog";
import type { StudioBrushCatalogSelection } from "./studio-brush-selection";
import type { StudioBrushTrayItem } from "../studio-creative-ux";

import { cn } from "@/shared/lib/utils";

export interface StudioBrushLibrarySheetProps {
  open: boolean;
  activeBrushId: string;
  /** The active authoring family. Legacy callers default to the paint catalogue. */
  operation?: StudioToolOperation;
  /**
   * Forces the short-surface layout when the visual viewport is occluded by a software keyboard.
   * A height media query covers genuinely short viewports without requiring a resize render.
   */
  compact?: boolean;
  embedded?: boolean;
  closeOnSelection?: boolean;
  dismissOnOutsidePointer?: boolean;
  triggerElement?: HTMLElement | null;
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
  /** Where the artist left this catalogue last time; omitted means "start at the default tab". */
  restoredView?: StudioBrushCatalogRestoredView | null;
  /** Called once per visit, when the catalogue closes, with the place to return to. */
  onViewStateChange?: (view: StudioBrushCatalogRestoredView) => void;
  onClose: (reason: StudioBrushCatalogCloseReason) => void;
  onSelect: (selection: StudioBrushCatalogSelection) => void;
  onToggleFavorite?: (brushId: string) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The catalogue's restorable place. `tab` is an opaque id: a value that no longer exists in the
 * current tab manifest is not an error, it simply falls back to the operation default, which is
 * what keeps reorganising the categories from invalidating everyone's saved preference.
 */
export interface StudioBrushCatalogRestoredView {
  tab: string;
  query: string;
  viewMode: StudioBrushCatalogViewMode;
}

export type StudioBrushCatalogPlacement = "desktop-dock" | "mobile-sheet";
export type StudioBrushCatalogCloseReason =
  | "explicit"
  | "escape"
  | "selection"
  | "outside-pointer";

export interface StudioBrushCatalogPortalProps {
  open: boolean;
  placement: StudioBrushCatalogPlacement;
  triggerElement: HTMLElement | null;
  activeBrushId: string;
  /** Defaults to paint for compatibility with embedded legacy callers. */
  operation?: StudioToolOperation;
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
  restoredView?: StudioBrushCatalogRestoredView | null;
  onViewStateChange?: (view: StudioBrushCatalogRestoredView) => void;
  mobileKeyboardInset?: number;
  onClose: (reason: StudioBrushCatalogCloseReason) => void;
  onSelect: (selection: StudioBrushCatalogSelection) => void;
  onToggleFavorite: (brushId: string) => void;
}

export type StudioBrushCatalogPreviewKind =
  | "ribbon"
  | "eraser"
  | "calligraphy"
  | "marker"
  | "wash-marker"
  | "pencil"
  | "texture"
  | "soft-air"
  | "soft-wash"
  | "soft-pigment"
  | "oil"
  | "neon"
  | "glow"
  | "particle"
  | "tone";

export type StudioBrushCatalogViewMode = "stroke" | "tile" | "text";

type StudioBrushGridNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

const STUDIO_BRUSH_GRID_FALLBACK_COLUMNS = {
  stroke: 2,
  tile: 3,
  text: 1,
} as const satisfies Record<StudioBrushCatalogViewMode, number>;
const STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT = 48;
const STUDIO_BRUSH_PROGRESSIVE_BATCH_COUNT = 48;
const STUDIO_BRUSH_PROGRESSIVE_ROOT_MARGIN = "240px 0px";
const STUDIO_ERASER_LIBRARY_TABS = STUDIO_BRUSH_LIBRARY_TABS.filter(
  (tab) => tab.id === "favorites" || tab.id === "recent" || tab.id === "all",
);

function countCssGridTracks(template: string): number | null {
  const normalizedTemplate = template.trim();
  if (!normalizedTemplate || normalizedTemplate === "none") return null;

  const tracks: string[] = [];
  let depth = 0;
  let trackStart = 0;
  for (let index = 0; index <= normalizedTemplate.length; index += 1) {
    const character = normalizedTemplate[index];
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    if (
      index === normalizedTemplate.length
      || (depth === 0 && character !== undefined && /\s/u.test(character))
    ) {
      const track = normalizedTemplate.slice(trackStart, index).trim();
      if (track) tracks.push(track);
      trackStart = index + 1;
    }
  }

  let count = 0;
  for (const track of tracks) {
    const repeatMatch = /^repeat\(\s*(\d+)\s*,([\s\S]+)\)$/u.exec(track);
    if (!repeatMatch) {
      count += 1;
      continue;
    }
    const repetitions = Number.parseInt(repeatMatch[1] ?? "", 10);
    const repeatedTrackCount = countCssGridTracks(repeatMatch[2] ?? "");
    count += repetitions * (repeatedTrackCount ?? 1);
  }
  return count > 0 ? count : null;
}

/**
 * Reads the resolved CSS grid on every keyboard event so responsive column
 * changes do not leave navigation using a stale viewport-derived value.
 */
function studioBrushGridColumnCount(
  grid: HTMLElement | null,
  viewMode: StudioBrushCatalogViewMode,
): number {
  if (grid && typeof globalThis.getComputedStyle === "function") {
    try {
      const computedColumns = countCssGridTracks(
        globalThis.getComputedStyle(grid).gridTemplateColumns
      );
      if (computedColumns) return computedColumns;
    } catch {
      // Detached test nodes and older webviews can reject computed-style reads.
    }
  }
  return STUDIO_BRUSH_GRID_FALLBACK_COLUMNS[viewMode];
}

/**
 * Brush-grid navigation uses linear left/right movement and row-sized
 * up/down movement. Every edge clamps instead of wrapping, including a
 * partially filled final row, so a repeated arrow key never jumps away.
 */
function nextStudioBrushGridIndex({
  currentIndex,
  itemCount,
  columns,
  key,
}: {
  currentIndex: number;
  itemCount: number;
  columns: number;
  key: StudioBrushGridNavigationKey;
}): number | null {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) return null;
  const lastIndex = itemCount - 1;
  const safeColumns = Math.max(1, Math.floor(columns));
  if (key === "ArrowRight") return Math.min(lastIndex, currentIndex + 1);
  if (key === "ArrowLeft") return Math.max(0, currentIndex - 1);
  if (key === "ArrowDown") {
    const nextIndex = currentIndex + safeColumns;
    return nextIndex <= lastIndex ? nextIndex : currentIndex;
  }
  if (key === "ArrowUp") {
    const nextIndex = currentIndex - safeColumns;
    return nextIndex >= 0 ? nextIndex : currentIndex;
  }
  if (key === "Home") return 0;
  if (key === "End") return lastIndex;
  return null;
}

const STUDIO_BRUSH_CATALOG_VIEW_OPTIONS = [
  {
    id: "stroke",
    label: "획",
    title: "획 미리보기",
    Icon: Waves,
  },
  {
    id: "tile",
    label: "타일",
    title: "작은 타일",
    Icon: Grid2X2,
  },
  {
    id: "text",
    label: "목록",
    title: "이름 목록",
    Icon: Rows3,
  },
] as const satisfies readonly {
  id: StudioBrushCatalogViewMode;
  label: string;
  title: string;
  Icon: typeof Waves;
}[];

function studioBrushPreviewHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function StudioProceduralBrushPreviewDetail({
  item,
  ink,
  opacity,
}: {
  item: StudioBrushTrayItem;
  ink: string;
  opacity: number;
}): ReactElement | null {
  if (!isStudioBrushPackCatalogId(item.id)) return null;
  const hash = studioBrushPreviewHash(item.id);
  const phase = (hash % 17) / 17;
  const ids = item.id;

  if (ids.includes("heart")) {
    return (
      <g fill={ink} opacity={opacity * 0.72} transform={`translate(${phase * 3} 0)`}>
        <path d="M72 13 C72 8 80 7 81 13 C83 7 91 8 91 13 C91 19 81 24 81 24 C81 24 72 19 72 13Z" />
        <path d="M58 19 C58 16 63 15 64 19 C65 15 70 16 70 19 C70 23 64 26 64 26 C64 26 58 23 58 19Z" opacity="0.62" />
      </g>
    );
  }
  if (ids.includes("footstep")) {
    return (
      <g fill={ink} opacity={opacity * 0.72} transform={`rotate(${phase * 8 - 4} 75 17)`}>
        <ellipse cx="64" cy="20" rx="3.2" ry="6.2" />
        <circle cx="61" cy="12" r="1.5" /><circle cx="64" cy="10.5" r="1.35" /><circle cx="67" cy="11.5" r="1.2" />
        <ellipse cx="79" cy="14" rx="3.2" ry="6.2" />
        <circle cx="76" cy="6" r="1.5" /><circle cx="79" cy="4.5" r="1.35" /><circle cx="82" cy="5.5" r="1.2" />
      </g>
    );
  }
  if (ids.includes("checker")) {
    return (
      <g fill={ink} opacity={opacity * 0.58} transform={`translate(${phase * 2} 0)`}>
        {Array.from({ length: 12 }, (_, index) => {
          const column = index % 6;
          const row = Math.floor(index / 6);
          if ((column + row) % 2 !== 0) return null;
          return <rect key={index} x={55 + column * 6} y={10 + row * 6} width="6" height="6" />;
        })}
      </g>
    );
  }
  if (ids.includes("leaf") || ids.includes("foliage") || ids.includes("grass") || ids.includes("vine") || ids.includes("willow")) {
    return (
      <g fill={ink} stroke={ink} strokeWidth="0.7" opacity={opacity * 0.62}>
        {Array.from({ length: 6 }, (_, index) => {
          const x = 53 + index * 7 + ((hash >>> (index % 8)) & 3);
          const y = 10 + ((hash >>> ((index + 3) % 12)) & 11);
          const rotation = -38 + ((hash >>> ((index + 5) % 16)) & 63);
          return (
            <g key={index} transform={`translate(${x} ${y}) rotate(${rotation})`}>
              <path d="M0 0 C2.2 -3.4 6.5 -3.1 8 0 C5.9 2.7 2.1 2.9 0 0Z" />
              <path d="M0 0 H7" fill="none" stroke={ink} opacity="0.48" />
            </g>
          );
        })}
      </g>
    );
  }
  if (ids.includes("rake") || ids.includes("hair") || ids.includes("stripe") || ids.includes("roller")) {
    const count = 3 + (hash % 4);
    return (
      <g fill="none" stroke={ink} strokeLinecap="round" opacity={opacity * 0.62}>
        {Array.from({ length: count }, (_, index) => (
          <path
            key={index}
            d={`M50 ${9 + index * (15 / Math.max(1, count - 1))} C62 ${7 + index * 3 + phase * 2}, 74 ${23 - index * 2}, 92 ${10 + index * 2.4}`}
            strokeWidth={0.65 + ((hash >>> index) & 3) * 0.28}
            strokeDasharray={ids.includes("rough") || ids.includes("dry") ? `${2 + index} ${1.5 + phase}` : undefined}
          />
        ))}
      </g>
    );
  }
  if (ids.includes("square") || ids.includes("blade") || ids.includes("flat") || ids.includes("block") || ids.includes("marker")) {
    return (
      <g fill={ink} opacity={opacity * 0.5} transform={`rotate(${phase * 18 - 9} 74 17)`}>
        <rect x="53" y={9 + phase * 3} width={13 + (hash % 9)} height={4 + ((hash >>> 4) % 6)} rx={ids.includes("square") ? 0 : 1.5} />
        <rect x={72 + phase * 4} y={16 - phase * 3} width={17 - (hash % 5)} height={3 + ((hash >>> 7) % 5)} rx="1" opacity="0.58" />
      </g>
    );
  }
  if (ids.includes("oval")) {
    return (
      <g fill={ink} opacity={opacity * 0.56} transform={`rotate(${phase * 36 - 18} 74 17)`}>
        <ellipse cx="60" cy="17" rx={4 + (hash % 4)} ry={2 + ((hash >>> 3) % 3)} />
        <ellipse cx="75" cy="15" rx={6 + ((hash >>> 5) % 4)} ry={2.5 + ((hash >>> 8) % 3)} opacity="0.72" />
        <ellipse cx="89" cy="19" rx={3 + ((hash >>> 10) % 3)} ry={2 + ((hash >>> 12) % 2)} opacity="0.48" />
      </g>
    );
  }

  return (
    <g fill={ink} opacity={opacity * 0.44}>
      {Array.from({ length: 8 }, (_, index) => {
        const x = 51 + index * 5.4 + ((hash >>> (index % 16)) & 3);
        const y = 9 + ((hash >>> ((index + 5) % 19)) & 15);
        const radius = 0.7 + ((hash >>> ((index + 9) % 21)) & 3) * 0.45;
        return <circle key={index} cx={x} cy={y} r={radius} />;
      })}
    </g>
  );
}

/**
 * Keep preview semantics aligned with the actual renderer rather than relying only on a decorative
 * style name. Marker aliases and the one-wash highlighters, for example, share a previewStyle in
 * older saved UI data but use different cap and opacity semantics in the canvas renderer.
 */
function studioBrushCatalogPreviewKind(
  item: StudioBrushTrayItem
): StudioBrushCatalogPreviewKind {
  if (item.operation === "erase") return "eraser";
  if (
    item.id === "highlighter"
    || item.id === "chisel-highlighter"
    || item.id === "pastel-highlighter"
  ) return "wash-marker";
  if (item.id === "marker" || item.id === "marker-bold" || item.id === "felt-tip") {
    return "marker";
  }
  if (item.previewStyle === "calligraphy") return "calligraphy";
  if (item.previewStyle === "neon") return "neon";
  if (item.previewStyle === "glow") return "glow";
  if (item.previewStyle === "glitter" || item.previewStyle === "dots") return "particle";
  if (item.previewStyle === "tone") return "tone";
  if (item.previewStyle === "oil") return "oil";
  if (item.previewStyle === "dashed") return "pencil";
  if (item.previewStyle === "texture") return "texture";
  if (item.previewStyle === "soft") {
    if (
      item.id === "airbrush"
      || item.id === "airbrush-fine"
      || item.id === "soft-brush"
      || item.id === "spray"
    ) {
      return "soft-air";
    }
    if (item.id === "watercolor" || item.id === "ink-wash" || item.id === "wash-brush") {
      return "soft-wash";
    }
    return "soft-pigment";
  }
  return "ribbon";
}

export function LargeBrushPreview({
  item,
  active,
  compact = false,
  density = "stroke",
}: {
  item: StudioBrushTrayItem;
  active: boolean;
  compact?: boolean;
  density?: Exclude<StudioBrushCatalogViewMode, "text">;
}): ReactElement {
  const w = 96;
  const h = 34;
  const surface = studioBrushChipSurface(item.mediaGroup);
  const strokeW = studioBrushPreviewStrokeWidth(item.previewWeight, item.previewStyle);
  const pathD = studioBrushPreviewPathD(item.previewStyle, w, h);
  const ribbonD = studioBrushPreviewRibbonD(item.previewStyle, w, h, item.previewWeight);
  const dashArray = studioBrushPreviewDashArray(item.previewStyle);
  // Dot helpers use their canonical 36×16 coordinate system. Convert once into the padded large
  // preview viewport; the previous implementation passed 72×28 and then scaled those coordinates
  // again, which clipped screentone rows and pushed particles outside the tile.
  const dotStyle = item.previewStyle === "dashed" ? "texture" : item.previewStyle;
  const dots = studioBrushPreviewDotCenters(dotStyle, 36, 16).map((dot) => ({
    x: 4 + dot.x * ((w - 8) / 36),
    y: 3 + dot.y * ((h - 6) / 16),
    r: dot.r * Math.min((w - 8) / 36, (h - 6) / 16),
  }));
  // Suggested preset colors make effect brushes recognizable in the catalog only. Selecting a
  // preset still preserves the artist's working color (the apply contract lives outside this view).
  const ink = active ? "currentColor" : item.defaultColor ?? surface.ink;
  const kind = studioBrushCatalogPreviewKind(item);
  const opacity = studioBrushPreviewOpacity(item.defaultOpacity);

  let brushSample: ReactElement;
  if (kind === "eraser") {
    brushSample = (
      <g data-studio-brush-preview-layer="eraser">
        <path
          d={pathD}
          fill="none"
          stroke={ink}
          strokeWidth={Math.max(9, strokeW * 2.4)}
          strokeLinecap="round"
          opacity={Math.max(0.16, opacity * 0.72)}
        />
        <path
          d={pathD}
          fill="none"
          stroke={active ? "currentColor" : surface.paper}
          strokeWidth={Math.max(4.5, strokeW * 1.18)}
          strokeLinecap="round"
          strokeDasharray="2.5 1.4"
          opacity="0.7"
        />
      </g>
    );
  } else if (kind === "wash-marker") {
    const chisel = item.id === "chisel-highlighter";
    const pastel = item.id === "pastel-highlighter";
    brushSample = (
      <g data-studio-brush-preview-layer="wash-marker">
        <path
          d={pathD}
          fill="none"
          stroke={ink}
          strokeWidth={Math.max(6.8, strokeW * 1.55)}
          strokeLinecap={chisel ? "butt" : "round"}
          strokeLinejoin={chisel ? "bevel" : "round"}
          strokeDasharray={pastel ? "7 0.45" : undefined}
          opacity={opacity * 0.82}
        />
        <path
          d={pathD}
          fill="none"
          stroke={ink}
          strokeWidth={Math.max(2.2, strokeW * 0.5)}
          strokeLinecap={chisel ? "butt" : "round"}
          strokeDasharray={pastel ? "1.1 1.4" : undefined}
          opacity={opacity * (pastel ? 0.24 : 0.18)}
        />
      </g>
    );
  } else if (kind === "marker") {
    brushSample = (
      <g data-studio-brush-preview-layer="marker">
        <path
          d={pathD}
          fill="none"
          stroke={ink}
          strokeWidth={Math.max(4.8, strokeW * 1.25)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={opacity}
        />
        <circle cx={w - 7} cy={h / 2 - 1} r={Math.max(2.4, strokeW * 0.56)} fill={ink} opacity={opacity * 0.78} />
      </g>
    );
  } else if (kind === "neon" || kind === "glow") {
    const softGlow = item.id === "soft-glow";
    const passes = kind === "neon"
      ? planNeonBrushPasses(strokeW)
      : planGlowBrushPasses(strokeW, softGlow).map((pass) => ({ ...pass, tone: "color" as const }));
    brushSample = (
      <g data-studio-brush-preview-layer={kind}>
        {passes.map((pass, index) => (
          <path
            key={index}
            d={pathD}
            fill="none"
            stroke={pass.tone === "white-core" ? "oklch(0.97 0.015 85)" : ink}
            strokeWidth={Math.max(1.15, strokeW * pass.widthScale)}
            strokeLinecap="round"
            opacity={pass.opacity * opacity}
          />
        ))}
      </g>
    );
  } else if (kind === "particle" || kind === "tone") {
    const particleDots = item.id === "star-dust" ? dots.filter((_, index) => index % 2 === 0) : dots;
    brushSample = (
      <g data-studio-brush-preview-layer={kind} fill={ink} opacity={opacity}>
        {particleDots.map((dot, index) => {
          if (kind === "particle" && (item.id === "star-dust" || index % 3 === 1)) {
            const size = dot.r * (item.id === "star-dust" ? 2.1 : 1.45);
            return (
              <path
                key={index}
                d={`M${dot.x} ${dot.y - size} L${dot.x + size * 0.38} ${dot.y - size * 0.38} L${dot.x + size} ${dot.y} L${dot.x + size * 0.38} ${dot.y + size * 0.38} L${dot.x} ${dot.y + size} L${dot.x - size * 0.38} ${dot.y + size * 0.38} L${dot.x - size} ${dot.y} L${dot.x - size * 0.38} ${dot.y - size * 0.38} Z`}
              />
            );
          }
          return <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} />;
        })}
      </g>
    );
  } else if (kind === "pencil" || kind === "texture") {
    brushSample = (
      <g data-studio-brush-preview-layer={kind}>
        <path
          d={pathD}
          fill="none"
          stroke={ink}
          strokeWidth={Math.max(1.1, strokeW * (kind === "texture" ? 1.15 : 0.82))}
          strokeLinecap="round"
          strokeDasharray={dashArray ?? "1.6 1.3"}
          opacity={opacity * 0.88}
        />
        <g fill={ink} opacity={opacity * (kind === "texture" ? 0.52 : 0.34)}>
          {dots.map((dot, index) => (
            <circle key={index} cx={dot.x} cy={dot.y} r={Math.max(0.45, dot.r * 0.48)} />
          ))}
        </g>
      </g>
    );
  } else if (kind === "soft-air") {
    brushSample = (
      <g data-studio-brush-preview-layer="soft-air">
        <path d={pathD} fill="none" stroke={ink} strokeWidth={Math.max(10, strokeW * 3.3)} strokeLinecap="round" opacity={opacity * 0.08} />
        <path d={pathD} fill="none" stroke={ink} strokeWidth={Math.max(7, strokeW * 2.35)} strokeLinecap="round" opacity={opacity * 0.16} />
        <path d={pathD} fill="none" stroke={ink} strokeWidth={Math.max(3.5, strokeW * 1.15)} strokeLinecap="round" opacity={opacity * 0.42} />
      </g>
    );
  } else if (kind === "soft-wash" || kind === "soft-pigment") {
    const wash = kind === "soft-wash";
    brushSample = (
      <g data-studio-brush-preview-layer={kind}>
        <path
          d={pathD}
          fill="none"
          stroke={ink}
          strokeWidth={Math.max(wash ? 8.4 : 7.2, strokeW * (wash ? 2.45 : 2.05))}
          strokeLinecap="round"
          opacity={opacity * (wash ? 0.2 : 0.24)}
        />
        <path
          d={pathD}
          fill="none"
          stroke={ink}
          strokeWidth={Math.max(3.2, strokeW * 1.08)}
          strokeLinecap="round"
          strokeDasharray={wash ? "8 2.2" : undefined}
          opacity={opacity * 0.48}
        />
        {wash ? (
          <g fill="none" stroke={ink} opacity={opacity * 0.25}>
            <circle cx={22} cy={h / 2 - 1.5} r={Math.max(3.6, strokeW)} />
            <circle cx={68} cy={h / 2 + 0.5} r={Math.max(4.2, strokeW * 1.15)} />
          </g>
        ) : null}
      </g>
    );
  } else if (kind === "oil") {
    brushSample = (
      <g data-studio-brush-preview-layer="oil">
        <path d={ribbonD ?? pathD} fill={ribbonD ? ink : "none"} stroke={ribbonD ? "none" : ink} opacity={opacity * 0.92} />
        <path d={pathD} fill="none" stroke={active ? "currentColor" : surface.paper} strokeWidth={1.1} strokeDasharray="7 2" opacity={opacity * 0.72} />
        <path d={pathD} fill="none" stroke={ink} strokeWidth={0.7} strokeDasharray="2 3" opacity={opacity * 0.58} transform="translate(0 2.2)" />
      </g>
    );
  } else {
    brushSample = (
      <g data-studio-brush-preview-layer={kind}>
        {ribbonD ? (
          <path d={ribbonD} fill={ink} opacity={opacity} />
        ) : (
          <path
            d={pathD}
            fill="none"
            stroke={ink}
            strokeWidth={strokeW * 1.15}
            strokeLinecap="round"
            opacity={opacity}
          />
        )}
        {kind === "calligraphy" ? (
          <>
            <path
              d={pathD}
              fill="none"
              stroke={active ? "currentColor" : surface.paper}
              strokeWidth={item.id === "school-pen" ? 0.55 : 0.75}
              opacity={item.id === "school-pen" ? 0.46 : 0.62}
            />
            {item.id === "fountain-pen" ? (
              <path
                d={pathD}
                fill="none"
                stroke={ink}
                strokeWidth={0.55}
                strokeDasharray="7 2.2"
                opacity={opacity * 0.74}
                transform="translate(0 1.6)"
                data-studio-brush-preview-detail="fountain-nib-slit"
              />
            ) : null}
            {item.id === "maru-pen" ? (
              <path
                d={pathD}
                fill="none"
                stroke={ink}
                strokeWidth={0.42}
                strokeDasharray="10 1.1"
                opacity={opacity * 0.82}
                transform="translate(0 -1.1)"
                data-studio-brush-preview-detail="maru-hairline"
              />
            ) : null}
            {item.id === "parallel-pen" ? (
              <g
                fill="none"
                stroke={active ? "currentColor" : surface.paper}
                strokeLinecap="square"
                opacity={0.72}
                data-studio-brush-preview-detail="parallel-edge"
              >
                <path d={pathD} strokeWidth={0.72} transform="translate(0 -2.2)" />
                <path d={pathD} strokeWidth={0.72} transform="translate(0 2.2)" />
              </g>
            ) : null}
          </>
        ) : null}
        {item.id === "ruling-pen" ? (
          <g
            fill="none"
            stroke={active ? "currentColor" : surface.paper}
            strokeLinecap="round"
            opacity={0.68}
            data-studio-brush-preview-detail="ruling-gap"
          >
            <path d={pathD} strokeWidth={0.5} transform="translate(0 -1.25)" />
            <path d={pathD} strokeWidth={0.5} transform="translate(0 1.25)" />
          </g>
        ) : null}
        {item.id === "glass-pen" ? (
          <g
            fill={ink}
            opacity={opacity * 0.76}
            data-studio-brush-preview-detail="glass-flow"
          >
            <circle cx="27" cy="10.8" r="0.85" />
            <circle cx="49" cy="22.7" r="1.05" />
            <circle cx="71" cy="12.3" r="0.72" />
          </g>
        ) : null}
      </g>
    );
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${w} ${h}`}
      data-studio-brush-preview="true"
      data-studio-brush-preview-kind={kind}
      data-studio-brush-preview-opacity={opacity}
      data-studio-brush-preview-density={density}
      className={cn(
        "block w-full",
        density === "tile" ? "h-7" : "h-[2.125rem]",
        compact && "h-7",
        "[@media(max-height:32rem)]:h-7",
        active && "text-on-accent"
      )}
    >
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        rx={6}
        fill={active ? "oklch(0.98 0.01 85 / 0.14)" : surface.tile}
        stroke={active ? "oklch(0.98 0.01 85 / 0.25)" : "oklch(0.4 0.012 64 / 0.35)"}
        strokeWidth={0.7}
      />
      <path d={`M5 ${h - 5.5} H${w - 5}`} stroke={active ? "currentColor" : surface.paper} strokeWidth={0.5} opacity={0.35} />
      {brushSample}
      <StudioProceduralBrushPreviewDetail item={item} ink={ink} opacity={opacity} />
    </svg>
  );
}

export function StudioBrushLibrarySheet({
  open,
  activeBrushId,
  operation = "paint",
  compact = false,
  embedded = false,
  closeOnSelection = true,
  dismissOnOutsidePointer = true,
  triggerElement = null,
  favoriteIds = [],
  recentIds = [],
  restoredView = null,
  onViewStateChange,
  onClose,
  onSelect,
  onToggleFavorite,
  className,
  style,
}: StudioBrushLibrarySheetProps): ReactElement | null {
  const titleId = useId();
  const tabsId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const itemGridRef = useRef<HTMLDivElement>(null);
  const scrollportRef = useRef<HTMLDivElement>(null);
  const progressiveSentinelRef = useRef<HTMLDivElement>(null);
  const progressiveFilterKeyRef = useRef<string | null>(null);
  const progressiveLoadPendingRef = useRef(false);
  const progressiveObserverEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const selectionRequestEpochRef = useRef(0);
  const viewStateRef = useRef<StudioBrushCatalogRestoredView>({
    tab: restoredView?.tab ?? "",
    query: restoredView?.query ?? "",
    viewMode: restoredView?.viewMode ?? "stroke",
  });
  const reportViewStateRef = useRef(onViewStateChange);
  const [query, setQuery] = useState(restoredView?.query ?? "");
  const [tab, setTab] = useState<(typeof STUDIO_BRUSH_LIBRARY_TABS)[number]["id"]>(
    (restoredView?.tab as (typeof STUDIO_BRUSH_LIBRARY_TABS)[number]["id"] | undefined)
      || (operation === "erase" ? "all" : "beginner"),
  );
  const [viewMode, setViewMode] = useState<StudioBrushCatalogViewMode>(
    restoredView?.viewMode ?? "stroke",
  );
  const [visibleLimit, setVisibleLimit] = useState(
    STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT
  );
  const [focusedBrushId, setFocusedBrushId] = useState<string | null>(null);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const panelId = `${tabsId}-panel`;
  const catalogTabs = operation === "erase"
    ? STUDIO_ERASER_LIBRARY_TABS
    : STUDIO_BRUSH_LIBRARY_TABS;
  // SSOT totals — never hardcode (legacy copy said "229 paint" from core 71 era). The number must
  // come from the LISTED inventory, not the registered one: registered counts include quarantined
  // ids that this sheet can never show, so `STUDIO_BRUSH_CATALOG_COUNTS.paint` would advertise
  // 328 brushes behind a drawer that offers 240 (2026-08-21 로스터 축소 이후).
  const operationCatalogCount = operation === "erase"
    ? STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS.length
    : STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.length;
  // 코어/프로시저럴은 구현 티어라 서랍에서 말하지 않는다. 대신 지금 고를 수 있는 재질 갈래 수를
  // 보여준다 — 탭이 곧 재질이므로 이 숫자는 탭 목록에서 파생된다.
  const materialTabCount = catalogTabs.filter(
    (chip) => isStudioBrushMaterialGroup(chip.id),
  ).length;
  const operationLabel = operation === "erase" ? "지우개" : "브러시";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      selectionRequestEpochRef.current += 1;
    };
  }, []);

  // The place to return to is reported ONCE, on teardown, rather than per keystroke: each report
  // becomes a durable SQLite intent, and the catalogue closes on every exit path (escape, outside
  // pointer, explicit, selection), so one write per visit captures the same information.
  useEffect(() => {
    viewStateRef.current = { tab, query: query.trim(), viewMode };
  }, [tab, query, viewMode]);

  useEffect(() => {
    reportViewStateRef.current = onViewStateChange;
  }, [onViewStateChange]);

  useEffect(
    () => () => {
      reportViewStateRef.current?.(viewStateRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open) selectionRequestEpochRef.current += 1;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectionError(null);
    const t = globalThis.setTimeout(() => searchRef.current?.focus(), 30);
    return () => globalThis.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!catalogTabs.some((catalogTab) => catalogTab.id === tab)) {
      setTab(operation === "erase" ? "all" : "beginner");
    }
  }, [catalogTabs, open, operation, tab]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        selectionRequestEpochRef.current += 1;
        setPendingSelectionId(null);
        onClose("escape");
      }
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !dismissOnOutsidePointer) return;
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (
        rootRef.current?.contains(event.target)
        || triggerElement?.contains(event.target)
      ) return;
      selectionRequestEpochRef.current += 1;
      setPendingSelectionId(null);
      onClose("outside-pointer");
    }
    globalThis.addEventListener("pointerdown", onPointerDown, true);
    return () => globalThis.removeEventListener("pointerdown", onPointerDown, true);
  }, [dismissOnOutsidePointer, open, onClose, triggerElement]);

  const normalizedQuery = query.trim();
  const personalSearch = tab === "favorites" || tab === "recent";
  const items = filterStudioBrushCatalogItems({
    operation,
    category: tab,
    query: normalizedQuery,
    favoriteIds,
    recentIds,
  });
  const progressiveFilterKey = [
    operation,
    tab,
    normalizedQuery,
    tab === "favorites" ? favoriteIds.join("\u001f") : "",
    tab === "recent" ? recentIds.join("\u001f") : "",
  ].join("\u001e");
  const visibleLimitForFilter =
    progressiveFilterKeyRef.current === progressiveFilterKey
      ? visibleLimit
      : STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT;
  const visibleItems = items.slice(0, visibleLimitForFilter);
  const hasMoreItems = visibleItems.length < items.length;
  const remainingItemCount = Math.max(0, items.length - visibleItems.length);
  const nextBatchItemCount = Math.min(
    STUDIO_BRUSH_PROGRESSIVE_BATCH_COUNT,
    remainingItemCount,
  );
  const rovingBrushId = visibleItems.some((item) => item.id === focusedBrushId)
    ? focusedBrushId
    : visibleItems.some((item) => item.id === activeBrushId)
      ? activeBrushId
      : visibleItems[0]?.id ?? null;
  const activeCatalogItem = studioBrushCatalogItemById(activeBrushId);
  const activeEraserId: StudioEraserQuickPickerId =
    activeBrushId === "kneaded-eraser" ? "kneaded-eraser" : "standard-eraser";
  const showEraserQuickPicker =
    operation === "erase" && tab === "all" && normalizedQuery.length === 0;

  useLayoutEffect(() => {
    if (progressiveFilterKeyRef.current === progressiveFilterKey) return;
    progressiveFilterKeyRef.current = progressiveFilterKey;
    progressiveLoadPendingRef.current = false;
    progressiveObserverEpochRef.current += 1;
    if (scrollportRef.current) scrollportRef.current.scrollTop = 0;
    setVisibleLimit(STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT);
  }, [progressiveFilterKey]);

  useEffect(() => {
    const observerEpoch = progressiveObserverEpochRef.current + 1;
    progressiveObserverEpochRef.current = observerEpoch;
    progressiveLoadPendingRef.current = false;
    const sentinel = progressiveSentinelRef.current;
    if (
      !open
      || !hasMoreItems
      || !sentinel
      || typeof globalThis.IntersectionObserver !== "function"
    ) {
      return () => {
        if (progressiveObserverEpochRef.current === observerEpoch) {
          progressiveObserverEpochRef.current += 1;
        }
        progressiveLoadPendingRef.current = false;
      };
    }

    const observer = new globalThis.IntersectionObserver(
      (entries) => {
        if (
          progressiveObserverEpochRef.current !== observerEpoch
          || progressiveLoadPendingRef.current
          || !entries.some((entry) => entry.isIntersecting)
        ) {
          return;
        }
        progressiveLoadPendingRef.current = true;
        setVisibleLimit((current) => Math.min(
          items.length,
          Math.max(current, STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT)
            + STUDIO_BRUSH_PROGRESSIVE_BATCH_COUNT,
        ));
      },
      {
        root: scrollportRef.current,
        rootMargin: STUDIO_BRUSH_PROGRESSIVE_ROOT_MARGIN,
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      if (progressiveObserverEpochRef.current === observerEpoch) {
        progressiveObserverEpochRef.current += 1;
      }
      progressiveLoadPendingRef.current = false;
    };
  }, [
    hasMoreItems,
    items.length,
    open,
    progressiveFilterKey,
    visibleItems.length,
  ]);

  if (!open) return null;

  function chooseTab(
    nextTab: (typeof STUDIO_BRUSH_LIBRARY_TABS)[number]["id"],
  ): void {
    setTab(nextTab);
    setVisibleLimit(STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT);
    setFocusedBrushId(null);
  }

  async function selectCatalogItem(item: StudioBrushCatalogItem): Promise<void> {
    if (pendingSelectionId) return;
    const requestEpoch = selectionRequestEpochRef.current + 1;
    selectionRequestEpochRef.current = requestEpoch;
    const requestIsCurrent = () =>
      mountedRef.current && requestEpoch === selectionRequestEpochRef.current;
    setSelectionError(null);
    setPendingSelectionId(item.id);
    try {
      const selection = await materializeStudioBrushCatalogSelection(item.id);
      if (!requestIsCurrent()) return;
      if (!selection) throw new Error("브러시 프로필을 찾을 수 없습니다.");
      onSelect(selection);
      if (!requestIsCurrent()) return;
      selectionRequestEpochRef.current += 1;
      setPendingSelectionId(null);
      if (closeOnSelection) onClose("selection");
    } catch (error) {
      if (!requestIsCurrent()) return;
      setSelectionError(
        error instanceof Error && error.message
          ? error.message
          : "브러시를 불러오지 못했습니다. 다시 시도해 주세요."
      );
    } finally {
      if (requestIsCurrent()) setPendingSelectionId(null);
    }
  }

  function onTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ): void {
    const lastIndex = catalogTabs.length - 1;
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
    const nextTab = catalogTabs[nextIndex];
    if (!nextTab) return;
    event.preventDefault();
    chooseTab(nextTab.id);
    tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }

  function onBrushKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void {
    const currentBrush = visibleItems[currentIndex];
    if (
      currentBrush
      && onToggleFavorite
      && event.key.toLowerCase() === "f"
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
    ) {
      event.preventDefault();
      onToggleFavorite(currentBrush.id);
      return;
    }
    if (
      event.key !== "ArrowLeft"
      && event.key !== "ArrowRight"
      && event.key !== "ArrowUp"
      && event.key !== "ArrowDown"
      && event.key !== "Home"
      && event.key !== "End"
    ) return;
    const nextIndex = nextStudioBrushGridIndex({
      currentIndex,
      itemCount: visibleItems.length,
      columns: studioBrushGridColumnCount(itemGridRef.current, viewMode),
      key: event.key,
    });
    if (nextIndex === null) return;
    event.preventDefault();
    if (nextIndex === currentIndex) return;
    const nextBrush = visibleItems[nextIndex];
    if (!nextBrush) return;
    setFocusedBrushId(nextBrush.id);
    const nextButton = itemGridRef.current
      ?.querySelectorAll<HTMLButtonElement>("[data-studio-brush-select]")
      [nextIndex];
    nextButton?.focus({ preventScroll: true });
    nextButton?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  return (
    <div
      ref={rootRef}
      role={embedded ? "region" : "dialog"}
      aria-label={embedded
        ? operation === "erase" ? "지우개 선택" : "브러시 전체 라이브러리"
        : undefined}
      aria-labelledby={embedded ? undefined : titleId}
      aria-describedby={embedded ? undefined : `${titleId}-description`}
      data-studio-brush-library="true"
      data-studio-brush-catalog="built-in"
      data-studio-brush-catalog-session="true"
      data-studio-brush-surface-role="full-catalog-management"
      data-studio-brush-compact={compact ? "true" : undefined}
      style={style}
      className={cn(
        embedded
          ? "relative flex h-full max-h-none w-full flex-col overflow-hidden bg-panel"
          : "absolute left-2 top-[calc(100%+0.35rem)] z-[60] flex max-h-[min(32rem,calc(100dvh-1rem))] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_16px_48px_oklch(0.12_0.02_70/0.55)]",
        className
      )}
    >
      {!embedded ? (
      <div
        data-studio-brush-catalog-header="true"
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2",
          compact && "px-2 py-0",
          "[@media(max-height:32rem)]:px-2 [@media(max-height:32rem)]:py-0"
        )}
      >
        <div className="min-w-0">
          <p id={titleId} className="text-sm font-bold text-fg">
            {operation === "erase" ? "지우개 선택" : "브러시 전체 라이브러리"}
          </p>
          <p
            id={`${titleId}-description`}
            className={cn(
              "text-[0.62rem] text-fg-3",
              compact && "hidden",
              "[@media(max-height:32rem)]:hidden"
            )}
          >
            {operation === "erase"
              ? `지우개 ${operationCatalogCount}종 · ${visibleItems.length}/${items.length}개 표시`
              : `브러시 ${operationCatalogCount}종 · 재질 ${materialTabCount}갈래 · ${visibleItems.length}/${items.length}개 표시`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            selectionRequestEpochRef.current += 1;
            setPendingSelectionId(null);
            onClose("explicit");
          }}
          aria-label={operation === "erase"
            ? "지우개 선택 닫기"
            : "브러시 전체 라이브러리 닫기"}
          data-studio-brush-library-close="true"
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised hover:text-fg",
            STUDIO_FOCUS_RING
          )}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      ) : null}

      <div
        data-studio-brush-catalog-controls="true"
        className={cn(
          "shrink-0 border-b border-line px-2 py-2",
          compact && "flex items-center gap-1 px-1 py-0",
          "[@media(max-height:32rem)]:flex [@media(max-height:32rem)]:items-center [@media(max-height:32rem)]:gap-1 [@media(max-height:32rem)]:px-1 [@media(max-height:32rem)]:py-0"
        )}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleLimit(STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT);
              setFocusedBrushId(null);
            }}
            placeholder={personalSearch
              ? `${tab === "favorites" ? "즐겨찾기" : "최근 사용"}에서 이름·용도로 검색`
              : operation === "erase"
              ? `지우개 ${operationCatalogCount}종 검색`
              : `전체 ${operationCatalogCount}종 검색 (네온, 수채, G펜…)`}
            className="min-h-11 w-full rounded-xl border border-line bg-card py-1.5 pl-9 pr-3 text-xs outline-none placeholder:text-fg-3 focus:border-accent focus:ring-1 focus:ring-accent/40"
            aria-label={`${personalSearch ? tab === "favorites" ? "즐겨찾기" : "최근 사용" : "전체"} ${operationLabel} 검색`}
            aria-controls={panelId}
            aria-describedby={`${titleId}-search-scope`}
            data-studio-brush-search-scope={personalSearch ? tab : "all"}
          />
        </div>
        <p
          id={`${titleId}-search-scope`}
          className={cn(
            "mt-1 px-1 text-[0.6rem] leading-relaxed text-fg-3",
            compact && "hidden",
            "[@media(max-height:32rem)]:hidden"
          )}
        >
          {personalSearch
            ? `${tab === "favorites" ? "즐겨찾기" : "최근 사용"} 안에서 검색합니다. 다른 브러시는 전체 탭에서 찾으세요.`
            : normalizedQuery
            ? `재질 분류와 관계없이 전체 ${operationCatalogCount}종에서 검색 중`
            : operation === "erase"
              ? "지우는 강도와 결과를 비교해 선택하세요."
              : "재질을 고르거나 이름·용도·종류로 전체 검색"}
        </p>
        {operation === "paint" ? <div
          className={cn(
            "mt-1.5 flex min-w-0 items-center justify-between gap-2 px-1",
            compact && "mt-0 shrink-0 gap-0 px-0",
            "[@media(max-height:32rem)]:mt-0 [@media(max-height:32rem)]:shrink-0 [@media(max-height:32rem)]:gap-0 [@media(max-height:32rem)]:px-0"
          )}
        >
          <span
            className={cn(
              "shrink-0 text-[0.62rem] font-semibold text-fg-3",
              compact && "hidden",
              "[@media(max-height:32rem)]:hidden"
            )}
          >
            표시
          </span>
          <div
            role="group"
            aria-label="브러시 표시 방식"
            className={cn(
              "grid min-w-0 flex-1 grid-cols-3 rounded-xl border border-line bg-card p-0.5",
              compact && "w-[8.5rem] flex-none",
              "[@media(max-height:32rem)]:w-[8.5rem] [@media(max-height:32rem)]:flex-none"
            )}
          >
            {STUDIO_BRUSH_CATALOG_VIEW_OPTIONS.map(({ id, label, title, Icon }) => {
              const active = viewMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={title}
                  aria-label={title}
                  aria-pressed={active}
                  data-studio-brush-view-option={id}
                  onClick={() => setViewMode(id)}
                  className={cn(
                    "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-1.5 text-[0.62rem] font-bold",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    active
                      ? "bg-raised text-fg shadow-[inset_0_0_0_1px_oklch(0.42_0.013_64)]"
                      : "text-fg-3 hover:bg-raised/70 hover:text-fg"
                  )}
                >
                  <Icon size={13} strokeWidth={1.8} aria-hidden />
                  <span
                    className={cn(
                      compact && "sr-only",
                      "[@media(max-height:32rem)]:sr-only"
                    )}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div> : null}
      </div>

      <div
        ref={tabListRef}
        data-studio-brush-catalog-tabs="true"
        className={cn(
          "flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5 [scrollbar-width:thin]",
          compact && "px-1 py-0",
          "[@media(max-height:32rem)]:px-1 [@media(max-height:32rem)]:py-0"
        )}
        role="tablist"
        aria-label={`${operationLabel} 재질 분류`}
      >
        {catalogTabs.map((chip, chipIndex) => {
          const active = tab === chip.id;
          return (
            <button
              key={chip.id}
              id={`${tabsId}-${chip.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              title={chip.title}
              onClick={() => chooseTab(chip.id)}
              onKeyDown={(event) => onTabKeyDown(event, chipIndex)}
              className={cn(
                "min-h-11 min-w-11 shrink-0 rounded-xl border px-3 py-1 text-[0.64rem] font-semibold",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <div
        ref={scrollportRef}
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${tab}`}
        tabIndex={0}
        data-studio-brush-catalog-scrollport="true"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto p-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
          compact && "min-h-16 p-1",
          "[@media(max-height:32rem)]:min-h-16 [@media(max-height:32rem)]:p-1"
        )}
      >
        {selectionError ? (
          <div
            role="alert"
            className="mb-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-[0.68rem] font-medium text-danger"
          >
            {selectionError}
          </div>
        ) : null}
        <p role="status" aria-live="polite" className="sr-only">
          {visibleItems.length}/{items.length}개의 {operationLabel}가 표시됩니다.
        </p>
        {showEraserQuickPicker ? (
          <StudioEraserQuickPicker
            selectedId={activeEraserId}
            ariaLabel="지우개 종류 선택"
            onSelect={(eraserId) => {
              const item = studioBrushCatalogItemById(eraserId);
              if (item?.operation === "erase") void selectCatalogItem(item);
            }}
          />
        ) : items.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center rounded-xl border border-dashed border-line text-center">
            <p className="text-xs text-fg-3">
              {tab === "favorites"
                ? `즐겨찾기한 ${operationLabel}가 없어요. ☆로 추가해 보세요.`
                : tab === "recent"
                  ? `최근 사용한 ${operationLabel}가 아직 없어요.`
                  : "검색 결과가 없습니다."}
            </p>
          </div>
        ) : (
          <>
          <div
            ref={itemGridRef}
            data-studio-brush-progressive-grid="true"
            data-studio-brush-view={viewMode}
            className={cn(
              "grid",
              viewMode === "stroke"
                ? "grid-cols-2 gap-1.5 sm:grid-cols-3"
                : viewMode === "tile"
                  ? "grid-cols-3 gap-1"
                  : "grid-cols-1 gap-1"
            )}
          >
            {visibleItems.map((item, itemIndex) => {
              const active = item.id === activeBrushId;
              const fav = favoriteIds.includes(item.id);
              const kindLabel = studioBrushCatalogKindLabel(item);
              const engineLaneLabel = resolveStudioBrushEngineLaneLabelKo(item.id);
              const engineLane = studioBrushEngineLaneRowById(item.id);
              return (
                <div
                  key={item.id}
                  data-studio-brush-source={item.source}
                  data-studio-brush-kind={item.mediaGroup}
                  data-studio-brush-engine-lane={engineLane?.lane}
                  className={cn(
                    "group relative flex border [content-visibility:auto]",
                    STUDIO_EASE,
                    viewMode === "stroke"
                      ? cn(
                          "flex-col rounded-xl p-1.5 [contain-intrinsic-size:7.25rem]",
                          compact && "p-1 [contain-intrinsic-size:4rem]",
                          "[@media(max-height:32rem)]:p-1 [@media(max-height:32rem)]:[contain-intrinsic-size:4rem]"
                        )
                      : viewMode === "tile"
                        ? "min-h-[5.25rem] flex-col rounded-lg p-1 [contain-intrinsic-size:5.25rem]"
                        : "min-h-11 rounded-lg px-1 [contain-intrinsic-size:2.75rem]",
                    active
                      ? "border-accent bg-accent text-on-accent shadow-[0_2px_10px_oklch(0.72_0.185_42/0.25)]"
                      : "border-line bg-card hover:border-accent/40 hover:bg-raised"
                  )}
                >
                  <button
                    type="button"
                    onPointerEnter={() => {
                      void preloadStudioBrushCatalogSelection(item.id).catch(() => undefined);
                    }}
                    onFocus={() => {
                      void preloadStudioBrushCatalogSelection(item.id).catch(() => undefined);
                    }}
                    onClick={() => void selectCatalogItem(item)}
                    title={item.hint}
                    aria-label={`${item.name} 선택`}
                    aria-pressed={active}
                    aria-keyshortcuts={onToggleFavorite ? "F" : undefined}
                    tabIndex={item.id === rovingBrushId ? 0 : -1}
                    aria-busy={pendingSelectionId === item.id || undefined}
                    disabled={pendingSelectionId !== null}
                    data-studio-brush-select={item.id}
                    onKeyDown={(event) => onBrushKeyDown(event, itemIndex)}
                    className={cn(
                      "flex min-w-0 flex-1 rounded-lg text-left disabled:cursor-wait disabled:opacity-70",
                      viewMode === "stroke"
                        ? "flex-col items-stretch gap-1"
                        : viewMode === "tile"
                          ? "min-h-[4.75rem] flex-col items-stretch gap-0.5"
                          : "min-h-11 items-center gap-2 pr-11",
                      STUDIO_FOCUS_RING
                    )}
                  >
                    {viewMode === "text" ? null : (
                      <LargeBrushPreview
                        item={item}
                        active={active}
                        compact={compact}
                        density={viewMode}
                      />
                    )}
                    <span
                      data-studio-brush-text-row={viewMode === "text" ? "true" : undefined}
                      className={cn(
                        "flex min-w-0 items-center gap-1",
                        viewMode === "text" ? "flex-1" : "pr-5"
                      )}
                    >
                      <StudioBrushPresetIcon
                        brushId={item.id}
                        size={viewMode === "text" ? 15 : 12}
                        strokeWidth={2}
                        className={cn(
                          "shrink-0",
                          active ? "text-on-accent" : "text-fg-2"
                        )}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1",
                          active ? "text-on-accent" : "text-fg-2"
                        )}
                      >
                        <span className="block truncate text-[0.68rem] font-bold leading-tight">
                          {item.name}
                        </span>
                        {viewMode === "text" ? (
                          <span
                            className={cn(
                              "block truncate text-[0.58rem] font-medium leading-tight",
                              active ? "text-on-accent/75" : "text-fg-3"
                            )}
                          >
                            {engineLaneLabel ? `${engineLaneLabel} · ` : ""}{kindLabel} · {item.defaultWidth}px ·{" "}
                            {Math.round(item.defaultOpacity * 100)}%
                          </span>
                        ) : null}
                      </span>
                      {pendingSelectionId === item.id ? (
                        <LoaderCircle size={12} className="ml-auto shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                      ) : item.source === "pro" ? (
                        <span className="ml-auto shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.58rem] font-black text-accent">
                          PRO
                        </span>
                      ) : null}
                    </span>
                    {viewMode === "stroke" ? (
                      <span
                        data-studio-brush-stroke-details="true"
                        className={cn(
                          "flex min-w-0 items-center justify-between gap-1 text-[0.6rem] leading-tight",
                          compact && "hidden",
                          "[@media(max-height:32rem)]:hidden",
                          active ? "text-on-accent/75" : "text-fg-3"
                        )}
                      >
                        <span className="truncate">
                          {item.defaultWidth}px · {Math.round(item.defaultOpacity * 100)}%
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {engineLaneLabel ? (
                            <span
                              data-studio-brush-engine-chip={engineLane?.lane}
                              className={cn(
                                "rounded-full px-1.5 py-0.5 font-bold",
                                active
                                  ? "bg-on-accent/20 text-on-accent"
                                  : "bg-accent/12 text-accent"
                              )}
                              title={`엔진: ${engineLaneLabel}`}
                            >
                              {engineLaneLabel}
                            </span>
                          ) : null}
                          <span
                            data-studio-brush-kind-badge={item.mediaGroup}
                            className={cn(
                              "rounded-full px-1.5 py-0.5 font-bold",
                              active ? "bg-on-accent/15 text-on-accent" : "bg-raised text-fg-2"
                            )}
                          >
                            {kindLabel}
                          </span>
                        </span>
                      </span>
                    ) : null}
                  </button>
                  {onToggleFavorite ? (
                    <button
                      type="button"
                      title={`${fav ? "즐겨찾기 해제" : "즐겨찾기"} · 선택 항목에서 F`}
                      aria-label={fav ? `${item.name} 즐겨찾기 해제` : `${item.name} 즐겨찾기`}
                      aria-pressed={fav}
                      tabIndex={-1}
                      data-studio-brush-favorite={item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(item.id);
                      }}
                      className={cn(
                        "absolute right-0 top-0 grid size-11 place-items-center rounded-xl",
                        STUDIO_FOCUS_RING,
                        fav
                          ? active
                            ? "text-on-accent"
                            : "text-accent"
                          : active
                            ? "text-on-accent/55 hover:text-on-accent"
                            : "text-fg-3 hover:text-fg"
                      )}
                    >
                      <Star size={12} fill={fav ? "currentColor" : "none"} aria-hidden />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {hasMoreItems ? (
            <div
              ref={progressiveSentinelRef}
              aria-hidden="false"
              data-studio-brush-progressive-sentinel="true"
              data-studio-brush-progressive-remaining={remainingItemCount}
              className="relative h-px w-full focus-within:h-auto"
            >
              <button
                type="button"
                aria-controls={panelId}
                aria-label={`다음 ${operationLabel} ${nextBatchItemCount}개 불러오기, ${remainingItemCount}개 남음`}
                data-studio-brush-progressive-fallback="true"
                onClick={() => {
                  if (progressiveLoadPendingRef.current) return;
                  progressiveLoadPendingRef.current = true;
                  setVisibleLimit((current) => Math.min(
                    items.length,
                    Math.max(current, STUDIO_BRUSH_PROGRESSIVE_INITIAL_COUNT)
                      + STUDIO_BRUSH_PROGRESSIVE_BATCH_COUNT,
                  ));
                }}
                className={cn(
                  "sr-only focus:not-sr-only focus:mt-2 focus:flex focus:min-h-11 focus:w-full focus:items-center focus:justify-center focus:rounded-xl focus:border focus:border-line focus:bg-card focus:px-3 focus:text-[0.68rem] focus:font-bold focus:text-fg-2",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                )}
              >
                다음 {operationLabel} {nextBatchItemCount}개 불러오기
              </button>
            </div>
          ) : null}
          </>
        )}
      </div>
      <div
        data-studio-brush-catalog-reset="true"
        className={cn(
          "shrink-0 border-t border-line bg-panel px-2 py-2",
          compact && "px-1 py-0",
          "[@media(max-height:32rem)]:px-1 [@media(max-height:32rem)]:py-0"
        )}
      >
        <button
          type="button"
          disabled={!activeCatalogItem || pendingSelectionId !== null}
          onClick={() => {
            if (activeCatalogItem) void selectCatalogItem(activeCatalogItem);
          }}
          aria-label={
            activeCatalogItem
              ? `${activeCatalogItem.name} 기본값 다시 적용`
              : `현재 ${operationLabel} 기본값을 찾을 수 없음`
          }
          className={cn(
            "flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-card px-3 text-left text-fg-2 hover:border-accent/40 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
            STUDIO_EASE,
            STUDIO_FOCUS_RING
          )}
        >
          <RotateCcw size={14} className="shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[0.68rem] font-bold">
              현재 {operationLabel} 기본값 다시 적용
            </span>
            <span
              className={cn(
                "block truncate text-[0.6rem] text-fg-3",
                compact && "hidden",
                "[@media(max-height:32rem)]:hidden"
              )}
            >
              {activeCatalogItem
                ? operation === "erase"
                  ? `${activeCatalogItem.name}의 굵기·지우기 강도·촉 반응`
                  : `${activeCatalogItem.name}의 굵기·불투명도·촉 반응`
                : `사용자 저장 ${operationLabel}는 내 브러시에서 다시 적용`}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * The only built-in preset catalog Portal in Studio. Desktop and mobile
 * triggers point at this controlled host, so Escape/outside-click/focus return
 * and favorite mutations cannot diverge across hidden UI surfaces.
 */
export function StudioBrushCatalogPortal({
  open,
  placement,
  triggerElement,
  activeBrushId,
  operation = "paint",
  favoriteIds = [],
  recentIds = [],
  restoredView = null,
  onViewStateChange,
  mobileKeyboardInset = 0,
  onClose,
  onSelect,
  onToggleFavorite,
}: StudioBrushCatalogPortalProps): ReactElement | null {
  const desktop = placement === "desktop-dock";
  const { layout, setLayout, authority, failure } = useStudioFloatingSurfaceLayout({
    surfaceId: `brush-catalog:${operation}`,
    defaultLayout: DEFAULT_STUDIO_BRUSH_CATALOG_FLOATING_LAYOUT,
    enabled: open && desktop,
  });

  if (!open || !globalThis.document) return null;

  const safeMobileKeyboardInset = Number.isFinite(mobileKeyboardInset)
    ? Math.max(0, Math.round(mobileKeyboardInset))
    : 0;
  const mobileStyle: CSSProperties = {
    bottom: `calc(7.5rem + env(safe-area-inset-bottom) + ${safeMobileKeyboardInset}px)`,
  };
  const sheet = (
    <StudioBrushLibrarySheet
      open
      activeBrushId={activeBrushId}
      operation={operation}
      compact={!desktop && safeMobileKeyboardInset >= 80}
      embedded={desktop}
      closeOnSelection={!desktop}
      dismissOnOutsidePointer={!desktop}
      triggerElement={triggerElement}
      favoriteIds={favoriteIds}
      recentIds={recentIds}
      restoredView={restoredView}
      onViewStateChange={onViewStateChange}
      onClose={onClose}
      onSelect={onSelect}
      onToggleFavorite={onToggleFavorite}
      className={desktop
        ? "h-full w-full"
        : "fixed pointer-events-auto inset-x-2 top-3 w-auto max-h-[calc(100dvh-1.5rem)]"}
      style={desktop ? undefined : mobileStyle}
    />
  );

  return createPortal(
    desktop ? (
      <StudioFloatingSurface
        surfaceId={`brush-catalog:${operation}`}
        label={operation === "erase" ? "지우개 선택" : "브러시 전체 라이브러리"}
        layout={layout}
        defaultLayout={DEFAULT_STUDIO_BRUSH_CATALOG_FLOATING_LAYOUT}
        minWidth={360}
        minHeight={420}
        maxWidth={900}
        maxHeight={1_100}
        insetTop={76}
        insetRight={12}
        insetBottom={12}
        insetLeft={12}
        snapDistance={12}
        allowedDockEdges={["left", "right"]}
        onLayoutChange={setLayout}
        onClose={() => onClose("explicit")}
        rootDataAttributes={{
          "data-studio-brush-floating": operation,
          "data-studio-floating-layout-authority": authority,
          "data-studio-floating-layout-failure": failure ?? undefined,
        }}
        contentClassName="flex min-h-0 flex-1"
      >
        {sheet}
      </StudioFloatingSurface>
    ) : sheet,
    globalThis.document.body,
  );
}
