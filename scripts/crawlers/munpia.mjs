// 문피아(munpia) 크롤러 — 공개 HTML 카탈로그(/group/pl.serial, /group/nv.free)에서 웹소설 목록 수집.
// robots: /group 허용, /tpl·/addon·/ch 금지 → ajax /tpl 미사용. 데스크톱 UA + Referer https://www.munpia.com/.
// 표지 호스트: cdn1.munpia.com. workUrl=https://novel.munpia.com/{nvSrl}. type=webnovel, pricing=paid.
// 계약: scripts/crawlers/_shared.mjs 의 헬퍼만 사용하고 lib/types Title 형태(+_normTitle)로 반환한다.

import {
  fetchText,
  mapGenres,
  coverGradient,
  coverProxy,
  estimateStats,
  norm,
  cleanTitle,
  stripTags,
  decodeEntities,
  mapAge,
  sleep,
} from "./_shared.mjs";

const PREFIX = "mp";
const PLATFORM_ID = "munpia";
const PLATFORM_NAME = "문피아";
const SITE = "https://www.munpia.com";
const REFERER = "https://www.munpia.com/";

// 공개 목록 페이지(robots /group 허용). 두 그룹에서 수집해 중복은 nvSrl 로 dedupe.
const LIST_URLS = [
  `${SITE}/group/pl.serial`, // 유료 연재
  `${SITE}/group/nv.free`, // 무료 연재
];

// cdn1.munpia.com 만 신뢰. 프로토콜 상대(//) URL 은 https 로 정규화.
function normalizeCover(raw) {
  if (!raw) return undefined;
  let u = decodeEntities(String(raw).trim());
  if (u.startsWith("//")) u = "https:" + u;
  if (u.startsWith("http://")) u = "https://" + u.slice(7);
  if (!/^https:\/\/[^/]*cdn1\.munpia\.com\//i.test(u)) return undefined;
  return u;
}

// 한 목록 HTML 에서 작품 아이템 블록을 파싱한다.
// 아이템: <a href="https://novel.munpia.com/{id}" class="item|hero-item ..."> ... </a>
//   내부에 <img class="cover" src/data-src>, <span class="genre">, <span class="title ...">, <span class="author">
function parseList(html) { // NOSONAR javascript:S3776
  if (!html) return [];
  const out = [];
  // 각 작품 앵커 블록을 비탐욕 매칭(다음 </a> 까지).
  const anchorRe =
    /<a\b[^>]*href="https?:\/\/novel\.munpia\.com\/(\d+)"[^>]*class="(?:[^"]*\b)?(?:hero-)?item\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi; // NOSONAR S5842 (선택 접두 클래스 매칭, 동작 검증됨)
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const workId = m[1];
    const inner = m[2];

    // 제목: <span class="title ...">텍스트</span>
    const titleM = inner.match(/<span\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    let title = titleM ? stripTags(titleM[1]) : "";
    // 보조: img alt
    if (!title) {
      const altM = inner.match(/<img\b[^>]*\balt="([^"]*)"/i);
      if (altM) title = decodeEntities(altM[1]).trim();
    }
    if (!title) continue;

    // 작가: <span class="author">텍스트</span>
    const authorM = inner.match(/<span\b[^>]*class="[^"]*\bauthor\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const author = authorM ? stripTags(authorM[1]) : "";

    // 장르: <span class="genre">현대판타지, 퓨전</span>  → 쉼표 분리
    const genreM = inner.match(/<span\b[^>]*class="[^"]*\bgenre\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const rawGenres = genreM
      ? stripTags(genreM[1])
          .split(/[,/·]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // 표지: <img class="cover" src|data-src|data-original="//cdn1.munpia.com/...">
    let cover;
    const imgM = inner.match(/<img\b[^>]*class="[^"]*\bcover\b[^"]*"[^>]*>/i);
    if (imgM) {
      const tag = imgM[0];
      const srcM =
        tag.match(/\bdata-src="([^"]+)"/i) ||
        tag.match(/\bdata-original="([^"]+)"/i) ||
        tag.match(/\bsrc="([^"]+)"/i);
      if (srcM) cover = normalizeCover(srcM[1]);
    }

    out.push({ workId, title, author, rawGenres, cover });
  }
  return out;
}

// 표지가 없는 일부 아이템 한정으로 상세 페이지 og:image / og:description 보강(요청량 절제).
async function fetchDetailMeta(workId) {
  const html = await fetchText(`https://novel.munpia.com/${workId}`, { referer: REFERER });
  if (!html) return {};
  const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  const cover = ogImg ? normalizeCover((ogImg[1] || "").split("?")[0]) : undefined;
  let synopsis;
  if (ogDesc) {
    // og:description 은 "작가 - 작가 - 본문" 형태가 흔함 → 마지막 세그먼트만 취함.
    const parts = decodeEntities(ogDesc[1])
      .split(" - ")
      .map((s) => s.trim())
      .filter(Boolean);
    synopsis = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || "").trim();
    if (synopsis.length < 8) synopsis = undefined;
  }
  // 상세 페이지에 작품 연재상태가 평문 배지로 노출되지 않고(추천/네비 영역에 '완결' 문구가 섞임)
  // 신뢰 가능한 마커가 없어, 상태는 추정하지 않고 기본값(ongoing)을 유지한다.
  return { cover, synopsis };
}

export async function crawl() { // NOSONAR javascript:S3776
  // 1) 공개 목록 페이지들 수집 + nvSrl dedupe.
  const byId = new Map();
  for (const url of LIST_URLS) {
    const html = await fetchText(url, { referer: REFERER });
    for (const item of parseList(html)) {
      const prev = byId.get(item.workId);
      if (!prev) {
        byId.set(item.workId, item);
      } else {
        // 더 풍부한(표지·장르 있는) 레코드로 보강.
        if (!prev.cover && item.cover) prev.cover = item.cover;
        if ((!prev.rawGenres || !prev.rawGenres.length) && item.rawGenres?.length) prev.rawGenres = item.rawGenres;
        if (!prev.author && item.author) prev.author = item.author;
      }
    }
    await sleep(400);
  }

  const items = [...byId.values()];

  // 2) 표지 없는 아이템 일부만 상세에서 og:image 보강(요청량 절제: 최대 60건).
  const DETAIL_CAP = 60;
  let fetched = 0;
  for (const it of items) {
    if (it.cover) continue;
    if (fetched >= DETAIL_CAP) break;
    fetched++;
    const meta = await fetchDetailMeta(it.workId);
    if (meta.cover) it.cover = meta.cover;
    if (meta.synopsis) it.synopsis = meta.synopsis;
    await sleep(350);
  }

  // 3) Title row 매핑.
  const rows = items.map((it, i) => {
    const realTitle = it.title;
    const genres = mapGenres(it.rawGenres, "판타지");
    const realCover = normalizeCover(it.cover);
    const status = "ongoing"; // 신뢰 가능한 상태 마커가 공개 페이지에 없어 best-effort 기본값.
    const id = `${PREFIX}-${it.workId}`;
    const workUrl = `https://novel.munpia.com/${it.workId}`;

    const row = {
      _normTitle: norm(realTitle),
      id,
      slug: `${PREFIX}-${it.workId}`,
      type: "webnovel",
      title: cleanTitle(realTitle),
      author: it.author || "미상",
      genres,
      tags: (it.rawGenres || []).map((g) => g.trim()).filter(Boolean).slice(0, 6),
      synopsis: it.synopsis || `${realTitle} · ${PLATFORM_NAME} 공개 카탈로그 수집작.`,
      cover: coverGradient(it.workId, genres),
      coverImage: coverProxy(realCover),
      status,
      ageRating: mapAge(false),
      releaseYear: 2023,
      availability: [{ platformId: PLATFORM_ID, pricing: "paid", url: workUrl }],
      stats: estimateStats({ seed: id, rank: i + 1, finished: status === "completed" }),
      featured: false,
    };
    return row;
  });

  return rows;
}
