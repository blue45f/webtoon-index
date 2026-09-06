import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "../read-studio-inspector-aside-source";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioCuttoonEditorSource();
const inspectorSource = readStudioInspectorAsideSurface();
const stackSource = readFileSync(
  new URL("./StudioDrawingPaletteStack.tsx", import.meta.url),
  "utf8",
);
const lazyRegistrySource = readFileSync(
  new URL("../studio-page-lazy-ui.ts", import.meta.url),
  "utf8",
);
const workspaceSource = readFileSync(
  new URL("../studio-workspaces.ts", import.meta.url),
  "utf8",
);
const viteSource = readFileSync(
  new URL("../../../../config/vite-manual-chunks.ts", import.meta.url),
  "utf8",
);

function sourceBetween(
  source: string,
  startToken: string,
  endToken: string,
  label: string,
): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing ${label} source boundary: ${startToken} -> ${endToken}`);
  }
  return source.slice(start, end);
}

describe("Studio drawing palette workspace integration boundary", () => {
  it("co-locates palette persistence with the eager workspace chunk", () => {
    const workspaceChunk = sourceBetween(
      viteSource,
      'id.endsWith("/src/domains/creator/studio-workspaces.ts")',
      'return "studio-workspaces"',
      "workspace manual chunk",
    );

    expect(workspaceChunk).toContain(
      'id.endsWith("/src/domains/creator/brush/studio-drawing-palettes.ts")',
    );
  });

  it("owns drawing palettes in workspace v3 and initializes the live page model from them", () => {
    const layoutContract = sourceBetween(
      workspaceSource,
      "export interface StudioWorkspaceLayout",
      "export interface StudioDefaultWorkspace",
      "workspace layout",
    );
    const frozenLayout = sourceBetween(
      workspaceSource,
      "function freezeLayout",
      "function createQuickActions",
      "workspace normalization",
    );
    const pageInitialization = sourceBetween(
      pageSource,
      "const [workspacePersistence, setWorkspacePersistence]",
      "const [drawingPaletteDragging, setDrawingPaletteDragging]",
      "page palette initialization",
    );
    const liveLayout = sourceBetween(
      pageSource,
      "const liveWorkspaceLayout = useMemo",
      "const workspacePersistenceRef",
      "page live workspace layout",
    );

    // The palette layout has been part of the workspace envelope since v3; the device-override
    // axis moved it to v4. Both constants must keep moving together.
    expect(workspaceSource).toContain(
      "export const STUDIO_WORKSPACE_STATE_VERSION = 4 as const",
    );
    expect(workspaceSource).toContain(
      "export const STUDIO_WORKSPACE_PAYLOAD_VERSION = 4 as const",
    );
    expect(layoutContract).toContain(
      "readonly drawingPalettes: StudioDrawingPaletteLayout",
    );
    expect(frozenLayout).toContain(
      "drawingPalettes: normalizeStudioDrawingPaletteLayout(",
    );
    expect(pageInitialization).toContain(
      "useState<StudioDrawingPaletteLayout>",
    );
    expect(pageInitialization).toContain(
      "() => workspaceState.liveLayout.drawingPalettes",
    );
    expect(liveLayout).toContain("drawingPalettes: drawingPaletteLayout");
    expect(liveLayout).toContain("drawingPaletteLayout,");
  });

  it("persists settled palette sizes through the SQLite workspace runtime", () => {
    const paletteState = sourceBetween(
      pageSource,
      "const [drawingPaletteDragging, setDrawingPaletteDragging]",
      "// 모바일(<lg) 레이아웃",
      "page palette drag state",
    );
    const dragController = sourceBetween(
      pageSource,
      "function changeDrawingPaletteDragging",
      "function applyStudioWorkspaceLayout",
      "page palette drag controller",
    );
    // Intentional change (B-08 extraction): the SQLite/OPFS persistence cluster moved to
    // studio-page-workspace-persistence.ts, so the apply block in StudioPage now ends at the
    // extracted hook's call site instead of the old inline snapshot helper.
    const applyLayout = sourceBetween(
      pageSource,
      "function applyStudioWorkspaceLayout",
      "useStudioPageWorkspacePersistence(",
      "workspace apply",
    );
    const ownerSync = sourceBetween(
      pageSource,
      "// owner가 바뀔 때마다 별도의 SQLite/OPFS runtime을 열고",
      "// 드래그나 작업공간 메뉴 편집과 겹친 외부 revision은",
      "workspace owner hydration",
    );
    const pendingReplay = sourceBetween(
      pageSource,
      "// 드래그나 작업공간 메뉴 편집과 겹친 외부 revision은",
      "// 활성 프리셋 스냅샷은 그대로 두고",
      "pending external workspace replay",
    );
    const autosave = sourceBetween(
      pageSource,
      "// 활성 프리셋 스냅샷은 그대로 두고",
      "// 재사용 클립 보관함",
      "workspace autosave",
    );

    expect(paletteState).toContain("const drawingPaletteDraggingRef = useRef(false)");
    expect(paletteState).toContain(
      "const [drawingPaletteCancelEpoch, setDrawingPaletteCancelEpoch] = useState(0)",
    );
    expect(paletteState).toContain(
      "const [pendingExternalWorkspaceSync, setPendingExternalWorkspaceSync]",
    );
    expect(pageSource).toContain("interface PendingStudioWorkspaceSync");
    expect(pageSource).toContain("readonly ownerScope: string;");
    expect(pageSource).toContain("readonly authorityRevision: number;");
    expect(pageSource).toContain("readonly sequence: number;");
    expect(pageSource).toContain("readonly baseState: StudioWorkspaceState;");
    expect(pageSource).not.toContain("readonly latestEventRaw: string | null;");
    expect(pageSource).not.toContain("readonly storageKey: string;");

    expect(dragController).toContain("drawingPaletteDraggingRef.current = next");
    expect(dragController).toContain("setDrawingPaletteDragging(next)");
    expect(dragController).toContain("setDrawingPaletteCancelEpoch((current) => current + 1)");
    expect(applyLayout.indexOf("cancelDrawingPaletteDrag()")).toBeLessThan(
      applyLayout.indexOf("setDrawingPaletteLayout(presented.drawingPalettes)"),
    );

    expect(ownerSync).toContain("createStudioWorkspacePersistenceRuntime({");
    expect(ownerSync).toContain('import("./studio-workspace-sqlite-runtime")');
    expect(ownerSync).toContain("runtime.subscribeInvalidation((invalidation) => {");
    expect(ownerSync).toContain("await runtime.hydrate({");
    expect(ownerSync).toContain('result.failure === "ownership-busy"');
    expect(ownerSync).toContain("getDirtyRevision: () => workspaceDirtyRevisionRef.current");
    expect(ownerSync).toContain("authorityRevision: Math.max(");
    expect(ownerSync).not.toContain("localStorage");
    expect(ownerSync).not.toContain('window.addEventListener("storage"');

    expect(pendingReplay).toContain("leftResize.dragging");
    expect(pendingReplay).toContain("rightResize.dragging");
    expect(pendingReplay).toContain("drawingPaletteDragging");
    expect(pendingReplay).toContain(
      "'[data-testid=\"studio-workspace-dialog\"]:not([hidden])'",
    );
    expect(pendingReplay).toContain("void runtime.reconcile({");
    expect(pendingReplay).toContain("baseState: pendingSync.baseState");
    expect(pendingReplay).toContain(
      "getDirtyRevision: () => workspaceDirtyRevisionRef.current",
    );
    expect(pendingReplay).toContain("result.conflictPaths.length > 0");
    expect(pendingReplay).toContain('"external-sync"');
    expect(pendingReplay).not.toContain("loadStudioWorkspacePersistence");
    expect(pendingReplay).not.toContain("saveStudioWorkspaceState");

    expect(autosave).toContain(
      "if (leftResize.dragging || rightResize.dragging || drawingPaletteDragging) return",
    );
    expect(autosave).toContain("if (pendingExternalWorkspaceSync) return");
    expect(autosave).toContain("drawingPalettes: drawingPaletteLayout");
    expect(autosave).toContain("persistStudioWorkspaceStateFromEffect(");
    expect(autosave).not.toContain("localStorage");
  });

  it("keeps menu edits session-atomic until verified SQLite persistence completes", () => {
    const persist = sourceBetween(
      pageSource,
      "function persistStudioWorkspaceState",
      "// owner가 바뀔 때마다 별도의 SQLite/OPFS runtime을 열고",
      "direct workspace persistence",
    );
    const pendingReplay = sourceBetween(
      pageSource,
      "// 드래그나 작업공간 메뉴 편집과 겹친 외부 revision은",
      "// 활성 프리셋 스냅샷은 그대로 두고",
      "pending external workspace replay",
    );

    expect(persist).toContain(
      "const guardRevision = workspaceDirtyRevisionRef.current + 1",
    );
    expect(persist).toContain(
      "const blockedByExternalMerge = pendingExternalWorkspaceSyncRef.current !== null",
    );
    expect(persist).toContain("status: \"session-only\"");
    expect(persist).toContain("updateWorkspacePersistenceSnapshot(optimistic)");
    expect(persist.indexOf("blockedByExternalMerge")).toBeLessThan(
      persist.indexOf("void runtime.save("),
    );
    expect(persist).toContain(
      "result.guardRevision !== workspaceDirtyRevisionRef.current",
    );
    expect(persist).not.toContain("localStorage");
    expect(persist).not.toContain("saveStudioWorkspaceState");

    expect(pendingReplay).toContain("void runtime.reconcile({");
    expect(pendingReplay).toContain("workspaceSyncBaseStateRef.current = result.state");
    expect(pendingReplay).toContain("state: result.state");
    expect(pendingReplay).not.toContain("reconcileStudioWorkspacePendingSync");
  });


  it("keeps cancellation and lazy palette ownership controlled from Page through Aside", () => {
    const pageHandlers = sourceBetween(
      pageSource,
      "const studioInspectorAsideHandlers",
      "const studioCanvasViewportHandlers",
      "page inspector handlers",
    );
    const pageAside = sourceBetween(
      pageSource,
      "<LazyStudioInspectorAside",
      "stableHandlers={studioInspectorAsideHandlers}",
      "page inspector props",
    );
    const inspectorDrawingSurface = sourceBetween(
      inspectorSource,
      '{inspectorContentMode === "drawing" && (',
      "imageInspectorRouteWithoutImageSelection ? (",
      "inspector drawing surface",
    );

    expect(pageHandlers).toContain(
      "changeDrawingPaletteLayout: setDrawingPaletteLayout",
    );
    expect(pageHandlers).toContain(
      "setDrawingPaletteDragging: changeDrawingPaletteDragging",
    );
    expect(pageHandlers).toContain('if (isMobile) {');
    expect(pageHandlers).toContain('setMobileSheet("draw")');
    expect(pageHandlers).toContain('"mobile-sheet",');
    expect(pageHandlers).toContain(
      'studioBrushCatalogHandlers.toggle("desktop-dock", trigger)',
    );
    expect(pageAside).toContain(
      "drawingPaletteLayout={drawingPaletteLayout}",
    );
    expect(pageAside).toContain(
      "drawingPaletteCancelEpoch={drawingPaletteCancelEpoch}",
    );
    expect(inspectorSource).toContain(
      "drawingPaletteCancelEpoch: number;",
    );
    expect(inspectorSource).toContain("drawingPaletteCancelEpoch,");
    expect(inspectorDrawingSurface).toContain("<StudioDrawingPaletteStack");
    expect(inspectorDrawingSurface).toContain(
      "cancelEpoch={drawingPaletteCancelEpoch}",
    );
    expect(inspectorDrawingSurface).toContain(
      "layout={drawingPaletteLayout}",
    );
    expect(inspectorDrawingSurface).toContain(
      "onLayoutChange={changeDrawingPaletteLayout}",
    );
    expect(inspectorDrawingSurface).toContain(
      "onDraggingChange={setDrawingPaletteDragging}",
    );
    expect(inspectorDrawingSurface).toContain(
      "onOpenBrushCatalog={openBrushCatalog}",
    );
    expect(inspectorDrawingSurface).toContain(
      'mobilePrimaryPaletteId={\n                    isMobile ? "tool-properties" : undefined',
    );
    expect(inspectorDrawingSurface).toContain(
      'defaultPresentation={isMobile ? "full" : "icon-popup"}',
    );
    expect(inspectorDrawingSurface).toContain("mobileHeaderAction={");
    expect(stackSource).toContain("readonly cancelEpoch?: number;");
    expect(stackSource).toContain(
      "const previousCancelEpochRef = useRef(cancelEpoch)",
    );
    expect(stackSource).toContain(
      "activeDragCleanupRef.current?.();",
    );
    expect(inspectorSource).toContain("StudioDrawingPaletteStack,");
    expect(inspectorSource).toContain("StudioAdvancedRulerPanel");
    expect(inspectorSource).toContain('from "./studio-page-lazy-ui"');
    expect(inspectorSource).not.toContain(
      'from "./StudioDrawingPaletteStack"',
    );
    expect(pageSource).not.toContain(
      'from "./StudioDrawingPaletteStack"',
    );
    expect(
      lazyRegistrySource.match(
        /import\("\.\/brush\/StudioDrawingPaletteStack"\)/gu,
      ),
    ).toHaveLength(1);
    expect(lazyRegistrySource).toContain(
      "const StudioDrawingPaletteStack = lazyRetry(",
    );
    expect(lazyRegistrySource).toContain("StudioDrawingPaletteStack,");
  });

  it("contains desktop drawing overflow at the palette shell and scrolls each open body", () => {
    const inspectorShell = sourceBetween(
      inspectorSource,
      "<aside",
      "style={",
      "inspector shell",
    );
    const drawingSurface = sourceBetween(
      inspectorSource,
      '{inspectorContentMode === "drawing" && (',
      "<StudioDrawingPaletteStack",
      "inspector drawing panel",
    );
    const stackRoot = sourceBetween(
      stackSource,
      'data-studio-drawing-palette-stack="true"',
      "{normalizedLayout.order.map",
      "drawing palette stack root",
    );
    const paletteBody = sourceBetween(
      stackSource,
      'data-studio-drawing-palette-scroll="true"',
      "{paletteBody(id, subTools, toolProperties)}",
      "drawing palette scroll body",
    );

    expect(inspectorShell).toContain(
      'inspectorDrawing &&\n              inspectorLayout.primary === "properties" &&\n              "lg:overflow-hidden"',
    );
    expect(drawingSurface).toContain(
      'className="min-h-0 lg:flex lg:flex-1 lg:flex-col"',
    );
    expect(stackRoot).toContain(
      '"lg:min-h-0 lg:flex-1 lg:gap-0 lg:overflow-hidden"',
    );
    expect(paletteBody).toContain(
      "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain",
    );
  });
});
