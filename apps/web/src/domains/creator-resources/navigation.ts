export const RESOURCE_PAGES = [
  { path: "/creator-hub", title: "창작 허브", description: "자료 수집부터 작품 공개까지, 다음 작업을 시작하세요." },
  { path: "/opportunities", title: "작가 기회센터", description: "지원사업을 찾아 저장하고 접수 준비를 시작하세요." },
  { path: "/creator-hub/references", title: "창작 레퍼런스", description: "복식·소품·미술 자료를 출처와 함께 모으세요." },
  { path: "/learn/recipes", title: "웹툰 제작 레시피", description: "작은 실험으로 연출의 차이를 확인하세요." },
  { path: "/story-lab", title: "스토리 연구실", description: "인물의 욕망과 갈등에서 첫 화를 설계하세요." },
  { path: "/discover/works", title: "만화·작법서 탐색", description: "도서 메타데이터와 기존 작품 검색을 연결합니다." },
  { path: "/publishing", title: "연재·출판 준비실", description: "원고, 권리, 소개 자료의 준비 상태를 점검하세요." },
  { path: "/insights/resources", title: "공식 자료·API 안내", description: "데이터 출처, 연결 범위와 이용조건을 확인하세요." },
];
export const RESOURCE_PAGE_TITLES: Record<string, string> = Object.fromEntries(RESOURCE_PAGES.map((page) => [page.path, page.title]));
export const RESOURCE_BUTTON = "inline-flex min-h-11 items-center justify-center rounded-xl border border-line px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
export const RESOURCE_INPUT = "min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
