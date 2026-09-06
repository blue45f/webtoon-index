// 교보문고(kyobo) 전자책 웹소설 공개 카탈로그 크롤러.
// SOURCE: 통합검색 결과 페이지(서버 렌더 HTML) — https://search.kyobobook.co.kr/search?keyword=<kw>&target=ebook&page=<n>
//   eBook(전자책) 타겟 검색 결과 li.prod_item 안에 상품 메타가 data-* 속성으로 박혀 있다.
//   상품: data-pid(E…), data-bid(표지 바코드), data-name(제목), data-prhb-age(연령), data-free-ysno(무료여부).
//   저자/출판사/출간일/상세링크는 같은 prod_item 블록에서 추출.
// robots: search.kyobobook.co.kr/robots.txt 는 /api/ 만 Disallow → 사람용 /search 결과 페이지는 Allow.
//   JSON /api 엔드포인트는 robots 금지라 사용하지 않고, 공개 검색 결과 HTML만 파싱한다.
//   로그인/연령게이트 우회 없음(공개 목록 메타데이터만 사용; 성인작은 실제 공개 썸네일 URL 그대로 전달).
//   digital.kyobobook.co.kr 카테고리 호스트는 이 환경의 node fetch 에서 연결 불가(DNS/연결 실패)라
//   동일 카탈로그를 노출하는 search 호스트의 eBook 검색 결과를 사용한다.
// 표지: contents.kyobobook.co.kr/sih/fit-in/<size>/pdt/<barcode>.jpg (실제 원본, image/jpeg) → coverProxy.
//   ※ contents.kyobobook.co.kr 는 catalog.controller 의 COVER_ALLOWED_HOST 에 추가되어야 프록시가 통과한다.
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

const PREFIX = "kb";
const PLATFORM_ID = "kyobo";
const PLATFORM_NAME = "교보문고";
const ORIGIN = "https://search.kyobobook.co.kr";
// 실제 표지 호스트. 바코드(data-bid)로 fit-in 썸네일 원본을 만든다.
const COVER_BASE = "https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt";

// 웹소설 장르 키워드 → 폴백 장르. eBook 검색은 키워드당 페이지 20건씩,
// 여러 장르 키워드 × 다중 페이지를 합쳐 dedupe 하면 실작 120+ 확보 가능.
// 키워드는 웹소설 장르/소재 위주로 골라 일반 비문학 eBook 혼입을 줄인다.
const QUERIES = [
  { kw: "로맨스판타지", genre: "로판", tag: "로맨스판타지" },
  { kw: "무협", genre: "무협", tag: "무협" },
  { kw: "현대판타지", genre: "현판", tag: "현대판타지" },
  { kw: "판타지소설", genre: "판타지", tag: "판타지" },
  { kw: "회귀", genre: "판타지", tag: "회귀" },
  { kw: "빙의", genre: "로판", tag: "빙의" },
  { kw: "악녀", genre: "로판", tag: "악녀" },
  { kw: "계약결혼", genre: "로맨스", tag: "로맨스" },
  { kw: "아카데미", genre: "판타지", tag: "아카데미" },
  { kw: "게임판타지", genre: "게임판타지", tag: "게임판타지" },
  { kw: "BL소설", genre: "BL", tag: "BL" },
];

const PAGES_PER_QUERY = 20; // 키워드당 20페이지 → 빈 페이지면 조기 종료(전 작품 지향).

// li.prod_item 블록 경계로 분리. 각 블록에서 상품 1건의 메타를 뽑는다.
function splitProductBlocks(html) {
  const s = String(html || "");
  const re = /<li class="prod_item">/g;
  const starts = [];
  let m;
  while ((m = re.exec(s)) !== null) starts.push(m.index);
  const blocks = [];
  for (let i = 0; i < starts.length; i++) {
    blocks.push(s.slice(starts[i], starts[i + 1] ?? s.length));
  }
  return blocks;
}

// "2026년 03월 12일" → 연도 숫자. 실패 시 null.
function parseYear(dateStr) {
  const m = String(dateStr || "").match(/(19|20)\d{2}/);
  if (!m) return null;
  const y = Number(m[0]);
  return y >= 1990 && y <= 2030 ? y : null;
}

// 저자 anchor(class="author …") 텍스트들에서 대표 저자 문자열 구성. 많으면 "외 N명" 요약.
function parseAuthors(block) {
  const parts = [...block.matchAll(/class="author[^"]*"[^>]*>([^<]+)<\/a>/g)]
    .map((x) => stripTags(x[1]))
    .filter(Boolean);
  const uniq = [...new Set(parts)];
  if (!uniq.length) return "미상";
  return uniq.length > 3 ? `${uniq[0]} 외 ${uniq.length - 1}명` : uniq.join(", ");
}

function parseProduct(block) {
  const pid = (block.match(/data-pid="(E\d+)"/) || [])[1];
  if (!pid) return null; // eBook(E코드)만 채택. 종이책(S코드)은 무시.
  const bid = (block.match(/data-bid="([^"]+)"/) || [])[1] || "";
  const rawName = (block.match(/data-name="([^"]*)"/) || [])[1] || "";
  const title = cleanTitle(rawName);
  if (!title) return null;

  const adult = (block.match(/data-prhb-age="(\d+)"/) || [])[1];
  const isAdult = Number(adult) >= 19;
  const free = (block.match(/data-free-ysno="(\d)"/) || [])[1] === "1";

  const author = parseAuthors(block);
  const publisher = stripTags(
    (block.match(/class="prod_publish"[\s\S]*?class="text"[^>]*>([^<]+)<\/a>/) || [])[1] || "",
  );
  const dateStr = (block.match(/class="date">([^<]+)<\/span>/) || [])[1] || "";
  const detail =
    (block.match(/href="(https:\/\/ebook-product\.kyobobook\.co\.kr\/[^"]+\/E\d+)"/) || [])[1] ||
    `https://ebook-product.kyobobook.co.kr/dig/epd/ebook/${pid}`;

  return { pid, bid, title, isAdult, free, author, publisher, dateStr, detail };
}

function buildRow(p, query, rank) {
  const { pid, bid, title, isAdult, free, author, publisher, dateStr, detail } = p;

  // 장르: 제목 + 검색 키워드/장르 + 태그로 매핑(폴백은 쿼리 장르).
  const genres = mapGenres([title, query.kw, query.tag, query.genre], query.genre);

  const tags = [query.tag, publisher, free ? "무료" : null]
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 6);

  // 실제 표지(바코드 기반). 바코드 없으면 표지 생략.
  const realCover = bid ? `${COVER_BASE}/${encodeURIComponent(bid)}.jpg` : undefined;

  const id = `${PREFIX}-${pid}`;
  const row = {
    _normTitle: norm(title),
    id,
    slug: id,
    type: "webnovel",
    title,
    author: author || "미상",
    genres,
    tags,
    synopsis: `${title} · ${PLATFORM_NAME} 공개 카탈로그 수집작.`,
    cover: coverGradient(pid, genres),
    status: "ongoing",
    ageRating: mapAge(isAdult),
    releaseYear: parseYear(dateStr) ?? 2023,
    availability: [
      { platformId: PLATFORM_ID, pricing: free ? "free" : "paid", url: detail },
    ],
    stats: estimateStats({ seed: id, rank }),
    featured: false,
  };

  const cover = coverProxy(realCover);
  if (cover) row.coverImage = cover;

  return row;
}

async function fetchSearchPage(kw, page) {
  const url = `${ORIGIN}/search?keyword=${encodeURIComponent(kw)}&target=ebook&page=${page}`;
  return fetchText(url, { referer: `${ORIGIN}/` });
}

export async function crawl() { // NOSONAR javascript:S3776
  const byWorkId = new Map();

  for (let qi = 0; qi < QUERIES.length; qi++) {
    const query = QUERIES[qi];
    for (let page = 1; page <= PAGES_PER_QUERY; page++) {
      const html = await fetchSearchPage(query.kw, page);
      if (html) {
        const blocks = splitProductBlocks(html);
        for (const block of blocks) {
          const p = parseProduct(block);
          if (!p || byWorkId.has(p.pid)) continue; // dedupe by workId(E코드)
          const rank = byWorkId.size + 1;
          byWorkId.set(p.pid, buildRow(p, query, rank));
        }
      }
      // 마지막 요청 뒤엔 굳이 대기하지 않는다.
      const last = qi === QUERIES.length - 1 && page === PAGES_PER_QUERY;
      if (!last) await sleep(400);
    }
  }

  return [...byWorkId.values()];
}
