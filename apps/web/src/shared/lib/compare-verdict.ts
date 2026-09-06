import type { Title } from "./types";

// 작품 비교(/compare)의 "종합 우세" 판정 — compare-view 의 METRICS 와 동일한 지표 집합을 쓰되,
// 우열을 가릴 수 있는 지표(better:"high")만 집계한다. 연재 시작연도(better:"none")는 제외.
// 동점 지표는 어느 쪽에도 가산하지 않는다. UI 와 분리된 순수 함수라 단위 테스트가 쉽다.

export interface CompareMetric {
  label: string;
  get: (t: Title) => number;
  better: "high" | "none";
}

// compare-view.tsx 의 METRICS 와 동기화(우열 판정 대상만 better:"high").
export const COMPARE_VERDICT_METRICS: CompareMetric[] = [
  { label: "별점", get: (t) => t.stats.ratingAvg, better: "high" },
  { label: "평가 수", get: (t) => t.stats.ratingCount, better: "high" },
  { label: "누적 조회", get: (t) => t.stats.views, better: "high" },
  { label: "관심", get: (t) => t.stats.bookmarks, better: "high" },
  { label: "완독률", get: (t) => t.stats.completionRate, better: "high" },
  { label: "정주행 몰입", get: (t) => t.stats.bingeIndex, better: "high" },
];

export type VerdictWinner = "a" | "b" | "tie";

export interface CompareVerdict {
  aWins: number;
  bWins: number;
  ties: number;
  total: number; // 우열 판정에 쓰인 지표 수
  winner: VerdictWinner;
  /** A 가 더 나은 지표 라벨(요약 칩) */
  aLabels: string[];
  /** B 가 더 나은 지표 라벨(요약 칩) */
  bLabels: string[];
}

/**
 * 두 작품의 우열 지표를 집계해 종합 판정을 돌려준다.
 * @param metrics 기본은 COMPARE_VERDICT_METRICS(테스트 주입 가능).
 */
export function computeCompareVerdict(
  a: Title,
  b: Title,
  metrics: CompareMetric[] = COMPARE_VERDICT_METRICS
): CompareVerdict {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  const aLabels: string[] = [];
  const bLabels: string[] = [];

  for (const m of metrics) {
    if (m.better !== "high") continue;
    const va = m.get(a);
    const vb = m.get(b);
    if (va > vb) {
      aWins += 1;
      aLabels.push(m.label);
    } else if (vb > va) {
      bWins += 1;
      bLabels.push(m.label);
    } else {
      ties += 1;
    }
  }

  const total = aWins + bWins + ties;
  const winner: VerdictWinner = aWins > bWins ? "a" : bWins > aWins ? "b" : "tie";
  return { aWins, bWins, ties, total, winner, aLabels, bLabels };
}
