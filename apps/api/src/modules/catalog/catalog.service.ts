import "reflect-metadata";
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { fromDb } from "../../../../web/src/shared/lib/api-helpers";
import { rateLimit } from "../../../../web/src/shared/lib/rate-limit";
import { buildTasteProfile, recommendForTaste, similarTitles } from "../../../../web/src/shared/lib/recommend";
import { searchTitles, sortTitles, suggest, type SearchFilters, type SortKey } from "../../../../web/src/shared/lib/search";
import {
  activeTags,
  getAuthorData,
  getAuthorDirectory,
  getCalendarData,
  getCatalogState,
  getExploreData,
  getHomeData,
  getInsightsData,
  getRankingData,
  getTitle,
  TITLES,
} from "../../../../../packages/core/src/server";
import { db, reviewLikes, reviews, users } from "../../db";
import { isAdminUser } from "../../server/app-config";
import { getCatalogIngestStatus, isCatalogForceDb, loadLatestCatalogSnapshotFromDb, loadLatestCatalogSnapshotFromFile, normalizeCatalogIngestConfig, refreshCatalogIfChanged, runCatalogIngest, verifyCatalogIngestToken, type CatalogIngestRunResult } from "../../server/catalog-ingest";
import {
  enrichTitleWithKmas,
  enrichTitlesWithKmas,
  getKmasBookAndWebtoonProxyResponse,
  getKmasSearchData,
  mergeKmasForSiteAccessOnce,
  shouldMergeKmasOnAccess,
  withKmasImageUrlsForResponse,
  type KmasSiteAccessMergeResult,
} from "../../server/kmas";
import { getReviewGlobalStats } from "../../server/reviews";
import { getTitleDetail as getTitleDetailFromLib } from "../../server/title";
// 브라우저-세이프 카탈로그 read-model 7종은 @toonspectrum/core 패키지(packages/core/src/server)로 이전됨
// (웹 앱·API가 공유). API 는 lib/* 와 동일한 deep-climb(rootDir=레포루트) 로 참조한다 — tsc 가 dist 로 함께
// 컴파일해 상대 require 로 런타임 해석되도록(bare 패키지 지정자는 plain-node 가 .ts exports 를 못 풀어 부적합).

import type { AgeRating, PlatformId, ReadState, SerialStatus, Title, WorkType } from "../../../../web/src/shared/lib/types";
import type { OnModuleInit } from "@nestjs/common";

type QueryRecord = Record<string, string>;

interface TitleQuery {
  ids?: string;
  q?: string;
  limit?: number | string;
  sort?: string;
}

interface SearchRouteQuery {
  sort?: string;
  q?: string;
  types?: string;
  genres?: string;
  tags?: string;
  status?: string;
  platforms?: string;
  ages?: string;
  minRating?: string;
  yearMin?: string;
  yearMax?: string;
  freeOnly?: string;
  adaptedOnly?: string;
}

interface RecommendPayload {
  picked?: unknown;
  seedId?: unknown;
  ratings?: unknown;
  reads?: unknown;
}

interface IngestRunPayload {
  token?: unknown;
  requestedBy?: unknown;
  force?: unknown;
}

interface KmasBookAndWebtoonQuery {
  title?: string;
  isbn?: string;
  listSeCd?: string;
  pictrWritrNm?: string;
  sntncWritrNm?: string;
  pltfomCdNm?: string;
  plscmpnIdNm?: string;
  startDate?: string;
  endDate?: string;
  pageNo?: string;
  viewItemCnt?: string;
}

interface KmasMergeOptions {
  force?: boolean;
}

const validSorts = new Set<SortKey>([
  "relevance",
  "rating",
  "popular",
  "trending",
  "bookmarks",
  "completion",
  "newest",
  "title",
]);

const validTypes = new Set<WorkType>(["webtoon", "webnovel"]);
const validStatus = new Set<SerialStatus>(["ongoing", "completed", "hiatus"]);
const validAge = new Set<AgeRating>(["all", "12", "15", "19"]);
const SORTS: SortKey[] = ["popular", "rating", "trending", "newest", "relevance"];

type ReadStateMap = Record<string, ReadState>;
type RatingMap = Record<string, number>;

@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly ingestConfig = normalizeCatalogIngestConfig();
  private ingestInProgress: Promise<CatalogIngestRunResult> | null = null;
  private consecutiveIngestFailures = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private kmasSiteAccessLogged = false;

  async onModuleInit() {
    try {
      // 카탈로그는 파일 전용: 번들/지정 gz(apps/api/data/catalog.json.gz 또는 WEBDEX_CATALOG_FILE) →
      // 없으면 빈 카탈로그. DB catalog_snapshot 읽기는 WEBDEX_CATALOG_FORCE_DB=1 레거시 모드에서만.
      if (isCatalogForceDb()) {
        await loadLatestCatalogSnapshotFromDb();
      } else {
        const result = loadLatestCatalogSnapshotFromFile();
        if (result.loaded) {
          console.log(`catalog loaded from file (${result.titleCount} titles) — DB 전송 0`);
        } else {
          console.warn("catalog file missing; starting empty (pnpm ingest 또는 WEBDEX_CATALOG_FILE 확인)");
        }
      }
    } catch (error) {
      console.error("catalog load failed; runtime catalog is empty until a successful load", error);
    }
    // 자동 크롤 스케줄러 폐기 — 수집은 운영자가 필요할 때 수동으로만 수행한다(pnpm catalog:update
    // 또는 인증된 /catalog/ingest API). 런타임에 외부 플랫폼을 주기 페치하지 않는다.
    // 갱신 감지 폴링: 파일 모드는 mtime/size 스탯 비교(무비용)라 항상 켠다.
    // 레거시 FORCE_DB 모드에서만 기존 DB 해시 폴링이 동작한다(refreshCatalogIfChanged 내부 분기).
    this.startCatalogRefreshPoll();
  }

  async mergeKmasOnSiteAccess(options: KmasMergeOptions = {}): Promise<KmasSiteAccessMergeResult & { generatedAt: string }> {
    if (!shouldMergeKmasOnAccess()) {
      return {
        enabled: false,
        attempted: 0,
        updated: 0,
        cached: false,
        cacheTtlMs: 0,
        generatedAt: new Date().toISOString(),
      };
    }
    try {
      const result = await mergeKmasForSiteAccessOnce(process.env, options);
      if (!this.kmasSiteAccessLogged && result.enabled && !result.cached) {
        this.kmasSiteAccessLogged = true;
        console.log(
          `KMAS live merge on access: attempted=${result.attempted} updated=${result.updated} cacheTtlMs=${result.cacheTtlMs}`
        );
      }
      return { ...result, generatedAt: new Date().toISOString() };
    } catch (error) {
      console.error("KMAS live merge on access failed; using existing catalog data", error);
      return {
        enabled: true,
        attempted: 0,
        updated: 0,
        cached: false,
        cacheTtlMs: 0,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  private async enrichResponseTitles(items: readonly Title[]) {
    if (!shouldMergeKmasOnAccess() || items.length === 0) return;
    const limit = clampLimit(process.env.KMAS_RESPONSE_ENRICH_LIMIT ?? 12);
    await enrichTitlesWithKmas(items.slice(0, limit)).catch((error) => {
      console.error("KMAS response enrichment failed; returning existing title data", error);
    });
  }

  private async withKmasImages<T>(data: T | Promise<T>): Promise<T> {
    const resolved = await data;
    if (!shouldMergeKmasOnAccess()) return resolved;
    const limit = clampLimit(process.env.KMAS_RESPONSE_IMAGE_LIMIT ?? 96);
    return withKmasImageUrlsForResponse(resolved, process.env, limit, { cachedOnly: true }).catch((error) => {
      console.error("KMAS response image URL overlay failed; returning existing title data", error);
      return resolved;
    });
  }

  // 무중단 핫 리로드 폴링: 외부 프로세스(CLI/cron/다른 인스턴스)가 새 카탈로그를 적재하면
  // 재시작 없이 메모리 카탈로그를 갱신한다. 파일 모드는 스탯 폴링, 레거시 DB 모드는 id 폴링.
  private startCatalogRefreshPoll() {
    const seconds = this.ingestConfig.refreshPollSeconds;
    if (!seconds) return; // 0 = 비활성
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (this.ingestInProgress) return; // ingest 중엔 건너뜀(곧 in-process 갱신됨)
      void refreshCatalogIfChanged()
        .then((r) => {
          if (r.reloaded) {
            console.log(`catalog hot-reloaded: snapshot=${r.snapshotId} titles=${r.titleCount}`);
          }
        })
        .catch((error) => console.error("catalog refresh poll failed", error));
    }, seconds * 1000);
    if (typeof this.refreshTimer.unref === "function") this.refreshTimer.unref();
  }

  // 강제 리로드(엔드포인트용) — 변경 없으면 reloaded:false. 토큰 설정 시 일치 필요(reload는 read-only).
  async refreshCatalog(headerToken?: string, clientKey = "unknown") {
    this.assertIngestRateLimit("refresh", clientKey, 10);
    if (this.ingestConfig.triggerToken) {
      if (verifyCatalogIngestToken(this.ingestConfig.triggerToken, headerToken) !== "ok") {
        throw new UnauthorizedException("invalid catalog ingest token");
      }
    }
    return refreshCatalogIfChanged();
  }

  async getHomeData() {
    void this.mergeKmasOnSiteAccess().catch(() => {});
    // 리뷰 총계는 DB read-model 이라 API(앱 레이어)가 core 홈 read-model 에 주입한다.
    return this.withKmasImages(await getHomeData({ loadReviewStats: getReviewGlobalStats }));
  }

  async getCalendarData() {
    void this.mergeKmasOnSiteAccess().catch(() => {});
    return this.withKmasImages(await getCalendarData());
  }

  async getInsightsData() {
    void this.mergeKmasOnSiteAccess().catch(() => {});
    return this.withKmasImages(await getInsightsData());
  }

  async getRankingData(query: QueryRecord) {
    void this.mergeKmasOnSiteAccess().catch(() => {});
    return this.withKmasImages(await getRankingData(createQueryReader(query)));
  }

  async getExploreData(query: QueryRecord) {
    void this.mergeKmasOnSiteAccess().catch(() => {});
    return this.withKmasImages(await getExploreData(query));
  }

  async getSearchData(query: SearchRouteQuery) {
    void this.mergeKmasOnSiteAccess().catch(() => {});
    const kmasLive = await getKmasSearchData({ q: query.q }).catch((error) => {
      console.error("KMAS live search failed; falling back to existing catalog search", error);
      return null;
    });
    if (kmasLive) return kmasLive;

    const sort = validSorts.has(query.sort as SortKey) ? (query.sort as SortKey) : "popular";
    const filters: SearchFilters = {
      q: query.q ?? "",
      types: list(query.types, validTypes),
      genres: list(query.genres),
      tags: list(query.tags),
      status: list(query.status, validStatus),
      platforms: list(query.platforms) as PlatformId[] | undefined,
      ageRatings: list(query.ages, validAge),
      minRating: numberParam(query.minRating),
      yearMin: numberParam(query.yearMin),
      yearMax: numberParam(query.yearMax),
      freeOnly: boolParam(query.freeOnly),
      adaptedOnly: boolParam(query.adaptedOnly),
    };
    const items = searchTitles(TITLES, filters, sort);
    await this.enrichResponseTitles(items);
    const typeCount = {
      webtoon: items.filter((title) => title.type === "webtoon").length,
      webnovel: items.filter((title) => title.type === "webnovel").length,
    };

    return this.withKmasImages({
      items,
      total: items.length,
      typeCount,
      catalog: {
        ...getCatalogState(),
        platformCoverage: platformCoverage(TITLES),
        filteredPlatformCoverage: platformCoverage(items),
      },
      topTags: activeTags().slice(0, 18).map((tag) => tag.tag),
      generatedAt: new Date().toISOString(),
    });
  }

  async getRecommendData(payload: RecommendPayload) {
    void this.mergeKmasOnSiteAccess().catch(() => {});
    const body = (payload ?? {}) as Record<string, unknown>;
    const picked = stringList(body.picked);
    const seedId = typeof body.seedId === "string" ? body.seedId : null;
    const ratings = recordNumbers(body.ratings);
    const reads = recordReads(body.reads);

    const seen = new Set([...Object.keys(ratings), ...Object.keys(reads)]);
    const profile = buildTasteProfile(TITLES, ratings, reads);
    const genres = picked.length ? picked : profile.topGenres.slice(0, 3).map((genre) => genre.name);
    const byId = new Map(TITLES.map((title) => [title.id, title]));
    const reading = Object.entries(reads)
      .filter(([, state]) => state === "reading" || state === "want")
      .map(([id]) => byId.get(id))
      .filter((title): title is Title => Boolean(title));

    const pickedRecs = genres.length
      ? TITLES.filter((title) => title.genres.some((genre) => genres.includes(genre)) && !seen.has(title.id))
          .sort((a, b) => bayes(b) - bayes(a))
          .slice(0, 15)
      : TITLES.filter((title) => title.featured).slice(0, 12);

    const tasteRecs = recommendForTaste(TITLES, profile, seen, 12);
    const popular = [...TITLES].sort((a, b) => b.stats.views - a.stats.views).slice(0, 12);
    const seed = (seedId && getTitle(seedId)) || popular[0] || null;
    const similar = seed ? similarTitles(TITLES, seed, 12) : [];

    return this.withKmasImages({
      pickedRecs,
      pickedLabelGenres: genres,
      tasteRecs,
      reading,
      popular,
      seed,
      similar,
      profile: {
        ratedCount: profile.ratedCount,
        readCount: Object.keys(reads).length,
        topGenres: profile.topGenres,
      },
      generatedAt: new Date().toISOString(),
    });
  }

  async getTagCloud() {
    await this.mergeKmasOnSiteAccess();
    return { tags: activeTags() };
  }

  async getAuthorDirectory() {
    await this.mergeKmasOnSiteAccess();
    return this.withKmasImages(getAuthorDirectory());
  }

  async getTitles(query: TitleQuery) {
    await this.mergeKmasOnSiteAccess();
    const sort = SORTS.includes((query.sort as SortKey) ? (query.sort as SortKey) : "popular")
      ? (query.sort as SortKey)
      : "popular";

    const ids = (query.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const q = (query.q ?? "").trim();
    const limit = clampLimit(query.limit);
    const seen = new Set<string>();
    let items: Title[];

    if (ids.length > 0) {
      items = ids
        .map((id) => findTitle(id))
        .filter((title): title is Title => Boolean(title))
        .filter((title) => {
          if (seen.has(title.id)) return false;
          seen.add(title.id);
          return true;
        });
    } else if (q) {
      items = suggest(TITLES, q, limit);
    } else {
      items = sortTitles(TITLES, sort).slice(0, limit);
    }
    await this.enrichResponseTitles(items);

    return this.withKmasImages({
      items,
      meta: {
        total: items.length,
        query: q || null,
        ids,
        sort,
        generatedAt: new Date().toISOString(),
        source: "server-catalog",
      },
    });
  }

  async getTitleDetail(id: string) {
    await this.mergeKmasOnSiteAccess();
    const data = await getTitleDetailFromLib(id);
    if (data?.title) await enrichTitleWithKmas(data.title).catch(() => data.title);
    return this.withKmasImages(data);
  }

  async getTitleReviews(titleId: string) {
    try {
    const rows = await db
      .select({
        id: reviews.id,
        userId: reviews.userId,
        rating: reviews.rating,
        text: reviews.text,
        tags: reviews.tags,
        spoiler: reviews.spoiler,
        createdAt: reviews.createdAt,
        author: users.name,
        avatar: users.avatar,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.userId, users.id))
      .where(eq(reviews.titleId, titleId))
      .orderBy(desc(reviews.createdAt));

    const ids = rows.map((row) => row.id);
    const counts = ids.length
      ? await db
          .select({ reviewId: reviewLikes.reviewId, c: sql<number>`count(*)`.as("c") })
          .from(reviewLikes)
          .where(inArray(reviewLikes.reviewId, ids))
          .groupBy(reviewLikes.reviewId)
      : [];
    const likesById = Object.fromEntries(counts.map((row) => [row.reviewId, Number(row.c)]));

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      author: row.author ?? "익명",
      avatar: row.avatar ?? "#7c5cfc",
      rating: fromDb(row.rating),
      text: row.text,
      tags: row.tags ?? [],
      spoiler: row.spoiler,
      likes: likesById[row.id] ?? 0,
      createdAt: new Date(row.createdAt ?? Date.now()).toISOString(),
    }));
    } catch {
      // 리뷰 DB(Neon) 불가(쿼터/장애) 시 빈 목록 폴백 — 상세 페이지/리뷰 탭이 깨지지 않게.
      return [];
    }
  }

  async getAuthorData(name: string) {
    await this.mergeKmasOnSiteAccess();
    return this.withKmasImages(getAuthorData(name));
  }

  async getKmasBookAndWebtoonData(query: KmasBookAndWebtoonQuery) {
    return getKmasBookAndWebtoonProxyResponse({
      title: query.title,
      isbn: query.isbn,
      listSeCd: query.listSeCd,
      pictrWritrNm: query.pictrWritrNm,
      sntncWritrNm: query.sntncWritrNm,
      pltfomCdNm: query.pltfomCdNm,
      plscmpnIdNm: query.plscmpnIdNm,
      startDate: query.startDate,
      endDate: query.endDate,
      pageNo: numberParam(query.pageNo),
      viewItemCnt: numberParam(query.viewItemCnt),
    });
  }

  async getCatalogIngestStatus() {
    const status = await getCatalogIngestStatus(this.ingestConfig);
    return {
      ...status,
      // 자동 스케줄러 폐기 — 수동 수집만. 예약된 다음 실행이 없다.
      scheduler: {
        running: false,
        inProgress: Boolean(this.ingestInProgress),
        nextRunAt: null,
        nextRunInSeconds: null,
        consecutiveFailures: this.consecutiveIngestFailures,
      },
    };
  }

  async runCatalogIngest(payload: IngestRunPayload, headerToken?: string, userId?: string, clientKey = "unknown") {
    // 연타·토큰 무차별 대입 방지 — 인증 검사보다 먼저 적용해 실패 시도도 카운트한다.
    this.assertIngestRateLimit("run", clientKey, 5);
    await this.assertIngestAuthorized(payload, headerToken, userId);
    return this.runCatalogIngestOnce({
      requestedBy: typeof payload.requestedBy === "string" ? payload.requestedBy : "manual",
      triggeredBy: "manual",
      force: boolValue(payload.force),
    });
  }

  // 인메모리 슬라이딩 윈도(1분) — lib/rate-limit 재사용. 한도 초과 시 429.
  private assertIngestRateLimit(scope: string, clientKey: string, limit: number) {
    if (!rateLimit(`catalog-ingest:${scope}:${clientKey}`, limit, 60_000)) {
      throw new HttpException("too many catalog ingest requests; retry later", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async assertIngestAuthorized(payload: IngestRunPayload, headerToken?: string, userId?: string) {
    // 관리자(서명 세션이 검증된 x-user-id)는 ingest 토큰 없이도 수동 크롤을 트리거할 수 있다.
    if (userId && (await isAdminUser(userId))) return;

    // 토큰 인증 경로(cron·비관리자 호출). 비교는 타이밍 세이프, 토큰 미설정 시 토큰 인증은 사용할 수 없다.
    const verdict = verifyCatalogIngestToken(
      this.ingestConfig.triggerToken,
      typeof payload.token === "string" ? payload.token : "",
      headerToken
    );
    if (verdict === "not-configured") {
      throw new UnauthorizedException("catalog ingest token is not configured");
    }
    if (verdict !== "ok") {
      throw new UnauthorizedException("invalid catalog ingest token");
    }
  }

  private async runCatalogIngestOnce(options: { requestedBy: string; triggeredBy: string; force?: boolean }) {
    if (this.ingestInProgress) throw new ConflictException("catalog ingest is already running");

    const job = runCatalogIngest({ ...options, config: this.ingestConfig })
      .then((result) => {
        this.consecutiveIngestFailures = 0;
        return result;
      })
      .catch((error: unknown) => {
        this.consecutiveIngestFailures += 1;
        const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
        // 크롤/적재 실패는 클라이언트 요청 문제(4xx)가 아니라 업스트림 수집 실패 → 502.
        throw new BadGatewayException(`catalog ingest failed${detail}`);
      })
      .finally(() => {
        this.ingestInProgress = null;
      });

    this.ingestInProgress = job;
    return job;
  }

}

function createQueryReader(query: QueryRecord) {
  return {
    get(name: string) {
      return query[name] ?? null;
    },
  };
}

function findTitle(identifier: string): Title | null {
  return getTitle(identifier) ?? null;
}

function bayes(title: Title) {
  const ratingAvg = Math.max(0, Math.min(5, title.stats.ratingAvg));
  const ratingCount = Math.max(0, title.stats.ratingCount);
  return (4 * 800 + ratingAvg * ratingCount) / (800 + ratingCount);
}

function platformCoverage(titles: Title[]) {
  const counts = new Map<PlatformId, number>();
  for (const title of titles) {
    const ids = new Set(title.availability.map((entry) => entry.platformId));
    ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  }
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      count,
      share: titles.length ? Math.round((count / titles.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

function list<T extends string>(raw: string | null | undefined, allowed?: Set<T>): T[] | undefined {
  const values = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as T[];
  const filtered = allowed ? values.filter((value) => allowed.has(value)) : values;
  return filtered.length ? filtered : undefined;
}

function numberParam(raw: string | null | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boolParam(raw: string | null | undefined): boolean {
  return raw === "true";
}

function boolValue(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  return false;
}

function clampLimit(raw: number | string | undefined) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(Math.floor(parsed), 1), 80);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function recordNumbers(value: unknown): RatingMap {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [key, Number(raw)] as const)
      .filter(([, raw]) => Number.isFinite(raw))
  );
}

function recordReads(value: unknown): ReadStateMap {
  if (!value || typeof value !== "object") return {};
  const allowed = new Set<ReadState>(["want", "reading", "done", "dropped"]);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, ReadState] =>
      allowed.has(entry[1] as ReadState)
    )
  );
}
