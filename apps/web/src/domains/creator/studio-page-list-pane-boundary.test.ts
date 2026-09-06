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
      if (
        !statement.importClause?.isTypeOnly
        && bindings
        && ts.isNamedImports(bindings)
      ) {
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

describe("Studio page-list pane module boundary", () => {
  it("keeps StudioPage as the one-way orchestration owner", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorWorkspace.tsx");
    const pane = moduleShape("./StudioPageListPane.tsx");
    const modalLazyBoundary = moduleShape("./studio-page-modal-lazy-boundaries.ts");

    expect(page.valueImports).not.toContain("./StudioPageListPane");
    expect(page.dynamicImports.filter((specifier) => specifier === "./StudioPageListPane")).toEqual([
    ]);
    expect(editorView.valueImports).toContain("../studio-page-modal-lazy-boundaries");
    expect(
      modalLazyBoundary.dynamicImports.filter((specifier) => specifier === "./StudioPageListPane")
    ).toEqual(["./StudioPageListPane"]);
    expect(pane.allImports).not.toContain("./StudioPage");
    expect(pane.dynamicImports).not.toContain("./StudioPage");
    expect(page.source).toContain("useStudioStableHandlers<StudioPageListPaneHandlers>({");
    expect(editorView.source).toContain("<LazyStudioPageListPane");
  });

  it("wires multi-page bulk move/delete through pure studio-pages helpers", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const pageManagement = moduleShape("./page/studio-page-management-controller.ts");
    const pane = moduleShape("./StudioPageListPane.tsx");
    const pageManagementCombined = [page.source, pageManagement.source].join("\n");

    expect(pageManagementCombined).toContain("deletePagesBulk as deletePagesBulkPure");
    expect(pageManagementCombined).toContain("movePagesBulk as movePagesBulkPure");
    expect(pageManagementCombined).toContain("computeNextActiveIdAfterBulkDelete");
    expect(page.source).toContain("deletePagesBulk,");
    expect(page.source).toContain("movePagesBulk,");
    expect(pane.source).toContain("deletePagesBulk: (ids: string[]) => void");
    expect(pane.source).toContain("movePagesBulk: (ids: string[], delta: number) => void");
    expect(pane.source).toContain("selectedPageIds");
    expect(pane.source).toContain("개 선택");
  });

  it("moves the component and both contracts out of the page monolith", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const pane = moduleShape("./StudioPageListPane.tsx");

    expect(pane.exportedDeclarations).toContain("StudioPageListPaneHandlers");
    expect(pane.exportedDeclarations).toContain("StudioPageListPaneProps");
    expect(pane.exportedDeclarations).toContain("StudioPageListPane");
    expect(page.topLevelDeclarations).not.toContain("StudioPageListPaneHandlers");
    expect(page.topLevelDeclarations).not.toContain("StudioPageListPaneProps");
    expect(page.topLevelDeclarations).not.toContain("StudioPageListPane");
  });

  it("keeps the pane presentation-only and preserves the thumbnail lazy registry", () => {
    const pane = moduleShape("./StudioPageListPane.tsx");

    expect(pane.valueImports).toContain("./studio-page-lazy-ui");
    expect(pane.namedValueImports.get("StudioPageThumbnail")).toBe("./studio-page-lazy-ui");
    expect(pane.allImports).not.toContain("./StudioPageThumbnails");
    expect(pane.valueImports).not.toContain("./StudioPanelResizeHandle");
    expect(pane.topLevelDeclarations).toContain("StudioPageListResizeHandle");
    expect(pane.source).toContain('data-studio-panel-resizer="true"');
    expect(pane.allImports).not.toContain("konva");
    expect(pane.allImports).not.toContain("react-konva/lib/ReactKonvaCore");
    expect(pane.source).not.toContain("useStudioStableHandlers(");
    expect(pane.source).not.toContain("lazyRetry(");
  });

  it("keeps resize handles accessible without creating a shared startup chunk", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const pane = moduleShape("./StudioPageListPane.tsx");
    const resizeHandle = moduleShape("./StudioPanelResizeHandle.tsx");

    expect(editorView.valueImports).toContain("../StudioPanelResizeHandle");
    expect(pane.valueImports).not.toContain("./StudioPanelResizeHandle");
    expect(pane.topLevelDeclarations).toContain("StudioPageListResizeHandle");
    expect(resizeHandle.exportedDeclarations).toContain("StudioPanelResizeHandle");
    expect(resizeHandle.exportedDeclarations).toContain("StudioPanelResizeHandleProps");
    expect(resizeHandle.allImports).not.toContain("./StudioPage");
    expect(pane.allImports).not.toContain("./StudioPage");
    expect(page.topLevelDeclarations).not.toContain("PanelResizeHandle");
  });
});
