import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly dynamicImports: readonly string[];
  readonly exportedDeclarations: ReadonlySet<string>;
  readonly runtimeImports: readonly string[];
  readonly source: string;
  readonly topLevelDeclarations: ReadonlySet<string>;
}

function moduleShape(relativePath: string): ModuleShape {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const dynamicImports: string[] = [];
  const exportedDeclarations = new Set<string>();
  const runtimeImports: string[] = [];
  const topLevelDeclarations = new Set<string>();

  function rememberDeclaration(name: string, node: ts.Node): void {
    topLevelDeclarations.add(name);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedDeclarations.add(name);
    }
  }

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const hasRuntimeBinding = !clause
        || (
          !clause.isTypeOnly
          && (
            Boolean(clause.name)
            || Boolean(bindings && ts.isNamespaceImport(bindings))
            || Boolean(
              bindings
              && ts.isNamedImports(bindings)
              && bindings.elements.some((specifier) => !specifier.isTypeOnly),
            )
          )
        );
      if (hasRuntimeBinding) runtimeImports.push(statement.moduleSpecifier.text);
    }

    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
    ) {
      if (statement.name) rememberDeclaration(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          rememberDeclaration(declaration.name.text, statement);
        }
      }
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      dynamicImports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);

  return {
    dynamicImports,
    exportedDeclarations,
    runtimeImports,
    source,
    topLevelDeclarations,
  };
}

const OPTIONAL_VIEWPORT_SURFACES = [
  "../StudioAppSettingsPanel",
  "../StudioDialogueBatchPanel",
  "../StudioDialogueTranslatePanel",
  "../StudioFeatureTutorialHub",
  "../StudioFrameAnimationPanel",
  "../StudioHealCloneOverlay",
  "../StudioHistoryBrushOverlay",
  "../StudioHistoryPanel",
  "../layer/StudioLayerMaskOverlay",
  "../StudioMasterPagePanel",
  "../StudioPanelSplitTool",
  "../StudioPuppetWarpOverlay",
  "../StudioQuickMaskOverlay",
  "../StudioShortcutsHelp",
  "../StudioWebGpuCanvas",
] as const;

describe("Studio canvas viewport module boundary", () => {
  it("keeps the core canvas on one static, one-way ownership edge", () => {
    const editor = moduleShape("../studio-cuttoon-editor/StudioCuttoonEditorCanvasColumn.tsx");
    const viewport = moduleShape("./StudioCanvasViewport.tsx");

    expect(
      editor.runtimeImports.filter((specifier) => specifier === "../canvas/StudioCanvasViewport"),
    ).toEqual(["../canvas/StudioCanvasViewport"]);
    expect(editor.dynamicImports).not.toContain("../canvas/StudioCanvasViewport");
    expect(viewport.runtimeImports).not.toContain("../StudioPage");
    expect(viewport.dynamicImports).not.toContain("../StudioPage");
    expect(editor.source).toContain("<StudioCanvasViewport");
  });

  it("moves the renderer and both public contracts out of the page monolith", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleShape("./StudioCanvasViewport.tsx");
    const viewportTypes = moduleShape("./StudioCanvasViewportTypes.ts");

    expect(viewportTypes.exportedDeclarations).toContain("StudioCanvasViewportHandlers");
    expect(viewportTypes.exportedDeclarations).toContain("StudioCanvasViewportProps");
    expect(viewport.exportedDeclarations).toContain("StudioCanvasViewport");
    expect(viewport.source).toContain("type StudioCanvasViewportHandlers");
    expect(viewport.source).toContain("type StudioCanvasViewportProps");
    expect(page.topLevelDeclarations).not.toContain("StudioCanvasViewportHandlers");
    expect(page.topLevelDeclarations).not.toContain("StudioCanvasViewportProps");
    expect(page.topLevelDeclarations).not.toContain("StudioCanvasViewport");
    expect(Buffer.byteLength(viewport.source, "utf8")).toBeLessThan(500_000);
  });

  it("preserves the existing memoized Stage hot-surface contract", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleShape("./StudioCanvasViewport.tsx");

    expect(page.source).toContain(
      "useStudioStableHandlers<StudioCanvasViewportHandlers>({",
    );
    expect(viewport.source).toContain(
      "export const StudioCanvasViewport = memo(function StudioCanvasViewport({",
    );
    const stageHost = moduleShape("./StudioCanvasViewportStageHost.tsx");
    expect(stageHost.source).toContain('<Profiler id="studio:stage"');
  });

  it("stabilizes compiler-opted-out viewport projections and event bridges", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const editor = moduleShape("../studio-cuttoon-editor/StudioCuttoonEditorCanvasColumn.tsx");
    const viewportTypes = moduleShape("./StudioCanvasViewportTypes.ts");

    expect(page.source).toContain(
      "const studioWorkAssetRenderProjection = useMemo(",
    );
    expect(page.source).toContain("const pageGrade = useMemo(");
    expect(page.source).toContain("const animTimeline = useMemo(");
    expect(page.source).toContain("const defaultedDrawingAssistDocument = useMemo(");
    expect(page.source).toContain("const webGpuViewportSurface = useMemo(");
    expect(page.source).toContain("const studioRasterHiddenOperationIds = useMemo(");
    expect(page.source).toContain("const sharedGutters = useMemo(");
    expect(page.source).toContain("const pixelOverlayFrame: SelectionFrame | null = useMemo(");
    expect(editor.source).toContain(
      "closeViewToolWithFocus={studioCanvasViewportHandlers.closeViewToolWithFocus}",
    );
    expect(editor.source).toContain(
      "setCurrentPageId={studioCanvasViewportHandlers.setCurrentPageId}",
    );
    expect(page.source).toContain(
      "activateCanvasTool: activatePrimaryCanvasTool,",
    );
    expect(viewportTypes.source).toContain(
      'activateCanvasTool: (tool: "select" | "draw", drawMode?: DrawMode) => void;',
    );
    expect(page.source).not.toContain(
      "setDrawMode={studioCanvasViewportHandlers.setDrawMode}",
    );
    expect(editor.source).toContain(
      "setRightPanelOpen={studioCanvasViewportHandlers.setRightPanelOpen}",
    );
    expect(viewportTypes.source).toContain(
      "closeViewToolWithFocus: (options?: { preferCanvas?: boolean }) => void;",
    );
  });

  it("keeps transient shortcut notices below the memoized Stage boundary", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleShape("./StudioCanvasViewport.tsx");
    // 2026-08-21 intentional: the notice layer moved verbatim out of StudioCanvasViewport.tsx into
    // its own leaf module. The boundary being guarded is unchanged — the store still lives in
    // StudioPage, the subscribing layer still renders below the memoized Stage.
    const noticeLayer = moduleShape("./StudioDrawingShortcutNoticeLayer.tsx");

    expect(page.source).toContain(
      "const [drawingShortcutNoticeStore] = useState(createStudioDrawingShortcutNoticeStore);",
    );
    expect(page.source).toContain("const drawingShortcutNotice = useSyncExternalStore(");
    expect(page.source).toContain("if (!publishedNotice) return;");
    expect(page.source).toContain("drawingShortcutNoticeStore.clear(publishedNotice.id);");
    expect(page.source).toContain("}, 1_400);");
    expect(page.source).toContain("drawingShortcutNotice === null;");
    expect(page.source).toContain(
      "drawingShortcutNoticeStore={drawingShortcutNoticeStore}",
    );
    expect(page.source).not.toContain("drawingShortcutNotice={");
    const hudOverlays = moduleShape("./StudioCanvasViewportHudOverlays.tsx");
    const viewportTypes = moduleShape("./StudioCanvasViewportTypes.ts");
    expect(hudOverlays.source).toContain("<StudioDrawingShortcutNoticeLayer");
    expect(noticeLayer.source).toContain("export function StudioDrawingShortcutNoticeLayer({");
    expect(noticeLayer.source).toContain("const snapshot = useSyncExternalStore(");
    expect(viewportTypes.source).toContain(
      "drawingShortcutNoticeStore: StudioDrawingShortcutNoticeStore;",
    );
    expect(noticeLayer.source).toContain('aria-live="polite"');
    expect(noticeLayer.source).toContain("key={notice.id}");
    expect(noticeLayer.source).toContain("const notice = hasAutosave ? null : snapshot;");
  });

  it("keeps the viewport and right inspector in one desktop row without collapsing canvas height", () => {
    const workspace = moduleShape("../studio-cuttoon-editor/StudioCuttoonEditorWorkspace.tsx");
    const canvas = moduleShape("../studio-cuttoon-editor/StudioCuttoonEditorCanvasColumn.tsx");
    const inspector = moduleShape("../studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const viewport = moduleShape("./StudioCanvasViewport.tsx");
    const workspaceMarker = "중앙: 캔버스 + 우측 인스펙터";
    const workspaceIndex = workspace.source.indexOf(workspaceMarker);
    const canvasColumnIndex = workspace.source.indexOf(
      "<StudioCuttoonEditorCanvasColumn",
      workspaceIndex,
    );
    const inspectorColumnIndex = workspace.source.indexOf(
      "<StudioCuttoonEditorInspectorColumn",
      canvasColumnIndex,
    );
    const viewportIndex = canvas.source.indexOf("<StudioCanvasViewport");
    const pointCommentIndex = canvas.source.indexOf("{pointCommentComposer ?", viewportIndex);
    const resizeHandleIndex = inspector.source.indexOf("캔버스 ↔ 작업 패널 너비 스플리터");
    const inspectorIndex = inspector.source.indexOf("<LazyStudioInspectorAside", resizeHandleIndex);

    expect(workspaceIndex).toBeGreaterThan(-1);
    expect(
      workspace.source.slice(workspaceIndex, canvasColumnIndex),
    ).toContain(
      'className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row"',
    );
    expect(canvasColumnIndex).toBeGreaterThan(workspaceIndex);
    expect(inspectorColumnIndex).toBeGreaterThan(canvasColumnIndex);
    expect(viewportIndex).toBeGreaterThan(-1);
    expect(pointCommentIndex).toBeGreaterThan(viewportIndex);
    expect(resizeHandleIndex).toBeGreaterThan(-1);
    expect(inspectorIndex).toBeGreaterThan(resizeHandleIndex);
    expect(viewport.source).toContain(
      '"relative min-h-0 min-w-0 flex-1 lg:min-w-[16rem]"',
    );
  });

  it("keeps desktop status controls above the measured drawing options dock", () => {
    // 2026-08-21 intentional: the desktop status bar moved verbatim out of
    // StudioCanvasViewport.tsx into the stage-HUD leaf; the measured dock offset travelled with it.
    const stageHud = moduleShape("./StudioCanvasStageHud.tsx");
    const viewport = moduleShape("./StudioCanvasViewport.tsx");

    expect(stageHud.source).toContain(
      '"calc(var(--studio-draw-options-height, 3.75rem) + max(0.75rem, env(safe-area-inset-bottom)) + 0.75rem)"',
    );
    expect(stageHud.source).not.toContain(
      'tool === "draw" && !isMobile && "bottom-[4.75rem]"',
    );
    expect(viewport.source).not.toContain(
      'tool === "draw" && !isMobile && "bottom-[4.75rem]"',
    );
  });

  it("preserves the neutral optional-UI registry instead of flattening lazy chunks", () => {
    const hosts = [
      moduleShape("./StudioCanvasViewport.tsx"),
      moduleShape("./StudioCanvasViewportStageHost.tsx"),
      moduleShape("./StudioCanvasViewportDocumentLayer.tsx"),
      moduleShape("./StudioCanvasViewportToolLayers.tsx"),
      moduleShape("./StudioCanvasViewportDomOverlays.tsx"),
      moduleShape("./StudioCanvasViewportHudOverlays.tsx"),
    ];

    expect(
      hosts.flatMap((host) => host.runtimeImports.filter((specifier) => specifier === "../studio-page-lazy-ui")),
    ).not.toEqual([]);
    for (const host of hosts) {
      expect(host.dynamicImports).toEqual([]);
      for (const specifier of OPTIONAL_VIEWPORT_SURFACES) {
        expect(
          host.runtimeImports,
          `${specifier} must stay behind studio-page-lazy-ui in ${host.source.slice(0, 40)}`,
        ).not.toContain(specifier);
      }
    }
  });

  it("shares only leaf utilities with the orchestration owner", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleShape("./StudioCanvasViewport.tsx");
    const shared = moduleShape("./studio-canvas-shared-runtime.ts");

    const stageHost = moduleShape("./StudioCanvasViewportStageHost.tsx");
    const interaction = moduleShape("./studio-canvas-viewport-interaction.ts");
    expect(page.runtimeImports).toContain("./canvas/studio-canvas-shared-runtime");
    expect(stageHost.runtimeImports).toContain("./studio-canvas-shared-runtime");
    expect(interaction.runtimeImports).toContain("./studio-canvas-shared-runtime");
    expect(shared.runtimeImports).not.toContain("../StudioPage");
    expect(shared.runtimeImports).not.toContain("./StudioCanvasViewport");
    expect(shared.runtimeImports).not.toContain("react");
    expect(shared.runtimeImports).not.toContain("react-konva/lib/ReactKonvaCore");
  });

  it("routes paper-grain visibility through one authority, never an inline predicate", () => {
    // Both call sites used to read `=== true` independently, so a page that had chosen a paper
    // still rendered nothing. The rule now lives in `studio-paper-grain-visibility-v1` alone:
    // an explicit toggle wins, otherwise the sheet shows iff the page carries an authored
    // `paperSurface` — which never repaints a page that never opted in.
    const page = moduleShape("../studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const liveSurfaces = moduleShape("./studio-canvas-viewport-live-surfaces.ts");

    expect(liveSurfaces.source).toContain(
      "const paperGrainVisible = resolveStudioPaperGrainVisibleV1(activePage);",
    );
    expect(page.source).toContain(
      "paperGrainVisible={resolveStudioPaperGrainVisibleV1(activePage)}",
    );
    for (const shape of [page, liveSurfaces]) {
      expect(shape.source).not.toContain("activePage.paperGrainVisible === true");
      expect(shape.source).not.toContain("activePage.paperGrainVisible !== false");
      expect(shape.runtimeImports).toContain(
        "../brush/studio-paper-grain-visibility-v1",
      );
    }
  });

  it("paints the sheet into exports — what the artist sees is what ships", () => {
    // `isExporting` used to null the pattern out, so PNG/PSD/timelapse output disagreed with the
    // canvas. The paper is a property of the page, so the export gate is gone.
    const liveSurfaces = moduleShape("./studio-canvas-viewport-live-surfaces.ts");
    expect(liveSurfaces.source).not.toContain("if (!paperGrainVisible || isExporting) return null;");
  });

  it("bakes the high-fidelity substrate off the main thread and degrades to the fast tile", () => {
    // A 256² procedural surface costs ~1s on this repo's CPU. It must never run inline, and its
    // failure path must keep the paper visible rather than turning it off.
    const liveSurfaces = moduleShape("./studio-canvas-viewport-live-surfaces.ts");
    expect(liveSurfaces.runtimeImports).toContain("../brush/studio-paper-substrate-tile-host-v1");
    expect(liveSurfaces.source).toContain("requestStudioPaperSubstrateTileHeightsV1");
    expect(liveSurfaces.source).toContain("substrateTile ?? paperGrainFallbackImage");
    // The synchronous baker must not be pulled into the viewport bundle path.
    expect(liveSurfaces.source).not.toContain("bakeStudioPaperSubstrateTileV1");
  });
});
