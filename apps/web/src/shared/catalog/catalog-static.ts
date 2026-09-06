// 정적 카탈로그 fetch installer. Keep this module light: it is imported by main.tsx
// before the app renders. Heavy catalog search/ranking logic lives in catalog-static-engine
// and is loaded only for dynamic catalog routes.

const STATIC_MODE = import.meta.env.VITE_CATALOG_SOURCE === "static";

const STATIC_FILES: Record<string, string> = {
  "/api/home": "/data/home.json",
  "/api/calendar": "/data/calendar.json",
  "/api/insights": "/data/insights.json",
  "/api/tags": "/data/tags.json",
  "/api/authors": "/data/authors.json",
};

type StaticCatalogEngine = typeof import("./catalog-static-engine");

let enginePromise: Promise<StaticCatalogEngine> | null = null;

/** 정적 자산 경로 호환 헬퍼. 웹 단일 배포에서는 입력 경로를 그대로 사용합니다. */
export function resolveAssetUrl(url: string): string {
  return url;
}

function loadEngine(): Promise<StaticCatalogEngine> {
  enginePromise ??= import("./catalog-static-engine");
  return enginePromise;
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function precomputedRankingPath(pathname: string, sp: URLSearchParams): string | null {
  if (pathname !== "/api/ranking") return null;
  const isDefault =
    (sp.get("period") ?? "weekly") === "weekly" &&
    (sp.get("platform") ?? "all") === "all" &&
    (sp.get("genre") ?? "all") === "all" &&
    (sp.get("status") ?? "all") === "all" &&
    (sp.get("pricing") ?? "all") === "all" &&
    !sp.get("minRating") &&
    sp.get("rising") !== "true" &&
    sp.get("refresh") !== "true";
  if (!isDefault) return null;
  const axis = sp.get("axis") ?? "popular";
  const type = sp.get("type") ?? "all";
  return `/data/ranking/${encodeURIComponent(axis)}-${encodeURIComponent(type)}.json`;
}

function usesStaticCatalogEngine(pathname: string): boolean {
  return (
    pathname === "/api/search" ||
    pathname === "/api/random" ||
    pathname === "/api/ranking" ||
    pathname === "/api/explore" ||
    pathname === "/api/recommend" ||
    pathname === "/api/titles" ||
    (pathname.startsWith("/api/titles/") && !pathname.endsWith("/reviews")) ||
    pathname.startsWith("/api/authors/")
  );
}

/** 정적 카탈로그 모드에서 `/api` 읽기 요청을 로컬 스냅샷 엔진으로 연결합니다. */
export function installStaticCatalog(): void {
  if (
    !STATIC_MODE ||
    typeof window === "undefined" ||
    (globalThis.fetch as { __toonspectrumStatic?: boolean }).__toonspectrumStatic
  ) {
    return;
  }

  const origFetch = globalThis.fetch.bind(window);
  const route: typeof fetch = async (input, init) => {
    let pathname: string;
    let sp: URLSearchParams;
    try {
      const url = new URL(toUrl(input), globalThis.location.origin);
      pathname = url.pathname;
      sp = url.searchParams;
    } catch {
      return origFetch(input, init);
    }

    if (!pathname.startsWith("/api/")) return origFetch(input, init);

    // 매개변수 없는 카탈로그 화면은 브라우저 엔진 없이 미리 생성한 CDN 파일을 사용합니다.
    if (STATIC_FILES[pathname] && [...sp.keys()].length === 0) {
      return origFetch(STATIC_FILES[pathname], { ...init, cache: "default" });
    }

    // 기본 랭킹은 미리 계산한 파일을 우선 사용하고, 실패하거나 필터가 있으면 지연 엔진으로 넘어갑니다.
    const rankingPath = precomputedRankingPath(pathname, sp);
    if (rankingPath) {
      const response = await origFetch(rankingPath, { ...init, cache: "default" });
      if (response.ok) return response;
    }

    if (!usesStaticCatalogEngine(pathname)) return origFetch(input, init);

    const engine = await loadEngine();
    return engine.handleStaticCatalogRequest(pathname, sp, init, origFetch);
  };

  (route as { __toonspectrumStatic?: boolean }).__toonspectrumStatic = true;
  globalThis.fetch = route;
}
