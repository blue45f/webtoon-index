import { Eraser, Grid3X3, Pencil, Shapes } from "lucide-react";

import type { DrawMode, DrawShapeKind } from "./studio-editor-tool-model";

import { cn } from "@/shared/lib/utils";

type InspectorDrawMode = Exclude<DrawMode, "lasso-fill">;
type InspectorSymmetryMode = "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope";

interface StudioInspectorDrawModeControlsProps {
  drawMode: DrawMode;
  onDrawModeChange: (mode: InspectorDrawMode) => void;
  onDrawShapeChange: (shape: DrawShapeKind) => void;
  onStrokeWidthChange: (width: number) => void;
  onSymmetryChange: (mode: InspectorSymmetryMode) => void;
}

const DRAW_MODES = [
  { label: "펜", value: "pen" as const, Icon: Pencil },
  { label: "픽셀 펜", value: "pixel" as const, Icon: Grid3X3 },
  { label: "지우개", value: "eraser" as const, Icon: Eraser },
  { label: "도형", value: "shape" as const, Icon: Shapes },
] as const;

const PIXEL_TRAITS = [
  ["1 PX", "한 칸 단위"],
  ["HARD", "단단한 가장자리"],
  ["RAW", "필압·보정 없음"],
] as const;

export function StudioInspectorDrawModeControls({
  drawMode,
  onDrawModeChange,
  onDrawShapeChange,
  onStrokeWidthChange,
  onSymmetryChange,
}: StudioInspectorDrawModeControlsProps) {
  return (
    <div data-testid="studio-inspector-context-drawing" className="contents">
      <p className="text-xs font-semibold text-fg-3">그리기 도구 설정</p>
      <div
        className="flex gap-1 rounded-lg border border-line bg-card p-0.5"
        role="group"
        aria-label="그리기 모드"
        data-testid="studio-inspector-draw-mode"
      >
        {DRAW_MODES.map(({ label, value, Icon }) => (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={drawMode === value}
            onClick={() => {
              if (drawMode === value) return;
              onDrawModeChange(value);
              if (value === "pixel") {
                onStrokeWidthChange(1);
                onSymmetryChange("none");
              } else if (value === "shape") {
                onDrawShapeChange("line");
              }
            }}
            className={cn(
              "grid min-h-11 flex-1 place-items-center rounded-md transition-colors lg:min-h-9",
              drawMode === value
                ? "bg-accent text-on-accent"
                : "text-fg-2 hover:bg-raised"
            )}
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
          </button>
        ))}
      </div>

      {drawMode === "pixel" ? (
        <section
          aria-label="픽셀 펜 특성"
          data-studio-pixel-pen-identity="true"
          className="rounded-xl border border-accent/35 bg-accent-soft/20 p-2.5"
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-on-accent"
            >
              <Grid3X3 size={17} strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-fg">픽셀 펜</span>
              <span className="block text-[0.62rem] leading-relaxed text-fg-2">
                안티앨리어싱 없는 원본 픽셀을 정확히 찍어요.
              </span>
            </span>
            <span className="shrink-0 rounded-md border border-accent/35 bg-card px-1.5 py-1 text-[0.58rem] font-bold tabular-nums text-accent">
              1px 고정
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1" aria-label="픽셀 펜 고정 특성">
            {PIXEL_TRAITS.map(([label, description]) => (
              <span
                key={label}
                title={description}
                className="rounded-md border border-line/70 bg-card px-1.5 py-0.5 text-[0.56rem] font-bold tracking-[0.08em] text-fg-2"
              >
                {label}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[0.62rem] leading-relaxed text-fg-3">
            필압, 스탬프, 선 보정, 대칭은 적용하지 않습니다. 색상과 불투명도만 조절할 수 있어요.
          </p>
        </section>
      ) : null}
    </div>
  );
}
