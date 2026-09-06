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
    allImports,
    dynamicImports,
    exportedDeclarations,
    source,
    topLevelDeclarations,
    valueImports,
  };
}

describe("Studio left tool rail module boundary", () => {
  it("keeps StudioPage as the one-way lazy orchestration owner", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const lazyUi = moduleShape("./studio-page-modal-lazy-boundaries.ts");
    const rail = moduleShape("./StudioLeftToolRail.tsx");

    expect(page.valueImports).not.toContain("./StudioLeftToolRail");
    expect(lazyUi.dynamicImports.filter((specifier) => specifier === "./StudioLeftToolRail")).toEqual([
      "./StudioLeftToolRail",
    ]);
    expect(rail.allImports).not.toContain("./StudioPage");
    expect(rail.source).not.toMatch(/import\s*\([^)]*StudioPage/u);
  });

  it("exports the component and stable handler contract from their new owner", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const rail = moduleShape("./StudioLeftToolRail.tsx");

    expect(rail.exportedDeclarations.has("StudioLeftToolRail")).toBe(true);
    expect(rail.exportedDeclarations.has("StudioLeftToolRailHandlers")).toBe(true);
    expect(page.topLevelDeclarations.has("StudioLeftToolRail")).toBe(false);
    expect(page.topLevelDeclarations.has("StudioLeftToolRailHandlers")).toBe(false);
  });

  it("mounts the rail through one persistent EditorClient runtime", () => {
    const rail = moduleShape("./StudioLeftToolRail.tsx");
    const workspace = moduleShape(
      "./studio-cuttoon-editor/StudioCuttoonEditorWorkspace.tsx",
    );

    expect(rail.source).toContain("readonly client: StudioLeftToolRailClient;");
    expect(rail.source).not.toContain('import("react").Dispatch<');
    expect(workspace.source).toContain("createStudioLeftToolRailRuntime(");
    expect(workspace.source).toContain(
      "studioLeftToolRailRuntime.update(studioLeftToolRailInput);",
    );
    expect(workspace.source).toContain(
      "<LazyStudioLeftToolRail client={studioLeftToolRailRuntime.client} />",
    );
    expect(workspace.source).not.toContain("createStudioLeftToolRailClient(");
    expect(workspace.source).not.toContain(
      "stableHandlers={studioLeftToolRailHandlers}",
    );
  });

  it("keeps the rail independent from canvas render runtimes", () => {
    const rail = moduleShape("./StudioLeftToolRail.tsx");

    expect(rail.allImports).not.toContain("konva");
    expect(rail.allImports).not.toContain("react-konva");
    expect(rail.valueImports).toContain("./studio-page-lazy-ui");
    expect(rail.source).toContain("preloadStudioReferencePanel");
  });

  it("exposes the more-tools popover as one keyboard-operable dialog", () => {
    const rail = moduleShape("./StudioLeftToolRail.tsx");

    expect(rail.source).toContain('aria-haspopup="dialog"');
    expect(rail.source).toContain("aria-expanded={railMoreOpen}");
    expect(rail.source).toContain("aria-controls={railMoreOpen ? railMoreDialogId : undefined}");
    expect(rail.source).toContain('role="dialog"');
    expect(rail.source).toContain('aria-modal="false"');
    expect(rail.source).toContain("aria-labelledby={railMoreTitleId}");
    expect(rail.source).toContain("createPortal((");
    expect(rail.source).toContain('className="fixed z-[80]');
    expect(rail.valueImports).toContain("./studio-left-tool-rail-position");
    expect(rail.source).toContain("resolveStudioRailMorePosition({");
    expect(rail.source).toContain(
      "availableOnRight < measuredWidth && availableOnLeft >= measuredWidth"
    );
    expect(rail.source).toContain("top: railMorePosition.top");
    expect(rail.source).toContain("maxHeight: railMorePosition.maxHeight");
    expect(rail.source).toContain('globalThis.visualViewport?.addEventListener("resize", updatePosition)');
    expect(rail.source).toContain('document.addEventListener("pointerdown", handlePointerDown, true)');
    expect(rail.source).toContain('setAppSettingsInitialTab("toolbar")');
    expect(rail.source).toContain("?.focus({ preventScroll: true })");
    expect(rail.source).toContain("max-h-[min(28rem,calc(100dvh-1rem))]");
    expect(rail.source).toContain('if (event.key !== "Escape") return;');
    expect(rail.source).toContain("closeRailMoreAndRestoreFocus()");
    expect(rail.source).toContain("?.focus();");
  });
});
