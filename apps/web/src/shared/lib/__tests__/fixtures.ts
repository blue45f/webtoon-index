import type { Title, TitleStats } from "../types";

const baseStats: TitleStats = {
  views: 1_000_000,
  likes: 100_000,
  bookmarks: 100_000,
  ratingAvg: 4.5,
  ratingCount: 10_000,
  ratingDist: [100, 200, 500, 3000, 6200],
  rankDelta: 0,
  trendingScore: 60,
  completionRate: 70,
  bingeIndex: 70,
};

let seq = 0;

export function makeTitle(
  p: Omit<Partial<Title>, "stats"> & { stats?: Partial<TitleStats> } = {}
): Title {
  seq += 1;
  const id = p.id ?? `t-${seq}`;
  return {
    id,
    slug: p.slug ?? id,
    type: p.type ?? "webtoon",
    title: p.title ?? `작품 ${seq}`,
    author: p.author ?? "작가",
    artist: p.artist,
    genres: p.genres ?? ["판타지"],
    tags: p.tags ?? [],
    synopsis: p.synopsis ?? "소개",
    cover: p.cover ?? ["#111", "#222"],
    coverImage: p.coverImage,
    status: p.status ?? "ongoing",
    ageRating: p.ageRating ?? "all",
    releaseYear: p.releaseYear ?? 2020,
    totalEpisodes: p.totalEpisodes,
    updateDays: p.updateDays,
    availability: p.availability ?? [{ platformId: "naver-webtoon", pricing: "free" }],
    adaptedFrom: p.adaptedFrom,
    stats: { ...baseStats, ...(p.stats ?? {}) },
    statsEstimated: p.statsEstimated,
    featured: p.featured,
    editorNote: p.editorNote,
    relatedInfo: p.relatedInfo,
  };
}
