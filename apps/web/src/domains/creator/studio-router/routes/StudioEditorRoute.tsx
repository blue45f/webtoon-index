import { Suspense, useEffect } from "react";


import { studioEditorInstanceKey } from "../../studio-editor-scope";
import { studioWorkspaceDocumentIdentity } from "../../studio-workspace-route";
import { StudioRouteLoading } from "../../StudioLazySurfaceFallback";
import { StudioDocumentLayout } from "../StudioDocumentLayout";
import { StudioDocumentRuntimeBoundary } from "../StudioDocumentRuntimeBoundary";
import { useStudioDraftScope } from "../useStudioDraftScope";

import type { StudioEditorRouteResolution } from "../studio-route-manifest";

import { lazyRetry } from "@/shared/lib/lazy-retry";
import { useSession } from "@/src/compat/auth-session-store";

const LegacyStudioEditorAdapter = lazyRetry(
  () => import("../../studio-legacy-editor-adapter").then((module) => ({
    default: module.LegacyStudioEditorAdapter,
  })),
  "LegacyStudioEditorAdapter",
);

export function StudioEditorRoute({ resolution }: {
  readonly resolution: StudioEditorRouteResolution;
}) {
  const { data: session } = useSession();
  const authScopeKey = session?.user?.id ?? null;
  const route = resolution.workspaceRoute;
  const identity = studioWorkspaceDocumentIdentity(route);
  const draftScope = useStudioDraftScope(identity, authScopeKey);
  const editorKey = studioEditorInstanceKey({
    authScopeKey,
    draftSessionEpoch: draftScope.epoch,
    remixId: route.remixSourceWorkId,
    workId: route.workId,
  });

  useEffect(() => {
    if (
      typeof window === "undefined"
      || typeof window.matchMedia !== "function"
      || window.matchMedia("(max-width: 1023px)").matches
    ) {
      return;
    }

    // Start the inspector request beside the editor chunk so the canvas remains the critical paint
    // without introducing a second waterfall for the desktop properties rail.
    void import("../../studio-inspector-aside-loader")
      .then(({ preloadStudioInspectorAside }) => preloadStudioInspectorAside())
      .catch(() => undefined);
  }, []);

  return (
    <StudioDocumentRuntimeBoundary documentKey={editorKey}>
      <StudioDocumentLayout
        draftSessionEpoch={draftScope.epoch}
        studioRoute={route}
      >
        <Suspense fallback={<StudioRouteLoading label="Studio 편집기를 여는 중..." />}>
          <LegacyStudioEditorAdapter
            remixId={route.remixSourceWorkId}
            studioRoute={route}
          />
        </Suspense>
      </StudioDocumentLayout>
    </StudioDocumentRuntimeBoundary>
  );
}
