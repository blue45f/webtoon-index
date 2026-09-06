
import { cn } from "@/shared/lib/utils";
import { useInView } from "@/src/hooks/use-in-view";

export interface CompareMetric {
  label: string;
  /** 표시 문자열 (예: "4.6", "1.2억") */
  a: string;
  b: string;
  /** 비교 바 비율 계산용 원시값 */
  aRaw: number;
  bRaw: number;
}

/**
 * 두 그룹 비교 (웹툰 vs 웹소설) — 지표별 양방향 분할 바.
 * 가운데 기준선에서 좌(A)/우(B)로 뻗는 대비 바. 색상 2개로 구분.
 */
export function CompareSplit({
  aName,
  bName,
  aColor,
  bColor,
  aCount,
  bCount,
  metrics,
  className,
}: {
  aName: string;
  bName: string;
  aColor: string;
  bColor: string;
  aCount: number;
  bCount: number;
  metrics: CompareMetric[];
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("flex flex-col gap-4", className)}>
      {/* 헤더: 두 그룹 + 작품 수 */}
      <div className="flex items-stretch gap-2">
        <GroupHead name={aName} count={aCount} color={aColor} align="left" />
        <GroupHead name={bName} count={bCount} color={bColor} align="right" />
      </div>
      {/* 지표별 분할 바 — 가운데 기준선에서 좌/우로 동시에 뻗어나간다 */}
      <div className="flex flex-col gap-3">
        {metrics.map((m, i) => {
          const peak = Math.max(1, m.aRaw, m.bRaw);
          const aPct = Math.max(4, (m.aRaw / peak) * 100);
          const bPct = Math.max(4, (m.bRaw / peak) * 100);
          const delay = `${i * 80}ms`;
          return (
            <div key={m.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="numeral text-fg tabular-nums">{m.a}</span>
                <span className="text-[0.7rem] uppercase tracking-wide text-fg-3">{m.label}</span>
                <span className="numeral text-fg tabular-nums">{m.b}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full origin-right rounded-full transition-transform duration-[700ms] ease-out-quint"
                    style={{
                      width: `${aPct}%`,
                      backgroundColor: aColor,
                      transform: inView ? "scaleX(1)" : "scaleX(0)",
                      transitionDelay: delay,
                    }}
                  />
                </div>
                <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full origin-left rounded-full transition-transform duration-[700ms] ease-out-quint"
                    style={{
                      width: `${bPct}%`,
                      backgroundColor: bColor,
                      transform: inView ? "scaleX(1)" : "scaleX(0)",
                      transitionDelay: delay,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupHead({
  name,
  count,
  color,
  align,
}: {
  name: string;
  count: number;
  color: string;
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-0.5 rounded-xl border border-line bg-panel/50 px-3.5 py-2.5",
        align === "right" && "items-end text-right"
      )}
    >
      <div className={cn("flex items-center gap-1.5", align === "right" && "flex-row-reverse")}>
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-sm font-medium text-fg-2">{name}</span>
      </div>
      <div className={cn("flex items-baseline gap-1", align === "right" && "flex-row-reverse")}>
        <span className="numeral text-2xl text-fg">{count}</span>
        <span className="text-xs text-fg-3">작품</span>
      </div>
    </div>
  );
}
