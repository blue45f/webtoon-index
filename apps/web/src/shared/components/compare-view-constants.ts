import type { Title } from "@/shared/lib/types";

import { formatCount } from "@/shared/lib/utils";

export type Metric = {
  label: string;
  get: (t: Title) => number;
  fmt: (v: number) => string;
  better: "high" | "none";
  // 추정 가능 지표면 statsAreEstimated 작품의 셀에 ≈를 붙인다.
  // 연재 시작연도는 실수집 메타데이터라 추정 표기 대상이 아니다.
  estimable?: boolean;
};

export const METRICS: Metric[] = [
  { label: "별점", get: (t) => t.stats.ratingAvg, fmt: (v) => v.toFixed(1), better: "high", estimable: true },
  { label: "평가 수", get: (t) => t.stats.ratingCount, fmt: formatCount, better: "high", estimable: true },
  { label: "누적 조회", get: (t) => t.stats.views, fmt: formatCount, better: "high", estimable: true },
  { label: "관심", get: (t) => t.stats.bookmarks, fmt: formatCount, better: "high", estimable: true },
  { label: "완독률", get: (t) => t.stats.completionRate, fmt: (v) => `${v}%`, better: "high", estimable: true },
  { label: "정주행 몰입", get: (t) => t.stats.bingeIndex, fmt: (v) => String(v), better: "high", estimable: true },
  { label: "연재 시작", get: (t) => t.releaseYear, fmt: (v) => String(v), better: "none" },
];
