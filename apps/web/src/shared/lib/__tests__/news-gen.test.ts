import { describe, expect, it } from "vitest";

import {
  assembleNews,
  attachRelatedTitles,
  buildTitleMatcher,
  capSourceRuns,
  classifyNews,
  dedupeNews,
  findRelatedTitles,
  googleNewsRssUrl,
  headlineSimilarity,
  isNoiseHeadline,
  normalizeHeadlineKey,
  parseRssItems,
  type NewsCategory,
  type NewsItem,
} from "../../../../../../scripts/news-gen";

function makeItem(over: Partial<NewsItem> & { title: string }): NewsItem {
  return {
    source: "매체",
    url: `https://news.example.com/${encodeURIComponent(over.title)}`,
    date: "2026-06-10T09:00:00.000Z",
    category: "industry",
    ...over,
  };
}

// ── RSS 파싱(고정 fixture) ───────────────────────────────────────────────────

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>"웹툰" - Google 뉴스</title>
<item>
  <title>네이버웹툰, 글로벌 웹툰 공모전 개최 - 연합뉴스</title>
  <link>https://news.example.com/a1</link>
  <pubDate>Wed, 10 Jun 2026 09:00:00 GMT</pubDate>
  <source url="https://www.yna.co.kr">연합뉴스</source>
</item>
<item>
  <title><![CDATA[&#39;화산귀환&#39; 애니메이션 제작 확정 - OSEN]]></title>
  <link>https://news.example.com/a2</link>
  <pubDate>Tue, 09 Jun 2026 12:30:00 GMT</pubDate>
  <source url="https://osen.mt.co.kr">OSEN</source>
</item>
<item>
  <title>링크 없는 항목은 버린다 - 매체</title>
  <pubDate>Tue, 09 Jun 2026 10:00:00 GMT</pubDate>
  <source url="https://example.com">매체</source>
</item>
</channel></rss>`;

describe("parseRssItems", () => {
  const items = parseRssItems(FIXTURE_XML);

  it("item 블록에서 제목·출처·링크를 뽑고 링크 없는 항목은 버린다", () => {
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe("https://news.example.com/a1");
    expect(items[0].source).toBe("연합뉴스");
  });

  it('구글뉴스 제목의 " - 출처" 접미사를 제거한다', () => {
    expect(items[0].title).toBe("네이버웹툰, 글로벌 웹툰 공모전 개최");
  });

  it("CDATA·HTML 엔티티를 디코드한다", () => {
    expect(items[1].title).toBe("'화산귀환' 애니메이션 제작 확정");
  });

  it("pubDate 를 ISO 로 정규화한다", () => {
    expect(items[0].date).toBe("2026-06-10T09:00:00.000Z");
  });
});

describe("googleNewsRssUrl", () => {
  it("한국어 지역 파라미터(hl=ko&gl=KR&ceid=KR:ko)를 포함한다", () => {
    const url = googleNewsRssUrl("웹툰 공모전");
    expect(url).toContain("hl=ko&gl=KR&ceid=KR:ko");
    expect(url).toContain(encodeURIComponent("웹툰 공모전"));
  });
});

// ── 분류 ────────────────────────────────────────────────────────────────────

describe("classifyNews", () => {
  const cases: Array<[string, NewsCategory, NewsCategory]> = [
    // [헤드라인, 폴백, 기대 카테고리]
    ["'화산귀환' 애니메이션 제작 확정", "industry", "adaptation"],
    ["웹소설 원작 드라마, 넷플릭스 공개", "novel", "adaptation"],
    ["부천국제만화축제 다음 달 개막", "industry", "event"],
    ["지상최대 웹소설 공모전 접수 시작", "title", "event"],
    ["올해 주목할 웹소설 플랫폼", "industry", "novel"],
    ["네이버웹툰 기대 신작 공개", "industry", "title"],
    ["웹툰 불법 유통 단속 강화", "title", "industry"],
    // 키워드가 없으면 수집 쿼리의 카테고리 폴백
    ["키워드가 전혀 없는 헤드라인", "event", "event"],
  ];
  it.each(cases)("%s → %s 폴백에서 %s", (headline, fallback, expected) => {
    expect(classifyNews(headline, fallback)).toBe(expected);
  });
});

// ── 무관/스팸 필터 ──────────────────────────────────────────────────────────

describe("isNoiseHeadline", () => {
  it("불법 무료사이트 주소 어그로를 거른다", () => {
    expect(isNoiseHeadline("뉴토끼 최신 주소 바로가기 안내")).toBe(true);
    expect(isNoiseHeadline("무료 웹툰 사이트 추천 BEST 10")).toBe(true);
    expect(isNoiseHeadline("웹툰 무료보기 사이트 링크 정리")).toBe(true);
    expect(isNoiseHeadline("온라인 카지노 홍보 웹툰 적발")).toBe(true);
  });

  it("정상 보도는 거르지 않는다 — 단속·프로모션 뉴스 포함", () => {
    expect(isNoiseHeadline("웹툰 불법 유통 사이트 운영자 검거")).toBe(false);
    expect(isNoiseHeadline("카카오페이지, 웹툰 무료 보기 이벤트 진행")).toBe(false);
    expect(isNoiseHeadline("네이버웹툰 3분기 실적 발표")).toBe(false);
  });
});

// ── dedupe ──────────────────────────────────────────────────────────────────

describe("dedupeNews", () => {
  it("머리말 태그·문장부호만 다른 거의 동일 헤드라인을 제거한다(앞 항목 우선)", () => {
    const a = makeItem({ title: "[단독] '화산귀환' 드라마 제작 확정…제작사는 A스튜디오", url: "u1" });
    const b = makeItem({ title: "'화산귀환' 드라마 제작 확정… 제작사는 A스튜디오!", url: "u2" });
    const c = makeItem({ title: "전혀 다른 웹툰 산업 뉴스", url: "u3" });
    expect(dedupeNews([a, b, c]).map((x) => x.url)).toEqual(["u1", "u3"]);
  });

  it("충분히 긴 키가 접두사 관계면(말줄임 차이) 중복으로 본다", () => {
    const full = makeItem({ title: "전지적 독자 시점 영화 개봉일 확정 소식에 팬들 환호", url: "u1" });
    const cut = makeItem({ title: "전지적 독자 시점 영화 개봉일 확정", url: "u2" });
    expect(dedupeNews([full, cut])).toHaveLength(1);
  });

  it("조사·어미만 바꾼 보도자료 변주 헤드라인을 유사도로 제거한다", () => {
    const a = makeItem({ title: "카카오페이지 인기 웹소설 '괴담출근', 웹툰으로 나왔다", url: "u1" });
    const b = makeItem({ title: "카카오페이지 인기 웹소설 '괴담출근', 웹툰으로 본다", url: "u2" });
    const c = makeItem({ title: "젠지 세대 신드롬 웹소설 '괴담출근', 오늘 웹툰으로 공개", url: "u3" });
    // a≈b(같은 문장 변주)는 합치고, c(다른 문장 구성)는 남긴다
    expect(dedupeNews([a, b, c]).map((x) => x.url)).toEqual(["u1", "u3"]);
  });

  it("단어 한두 개 바꿔치기한 같은 보도자료 헤드라인도 잡는다(실측 0.74 변주)", () => {
    const a = makeItem({ title: "젠지 세대 인기 웹소설 ‘괴담출근’, 오늘(5일) 웹툰으로 공개", url: "u1" });
    const b = makeItem({ title: "젠지 세대 신드롬 웹소설 ‘괴담출근’, 오늘 웹툰으로 공개", url: "u2" });
    expect(dedupeNews([a, b])).toHaveLength(1);
  });

  it("headlineSimilarity 는 동일 문장 1, 무관 문장 0 에 가깝다", () => {
    const k = normalizeHeadlineKey;
    expect(headlineSimilarity(k("웹툰 산업 성장"), k("웹툰 산업 성장"))).toBe(1);
    expect(
      headlineSimilarity(k("웹툰 플랫폼 3분기 실적 발표"), k("인기 웹소설 드라마 캐스팅 확정"))
    ).toBeLessThan(0.3);
  });

  it("짧은 헤드라인은 접두사가 겹쳐도 서로 다른 뉴스로 남긴다", () => {
    const a = makeItem({ title: "웹툰 산업 성장", url: "u1" });
    const b = makeItem({ title: "웹툰 산업 성장세 주춤한 이유", url: "u2" });
    expect(dedupeNews([a, b])).toHaveLength(2);
  });

  it("동일 URL 은 제거한다", () => {
    const a = makeItem({ title: "기사 A", url: "same" });
    const b = makeItem({ title: "기사 B", url: "same" });
    expect(dedupeNews([a, b])).toHaveLength(1);
  });

  it("normalizeHeadlineKey 는 대괄호 태그·공백·문장부호를 무시한다", () => {
    expect(normalizeHeadlineKey("[속보] 웹툰, 산업 '성장'!")).toBe(normalizeHeadlineKey("웹툰 산업 성장"));
  });
});

// ── 출처 다양화 ─────────────────────────────────────────────────────────────

describe("capSourceRuns", () => {
  const src = (s: string, i: number) => ({ source: s, id: `${s}${i}` });

  it("같은 매체가 maxRun 을 넘겨 연속되면 다른 매체 기사를 끌어올린다", () => {
    const input = [src("A", 1), src("A", 2), src("A", 3), src("B", 4)];
    expect(capSourceRuns(input, 2).map((x) => x.id)).toEqual(["A1", "A2", "B4", "A3"]);
  });

  it("대안이 없으면(전부 같은 매체) 순서를 유지한다", () => {
    const input = [src("A", 1), src("A", 2), src("A", 3)];
    expect(capSourceRuns(input, 2).map((x) => x.id)).toEqual(["A1", "A2", "A3"]);
  });

  it("빈 출처는 연속 제한을 적용하지 않는다", () => {
    const input = [src("", 1), src("", 2), src("", 3), src("B", 4)];
    expect(capSourceRuns(input, 2).map((x) => x.id)).toEqual(["1", "2", "3", "B4"]);
  });
});

// ── 카탈로그 작품 매칭 ──────────────────────────────────────────────────────

describe("buildTitleMatcher / findRelatedTitles", () => {
  const matcher = buildTitleMatcher([
    { slug: "hwasan", title: "화산귀환", stats: { views: 100 } },
    { slug: "body", title: "신체", stats: { views: 5 } }, // 2자 — 따옴표 안에서만
    { slug: "omni", title: "전지적 독자 시점", altTitles: ["전독시"], stats: { views: 50 } },
    { slug: "leveling", title: "나 혼자만 레벨업", stats: { views: 90 } },
    { slug: "generic", title: "웹툰", stats: { views: 999 } }, // 스톱워드 — 매칭 금지
  ]);

  it("따옴표 안 정확 일치는 짧은 제목(4자)도 매칭한다", () => {
    expect(findRelatedTitles("'화산귀환' 애니메이션 제작 확정", matcher)).toEqual([
      { slug: "hwasan", title: "화산귀환" },
    ]);
  });

  it("따옴표 없는 4자 이하 제목은 본문 포함만으로 매칭하지 않는다(오탐 방지)", () => {
    expect(findRelatedTitles("화산귀환 애니메이션 제작 확정", matcher)).toEqual([]);
    expect(findRelatedTitles("신체검사 결과로 본 웹툰 캐릭터", matcher)).toEqual([]);
  });

  it("5자+ 제목은 웹툰/웹소설 문맥이 있을 때 본문 포함으로 매칭한다", () => {
    expect(findRelatedTitles("전지적 독자 시점, 웹툰 완결 임박", matcher)).toEqual([
      { slug: "omni", title: "전지적 독자 시점" },
    ]);
  });

  it("별칭(altTitles)도 따옴표 일치로 매칭하고 표시는 정식 제목으로 한다", () => {
    expect(findRelatedTitles("'전독시' 영화 내년 개봉", matcher)).toEqual([
      { slug: "omni", title: "전지적 독자 시점" },
    ]);
  });

  it("스톱워드 제목(웹툰 등)·일반 문구는 매칭하지 않는다", () => {
    expect(findRelatedTitles("'웹툰' 산업이 커진다", matcher)).toEqual([]);
  });

  it("최대 2개까지만 매칭한다", () => {
    const hits = findRelatedTitles(
      "'화산귀환'·'전지적 독자 시점'·'나 혼자만 레벨업' 줄줄이 영상화",
      matcher
    );
    expect(hits).toHaveLength(2);
  });

  it("attachRelatedTitles 는 매칭 없는 아이템에 related 를 붙이지 않는다", () => {
    const [hit, miss] = attachRelatedTitles(
      [
        makeItem({ title: "'화산귀환' 드라마 캐스팅 발표", url: "u1" }),
        makeItem({ title: "웹툰 산업 결산", url: "u2" }),
      ],
      matcher
    );
    expect(hit.related).toEqual([{ slug: "hwasan", title: "화산귀환" }]);
    expect(miss.related).toBeUndefined();
  });
});

// ── 조립(정렬·상한·필터) ────────────────────────────────────────────────────

describe("assembleNews", () => {
  it("날짜 내림차순 정렬 + 카테고리 상한 + 전체 상한을 적용한다", () => {
    const items: NewsItem[] = [
      makeItem({ title: "산업 뉴스 1", url: "i1", date: "2026-06-10T00:00:00Z" }),
      makeItem({ title: "산업 뉴스 2", url: "i2", date: "2026-06-09T00:00:00Z" }),
      makeItem({ title: "산업 뉴스 3", url: "i3", date: "2026-06-08T00:00:00Z" }),
      makeItem({ title: "행사 뉴스 1", url: "e1", date: "2026-06-11T00:00:00Z", category: "event", source: "B" }),
      makeItem({ title: "행사 뉴스 2", url: "e2", date: "2026-06-07T00:00:00Z", category: "event", source: "B" }),
    ];
    const out = assembleNews(items, { perCategoryCap: 2, totalCap: 3, maxSourceRun: 2 });
    expect(out).toHaveLength(3);
    // 최신순이되 industry 는 상한(2) 내, event 최신이 맨 앞
    expect(out.map((x) => x.url)).toEqual(["e1", "i1", "i2"]);
  });

  it("스팸 헤드라인과 중복을 걸러낸 뒤 상한을 센다", () => {
    const items: NewsItem[] = [
      makeItem({ title: "뉴토끼 최신 주소 바로가기", url: "s1", date: "2026-06-12T00:00:00Z" }),
      makeItem({ title: "웹툰 플랫폼 매출 사상 최대", url: "k1", date: "2026-06-10T00:00:00Z" }),
      makeItem({ title: "[종합] 웹툰 플랫폼 매출 사상 최대", url: "k2", date: "2026-06-09T00:00:00Z" }),
    ];
    const out = assembleNews(items);
    expect(out.map((x) => x.url)).toEqual(["k1"]);
  });
});
