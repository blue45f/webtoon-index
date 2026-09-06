import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-multi-light-surface-provider.ts",
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

describe("Studio multi-light surface clean-room AST boundary", () => {
  it("depends only on portable hashing and not another filter implementation", () => {
    expect(analysis.staticImports).toEqual(["./studio-sha256"]);
    expect(analysis.dynamicImports).toEqual([]);
    expect(analysis.staticImports.some(
      (specifier) => (
        specifier.includes("live-surface")
        || specifier.includes("canonical-filter")
        || specifier.includes("webgpu")
      ),
    )).toBe(false);
  });

  it("keeps the CPU oracle isolated from host renderers and concurrency runtimes", () => {
    const forbiddenIdentifiers = [
      "CanvasRenderingContext2D",
      "OffscreenCanvas",
      "ImageData",
      "GPUDevice",
      "GPUTexture",
      "GPUBuffer",
      "Worker",
      "SharedArrayBuffer",
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
    expect(source).toContain(
      '"deterministic-tiled-canonical-light-order"',
    );
    expect(source).toContain("maximumWorkUnits");
    expect(source).toContain("residentBytes");
    expect(source).toContain("haloPixels: 1");
  });

  it("exports explicit recipe, resource, oracle and lifecycle boundaries", () => {
    const expectedExports = [
      "StudioMultiLightSurfaceRecipe",
      "StudioMultiLightSurfaceImage",
      "StudioMultiLightSurfaceScalarMap",
      "StudioMultiLightSurfaceNormalMap",
      "StudioMultiLightSurfaceCpuOracleReceipt",
      "StudioMultiLightSurfaceReceipt",
      "StudioMultiLightSurfaceProvider",
      "StudioMultiLightSurfaceError",
      "createStudioMultiLightSurfaceRecipe",
      "parseStudioMultiLightSurfaceRecipe",
      "serializeStudioMultiLightSurfaceRecipe",
      "renderStudioMultiLightSurfaceCpuOracle",
      "createStudioMultiLightSurfaceProvider",
    ];
    for (const name of expectedExports) {
      expect(analysis.exported.has(name), name).toBe(true);
    }
    expect(source).toContain('"scene-linear-straight-rgba-f32"');
    expect(source).toContain('"preserve-source-alpha-exactly"');
    expect(source).toContain('"directional"');
    expect(source).toContain('"point"');
    expect(source).toContain('"spot"');
    expect(source).toContain('"inverse-square"');
    expect(source).toContain('"smooth-range"');
  });

  it("contains no time, random, commercial-product or vendor-specific inputs", () => {
    expect(analysis.nondeterministicCalls).toEqual([]);
    expect(source).not.toMatch(/\bvendor(?:Mode|Id|Code)\b/u);
    expect(source).not.toMatch(/\bphotoshop\b/iu);
    expect(source).not.toMatch(/\baffinity\b/iu);
    expect(source).not.toMatch(/\bcorel\b/iu);
    expect(source).not.toMatch(/\btoon\s*boom\b/iu);
  });
});
