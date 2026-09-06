import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-live-surface-filter-provider.ts",
  import.meta.url,
);
const source = readFileSync(fileUrl, "utf8");
const file = ts.createSourceFile(
  fileUrl.pathname,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function moduleAnalysis() {
  const staticImports: string[] = [];
  const dynamicImports: string[] = [];
  const identifiers = new Set<string>();
  const exported = new Set<string>();
  const nondeterministicCalls: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) staticImports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) dynamicImports.push(node.arguments[0].text);
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && (
        (
          node.expression.expression.text === "Math"
          && node.expression.name.text === "random"
        )
        || (
          node.expression.expression.text === "Date"
          && node.expression.name.text === "now"
        )
        || (
          node.expression.expression.text === "performance"
          && node.expression.name.text === "now"
        )
      )
    ) nondeterministicCalls.push(node.expression.getText(file));
    ts.forEachChild(node, visit);
  }

  for (const statement of file.statements) {
    if (
      (
        ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
      )
      && statement.name
      && ts.getModifiers(statement)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) exported.add(statement.name.text);
  }
  visit(file);
  return {
    staticImports,
    dynamicImports,
    identifiers,
    exported,
    nondeterministicCalls,
  };
}

const analysis = moduleAnalysis();

describe("Studio live surface filter clean-room AST boundary", () => {
  it("is isolated from existing canonical filters and renderer-specific runtimes", () => {
    expect(analysis.staticImports).toEqual(["../studio-sha256"]);
    expect(analysis.dynamicImports).toEqual([]);
    expect(analysis.staticImports.some(
      (specifier) => (
        specifier.includes("canonical-filter")
        || specifier.includes("webgpu-filter")
        || specifier.includes("konva")
      ),
    )).toBe(false);
  });

  it("keeps the oracle typed-array-only and free of host rendering handles", () => {
    const forbiddenIdentifiers = [
      "CanvasRenderingContext2D",
      "OffscreenCanvas",
      "ImageData",
      "GPUDevice",
      "GPUTexture",
      "GPUBuffer",
      "Worker",
      "Blob",
      "document",
      "window",
      "navigator",
      "postMessage",
    ];
    for (const identifier of forbiddenIdentifiers) {
      expect(analysis.identifiers.has(identifier), identifier).toBe(false);
    }
    expect(analysis.identifiers.has("Float32Array")).toBe(true);
    expect(source).toContain('"deterministic-tiled-oracle"');
    expect(source).toContain("haloPixels");
    expect(source).toContain("tileEdge");
  });

  it("exports explicit recipe, CPU oracle and provider boundaries", () => {
    const expectedExports = [
      "StudioLiveSurfaceFilterRecipe",
      "StudioLiveSurfaceImage",
      "StudioLiveSurfaceCpuOracleReceipt",
      "StudioLiveSurfaceFilterReceipt",
      "StudioLiveSurfaceFilterProvider",
      "StudioLiveSurfaceFilterError",
      "createStudioLiveSurfaceFilterRecipe",
      "parseStudioLiveSurfaceFilterRecipe",
      "serializeStudioLiveSurfaceFilterRecipe",
      "renderStudioLiveSurfaceFilterCpuOracle",
      "createStudioLiveSurfaceFilterProvider",
    ];
    for (const name of expectedExports) {
      expect(analysis.exported.has(name), name).toBe(true);
    }
    expect(source).toContain('"scene-linear-straight-rgba-f32"');
    expect(source).toContain('"preserve-displaced-source-alpha"');
  });

  it("does not introduce time or random inputs into deterministic hashes", () => {
    expect(analysis.nondeterministicCalls).toEqual([]);
    expect(source).not.toMatch(/\bvendor(?:Mode|Id|Code)\b/u);
    expect(source).not.toMatch(/\bphotoshop\b/iu);
    expect(source).not.toMatch(/\baffinity\b/iu);
  });
});
