/**
 * Commercial pressure response graph — direct curve manipulation plus a live calibration pad.
 * Existing documents still persist one scalar exponent; this wrapper keeps that public contract
 * while the editor and stylus sampling panel evolve independently.
 */

import { StudioPressureCalibrationPanel } from "./StudioPressureCalibrationPanel";
import { StudioPressureCurveEditor } from "./StudioPressureCurveEditor";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioPressureCurveGraphProps {
  pressureCurve: number;
  onPressureCurveChange: (value: number) => void;
  pressureMinSize?: number;
  className?: string;
  density?: "compact" | "touch";
}

export function StudioPressureCurveGraph({
  pressureCurve,
  onPressureCurveChange,
  pressureMinSize = 0,
  className,
  density = "compact",
}: StudioPressureCurveGraphProps): ReactElement {
  return (
    <div
      data-studio-pressure-curve-graph="true"
      className={cn(
        "rounded-xl border border-line/70 bg-card/50 p-2.5",
        className
      )}
    >
      <StudioPressureCurveEditor
        pressureCurve={pressureCurve}
        onPressureCurveChange={onPressureCurveChange}
        density={density}
      />
      <StudioPressureCalibrationPanel
        pressureCurve={pressureCurve}
        onPressureCurveChange={onPressureCurveChange}
        pressureMinSize={pressureMinSize}
        density={density}
      />
      <p className="mt-1.5 text-[0.58rem] leading-relaxed text-fg-3">
        가로=입력 필압 · 세로=획 굵기/농도. 시험선은 실제 작품에 기록되지 않으며 현재 설정만 미리 봅니다.
      </p>
    </div>
  );
}
