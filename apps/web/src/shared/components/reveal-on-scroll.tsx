import { useReveal } from "@toonspectrum/core/fx";
import { createElement } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * RevealOnScroll — 공용 스크롤 진입 래퍼.
 *
 * 공유 `useReveal`(IntersectionObserver, once)로 요소가 처음 뷰포트에 들어올 때 fx.css 의
 * `reveal`/`reveal-soft` from-state 를 `is-revealed` 로 안착시킵니다. 가시성은 모션과 분리돼
 * (CLS 0) JS/IO 미지원·reduced-motion 에서도 콘텐츠가 항상 또렷이 보입니다.
 *
 * - variant="up"(기본): 살짝 내려가 투명 → 위로 안착(reveal).
 * - variant="fade": 투명 → 페이드(reveal-soft).
 * - delayMs: 형제 목록 스태거(--reveal-delay).
 */
export interface RevealOnScrollProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: "up" | "fade";
  /** 스태거 지연(ms) — fx.css 가 --reveal-delay 로 소비. */
  delayMs?: number;
  /** 렌더 태그(기본 "div"). */
  as?: "div" | "section" | "li";
}

export function RevealOnScroll({
  children,
  variant = "up",
  delayMs = 0,
  as: Tag = "div",
  className,
  style,
  ...rest
}: RevealOnScrollProps) {
  // 다형 태그(div/section/li)라 ref 는 공통 상위 Element 로 받는다(태그별 정확 ref 타입 충돌 회피).
  const { ref, revealed } = useReveal<Element>();
  // JSX 로 다형 태그를 렌더하면 ref 타입이 태그별로 교차돼 콜백 ref 와 충돌한다.
  // createElement 로 우회해 단일 콜백 ref(Element) 시그니처로 정렬한다.
  return createElement(
    Tag,
    {
      ref,
      className: cn(
        variant === "fade" ? "reveal-soft" : "reveal",
        revealed && "is-revealed",
        className,
      ),
      style: delayMs ? { ...style, ["--reveal-delay" as string]: delayMs } : style,
      ...rest,
    },
    children,
  );
}

export default RevealOnScroll;
