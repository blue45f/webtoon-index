/**
 * Studio Curve Panel
 * 인터랙티브 SVG 톤 커브 에디터 — 채널 세그먼트(RGB/R/G/B) + 프리셋 칩 + 드래그 가능한 제어점.
 * studio-curves 엔진의 CurvePoint[](마스터)와 CurveRgbChannels(r/g/b)를 props로 읽고
 * onChange/onChannelsChange/onReset으로만 쓴다. onChannelsChange가 없으면 채널 UI를 숨긴다(하위호환).
 * 로컬 상태는 드래그/선택 중인 점과 편집 채널, 좌표 입력 draft뿐이며 실제 곡선은 부모가 소유한다.
 * 포인터 계약은 포토샵·클립스튜디오와 같다 — 점 위 누르기=잡기, 빈 곳 누르기=그 자리에 점 추가 후
 * 같은 제스처로 드래그 계속, 중간점 더블클릭=삭제.
 * 좌표 변환은 svgRef의 getBoundingClientRect로 CSS 스케일을 보정한다(브라우저 전용, 테스트 대상 아님).
 * histogramSource(선택 이미지 디코드 픽셀)가 주어지면 커브 위에 히스토그램을 그린다 —
 * 없으면 기존과 완전히 동일하게 렌더된다(하위호환).
 */
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  addCurvePoint,
  CURVE_PRESETS,
  isIdentityCurve,
  isIdentityCurveChannels,
  moveCurvePoint,
  normalizeCurve,
  normalizeCurveChannels,
  removeCurvePoint,
  STUDIO_CURVE_MAX_CONTROL_POINTS,
  TONE_CHANNELS,
  type CurvePoint,
  type CurveRgbChannels,
  type ToneChannel,
} from "./studio-curves";
import { StudioToggleChip } from "./studio-panel-ui";
import { StudioHistogramSection } from "./StudioHistogramGraph";

import type { StudioImageDataLike } from "./studio-filters";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

// SVG 기하 — 정사각 플롯. PAD만큼 안쪽 여백을 두고 150x150 영역에 0..255 도메인을 매핑한다.
const SIZE = 170;
const PAD = 10;
const PLOT = SIZE - 2 * PAD; // 150
const AXIS_MAX = 255;
// 더블클릭 히트테스트 반경(SVG 단위) — 이 안에 점이 있으면 "점 위", 없으면 "빈 영역"으로 본다.
const HIT_RADIUS = 10;
// SVG는 최소 170px로 렌더링된다. 44 SVG 단위 정사각 목표는 최소 44 CSS px이며,
// 끝점에서는 목표 원점을 안쪽으로 보정해 viewBox에 잘리지 않도록 한다.
const POINT_HIT_SIZE = 44;
const KEYBOARD_STEP = 1;
const KEYBOARD_LARGE_STEP = 10;
// 같은 더블클릭 제스처인지 판정하는 창. pointerdown의 detail은 Chromium에서 항상 0이라 클릭 횟수로
// 쓸 수 없으므로, 브라우저 더블클릭 간격(대개 500ms 이하)보다 조금 넉넉한 시간으로 가른다.
const SAME_GESTURE_MS = 700;

// 프리셋 칩 — StudioLevelsPanel과 동일 idiom(활성 시 accent 보더 + raised 배경).
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// 채널별 곡선/핸들 색 — 마스터는 accent, R/G/B는 각 채널을 상징하는 색으로 그린다(포토샵과 동일 관례).
const CHANNEL_COLORS: Record<ToneChannel, { stroke: string; fill: string }> = {
  master: { stroke: "stroke-accent", fill: "fill-accent" },
  r: { stroke: "stroke-red-400", fill: "fill-red-400" },
  g: { stroke: "stroke-emerald-400", fill: "fill-emerald-400" },
  b: { stroke: "stroke-sky-400", fill: "fill-sky-400" },
};

/** 0..255로 반올림·클램프(엔진과 동일 규칙 — 화면 좌표 역변환 시 사용). */
function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > AXIS_MAX) return AXIS_MAX;
  return Math.round(value);
}

// 커브 도메인(0..255) → SVG 좌표. y는 위가 밝은 출력이 되도록 뒤집는다.
function toSvgX(x: number): number {
  return PAD + (x / AXIS_MAX) * PLOT;
}
function toSvgY(y: number): number {
  return PAD + (1 - y / AXIS_MAX) * PLOT;
}

function hitTargetOrigin(coordinate: number): number {
  return Math.min(SIZE - POINT_HIT_SIZE, Math.max(0, coordinate - POINT_HIT_SIZE / 2));
}

/** 점 배열 → SVG polyline 좌표 문자열. */
function toPolyPoints(points: CurvePoint[]): string {
  return points.map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(" ");
}

/** 가장 넓은 구간의 선형 보간 중간점. 엔진의 동일-x 허용 오차를 피해 점을 추가할 수 없으면 null. */
function suggestedCurvePoint(points: CurvePoint[]): CurvePoint | null {
  const normalized = normalizeCurve(points);
  if (normalized.length >= STUDIO_CURVE_MAX_CONTROL_POINTS) return null;
  let best: { left: CurvePoint; right: CurvePoint; gap: number } | null = null;
  for (let index = 0; index < normalized.length - 1; index++) {
    const left = normalized[index]!;
    const right = normalized[index + 1]!;
    const gap = right.x - left.x;
    if (!best || gap > best.gap) best = { left, right, gap };
  }
  if (!best || best.gap <= 4) return null;
  const x = Math.round((best.left.x + best.right.x) / 2);
  const progress = (x - best.left.x) / best.gap;
  const y = Math.round(best.left.y + (best.right.y - best.left.y) * progress);
  return { x, y };
}

function nearestCurvePointIndex(points: CurvePoint[], x: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.abs(point.x - x);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function CurveCoordinateInput({
  axis,
  value,
  readOnly = false,
  describedBy,
  onCommit,
}: {
  axis: "X" | "Y";
  value: number;
  readOnly?: boolean;
  describedBy?: string;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(String(value));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(String(value));
  }, [value]);

  const commitDraft = (): void => {
    editingRef.current = false;
    const normalized = draft.trim();
    const parsed = normalized === "" ? Number.NaN : Number(normalized);
    const committed = Number.isFinite(parsed) ? clampAxis(parsed) : value;
    setDraft(String(committed));
    if (!readOnly && committed !== value) onCommit(committed);
  };

  return (
    <label className="grid min-h-11 grid-cols-[1.25rem_minmax(0,1fr)] items-center rounded-xl border border-line bg-card px-2 focus-within:border-accent">
      <span className="text-[0.65rem] font-bold text-fg-3">{axis}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        readOnly={readOnly}
        aria-label={`선택한 제어점 ${axis} 좌표`}
        aria-describedby={describedBy}
        onFocus={() => {
          editingRef.current = !readOnly;
        }}
        onChange={(event) => {
          if (!readOnly && /^\d{0,3}$/.test(event.target.value)) setDraft(event.target.value);
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "h-full min-w-0 bg-transparent text-right text-xs font-semibold tabular-nums text-fg outline-none",
          readOnly && "cursor-not-allowed text-fg-4",
        )}
      />
    </label>
  );
}

export function StudioCurvePanel({
  points,
  channels,
  histogramSource,
  onChange,
  onChannelsChange,
  onReset,
}: {
  points: CurvePoint[];
  /** r/g/b 개별 채널 곡선(마스터는 points). 미지정이면 전 채널 항등으로 본다. */
  channels?: CurveRgbChannels;
  /**
   * 선택 이미지의 디코드 픽셀 — 지정된 경우에만 커브 위에 히스토그램을 그린다
   * (마스터=휘도, r/g/b=해당 채널 분포). 미지정/null이면 기존 렌더와 동일.
   */
  histogramSource?: StudioImageDataLike | null;
  onChange: (points: CurvePoint[]) => void;
  /** 채널 곡선 변경 콜백 — 지정된 경우에만 채널 세그먼트 UI를 노출한다. */
  onChannelsChange?: (channels: CurveRgbChannels) => void;
  onReset: () => void;
}): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointHitRefs = useRef<Array<SVGRectElement | null>>([]);
  // 방금 pointerdown이 새로 만든 점의 시각. 같은 제스처의 dblclick이 그 점을 곧바로 되지우지 않게
  // 해, "빈 곳 더블클릭 = 점 추가"라는 기존 계약을 그대로 남긴다.
  const pointerAddedAtRef = useRef<number | null>(null);
  // 실제 곡선은 부모가 소유하고, 여기서는 드래그/선택 인덱스와 편집 채널만 추적한다.
  const [drag, setDrag] = useState<number | null>(null);
  const [channel, setChannel] = useState<ToneChannel>("master");
  const [selectedPointIndex, setSelectedPointIndex] = useState(0);
  const instructionsId = useId();
  const endpointHintId = useId();

  // 채널 편집은 onChannelsChange가 있어야 켜진다(없으면 기존 마스터 전용 동작).
  const channelEditable = typeof onChannelsChange === "function";
  const activeChannel: ToneChannel = channelEditable ? channel : "master";

  // 안전장치 — 외부 입력이 비정상이어도 항상 정규화본으로 그린다(끝점 0/255, x 오름차순).
  const master = normalizeCurve(points);
  const channelCurves = normalizeCurveChannels(channels);
  // 채널별 항등 여부 — 세그먼트 칩의 "조정됨" 점 표시·프리셋 활성·리셋 버튼 활성화에 쓴다.
  const identityByChannel: Record<ToneChannel, boolean> = {
    master: isIdentityCurve(master),
    r: isIdentityCurve(channelCurves.r),
    g: isIdentityCurve(channelCurves.g),
    b: isIdentityCurve(channelCurves.b),
  };
  const allIdentity = identityByChannel.master && isIdentityCurveChannels(channels);

  // 지금 편집 중인 곡선과 변경 발행 — master는 onChange, r/g/b는 onChannelsChange로 라우팅.
  const curve = activeChannel === "master" ? master : channelCurves[activeChannel];
  const emitCurve = (next: CurvePoint[]): void => {
    if (activeChannel === "master") {
      onChange(next);
      return;
    }
    onChannelsChange?.({ ...channels, [activeChannel]: next });
  };

  const channelLabel = TONE_CHANNELS.find((c) => c.id === activeChannel)?.label ?? "RGB";
  const colors = CHANNEL_COLORS[activeChannel];
  const selectedIndex = Math.min(selectedPointIndex, curve.length - 1);
  const selectedPoint = curve[selectedIndex]!;
  const selectedPointIsEndpoint = selectedIndex === 0 || selectedIndex === curve.length - 1;
  const curvePointLimitReached = curve.length >= STUDIO_CURVE_MAX_CONTROL_POINTS;
  const suggestedPoint = suggestedCurvePoint(curve);

  const movePoint = (index: number, x: number, y: number): void => {
    setSelectedPointIndex(index);
    emitCurve(moveCurvePoint(curve, index, x, y));
  };

  const removePoint = (index: number): void => {
    const next = removeCurvePoint(curve, index);
    if (next.length === curve.length) return;
    setDrag(null);
    setSelectedPointIndex(Math.min(index, next.length - 1));
    emitCurve(next);
  };

  const addSuggestedPoint = (): void => {
    if (!suggestedPoint) return;
    const next = addCurvePoint(curve, suggestedPoint.x, suggestedPoint.y);
    setSelectedPointIndex(nearestCurvePointIndex(next, suggestedPoint.x));
    emitCurve(next);
  };

  const handlePointKeyDown = (
    event: React.KeyboardEvent<SVGRectElement>,
    index: number,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      setSelectedPointIndex(index);
      return;
    }
    const point = curve[index];
    if (!point) return;
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
    let x = point.x;
    let y = point.y;
    if (event.key === "ArrowLeft") x -= step;
    else if (event.key === "ArrowRight") x += step;
    else if (event.key === "ArrowUp") y += step;
    else if (event.key === "ArrowDown") y -= step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    movePoint(index, x, y);
  };

  // 화면 좌표(clientX/Y) → 커브 도메인 좌표(0..255). 스케일 보정 + 0 나눗셈 방어.
  // 측정 불가(미마운트/0폭)면 null.
  const clientToCurve = (clientX: number, clientY: number): { cx: number; cy: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    // 렌더 크기와 viewBox(SIZE) 비율로 SVG 로컬 좌표를 구한다.
    const px = (clientX - rect.left) * (SIZE / rect.width);
    const py = (clientY - rect.top) * (SIZE / rect.height);
    const cx = clampAxis(((px - PAD) / PLOT) * AXIS_MAX);
    const cy = clampAxis((1 - (py - PAD) / PLOT) * AXIS_MAX);
    return { cx, cy };
  };

  // 더블클릭 위치에서 가장 가까운 제어점 인덱스를 찾는다(SVG 단위 거리, HIT_RADIUS 이내). 없으면 -1.
  const hitTestPoint = (
    clientX: number,
    clientY: number,
    radius = HIT_RADIUS,
  ): number => {
    const svg = svgRef.current;
    if (!svg) return -1;
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return -1;
    const px = (clientX - rect.left) * (SIZE / rect.width);
    const py = (clientY - rect.top) * (SIZE / rect.height);
    let best = -1;
    let bestDist = radius;
    for (let i = 0; i < curve.length; i++) {
      const dx = px - toSvgX(curve[i]!.x);
      const dy = py - toSvgY(curve[i]!.y);
      const dist = Math.hypot(dx, dy);
      if (dist <= bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };

  // Overlapping 44px targets are common on subtle curves. Resolve pointer input geometrically
  // instead of trusting SVG paint order, so the nearest visible point always owns the gesture.
  // 빈 곳을 누르면 포토샵·클립스튜디오와 같이 그 자리에 점이 생기고, 손을 떼지 않은 채
  // 그대로 드래그로 이어진다(점을 만든 뒤 다시 잡게 하지 않는다).
  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    let index = hitTestPoint(
      event.clientX,
      event.clientY,
      POINT_HIT_SIZE / Math.SQRT2,
    );
    if (index < 0) {
      if (curvePointLimitReached) return;
      const spot = clientToCurve(event.clientX, event.clientY);
      if (!spot) return;
      const next = addCurvePoint(curve, spot.cx, spot.cy);
      index = nearestCurvePointIndex(next, spot.cx);
      pointerAddedAtRef.current = event.timeStamp;
      emitCurve(next);
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // key={i} 덕분에 인덱스별 rect DOM 노드는 재사용된다 — 방금 추가한 점의 최종 타깃과 같은 노드다.
    pointHitRefs.current[index]?.focus();
    setSelectedPointIndex(index);
    setDrag(index);
  };

  // 드래그 중 포인터 이동 — 현재 점을 새 좌표로 옮긴다(끝점은 엔진이 x를 고정).
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (drag === null) return;
    const c = clientToCurve(e.clientX, e.clientY);
    if (!c) return;
    emitCurve(moveCurvePoint(curve, drag, c.cx, c.cy));
  };

  // 드래그 종료(놓거나 SVG 밖으로 나감).
  const endDrag = (): void => {
    if (drag !== null) setDrag(null);
  };

  // 더블클릭 — 중간점 삭제. 빈 영역 추가는 이제 첫 pointerdown이 이미 처리했으므로,
  // 같은 시퀀스에서 만들어진 점은 지우지 않고 그대로 남긴다(끝점 더블클릭도 삭제 불가).
  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const addedAt = pointerAddedAtRef.current;
    pointerAddedAtRef.current = null;
    if (addedAt !== null && e.timeStamp - addedAt <= SAME_GESTURE_MS) return;
    const idx = hitTestPoint(e.clientX, e.clientY);
    if (idx > 0 && idx < curve.length - 1) removePoint(idx);
  };

  // 폴리라인 좌표 문자열 — 모든 점을 SVG 좌표로 변환해 잇는다.
  const polyPoints = toPolyPoints(curve);

  // 4x4 격자 내부선 위치(테두리 제외한 3개 분할선).
  const gridLines = [1, 2, 3].map((n) => PAD + (n / 4) * PLOT);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀(모든 채널) */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">톤 커브 (Curves)</p>
        <button
          type="button"
          onClick={() => {
            setDrag(null);
            setSelectedPointIndex(0);
            onReset();
          }}
          disabled={channelEditable ? allIdentity : identityByChannel.master}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="톤 커브(모든 채널)를 제거하고 원본 톤으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 채널 세그먼트 — RGB(마스터)/R/G/B. 조정된 채널에는 점 배지를 띄운다. */}
      {channelEditable && (
        <div role="group" aria-label="곡선 채널" className="flex flex-wrap gap-1.5">
          {TONE_CHANNELS.map((c) => (
            <StudioToggleChip
              key={c.id}
              active={activeChannel === c.id}
              title={c.tip}
              onClick={() => {
                setDrag(null); // 채널 전환 시 진행 중 드래그를 끊어 다른 곡선으로 이어지지 않게.
                setSelectedPointIndex(0);
                setChannel(c.id);
              }}
            >
              {c.label}
              {!identityByChannel[c.id] && (
                <>
                  <span aria-hidden className="ml-1 inline-block size-1.5 rounded-full bg-accent align-middle" />
                  <span className="sr-only">(조정됨)</span>
                </>
              )}
            </StudioToggleChip>
          ))}
        </div>
      )}

      {/* 프리셋 칩 — 마스터(RGB) 채널에서만. 절대 곡선으로 덮어쓴다(누적 아님). "기본"은 항등일 때 활성 표시. */}
      {activeChannel === "master" && (
        <div className="flex flex-wrap gap-1.5">
          {CURVE_PRESETS.map((preset) => {
            const active = preset.id === "linear" && identityByChannel.master;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setSelectedPointIndex(0);
                  onChange(normalizeCurve(preset.points));
                }}
                title={preset.tip}
                className={cn(CHIP_CLASS, active && "border-accent bg-raised text-fg")}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 히스토그램 — 선택 이미지 픽셀이 주어졌을 때만. 편집 채널을 따라간다(마스터=휘도). */}
      <StudioHistogramSection source={histogramSource} channel={activeChannel} />

      {/* 인터랙티브 커브 — 격자/대각 기준선 + (채널 편집 시) 마스터 참조선 + 폴리라인 + 드래그 핸들. */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto w-full min-w-[170px] max-w-[180px] touch-none select-none rounded border border-line bg-card"
        role="group"
        aria-label={`톤 커브 편집기 (${channelLabel} 채널)`}
        aria-describedby={instructionsId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={handleDoubleClick}
      >
        {/* 4x4 격자 — 옅은 line 색. */}
        {gridLines.map((g) => (
          <line key={`v${g}`} x1={g} y1={PAD} x2={g} y2={SIZE - PAD} className="stroke-line/30" strokeWidth={0.75} />
        ))}
        {gridLines.map((g) => (
          <line key={`h${g}`} x1={PAD} y1={g} x2={SIZE - PAD} y2={g} className="stroke-line/30" strokeWidth={0.75} />
        ))}
        {/* 항등 기준 대각선(좌하단→우상단) — 비교용 옅은 가이드. */}
        <line
          x1={PAD}
          y1={SIZE - PAD}
          x2={SIZE - PAD}
          y2={PAD}
          className="stroke-line/60"
          strokeWidth={0.75}
          strokeDasharray="3 3"
        />
        {/* 채널 편집 중엔 마스터(RGB) 곡선을 옅은 참조선으로 함께 보여준다(항등이면 대각선과 겹치므로 생략). */}
        {activeChannel !== "master" && !identityByChannel.master && (
          <polyline
            points={toPolyPoints(master)}
            className="stroke-fg-4/50"
            strokeWidth={1}
            fill="none"
            strokeLinejoin="round"
          />
        )}
        {/* 현재 곡선. */}
        <polyline points={polyPoints} className={colors.stroke} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
        {/* 제어점 핸들 — 시각 반경은 유지하고 투명 44px 목표가 포인터·키보드 입력을 받는다. */}
        {curve.map((p, i) => (
          <g key={i}>
            <rect
              ref={(node) => {
                pointHitRefs.current[i] = node;
              }}
              x={hitTargetOrigin(toSvgX(p.x))}
              y={hitTargetOrigin(toSvgY(p.y))}
              width={POINT_HIT_SIZE}
              height={POINT_HIT_SIZE}
              rx={POINT_HIT_SIZE / 2}
              fill="transparent"
              stroke="transparent"
              strokeWidth={2}
              tabIndex={0}
              role="button"
              aria-pressed={selectedIndex === i}
              aria-label={`${channelLabel} 제어점 ${i + 1}/${curve.length}, X ${p.x}, Y ${p.y}`}
              aria-describedby={instructionsId}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
              data-studio-curve-point-hit-target="true"
              className="cursor-grab text-accent outline-none focus-visible:stroke-current"
              onFocus={() => setSelectedPointIndex(i)}
              onClick={(event) => {
                // Keyboard and assistive-technology activation has detail=0. Pointer gestures are
                // resolved by the SVG-level nearest-point hit test above.
                if (event.detail === 0) setSelectedPointIndex(i);
              }}
              onKeyDown={(event) => handlePointKeyDown(event, i)}
            />
            {selectedIndex === i ? (
              <circle
                cx={toSvgX(p.x)}
                cy={toSvgY(p.y)}
                r={7}
                fill="none"
                className={colors.stroke}
                strokeWidth={1.25}
                pointerEvents="none"
                aria-hidden="true"
              />
            ) : null}
            <circle
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={4}
              className={colors.fill}
              pointerEvents="none"
              aria-hidden="true"
            />
          </g>
        ))}
      </svg>

      <div
        role="group"
        aria-label={`${channelLabel} 채널 선택한 제어점`}
        data-studio-curve-point-editor="true"
        className="rounded-xl border border-line/70 bg-card/55 p-2.5"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[0.66rem] font-semibold text-fg-2">
            선택한 점 {selectedIndex + 1}/{curve.length}
          </p>
          <span className="text-[0.6rem] font-semibold text-fg-4">{channelLabel} 채널</span>
        </div>
        <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <CurveCoordinateInput
            axis="X"
            value={selectedPoint.x}
            readOnly={selectedPointIsEndpoint}
            describedBy={selectedPointIsEndpoint ? endpointHintId : undefined}
            onCommit={(x) => movePoint(selectedIndex, x, selectedPoint.y)}
          />
          <CurveCoordinateInput
            axis="Y"
            value={selectedPoint.y}
            onCommit={(y) => movePoint(selectedIndex, selectedPoint.x, y)}
          />
          <button
            type="button"
            disabled={!suggestedPoint}
            aria-describedby={curvePointLimitReached ? instructionsId : undefined}
            title={curvePointLimitReached
              ? `채널마다 제어점은 최대 ${STUDIO_CURVE_MAX_CONTROL_POINTS}개까지 사용할 수 있습니다.`
              : "가장 넓은 구간에 제어점을 추가합니다."}
            onClick={addSuggestedPoint}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 justify-center min-[420px]:px-3",
            })}
          >
            <Plus className="size-3.5" aria-hidden />
            점 추가
          </button>
          <button
            type="button"
            disabled={selectedPointIsEndpoint}
            aria-describedby={selectedPointIsEndpoint ? endpointHintId : undefined}
            onClick={() => removePoint(selectedIndex)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 justify-center text-red-400 min-[420px]:px-3",
            })}
          >
            <Trash2 className="size-3.5" aria-hidden />
            점 삭제
          </button>
        </div>
        <p id={endpointHintId} className="mt-2 text-[0.6rem] leading-relaxed text-fg-4">
          {selectedPointIsEndpoint
            ? "첫 점과 마지막 점의 X 위치는 고정되며 Y만 조절할 수 있습니다."
            : "X와 Y를 직접 입력하거나 화살표 키로 미세 조절할 수 있습니다."}
        </p>
      </div>

      <p id={instructionsId} className="text-[0.6rem] leading-relaxed text-fg-4">
        그래프의 빈 곳을 클릭하면 그 자리에 점이 생기고 그대로 드래그됩니다. 점 위를 더블클릭하면 삭제됩니다. 점을 선택한 뒤 화살표 키로 1, Shift+화살표로 10씩 이동합니다. 점 추가 버튼은 가장 넓은 구간의 중간에 배치되며 채널마다 최대 {STUDIO_CURVE_MAX_CONTROL_POINTS}개까지 사용할 수 있습니다.
      </p>
    </div>
  );
}
