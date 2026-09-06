import { useCarousel } from "@toonspectrum/core/carousel";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/shared/lib/utils";

/**
 * 공유 가로 캐러셀(웹) — embla 헤드리스 로직(@toonspectrum/core/carousel)을 Tailwind 로 입힌 뷰.
 * 렌더링은 이 컴포넌트가 맡고, 동작은 공용 헤드리스 훅을 재사용합니다.
 *
 * 제공: 스냅 · 관성 드래그(dragFree) · free-scroll · 다음 카드 peek · 데스크톱 화살표 · 닷 인디케이터
 *       · 키보드(←/→/Home/End) · aria(roledescription="carousel"/"slide", 닷 aria-current).
 *
 * peek 은 트랙 좌우 패딩(edgePadding) + 아이템 폭(itemClassName)으로 만든다 — 마지막 카드까지
 * containScroll:"trimSnaps" 로 끝이 깔끔하게 맞는다. 트랙 자체는 음수 마진 없이 패딩만 준다.
 */
export function Carousel({
  children,
  className,
  itemClassName = "w-[150px] sm:w-[172px]",
  ariaLabel,
  /** 좌우 가장자리 패딩(컨테이너 블리드) — 화면 끝에서 카드가 잘리지 않게. 기본 px-4 sm:px-0 느낌. */
  edgePaddingClassName = "px-4 sm:px-0",
  gapClassName = "gap-3.5",
}: {
  children: React.ReactNode[];
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
  edgePaddingClassName?: string;
  gapClassName?: string;
}) {
  const items = children.filter((child) => child !== null && child !== false && child !== undefined);
  const { emblaRef, selectedIndex, snapCount, canPrev, canNext, scrollPrev, scrollNext, scrollTo, hasPagination, onKeyDown } =
    useCarousel({ active: items.length > 1 });

  return (
    // 화살표/Home/End 키보드 내비는 W3C 캐러셀 패턴(role=group + aria-roledescription=carousel)의
    // 표준 동작이라 컨테이너에 onKeyDown 을 둔다. 포커스 가능한 화살표 버튼·닷이 별도로 있어 키보드
    // 사용자는 그쪽으로도 조작 가능하므로 컨테이너에 tabIndex 는 두지 않는다(비상호작용 tabIndex 회피).
    // 컨테이너 onKeyDown 만 표준 ARIA 캐러셀 패턴이라 비상호작용 요소 핸들러 규칙을 의도적으로 끈다.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 표준 ARIA 캐러셀 키보드 내비(화살표/Home/End)
    <div
      className={cn("group/carousel relative", className)}
      role="group"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {/* viewport — overflow-hidden. 음수 마진 없이 좌우 패딩으로 가장자리 peek 여백 확보. */}
      <div className={cn("overflow-hidden", edgePaddingClassName)} ref={emblaRef}>
        <div className={cn("flex", gapClassName)}>
          {items.map((child, i) => (
            <div key={i} className={cn("min-w-0 shrink-0", itemClassName)} aria-roledescription="slide">
              {child}
            </div>
          ))}
        </div>
      </div>

      {hasPagination && (
        <>
          {/* 데스크톱 화살표 — 끝에 닿으면 비활성(opacity/pointer-none). 모바일은 드래그가 주 인터랙션이라 숨김. */}
          <button
            type="button"
            aria-label="이전"
            disabled={!canPrev}
            onClick={scrollPrev}
            className="absolute -left-3 top-[42%] z-10 hidden -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-panel/95 p-1.5 text-fg-2 shadow-[0_8px_24px_-12px_oklch(0_0_0/0.5)] backdrop-blur-sm transition-[opacity,background,color] duration-150 hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-0 sm:grid"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label="다음"
            disabled={!canNext}
            onClick={scrollNext}
            className="absolute -right-3 top-[42%] z-10 hidden -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-panel/95 p-1.5 text-fg-2 shadow-[0_8px_24px_-12px_oklch(0_0_0/0.5)] backdrop-blur-sm transition-[opacity,background,color] duration-150 hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-0 sm:grid"
          >
            <ChevronRight size={18} />
          </button>

          {/* 닷 인디케이터 — 스냅(페이지)당 한 점. aria-current 로 현재 페이지 표시. */}
          <div className="mt-2 flex items-center justify-center" role="tablist" aria-label="페이지">
            {Array.from({ length: snapCount }).map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-label={`${i + 1}페이지로 이동`}
                aria-current={i === selectedIndex}
                aria-selected={i === selectedIndex}
                onClick={() => scrollTo(i)}
                // 탭 영역은 24px 이상(터치 타겟), 보이는 점은 내부 span 으로 작게 유지.
                className="group/dot grid size-6 place-items-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    "block h-1.5 rounded-full transition-all duration-200",
                    i === selectedIndex ? "w-5 bg-accent" : "w-1.5 bg-line group-hover/dot:bg-line-strong"
                  )}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
