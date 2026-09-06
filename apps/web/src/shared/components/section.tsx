import { ArrowRight } from "lucide-react";

import { buttonClass } from "./ui/button-utils";
import { Carousel } from "./ui/carousel";

import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

export { Container } from "./container";

export function Section({
  eyebrow,
  title,
  desc,
  action,
  children,
  className,
  tick = false,
  live = false,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  desc?: React.ReactNode;
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
  /** 영문 라벨 앞 시그니처 accent 틱 — 에디토리얼 섹션 리듬에 브랜드 맥동을 더한다(홈 전용). */
  tick?: boolean;
  /** 실시간 신호 섹션 — eyebrow 앞에 레이더처럼 확산하는 라이브 펄스 점(fx.css `pulse-dot`). */
  live?: boolean;
}) {
  return (
    <section className={cn(className)}>
      <header className="mb-4 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="eyebrow mb-1.5 flex items-center gap-2 text-accent">
              {/* 실시간 라이브 점은 틱보다 우선(둘 다 켜져도 라이브 신호가 의미상 강함). */}
              {live ? (
                <span aria-hidden className="pulse-dot shrink-0" />
              ) : (
                tick && (
                  <span
                    aria-hidden
                    className="h-2.5 w-0.5 shrink-0 rounded-full bg-accent motion-safe:[animation:pulse-soft_2.4s_ease-in-out_infinite]"
                  />
                )
              )}
              {eyebrow}
            </p>
          )}
          <h2 className="text-pretty text-xl font-bold tracking-tight text-fg sm:text-2xl">
            {title}
          </h2>
          {desc && <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{desc}</p>}
        </div>
        {action && (
          <Link
            href={action.href}
            className={buttonClass({ size: "sm", variant: "quiet", className: "group gap-1" })}
            // 링크 접근명에 섹션 제목을 포함해 "전체 보기" 같은 모호한 링크텍스트 문제 방지(문자열 제목 한정).
            aria-label={typeof title === "string" ? `${title} ${action.label}` : `${action.label} 바로가기`}
          >
            {action.label}
            <ArrowRight size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

// 가로 스크롤 레일 — embla 캐러셀(공유 <Carousel>) 위의 얇은 어댑터.
// 기존 호출부(홈 레일 전반: 이어보기·최근 본·추천·신작·에디터 픽·평점·무료·비슷한 작품)는 그대로
// 두면서 스냅·관성 드래그·다음 카드 peek·데스크톱 화살표·닷·키보드·aria 를 한 번에 얻는다.
export function Rail({
  children,
  className,
  itemClassName = "w-[150px] sm:w-[172px]",
  ariaLabel,
}: {
  children: React.ReactNode[];
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
}) {
  return (
    <Carousel className={className} itemClassName={itemClassName} ariaLabel={ariaLabel}>
      {children}
    </Carousel>
  );
}
