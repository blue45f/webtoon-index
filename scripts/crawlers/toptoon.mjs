// toptoon (탑툰) 웹툰 크롤러.
// 소스: https://toptoon.com 의 공개 랭킹/완결 카탈로그 AJAX 프래그먼트(HTML 조각).
//   - /ranking/getRankingHtml/{1,2,3}       — 랭킹 1/2/3 탭(각 100작)
//   - /complete/getCompleteHtml/<tab>        — 완결 탭(comicTotalComplete=157작 등)
// robots.txt: User-agent:* Allow:/ (일반 봇 전체 허용; Googlebot/Yeti 만 ?p_id= 차단,
//   우리는 ?p_id= 를 쓰지 않는다). /api 미사용. 데스크톱 UA + XMLHttpRequest 헤더로
//   각 엔드포인트 1회씩만 요청(총 <10회).
// 아이템: <li class="serial__item jsComicObj" data-comic-idx data-comic-id data-paid-count ...>
//   안에 표지(serial__image background-image), 제목(serial__title-text),
//   조회수(serial__views "143만"), 회차(serial__episode "제145화 최종화 ...") 가 박혀 있다.
// 성인 우회 금지: 공개 리스트에 노출된 공개 썸네일 URL 만 그대로 사용한다.
import {
  fetchText,
  mapGenres,
  coverGradient,
  coverProxy,
  estimateStats,
  norm,
  cleanTitle,
  mapAge,
  sleep,
} from "./_shared.mjs";

const PREFIX = "tt";
const PLATFORM_ID = "toptoon";
const PLATFORM_NM = "탑툰";
const ORIGIN = "https://toptoon.com";

// 수집 소스. [url, referer, fallbackGenre, completed].
// 랭킹 탭은 연재/완결 혼재(에피소드 "최종화" 로 개별 판정), 완결 탭은 전부 완결작.
const SOURCES = [
  [`${ORIGIN}/ranking/getRankingHtml/1`, `${ORIGIN}/ranking`, "", false],
  [`${ORIGIN}/ranking/getRankingHtml/2`, `${ORIGIN}/ranking`, "", false],
  [`${ORIGIN}/ranking/getRankingHtml/3`, `${ORIGIN}/ranking`, "", false],
  [`${ORIGIN}/complete/getCompleteHtml/comicTotalComplete`, `${ORIGIN}/complete`, "", true],
  [`${ORIGIN}/complete/getCompleteHtml/topSales`, `${ORIGIN}/complete`, "", true],
  [`${ORIGIN}/complete/getCompleteHtml/latestTotal`, `${ORIGIN}/complete`, "", true],
];

// "143만"/"5천"/"1.0만"/"2,645만" → 정수 조회수. 실패 시 undefined.
function parseViews(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  const m = t.match(/^([\d.]+)\s*([만천])?/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  let unit = 1;
  if (m[2] === "만") unit = 10_000;
  else if (m[2] === "천") unit = 1_000;
  const v = Math.round(n * unit);
  return v > 0 ? v : undefined;
}

// <li class="serial__item jsComicObj" ...>...</li> 블록 하나에서 필드 추출.
function parseItem(block, source) { // NOSONAR javascript:S3776
  const [, , fallbackGenre, completedSource] = source;

  const idx = (block.match(/data-comic-idx="(\d+)"/) || [])[1];
  const cid = (block.match(/data-comic-id="([^"]+)"/) || [])[1];
  // idx + slug(data-comic-id) 둘 다 있어야 실제 작품 li (배너/플레이스홀더 li 제외).
  if (!idx || !cid) return null;

  const rawTitle = cleanTitle((block.match(/serial__title-text"[^>]*>([^<]*)</) || [])[1] || "");
  if (!rawTitle) return null;

  const coverRaw = (block.match(/serial__image[^>]*background-image\s*:\s*url\(([^)]+)\)/i) || [])[1] || "";
  const coverUrl = coverRaw.replace(/(?:^['"]|['"]$)/g, "").trim();
  // 실제 공개 썸네일(smurfs.toptoon.com)만 통과. UI 에셋(/assets/img/) 은 표지가 아니다.
  const realCover = /^https:\/\/[^/]*toptoon\.com\/assets\/upfile\//i.test(coverUrl) ? coverUrl : undefined;

  const viewsStr = (block.match(/serial__views[^>]*>([^<]*)</) || [])[1] || "";
  const realViews = parseViews(viewsStr);

  const epStr = (block.match(/serial__episode"[^>]*>([^<]*)</) || [])[1] || "";
  const epCount = (epStr.match(/제\s*(\d+)\s*화/) || [])[1];
  // 완결 탭 소속이거나 회차에 "최종화" 표기가 있으면 완결.
  const completed = completedSource || /최종화/.test(epStr);

  const paidCount = Number((block.match(/data-paid-count="(\d+)"/) || [])[1] || 0);

  return {
    idx,
    cid,
    rawTitle,
    realCover,
    realViews,
    epCount: epCount ? Number(epCount) : undefined,
    paidCount,
    completed,
    fallbackGenre,
  };
}

function buildRow(item, rank) {
  const { idx, cid, rawTitle, realCover, realViews, epCount, paidCount, completed, fallbackGenre } = item;

  // 장르 추론: 공개 리스트엔 장르 라벨이 없어 제목 기반 정규 매핑.
  const genres = mapGenres([rawTitle, fallbackGenre].filter(Boolean), fallbackGenre || "드라마");
  const status = completed ? "completed" : "ongoing";

  const tags = [status === "completed" ? "완결" : "연재중", ...genres.slice(0, 2)]
    .filter(Boolean)
    .slice(0, 6);

  const id = `${PREFIX}-${idx}`;
  const workUrl = `${ORIGIN}/comic/ep_list/${cid}`;

  const row = {
    _normTitle: norm(rawTitle),
    id,
    slug: id,
    type: "webtoon",
    title: rawTitle,
    author: "미상",
    genres,
    tags,
    synopsis: `${rawTitle} · ${PLATFORM_NM} 공개 카탈로그 수집작.`,
    cover: coverGradient(idx, genres),
    coverImage: coverProxy(realCover),
    status,
    // 탑툰은 유료 코인 기반(파일럿 무료 회차 존재). 카탈로그 가격은 paid 로 표기.
    ageRating: mapAge(false),
    releaseYear: 2022,
    availability: [{ platformId: PLATFORM_ID, pricing: "paid", url: workUrl }],
    stats: estimateStats({
      seed: id,
      rank,
      views: realViews,
      finished: status === "completed",
    }),
    featured: false,
  };

  // 회차 수(공개 메타). data-paid-count 가 더 클 때가 있어 둘 중 큰 값.
  const episodes = Math.max(epCount || 0, paidCount || 0);
  if (episodes > 0) row.episodeCount = episodes;

  return row;
}

// HTML 프래그먼트를 <li ... jsComicObj ...> 단위로 분할.
function splitItems(html) {
  const s = String(html || "");
  const out = [];
  const re = /<li\b[^>]*\bjsComicObj\b[^>]*>/g;
  let m;
  const starts = [];
  while ((m = re.exec(s))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : s.length;
    out.push(s.slice(from, to));
  }
  return out;
}

export async function crawl() { // NOSONAR javascript:S3776
  const byWorkId = new Map();

  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i];
    const [url, referer] = source;
    const html = await fetchText(url, {
      referer,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (html) {
      for (const block of splitItems(html)) {
        const item = parseItem(block, source);
        if (!item) continue;
        if (byWorkId.has(item.idx)) continue; // dedupe by comic-idx
        const rank = byWorkId.size + 1;
        const row = buildRow(item, rank);
        if (row) byWorkId.set(item.idx, row);
      }
    }
    if (i < SOURCES.length - 1) await sleep(400);
  }

  return [...byWorkId.values()];
}
