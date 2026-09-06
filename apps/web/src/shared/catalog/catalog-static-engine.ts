// Dynamic static-catalog engine. This module intentionally contains the heavy
// catalog query/ranking logic and is lazy-loaded by catalog-static.ts only when
// a request cannot be served from precomputed CDN files.
import type { PlatformId, ReadState, Title, TitleCard } from "@/shared/lib/types";

import { detailShardFile, mergeDetailExtra, type DetailShardFile } from "@/shared/lib/catalog-slim";
import { buildTasteProfile, recommendForTaste, similarTitles } from "@/shared/lib/recommend";
import { searchTitles, sortTitles, suggest, type SearchFilters, type SortKey } from "@/shared/lib/search";
import { getAuthorData } from "@/shared/lib/server/author";
import {
  activeTags,
  adaptationsOf,
  getCatalogState,
  getTitle,
  originalOf,
  replaceCatalogData,
  TITLES,
} from "@/shared/lib/server/catalog-store";
import { getExploreData } from "@/shared/lib/server/explore";
import { getRankingData } from "@/shared/lib/server/ranking-service";

const JSON_HEADERS = { "content-type": "application/json" };
const NOT_FOUND = Symbol("not-found");

let catalogPromise: Promise<void> | null = null;
function ensureCatalog(origFetch: typeof fetch): Promise<void> {
  if (!catalogPromise) {
    // 표준 HTTP 캐시(max-age=600, ETag 재검증) 사용 — force-cache 는 스냅샷 갱신(신규 작품·
    // 영상화 등)을 재방문자에게 무기한 숨기므로 쓰지 않는다. 세션 내 1회만 로드(catalogPromise 메모).
    // catalog.json 은 경량 카드(TitleCard — 축약 시놉시스, url/ratingDist 없음)를 싣는다.
    // 상세 전용 필드는 /data/detail/<bucket>.json 샤드에서 필요할 때 병합(loadDetailExtra).
    catalogPromise = origFetch("/data/catalog.json", { cache: "default" })
      .then((r) => {
        if (!r.ok) throw new Error(`catalog.json ${r.status}`);
        return r.json() as Promise<TitleCard[]>;
      })
      .then((titles) => {
        replaceCatalogData(titles, { source: "database-snapshot", sourceVersion: "static-catalog" });
      })
      .catch((error) => {
        catalogPromise = null; // 다음 호출에서 재시도
        throw error;
      });
  }
  return catalogPromise;
}

// 상세 샤드(시놉시스 원문·보러가기 URL·평점분포) — 버킷 단위 메모. 실패는 캐시하지 않아
// 다음 요청에서 재시도하며, 샤드가 없어도 경량 카드만으로 우아하게 동작한다.
const detailShardCache = new Map<string, Promise<DetailShardFile | null>>();
function loadDetailExtra(titleId: string, origFetch: typeof fetch) {
  const file = detailShardFile(titleId);
  let shard = detailShardCache.get(file);
  if (!shard) {
    shard = origFetch(`/data/${file}`, { cache: "default" })
      .then((r) => (r.ok ? (r.json() as Promise<DetailShardFile>) : null))
      .catch(() => null);
    detailShardCache.set(file, shard);
    void shard.then((value) => {
      if (value === null) detailShardCache.delete(file);
    });
  }
  return shard.then((value) => value?.[titleId]);
}

// ── catalog.service 의 응답 조립 로직 복제(동일 shape 유지) ──────────────
const validSorts = new Set<SortKey>(["relevance", "rating", "popular", "trending", "bookmarks", "completion", "newest", "title"]);
const validTypes = new Set(["webtoon", "webnovel"]);
const validStatus = new Set(["ongoing", "completed", "hiatus"]);
const validAge = new Set(["all", "12", "15", "19"]);
const SORTS: SortKey[] = ["popular", "rating", "trending", "newest", "relevance"];

function list<T extends string>(raw: string | null | undefined, allowed?: Set<string>): T[] | undefined {
  const values = (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean) as T[];
  const filtered = allowed ? values.filter((v) => allowed.has(v)) : values;
  return filtered.length ? filtered : undefined;
}
const numberParam = (raw: string | null | undefined) => (Number.isFinite(Number(raw)) ? Number(raw) : undefined);
const boolParam = (raw: string | null | undefined) => raw === "true";
function clampLimit(raw: string | null | undefined) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 24;
  return Math.min(Math.max(Math.floor(n), 1), 80);
}
let cachedStaticCoverage: Array<{ id: PlatformId; count: number; share: number }> | null = null;
let cachedStaticCoverageRevision = -1;

function platformCoverage(titles: Title[]) {
  const isStaticTitles = titles === TITLES;
  const state = getCatalogState();
  if (isStaticTitles && cachedStaticCoverage && cachedStaticCoverageRevision === state.revision) {
    return cachedStaticCoverage;
  }

  const counts = new Map<PlatformId, number>();
  const seen = new Set<PlatformId>();
  const tLen = titles.length;

  for (let i = 0; i < tLen; i++) {
    const avail = titles[i].availability;
    const aLen = avail.length;
    seen.clear();
    for (let j = 0; j < aLen; j++) {
      const id = avail[j].platformId;
      if (!seen.has(id)) {
        seen.add(id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }

  const entries = Array.from(counts.entries());
  const eLen = entries.length;
  const result = new Array<{ id: PlatformId; count: number; share: number }>(eLen);
  for (let i = 0; i < eLen; i++) {
    const [id, count] = entries[i];
    result[i] = { id, count, share: tLen ? Math.round((count / tLen) * 100) : 0 };
  }
  result.sort((a, b) => b.count - a.count);

  if (isStaticTitles) {
    cachedStaticCoverage = result;
    cachedStaticCoverageRevision = state.revision;
  }
  return result;
}
const bayes = (t: Title) => (4 * 800 + t.stats.ratingAvg * t.stats.ratingCount) / (800 + t.stats.ratingCount);

function searchData(sp: URLSearchParams) {
  const sort = validSorts.has(sp.get("sort") as SortKey) ? (sp.get("sort") as SortKey) : "popular";
  const filters: SearchFilters = {
    q: sp.get("q") ?? "",
    types: list(sp.get("types"), validTypes),
    genres: list(sp.get("genres")),
    tags: list(sp.get("tags")),
    status: list(sp.get("status"), validStatus),
    platforms: list(sp.get("platforms")) as PlatformId[] | undefined,
    ageRatings: list(sp.get("ages"), validAge),
    minRating: numberParam(sp.get("minRating")),
    yearMin: numberParam(sp.get("yearMin")),
    yearMax: numberParam(sp.get("yearMax")),
    freeOnly: boolParam(sp.get("freeOnly")),
    adaptedOnly: boolParam(sp.get("adaptedOnly")),
  };
  const items = searchTitles(TITLES, filters, sort);
  let webtoonCount = 0;
  let webnovelCount = 0;
  const iLen = items.length;
  for (let i = 0; i < iLen; i++) {
    if (items[i].type === "webtoon") webtoonCount++;
    else if (items[i].type === "webnovel") webnovelCount++;
  }

  return {
    items,
    total: iLen,
    typeCount: {
      webtoon: webtoonCount,
      webnovel: webnovelCount,
    },
    catalog: {
      ...getCatalogState(),
      platformCoverage: platformCoverage(TITLES),
      filteredPlatformCoverage: platformCoverage(items),
    },
    topTags: activeTags().slice(0, 18).map((t) => t.tag),
    generatedAt: new Date().toISOString(),
  };
}

function titlesData(sp: URLSearchParams) {
  const sort = (SORTS.includes(sp.get("sort") as SortKey) ? sp.get("sort") : "popular") as SortKey;
  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const q = (sp.get("q") ?? "").trim();
  const limit = clampLimit(sp.get("limit"));
  const seen = new Set<string>();
  let items: Title[];
  if (ids.length > 0) {
    items = ids.map((id) => getTitle(id)).filter((t): t is Title => Boolean(t)).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  } else if (q) {
    items = suggest(TITLES, q, limit);
  } else {
    items = sortTitles(TITLES, sort).slice(0, limit);
  }
  return { items, meta: { total: items.length, query: q || null, ids, sort, generatedAt: new Date().toISOString(), source: "static-catalog" } };
}

// 일부 카탈로그 항목은 ratingDist가 음수/합 0 등으로 손상돼 있다(크롤 생성 버그, 약 40%).
// 손상 시 ratingAvg·ratingCount로 종형 분포를 재합성해 상세 페이지의 분포 막대가 정상 표시되게 한다.
function synthRatingDist(avg: number, count: number): [number, number, number, number, number] {
  const c = Number.isFinite(count) && count > 0 ? count : 1000;
  const a = Number.isFinite(avg) ? Math.min(5, Math.max(1, avg)) : 4.2;
  const w = [1, 2, 3, 4, 5].map((s) => Math.exp(-Math.pow(s - a, 2) / 0.6));
  const sum = w.reduce((x, y) => x + y, 0);
  return w.map((x) => Math.round((x / sum) * c)) as [number, number, number, number, number];
}
function safeRatingDist(stats: Title["stats"]): [number, number, number, number, number] {
  const d = stats.ratingDist;
  if (Array.isArray(d) && d.length === 5 && d.every((v) => Number.isFinite(v) && v >= 0) && d.reduce((x, y) => x + y, 0) > 0) {
    return d as [number, number, number, number, number];
  }
  return synthRatingDist(stats.ratingAvg, stats.ratingCount);
}

async function titleDetail(slug: string, origFetch: typeof fetch) {
  const raw = getTitle(slug);
  if (!raw) return NOT_FOUND;
  // 경량 카드에 상세 샤드(시놉시스 원문·보러가기 URL·평점분포)를 병합하고,
  // 손상된 평점 분포를 보정한 사본을 만든다(원본 캐시는 변형하지 않음).
  const merged = mergeDetailExtra(raw, await loadDetailExtra(raw.id, origFetch).catch(() => undefined));
  const title: Title = { ...merged, stats: { ...merged.stats, ratingDist: safeRatingDist(merged.stats) } };
  const similar = similarTitles(TITLES, title, 8);
  const original = originalOf(title) ?? title;
  const adaptations = adaptationsOf(original);
  // 같은 작가의 다른 작품(자기·이미 'similar'에 든 작품 제외) — 작가 단위 디스커버리.
  // "미상"·플랫폼/출판사 묶음 같은 플레이스홀더 작가명은 무관한 작품이 섞이므로 제외하고,
  // 한 작가가 갖기엔 비현실적으로 많은 묶음(플레이스홀더 신호)도 건너뛴다.
  const GENERIC_AUTHORS = new Set(["미상", "작가 미상", "익명", "unknown", "네이버웹툰 작가", "포스타입 오리지널"]);
  const authorName = (title.author ?? "").trim();
  const sameAuthor =
    authorName && !GENERIC_AUTHORS.has(authorName) ? TITLES.filter((t) => t.author === title.author) : [];
  const similarIds = new Set(similar.map((t) => t.id));
  const byAuthor =
    sameAuthor.length <= 25 ? sameAuthor.filter((t) => t.id !== title.id && !similarIds.has(t.id)).slice(0, 6) : [];
  // 리뷰는 하이브리드 — 런타임 /api(Neon)에서 가져와 병합. 실패(쿼터 등) 시 빈 배열로 폴백.
  let reviews: unknown[] = [];
  try {
    const res = await origFetch(`/api/titles/${encodeURIComponent(title.id)}/reviews`, { cache: "no-store" });
    if (res.ok) reviews = await res.json();
  } catch {
    reviews = [];
  }
  const reviewCount = reviews.length;
  const reviewAvg = reviewCount > 0 ? (reviews as { rating: number }[]).reduce((s, r) => s + (r.rating ?? 0), 0) / reviewCount : 0;
  return { title, reviews, similar, byAuthor, original, adaptations, hasFamily: adaptations.length > 0, reviewAvg, reviewCount, generatedAt: new Date().toISOString(), source: "static-catalog" };
}

function recordNumbers(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, Number(v)] as const).filter(([, v]) => Number.isFinite(v)));
}
function recordReads(value: unknown): Record<string, ReadState> {
  if (!value || typeof value !== "object") return {};
  const allowed = new Set<ReadState>(["want", "reading", "done", "dropped"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((e): e is [string, ReadState] => allowed.has(e[1] as ReadState)));
}
function recommendData(body: Record<string, unknown>) {
  const picked = Array.isArray(body.picked) ? (body.picked as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const seedId = typeof body.seedId === "string" ? body.seedId : null;
  const ratings = recordNumbers(body.ratings);
  const reads = recordReads(body.reads);
  const seen = new Set([...Object.keys(ratings), ...Object.keys(reads)]);
  const profile = buildTasteProfile(TITLES, ratings, reads);
  const genres = picked.length ? picked : profile.topGenres.slice(0, 3).map((g) => g.name);
  const byId = new Map(TITLES.map((t) => [t.id, t]));
  const reading = Object.entries(reads).filter(([, s]) => s === "reading" || s === "want").map(([id]) => byId.get(id)).filter((t): t is Title => Boolean(t));
  const pickedRecs = genres.length
    ? TITLES.filter((t) => t.genres.some((g) => genres.includes(g)) && !seen.has(t.id)).sort((a, b) => bayes(b) - bayes(a)).slice(0, 15)
    : TITLES.filter((t) => t.featured).slice(0, 12);
  const tasteRecs = recommendForTaste(TITLES, profile, seen, 12);
  const popular = [...TITLES].sort((a, b) => b.stats.views - a.stats.views).slice(0, 12);
  const seed = (seedId && getTitle(seedId)) || popular[0] || null;
  const similar = seed ? similarTitles(TITLES, seed, 12) : [];
  return { pickedRecs, pickedLabelGenres: genres, tasteRecs, reading, popular, seed, similar, profile: { ratedCount: profile.ratedCount, readCount: Object.keys(reads).length, topGenres: profile.topGenres }, generatedAt: new Date().toISOString() };
}

// 랜덤 발견 — 평가가 있고 표지가 있는 품질 풀에서 무작위 1편(기본 19금 제외).
// type·genre로 좁힐 수 있고, 풀이 비면 단계적으로 필터를 완화한다.
function randomData(sp: URLSearchParams) {
  const type = sp.get("type");
  const genre = sp.get("genre");
  const allowAdult = boolParam(sp.get("adult"));
  const quality = (t: Title) => Boolean(t.coverImage) && t.stats.ratingCount > 0;
  const sfw = (t: Title) => allowAdult || t.ageRating !== "19";
  let pool = TITLES.filter((t) => quality(t) && sfw(t));
  if (type === "webtoon" || type === "webnovel") pool = pool.filter((t) => t.type === type);
  if (genre) pool = pool.filter((t) => t.genres.includes(genre));
  if (pool.length === 0) pool = TITLES.filter(sfw); // 완화 1: 품질 조건 해제
  if (pool.length === 0) pool = TITLES; // 완화 2: 전부
  const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null; // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
  return {
    slug: pick?.slug ?? pick?.id ?? null,
    id: pick?.id ?? null,
    title: pick?.title ?? null,
    poolSize: pool.length,
    generatedAt: new Date().toISOString(),
  };
}

// URL → 카탈로그 핸들러(엔진). 카탈로그가 아니면 null(통과).
function matchEngine(pathname: string, sp: URLSearchParams): null | ((init: RequestInit | undefined, origFetch: typeof fetch) => Promise<unknown> | unknown) {
  if (pathname === "/api/search") return () => searchData(sp);
  if (pathname === "/api/random") return () => randomData(sp);
  if (pathname === "/api/ranking")
    // 실시간(live) 제거 — 스냅샷 기반 산식 랭킹(naver 호출·CORS·서버리스 없음).
    return async () => getRankingData({ get: (n: string) => sp.get(n) });
  if (pathname === "/api/explore") return async () => getExploreData(Object.fromEntries(sp.entries()));
  if (pathname === "/api/recommend") return (init) => recommendData(parseBody(init));
  if (pathname === "/api/titles") return () => titlesData(sp);
  if (pathname.startsWith("/api/titles/") && !pathname.endsWith("/reviews")) {
    const slug = decodeURIComponent(pathname.slice("/api/titles/".length));
    return (_init, origFetch) => titleDetail(slug, origFetch);
  }
  if (pathname.startsWith("/api/authors/")) {
    const name = decodeURIComponent(pathname.slice("/api/authors/".length));
    return async () => (await getAuthorData(name)) ?? NOT_FOUND;
  }
  return null;
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleStaticCatalogRequest(
  pathname: string,
  sp: URLSearchParams,
  init: RequestInit | undefined,
  origFetch: typeof fetch
): Promise<Response> {
  const handler = matchEngine(pathname, sp);
  if (!handler) {
    const query = sp.toString();
    return origFetch(`${pathname}${query ? `?${query}` : ""}`, init);
  }

  try {
    await ensureCatalog(origFetch);
    const data = await handler(init, origFetch);
    if (data === NOT_FOUND) return new Response("null", { status: 404, headers: JSON_HEADERS });
    return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "static catalog error" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
