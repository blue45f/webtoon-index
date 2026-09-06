import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

function moduleEdges(relativePath: string) {
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
  const typeImports: string[] = [];
  const valueImports: string[] = [];
  const wholeClauseTypeImports: string[] = [];
  let layerNavigatorUsesLazyRetry = false;

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) wholeClauseTypeImports.push(node.moduleSpecifier.text);
      const namedBindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(namedBindings && ts.isNamespaceImport(namedBindings))
          || Boolean(
            namedBindings
            && ts.isNamedImports(namedBindings)
            && namedBindings.elements.some((specifier) => !specifier.isTypeOnly),
          )
        )
      );
      (hasRuntimeValue ? valueImports : typeImports).push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      dynamicImports.push(node.arguments[0].text);
    }
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "StudioLayerNavigator"
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "lazyRetry"
    ) {
      layerNavigatorUsesLazyRetry = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return {
    dynamicImports,
    layerNavigatorUsesLazyRetry,
    source,
    typeImports,
    valueImports,
    wholeClauseTypeImports,
  };
}

describe("Studio layer navigator bundle boundary", () => {
  it("keeps the optional layer navigator behind one registry-owned lazyRetry import", () => {
    const page = moduleEdges("../StudioCuttoonEditorHost.tsx");
    const inspector = moduleEdges("../StudioInspectorAsideShell.tsx");
    const navigator = moduleEdges("./StudioLayerNavigator.tsx");
    const itemRow = moduleEdges("./StudioLayerNavigatorItemRow.tsx");
    const itemRowUi = moduleEdges("./studio-layer-navigator-row-ui.ts");
    const registry = moduleEdges("../studio-page-lazy-ui.ts");

    const types = moduleEdges("../StudioInspectorAsideTypes.ts");
    expect(page.valueImports).not.toContain("./layer/StudioLayerNavigator");
    expect(inspector.valueImports).not.toContain("./layer/StudioLayerNavigator");
    expect(
      types.wholeClauseTypeImports.filter((specifier) => specifier === "./layer/StudioLayerNavigator"),
    ).toEqual(["./layer/StudioLayerNavigator"]);
    expect(page.dynamicImports).not.toContain("./layer/StudioLayerNavigator");
    expect(inspector.dynamicImports).not.toContain("./layer/StudioLayerNavigator");
    expect(registry.dynamicImports.filter((specifier) => specifier === "./layer/StudioLayerNavigator")).toEqual([
      "./layer/StudioLayerNavigator",
    ]);
    expect(registry.layerNavigatorUsesLazyRetry).toBe(true);
    expect(navigator.valueImports).toContain("./StudioLayerNavigatorItemRow");
    expect(navigator.dynamicImports).not.toContain("./StudioLayerNavigatorItemRow");
    expect(itemRow.valueImports).not.toContain("./StudioLayerNavigator");
    expect(itemRow.valueImports).not.toContain("../StudioPage");
    expect(itemRow.valueImports).not.toContain("../StudioInspectorAside");
    expect(itemRow.dynamicImports).toEqual([]);
    expect(itemRowUi.valueImports).not.toContain("./StudioLayerNavigator");
    expect(itemRowUi.valueImports).not.toContain("../StudioPage");
    expect(itemRowUi.valueImports).not.toContain("../StudioInspectorAside");
    expect(itemRowUi.dynamicImports).toEqual([]);
  });

  it("mounts the navigator only for the visible inspector layer tab with an accessible fallback", () => {
    const source = moduleEdges("../StudioInspectorAsideShell.tsx").source;

    // The layers pane mounts for the 레이어 tab and, on panels ≥ 420px, under the 대상 tab as a
    // split region (UX 감사 2026-09-02 §5.8). Either way the lazy navigator mounts only while the
    // pane itself is visible — `layersPaneMounted` gates both the `hidden` attribute and the mount.
    expect(source).toMatch(
      /id=\{tabA11y\.primary\.layers\.panelId\}[\s\S]*?role=\{layersSplitWithProperties \? "region" : "tabpanel"\}[\s\S]*?aria-labelledby=\{layersSplitWithProperties \? undefined : tabA11y\.primary\.layers\.tabId\}[\s\S]*?hidden=\{!layersPaneMounted\}[\s\S]*?\{layersPaneMounted \? \([\s\S]*?<Suspense/,
    );
    expect(source).toContain(
      'const layersPaneMounted = inspectorLayout.primary === "layers" || layersSplitWithProperties;',
    );
    expect(source).toMatch(
      /fallback=\{[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?h-full min-h-72/,
    );
    expect(source).toMatch(/<StudioLayerNavigator[\s\S]*?<\/Suspense>[\s\S]*?\) : null\}/);
  });
});
