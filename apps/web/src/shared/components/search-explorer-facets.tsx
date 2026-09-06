import { Link2, Gift } from "lucide-react";
import React from "react";

import {
  WORK_TYPES,
  YEAR_RANGES,
  STATUS_OPTIONS,
  STATUS_LABEL_KEY,
  RATING_OPTIONS,
  AGE_OPTIONS,
  AGE_LABEL_KEY,
} from "./search-explorer-constants";
import { toggle, facetClass, tinyPill } from "./search-explorer-utils";
import { GenreChip, TagChip } from "./ui/chip";

import type { WorkType, SerialStatus, AgeRating, PlatformId } from "@/shared/lib/types";

import { GENRES } from "@/shared/lib/taxonomy";
import { cn } from "@/shared/lib/utils";


export function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-3.5 last:border-0">
      <p className="eyebrow mb-2.5 text-fg-3">{title}</p>
      {children}
    </section>
  );
}

export interface SearchFacetPanelProps {
  t: (key: string) => string;
  types: WorkType[];
  setTypes: React.Dispatch<React.SetStateAction<WorkType[]>>;
  genres: string[];
  setGenres: React.Dispatch<React.SetStateAction<string[]>>;
  topTags: string[];
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  yearRange: [number, number] | null;
  setYearRange: React.Dispatch<React.SetStateAction<[number, number] | null>>;
  status: SerialStatus[];
  setStatus: React.Dispatch<React.SetStateAction<SerialStatus[]>>;
  platformOptions: { id: PlatformId; name: string; color: string; short?: string }[];
  platforms: PlatformId[];
  setPlatforms: React.Dispatch<React.SetStateAction<PlatformId[]>>;
  minRating: number;
  setMinRating: React.Dispatch<React.SetStateAction<number>>;
  ages: AgeRating[];
  setAges: React.Dispatch<React.SetStateAction<AgeRating[]>>;
  freeOnly: boolean;
  setFreeOnly: React.Dispatch<React.SetStateAction<boolean>>;
  adaptedOnly: boolean;
  setAdaptedOnly: React.Dispatch<React.SetStateAction<boolean>>;
}

export function SearchFacetPanel({
  t,
  types,
  setTypes,
  genres,
  setGenres,
  topTags,
  tags,
  setTags,
  yearRange,
  setYearRange,
  status,
  setStatus,
  platformOptions,
  platforms,
  setPlatforms,
  minRating,
  setMinRating,
  ages,
  setAges,
  freeOnly,
  setFreeOnly,
  adaptedOnly,
  setAdaptedOnly,
}: SearchFacetPanelProps) {
  return (
    <div className="flex flex-col">
      <FacetGroup title={t("search.explorer.facet.type")}>
        <div className="grid grid-cols-2 gap-1.5">
          {WORK_TYPES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={types.includes(entry.value)}
              onClick={() => setTypes((prev) => toggle(prev, entry.value))}
              className={facetClass(types.includes(entry.value))}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.genre")}>
        <div className="flex flex-wrap gap-1.5">
          {GENRES.map((genre) => (
            <button
              type="button"
              key={genre}
              onClick={() => setGenres((prev) => toggle(prev, genre))}
              aria-pressed={genres.includes(genre)}
            >
              <GenreChip genre={genre} active={genres.includes(genre)} size="sm" />
            </button>
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.tag")}>
        <div className="flex flex-wrap gap-1.5">
          {topTags.map((tag) => (
            <TagChip
              key={tag}
              label={tag}
              active={tags.includes(tag)}
              onClick={() => setTags((prev) => toggle(prev, tag))}
              className="h-7"
            />
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.year")}>
        <div className="grid grid-cols-3 gap-1.5">
          {YEAR_RANGES.map((entry) => {
            const active =
              (entry.range === null && yearRange === null) ||
              (entry.range !== null && yearRange !== null && entry.range[0] === yearRange[0] && entry.range[1] === yearRange[1]);

            return (
              <button
                type="button"
                key={entry.key}
                onClick={() => setYearRange(entry.range)}
                aria-pressed={active}
                className={tinyPill(active)}
              >
                {entry.key === "all" ? t("search.explorer.year.all") : t(entry.labelKey)}
              </button>
            );
          })}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.status")}>
        <div className="grid grid-cols-3 gap-1.5">
          {STATUS_OPTIONS.map((entry) => (
            <button
              type="button"
              key={entry}
              onClick={() => setStatus((prev) => toggle(prev, entry))}
              aria-pressed={status.includes(entry)}
              className={tinyPill(status.includes(entry))}
            >
              {t(STATUS_LABEL_KEY[entry])}
            </button>
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.platform")}>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {platformOptions.map((entry) => (
            <button
              type="button"
              key={entry.id}
              onClick={() => setPlatforms((prev) => toggle(prev, entry.id))}
              aria-pressed={platforms.includes(entry.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors",
                platforms.includes(entry.id)
                  ? "border-accent/55 bg-accent-soft text-accent"
                  : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
              )}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </button>
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.minRating")}>
        <div className="grid grid-cols-4 gap-1.5">
          {RATING_OPTIONS.map((rating) => (
            <button
              type="button"
              key={rating}
              onClick={() => setMinRating(rating)}
              aria-pressed={minRating === rating}
              className={tinyPill(minRating === rating)}
            >
              {rating === 0 ? t("search.explorer.ratingAll") : `${rating}★+`}
            </button>
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.age")}>
        <div className="grid grid-cols-4 gap-1.5">
          {AGE_OPTIONS.map((entry) => (
            <button
              type="button"
              key={entry}
              onClick={() => setAges((prev) => toggle(prev, entry))}
              aria-pressed={ages.includes(entry)}
              className={tinyPill(ages.includes(entry))}
            >
              {t(AGE_LABEL_KEY[entry])}
            </button>
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title={t("search.explorer.facet.option")}>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setFreeOnly((current) => !current)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              freeOnly
                ? "border-good/45 bg-[oklch(0.8_0.15_150/0.14)] text-good border border-good/35"
                : "border-line bg-card text-fg-2 hover:text-fg"
            )}
            aria-pressed={freeOnly}
          >
            <Gift size={15} />
            {t("search.explorer.option.freeOnly")}
          </button>
          <button
            type="button"
            onClick={() => setAdaptedOnly((current) => !current)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              adaptedOnly
                ? "border-accent/55 bg-accent-soft text-accent border"
                : "border-line bg-card text-fg-2 hover:text-fg"
            )}
            aria-pressed={adaptedOnly}
          >
            <Link2 size={15} />
            {t("search.explorer.option.adapted")}
          </button>
        </div>
      </FacetGroup>
    </div>
  );
}
