import { cn } from "@/shared/lib/utils";

/**
 * 벤토 패널 — eyebrow + 제목 + (차트) + 하단 "인사이트" 캡션.
 * 대시보드 모든 칸의 공통 셸. surface-hl + 라인 보더로 다크 깊이감.
 * span* props 로 그리드 칸 크기를 가변(에디토리얼 리듬).
 */
export function Panel({
  eyebrow,
  title,
  children,
  insight,
  aside,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
  /** 하단 한 줄 인사이트 (데이터 해석). */
  insight?: React.ReactNode;
  /** 제목 우측 보조 슬롯 (예: 합계 뱃지) */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-line bg-card p-5 surface-hl sm:p-6",
        className
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5 text-accent">{eyebrow}</p>
          <h3 className="text-pretty text-base font-bold leading-tight tracking-tight text-fg sm:text-lg">
            {title}
          </h3>
        </div>
        {aside != null && <div className="shrink-0">{aside}</div>}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
      {insight != null && (
        <p className="mt-4 border-t border-line pt-3 text-[0.8rem] leading-relaxed text-fg-3">
          <span className="eyebrow mr-1.5 text-fg-2">인사이트</span>
          {insight}
        </p>
      )}
    </section>
  );
}
