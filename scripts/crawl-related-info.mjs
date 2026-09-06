// 관련 정보 크롤러 — 작품별로 "실제 목적지 직링크"(유튜브 영상·네이버 뉴스 기사·나무위키 문서·
// 네이버 블로그 글)를 수집해 data/related-info.json 에 { [titleId]: RelatedInfoItem[] } 로 저장한다.
// 웹툰 카탈로그 크롤(scripts/crawl.mjs)과 같은 규약: 검색 결과 페이지가 아닌 개별 목적지 URL,
// additive 머지, resumable(이미 있는 작품은 --refresh 없으면 건너뜀), 레이트리밋, 원자적 저장.
//
// 사용:
//   node scripts/crawl-related-info.mjs                 # 상위 200개(기본), 이미 수집분 스킵
//   node scripts/crawl-related-info.mjs --limit 500     # 상위 500개
//   node scripts/crawl-related-info.mjs --refresh       # 이미 수집분도 다시 크롤(카테고리별 병합)
//   node scripts/crawl-related-info.mjs --id nw-828167  # 특정 작품만
//
// 60,229개 전량은 비현실적이라 인기 상위부터 additive 로 넓혀간다(카탈로그와 동일 전략).
//
// 제목 정확성: 뉴스/블로그 제목은 검색결과 마크업(네이버 난독화 sds-comps-*)의 DOM 근접추정이
// 아니라 "각 기사/포스트 페이지의 og:title" 을 직접 읽어 붙인다 → URL 과 제목이 항상 일치.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractOgTitle,
  jsonUnescape,
  mapNaverBlogItems,
  mapNaverNewsItems,
  mapYoutubeApiItems,
} from "./related-info-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "public", "data", "catalog.json");
const OUT = join(ROOT, "data", "related-info.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const rawLimit = Number(argVal("--limit", "200"));
const LIMIT = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200; // --limit abc → 기본값(무음 0-크롤 방지)
const REFRESH = args.includes("--refresh");
const ONLY_ID = argVal("--id", null);
const DELAY_MS = Number(argVal("--delay", "700")); // 소스 간·작품 간 예의상 간격

// 공식 API 키(선택) — 설정돼 있으면 각 사 ToS 를 준수하는 "공식 검색 API" 를 우선 사용하고,
// 없으면 HTML 스크래핑으로 폴백한다. 상업 서비스는 공식 API 사용을 권장(스크래핑은 각 사 약관 위반 소지).
//   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET — https://developers.naver.com 검색 API(무료, 뉴스/블로그)
//   YOUTUBE_API_KEY                       — https://console.cloud.google.com YouTube Data API v3(일 1만 쿼터 무료, 스로틀 없음)
const NAVER_ID = process.env.NAVER_CLIENT_ID || "";
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET || "";
const YT_API_KEY = process.env.YOUTUBE_API_KEY || "";
const hasNaverApi = Boolean(NAVER_ID && NAVER_SECRET);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, { referer } = {}) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: "follow",
    });
    return r.status < 400 ? await r.text() : "";
  } catch {
    return "";
  }
}

// decodeEntities·jsonUnescape 는 순수 파싱이라 ./related-info-parse.mjs 로 분리(단위 테스트 대상).

// 목적지 페이지의 실제 제목(og:title 우선, 없으면 <title>). URL 마다 정확한 제목이라 오귀속 없음.
async function fetchOgTitle(url) {
  return extractOgTitle(await fetchHtml(url)); // 순수 파싱은 related-info-parse.mjs(따옴표 안전·테스트됨)
}

// 유튜브(구글)는 IP당 ~5~10회 급속 요청 후 google.com/sorry/ 봇체크로 302 스로틀한다(rate 기반).
// redirect:follow 는 20회 리다이렉트를 다 따라가 느리고 결국 throw → redirect:manual 로 즉시 감지,
// 스로틀 걸리면 쿨다운 동안 유튜브를 건너뛴다(불필요한 /sorry/ 난타 방지 + 스로틀 자연회복 유도).
// news/wiki/blog 는 영향 없이 계속 수집되므로 유튜브는 best-effort(주기 크롤로 누적).
let ytBlockedUntil = 0;
const YT_COOLDOWN_MS = 60000;

// 유튜브 검색 HTML 가져오기 — 스로틀(302 /sorry/)이면 쿨다운 진입 후 "" 반환.
async function fetchYoutubeHtml(query) {
  if (Date.now() < ytBlockedUntil) return ""; // 쿨다운 중 — 스로틀 회복 대기
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(
      "https://www.youtube.com/results?search_query=" + encodeURIComponent(query) + "&hl=ko&gl=KR",
      { headers: { "User-Agent": UA, "Accept-Language": "ko-KR", Cookie: "PREF=hl=ko&gl=KR" }, redirect: "manual", signal: ctl.signal }
    );
    clearTimeout(to);
    if (r.status >= 300 && r.status < 400) {
      ytBlockedUntil = Date.now() + YT_COOLDOWN_MS; // /sorry/ 스로틀 감지 → 쿨다운 진입
      return "";
    }
    if (r.status < 200 || r.status >= 300) return "";
    return await r.text();
  } catch {
    return "";
  }
}

// YouTube Data API v3(키 있으면) — ToS 준수 + 스로틀 없음. 없으면 검색 HTML 스크래핑 폴백.
async function youtubeApi(query, max) {
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${max}` +
        `&relevanceLanguage=ko&regionCode=KR&q=${encodeURIComponent(query)}&key=${YT_API_KEY}`
    );
    if (!r.ok) return [];
    const j = await r.json();
    return mapYoutubeApiItems(j.items, max);
  } catch {
    return [];
  }
}

async function crawlYoutube(query, max = 3) {
  if (YT_API_KEY) return youtubeApi(query, max);
  const html = await fetchYoutubeHtml(query);
  if (!html) return [];
  const out = [];
  const seen = new Set();
  // 제목은 JSON 문자열 전체를 이스케이프까지 포함해 캡처(\" 로 잘리지 않게)한 뒤 jsonUnescape.
  const re =
    /"videoId":"([\w-]{11})"[\s\S]{0,600}?"title":\{(?:"runs":\[\{"text":"((?:[^"\\]|\\.)*)"|"simpleText":"((?:[^"\\]|\\.)*)")/g;
  let m;
  while (true) {
    m = re.exec(html);
    if (!m || out.length >= max) break;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = jsonUnescape(m[2] || m[3] || "").trim();
    if (!title) continue;
    // 조회수 — videoId 바로 뒤 좁은 창(400자)에서만(다음 영상 값 차용 방지).
    const around = html.slice(m.index, m.index + 400);
    const viewM = around.match(/"viewCountText":\{"simpleText":"([^"]+)"/);
    out.push({ id, title, views: viewM ? jsonUnescape(viewM[1]) : undefined });
  }
  return out;
}

// ── 나무위키: 문서 존재 확인(있을 때만 링크) ──
async function crawlNamu(title) {
  const url = "https://namu.wiki/w/" + encodeURIComponent(title);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR" }, redirect: "follow" });
    // 없는 문서는 404. 존재하면 200 + 충분한 본문. 안티봇 챌린지(200이지만 짧거나 안내문구) 배제.
    if (r.status !== 200) return null;
    const text = await r.text();
    if (text.length < 5000 || /해당 문서를 찾을 수 없습니다|존재하지 않는 문서/.test(text)) return null;
    return url;
  } catch {
    return null;
  }
}

// 네이버 통합검색 결과에서 목적지 URL만 확정 추출(제목은 fetchOgTitle 로 페이지에서 직접).
async function naverResultUrls(where, query, pattern, max) {
  const html = await fetchHtml(
    `https://search.naver.com/search.naver?where=${where}&sm=tab_jum&query=` + encodeURIComponent(query),
    { referer: "https://www.naver.com/" }
  );
  if (!html) return [];
  const urls = [];
  const seen = new Set();
  for (const m of html.matchAll(pattern)) {
    if (urls.length >= max) break;
    const url = m[0].replace(/&amp;/g, "&");
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

// 네이버 검색 오픈 API(뉴스/블로그) — ToS 준수. items[].title 은 <b> 태그·HTML 엔티티 포함이라 정제.
async function naverSearchApi(kind, query, display) {
  try {
    const r = await fetch(
      `https://openapi.naver.com/v1/search/${kind}.json?query=${encodeURIComponent(query)}&display=${display}&sort=sim`,
      { headers: { "X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET } }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}

// ── 네이버 뉴스: 공식 API 우선(키 있으면), 없으면 실제 기사 링크 + og:title 스크래핑 ──
async function crawlNaverNews(query, max = 2) {
  if (hasNaverApi) {
    return mapNaverNewsItems(await naverSearchApi("news", query, max), query, max);
  }
  const urls = await naverResultUrls("news", query, /https?:\/\/n\.news\.naver\.com\/[^\s"'<>\\]+/g, max);
  const titles = await Promise.all(urls.map((u) => fetchOgTitle(u)));
  return urls.map((url, i) => ({
    url,
    title: titles[i] && titles[i].length >= 6 ? titles[i] : `${query} 관련 뉴스 ${i + 1}`,
  }));
}

// ── 네이버 블로그: 공식 API 우선(키 있으면), 없으면 실제 포스트 링크 + og:title 스크래핑 ──
async function crawlNaverBlog(query, max = 1) {
  if (hasNaverApi) {
    return mapNaverBlogItems(await naverSearchApi("blog", query, max), query, max);
  }
  const urls = await naverResultUrls("blog", query, /https?:\/\/blog\.naver\.com\/[A-Za-z0-9_-]+\/\d{6,}/g, max);
  // 데스크톱 blog.naver.com 은 iframe 이라 og:title 이 빈약 → m.blog 로 실제 제목을 읽는다.
  const titles = await Promise.all(urls.map((u) => fetchOgTitle(u.replace("blog.naver.com", "m.blog.naver.com"))));
  return urls.map((url, i) => ({
    url,
    title: titles[i] && titles[i].length >= 6 ? titles[i] : `${query} 후기·리뷰 블로그`,
  }));
}

// ── 작품 1건 → RelatedInfoItem[] ──
async function crawlOne(title) {
  const t = title.title;
  const kind = title.type === "webnovel" ? "웹소설" : "웹툰";
  const q = `${t} ${kind}`;
  const items = [];

  const [yt, namu, news, blog] = await Promise.all([
    crawlYoutube(q, 3),
    crawlNamu(t),
    crawlNaverNews(q, 2),
    crawlNaverBlog(q, 1),
  ]);

  yt.forEach((v, i) => {
    items.push({
      id: `yt-${title.id}-${i}`,
      category: "youtube",
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      sourceName: "유튜브",
      dateOrViews: v.views,
      thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    });
  });
  if (namu) {
    items.push({
      id: `wiki-${title.id}`,
      category: "wiki",
      title: `나무위키: ${t}`,
      url: namu,
      sourceName: "나무위키",
      dateOrViews: "위키 문서",
      badge: "세계관 설정",
    });
  }
  news.forEach((n, i) => {
    items.push({ id: `news-${title.id}-${i}`, category: "news", title: n.title, url: n.url, sourceName: "네이버 뉴스", dateOrViews: "언론 보도" });
  });
  blog.forEach((b, i) => {
    items.push({ id: `blog-${title.id}-${i}`, category: "blog", title: b.title, url: b.url, sourceName: "네이버 블로그", dateOrViews: "후기·분석" });
  });
  // 방어: url/title 이 비면 깨진 카드가 되므로 제외.
  return items.filter((it) => it.url && it.title);
}

// 이번 크롤 결과를 기존 항목과 카테고리 단위로 병합 — 이번에 응답 없은 카테고리(예: 뉴스 다운)의
// 기존 데이터를 덮어써 잃지 않게 한다(--refresh/--id 부분 실패 회귀 방지).
function mergeItems(prev, next) {
  if (!Array.isArray(prev) || prev.length === 0) return next;
  const freshCats = new Set(next.map((it) => it.category));
  const kept = prev.filter((it) => !freshCats.has(it.category));
  return [...next, ...kept];
}

// 인기 지표 — catalog 카드의 stats(스칼라: views/likes/bookmarks/ratingCount)에서 뽑는다.
function popScore(t) {
  const s = t.stats || {};
  return (s.views || 0) + (s.likes || 0) * 5 + (s.bookmarks || 0) * 4 + (s.ratingCount || 0) * 3;
}

function loadSnapshot() {
  if (!existsSync(OUT)) return {};
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    // 손상된 스냅샷을 만나면 조용히 덮어쓰지 않는다 — 크래시로 알리고 사람이 확인/삭제하게.
    console.error(`기존 스냅샷(${OUT}) 파싱 실패 — 손상 가능. 확인 후 삭제하거나 복구하세요.\n`, e);
    process.exit(1);
  }
}

// 원자적 저장: tmp 에 쓰고 rename(카탈로그 ingest 와 동일). 중단 시 truncated 파일이 남지 않게.
function persist(data) {
  mkdirSync(dirname(OUT), { recursive: true });
  const sorted = {};
  for (const k of Object.keys(data).sort()) sorted[k] = data[k]; // 결정성(diff 안정)
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify(sorted, null, 0));
  renameSync(tmp, OUT);
}

async function main() { // NOSONAR javascript:S3776
  // 소스별 모드 표시(투명성): 공식 API(ToS 준수) vs HTML 스크래핑 폴백.
  console.log(
    `소스 모드 — 유튜브: ${YT_API_KEY ? "공식 API" : "스크래핑(스로틀 있음)"} · ` +
      `네이버 뉴스/블로그: ${hasNaverApi ? "공식 API" : "스크래핑"} · 나무위키: 문서 존재확인`
  );
  if (!YT_API_KEY || !hasNaverApi) {
    console.log(
      "  ↳ 공식 API 키를 설정하면 ToS 준수+품질↑+유튜브 스로틀 해소: NAVER_CLIENT_ID/NAVER_CLIENT_SECRET, YOUTUBE_API_KEY"
    );
  }
  if (!existsSync(CATALOG)) {
    console.error(`catalog not found: ${CATALOG} — run 'pnpm catalog:gen' first`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(CATALOG, "utf-8"));
  const titles = Array.isArray(raw) ? raw : raw.titles || raw.items || [];
  if (!titles.length) {
    console.error("no titles in catalog");
    process.exit(1);
  }

  const existing = loadSnapshot();

  const targets = ONLY_ID
    ? titles.filter((t) => t.id === ONLY_ID)
    : [...titles].sort((a, b) => popScore(b) - popScore(a)).slice(0, LIMIT);

  let done = 0;
  let withData = 0;
  for (const title of targets) {
    if (!REFRESH && !ONLY_ID && Array.isArray(existing[title.id]) && existing[title.id].length > 0) {
      continue; // resumable — 이미 수집됨
    }
    const items = await crawlOne(title);
    done += 1;
    if (items.length > 0) {
      existing[title.id] = REFRESH || ONLY_ID ? mergeItems(existing[title.id], items) : items;
      withData += 1;
    }
    if (done % 10 === 0) {
      console.log(`  [${done}/${targets.length}] ${title.title} — ${items.length} links (누적 수집 ${withData})`);
      persist(existing); // 중간 저장(원자적) — 중단돼도 진행분 보존.
    }
    await sleep(DELAY_MS);
  }

  persist(existing);
  console.log(`완료: ${done}개 크롤, ${withData}개 링크 수집. 총 ${Object.keys(existing).length}개 작품 데이터. → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
