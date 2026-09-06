/**
 * Studio Histogram Graph
 * 레벨/톤 커브 패널 위에 놓이는 256칸 히스토그램 — StudioHistogramGraph는 상태 없는 순수
 * 프레젠테이션(로그 스케일도 prop으로만 제어), StudioHistogramSection은 두 패널이 공유하는
 * 래퍼로 로그 토글 상태와 computeHistogram 메모만 갖는다(픽셀 소스가 없으면 아무것도 그리지
 * 않아 기존 패널과 렌더 결과가 동일). 채널 틴트는 StudioCurvePanel의 CHANNEL_COLORS와 동일
 * 관례(r/g/b), 마스터 채널은 휘도(luma) 분포로 매핑한다(포토샵 관례). 양끝 클리핑(0/255 몰림)은
 * warn 색 마커로 표시하고, 분포 요약은 한국어 aria-label로 제공한다.
 */
import { useMemo, useState } from "react";

import { computeHistogram, type StudioHistogramChannel, type StudioHistogramResult } from "./studio-histogram";
import { StudioToggleChip } from "./studio-panel-ui";

import type { ToneChannel } from "./studio-curves";
import type { StudioImageDataLike } from "./studio-filters";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

// SVG 기하 — 빈 하나가 viewBox 1 단위. preserveAspectRatio="none"으로 폭에 맞춰 늘어난다.
const GRAPH_W = 256;
const GRAPH_H = 64;
const TOP_PAD = 3;

// 채널 틴트 — 마스터(휘도)는 중립 잉크, R/G/B는 커브 패널과 동일한 채널 상징색.
const CHANNEL_TINT: Record<StudioHistogramChannel, string> = {
  luma: "text-fg-2",
  r: "text-red-400",
  g: "text-emerald-400",
  b: "text-sky-400",
};

const CHANNEL_KOREAN: Record<StudioHistogramChannel, string> = {
  luma: "휘도",
  r: "빨강",
  g: "초록",
  b: "파랑",
};

/** 256개 빈 → 세로 막대 path 문자열. 로그 스케일은 log1p 비율로 낮은 빈도 구간을 살린다. */
function studioHistogramBarsPath(histogram: StudioHistogramResult, logScale: boolean): string {
  if (histogram.max <= 0) return "";
  const usableHeight = GRAPH_H - TOP_PAD;
  const logMax = Math.log1p(histogram.max);
  let d = "";
  for (let value = 0; value < 256; value++) {
    const count = histogram.bins[value]!;
    if (count <= 0) continue;
    const ratio = logScale ? Math.log1p(count) / logMax : count / histogram.max;
    const top = GRAPH_H - ratio * usableHeight;
    d += `M${value + 0.5} ${GRAPH_H}V${Number(top.toFixed(2))}`;
  }
  return d;
}

export interface StudioHistogramGraphProps {
  /** 그릴 분포 — null이거나 표본이 0이면 빈 상태 박스를 그린다. */
  histogram: StudioHistogramResult | null;
  /** 표시 채널(틴트·라벨용). 기본 luma. */
  channel?: StudioHistogramChannel;
  /** 세로축 로그 스케일 — 내부 상태 없이 prop으로만 제어한다. */
  logScale?: boolean;
  className?: string;
}

export function StudioHistogramGraph({
  histogram,
  channel = "luma",
  logScale = false,
  className,
}: StudioHistogramGraphProps): ReactElement {
  const barsPath = useMemo(
    () => (histogram && histogram.sampledPixels > 0 ? studioHistogramBarsPath(histogram, logScale) : ""),
    [histogram, logScale]
  );

  if (!histogram || histogram.sampledPixels === 0) {
    return (
      <div
        data-studio-histogram-empty="true"
        className={cn(
          "flex h-14 items-center justify-center rounded border border-dashed border-line/70 bg-card/50 text-[0.62rem] text-fg-4",
          className
        )}
      >
        히스토그램 데이터 없음
      </div>
    );
  }

  const label =
    `${CHANNEL_KOREAN[channel]} 히스토그램 — 표본 ${histogram.sampledPixels}픽셀, ` +
    `평균 ${histogram.mean.toFixed(1)}, 중앙값 ${histogram.median}, ` +
    `어두운 끝(0) 잘림 ${histogram.clippedLow}픽셀, 밝은 끝(255) 잘림 ${histogram.clippedHigh}픽셀`;

  return (
    <svg
      viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-studio-histogram-graph="true"
      className={cn("block h-14 w-full rounded border border-line bg-card", CHANNEL_TINT[channel], className)}
    >
      {/* 4분할 세로 가이드 — 톤 구간(섀도/미드/하이라이트) 눈대중용 옅은 선. */}
      {[64, 128, 192].map((guideX) => (
        <line key={guideX} x1={guideX} y1={0} x2={guideX} y2={GRAPH_H} className="stroke-line/30" strokeWidth={1} />
      ))}
      {/* 256개 빈 막대 — 채널 틴트(currentColor). */}
      <path d={barsPath} stroke="currentColor" strokeWidth={1} opacity={0.9} fill="none" data-studio-histogram-bars="true" />
      {/* 양끝 클리핑 마커 — 0/255 칸에 표본이 몰려 있으면 warn 삼각형으로 경고. */}
      {histogram.clippedLow > 0 && (
        <path
          d={`M1 ${GRAPH_H - 1} L8 ${GRAPH_H - 1} L1 ${GRAPH_H - 8} Z`}
          className="text-warn"
          fill="currentColor"
          data-studio-histogram-clip="low"
        />
      )}
      {histogram.clippedHigh > 0 && (
        <path
          d={`M${GRAPH_W - 1} ${GRAPH_H - 1} L${GRAPH_W - 8} ${GRAPH_H - 1} L${GRAPH_W - 1} ${GRAPH_H - 8} Z`}
          className="text-warn"
          fill="currentColor"
          data-studio-histogram-clip="high"
        />
      )}
    </svg>
  );
}

export interface StudioHistogramSectionProps {
  /** 선택 이미지의 디코드된 픽셀 — 없으면(미지정/null) 섹션 전체를 그리지 않는다(기존 렌더 동일). */
  source?: StudioImageDataLike | null;
  /** 패널의 편집 채널 — master는 휘도(luma) 분포로 매핑한다(포토샵 관례). */
  channel: ToneChannel;
}

/**
 * 패널용 히스토그램 섹션 — 헤더(채널 라벨 + 로그 토글) + 그래프 + 요약 한 줄.
 * computeHistogram은 [source, channel]로만 메모되므로 슬라이더/곡선 드래그 중에는
 * 재계산이 없다(핫패스 계약: 픽셀 집계는 선택/소스 변경 시 한 번).
 */
export function StudioHistogramSection({ source, channel }: StudioHistogramSectionProps): ReactElement | null {
  const [logScale, setLogScale] = useState(false);
  const histogramChannel: StudioHistogramChannel = channel === "master" ? "luma" : channel;
  const histogram = useMemo(
    () => (source ? computeHistogram(source, histogramChannel) : null),
    [source, histogramChannel]
  );

  if (!source) return null;

  return (
    <div className="space-y-1" data-studio-histogram-section="true">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.6rem] font-semibold text-fg-4">히스토그램 ({CHANNEL_KOREAN[histogramChannel]})</p>
        <StudioToggleChip
          active={logScale}
          onClick={() => setLogScale((prev) => !prev)}
          title="세로축을 로그 스케일로 바꿔 빈도가 낮은 톤 구간도 보이게 합니다."
          aria-label="히스토그램 로그 스케일"
        >
          로그
        </StudioToggleChip>
      </div>
      <StudioHistogramGraph histogram={histogram} channel={histogramChannel} logScale={logScale} />
      {histogram && histogram.sampledPixels > 0 ? (
        <p className="text-[0.6rem] tabular-nums text-fg-4">
          평균 {histogram.mean.toFixed(1)} · 중앙값 {histogram.median}
          {histogram.clippedLow > 0 ? ` · 0 잘림 ${histogram.clippedLow}` : ""}
          {histogram.clippedHigh > 0 ? ` · 255 잘림 ${histogram.clippedHigh}` : ""}
        </p>
      ) : null}
    </div>
  );
}
