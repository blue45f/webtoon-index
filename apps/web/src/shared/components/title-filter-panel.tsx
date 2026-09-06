// 전 페이지 공용 필터 패널 — 표시할 facet을 선택해 렌더(캘린더/탐색/추천/랭킹 공용).
import { Bookmark, Check, SlidersHorizontal, X } from "lucide-react";

import type { PlatformId } from "@/shared/lib/types";
import type { ReactNode } from "react";

import { useT } from "@/shared/lib/i18n";
import { PLATFORMS } from "@/shared/lib/platforms";
import { GENRES, TAGS } from "@/shared/lib/taxonomy";
import {
  AGE_OPTIONS,
  MIN_RATING_OPTIONS,
  PRICING_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  YEAR_BUCKETS,
  countActiveTitleFilters,
  type TitleFilterState,
} from "@/shared/lib/title-filters";
import { cn } from "@/shared/lib/utils";



export type FilterFacet =
  | "saved"
  | "type"
  | "genre"
  | "status"
  | "platform"
  | "age"
  | "pricing"
  | "minRating"
  | "year"
  | "tag"
  | "adapted";

const ALL_FACETS: FilterFacet[] = [
  "saved", "type", "genre", "status", "platform", "age", "pricing", "minRating", "year", "tag", "adapted",
];

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function chip(active: boolean) {
  return cn(
    "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[0.72rem] transition-colors",
    active
      ? "border-accent/60 bg-accent-soft/60 text-fg"
      : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
  );
}

const TYPE_LABEL_MAP: Record<"webtoon" | "webnovel", string> = {
  webtoon: "titleFilter.option.type.webtoon",
  webnovel: "titleFilter.option.type.webnovel",
};
const STATUS_LABEL_MAP: Record<"ongoing" | "completed" | "hiatus", string> = {
  ongoing: "titleFilter.option.status.ongoing",
  completed: "titleFilter.option.status.completed",
  hiatus: "titleFilter.option.status.hiatus",
};
const AGE_LABEL_MAP: Record<"all" | "12" | "15" | "19", string> = {
  all: "titleFilter.option.age.all",
  "12": "titleFilter.option.age.12",
  "15": "titleFilter.option.age.15",
  "19": "titleFilter.option.age.19",
};
const PRICING_LABEL_MAP: Record<"free" | "wait-free" | "paid" | "subscription", string> = {
  free: "titleFilter.option.pricing.free",
  "wait-free": "titleFilter.option.pricing.wait-free",
  paid: "titleFilter.option.pricing.paid",
  subscription: "titleFilter.option.pricing.subscription",
};
const YEAR_LABEL_MAP: Record<string, string> = {
  "2022+": "titleFilter.option.year.2022plus",
  "2018–21": "titleFilter.option.year.2018-21",
  "2014–17": "titleFilter.option.year.2014-17",
  "~2013": "titleFilter.option.year.upto2013",
};

function minRatingLabel(value: number) {
  if (value >= 4.5) return "titleFilter.option.minRating.45";
  if (value >= 4) return "titleFilter.option.minRating.4";
  if (value >= 3) return "titleFilter.option.minRating.3";
  return "titleFilter.option.minRating.all";
}

// wide facet(장르·태그 등 칩이 많은 그룹)은 중간폭부터 그리드 전체 폭을 차지해
// 좁은 칸에 칩이 과하게 줄바꿈되는 것을 막는다.
function FacetRow({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2 md:col-span-3")}>
      <span className="text-[0.68rem] font-medium uppercase tracking-wide text-fg-3">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function TitleFilterPanel({
  value,
  onChange,
  facets = ALL_FACETS,
  platformOptions,
  savedCount,
  remember,
  onToggleRemember,
  className,
}: {
  value: TitleFilterState;
  onChange: (next: TitleFilterState) => void;
  facets?: FilterFacet[];
  platformOptions?: PlatformId[]; // 데이터 기반 노출(빈 플랫폼 숨김). 미지정 시 전체.
  savedCount?: number;
  remember?: boolean; // "필터 기억" 상태(undefined면 토글 숨김)
  onToggleRemember?: () => void;
  className?: string;
}) {
  const t = useT();
  const show = (f: FilterFacet) => facets.includes(f);
  const patch = (p: Partial<TitleFilterState>) => onChange({ ...value, ...p });
  const active = countActiveTitleFilters(value);
  const platforms = (platformOptions ?? (Object.keys(PLATFORMS) as PlatformId[]))
    .map((id) => PLATFORMS[id])
    .filter(Boolean);

  return (
    <div className={cn("rounded-2xl border border-line bg-panel/40 p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
          <SlidersHorizontal size={15} className="text-accent" /> {t("titleFilter.header")}
          {active > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 text-[0.68rem] text-accent">{active}</span>
          )}
        </span>
        <div className="flex items-center gap-3">
          {onToggleRemember && (
            <button
              type="button"
              onClick={onToggleRemember}
              role="checkbox"
              aria-checked={!!remember}
              className="inline-flex items-center gap-1.5 text-[0.72rem] text-fg-3 hover:text-fg"
              title={t("titleFilter.rememberTitle")}
            >
              <span
                className={cn(
                  "grid size-3.5 place-items-center rounded border transition-colors",
                  remember ? "border-accent bg-accent text-on-accent" : "border-line-strong"
                )}
              >
                {remember && <Check size={10} strokeWidth={3} aria-hidden="true" />}
              </span>
              {t("titleFilter.remember")}
            </button>
          )}
          {active > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...value, ...emptyExceptSort(value) })}
              className="inline-flex items-center gap-1 text-[0.72rem] text-fg-3 hover:text-fg"
            >
              <X size={12} /> {t("titleFilter.reset")}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-3">
        {show("saved") && (
          <FacetRow label={t("titleFilter.facet.saved")}>
            <button
              type="button"
              onClick={() => patch({ savedOnly: !value.savedOnly })}
              aria-pressed={value.savedOnly}
              className={chip(value.savedOnly)}
            >
              <Bookmark size={12} className={value.savedOnly ? "fill-accent text-accent" : ""} />
              {t("titleFilter.savedOnly")}
              {typeof savedCount === "number" ? ` (${savedCount})` : ""}
            </button>
          </FacetRow>
        )}

        {show("type") && (
          <FacetRow label={t("titleFilter.facet.type")}>
            {TYPE_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => patch({ types: toggle(value.types, o.value) })} aria-pressed={value.types.includes(o.value)} className={chip(value.types.includes(o.value))}>
                {t(TYPE_LABEL_MAP[o.value])}
              </button>
            ))}
          </FacetRow>
        )}

        {show("status") && (
          <FacetRow label={t("titleFilter.facet.status")}>
            {STATUS_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => patch({ status: toggle(value.status, o.value) })} aria-pressed={value.status.includes(o.value)} className={chip(value.status.includes(o.value))}>
                {t(STATUS_LABEL_MAP[o.value])}
              </button>
            ))}
          </FacetRow>
        )}

        {show("pricing") && (
          <FacetRow label={t("titleFilter.facet.pricing")}>
            {PRICING_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => patch({ pricing: toggle(value.pricing, o.value) })} aria-pressed={value.pricing.includes(o.value)} className={chip(value.pricing.includes(o.value))}>
                {t(PRICING_LABEL_MAP[o.value])}
              </button>
            ))}
          </FacetRow>
        )}

        {show("age") && (
          <FacetRow label={t("titleFilter.facet.age")}>
            {AGE_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => patch({ ages: toggle(value.ages, o.value) })} aria-pressed={value.ages.includes(o.value)} className={chip(value.ages.includes(o.value))}>
                {t(AGE_LABEL_MAP[o.value])}
              </button>
            ))}
          </FacetRow>
        )}

        {show("minRating") && (
          <FacetRow label={t("titleFilter.facet.minRating")}>
            {MIN_RATING_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => patch({ minRating: o.value })} aria-pressed={value.minRating === o.value} className={chip(value.minRating === o.value)}>
                {t(minRatingLabel(o.value))}
              </button>
            ))}
          </FacetRow>
        )}

        {show("year") && (
          <FacetRow label={t("titleFilter.facet.year")}>
            {YEAR_BUCKETS.map((o) => {
              const on = !!value.yearRange && value.yearRange[0] === o.range[0] && value.yearRange[1] === o.range[1];
              return (
                <button key={o.label} type="button" onClick={() => patch({ yearRange: on ? null : o.range })} aria-pressed={on} className={chip(on)}>
                  {t(YEAR_LABEL_MAP[o.label] ?? o.label)}
                </button>
              );
            })}
          </FacetRow>
        )}

        {show("adapted") && (
          <FacetRow label={t("titleFilter.facet.adapted")}>
            <button type="button" onClick={() => patch({ adaptedOnly: !value.adaptedOnly })} aria-pressed={value.adaptedOnly} className={chip(value.adaptedOnly)}>
              {t("titleFilter.option.adaptedOnly")}
            </button>
          </FacetRow>
        )}

        {show("platform") && (
          <FacetRow label={t("titleFilter.facet.platform")}>
            {platforms.map((p) => (
              <button key={p.id} type="button" onClick={() => patch({ platforms: toggle(value.platforms, p.id) })} aria-pressed={value.platforms.includes(p.id)} className={chip(value.platforms.includes(p.id))}>
                <span className="size-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                {p.short}
              </button>
            ))}
          </FacetRow>
        )}

        {show("genre") && (
          <FacetRow label={t("titleFilter.facet.genre")} wide>
            {GENRES.map((g) => (
              <button key={g} type="button" onClick={() => patch({ genres: toggle(value.genres, g) })} aria-pressed={value.genres.includes(g)} className={chip(value.genres.includes(g))}>
                {g}
              </button>
            ))}
          </FacetRow>
        )}

        {show("tag") && (
          <FacetRow label={t("titleFilter.facet.tag")} wide>
            {TAGS.slice(0, 18).map((tag) => (
              <button key={tag} type="button" onClick={() => patch({ tags: toggle(value.tags, tag) })} aria-pressed={value.tags.includes(tag)} className={chip(value.tags.includes(tag))}>
                #{tag}
              </button>
            ))}
          </FacetRow>
        )}
      </div>
    </div>
  );
}

// sort 등 패널이 관리하지 않는 필드는 보존하면서 필터만 초기화.
function emptyExceptSort(prev: TitleFilterState): TitleFilterState {
  return {
    ...prev,
    types: [],
    genres: [],
    status: [],
    platforms: [],
    ages: [],
    pricing: [],
    minRating: 0,
    yearRange: null,
    tags: [],
    savedOnly: false,
    adaptedOnly: false,
  };
}
