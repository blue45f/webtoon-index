import { useState } from "react";

import { spectrumGradient, genreTextColor } from "@/shared/lib/genre-color";
import { cn } from "@/shared/lib/utils";
import { useInView } from "@/src/hooks/use-in-view";

// 장르 믹스 스펙트럼 — 작품의 장르들을 가로 그라디언트로.
// 시그니처 데이터 모티프: reveal 시 좌→우로 채워지고(reveal),
// interactive 모드에선 커서 스크럽으로 그 지점의 장르를 짚어준다.
export function GenreSpectrum({
  genres,
  className,
  height = 4,
  interactive = false,
  label,
}: {
  genres: string[];
  className?: string;
  height?: number;
  /** 호버 스크럽(플레이헤드 + 장르 라벨) 활성화 */
  interactive?: boolean;
  /** 접근성 라벨 (interactive 일 때 role=img 로 노출) */
  label?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [scrub, setScrub] = useState<{ x: number; genre: string } | null>(null);

  const list = genres.length ? genres : ["로맨스", "판타지", "액션"];
  const fillGenre = (ratio: number) => {
    if (list.length <= 1) return list[0];
    const idx = Math.min(list.length - 1, Math.round(ratio * (list.length - 1)));
    return list[idx];
  };

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setScrub({ x: ratio, genre: fillGenre(ratio) });
  }

  return (
    <div
      ref={ref}
      className={cn(
        "group/spectrum relative w-full overflow-hidden rounded-full",
        interactive && "cursor-ew-resize",
        className
      )}
      style={{ height }}
      onPointerMove={onMove}
      onPointerLeave={() => setScrub(null)}
      role={interactive ? "img" : undefined}
      aria-label={interactive ? (label ?? `장르 스펙트럼: ${list.join(", ")}`) : undefined}
      aria-hidden={interactive ? undefined : true}
    >
      {/* 어둑한 트랙 (채워지기 전 잔상) */}
      <div
        className="absolute inset-0 opacity-25"
        style={{ background: spectrumGradient(list) }}
      />
      {/* 채움 — clip-path inset 로 좌→우 reveal. transform 대신 clip(레이아웃 무관). */}
      <div
        className="absolute inset-0 transition-[clip-path] duration-[900ms] ease-out-quint"
        style={{
          background: spectrumGradient(list),
          clipPath: inView ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
        }}
      />
      {/* 스크럽 플레이헤드 */}
      {interactive && scrub && (
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-fg/80 mix-blend-screen"
          style={{ left: `${scrub.x * 100}%` }}
          aria-hidden
        />
      )}
      {/* 스크럽 장르 라벨 */}
      {interactive && scrub && (
        <span
          className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-0.5 text-[0.68rem] font-medium shadow-sm"
          style={{
            left: `${Math.min(92, Math.max(8, scrub.x * 100))}%`,
            color: genreTextColor(scrub.genre, 0.82),
          }}
          aria-hidden
        >
          {scrub.genre}
        </span>
      )}
    </div>
  );
}

// 평점 분포 바 (1~5점 누적) — 스펙트럼 톤. reveal 시 좌→우로 채워짐.
export function DistributionBars({
  dist,
  className,
}: {
  dist: [number, number, number, number, number];
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  // 손상된 분포값(음수/비유한)이 들어와도 막대가 깨지지 않도록 방어적으로 0 처리.
  const safe = dist.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = safe.reduce((a, b) => a + b, 0) || 1;
  const rows = [5, 4, 3, 2, 1];
  // 5점=따뜻한 악센트 계열 → 1점=차가운 회색, 점수별 hue
  const hue = (s: number) => {
    const map: Record<number, string> = {
      5: "oklch(0.72 0.185 42)",
      4: "oklch(0.74 0.13 60)",
      3: "oklch(0.72 0.07 90)",
      2: "oklch(0.62 0.04 80)",
      1: "oklch(0.5 0.03 70)",
    };
    return map[s];
  };
  return (
    <div ref={ref} className={cn("flex flex-col gap-1.5", className)}>
      {rows.map((s, i) => {
        const v = safe[s - 1];
        const pct = (v / total) * 100;
        return (
          <div key={s} className="flex items-center gap-2.5">
            <span className="numeral w-3 text-right text-xs text-fg-3">{s}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-raised">
              <div
                className="absolute inset-y-0 left-0 origin-left rounded-full transition-transform duration-700 ease-out-quint"
                style={{
                  width: `${pct}%`,
                  backgroundColor: hue(s),
                  transform: inView ? "scaleX(1)" : "scaleX(0)",
                  transitionDelay: `${i * 70}ms`,
                }}
              />
            </div>
            <span className="tnum w-10 text-right text-[0.7rem] text-fg-3">
              {pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 단일 미터 (트렌드/완독률/몰입지수). 라벨 + 값. reveal 시 채워짐.
export function MeterBar({
  value,
  max = 100,
  label,
  color = "var(--color-accent)",
  className,
  suffix = "",
}: {
  value: number;
  max?: number;
  label?: string;
  color?: string;
  className?: string;
  suffix?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <div ref={ref} className={cn("flex flex-col gap-1", className)}>
      {label && (
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-fg-2">{label}</span>
          <span className="numeral text-xs text-fg">
            {value}
            {suffix}
          </span>
        </div>
      )}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-raised">
        <div
          className="absolute inset-y-0 left-0 origin-left rounded-full transition-transform duration-[800ms] ease-out-expo"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            transform: inView ? "scaleX(1)" : "scaleX(0)",
          }}
        />
      </div>
    </div>
  );
}

// 장르 도트 (범례용)
