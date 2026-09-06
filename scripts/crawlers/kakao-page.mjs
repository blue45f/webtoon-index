// kakao-page 크롤러 — 카카오페이지 공개 카탈로그(HTML __NEXT_DATA__) 수집.
// 출처: https://page.kakao.com/ (홈, 데스크톱 UA) + /menu/<tab>/screen/<screen> 장르/랭킹 랜딩 + /content/<seriesId> 상세 페이지.
//   - robots.txt 는 /viewer* 만 disallow. 홈/장르 랜딩/상세 페이지는 허용. (/api, /graphql 딥라우트는 미사용)
//   - 홈 __NEXT_DATA__ 의 배너(metaList)·랭킹(subtitleList) 리스트 + 4개 탭(추천/웹툰/웹소설/책)의 장르·랭킹
//     screen 랜딩 페이지(SSR __NEXT_DATA__)에서 시리즈를 모으고(seriesId 기준 dedupe),
//     각 시리즈의 /content/<id> 상세 페이지에서 실제 작가/장르/줄거리/연재상태/연령/연재요일을 보강한다(상한 내).
//   - 표지(dn-img-page.kakao.com, 확장자 없음)는 coverProxy 로 /api/cover 프록시 URL 화(프록시가 바이트 스니핑).

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
  stripTags,
  mapAge,
  sleep,
} from "./_shared.mjs";

const PLATFORM_ID = "kakao-page";
const PREFIX = "kp";
const PLATFORM_NAME = "카카오페이지";
const ORIGIN = "https://page.kakao.com";
const HOME = ORIGIN + "/";

// 홈을 여러 번 호출하면 랭킹/지금핫한 섹션이 회전하여 더 많은 시리즈가 노출된다(서버 페이지네이션 없음).
const HOME_FETCHES = 4;
// 상세 페이지 보강 호출 상한(요청량 절제). 상한 초과 시 리스트 메타만으로 row 를 만든다.
const MAX_DETAIL = 220;

// 메인 4개 탭(menuUid)과 그 하위 장르/랭킹 screen 랜딩 페이지(screenUid).
// 각 /menu/<tab>/screen/<screen> 는 SSR __NEXT_DATA__ 안에 해당 장르/랭킹의 실제 시리즈 리스트(PosterView/RankingPosterView)를 담고 있다.
// screen 타이틀 끝의 한글 키워드(로판/무협/판타지…)는 장르 힌트로 함께 매핑한다.
const TAB_SCREENS = {
  10000: ["46", "47", "48", "50", "81", "87", "88", "89", "102", "103"], // 추천
  10010: ["54", "55", "56", "57", "58", "59", "60", "61", "62", "82", "83", "86", "104"], // 웹툰
  10011: ["63", "64", "68", "70", "73", "74", "76", "84", "85", "90", "91", "92", "94", "101", "105", "181"], // 웹소설
  10016: ["78", "79", "80"], // 책
};

// screen 메타 타이틀(예: "웹소설 - 무협", "웹툰 - 로판") 끝 토큰을 장르 힌트로. 비-장르 토큰은 버린다.
const NON_GENRE_SCREEN_TOKENS = new Set([
  "지금핫한", "장르전체", "분류전체", "완전판", "연재무료", "단행본", "만화",
  "여성인기", "남성인기", "완결추천", "브랜드", "랭킹", "실시간 랭킹", "요일", "오늘신작", "TV속 작품", "만화 랭킹",
]);
function genreHintFromScreenTitle(title) {
  const tail = String(title || "").split("-").pop()?.trim();
  if (!tail || NON_GENRE_SCREEN_TOKENS.has(tail)) return undefined;
  return tail;
}

// 홈 __NEXT_DATA__ 의 리스트 아이템(배너 metaList / 랭킹 subtitleList 모두 포함)인지 판정.
function isListItem(o) {
  return (
    o &&
    o.seriesId &&
    typeof o.title === "string" &&
    typeof o.thumbnail === "string" &&
    o.thumbnail &&
    (Array.isArray(o.metaList) || Array.isArray(o.subtitleList))
  );
}

// "//dn-img-page.kakao.com/..." → "https://..."  (확장자 없는 th3 URL — 그대로 동작)
function absThumb(thumb) {
  if (typeof thumb !== "string" || !thumb) return undefined;
  const t = thumb.trim();
  if (t.startsWith("//")) return "https:" + t;
  if (/^https?:\/\//i.test(t)) return t.replace(/^http:/, "https:");
  return undefined;
}

// metaList / subtitleList 의 첫 요소("웹소설"|"웹툰")로 타입 판정.
function typeFromMeta(metaArr) {
  const first = Array.isArray(metaArr) ? String(metaArr[0] || "") : "";
  if (first.includes("웹소설")) return "webnovel";
  if (first.includes("웹툰")) return "webtoon";
  return null;
}

// 상세 페이지 categoryType(Webnovel|Webtoon) → 타입.
function typeFromCategory(categoryType, category) {
  const c = String(categoryType || category || "");
  return /novel|소설/i.test(c) ? "webnovel" : "webtoon";
}

// onIssue / state 코드 → 연재 상태.
function mapStatus(onIssue) {
  const s = String(onIssue || "");
  if (/end|완결|complete/i.test(s)) return "completed";
  if (/rest|휴재|hiatus|pause/i.test(s)) return "hiatus";
  return "ongoing"; // "Ing" 등
}

// bm / isAllFree / isWaitfree → availability pricing.
function mapPricing({ isAllFree, isWaitfree, bm }) {
  if (isAllFree) return "free";
  if (isWaitfree || /waitfree/i.test(String(bm || ""))) return "wait-free";
  return "wait-free"; // 카카오페이지 기본은 기다리면 무료
}

const DAY_SET = new Set(["월", "화", "수", "목", "금", "토", "일"]);
// pubPeriod 문자열(예: "화", "월,목") → ["화"] / ["월","목"]
function parsePubPeriod(pubPeriod) {
  if (!pubPeriod) return undefined;
  const days = String(pubPeriod)
    .split(/[,\s/·]+/)
    .map((d) => d.replace(/요일$/, "").trim())
    .filter((d) => DAY_SET.has(d));
  return days.length ? [...new Set(days)] : undefined;
}

// 한 HTML 의 __NEXT_DATA__ 에서 리스트 아이템을 모아 bySeries 맵에 누적(먼저 본 것 우선, 장르 힌트 보존).
function accumulateItems(html, bySeries, genreHint) {
  const data = html && extractNextData(html);
  if (!data) return;
  const items = deepCollect(data, isListItem);
  for (const it of items) {
    if (!bySeries.has(it.seriesId)) {
      bySeries.set(it.seriesId, genreHint ? { ...it, _genreHint: genreHint } : it);
    } else if (genreHint) {
      const cur = bySeries.get(it.seriesId);
      if (!cur._genreHint) cur._genreHint = genreHint;
    }
  }
}

// 홈을 여러 번 호출하면 랭킹/지금핫한 섹션이 회전하여 더 많은 시리즈가 노출된다(서버 페이지네이션 없음).
async function collectHomeItems(bySeries) {
  for (let i = 0; i < HOME_FETCHES; i++) {
    const html = await fetchText(HOME + (i ? `?_=${Date.now()}${i}` : ""), {
      referer: ORIGIN,
      headers: { "Cache-Control": "no-cache" },
    });
    accumulateItems(html, bySeries);
    if (i < HOME_FETCHES - 1) await sleep(400);
  }
}

// 각 탭의 장르/랭킹 screen 랜딩 페이지(SSR __NEXT_DATA__)에서 시리즈 리스트를 모은다.
async function collectScreenItems(bySeries) { // NOSONAR javascript:S3776
  for (const [tab, screens] of Object.entries(TAB_SCREENS)) {
    const tabRef = `${ORIGIN}/menu/${tab}`;
    for (const screen of screens) {
      const html = await fetchText(`${ORIGIN}/menu/${tab}/screen/${screen}`, { referer: tabRef });
      const data = html && extractNextData(html);
      if (data) {
        const title = data?.props?.pageProps?.initialProps?.metaInfo?.title;
        const items = deepCollect(data, isListItem);
        const hint = genreHintFromScreenTitle(title);
        for (const it of items) {
          if (!bySeries.has(it.seriesId)) {
            bySeries.set(it.seriesId, hint ? { ...it, _genreHint: hint } : it);
          } else if (hint && !bySeries.get(it.seriesId)._genreHint) {
            bySeries.get(it.seriesId)._genreHint = hint;
          }
        }
      }
      await sleep(150);
    }
  }
}

// 홈 + 모든 탭의 screen 랜딩에서 시리즈 리스트 아이템을 dedupe(seriesId 기준)하여 반환.
async function collectListItems() {
  const bySeries = new Map();
  await collectHomeItems(bySeries);
  await collectScreenItems(bySeries);
  return [...bySeries.values()];
}

// /content/<seriesId> 상세 페이지에서 해당 시리즈의 메타 객체(작가/장르/줄거리/상태)를 추출.
async function fetchDetailMeta(seriesId) {
  const html = await fetchText(`${ORIGIN}/content/${seriesId}`, { referer: HOME });
  const data = html && extractNextData(html);
  if (!data) return null;
  // authors+category 를 가진 콘텐츠 메타 객체들. 같은 seriesId 우선, 없으면 첫 객체.
  const metas = deepCollect(
    data,
    (o) => o && o.seriesId && typeof o.title === "string" && o.authors != null && o.category != null,
  );
  if (!metas.length) return null;
  return metas.find((m) => m.seriesId === seriesId) || metas[0];
}

export async function crawl() { // NOSONAR javascript:S3776
  const listItems = await collectListItems();
  if (!listItems.length) return [];

  const rows = [];
  const seen = new Set();
  let detailCalls = 0;

  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];
    const workId = item.seriesId;
    if (seen.has(workId)) continue;
    seen.add(workId);

    const rawTitle = stripTags(String(item.title || "").replace(/[\r\n]+/g, " "));
    if (!rawTitle) continue;

    const metaArr = Array.isArray(item.metaList) ? item.metaList : item.subtitleList;
    const listType = typeFromMeta(metaArr);
    // metaList[1] 후보 장르(배너 아이템) — 랭킹 아이템엔 없을 수 있음.
    const listGenre = Array.isArray(item.metaList) ? item.metaList[1] : undefined;
    const listAdult = item.ageGrade === "Nineteen" || item.selfCensorship === true;

    // 상세 페이지 보강(상한 내에서).
    let detail = null;
    if (detailCalls < MAX_DETAIL) {
      detailCalls++;
      detail = await fetchDetailMeta(workId);
      await sleep(250);
    }

    // 타입: metaList/subtitleList 우선, 없으면 상세 categoryType.
    const type =
      listType || (detail ? typeFromCategory(detail.categoryType, detail.category) : "webtoon");

    const author = (detail && String(detail.authors || "").trim()) || "미상";
    // category(웹툰/웹소설)는 장르가 아니므로 subcategory + listGenre + screen 장르 힌트만 장르 매핑에 사용.
    const genreCandidates = [
      detail && detail.subcategory,
      listGenre,
      item._genreHint,
      ...(metaArr || []),
    ].filter(Boolean);
    const fallbackGenre = type === "webnovel" ? "판타지" : "드라마";
    const genres = mapGenres(genreCandidates, fallbackGenre);

    const adult = (detail && detail.ageGrade === "Nineteen") || listAdult;
    const status = mapStatus(detail && detail.onIssue);
    const pricing = mapPricing({
      isAllFree: detail && detail.isAllFree,
      isWaitfree: detail && detail.isWaitfree,
      bm: detail && detail.bm,
    });

    let releaseYear = 2023;
    if (detail && detail.startSaleDt) {
      const y = new Date(detail.startSaleDt).getFullYear();
      if (Number.isFinite(y) && y >= 2000 && y <= 2030) releaseYear = y;
    }

    const updateDays = parsePubPeriod(detail && detail.pubPeriod);

    // 표지: 홈 리스트의 dn-img-page th3 URL 우선(allowlist 호스트, 확장자 없음). 없으면 상세 thumbnail.
    const rawCover = absThumb(item.thumbnail || (detail && detail.thumbnail));

    const synopsisRaw = detail && detail.description ? stripTags(detail.description) : "";
    const synopsis = synopsisRaw || `${rawTitle} · ${PLATFORM_NAME} 공개 카탈로그 수집작.`;

    // 태그: 카테고리/서브카테고리/screen 장르 힌트/메타 텍스트 중 짧은 한글 토큰.
    const tagPool = [detail && detail.category, detail && detail.subcategory, item._genreHint, listGenre, ...(metaArr || [])]
      .filter(Boolean)
      .map((s) => String(s).trim())
      .filter((s) => s && s.length <= 8 && !/^\d+(\.\d+)?[만억]?$/.test(s));
    const tags = [...new Set(tagPool)].slice(0, 6);

    const id = `${PREFIX}-${workId}`;
    const workUrl = `${ORIGIN}/content/${workId}`;
    const title = cleanTitle(rawTitle);

    const row = {
      _normTitle: norm(title),
      id,
      slug: `${PREFIX}-${workId}`,
      type,
      title,
      author,
      genres,
      tags,
      synopsis,
      cover: coverGradient(workId, genres),
      coverImage: coverProxy(rawCover),
      status,
      ageRating: mapAge(adult),
      releaseYear,
      availability: [{ platformId: PLATFORM_ID, pricing, url: workUrl }],
      stats: estimateStats({
        seed: id,
        rank: i + 1,
        finished: status === "completed",
      }),
      featured: false,
    };
    if (updateDays) row.updateDays = updateDays;

    rows.push(row);
  }

  return rows;
}
