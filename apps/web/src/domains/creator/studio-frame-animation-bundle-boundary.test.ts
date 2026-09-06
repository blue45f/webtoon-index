import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

function moduleEdges(fileName: string) {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const valueImports: string[] = [];
  const valueReexports: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      valueImports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      valueReexports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { valueImports, valueReexports };
}

describe("Studio frame animation lazy export boundary", () => {
  it("keeps the always-on frame model free of MediaRecorder and motion export imports", () => {
    const model = moduleEdges("./studio-frame-animation.ts");
    const timing = moduleEdges("./studio-frame-animation-timing.ts");

    expect(model.valueImports).not.toContain("./export/studio-motion-export");
    expect(model.valueReexports).not.toContain("./export/studio-frame-animation-export");
    expect(timing.valueImports).toEqual([]);
    expect(timing.valueReexports).toEqual([]);
  });

  it("isolates motion export in the panel-only runtime module", () => {
    const runtime = moduleEdges("./export/studio-frame-animation-export.ts");
    const panel = moduleEdges("./StudioFrameAnimationPanel.tsx");

    expect(runtime.valueImports).toContain("./studio-motion-export");
    expect(runtime.valueImports).toContain("../studio-frame-animation-timing");
    expect(runtime.valueImports).not.toContain("../studio-frame-animation");
    expect(panel.valueImports).toContain("./studio-frame-animation");
    expect(panel.valueImports).toContain("./export/studio-frame-animation-export");
  });

  it("does not import the export runtime from the Studio route entry", () => {
    const studio = moduleEdges("./StudioCuttoonEditorHost.tsx");

    expect(studio.valueImports).toContain("./studio-frame-animation");
    expect(studio.valueImports).not.toContain("./export/studio-frame-animation-export");
    expect(studio.valueImports).not.toContain("./export/studio-motion-export");
  });
});
