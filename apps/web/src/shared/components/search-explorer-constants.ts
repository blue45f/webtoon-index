import type { SortKey } from "@/shared/lib/search";
import type { WorkType, SerialStatus, AgeRating } from "@/shared/lib/types";

export const SORTS: { value: SortKey; labelKey: string }[] = [
  { value: "relevance", labelKey: "search.explorer.sort.relevance" },
  { value: "rating", labelKey: "search.explorer.sort.rating" },
  { value: "popular", labelKey: "search.explorer.sort.popular" },
  { value: "trending", labelKey: "search.explorer.sort.trending" },
  { value: "bookmarks", labelKey: "search.explorer.sort.bookmarks" },
  { value: "completion", labelKey: "search.explorer.sort.completion" },
  { value: "newest", labelKey: "search.explorer.sort.newest" },
  { value: "title", labelKey: "search.explorer.sort.title" },
];

export const YEAR_RANGES: { key: string; labelKey: string; range: [number, number] | null }[] = [
  { key: "all", labelKey: "search.explorer.year.all", range: null },
  { key: "2022+", labelKey: "search.explorer.year.2022plus", range: [2022, 9999] },
  { key: "2018-21", labelKey: "search.explorer.year.2018-21", range: [2018, 2021] },
  { key: "2014-17", labelKey: "search.explorer.year.2014-17", range: [2014, 2017] },
  { key: "upto2013", labelKey: "search.explorer.year.upto2013", range: [0, 2013] },
];

export const RATING_OPTIONS = [0, 3, 4, 4.5] as const;
export const AGE_OPTIONS: AgeRating[] = ["all", "12", "15", "19"];
export const WORK_TYPES: { value: WorkType; labelKey: string }[] = [
  { value: "webtoon", labelKey: "search.explorer.type.webtoon" },
  { value: "webnovel", labelKey: "search.explorer.type.webnovel" },
];

export const WORK_TYPE_LABEL_KEY: Record<WorkType, string> = {
  webtoon: "search.explorer.type.webtoon",
  webnovel: "search.explorer.type.webnovel",
};

export const STATUS_OPTIONS = ["ongoing", "completed", "hiatus"] as const;

export const STATUS_LABEL_KEY: Record<SerialStatus, string> = {
  ongoing: "search.explorer.status.ongoing",
  completed: "search.explorer.status.completed",
  hiatus: "search.explorer.status.hiatus",
};

export const AGE_LABEL_KEY: Record<AgeRating, string> = {
  all: "search.explorer.age.all",
  "12": "search.explorer.age.12",
  "15": "search.explorer.age.15",
  "19": "search.explorer.age.19",
};
