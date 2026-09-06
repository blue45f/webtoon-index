import { type ReactNode, lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { shouldRenderAppSplash } from "./app-shell-splash";
import { AppRouter } from "./routes/AppRouter";

import { AuthSessionProvider } from "@/domains/auth/components/session-provider";
import { CommandPaletteHost } from "@/shared/components/command-palette-host";
import { RandomIntro } from "@/shared/components/RandomIntro";
import { pingVisit } from "@/shared/lib/visits-api";
import {
  isStudioRoutePathname,
  shouldPreserveStudioRouteLifecycle,
} from "@/src/domains/creator/studio-workspace-route";

// 공용 fx 키프레임/유틸(.pf-* + --ts-fx-* 토큰). 전역에서 한 번만 import 합니다.
import "@toonspectrum/core/fx/fx.css";

const AgeGateHost = lazy(() =>
  import("@/shared/components/age-gate-host").then((mod) => ({
    default: mod.AgeGateHost,
  })),
);
const StoreSync = lazy(() =>
  import("@/domains/auth/components/store-sync").then((mod) => ({
    default: mod.StoreSync,
  })),
);
const ToastHost = lazy(() =>
  import("@/shared/components/toast-host").then((mod) => ({ default: mod.ToastHost })),
);

// 라우트 전환 시 스크롤을 최상단으로 되돌리고, 본문 랜드마크로 포커스를 옮긴다(a11y).
// 첫 진입(직접 연 위치)은 포커스를 가로채지 않습니다.
function ScrollToTop() {
  const { pathname, search } = useLocation();
  const previousLocationRef = useRef<{ pathname: string; search: string } | null>(null);

  useEffect(() => {
    const previousLocation = previousLocationRef.current;
    const currentLocation = { pathname, search };
    previousLocationRef.current = currentLocation;
    // Search-only navigation was historically inert outside Studio. Preserve that behavior so
    // filters and search inputs do not repeatedly move focus to the main landmark.
    if (
      previousLocation?.pathname === pathname
      && !isStudioRoutePathname(pathname)
    ) return;
    if (
      previousLocation !== null
      && shouldPreserveStudioRouteLifecycle(previousLocation, currentLocation)
    ) {
      return;
    }
    globalThis.scrollTo({ top: 0, left: 0 });
    if (previousLocation === null) return;
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname, search]);

  return null;
}

function useDeferredByInput(timeoutMs = 4500) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    let timeoutId = 0;
    const activate = () => setReady(true);
    const options = { passive: true } as const;

    timeoutId = window.setTimeout(activate, timeoutMs);
    window.addEventListener("pointerdown", activate, options);
    window.addEventListener("keydown", activate);
    window.addEventListener("scroll", activate, options);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
      window.removeEventListener("scroll", activate);
    };
  }, [ready, timeoutMs]);

  return ready;
}

// 방문 핑 — 앱 마운트 시 하루 1회(localStorage 디바운스). best-effort, 렌더 비차단.
function useVisitPing() {
  useEffect(() => {
    void pingVisit();
  }, []);
}

function DeferredGlobalOverlays() {
  const ready = useDeferredByInput();
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <AgeGateHost />
      <ToastHost />
    </Suspense>
  );
}

export interface AppShellProps {
  /** 본문 위 상단 크롬. */
  header?: ReactNode;
  /** 본문 아래 푸터. */
  footer?: ReactNode;
  /** 자동 숨김 플로팅 컨트롤 클러스터. */
  floatingControls?: ReactNode;
  /** 콘텐츠 트리 밖(셸 최상위)에 얹는 오버레이. */
  chromeOverlay?: ReactNode;
  /** 인트로/스플래시 노출. 기본=RandomIntro(세션 1회). */
  splash?: ReactNode;
  /** `sr-only` 본문 바로가기 링크 노출. */
  showSkipLink?: boolean;
  /** `<main>`에 적용할 클래스. */
  mainClassName?: string;
}

/**
 * AppShell — 라우터 안에서 인증, 페이지, 커맨드 팔레트, 전역 오버레이,
 * 스토어 동기화, 스크롤·포커스 복원을 조립하는 웹 앱 본문 셸입니다.
 */
export function AppShell({
  header,
  footer,
  floatingControls,
  chromeOverlay,
  splash,
  showSkipLink = true,
  mainClassName = "min-h-screen pb-20 outline-none md:pb-0",
}: AppShellProps) {
  const { pathname, search } = useLocation();
  useVisitPing();
  return (
    <AuthSessionProvider>
      {pathname !== "/" && shouldRenderAppSplash(pathname, search) ? (splash ?? <RandomIntro />) : null}
      <Suspense fallback={null}>
        <StoreSync />
      </Suspense>
      <ScrollToTop />
      {showSkipLink && (
        <a
          href="#main-content"
          className="sr-only rounded-md focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-fg focus:px-4 focus:py-2 focus:font-semibold focus:text-canvas"
        >
          본문으로 건너뛰기
        </a>
      )}
      {header}
      <main id="main-content" tabIndex={-1} className={mainClassName}>
        <AppRouter />
      </main>
      {footer}
      <CommandPaletteHost />
      <DeferredGlobalOverlays />
      {floatingControls}
      {chromeOverlay}
    </AuthSessionProvider>
  );
}

export default AppShell;
