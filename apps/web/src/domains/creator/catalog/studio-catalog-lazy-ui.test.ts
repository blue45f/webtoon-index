import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

function readSource(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function dynamicImports(file: ts.SourceFile): string[] {
  const paths: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      paths.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return paths;
}

describe("scene catalog lazy-loading boundary", () => {
  it("keeps one deferred catalog import behind the shared retry policy", () => {
    const file = readSource("./studio-catalog-lazy-ui.ts");
    const imports = file.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => statement.moduleSpecifier.getText(file));

    expect(imports).toEqual(['"@/shared/lib/lazy-retry"']);
    expect(dynamicImports(file)).toEqual(["./StudioSceneTemplateBrowser"]);
    expect(file.getFullText()).toContain("export const StudioSceneTemplateBrowser = lazyRetry(");
    expect(file.getFullText()).toContain("default: module.StudioSceneTemplateBrowser");
  });

  it("does not create a reverse editor dependency or a second state owner", () => {
    const source = readSource("./studio-catalog-lazy-ui.ts").getFullText();

    expect(source).not.toMatch(/from\s+["'][^"']*(?:StudioPage|StudioToolBelt|studio-page-lazy-ui)/u);
    expect(source).not.toMatch(/\b(?:useState|useReducer|createRoot)\s*\(/u);
  });

  it("keeps scene rendering under the caller's menu intent and Suspense", () => {
    const file = readSource("../StudioAssetToolPopoverBody.tsx");
    const source = file.getFullText();
    const sceneStart = source.indexOf('{menu === "scene" && (');
    const sceneEnd = source.indexOf('{menu === "clip" && (', sceneStart);
    const scene = source.slice(sceneStart, sceneEnd);

    expect(dynamicImports(file)).toEqual([]);
    expect(source).toContain('from "./catalog/studio-catalog-lazy-ui"');
    expect(sceneStart).toBeGreaterThan(0);
    expect(sceneEnd).toBeGreaterThan(sceneStart);
    expect(scene).toContain("<Suspense");
    expect(scene).toContain("<StudioSceneTemplateBrowser");
    expect(scene).toContain("onAdd={addSceneTemplate}");
    expect(scene).toContain("error={sceneTemplatesError}");
    expect(scene).toContain("</Suspense>");
  });
});
