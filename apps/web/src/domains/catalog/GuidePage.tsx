import { Scale, Sigma, Gauge, ShieldCheck, ArrowRight } from "lucide-react";

import type { PlatformId } from "@/shared/lib/types";

import { Container } from "@/shared/components/section";
import { PLATFORMS } from "@/shared/lib/platforms";
import { RANK_AXES, PLATFORM_REACH_WEIGHT } from "@/shared/lib/ranking";
import Link from "@/src/compat/router-link";



// 랭킹 산정 방식 공개 페이지(/guide) — 투명 산식을 사람이 읽을 수 있게 풀어 설명한다.
// 산식·도달가중·축 목록은 lib/ranking.ts 의 단일 출처를 그대로 읽어와 코드와 어긋나지 않게 한다.

const PILLARS = [
  {
    icon: Scale,
    title: "베이즈 평점",
    sub: "적은 표본 보정",
    body: "평가 수가 적은 작품의 평점은 쉽게 출렁입니다. 평가 3개로 5.0인 작품과 평가 1만 개로 4.6인 작품을 같은 줄에 세우면 안 되죠. 그래서 카탈로그 분포에서 유도한 사전 평균 C(평가수 가중 평균, 3.2~4.6 범위)와 가중 표본 m(평가수 중앙값 기반, 50~5,000 범위)을 더해, 평가가 쌓일수록 자기 점수에 가까워지게 보정합니다. 표본이 부족하면 C=4.0, m=800 기본값으로 폴백합니다.",
    formula: "bayes = (C×m + 평균평점×평가수) / (m + 평가수) — C·m은 카탈로그 분포에서 유도",
  },
  {
    icon: Sigma,
    title: "인기 백분위",
    sub: "플랫폼 안에서 먼저 줄 세우기",
    body: "플랫폼마다 조회수의 단위가 다릅니다. 그래서 절대 조회수를 직접 비교하지 않고, 각 플랫폼 안에서의 인기 백분위(0~100)를 먼저 구한 뒤 지수 감쇠를 줍니다. 각 플랫폼의 '최상위'만 또렷이 부각돼, 작품 수가 많은 네이버의 상위 무더기에 다른 플랫폼 상위작이 묻히지 않습니다.",
    formula: "popComp = 100 × exp((백분위−100)/2.5) × 도달가중 × 신뢰계수",
  },
  {
    icon: Gauge,
    title: "도달 가중",
    sub: "플랫폼 트래픽 규모",
    body: "같은 '플랫폼 1위'라도 도달(실제 트래픽 규모)은 다릅니다. 백분위만 쓰면 모든 플랫폼의 1위가 똑같이 100점이 돼버려, 초소형 플랫폼 1위가 종합 1위에 오르는 왜곡이 생깁니다. 도달 가중을 곱으로 적용해 메이저와 군소의 격차를 분명히 둡니다(곱셈 계수일 뿐, 절대 조회수 독식은 막습니다).",
    formula: "도달가중 = 작품이 연재되는 플랫폼들 중 최댓값",
  },
  {
    icon: ShieldCheck,
    title: "신뢰 계수",
    sub: "실데이터는 확신 있게",
    body: "네이버 웹툰의 별점·순위처럼 실제로 수집한 값은 확신 있게, 추정으로 채운 보조 지표는 약하게 감점합니다. '얼마나 많이 보느냐'를 다투는 인기·급상승 축에서, 추정값 작품이 실데이터 작품을 1위에서 밀어내지 못하게 하는 장치입니다. 완전 배제가 아니라 약한 감점이라 다양성은 유지됩니다.",
    formula: "실데이터 1.00~1.06 · 순수 추정 0.78~0.80",
  },
];

function reachTier(w: number): string {
  if (w >= 0.9) return "메이저";
  if (w >= 0.7) return "대형";
  if (w >= 0.5) return "중형";
  return "전문·소형";
}

export function GuidePage() {
  // 도달 가중 표 — lib/ranking.ts 의 값을 그대로 읽어 내림차순 정렬.
  const reachRows = (Object.entries(PLATFORM_REACH_WEIGHT) as [PlatformId, number][])
    .map(([id, w]) => ({ id, w, p: PLATFORMS[id] }))
    .filter((r) => r.p)
    .sort((a, b) => b.w - a.w);

  return (
    <Container size="prose" className="py-10 sm:py-14">
      {/* 헤더 */}
      <header>
        <p className="eyebrow text-accent">투명 산식 · OPEN FORMULA</p>
        <h1 className="mt-2 text-pretty font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          랭킹은 이렇게 매겨집니다
        </h1>
        <p className="mt-3 text-base leading-relaxed text-fg-2">
          툰스펙트럼의 모든 순위는 사람이 손으로 고르지 않습니다. 공개된 산식으로만 계산하고, 그 산식을
          이 페이지에 그대로 적어둡니다. 어떤 작품이 왜 그 자리에 있는지 직접 검산할 수 있어야
          한다고 믿기 때문입니다.
        </p>
      </header>

      {/* 정직성 원칙 */}
      <section className="mt-8 rounded-2xl border border-line bg-panel/40 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
          <span className="numeral text-accent">01</span> 실데이터와 추정값을 섞지 않습니다
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-fg-2">
          네이버 웹툰의 <strong className="text-fg">별점은 실제 수집값</strong>입니다. 다만 네이버가
          조회·관심 집계를 비공개로 전환하면서, 조회수·관심수 등 일부 보조 지표는{" "}
          <strong className="text-fg">추정값(≈)</strong>으로 표기합니다. 다른 플랫폼의 평점·조회·완독률
          중 일부도 마찬가지입니다. 추정값은 화면 어디서나 <code className="rounded bg-raised px-1 py-0.5 text-[0.8em] text-fg-2">≈</code>{" "}
          기호로 분명히 구분하고, 위의 <strong className="text-fg">신뢰 계수</strong>로 순위 영향력도 낮춥니다.
          가격·조회수를 부풀려 표시하지 않습니다.
        </p>
      </section>

      {/* 4가지 핵심 장치 */}
      <section className="mt-10">
        <h2 className="text-xl font-bold tracking-tight text-fg">순위를 떠받치는 4가지 장치</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
          모든 축은 아래 네 가지를 조합해 만들어집니다.
        </p>
        <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <article key={p.title} className="flex flex-col rounded-2xl border border-line bg-card/30 p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent">
                  <p.icon size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="font-bold text-fg">{p.title}</h3>
                  <p className="text-[0.72rem] text-fg-3">{p.sub}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-fg-2">{p.body}</p>
              <code className="mt-3 block rounded-lg border border-line/70 bg-raised px-3 py-2 text-[0.74rem] leading-relaxed text-fg-2">
                {p.formula}
              </code>
            </article>
          ))}
        </div>
      </section>

      {/* 도달 가중 표 */}
      <section className="mt-10">
        <h2 className="text-xl font-bold tracking-tight text-fg">플랫폼 도달 가중</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
          작품이 연재되는 플랫폼들 중 가장 큰 값을 씁니다. 인기·급상승 점수에 곱으로 들어갑니다.
        </p>
        <div className="mt-4 overflow-hidden rounded-2xl border border-line">
          {reachRows.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 ? "bg-card/20" : "bg-transparent"}`}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: r.p.color }} />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{r.p.name}</span>
              <span className="shrink-0 text-[0.7rem] text-fg-3">{reachTier(r.w)}</span>
              <span className="numeral w-12 shrink-0 text-right text-sm tabular-nums text-fg-2">
                ×{r.w.toFixed(2)}
              </span>
              <span aria-hidden className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-line sm:block">
                <span className="block h-full rounded-full bg-accent/70" style={{ width: `${r.w * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 8개 랭킹 축 */}
      <section className="mt-10">
        <h2 className="text-xl font-bold tracking-tight text-fg">8개 랭킹 축</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
          하나의 점수로 줄 세우면 시야가 좁아집니다. 보는 관점마다 다른 축을 둡니다.
        </p>
        <ol className="mt-4 flex flex-col gap-2.5">
          {RANK_AXES.map((a, i) => (
            <li key={a.key} className="rounded-2xl border border-line bg-card/30 p-4">
              <div className="flex items-baseline gap-2.5">
                <span className="numeral text-sm text-fg-3">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-bold text-fg">{a.label}</h3>
                <span className="text-[0.78rem] text-fg-3">{a.desc}</span>
              </div>
              <code className="mt-2 block rounded-lg border border-line/70 bg-raised px-3 py-2 text-[0.74rem] leading-relaxed text-fg-2">
                {a.formula}
              </code>
            </li>
          ))}
        </ol>
      </section>

      {/* 워크드 예시 */}
      <section className="mt-10 rounded-2xl border border-line bg-panel/40 p-5 sm:p-6">
        <h2 className="text-lg font-bold text-fg">예: 왜 종합 1위가 군소 플랫폼 작품이 아닌가</h2>
        <p className="mt-2.5 text-sm leading-relaxed text-fg-2">
          각 플랫폼의 1위는 모두 인기 백분위 100에 가깝습니다. 백분위만 보면 전부 동점이라, 추정
          지표가 큰 군소 플랫폼 작품이 우연히 종합 1위에 오를 수 있습니다. 도달 가중과 신뢰 계수를
          곱으로 적용하면 이야기가 달라집니다.
        </p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-line/70 bg-raised px-4 py-3">
            <p className="text-sm font-semibold text-fg">네이버 웹툰 1위 (실데이터)</p>
            <p className="numeral mt-1 text-sm text-fg-2">100 × 1.00(도달) × 1.05(신뢰) ≈ <strong className="text-fg">105</strong></p>
          </div>
          <div className="rounded-xl border border-line/70 bg-raised px-4 py-3">
            <p className="text-sm font-semibold text-fg">레진 1위 (추정 지표)</p>
            <p className="numeral mt-1 text-sm text-fg-2">100 × 0.62(도달) × 0.79(신뢰) ≈ <strong className="text-fg">49</strong></p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-fg-3">
          같은 '플랫폼 1위'라도 종합 점수는 두 배 넘게 벌어집니다. 군소 플랫폼이 무시되는 게 아니라,
          장르·숨은 명작 같은 다른 축에서 정당하게 상위에 오릅니다.
        </p>
      </section>

      {/* CTA */}
      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/ranking"
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
        >
          통합 랭킹 보러가기 <ArrowRight size={15} />
        </Link>
        <Link
          href="/about"
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised"
        >
          툰스펙트럼 소개
        </Link>
      </div>
    </Container>
  );
}
