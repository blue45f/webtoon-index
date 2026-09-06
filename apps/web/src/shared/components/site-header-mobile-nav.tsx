import {
  BarChart3,
  CalendarDays,
  Compass,
  Home,
  Library,
  MessageCircle,
  MessageSquareQuote,
  Palette,
  Sparkles,
  Store,
  TrendingUp,
  UserRoundPen,
  X,
  Moon,
  Gamepad2,
} from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";

import { cx } from "@/shared/lib/cx";
import { useT } from "@/shared/lib/i18n";
import Link from "@/src/compat/router-link";

const MOBILE_NAV = [
  { i18n: "nav.home", href: "/", icon: Home, exact: true },
  { i18n: "nav.studio", href: "/studio", icon: Palette },
  { i18n: "nav.assets", href: "/market", icon: Store },
  { i18n: "nav.creators", href: "/create", icon: Palette },
  { i18n: "nav.discover", href: "/explore", icon: Compass },
  { i18n: "nav.ranking", href: "/ranking", icon: TrendingUp },
  { i18n: "nav.calendar", href: "/calendar", icon: CalendarDays },
  { i18n: "nav.recommend", href: "/recommend", icon: Sparkles },
  { i18n: "nav.fortune", href: "/fortune", icon: Moon },
  { i18n: "nav.play", href: "/play", icon: Gamepad2 },
  { i18n: "nav.reviews", href: "/reviews", icon: MessageSquareQuote },
  { i18n: "nav.community", href: "/community", icon: MessageCircle },
  { i18n: "footer.link.feedback", href: "/feedback", icon: MessageSquareQuote },
  { i18n: "nav.create", href: "/create", icon: Palette },
  { i18n: "nav.shaper", href: "/shaper", icon: UserRoundPen },
  { i18n: "nav.insights", href: "/insights", icon: BarChart3 },
];

// 모바일 하단 탭바: 빠른 접근용 핵심 4개 (+ 서재). 나머지(연재·리뷰·인사이트)는
// 햄버거 오버플로 메뉴로 모두 도달 가능하다.
const MOBILE_TABS = MOBILE_NAV.filter((n) =>
  ["/", "/studio", "/market", "/create", "/explore"].includes(n.href)
);

interface MobileHeaderNavigationProps {
  menuOpen: boolean;
  menuId: string;
  panelRef: RefObject<HTMLDivElement | null>;
  closeMenu: () => void;
  isActive: (href: string, exact?: boolean) => boolean;
  hideBottomTabs?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface BackgroundAttributeSnapshot {
  element: HTMLElement;
  ariaHidden: string | null;
  inert: string | null;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) =>
      element.tabIndex >= 0
      && !element.hidden
      && !element.closest("[hidden], [inert], [aria-hidden='true']")
  );
}

/** Isolate every DOM branch outside the menu while retaining the pointer-only scrim. */
function isolateMenuBranch(overlay: HTMLElement): () => void {
  const snapshots: BackgroundAttributeSnapshot[] = [];
  let branch: HTMLElement | null = overlay;

  while (branch?.parentElement) {
    const parent: HTMLElement = branch.parentElement;
    for (const sibling of [...parent.children]) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
      snapshots.push({
        element: sibling,
        ariaHidden: sibling.getAttribute("aria-hidden"),
        inert: sibling.getAttribute("inert"),
      });
      sibling.setAttribute("aria-hidden", "true");
      sibling.setAttribute("inert", "");
    }
    branch = parent;
    if (parent === overlay.ownerDocument.body) break;
  }

  return () => {
    for (const snapshot of snapshots) {
      if (snapshot.element.getAttribute("aria-hidden") === "true") {
        if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
        else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
      }
      if (snapshot.element.getAttribute("inert") === "") {
        if (snapshot.inert === null) snapshot.element.removeAttribute("inert");
        else snapshot.element.setAttribute("inert", snapshot.inert);
      }
    }
  };
}

export function MobileHeaderNavigation({
  menuOpen,
  menuId,
  panelRef,
  closeMenu,
  isActive,
  hideBottomTabs = false,
}: MobileHeaderNavigationProps) {
  const t = useT();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const dialog = panelRef.current;
    const overlay = overlayRef.current;
    if (!dialog || !overlay) return;

    // `overlayRef` is locally owned; deriving the document from the prop-owned
    // panel ref makes React Compiler conservatively treat scroll locking as a
    // prop mutation even though only the global document is changed.
    const ownerDocument = overlay.ownerDocument;
    const previousBodyOverflow = ownerDocument.body.style.overflow;
    const previousRootOverflow = ownerDocument.documentElement.style.overflow;
    ownerDocument.body.style.overflow = "hidden";
    ownerDocument.documentElement.style.overflow = "hidden";
    const restoreBackground = isolateMenuBranch(overlay);

    const focusFirst = () => {
      const requested = dialog.querySelector<HTMLElement>("[data-autofocus]");
      const target = requested ?? focusableElements(dialog)[0] ?? dialog;
      target.focus({ preventScroll: true });
    };
    const focusId = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        return;
      }
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = ownerDocument.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (dialog.contains(event.target as Node)) return;
      focusFirst();
    };

    ownerDocument.addEventListener("keydown", onKeyDown, true);
    ownerDocument.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.cancelAnimationFrame(focusId);
      ownerDocument.removeEventListener("keydown", onKeyDown, true);
      ownerDocument.removeEventListener("focusin", onFocusIn, true);
      ownerDocument.body.style.overflow = previousBodyOverflow;
      ownerDocument.documentElement.style.overflow = previousRootOverflow;
      restoreBackground();
    };
  }, [closeMenu, menuOpen, panelRef]);

  return (
    <>
      {/* 오버플로 메뉴 (<1360px): 목적지 전부 + 내 서재 */}
      {menuOpen && (
        <div ref={overlayRef} className="fixed inset-0 z-[60] min-[1360px]:hidden">
          <div
            aria-hidden="true"
            data-mobile-menu-backdrop="true"
            onPointerDown={closeMenu}
            className="absolute inset-0 bg-canvas/70 backdrop-blur-sm motion-safe:animate-fade-up"
          />
          <div
            ref={panelRef}
            id={menuId}
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.allMenu")}
            tabIndex={-1}
            className="absolute inset-x-0 top-0 max-h-[100dvh] overflow-y-auto border-b border-line-strong bg-gradient-to-b from-panel/95 to-card/90 shadow-2xl shadow-[oklch(0.1_0.02_70/0.5)] backdrop-blur-xl motion-safe:animate-fade-up"
          >
            <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-4 sm:px-6">
              <span className="font-display text-sm font-semibold text-fg-2">{t("nav.menu")}</span>
              <button
                data-autofocus
                onClick={closeMenu}
                aria-label={`${t("nav.allMenu")} ${t("common.close")}`}
                className="grid size-10 place-items-center rounded-xl border border-line bg-card text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="mx-auto max-w-[1320px] px-3 pb-4 sm:px-5">
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {MOBILE_NAV.map((n) => {
                  const active = isActive(n.href, n.exact);
                  const Icon = n.icon;
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "group flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition-colors duration-150",
                          active
                            ? "border-accent/35 bg-accent-soft text-accent"
                            : "border-line bg-card/60 text-fg-2 hover:border-line-strong hover:bg-raised/70 hover:text-fg"
                        )}
                      >
                        <span
                          className={cx(
                            "grid size-8 shrink-0 place-items-center rounded-lg border transition-colors duration-150",
                            active
                              ? "border-accent/35 bg-canvas/45"
                              : "border-line bg-canvas/40 group-hover:border-line-strong"
                          )}
                        >
                          <Icon
                            size={16}
                            className={cx(
                              "transition-colors",
                              active ? "text-accent" : "text-fg-3 group-hover:text-accent"
                            )}
                          />
                        </span>
                        {t(n.i18n)}
                      </Link>
                    </li>
                  );
                })}
                <li className="col-span-2 sm:col-span-3">
                  <Link
                    href="/library"
                    aria-current={isActive("/library") ? "page" : undefined}
                    className={cx(
                      "group flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition-colors duration-150",
                      isActive("/library")
                        ? "border-accent/35 bg-accent text-on-accent"
                        : "border-line bg-card/60 text-fg-2 hover:border-line-strong hover:bg-raised/70 hover:text-fg"
                    )}
                  >
                    <span
                      className={cx(
                        "grid size-8 shrink-0 place-items-center rounded-lg border transition-colors duration-150",
                        isActive("/library")
                          ? "border-on-accent/25 bg-on-accent/10"
                          : "border-line bg-canvas/40 group-hover:border-line-strong"
                      )}
                    >
                      <Library
                        size={16}
                        className={cx(
                          "transition-colors",
                          isActive("/library") ? "text-on-accent" : "text-fg-3 group-hover:text-accent"
                        )}
                      />
                    </span>
                    {t("nav.library")}
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      )}

      {/* 모바일 하단 탭바 (<768px): 빠른 접근용. 전체 목적지는 상단 햄버거 메뉴.
          /studio 등 자체 하단 도구막대를 쓰는 라우트에서는 겹치므로 hideBottomTabs로 뺀다. */}
      {!hideBottomTabs && (
        <nav
          aria-label={t("nav.quickAccess")}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-line/80 bg-panel/90 backdrop-blur-xl md:hidden"
        >
          <div className="mx-auto grid max-w-md grid-cols-6 pb-[env(safe-area-inset-bottom)]">
            {MOBILE_TABS.map((n) => {
              const active = isActive(n.href, n.exact);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative flex flex-col items-center gap-1 py-2.5 text-[0.65rem] font-medium transition-colors",
                    active ? "text-accent" : "text-fg-3"
                  )}
                >
                  {active && (
                    <span className="absolute left-1/2 top-0 h-0.5 w-10 -translate-x-1/2 rounded-full bg-accent" />
                  )}
                  <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
                  {t(n.i18n)}
                </Link>
              );
            })}
            <Link
              href="/library"
              aria-current={isActive("/library") ? "page" : undefined}
              className={cx(
                "flex flex-col items-center gap-1 py-2.5 text-[0.65rem] font-medium transition-colors",
                isActive("/library") ? "text-accent" : "text-fg-3"
              )}
            >
              <Library size={19} strokeWidth={isActive("/library") ? 2.4 : 1.9} />
              {t("nav.library")}
            </Link>
          </div>
        </nav>
      )}
    </>
  );
}
