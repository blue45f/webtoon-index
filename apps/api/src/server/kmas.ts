import { activeTags, TITLES } from "../../../../packages/core/src/server/catalog-store";

import type { PlatformId, Title } from "../../../web/src/shared/lib/types";

export interface KmasBookAndWebtoonItem {
  mastrId?: string | number | null;
  listSeCd?: string | null;
  listSeCdNm?: string | null;
  prdctNm?: string | null;
  title?: string | null;
  subtitl?: string | null;
  edtn?: string | null;
  pictrWritrNm?: string | null;
  sntncWritrNm?: string | null;
  writrNm?: string | null;
  storyWritrNm?: string | null;
  orginlTitle?: string | null;
  originClCdNm?: string | null;
  mainGenreCdNm?: string | null;
  outline?: string | null;
  isbn?: string | null;
  setIsbn?: string | null;
  plscmpnIdNm?: string | null;
  pltfomCdNm?: string | null;
  ageGradCdNm?: string | null;
  fnshYn?: string | null;
  webtoonPusryYn?: string | null;
  pusryBeginDe?: string | null;
  pusryEndDe?: string | null;
  pblicteDe?: string | null;
  relDe?: string | null;
  imageDownloadUrl?: string | null;
}

export interface KmasResultEnvelope {
  pageNo?: number | string | null;
  resultMessage?: string | null;
  resultState?: string | null;
  totalCount?: number | string | null;
  viewItemCnt?: number | string | null;
  itemlist?: KmasBookAndWebtoonItem[];
  itemList?: KmasBookAndWebtoonItem[];
}

export interface KmasBookAndWebtoonResponse {
  result: KmasResultEnvelope;
  itemList?: KmasBookAndWebtoonItem[];
  itemlist?: KmasBookAndWebtoonItem[];
}

export interface KmasBookAndWebtoonQuery {
  title?: string;
  isbn?: string;
  listSeCd?: string;
  pictrWritrNm?: string;
  sntncWritrNm?: string;
  pltfomCdNm?: string;
  plscmpnIdNm?: string;
  startDate?: string;
  endDate?: string;
  pageNo?: number;
  viewItemCnt?: number;
}

export interface KmasCatalogMeta {
  source: "kmas-live";
  sourceVersion: string;
  loadedAt: string;
  titleCount: number;
  seedFallback: false;
  platformCoverage: { id: PlatformId; count: number; share: number }[];
  filteredPlatformCoverage: { id: PlatformId; count: number; share: number }[];
}

type EnvLike = Partial<Record<string, string | undefined>>;

type KmasMatch = {
  item: KmasBookAndWebtoonItem;
  score: number;
};

type CachedLookup = {
  item: KmasBookAndWebtoonItem | null;
  fetchedAt: number;
};

type KmasLookupCacheHit = {
  hit: boolean;
  item: KmasBookAndWebtoonItem | null;
};

interface KmasTitleMergeOptions {
  image?: "raw" | "omit";
}

interface KmasResponseImageOptions {
  cachedOnly?: boolean;
}

interface KmasFetchOptions {
  defaultPagination?: boolean;
}

export type KmasSiteAccessMergeResult = {
  enabled: boolean;
  attempted: number;
  updated: number;
  cached: boolean;
  cacheTtlMs: number;
};

interface KmasSiteAccessMergeOptions {
  force?: boolean;
  now?: number;
}

const DEFAULT_BASE_URL = "https://www.kmas.or.kr";
const BOOK_AND_WEBTOON_PATH = "/openapi/search/bookAndWebtoonList";
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LOOKUP_LIMIT = 24;
const DEFAULT_LOOKUP_CONCURRENCY = 3;
const DEFAULT_SITE_ACCESS_MERGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const lookupCache = new Map<string, CachedLookup>();
let siteAccessMergePromise: Promise<{ attempted: number; updated: number }> | null = null;
let siteAccessMergeCompletedAt = 0;
let siteAccessMergeLastResult: { attempted: number; updated: number } | null = null;

export function hasKmasKey(env: EnvLike = process.env): boolean {
  return Boolean(env.KMAS_PRV_KEY?.trim());
}

export function shouldMergeKmasOnAccess(env: EnvLike = process.env): boolean {
  if (!hasKmasKey(env)) return false;
  return env.KMAS_MERGE_ON_ACCESS !== "0";
}

export function shouldUseKmasLiveSearch(env: EnvLike = process.env): boolean {
  if (!hasKmasKey(env)) return false;
  return env.KMAS_LIVE_SEARCH === "1" || env.KMAS_CATALOG_SOURCE === "live";
}

export function kmasItems(response: KmasBookAndWebtoonResponse): KmasBookAndWebtoonItem[] {
  const top = response.itemList ?? response.itemlist;
  if (Array.isArray(top)) return top;
  const nested = response.result?.itemList ?? response.result?.itemlist;
  return Array.isArray(nested) ? nested : [];
}

export function kmasResultOk(response: KmasBookAndWebtoonResponse): boolean {
  return response.result?.resultState === "success";
}

export async function fetchKmasBookAndWebtoon(
  query: KmasBookAndWebtoonQuery = {},
  env: EnvLike = process.env,
  options: KmasFetchOptions = {}
): Promise<KmasBookAndWebtoonResponse> {
  const key = env.KMAS_PRV_KEY?.trim();
  if (!key) throw new Error("KMAS_PRV_KEY is not configured");

  const base = (env.KMAS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(`${base}${BOOK_AND_WEBTOON_PATH}`);
  url.searchParams.set("prvKey", key);
  setParam(url, "title", query.title);
  setParam(url, "isbn", query.isbn);
  setParam(url, "listSeCd", query.listSeCd);
  setParam(url, "pictrWritrNm", query.pictrWritrNm);
  setParam(url, "sntncWritrNm", query.sntncWritrNm);
  setParam(url, "pltfomCdNm", query.pltfomCdNm);
  setParam(url, "plscmpnIdNm", query.plscmpnIdNm);
  setParam(url, "startDate", query.startDate);
  setParam(url, "endDate", query.endDate);
  if (query.pageNo != null || options.defaultPagination !== false) {
    url.searchParams.set("pageNo", String(boundInt(query.pageNo, 1, 1, 10_000)));
  }
  if (query.viewItemCnt != null || options.defaultPagination !== false) {
    url.searchParams.set("viewItemCnt", String(boundInt(query.viewItemCnt, DEFAULT_PAGE_SIZE, 1, 100)));
  }

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`KMAS ${response.status} ${response.statusText}`);
  const json = (await response.json()) as Partial<KmasBookAndWebtoonResponse>;
  if (!json || typeof json !== "object" || !json.result) {
    throw new Error("KMAS response did not contain result envelope");
  }
  return json as KmasBookAndWebtoonResponse;
}

export async function getKmasBookAndWebtoonProxyResponse(
  query: KmasBookAndWebtoonQuery,
  env: EnvLike = process.env
): Promise<KmasBookAndWebtoonResponse & { normalizedItems: Title[]; generatedAt: string }> {
  const response = await fetchKmasBookAndWebtoon(query, env, { defaultPagination: hasKmasQueryValue(query) });
  return {
    ...response,
    normalizedItems: kmasItems(response).map((item, index) => kmasItemToTitle(item, index)),
    generatedAt: new Date().toISOString(),
  };
}

function hasKmasQueryValue(query: KmasBookAndWebtoonQuery): boolean {
  return Object.values(query).some((value) => value != null && String(value).trim() !== "");
}

export async function getKmasSearchData(
  query: { q?: string; limit?: number | string },
  env: EnvLike = process.env
): Promise<{
  items: Title[];
  total: number;
  typeCount: { webtoon: number; webnovel: number };
  catalog: KmasCatalogMeta;
  topTags: string[];
  generatedAt: string;
} | null> {
  if (!shouldUseKmasLiveSearch(env)) return null;
  const q = query.q?.trim();
  if (!q) return null;
  const limit = boundInt(Number(query.limit), DEFAULT_PAGE_SIZE, 1, 100);
  const response = await fetchKmasBookAndWebtoon({ title: q, pageNo: 1, viewItemCnt: limit }, env);
  const items = dedupeTitles(kmasItems(response).map((item, index) => kmasItemToTitle(item, index)));
  const total = Number(response.result.totalCount) || items.length;
  const coverage = platformCoverage(items);
  return {
    items,
    total,
    typeCount: {
      webtoon: items.filter((title) => title.type === "webtoon").length,
      webnovel: items.filter((title) => title.type === "webnovel").length,
    },
    catalog: {
      source: "kmas-live",
      sourceVersion: `kmas/${new Date().toISOString()}`,
      loadedAt: new Date().toISOString(),
      titleCount: total,
      seedFallback: false,
      platformCoverage: coverage,
      filteredPlatformCoverage: coverage,
    },
    topTags: activeTags().slice(0, 18).map((tag) => tag.tag),
    generatedAt: new Date().toISOString(),
  };
}

export async function mergeKmasForSiteAccessOnce(
  env: EnvLike = process.env,
  options: KmasSiteAccessMergeOptions = {}
): Promise<KmasSiteAccessMergeResult> {
  const cacheTtlMs = siteAccessMergeTtlMs(env);
  if (!shouldMergeKmasOnAccess(env)) return { enabled: false, attempted: 0, updated: 0, cached: false, cacheTtlMs };

  const now = options.now ?? Date.now();
  const freshCachedResult =
    siteAccessMergeLastResult && cacheTtlMs > 0 && now - siteAccessMergeCompletedAt < cacheTtlMs
      ? siteAccessMergeLastResult
      : null;
  if (!options.force && freshCachedResult) {
    return { enabled: true, ...freshCachedResult, cached: true, cacheTtlMs };
  }

  if (!siteAccessMergePromise) {
    const limit = boundInt(Number(env.KMAS_MERGE_ON_ACCESS_LIMIT), DEFAULT_LOOKUP_LIMIT, 1, 1000);
    const candidates = [...TITLES]
      .filter((title) => !isKmasCover(title.coverImage))
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.stats.views - a.stats.views)
      .slice(0, limit);

    siteAccessMergePromise = enrichTitlesWithKmas(candidates, env)
      .then((result) => {
        siteAccessMergeLastResult = result;
        siteAccessMergeCompletedAt = Date.now();
        return result;
      })
      .finally(() => {
        siteAccessMergePromise = null;
      });
  }
  const result = await siteAccessMergePromise;
  return { enabled: true, ...result, cached: false, cacheTtlMs };
}

export async function enrichTitlesWithKmas(
  titles: readonly Title[],
  env: EnvLike = process.env,
  options: KmasTitleMergeOptions = {}
): Promise<{ attempted: number; updated: number }> {
  if (!hasKmasKey(env) || titles.length === 0) return { attempted: 0, updated: 0 };
  const concurrency = boundInt(Number(env.KMAS_LOOKUP_CONCURRENCY), DEFAULT_LOOKUP_CONCURRENCY, 1, 8);
  let cursor = 0;
  let attempted = 0;
  let updated = 0;

  async function worker() {
    while (cursor < titles.length) {
      const title = titles[cursor++];
      attempted += 1;
      const item = await lookupKmasForTitle(title, env).catch(() => null);
      if (item && mergeKmasItemIntoTitle(title, item, options)) updated += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, titles.length) }, () => worker()));
  return { attempted, updated };
}

export async function enrichTitleWithKmas(
  title: Title,
  env: EnvLike = process.env,
  options: KmasTitleMergeOptions = {}
): Promise<Title> {
  if (!hasKmasKey(env) || isKmasCover(title.coverImage)) return title;
  const item = await lookupKmasForTitle(title, env).catch(() => null);
  if (item) mergeKmasItemIntoTitle(title, item, options);
  return title;
}

export async function withKmasImageUrlsForResponse<T>(
  data: T | Promise<T>,
  env: EnvLike = process.env,
  limit = DEFAULT_LOOKUP_LIMIT,
  options: KmasResponseImageOptions = {}
): Promise<T> {
  const resolved = await data;
  if (!hasKmasKey(env) || limit <= 0) return resolved;
  const titles = collectResponseTitles(resolved).slice(0, limit);
  if (titles.length === 0) return resolved;
  const imageById = new Map<string, string>();
  await Promise.all(
    titles.map(async (title) => {
      if (isKmasCover(title.coverImage)) return;
      const item = options.cachedOnly
        ? cachedKmasForTitle(title, env)
        : await lookupKmasForTitle(title, env).catch(() => null);
      const image = normalizeImageUrl(item?.imageDownloadUrl);
      if (image) imageById.set(title.id, image);
    })
  );
  if (imageById.size === 0) return resolved;
  return applyResponseImages(resolved, imageById);
}

export function mergeKmasItemIntoTitle(
  title: Title,
  item: KmasBookAndWebtoonItem,
  options: KmasTitleMergeOptions = {}
): boolean {
  let changed = false;
  const image = normalizeImageUrl(item.imageDownloadUrl);
  if (options.image !== "omit" && image && title.coverImage !== image) {
    title.coverImage = image;
    changed = true;
  }
  const outline = cleanText(item.outline);
  if (outline && outline.length > 20 && title.synopsis !== outline) {
    title.synopsis = outline;
    changed = true;
  }
  const genre = mapKmasGenre(item.mainGenreCdNm);
  if (genre && !title.genres.includes(genre)) {
    title.genres = [genre, ...title.genres].slice(0, 3);
    changed = true;
  }
  const ageRating = mapKmasAge(item.ageGradCdNm);
  if (ageRating && title.ageRating !== ageRating) {
    title.ageRating = ageRating;
    changed = true;
  }
  return changed;
}

export function kmasItemToTitle(item: KmasBookAndWebtoonItem, index = 0): Title {
  const title = cleanText(item.prdctNm) || cleanTitle(cleanText(item.title)) || "제목 미상";
  const idSeed = cleanText(item.mastrId) || normalizeIsbn(item.isbn) || stableHash(`${title}:${item.title ?? ""}`);
  const genres = [mapKmasGenre(item.mainGenreCdNm) ?? "드라마"];
  const author = cleanCreator(item.sntncWritrNm) || cleanCreator(item.writrNm) || cleanCreator(item.storyWritrNm) || cleanCreator(item.pictrWritrNm) || "미상";
  const artist = cleanCreator(item.pictrWritrNm);
  const status = item.fnshYn === "Y" || Boolean(cleanText(item.pusryEndDe)) ? "completed" : "ongoing";
  const releaseYear = parseKmasYear(item.pusryBeginDe) ?? parseKmasYear(item.pblicteDe) ?? parseKmasYear(item.relDe) ?? 2024;
  const ratingAvg = 4.1 + (stableNumber(idSeed) % 8) / 10;
  const ratingCount = 80 + (stableNumber(`${idSeed}:rating`) % 900);
  const views = 20_000 + (stableNumber(`${idSeed}:views`) % 900_000);

  return {
    id: `kmas-${idSeed}`,
    slug: `kmas-${idSeed}`,
    type: "webtoon",
    title,
    altTitles: [cleanText(item.title), cleanText(item.orginlTitle)].filter(Boolean),
    author,
    artist: artist && artist !== author ? artist : undefined,
    genres,
    tags: ["규장각", status === "completed" ? "완결" : "연재중"],
    synopsis: cleanText(item.outline) || `${title} · 만화규장각 등록 작품.`,
    cover: coverGradient(idSeed, genres),
    coverImage: normalizeImageUrl(item.imageDownloadUrl),
    status,
    ageRating: mapKmasAge(item.ageGradCdNm) ?? "all",
    releaseYear,
    availability: [
      {
        platformId: "kmas",
        pricing: "free",
        isOriginal: false,
      },
    ],
    stats: {
      views,
      likes: Math.round(views * 0.035),
      bookmarks: Math.round(views * 0.04),
      ratingAvg: Math.round(ratingAvg * 10) / 10,
      ratingCount,
      ratingDist: synthDist(ratingAvg, ratingCount),
      rankDelta: 0,
      trendingScore: Math.max(35, 92 - index),
      completionRate: status === "completed" ? 86 : 72,
      bingeIndex: 70,
    },
    statsEstimated: true,
  };
}

async function lookupKmasForTitle(title: Title, env: EnvLike): Promise<KmasBookAndWebtoonItem | null> {
  const key = normalizeLookupKey(title.title);
  if (!key) return null;
  const cached = cachedKmasLookupForTitle(title, env);
  const cacheTtlMs = lookupCacheTtlMs(env);
  if (cached.hit) return cached.item;

  const response = await fetchKmasBookAndWebtoon({ title: title.title, pageNo: 1, viewItemCnt: 10 }, env);
  const match = bestKmasMatch(title, kmasItems(response));
  const item = match?.item ?? null;
  if (cacheTtlMs > 0) lookupCache.set(key, { item, fetchedAt: Date.now() });
  return item;
}

function cachedKmasForTitle(title: Title, env: EnvLike): KmasBookAndWebtoonItem | null {
  return cachedKmasLookupForTitle(title, env).item;
}

function cachedKmasLookupForTitle(title: Title, env: EnvLike): KmasLookupCacheHit {
  const key = normalizeLookupKey(title.title);
  if (!key) return { hit: false, item: null };
  const cached = lookupCache.get(key);
  const cacheTtlMs = lookupCacheTtlMs(env);
  if (!cached || cacheTtlMs <= 0 || Date.now() - cached.fetchedAt >= cacheTtlMs) return { hit: false, item: null };
  return { hit: true, item: cached.item };
}

function bestKmasMatch(title: Title, items: KmasBookAndWebtoonItem[]): KmasMatch | null {
  const titleKey = normalizeLookupKey(title.title);
  const authorKey = normalizeCreatorKey(title.author);
  let best: KmasMatch | null = null;
  for (const item of items) {
    const productKey = normalizeLookupKey(item.prdctNm);
    const itemTitleKey = normalizeLookupKey(cleanTitle(cleanText(item.title)));
    let score = 0;
    if (productKey && productKey === titleKey) score += 100;
    if (itemTitleKey && itemTitleKey === titleKey) score += 85;
    if (productKey && (productKey.includes(titleKey) || titleKey.includes(productKey))) score += 35;
    if (itemTitleKey && (itemTitleKey.includes(titleKey) || titleKey.includes(itemTitleKey))) score += 25;
    const creators = [item.sntncWritrNm, item.writrNm, item.storyWritrNm, item.pictrWritrNm]
      .map(normalizeCreatorKey)
      .filter(Boolean);
    if (authorKey && creators.some((creator) => creator.includes(authorKey) || authorKey.includes(creator))) score += 20;
    if (cleanText(item.imageDownloadUrl)) score += 15;
    if (cleanText(item.outline)) score += 10;
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 50 ? best : null;
}

function platformCoverage(titles: readonly Title[]): { id: PlatformId; count: number; share: number }[] {
  const counts = new Map<PlatformId, number>();
  for (const title of titles) {
    const seen = new Set<PlatformId>();
    for (const availability of title.availability) {
      if (seen.has(availability.platformId)) continue;
      seen.add(availability.platformId);
      counts.set(availability.platformId, (counts.get(availability.platformId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count, share: titles.length ? Math.round((count / titles.length) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

function setParam(url: URL, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) url.searchParams.set(key, trimmed);
}

function boundInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function siteAccessMergeTtlMs(env: EnvLike): number {
  return boundInt(Number(env.KMAS_MERGE_ON_ACCESS_TTL_MS), DEFAULT_SITE_ACCESS_MERGE_TTL_MS, 0, 24 * 60 * 60 * 1000);
}

function lookupCacheTtlMs(env: EnvLike): number {
  return boundInt(Number(env.KMAS_LOOKUP_CACHE_TTL_MS), DEFAULT_LOOKUP_CACHE_TTL_MS, 0, 24 * 60 * 60 * 1000);
}

function collectResponseTitles(value: unknown, out: Title[] = [], seen = new Set<unknown>()): Title[] {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (isResponseTitle(value)) {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectResponseTitles(item, out, seen);
    return out;
  }
  for (const item of Object.values(value)) collectResponseTitles(item, out, seen);
  return out;
}

function isResponseTitle(value: unknown): value is Title {
  const item = value as Partial<Title> | null;
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      Array.isArray(item.cover) &&
      Array.isArray(item.availability) &&
      item.stats &&
      typeof item.stats === "object"
  );
}

function applyResponseImages<T>(value: T, imageById: Map<string, string>, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (isResponseTitle(value)) {
    const image = imageById.get(value.id);
    return (image ? { ...value, coverImage: image } : value) as T;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(applyResponseImages(item, imageById, seen));
    return copy as T;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = applyResponseImages(item, imageById, seen);
  return copy as T;
}

function dedupeTitles(titles: Title[]): Title[] {
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = title.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeImageUrl(value: unknown): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!/(^|\.)kmas\.or\.kr$/i.test(url.hostname)) return undefined;
  return raw;
}

function isKmasCover(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const match = value.match(/[?&]u=([^&]+)/);
    const url = match ? new URL(decodeURIComponent(match[1])) : new URL(value);
    return /(^|\.)kmas\.or\.kr$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(value: string): string {
  return value.replace(/\[[^\]]+\]/g, "").replace(/\s+\d+(?:권|화|부)?$/g, "").trim();
}

function cleanCreator(value: unknown): string {
  return cleanText(value)
    .replace(/\s*(글|그림|원작|작가)\s*$/g, "")
    .trim();
}

function normalizeLookupKey(value: unknown): string {
  return cleanTitle(cleanText(value))
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[\s:~!?,.\-()[\]·"'《》<>]/g, "")
    .toLowerCase();
}

function normalizeCreatorKey(value: unknown): string {
  return cleanCreator(value).replace(/[\s,./·]/g, "").toLowerCase();
}

function normalizeIsbn(value: unknown): string {
  return cleanText(value).replace(/[^0-9Xx]/g, "");
}

function mapKmasGenre(value: unknown): Title["genres"][number] | null {
  const text = cleanText(value);
  if (!text) return null;
  if (/로맨스\s*판타지|로판/.test(text)) return "로판";
  if (/\bBL\b|비엘|보이즈/i.test(text)) return "BL";
  if (/무협|무림/.test(text)) return "무협";
  if (/현대.*판타지|현판/.test(text)) return "현판";
  if (/게임/.test(text)) return "게임판타지";
  if (/로맨스|순정/.test(text)) return "로맨스";
  if (/판타지/.test(text)) return "판타지";
  if (/액션|배틀/.test(text)) return "액션";
  if (/스릴러|범죄/.test(text)) return "스릴러";
  if (/미스터리|추리/.test(text)) return "미스터리";
  if (/공포|호러/.test(text)) return "공포";
  if (/학원|학교/.test(text)) return "학원";
  if (/스포츠/.test(text)) return "스포츠";
  if (/역사|사극/.test(text)) return "역사";
  if (/\bSF\b|공상과학|과학/i.test(text)) return "SF";
  if (/코미디|개그/.test(text)) return "코미디";
  if (/일상|힐링/.test(text)) return "일상";
  return "드라마";
}

function mapKmasAge(value: unknown): Title["ageRating"] | null {
  const text = cleanText(value);
  if (!text) return null;
  if (/19|청소년|성인/.test(text)) return "19";
  if (/15/.test(text)) return "15";
  if (/12/.test(text)) return "12";
  return "all";
}

function parseKmasYear(value: unknown): number | null {
  const match = cleanText(value).match(/(19|20)\d{2}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : null;
}

function coverGradient(seed: string, genres: string[]): [string, string] {
  const hueByGenre: Record<string, number> = {
    로맨스: 5,
    로판: 340,
    BL: 315,
    판타지: 290,
    현판: 268,
    SF: 245,
    게임판타지: 222,
    미스터리: 205,
    스릴러: 195,
    공포: 150,
    일상: 162,
    스포츠: 138,
    코미디: 100,
    학원: 78,
    역사: 62,
    드라마: 35,
    무협: 22,
    액션: 12,
  };
  const h = hueByGenre[genres[0]] ?? stableNumber(seed) % 360;
  return [`oklch(0.45 0.14 ${h})`, `oklch(0.28 0.1 ${(h + 40) % 360})`];
}

function synthDist(avg: number, count: number): [number, number, number, number, number] {
  const c = Number.isFinite(count) && count > 0 ? count : 1000;
  const a = Number.isFinite(avg) ? Math.min(5, Math.max(1, avg)) : 4.2;
  const weights = [1, 2, 3, 4, 5].map((score) => Math.exp(-Math.pow(score - a, 2) / 0.6));
  const sum = weights.reduce((acc, value) => acc + value, 0);
  return weights.map((value) => Math.round((value / sum) * c)) as [number, number, number, number, number];
}

function stableHash(value: string): string {
  return stableNumber(value).toString(36);
}

function stableNumber(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
