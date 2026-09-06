
import { cn } from "@/shared/lib/utils";
import { useInView } from "@/src/hooks/use-in-view";

export interface BarListItem {
  label: string;
  value: number;
  /** 바 색상 (CSS color). 없으면 라인색 폴백 */
  color?: string;
  /** 라벨 옆에 표시할 보조 텍스트 (예: 평점 4.7) */
  meta?: React.ReactNode;
  /** 라벨 앞 도트 노출 여부 */
  dot?: boolean;
}

/**
 * 가로 막대 리스트 — 라벨 + 값 비율 바.
 * CSS flex 기반. 다크 배경에서 읽히도록 트랙(bg-raised) + 채움(컬러).
 * value 는 max(또는 최대값) 대비 비율로 폭 계산.
 * reveal 시 위에서부터 순차로 좌→우 채워진다(transform scaleX, 레이아웃 무관).
 */
export function BarList({
  items,
  max,
  valueFormat = (v) => String(v),
  className,
  barClassName,
  trackClassName,
  minPct = 3,
}: {
  items: BarListItem[];
  max?: number;
  valueFormat?: (v: number) => string;
  className?: string;
  barClassName?: string;
  trackClassName?: string;
  /** 0 이 아닌 값의 최소 표시 폭(%) */
  minPct?: number;
}) {
  const [ref, inView] = useInView<HTMLUListElement>();
  const peak = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul ref={ref} className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item, i) => {
        const ratio = item.value / peak;
        const pct = item.value <= 0 ? 0 : Math.max(minPct, ratio * 100);
        const color = item.color ?? "var(--color-line-strong)";
        return (
          <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {item.dot && (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
              )}
              <span className="truncate text-sm text-fg-2">{item.label}</span>
              {item.meta != null && (
                <span className="tnum shrink-0 text-xs text-fg-3">{item.meta}</span>
              )}
            </div>
            <span className="numeral text-sm text-fg tabular-nums">{valueFormat(item.value)}</span>
            <div
              className={cn(
                "col-span-2 h-2 overflow-hidden rounded-full bg-raised",
                trackClassName
              )}
            >
              <div
                className={cn(
                  "h-full origin-left rounded-full transition-transform duration-[700ms] ease-out-quint",
                  barClassName
                )}
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                  transform: inView ? "scaleX(1)" : "scaleX(0)",
                  transitionDelay: `${Math.min(i, 9) * 55}ms`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
