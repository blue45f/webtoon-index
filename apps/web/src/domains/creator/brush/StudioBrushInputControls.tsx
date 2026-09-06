import { StudioPressureCurveGraph } from "../StudioPressureCurveGraph";

import { cx } from "@/shared/lib/cx";

export interface StudioBrushInputControlsProps {
  useVelocityPressure: boolean;
  onUseVelocityPressureChange: (value: boolean) => void;
  velocitySensitivity: number;
  onVelocitySensitivityChange: (value: number) => void;
  pressureCurve: number;
  onPressureCurveChange: (value: number) => void;
  pressureMinSize?: number;
  onPressureMinSizeChange?: (value: number) => void;
  density?: "compact" | "touch";
}
export function StudioBrushInputControls({
  useVelocityPressure,
  onUseVelocityPressureChange,
  velocitySensitivity,
  onVelocitySensitivityChange,
  pressureCurve,
  onPressureCurveChange,
  pressureMinSize = 0,
  onPressureMinSizeChange,
  density = "compact",
}: StudioBrushInputControlsProps) {
  const touch = density === "touch";

  return (
    <section
      aria-label="필압 입력"
      className={cx("border-t border-line/35", touch ? "mt-2.5 space-y-2.5 pt-2.5" : "space-y-2 pt-2")}
    >
      <label
        className={cx(
          "flex cursor-pointer items-center justify-between gap-3 text-fg-2",
          touch ? "min-h-11 rounded-lg bg-card/45 px-2.5 text-xs" : "text-sm"
        )}
      >
        <span>
          <span className="block font-medium">마우스·터치 속도 필압</span>
          {touch ? (
            <span className="block text-[0.62rem] leading-relaxed text-fg-3">
              스타일러스 필압이 없을 때 CSS 화면 속도로 굵기를 보완
            </span>
          ) : null}
        </span>
        <input
          type="checkbox"
          checked={useVelocityPressure}
          onChange={(event) => onUseVelocityPressureChange(event.target.checked)}
          className={cx("shrink-0 rounded accent-accent", touch ? "size-5" : "size-4")}
        />
      </label>

      {useVelocityPressure ? (
        <label className={cx("flex items-center justify-between gap-2 text-fg-3", touch ? "text-[0.7rem]" : "text-xs")}>
          <span>속도 감도</span>
          <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={velocitySensitivity}
              onChange={(event) => onVelocitySensitivityChange(Number(event.target.value))}
              aria-label="마우스와 터치 속도 필압 감도"
              className={cx("cursor-pointer accent-accent", touch ? "h-10 w-full max-w-52" : "w-20")}
            />
            <span className="w-9 text-right tabular-nums">{Math.round(velocitySensitivity * 100)}%</span>
          </span>
        </label>
      ) : null}

      <StudioPressureCurveGraph
        pressureCurve={pressureCurve}
        onPressureCurveChange={onPressureCurveChange}
        pressureMinSize={pressureMinSize}
        density={density}
      />

      <div className={cx("space-y-1.5", touch ? "pt-0.5" : "")}>
        <label className={cx("flex items-center justify-between gap-2 text-fg-3", touch ? "text-[0.7rem]" : "text-xs")}>
          <span className="font-medium text-fg-2">최소 굵기</span>
          <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={pressureMinSize}
              onChange={(event) => onPressureMinSizeChange?.(Number(event.target.value))}
              aria-label="필압 최소 굵기 비율"
              className={cx("cursor-pointer accent-accent", touch ? "h-10 w-full max-w-52" : "w-24")}
            />
            <span className="w-9 text-right tabular-nums">{Math.round(pressureMinSize * 100)}%</span>
          </span>
        </label>
        <p className={cx("leading-relaxed text-fg-3", touch ? "text-[0.62rem]" : "text-[0.65rem]")}>
          필압 0에서도 남는 굵기 비율입니다. 0%면 아주 약한 필압은 거의 안 그려지고, CSP의 Size Min과 같은 역할입니다.
        </p>
        <div className="flex flex-wrap gap-1">
          {[0, 0.1, 0.25, 0.5].map((value) => (
            <button
              key={value}
              type="button"
              className={cx(
                "rounded-md border px-2 py-1 text-[0.65rem] tabular-nums transition-colors",
                Math.abs(pressureMinSize - value) < 0.001
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line bg-card/50 text-fg-3 hover:bg-card"
              )}
              onClick={() => onPressureMinSizeChange?.(value)}
            >
              {Math.round(value * 100)}%
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
