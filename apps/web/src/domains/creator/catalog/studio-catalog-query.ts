/** Bounded, deterministic catalog search. Never evaluates user text as a RegExp. */
export interface StudioCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly keywords?: readonly string[];
  readonly description?: string;
  readonly width?: number;
  readonly height?: number;
}
export type StudioCatalogOrientation = "all" | "portrait" | "landscape" | "square";
export type StudioCatalogSort = "relevance" | "name" | "recent";
export type StudioCatalogView = "comfortable" | "compact" | "list";
export interface StudioCatalogQuery {
  readonly query?: string;
  readonly category?: string;
  readonly orientation?: StudioCatalogOrientation;
  readonly sort?: StudioCatalogSort;
  readonly favoriteIds?: readonly string[];
  readonly favoritesOnly?: boolean;
  readonly recentIds?: readonly string[];
}

export function normalizeStudioCatalogText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/gu, " ").trim();
}

/** Synonyms describe uses, never imply a particular license or quality rating. */
const CONCEPTS = [
  ["집중선", "focus", "radial"], ["속도선", "speed"], ["회상", "flashback"],
  ["학원", "학교", "school"], ["사무실", "회사", "office"],
  ["로맨스", "사랑", "romance"], ["판타지", "fantasy"], ["카페", "cafe"],
] as const;

export function studioCatalogTerms(query: string): readonly string[] {
  const normalized = normalizeStudioCatalogText(query.slice(0, 240));
  // Quotes keep a phrase together; unmatched quotes still form a useful literal token.
  return [...normalized.matchAll(/"([^"]+)"|([^\s"]+)/gu)]
    .slice(0, 12).map((match) => (match[1] ?? match[2]).trim()).filter(Boolean);
}

export function studioCatalogOrientation(entry: StudioCatalogEntry): StudioCatalogOrientation {
  if (!entry.width || !entry.height || entry.width <= 0 || entry.height <= 0 || !Number.isFinite(entry.width / entry.height)) return "all";
  const ratio = entry.width / entry.height;
  return ratio > 1.1 ? "landscape" : ratio < 0.9 ? "portrait" : "square";
}

function scoreEntry(entry: StudioCatalogEntry, terms: readonly string[]): number | null {
  const label = normalizeStudioCatalogText(entry.label);
  const searchable = normalizeStudioCatalogText([
    entry.label, entry.id, entry.category, entry.description ?? "", ...(entry.keywords ?? []),
  ].join(" "));
  let score = 0;
  for (const term of terms) {
    const alternatives: readonly string[] = CONCEPTS.find((group) =>
      (group as readonly string[]).includes(term)) ?? [term];
    if (!alternatives.some((alternative) => searchable.includes(alternative))) return null;
    score += label === term ? 12 : label.startsWith(term) ? 8 : label.includes(term) ? 5 : searchable.includes(term) ? 3 : 1;
  }
  return score;
}

const compareNames = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
export function queryStudioCatalog<T extends StudioCatalogEntry>(
  entries: readonly T[], options: StudioCatalogQuery = {},
): T[] {
  const terms = studioCatalogTerms(options.query ?? "");
  const favorites = new Set(options.favoriteIds ?? []);
  const recentRanks = new Map((options.recentIds ?? []).map((id, index) => [id, index]));
  const matched: { entry: T; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    if (options.category && options.category !== "all" && entry.category !== options.category) return;
    if (options.orientation && options.orientation !== "all" && studioCatalogOrientation(entry) !== options.orientation) return;
    if (options.favoritesOnly && !favorites.has(entry.id)) return;
    const score = scoreEntry(entry, terms);
    if (score !== null) matched.push({ entry, score, index });
  });
  matched.sort((a, b) => {
    if (options.sort === "name") return compareNames.compare(a.entry.label, b.entry.label) || a.index - b.index;
    if (options.sort === "recent") {
      const rank = (recentRanks.get(a.entry.id) ?? Number.MAX_SAFE_INTEGER) - (recentRanks.get(b.entry.id) ?? Number.MAX_SAFE_INTEGER);
      if (rank) return rank;
    }
    return b.score - a.score || a.index - b.index;
  });
  return matched.map(({ entry }) => entry);
}
