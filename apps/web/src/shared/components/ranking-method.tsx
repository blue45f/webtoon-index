import { Flag, Flame, FunctionSquare, Gem, Heart, Info, Sprout, Star, TrendingUp, Waves, type LucideIcon } from "lucide-react";

import { RANK_AXES, type RankAxis } from "@/shared/lib/ranking";

const AXIS_ICONS: Record<RankAxis, LucideIcon> = {
  popular: Flame,
  trending: TrendingUp,
  favorites: Heart,
  rating: Star,
  hidden: Gem,
  binge: Waves,
  completed: Flag,
  rookie: Sprout,
};

// 랭킹 선정 방식 — 전 축 산식 + 보정·기간·데이터 출처를 투명 공개
export function RankingMethod() {
  return (
    <section className="rounded-xl border border-line bg-panel/40 p-5 surface-hl sm:p-6">
      <div className="mb-5 flex items-center gap-2">
        <FunctionSquare size={18} className="text-accent" />
        <h2 className="text-lg font-bold tracking-tight">랭킹은 이렇게 정해집니다</h2>
        <span className="eyebrow ml-1 text-fg-3">METHODOLOGY</span>
      </div>

      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-fg-2">
        툰스펙트럼의 순위는 사람이 손으로 매기지 않습니다. 랭킹 화면은 정적 카탈로그 스냅샷 또는{" "}
        <span className="text-fg">/api/ranking</span>에서 검증된 작품 DB에 산식을 적용해 계산합니다.
        기본 운영 경로는 외부 실시간 호출 없이 결정적인 스냅샷 산식 순위를 사용합니다.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {RANK_AXES.map((a) => {
          const AxisIcon = AXIS_ICONS[a.key];
          return (
            <div key={a.key} className="rounded-xl border border-line bg-card p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg border border-accent/30 bg-accent-soft text-accent">
                  <AxisIcon size={15} />
                </span>
                <span className="text-sm font-semibold text-fg">{a.label}</span>
              </div>
              <p className="mb-2 text-xs text-fg-3">{a.desc}</p>
              <code className="block rounded-md bg-canvas px-2.5 py-1.5 font-mono text-[0.72rem] leading-relaxed text-fg-2">
                {a.formula}
              </code>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col gap-2.5 border-t border-line pt-5 text-xs leading-relaxed text-fg-3">
        <p className="flex gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-fg-2" />
          <span>
            <span className="font-medium text-fg-2">베이즈 평균 보정</span> — 평가 수가 적은 작품의 평점
            거품을 막기 위해 사전 평균(C)과 가중 표본(m)으로 보정합니다. C와 m은 고정값이 아니라 카탈로그
            분포에서 유도합니다 — C는 평가수 가중 평균 평점(추정 표본은 25%만 가중), m은 평가수 중앙값이며,
            안전 범위(C 3.2~4.6 · m 50~5000)로 클램프합니다. 표본이 클수록 실제 평점에 수렴합니다.
          </span>
        </p>
        <p className="flex gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-fg-2" />
          <span>
            <span className="font-medium text-fg-2">기간별 신호 블렌딩</span> — 일간·주간·월간·전체의 순위
            차이는 무작위 변주가 아니라 신호 가중치의 차이입니다. 일간은 단기 모멘텀(실 순위 변동·트렌드
            지수), 월간·전체는 누적 신호(조회·관심·베이즈 평점)의 비중을 높입니다. 같은 데이터면 언제나
            같은 순위가 나옵니다(결정적). 순위 변동(△)은 실데이터가 있으면 그대로 쓰고, 없는 축에서는
            기간 가중 차이로 추정한 값(±5 한도)만 표시합니다.
          </span>
        </p>
        <p className="flex gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-fg-2" />
          <span>
            <span className="font-medium text-fg-2">연재 신선도 · 멀티플랫폼</span> — 인기·급상승 축은
            연재중(연재요일 확인) 작품에 소폭 가중(×1.05)하고 휴재·완결작은 감쇠해, 갱신이 멈춘 작품이
            실시간 상위를 점유하지 않게 합니다(완결은 급상승에서 제외 대신 ×0.80 감쇠). 두 곳 이상에
            유통되는 검증된 IP는 +2~6% 보너스를 받되, 도달 가중은 최대 플랫폼 기준을 유지합니다.
          </span>
        </p>
        <p className="flex gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-fg-2" />
          <span>
            <span className="font-medium text-fg-2">스냅샷 산식</span> — 검색·탐색·랭킹은 빌드 시 생성된
            카탈로그 스냅샷을 기본으로 사용합니다. 스냅샷이 갱신되면 같은 산식으로 사전 계산 파일과 API 응답이
            다시 만들어지고, 사용자는 어느 데이터 기준의 순위인지 메타데이터로 확인할 수 있습니다.
          </span>
        </p>
        <p className="flex gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-warn/90" />
          <span>
            <span className="font-medium text-fg-2">신뢰도 점수</span> — 화면 상단의 confidence는
            스냅샷 산식 모드, 소스 상태, 추정 지표 비중, 폴백 여부를 합산한 해석 보조 지표입니다.
            점수가 낮아도 순위는 표시하지만, 그 경우 화면에 폴백 이유와 소스 상태를 함께 노출합니다.
          </span>
        </p>
        <p className="flex gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-good/80" />
          <span>
            <span className="font-medium text-fg-2">데이터 출처</span> — 제목·작가·장르·시놉시스·표지와{" "}
            <span className="text-fg-2">공개 랭킹·평점·조회 신호</span>는 플랫폼 공개 카탈로그에서 수집합니다.
            공개되지 않는 평가 수·평점 분포·완독률 등 보조 지표는 추정값으로 표시하고, 순위는 위 산식으로
            계산됩니다(베이즈 보정이 추정 평점의 영향을 억제).
          </span>
        </p>
      </div>
    </section>
  );
}
