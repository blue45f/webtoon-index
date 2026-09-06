// onestory (원스토리 북스) 웹툰 크롤러.
// 소스: https://onestory.co.kr/display/rank/webtoon/<menuKey> 의 HTML 안에 박힌
//       globalThis.__PRELOADED_STATE__ (JSON). robots.txt 가 /display/ 를 Allow 하며
//       /api · /tpl 은 건드리지 않는다. 데스크톱 UA, 장르 메뉴별 1회씩만 요청(소량).
// 아이템: state.displayProduct.productList[] — prodNm/artistNm/prodId/thumbnailImageUrl 등.
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

const PREFIX = "os";
const PLATFORM_ID = "onestory";
const PLATFORM_NM = "원스토리";
const ORIGIN = "https://onestory.co.kr";
// 실제 표지 호스트(상대경로 thumbnailImageUrl 앞에 224x224 썸네일 프리셋을 붙인다).
const COVER_BASE = "https://img-books.onestore.co.kr/thumbnails/img_sac/224_224_F10_95";

// 웹툰 장르 메뉴(displayCategory.menuList) — menuKey: 폴백 장르(한글).
// 전체(webtoonAll) 외 8개 장르 페이지를 합쳐 dedupe → 솔리드 카탈로그.
const MENUS = [
  ["webtoonAll", ""],
  ["DP26002", "로맨스"], // 순정
  ["DP26009", "BL"], // BL
  ["DP26003", "드라마"], // 드라마
  ["DP26006", "액션"], // 액션
  ["DP26005", "판타지"], // 판타지
  ["DP26007", "일상"], // 일상
  ["DP26001", "코미디"], // 개그
  ["DP26004", "스릴러"], // 스릴러
];

// HTML 안의 globalThis.__PRELOADED_STATE__ = {...} 를 중괄호 균형으로 안전 추출.
// (JSON 본문에 </script> 가 섞여 있어 정규식 non-greedy 매칭은 깨진다.)
function extractPreloadedState(html) { // NOSONAR javascript:S3776
  const s = String(html || "");
  const mi = s.indexOf("globalThis.__PRELOADED_STATE__");
  if (mi < 0) return null;
  const from = s.indexOf("{", mi);
  if (from < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(from, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// "월, 목, 토" → ["월","목","토"] (정규 요일만).
const WDAYS = new Set(["월", "화", "수", "목", "금", "토", "일"]);
function parseUpdateDays(weekDayNm) {
  const days = String(weekDayNm || "")
    .split(/[,\s/·]+/)
    .map((d) => d.trim())
    .filter((d) => WDAYS.has(d));
  return days.length ? days : undefined;
}

// "YYYY.MM.DD" → 연도. 실패 시 기본 2023.
function parseYear(regDt) {
  const m = String(regDt || "").match(/(19|20)\d{2}/);
  if (!m) return 2023;
  const y = Number(m[0]);
  return y >= 1990 && y <= 2030 ? y : 2023;
}

// completedStatus: "completed" → completed, 그 외("continue" 등) → ongoing.
function mapStatus(completedStatus) {
  return String(completedStatus || "").toLowerCase() === "completed" ? "completed" : "ongoing";
}

// 작가 문자열 정리. artistNm 은 "니나노솔,아름,민은경" 처럼 콤마 구분.
function cleanAuthor(s) {
  const v = String(s || "").trim();
  return v || "미상";
}

function buildRow(item, fallbackGenre, rank) { // NOSONAR javascript:S3776
  const workId = String(item.prodId || "").trim();
  if (!workId) return null;
  const rawTitle = cleanTitle(item.prodNm || "");
  if (!rawTitle) return null;

  const author = cleanAuthor(item.artistNm);
  const artist = String(item.artistNmSub || "").trim() || undefined;

  const status = mapStatus(item.completedStatus);
  const adult = String(item.plus19Yn || "").toUpperCase() === "Y";

  // 장르 추론: 제목 + (메뉴 폴백) 으로 정규 장르 매핑.
  const genreHints = [rawTitle];
  if (fallbackGenre) genreHints.push(fallbackGenre);
  const genres = mapGenres(genreHints, fallbackGenre || "드라마");

  // 태그: 출판사 / 단위 / 요일 등 짧은 메타.
  const tags = [
    item.publisherNm,
    fallbackGenre,
    status === "completed" ? "완결" : "연재중",
  ]
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 6);

  // 실제 평점(avgScore). 0 은 "평가 없음" 으로 보고 estimateStats 에 넘기지 않는다.
  const realAvg = Number(item.avgScore) > 0 ? Number(item.avgScore) : undefined;
  const realCount = Number(item.commentCount) > 0 ? Number(item.commentCount) : undefined;

  const relCover = String(item.thumbnailImageUrl || "").trim();
  const realCoverUrl = relCover.startsWith("/") ? COVER_BASE + relCover : undefined;

  const id = `${PREFIX}-${workId}`;
  const workUrl = `${ORIGIN}/display/product/${workId}`;

  const row = {
    _normTitle: norm(rawTitle),
    id,
    slug: id,
    type: "webtoon",
    title: rawTitle,
    author,
    genres,
    tags,
    synopsis: `${rawTitle} · ${PLATFORM_NM} 공개 카탈로그 수집작.`,
    cover: coverGradient(workId, genres),
    coverImage: coverProxy(realCoverUrl),
    status,
    ageRating: mapAge(adult),
    releaseYear: parseYear(item.regDt),
    availability: [{ platformId: PLATFORM_ID, pricing: "paid", url: workUrl }],
    stats: estimateStats({
      seed: id,
      rank,
      ratingAvg: realAvg,
      ratingCount: realCount,
      finished: status === "completed",
    }),
    featured: false,
  };

  if (artist) row.artist = artist;
  const updateDays = parseUpdateDays(item.weekDayNm);
  if (updateDays) row.updateDays = updateDays;

  return row;
}

export async function crawl() { // NOSONAR javascript:S3776
  const byWorkId = new Map();

  for (let i = 0; i < MENUS.length; i++) {
    const [menuKey, fallbackGenre] = MENUS[i];
    const url = `${ORIGIN}/display/rank/webtoon/${menuKey}`;
    const html = await fetchText(url, { referer: `${ORIGIN}/` });
    if (html) {
      const state = extractPreloadedState(html);
      const list = state?.displayProduct?.productList;
      if (Array.isArray(list)) {
        list.forEach((item) => {
          const workId = String(item?.prodId || "").trim();
          if (!workId || byWorkId.has(workId)) return; // dedupe by workId
          // 전체적인 순위: 발견 순서(맵 크기) 기반 — estimateStats 의 rank 시드.
          const rank = byWorkId.size + 1;
          const row = buildRow(item, fallbackGenre, rank);
          if (row) byWorkId.set(workId, row);
        });
      }
    }
    if (i < MENUS.length - 1) await sleep(400); // 소량 요청 + 짧은 간격.
  }

  return [...byWorkId.values()];
}
