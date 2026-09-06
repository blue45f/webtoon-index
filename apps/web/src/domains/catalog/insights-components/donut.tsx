
import { cn } from "@/shared/lib/utils";
import { useInView } from "@/src/hooks/use-in-view";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/**
 * 도넛 차트 — CSS conic-gradient.
 * 비율 구성(가격 모델 분포 등)에 사용. 중앙에 총합/캡션 슬롯.
 * reveal 시 시계방향으로 그려진다(@property --donut-sweep 각도 마스크).
 * reduced-motion / 미지원 시엔 즉시 완성된 도넛으로 노출.
 */
export function Donut({
  segments,
  size = 132,
  thickness = 18,
  center,
  className,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  center?: React.ReactNode;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  // 무변이 prefix-sum 으로 각 세그먼트의 시작/끝 각도 계산
  const stops = segments
    .map((s, i) => {
      const before = segments.slice(0, i).reduce((a, x) => a + x.value, 0);
      const start = (before / total) * 360;
      const end = ((before + s.value) / total) * 360;
      return `${s.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    })
    .join(", ");

  return (
    <div ref={ref} className={cn("flex flex-col items-center gap-4 sm:flex-row sm:gap-5", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img">
        {/* 컬러 링 — 시계방향 reveal: --donut-sweep 각도까지만 보이도록 conic 마스크.
            reveal 전엔 0deg(가려짐), reveal 시 360deg 로 애니메이션 → 그려짐.
            마스크는 링에만 적용하고, 가운데 구멍·센터는 별도 레이어로 분리. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(${stops})`,
            ["--donut-sweep" as string]: inView ? "360deg" : "0deg",
            // 마스크는 알파 채널만 사용(가시색 아님). hex 대신 OKLCH 알파로 표기.
            WebkitMaskImage:
              "conic-gradient(oklch(0 0 0 / 1) 0deg, oklch(0 0 0 / 1) var(--donut-sweep), oklch(0 0 0 / 0) var(--donut-sweep))",
            maskImage:
              "conic-gradient(oklch(0 0 0 / 1) 0deg, oklch(0 0 0 / 1) var(--donut-sweep), oklch(0 0 0 / 0) var(--donut-sweep))",
            animation: inView ? "donut-sweep 0.85s var(--ease-out-quint) both" : undefined,
          }}
        />
        {/* 가운데 구멍 */}
        <div className="absolute rounded-full bg-card" style={{ inset: thickness }} />
        {center != null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {center}
          </div>
        )}
      </div>
      <ul className="flex w-full flex-col gap-2">
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          return (
            <li key={s.label} className="flex items-center gap-2.5">
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-fg-2">{s.label}</span>
              <span className="numeral text-sm text-fg tabular-nums">{pct.toFixed(0)}%</span>
              <span className="tnum w-7 text-right text-xs text-fg-3">{s.value}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
