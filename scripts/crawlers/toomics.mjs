// toomics (투믹스) 웹툰 크롤러.
// 소스: https://www.toomics.com 의 공개 웹툰 목록 HTML(/webtoon/...).
//   - /webtoon/top100/genre/<code>            장르별 랭킹 그리드(page/2 까지 신규)
//   - /webtoon/top100/type/<famous|monthly|newest|weekly>   기간/랭킹 그리드
//   - /webtoon/weekly/dow/<1..7>              요일별 연재 그리드
//   - /webtoon/toon_list/display/G2           신작 그리드(page/2)
//   - /webtoon/finish/all                     완결 그리드
// robots.txt: user-agent:* 에 대해 allow:/ (disallow 는 /popular/move_toon/*,
//   /mypage/charge/* 와 비-한국어 로케일 프리픽스뿐). 위 /webtoon/* 목록은 허용.
// 카드 구조(모든 그리드 공통): <a href="/webtoon/bridge/type/2/toon/<id>" class="toon ...">
//   안에 data-original(실표지, host=thumb.toomics.com) · alt(제목) ·
//   strong.toon__title(제목) · toon-dcard__subtitle("123화(완) · <장르>") ·
//   i.sp-icon__l-waitingfree(기다리면 무료) 등.
// 작가/성인(19+) 메타는 공개 목록 카드에 노출되지 않는다(로그인·연령인증 벽 안).
//   age 벽을 우회하지 않으므로 author="미상", ageRating="all"(공개 목록 범위)로 둔다.
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
  stripTags,
} from "./_shared.mjs";

const PREFIX = "tm";
const PLATFORM_ID = "toomics";
const PLATFORM_NM = "투믹스";
const ORIGIN = "https://www.toomics.com";
// 실제 표지 호스트(카드의 data-original 절대 URL). 크로스체크용 allowlist 등록 대상.
const COVER_HOST = "thumb.toomics.com";

// 장르 그리드 코드 → 폴백 장르(한글, _shared 정규 집합으로 매핑됨).
// (top100/genre/<code> 의 nav 라벨에서 확인)
const GENRES = [
  ["1066", "판타지"], // 판타지
  ["1065", "로맨스"], // 로맨스
  ["5", "드라마"], // 드라마
  ["8", "액션"], // 학원/액션
  ["1443", "무협"], // 무협/시대극
  ["1441", "스릴러"], // 공포/스릴러
  ["1444", "스포츠"], // 스포츠
  ["2570", "코미디"], // 개그
  ["7", "BL"], // BL
];

// 기간/랭킹 타입 그리드.
const RANK_TYPES = ["famous", "monthly", "newest", "weekly"];

// /webtoon/weekly/dow/<1..7> → 한글 연재요일 (dow/1=월 … dow/7=일, 페이지 타이틀로 확인).
const DOW_KR = ["월", "화", "수", "목", "금", "토", "일"];

// 카드 블록: <a href="/webtoon/bridge/type/2/toon/<id>" class="toon ...> ... </a>.
const CARD_RE =
  /<a\s+href="\/webtoon\/bridge\/type\/2\/toon\/(\d+)"[^>]*class="toon\b[\s\S]*?<\/a>/g;
const TITLE_RE = /<strong class="toon__title">([^<]*)<\/strong>/;
const COVER_RE = /data-original="([^"]+)"/;
const ALT_RE = /\balt="([^"]*)"/;
// 서브타이틀: "<n>화(완) · <장르>" 같은 텍스트.
const SUB_RE = /toon-dcard__subtitle">([\s\S]*?)<\/span>\s*<\/span>/;
const GENRE_LINK_RE = /toon__link">([^<]*)<\/span>/;

// 작품 상세(브릿지) URL — 공개 진입점. PREFIX 와 함께 id/slug 구성.
const detailUrl = (workId) => `${ORIGIN}/webtoon/bridge/type/2/toon/${workId}`;

// "최신 2025.." 류 연도 추정용 — 표지 업로드 경로(.../2026_05_14_...png)에서 연도 추출.
function yearFromCover(coverUrl) {
  const m = String(coverUrl || "").match(/\/((?:19|20)\d{2})_\d{2}_\d{2}_/);
  if (m) {
    const y = Number(m[1]);
    if (y >= 2005 && y <= 2030) return y;
  }
  return undefined;
}

// 서브타이틀에서 (완)/(완결) → completed.
function statusFromSub(sub) {
  return /\(완\)|\(완결\)/.test(String(sub || "")) ? "completed" : "ongoing";
}

// 표지 절대 URL 검증(반드시 thumb.toomics.com https).
function validCover(url) {
  const u = String(url || "").trim();
  if (!/^https:\/\//i.test(u)) return undefined;
  try {
    return new URL(u).hostname === COVER_HOST ? u : undefined;
  } catch {
    return undefined;
  }
}

function buildRow(card, fallbackGenre, rank) {
  const workId = card.workId;
  const rawTitle = cleanTitle(card.title);
  if (!workId || !rawTitle) return null;

  const status = card.status;
  // 토믹스는 코인 결제 기반 — 기다리면무료 아이콘이면 wait-free, 아니면 paid.
  const pricing = card.waitFree ? "wait-free" : "paid";

  // 장르 추론: 제목 + 카드 장르 라벨 + 그리드 폴백.
  const genreHints = [rawTitle];
  if (card.genreLabel) genreHints.push(card.genreLabel);
  if (fallbackGenre) genreHints.push(fallbackGenre);
  const genres = mapGenres(genreHints, fallbackGenre || "드라마");

  const tags = [
    card.genreLabel,
    card.waitFree ? "기다리면무료" : null,
    status === "completed" ? "완결" : "연재중",
    card.episodeLabel,
  ]
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const realCover = validCover(card.cover);
  const id = `${PREFIX}-${workId}`;
  const url = detailUrl(workId);

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
    cover: coverGradient(workId, genres),
    coverImage: coverProxy(realCover),
    status,
    ageRating: mapAge(false), // 공개 목록 카드엔 19+ 표식 없음(연령 벽 미우회).
    releaseYear: yearFromCover(card.cover) ?? 2023,
    availability: [{ platformId: PLATFORM_ID, pricing, url }],
    stats: estimateStats({
      seed: id,
      rank,
      finished: status === "completed",
    }),
    featured: false,
  };

  return row;
}

// 그리드 HTML → 카드 객체 배열.
function parseCards(html) {
  const out = [];
  const s = String(html || "");
  CARD_RE.lastIndex = 0;
  let m;
  while ((m = CARD_RE.exec(s))) {
    const block = m[0];
    const workId = m[1];
    const t = TITLE_RE.exec(block);
    const altM = ALT_RE.exec(block);
    let title = "";
    if (t) title = t[1];
    else if (altM) title = altM[1];
    title = title.trim();
    if (!title) continue;
    const cov = COVER_RE.exec(block);
    const subM = SUB_RE.exec(block);
    const sub = subM ? stripTags(subM[1]) : "";
    const gM = GENRE_LINK_RE.exec(block);
    const epM = sub.match(/(\d+)\s*화/);
    out.push({
      workId,
      title,
      cover: cov ? cov[1].trim() : undefined,
      genreLabel: gM ? gM[1].trim() : undefined,
      status: statusFromSub(sub),
      waitFree: /l-waitingfree/.test(block),
      episodeLabel: epM ? `${epM[1]}화` : undefined,
    });
  }
  return out;
}

export async function crawl() { // NOSONAR javascript:S3776
  const byWorkId = new Map();

  // 요청 URL 목록(폴백 장르 동봉). 소스 폭으로 dedupe 후 120+ 확보.
  const requests = [];
  for (const [code, fb] of GENRES) {
    requests.push([`${ORIGIN}/webtoon/top100/genre/${code}`, fb]);
    requests.push([`${ORIGIN}/webtoon/top100/genre/${code}/page/2`, fb]);
  }
  for (const t of RANK_TYPES) {
    requests.push([`${ORIGIN}/webtoon/top100/type/${t}`, ""]);
  }
  // 요일별 연재 그리드 — 카드에 연재요일을 부여해 연재 캘린더 커버리지 확보.
  for (let d = 1; d <= 7; d++) {
    requests.push([`${ORIGIN}/webtoon/weekly/dow/${d}`, "", DOW_KR[d - 1]]);
  }
  requests.push([`${ORIGIN}/webtoon/toon_list/display/G2`, ""]);
  requests.push([`${ORIGIN}/webtoon/toon_list/display/G2/page/2`, ""]);
  requests.push([`${ORIGIN}/webtoon/finish/all`, ""]);

  for (let i = 0; i < requests.length; i++) {
    const [url, fb, weekday] = requests[i];
    const html = await fetchText(url, { referer: `${ORIGIN}/webtoon/weekly` });
    if (html) {
      for (const card of parseCards(html)) {
        if (!card.workId) continue;
        const existing = byWorkId.get(card.workId);
        if (existing) {
          // 요일 그리드에서 재발견 시 연재요일 누적(연재중 한정).
          if (weekday && existing.status !== "completed") {
            const days = new Set(existing.updateDays || []);
            days.add(weekday);
            existing.updateDays = [...days];
          }
          continue;
        }
        const rank = byWorkId.size + 1; // 발견 순서 기반 랭크 시드.
        const row = buildRow(card, fb, rank);
        if (row) {
          if (weekday && row.status !== "completed") row.updateDays = [weekday];
          byWorkId.set(card.workId, row);
        }
      }
    }
    if (i < requests.length - 1) await sleep(350); // 짧은 간격 + 합리적 요청 수(<40).
  }

  return [...byWorkId.values()];
}
