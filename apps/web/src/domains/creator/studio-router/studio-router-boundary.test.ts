import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const routerSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-router/StudioRouter.tsx"),
  "utf8",
);
const appRouterSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/app/routes/AppRouter.tsx"),
  "utf8",
);
const creatorRoutesSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/app/routes/groups/creator.routes.tsx"),
  "utf8",
);
const editorRouteSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-router/routes/StudioEditorRoute.tsx"),
  "utf8",
);
const publishRouteSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-router/routes/StudioPublishRoute.tsx"),
  "utf8",
);
const legacyEditorSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx"),
  "utf8",
);
const legacyEditorAdapterSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-legacy-editor-adapter.tsx"),
  "utf8",
);
const documentLayoutSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-router/StudioDocumentLayout.tsx"),
  "utf8",
);
const dccWorkbenchNavigationSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/src/domains/creator/studio-router/studio-dcc-workbench-navigation.ts",
  ),
  "utf8",
);
const dccWorkbenchSurfaceSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/src/domains/creator/studio-router/StudioDccWorkbenchRoute.tsx",
  ),
  "utf8",
);
const dccWorkbenchRouteSource =
  `${dccWorkbenchNavigationSource}\n${dccWorkbenchSurfaceSource}`;

describe("Studio router bundle boundaries", () => {
  it("loads editor and publish surfaces through independent route modules", () => {
    expect(publishRouteSource).toContain('import("../../StudioUploadPublish")');
    expect(editorRouteSource).toContain('import("../../studio-legacy-editor-adapter")');
    expect(routerSource).not.toContain("StudioUploadPublish");
    expect(routerSource).not.toContain("studio-legacy-editor-adapter");
    expect(routerSource).not.toMatch(/from\s+["']\.\.\/StudioPage["']/u);
    expect(legacyEditorSource).not.toContain("StudioUploadPublish,");
  });

  it("gives AppRouter one domain-owned lazy Studio entry instead of competing flat routes", () => {
    expect(appRouterSource).toContain('import { appRoutes } from "./groups/app-routes"');
    expect(appRouterSource).toContain("appRoutes.map");
    expect(creatorRoutesSource).toContain(
      'import("@/src/domains/creator/studio-router/StudioRouter")',
    );
    expect(creatorRoutesSource).toContain(
      '{ id: "creator-studio", path: "/studio/*", element: <StudioRouter /> }',
    );
    expect(creatorRoutesSource).not.toContain('path: "/studio/tools-companion"');
    expect(creatorRoutesSource).not.toContain('import("@/src/domains/creator/StudioPage")');
  });

  it("keeps URL and editor-key ownership outside the legacy adapter", () => {
    const adapterSource = legacyEditorAdapterSource;
    expect(adapterSource).toContain("export function LegacyStudioEditorAdapter");
    expect(adapterSource).toContain("remixId={remixId}");
    expect(adapterSource).not.toContain("useLocation");
    expect(adapterSource).not.toContain("useSearchParams");
    expect(adapterSource).not.toContain("studioEditorInstanceKey");
  });

  it("nests the document layout inside the runtime boundary without collapsing the key layers", () => {
    // Two-layer keying: the boundary keys by auth+epoch (studioEditorInstanceKey), the layout does
    // not key at all — it inherits the boundary's lifetime so surface switches preserve it.
    const boundaryOpenIndex = editorRouteSource.indexOf(
      "<StudioDocumentRuntimeBoundary documentKey={editorKey}>",
    );
    const layoutOpenIndex = editorRouteSource.indexOf("<StudioDocumentLayout");
    const adapterIndex = editorRouteSource.indexOf("<LegacyStudioEditorAdapter");
    expect(boundaryOpenIndex).toBeGreaterThanOrEqual(0);
    expect(layoutOpenIndex).toBeGreaterThan(boundaryOpenIndex);
    expect(adapterIndex).toBeGreaterThan(layoutOpenIndex);
    expect(editorRouteSource).toContain("draftSessionEpoch={draftScope.epoch}");
    expect(documentLayoutSource).not.toMatch(/import[^;]*studio-editor-scope/u);
    expect(documentLayoutSource).not.toMatch(/\skey=\{/u);
  });

  it("moves live-session identity ownership out of the legacy page and into the layout", () => {
    expect(documentLayoutSource).toContain("useSearchParams");
    expect(documentLayoutSource).toContain("readStudioLiveRoomQuery");
    expect(documentLayoutSource).toContain("useStudioDocumentRuntime()");
    expect(documentLayoutSource).not.toContain("useLocation");
    expect(legacyEditorSource).not.toContain("readStudioLiveRoomQuery");
    expect(legacyEditorSource).not.toContain("setSearchParams");
    expect(legacyEditorSource).toContain("useStudioDocumentLayout()");
  });

  it("moves the DCC route/navigation half out of the legacy page into the workbench route", () => {
    // Href construction, the v1 return receipt and back-navigation all live in the route module.
    for (const symbol of [
      "createStudioDccNavigationState",
      "studioCanvasHref",
      "studioDccHref",
      "studioWorkspaceReturnHref",
      "navigate(-1)",
    ]) {
      expect(dccWorkbenchRouteSource).toContain(symbol);
      expect(legacyEditorSource).not.toContain(symbol);
    }
    // Surface-scoped lifecycle (pagehide flush, denied-access auto-close) moved with it, and it
    // lives in the component half so it can only run while the DCC surface node is mounted.
    expect(dccWorkbenchSurfaceSource).toContain('globalThis.addEventListener("pagehide"');
    expect(dccWorkbenchSurfaceSource).toContain('dccRouteAccess !== "denied"');
    expect(dccWorkbenchSurfaceSource).not.toContain("useNavigate");
    expect(legacyEditorSource).not.toContain('globalThis.addEventListener("pagehide", flushBeforeDocumentExit)');
    // The route reads document identity from the layout instead of re-parsing the URL.
    expect(dccWorkbenchNavigationSource).toContain("useStudioDocumentLayout()");
    expect(dccWorkbenchRouteSource).not.toContain("useSearchParams");
    expect(dccWorkbenchRouteSource).not.toContain("resolveStudioDccRouteAccess");
    // The legacy page keeps only the access verdict and the editor-side UI hooks it injects.
    expect(legacyEditorSource).toContain("resolveStudioDccRouteAccess({");
    expect(legacyEditorSource).toContain("useStudioDccWorkbenchNavigation({");
    expect(legacyEditorSource).toContain("<StudioDccWorkbenchRoute");
  });
});
