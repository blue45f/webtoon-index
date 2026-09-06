import { Link, useLocation } from "react-router-dom";

import { RESOURCE_BUTTON, RESOURCE_PAGES } from "./navigation";

import type { ReactNode } from "react";

export function ResourceLayout({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return <section className="mx-auto max-w-6xl space-y-8 px-4 py-8 text-fg sm:px-6 sm:py-12">
    <header className="space-y-4">
      <Link to="/creator-hub" className="text-sm font-semibold text-accent">TOONSTUDIO / 창작 허브</Link>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <p className="max-w-3xl text-base leading-7 text-fg-2">{intro}</p>
    </header>
    <nav aria-label="창작 자료 메뉴" className="flex flex-wrap gap-2">
      {RESOURCE_PAGES.slice(1).map((page) => <Link key={page.path} to={page.path} aria-current={pathname === page.path ? "page" : undefined}
        className={`${RESOURCE_BUTTON} ${pathname === page.path ? "bg-accent-soft text-accent" : "bg-panel"}`}>{page.title}</Link>)}
    </nav>
    {children}
    <footer className="flex flex-wrap gap-3 border-t border-line pt-6">
      <Link className={RESOURCE_BUTTON} to="/studio">스튜디오 열기</Link>
      <Link className={RESOURCE_BUTTON} to="/create">작품 갤러리</Link>
      <Link className={RESOURCE_BUTTON} to="/create/challenges">창작 챌린지</Link>
      <Link className={RESOURCE_BUTTON} to="/community">창작 커뮤니티</Link>
    </footer>
  </section>;
}
export function LocalSaveNotice({ error, saving = false, writable = true }: { error?: string; saving?: boolean; writable?: boolean }) {
  return <div className="rounded-xl border border-line bg-panel p-4 text-sm leading-6 text-fg-2">
    <p>자료와 기획서는 이 브라우저에만 저장됩니다. 계정·다른 기기로 동기화되지 않습니다. 공용 기기에서는 개인 작업 정보를 저장하지 마세요.</p>
    {saving && <p role="status">다른 탭의 변경을 확인하며 저장하고 있습니다…</p>}
    {!writable && <p className="mt-2">이 환경에서는 안전한 동시 저장을 사용할 수 없습니다. 읽기·내보내기는 가능하며, 저장은 HTTPS의 최신 브라우저를 이용하세요.</p>}
    {error && <p role="alert" className="mt-2 font-semibold text-fg">저장 오류: {error}</p>}
  </div>;
}
