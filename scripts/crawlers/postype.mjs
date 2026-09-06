// Postype 크롤러 — SSR HTML(globalThis.__next_f.push 페이로드)에서 시리즈 카탈로그를 수집한다.
// 출처: https://www.postype.com/@<handle>/series (path 페이지네이션 ?page=N — robots 허용).
// 채널 핸들은 공개 sitemap(/sitemap.xml → /sitemap/posts/posts-*.xml, robots 허용)에서 수확한다.
// 표지는 d3mcojo3jv0dbr.cloudfront.net (catalog.controller allowlist 등록 호스트), coverProxy()로 프록시.
//   (빈 표지 placeholder d33pksfia2a94m.cloudfront.net 은 허용 호스트가 아니므로 safeCover 가 자연히 제외.)
// robots: /api,/@*/search,*series_sort=,/feed 등은 사용하지 않는다. 데스크톱 UA, 소량 요청 + sleep.
import {
  fetchText,
  mapGenres,
  coverGradient,
  coverProxy,
  estimateStats,
  norm,
  cleanTitle,
  stripTags,
  mapAge,
  sleep,
} from "./_shared.mjs";

const PREFIX = "pt";
const PLATFORM_ID = "postype";
const ORIGIN = "https://www.postype.com";
const COVER_HOST = "d3mcojo3jv0dbr.cloudfront.net";

// 검증된 공개 콘텐츠 채널(시드). @original 은 포스타입 오리지널 카탈로그(다수 시리즈).
// 이 외 핸들은 공개 sitemap 에서 동적으로 수확한다(discoverHandles).
const SEED_HANDLES = ["original", "blog"];

// sitemap 인덱스(/sitemap.xml)가 막히거나 비었을 때 쓰는 알려진 posts sitemap fallback.
// 이 날짜 파일들은 활동 채널(시리즈 발행 이력)이 밀집한 공개 sitemap 이다.
const FALLBACK_POSTS_SITEMAPS = [
  `${ORIGIN}/sitemap/posts/posts-2022-01-16.xml`,
  `${ORIGIN}/sitemap/posts/posts-2022-02-05.xml`,
  `${ORIGIN}/sitemap/posts/posts-2022-03-18.xml`,
];

const MAX_PAGES = 20; // 핸들당 안전 상한.
const TARGET = 800; // 목표 유니크 시리즈 수. 도달하면 조기 종료.
const MAX_CHANNEL_FETCHES = 400; // 채널 series 요청 상한.
const MAX_HANDLES_SCAN = 900; // 핸들 후보 스캔 상한.
const SITEMAP_INDEX = `${ORIGIN}/sitemap.xml`;

// globalThis.__next_f.push([1,"...escaped..."]) 문자열 페이로드를 모두 이어붙여 디코드한다.
function decodeNextPayload(html) {
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  let joined = "";
  while ((m = re.exec(html))) {
    try {
      joined += JSON.parse('"' + m[1] + '"');
    } catch {
      /* 부분 청크 디코드 실패는 무시 */
    }
  }
  return joined;
}

// 디코드된 텍스트에서 "series":{...} 객체를 중괄호 균형으로 추출 → JSON 파싱.
// title + thumbnail + id 를 가진 객체만 채택.
function extractSeries(joined) { // NOSONAR javascript:S3776
  const out = [];
  const marker = '"series":{';
  let i = 0;
  while ((i = joined.indexOf(marker, i)) !== -1) {
    const start = i + marker.length - 1; // 여는 '{' 위치
    let depth = 0;
    let j = start;
    let inStr = false;
    let esc = false;
    for (; j < joined.length; j++) {
      const ch = joined[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          j++; // NOSONAR javascript:S2310
          break;
        }
      }
    }
    const objText = joined.slice(start, j);
    try {
      // "$undefined" 토큰을 null 로 치환해 JSON 파싱 가능하게 한다.
      const obj = JSON.parse(objText.replace(/"\$undefined"/g, "null"));
      if (obj && obj.id != null && obj.title && obj.thumbnail) out.push(obj);
    } catch {
      /* 깨진 객체 무시 */
    }
    i = j;
  }
  return out;
}

// 시리즈 type 코드 → 표준 status.
function mapStatus(type) {
  // FINISHED/SHORT(단편 완결) → completed, 그 외(ONGOING 등) → ongoing.
  if (type === "FINISHED" || type === "SHORT") return "completed";
  return "ongoing";
}

// thumbnail 이 허용 표지 호스트인지 검증(잘못된 호스트면 coverImage 생략).
function safeCover(url) {
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return undefined;
    if (u.hostname !== COVER_HOST) return undefined;
    return coverProxy(url);
  } catch {
    return undefined;
  }
}

// thumbnail 경로 prefix(YYYY/MM/...)에서 발행연도 추정.
function inferYear(url) {
  const m = String(url || "").match(/\/(\d{4})\/(\d{2})\//);
  if (m) {
    const y = Number(m[1]);
    if (y >= 2014 && y <= 2026) return y;
  }
  return 2023;
}

// 공개 sitemap XML 에서 <loc> URL 목록을 뽑는다.
function extractLocs(xml) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

// 채널/포스트 URL(.../@handle 또는 .../@handle/post/123)에서 핸들만 추출.
function handleFromUrl(url) {
  const m = String(url || "").match(/postype\.com\/@(\w+)/);
  return m ? m[1] : null;
}

// 공개 sitemap 인덱스에서 posts sitemap 들을 골라(robots 허용 경로),
// 거기 등장하는 채널 핸들을 수확한다. 인덱스가 비면 FALLBACK 으로 폴백.
// 시드 핸들을 앞에 두고, sitemap 등장 순서를 유지(결정적 — 재현 가능).
async function discoverHandles() { // NOSONAR javascript:S3776
  const seen = new Set();
  const ordered = [];
  const push = (h) => {
    if (h && !seen.has(h)) {
      seen.add(h);
      ordered.push(h);
    }
  };
  for (const h of SEED_HANDLES) push(h);

  // 1) sitemap 인덱스에서 posts sitemap URL 후보를 모은다(최신 우선 — 활동 채널 밀집).
  let postsSitemaps = [];
  const indexXml = await fetchText(SITEMAP_INDEX, { referer: ORIGIN + "/" });
  if (indexXml) {
    postsSitemaps = extractLocs(indexXml)
      .filter((u) => /\/sitemap\/posts\/posts-[\d-]+\.xml$/.test(u))
      .reverse(); // 최신 날짜부터
  }
  if (postsSitemaps.length === 0) postsSitemaps = [...FALLBACK_POSTS_SITEMAPS];

  // 2) 핸들이 충분히 모일 때까지 posts sitemap 을 소량씩 읽는다(최대 6개).
  for (const sm of postsSitemaps.slice(0, 6)) {
    if (ordered.length >= MAX_HANDLES_SCAN) break;
    const xml = await fetchText(sm, { referer: ORIGIN + "/" });
    await sleep(250);
    if (!xml) continue;
    const handles = extractLocs(xml).map(handleFromUrl).filter(Boolean);
    if (handles.length === 0) continue;
    for (const h of handles) {
      push(h);
      if (ordered.length >= MAX_HANDLES_SCAN) break;
    }
  }

  // 3) 인덱스 경로가 막혀 시드만 남았으면 FALLBACK sitemap 으로 한 번 더 시도.
  if (ordered.length <= SEED_HANDLES.length) {
    for (const sm of FALLBACK_POSTS_SITEMAPS) {
      if (ordered.length >= MAX_HANDLES_SCAN) break;
      const xml = await fetchText(sm, { referer: ORIGIN + "/" });
      await sleep(250);
      if (!xml) continue;
      for (const h of extractLocs(xml).map(handleFromUrl).filter(Boolean)) {
        push(h);
        if (ordered.length >= MAX_HANDLES_SCAN) break;
      }
    }
  }

  return ordered;
}

function toRow(obj, handle, index) {
  const workId = String(obj.id);
  const id = `${PREFIX}-${workId}`;
  const rawTitle = stripTags(String(obj.title));
  const isNovel = Array.isArray(obj.majorTags) && obj.majorTags.includes("웹소설");
  const type = isNovel ? "webnovel" : "webtoon";
  const fallbackGenre = isNovel ? "판타지" : "드라마";

  const tagPool = [
    ...(Array.isArray(obj.userTags) ? obj.userTags : []),
    ...(Array.isArray(obj.majorTags) ? obj.majorTags : []),
  ]
    .filter((t) => typeof t === "string" && t.trim())
    .map((t) => t.trim());

  const genres = mapGenres(tagPool, fallbackGenre);
  const status = mapStatus(obj.type);
  const synopsisRaw = stripTags(String(obj.description || ""));
  const synopsis =
    synopsisRaw.length > 4
      ? synopsisRaw
      : `${rawTitle} · 포스타입 공개 카탈로그 수집작.`;

  const workUrl = `${ORIGIN}/@${handle}/series/${workId}`;
  const realViews =
    typeof obj.viewCount === "number" && obj.viewCount > 0 ? obj.viewCount : undefined;
  const realLikes =
    typeof obj.likeCount === "number" && obj.likeCount > 0 ? obj.likeCount : undefined;

  const row = {
    _normTitle: norm(rawTitle),
    id,
    slug: id,
    type,
    title: cleanTitle(rawTitle),
    author: stripTags(String(obj.nickname || "")) || "미상",
    genres,
    tags: [...new Set(tagPool)].slice(0, 6),
    synopsis,
    cover: coverGradient(workId, genres),
    coverImage: safeCover(obj.thumbnail),
    status,
    ageRating: mapAge(Boolean(obj.adult)),
    releaseYear: inferYear(obj.thumbnail),
    availability: [{ platformId: PLATFORM_ID, pricing: "free", url: workUrl }],
    stats: estimateStats({
      seed: id,
      rank: index + 1,
      views: realViews,
      likes: realLikes,
      finished: status === "completed",
    }),
    featured: false,
  };

  return row;
}

// 한 채널의 /series 를 페이지네이션하며 시리즈를 byWorkId 에 채운다.
// 반환: 이 채널에서 새로 추가된 시리즈 수.
async function crawlHandle(handle, byWorkId) { // NOSONAR javascript:S3776
  let addedTotal = 0;
  let prevSize = -1;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageQuery = page > 1 ? `?page=${page}` : "";
    const url = `${ORIGIN}/@${handle}/series${pageQuery}`;
    const html = await fetchText(url, { referer: ORIGIN + "/" });
    if (!html) break;

    const joined = decodeNextPayload(html);
    if (!joined) break;

    const series = extractSeries(joined);
    if (series.length === 0) break;

    let added = 0;
    for (const obj of series) {
      const wid = String(obj.id);
      if (byWorkId.has(wid)) continue;
      byWorkId.set(wid, { obj, handle });
      added++;
    }
    addedTotal += added;

    // 이번 페이지가 새 항목을 전혀 추가하지 않았다면(중복/마지막 페이지) 이 채널 종료.
    if (added === 0) break;

    // 마지막 페이지 감지: 직전 페이지보다 시리즈가 적게 나오면 끝.
    if (prevSize !== -1 && series.length < prevSize) break;
    prevSize = series.length;

    await sleep(420);
  }
  return addedTotal;
}

export async function crawl() {
  const byWorkId = new Map();

  // 공개 sitemap 에서 채널 핸들을 수확(시드 포함, 결정적 순서).
  const handles = await discoverHandles();

  let fetches = 0;
  for (const handle of handles) {
    if (byWorkId.size >= TARGET) break;
    if (fetches >= MAX_CHANNEL_FETCHES) break;
    fetches++;
    await crawlHandle(handle, byWorkId);
    await sleep(180);
  }

  const rows = [];
  let i = 0;
  for (const { obj, handle } of byWorkId.values()) {
    rows.push(toRow(obj, handle, i));
    i++;
  }
  return rows;
}
