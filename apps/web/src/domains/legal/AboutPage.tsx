import {
  Search,
  Compass,
  Trophy,
  Sparkles,
  CalendarDays,
  Star,
  Network,
  Library,
  ArrowRight,
  MapPin,
} from "lucide-react";

import { Container } from "@/shared/components/section";
import Link from "@/src/compat/router-link";

// 사이트 소개·튜토리얼 페이지(/about) — 처음 온 사람에게 툰스펙트럼이 무엇이고 무엇을 할 수 있는지,
// 어떻게 쓰는지 한 화면에서 안내한다.

const FEATURES = [
  {
    icon: MapPin,
    title: "어디서 봐",
    body: "한 작품이 네이버·카카오·리디 등 어디서 연재되는지, 무료·기다무·유료 중 무엇인지 한눈에. 가장 싸게 보는 길을 먼저 보여줍니다.",
    href: "/search",
    cta: "작품 찾기",
  },
  {
    icon: Search,
    title: "통합 검색",
    body: "18개 플랫폼의 작품을 한 번에 검색합니다. 같은 작품이 여러 곳에 흩어져 있어도 하나로 묶어 보여줍니다.",
    href: "/search",
    cta: "검색하기",
  },
  {
    icon: Trophy,
    title: "투명 통합 랭킹",
    body: "플랫폼을 가로지르는 8개 축의 순위. 손으로 고르지 않고 공개된 산식으로만 계산합니다.",
    href: "/ranking",
    cta: "랭킹 보기",
  },
  {
    icon: Sparkles,
    title: "맞춤 추천",
    body: "별점·읽은 작품·취향 태그를 바탕으로 다음에 볼 작품을 제안합니다. 플랫폼을 가리지 않습니다.",
    href: "/recommend",
    cta: "추천 받기",
  },
  {
    icon: CalendarDays,
    title: "연재 캘린더",
    body: "요일별 연재작을 모아 봅니다. 네이버·카카오 밖의 플랫폼 신작도 빠뜨리지 않습니다.",
    href: "/calendar",
    cta: "캘린더 열기",
  },
  {
    icon: Compass,
    title: "스펙트럼 탐색",
    body: "18색 장르 스펙트럼으로 기분 따라 작품을 발견합니다. 필터를 좁혀가며 취향의 결을 찾습니다.",
    href: "/explore",
    cta: "탐색하기",
  },
  {
    icon: Star,
    title: "신뢰 리뷰",
    body: "별점·스포일러 가림·태그가 붙은 독자 리뷰. 평가가 적은 작품은 베이즈 보정으로 과대평가를 막습니다.",
    href: "/reviews",
    cta: "리뷰 보기",
  },
  {
    icon: Network,
    title: "원작·2차 창작",
    body: "웹소설 원작이 웹툰이 되고 드라마·영화로 이어지는 관계를 그래프로 잇습니다.",
    href: "/insights",
    cta: "인사이트 보기",
  },
  {
    icon: Library,
    title: "내 서재",
    body: "보고싶다·보는중·완독·하차로 상태를 기록하고, 컬렉션으로 묶어 나만의 서재를 만듭니다.",
    href: "/library",
    cta: "내 서재",
  },
];

const STEPS = [
  { n: "01", title: "검색하거나 둘러보기", body: "작품명을 검색하거나, 랭킹·캘린더·스펙트럼 탐색으로 마음에 드는 작품을 찾습니다." },
  { n: "02", title: "'어디서 봐' 확인", body: "작품 상세에서 연재 플랫폼과 무료·기다무·유료 여부를 보고, 가장 좋은 길로 바로 이동합니다." },
  { n: "03", title: "서재에 담고 기록", body: "상태를 표시하고 별점·리뷰를 남기면, 그 기록이 다음 추천을 더 정확하게 만듭니다." },
];

export function AboutPage() {
  return (
    <Container size="prose" className="py-10 sm:py-14">
      {/* 히어로 */}
      <header>
        <p className="eyebrow text-accent">소개 · GETTING STARTED</p>
        <h1 className="mt-2 text-balance font-display text-[clamp(1.6rem,7vw,1.875rem)] font-bold tracking-tight text-fg sm:text-4xl">
          무엇을, 어디서, 왜 볼지 한 곳에서
        </h1>
        <p className="mt-3 text-base leading-relaxed text-fg-2">
          툰스펙트럼은 작품을 직접 서비스하지 않습니다. 대신 네이버·카카오·리디를 비롯한 국내 웹툰·웹소설
          플랫폼을 가로질러, <strong className="text-fg">고르는 단계</strong>를 책임지는 통합 인덱스입니다.
          흩어진 작품을 하나로 묶고, 어디서 가장 좋게 볼 수 있는지 알려주고, 믿을 수 있는 데이터로
          순위를 매깁니다.
        </p>
      </header>

      {/* 기능 카드 */}
      <section className="mt-10">
        <h2 className="text-xl font-bold tracking-tight text-fg">무엇을 할 수 있나요</h2>
        <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              className="group flex flex-col rounded-2xl border border-line bg-card/30 p-5 transition-colors hover:border-line-strong hover:bg-card/50"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent">
                <f.icon size={18} />
              </span>
              <h3 className="mt-3 font-bold text-fg">{f.title}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-fg-2">{f.body}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[0.8rem] font-medium text-accent">
                {f.cta}
                <ArrowRight size={13} className="transition-transform duration-150 group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 사용법 3단계 */}
      <section className="mt-10">
        <h2 className="text-xl font-bold tracking-tight text-fg">3단계로 시작하기</h2>
        <ol className="mt-5 flex flex-col gap-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-4 rounded-2xl border border-line bg-card/30 p-5">
              <span className="numeral text-2xl font-bold text-accent">{s.n}</span>
              <div className="min-w-0">
                <h3 className="font-bold text-fg">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-2">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 정직성 약속 */}
      <section className="mt-10 rounded-2xl border border-line bg-panel/40 p-5 sm:p-6">
        <h2 className="text-lg font-bold text-fg">데이터에 대한 약속</h2>
        <p className="mt-2.5 text-sm leading-relaxed text-fg-2">
          작품 메타데이터와 표지는 여러 플랫폼의 공개 카탈로그에서 수집한 실데이터입니다. 네이버
          웹툰의 별점은 실수집값이며, 일부 보조 지표(조회·관심수 등)는 추정값(≈)으로 분명히
          구분해 표기합니다. 가격·조회수를 부풀리지 않고, 순위는 공개된 산식으로만 계산합니다.
        </p>
        <Link
          href="/guide"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          랭킹 산정 방식 자세히 보기 <ArrowRight size={14} />
        </Link>
      </section>

      {/* CTA */}
      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/search"
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
        >
          지금 작품 찾아보기 <ArrowRight size={15} />
        </Link>
        <Link
          href="/ranking"
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised"
        >
          통합 랭킹
        </Link>
      </div>
    </Container>
  );
}
