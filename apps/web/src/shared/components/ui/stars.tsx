import { Star } from "lucide-react";

import { cx } from "@/shared/lib/cx";

const SIZES = { xs: 11, sm: 13, md: 16, lg: 22 } as const;

// 별점 표시 (0~5, 0.5 지원). 회색 별 위에 악센트 별을 너비%로 클립.
export function Stars({
  value,
  size = "md",
  className,
}: {
  value: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const px = SIZES[size];
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span
      role="img"
      className={cx("relative inline-flex shrink-0", className)}
      style={{ gap: px * 0.12 }}
      aria-label={`별점 ${value.toFixed(1)} / 5`}
    >
      <span className="inline-flex" style={{ gap: px * 0.12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={px}
            className="text-[oklch(0.48_0.018_68)]"
            strokeWidth={1.55}
          />
        ))}
      </span>
      <span
        className="absolute inset-0 inline-flex overflow-hidden"
        style={{ width: `${pct}%`, gap: px * 0.12 }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={px}
            className="shrink-0 fill-accent text-accent drop-shadow-[0_0_5px_oklch(0.72_0.185_42/0.34)]"
            strokeWidth={1.55}
          />
        ))}
      </span>
    </span>
  );
}

// 평점 + 숫자 묶음. estimated=합성 지표(카카오웹툰·웹소설)면 '≈'로 추정임을 표시.
export function RatingInline({
  value,
  count,
  size = "sm",
  estimated,
  className,
}: {
  value: number;
  count?: number;
  size?: keyof typeof SIZES;
  estimated?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx("inline-flex items-center gap-1.5", className)}
      title={estimated ? "추정 별점" : undefined}
    >
      <Stars value={value} size={size} />
      <span className="numeral text-sm text-fg">
        {estimated && <span className="text-fg-3" aria-hidden>≈</span>}
        {value.toFixed(1)}
      </span>
      {count != null && (
        <span className="text-xs text-fg-3 tnum">
          ({estimated ? "약 " : ""}
          {count.toLocaleString("ko-KR")})
        </span>
      )}
    </span>
  );
}
