import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import {
  recommendStudioPressureCurveExponent,
  studioPressureCalibrationStats,
  studioPressureCurveMap,
  studioPressurePreviewDiameter,
} from "./studio-pressure-curve-graph";

import { cn } from "@/shared/lib/utils";

const TEST_W = 320;
const TEST_H = 78;
const TEST_POINT_LIMIT = 180;

interface StudioPressureTestPoint {
  readonly x: number;
  readonly y: number;
  readonly rawPressure: number;
}

type CoalescedPointerEvent = PointerEvent & {
  getCoalescedEvents?: () => readonly PointerEvent[];
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pressurePercent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function safeCoalescedPointerEvents(event: PointerEvent): readonly PointerEvent[] {
  const method = (event as CoalescedPointerEvent).getCoalescedEvents;
  if (typeof method !== "function") return [event];
  try {
    const samples = method.call(event);
    return samples.length > 0 ? samples : [event];
  } catch {
    // Safari versions and embedded webviews can expose a method that still throws.
    return [event];
  }
}

function normalizedReportedPressure(event: PointerEvent): number {
  const reportedPressure = Number.isFinite(event.pressure) ? event.pressure : 0;
  if (reportedPressure > 0) return clamp(reportedPressure, 0, 1);
  // Mouse PointerEvents commonly expose a fixed 0.5 while pressed. Keeping that value makes the
  // scratch pad usable but the calibration recommendation rejects its near-zero dynamic range.
  if (event.pointerType === "mouse" || event.pointerType === "touch") return 0.5;
  // A zero pen sample stays zero so release/contact sentinels cannot bias the recommendation.
  return 0;
}

function normalizedTestPoint(
  event: PointerEvent,
  rect: DOMRect
): StudioPressureTestPoint | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const x = clamp(((event.clientX - rect.left) / rect.width) * TEST_W, 0, TEST_W);
  const y = clamp(((event.clientY - rect.top) / rect.height) * TEST_H, 0, TEST_H);
  return { x, y, rawPressure: normalizedReportedPressure(event) };
}

export interface StudioPressureCalibrationPanelProps {
  readonly pressureCurve: number;
  readonly onPressureCurveChange: (value: number) => void;
  readonly pressureMinSize: number;
  readonly density: "compact" | "touch";
}

export function StudioPressureCalibrationPanel({
  pressureCurve,
  onPressureCurveChange,
  pressureMinSize,
  density,
}: StudioPressureCalibrationPanelProps): ReactElement {
  const touch = density === "touch";
  const testPointerIdRef = useRef<number | null>(null);
  const [testPoints, setTestPoints] = useState<readonly StudioPressureTestPoint[]>([]);
  const rawSamples = useMemo(
    () => testPoints.map((point) => point.rawPressure),
    [testPoints]
  );
  const stats = useMemo(() => studioPressureCalibrationStats(rawSamples), [rawSamples]);
  const recommendation = useMemo(
    () => recommendStudioPressureCurveExponent(rawSamples),
    [rawSamples]
  );
  const latestPoint = testPoints.at(-1) ?? null;
  const latestRaw = latestPoint?.rawPressure ?? 0;
  const latestMapped = studioPressureCurveMap(latestRaw, pressureCurve);

  const appendTestPoints = (
    event: ReactPointerEvent<SVGSVGElement>,
    replace: boolean
  ): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const samples = safeCoalescedPointerEvents(event.nativeEvent)
      .map((sample) => normalizedTestPoint(sample, rect))
      .filter((sample): sample is StudioPressureTestPoint => sample !== null);
    if (samples.length === 0) return;
    setTestPoints((current) => {
      const next = replace ? samples : [...current, ...samples];
      return next.length > TEST_POINT_LIMIT
        ? next.slice(next.length - TEST_POINT_LIMIT)
        : next;
    });
  };

  const onTestPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 && event.button !== -1) return;
    event.preventDefault();
    testPointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The global pointer stream remains a safe fallback.
    }
    appendTestPoints(event, true);
  };

  const onTestPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (testPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    appendTestPoints(event, false);
  };

  const finishTestPointer = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (testPointerIdRef.current !== event.pointerId) return;
    testPointerIdRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  };

  const cancelTestPointer = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (testPointerIdRef.current !== event.pointerId) return;
    testPointerIdRef.current = null;
  };

  return (
    <details
      data-studio-pressure-calibration="true"
      className="group mt-2.5 rounded-lg border border-line/55 bg-canvas/45 p-2"
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2 rounded-md text-[0.62rem] font-bold text-fg-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden",
          touch ? "min-h-11" : "min-h-9"
        )}
      >
        <span>필압 테스트 · 자동 보정</span>
        <span className="text-[0.54rem] font-semibold text-fg-3 group-open:hidden">
          실제 펜 입력으로 열기
        </span>
        <span className="hidden text-[0.54rem] font-semibold text-fg-3 group-open:inline">
          접기
        </span>
      </summary>

      <div className="mt-2 border-t border-line/45 pt-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[0.62rem] font-bold text-fg-2">
            실시간 필압 테스트
          </span>
          <span className="tabular-nums text-[0.56rem] font-semibold text-fg-3">
            입력 {pressurePercent(latestRaw)} → 출력 {pressurePercent(latestMapped)}
          </span>
        </div>

        <svg
          role="group"
          aria-label="필압 시험선 입력 영역"
          viewBox={`0 0 ${TEST_W} ${TEST_H}`}
          data-studio-pressure-test-pad="true"
          className={cn(
            "block w-full touch-none select-none rounded-md border border-line/45 bg-card/60",
            touch ? "h-24" : "h-20"
          )}
          onPointerDown={onTestPointerDown}
          onPointerMove={onTestPointerMove}
          onPointerUp={finishTestPointer}
          onPointerCancel={cancelTestPointer}
        >
          <path
            d={`M0 ${TEST_H / 2} H${TEST_W}`}
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeDasharray="4 4"
            aria-hidden="true"
          />
          {testPoints.length === 0 ? (
            <text
              x={TEST_W / 2}
              y={TEST_H / 2 + 3}
              textAnchor="middle"
              fill="currentColor"
              className="text-fg-3 text-[10px]"
              aria-hidden="true"
            >
              펜을 약하게→강하게 눌러 시험선을 그리세요
            </text>
          ) : null}
          <g className="text-accent" aria-hidden="true">
            {testPoints.slice(1).map((point, index) => {
              const previous = testPoints[index] ?? point;
              const averagePressure = (previous.rawPressure + point.rawPressure) / 2;
              return (
                <line
                  key={`${index}-${point.x.toFixed(2)}-${point.y.toFixed(2)}`}
                  x1={previous.x}
                  y1={previous.y}
                  x2={point.x}
                  y2={point.y}
                  stroke="currentColor"
                  strokeWidth={studioPressurePreviewDiameter(
                    averagePressure,
                    pressureCurve,
                    pressureMinSize,
                    18
                  )}
                  strokeOpacity={
                    0.45 +
                    studioPressureCurveMap(point.rawPressure, pressureCurve) * 0.55
                  }
                  strokeLinecap="round"
                />
              );
            })}
            {testPoints.length === 1 ? (
              <circle
                cx={testPoints[0]?.x}
                cy={testPoints[0]?.y}
                r={
                  studioPressurePreviewDiameter(
                    testPoints[0]?.rawPressure ?? 0.5,
                    pressureCurve,
                    pressureMinSize,
                    18
                  ) / 2
                }
                fill="currentColor"
              />
            ) : null}
          </g>
        </svg>

        <div
          className="mt-1.5 grid grid-cols-2 gap-1.5"
          aria-label="현재 필압 입출력"
        >
          <div>
            <div className="mb-0.5 flex justify-between text-[0.54rem] text-fg-3">
              <span>원시 입력</span>
              <span>{pressurePercent(latestRaw)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-fg-3/55"
                style={{ width: pressurePercent(latestRaw) }}
              />
            </div>
          </div>
          <div>
            <div className="mb-0.5 flex justify-between text-[0.54rem] text-fg-3">
              <span>적용 출력</span>
              <span>{pressurePercent(latestMapped)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: pressurePercent(latestMapped) }}
              />
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
          <p
            className="min-w-0 flex-1 text-[0.56rem] leading-relaxed text-fg-3"
            aria-live="polite"
          >
            {stats
              ? `입력 샘플 ${stats.sampleCount}개 · 범위 ${pressurePercent(stats.minimum)}–${pressurePercent(stats.maximum)} · 중앙 ${pressurePercent(stats.median)} · P90 ${pressurePercent(stats.p90)}`
              : "입력 샘플 없음 · 다양한 압력으로 한 번에 그리면 자동 보정할 수 있습니다."}
          </p>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setTestPoints([])}
              disabled={testPoints.length === 0}
              className={cn(
                "rounded-md border border-line/70 px-2 text-[0.58rem] font-semibold text-fg-3 disabled:cursor-not-allowed disabled:opacity-40",
                touch ? "min-h-11" : "min-h-8"
              )}
            >
              지우기
            </button>
            <button
              type="button"
              onClick={() => {
                if (recommendation !== null) onPressureCurveChange(recommendation);
              }}
              disabled={recommendation === null}
              title={
                recommendation === null
                  ? "서로 다른 압력의 유효 샘플이 8개 이상 필요합니다"
                  : `권장 감마 ${recommendation.toFixed(2)} 적용`
              }
              className={cn(
                "rounded-md border border-accent/45 bg-accent-soft px-2 text-[0.58rem] font-bold text-accent disabled:cursor-not-allowed disabled:opacity-40",
                touch ? "min-h-11" : "min-h-8"
              )}
            >
              자동 보정
              {recommendation === null ? "" : ` γ${recommendation.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
