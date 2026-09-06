import { RANK_ENTRY_STAGGER_CAP, RANK_ENTRY_STAGGER_STEP_MS } from "./rank-row";

import type { RankingMeta } from "./ranking-board-types";
import type { RankAxis } from "@/shared/lib/ranking";
import type { Title } from "@/shared/lib/types";

import { formatCount } from "@/shared/lib/utils";


// countTo — 정수 스코어 지표(트렌드·몰입·완독률)만 진입 카운트업 대상으로 원시값을 함께 넘긴다.
// 단위 포맷 문자열(1.2만 등)·연도·소수점 평점은 카운트업이 어색하거나 포맷을 깨므로 제외.
export function metricFor(
  axis: RankAxis
): (t: Title) => { label: string; value: string; countTo?: number; countSuffix?: string } {
  switch (axis) {
    case "trending":
      return (t) => {
        const n = Math.round(t.stats.trendingScore);
        return { label: "트렌드", value: String(n), countTo: n };
      };
    case "rating":
    case "hidden":
      return (t) => ({ label: "평점", value: t.stats.ratingAvg.toFixed(1) });
    case "favorites":
      return (t) => ({ label: "관심", value: formatCount(t.stats.bookmarks) });
    case "binge":
      return (t) => {
        const n = Math.round(t.stats.bingeIndex);
        return { label: "몰입지수", value: String(n), countTo: n };
      };
    case "completed":
      return (t) => {
        const n = Math.round(t.stats.completionRate);
        return { label: "완독률", value: `${n}%`, countTo: n, countSuffix: "%" };
      };
    case "rookie":
      return (t) => ({ label: "데뷔", value: String(t.releaseYear) });
    case "popular":
    default:
      return (t) => ({ label: "조회", value: formatCount(t.stats.views) });
  }
}

// 목록 진입 스태거 — 첫 화면 분량(캡)까지만 지연을 주고, 캡 밖 행은 애니메이션 없이 즉시 표시.
export function entryStaggerStyle(index: number): React.CSSProperties | undefined {
  return index < RANK_ENTRY_STAGGER_CAP
    ? { animationDelay: `${index * RANK_ENTRY_STAGGER_STEP_MS}ms` }
    : undefined;
}

export function formatUpdatedAt(value?: string) {
  if (!value) return "대기 중";
  return `${new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value))} ${new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))}`;
}

export function confidenceTone(level?: RankingMeta["reliability"]["level"]) {
  if (level === "high") return "text-good";
  if (level === "medium") return "text-warn";
  return "text-bad";
}
