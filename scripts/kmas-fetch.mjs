#!/usr/bin/env node
// KMAS(한국만화영상진흥원 만화규장각) 오픈 API 수집 — 공식 공공데이터로 시놉시스·썸네일 URL을 보강한다.
//
// 왜: 카탈로그의 시놉시스(원문)는 플랫폼 크롤 출처라 저작권/성과도용 리스크가 있다. KMAS Open API는
// 줄거리(outline)와 이미지 썸네일 URL(imageDownloadUrl)을 제공하므로 이를 정당한 소스로 보강한다.
// 이 스크립트는 KMAS 응답 구조(result + itemList)를 보존하면서 imageDownloadUrl URL 문자열만 저장한다.
// 이미지 바이너리는 저장하지 않는다(카탈로그 교체/병합은 kmas-update-catalog.mjs).
//
// 인증: KMAS_PRV_KEY(승인된 인증키) 필수. 미설정 시 즉시 종료(크롤 데이터 유지).
// 기본 호출: bookAndWebtoonList 에 prvKey 만 붙여 전체 목록을 가져온다.
// 문제가 생긴 경우에만 KMAS_FETCH_MODE=paged 로 pageNo/viewItemCnt 페이지 수집을 사용한다.
//
// 응답 엔벨로프:
//   - 문서 표기: result.itemlist
//   - 실 응답(2026-07 확인): { result: {...}, itemList: [...] }
// 두 구조를 모두 허용하되, 저장 파일은 실 응답 구조(itemList)를 기준으로 둔다.
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

const PRV_KEY = process.env.KMAS_PRV_KEY;
const BASE = process.env.KMAS_BASE_URL || "https://www.kmas.or.kr";
const OUT = process.env.KMAS_OUT || join(process.cwd(), "data", "kmas-catalog.json");
const FETCH_MODE = process.env.KMAS_FETCH_MODE === "paged" ? "paged" : "full-list";
const PAGE_SIZE = Math.min(Number(process.env.KMAS_PAGE_SIZE) || 100, 100);
const MAX_PAGES = Number(process.env.KMAS_MAX_PAGES) || 10; // 100×10 = 1000건/일 한도
const LIST_SE_CD = process.env.KMAS_LIST_SE_CD || ""; // 1=웹툰 (docs 기준). 실 서비스는 title 조건 없으면 빈 응답일 수 있다.
const TITLE = process.env.KMAS_TITLE || "";

// 공식 가이드 문서 기준 필드명. 실 응답에서 키 대소문자/철자가 다르면 여기만 조정한다.
const FIELDS = {
  title: ["prdctNm", "title"], // 작품명 우선, 서명 폴백
  synopsis: ["outline"], // 줄거리
  cover: ["imageDownloadUrl"], // 표지 이미지 URL 문자열
  isbn: ["isbn"],
  artist: ["pictrWritrNm"], // 그림작가
  writer: ["sntncWritrNm", "writrNm", "storyWritrNm"],
  genre: ["mainGenreCdNm"],
  age: ["ageGradCdNm"],
};

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function findRecords(json) {
  if (Array.isArray(json?.itemList)) return json.itemList;
  if (Array.isArray(json?.itemlist)) return json.itemlist;
  if (Array.isArray(json?.result?.itemList)) return json.result.itemList;
  if (Array.isArray(json?.result?.itemlist)) return json.result.itemlist;
  return [];
}

function assertResultOk(json, label) {
  if (json?.result?.resultState && json.result.resultState !== "success") {
    throw new Error(`KMAS resultState=${json.result.resultState} (${label}): ${json.result.resultMessage ?? "unknown error"}`);
  }
}

function normalize(rec) {
  const title = pick(rec, FIELDS.title);
  if (!title) return null;
  return {
    source: "kmas",
    title,
    synopsis: pick(rec, FIELDS.synopsis),
    coverImageUrl: pick(rec, FIELDS.cover),
    isbn: pick(rec, FIELDS.isbn).replace(/[^0-9Xx]/g, ""),
    artist: pick(rec, FIELDS.artist),
    writer: pick(rec, FIELDS.writer),
    genre: pick(rec, FIELDS.genre),
    ageRating: pick(rec, FIELDS.age),
  };
}

async function fetchPage(pageNo) {
  const url = new URL(`${BASE}/openapi/search/bookAndWebtoonList`);
  url.searchParams.set("prvKey", PRV_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("viewItemCnt", String(PAGE_SIZE));
  if (LIST_SE_CD) url.searchParams.set("listSeCd", LIST_SE_CD);
  if (TITLE) url.searchParams.set("title", TITLE);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`KMAS ${res.status} ${res.statusText} (page ${pageNo})`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`KMAS 응답이 JSON 이 아님 (page ${pageNo}): ${text.slice(0, 200)}`);
  }
  assertResultOk(json, `page ${pageNo}`);
  return { result: json?.result ?? null, records: findRecords(json) };
}

async function fetchFullList() {
  const url = new URL(`${BASE}/openapi/search/bookAndWebtoonList`);
  url.searchParams.set("prvKey", PRV_KEY);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`KMAS ${res.status} ${res.statusText} (full-list)`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`KMAS 응답이 JSON 이 아님 (full-list): ${text.slice(0, 200)}`);
  }
  assertResultOk(json, "full-list");
  return { result: json?.result ?? null, records: findRecords(json) };
}

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

async function main() { // NOSONAR javascript:S3776
  if (!PRV_KEY) {
    console.error(
      "[kmas] KMAS_PRV_KEY 미설정 — 수집을 건너뜁니다(크롤 데이터 유지).\n" +
        "  승인된 인증키를 발급받아: KMAS_PRV_KEY=<키> pnpm kmas:fetch"
    );
    process.exit(0);
  }
  const byTitle = new Map();
  let total = 0;
  const pages = [];

  if (FETCH_MODE === "full-list") {
    const pageData = await fetchFullList();
    const recs = pageData.records;
    pages.push({
      result: pageData.result,
      itemList: recs,
    });
    for (const raw of recs) {
      const item = normalize(raw);
      if (!item) continue;
      // 같은 작품 중복 시 시놉시스·썸네일 URL이 더 채워진 레코드를 우선.
      const key = item.isbn || item.title;
      const prev = byTitle.get(key);
      const score = (r) => (r.synopsis ? 2 : 0) + (r.coverImageUrl ? 1 : 0);
      if (!prev || score(item) > score(prev)) byTitle.set(key, item);
    }
    total += recs.length;
    console.error(`[kmas] full-list: ${recs.length}건 (누적 고유 ${byTitle.size})`);
  } else {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let pageData;
      try {
        pageData = await fetchPage(page);
      } catch (err) {
        console.error(`[kmas] page ${page} 실패: ${err.message}`);
        break;
      }
      const recs = pageData.records;
      pages.push({
        result: pageData.result,
        itemList: recs,
      });
      if (recs.length === 0) break;
      for (const raw of recs) {
        const item = normalize(raw);
        if (!item) continue;
        // 같은 작품 중복 시 시놉시스·썸네일 URL이 더 채워진 레코드를 우선.
        const key = item.isbn || item.title;
        const prev = byTitle.get(key);
        const score = (r) => (r.synopsis ? 2 : 0) + (r.coverImageUrl ? 1 : 0);
        if (!prev || score(item) > score(prev)) byTitle.set(key, item);
      }
      total += recs.length;
      console.error(`[kmas] page ${page}: ${recs.length}건 (누적 고유 ${byTitle.size})`);
      if (recs.length < PAGE_SIZE) break; // 마지막 페이지
    }
  }
  const items = [...byTitle.values()];
  const withSynopsis = items.filter((i) => i.synopsis).length;
  const withCover = items.filter((i) => i.coverImageUrl).length;
  writeAtomic(OUT, {
    generatedAt: new Date().toISOString(),
    source: "kmas",
    endpoint: "/openapi/search/bookAndWebtoonList",
    request: {
      mode: FETCH_MODE,
      listSeCd: LIST_SE_CD || null,
      title: TITLE || null,
      pageSize: FETCH_MODE === "paged" ? PAGE_SIZE : null,
      maxPages: FETCH_MODE === "paged" ? MAX_PAGES : null,
    },
    result: {
      resultState: "success",
      resultMessage: "수집 완료",
      totalCount: items.length,
      viewItemCnt: items.length,
      pageNo: 1,
    },
    itemList: pages.flatMap((page) => page.itemList),
    normalizedItems: items,
  });
  console.error(
    `[kmas] 완료 → ${OUT}\n` +
      `  수집 ${total}건 · 고유 ${items.length} · 시놉시스 ${withSynopsis} · 썸네일 URL ${withCover}`
  );
}

main().catch((err) => {
  console.error("[kmas] 오류:", err);
  process.exit(1);
});
