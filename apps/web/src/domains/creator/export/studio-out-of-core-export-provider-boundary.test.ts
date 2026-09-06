import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-out-of-core-export-provider.ts",
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

function analyzeModule() {
  const staticImports: string[] = [];
  const dynamicImports: string[] = [];
  const identifiers = new Set<string>();
  const exports = new Set<string>();
  const nondeterministicCalls: string[] = [];
  const byteAllocationArguments: string[] = [];

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
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Uint8Array"
    ) {
      byteAllocationArguments.push(
        node.arguments?.map((argument) => argument.getText(file)).join(",")
        ?? "",
      );
    }
    ts.forEachChild(node, visit);
  }

  for (const statement of file.statements) {
    const named = (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isVariableStatement(statement)
    );
    if (
      named
      && ts.getModifiers(statement)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exports.add(declaration.name.text);
        }
      } else if (statement.name) {
        exports.add(statement.name.text);
      }
    }
  }
  visit(file);
  return {
    staticImports,
    dynamicImports,
    identifiers,
    exports,
    nondeterministicCalls,
    byteAllocationArguments,
  };
}

const analysis = analyzeModule();

describe("Studio out-of-core export clean-room AST boundary", () => {
  it("depends only on the portable digest primitive", () => {
    expect(analysis.staticImports).toEqual(["../studio-sha256"]);
    expect(analysis.dynamicImports).toEqual([]);
  });

  it("has no host renderer, UI, worker, network, or engine boundary", () => {
    const forbiddenIdentifiers = [
      "CanvasRenderingContext2D",
      "OffscreenCanvas",
      "HTMLCanvasElement",
      "ImageData",
      "GPU",
      "GPUDevice",
      "GPUTexture",
      "GPUBuffer",
      "Worker",
      "SharedWorker",
      "React",
      "Konva",
      "THREE",
      "PIXI",
      "document",
      "window",
      "navigator",
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "postMessage",
    ];
    for (const identifier of forbiddenIdentifiers) {
      expect(analysis.identifiers.has(identifier), identifier).toBe(false);
    }
    expect(source).not.toMatch(/\bvendor(?:Id|Mode|Name|Code)?\b/iu);
  });

  it("does not allocate a logical or output-sized raster", () => {
    for (const argument of analysis.byteAllocationArguments) {
      expect(argument).not.toMatch(
        /\b(?:logicalPixelCount|outputPixelCount|pixelWidth|pixelHeight)\b/u,
      );
    }
    expect(source).toContain("tiles(): IterableIterator");
    expect(source).toContain("reservedResidentBytes");
    expect(source).not.toContain("Array.from(plan.tiles())");
  });

  it("exports explicit planning, adapter, receipt, and lifecycle contracts", () => {
    const expectedExports = [
      "STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION",
      "STUDIO_OUT_OF_CORE_EXPORT_DEFAULT_BUDGETS",
      "StudioOutOfCoreExportPlan",
      "StudioOutOfCoreTilePlan",
      "StudioOutOfCoreRendererAdapter",
      "StudioOutOfCoreSinkAdapter",
      "StudioOutOfCoreResumeManifest",
      "StudioOutOfCoreExportReceipt",
      "StudioOutOfCoreExportError",
      "StudioOutOfCoreExportProvider",
      "createStudioOutOfCoreExportPlan",
      "createStudioOutOfCoreExportProvider",
    ];
    for (const name of expectedExports) {
      expect(analysis.exports.has(name), name).toBe(true);
    }
    expect(source).toContain('"complete" | "fail-closed"');
    expect(source).toContain('"row-major" | "morton"');
    expect(source).toContain("defaultOperationTimeoutMs");
    expect(source).toContain("maxOperationTimeoutMs");
    expect(source).toContain("operationTimeoutMs");
    expect(source).toContain('"operation-timeout"');
  });

  it("makes adapter waits and hostile signal cleanup explicitly fail closed", () => {
    expect(source).toContain("raceAdapterOperation");
    expect(source).toContain("normalizeExternalAbortSignal");
    expect(source).toContain("safeRemoveExternalAbortListener");
    expect(source).toContain("controller.signal.addEventListener");
  });

  it("keeps deterministic hashes independent from clocks and randomness", () => {
    expect(analysis.nondeterministicCalls).toEqual([]);
    expect(source).toContain("canonicalPlanRecord");
    expect(source).toContain("rollingTileManifestHash");
  });
});
