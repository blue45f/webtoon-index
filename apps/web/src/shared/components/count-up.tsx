import { useEffect, useState } from "react";

import { cn } from "@/shared/lib/utils";

// 마운트 시 0 → value 카운트업 (ease-out-quart) + fx.css `count-pop`(톡 솟구쳤다 안착).
// reduced-motion 이면 카운트업은 즉시 표시되고, fx.css 가 pop 모션을 무효화한다(가시성 유지).
export function CountUp({
  value,
  duration = 1.1,
  suffix = "",
  className,
  separator = false,
  style,
}: {
  value: number;
  duration?: number;
  suffix?: string;
  className?: string;
  /** 천 단위 구분 기호(ko-KR) 적용 — 대형 인덱스 넘버럴 가독성. */
  separator?: boolean;
  /** 호출부에서 색과 굵기를 주입할 수 있는 인라인 스타일. */
  style?: React.CSSProperties;
}) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce ? 0 : duration; // reduced-motion 이면 즉시 (첫 프레임에 완료)
    let raf = 0;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = dur <= 0 ? 1 : Math.min(1, (ts - start) / (dur * 1000));
      const eased = 1 - Math.pow(1 - p, 4);
      setN(value * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const rounded = Math.round(n);
  return (
    <span className={cn("count-pop is-revealed", className)} style={style}>
      {separator ? rounded.toLocaleString("ko-KR") : rounded}
      {suffix}
    </span>
  );
}
