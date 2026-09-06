// 리디(RIDI) 크롤러 — 공개 카탈로그(HTML __NEXT_DATA__) 수집.
// 소스:
//   - /comics/bestsellers, /comics/new-releases : 큐레이션 목록(책 객체를 __NEXT_DATA__에 임베드)
//   - /comics/view-category-<id> : 장르별 카탈로그(카드 객체 {bookId,title,thumbnail,authors,starRate,extra}
//                                  를 200개 단위로 SSR 임베드 → 커버리지 확장의 핵심 소스)
// robots: /comics 허용, /api · /account · /payment 비허용 → SSR HTML만 사용(데스크톱 UA). 로그인/성인인증 우회 없음.
// 표지 호스트: img.ridicdn.net (image/jpeg 검증됨). coverImage 는 coverProxy()로 /api/cover 프록시.

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

const PREFIX = "rd";
const PLATFORM_ID = "ridi";
const PLATFORM_NAME = "리디";
const REFERER = "https://ridibooks.com/";

// 책 객체(buildRow)가 __NEXT_DATA__에 임베드되는 큐레이션 목록 페이지들.
// (장르/시간대 변형, ?genre=, ?page= 는 SSR에서 동일 기본 목록만 반환 → 의미 없음.)
const LIST_PAGES = [
  "https://ridibooks.com/comics/bestsellers",
  "https://ridibooks.com/comics/new-releases",
];

// 장르별 카탈로그 페이지(/comics/view-category-<id>). 각 페이지가 카드 객체를 200개 단위로 SSR 임베드한다.
// id별 의미(페이지 title): 1515=액션, 1519=드라마, 1522=해외 순정, 1523=코믹, 1527=판타지/SF.
// 100 은 "만화 추천"(에디터 추천 묶음)으로 장르 교차 보완용. 모두 /comics 하위 → robots 허용.
const CATEGORY_IDS = ["1515", "1519", "1522", "1523", "1527", "100"];
const categoryUrl = (id) => `https://ridibooks.com/comics/view-category-${id}`;

// view-category 카드 객체 판별: bookId + title(문자열) + thumbnail + authors 동시 보유.
function isCard(o) {
  return (
    o &&
    typeof o.bookId !== "undefined" &&
    typeof o.title === "string" &&
    o.title.trim() &&
    o.thumbnail &&
    typeof o.thumbnail === "object" &&
    Array.isArray(o.authors)
  );
}

// 책 데이터 객체 판별: id + title + authors + categories 동시 보유.
function isBook(o) {
  return (
    o &&
    typeof o.id !== "undefined" &&
    o.title &&
    typeof o.title === "object" &&
    Array.isArray(o.authors) &&
    Array.isArray(o.categories)
  );
}

// "만화 e북" 같은 포맷 라벨 / 슬래시 복합 장르를 풀어서 정규화 입력으로.
const FORMAT_LABELS = new Set(["만화 e북", "e북", "전자책", "단행본"]);

function rawGenreStrings(categories = []) {
  const out = [];
  for (const c of categories) {
    const name = (c && c.name) || "";
    if (!name || FORMAT_LABELS.has(name)) continue;
    // "판타지/SF", "공포/추리" 처럼 슬래시 복합은 분리해서 각각 매칭에 태운다.
    for (const part of name.split(/[/·,]/)) {
      const t = part.trim();
      if (t && !FORMAT_LABELS.has(t)) out.push(t);
    }
  }
  return out;
}

// 작가/그림 분리. role 우선순위: AUTHOR/ORIGINAL_AUTHOR=글, ILLUSTRATOR=그림.
function pickAuthors(authors = []) {
  const byRole = (roles) =>
    authors
      .filter((a) => a && a.name && roles.includes(String(a.role || "").toUpperCase()))
      .map((a) => a.name.trim())
      .filter(Boolean);

  const writers = byRole(["AUTHOR", "ORIGINAL_AUTHOR", "STORY_WRITER", "WRITER"]);
  const artists = byRole(["ILLUSTRATOR", "ART", "ARTIST", "DRAWING"]);

  let authorList = writers;
  if (!authorList.length) {
    // 글 역할이 없으면 그림이라도, 그것도 없으면 번역/기타 제외하고 전체 이름.
    authorList = artists.length
      ? artists
      : authors
          .filter((a) => a && a.name && String(a.role || "").toUpperCase() !== "TRANSLATOR")
          .map((a) => a.name.trim())
          .filter(Boolean);
  }
  // 중복 제거.
  const uniq = (arr) => [...new Set(arr)];
  return {
    author: uniq(authorList).join(", ") || "미상",
    // 작가와 그림이 다를 때만 artist 노출.
    artist:
      artists.length && uniq(artists).join() !== uniq(writers).join()
        ? uniq(artists).join(", ")
        : undefined,
  };
}

// 실제 평점 배열 [{count, rating}] → {avg, count}.
function realRatings(ratings) {
  if (!Array.isArray(ratings) || !ratings.length) return {};
  let sum = 0;
  let total = 0;
  for (const r of ratings) {
    const rating = Number(r && r.rating);
    const count = Number(r && r.count);
    if (!Number.isFinite(rating) || !Number.isFinite(count) || count <= 0) continue;
    sum += rating * count;
    total += count;
  }
  if (total <= 0) return {};
  return { ratingAvg: Math.round((sum / total) * 10) / 10, ratingCount: total };
}

// 시놉시스 저작권/출간 문구에서 연도 추정(예: "ⓒ ... 2025", "2024 by ..."). 없으면 default.
function guessYear(description, fallback = 2023) {
  const text = String(description || "");
  const years = [];
  const re = /(?:©|ⓒ|\bin\b|by|published|first published|\b20\d{2}\b)[^\d]{0,10}(20\d{2})|\b(20\d{2})\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const y = Number(m[1] || m[2]);
    if (y >= 2000 && y <= 2026) years.push(y);
  }
  if (!years.length) return fallback;
  // 가장 최근 연도(최초 출간/저작권 표기 중 최신)를 release 추정으로.
  return Math.max(...years);
}

// 카테고리로 웹툰/웹소설 판별. 리디 /comics 는 사실상 만화(웹툰류) → 기본 webtoon.
function pickType(categories = []) {
  for (const c of categories) {
    const name = String((c && c.name) || "");
    const genre = String((c && c.genre) || "").toLowerCase();
    if (genre === "novel" || /웹소설|소설|라이트노벨|라노벨/.test(name)) return "webnovel";
  }
  return "webtoon";
}

// 가격 모델: 무료편 존재 + 유료 → wait-free 느낌이지만, 리디는 단행본 구매형이 기본 → paid.
function pickPricing(book) {
  const series = book.series || {};
  const free = series.freeEpisodeCountInfo || {};
  const hasFree = (Number(free.purchase) || 0) > 0 || (Number(free.rental) || 0) > 0;
  // 무료 회차가 있으면 wait-free(기다리면무료) 성격, 아니면 paid.
  return hasFree ? "wait-free" : "paid";
}

// ── view-category 카드 → 작가/그림 분리. role 은 소문자(author/illustrator/story_writer/translator…).
function pickAuthorsCard(authors = []) {
  const byRole = (roles) =>
    authors
      .filter((a) => a && a.name && roles.includes(String(a.role || "").toLowerCase()))
      .map((a) => a.name.trim())
      .filter(Boolean);

  const writers = byRole(["author", "original_author", "story_writer", "writer"]);
  const artists = byRole(["illustrator", "art", "artist", "drawing", "original_illustrator"]);

  let authorList = writers;
  if (!authorList.length) {
    authorList = artists.length
      ? artists
      : authors
          .filter((a) => a && a.name && String(a.role || "").toLowerCase() !== "translator")
          .map((a) => a.name.trim())
          .filter(Boolean);
  }
  const uniq = (arr) => [...new Set(arr)];
  return {
    author: uniq(authorList).join(", ") || "미상",
    artist:
      artists.length && uniq(artists).join() !== uniq(writers).join()
        ? uniq(artists).join(", ")
        : undefined,
  };
}

// view-category 카드 객체를 표준 row 로. buildRow 와 동일한 계약/필드.
function buildRowFromCard(card, index) { // NOSONAR javascript:S3776
  const workId = String(card.bookId || "");
  if (!workId) return null;

  const title = cleanTitle(card.title);
  if (!title) return null;

  const { author, artist } = pickAuthorsCard(card.authors);

  const extra = card.extra || {};
  // extra.genre 는 "판타지/SF", "해외 순정" 같은 단일/복합 라벨 → 슬래시·중점 분리해 정규화.
  const rawGenres = String(extra.genre || "")
    .split(/[/·,]/)
    .map((s) => s.trim())
    .filter((s) => s && !FORMAT_LABELS.has(s));
  const genres = mapGenres(rawGenres, "드라마");

  const src = card.thumbnail?.source || {};
  const rawCover =
    (src.xxlarge || src.large || src.small || "").split("#")[0] ||
    `https://img.ridicdn.net/cover/${workId}/xxlarge`;

  const description = stripTags(extra.description || "");
  const synopsis =
    description && description.length > 8
      ? description.slice(0, 600)
      : `${title} · ${PLATFORM_NAME} 공개 카탈로그 수집작.`;

  const status = extra.series?.completion ? "completed" : "ongoing";
  const adult = Boolean(card.isAdultOnly);

  const tags = [...new Set(rawGenres)].filter((t) => t.length <= 12).slice(0, 6);

  // starRate: { count, score } → 실제 평점.
  const score = Number(card.starRate?.score);
  const scount = Number(card.starRate?.count);
  const ratingAvg = Number.isFinite(score) && score > 0 ? Math.round(score * 10) / 10 : undefined;
  const ratingCount = Number.isFinite(scount) && scount > 0 ? scount : undefined;

  // 가격: rental(대여) 또는 무료편이 있으면 wait-free 성격, 아니면 paid.
  const hasRental = Boolean(extra.price?.rental || extra.price?.rentalAll);
  const pricing = hasRental ? "wait-free" : "paid";

  const id = `${PREFIX}-${workId}`;
  const workUrl = `https://ridibooks.com/books/${workId}`;

  const row = {
    _normTitle: norm(title),
    id,
    slug: `${PREFIX}-${workId}`,
    type: "webtoon",
    title,
    author,
    genres,
    tags,
    synopsis,
    cover: coverGradient(workId, genres),
    coverImage: coverProxy(rawCover),
    status,
    ageRating: mapAge(adult),
    releaseYear: guessYear(description, 2023),
    availability: [
      {
        platformId: PLATFORM_ID,
        pricing,
        url: workUrl,
      },
    ],
    stats: estimateStats({
      seed: id,
      rank: index + 1,
      ratingAvg,
      ratingCount,
      finished: status === "completed",
    }),
    featured: false,
  };

  if (artist) row.artist = artist;
  return row;
}

function buildRow(book, index) {
  const workId = String(book.series?.id || book.id);
  if (!workId) return null;

  const series = book.series || {};
  const rawTitle = series.title || book.title?.main || "";
  const title = cleanTitle(rawTitle);
  if (!title) return null;

  const { author, artist } = pickAuthors(book.authors);
  const rawGenres = rawGenreStrings(book.categories);
  const genres = mapGenres(rawGenres, "드라마");

  // 표지: 데이터에 실제 thumbnail.xxlarge 가 있으면 그것(캐시버스터 #n 제거), 없으면 규칙 URL.
  const thumb = series.thumbnail || {};
  const rawCover =
    (thumb.xxlarge || thumb.large || "").split("#")[0] ||
    `https://img.ridicdn.net/cover/${workId}/xxlarge`;

  const description = stripTags(book.introduction?.description || "");
  const synopsis =
    description && description.length > 8
      ? description.slice(0, 600)
      : `${title} · ${PLATFORM_NAME} 공개 카탈로그 수집작.`;

  const status = series.isCompleted ? "completed" : "ongoing";
  const adult = Boolean(book.isAdultOnly);
  const type = pickType(book.categories);

  // 태그: 정규화 전 원본 장르 라벨(짧은 것) 최대 6개.
  const tags = [...new Set(rawGenres)].filter((t) => t.length <= 12).slice(0, 6);

  const { ratingAvg, ratingCount } = realRatings(book.ratings);
  const id = `${PREFIX}-${workId}`;
  const workUrl = `https://ridibooks.com/books/${workId}`;

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
    releaseYear: guessYear(description, 2023),
    availability: [
      {
        platformId: PLATFORM_ID,
        pricing: pickPricing(book),
        url: workUrl,
      },
    ],
    stats: estimateStats({
      seed: id,
      rank: index + 1,
      ratingAvg,
      ratingCount,
      finished: status === "completed",
    }),
    featured: false,
  };

  if (artist) row.artist = artist;
  return row;
}

export async function crawl() { // NOSONAR javascript:S3776
  // 큐레이션 목록(bestsellers/new-releases): 풀 책 객체(series/ratings 포함) → buildRow.
  const byId = new Map();
  // 장르 카탈로그(view-category): 카드 객체 → buildRowFromCard. 책 객체에 없는 workId만 채운다.
  const cardById = new Map();

  for (const url of LIST_PAGES) {
    const html = await fetchText(url, { referer: REFERER });
    if (html) {
      const data = extractNextData(html);
      if (data) {
        const books = deepCollect(data, isBook);
        for (const book of books) {
          const workId = String(book.series?.id || book.id || "");
          if (!workId || byId.has(workId)) continue;
          byId.set(workId, book);
        }
      }
    }
    await sleep(700);
  }

  // 장르별 카탈로그 페이지에서 카드 수집(요청당 작은 sleep). 풀 책 객체가 우선이므로 중복 workId는 스킵.
  for (let c = 0; c < CATEGORY_IDS.length; c++) {
    const html = await fetchText(categoryUrl(CATEGORY_IDS[c]), { referer: REFERER });
    if (html) {
      const data = extractNextData(html);
      if (data) {
        const cards = deepCollect(data, isCard, 8000);
        for (const card of cards) {
          const workId = String(card.bookId || "");
          if (!workId || byId.has(workId) || cardById.has(workId)) continue;
          cardById.set(workId, card);
        }
      }
    }
    if (c < CATEGORY_IDS.length - 1) await sleep(600);
  }

  const rows = [];
  let i = 0;
  for (const book of byId.values()) {
    const row = buildRow(book, i);
    if (row) {
      rows.push(row);
      i++;
    }
  }
  for (const card of cardById.values()) {
    const row = buildRowFromCard(card, i);
    if (row) {
      rows.push(row);
      i++;
    }
  }
  return rows;
}
