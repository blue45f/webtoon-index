import { cx } from "@/shared/lib/cx";
import { genreTint, genreBorder, genreTextColor } from "@/shared/lib/genre-color";

// 장르 스펙트럼 칩 — 장르별 고유 hue 틴트
export function GenreChip({
  genre,
  active,
  size = "md",
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  genre: string;
  active?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border font-medium transition-colors duration-150 ease-out-expo",
        size === "sm" ? "px-2 py-0.5 text-[0.7rem]" : "px-2.5 py-1 text-xs",
        className
      )}
      style={{
        color: genreTextColor(genre, active ? 0.92 : 0.82),
        backgroundColor: genreTint(genre, active ? 0.26 : 0.13),
        borderColor: genreBorder(genre, active ? 0.6 : 0.28),
      }}
      {...props}
    >
      {genre}
    </span>
  );
}

// 일반 태그 칩 (작품 특성 태그). 토글 가능.
export function TagChip({
  label,
  active,
  size = "md",
  prefix = "#",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  size?: "sm" | "md";
  prefix?: string;
}) {
  const interactive = !!props.onClick;
  return (
    <button
      type="button"
      disabled={!interactive ? true : props.disabled}
      className={cx(
        "inline-flex items-center rounded-full border font-medium transition-all duration-150 ease-out-expo",
        size === "sm" ? "px-2 py-0.5 text-[0.7rem]" : "px-2.5 py-1 text-xs",
        active
          ? "border-accent/60 bg-accent-soft text-accent"
          : "border-line bg-raised/50 text-fg-2 hover:text-fg hover:border-line-strong",
        !interactive && "disabled:opacity-100 cursor-default",
        className
      )}
      {...props}
    >
      {prefix && <span className="opacity-50">{prefix}</span>}
      {label}
    </button>
  );
}

// 상태/메타 뱃지
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad" | "cool";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-raised text-fg-2 border-line",
    accent: "bg-accent-soft text-accent border-accent/30",
    good: "border-[color:oklch(0.8_0.15_150/0.3)] text-good bg-[oklch(0.8_0.15_150/0.12)]",
    warn: "border-[color:oklch(0.82_0.15_80/0.3)] text-warn bg-[oklch(0.82_0.15_80/0.12)]",
    bad: "border-[color:oklch(0.66_0.2_25/0.35)] text-bad bg-[oklch(0.66_0.2_25/0.14)]",
    cool: "border-[color:oklch(0.8_0.11_232/0.3)] text-cool bg-[oklch(0.8_0.11_232/0.12)]",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium leading-none",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
