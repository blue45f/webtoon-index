#!/usr/bin/env node
// 기존 apps/api/data/catalog.json.gz 를 KMAS 전체 목록 응답과 병합한다.
//
// KMAS_UPDATE_MODE=full-list 로 /openapi/search/bookAndWebtoonList 를 prvKey 만 붙여 호출할 수 있다.
// 다만 현재 KMAS 원본은 prvKey 단독 전체 목록 호출에 "데이터가 없습니다."를 반환하므로, 기본값은
// 기존 카탈로그 제목으로 조회하는 title-search 모드다.
// imageDownloadUrl은 기존 크롤 썸네일 URL과 같은 메타데이터로 저장하되, 이미지 바이너리는 저장하지 않고
// /api/cover 서버 프록시로도 감싸지 않는다.
//
// 사용:
//   KMAS_PRV_KEY=<키> pnpm kmas:update-catalog
//   KMAS_UPDATE_ONLY_MISSING=1 KMAS_PRV_KEY=<키> node scripts/kmas-update-catalog.mjs
//   KMAS_UPDATE_MODE=full-list KMAS_PRV_KEY=<키> node scripts/kmas-update-catalog.mjs
//   KMAS_PROXY_BASE=http://127.0.0.1:4001 node scripts/kmas-update-catalog.mjs

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = process.env.WEBDEX_CATALOG_FILE || path.join(ROOT, "apps/api/data/catalog.json.gz");
const BASE = (process.env.KMAS_BASE_URL || "https://www.kmas.or.kr").replace(/\/+$/, "");
const PRV_KEY = process.env.KMAS_PRV_KEY?.trim();
const PROXY_BASE = process.env.KMAS_PROXY_BASE?.trim().replace(/\/+$/, "");
const MODE = process.env.KMAS_UPDATE_MODE === "full-list" ? "full-list" : "title-search";
const FULL_LIST_MODE = MODE === "full-list";
const LIMIT = boundedInt(
  process.env.KMAS_UPDATE_LIMIT,
  FULL_LIST_MODE ? Number.MAX_SAFE_INTEGER : 100,
  1,
  Number.MAX_SAFE_INTEGER
);
const START = boundedInt(process.env.KMAS_UPDATE_START, 0, 0, Number.MAX_SAFE_INTEGER);
const CONCURRENCY = boundedInt(process.env.KMAS_UPDATE_CONCURRENCY, 3, 1, 8);
const ONLY_MISSING = process.env.KMAS_UPDATE_ONLY_MISSING === "1";
const ONLY_WITH_COVER = process.env.KMAS_UPDATE_ONLY_WITH_COVER === "1";
const UPDATE_SYNOPSIS = process.env.KMAS_UPDATE_SYNOPSIS !== "0";

function mainGuard() {
  if (!PRV_KEY && !PROXY_BASE) {
    console.error("[kmas:update] KMAS_PRV_KEY 또는 KMAS_PROXY_BASE 미설정 — 갱신을 중단합니다.");
    process.exit(2);
  }
  if (!existsSync(CATALOG)) {
    console.error(`[kmas:update] catalog not found: ${CATALOG}`);
    process.exit(2);
  }
}

function loadCatalog(file) {
  const raw = file.endsWith(".gz")
    ? gunzipSync(readFileSync(file)).toString("utf8")
    : readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  const titles = Array.isArray(parsed) ? parsed : parsed?.titles;
  if (!Array.isArray(titles)) throw new Error("catalog titles 배열 없음");
  return { wrapper: Array.isArray(parsed) ? { titles } : parsed, titles };
}

function writeCatalog(file, wrapper) {
  const body = JSON.stringify(wrapper);
  const payload = file.endsWith(".gz") ? gzipSync(Buffer.from(body), { level: 9 }) : Buffer.from(body);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

async function fetchKmasFullList() {
  const url = PROXY_BASE
    ? new URL(`${PROXY_BASE}/api/kmas/book-webtoons`)
    : new URL(`${BASE}/openapi/search/bookAndWebtoonList`);
  if (!PROXY_BASE) url.searchParams.set("prvKey", PRV_KEY);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`KMAS ${response.status} ${response.statusText}`);
  const json = await response.json();
  if (json?.result?.resultState && json.result.resultState !== "success") {
    throw new Error(`KMAS resultState=${json.result.resultState}: ${json.result.resultMessage ?? "unknown error"}`);
  }
  return itemsOf(json);
}

async function fetchKmasByTitle(title) {
  const url = PROXY_BASE
    ? new URL(`${PROXY_BASE}/api/kmas/book-webtoons`)
    : new URL(`${BASE}/openapi/search/bookAndWebtoonList`);
  if (!PROXY_BASE) url.searchParams.set("prvKey", PRV_KEY);
  url.searchParams.set("title", title);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("viewItemCnt", "10");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`KMAS ${response.status} ${response.statusText}`);
  const json = await response.json();
  return itemsOf(json);
}

function itemsOf(json) {
  if (Array.isArray(json?.itemList)) return json.itemList;
  if (Array.isArray(json?.itemlist)) return json.itemlist;
  if (Array.isArray(json?.result?.itemList)) return json.result.itemList;
  if (Array.isArray(json?.result?.itemlist)) return json.result.itemlist;
  return [];
}

function buildKmasIndex(items) {
  const index = new Map();
  for (const item of items) {
    for (const key of itemLookupKeys(item)) {
      const bucket = index.get(key);
      if (bucket) bucket.push(item);
      else index.set(key, [item]);
    }
  }
  return index;
}

function bestMatchFromIndex(title, index) {
  const candidates = [];
  const seen = new Set();
  for (const key of titleLookupKeys(title)) {
    for (const item of index.get(key) ?? []) {
      if (seen.has(item)) continue;
      seen.add(item);
      candidates.push(item);
    }
  }
  return bestMatch(title, candidates);
}

function bestMatch(title, items) { // NOSONAR javascript:S3776
  const titleKey = normalizeTitleKey(title.title);
  const authorKey = normalizeCreatorKey(title.author);
  let best = null;
  for (const item of items) {
    const productKey = normalizeTitleKey(item.prdctNm);
    const itemTitleKey = normalizeTitleKey(cleanBookTitle(cleanText(item.title)));
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
  return best && best.score >= 50 ? best.item : null;
}

function itemLookupKeys(item) {
  return uniqueKeys([item.prdctNm, cleanBookTitle(cleanText(item.title)), item.orginlTitle]);
}

function titleLookupKeys(title) {
  return uniqueKeys([title.title, ...(Array.isArray(title.altTitles) ? title.altTitles : [])]);
}

function uniqueKeys(values) {
  return [...new Set(values.map(normalizeTitleKey).filter(Boolean))];
}

function mergeTitle(title, item) {
  let changed = false;
  const cover = kmasImageUrl(item.imageDownloadUrl);
  if (cover && title.coverImage !== cover) {
    title.coverImage = cover;
    changed = true;
  }
  const outline = cleanText(item.outline);
  if (UPDATE_SYNOPSIS && outline && outline.length > 20 && title.synopsis !== outline) {
    title.synopsis = outline;
    changed = true;
  }
  const age = mapAge(item.ageGradCdNm);
  if (age && title.ageRating !== age) {
    title.ageRating = age;
    changed = true;
  }
  return changed;
}

function candidateTitles(titles) {
  return [...titles]
    .filter(
      (title) =>
        title?.title &&
        (!ONLY_MISSING || !title.coverImage) &&
        (!ONLY_WITH_COVER || title.coverImage) &&
        !isKmasCover(title.coverImage)
    )
    .sort((a, b) => { // NOSONAR javascript:S3776
      if (ONLY_WITH_COVER) {
        return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.stats?.views ?? 0) - (a.stats?.views ?? 0);
      }
      if (!a.coverImage && b.coverImage) return -1;
      if (a.coverImage && !b.coverImage) return 1;
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.stats?.views ?? 0) - (a.stats?.views ?? 0);
    })
    .slice(START, START + LIMIT);
}

async function run() { // NOSONAR javascript:S3776
  mainGuard();
  const { wrapper, titles } = loadCatalog(CATALOG);
  const targets = candidateTitles(titles);
  let cursor = 0;
  let matched = 0;
  let updated = 0;
  let failed = 0;
  let sourceItems = 0;

  console.error(
    `[kmas:update] 대상 ${targets.length}편 (mode=${MODE}, limit=${LIMIT}, start=${START}, concurrency=${CONCURRENCY}, onlyMissing=${ONLY_MISSING}, onlyWithCover=${ONLY_WITH_COVER})`
  );

  if (FULL_LIST_MODE) {
    const items = await fetchKmasFullList();
    sourceItems = items.length;
    const index = buildKmasIndex(items);
    console.error(`[kmas:update] 전체 목록 ${sourceItems}건 수신, 제목 인덱스 ${index.size}개`);
    for (const title of targets) {
      const item = bestMatchFromIndex(title, index);
      if (!item) continue;
      matched += 1;
      if (mergeTitle(title, item)) updated += 1;
    }
  } else {
    async function worker() {
      while (cursor < targets.length) {
        const title = targets[cursor++];
        try {
          const items = await fetchKmasByTitle(title.title);
          const item = bestMatch(title, items);
          if (!item) continue;
          matched += 1;
          if (mergeTitle(title, item)) updated += 1;
        } catch (error) {
          failed += 1;
          console.error(`[kmas:update] ${title.title} 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));
  }

  wrapper.titles = titles;
  wrapper.count = titles.length;
  wrapper.sourceVersion = wrapper.sourceVersion ?? "catalog/kmas-merged";
  wrapper.crawledAt = wrapper.crawledAt ?? new Date().toISOString();
  wrapper.metadata = {
    ...(wrapper.metadata && typeof wrapper.metadata === "object" ? wrapper.metadata : {}),
    kmas: {
      updatedAt: new Date().toISOString(),
      mode: MODE,
      limit: LIMIT,
      start: START,
      sourceItems,
      attempted: targets.length,
      onlyMissing: ONLY_MISSING,
      onlyWithCover: ONLY_WITH_COVER,
      matched,
      updated,
      failed,
    },
  };
  writeCatalog(CATALOG, wrapper);
  console.error(
    `[kmas:update] 완료: sourceItems=${sourceItems} attempted=${targets.length} matched=${matched} updated=${updated} failed=${failed}`
  );
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function kmasImageUrl(value) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!/(^|\.)kmas\.or\.kr$/i.test(url.hostname)) return undefined;
  return raw;
}

function isKmasCover(value) {
  if (!value) return false;
  try {
    const match = String(value).match(/[?&]u=([^&]+)/);
    const url = match ? new URL(decodeURIComponent(match[1])) : new URL(String(value));
    return /(^|\.)kmas\.or\.kr$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBookTitle(value) {
  return value.replace(/\[[^\]]+\]/g, "").replace(/\s+\d+[권화부]?$/g, "").trim();
}

function cleanCreator(value) {
  return cleanText(value)
    .replace(/\s*(글|그림|원작|작가)\s*$/g, "")
    .trim();
}

function normalizeTitleKey(value) {
  return cleanBookTitle(cleanText(value))
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[\s:~!?,.\-()[\]·"'《》<>]/g, "")
    .toLowerCase();
}

function normalizeCreatorKey(value) {
  return cleanCreator(value).replace(/[\s,./·]/g, "").toLowerCase();
}

function mapAge(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (/19|청소년|성인/.test(text)) return "19";
  if (/15/.test(text)) return "15";
  if (/12/.test(text)) return "12";
  return "all";
}

run().catch((error) => {
  console.error("[kmas:update] 오류:", error);
  process.exit(1);
});
