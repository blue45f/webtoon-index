import { cn } from "@/shared/lib/utils";

export interface WeightedTag {
  tag: string;
  count: number;
}

/**
 * 가중 태그 클라우드 — count 에 따라 글자 크기/불투명도 변주.
 * 색은 라인색~크림 사이 보간(악센트 충돌 회피), 상위 태그만 악센트 틴트.
 */
export function TagCloud({
  tags,
  className,
}: {
  tags: WeightedTag[];
  className?: string;
}) {
  const max = Math.max(1, ...tags.map((t) => t.count));
  const min = Math.min(...tags.map((t) => t.count));
  const span = Math.max(1, max - min);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-2", className)}>
      {tags.map(({ tag, count }) => {
        const t = (count - min) / span; // 0~1
        const fontRem = 0.78 + t * 0.74; // 0.78rem ~ 1.52rem
        const opacity = 0.5 + t * 0.5;
        const strong = t > 0.66;
        return (
          <span
            key={tag}
            className={cn(
              "inline-flex items-baseline gap-0.5 font-medium leading-none transition-colors",
              strong ? "text-accent" : "text-fg"
            )}
            style={{ fontSize: `${fontRem}rem`, opacity }}
            title={`${count}개 작품`}
          >
            <span className={cn(strong ? "text-accent/60" : "text-fg-3")}>#</span>
            {tag}
            <span className="numeral ml-0.5 text-[0.72rem] text-fg-3">{count}</span>
          </span>
        );
      })}
    </div>
  );
}
