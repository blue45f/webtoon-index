import {
  Search,
  Palette,
  Menu,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";

import { AuthMenuShell } from "../../domains/auth/components/auth-menu-shell";

import { ToonSpectrumMark } from "./visual-marks";

import { cx } from "@/shared/lib/cx";
import { useT } from "@/shared/lib/i18n";
import { keepInlineText } from "@/shared/lib/text";
import { useUi } from "@/shared/lib/ui-store";
import { isImmersiveMobileRoute } from "@/src/app/routes/immersive-mobile-route";
import { usePathname } from "@/src/compat/navigation";
import Link from "@/src/compat/router-link";

const NAV = [
  { i18n: "nav.home", href: "/", exact: true },
  { i18n: "nav.studio", href: "/studio" },
  { i18n: "nav.assets", href: "/market" },
  { i18n: "nav.creators", href: "/create" },
  { i18n: "nav.discover", href: "/explore" },
  { i18n: "nav.allMenu", href: "/sitemap" },
  { i18n: "footer.link.feedback", href: "/feedback" },
];

const MobileHeaderNavigation = lazy(() =>
  import("./site-header-mobile-nav").then((mod) => ({ default: mod.MobileHeaderNavigation }))
);

function useActive() {
  const path = usePathname();
  return (href: string, exact?: boolean) => {
    if (href === "/create") {
      return path === "/create" || path.startsWith("/create/") || path.startsWith("/studio");
    }
    return exact ? path === href : path === href || path.startsWith(href + "/");
  };
}

function matchesMobileNavigationViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

const DESKTOP_NAVIGATION_QUERY = "(min-width: 1360px)";

function useMobileNavigationViewport() {
  const [isMobile, setIsMobile] = useState(matchesMobileNavigationViewport);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

function MobileNavigationFallback() {
  return (
    <nav
      aria-hidden="true"
      className="fixed inset-x-0 bottom-0 z-50 h-[calc(3.75rem+env(safe-area-inset-bottom))] border-t border-line/80 bg-panel/90 backdrop-blur-xl md:hidden"
    />
  );
}

export function SiteHeader() {
  const isActive = useActive();
  const pathname = usePathname();
  const t = useT();
  const openSearch = useUi((s) => s.openCommandPalette);

  const [menuOpen, setMenuOpen] = useState(false);
  const isMobileNavigationViewport = useMobileNavigationViewport();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shouldRenderMobileNavigation = menuOpen || isMobileNavigationViewport;
  const hideBottomTabs = isImmersiveMobileRoute(pathname);

  // 수동으로 메뉴를 닫은 뒤에는 모달 배경의 inert 해제가 반영된 다음 호출 버튼으로 돌아간다.
  // 라우트 이동에 따른 자동 닫힘은 ScrollToTop이 본문 포커스를 소유하므로 이 경로를 쓰지 않는다.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  // 라우트 이동 시 오버플로 메뉴 닫기
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // CSS swaps the overflow trigger/dialog for the desktop navigation at 1360px. Close the
  // stateful modal at the same boundary so its focus trap, inert background, and scroll lock are
  // cleaned up instead of remaining attached to a display:none dialog. This automatic path does
  // not restore focus to the trigger because that trigger is hidden at the new breakpoint.
  useEffect(() => {
    const desktopNavigation = window.matchMedia(DESKTOP_NAVIGATION_QUERY);
    const closeAtDesktop = () => {
      if (desktopNavigation.matches) setMenuOpen(false);
    };
    closeAtDesktop();
    desktopNavigation.addEventListener("change", closeAtDesktop);
    return () => desktopNavigation.removeEventListener("change", closeAtDesktop);
  }, []);

  return (
    <>
      <header
        data-site-chrome="header"
        className="sticky top-0 z-50 border-b border-line/70 bg-gradient-to-b from-panel/90 to-panel/80 backdrop-blur-xl"
      >
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-2 px-4 sm:px-6">
          {/* 로고 */}
          <Link href="/" className="group flex shrink-0 items-center gap-2.5 whitespace-nowrap pr-2">
            <ToonSpectrumMark className="transition-transform duration-150 group-hover:scale-105" />
            <span className="flex items-center gap-1.5">
              <span className="font-display text-lg font-bold text-fg transition-colors group-hover:text-accent">
                {t("app.name")}
              </span>
              <span
                className="hidden rounded-[0.4rem] border border-accent/40 bg-accent/15 px-1.5 py-0.5 font-display text-[0.6rem] font-bold uppercase leading-none tracking-wide text-accent min-[400px]:inline"
                title={t("app.brandBeta")}
              >
                BETA
              </span>
            </span>
          </Link>

          {/* 데스크탑 내비 (≥1024px) — 9개 항목이 좁은 폭을 침범하지 않도록 lg에서만 노출.
              텍스트 전용 링크: 항목별 아이콘 박스는 EN 라벨 합산 폭이 컨테이너 상한(1320px)을
              넘겨 어느 뷰포트에서도 한 줄에 들어가지 않는다(아이콘은 오버플로/모바일 메뉴 담당). */}
          <nav className="ml-2 hidden items-center gap-0.5 min-[1360px]:flex">
            {NAV.map((n) => {
              const active = isActive(n.href, n.exact);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-2 text-sm font-medium transition-colors duration-150 xl:px-3",
                    active ? "text-accent" : "text-fg-2 hover:bg-raised/70 hover:text-fg"
                  )}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-full bg-accent-soft transition-colors duration-150"
                    />
                  )}
                  {t(n.i18n)}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* 검색 트리거 — lg(1024~1280px)에선 9개 내비와 폭을 절충해 한 단계 좁힘.
                힌트 텍스트는 truncate로 방어하고 ⌘K 배지는 그 구간만 양보(xl부터 복귀) */}
            <button
              onClick={openSearch}
              aria-label={t("nav.searchOpen")}
              className="flex h-10 items-center gap-2 rounded-xl border border-line bg-card/70 px-3 text-sm text-fg-3 transition-all duration-150 hover:border-line-strong hover:bg-card hover:text-fg-2 sm:w-48 sm:justify-between lg:w-40 xl:w-56"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Search size={16} className="shrink-0" />
                <span className="hidden truncate sm:inline">{t("nav.search")}</span>
              </span>
              <kbd
                aria-hidden="true"
                className="hidden items-center gap-0.5 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[0.65rem] sm:flex lg:hidden xl:flex"
              >
                ⌘K
              </kbd>
            </button>

            {/* 내 서재 — 모바일(<sm)에선 하단 탭바에 동일 항목이 있어 헤더 혼잡을 줄이려 숨긴다 */}
            <Link
              href="/studio"
              aria-label={t("nav.studio")}
              aria-current={isActive("/studio") ? "page" : undefined}
              className={cx(
                "group hidden h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium [text-wrap:nowrap] [word-break:keep-all] transition-colors sm:flex",
                isActive("/studio")
                  ? "bg-accent text-on-accent"
                  : "border border-line bg-card text-fg-2 hover:text-fg hover:border-line-strong"
              )}
            >
              <Palette size={16} className="shrink-0 text-fg-3 transition-colors group-hover:text-accent" />
              <span className="hidden min-w-max whitespace-nowrap [text-wrap:nowrap] [word-break:keep-all] xl:inline-block">
                {keepInlineText(t("nav.studio"))}
              </span>
            </Link>
            {/*
              사이트 계정 진입점은 AuthMenuShell 하나뿐이다.
              (Google/크리덴셜 세션 → 프로필·서재·설정·관리자·로그아웃)
              Firebase "회원" 버튼은 별도 세션이라 같은 GNB에 두지 않는다.
            */}
            <AuthMenuShell />

            {/* 오버플로 메뉴 트리거 (<1024px) — 모든 목적지 도달 보장 */}
            <button
              ref={triggerRef}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={t("nav.allMenu")}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              className="grid size-10 place-items-center rounded-xl border border-line bg-card text-fg-2 transition-colors hover:border-line-strong hover:text-fg min-[1360px]:hidden"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      {shouldRenderMobileNavigation && (
        <Suspense fallback={isMobileNavigationViewport && !hideBottomTabs ? <MobileNavigationFallback /> : null}>
          <MobileHeaderNavigation
            menuOpen={menuOpen}
            menuId={menuId}
            panelRef={panelRef}
            closeMenu={closeMenu}
            isActive={isActive}
            hideBottomTabs={hideBottomTabs}
          />
        </Suspense>
      )}
    </>
  );
}
