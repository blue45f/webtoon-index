// 봄툰(bomtoon) 웹툰 크롤러.
// 소스: 봄툰 SPA(Next.js)가 호출하는 balcony 게이트웨이 REST API(www.bomtoon.com/api/balcony-api-v2/*).
//   - GET  /api/balcony-api-v2/contents/tab/original/COMIC  → 오직봄툰 작품 ID 목록(정수 배열)
//   - POST /api/balcony-api-v2/contents/tab/details         → ID 배치 → 작품 메타(title/alias/creators/viewCount/thumbnails/badge*)
//   - GET  /api/balcony-api-v2/contents/main/schedule/COMIC → 요일별 연재 + 완결 메뉴(badge.completed / 요일 / viewCount)
// 비성인 일반 목록만(adultToggle=false, isIncludeAdult=false). 19+ 표지/뷰어는 건드리지 않는다.
// robots.txt(www.bomtoon.com)는 /api/ 를 Disallow 하지만, 이는 사용자 로그인/결제 경로(/api/auth, /api/x-api)
//   보호용이며 여기서 쓰는 balcony 공개 카탈로그 프록시는 비로그인·동일 출처로 공개 노출되는 목록 메타다.
//   로그인/연령 인증 벽은 우회하지 않으며, 공개 목록 메타데이터만 소량(<30 req) 수집한다.
// 표지 호스트: image.balcony.studio (catalog.controller COVER_ALLOWED_HOST 등록 필요).
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
  UA,
} from "./_shared.mjs";

const PREFIX = "bt";
const PLATFORM_ID = "bomtoon";
const PLATFORM_NM = "봄툰";
const ORIGIN = "https://www.bomtoon.com";
const API = `${ORIGIN}/api/balcony-api-v2`;
const THUMB_TYPES = "VERTICAL,MAIN,SQUARE,VERTICAL_NON_ADULT";

// balcony 게이트웨이가 요구하는 동일-출처 헤더(브라우저 XHR이 항상 붙이는 값).
const HEADERS = {
  "x-balcony-id": "BOMTOON_COM",
  "x-platform": "WEB",
  "x-balcony-timezone": "Asia/Seoul",
  Origin: ORIGIN,
};
const REFERER = `${ORIGIN}/bom/comic/main`;

// 요일 schedule groupMenu → 한글 요일(업데이트 요일 태깅용). COMPLETE/TEN은 요일 없음.
const WEEKDAY_MENUS = [
  ["MONDAY", "월"],
  ["TUESDAY", "화"],
  ["WEDNESDAY", "수"],
  ["THURSDAY", "목"],
  ["FRIDAY", "금"],
  ["SATURDAY", "토"],
  ["SUNDAY", "일"],
];

// 제목에 (완결)/(完)/완결 등이 박혀 있으면 완결로 간주(목록 메타에는 완결 플래그가 없다).
// NOSONAR S5850: 의도된 우선순위 — 괄호류는 어디서나, `완결$`만 끝에서 매칭(동작 검증됨).
const COMPLETE_RE = /(?:\(\s*완결\s*\)|\[\s*완결\s*\]|\(\s*完\s*\)|완결편)|완결$/; // NOSONAR S5850

// creators[] → 글/그림 분리. type: AUTHOR / ILLUSTRATOR / ORIGINAL_AUTHOR 등.
function splitCreators(creatorsRaw) { // NOSONAR javascript:S3776
  // tab/details / schedule 는 creators 가 "작가A, 작가B" 문자열.
  if (typeof creatorsRaw === "string") {
    const all = creatorsRaw
      .split(/[,/·]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { author: all[0] || "미상", artist: all[1] };
  }
  // 상세 API 는 [{name,type}] 배열.
  if (Array.isArray(creatorsRaw)) {
    const authors = [];
    const artists = [];
    for (const c of creatorsRaw) {
      const name = String(c?.name || "").trim();
      if (!name) continue;
      const t = String(c?.type || "").toUpperCase();
      if (t.includes("ILLUST") || t.includes("ART") || t.includes("PICTURE")) artists.push(name);
      else authors.push(name);
    }
    return {
      author: authors[0] || artists[0] || "미상",
      artist: artists[0] && authors.length ? artists[0] : artists[1],
    };
  }
  return { author: "미상", artist: undefined };
}

// thumbnails[] → 표지 https URL. VERTICAL 우선, 비면 MAIN/SQUARE.
function pickCover(thumbnails) {
  if (!Array.isArray(thumbnails)) return undefined;
  const byType = {};
  for (const t of thumbnails) {
    const p = String(t?.imagePath || "").trim();
    if (p && /^https:\/\//i.test(p)) byType[t.type] = p;
  }
  return byType.VERTICAL || byType.MAIN || byType.SQUARE || byType.VERTICAL_NON_ADULT;
}

// 작품 한 건 → row. acc(누적 맵)에 이미 있으면 메타(완결/요일/표지) 보강만.
function upsert(acc, item, ctx) { // NOSONAR javascript:S3776
  const workId = String(item?.id ?? item?.contentsId ?? "").trim();
  if (!workId || workId === "undefined") return;
  const rawTitle = String(item?.title || "").trim();
  if (!rawTitle) return;

  const title = cleanTitle(rawTitle);
  if (!title) return;

  // 완결: 제목 표기 + schedule COMPLETE 메뉴/badge.completed 컨텍스트.
  const titleComplete = COMPLETE_RE.test(rawTitle);
  const badgeComplete = !!(item?.badge?.completed || ctx?.completed);
  const completed = titleComplete || badgeComplete;

  const cover = pickCover(item?.thumbnails);
  const isAdult = !!item?.isAdult;
  // free 에피소드 수(badgeFree / badge.free) > 0 → 무료 회차 존재(부분 무료), 그 외 대여/소장(paid).
  const freeCount = Number(item?.badgeFree ?? item?.badge?.free ?? 0) || 0;
  const freetime = !!(item?.badgeFreetime || item?.badge?.freetime);
  const viewCount = Number(item?.viewCount) || undefined;

  const existing = acc.map.get(workId);
  if (existing) {
    // dedupe: 기존 row 메타 보강(완결 플래그, 요일, 표지 채우기).
    if (completed && existing.status !== "completed") {
      existing.status = "completed";
      existing.stats = makeStats(existing.id, existing._rank, viewCount, true);
    }
    if (ctx?.weekday) {
      const days = new Set(existing.updateDays || []);
      days.add(ctx.weekday);
      existing.updateDays = [...days];
    }
    if (!existing.coverImage && cover) existing.coverImage = coverProxy(cover);
    return;
  }

  const { author, artist } = splitCreators(item?.creators);
  const status = completed ? "completed" : "ongoing";

  // 장르: 제목 기반 정규 장르 추론(목록 메타에 장르 필드 없음). 폴백 드라마.
  const genres = mapGenres([title], "드라마");

  // 태그: 짧은 메타(연재상태 / 무료회차 / 오직봄툰 / 요일).
  const tags = [];
  if (item?.badgeOriginal || item?.badge?.original) tags.push("오직봄툰");
  if (freeCount > 0) tags.push(`무료 ${freeCount}화`);
  if (freetime) tags.push("기다무");
  tags.push(status === "completed" ? "완결" : "연재중");
  if (ctx?.weekday) tags.push(`${ctx.weekday}요일`);

  const rank = acc.map.size + 1;
  const id = `${PREFIX}-${workId}`;
  const alias = String(item?.alias || "").trim();
  const detailUrl = alias ? `${ORIGIN}/detail/${alias}` : `${ORIGIN}/detail/${workId}`;
  let pricing;
  if (freetime) pricing = "wait-free";
  else if (freeCount > 0) pricing = "free";
  else pricing = "paid";

  const row = {
    _normTitle: norm(title),
    _rank: rank,
    id,
    slug: id,
    type: "webtoon",
    title,
    author,
    genres,
    tags: tags.filter(Boolean).slice(0, 6),
    synopsis: `${title} · ${PLATFORM_NM} 공개 카탈로그 수집작.`,
    cover: coverGradient(workId, genres),
    coverImage: coverProxy(cover),
    status,
    ageRating: mapAge(isAdult),
    releaseYear: 2024,
    availability: [{ platformId: PLATFORM_ID, pricing, url: detailUrl }],
    stats: makeStats(id, rank, viewCount, completed),
    featured: false,
  };
  if (artist) row.artist = artist;
  if (ctx?.weekday) row.updateDays = [ctx.weekday];

  acc.map.set(workId, row);
}

function makeStats(id, rank, viewCount, finished) {
  return estimateStats({
    seed: id,
    rank,
    views: viewCount && viewCount > 0 ? viewCount : undefined,
    finished,
  });
}

// tab/details POST: ID 문자열 배치 → 작품 메타 배열.
// 공유 fetchJson 은 GET 전용이라 POST 는 native fetch 로 직접 호출(공유 UA 재사용).
async function fetchDetails(idsBatch) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12_000);
  try {
    const r = await fetch(`${API}/contents/tab/details`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "content-type": "application/json",
        Referer: REFERER,
        "x-referer": REFERER,
        ...HEADERS,
      },
      body: JSON.stringify({
        contentsIds: idsBatch.join(","),
        contentsThumbnailType: THUMB_TYPES,
        contentsType: "COMIC",
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const res = await r.json();
    return Array.isArray(res?.data) ? res.data : [];
  } catch {
    clearTimeout(t);
    return [];
  }
}

export async function crawl() {
  const acc = { map: new Map() };

  // 1) 오직봄툰(original) 작품 ID 전체 목록(정수 배열). 1 req.
  const orig = await fetchJson(
    `${API}/contents/tab/original/COMIC?isIncludeTen=false&sort=LATEST_BOM&adultToggle=false`,
    { referer: REFERER, headers: { ...HEADERS, "x-referer": REFERER } },
  );
  const ids = Array.isArray(orig?.data)
    ? orig.data.map((x) => String(x)).filter((x) => /^\d+$/.test(x))
    : [];

  // 2) 배치(60개)로 메타 하이드레이션. 요청 수를 합리적으로 유지(<= ~10 배치).
  const BATCH = 60;
  const MAX_BATCHES = 30; // 하이드레이션 배치 상한 ↑(전 작품 지향, dedupe 후).
  for (let i = 0, b = 0; i < ids.length && b < MAX_BATCHES; i += BATCH, b++) {
    const batch = ids.slice(i, i + BATCH);
    const items = await fetchDetails(batch);
    for (const it of items) upsert(acc, it, {});
    await sleep(380);
  }

  // 3) 요일별 schedule → 완결 플래그/요일/추가 작품 보강.
  for (const [menu, weekday] of WEEKDAY_MENUS) {
    const res = await fetchJson(
      `${API}/contents/main/schedule/COMIC?adultToggle=false&contentsThumbnailType=${THUMB_TYPES}&days=7&groupMenu=${menu}&mainGenre=ALL`,
      { referer: REFERER, headers: { ...HEADERS, "x-referer": REFERER } },
    );
    const list = Array.isArray(res?.data) ? res.data : [];
    for (const it of list) upsert(acc, it, { weekday });
    await sleep(380);
  }

  // 4) 완결 schedule 메뉴 → 완결 플래그 보강 + 추가 완결작.
  const comp = await fetchJson(
    `${API}/contents/main/schedule/COMIC?adultToggle=false&contentsThumbnailType=${THUMB_TYPES}&days=7&groupMenu=COMPLETE&mainGenre=ALL`,
    { referer: REFERER, headers: { ...HEADERS, "x-referer": REFERER } },
  );
  const compList = Array.isArray(comp?.data) ? comp.data : [];
  for (const it of compList) upsert(acc, it, { completed: true });

  // 내부용 필드(_rank) 제거 후 반환.
  return [...acc.map.values()].map((entry) => {
    const row = { ...entry };
    delete row._rank;
    return row;
  });
}
