import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

/**
 * LoadingState — 공용 동적 로딩 표시.
 *
 * 정적 "불러오는 중…" / "로딩" 텍스트를 대체하는 동적 표현:
 *  - variant="skeleton" (기본): shimmer 스켈레톤 골격(DESIGN.md "스켈레톤 로딩, 스피너 금지" 준수).
 *    `skeleton` 유틸(@layer)의 --animate-shimmer 흐름을 그대로 사용.
 *  - variant="cards"   : 카드 그리드 스켈레톤(목록/그리드 라우트 폴백용).
 *  - variant="pulse"   : 펄스 도트 3개(스피너 대용 — 좁은 인라인 컨텍스트/버튼 옆 등).
 *
 * 접근성: role="status" + aria-busy + sr-only 라벨(label). 시각 요소는 aria-hidden.
 * prefers-reduced-motion 은 skeleton/펄스 애니메이션이 전역 가드로 자동 정지된다.
 *
 * @example 라우트/섹션 폴백
 *   import { LoadingState } from "@/shared/components/LoadingState";
 *   <Suspense fallback={<LoadingState variant="cards" />}> … </Suspense>
 *   {loading && <LoadingState label="리뷰 불러오는 중" />}
 *   <LoadingState variant="pulse" label="저장 중" />   // 인라인 펄스
 */
export interface LoadingStateProps {
  /** 표현 방식. 기본 "skeleton". */
  variant?: "skeleton" | "cards" | "pulse";
  /** sr-only 상태 라벨(스크린리더). 기본 "불러오는 중". */
  label?: string;
  /** variant="cards" 일 때 카드 개수. 기본 8. */
  cardCount?: number;
  /** 추가 클래스(루트). */
  className?: string;
}

/** 펄스 도트(스피너 대용) — pulse-soft 키프레임을 도트마다 stagger. */
function PulseDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-accent"
          style={{
            animation: "var(--animate-pulse-soft)",
            animationDelay: `${i * 180}ms`,
          }}
        />
      ))}
    </span>
  );
}

export function LoadingState({
  variant = "skeleton",
  label,
  cardCount = 8,
  className,
}: LoadingStateProps) {
  const t = useT();
  const resolvedLabel = label ?? t("common.loading");

  if (variant === "pulse") {
    return (
      <span
        role="status"
        aria-busy="true"
        aria-label={resolvedLabel}
        className={cn("inline-flex items-center gap-2 text-sm text-fg-2", className)}
      >
        <PulseDots />
        <span className="sr-only">{resolvedLabel}</span>
      </span>
    );
  }

  if (variant === "cards") {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={resolvedLabel}
        className={cn("w-full", className)}
      >
        <div className="flex flex-col gap-3" aria-hidden="true">
          <span className="skeleton h-3 w-24" />
          <span className="skeleton h-9 w-2/3 max-w-md" />
          <span className="skeleton h-4 w-1/2 max-w-sm" />
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: cardCount }).map((_, i) => (
            <span key={i} className="skeleton aspect-[3/4] w-full rounded-2xl" aria-hidden="true" />
          ))}
        </div>
        <span className="sr-only">{resolvedLabel}</span>
      </div>
    );
  }

  // skeleton (기본) — 텍스트 블록 골격.
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={resolvedLabel}
      className={cn("flex w-full max-w-full flex-col gap-2.5", className)}
    >
      <span className="skeleton h-4 w-3/4" aria-hidden="true" />
      <span className="skeleton h-4 w-full" aria-hidden="true" />
      <span className="skeleton h-4 w-5/6" aria-hidden="true" />
      <span className="sr-only">{resolvedLabel}</span>
    </div>
  );
}

export default LoadingState;
