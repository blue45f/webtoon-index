import Link from "@/src/compat/router-link";

const routes = [
  ["/", "홈", "통합 카탈로그와 추천 진입점"],
  ["/ranking", "통합 랭킹", "작품 랭킹"],
  ["/search", "검색", "작품·작가 검색"],
  ["/recommend", "맞춤 추천", "취향 기반 추천"],
  ["/explore", "스펙트럼 탐색", "장르·태그 탐색"],
  ["/calendar", "연재 캘린더", "요일별 연재"],
  ["/reviews", "리뷰", "리뷰 피드"],
  ["/community", "커뮤니티", "커뮤니티 허브"],
  ["/community/cafes", "장르 카페", "카페 목록"],
  ["/community/cafes/:slug", "카페 상세", "카페별 게시판"],
  ["/community/post/:id", "게시글", "커뮤니티 글 상세"],
  ["/community/:scope", "커뮤니티 범위", "범위별 커뮤니티"],
  ["/library", "내 서재", "저장 작품"],
  ["/compare", "작품 비교", "작품 비교 도구"],
  ["/random", "랜덤 발견", "랜덤 추천"],
  ["/insights", "트렌드 인사이트", "트렌드 대시보드"],
  ["/feedback", "제보·제안 커뮤니티", "버그·아이디어·기능 요청과 처리 현황"],
  ["/tags", "태그로 찾기", "태그 목록"],
  ["/authors", "작가별 보기", "작가 디렉터리"],
  ["/u/:userId", "회원 프로필", "사용자 공개 프로필"],
  ["/news", "소식", "웹툰·웹소설 뉴스"],
  ["/settings", "설정", "사용자 설정"],
  ["/about", "소개", "서비스 소개"],
  ["/guide", "랭킹 산정 방식", "랭킹 설명"],
  ["/terms", "이용약관", "정책 문서"],
  ["/privacy", "개인정보처리방침", "정책 문서"],
  ["/copyright", "저작권 안내", "콘텐츠 안내"],
  ["/contact", "광고·제휴 문의", "비즈니스 문의"],
  ["/support", "문의", "공개 문의 게시판"],
  ["/create", "창작 게시판", "창작 홈"],
  ["/create/challenges", "창작 챌린지", "챌린지 목록"],
  ["/create/series/:id", "시리즈 편집", "시리즈 창작"],
  ["/create/:id", "창작물 상세", "작품 창작"],
  ["/studio", "창작 스튜디오", "창작 도구"],
  ["/references", "만화 레퍼런스", "KMAS 자료 탐색·개인 연구노트"],
  ["/shaper", "캐릭터 셰이퍼", "3D 웹툰 캐릭터 프리셋 도구 안내"],
  ["/market", "창작 마켓", "스튜디오 공유 리소스 마켓"],
  ["/market/browse", "마켓 탐색", "리소스 검색·필터"],
  ["/market/resource/:id", "리소스 상세", "공유 리소스 상세"],
  ["/me", "내 정보", "계정 페이지"],
  ["/title/:slug", "작품 상세", "작품 상세 정보"],
  ["/author/:name", "작가 상세", "작가 작품"],
  ["/pencafe/:name", "펜카페", "팬 커뮤니티"],
  ["/admin", "관리자 콘솔", "운영 관리"],
  ["/admin/community", "커뮤니티 관리", "운영자 모더레이션"],
  ["/admin/members", "회원 관리", "운영자 회원 관리"],
  ["/auth/callback", "인증 콜백", "로그인 처리"],
  ["/design", "디자인 시스템", "토큰과 컴포넌트 스타일가이드"],
] as const;

export function SitemapPage() {
  return (
    <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-10">
      <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
        <p className="eyebrow text-accent">BETA Sitemap</p>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,7vw,1.875rem)] font-bold sm:text-4xl">툰스펙트럼 사이트맵</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-2">
          탐색, 커뮤니티, 창작, 계정, 정책, 디자인 시스템 경로를 한 화면에 정리했습니다.
        </p>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {routes.map(([href, label, helper]) => (
          <Link
            key={href}
            href={href}
            className="grid min-h-28 gap-2 rounded-xl border border-line bg-card/70 p-4 transition-colors hover:border-accent/60"
          >
            <strong>{label}</strong>
            <small className="text-sm leading-5 text-fg-2">{helper}</small>
            <code className="text-xs text-fg-3 [overflow-wrap:anywhere]">{href}</code>
          </Link>
        ))}
      </section>
    </main>
  );
}
