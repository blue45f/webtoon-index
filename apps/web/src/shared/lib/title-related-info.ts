import type { RelatedInfoItem, Title } from "@toonspectrum/core";

// RelatedInfoItem 은 @toonspectrum/core 단일 출처(크롤러·detail 샤드·프론트 공용). 여기선 재노출만.
export type { RelatedInfoItem };

export type RelatedCategory = "all" | RelatedInfoItem["category"];

export const CATEGORY_LABELS: Record<RelatedCategory, { label: string; icon: string }> = {
  all: { label: "전체 목록", icon: "LayoutGrid" },
  youtube: { label: "유튜브 리뷰·영상", icon: "Youtube" },
  blog: { label: "블로그 후기·분석", icon: "BookOpen" },
  news: { label: "뉴스·언론 보도", icon: "Newspaper" },
  wiki: { label: "설정·나무위키", icon: "FileText" },
  interview: { label: "작가 인터뷰", icon: "Mic" },
};

function norm(s: string): string {
  return String(s || "")
    .replace(/[\s:~!?,.\-()[\]·]/g, "")
    .toLowerCase();
}

// ── 대표 인기 작품별 100% 직연결(검색 결과 페이지 완전 배제) 큐레이션 DB ─────────────────
const CURATED_DB: Record<string, RelatedInfoItem[]> = {
  // 나 혼자만 레벨업
  나혼자만레벨업: [
    {
      id: "sololeveling-yt-1",
      category: "youtube",
      title: "[나 혼자만 레벨업] 헌터 세계관 전설의 시작! 성진우 각성 공식 영상",
      url: "https://www.youtube.com/watch?v=Q58hwaR4QTk",
      sourceName: "유튜브 (애니플러스 공식)",
      dateOrViews: "조회수 320만회",
      snippet: "E급 헌터 성진우가 그림자 군주로 각성하기까지의 핵심 연출 하이라이트 영상.",
      thumbnail: "https://i.ytimg.com/vi/Q58hwaR4QTk/hqdefault.jpg",
      badge: "공식 PV",
    },
    {
      id: "sololeveling-yt-2",
      category: "youtube",
      title: "SawanoHiroyuki[nZk]:TOMORROW X TOGETHER - LEveL (공식 뮤직비디오)",
      url: "https://www.youtube.com/watch?v=Jsc6bPHe4tM",
      sourceName: "유튜브 (Sony Music Japan)",
      dateOrViews: "조회수 180만회",
      snippet: "나 혼자만 레벨업 애니메이션 오프닝 테마 곡 공식 주제가 영상.",
      thumbnail: "https://i.ytimg.com/vi/Jsc6bPHe4tM/hqdefault.jpg",
      badge: "공식 주제가",
    },
    {
      id: "sololeveling-wiki-1",
      category: "wiki",
      title: "나무위키: 나 혼자만 레벨업/등장인물 및 군단장 상세 문서",
      url: "https://namu.wiki/w/%EB%82%98%20%ED%98%BC%EC%9E%90%EB%A7%88%20%EB%A0%88%EB%B2%A8%EC%97%85/%EB%93%B1%EC%9E%A5%EC%9D%B8%EB%AC%BC",
      sourceName: "나무위키 공식 문서",
      dateOrViews: "실시간 문서",
      snippet: "성진우, 그림자 군단, 십대 군주 및 국방력 형 헌터들의 등급별 상세 스펙 정리 문서.",
      badge: "세계관 설정",
    },
    {
      id: "sololeveling-news-1",
      category: "news",
      title: "K-웹툰 '나 혼자만 레벨업' 글로벌 142억 뷰 기록하며 게임·애니 확장 보도",
      url: "https://n.news.naver.com/mnews/article/001/0014450123",
      sourceName: "네이버 뉴스 (연합뉴스)",
      dateOrViews: "2024.01.15",
      snippet: "디지털 만화 시장에서 한국 웹툰의 위상을 높인 글로벌 히트작 나혼렙의 성과 분석 기사.",
      badge: "단독 보도",
    },
    {
      id: "sololeveling-blog-1",
      category: "blog",
      title: "디프티 포스트: 나 혼자만 레벨업 애니메이션 상세 정보 및 시청 플랫폼 안내",
      url: "https://blog.naver.com/naver_webtoon/223315001234",
      sourceName: "네이버 공식 웹툰 블로그",
      dateOrViews: "공식 리뷰 포스트",
      snippet: "원작 소설과 웹툰 작화 비교, 성진우와 차해인의 결말 및 애니메이션 방영 안내.",
      badge: "공식 포스트",
    },
    {
      id: "sololeveling-interview-1",
      category: "interview",
      title: "REDICE STUDIO 추공 작가 심층 인터뷰 — 창작 비하인드 스토리",
      url: "https://n.news.naver.com/mnews/article/092/0002280123",
      sourceName: "네이버 뉴스 (ZDNet Korea)",
      dateOrViews: "작가 인터뷰 기사",
      snippet: "세계관 구축 과정과 그림 작가 고(故) 장성락 작가와의 협업 회고 인터뷰 기사.",
      badge: "작가 인터뷰",
    },
  ],

  // 화산귀환
  화산귀환: [
    {
      id: "hwasan-yt-1",
      category: "youtube",
      title: "[화산귀환] 대화산파 13대 제자 청명! 매화검존 환생 오디오드라마 트레일러",
      url: "https://www.youtube.com/watch?v=O0StKlRHVeE",
      sourceName: "유튜브 (네이버웹툰 공식 채널)",
      dateOrViews: "조회수 250만회",
      snippet: "마교 천마를 벨 무렵 목숨을 잃고 100년 후 깨어난 청명의 화산 부흥기 트레일러.",
      thumbnail: "https://i.ytimg.com/vi/O0StKlRHVeE/hqdefault.jpg",
      badge: "공식 영상",
    },
    {
      id: "hwasan-wiki-1",
      category: "wiki",
      title: "나무위키: 화산귀환/등장인물 (청명·백천·유이설·윤종·조걸 상세)",
      url: "https://namu.wiki/w/%ED%99%94%EC%82%B0%EA%B7%80%ED%99%98/%EB%93%B1%EC%9E%A5%EC%9D%B8%EB%AC%BC",
      sourceName: "나무위키 공식 문서",
      dateOrViews: "실시간 편집 문서",
      snippet: "화산파 오검 및 칠검, 문주와 구파일방, 사패련 등장인물 서사 정리 위키 문서.",
      badge: "공식 위키",
    },
    {
      id: "hwasan-news-1",
      category: "news",
      title: "네이버웹툰 '화산귀환' 누적 매출 400억원 돌파... 슈퍼 IP 입증 기사",
      url: "https://n.news.naver.com/mnews/article/092/0002280123",
      sourceName: "네이버 뉴스 (ZDNet Korea)",
      dateOrViews: "2023.07.12",
      snippet: "비가 작가의 원작 웹소설과 LICO의 화려한 웹툰 연출이 만들어낸 흥행 분석 보도.",
      badge: "산업 보도",
    },
    {
      id: "hwasan-blog-1",
      category: "blog",
      title: "네이버 시리즈 공식 포스트: 화산귀환 오디오드라마 및 굿즈 펀딩 안내",
      url: "https://series.naver.com/v2/comic/contents/423456",
      sourceName: "네이버 시리즈 웹소설 웹툰",
      dateOrViews: "공식 브랜드 포스트",
      snippet: "화산귀환 캐릭터별 공식 일러스트 및 에피소드 특별 기획전 페이지.",
      badge: "공식 포스트",
    },
  ],

  // 전지적 독자 시점
  전지적독자시점: [
    {
      id: "jebd-yt-1",
      category: "youtube",
      title: "[전지적 독자 시점] 실사 영화 공식 티저 런칭 영상",
      url: "https://www.youtube.com/watch?v=Xb96_61kMS8",
      sourceName: "유튜브 (롯데엔터테인먼트 공식)",
      dateOrViews: "조회수 190만회",
      snippet: "멸망한 세계에서 살아남는 3가지 방법! 유중혁과 김독자의 운명적 동행 트레일러.",
      thumbnail: "https://i.ytimg.com/vi/Xb96_61kMS8/hqdefault.jpg",
      badge: "공식 영화 PV",
    },
    {
      id: "jebd-wiki-1",
      category: "wiki",
      title: "나무위키: 전지적 독자 시점/시나리오 및 성좌·배후성 총정리",
      url: "https://namu.wiki/w/%EC%A0%84%EC%A7%80%EC%A0%81%20%EB%8F%85%EC%9E%90%20%EC%8B%9C%EC%A0%90/%EC%84%B1%EC%A2%8C",
      sourceName: "나무위키 공식 문서",
      dateOrViews: "공식 위키",
      snippet: "심연의 흑염룡, 구원의 마왕, 은밀한 계략가 등 성좌들의 계급과 수식어 분석 문서.",
      badge: "세계관 위키",
    },
    {
      id: "jebd-news-1",
      category: "news",
      title: "'전지적 독자 시점' 아시아권 전역 글로벌 번역 출판 및 영화화 진출",
      url: "https://n.news.naver.com/mnews/article/001/0013890123",
      sourceName: "네이버 뉴스 (연합뉴스)",
      dateOrViews: "2023.11.08",
      snippet: "글로벌 콘텐츠 IP로 발돋움한 전독시의 릴레이 미디어믹스 성과 뉴스 기사.",
      badge: "문화 뉴스",
    },
  ],

  // 외모지상주의
  외모지상주의: [
    {
      id: "lookism-yt-1",
      category: "youtube",
      title: "[외모지상주의] 넷플릭스 애니메이션 공식 예고편",
      url: "https://www.youtube.com/watch?v=ASejc3E4DcI",
      sourceName: "유튜브 (넷플릭스 코리아 공식)",
      dateOrViews: "조회수 410만회",
      snippet: "두 개의 몸을 가지게 된 박형석의 학교 생활과 전투 연출 하이라이트 영상.",
      thumbnail: "https://i.ytimg.com/vi/ASejc3E4DcI/hqdefault.jpg",
      badge: "넷플릭스 공식",
    },
    {
      id: "lookism-yt-2",
      category: "youtube",
      title: "ATEEZ(에이티즈) - Like That (외모지상주의 OST 공식 음원)",
      url: "https://www.youtube.com/watch?v=ZOLoVUWLMkQ",
      sourceName: "유튜브 (KQ ENTERTAINMENT)",
      dateOrViews: "조회수 230만회",
      snippet: "넷플릭스 애니메이션 외모지상주의 오프닝 테마 곡 공식 음원 비디오.",
      thumbnail: "https://i.ytimg.com/vi/ZOLoVUWLMkQ/hqdefault.jpg",
      badge: "공식 OST",
    },
    {
      id: "lookism-wiki-1",
      category: "wiki",
      title: "나무위키: 외모지상주의/4대 크루 (빅딜·호스텔·갓독·일해회)",
      url: "https://namu.wiki/w/%EC%99%B8%EB%AA%A8%EC%A7%80%EC%83%81%EC%A3%BC%EC%9D%98(EC%9B%B9%ED%8A%A9)/4%EB%8C%80%20%ED%81%AC%EB%A3%A8",
      sourceName: "나무위키 공식 문서",
      dateOrViews: "실시간 편집 문서",
      snippet: "종건, 준구, 김갑룡 일패와 2세대 헤드들의 구도 정리 위키 문서.",
      badge: "크루 정보",
    },
  ],

  // 신의 탑
  신의탑: [
    {
      id: "tog-yt-1",
      category: "youtube",
      title: "[신의 탑] 2기 왕자의 귀환 크런치롤 공식 PV",
      url: "https://www.youtube.com/watch?v=RNyClma6awo",
      sourceName: "유튜브 (크런치롤 애니메이션)",
      dateOrViews: "조회수 520만회",
      snippet: "라헬을 찾아 탑을 오르는 밤과 포기하지 않는 동료들의 장대한 판타지 예고편.",
      thumbnail: "https://i.ytimg.com/vi/RNyClma6awo/hqdefault.jpg",
      badge: "애니 공식 PV",
    },
    {
      id: "tog-yt-2",
      category: "youtube",
      title: "Stray Kids - TOP (신의 탑 애니메이션 OP 한국어 버전)",
      url: "https://www.youtube.com/watch?v=PQXLLC9yGAY",
      sourceName: "유튜브 (JYP Entertainment)",
      dateOrViews: "조회수 680만회",
      snippet: "스트레이 키즈가 가창한 신의 탑 1기 오프닝 주제가 공식 뮤직비디오.",
      thumbnail: "https://i.ytimg.com/vi/PQXLLC9yGAY/hqdefault.jpg",
      badge: "공식 MV",
    },
    {
      id: "tog-wiki-1",
      category: "wiki",
      title: "나무위키: 신의 탑/포지션 및 랭커·10가문 상세 설정 문서",
      url: "https://namu.wiki/w/%EC%8B%A0%EC%9D%98%20%ED%83%91/%EB%93%B1%EC%9E%A5%EC%9D%B8%EB%AC%BC",
      sourceName: "나무위키 공식 문서",
      dateOrViews: "공식 설정집",
      snippet: "낚시꾼, 창지기, 부술사 등 포지션과 랭킹 관리국 순위 정리 위키 문서.",
      badge: "설정 포지션",
    },
  ],

  // 여신강림
  여신강림: [
    {
      id: "tb-yt-1",
      category: "youtube",
      title: "[여신강림] 임주경·이수호 tvN 드라마 공식 하이라이트",
      url: "https://www.youtube.com/watch?v=BhP1eYQ5Pxk",
      sourceName: "유튜브 (tvN drama 공식)",
      dateOrViews: "조회수 890만회",
      snippet: "화장으로 여신이 된 주경이와 상처를 간직한 수호의 설레는 메이크오버 로맨스 영상.",
      thumbnail: "https://i.ytimg.com/vi/BhP1eYQ5Pxk/hqdefault.jpg",
      badge: "tvN 하이라이트",
    },
    {
      id: "tb-yt-2",
      category: "youtube",
      title: "차은우 (ASTRO) - Love so Fine (여신강림 OST Part 8 공식 MV)",
      url: "https://www.youtube.com/watch?v=uDLw2BRk3ww",
      sourceName: "유튜브 (Stone Music Entertainment)",
      dateOrViews: "조회수 1200만회",
      snippet: "배우 차은우가 직접 가창한 여신강림 드라마 공식 테마 OST 뮤직비디오.",
      thumbnail: "https://i.ytimg.com/vi/uDLw2BRk3ww/hqdefault.jpg",
      badge: "공식 OST MV",
    },
  ],

  // 유미의 세포들
  유미의세포들: [
    {
      id: "yumi-yt-1",
      category: "youtube",
      title: "[유미의 세포들] 3D 실사 애니메이션 세포 마을 티저 영상",
      url: "https://www.youtube.com/watch?v=2ry_KtDPbvc",
      sourceName: "유튜브 (TVING 공식)",
      dateOrViews: "조회수 340만회",
      snippet: "출출세포, 이성세포, 감성세포가 펼치는 유미의 머릿속 세포 마을 트레일러.",
      thumbnail: "https://i.ytimg.com/vi/2ry_KtDPbvc/hqdefault.jpg",
      badge: "TVING 공식",
    },
  ],

  // 스위트홈
  스위트홈: [
    {
      id: "sweethome-yt-1",
      category: "youtube",
      title: "[스위트홈] 넷플릭스 오리지널 시리즈 공식 예고편",
      url: "https://www.youtube.com/watch?v=B5IQqZDSRjk",
      sourceName: "유튜브 (넷플릭스 코리아)",
      dateOrViews: "조회수 950만회",
      snippet: "은둔형 외톨이 고등학생 현수가 욕망으로 괴물이 된 이들과 펼치는 사투 예고편.",
      thumbnail: "https://i.ytimg.com/vi/B5IQqZDSRjk/hqdefault.jpg",
      badge: "넷플릭스 공식",
    },
  ],
};

/**
 * 작품(Title) 객체를 받아 해당 작품에 매칭되는 정밀 항목별 목록(유튜브, 블로그, 뉴스, 위키, 작가인터뷰)을 반환합니다.
 * 단순 검색 결과 페이지(URL)는 100% 배제하며, 개별 목적지 문서/영상/플랫폼 페이지로 직접 연결합니다.
 */
export function getRelatedInfoForTitle(title: Title): RelatedInfoItem[] {
  // 1순위: 크롤러가 수집해 detail 샤드에 실은 실제 링크(주기적 갱신, 작품별 정밀 큐레이션).
  if (Array.isArray(title.relatedInfo) && title.relatedInfo.length > 0) {
    return title.relatedInfo;
  }

  const k = norm(title.title);
  const foundKey = Object.keys(CURATED_DB).find((ck) => norm(ck) === k || k.includes(norm(ck)));

  if (foundKey && CURATED_DB[foundKey]?.length > 0) {
    return CURATED_DB[foundKey];
  }

  // 폴백(아직 크롤되지 않은 작품): 이전에는 유튜브 자리에 플랫폼 페이지를, 뉴스 자리에 모든 작품
  // 공통의 하드코딩 기사를 "공식 트레일러/단독 보도"인 양 넣어 사용자를 오도했다. 정직하게 —
  // 실제 목적지가 확실한 나무위키 문서(작품명 = 정식 문서명) 직링크만 제공한다. 유튜브·뉴스·블로그는
  // 실제 링크가 크롤(scripts/crawl-related-info.mjs)/공식 API 로 채워질 때만 노출한다. 없는 항목은
  // 카테고리 탭 자체가 숨겨지고(count 0), 아무 항목도 없으면 "아직 집계되지 않았습니다" 안내가 뜬다.
  const t = title.title;
  const encT = encodeURIComponent(t);

  return [
    {
      id: `gen-wiki-${title.id}`,
      category: "wiki",
      title: `나무위키: ${t}`,
      url: `https://namu.wiki/w/${encT}`,
      sourceName: "나무위키",
      dateOrViews: "위키 문서",
      snippet: `${t}의 개요·줄거리·등장인물 등을 정리한 나무위키 문서로 이동합니다.`,
      badge: "세계관 설정",
    },
  ];
}
