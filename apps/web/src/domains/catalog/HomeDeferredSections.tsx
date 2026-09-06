import { ArrowRight, Layers, LayoutTemplate, MessageCircle, Palette, PersonStanding } from "lucide-react";

import type { Title } from "@/shared/lib/types";

import { AdSlot } from "@/shared/components/ad-slot";
import { AdaptationGraph } from "@/shared/components/adaptation-graph";
import { Container } from "@/shared/components/container";
import { HomePersonal } from "@/shared/components/home-personal";
import { RevealOnScroll } from "@/shared/components/reveal-on-scroll";
import { Rail, Section } from "@/shared/components/section";
import { TitleCard } from "@/shared/components/title-card";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { GenreSpectrum } from "@/shared/components/ui/spectrum-bar";
import { genreColor, genreTextColor } from "@/shared/lib/genre-color";
import { GENRES } from "@/shared/lib/taxonomy";
import Link from "@/src/compat/router-link";

interface HomeDeferredSectionsProps {
  todayReleases: Title[];
  todayDay: string;
  families: { original: Title; adaptations: Title[] }[];
  featured: Title[];
  topRated: Title[];
  waitFree: Title[];
  tags: { tag: string; count: number }[];
  newest: Title[];
}

export function HomeDeferredSections({
  todayReleases,
  todayDay,
  families,
  featured,
  topRated,
  waitFree,
  tags,
  newest,
}: HomeDeferredSectionsProps) {
  return (
    <Container size="wide" className="flex flex-col gap-12 py-9 sm:gap-20 sm:py-16">
      <RevealOnScroll>
        <HomePersonal />
      </RevealOnScroll>

      {todayReleases.length > 0 && (
        <RevealOnScroll as="section">
          <Section
            live
            eyebrow="TODAY"
            title={`오늘(${todayDay}) 새로 올라오는`}
            desc="오늘 새 회차가 공개되는 연재작"
            action={{ label: "연재 캘린더", href: "/calendar" }}
          >
            <Rail>
              {todayReleases.map((title) => (
                <TitleCard key={title.id} title={title} />
              ))}
            </Rail>
          </Section>
        </RevealOnScroll>
      )}

      <RevealOnScroll as="section">
      <Section
        tick
        eyebrow="GENRE SPECTRUM"
        title="장르로 떠나는 탐색"
        desc="장르마다 다른 색을 따라 다음 정주행작을 발견하세요."
        action={{ label: "스펙트럼 탐색", href: "/explore" }}
      >
        <GenreSpectrum
          genres={[...GENRES]}
          height={10}
          interactive
          label={`전체 장르 스펙트럼 (${GENRES.length}개)`}
          className="mb-5"
        />
        <div className="flex flex-wrap gap-2">
          {GENRES.map((genre) => (
            <Link key={genre} href={`/explore?genre=${encodeURIComponent(genre)}`}>
              <span
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium [word-break:keep-all] transition-transform duration-150 hover:scale-105"
                style={{
                  color: genreTextColor(genre, 0.85),
                  backgroundColor: `color-mix(in oklch, ${genreColor(genre, 0.6)} 14%, transparent)`,
                  borderColor: `color-mix(in oklch, ${genreColor(genre, 0.6)} 32%, transparent)`,
                }}
              >
                {genre}
              </span>
            </Link>
          ))}
        </div>
      </Section>
      </RevealOnScroll>

      <RevealOnScroll as="section">
      <Section
        tick
        eyebrow="ADAPTATION GRAPH"
        title="원작에서 웹툰까지, 한 우주"
        desc="웹소설과 웹툰이 이어지는 관계를 같은 이야기의 계보로 묶었습니다."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {families.map(({ original, adaptations }) => (
            <div key={original.id} className="rounded-2xl border border-line bg-card p-5 surface-hl">
              <div className="mb-4 flex items-center gap-2 text-fg-3">
                <Layers size={14} />
                <span className="eyebrow">{original.title} 유니버스</span>
              </div>
              <AdaptationGraph original={original} adaptations={adaptations} />
            </div>
          ))}
        </div>
      </Section>
      </RevealOnScroll>

      <RevealOnScroll as="section">
      <Section
        tick
        eyebrow="EDITOR'S PICK"
        title="에디터의 발견"
        desc="수치 너머 작품 설명과 독자 반응을 함께 볼 수 있는 추천 묶음"
        action={{ label: "더 보기", href: "/explore?sort=rating" }}
      >
        <Rail>
          {featured.map((title) => (
            <TitleCard key={title.id} title={title} />
          ))}
        </Rail>
      </Section>
      </RevealOnScroll>

      {/* 수익화 OFF면 렌더되지 않음(기본 invisible). 콘텐츠 레일 사이 광고 지면. */}
      <AdSlot />

      <RevealOnScroll as="section">
      <Section
        tick
        eyebrow="TOP RATED"
        title="평점이 검증한 명작"
        desc="독자 평점 베이즈 보정 상위작"
        action={{ label: "평점 랭킹", href: "/ranking?axis=rating" }}
      >
        <Rail>
          {topRated.map((title) => (
            <TitleCard key={title.id} title={title} />
          ))}
        </Rail>
      </Section>
      </RevealOnScroll>

      <RevealOnScroll as="section">
      <Section
        tick
        eyebrow="FREE TO START"
        title="지금 무료로 시작하기"
        desc="무료 공개 · 기다리면 무료로 진입 가능한 작품"
        action={{ label: "전체 보기", href: "/search?free=1" }}
      >
        <Rail>
          {waitFree.map((title) => (
            <TitleCard key={title.id} title={title} />
          ))}
        </Rail>
      </Section>
      </RevealOnScroll>

      <RevealOnScroll className="grid gap-12 lg:grid-cols-[0.9fr_1.4fr]">
        <Section tick eyebrow="BY MOOD" title="코드로 찾기" desc="작품의 결을 나타내는 특성 태그">
          <div className="flex flex-wrap gap-2">
            {tags.map(({ tag, count }) => (
              <Link
                key={tag}
                href={`/explore?tag=${encodeURIComponent(tag)}`}
                className="group inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 py-2 text-sm text-fg-2 [word-break:keep-all] transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
              >
                <span className="text-fg-3 group-hover:text-accent">#</span>
                {tag}
                <span className="tnum text-xs text-fg-3">{count}</span>
              </Link>
            ))}
          </div>
        </Section>

        <Section
          tick
          eyebrow="FRESH"
          title="신작 발굴"
          desc="최근 합류한 라이징 작품"
          action={{ label: "신작 랭킹", href: "/ranking?axis=rookie" }}
        >
          {/* 리드 1작은 가로 에디토리얼 카드(2칸), 나머지는 그리드 — 균일 매트릭스 탈피 */}
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            {newest.slice(0, 7).map((title, i) =>
              i === 0 ? (
                <TitleCard
                  key={title.id}
                  title={title}
                  feature
                  className="col-span-2"
                />
              ) : (
                <TitleCard key={title.id} title={title} size="sm" />
              )
            )}
          </div>
        </Section>
      </RevealOnScroll>

      <RevealOnScroll as="section">
      <Section
        tick
        eyebrow="CREATOR STUDIO"
        title="읽다가, 만들어 보세요"
        desc="설치 없이 브라우저에서 컷툰을 만들고, 창작 게시판에서 독자 반응을 받아보세요."
      >
        <div className="grid gap-3.5 sm:grid-cols-3">
          {[
            {
              icon: LayoutTemplate,
              title: "컷 템플릿",
              body: "컷 분할 템플릿으로 캔버스를 잡고, 이미지·스티커·펜으로 장면을 채웁니다.",
            },
            {
              icon: MessageCircle,
              title: "말풍선·대사",
              body: "꼬리 방향과 글꼴을 고를 수 있는 말풍선으로 컷에 대사를 입힙니다.",
            },
            {
              icon: PersonStanding,
              title: "3D 캐릭터 포즈",
              body: "3D 캐릭터에 원하는 포즈를 잡아 컷에 내려놓습니다. VRM 모델도 불러올 수 있어요.",
            },
          ].map((f, i) => (
            // 진입 모션(reveal)과 호버 transform 을 분리: reveal 의 fill:both 가 호버 translate 를
            // 덮어쓰지 않도록 바깥 래퍼에 reveal, 안쪽 카드에 호버 리프트를 둔다.
            <RevealOnScroll key={f.title} delayMs={i * 90}>
              <div className="sheen-sweep group relative h-full overflow-hidden rounded-2xl border border-line bg-card/30 p-5 surface-hl transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-accent/40 hover:bg-card/50 hover:shadow-[0_14px_36px_-18px_oklch(0.72_0.185_42/0.5)]">
                <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent transition-transform duration-200 ease-out-expo group-hover:scale-110 group-hover:-rotate-3">
                  <f.icon size={18} />
                </span>
                <h3 className="mt-3 font-bold text-fg transition-colors group-hover:text-accent">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{f.body}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/studio" className={buttonClass({ className: "gap-2" })}>
            <Palette size={16} />
            창작 스튜디오 열기
          </Link>
          <Link href="/create" className={buttonClass({ variant: "outline", className: "gap-1.5" })}>
            창작 게시판 둘러보기
            <ArrowRight size={16} />
          </Link>
        </div>
      </Section>
      </RevealOnScroll>
    </Container>
  );
}
