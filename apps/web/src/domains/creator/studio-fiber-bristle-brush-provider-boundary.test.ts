import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-fiber-bristle-brush-provider.ts",
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

const staticImports: string[] = [];
const dynamicImports: string[] = [];
const identifiers = new Set<string>();
const exportedNames = new Set<string>();
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
  ) exportedNames.add(statement.name.text);
}
visit(file);

describe("Studio fiber bristle brush clean-room AST boundary", () => {
  it("allows only the portable integrity dependency and no dynamic loading", () => {
    expect(staticImports).toEqual([
      "./studio-fiber-bristle-brush-integrity",
      "./studio-sha256",
    ]);
    expect(dynamicImports).toEqual([]);
  });

  it("owns no UI, renderer, host, network or parallel-runtime handles", () => {
    const forbiddenIdentifiers = [
      "CanvasRenderingContext2D",
      "HTMLCanvasElement",
      "OffscreenCanvas",
      "ImageData",
      "WebGLRenderingContext",
      "GPUDevice",
      "GPUTexture",
      "GPUBuffer",
      "Worker",
      "React",
      "Konva",
      "Three",
      "Pixi",
      "document",
      "window",
      "navigator",
      "fetch",
      "WebSocket",
      "XMLHttpRequest",
      "postMessage",
    ];
    for (const identifier of forbiddenIdentifiers) {
      expect(identifiers.has(identifier), identifier).toBe(false);
    }
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:react|konva|three|pixi|canvas|webgpu)[^"']*["']/iu,
    );
  });

  it("keeps deterministic typed-array quality, budgets and replay explicit", () => {
    expect(nondeterministicCalls).toEqual([]);
    expect(identifiers.has("Float32Array")).toBe(true);
    expect(source).toContain("STUDIO_FIBER_BRISTLE_HARD_LIMITS");
    expect(source).toContain("STUDIO_FIBER_BRISTLE_DEPOSITION_STRIDE");
    expect(source).toContain('"bounded-lag-arc-length-v1"');
    expect(source).toContain("replayHash");
    expect(source).toContain("artifactHash");
    expect(source).toContain('"append"');
    expect(source).toContain('"aborted"');
    expect(source).toContain('"disposed"');
  });

  it("exports recipe, oracle and provider boundaries without product identifiers", () => {
    const expectedExports = [
      "StudioFiberBristleSampleInput",
      "StudioFiberBristleBrushRecipe",
      "StudioFiberBristleBrushArtifact",
      "StudioFiberBristleCpuOracleReceipt",
      "StudioFiberBristleBrushError",
      "StudioFiberBristleBrushProvider",
      "createStudioFiberBristleBrushRecipe",
      "parseStudioFiberBristleBrushRecipe",
      "renderStudioFiberBristleBrushCpuOracle",
      "createStudioFiberBristleBrushProvider",
    ];
    for (const name of expectedExports) {
      expect(exportedNames.has(name), name).toBe(true);
    }
    expect(source).not.toMatch(
      /\b(?:vendor|photoshop|painter|fresco|clipstudio|corel|adobe)\b/iu,
    );
  });
});
