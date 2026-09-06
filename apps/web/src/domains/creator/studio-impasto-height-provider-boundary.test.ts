import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-impasto-height-provider.ts", import.meta.url);
const source = readFileSync(fileUrl, "utf8");
const file = ts.createSourceFile(
  fileUrl.pathname,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const staticImports: string[] = [];
const dynamicImports: string[] = [];
const forbiddenIdentifiers: string[] = [];
const forbiddenNames = new Set([
  "CanvasRenderingContext2D",
  "HTMLCanvasElement",
  "OffscreenCanvas",
  "Worker",
  "WebGLRenderingContext",
  "GPUDevice",
  "document",
  "navigator",
  "window",
]);

function visit(node: ts.Node): void {
  if (
    ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier)
  ) {
    staticImports.push(node.moduleSpecifier.text);
  }
  if (
    ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword
    && node.arguments.length === 1
    && ts.isStringLiteral(node.arguments[0])
  ) {
    dynamicImports.push(node.arguments[0].text);
  }
  if (ts.isIdentifier(node) && forbiddenNames.has(node.text)) {
    forbiddenIdentifiers.push(node.text);
  }
  ts.forEachChild(node, visit);
}

visit(file);

describe("Studio impasto height provider AST boundary", () => {
  it("keeps a single dependency-free integrity edge and no dynamic loader", () => {
    expect(staticImports).toEqual(["./studio-sha256"]);
    expect(dynamicImports).toEqual([]);
  });

  it("contains no renderer, DOM, worker, UI or GPU ownership", () => {
    expect(forbiddenIdentifiers).toEqual([]);
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:react|konva|three|pixi|paper|canvas)[^"']*["']/iu,
    );
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest)\b/u);
  });

  it("keeps signed state, budgets, hashes and conservation explicit", () => {
    expect(source).toContain("STUDIO_IMPASTO_HEIGHT_BUDGETS");
    expect(source).toContain('"add-height"');
    expect(source).toContain('"excavate"');
    expect(source).toContain('"flatten"');
    expect(source).toContain("beforeHash");
    expect(source).toContain("afterHash");
    expect(source).toContain("intentionalHeightDelta");
    expect(source).toContain("plowRedistributedHeight");
    expect(source).toContain("conservationError");
    expect(source).toContain("Math.fround");
  });
});
