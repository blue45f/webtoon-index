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
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      allImports.push(specifier);
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
            && namedBindings.elements.some((element) => !element.isTypeOnly)
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(specifier);
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

describe("Studio Writer Room review surface boundary", () => {
  it("keeps the modal shell as the static owner of controlled review leaves", () => {
    const panel = moduleEdges("./StudioWriterRoomPanel.tsx");
    const review = moduleEdges("./StudioWriterRoomReviewSurfaces.tsx");
    const ui = moduleEdges("./studio-writer-room-ui.ts");

    expect(
      panel.valueImports.filter(
        (specifier) => specifier === "./StudioWriterRoomReviewSurfaces"
      )
    ).toEqual(["./StudioWriterRoomReviewSurfaces"]);
    expect(panel.valueImports).toContain("./studio-writer-room-ui");
    expect(panel.dynamicImports).toEqual([]);
    expect(review.dynamicImports).toEqual([]);
    expect(ui.dynamicImports).toEqual([]);
    expect(review.allImports).not.toContain("./StudioWriterRoomPanel");
    expect(ui.allImports).not.toContain("./StudioWriterRoomPanel");
    expect(panel.source).toContain("<StudioWriterRoomAiReviewPanel");
    expect(panel.source).toContain("<StudioWriterRoomCanvasPlanHandoff");
    expect(panel.source).toContain("<StudioWriterRoomSuggestionsPanel");
  });

  it("prevents review leaves from reaching orchestration, stores, CRDT, or AI clients", () => {
    const review = moduleEdges("./StudioWriterRoomReviewSurfaces.tsx");
    const ui = moduleEdges("./studio-writer-room-ui.ts");
    const forbiddenDependency =
      /(?:StudioPage|StudioLazyPanelStack|studio-page-lazy-ui|collaborat|(?:^|[-/])crdt(?:[-/]|$)|ai-client|stores?\/)/iu;

    for (const specifier of [...review.allImports, ...ui.allImports]) {
      expect(specifier).not.toMatch(forbiddenDependency);
    }
    expect(review.valueImports).toEqual([
      "lucide-react",
      "react",
      "./studio-writer-room",
      "./studio-writer-room-ui",
    ]);
    expect(ui.valueImports).toEqual([]);
    expect(review.source).not.toMatch(/\b(?:memo|useCallback|useMemo)\s*\(/u);
    expect(review.source).not.toContain('"use no memo"');
  });

  it("preserves one literal Writer Room lazy boundary instead of splitting review leaves", () => {
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    expect(
      registry.dynamicImports.filter((specifier) => specifier === "./StudioWriterRoomPanel")
    ).toEqual(["./StudioWriterRoomPanel"]);
    expect(registry.dynamicImports).not.toContain("./StudioWriterRoomReviewSurfaces");
    expect(registry.valueImports).not.toContain("./StudioWriterRoomPanel");
    expect(registry.valueImports).not.toContain("./StudioWriterRoomReviewSurfaces");
  });
});
