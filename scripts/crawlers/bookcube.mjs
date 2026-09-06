// bookcube (북큐브) 웹소설 카탈로그 크롤러.
// 공개 HTML 목록(categorylist.asp 웹소설 / best.asp 베스트)을 데스크톱 UA로 파싱한다.
// 출력 row 는 lib/types Title(+ _normTitle) 계약과 _shared.mjs 헬퍼를 따른다.

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

const BASE = "https://www.bookcube.com";
const PREFIX = "bc";
const PLATFORM_ID = "bookcube";
const PLATFORM_NAME = "북큐브";

// 웹소설 메인 분류(mainclass_num=00). 너무 많이 두드리지 않도록 페이지 수를 제한한다.
const CATEGORY_PAGES = 30; // 50개 x 30 (빈 페이지면 조기 종료 — 전 작품 지향)
const SLEEP_MS = 450;

// 한 <li> 블록에서 제목/저자/평점 등을 추출.
function parseListItems(html) { // NOSONAR javascript:S3776
  if (!html) return [];
  const items = [];
  // <ul class="book-list"> 내부의 각 <li> ... </li> 단위로 분리.
  const ulMatch = html.match(/<ul class="book-list">([\s\S]*?)<\/ul>/);
  const scope = ulMatch ? ulMatch[1] : html;
  const liBlocks = scope.split(/<li>/).slice(1); // 첫 조각은 <li> 이전 텍스트

  for (const block of liBlocks) {
    const li = block.split(/<\/li>/)[0];
    if (!li) continue;

    const idMatch = li.match(/\/detail\.asp\?series_num=(\d+)/);
    if (!idMatch) continue;
    const workId = idMatch[1];

    // 제목: <p class="hot-title"><a ...>{title}</a>
    const titleMatch = li.match(/<p class="hot-title">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    const rawTitle = titleMatch ? stripTags(titleMatch[1]) : "";
    if (!rawTitle) continue;

    // 표지: <img src="https://bookimg.bookcube.com/150/.../N.jpg" alt="도서 이미지 - {title}" />
    // 성인물은 /images/contents/adult_19_94.jpg 플레이스홀더로 노출(나이등급 19로 표기).
    const imgMatch = li.match(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["']/i);
    let coverUrl;
    let adult = false;
    if (imgMatch) {
      const src = decodeEntities(imgMatch[1]);
      if (/adult_19_94\.jpg/i.test(src) || /19금/.test(imgMatch[2] || "")) {
        adult = true; // 성인 표지 가림 → 19등급. 실제 표지 URL은 수집하지 않음(age-gate 우회 금지).
      } else if (/^https:\/\/bookimg\.bookcube\.com\//i.test(src)) {
        // /150/ 변형 → /200/ 더 큰 변형이 존재하면 사용.
        coverUrl = src.replace(/\/bookimg\.bookcube\.com\/150\//i, "/bookimg.bookcube.com/200/");
      }
    }

    // 저자/출판사/발행일: <p class="hot-author">{author}<em>|</em><a>{publisher}</a><em>|</em>{date}
    const authorBlock = li.match(/<p class="hot-author">([\s\S]*?)<\/p>/);
    let author = "미상";
    let publisher = "";
    let releaseYear = 2023;
    if (authorBlock) {
      const parts = authorBlock[1].split(/<em>\s*\|\s*<\/em>/);
      if (parts[0]) author = stripTags(parts[0]) || "미상";
      if (parts[1]) publisher = stripTags(parts[1]);
      for (const p of parts) {
        const ym = stripTags(p).match(/(19|20)\d{2}/);
        if (ym) {
          releaseYear = Number(ym[0]);
          break;
        }
      }
    }

    // 평점(0~10 스케일) + 평가 인원: <em>8.4</em> (515명)
    let ratingAvg;
    let ratingCount;
    const scoreMatch = li.match(/<em>(\d+(?:\.\d+)?)<\/em>\s*\(([0-9,]+)\s*명\)/);
    if (scoreMatch) {
      const cnt = Number(scoreMatch[2].replace(/,/g, ""));
      const avg10 = Number(scoreMatch[1]);
      if (cnt > 0 && avg10 > 0) {
        ratingCount = cnt;
        ratingAvg = Math.round((avg10 / 2) * 10) / 10; // 10점 → 5점 환산
      }
    }

    // 완결 여부: <em class="end-result">완결</em>
    const finished = /class="end-result"[^>]*>\s*완결/.test(li) || /완결\s*<\/em>/.test(li);

    // 권수: 총 N권
    const volMatch = li.match(/총\s*([0-9,]+)\s*권/);
    const volumes = volMatch ? Number(volMatch[1].replace(/,/g, "")) : undefined;

    // 시놉시스: <div class="hot-desc"><p>...</p>
    const descMatch = li.match(/<div class="hot-desc">\s*<p>([\s\S]*?)<\/p>/);
    const synopsis = descMatch ? stripTags(descMatch[1]) : "";

    items.push({
      workId,
      rawTitle,
      author,
      publisher,
      releaseYear,
      ratingAvg,
      ratingCount,
      finished,
      volumes,
      synopsis,
      coverUrl,
      adult,
    });
  }
  return items;
}

function buildRow(item, index) {
  const {
    workId,
    rawTitle,
    author,
    publisher,
    releaseYear,
    ratingAvg,
    ratingCount,
    finished,
    volumes,
    synopsis,
    coverUrl,
    adult,
  } = item;

  const title = cleanTitle(rawTitle);
  const id = `${PREFIX}-${workId}`;
  const workUrl = `${BASE}/detail.asp?series_num=${workId}`;

  // 장르 단서: 제목 + 시놉시스 + 출판사. 매칭 없으면 드라마.
  const genres = mapGenres([rawTitle, synopsis, publisher], "드라마");

  // 태그: 출판사 + 완결/연재 + 권수.
  const tags = [];
  if (publisher) tags.push(publisher);
  tags.push(finished ? "완결" : "연재중");
  if (volumes) tags.push(`총 ${volumes}권`);
  if (adult) tags.push("성인");

  const row = {
    _normTitle: norm(title),
    id,
    slug: id,
    type: "webnovel",
    title,
    author: author || "미상",
    genres,
    tags: tags.slice(0, 6),
    synopsis: synopsis || `${title} · ${PLATFORM_NAME} 공개 카탈로그 수집작.`,
    cover: coverGradient(workId, genres),
    coverImage: coverProxy(coverUrl),
    status: finished ? "completed" : "ongoing",
    ageRating: mapAge(adult),
    releaseYear: releaseYear || 2023,
    availability: [{ platformId: PLATFORM_ID, pricing: "paid", url: workUrl }],
    stats: estimateStats({
      seed: id,
      rank: index + 1,
      ratingAvg,
      ratingCount,
      finished,
    }),
    featured: false,
  };

  if (row.coverImage === undefined) delete row.coverImage;
  return row;
}

export async function crawl() { // NOSONAR javascript:S3776
  const byId = new Map();

  // 1) 웹소설 분류 목록을 몇 페이지 페이지네이션.
  for (let page = 1; page <= CATEGORY_PAGES; page++) {
    const url = `${BASE}/categorylist.asp?mainclass_num=00&pageNum=${page}`;
    const html = await fetchText(url, { referer: `${BASE}/` });
    const parsed = parseListItems(html);
    for (const item of parsed) {
      if (!byId.has(item.workId)) byId.set(item.workId, item);
    }
    if (parsed.length === 0) break; // 더 이상 항목 없음
    await sleep(SLEEP_MS);
  }

  // 2) 베스트 목록으로 평점 있는 인기작 보강(실제 평점/완결 정보가 더 풍부).
  const bestHtml = await fetchText(`${BASE}/best.asp`, { referer: `${BASE}/` });
  for (const item of parseListItems(bestHtml)) {
    const existing = byId.get(item.workId);
    if (!existing) {
      byId.set(item.workId, item);
    } else {
      // 베스트 쪽의 실제 평점/완결/표지가 있으면 병합.
      if (item.ratingAvg && !existing.ratingAvg) {
        existing.ratingAvg = item.ratingAvg;
        existing.ratingCount = item.ratingCount;
      }
      if (item.finished) existing.finished = true;
      if (item.coverUrl && !existing.coverUrl) existing.coverUrl = item.coverUrl;
    }
  }

  const items = [...byId.values()];
  return items.map((item, i) => buildRow(item, i));
}
