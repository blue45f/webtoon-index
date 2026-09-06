import { playSfx, triggerParticleBurst } from "@toonspectrum/core/fx";

import { AvailabilityDots, PlatformTags } from "./availability";
import { bestPricing } from "./availability-utils";
import { BookmarkButton } from "./bookmark-button";
import { TitlePoster } from "./title-poster";
import { Card3D } from "./ui/card-3d";
import { GenreChip } from "./ui/chip";
import { GenreSpectrum } from "./ui/spectrum-bar";
import { RatingInline } from "./ui/stars";

import type { Title } from "@/shared/lib/types";

import { statsAreEstimated } from "@/shared/lib/estimate";
import { useIsBookmarked } from "@/shared/lib/store";
import { STATUS_LABEL } from "@/shared/lib/taxonomy";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

// 작품 카드 탭 — 탭 지점에 파티클 "팡" + 'pop' 효과음. 전역 클릭 'tick' 은 [data-no-sfx] 로
// 억제하고 여기서 'pop' 만 울린다(중복 방지). 북마크 등 카드 내부 컨트롤 탭에는 반응하지 않는다.
function popOnTitleTap(event: React.PointerEvent<HTMLElement>) {
  if (event.defaultPrevented) return;
  // 카드 안의 다른 인터랙티브 요소(북마크 버튼 등)에서 시작한 탭은 제외.
  const interactive = (event.target as Element | null)?.closest?.("button, [data-no-sfx-skip]");
  if (interactive && interactive !== event.currentTarget) return;
  playSfx("pop");
  triggerParticleBurst(event.clientX, event.clientY, { count: 14, spread: 0.85 });
}

// 카드 전체를 덮는 "stretched link" — 카드는 <a> 안에 <button> 을 중첩하지 않는다(nested-interactive
// a11y 위반 회피). 링크는 카드 영역을 절대 위치로 덮어 단일 클릭 타깃이 되고, 북마크/연령 버튼은
// 형제로 더 높은 z-index 에 올려 링크 위에서 독립 동작한다(키보드 탭 순서도 정상).
function StretchedTitleLink({ title }: { title: Title }) {
  return (
    <Link
      href={`/title/${title.slug}`}
      data-no-sfx
      onPointerDown={popOnTitleTap}
      aria-label={title.title}
      className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    />
  );
}

// 표지 호버 빛 스윕 — group-hover 시 비스듬한 반투명 띠가 표지를 좌→우로 한 번 가로지른다.
// Tailwind v4 의 group-hover 는 (hover: hover) 미디어 게이트가 걸려 터치 기기에선 발화하지 않고,
// motion-safe 로 reduced-motion 도 제외된다. 부모는 relative + overflow-hidden 이어야 한다.
function CoverSheen() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 -left-[45%] z-10 w-[45%] bg-[linear-gradient(90deg,transparent,oklch(1_0_0/0.16),transparent)] opacity-0 motion-safe:group-hover:[animation:card-sheen_0.9s_var(--ease-out-quint)]"
    />
  );
}

// 표준 그리드 카드 — 포스터 + 메타.
// feature: 그리드의 리드 카드(가로 에디토리얼 레이아웃, 2칸 span).
//   균일한 카드 매트릭스를 깨는 비대칭 리듬용.
export function TitleCard({
  title,
  rank,
  size = "md",
  feature = false,
  className,
}: {
  title: Title;
  rank?: number;
  size?: "sm" | "md" | "lg";
  feature?: boolean;
  className?: string;
}) {
  const price = bestPricing(title.availability);
  // 이미 관심 등록된 작품은 북마크를 상시 노출(그리드에서 한눈에 식별), 그 외엔 호버/포커스 시 노출.
  const saved = useIsBookmarked(title.id);
  const bookmarkReveal = saved
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";

  if (feature) {
    return (
      <Card3D maxTilt={12} scale={1.02} className={cn("group relative block rounded-2xl", className)}>
        <article className="relative flex transform-gpu gap-4 overflow-hidden rounded-2xl border border-line/70 bg-panel/40 p-3 backface-hidden transition-[box-shadow,border-color] duration-200 surface-hl group-hover:border-line-strong group-hover:shadow-[0_22px_48px_-16px_oklch(0.14_0.02_68/0.45)] group-focus-within:border-line-strong">
          <div className="relative w-[38%] max-w-[8.5rem] shrink-0 overflow-hidden rounded-[0.9rem]">
            <div className="transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]">
              <TitlePoster title={title} size={size} rank={rank} />
            </div>
            <CoverSheen />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
            <div className="flex flex-wrap gap-1.5">
              {title.genres.slice(0, 2).map((g) => (
                <GenreChip key={g} genre={g} size="sm" />
              ))}
            </div>
            <h3 className="text-pretty text-base font-bold leading-tight text-fg transition-colors group-hover:text-accent">
              {title.title}
            </h3>
            <p className="line-clamp-3 text-xs leading-relaxed text-fg-2">{title.synopsis}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <RatingInline
                value={title.stats.ratingAvg}
                estimated={statsAreEstimated(title)}
                size="xs"
              />
              <span className={cn("shrink-0 text-[0.7rem] font-medium", price.tone)}>{price.label}</span>
            </div>
            <GenreSpectrum
              genres={title.genres}
              height={4}
              interactive
              label={`${title.title} 장르`}
              className="mt-1"
            />
          </div>
        </article>
        <StretchedTitleLink title={title} />
        <div className={cn("absolute right-2 top-2 z-20 transition-opacity duration-150", bookmarkReveal)}>
          <BookmarkButton titleId={title.id} size={14} />
        </div>
      </Card3D>
    );
  }

  return (
    <Card3D maxTilt={10} scale={1.025} className={cn("group relative block rounded-2xl", className)}>
      <article className="relative block rounded-2xl">
        <div className="relative transform-gpu overflow-hidden rounded-2xl border border-line/70 bg-panel/35 p-1 backface-hidden transition-[box-shadow,border-color] duration-200 group-hover:border-line-strong group-hover:shadow-[0_20px_45px_-18px_oklch(0.14_0.02_68/0.4)] group-focus-within:border-line-strong">
          <div className="relative overflow-hidden rounded-[0.9rem] transition-transform duration-300 ease-out-expo group-hover:scale-[1.035]">
            <TitlePoster title={title} size={size} rank={rank} />
            <CoverSheen />
          </div>
          {/* 호버 보더 */}
          <div className="pointer-events-none absolute inset-1 rounded-[0.9rem] ring-1 ring-inset ring-transparent transition-colors duration-200 group-hover:ring-accent/50" />
          <GenreSpectrum
            genres={title.genres}
            height={3}
            className="absolute inset-x-1 bottom-1 rounded-xl opacity-90"
          />
        </div>

        <div className="mt-2.5 flex flex-col gap-1.5 px-1.5">
          <div className="flex items-center justify-between gap-2">
            <RatingInline value={title.stats.ratingAvg} estimated={statsAreEstimated(title)} size="xs" />
            <span className={cn("shrink-0 text-[0.7rem] font-medium", price.tone)}>{price.label}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-fg-2">
              {STATUS_LABEL[title.status]} · {title.releaseYear}
            </span>
            <AvailabilityDots availability={title.availability} max={3} className="shrink-0" />
          </div>
          <p className="mt-1 line-clamp-2 border-t border-line/50 pt-2 text-xs leading-relaxed text-fg-2">
            {title.synopsis}
          </p>
        </div>

        <StretchedTitleLink title={title} />
        <div className={cn("absolute right-1.5 top-1.5 z-20 transition-opacity duration-150", bookmarkReveal)}>
          <BookmarkButton titleId={title.id} size={14} />
        </div>
      </article>
    </Card3D>
  );
}

// 가로 리스트 행 (검색결과/리뷰목록 등 밀도 높은 맥락)
export function TitleRow({ title, className }: { title: Title; className?: string }) {
  const price = bestPricing(title.availability);
  return (
    <Link
      href={`/title/${title.slug}`}
      data-no-sfx
      onPointerDown={popOnTitleTap}
      className={cn(
        "group flex gap-3.5 rounded-xl border border-line bg-card/85 p-3 transition-colors duration-150 hover:border-line-strong hover:bg-raised",
        className
      )}
    >
      <div className="w-16 shrink-0 sm:w-20">
        <TitlePoster title={title} size="sm" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-[0.95rem] font-semibold text-fg transition-colors group-hover:text-accent">
            {title.title}
          </h3>
          <span className={cn("shrink-0 text-xs font-medium", price.tone)}>{price.label}</span>
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-fg-2">{title.synopsis}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1">
          <RatingInline
            value={title.stats.ratingAvg}
            count={title.stats.ratingCount}
            estimated={statsAreEstimated(title)}
            size="xs"
          />
          <span className="hidden text-line-strong sm:inline">·</span>
          {title.genres.slice(0, 2).map((g) => (
            <GenreChip key={g} genre={g} size="sm" />
          ))}
          <PlatformTags availability={title.availability} className="ml-auto shrink-0" max={2} />
        </div>
      </div>
    </Link>
  );
}
