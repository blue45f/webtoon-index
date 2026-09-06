import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";

import { checkBrowserCompatibility, type BrowserCompatibilityResult } from "../compat/browser-check";
import { BrowserCompatModal } from "../components/browser-compat-modal";
import { apiPath } from "../infrastructure/api";

import { AppShell } from "./AppShell";
import { isImmersiveMobileRoute } from "./routes/immersive-mobile-route";
import { ensureSerifWebFontForRoute } from "./serif-webfont";

import { FloatingControls } from "@/shared/components/FloatingControls";
import { SiteHeader } from "@/shared/components/site-header";
import { withCsrfProtection } from "@/shared/lib/csrf";
import { useUi } from "@/shared/lib/ui-store";

const BackToTop = lazy(() =>
  import("@/shared/components/back-to-top").then((mod) => ({
    default: mod.BackToTop,
  })),
);
const DeskCloudMounts = lazy(() =>
  import("@/src/components/deskcloud-native/DeskCloudMounts").then((mod) => ({
    default: mod.DeskCloudMounts,
  })),
);
const SiteFooter = lazy(() =>
  import("@/shared/components/site-footer").then((mod) => ({
    default: mod.SiteFooter,
  })),
);
const StudioBg3dRetainedOwnerHost = lazy(() =>
  import("../domains/creator/bg3d/StudioBg3dRetainedOwnerHost").then((mod) => ({
    default: mod.StudioBg3dRetainedOwnerHost,
  })),
);
const TrafficAnalyticsBridge = lazy(() =>
  import("./traffic-analytics/TrafficAnalyticsBridge").then((mod) => ({
    default: mod.TrafficAnalyticsBridge,
  })),
);

const HAS_DESKCLOUD_MOUNTS = Boolean(
  import.meta.env.VITE_SURVEYDESK_URL ||
  import.meta.env.VITE_CHANGELOGDESK_URL ||
  import.meta.env.VITE_NOTIFYDESK_URL,
);
const TRAFFIC_ANALYTICS_ENABLED =
  import.meta.env.PROD
  && import.meta.env.VITE_TRAFFIC_ANALYTICS_ENABLED !== "false";
let kmasEntryMergeStarted = false;

function useDeferredByScroll(timeoutMs = 6500) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    let timeoutId = 0;
    const activate = () => setReady(true);
    const options = { passive: true } as const;

    timeoutId = window.setTimeout(activate, timeoutMs);
    window.addEventListener("scroll", activate, options);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("scroll", activate);
    };
  }, [ready, timeoutMs]);

  return ready;
}

function DeskCloudHost() {
  if (!HAS_DESKCLOUD_MOUNTS) return null;
  return (
    <Suspense fallback={null}>
      <DeskCloudMounts />
    </Suspense>
  );
}

function DeferredFooter() {
  const ready = useDeferredByScroll();
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <SiteFooter />
    </Suspense>
  );
}

function DeferredBackToTop() {
  const ready = useDeferredByScroll();
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <BackToTop />
    </Suspense>
  );
}

function useKmasEntryMerge() {
  useEffect(() => {
    if (kmasEntryMergeStarted || import.meta.env.VITE_CATALOG_SOURCE === "static") return;
    kmasEntryMergeStarted = true;
    const run = () => {
      fetch(apiPath("/api/kmas/merge-on-access"), withCsrfProtection({
        method: "POST",
        cache: "no-store",
        keepalive: true,
      })).catch(() => {
        kmasEntryMergeStarted = false;
      });
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const handle = (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(run, { timeout: 3000 });
      return () => {
        if ("cancelIdleCallback" in window) {
          (window as unknown as { cancelIdleCallback: (h: number) => void }).cancelIdleCallback(handle);
        }
      };
    }
    const timer = setTimeout(run, 1500);
    return () => clearTimeout(timer);
  }, []);
}

/**
 * Studio 모바일은 2단 하단 도크와 선택 컨텍스트 바를 직접 소유한다. 그 위에 전역 설정
 * 버튼을 다시 띄우면 375px 화면에서 핵심 도구를 가리므로 모바일에서만 숨긴다. 데스크톱은
 * 테마·언어 접근을 유지한다(클릭 이펙트·BGM 컨트롤은 제거됨).
 */
function WebFloatingControls() {
  const { pathname } = useLocation();
  const hideOnMobile = isImmersiveMobileRoute(pathname);

  return (
    <FloatingControls
      placement="bottom-left"
      showSound={false}
      showBgm={false}
      className={hideOnMobile ? "max-md:hidden" : undefined}
    />
  );
}

/**
 * Route-level immersive owner: site GNB/footer never flash on /studio (including the
 * lazy StudioPage load gap). Release only when leaving the studio path.
 */
function StudioRouteImmersiveBridge() {
  const { pathname } = useLocation();
  const acquireImmersiveSurface = useUi((state) => state.acquireImmersiveSurface);
  const releaseImmersiveSurface = useUi((state) => state.releaseImmersiveSurface);
  const onStudioPath = isImmersiveMobileRoute(pathname);

  useEffect(() => {
    if (!onStudioPath) return;
    acquireImmersiveSurface("studio");
    return () => {
      releaseImmersiveSurface("studio");
    };
  }, [acquireImmersiveSurface, onStudioPath, releaseImmersiveSurface]);

  return null;
}

/**
 * --font-serif(Nanum Myeongjo) 소유자 — 웹 크롬 경로에서만 스타일시트를 주입한다.
 * 최초 진입은 main.tsx 가 렌더 전에 처리하므로, 여기는 /studio 에서 웹 라우트로 넘어오는
 * SPA 전환을 덮는 몫이다(멱등이라 겹쳐 불려도 <link>는 하나).
 */
function SerifWebFontBridge() {
  const { pathname } = useLocation();

  useEffect(() => {
    ensureSerifWebFontForRoute(pathname);
  }, [pathname]);

  return null;
}

// 웹 앱 — 공유 AppShell 을 BrowserRouter(실 URL/history) 안에서 마운트하고 웹 전용 크롬을 주입한다.
export default function App() {
  const [compatResult, setCompatResult] = useState<BrowserCompatibilityResult | null>(null);
  const [showCompatModal, setShowCompatModal] = useState(false);
  const studioImmersive = useUi((state) => state.immersiveSurface === "studio");

  useKmasEntryMerge();

  useEffect(() => {
    const res = checkBrowserCompatibility();
    setCompatResult(res);
    // 추천 업데이트 대상이고, 세션 내에서 사용자가 아직 닫지 않았을 때 팝업 표시
    const dismissed = sessionStorage.getItem("toonspectrum-compat-dismissed");
    if (res.recommendUpdate && !dismissed) {
      setShowCompatModal(true);
    }
  }, []);

  const handleCloseCompatModal = () => {
    setShowCompatModal(false);
    sessionStorage.setItem("toonspectrum-compat-dismissed", "true");
  };

  return (
    <BrowserRouter>
      {TRAFFIC_ANALYTICS_ENABLED ? (
        <Suspense fallback={null}>
          <TrafficAnalyticsBridge />
        </Suspense>
      ) : null}
      <StudioRouteImmersiveBridge />
      <SerifWebFontBridge />
      <AppShell
        header={studioImmersive ? null : <SiteHeader />}
        footer={studioImmersive ? null : <DeferredFooter />}
        floatingControls={studioImmersive ? null : <WebFloatingControls />}
        // Studio owns its shell — hide site skip-to-content chrome too.
        showSkipLink={!studioImmersive}
        mainClassName={
          studioImmersive
            ? "min-h-0 h-[100dvh] overflow-hidden outline-none pb-0"
            : "min-h-screen pb-20 outline-none md:pb-0"
        }
        chromeOverlay={
          <>
            <Suspense fallback={null}>
              <StudioBg3dRetainedOwnerHost />
            </Suspense>
            {!studioImmersive ? (
              <>
                <DeferredBackToTop />
                <DeskCloudHost />
              </>
            ) : null}
            {compatResult && (
              <BrowserCompatModal
                isOpen={showCompatModal}
                onClose={handleCloseCompatModal}
                missingFeatures={compatResult.missingFeatures}
              />
            )}
          </>
        }
      />
    </BrowserRouter>
  );
}
