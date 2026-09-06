import Autoplay from "embla-carousel-autoplay";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { HeroBannerBadge } from "./hero-banner-badge";
import { HERO_BANNER_AUTOPLAY_MS, HeroBannerSlide } from "./hero-banner-slide";

import type { Title } from "@/shared/lib/types";

// 홈 '이 주의 발견' 배너 — embla 캐러셀(경량). 표지를 무대 삼은 시네마틱 배경(표지가 주인공) +
// 에디토리얼 정보(장르 스펙트럼·serif 한 줄·어디서 봐·평점) + 자동회전 진행바. 드래그/화살표/닷.
// 접근성: prefers-reduced-motion 시 자동회전 OFF, 포커스 진입 시 일시정지, 명시적 재생/정지 토글(WCAG 2.2.2).
export function HeroBanner({ items }: { items: Title[] }) {
  const slides = items.slice(0, 6);
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "start", duration: 30 }, [
    Autoplay({ delay: HERO_BANNER_AUTOPLAY_MS, stopOnInteraction: false, stopOnMouseEnter: true }),
  ]);
  const [selected, setSelected] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setSelected(emblaApi.selectedScrollSnap());
    };
    onSelect();
    emblaApi.on("select", onSelect).on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect).off("reInit", onSelect);
    };
  }, [emblaApi]);

  // 동작 최소화 선호 시 자동회전을 멈춰 둔다(WCAG 2.3 / 모션 민감 사용자 배려).
  useEffect(() => {
    if (!emblaApi || typeof window === "undefined") return;
    if (globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      emblaApi.plugins().autoplay?.stop();
      setIsPlaying(false);
    }
  }, [emblaApi]);

  // 명시적 재생/정지 토글 — 움직이는 콘텐츠를 멈출 수단 제공(WCAG 2.2.2).
  const toggleAutoplay = () => {
    const autoplay = emblaApi?.plugins().autoplay;
    if (!autoplay) return;
    if (autoplay.isPlaying()) {
      autoplay.stop();
      setIsPlaying(false);
    } else {
      autoplay.play();
      setIsPlaying(true);
    }
  };

  // 키보드 포커스가 배너에 들어오면 자동회전 일시정지(마우스 호버와 동일한 배려).
  const onFocusEnter = () => {
    emblaApi?.plugins().autoplay?.stop();
  };
  const onFocusLeave = (e: React.FocusEvent<HTMLDivElement>) => {
    if (isPlaying && !e.currentTarget.contains(e.relatedTarget)) {
      emblaApi?.plugins().autoplay?.play();
    }
  };

  if (slides.length === 0) return null;

  return (
    <div
      className="group relative"
      role="group"
      aria-roledescription="carousel"
      aria-label="이 주의 추천 작품"
      onFocus={onFocusEnter}
      onBlur={onFocusLeave}
    >
      <HeroBannerBadge />

      <div className="overflow-hidden rounded-2xl border border-line bg-card surface-hl" ref={emblaRef}>
        <div className="flex">
          {slides.map((title) => (
            <div key={title.id} className="min-w-0 flex-[0_0_100%]" aria-roledescription="slide">
              <HeroBannerSlide title={title} />
            </div>
          ))}
        </div>
      </div>

      {slides.length > 1 && (
        <>
          <button
            type="button"
            aria-label="이전 추천작"
            onClick={() => emblaApi?.scrollPrev()}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-panel/95 p-1.5 text-fg-2 transition-colors hover:bg-raised hover:text-fg sm:grid"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label="다음 추천작"
            onClick={() => emblaApi?.scrollNext()}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-panel/95 p-1.5 text-fg-2 transition-colors hover:bg-raised hover:text-fg sm:grid"
          >
            <ChevronRight size={18} />
          </button>
          {/* 자동회전 진행바 — 슬라이드 전환마다 재시작, 호버 시 일시정지(autoplay 동기). 정지 시 멈춤. */}
          <span
            key={selected}
            aria-hidden
            style={{ animationPlayState: isPlaying ? undefined : "paused" }}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left rounded-full bg-accent/75 [animation:hero-progress_5500ms_linear] group-hover:[animation-play-state:paused]"
          />
          <div className="relative mt-3 flex items-center justify-center gap-1.5">
            {slides.map((t, i) => (
              <button
                key={t.id}
                type="button"
                aria-label={`${i + 1}번째 추천작 보기`}
                aria-current={i === selected}
                onClick={() => emblaApi?.scrollTo(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === selected ? "w-5 bg-accent" : "w-1.5 bg-line hover:bg-line-strong"
                }`}
              />
            ))}
            <button
              type="button"
              onClick={toggleAutoplay}
              aria-label={isPlaying ? "자동 재생 멈춤" : "자동 재생 시작"}
              aria-pressed={!isPlaying}
              className="absolute right-0 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-fg-3 transition-colors hover:text-fg focus-visible:text-fg"
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
