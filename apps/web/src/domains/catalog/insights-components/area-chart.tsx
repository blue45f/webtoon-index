
import { cn } from "@/shared/lib/utils";
import { useInView } from "@/src/hooks/use-in-view";

export interface AreaPoint {
  label: string | number;
  value: number;
}

/**
 * 단색 영역/라인 차트 — 순수 SVG path.
 * 시계열(연도별 추이 등)에 사용. viewBox 좌표계 기반으로 반응형.
 * 영역 채움(저채도 그라디언트) + 상단 스트로크 라인 + 데이터 도트.
 * reveal 시 라인이 좌→우로 그려지고(node-draw) 도트가 순차로 팝인.
 */
export function AreaChart({
  points,
  color = "var(--color-accent)",
  height = 132,
  className,
  showDots = true,
  highlightLast = true,
}: {
  points: AreaPoint[];
  color?: string;
  height?: number;
  className?: string;
  showDots?: boolean;
  /** 마지막 포인트(최신)를 악센트 도트로 강조 */
  highlightLast?: boolean;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const W = 320;
  const H = 100;
  const padX = 6;
  const padTop = 10;
  const padBottom = 16;
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const xy = points.map((p, i) => {
    const x = padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = padTop + (1 - p.value / max) * innerH;
    return { x, y, ...p };
  });

  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baseY = padTop + innerH;
  const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${baseY} L${xy[0].x.toFixed(1)},${baseY} Z`;
  const gid = `area-fill-${Math.round((xy[0]?.value ?? 0) + n * 7)}`;
  // 라인 draw 시간(도트 stagger 와 동기). reveal 전엔 0(가려짐).
  const lineDrawMs = 900;

  return (
    <div ref={ref} className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* baseline 해어라인 */}
        <line
          x1={padX}
          y1={baseY}
          x2={W - padX}
          y2={baseY}
          stroke="var(--color-line)"
          strokeWidth="0.75"
        />
        {/* 영역 채움 — 라인이 다 그려질 즈음 페이드인 */}
        <path
          d={area}
          fill={`url(#${gid})`}
          style={{
            opacity: inView ? 1 : 0,
            transition: "opacity 600ms var(--ease-out-expo)",
            transitionDelay: `${lineDrawMs * 0.5}ms`,
          }}
        />
        {/* 라인 — pathLength 정규화 후 dashoffset 으로 좌→우 그리기 */}
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          style={{
            strokeDasharray: 1,
            strokeDashoffset: inView ? 0 : 1,
            transition: `stroke-dashoffset ${lineDrawMs}ms var(--ease-out-quint)`,
          }}
        />
        {showDots &&
          xy.map((p, i) => {
            const isLast = highlightLast && i === n - 1;
            // 라인이 그 지점을 지날 때쯤 도트가 팝인 (좌→우 stagger)
            const delay = (n <= 1 ? 0 : (i / (n - 1)) * lineDrawMs) + (isLast ? 60 : 0);
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={isLast ? 3 : 1.8}
                fill={isLast ? color : "var(--color-canvas)"}
                stroke={color}
                strokeWidth={isLast ? 0 : 1.4}
                vectorEffect="non-scaling-stroke"
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  opacity: inView ? 1 : 0,
                  transform: inView ? "scale(1)" : "scale(0.4)",
                  transition: `opacity 240ms var(--ease-out-expo) ${delay}ms, transform 240ms var(--ease-out-quint) ${delay}ms`,
                }}
              />
            );
          })}
      </svg>
      {/* x축 라벨 (양끝 + 중간 일부) — 숨김 라벨은 0폭으로 접어 데이터 포인트가 많아도
          라벨 행이 컨테이너를 넘어 가로 오버플로를 만들지 않게 한다(모바일 가드). */}
      <div className="mt-1 flex justify-between gap-1 overflow-hidden px-1">
        {xy.map((p, i) => {
          const show = n <= 7 || i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0;
          return (
            <span
              key={i}
              aria-hidden={!show}
              className={cn(
                "tnum whitespace-nowrap text-[0.68rem] text-fg-3",
                !show && "w-0 overflow-hidden opacity-0",
                highlightLast && i === n - 1 && "font-medium text-fg-2"
              )}
            >
              {String(p.label).slice(2)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
