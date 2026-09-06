import { Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { appRoutes } from "./groups/app-routes";
import { RouteFallback } from "./route-fallback";
import { RouteStage } from "./route-stage";
import { useRouteTitle } from "./route-titles";

import { lazyRetry } from "@/shared/lib/lazy-retry";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { isStudioRoutePathname } from "@/src/domains/creator/studio-workspace-route";

function readInitialDocumentPathname(): string | null {
  try {
    return typeof globalThis.location?.pathname === "string"
      ? globalThis.location.pathname
      : null;
  } catch {
    return null;
  }
}

// This module lives for one browser document. Retain the initial delivery mode across SPA
// transitions because a document opened on `/studio` may keep COOP even when COEP is unavailable.
const INITIAL_DOCUMENT_PATHNAME = readInitialDocumentPathname();

const StudioCrossOriginIsolationGate = lazyRetry(
  () => import("@/src/app/StudioCrossOriginIsolationGate").then((module) => ({
    default: module.StudioCrossOriginIsolationGate,
  })),
  "StudioCrossOriginIsolationGate",
);

function AppRouteTree({ pathname, search }: {
  readonly pathname: string;
  readonly search: string;
}) {
  return (
    <RouteStage pathname={pathname} search={search}>
      <ErrorBoundary resetKey={`${pathname}${search}`}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {appRoutes.map(({ element, id, path }) => (
              <Route key={id} id={id} path={path} element={element} />
            ))}
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </RouteStage>
  );
}

export function AppRouter() {
  const { pathname, search } = useLocation();
  useRouteTitle(pathname, search);

  const documentWasStudio = isStudioRoutePathname(
    INITIAL_DOCUMENT_PATHNAME ?? pathname,
  );
  const routeTree = <AppRouteTree pathname={pathname} search={search} />;
  const needsIsolationGate =
    isStudioRoutePathname(pathname)
    || documentWasStudio
    || globalThis.crossOriginIsolated === true;

  if (!needsIsolationGate) return routeTree;

  return (
    <Suspense fallback={<RouteFallback />}>
      <StudioCrossOriginIsolationGate
        pathname={pathname}
        documentWasStudio={documentWasStudio}
        pending={<RouteFallback />}
      >
        {routeTree}
      </StudioCrossOriginIsolationGate>
    </Suspense>
  );
}
