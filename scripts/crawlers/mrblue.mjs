// 미스터블루(mrblue) 만화 카탈로그 크롤러.
// 공개 HTML 목록(/comic, /comic/ranking/real-time, /comic/genre/all)에서 작품을 수집한다.
// robots.txt: /comic·/comic/ranking·/comic/genre 는 허용(/api·/tpl·/section_* 등은 미접근).
// 각 item: <a href="/comic/<ID>"> 안의 <img class="lazy" data-original=".../comics/<ID>/cover_w480.jpg" alt="<TITLE>">.
// 표지는 coverProxy()로 /api/cover 프록시 URL을 만든다(호스트 img.mrblue.com).

import {
  fetchText,
  mapGenres,
  coverGradient,
  coverProxy,
  estimateStats,
  norm,
  cleanTitle,
  decodeEntities,
  mapAge,
  sleep,
} from "./_shared.mjs";

const ORIGIN = "https://www.mrblue.com";
const COMIC_BASE = `${ORIGIN}/comic/`;

// 공개 목록 페이지(robots 허용). 정적 HTML 에 작품 카드가 그대로 들어있다.
const LIST_URLS = [
  `${ORIGIN}/comic/ranking/real-time`,
  `${ORIGIN}/comic`,
  `${ORIGIN}/comic/genre/all`,
];

// alt 텍스트의 후행 분류 태그 → 상태/성격. (cleanTitle 이 대괄호를 제거하므로 상태 판정용으로만 보존)
const STATUS_BY_TAG = {
  연재: "ongoing",
  스크롤: "ongoing",
  단행본: "completed",
  완결: "completed",
  개정판: "completed",
  특가세트: "completed",
  전권무료: "completed",
};

// 카드 1개를 표현하는 <a href="/comic/ID"> ... </a> 블록에서 ID/제목/표지/상태를 추출.
// 같은 ID 가 여러 상태 변형(연재/단행본)으로 중복 노출되므로 workId 로 dedupe 한다.
function parseListHtml(html) { // NOSONAR javascript:S3776
  const items = [];
  if (!html) return items;

  // <a href="/comic/<ID>"> ... </a> 단위로 스캔(앵커 내부의 lazy 표지 img 를 매칭).
  const anchorRe = /<a\s+href="\/comic\/(\w+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const workId = m[1];
    const inner = m[2];

    // 앵커 내부의 표지 이미지(data-original 의 ID 가 앵커 ID 와 일치하는 것만 신뢰).
    const imgRe =
      /<img[^>]*class="lazy"[^>]*data-original="(https:\/\/img\.mrblue\.com\/prod_img\/comics\/(\w+)\/cover_w480\.jpg)"[^>]*alt="([^"]*)"[^>]*>/i;
    const img = imgRe.exec(inner);
    if (!img) continue;

    const coverUrl = img[1];
    const imgId = img[2];
    if (imgId !== workId) continue; // 잘못 짝지어진 카드 방어
    const altRaw = decodeEntities(img[3]).trim();
    if (!altRaw) continue;

    // 상태: alt 후행 대괄호 태그로 판정. 여러 태그가 있으면 "단행본/완결" 우선.
    const tags = (altRaw.match(/\[([^\]]+)\]/g) || []).map((t) => t.replace(/[[\]]/g, "").trim());
    let status = "ongoing";
    for (const tag of tags) {
      const key = tag.replace(/\s+/g, "");
      const mapped = STATUS_BY_TAG[key];
      if (mapped === "completed") {
        status = "completed";
        break;
      }
      if (mapped) status = mapped;
    }

    items.push({ workId, coverUrl, altRaw, status });
  }
  return items;
}

// keywords meta 구조(관찰): 제목어..., [상태태그], <장르...>, <작가/그림 이름...>, "/", <출판사>, "만화", "comic".
// 즉 [상태] 직후 토큰부터 "/" 또는 "만화"/"comic" 직전까지가 (장르 + 작가) 영역이고, 선두가 장르 토큰이다.
const NON_AUTHOR = new Set(["만화", "comic", "무료", "할인", "이벤트", "신작", "완결", "연재"]);

// mrblue keywords meta 에서 관찰되는 장르 토큰 어휘([상태] 직후 선두에 등장).
const GENRE_TOKENS = new Set([
  "순정", "로맨스", "로맨스판타지", "로판", "BL", "GL", "백합", "판타지", "현대판타지", "현판",
  "무협", "액션", "스릴러", "미스터리", "추리", "공포", "호러", "드라마", "일상", "코미디", "개그",
  "학원", "스포츠", "역사", "사극", "SF", "성인", "느와르", "시대극", "감성", "옴니버스", "소년", "소녀",
]);

// 상세 페이지 og:description / keywords meta 로 synopsis·장르·작가를 보강(요청을 아끼기 위해 소수만).
function parseDetailHtml(html, titleWords = []) {
  if (!html) return null;
  const out = {};

  const desc = /<meta\s+property="og:description"\s+content="([^"]*)"/i.exec(html);
  if (desc) {
    const s = decodeEntities(desc[1]).replace(/\s+/g, " ").trim();
    if (s.length >= 20) out.synopsis = s.slice(0, 400);
  }

  const kw = /<meta\s+name="keywords"\s+content="([^"]*)"/i.exec(html);
  if (!kw) return out;

  const toks = decodeEntities(kw[1])
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  out.keywords = toks;

  // [상태태그] 위치 이후 ~ "/"(저자 구분) 또는 "만화"/"comic" 직전까지를 메타 영역으로 본다.
  const statusIdx = toks.findIndex((t) => /^\[.*\]$/.test(t));
  let metaStart = statusIdx >= 0 ? statusIdx + 1 : 0;
  let metaEnd = toks.findIndex((t, i) => i >= metaStart && (t === "/" || t === "만화" || t === "comic"));
  if (metaEnd < 0) metaEnd = toks.length;
  const meta = toks.slice(metaStart, metaEnd);

  // 선두의 연속된 장르 토큰을 장르로, 그 뒤(첫 비장르 토큰부터)를 작가/그림 이름 영역으로 본다.
  const titleSet = new Set(titleWords);
  let gi = 0;
  while (gi < meta.length && GENRE_TOKENS.has(meta[gi])) gi++;
  out.genreText = meta.slice(0, gi);
  out.adult = out.genreText.includes("성인");

  // 작가/그림 이름 후보: 장르 영역 이후, "/"·잡토큰·제목어·영문전용·출판사명 제외.
  // "/" 가 있으면 그 뒤(출판사 영역)는 잘라낸다.
  const afterGenre = meta.slice(gi);
  const slashAt = afterGenre.indexOf("/");
  const authorZone = slashAt >= 0 ? afterGenre.slice(0, slashAt) : afterGenre;
  const PUBLISHER_RE = /(코믹스|코믹|미디어|하우스|문화사|출판|엔터|컴퍼니|스튜디오|comics?)$/i;
  const authorCandidates = authorZone.filter(
    (t) =>
      t !== "/" &&
      t.length >= 2 &&
      t.length <= 12 &&
      !NON_AUTHOR.has(t) &&
      !GENRE_TOKENS.has(t) &&
      !titleSet.has(t) &&
      !PUBLISHER_RE.test(t) &&
      !/^[A-Za-z]+$/.test(t),
  );
  if (authorCandidates.length) out.authors = authorCandidates.slice(0, 3);
  return out;
}

export async function crawl() { // NOSONAR javascript:S3776
  // 1) 공개 목록 페이지들을 순차 수집(작은 sleep). 등장 순서 = 대략적 랭크.
  const seen = new Map(); // workId -> item(최초 등장 보존, 랭크 인덱스 포함)
  for (const url of LIST_URLS) {
    const html = await fetchText(url, { referer: ORIGIN });
    const parsed = parseListHtml(html);
    for (const it of parsed) {
      if (seen.has(it.workId)) {
        // 완결 정보가 더 확실하면 상태만 승격(단행본/완결 우선).
        const prev = seen.get(it.workId);
        if (prev.status !== "completed" && it.status === "completed") prev.status = "completed";
        continue;
      }
      seen.set(it.workId, { ...it, rank: seen.size + 1 });
    }
    await sleep(350);
  }

  const list = [...seen.values()];

  // 2) 상위 일부만 상세 보강(synopsis/장르/작가). 요청량을 아끼려 cap + sleep.
  const ENRICH_CAP = 80;
  const enrich = new Map();
  for (let i = 0; i < Math.min(ENRICH_CAP, list.length); i++) {
    const it = list[i];
    const titleWords = cleanTitle(it.altRaw).split(/\s+/).filter(Boolean);
    const html = await fetchText(`${COMIC_BASE}${it.workId}`, { referer: `${ORIGIN}/comic` });
    const d = parseDetailHtml(html, titleWords);
    if (d) enrich.set(it.workId, d);
    await sleep(300);
  }

  // 3) row 구성.
  const rows = list.map((it, idx) => {
    const realTitle = cleanTitle(it.altRaw); // 대괄호 분류 태그 제거
    const det = enrich.get(it.workId);
    const adult = Boolean(det?.adult) || /\[성인\]|\[19\]/.test(it.altRaw);

    // 장르: 상세 keywords 의 장르 토큰 + 제목 키워드로 추정(둘 다 없으면 드라마).
    const genreSource = [realTitle, ...(det?.genreText || [])];
    const genres = mapGenres(genreSource, "드라마");

    // 작가: keywords 구조에서 추출한 이름(없으면 "미상").
    const author = det?.authors?.length ? det.authors.join(", ") : "미상";

    // 태그: 장르 토큰 + 작가명을 짧게 노출(제목 단어 파편은 제외).
    const tags = [...(det?.genreText || []), ...(det?.authors || [])]
      .filter((k) => k.length >= 2 && k.length <= 12)
      .slice(0, 6);

    const workUrl = `${COMIC_BASE}${it.workId}`;
    const id = `mb-${it.workId}`;
    const synopsis = det?.synopsis || `${realTitle} · 미스터블루 공개 카탈로그 수집작.`;

    return {
      _normTitle: norm(realTitle),
      id,
      slug: `mb-${it.workId}`,
      type: "webtoon",
      title: realTitle,
      author,
      genres,
      tags,
      synopsis,
      cover: coverGradient(it.workId, genres),
      coverImage: coverProxy(it.coverUrl),
      status: it.status,
      ageRating: mapAge(adult),
      releaseYear: 2023,
      availability: [
        { platformId: "mrblue", pricing: "paid", url: workUrl },
      ],
      stats: estimateStats({
        seed: id,
        rank: idx + 1,
        finished: it.status === "completed",
      }),
      featured: false,
    };
  });

  return rows;
}
