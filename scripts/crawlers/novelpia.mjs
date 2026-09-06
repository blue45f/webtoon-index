// novelpia (노벨피아) 웹소설 크롤러.
// 소스: 공개 검색 API GET /proc/novelsearch_v2/ (SPA Vue 컴포넌트가 호출하는 동일 엔드포인트).
//       응답: { status:200, novel_search:{ total_cnt, list:[{ novel_name, novel_no, writer_nick,
//       novel_story, novel_thumb_all, novel_img_all, ... }] } }. 로그인/성인인증 없이 일반작 메타가 내려온다.
// 표지 host: images.novelpia.com (사이트 파비콘/이미지와 동일 호스트). 상대경로 /imagebox/cover/...
//       앞에 https://images.novelpia.com 을 붙이면 원본 표지가 그대로 열린다.
// 전략: 검색은 제목 부분일치 → 흔한 한글 키워드/장르어 다수로 질의하고 novel_no 로 dedupe 하여 카탈로그를 채운다.
//       각 키워드는 폴백 장르를 함께 들고 다닌다(장르 필드가 없어 제목+줄거리+폴백으로 매핑).
//       성인 우회 없음: 검색 결과에 그대로 노출되는 공개 메타만 사용하고, 성인 표지도 공개 썸네일 URL을 그대로 통과시킨다.
import {
  fetchJson,
  mapGenres,
  coverGradient,
  coverProxy,
  estimateStats,
  norm,
  cleanTitle,
  mapAge,
  sleep,
  stripTags,
} from "./_shared.mjs";

const PREFIX = "np";
const PLATFORM_ID = "novelpia";
const PLATFORM_NM = "노벨피아";
const ORIGIN = "https://novelpia.com";
// 실제 표지 호스트(상대경로 novel_thumb_all/novel_img_all 앞에 붙인다).
const COVER_HOST = "https://images.novelpia.com";

// 검색 키워드 → 폴백 장르(한글). 노벨피아 검색은 제목 부분일치라서, 장르/소재 단어와
// 흔한 조사/형용사 단어를 섞어 폭넓게 긁고 novel_no 로 dedupe 한다. (일반작 위주, 성인 우회 없음)
const QUERIES = [
  // 장르/소재 중심 — 키워드당 50건씩 긁어 novel_no 로 dedupe. 부분일치라 키워드 하나로도 수십 건.
  ["회귀", "판타지"],
  ["환생", "판타지"],
  ["빙의", "판타지"],
  ["이세계", "판타지"],
  ["헌터", "현판"],
  ["랭커", "게임판타지"],
  ["던전", "게임판타지"],
  ["마법", "판타지"],
  ["용사", "판타지"],
  ["악역", "로판"],
  ["영애", "로판"],
  ["황녀", "로판"],
  ["로맨스", "로맨스"],
  ["계약", "로맨스"],
  ["무협", "무협"],
  ["무림", "무협"],
  ["천재", "드라마"],
  ["복수", "스릴러"],
  ["추리", "미스터리"],
  ["학원", "학원"],
];

// novel_thumb_all → novel_img_all 순으로 실제 표지 상대경로를 고른 뒤 절대 URL 로.
function resolveCover(item) {
  const rel = String(item.novel_thumb_all || item.novel_img_all || "").trim();
  if (!rel || !rel.startsWith("/")) return undefined;
  return COVER_HOST + rel;
}

// 줄거리 정리: 태그 제거 + 공백 정규화. 비면 기본 문구.
function buildSynopsis(rawTitle, story) {
  const s = stripTags(story);
  if (s && s.length >= 4) return s.slice(0, 400);
  return `${rawTitle} · ${PLATFORM_NM} 공개 카탈로그 수집작.`;
}

function buildRow(item, fallbackGenre, rank) {
  const workId = String(item.novel_no || "").trim();
  if (!workId) return null;
  const rawTitle = cleanTitle(item.novel_name || "");
  if (!rawTitle) return null;

  const author = String(item.writer_nick || item.mem_nick || "").trim() || "미상";

  // 장르: 제목 + 줄거리 + 폴백 으로 정규 장르 매핑(검색 응답에 장르 필드가 없음).
  const story = String(item.novel_story || "");
  const genres = mapGenres([rawTitle, story, fallbackGenre], fallbackGenre || "판타지");

  // 태그: 폴백 장르 + 2차창작 여부 등 짧은 메타.
  const tags = [
    fallbackGenre,
    Number(item.is_secondary_creation) === 1 ? "2차창작" : null,
    "노벨피아",
  ]
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const realCoverUrl = resolveCover(item);

  const id = `${PREFIX}-${workId}`;
  const workUrl = `${ORIGIN}/novel/${workId}`;

  // 검색 응답엔 연재상태/연령 필드가 없다 → 보수적으로 연재중/전체이용가 기본값.
  const status = "ongoing";

  const row = {
    _normTitle: norm(rawTitle),
    id,
    slug: id,
    type: "webnovel",
    title: rawTitle,
    author,
    genres,
    tags,
    synopsis: buildSynopsis(rawTitle, story),
    cover: coverGradient(workId, genres),
    coverImage: coverProxy(realCoverUrl),
    status,
    ageRating: mapAge(false),
    releaseYear: 2023,
    availability: [{ platformId: PLATFORM_ID, pricing: "free", url: workUrl }],
    stats: estimateStats({
      seed: id,
      rank,
      finished: status === "completed",
    }),
    featured: false,
  };

  return row;
}

export async function crawl() { // NOSONAR javascript:S3776
  const byWorkId = new Map();
  const ROWS = 90; // 키워드당 한 페이지로 90건 (dedupe 후 커버리지 ↑).

  for (let i = 0; i < QUERIES.length; i++) {
    const [word, fallbackGenre] = QUERIES[i];
    const url =
      `${ORIGIN}/proc/novelsearch_v2/` +
      `?search_text=${encodeURIComponent(word)}&page=1&rows=${ROWS}`;
    const data = await fetchJson(url, { referer: `${ORIGIN}/` });
    const list = data?.novel_search?.list;
    if (Array.isArray(list)) {
      for (const item of list) {
        const workId = String(item?.novel_no || "").trim();
        if (!workId || byWorkId.has(workId)) continue; // dedupe by novel_no
        const rank = byWorkId.size + 1; // 발견 순서 기반 rank 시드.
        const row = buildRow(item, fallbackGenre, rank);
        if (row) byWorkId.set(workId, row);
      }
    }
    if (i < QUERIES.length - 1) await sleep(380); // 요청 간 간격.
  }

  return [...byWorkId.values()];
}
