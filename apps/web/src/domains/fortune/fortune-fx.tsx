import { motion } from "motion/react";
import { useEffect, useState } from "react";

// 운세 페이지 공용 화려 이펙트 모음.

// prefers-reduced-motion 여부(커스텀 rAF 이펙트용 — MotionConfig는 motion 컴포넌트만 가드)
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// 숫자 카운트업 — 0에서 value까지 이징 애니메이션
export function CountUp({
  value,
  className,
  durationMs = 950,
  style,
}: {
  value: number;
  className?: string;
  durationMs?: number;
  style?: React.CSSProperties;
}) {
  const reduced = usePrefersReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setN(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setN(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, reduced]);

  return <span className={className} style={style}>{n}</span>;
}

// 컨페티 버스트 — 고득점 등 축하 순간에 방사형으로 터지는 파티클
const CONFETTI_HUES = [42, 150, 250, 350, 90, 200];
export function ConfettiBurst({ count = 26 }: { count?: number }) {
  // motion 컴포넌트라 MotionConfig reducedMotion=user가 자동 가드
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-visible">
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 2 ? 0.3 : 0);
        const dist = 70 + (i % 5) * 22;
        const hue = CONFETTI_HUES[i % CONFETTI_HUES.length];
        const isCircle = i % 3 === 0;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{
              width: isCircle ? 7 : 5,
              height: isCircle ? 7 : 10,
              borderRadius: isCircle ? 999 : 2,
              background: `oklch(0.78 0.18 ${hue})`,
              boxShadow: `0 0 8px oklch(0.78 0.18 ${hue} / 0.7)`,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
            animate={{
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist + 30,
              opacity: 0,
              scale: 0.4,
              rotate: (i % 2 ? 1 : -1) * 320,
            }}
            transition={{ duration: 1.1 + (i % 4) * 0.15, ease: "easeOut", delay: (i % 6) * 0.03 }}
          />
        );
      })}
    </div>
  );
}
