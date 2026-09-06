// 정적 카탈로그 생성기 — 커밋된 gz 스냅샷을 읽어 apps/web/public/data/*.json 을 만든다.
//
//   pnpm catalog:gen                       # apps/api/data/catalog.json.gz → apps/web/public/data/*
//   WEBDEX_CATALOG_GZ=path pnpm catalog:gen
//
// 카탈로그 읽기에 Neon/DB 를 전혀 쓰지 않는다(순수 함수만). 리뷰·북마크·인증은 런타임 /api 담당.
// apps/web/public/data 는 빌드 산출물(.gitignore) — git 소스는 2.3MB gz 하나만 유지한다.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  buildDetailExtra,
  detailShardBucket,
  detailShardFileForBucket,
  DETAIL_SHARD_COUNT,
  toCalendarTitle,
  toListTitle,
  type DetailShardFile,
} from "../apps/web/src/shared/lib/catalog-slim";
import { PLATFORM_LIST } from "../apps/web/src/shared/lib/platforms";
import { rankBy, RANK_AXES } from "../apps/web/src/shared/lib/ranking";
import { sortTitles } from "../apps/web/src/shared/lib/search";
import { getCalendarData } from "../apps/web/src/shared/lib/server/calendar";
import {
  activeTags,
  adaptationsOf,
  getAuthorDirectory,
  replaceCatalogData,
  TITLES,
} from "../apps/web/src/shared/lib/server/catalog-store";
import { getInsightsData } from "../apps/web/src/shared/lib/server/insights";
import { getRankingData } from "../apps/web/src/shared/lib/server/ranking-service";
import { GENRES, WEEK_DAYS } from "../apps/web/src/shared/lib/taxonomy";
import { kstDayOfWeek } from "../apps/web/src/shared/lib/utils";

import { readFileIfExists, writeNews } from "./news-gen";

import type { Title } from "../apps/web/src/shared/lib/types";

const RANK_TYPES = ["all", "webtoon", "webnovel"];

// 랭킹 기본 뷰(축×타입, 필터 없음) 사전계산 — live 비활성(스냅샷 산식)으로 결정적.
// /ranking 이 전체 카탈로그를 클라이언트에서 로드하지 않고 작은 정적 파일로 즉시 표시한다.
// 항목의 title 은 경량 카드(toListTitle)로 줄인다 — rank-row·ranking-board·explainScore 가
// 읽는 필드(스칼라 stats·platformId·pricing·축약 시놉시스 등)는 모두 유지된다.
async function buildRankingFiles(writeJson: (name: string, data: unknown) => void): Promise<void> {
  for (const axis of RANK_AXES.map((a) => a.key)) {
    for (const type of RANK_TYPES) {
      const reader = { get: (n: string) => (n === "axis" ? axis : n === "type" ? type : null) };
      const data = await getRankingData(reader, { disableLive: true });
      const slim = { ...data, items: data.items.map((item) => ({ ...item, title: toListTitle(item.title) })) };
      writeJson(`ranking/${axis}-${type}.json`, slim);
    }
  }
}

// 크롤러(scripts/crawl-related-info.mjs)가 수집한 작품별 관련 정보 실링크 스냅샷.
// { [titleId]: RelatedInfoItem[] } — 커밋된 JSON 이라 빌드가 결정적(카탈로그 스냅샷과 동일 규약).
type RelatedSnapshot = Record<string, Title["relatedInfo"]>;
function loadRelatedInfoSnapshot(): RelatedSnapshot {
  const file = path.join(ROOT, "data", "related-info.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as RelatedSnapshot) : {};
  } catch (e) {
    // 손상된 스냅샷을 조용히 무시하면 관련 정보가 통째로 사라진 채 green 빌드가 나간다 → 경고로 알린다.
    console.warn(`⚠️  related-info.json 파싱 실패 — 관련 정보를 이번 빌드에서 생략합니다: ${String(e)}`);
    return {};
  }
}

// 상세 전용 필드(시놉시스 원문·보러가기 URL·평점분포·관련 정보)를 해시 버킷 샤드로 분리 —
// 상세/비교 화면이 작은 샤드 1개만 추가로 받아 병합한다(src/shared/catalog/catalog-static-engine.ts).
function buildDetailShards(titles: readonly Title[]): { files: DetailShardFile[]; entryCount: number } {
  const files: DetailShardFile[] = Array.from({ length: DETAIL_SHARD_COUNT }, () => ({}));
  const related = loadRelatedInfoSnapshot();
  let entryCount = 0;
  for (const title of titles) {
    // buildDetailExtra 는 s/u/d 가 없으면 null — 관련 정보만 있는 작품도 샤드에 실어야 하므로 {} 로 시작.
    const extra = buildDetailExtra(title) ?? {};
    const rel = related[title.id];
    if (Array.isArray(rel) && rel.length > 0) extra.r = rel;
    if (Object.keys(extra).length === 0) continue;
    files[detailShardBucket(title.id)][title.id] = extra;
    entryCount += 1;
  }
  return { files, entryCount };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// WEBDEX_CATALOG_FILE 이 정식 이름(서버 런타임과 동일), WEBDEX_CATALOG_GZ 는 기존 호환 별칭.
const SRC_GZ =
  process.env.WEBDEX_CATALOG_FILE ??
  process.env.WEBDEX_CATALOG_GZ ??
  path.join(ROOT, "apps/api/data/catalog.json.gz");
const OUT = path.join(ROOT, "apps", "web", "public", "data");

function loadTitles(): Title[] {
  if (!existsSync(SRC_GZ)) {
    throw new Error(`catalog gz not found: ${SRC_GZ} (먼저 pnpm catalog:update 로 생성)`);
  }
  const raw = gunzipSync(readFileSync(SRC_GZ)).toString("utf8");
  const parsed = JSON.parse(raw) as unknown;
  const titles = Array.isArray(parsed) ? parsed : (parsed as { titles?: unknown })?.titles;
  if (!Array.isArray(titles)) throw new Error("invalid catalog payload (titles 배열 없음)");
  return titles as Title[];
}

// lib/server/home.ts 의 카탈로그 부분 복제 — 리뷰 통계(DB)만 제외(정적은 reviews:0, 런타임은 /api).
// home.ts 변경 시 함께 갱신할 것.
const DAY_IDX_FROM_GETDAY = [6, 0, 1, 2, 3, 4, 5];
function buildHome() {
  const featured = TITLES.filter((t) => t.featured);
  const spotlight = [...featured].sort((a, b) => b.stats.views - a.stats.views)[0] ?? null;
  const topRated = rankBy(TITLES, "rating", { limit: 12 }).map((r) => r.title);
  const waitFree = sortTitles(
    TITLES.filter((t) => t.availability.some((a) => a.pricing === "free" || a.pricing === "wait-free")),
    "popular"
  ).slice(0, 12);
  const newest = sortTitles(TITLES, "newest").slice(0, 12);
  const families = TITLES.filter((t) => t.type === "webnovel" && adaptationsOf(t).length > 0)
    .map((novel) => ({ original: novel, adaptations: adaptationsOf(novel) }))
    .sort((a, b) => b.original.stats.views - a.original.stats.views)
    .slice(0, 3);
  const tags = activeTags().slice(0, 14);
  const todayDay = WEEK_DAYS[DAY_IDX_FROM_GETDAY[kstDayOfWeek()]];
  const todayReleases = TITLES.filter(
    (t) => t.type === "webtoon" && t.status === "ongoing" && t.updateDays?.includes(todayDay)
  )
    .sort((a, b) => b.stats.views - a.stats.views)
    .slice(0, 12);
  return {
    featured,
    spotlight,
    topRated,
    waitFree,
    newest,
    families,
    tags,
    todayDay,
    todayReleases,
    genres: GENRES,
    // reviews 는 정적 단계에서 0 — 프론트가 정적 모드에서 /api/reviews/stats 로 보강(있으면)하거나 생략.
    stats: { titles: TITLES.length, platforms: PLATFORM_LIST.length, genres: GENRES.length, reviews: 0 },
    generatedAt: new Date().toISOString(),
  };
}

function writeJson(name: string, data: unknown): void {
  const file = path.join(OUT, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  const kb = (statSync(file).size / 1024).toFixed(0);
  console.log(`  ${name.padEnd(16)} ${kb.padStart(7)} KB`);
}

async function main(): Promise<void> {
  const titles = loadTitles();
  replaceCatalogData(titles, { source: "cli-ingest", sourceVersion: "static-build" });
  console.log(`정적 카탈로그 생성: ${TITLES.length}편 → ${path.relative(ROOT, OUT)}/`);

  // 산출물 초기화(낡은 파일 제거) 후 재생성. 뉴스는 수집 전체 실패 시 직전 스냅샷을
  // 보존해야 하므로(빈 파일로 덮지 않기) 삭제 전에 원문을 확보해 둔다.
  const newsFallbackRaw = readFileIfExists(path.join(OUT, "news.json"));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 전체 카탈로그(클라이언트 검색·탐색·랭킹·추천 계산용) — 경량 카드로 슬리밍해 싣는다.
  // 상세 전용 필드(시놉시스 원문·availability.url·ratingDist)는 detail/<bucket>.json 샤드로 분리.
  // 메모리 스토어(TITLES)는 풀 데이터를 유지 — insights(평점분포)·뉴스 매칭 등 빌드 계산은 원본 사용.
  writeJson("catalog.json", TITLES.map(toListTitle));
  const { files: detailShards, entryCount: detailEntryCount } = buildDetailShards(TITLES);
  let detailBytes = 0;
  detailShards.forEach((shard, bucket) => {
    const file = path.join(OUT, detailShardFileForBucket(bucket));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(shard));
    detailBytes += statSync(file).size;
  });
  console.log(
    `  detail/*.json    ${String(DETAIL_SHARD_COUNT).padStart(5)} files (${detailEntryCount} entries, ${(detailBytes / 1024).toFixed(0)} KB)`
  );
  // 파라미터 없는 공통 페이지 — 사전 계산(즉시 로드).
  writeJson("home.json", buildHome());
  const calendar = await getCalendarData();
  // 캘린더 항목도 경량 카드로 — CalItem·공용 필터·ICS 내보내기가 읽는 필드만 유지(시놉시스 제외).
  writeJson("calendar.json", {
    ...calendar,
    days: calendar.days.map((d) => ({ ...d, items: d.items.map(toCalendarTitle) })),
  });
  writeJson("insights.json", await getInsightsData());
  writeJson("tags.json", { tags: activeTags() });
  writeJson("authors.json", getAuthorDirectory());

  // 랭킹 기본 뷰 사전계산(축×타입). /ranking 즉시 로드.
  let rankingCount = 0;
  await buildRankingFiles((name, data) => {
    const file = path.join(OUT, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
    rankingCount += 1;
  });
  console.log(`  ranking/*.json   ${String(rankingCount).padStart(5)} files (축×타입 사전계산)`);

  writeSitemap();
  // 웹툰·웹소설 뉴스 — 수집·정제·작품 매칭은 scripts/news-gen.ts 담당(단독 실행도 가능).
  // 실패해도 빌드는 계속(직전 스냅샷 보존 → 없으면 빈 목록 폴백).
  await writeNews({ outFile: path.join(OUT, "news.json"), titles: TITLES, fallbackRaw: newsFallbackRaw });

  console.log("완료.");
}

// SEO 사이트맵 — 정적 라우트 + 품질 작품 상세 URL. apps/web/public/ 루트에 써서 /sitemap.xml 로 서빙.
// (apps/web/public/sitemap.xml 은 빌드 산출물이라 .gitignore. robots.txt 가 이 위치를 가리킨다.)
function writeSitemap(): void {
  const BASE = "https://www.toonstudio.cloud";
  const STATIC_ROUTES = [
    "/", "/search", "/ranking", "/recommend", "/explore", "/calendar",
    "/reviews", "/community", "/community/cafes", "/insights", "/authors", "/tags", "/compare",
    "/about", "/guide", "/news", "/create", "/shaper", "/market", "/market/browse", "/contact",
  ];
  // thin-content 방지를 위해 '평점이 있는' 작품만 색인(빈 페이지 제외) — 조회수 상위 15000편.
  // 표지 유무에 의존하지 않는다(표지 정책 off·19+ 제거와 무관하게 동작). 성인(19+) 작품은
  // 검색엔진에 노출하지 않는다(미성년 검색 유입 차단).
  const topTitles = TITLES.filter((t) => t.ageRating !== "19" && t.stats.ratingCount > 0)
    .sort((a, b) => b.stats.views - a.stats.views)
    .slice(0, 15000);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const entry = (loc: string, priority: string) =>
    `  <url><loc>${esc(loc)}</loc><priority>${priority}</priority></url>`;
  const urls = [
    ...STATIC_ROUTES.map((r) => entry(`${BASE}${r}`, r === "/" ? "1.0" : "0.8")),
    // 인기 순위 구간별 priority(상위일수록 높게) — 크롤 우선순위 힌트.
    ...topTitles.map((t, i) =>
      entry(`${BASE}/title/${encodeURIComponent(t.slug)}`, i < 1000 ? "0.7" : i < 5000 ? "0.6" : "0.5")
    ),
  ];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join("\n") +
    `\n</urlset>\n`;
  const file = path.join(ROOT, "apps", "web", "public", "sitemap.xml");
  writeFileSync(file, xml);
  console.log(`  sitemap.xml      ${(statSync(file).size / 1024).toFixed(0).padStart(5)} KB (${urls.length} URLs)`);
}

main().catch((error) => {
  console.error("정적 카탈로그 생성 실패:", error?.message ?? error);
  process.exit(1);
});
