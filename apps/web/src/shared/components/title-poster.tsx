import { AdultOverlay } from "./adult-overlay";
import { CoverImage } from "./cover-image";

import type { Title } from "@/shared/lib/types";

import { cx } from "@/shared/lib/cx";

const SIZE = {
  sm: { pad: "p-2.5", title: "text-sm leading-[1.15]", type: "text-[0.58rem]", wm: "text-[3.8rem]" },
  md: { pad: "p-3", title: "text-base leading-[1.12]", type: "text-[0.62rem]", wm: "text-[5.3rem]" },
  lg: { pad: "p-4", title: "text-xl leading-[1.1]", type: "text-xs", wm: "text-[7.4rem]" },
  hero: { pad: "p-5", title: "text-3xl leading-[1.05]", type: "text-sm", wm: "text-[10.5rem]" },
} as const;

// 타이포그래픽 커버 — 실제 이미지 대신 장르 그라디언트 + 활자 포스터
export function TitlePoster({
  title,
  size = "md",
  className,
  rank,
  priority,
  unframed = false,
  titleAs: TitleTag = "h3",
}: {
  title: Title;
  size?: keyof typeof SIZE;
  className?: string;
  rank?: number;
  priority?: boolean;
  unframed?: boolean;
  // 표지 오버레이 제목의 시맨틱 태그. 상위 카드가 별도 제목을 가질 땐 "div"로 내려 heading 중복/순서 위반 방지.
  titleAs?: "h2" | "h3" | "div";
}) {
  const s = SIZE[size];
  const [from, to] = title.cover;
  const isNovel = title.type === "webnovel";
  const glyph = title.title.replace(/[^가-힣A-Za-z0-9]/g, "").charAt(0) || "W";
  const issue = String(title.releaseYear).slice(-2);
  const glyphNode = (
    <div
      className={cx(
        "absolute -right-3 top-1 select-none font-bold leading-none text-[oklch(0.96_0.01_85/0.14)] mix-blend-overlay",
        isNovel ? "font-serif" : "font-display",
        s.wm
      )}
      aria-hidden
    >
      {glyph}
    </div>
  );

  return (
    <div
      className={cx(
        "relative aspect-[3/4] w-full overflow-hidden bg-card shadow-[inset_0_1px_0_oklch(1_0_0/0.14)]",
        !unframed && "rounded-xl border border-[oklch(0.95_0.01_85/0.16)]",
        className
      )}
      style={{
        background: `linear-gradient(145deg, color-mix(in oklch, ${from} 88%, oklch(0.24 0.012 66)), color-mix(in oklch, ${to} 82%, oklch(0.15 0.008 70)))`,
      }}
    >
      {title.coverImage && (
        <CoverImage
          src={title.coverImage}
          alt={`${title.title} 표지`}
          fallback={glyphNode}
          priority={priority}
          className="absolute inset-0 size-full object-cover contrast-[1.03] saturate-[1.04]"
        />
      )}

      <div
        className="absolute inset-0"
        style={{
          background: title.coverImage
            ? "linear-gradient(to top, oklch(0.13 0.012 70 / 0.86), oklch(0.13 0.012 70 / 0.22) 46%, oklch(0.13 0.012 70 / 0.08)), radial-gradient(120% 80% at 16% 0%, oklch(0.95 0.01 85 / 0.24), transparent 56%)"
            : "radial-gradient(120% 80% at 15% 0%, oklch(0.98 0.01 85 / 0.2), transparent 54%), linear-gradient(to top, oklch(0.13 0.012 70 / 0.82), oklch(0.13 0.012 70 / 0.2) 48%, transparent)",
        }}
      />
      <div className="noise pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-overlay" aria-hidden />

      {!title.coverImage && glyphNode}

      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-[linear-gradient(to_bottom,oklch(0.95_0.01_85/0.26),oklch(0.72_0.185_42/0.75),oklch(0.95_0.01_85/0.14))]" />
      <div className="pointer-events-none absolute left-3 right-3 top-3 h-px bg-[oklch(0.95_0.01_85/0.28)]" />
      <div className="pointer-events-none absolute bottom-3 right-3 h-10 w-px bg-[oklch(0.95_0.01_85/0.2)]" />

      <div className={cx("absolute left-0 top-0 flex items-center gap-1.5", s.pad)}>
        <span
          className={cx(
            "rounded-md border border-[oklch(0.95_0.01_85/0.28)] bg-[oklch(0.16_0.01_70/0.56)] px-1.5 py-0.5 font-display font-semibold uppercase text-[oklch(0.95_0.01_85/0.9)] backdrop-blur-sm",
            s.type
          )}
        >
          {isNovel ? "NOVEL" : "TOON"}
        </span>
        {size !== "sm" && (
          <span className={cx("font-display font-semibold text-[oklch(0.95_0.01_85/0.62)]", s.type)}>
            IDX {issue}
          </span>
        )}
      </div>

      {rank != null && (
        <div className="absolute right-2 top-2 rounded-lg border border-[oklch(0.95_0.01_85/0.22)] bg-[oklch(0.16_0.01_70/0.56)] px-1.5 py-1 numeral text-2xl leading-none text-[oklch(0.95_0.01_85)] shadow-[0_8px_18px_-12px_oklch(0.1_0.02_70/0.8)] backdrop-blur-sm">
          {rank}
        </div>
      )}

      <div className={cx("absolute inset-x-0 bottom-0 flex flex-col gap-1", s.pad)}>
        <TitleTag
          className={cx(
            "text-balance line-clamp-3 font-bold text-[oklch(0.97_0.012_85)] drop-shadow-[0_1px_8px_oklch(0.1_0.02_70/0.72)]",
            isNovel ? "font-serif" : "",
            s.title
          )}
        >
          {title.title}
        </TitleTag>
        {size !== "sm" && (
          <p className="truncate text-xs text-[oklch(0.92_0.01_85/0.72)]">
            {title.author}
            {title.artist && title.artist !== title.author ? ` · 그림 ${title.artist}` : ""}
          </p>
        )}
      </div>

      {/* 19금 성인 인증 게이트 — 실제 표지 있을 때만 연령 확인 버튼(타이포 표지는 가릴 게 없어 표시만) */}
      {title.ageRating === "19" && (
        <AdultOverlay compact={size === "sm"} hasCover={Boolean(title.coverImage)} />
      )}
    </div>
  );
}
