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

describe("Studio inspector focus, speed, and frame boundary", () => {
  it("keeps StudioInspectorAside as the static owner of one controlled leaf", () => {
    const inspector = moduleEdges("./StudioInspectorSelectionSection.tsx");
    const leaf = moduleEdges("./StudioInspectorFocusSpeedFrameControls.tsx");

    expect(
      inspector.valueImports.filter(
        (specifier) => specifier === "./StudioInspectorFocusSpeedFrameControls"
      )
    ).toEqual(["./StudioInspectorFocusSpeedFrameControls"]);
    expect(inspector.dynamicImports).not.toContain("./StudioInspectorFocusSpeedFrameControls");
    expect(leaf.dynamicImports).toEqual([]);
    expect(leaf.allImports).not.toContain("./StudioInspectorAside");
    expect(leaf.allImports).not.toContain("./StudioPage");
    expect(inspector.source).toContain("<StudioInspectorFocusSpeedFrameControls");
  });

  it("leaves selection, document locks, panel state, history, CRDT, and saving outside the leaf", () => {
    const inspector = moduleEdges("./StudioInspectorSelectionSection.tsx").source;
    const leaf = moduleEdges("./StudioInspectorFocusSpeedFrameControls.tsx");
    const forbiddenDependency =
      /(?:StudioPage|StudioInspectorAside|collaborat|(?:^|[-/])crdt(?:[-/]|$)|history|stores?\/|save)/iu;

    for (const specifier of leaf.allImports) {
      expect(specifier).not.toMatch(forbiddenDependency);
    }
    expect(leaf.source).not.toContain("patchEl(");
    expect(leaf.source).not.toContain("collaborationDocumentLocked");
    expect(leaf.source).not.toContain("setPanelSplitActive");
    expect(leaf.source).not.toContain("setSharedDocumentNotice");
    expect(leaf.source).not.toContain("disarmAllPixelTools");
    expect(inspector).toContain("onPatch={(patch) => patchEl(selected.id, patch)}");
    expect(inspector).toContain("if (collaborationDocumentLocked) return;");
    expect(inspector).toContain("setSharedDocumentNotice(null);");
    expect(inspector).toContain(
      "executeStudioInspectorArmedToggle(panelSplitActive, {",
    );
    expect(inspector).toContain("setActive: setPanelSplitActive");
  });

  it("retains optional continuity and panel split loading in the neutral registry", () => {
    const leaf = moduleEdges("./StudioInspectorFocusSpeedFrameControls.tsx");
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    expect(leaf.valueImports).toContain("./studio-page-lazy-ui");
    expect(leaf.valueImports).not.toContain("./StudioContinuityMetadataEditor");
    expect(leaf.valueImports).not.toContain("./StudioPanelSplitTool");
    expect(
      registry.dynamicImports.filter(
        (specifier) => specifier === "./StudioContinuityMetadataEditor"
      )
    ).toEqual(["./StudioContinuityMetadataEditor"]);
    expect(
      registry.dynamicImports.filter((specifier) => specifier === "./StudioPanelSplitTool")
    ).toEqual(["./StudioPanelSplitTool"]);
  });

  it("keeps leaf render paths compatible with the React Compiler", () => {
    const leaf = moduleEdges("./StudioInspectorFocusSpeedFrameControls.tsx").source;

    expect(leaf).not.toContain('"use no memo"');
    expect(leaf).not.toMatch(/\b(?:memo|useCallback|useMemo)\s*\(/u);
    expect(leaf).toContain("export function StudioInspectorFocusSpeedFrameControls(");
  });
});
