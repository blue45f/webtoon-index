// joara (조아라) 크롤러 — 공개 JSON API(api.joara.com/v2/book/best_book) 기반.
// data.list[] 의 실제 메타(제목/작가/장르/표지/링크/소개/지표)를 수집한다.
// 표지는 cf-image.joara.com 절대 URL → coverProxy()로 /api/cover 프록시화.
import {
  fetchJson,
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

const PREFIX = "jo";
const PLATFORM_ID = "joara";
const REFERER = "https://www.joara.com/";

// best_book 공개 엔드포인트. best=today 만 유효(week/month 는 400). category 별로 다른 랭킹을 돌려준다.
const API =
  "https://api.joara.com/v2/book/best_book?api_key=mw_8ba234e7801ba288554ca07ae44c7&ver=3.2.0&device=mw&deviceuid=x&devicetoken=mw&store=all&best=today&orderby=cnt_best&offset=20";

// 카탈로그 다양성을 위해 장르 카테고리 코드별로 순회한다(0=전체 + 주요 장르).
// 각 코드별 fallback 정규 장르를 지정해 mapGenres 가 비면 보강.
const CATEGORIES = [
  { code: 0, fallback: "드라마" },
  { code: 1, fallback: "판타지" },
  { code: 5, fallback: "로맨스" },
  { code: 9, fallback: "드라마" }, // 패러디
  { code: 20, fallback: "BL" },
  { code: 22, fallback: "로판" },
  { code: 25, fallback: "현판" },
];

const PAGES_PER_CATEGORY = 30; // 카테고리당 30페이지 → 빈 페이지면 조기 종료(전 작품 지향).

// "YYYY-MM-DD ..." → 연도(best-effort).
function yearFrom(...dates) {
  for (const d of dates) {
    const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(d || ""));
    if (m) {
      const y = Number(m[1]);
      if (y >= 1990 && y <= 2030) return y;
    }
  }
  return 2023;
}

function toRow(item, fallbackGenre, rank) { // NOSONAR javascript:S3776
  const workId = item.book_code;
  if (workId == null) return null;
  const realTitle = cleanTitle(stripTags(String(item.subject || ""))).trim();
  if (!realTitle) return null;

  const id = `${PREFIX}-${workId}`;
  const author = String(item.member_name || "").trim() || "미상";

  // 장르 후보: category_name + keyword 태그 + 소개 일부.
  const rawIntro = String(item.intro || item.introduce || "");
  const keywords = Array.isArray(item.keyword)
    ? item.keyword.map((k) => String(k).trim()).filter(Boolean)
    : [];
  const genreInput = [String(item.category_name || ""), ...keywords, rawIntro];
  const genres = mapGenres(genreInput, fallbackGenre);

  // 태그: keyword 우선, 없으면 소개의 #해시태그에서 추출.
  let tags = keywords;
  if (!tags.length) {
    tags = (rawIntro.match(/#([^\s#]+)/g) || []).map((t) => t.replace(/^#/, ""));
  }
  tags = [...new Set(tags.map((t) => t.slice(0, 24)).filter(Boolean))].slice(0, 6);

  const cleanIntro = stripTags(rawIntro)
    .replace(/#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const synopsis = cleanIntro || `${realTitle} · 조아라 공개 카탈로그 수집작.`;

  const status = item.chkfinish ? "completed" : "ongoing";
  const realCover =
    typeof item.cover === "string" && /^https:\/\//i.test(item.cover) ? item.cover : undefined;

  const views = Number(item.page_read) || undefined;
  const likes = Number(item.recommend_count) || Number(item.favorite_count) || undefined;

  return {
    _normTitle: norm(realTitle),
    id,
    slug: id,
    type: "webnovel",
    title: realTitle,
    author,
    genres,
    tags,
    synopsis,
    cover: coverGradient(workId, genres),
    coverImage: coverProxy(realCover),
    status,
    ageRating: mapAge(Boolean(item.chkadult)),
    releaseYear: yearFrom(item.first_regist_datetime, item.last_regist_datetime),
    availability: [
      {
        platformId: PLATFORM_ID,
        pricing: "paid",
        url: `https://www.joara.com/book/${workId}`,
      },
    ],
    stats: estimateStats({
      seed: id,
      rank,
      views,
      likes,
      finished: status === "completed",
    }),
    featured: false,
  };
}

export async function crawl() { // NOSONAR javascript:S3776
  const byId = new Map();

  for (const { code, fallback } of CATEGORIES) {
    for (let page = 1; page <= PAGES_PER_CATEGORY; page++) {
      const url = `${API}&category=${code}&page=${page}`;
      const json = await fetchJson(url, { referer: REFERER });
      const list = json?.data?.list;
      if (!Array.isArray(list) || list.length === 0) break; // 빈 페이지면 이 카테고리 종료.

      let added = 0;
      for (const item of list) {
        const code2 = item?.book_code;
        if (code2 == null || byId.has(code2)) continue;
        const row = toRow(item, fallback, byId.size + 1);
        if (row) {
          byId.set(code2, row);
          added++;
        }
      }
      // 새로 추가된 게 전혀 없으면(전부 중복) 다음 카테고리로.
      if (added === 0 && page > 1) break;
      await sleep(250); // 호출 간 짧은 대기.
    }
  }

  // 최종 순위 재할당(map 삽입 순서 = 수집 순서) — trendingScore 등이 rank 에 의존.
  const rows = [...byId.values()];
  return rows.map((row, i) => ({
    ...row,
    stats: { ...row.stats, ...rankAdjust(row, i + 1) },
  }));
}

// rank 의존 지표만 최종 인덱스 기준으로 보정(views/likes 등 실제값은 estimateStats 가 이미 반영).
function rankAdjust(row, rank) {
  return {
    trendingScore: Math.max(35, Math.min(99, 92 - rank)),
  };
}
