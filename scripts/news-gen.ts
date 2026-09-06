// 웹툰·웹소설 뉴스 생성기 — Google News RSS(공개)에서 카테고리별 헤드라인을 수집해
// apps/web/public/data/news.json 으로 저장한다. build-static-catalog.ts 가 호출하며, 단독 실행도 지원:
//
//   pnpm exec tsx scripts/news-gen.ts            # apps/api/data/catalog.json.gz 기준 관련작품 매칭 포함
//   WEBDEX_CATALOG_GZ=path pnpm exec tsx scripts/news-gen.ts
//
// 저작권 안전: 헤드라인(사실)+출처·날짜만 저장하고 본문은 담지 않으며, 링크는 발행처로 보낸다.
// 네트워크 실패가 빌드를 깨지 않는다 — 쿼리 단위 재시도(1회)·실패 카테고리 스킵,
// 전체 실패 시 기존 news.json 을 보존(빈 파일로 덮지 않음), 그것도 없으면 빈 목록 폴백.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

// ── 데이터 모양 ──────────────────────────────────────────────────────────────
// 기존 필드(title/source/url/date)는 하위호환 유지, category/related 를 추가한다.

export type NewsCategory = "industry" | "adaptation" | "event" | "novel" | "title";

export interface NewsRelatedTitle {
  slug: string;
  title: string;
}

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  date: string; // ISO(파싱 가능 시) 또는 원문 pubDate
  category: NewsCategory;
  related?: NewsRelatedTitle[]; // 카탈로그 작품 매칭(최대 2) — 없으면 생략
}

export interface NewsPayload {
  items: NewsItem[];
  generatedAt: string;
}

// 카탈로그 매칭에 필요한 최소 모양 — lib/types.ts 의 Title 이 구조적으로 호환된다.
export interface NewsCatalogEntry {
  slug: string;
  title: string;
  altTitles?: string[];
  stats?: { views?: number };
}

// ── 수집 쿼리(카테고리별 다중 쿼리) ──────────────────────────────────────────
// Google News RSS 검색(hl=ko&gl=KR&ceid=KR:ko). 쿼리는 수집 다양화용이고,
// 최종 카테고리는 헤드라인 키워드 분류(classifyNews)가 우선한다.

export const NEWS_CATEGORIES: readonly NewsCategory[] = [
  "industry",
  "adaptation",
  "event",
  "novel",
  "title",
];

export const NEWS_QUERIES: ReadonlyArray<{ category: NewsCategory; query: string }> = [
  { category: "industry", query: "웹툰 플랫폼" },
  { category: "industry", query: "웹툰 산업" },
  { category: "adaptation", query: '"웹툰 원작" 드라마' },
  { category: "adaptation", query: "웹툰 영상화 OR 웹툰 원작 영화" },
  { category: "event", query: "웹툰 공모전" },
  { category: "event", query: "웹툰 페스티벌 OR 웹툰 행사" },
  { category: "novel", query: "웹소설" },
  { category: "novel", query: "웹소설 공모전 OR 웹소설 출간" },
  { category: "title", query: "웹툰 신작" },
  { category: "title", query: "네이버웹툰 신작 OR 카카오페이지 신작" },
];

export function googleNewsRssUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
}

// ── RSS 파싱(순수) ───────────────────────────────────────────────────────────

export interface ParsedRssItem {
  title: string;
  source: string;
  url: string;
  date: string;
}

function decodeXmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// <item> 블록에서 헤드라인·출처·링크·날짜를 추출한다. Google News 제목은
// "헤드라인 - 출처" 형태라 출처 접미사를 제거하고, pubDate 는 ISO 로 정규화한다.
export function parseRssItems(xml: string): ParsedRssItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => {
      const b = m[1];
      const rawTitle = decodeXmlText((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? "");
      const source = decodeXmlText((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] ?? "");
      const title =
        source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
      const rawDate = ((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] ?? "").trim();
      const parsedDate = new Date(rawDate);
      return {
        title,
        source,
        url: decodeXmlText((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] ?? ""),
        date: rawDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : rawDate,
      };
    })
    .filter((it) => it.title.length > 0 && it.url.length > 0);
}

// ── 분류(순수) ───────────────────────────────────────────────────────────────
// 우선순위: 영상화 > 공모전·행사 > 웹소설 > 신작 > 산업. 키워드가 없으면 수집 쿼리의
// 카테고리를 그대로 쓴다(쿼리 자체가 주제 필터라 폴백으로 충분).

const CLASSIFY_RULES: ReadonlyArray<{ category: NewsCategory; re: RegExp }> = [
  {
    category: "adaptation",
    re: /(드라마|영화|애니메이션|애니화|영상화|실사화|넷플릭스|디즈니|티빙|웨이브|쿠팡플레이|OTT|극장판|뮤지컬|캐스팅|주연|배우)/i,
  },
  {
    category: "event",
    re: /(공모전|콘테스트|페스티벌|축제|박람회|엑스포|시상식|어워드|어워즈|수상작|전시회?|행사|컨퍼런스|콘퍼런스|간담회|팝업\s*스토어)/,
  },
  { category: "novel", re: /(웹\s*소설|라이트노벨|장르\s*소설|로판|판타지\s*소설)/ },
  {
    category: "title",
    re: /(신작|새\s*웹툰|연재\s*시작|정식\s*연재|첫\s*공개|단독\s*공개|론칭|완결|단행본)/,
  },
  {
    category: "industry",
    re: /(실적|매출|영업이익|주가|상장|투자\s*유치|인수|합병|적자|흑자|규제|정책|불법\s*유통|저작권|단속|제휴|AI)/,
  },
];

export function classifyNews(title: string, fallback: NewsCategory): NewsCategory {
  for (const rule of CLASSIFY_RULES) {
    if (rule.re.test(title)) return rule.category;
  }
  return fallback;
}

// ── 무관/스팸 필터(순수) ─────────────────────────────────────────────────────
// 불법 무료사이트 주소 어그로·도박 광고류를 거른다. 불법 유통 '단속·검거' 보도 같은
// 정상 산업 뉴스는 살리기 위해 사이트명 단독으론 거르지 않고 미끼 문구와 결합해 판정.

const PIRACY_SITE_RE = /(뉴토끼|툰코|마나토끼|블랙툰|북토끼|아지툰|호두코믹스|누누티비|티비몬)/;
const PIRACY_BAIT_RE = /(주소|링크|바로\s*가기|바로가기|접속|우회|막힘|최신판|보는\s*곳|보는\s*법|시즌\s*2)/;

const NOISE_PATTERNS: readonly RegExp[] = [
  // "무료/미리 보기 사이트·링크" 어그로 — 합법 프로모션("기다리면 무료" 등)은 거르지 않는다.
  /(웹툰|웹소설|만화)\s*(무료|미리)\s*보기\s*(사이트|링크|주소|어플|앱|모음)/,
  /무료\s*(웹툰|만화|웹소설)\s*(사이트|어플|앱)/,
  /무료\s*(웹툰|만화|웹소설).{0,6}(추천\s*모음|사이트\s*순위|TOP\s*\d+)/i,
  /(다시\s*보기|무료\s*보기)\s*(사이트|링크|주소)/,
  /(최신|새|대체)\s*주소|주소\s*(찾기|모음|안내)|링크\s*모음/,
  /(카지노|바카라|슬롯머신|토토|먹튀|베팅)/,
  /(성인\s*웹툰)\s*(추천|사이트|순위)/,
];

export function isNoiseHeadline(title: string): boolean {
  if (PIRACY_SITE_RE.test(title) && PIRACY_BAIT_RE.test(title)) return true;
  return NOISE_PATTERNS.some((re) => re.test(title));
}

// ── 정규화·dedupe(순수) ──────────────────────────────────────────────────────

// 작품명/헤드라인 비교 키 — 소문자화 후 한글·영숫자만 남긴다(공백·문장부호 제거).
export function normalizeWorkKey(name: string): string {
  return name.toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
}

// 헤드라인 dedupe 키 — [단독]·【포토】 같은 머리말 태그를 떼고 정규화한다.
export function normalizeHeadlineKey(title: string): string {
  return normalizeWorkKey(title.replace(/\[[^\]]*\]|【[^】]*】/g, " "));
}

function charBigrams(key: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < key.length - 1; i += 1) grams.add(key.slice(i, i + 2));
  return grams;
}

// 정규화 키 간 유사도(문자 2-gram Dice 계수, 0~1) — 같은 보도자료를 매체별로
// 살짝 바꿔 쓴 헤드라인(조사·어미 차이)을 잡는다.
export function headlineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = charBigrams(a);
  const gb = charBigrams(b);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return (2 * inter) / (ga.size + gb.size);
}

const NEAR_DUP_MIN_KEY_LEN = 12; // 짧은 헤드라인은 유사도가 과대평가되므로 정확 일치만 본다
const NEAR_DUP_SIMILARITY = 0.72; // 실측: 같은 보도자료 변주 0.74~0.9, 다른 기사 ~0.67 이하

// 거의 동일 헤드라인 제거 — 정규화 키가 같거나, 충분히 긴(12자+) 키끼리
// 접두사 관계(말줄임·꼬리표 차이)거나 2-gram 유사도가 높으면(보도자료 변주) 중복으로 본다.
// URL 중복도 제거. 입력 순서 유지(앞이 승자 — 날짜 내림차순 입력이면 최신이 남는다).
export function dedupeNews<T extends { title: string; url: string }>(items: T[]): T[] {
  const seenUrls = new Set<string>();
  const seen: Array<{ key: string; grams: Set<string> }> = [];
  const out: T[] = [];
  for (const item of items) {
    if (seenUrls.has(item.url)) continue;
    const key = normalizeHeadlineKey(item.title);
    if (!key) continue;
    const grams = charBigrams(key);
    const isDup = seen.some((prev) => {
      if (prev.key === key) return true;
      if (Math.min(prev.key.length, key.length) < NEAR_DUP_MIN_KEY_LEN) return false;
      if (prev.key.startsWith(key) || key.startsWith(prev.key)) return true;
      let inter = 0;
      for (const g of grams) if (prev.grams.has(g)) inter += 1;
      return (2 * inter) / (grams.size + prev.grams.size) >= NEAR_DUP_SIMILARITY;
    });
    if (isDup) continue;
    seenUrls.add(item.url);
    seen.push({ key, grams });
    out.push(item);
  }
  return out;
}

// 동일 매체 연속 cap — 같은 출처가 maxRun 회를 넘겨 연속되면 뒤쪽의 다른 출처 기사를
// 끌어올려 출처를 다양화한다. 대안이 없으면(남은 게 전부 같은 매체) 순서를 유지한다.
export function capSourceRuns<T extends { source: string }>(items: T[], maxRun = 2): T[] {
  if (maxRun < 1) return [...items];
  const rest = [...items];
  const out: T[] = [];
  while (rest.length > 0) {
    const tail = out.slice(-maxRun);
    const blocked =
      tail.length === maxRun && tail[0].source && tail.every((t) => t.source === tail[0].source)
        ? tail[0].source
        : null;
    let idx = 0;
    if (blocked) {
      const alt = rest.findIndex((r) => r.source !== blocked);
      if (alt !== -1) idx = alt;
    }
    out.push(rest.splice(idx, 1)[0]);
  }
  return out;
}

// ── 조립(정렬·상한) ──────────────────────────────────────────────────────────

function dateValue(date: string): number {
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export interface AssembleOptions {
  perCategoryCap?: number;
  totalCap?: number;
  maxSourceRun?: number;
}

// 수집된 원시 아이템 → 노이즈 필터 → 날짜 내림차순 → dedupe → 카테고리 상한 →
// 전체 상한 → 동일 매체 연속 cap. 결정적(순수)이라 테스트 대상.
export function assembleNews(items: NewsItem[], options: AssembleOptions = {}): NewsItem[] {
  const { perCategoryCap = 20, totalCap = 80, maxSourceRun = 2 } = options;
  const usable = items.filter((it) => it.title && it.url && !isNoiseHeadline(it.title));
  const sorted = [...usable].sort((a, b) => dateValue(b.date) - dateValue(a.date));
  const deduped = dedupeNews(sorted);
  const counts: Partial<Record<NewsCategory, number>> = {};
  const capped: NewsItem[] = [];
  for (const item of deduped) {
    const n = counts[item.category] ?? 0;
    if (n >= perCategoryCap) continue;
    counts[item.category] = n + 1;
    capped.push(item);
    if (capped.length >= totalCap) break;
  }
  return capSourceRuns(capped, maxSourceRun);
}

// ── 카탈로그 작품 매칭(순수) ─────────────────────────────────────────────────
// 오탐 방지 보수 규칙:
//  - 따옴표/괄호 안('…', "…", 《…》, 〈…〉, [...]) 문구가 작품명과 정확히 일치 → 2자+면 매칭
//  - 일반 본문 포함 매칭은 정규화 5자+ 작품명만, 그리고 헤드라인에 웹툰/웹소설류 문맥 단어가 있을 때만
//  - 일반명사·보도 머리말과 겹치는 키는 스톱리스트로 차단

const WORK_KEY_STOPLIST = new Set(
  [
    // 도메인 일반어
    "웹툰", "웹소설", "만화", "소설", "드라마", "영화", "애니", "애니메이션", "신작", "연재",
    "작가", "무료", "인기", "완결", "공모전", "단행본", "시리즈", "시즌", "이벤트", "스토리",
    "코믹스", "오리지널", "랭킹", "순위", "콘텐츠", "플랫폼",
    // 플랫폼·회사명
    "네이버", "카카오", "네이버웹툰", "카카오페이지", "카카오웹툰", "레진", "리디", "문피아",
    "조아라", "노벨피아", "탑툰", "봄툰",
    // 보도 머리말(괄호 태그로 자주 등장)
    "단독", "속보", "포토", "인터뷰", "종합", "영상", "기획", "칼럼", "사설", "공식", "현장",
    "리뷰", "프리뷰", "오늘", "이슈",
  ].map(normalizeWorkKey)
);

export interface TitleMatcher {
  exact: Map<string, NewsRelatedTitle>;
  partial: ReadonlyArray<{ key: string; entry: NewsRelatedTitle }>;
}

export function buildTitleMatcher(titles: NewsCatalogEntry[]): TitleMatcher {
  // 같은 정규화 키가 여러 작품(플랫폼별 중복 등)이면 조회수 큰 작품을 우선한다.
  const byKey = new Map<string, { entry: NewsRelatedTitle; views: number }>();
  for (const t of titles) {
    if (!t?.slug || !t?.title) continue;
    const names = [t.title, ...(t.altTitles ?? []).slice(0, 3)];
    const views = t.stats?.views ?? 0;
    for (const name of names) {
      const key = normalizeWorkKey(name ?? "");
      if (key.length < 2 || key.length > 40) continue;
      if (WORK_KEY_STOPLIST.has(key) || /^[0-9]+$/.test(key)) continue;
      const prev = byKey.get(key);
      if (!prev || views > prev.views) {
        byKey.set(key, { entry: { slug: t.slug, title: t.title }, views });
      }
    }
  }
  const exact = new Map<string, NewsRelatedTitle>();
  for (const [key, v] of byKey) exact.set(key, v.entry);
  const partial = [...byKey]
    .filter(([key]) => key.length >= 5)
    .map(([key, v]) => ({ key, entry: v.entry }))
    .sort((a, b) => b.key.length - a.key.length || a.entry.slug.localeCompare(b.entry.slug));
  return { exact, partial };
}

const QUOTE_SPAN_RE =
  /['‘]([^'‘’]{1,60})['’]|["“]([^"“”]{1,60})["”]|《([^《》]{1,60})》|〈([^〈〉]{1,60})〉|\[([^\][]{1,60})\]/g;

const PLAIN_MATCH_CONTEXT_RE = /(웹툰|웹소설|만화|작가|연재|원작|단행본|애니|드라마|영화|시즌)/;

export function findRelatedTitles(
  headline: string,
  matcher: TitleMatcher,
  max = 2
): NewsRelatedTitle[] {
  const found: NewsRelatedTitle[] = [];
  const seen = new Set<string>();
  const push = (entry: NewsRelatedTitle) => {
    if (!seen.has(entry.slug)) {
      seen.add(entry.slug);
      found.push(entry);
    }
  };

  // 1) 따옴표/괄호 안 정확 일치(짧은 제목도 허용 — 인용부호가 강한 신호)
  for (const m of headline.matchAll(QUOTE_SPAN_RE)) {
    if (found.length >= max) break;
    const span = m.slice(1).find((g) => typeof g === "string" && g.length > 0);
    if (!span) continue;
    const key = normalizeWorkKey(span);
    if (key.length < 2 || WORK_KEY_STOPLIST.has(key)) continue;
    const entry = matcher.exact.get(key);
    if (entry) push(entry);
  }

  // 2) 본문 포함 매칭 — 5자+ 작품명, 웹툰/웹소설 문맥이 있는 헤드라인에서만(긴 제목 우선)
  if (found.length < max && PLAIN_MATCH_CONTEXT_RE.test(headline)) {
    const headlineKey = normalizeWorkKey(headline);
    for (const { key, entry } of matcher.partial) {
      if (found.length >= max) break;
      if (headlineKey.includes(key)) push(entry);
    }
  }
  return found.slice(0, max);
}

export function attachRelatedTitles(
  items: NewsItem[],
  matcher: TitleMatcher,
  max = 2
): NewsItem[] {
  return items.map((item) => {
    const related = findRelatedTitles(item.title, matcher, max);
    return related.length > 0 ? { ...item, related } : item;
  });
}

// ── 수집(IO) ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

// 쿼리 1개 수집 — 타임아웃 + 재시도 1회. 실패 시 throw(호출부에서 카테고리 스킵).
export async function fetchQueryItems(query: string, options: FetchOptions = {}): Promise<ParsedRssItem[]> {
  const { fetchImpl = fetch, timeoutMs = 10_000, retries = 1, retryDelayMs = 400 } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchImpl(googleNewsRssUrl(query), {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`rss ${res.status}`);
      return parseRssItems(await res.text());
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(retryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface CollectResult {
  items: NewsItem[];
  okQueries: number;
  failedQueries: string[];
}

// 전체 쿼리 병렬 수집 — 실패한 쿼리(카테고리)는 스킵하고 나머지로 계속한다.
export async function collectNewsItems(options: FetchOptions & { perQueryLimit?: number } = {}): Promise<CollectResult> {
  const perQueryLimit = options.perQueryLimit ?? 60;
  const settled = await Promise.allSettled(
    NEWS_QUERIES.map(async ({ category, query }) => {
      const parsed = await fetchQueryItems(query, options);
      return parsed
        .slice(0, perQueryLimit)
        .map<NewsItem>((it) => ({ ...it, category: classifyNews(it.title, category) }));
    })
  );
  const items: NewsItem[] = [];
  const failedQueries: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else failedQueries.push(NEWS_QUERIES[i].query);
  });
  return { items, okQueries: NEWS_QUERIES.length - failedQueries.length, failedQueries };
}

// ── 파일 쓰기 ────────────────────────────────────────────────────────────────

export function readFileIfExists(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

function parsePayload(raw: string | null | undefined): NewsPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NewsPayload;
    if (!Array.isArray(parsed?.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface WriteNewsOptions extends FetchOptions {
  outFile: string;
  titles?: NewsCatalogEntry[];
  /** rmSync 등으로 지워지기 전에 확보한 기존 news.json 원문 — 전체 실패 시 보존용 */
  fallbackRaw?: string | null;
  log?: (line: string) => void;
}

// 수집→정제→매칭→저장. 수집이 전부 실패하면 기존 스냅샷(fallbackRaw)을 그대로 보존하고,
// 그것도 없을 때만 빈 목록을 쓴다(빌드는 어떤 경우에도 깨지지 않음).
export async function writeNews(options: WriteNewsOptions): Promise<NewsPayload> {
  const log = options.log ?? console.log;
  const pad = (name: string) => name.padEnd(16);
  mkdirSync(path.dirname(options.outFile), { recursive: true });

  let collected: CollectResult = { items: [], okQueries: 0, failedQueries: [] };
  try {
    collected = await collectNewsItems(options);
  } catch (error) {
    log(`  ${pad("news.json")} (수집 오류: ${(error as Error)?.message ?? error})`);
  }

  let items = assembleNews(collected.items);
  if (items.length === 0) {
    const fallback = parsePayload(options.fallbackRaw);
    if (fallback && fallback.items.length > 0) {
      writeFileSync(options.outFile, JSON.stringify(fallback));
      log(`  ${pad("news.json")} (수집 실패 — 기존 ${fallback.items.length}건 보존)`);
      return fallback;
    }
    const empty: NewsPayload = { items: [], generatedAt: new Date().toISOString() };
    writeFileSync(options.outFile, JSON.stringify(empty));
    log(`  ${pad("news.json")} (수집 실패 — 빈 목록 폴백)`);
    return empty;
  }

  if (options.titles && options.titles.length > 0) {
    items = attachRelatedTitles(items, buildTitleMatcher(options.titles));
  }
  const payload: NewsPayload = { items, generatedAt: new Date().toISOString() };
  writeFileSync(options.outFile, JSON.stringify(payload));

  const kb = (statSync(options.outFile).size / 1024).toFixed(0);
  const relatedCount = items.filter((it) => (it.related?.length ?? 0) > 0).length;
  const failNote = collected.failedQueries.length > 0 ? `, 실패 쿼리 ${collected.failedQueries.length}` : "";
  log(`  ${pad("news.json")} ${kb.padStart(7)} KB (${items.length} items, 관련작품 ${relatedCount}건${failNote})`);
  return payload;
}

// ── CLI(단독 실행) ───────────────────────────────────────────────────────────

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadCatalogEntries(gzPath: string): NewsCatalogEntry[] {
  const raw = gunzipSync(readFileSync(gzPath)).toString("utf8");
  const parsed = JSON.parse(raw) as unknown;
  const titles = Array.isArray(parsed) ? parsed : (parsed as { titles?: unknown })?.titles;
  if (!Array.isArray(titles)) throw new Error("invalid catalog payload (titles 배열 없음)");
  return titles as NewsCatalogEntry[];
}

async function runCli(): Promise<void> {
  const gzPath =
    process.env.WEBDEX_CATALOG_FILE ??
    process.env.WEBDEX_CATALOG_GZ ??
    path.join(ROOT, "apps/api/data/catalog.json.gz");
  const outFile = path.join(ROOT, "apps", "web", "public", "data", "news.json");
  const titles = existsSync(gzPath) ? loadCatalogEntries(gzPath) : [];
  console.log(`뉴스 생성: ${NEWS_QUERIES.length}개 쿼리 (작품 매칭 카탈로그 ${titles.length}편)`);
  const payload = await writeNews({ outFile, titles, fallbackRaw: readFileIfExists(outFile) });
  const dist: Partial<Record<NewsCategory, number>> = {};
  for (const item of payload.items) dist[item.category] = (dist[item.category] ?? 0) + 1;
  console.log(
    `  카테고리 분포: ${NEWS_CATEGORIES.map((c) => `${c} ${dist[c] ?? 0}`).join(" · ")}`
  );
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runCli().catch((error) => {
    console.error("뉴스 생성 실패:", (error as Error)?.message ?? error);
    process.exit(1);
  });
}
