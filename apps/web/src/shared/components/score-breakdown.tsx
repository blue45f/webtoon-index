import { Sigma, ArrowUpRight } from "lucide-react";

import type { Title } from "@/shared/lib/types";

import { explainScore, axisMeta, type RankAxis } from "@/shared/lib/ranking";
import Link from "@/src/compat/router-link";


// "왜 이 점수인가" 투명성 카드 — 한 축의 점수 기여 요인을 사람이 읽게 분해.
// 랭킹 산식을 작품 단위로 보이게 하는 차별점(투명성) 표면. 데이터는 lib/ranking.explainScore 단일 출처.
export function ScoreBreakdown({
  title,
  axis = "popular",
  className,
}: {
  title: Title;
  axis?: RankAxis;
  className?: string;
}) {
  const factors = explainScore(title, axis);
  const meta = axisMeta(axis);
  if (!factors.length) return null;
  return (
    <div className={className}>
      <div className="rounded-2xl border border-line bg-panel/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-accent-soft text-accent">
              <Sigma size={16} />
            </span>
            <div>
              <p className="text-sm font-bold text-fg">이 작품의 {meta.label} 지표</p>
              <p className="text-[0.72rem] text-fg-3">점수에 기여한 요인을 그대로 공개합니다</p>
            </div>
          </div>
          <Link
            href="/guide"
            className="inline-flex shrink-0 items-center gap-1 text-[0.72rem] font-medium text-accent hover:underline"
          >
            산정 방식
            <ArrowUpRight size={12} />
          </Link>
        </div>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {factors.map((f) => (
            <div
              key={f.label}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-line/60 bg-card/30 px-3 py-2"
            >
              <dt className="text-xs text-fg-2">{f.label}</dt>
              <dd className="numeral shrink-0 text-sm font-semibold text-fg tnum">{f.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 font-mono text-[0.7rem] leading-relaxed text-fg-3">
          <span className="eyebrow mr-1.5 text-[0.58rem] text-accent">산식</span>
          {meta.formula}
        </p>
      </div>
    </div>
  );
}
