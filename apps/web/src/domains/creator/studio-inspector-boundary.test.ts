import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly exportedDeclarations: ReadonlySet<string>;
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
      if (!statement.importClause?.isTypeOnly) {
        valueImports.push(statement.moduleSpecifier.text);
      }
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
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
    source,
    topLevelDeclarations,
    valueImports,
  };
}

describe("Studio inspector module boundary", () => {
  it("keeps StudioPage as the orchestration owner while deferring the heavy inspector surface", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const inspector = moduleShape("./StudioInspectorAside.tsx");
    const loader = moduleShape("./studio-inspector-aside-loader.ts");
    const registry = moduleShape("./studio-page-lazy-ui.ts");

    expect(page.valueImports).not.toContain("./StudioInspectorAside");
    expect(page.allImports).toContain("./StudioInspectorAside");
    expect(editorView.valueImports).toContain("../studio-inspector-aside-loader");
    expect(page.dynamicImports).not.toContain("./StudioInspectorAside");
    expect(loader.dynamicImports).toEqual(["./StudioInspectorAside"]);
    expect(loader.valueImports).toContain("./studio-page-lazy-ui");
    expect(loader.source).toContain("preloadStudioInspectorDrawingSurface");
    expect(loader.source).toMatch(
      /preloadStudioInspectorDrawingSurface\(\): void \{\s*studioInspectorAsideLoader\.preload\(\);\s*preloadStudioDrawingPaletteStack\(\);\s*\}/u,
    );
    expect(inspector.allImports).not.toContain("./StudioPage");
    expect(inspector.dynamicImports).not.toContain("./StudioPage");
    expect(registry.allImports).not.toContain("./StudioInspectorAside");
    expect(registry.dynamicImports).not.toContain("./StudioInspectorAside");
  });

  it("warms the always-visible desktop inspector beside the editor without taxing mobile startup", () => {
    const router = moduleShape("./studio-router/routes/StudioEditorRoute.tsx");

    expect(router.dynamicImports).toContain("../../studio-inspector-aside-loader");
    expect(router.valueImports).not.toContain("../../studio-inspector-aside-loader");
    expect(router.source).toContain('typeof window.matchMedia !== "function"');
    expect(router.source).toContain('window.matchMedia("(max-width: 1023px)").matches');
    expect(router.source).toContain("preloadStudioInspectorAside())");
  });

  it("moves the handler contract and component while leaving page orchestration behind", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx");
    const inspector = moduleShape("./StudioInspectorAside.tsx");

    expect(inspector.exportedDeclarations).toContain("StudioInspectorAsideHandlers");
    expect(inspector.exportedDeclarations).toContain("StudioInspectorAside");
    expect(inspector.topLevelDeclarations).toContain("StudioInspectorAsideProps");
    expect(page.topLevelDeclarations).not.toContain("StudioInspectorAsideHandlers");
    expect(page.topLevelDeclarations).not.toContain("StudioInspectorAsideProps");
    expect(page.topLevelDeclarations).not.toContain("StudioInspectorAside");
    expect(editorView.source).toContain("<LazyStudioInspectorAside");
    expect(editorView.source).toContain('mobileSheet === "props"');
    expect(editorView.source).toContain("<StudioInspectorAsideFallback");
    expect(page.source).toContain('useState<StudioMobileSheetSnap>("medium")');
    expect(editorView.source).toContain("mobileInspectorSnap={mobileInspectorSnap}");
    expect(editorView.source).toContain("setMobileInspectorSnap={setMobileInspectorSnap}");
    expect(inspector.source).not.toContain('useState<StudioMobileSheetSnap>("medium")');
  });

  it("keeps the inspector presentation-only and delegates optional loading to the registry", () => {
    const inspector = moduleShape("./StudioInspectorAside.tsx");
    const body = moduleShape("./StudioInspectorAsideBody.tsx");

    expect(body.valueImports).toContain("./studio-page-lazy-ui");
    expect(inspector.allImports).not.toContain("konva");
    expect(inspector.allImports).not.toContain("react-konva/lib/ReactKonvaCore");
    expect(body.allImports).not.toContain("konva");
    expect(body.allImports).not.toContain("react-konva/lib/ReactKonvaCore");
    expect(inspector.source).not.toContain("lazyRetry(");
    expect(body.source).not.toContain("lazyRetry(");
  });
});
