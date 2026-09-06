import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleEdges {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly valueImports: readonly string[];
}

function moduleEdges(relativePath: string): ModuleEdges {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      allImports.push(node.moduleSpecifier.text);
      const clause = node.importClause;
      const namedBindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(namedBindings && ts.isNamespaceImport(namedBindings))
          || Boolean(
            namedBindings
            && ts.isNamedImports(namedBindings)
            && namedBindings.elements.some((specifier) => !specifier.isTypeOnly)
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(node.moduleSpecifier.text);
    }
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
  return { allImports, dynamicImports, source, valueImports };
}

describe("Studio menubar ownership boundary", () => {
  it("keeps StudioPage as the single lazy parent and forbids a reverse dependency", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleEdges("./studio-cuttoon-editor/StudioCuttoonEditorChrome.tsx");
    const menubar = moduleEdges("./StudioMenubarContent.tsx");
    const modalLazyBoundary = moduleEdges("./studio-page-modal-lazy-boundaries.ts");

    expect(
      page.valueImports.filter((specifier) => specifier === "./StudioMenubarContent")
    ).toEqual([]);
    expect(
      page.dynamicImports.filter((specifier) => specifier === "./StudioMenubarContent")
    ).toEqual([]);
    expect(
      editorView.valueImports.filter((specifier) => specifier === "../studio-page-modal-lazy-boundaries")
    ).toEqual(["../studio-page-modal-lazy-boundaries"]);
    expect(
      modalLazyBoundary.dynamicImports.filter((specifier) => specifier === "./StudioMenubarContent")
    ).toEqual(["./StudioMenubarContent"]);
    expect(editorView.source.match(/<LazyStudioMenubarContent\b/g)).toHaveLength(1);
    expect(editorView.source).toContain('data-studio-menubar-loading="true"');
    expect(page.source).not.toContain("interface StudioMenubarContentProps");
    expect(page.source).not.toContain("interface StudioMenubarContentHandlers");
    expect(menubar.allImports).not.toContain("./StudioPage");
    expect(
      menubar.allImports.some((specifier) =>
        specifier === "konva"
        || specifier.startsWith("konva/")
        || specifier.startsWith("react-konva")
        || specifier === "three"
        || specifier.startsWith("three/")
      )
    ).toBe(false);
    expect(menubar.source).not.toContain('"use no memo"');
  });

  it("loads heavy application menus only through the neutral lazy registry", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    const menubar = moduleEdges("./StudioMenubarContent.tsx");
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    for (const optionalModule of ["./StudioMainMenu", "./export/StudioExportMenuPanel"] as const) {
      expect(page.valueImports).not.toContain(optionalModule);
      expect(page.dynamicImports).not.toContain(optionalModule);
      expect(menubar.valueImports).not.toContain(optionalModule);
      expect(menubar.dynamicImports).not.toContain(optionalModule);
      expect(registry.valueImports).not.toContain(optionalModule);
      expect(registry.dynamicImports.filter((specifier) => specifier === optionalModule)).toEqual([
        optionalModule,
      ]);
    }

    expect(menubar.valueImports).toContain("./studio-page-lazy-ui");
    expect(menubar.source).toContain("preloadStudioExportMenuPanel();");
    expect(menubar.source).toContain("onMouseEnter={preloadStudioExportMenuPanel}");
    expect(menubar.source).toContain("onFocus={preloadStudioExportMenuPanel}");
  });

  it("preserves the two-lane chrome, accessible portal selectors, and Page-owned focus refs", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx").source;
    const menubar = moduleEdges("./StudioMenubarContent.tsx").source;

    expect(menubar).toContain('data-testid="studio-menubar-primary"');
    expect(menubar).toContain('data-testid="studio-menubar-actions"');
    expect(menubar).toContain('data-testid="studio-publish"');
    expect(menubar).toContain('data-studio-menubar-primary="true"');
    expect(menubar).toContain('data-studio-menubar-actions="true"');
    expect(menubar).toContain('data-studio-export-menu-panel="true"');
    expect(menubar).toContain('data-studio-project-actions-menu="true"');
    expect(menubar).toContain('data-studio-menubar-overflow-panel="true"');
    // Export, project actions, the measured overflow menu, and the command bar
    // settings dialog each escape clipping through one portal (2026-08-20).
    expect(menubar.match(/createPortal\(/g)).toHaveLength(4);
    expect(menubar).toContain("document.body");
    expect(menubar).toContain("globalThis.setTimeout(() => setProjectActionsOpen(false), 0)");
    expect(page).toContain("exportMenuRef={exportMenuRef}");
    expect(page).toContain("projectActionsRef={projectActionsRef}");
    expect(page).toContain(
      'projectActionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus()'
    );
  });

  it("keeps handler identity stable while render-time lock copy remains a normal prop", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx").source;
    const editorView = moduleEdges("./studio-cuttoon-editor/StudioCuttoonEditorChrome.tsx").source;
    const menubar = moduleEdges("./StudioMenubarContent.tsx").source;
    const handlerContract = menubar.slice(
      menubar.indexOf("export interface StudioMenubarContentHandlers"),
      menubar.indexOf("export interface StudioMenubarContentProps")
    );

    expect(page).toContain(
      "const studioMenubarContentHandlers = useStudioStableHandlers<StudioMenubarContentHandlers>({"
    );
    expect(editorView).toContain("stableHandlers={studioMenubarContentHandlers}");
    expect(editorView).toContain("collaborationLockMessage={collaborationLockMessage}");
    expect(handlerContract).not.toContain("collaborationLockMessage");
    expect(page).not.toMatch(
      /useStudioStableHandlers<StudioMenubarContentHandlers>\(\{[\s\S]{0,800}collaborationLockMessage/
    );
  });

  it("wires multi-page range capture through indices mode (not all-then-slice residual)", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx").source;
    const menubar = moduleEdges("./StudioMenubarContent.tsx").source;
    const rasterIntent = moduleEdges("./useStudioRasterExportOrchestration.ts").source;
    const rasterRuntime = moduleEdges(
      "./render/studio-raster-export-orchestration-runtime.ts"
    ).source;
    const handlerContract = menubar.slice(
      menubar.indexOf("export interface StudioMenubarContentHandlers"),
      menubar.indexOf("export interface StudioMenubarContentProps")
    );

    expect(page).not.toContain(
      "async function handleCapturePagesForIndices(indices: number[])"
    );
    expect(rasterRuntime).toContain(
      "async function handleCapturePagesForIndices("
    );
    expect(rasterRuntime).toContain(
      "return handleCapturePagesForIndices(pages.map((_, index) => index));"
    );
    expect(rasterIntent).toContain("handleCapturePagesForIndices: (indices) =>");
    expect(rasterIntent).toContain(
      "(await load()).handleCapturePagesForIndices(indices)"
    );
    expect(page).toContain(
      "const rasterExportOrchestration = useStudioRasterExportOrchestration({"
    );
    expect(page).toContain("} = rasterExportOrchestration;");
    expect(page).toContain("handleCapturePagesForIndices,");
    expect(handlerContract).toContain(
      "handleCapturePagesForIndices: (indices: number[]) => Promise<HTMLCanvasElement[]>"
    );
    expect(menubar).toContain("handleCapturePagesForIndices,");
    expect(menubar).toContain("capturePagesForIndices={handleCapturePagesForIndices}");
  });
});
