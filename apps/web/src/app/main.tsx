import "../compat/polyfills"; // 최상단 브라우저 API 폴리필 보완
import "../compat/storage-migrate"; // 스토어 hydrate 전에 레거시 키 이관
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installStaticCatalog } from "../shared/catalog/catalog-static";

import App from "./App";
import { ensureSerifWebFontForRoute } from "./serif-webfont";
import "../styles/globals.css";

const STUDIO_BG3D_MAGIC_PRODUCTION_PROOF_QUERY =
  "__studioBg3dMagicProductionProof";

/**
 * Keep the production proof in Vite's graph without joining any product activation path.
 *
 * The verifier normally imports the emitted hashed asset directly. This opt-in URL gate is the
 * sole application-reachable boundary and is intentionally unrelated to modal mount, intent
 * preload, hover, focus, or the automatic Three capture bridge.
 */
function loadStudioBg3dMagicProductionProofFromExplicitDiagnosticQuery(): void {
  if (!import.meta.env.PROD) return;
  const search = new URLSearchParams(globalThis.location.search);
  if (search.get(STUDIO_BG3D_MAGIC_PRODUCTION_PROOF_QUERY) !== "1") return;
  void import("../domains/creator/bg3d/studio-bg3d-magic-production-proof");
}

// API 카탈로그 모드(기본): /api/* 서버 경로에서 KMAS 병합/런타임 정책을 적용한다.
// VITE_CATALOG_SOURCE=static 일 때만 정적 파일/클라이언트 계산 라우팅을 설치한다.
installStaticCatalog();
loadStudioBg3dMagicProductionProofFromExplicitDiagnosticQuery();
// --font-serif(Nanum Myeongjo)는 index.html 렌더 차단 경로에서 뺐다. 첫 진입 경로가 웹 크롬이면
// 여기서 — 렌더가 시작되기 전에 — 요청을 출발시켜 랜딩의 폰트 스왑 창이 넓어지지 않게 한다.
// 이후 SPA 라우팅은 App.tsx 의 SerifWebFontBridge 가 이어받는다(멱등).
ensureSerifWebFontForRoute(globalThis.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
// Service Worker 등록은 첫 페인트와 경쟁하지 않도록 load 이후 동적 import 로 미룬다.
// (정적 import 로 두면 등록 로직과 업데이트 프롬프트가 app entry 청크에 들어간다.)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const startServiceWorker = (): void => {
    void import("./service-worker/studio-service-worker-registration")
      .then((module) => {
        module.registerStudioServiceWorker();
      })
      .catch(() => {});
  };
  if (document.readyState === "complete") startServiceWorker();
  else globalThis.addEventListener("load", startServiceWorker, { once: true });
}
