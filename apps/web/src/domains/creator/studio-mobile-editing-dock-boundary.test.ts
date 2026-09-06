import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly exportedDeclarations: ReadonlySet<string>;
  readonly namedValueImports: ReadonlyMap<string, string>;
  readonly source: string;
  readonly topLevelDeclarations: ReadonlySet<string>;
  readonly valueImports: readonly string[];
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
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const exportedDeclarations = new Set<string>();
  const namedValueImports = new Map<string, string>();
  const topLevelDeclarations = new Set<string>();
  const valueImports: string[] = [];

  function rememberDeclaration(name: string, node: ts.Node): void {
    topLevelDeclarations.add(name);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedDeclarations.add(name);
    }
  }

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      allImports.push(statement.moduleSpecifier.text);
      if (!statement.importClause?.isTypeOnly) valueImports.push(statement.moduleSpecifier.text);
      const bindings = statement.importClause?.namedBindings;
      if (!statement.importClause?.isTypeOnly && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) {
            namedValueImports.set(element.name.text, statement.moduleSpecifier.text);
          }
        }
      }
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
        if (ts.isIdentifier(declaration.name)) rememberDeclaration(declaration.name.text, statement);
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
    allImports,
    dynamicImports,
    exportedDeclarations,
    namedValueImports,
    source,
    topLevelDeclarations,
    valueImports,
  };
}

describe("Studio mobile editing dock module boundary", () => {
  it("keeps StudioPage as the one-way orchestration owner behind a mobile-only lazy boundary", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const dock = moduleShape("./StudioMobileEditingDock.tsx");
    const loader = moduleShape("./studio-mobile-editing-dock-loader.ts");

    expect(
      page.valueImports.filter((specifier) => specifier === "./StudioMobileEditingDock"),
    ).toEqual([]);
    expect(page.dynamicImports).not.toContain("./StudioMobileEditingDock");
    expect(editorView.namedValueImports.get("StudioMobileEditingDock")).toBe(
      "../studio-mobile-editing-dock-loader",
    );
    expect(loader.dynamicImports).toEqual(["./StudioMobileEditingDock"]);
    expect(loader.valueImports).not.toContain("./studio-page-lazy-ui");
    expect(dock.allImports).not.toContain("./StudioPage");
    expect(dock.dynamicImports).not.toContain("./StudioPage");
    expect(page.source).toContain("useStudioStableHandlers<StudioMobileEditingDockHandlers>({");
    expect(editorView.source).toContain("{isMobile ? (");
    expect(editorView.source).toContain("<Suspense fallback={null}>");
    expect(editorView.source).toContain("<StudioMobileEditingDock");
  });

  it("moves the dock and its presentation contracts out of the page monolith", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const dock = moduleShape("./StudioMobileEditingDock.tsx");

    for (const declaration of [
      "StudioBrushCatalogHandlers",
      "StudioMobileEditingDockHandlers",
      "StudioMobileEditingDockProps",
      "StudioMobileEditingDockUi",
      "StudioMobileEditingDock",
    ]) {
      expect(dock.exportedDeclarations).toContain(declaration);
      expect(page.topLevelDeclarations).not.toContain(declaration);
    }
  });

  it("preserves the lazy registry and excludes canvas runtime dependencies", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const dock = moduleShape("./StudioMobileEditingDock.tsx");
    const dockUi = moduleShape("./studio-mobile-dock-presets-config.ts");
    const dockPresets = moduleShape("./studio-mobile-dock-presets.tsx");

    for (const name of [
      "StudioBrushLibraryPanel",
      "StudioBrushStudio",
      "StudioShapePickerGrid",
      "StudioUnifiedBrushPicker",
      "loadStudioBrushStudio",
    ]) {
      expect(page.namedValueImports.has(name)).toBe(false);
      expect(dockUi.namedValueImports.get(name)).toBe("./studio-page-lazy-ui");
      expect(dock.namedValueImports.has(name)).toBe(false);
    }
    expect(page.namedValueImports.has("StudioMobileSheetHandle")).toBe(false);
    expect(page.dynamicImports).not.toContain("./StudioMobileSheetHandle");
    expect(dockPresets.dynamicImports).toContain("./StudioMobileSheetHandle");
    expect(dockPresets.source).toContain("function StudioMobileSheetHandleBoundary(");
    expect(dockUi.source).toContain("StudioMobileSheetHandle: StudioMobileSheetHandleBoundary");
    for (const directModule of [
      "./studio-page-lazy-ui",
      "./StudioMobileSheetHandle",
      "./brush/StudioBrushLibraryPanel",
      "./brush/StudioBrushStudio",
      "./StudioShapePickerGrid",
      "./StudioUnifiedBrushPicker",
      "konva",
      "react-konva",
      "react-konva/lib/ReactKonvaCore",
    ]) {
      expect(dock.allImports).not.toContain(directModule);
    }
    expect(dock.dynamicImports).toEqual([]);
    expect(dock.source).not.toContain("lazyRetry(");
    expect(editorView.source).toContain("ui={STUDIO_MOBILE_EDITING_DOCK_UI}");
  });

  it("warms both lazy properties surfaces from every mobile Work intent path", () => {
    const dock = moduleShape("./StudioMobileEditingDock.tsx");

    expect(
      dock.namedValueImports.get("preloadStudioInspectorDrawingSurface"),
    ).toBe("./studio-inspector-aside-loader");
    expect(
      dock.source.match(
        /onPointerEnter=\{preloadStudioInspectorDrawingSurface\}/gu,
      ),
    ).toHaveLength(2);
    expect(
      dock.source.match(
        /onPointerDown=\{preloadStudioInspectorDrawingSurface\}/gu,
      ),
    ).toHaveLength(2);
    expect(
      dock.source.match(/onFocus=\{preloadStudioInspectorDrawingSurface\}/gu),
    ).toHaveLength(2);
    expect(dock.dynamicImports).toEqual([]);
  });

  it("routes mobile brush default restore through the page-owned baseline controller", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const dock = moduleShape("./StudioMobileEditingDock.tsx");

    expect(editorView.source).toContain(
      "brushDefaultRestore={brushBaselineController.restoreState}",
    );
    expect(page.source).toMatch(
      /restoreBrushDefaults: \(\) => \{\s*void brushBaselineController\.restoreDefaults\(\);\s*\}/u,
    );
    expect(dock.source).toContain(
      "brushDefaultRestore: StudioBrushDefaultRestoreViewState;",
    );
    expect(dock.source).toContain("restoreBrushDefaults: () => void;");
    expect(dock.source).toContain(
      "applyBrushDefaultRestoreTransaction: (",
    );
    expect(dock.source).toContain(
      "onRestoreDefaults={applyBrushDefaultRestoreTransaction}",
    );
    expect(dock.source).not.toContain(
      "onRestoreDefaults={(transaction, direction) =>",
    );
    expect(dock.source).not.toContain(
      'setStrokeWidth(drawMode === "eraser" ? 18 : 4)',
    );
    expect(dock.source).not.toContain("setBrushOpacity(1)");
    expect(dock.source).toContain(
      'data-studio-mobile-brush-default-restore="true"',
    );
    expect(dock.source).toContain(
      '"flex min-h-11 min-w-[7rem] shrink-0 items-center',
    );
    expect(page.source).toContain(
      "applyBrushDefaultRestoreTransaction,",
    );
  });

  it("leaves modal, focus, and stable-handler lifecycle in StudioPage", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const dock = moduleShape("./StudioMobileEditingDock.tsx");

    for (const controllerContract of [
      "const drawSheetRef = useRef",
      "const brushManagerSheetRef = useRef",
      "const colorVisionSheetRef = useRef",
      "const mobileBrushDockButtonRef = useRef",
      "useStudioModalSheet({",
      "function dismissBrushManagerToDraw()",
      "function openBrushManager(launcher: HTMLButtonElement)",
      "useStudioStableHandlers<StudioMobileEditingDockHandlers>({",
    ]) {
      expect(page.source).toContain(controllerContract);
      expect(dock.source).not.toContain(controllerContract);
    }
    expect(dock.source).not.toContain("useState(");
    expect(dock.source).not.toContain("useStudioModalSheet");
    expect(page.source).toContain("dismissBrushManager: dismissBrushManagerToDraw,");
    expect(page.source).not.toContain("dismissBrushManager={dismissBrushManagerToDraw}");
    expect(page.source).toContain("mobileInspectorSelectionReturnFocusRef");
    expect(page.source).toContain('[data-studio-selection-properties-trigger="true"]');
    expect(page.source).toContain('[data-studio-mobile-workspace-toggle="true"]');
    expect(dock.source).toContain('data-studio-selection-properties-trigger="true"');
  });

  it("exposes draw-sheet dialog semantics only while the non-modal sheet is visible", () => {
    const dock = moduleShape("./StudioMobileEditingDock.tsx");

    expect(dock.source).toContain(
      'const drawSettingsVisible = drawSettingsOpen && !brushCatalogOpen;',
    );
    expect(dock.source).toContain(
      'role={drawSettingsVisible ? "dialog" : undefined}',
    );
    expect(dock.source).toContain(
      'aria-label={drawSettingsVisible ? "브러시 설정" : undefined}',
    );
    expect(dock.source).toContain(
      "tabIndex={drawSettingsVisible ? -1 : undefined}",
    );
    expect(dock.source).toContain(
      "aria-hidden={drawSettingsVisible ? undefined : true}",
    );
    expect(dock.source).toContain(
      "inert={drawSettingsVisible ? undefined : true}",
    );
  });
});
