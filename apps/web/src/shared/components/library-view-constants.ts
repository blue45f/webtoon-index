import type { ReadState, Title } from "@/shared/lib/types";

export type Tab = "shelf" | "rated" | "taste" | "collections" | "alerts";
export type RatedSort = "high" | "low" | "title";

export const RATED_SORTS: { value: RatedSort; label: string }[] = [
  { value: "high", label: "별점 높은순" },
  { value: "low", label: "별점 낮은순" },
  { value: "title", label: "가나다순" },
];

export const DAY_FROM_GETDAY = [6, 0, 1, 2, 3, 4, 5];

export const READ_TABS: { value: ReadState; label: string }[] = [
  { value: "want", label: "관심" },
  { value: "reading", label: "보는 중" },
  { value: "done", label: "완독" },
  { value: "dropped", label: "하차" },
];

export type TasteProfile = {
  affinityType: "webtoon" | "webnovel" | "balanced";
  ratedCount: number;
  avgRating: number;
  topGenres: { name: string; weight: number }[];
  topTags: { name: string; weight: number }[];
};

export type TasteRec = {
  title: Title;
  reason: string;
};

export const EMPTY_PROFILE: TasteProfile = {
  affinityType: "balanced",
  ratedCount: 0,
  avgRating: 0,
  topGenres: [],
  topTags: [],
};
