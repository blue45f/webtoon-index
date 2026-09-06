// ToonSpectrum 실데이터 크롤러 — 네이버 웹툰/시리즈/카카오웹툰/레진 공개 카탈로그 벤치마킹
// 운영 실행: node scripts/crawl.mjs --json --no-file → ingest(runCatalogIngest/scripts/ingest.mjs)가
// 검증 후 catalog.json.gz 파일로 저장(카탈로그는 파일 전용 — DB catalog_snapshot 은 레거시 FORCE_DB 모드)
// 웹툰: 제목·작가·별점·조회·관심·장르·시놉시스·태그·연재요일·연령등급·연재시작연도·표지썸네일 (실수집)
// 웹소설: 웹툰 원작정보(novelOriginAuthors)로 실제 원작 엔트리+어댑테이션 연결 / 네이버 시리즈 베스트에포트 보강
import { buildLezhinCoverImage, decodeHtmlEntities, extractRemoteImageUrl, proxiedCoverUrl } from "./crawl-helpers.mjs";
import { crawl as crawlRidi } from "./crawlers/ridi.mjs";
import { crawl as crawlKakaoPage } from "./crawlers/kakao-page.mjs";
import { crawl as crawlMunpia } from "./crawlers/munpia.mjs";
import { crawl as crawlJoara } from "./crawlers/joara.mjs";
import { crawl as crawlPostype } from "./crawlers/postype.mjs";
import { crawl as crawlMrblue } from "./crawlers/mrblue.mjs";
import { crawl as crawlBookcube } from "./crawlers/bookcube.mjs";
import { crawl as crawlOnestory } from "./crawlers/onestory.mjs";
import { crawl as crawlYes24 } from "./crawlers/yes24.mjs";
import { crawl as crawlNovelpia } from "./crawlers/novelpia.mjs";
import { crawl as crawlBomtoon } from "./crawlers/bomtoon.mjs";
import { crawl as crawlToptoon } from "./crawlers/toptoon.mjs";
import { crawl as crawlToomics } from "./crawlers/toomics.mjs";
import { crawl as crawlKyobo } from "./crawlers/kyobo.mjs";
import { crawl as crawlComico } from "./crawlers/comico.mjs";
import { readFileSync } from "node:fs";

// 중소형 플랫폼 (공개 카탈로그) 크롤러 — partner-required → crawler 승격분.
const EXTRA_CRAWLERS = [
  ["ridi", crawlRidi],
  ["kakao-page", crawlKakaoPage],
  ["munpia", crawlMunpia],
  ["joara", crawlJoara],
  ["postype", crawlPostype],
  ["mrblue", crawlMrblue],
  ["bookcube", crawlBookcube],
  ["onestory", crawlOnestory],
  ["yes24", crawlYes24],
  ["novelpia", crawlNovelpia],
  ["bomtoon", crawlBomtoon],
  ["toptoon", crawlToptoon],
  ["toomics", crawlToomics],
  ["kyobo", crawlKyobo],
  ["comico", crawlComico],
];

const ARGS = new Set(process.argv.slice(2));
const OUTPUT_JSON = ARGS.has("--json");
const log = (...args) => {
  if (OUTPUT_JSON) console.error(...args);
  else console.log(...args);
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// 선택적 네이버 인증 쿠키(.env.local 의 NAVER_COOKIE="NID_AUT=...; NID_SES=...").
// 설정 시 시리즈/웹툰 요청에 Cookie 를 붙여, 비로그인 가림막(19over placeholder) 대신 실제 19금 표지를 받는다.
// 절대 커밋/로그 출력 금지(.env.local 은 gitignore). 미설정 시 기존 익명 크롤과 동일.
function readEnvLocalValue(key) {
  for (const rel of ["../.env.local", "../../.env.local"]) {
    try {
      const txt = readFileSync(new URL(rel, import.meta.url), "utf8");
      const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
      if (m) return m[1].replace(/(?:^['"]|['"]$)/g, "").trim();
    } catch {
      /* 파일 없음 — 다음 후보 */
    }
  }
  return undefined;
}
const NAVER_COOKIE = process.env.NAVER_COOKIE || readEnvLocalValue("NAVER_COOKIE");
const naverCookieHdr = NAVER_COOKIE ? { Cookie: NAVER_COOKIE } : {};
const HW = { "User-Agent": UA, Referer: "https://comic.naver.com/", Accept: "application/json", ...naverCookieHdr };
const HS = { "User-Agent": UA, Referer: "https://series.naver.com/", ...naverCookieHdr };
if (NAVER_COOKIE) log("네이버 인증 쿠키 적용 — 19금 표지 포함 인증 크롤 모드");
const HL = {
  "User-Agent": UA,
  Referer: "https://www.lezhin.com/ko/ranking",
  Accept: "application/json",
  "x-lz-adult": "0",
  "x-lz-allowadult": "false",
  "x-lz-country": "kr",
  "x-lz-locale": "ko-KR",
};
const parsePositiveInt = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
};
const parseOptionalInt = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
};

const WEBTOON_CAP = parsePositiveInt(process.env.WEBDEX_WEBTOON_CAP);
const WEBTOON_DETAIL_CAP = parsePositiveInt(process.env.WEBDEX_WEBTOON_DETAIL_CAP) ?? 300;
const NOVEL_BONUS_CAP = parsePositiveInt(process.env.WEBDEX_SERIES_BONUS_CAP);
const KAKAO_WEBTOON_CAP = parsePositiveInt(process.env.WEBDEX_KAKAO_WEBTOON_CAP);
const LEZHIN_CAP = parsePositiveInt(process.env.WEBDEX_LEZHIN_CAP);
const WEBTOON_FINISHED_PAGES = parseOptionalInt(process.env.WEBDEX_WEBTOON_FINISHED_PAGES);
// 네이버 시리즈는 장르당 수천 페이지라, 캡이 없으면(과거 기본값 ∞) 한 장르에서 끝없이 페이징하다가
// 외부 execFile 타임아웃에 SIGTERM으로 강제종료돼 stdout(JSON)을 못 쓰고 매번 실패했다.
// 보너스 소스이므로 장르당 페이지 수를 유한 기본값으로 고정한다(env 로 상향 가능).
const SERIES_PAGES_PER_GENRE = parseOptionalInt(process.env.WEBDEX_SERIES_PAGES_PER_GENRE) ?? 40;
const MIN_CRAWL_DELAY_MS = parsePositiveInt(process.env.WEBDEX_CRAWL_DELAY_MS) ?? 90;

// ── 소프트 데드라인 ───────────────────────────────────────────
// 외부 타임아웃(SIGTERM)에 걸려 출력 없이 죽는 대신, 그 전에 각 루프를 정리하고 (부분 결과라도)
// 정상 emit 하기 위한 전역 예산(ms). 미설정=무제한(직접 실행용). catalog-ingest 가 실행 시
// (execFile 타임아웃 - 여유)로 WEBDEX_CRAWL_BUDGET_MS 를 주입한다.
const CRAWL_BUDGET_MS = parsePositiveInt(process.env.WEBDEX_CRAWL_BUDGET_MS);
const START_TS = Date.now();
const overBudget = () => CRAWL_BUDGET_MS != null && Date.now() - START_TS >= CRAWL_BUDGET_MS;
// 남은 예산만큼만 promise 를 기다리고, 초과하면 fallback 으로 진행한다(타이머는 unref → 종료 지연 없음).
function raceBudget(promise, fallback, label) {
  if (CRAWL_BUDGET_MS == null) return promise;
  const remaining = CRAWL_BUDGET_MS - (Date.now() - START_TS);
  if (remaining <= 0) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (label) log(`  ⏳ ${label}: 예산 초과 — 부분 결과로 진행`);
      resolve(fallback);
    }, remaining);
    if (typeof timer.unref === "function") timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}
const DEFAULT_SOURCE_IDS = [
  "naver-webtoon", "naver-series", "kakao-webtoon", "lezhin",
  "ridi", "kakao-page", "munpia", "joara", "postype", "mrblue", "bookcube", "onestory", "yes24",
  "novelpia", "bomtoon", "toptoon", "toomics", "kyobo", "comico",
];
const SOURCE_IDS = new Set(
  (process.env.WEBDEX_SOURCE_IDS || DEFAULT_SOURCE_IDS.join(","))
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

function applyLimit(items, limit) {
  return typeof limit === "number" ? items.slice(0, limit) : items;
}
function sourceEnabled(id) {
  return SOURCE_IDS.has("all") || SOURCE_IDS.has(id);
}

async function getJSON(url, headers = HW) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { headers, signal: c.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}
async function getTEXT(url, headers = HS) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { headers, signal: c.signal });
    clearTimeout(t);
    return r.ok ? await r.text() : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}
// 시리즈는 간헐적으로 빈 셸 반환 → 내용 있을 때까지 재시도
async function getSeries(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const h = await getTEXT(url);
    if (h && h.length > 8000 && h.includes("detail.series")) return h;
    if (overBudget()) return null;
    await sleep(250 + i * 150);
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pMap(items, fn, concurrency = 8) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

const ALLOWED = new Set([
  "로맨스", "로판", "판타지", "현판", "무협", "액션", "스릴러", "미스터리", "드라마",
  "일상", "코미디", "학원", "스포츠", "공포", "SF", "역사", "BL", "게임판타지",
]);
const WGENRE = {
  ROMANCE: "로맨스", PURE: "로맨스", FANTASY: "판타지", ACTION: "액션", DAILY: "일상",
  COMIC: "코미디", GAG: "코미디", DRAMA: "드라마", SENSIBILITY: "드라마", EMOTION: "드라마",
  THRILL: "스릴러", THRILLER: "스릴러", MYSTERY: "미스터리", HORROR: "공포", SPORTS: "스포츠",
  SPORT: "스포츠", HISTORICAL: "역사", SAGEUK: "역사", MARTIAL_ARTS: "무협", SF: "SF", SCHOOL: "학원",
};
const WEEK = { MONDAY: "월", TUESDAY: "화", WEDNESDAY: "수", THURSDAY: "목", FRIDAY: "금", SATURDAY: "토", SUNDAY: "일" };
const NGENRE = { 201: "로맨스", 207: "로판", 202: "판타지", 208: "현판", 206: "무협", 203: "미스터리", 209: "BL" };
const DAY_KEY = {
  mon: "월",
  monday: "월",
  tue: "화",
  tuesday: "화",
  wed: "수",
  wednesday: "수",
  thu: "목",
  thursday: "목",
  fri: "금",
  friday: "금",
  sat: "토",
  saturday: "토",
  sun: "일",
  sunday: "일",
  월: "월",
  화: "화",
  수: "수",
  목: "목",
  금: "금",
  토: "토",
  일: "일",
  0: "일",
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
  6: "토",
  7: "일",
};
function toKoreanWeek(raw) {
  if (raw == null) return undefined;
  const rawLower = String(raw).trim().toLowerCase();
  if (!rawLower) return undefined;
  const key = rawLower.replace(/요일$/, "").replace(/_/, "").replace(/-/g, "");
  return WEEK[key.toUpperCase()] ?? DAY_KEY[key] ?? DAY_KEY[key.slice(0, 3)] ?? DAY_KEY[key.slice(0, 1)] ?? undefined;
}

function mapWGenres(codes = [], tags = []) {
  const set = new Set();
  for (const c of codes) {
    const g = WGENRE[String(c).toUpperCase()];
    if (g) set.add(g);
  }
  if (set.has("로맨스") && set.has("판타지")) {
    set.delete("로맨스");
    set.delete("판타지");
    set.add("로판");
  }
  const ts = tags.join(" ");
  if (/무협|화산|문파|검신|무림/.test(ts)) set.add("무협");
  const arr = [...set].filter((g) => ALLOWED.has(g));
  return arr.length ? arr.slice(0, 3) : ["드라마"];
}
function mapAge(type = "", adult = false) {
  const s = String(type);
  if (adult || /18|19/.test(s)) return "19";
  if (/15/.test(s)) return "15";
  if (/12/.test(s)) return "12";
  return "all";
}
function hashInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function coverGradient(seed, genres) {
  const base = { 로맨스: 5, 로판: 340, BL: 315, 판타지: 290, 현판: 268, SF: 245, 게임판타지: 222, 미스터리: 205, 스릴러: 195, 공포: 150, 일상: 162, 스포츠: 138, 코미디: 100, 학원: 78, 역사: 62, 드라마: 35, 무협: 22, 액션: 12 };
  const h = base[genres[0]] ?? hashInt(seed) % 360;
  return [`oklch(0.45 0.14 ${h})`, `oklch(0.28 0.1 ${(h + 40) % 360})`];
}
const proxied = proxiedCoverUrl;
function synthDist(avg, count) {
  // count가 음수/비유한이면 분포가 음수가 돼 집계가 깨짐 → 안전한 양수로 클램프.
  const c = Number.isFinite(count) && count > 0 ? count : 1000;
  const w = [1, 2, 3, 4, 5].map((s) => Math.exp(-Math.pow(s - avg, 2) / 0.6));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => Math.round((x / sum) * c));
}
function trendScore(t) {
  let s = 50;
  if (t.new) s += 25;
  if (t.up) s += 12;
  if (t.potenUp) s += 15;
  if (t.openToday) s += 8;
  return Math.min(99, s);
}
function parseYear(desc) {
  const m = String(desc || "").match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (!m) return 2024;
  const yy = parseInt(m[1], 10);
  return yy <= 29 ? 2000 + yy : 1900 + yy;
}
// 작가/작가군 배열({id,name} 또는 문자열) → 이름 문자열 배열
const names = (arr) =>
  (arr ?? [])
    .map((x) => (typeof x === "string" ? x : x?.name || x?.writerName || x?.painterName || ""))
    .filter(Boolean);
const norm = (s) => String(s || "").replace(/[\s:~!?,.\-()[\]·]/g, "").toLowerCase();
function cleanTitle(s) {
  return decodeHtmlEntities(String(s || "")).replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

// 교차연결(플랫폼 간 병합) 거짓양성 방지: 동명이작이 작가까지 같지 않은데 합쳐지는 일을 막는다.
// author 는 "작가A, 작가B" 형태일 수 있어 콤마로 쪼개 정규화한 토큰 Set 으로 만든다.
// 빈값/"미상"(어느 한쪽이라도 작가 미상이면)은 빈 Set → authorsMatch 가 false 가 되어 병합 안 함.
function authorTokens(author) {
  return new Set(
    String(author || "")
      .split(",")
      .map((a) => norm(a))
      .filter((a) => a && a !== norm("미상"))
  );
}
// 양쪽 모두 실제 작가가 있고(빈 Set 아님), 토큰이 하나라도 겹칠 때만 같은 작가로 간주(보수적).
function authorsMatch(a, b) {
  const sa = authorTokens(a);
  if (sa.size === 0) return false;
  const sb = authorTokens(b);
  if (sb.size === 0) return false;
  for (const t of sa) if (sb.has(t)) return true;
  return false;
}
// 제목 정규화 → 후보 배열 맵. 동명이작을 분리 보존하기 위해 단일 값이 아니라 배열로 모은다.
function indexByNormTitle(items, key = (w) => norm(w.title)) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}
// 제목이 같은 후보들 중 작가까지 일치하는 것을 찾는다. 없으면 undefined → 별개 작품(신규)으로.
function findCrossMatch(map, normTitle, author) {
  const bucket = map.get(normTitle);
  if (!bucket) return undefined;
  return bucket.find((cand) => authorsMatch(cand.author, author));
}
// buildOriginNovels 전용 매처. 시리즈 웹소설 author 는 구조적으로 "미상"(crawlSeriesNovels)이라
// 일반 findCrossMatch(양쪽 실작가 요구)로는 절대 매칭되지 않아 원작-웹소설 연결이 죽는다.
// 웹툰이 _originAuthors(명시 원작 작가)를 보유한 경우에 한해: ① 작가까지 일치하는 후보 우선,
// ② 없으면 같은 제목의 '작가 미상' 후보를 택한다(명시 원작작가 + 동일 제목 = 충분한 신호).
function findOriginSeriesMatch(map, normTitle, originAuthor) {
  const bucket = map.get(normTitle);
  if (!bucket) return undefined;
  return (
    bucket.find((cand) => authorsMatch(cand.author, originAuthor)) ||
    bucket.find((cand) => authorTokens(cand.author).size === 0)
  );
}

// ── 웹툰 ─────────────────────────────────────────────
async function crawlWebtoons() {
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const map = new Map();
  for (const d of days) {
    if (overBudget()) break;
    // order=user = 실제 인기(연재) 순위. 목록 내 위치(idx+1)가 실순위 신호다 — 보존한다.
    const j = await getJSON(`https://comic.naver.com/api/webtoon/titlelist/weekday?week=${d}&order=user`);
    (j?.titleList ?? []).forEach((t, idx) => {
      if (!map.has(t.titleId)) map.set(t.titleId, { ...t, _days: new Set() });
      const entry = map.get(t.titleId);
      entry._days.add(d);
      const pos = idx + 1; // 요일별 인기 순위(1=최상위)
      entry._rankUser = entry._rankUser ? Math.min(entry._rankUser, pos) : pos;
    });
    await sleep(MIN_CRAWL_DELAY_MS);
  }
  let downloadPos = 0;
  for (let p = 1; ; p++) {
    if (WEBTOON_FINISHED_PAGES && p > WEBTOON_FINISHED_PAGES) break;
    if (overBudget()) break;
    // order=DOWNLOAD = 완결작 다운로드(인기) 순위. 페이지 가로질러 전역 위치를 보존한다.
    const j = await getJSON(`https://comic.naver.com/api/webtoon/titlelist/finished?page=${p}&order=DOWNLOAD`);
    const pageItems = j?.titleList;
    if (!Array.isArray(pageItems) || pageItems.length === 0) break;
    pageItems.forEach((t) => {
      downloadPos += 1;
      if (!map.has(t.titleId)) map.set(t.titleId, { ...t, _days: new Set(), finish: true });
      const entry = map.get(t.titleId);
      if (entry._rankDownload === undefined) entry._rankDownload = downloadPos;
    });
    await sleep(MIN_CRAWL_DELAY_MS);
  }
  // 실순위 우선 정렬(연재 인기 → 완결 다운로드 → 나머지). 상세+연도 보강도 실인기 상위부터.
  const rankKey = (t) => t._rankUser ?? (t._rankDownload ? 100000 + t._rankDownload : 1e9);
  const all = [...map.values()].sort((a, b) => rankKey(a) - rankKey(b));
  const top = applyLimit(all, WEBTOON_CAP);
  const detailIds = new Set(top.slice(0, WEBTOON_DETAIL_CAP).map((t) => t.titleId));
  log(`웹툰 수집: 전체 ${all.length}, 색인 ${top.length}, 상세+연도 ${detailIds.size}`);

  return (
    await pMap(top, async (t) => {
      // 예산 초과 시 상세 fetch 를 건너뛴다(작품은 기본값으로 색인 유지 — 누락보다 낫다).
      const shouldFetchDetail = detailIds.has(t.titleId) && !overBudget();
      const info = shouldFetchDetail
        ? await getJSON(`https://comic.naver.com/api/article/list/info?titleId=${t.titleId}`)
        : null;
      const asc = shouldFetchDetail
        ? await getJSON(`https://comic.naver.com/api/article/list?titleId=${t.titleId}&page=1&sort=ASC`)
        : null;
      const year = parseYear(asc?.articleList?.[0]?.serviceDateDescription);
      const genreTypes = info?.gfpAdCustomParam?.genreTypes ?? [];
      const curation = (info?.curationTagList ?? []).map((c) => c.tagName || "").filter(Boolean);
      const wd = [...(t._days ?? [])]
        .map((d) => toKoreanWeek(d))
        .filter(Boolean);
      const pub = (info?.publishDayOfWeekList ?? [])
        .map((d) => toKoreanWeek(d))
        .filter(Boolean);
      const updateDays = [...new Set((pub.length ? pub : wd).filter(Boolean))];
      const finished = !!(t.finish || info?.finished);
      const star = typeof t.starScore === "number" ? t.starScore : 0;
      // 네이버가 viewCount를 0으로 내리므로, 실순위(order=user/DOWNLOAD)에서 조회수를 역산해
      // 인기 순서를 보존한다. rank 1 ≈ 6천만, rank 200 ≈ 약 100만(연재) — 순위 단조감소 곡선.
      const realRank = t._rankUser; // 연재 인기 실순위(있으면 popular 신호로 사용)
      const viewsFromRank = (rank, base) => Math.max(50_000, Math.round(base * Math.pow(rank, -0.8)));
      let views = 0;
      if (t.viewCount > 0) views = t.viewCount;
      else if (realRank) views = viewsFromRank(realRank, 60_000_000);
      else if (t._rankDownload) views = viewsFromRank(t._rankDownload, 12_000_000);
      const fav = info?.favoriteCount ?? t.favoriteCount ?? Math.round(views * 0.045);
      const genres = mapWGenres(genreTypes, curation);
      const originAuthors = names(t.novelOriginAuthors);
      const ratingAvg = Math.round((star / 2) * 10) / 10;
      const ratingCount = Math.max(50, Math.round(fav * 0.32));
      const tags = [...new Set([...curation.map((c) => c.replace(/^#/, "")), ...(originAuthors.length ? ["원작소설"] : [])])].slice(0, 6);
      let status;
      if (finished) status = "completed";
      else if (t.rest) status = "hiatus";
      else status = "ongoing";
      return {
        id: `nw-${t.titleId}`,
        slug: `nw-${t.titleId}`,
        type: "webtoon",
        title: t.titleName,
        author: names(t.writers).join(", ") || t.author || "미상",
        artist: names(t.painters).join(", ") || undefined,
        genres,
        tags,
        synopsis: (info?.synopsis ?? "").trim().replace(/\s+/g, " ").slice(0, 280) || `${t.titleName} · 네이버 웹툰 연재작.`,
        cover: coverGradient(String(t.titleId), genres),
        coverImage: proxied(t.thumbnailUrl),
        status,
        ageRating: mapAge(info?.age?.type, t.adult),
        releaseYear: shouldFetchDetail ? year : 2024,
        updateDays: !finished && updateDays.length ? updateDays : undefined,
        availability: [
          { platformId: "naver-webtoon", pricing: t.dailyPass ? "wait-free" : "free", isOriginal: true, url: `https://comic.naver.com/webtoon/list?titleId=${t.titleId}` },
        ],
        stats: {
          views,
          likes: fav,
          bookmarks: fav,
          ratingAvg,
          ratingCount,
          ratingDist: synthDist(ratingAvg, ratingCount),
          rankDelta: 0,
          trendingScore: trendScore(t),
          completionRate: finished ? 90 : Math.min(95, Math.round(58 + ratingAvg * 7)),
          bingeIndex: Math.min(98, Math.round(52 + ratingAvg * 9)),
          popularityRank: realRank ?? undefined, // 네이버 연재 인기 실순위(1=최상위)
        },
        // 조회수가 실수집이 아니라 실순위 역산 추정이면 ≈ 표기(순서는 실제, 숫자는 추정).
        statsEstimated: t.viewCount > 0 ? undefined : true,
        featured: false,
        _originAuthors: originAuthors,
      };
    })
  ).filter(Boolean);
}

// ── 네이버 시리즈 웹소설 (베스트에포트, 장르별) ──────
async function crawlSeriesNovels() {
  const out = [];
  const seen = new Set();
  const genreEntries = Object.entries(NGENRE);
  log(
    `시리즈 웹소설 수집 시작: ${genreEntries.length}개 장르 × 최대 ${SERIES_PAGES_PER_GENRE || "∞"}페이지`
  );
  let gi = 0;
  for (const [code, genre] of genreEntries) {
    if (overBudget()) break;
    gi++;
    const genreStart = out.length;
    let lastPage = 0;
    for (let page = 1; ; page++) {
      if (SERIES_PAGES_PER_GENRE && page > SERIES_PAGES_PER_GENRE) break;
      if (overBudget()) break;
      lastPage = page;
      const html = await getSeries(
        `https://series.naver.com/novel/categoryProductList.series?categoryTypeCode=genre&genreCode=${code}&page=${page}`
      );
      if (!html) break;
      const before = out.length;
      const parts = html.split("detail.series?productNo=").slice(1);
      if (parts.length === 0) break;
      for (const part of parts) {
        const idM = part.match(/^(\d+)/);
        if (!idM) continue;
        const productNo = idM[1];
        if (seen.has(productNo)) continue;
        const imgM = part.slice(0, 600).match(/<img[^>]+src="([^"]+pstatic[^"]+)"[^>]*alt="([^"]+)"/);
        if (!imgM) continue;
        const title = cleanTitle(imgM[2]);
        if (!title || title.length < 2) continue;
        const head = part.slice(0, 600);
        seen.add(productNo);
        out.push({
          productNo,
          genre,
          title,
          thumb: imgM[1],
          is19: /19over|\[19\]|ico_19/.test(head),
          waitFree: /ico_onlyfree|매일.*무료/.test(head),
        });
      }
      if (page % 25 === 0) {
        log(
          `  [${gi}/${genreEntries.length}] ${genre}: ${page}p, 누적 ${out.length}건`
        );
      }
      await sleep(MIN_CRAWL_DELAY_MS);
      if (out.length === before) break;
    }
    log(
      `  [${gi}/${genreEntries.length}] ${genre} 완료: +${out.length - genreStart}건 (${lastPage}p), 누적 ${out.length}건`
    );
  }
  log(`시리즈 웹소설(보너스) 수집: ${out.length}`);
  return applyLimit(out, NOVEL_BONUS_CAP).map((n, i) => {
    const ratingAvg = 4.6 - (i % 12) * 0.04;
    const views = 9_000_000 - i * 150_000 + (hashInt(n.productNo) % 700_000);
    const fav = Math.round(views * 0.05);
    const ratingCount = Math.round(fav * 0.4);
    const genres = [n.genre].filter((g) => ALLOWED.has(g));
    return {
      _series: true,
      _normTitle: norm(n.title),
      id: `ns-${n.productNo}`,
      slug: `ns-${n.productNo}`,
      type: "webnovel",
      title: n.title,
      author: "미상",
      genres: genres.length ? genres : ["판타지"],
      tags: [],
      synopsis: `${n.title} · 네이버 시리즈 인기 웹소설.`,
      cover: coverGradient(String(n.productNo), genres),
      coverImage: proxied(n.thumb),
      status: "ongoing",
      ageRating: n.is19 ? "19" : "all",
      releaseYear: 2022,
      availability: [{ platformId: "naver-series", pricing: n.waitFree ? "wait-free" : "paid", url: `https://series.naver.com/novel/detail.series?productNo=${n.productNo}` }],
      stats: { views, likes: fav, bookmarks: fav, ratingAvg, ratingCount, ratingDist: synthDist(ratingAvg, ratingCount), rankDelta: 0, trendingScore: Math.max(42, 92 - i), completionRate: 72, bingeIndex: Math.min(96, Math.round(60 + ratingAvg * 7)) },
      featured: false,
    };
  });
}

// 웹툰의 원작 정보로 실제 웹소설 엔트리 생성 + 어댑테이션 연결
function buildOriginNovels(webtoons, seriesNovels) {
  const seriesByName = indexByNormTitle(seriesNovels, (n) => n._normTitle);
  const novelByName = new Map();
  for (const w of webtoons) {
    if (!w._originAuthors?.length) continue;
    const key = norm(w.title);
    const originAuthor = w._originAuthors.join(", ");
    // 시리즈에 동일 제목 + 작가(원작 작가) 웹소설이 있으면 그것과 연결 (썸네일 보유).
    // 시리즈 웹소설 author 는 기본 "미상" 이므로 웹툰의 원작 작가(_originAuthors)와 대조한다.
    // 작가 미상이라 확신할 수 없으면 동명이작일 수 있어 병합하지 않고, 파생 원작 엔트리를 만든다.
    const match = findOriginSeriesMatch(seriesByName, key, originAuthor);
    if (match) {
      if (match.author === "미상") match.author = originAuthor;
      w.adaptedFrom = match.id;
      continue;
    }
    // 없으면 원작 엔트리 파생 생성 (실제 제목·작가). 제목+작가가 같은 다음 웹툰만 이 엔트리에 연결.
    const existing = novelByName.get(key);
    if (existing && authorsMatch(existing.author, originAuthor)) {
      w.adaptedFrom = existing.id;
      continue;
    }
    const id = `nv-${hashInt(key)}`;
    const ratingAvg = Math.min(5, w.stats.ratingAvg + 0.1);
    const views = Math.round(w.stats.likes * 6);
    const fav = Math.round(w.stats.likes * 0.8);
    const novel = {
      id,
      slug: id,
      type: "webnovel",
      title: w.title,
      author: w._originAuthors.join(", "),
      genres: w.genres.slice(),
      tags: ["원작", ...w.tags.filter((t) => t !== "원작소설")].slice(0, 5),
      synopsis: `웹툰 「${w.title}」의 원작 웹소설. 글 ${w._originAuthors.join(", ")}.`,
      cover: coverGradient(id, w.genres),
      coverImage: w.coverImage, // 같은 IP — 웹툰화 표지를 상속(원작 소설 썸네일 보강)
      status: "ongoing",
      ageRating: w.ageRating,
      releaseYear: Math.max(2010, w.releaseYear - 1),
      availability: [{ platformId: "naver-series", pricing: "paid", url: "https://series.naver.com/" }],
      stats: { views, likes: fav, bookmarks: fav, ratingAvg, ratingCount: Math.round(fav * 0.4), ratingDist: synthDist(ratingAvg, Math.round(fav * 0.4)), rankDelta: 0, trendingScore: 60, completionRate: 80, bingeIndex: 82 },
      featured: false,
    };
    novelByName.set(key, novel);
    w.adaptedFrom = id;
  }
  return [...novelByName.values()];
}

// ── 카카오웹툰 (2번째 실 플랫폼) ───────────────────
const KW_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const KW_H = {
  "User-Agent": UA,
  Referer: "https://webtoon.kakao.com/",
  Origin: "https://webtoon.kakao.com",
  Accept: "application/json",
};
function kwGenres(keywords = []) {
  const text = keywords.join(" ");
  const out = new Set();
  for (const g of ALLOWED) if (text.includes(g)) out.add(g);
  if (out.has("로맨스") && out.has("판타지")) {
    out.delete("로맨스");
    out.delete("판타지");
    out.add("로판");
  }
  if (/무협|무림/.test(text)) out.add("무협");
  const arr = [...out].filter((g) => ALLOWED.has(g));
  return arr.length ? arr.slice(0, 3) : ["드라마"];
}

const LZ_GENRE = {
  drama: "드라마",
  romance: "로맨스",
  bl: "BL",
  fantasy: "판타지",
  school: "학원",
  gag: "코미디",
  gl: "로맨스",
  day: "일상",
  action: "액션",
  mystery: "미스터리",
  thriller: "스릴러",
  horror: "공포",
};
function lzGenres(codes = []) {
  const out = codes.map((code) => LZ_GENRE[String(code).toLowerCase()]).filter(Boolean);
  return out.length ? [...new Set(out)].slice(0, 3) : ["드라마"];
}
function lzAuthorNames(artists = [], roles = ["writer", "scripter", "original"]) {
  const allowed = new Set(roles);
  return artists.filter((artist) => allowed.has(artist?.role)).map((artist) => artist.name).filter(Boolean);
}
function lzUpdateDays(periods = []) {
  return periods
    .map((period) => toKoreanWeek(period))
    .filter(Boolean);
}
async function crawlLezhinCatalog() {
  const limit = 100;
  const out = new Map();
  const genreScopes = ["", ...Object.keys(LZ_GENRE)];
  // filter=all(완결 포함 전체 랭킹) + filter=publishing(연재중 — 연재요일 schedule 이 풍부).
  // realtime 랭킹은 완결작 비중이 커 연재 캘린더 커버리지가 낮아, publishing 패스로 연재중 작품을 보강한다.
  const filters = ["all", "publishing"];
  let budgetExceeded = false;
  for (const filter of filters) {
    for (const genre of genreScopes) {
      if (budgetExceeded) break;
      if (overBudget()) { budgetExceeded = true; break; }
      const page = await getJSON(
        `https://api.lezhin.com/v2/content-list/ranking?filter=${filter}&rankType=realtime&limit=${limit}&offset=0&genres=${encodeURIComponent(genre)}`,
        HL
      );
      const items = page?.data;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item?.id && !out.has(item.id)) out.set(item.id, item);
        }
      }
      if (LEZHIN_CAP && out.size >= LEZHIN_CAP) { budgetExceeded = true; break; }
      await sleep(MIN_CRAWL_DELAY_MS);
    }
    if (budgetExceeded) break;
  }

  const rows = applyLimit([...out.values()], LEZHIN_CAP);
  log(`레진 카탈로그 수집: ${rows.length}`);
  return rows.map((item, i) => {
    const genres = lzGenres(item.genres ?? []);
    const authors = lzAuthorNames(item.artists);
    const painters = lzAuthorNames(item.artists, ["painter"]);
    const fallbackAuthors = lzAuthorNames(item.artists, ["writer", "scripter", "painter", "original"]);
    const views = Number(item.viewCount) || 0;
    const subscriptions = Number(item.subscriptions) || Math.max(100, Math.round(views * 0.02));
    const rank = Number(item.currentRank) || i + 1;
    const ratingAvg = Math.max(3.4, Math.min(4.9, 4.78 - Math.log10(rank + 1) * 0.18 + Math.min(0.12, Math.log10(subscriptions + 1) * 0.012)));
    const ratingCount = Math.max(80, Math.round(subscriptions * 0.32));
    const status = item.contentsState === "completed" ? "completed" : "ongoing";
    const updateDays = status === "completed" ? undefined : lzUpdateDays(item.schedule?.periods ?? []);
    const releaseYear = item.publishedAt ? new Date(Number(item.publishedAt)).getFullYear() : 2024;
    const coverRemote = extractRemoteImageUrl(item) ?? buildLezhinCoverImage(item);
    const tags = [
      "레진",
      ...genres,
      item.freedEpisodeSize ? "무료회차" : "",
      item.print || item.isPrint ? "단행본" : "연재",
    ].filter(Boolean);

    return {
      _normTitle: norm(item.title),
      id: `lz-${item.id}`,
      slug: `lz-${item.alias || item.id}`,
      type: "webtoon",
      title: item.title,
      author: authors.join(", ") || fallbackAuthors.join(", ") || "미상",
      artist: painters.join(", ") || undefined,
      genres,
      tags: [...new Set(tags)].slice(0, 6),
      synopsis: `${item.title} · 레진코믹스 공개 카탈로그 수집작.`,
      cover: coverGradient(String(item.id), genres),
      coverImage: proxied(coverRemote),
      status,
      ageRating: "all",
      releaseYear: Number.isFinite(releaseYear) ? releaseYear : 2024,
      updateDays: updateDays?.length ? updateDays : undefined,
      availability: [
        {
          platformId: "lezhin",
          pricing: item.freedEpisodeSize ? "wait-free" : "paid",
          url: `https://www.lezhin.com/ko/comic/${item.alias || item.id}`,
        },
      ],
      stats: {
        views,
        likes: subscriptions,
        bookmarks: subscriptions,
        ratingAvg: Math.round(ratingAvg * 10) / 10,
        ratingCount,
        ratingDist: synthDist(ratingAvg, ratingCount),
        rankDelta: 0,
        trendingScore: Math.max(35, Math.min(99, 100 - rank)),
        completionRate: status === "completed" ? 86 : 66,
        bingeIndex: Math.min(96, Math.round(58 + ratingAvg * 7)),
      },
      featured: false,
    };
  });
}
async function crawlKakaoWebtoon() {
  const map = new Map();
  const dayMap = new Map(); // content id → Set(한글 연재요일) — 연재 캘린더용
  for (const d of KW_DAYS) {
    if (overBudget()) break;
    const ko = DAY_KEY[d];
    const j = await getJSON(
      `https://gateway-kw.kakao.com/section/v2/timetables/days?placement=timetable_${d}`,
      KW_H
    );
    for (const sec of j?.data ?? [])
      for (const grp of sec.cardGroups ?? [])
        for (const card of grp.cards ?? []) {
          const c = card.content;
          if (!c?.id || !c.title) continue;
          if (!map.has(c.id)) map.set(c.id, c);
          if (ko) {
            let ds = dayMap.get(c.id);
            if (!ds) { ds = new Set(); dayMap.set(c.id, ds); }
            ds.add(ko); // mon→sun 순회라 Set 삽입 순서가 곧 주간 순서
          }
        }
    await sleep(MIN_CRAWL_DELAY_MS);
  }
  const cards = [...map.values()];
  log(`카카오웹툰 수집: ${cards.length}`);
  return applyLimit(cards, KAKAO_WEBTOON_CAP).map((c, i) => {
    const authors = (c.authors ?? []).filter((a) => a.type === "AUTHOR").map((a) => a.name);
    const illus = (c.authors ?? []).filter((a) => a.type === "ILLUSTRATOR").map((a) => a.name);
    const kws = (c.seoKeywords ?? []).map((k) => String(k).replace(/^#/, "").trim()).filter(Boolean);
    const genres = kwGenres(kws);
    const updateDays = [...(dayMap.get(c.id) ?? [])]; // 연재 캘린더용 한글 요일
    const bg = typeof c.backgroundColor === "string" && /^#/.test(c.backgroundColor) ? c.backgroundColor : null;
    const imgUrl = c.backgroundImage || c.featuredCharacterImageA; // 카카오 CDN 은 확장자 필요
    const ratingAvg = Math.round((4.3 + (hashInt(String(c.id)) % 5) * 0.1) * 10) / 10; // 추정
    const views = 6_000_000 - i * 90_000 + (hashInt(String(c.id)) % 500_000); // 추정
    const ratingCount = 400 + (hashInt(String(c.id)) % 1200); // 낮게 → 베이즈가 평점랭킹 지배 방지
    return {
      _normTitle: norm(c.title),
      id: `kw-${c.id}`,
      slug: `kw-${c.id}`,
      type: "webtoon",
      title: c.title,
      author: authors.join(", ") || "미상",
      artist: illus.join(", ") || undefined,
      genres,
      tags: kws.slice(0, 5),
      synopsis:
        (c.catchphraseTwoLines || "").replace(/\s+/g, " ").trim().slice(0, 200) ||
        `${c.title} · 카카오웹툰 연재작.`,
      cover: bg ? [bg, coverGradient(String(c.id), genres)[1]] : coverGradient(String(c.id), genres),
      coverImage: imgUrl ? proxied(imgUrl + ".webp") : undefined,
      status: "ongoing",
      ageRating: c.adult ? "19" : "all",
      releaseYear: 2023,
      updateDays: updateDays.length ? updateDays : undefined,
      availability: [
        {
          platformId: "kakao-webtoon",
          pricing: "wait-free",
          isOriginal: true,
          url: `https://webtoon.kakao.com/content/${c.seoId || c.id}/${c.id}`,
        },
      ],
      stats: {
        views,
        likes: Math.round(views * 0.04),
        bookmarks: Math.round(views * 0.04),
        ratingAvg,
        ratingCount,
        ratingDist: synthDist(ratingAvg, ratingCount),
        rankDelta: 0,
        trendingScore: Math.max(45, 90 - i),
        completionRate: 70,
        bingeIndex: 72,
      },
      featured: false,
    };
  });
}

function fmt(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, "")}만`;
  return String(n);
}
function pickFeatured(all) {
  [...all].sort((a, b) => b.stats.views - a.stats.views).slice(0, 10).forEach((t) => {
    t.featured = true;
    t.editorNote = `누적 조회 ${fmt(t.stats.views)}, 별점 ${t.stats.ratingAvg.toFixed(1)}의 대표작.`;
  });
}
function clean(t) {
  const rest = { ...t };
  delete rest._originAuthors;
  delete rest._series;
  delete rest._normTitle;
  Object.keys(rest).forEach((k) => rest[k] === undefined && delete rest[k]);
  return rest;
}

// 모든 작품 stats 정규화 — 어떤 경로(네이버 viewCount=0, 시리즈 공식 언더플로, 병합 누락)로
// 만들어졌든 화면에 "조회 0"이 노출되지 않도록 보정한다. 실제값(views>0)은 그대로 두고,
// 보정한 작품만 statsEstimated=true 로 표시해 ≈/추정 배지가 정직하게 붙도록 한다.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function normalizeStats(t, idx) {
  const s = t.stats || (t.stats = {});
  if (num(s.views) <= 0) {
    const jitter = hashInt(t.id || t.slug || t.title || String(idx));
    const ratingAvg = num(s.ratingAvg) > 0 ? num(s.ratingAvg) : 4.0;
    // 별점·해시 기반 결정적 추정(평점 높을수록 ↑). 50k~약 3.5M 범위.
    s.views = Math.max(50_000, Math.round((ratingAvg - 2.8) * 900_000 + (jitter % 1_800_000)));
    t.statsEstimated = true;
  }
  if (num(s.likes) <= 0) s.likes = Math.max(50, Math.round(s.views * 0.04));
  if (num(s.bookmarks) <= 0) s.bookmarks = s.likes;
  if (num(s.ratingAvg) <= 0) s.ratingAvg = 4.2;
  if (num(s.ratingCount) <= 0) s.ratingCount = Math.max(50, Math.round(s.likes * 0.3));
  if (!Array.isArray(s.ratingDist) || s.ratingDist.length !== 5) s.ratingDist = synthDist(s.ratingAvg, s.ratingCount);
  if (num(s.trendingScore) <= 0) s.trendingScore = Math.max(35, Math.min(99, 90 - (idx % 60)));
  if (num(s.completionRate) <= 0) s.completionRate = t.status === "completed" ? 88 : 72;
  if (num(s.bingeIndex) <= 0) s.bingeIndex = Math.min(96, Math.round(60 + s.ratingAvg * 7));
  if (typeof s.rankDelta !== "number") s.rankDelta = 0;
  return t;
}

async function main() {
  const startedAt = new Date().toISOString();
  log(
    "네이버 실데이터 크롤 시작…" +
      (CRAWL_BUDGET_MS
        ? ` (예산 ${Math.round(CRAWL_BUDGET_MS / 1000)}s · 시리즈 ${SERIES_PAGES_PER_GENRE}p/장르)`
        : ` (시리즈 ${SERIES_PAGES_PER_GENRE}p/장르)`)
  );
  // ── 전 플랫폼 동시 크롤 ───────────────────────────────────────
  // 각 플랫폼은 서로 다른 호스트라 동시에 돌려도 호스트당 부하(내부 동시성·요청 간격)는 그대로다.
  // 순차로 돌리면 뒤 소스(카카오·레진·중소형)가 앞 소스(웹툰·시리즈)에 예산을 다 뺏겨 굶는다 →
  // 병렬화로 모든 플랫폼이 같은 예산 창을 공유하게 해 벽시계(합→최댓값)도 줄이고 커버리지도 키운다.
  const guard = (id, fn) =>
    sourceEnabled(id)
      ? Promise.resolve()
          .then(fn)
          .catch((e) => {
            log(`${id} 크롤 스킵:`, e.message);
            return [];
          })
      : Promise.resolve([]);

  const [webtoons, series, kakao, lezhin, extraResults] = await Promise.all([
    guard("naver-webtoon", crawlWebtoons),
    guard("naver-series", crawlSeriesNovels),
    guard("kakao-webtoon", crawlKakaoWebtoon),
    guard("lezhin", crawlLezhinCatalog),
    Promise.all(
      EXTRA_CRAWLERS.filter(([id]) => sourceEnabled(id)).map(async ([id, fn]) => {
        try {
          // 남은 예산 안에 못 끝내면 부분(빈) 결과로 넘어간다(다른 플랫폼을 막지 않음).
          const rows = await raceBudget(fn(), [], id);
          return [id, Array.isArray(rows) ? rows : []];
        } catch (e) {
          log(`${id} 크롤 스킵:`, e.message);
          return [id, []];
        }
      })
    ),
  ]);

  // ── 이후는 순수 병합(네트워크 없음) — 교차연결 우선순위: 웹툰 → 카카오 → 레진 → 중소형 ──
  const originNovels = buildOriginNovels(webtoons, series);
  const linked = webtoons.filter((w) => w.adaptedFrom).length;

  // 교차 매칭: 제목+작가가 같으면 네이버 작품에 카카오 가용성 추가(진짜 크로스플랫폼), 아니면 신규.
  // 제목만 같고 작가가 다르거나 한쪽 작가 미상이면 동명이작으로 보고 병합하지 않는다(거짓양성 방지).
  const naverByName = indexByNormTitle(webtoons);
  const kakaoNew = [];
  let crossLinked = 0;
  for (const k of kakao) {
    const match = findCrossMatch(naverByName, k._normTitle, k.author);
    if (match) {
      if (!match.availability.some((a) => a.platformId === "kakao-webtoon")) {
        match.availability.push(k.availability[0]);
        crossLinked++;
      }
    } else {
      kakaoNew.push(k);
    }
  }

  const knownByName = indexByNormTitle([...webtoons, ...kakaoNew]);
  const lezhinNew = [];
  let lezhinCrossLinked = 0;
  for (const item of lezhin) {
    const match = findCrossMatch(knownByName, item._normTitle, item.author);
    if (match) {
      if (!match.availability.some((a) => a.platformId === "lezhin")) {
        match.availability.push(item.availability[0]);
        match.stats.views = Math.max(match.stats.views, item.stats.views);
        match.stats.likes = Math.max(match.stats.likes, item.stats.likes);
        match.stats.bookmarks = Math.max(match.stats.bookmarks, item.stats.bookmarks);
        lezhinCrossLinked++;
      }
    } else {
      lezhinNew.push(item);
    }
  }

  // ── 중소형 플랫폼: 위 병렬 크롤 결과(extraResults)를 제목+작가로 교차연결/신규 분리 ──
  // 제목만 같고 작가가 다르거나 한쪽 작가 미상이면 동명이작으로 보고 신규로 둔다(거짓양성 방지).
  const knownAll = indexByNormTitle([...webtoons, ...kakaoNew, ...lezhinNew]);
  const extraNew = [];
  const extraCounts = {};
  for (const [id, rows] of extraResults) {
    extraCounts[id] = rows.length;
    let linked = 0;
    for (const item of rows) {
      const match = findCrossMatch(knownAll, item._normTitle, item.author);
      if (match) {
        if (!match.availability.some((a) => a.platformId === id)) {
          match.availability.push(item.availability[0]);
          linked++;
        }
      } else {
        // 동명이작도 후보로 누적해, 같은 제목+작가의 다음 항목만 이 항목에 병합되게 한다.
        const bucket = knownAll.get(item._normTitle);
        if (bucket) bucket.push(item);
        else knownAll.set(item._normTitle, [item]);
        extraNew.push(item);
      }
    }
    // 표지 호스트도 로깅 — /api/cover allowlist 유지보수용(특히 KR egress에서만 잡히는 comico 호스트 확인).
    const coverHosts = [
      ...new Set(
        rows
          .map((r) => {
            try {
              return r.coverImage ? new URL(decodeURIComponent(r.coverImage.replace("/api/cover?u=", ""))).hostname : null;
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      ),
    ];
    log(
      `${id} 수집: ${rows.length} (신규 ${rows.length - linked}, 교차연결 ${linked})` +
        (coverHosts.length ? ` · 표지호스트 ${coverHosts.join(", ")}` : "")
    );
  }

  // 시리즈 보너스 중 웹툰과 연결 안 된 것도 standalone 으로 포함
  const novels = [...series, ...originNovels];
  const all = [
    ...webtoons.map(clean),
    ...novels.map(clean),
    ...kakaoNew.map(clean),
    ...lezhinNew.map(clean),
    ...extraNew.map(clean),
  ];
  pickFeatured(all);
  // 조회수 0 노출 방지: 전 작품 stats 정규화(실제값 보존, 보정분만 추정 표시).
  all.forEach((t, i) => normalizeStats(t, i));
  const estimatedCount = all.filter((t) => t.statsEstimated).length;
  log(`stats 정규화: ${all.length}편 중 보정(추정 표시) ${estimatedCount}편`);

  const crawledAt = new Date().toISOString();
  const sourceVersion = `crawl/${crawledAt}`;
  const result = {
    titles: all,
    count: all.length,
    sourceVersion,
    crawledAt,
    metadata: {
      startedAt,
      sources: {
        naverWebtoon: webtoons.length,
        naverSeries: novels.length,
        kakaoWebtoon: kakao.length,
        kakaoNew: kakaoNew.length,
        kakaoCrossLinked: crossLinked,
        lezhin: lezhin.length,
        lezhinNew: lezhinNew.length,
        lezhinCrossLinked,
        adaptations: linked,
        ...extraCounts,
      },
      limits: {
        webtoonCap: WEBTOON_CAP ?? null,
        webtoonDetailCap: WEBTOON_DETAIL_CAP,
        seriesBonusCap: NOVEL_BONUS_CAP ?? null,
        kakaoWebtoonCap: KAKAO_WEBTOON_CAP ?? null,
        lezhinCap: LEZHIN_CAP ?? null,
        finishedPages: WEBTOON_FINISHED_PAGES ?? null,
        seriesPagesPerGenre: SERIES_PAGES_PER_GENRE ?? null,
      },
      sourceIds: [...SOURCE_IDS],
    },
  };

  if (OUTPUT_JSON) {
    // 대용량 JSON 백프레셔로 stdout 이 잘리지 않도록 flush 완료를 기다린 뒤 종료한다.
    await new Promise((resolve) => process.stdout.write(`${JSON.stringify(result)}\n`, resolve));
  }

  const extraCountsSummary = Object.entries(extraCounts).map(([k, v]) => k + " " + v).join(", ");
  log(
    `완료: ${all.length}편 — 네이버웹툰 ${webtoons.length}, 웹소설 ${novels.length}, 카카오웹툰 신규 ${kakaoNew.length}(+교차연결 ${crossLinked}), 레진 신규 ${lezhinNew.length}(+교차연결 ${lezhinCrossLinked}), 어댑테이션 ${linked}, 중소형 신규 ${extraNew.length} [${extraCountsSummary}]`
  );

  // 보너스 소스의 in-flight fetch 타이머가 이벤트 루프를 붙잡아 종료가 지연(→ 외부 타임아웃)되는 것을 막는다.
  // 결과 JSON 은 위에서 flush 완료 → 즉시 정상 종료.
  if (OUTPUT_JSON) process.exit(0);
}

main().catch((error) => {
  log("크롤 치명적 오류:", error?.message ?? error);
  process.exit(1);
});
