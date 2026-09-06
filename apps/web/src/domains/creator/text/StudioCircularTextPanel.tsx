/**
 * StudioCircularTextPanel.tsx
 *
 * CLIP STUDIO PAINT Ver.3.0 Parity:
 * - Circular Text Arrangement (원형 텍스트 배치):
 *   - Places sound effects (SFX), magic incantations, titles, or logo stamps along a circular arc.
 *   - Interactive controls:
 *     - Circular Layout Toggle (On/Off)
 *     - Arc Radius (반경)
 *     - Start Angle (시작 각도)
 *     - Flow Direction (시계방향 / 반시계방향)
 *     - Glyph Orientation (바깥쪽 / 안쪽)
 *     - Letter Spacing (자간 조정)
 *   - Real-time SVG preview of glyph arc positions and rotations.
 */

import { Compass } from "lucide-react";
import { useMemo } from "react";

import {
  layoutCircularText,
  type CircularTextOptions,
  type CircularTextResult,
} from "./studio-circular-text";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioCircularTextPanelProps {
  readonly text: string;
  readonly enabled: boolean;
  readonly options: CircularTextOptions;
  readonly onToggleEnabled: (enabled: boolean) => void;
  readonly onOptionsChange: (options: CircularTextOptions) => void;
  readonly className?: string;
}

export function StudioCircularTextPanel({
  text,
  enabled,
  options,
  onToggleEnabled,
  onOptionsChange,
  className,
}: StudioCircularTextPanelProps) {
  const layout = useMemo<CircularTextResult>(() => {
    if (!text || !enabled) {
      return Object.freeze({ glyphs: Object.freeze([]), totalSpanDeg: 0 });
    }
    return layoutCircularText(text, options);
  }, [text, enabled, options]);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-3 text-xs bg-slate-900/90 text-slate-100 rounded-lg border border-slate-800 shadow-xl",
        className,
      )}
      data-testid="studio-circular-text-panel"
    >
      {/* Header with toggle */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Compass size={15} className="text-pink-400" />
          <span>원형 텍스트 (Circular Text)</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 font-medium">
            CSP 3.0
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggleEnabled(!enabled)}
          // 고급 조판 디스클로저 안에서만 보이므로 advanced. 선언이 없는 상호작용 요소는
          // 밀도 감사가 unclassified-control 로 보고한다.
          data-inspector-control-id="typography.circular.enabled"
          data-inspector-priority="advanced"
          className={buttonClass({
            size: "sm",
            variant: enabled ? "solid" : "outline",
            className: cn(
              "h-6 px-2 text-[11px] font-medium transition-colors",
              enabled
                ? "bg-pink-600 hover:bg-pink-500 text-white"
                : "border-slate-700 text-slate-400 hover:text-slate-200",
            ),
          })}
        >
          {enabled ? "원형 배치 On" : "원형 배치 Off"}
        </button>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        효과음, 마법진 영창, 엠블럼 식자를 원형 호를 따라 자연스러운 회전 각도로
        배치합니다.
      </p>

      {enabled && (
        <>
          {/* Real-time SVG preview */}
          <div className="flex flex-col items-center justify-center p-2 bg-slate-950/60 rounded border border-slate-800 relative overflow-hidden h-36">
            <svg
              viewBox="0 0 200 200"
              className="w-32 h-32 text-pink-300 overflow-visible"
            >
              {/* Circle guideline */}
              <circle
                cx="100"
                cy="100"
                r={Math.min(80, Math.max(20, options.radius / 2))}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.2}
                strokeDasharray="3 3"
              />
              <circle
                cx="100"
                cy="100"
                r={2}
                fill="currentColor"
                fillOpacity={0.4}
              />
              {/* Glyphs */}
              {layout.glyphs.map((g) => {
                // normalize coordinates to 200x200 viewBox
                const nx =
                  100 +
                  ((g.x - options.centerX) / Math.max(1, options.radius)) *
                    Math.min(80, Math.max(20, options.radius / 2));
                const ny =
                  100 +
                  ((g.y - options.centerY) / Math.max(1, options.radius)) *
                    Math.min(80, Math.max(20, options.radius / 2));

                return (
                  <text
                    key={g.index}
                    x={nx}
                    y={ny}
                    transform={`rotate(${g.rotationDeg}, ${nx}, ${ny})`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="currentColor"
                    fontSize="13"
                    fontWeight="bold"
                  >
                    {g.char}
                  </text>
                );
              })}
            </svg>
            <div className="absolute bottom-1 right-2 text-[10px] text-slate-500">
              총 전개각: {Math.round(layout.totalSpanDeg)}°
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-2.5 pt-1">
            {/* Radius slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">원형 반경 (Radius)</span>
                <span className="font-semibold text-slate-200">
                  {Math.round(options.radius)}px
                </span>
              </div>
              <input
                type="range"
                min={30}
                max={300}
                step={2}
                value={options.radius}
                onChange={(e) =>
                  onOptionsChange({
                    ...options,
                    radius: Number(e.target.value),
                  })
                }
                data-inspector-control-id="typography.circular.radius"
                data-inspector-priority="advanced"
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-400"
              />
            </div>

            {/* Start Angle slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">시작 각도 (Start Angle)</span>
                <span className="font-semibold text-slate-200">
                  {Math.round(options.startAngleDeg ?? -90)}°
                </span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={5}
                value={options.startAngleDeg ?? -90}
                onChange={(e) =>
                  onOptionsChange({
                    ...options,
                    startAngleDeg: Number(e.target.value),
                  })
                }
                data-inspector-control-id="typography.circular.start-angle"
                data-inspector-priority="advanced"
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-400"
              />
            </div>

            {/* Direction toggle */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-400 text-[11px]">진행 방향</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() =>
                    onOptionsChange({ ...options, direction: "clockwise" })
                  }
                  data-inspector-control-id="typography.circular.direction.clockwise"
                  data-inspector-priority="advanced"
                  className={buttonClass({
                    size: "sm",
                    variant:
                      (options.direction ?? "clockwise") === "clockwise"
                        ? "solid"
                        : "ghost",
                    className: cn(
                      "h-6 px-2 text-[10px]",
                      (options.direction ?? "clockwise") === "clockwise"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400",
                    ),
                  })}
                >
                  시계방향
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOptionsChange({
                      ...options,
                      direction: "counter-clockwise",
                    })
                  }
                  data-inspector-control-id="typography.circular.direction.counter-clockwise"
                  data-inspector-priority="advanced"
                  className={buttonClass({
                    size: "sm",
                    variant:
                      options.direction === "counter-clockwise"
                        ? "solid"
                        : "ghost",
                    className: cn(
                      "h-6 px-2 text-[10px]",
                      options.direction === "counter-clockwise"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400",
                    ),
                  })}
                >
                  반시계방향
                </button>
              </div>
            </div>

            {/* Orientation toggle */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-400 text-[11px]">글자 방향</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() =>
                    onOptionsChange({ ...options, orientation: "outward" })
                  }
                  data-inspector-control-id="typography.circular.orientation.outward"
                  data-inspector-priority="advanced"
                  className={buttonClass({
                    size: "sm",
                    variant:
                      (options.orientation ?? "outward") === "outward"
                        ? "solid"
                        : "ghost",
                    className: cn(
                      "h-6 px-2 text-[10px]",
                      (options.orientation ?? "outward") === "outward"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400",
                    ),
                  })}
                >
                  바깥쪽
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOptionsChange({ ...options, orientation: "inward" })
                  }
                  data-inspector-control-id="typography.circular.orientation.inward"
                  data-inspector-priority="advanced"
                  className={buttonClass({
                    size: "sm",
                    variant:
                      options.orientation === "inward" ? "solid" : "ghost",
                    className: cn(
                      "h-6 px-2 text-[10px]",
                      options.orientation === "inward"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400",
                    ),
                  })}
                >
                  안쪽
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
