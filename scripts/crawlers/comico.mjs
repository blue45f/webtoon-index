// 코미코(comico.kr) 공개 웹툰 카탈로그 크롤러.
// 소스: https://www.comico.kr 의 공개 목록 페이지 HTML 안 <script id="__NEXT_DATA__"> JSON.
//       (api.comico.kr 내부 JSON은 인증 토큰을 요구하므로 사용하지 않는다 — 로그인/연령벽 우회 X.)
//
// ⚠️ 지오펜스: 코미코는 한국 외 IP를 방화벽에서 드롭(SYN 무응답)한다. 따라서 한국 외 egress
//    (일부 CI/샌드박스 포함)에서는 fetchText 가 타임아웃→null 을 반환하고 crawl()은 []를 낸다
//    — 날조 없이 정직하게 빈 결과(빈 슬롯은 UI 필터의 데이터 기반 노출로 숨겨짐). **KR 리전 egress
//    (운영 크론)에서 실행하면 정상 수집**된다.
// 표지 호스트: catalog.controller COVER_ALLOWED_HOST 에 comico.kr 로 등록(실데이터 확인 후 정밀 조정).
import {
  fetchText,
  extractNextData,
  deepCollect,
  mapGenres,
  coverGradient,
  coverProxy,
  estimateStats,
  norm,
  cleanTitle,
  mapAge,
  sleep,
} from "./_shared.mjs";

const PREFIX = "cm";
const PLATFORM_ID = "comico";
const PLATFORM_NM = "코미코";
const ORIGIN = "https://www.comico.kr";

// robots 허용 공개 목록 페이지(요일/장르/랭킹/무료/신작/완결). 장르 키는 사이트 구조에 맞춰 베스트에포트.
const PATHS = [
  "/webtoon/index",
  "/webtoon/ranking",
  "/webtoon/free",
  "/webtoon/update",
  "/webtoon/recommend",
  "/webtoon/finish",
  "/webtoon/genre/romance",
  "/webtoon/genre/drama",
  "/webtoon/genre/fantasy",
  "/webtoon/genre/action",
  "/webtoon/genre/comic",
  "/webtoon/genre/thriller",
  "/webtoon/genre/daily",
  "/webtoon/genre/bl",
];

// __NEXT_DATA__ 의 작품 객체는 사이트 버전에 따라 필드명이 다를 수 있어 방어적으로 후보 키를 본다.
const IMG_KEYS = [
  "thumbnailImageUrl", "thumbnailUrl", "thumbnail", "mainImageUrl", "listImageUrl",
  "portraitImageUrl", "featuredCharacterImageUrl", "squareImageUrl", "image", "imageUrl",
];
const EP_KEYS = ["episodeNo", "chapterNo", "articleNo", "episodeId", "chapterId"];
const ID_KEYS = ["id", "titleNo", "titleId", "contentId", "comicId"];
const NAME_KEYS = ["title", "name", "titleName", "comicTitle"];

function firstString(obj, keys) {
  for (const k of keys) if (typeof obj[k] === "string" && obj[k].trim()) return obj[k].trim();
  return undefined;
}
function firstVal(obj, keys) {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}
function absUrl(u) {
  if (typeof u !== "string") return undefined;
  const s = u.trim();
  if (/^https:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return "https:" + s;
  if (/^http:\/\//i.test(s)) return "https://" + s.slice(7);
  return undefined; // 상대경로는 호스트 불명 → 그라디언트 폴백
}
function parseYear(obj) {
  const raw = String(firstVal(obj, ["publishedAt", "firstPublishedAt", "createdAt", "openDate", "regDt"]) ?? "");
  const m = raw.match(/(19|20)\d{2}/);
  const y = m ? Number(m[0]) : 0;
  return y >= 1990 && y <= 2030 ? y : 2023;
}

function looksLikeTitle(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const id = firstVal(obj, ID_KEYS);
  const name = firstString(obj, NAME_KEYS);
  if (id == null || !name) return false;
  if (EP_KEYS.some((k) => obj[k] != null)) return false; // 회차 객체 제외
  if (!firstString(obj, IMG_KEYS)) return false; // 표지 없는 메뉴/배너 객체 제외
  return /^[A-Za-z0-9_-]+$/.test(String(id));
}

function buildRow(obj, rank) { // NOSONAR javascript:S3776
  const id = String(firstVal(obj, ID_KEYS));
  const rawTitle = cleanTitle(firstString(obj, NAME_KEYS) ?? "");
  if (!rawTitle) return null;

  const author =
    cleanTitle(
      obj.author ??
        obj.artistName ??
        (Array.isArray(obj.artists) ? obj.artists.map((a) => a?.name || a).filter(Boolean).join(", ") : "")
    ) || "미상";

  const genreHints = [
    rawTitle, obj.genre, obj.genreName, obj.category, obj.categoryName,
    ...(Array.isArray(obj.genres) ? obj.genres : []),
    ...(Array.isArray(obj.tags) ? obj.tags : []),
  ]
    .map((g) => (typeof g === "string" ? g : g?.name))
    .filter(Boolean);
  const genres = mapGenres(genreHints, "드라마");

  const adult =
    obj.adult === true || obj.isAdult === true || /19/.test(String(obj.ageGrade ?? obj.ageRating ?? ""));
  const finished =
    obj.completed === true || obj.isComplete === true || /완결|finish/i.test(String(obj.status ?? obj.serialStatus ?? ""));
  const realCover = absUrl(firstString(obj, IMG_KEYS));

  const xid = `${PREFIX}-${id}`;
  return {
    _normTitle: norm(rawTitle),
    id: xid,
    slug: xid,
    type: "webtoon",
    title: rawTitle,
    author,
    genres,
    tags: [],
    synopsis:
      cleanTitle(obj.synopsis ?? obj.description ?? obj.summary ?? "") ||
      `${rawTitle} · ${PLATFORM_NM} 공개 카탈로그 수집작.`,
    cover: coverGradient(id, genres),
    coverImage: coverProxy(realCover),
    status: finished ? "completed" : "ongoing",
    ageRating: mapAge(adult),
    releaseYear: parseYear(obj),
    availability: [{ platformId: PLATFORM_ID, pricing: "free", url: `${ORIGIN}/titles/${id}` }],
    stats: estimateStats({ seed: xid, rank, finished }),
    featured: false,
  };
}

export async function crawl() { // NOSONAR javascript:S3776
  const byId = new Map();
  for (let i = 0; i < PATHS.length; i++) {
    const html = await fetchText(`${ORIGIN}${PATHS[i]}`, { referer: `${ORIGIN}/` });
    if (!html) {
      // 첫 요청부터 실패하면 지오펜스/도달불가로 보고 즉시 종료(타임아웃 1회만 소비, 전체 크롤 지연 방지).
      // KR egress 라면 첫 요청이 성공하므로 이 분기를 타지 않는다.
      if (i === 0) break;
      continue;
    }
    const data = extractNextData(html);
    if (data) {
      for (const obj of deepCollect(data, looksLikeTitle, 4000)) {
        const id = String(firstVal(obj, ID_KEYS));
        if (byId.has(id)) continue;
        const row = buildRow(obj, byId.size + 1);
        if (row) byId.set(id, row);
      }
    }
    if (i < PATHS.length - 1) await sleep(400);
  }
  return [...byId.values()];
}
