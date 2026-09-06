import { ArrowRight } from "lucide-react";

import { HeroBannerBadge } from "./hero-banner-badge";

import type { Title } from "@/shared/lib/types";

import { genreColor, genreTextColor } from "@/shared/lib/genre-color";
import Link from "@/src/compat/router-link";

export function HeroBannerStatic({
  items,
  onActivate,
}: {
  items: Title[];
  onActivate?: () => void;
}) {
  const first = items[0];
  if (!first) return null;

  const primaryGenre = first.genres[0] ?? "드라마";
  const hue = genreColor(primaryGenre, 0.72);
  const isRestricted = first.ageRating === "19";
  const [coverFrom, coverTo] = first.cover;
  const glyph = first.title.replace(/[^가-힣A-Za-z0-9]/g, "").charAt(0) || "W";

  return (
    <div
      className="group relative"
      role="group"
      aria-label="이 주의 추천 작품"
      onPointerEnter={onActivate}
      onFocusCapture={onActivate}
    >
      <HeroBannerBadge />

      <div className="sheen-sweep overflow-hidden rounded-2xl border border-line bg-card surface-hl">
        <Link href={`/title/${first.slug}`} className="group/slide relative block">
          <div className="absolute inset-0" aria-hidden>
            {first.coverImage && !isRestricted ? (
              // Ken Burns — 인터랙티브 배너(hero-banner-slide)와 동일한 배경 표지 드리프트.
              <img
                src={first.coverImage}
                alt=""
                loading="eager"
                fetchPriority="high"
                className="size-full scale-110 object-cover opacity-[0.14] motion-safe:[animation:kenburns-drift_14s_ease-in-out_infinite_alternate]"
              />
            ) : null}
            <div
              className="absolute inset-0"
              style={{
                // 모바일은 아래→위 강한 다크 스크림으로 텍스트 대비 확보(hero-banner-slide와 동일).
                background: `radial-gradient(120% 120% at 84% 12%, ${hue}1f, transparent 56%), linear-gradient(to top, oklch(0.16 0.012 70 / 0.97) 12%, oklch(0.17 0.012 70 / 0.82) 52%, oklch(0.18 0.012 70 / 0.6))`,
              }}
            />
          </div>

          <div className="relative grid grid-cols-[4.5rem_1fr] items-center gap-3.5 p-3.5 sm:grid-cols-[11rem_1fr] sm:gap-6 sm:p-6">
            <div
              className="relative aspect-[3/4] overflow-hidden rounded-xl shadow-[0_20px_44px_-22px_oklch(0.1_0.02_70/0.85)] ring-1 ring-line/60 transition-transform duration-500 ease-out-expo group-hover/slide:-translate-y-0.5"
              style={{
                background: `linear-gradient(145deg, color-mix(in oklch, ${coverFrom} 88%, oklch(0.24 0.012 66)), color-mix(in oklch, ${coverTo} 82%, oklch(0.15 0.008 70)))`,
              }}
            >
              {first.coverImage && !isRestricted ? (
                <img
                  src={first.coverImage}
                  alt={`${first.title} 표지`}
                  loading="eager"
                  fetchPriority="high"
                  className="absolute inset-0 size-full object-cover contrast-[1.03] saturate-[1.04]"
                />
              ) : (
                <div
                  className="absolute -right-3 top-1 select-none font-display text-[7.4rem] font-bold leading-none text-[oklch(0.96_0.01_85/0.14)] mix-blend-overlay"
                  aria-hidden
                >
                  {glyph}
                </div>
              )}
              <div className="absolute inset-0 bg-[linear-gradient(to_top,oklch(0.13_0.012_70/0.86),oklch(0.13_0.012_70/0.22)_46%,oklch(0.13_0.012_70/0.08))]" />
              <div className="absolute left-0 top-0 flex items-center gap-1.5 p-4">
                <span className="rounded-md border border-[oklch(0.95_0.01_85/0.28)] bg-[oklch(0.16_0.01_70/0.56)] px-1.5 py-0.5 text-xs font-semibold uppercase text-white/90 backdrop-blur-sm">
                  {isRestricted ? "19+" : first.type === "webnovel" ? "NOVEL" : "TOON"}
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="line-clamp-3 text-xl font-bold leading-[1.1] text-[oklch(0.97_0.012_85)] drop-shadow-[0_1px_8px_oklch(0.1_0.02_70/0.72)]">
                  {first.title}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:gap-3">
              <div className="flex flex-wrap gap-1.5">
                {first.genres.slice(0, 2).map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full border px-2.5 py-1 text-xs font-semibold"
                    style={{
                      color: genreTextColor(genre, 0.84),
                      backgroundColor: `color-mix(in oklch, ${genreColor(genre, 0.6)} 14%, transparent)`,
                      borderColor: `color-mix(in oklch, ${genreColor(genre, 0.6)} 32%, transparent)`,
                    }}
                  >
                    {genre}
                  </span>
                ))}
              </div>
              <div className="text-pretty text-lg font-bold leading-tight text-fg sm:text-2xl lg:text-[1.75rem]">
                {first.title}
              </div>
              <p className="truncate text-xs text-fg-2">
                {first.author}
                {first.artist && first.artist !== first.author ? ` · 그림 ${first.artist}` : ""}
              </p>
              {/* 모바일은 한 줄(스크롤 억제), sm 이상은 두 줄. */}
              <p className="line-clamp-1 max-w-prose font-serif text-[0.8125rem] italic leading-relaxed text-fg-2 sm:line-clamp-2 sm:text-sm">
                {first.editorNote ?? first.synopsis}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-1">
                <span className="rounded-full border border-line bg-card/50 px-2.5 py-1 text-[0.72rem] font-medium text-fg-2">
                  {first.availability.length > 0 ? `${first.availability.length}개 플랫폼` : "플랫폼 확인 중"}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[0.78rem] font-semibold text-on-accent transition-transform duration-150 ease-out-expo group-hover/slide:translate-x-0.5">
                  보러가기
                  <ArrowRight size={14} />
                </span>
              </div>
            </div>
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-px w-full"
            style={{ background: `linear-gradient(90deg, transparent, ${hue}, transparent)` }}
          />
        </Link>
      </div>

      {items.length > 1 && (
        <div className="relative mt-3 flex items-center justify-center gap-1.5" aria-hidden="true">
          {items.slice(0, 6).map((title, index) => (
            <span
              key={title.id}
              className={index === 0 ? "h-1.5 w-5 rounded-full bg-accent" : "size-1.5 rounded-full bg-line"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
