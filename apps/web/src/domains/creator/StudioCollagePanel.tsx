/**
 * StudioCollagePanel — PicsArt-class collage layout picker.
 * Layout tiles + gap/padding/border/canvas size + apply.
 */
import { Grid2X2, Images } from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  DEFAULT_STUDIO_COLLAGE_OPTIONS,
  listStudioCollageLayouts,
  materializeStudioCollage,
  planStudioCollageImagePlacements,
  STUDIO_COLLAGE_CANVAS_H_PRESETS,
  STUDIO_COLLAGE_CATEGORY_CHIPS,
  studioCollagePreviewRects,
  type StudioCollageCategory,
  type StudioCollageFitMode,
  type StudioCollageFrameSeed,
  type StudioCollageImagePlacement,
  type StudioCollageImageSource,
  type StudioCollageLayoutPreset,
} from "./studio-collage";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "./studio-panel-ui";

import { cn } from "@/shared/lib/utils";

export interface StudioCollageApplyPayload {
  layout: StudioCollageLayoutPreset;
  canvasH: number;
  canvasBg: string;
  frames: StudioCollageFrameSeed[];
  groupId: string;
  imagePlacements: StudioCollageImagePlacement[];
  fit: StudioCollageFitMode;
  replaceExisting: boolean;
}

export interface StudioCollagePanelProps {
  canvasW: number;
  availableImages: readonly StudioCollageImageSource[];
  onApply: (payload: StudioCollageApplyPayload) => void;
  className?: string;
}

function CollagePreviewTile({
  layout,
  active,
}: {
  layout: StudioCollageLayoutPreset;
  active: boolean;
}): ReactElement {
  const rects = studioCollagePreviewRects(layout, 56, 56, 2, 3);
  return (
    <svg
      aria-hidden
      width={56}
      height={56}
      viewBox="0 0 56 56"
      className={cn("block rounded-md", active ? "text-on-accent" : "text-fg-2")}
    >
      <rect
        x={0.5}
        y={0.5}
        width={55}
        height={55}
        rx={6}
        fill={active ? "oklch(0.98 0.01 85 / 0.16)" : "oklch(0.22 0.01 66 / 0.55)"}
        stroke={active ? "oklch(0.98 0.01 85 / 0.25)" : "oklch(0.35 0.012 64 / 0.5)"}
        strokeWidth={0.8}
      />
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={1.5}
          fill={active ? "currentColor" : "oklch(0.55 0.04 42 / 0.55)"}
          opacity={active ? 0.9 : 0.85}
        />
      ))}
    </svg>
  );
}

export function StudioCollagePanel({
  canvasW,
  availableImages,
  onApply,
  className,
}: StudioCollagePanelProps): ReactElement {
  const [category, setCategory] = useState<StudioCollageCategory | "all">("all");
  const [selectedId, setSelectedId] = useState("c2x2");
  const [canvasH, setCanvasH] = useState(720);
  const [gap, setGap] = useState(DEFAULT_STUDIO_COLLAGE_OPTIONS.gap);
  const [padding, setPadding] = useState(DEFAULT_STUDIO_COLLAGE_OPTIONS.padding);
  const [borderWidth, setBorderWidth] = useState(0);
  const [cellBg, setCellBg] = useState("#f4efe6");
  const [canvasBg, setCanvasBg] = useState("#ffffff");
  const [borderColor, setBorderColor] = useState("#16100c");
  const [fit, setFit] = useState<StudioCollageFitMode>("cover");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [useCanvasImages, setUseCanvasImages] = useState(true);

  const layouts = listStudioCollageLayouts(category);
  const selected = layouts.find((l) => l.id === selectedId) ?? listStudioCollageLayouts("all").find((l) => l.id === selectedId) ?? listStudioCollageLayouts("all")[0]!;

  function handleApply() {
    // groupId is finalized in StudioPage (uid) so this handler stays pure for React Compiler.
    const { frames, groupId } = materializeStudioCollage(selected, {
      canvasW,
      canvasH,
      gap,
      padding,
      borderWidth,
      borderColor,
      cellBg,
    });
    const images = useCanvasImages ? availableImages.slice(0, selected.cells) : [];
    const imagePlacements = planStudioCollageImagePlacements(frames, images, fit);
    onApply({
      layout: selected,
      canvasH,
      canvasBg,
      frames,
      groupId,
      imagePlacements,
      fit,
      replaceExisting,
    });
  }

  return (
    <div className={cn("grid gap-2", className)} data-studio-collage-panel="true">
      <div className="flex items-start gap-2 rounded-lg border border-line bg-card px-2 py-1.5">
        <Grid2X2 size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <p className="text-[0.72rem] font-semibold text-fg">콜라주 레이아웃</p>
          <p className="text-[0.62rem] leading-snug text-fg-3">
            PicsArt·Canva급 다중 사진 그리드. 간격·여백·테두리·맞춤을 조절한 뒤 적용하세요.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="콜라주 카테고리">
        {STUDIO_COLLAGE_CATEGORY_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={category === chip.id}
            onClick={() => setCategory(chip.id)}
            className={cn(
              "min-h-8 rounded-full border px-2 text-[0.64rem] font-medium",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              category === chip.id
                ? "border-accent bg-accent text-on-accent"
                : "border-line bg-card text-fg-3 hover:bg-raised"
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div
        className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-4"
        role="listbox"
        aria-label="콜라주 레이아웃"
      >
        {layouts.map((layout) => {
          const active = layout.id === selected.id;
          return (
            <button
              key={layout.id}
              type="button"
              role="option"
              aria-selected={active}
              title={`${layout.label} · ${layout.hint} · ${layout.cells}칸`}
              onClick={() => setSelectedId(layout.id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-1.5",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent bg-accent text-on-accent shadow-[0_1px_6px_oklch(0.72_0.185_42/0.28)]"
                  : "border-line bg-card text-fg hover:border-accent/40 hover:bg-raised"
              )}
            >
              <CollagePreviewTile layout={layout} active={active} />
              <span className="w-full truncate text-center text-[0.58rem] font-semibold">
                {layout.label}
              </span>
              <span
                className={cn(
                  "text-[0.52rem] tabular-nums",
                  active ? "text-on-accent/80" : "text-fg-3"
                )}
              >
                {layout.cells}컷
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5 rounded-lg border border-line bg-card/80 p-2">
        <p className="text-[0.64rem] font-semibold text-fg-2">캔버스 비율</p>
        <div className="flex flex-wrap gap-1">
          {STUDIO_COLLAGE_CANVAS_H_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={canvasH === preset.height}
              onClick={() => setCanvasH(preset.height)}
              className={cn(
                "min-h-8 rounded-md border px-2 text-[0.62rem] font-medium",
                canvasH === preset.height
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-canvas text-fg-3 hover:bg-raised"
              )}
            >
              {preset.label}
              <span className="ml-1 tabular-nums opacity-70">{preset.height}</span>
            </button>
          ))}
        </div>

        <label className="grid gap-0.5 text-[0.62rem] text-fg-3">
          <span className="flex justify-between">
            <span>칸 간격</span>
            <span className="tabular-nums text-fg">{gap}px</span>
          </span>
          <input
            type="range"
            min={0}
            max={48}
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
            className="studio-range w-full"
            aria-label="콜라주 칸 간격"
          />
        </label>
        <label className="grid gap-0.5 text-[0.62rem] text-fg-3">
          <span className="flex justify-between">
            <span>바깥 여백</span>
            <span className="tabular-nums text-fg">{padding}px</span>
          </span>
          <input
            type="range"
            min={0}
            max={80}
            value={padding}
            onChange={(e) => setPadding(Number(e.target.value))}
            className="studio-range w-full"
            aria-label="콜라주 바깥 여백"
          />
        </label>
        <label className="grid gap-0.5 text-[0.62rem] text-fg-3">
          <span className="flex justify-between">
            <span>칸 테두리</span>
            <span className="tabular-nums text-fg">{borderWidth}px</span>
          </span>
          <input
            type="range"
            min={0}
            max={16}
            value={borderWidth}
            onChange={(e) => setBorderWidth(Number(e.target.value))}
            className="studio-range w-full"
            aria-label="콜라주 칸 테두리"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <label className="flex items-center gap-1 text-[0.62rem] text-fg-3">
            <span>칸 배경</span>
            <input
              type="color"
              value={cellBg}
              onChange={(e) => setCellBg(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent"
              aria-label="칸 배경색"
            />
          </label>
          <label className="flex items-center gap-1 text-[0.62rem] text-fg-3">
            <span>캔버스</span>
            <input
              type="color"
              value={canvasBg}
              onChange={(e) => setCanvasBg(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent"
              aria-label="캔버스 배경색"
            />
          </label>
          <label className="flex items-center gap-1 text-[0.62rem] text-fg-3">
            <span>테두리</span>
            <input
              type="color"
              value={borderColor}
              onChange={(e) => setBorderColor(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent"
              aria-label="테두리 색"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1 pt-0.5">
          <button
            type="button"
            aria-pressed={fit === "cover"}
            onClick={() => setFit("cover")}
            className={cn(
              "min-h-8 rounded-md border px-2 text-[0.62rem] font-medium",
              fit === "cover"
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-fg-3 hover:bg-raised"
            )}
          >
            채우기 (cover)
          </button>
          <button
            type="button"
            aria-pressed={fit === "contain"}
            onClick={() => setFit("contain")}
            className={cn(
              "min-h-8 rounded-md border px-2 text-[0.62rem] font-medium",
              fit === "contain"
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-fg-3 hover:bg-raised"
            )}
          >
            안에 맞춤
          </button>
        </div>

        <label className="flex items-center gap-2 text-[0.64rem] text-fg-2">
          <input
            type="checkbox"
            checked={useCanvasImages}
            onChange={(e) => setUseCanvasImages(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          <Images size={12} aria-hidden />
          캔버스 이미지 {Math.min(availableImages.length, selected.cells)}/
          {selected.cells}장 자동 배치
        </label>
        <label className="flex items-center gap-2 text-[0.64rem] text-fg-2">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          기존 작업 지우고 적용
        </label>
      </div>

      <button
        type="button"
        onClick={handleApply}
        className={cn(
          "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-accent bg-accent text-sm font-bold text-on-accent",
          STUDIO_EASE,
          STUDIO_FOCUS_RING,
          "hover:bg-accent-2"
        )}
      >
        <Grid2X2 size={15} aria-hidden />
        {selected.label} 적용 · {selected.cells}칸
      </button>
    </div>
  );
}
