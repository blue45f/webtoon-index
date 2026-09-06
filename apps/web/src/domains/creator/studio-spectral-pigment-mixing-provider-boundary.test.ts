import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-spectral-pigment-mixing-provider.ts",
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

function analyze() {
  const imports: string[] = [];
  const identifiers = new Set<string>();
  const exported = new Set<string>();
  const nondeterministicCalls: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) imports.push(node.moduleSpecifier.text);
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
  return { imports, identifiers, exported, nondeterministicCalls };
}

const analysis = analyze();

describe("Studio spectral pigment clean-room boundary", () => {
  it("depends only on the shared content hash primitive", () => {
    expect(analysis.imports).toEqual(["./studio-sha256"]);
    expect(source).not.toMatch(/\b(?:rebelle|corel|painter|vendor)\b/iu);
  });

  it("is renderer neutral, deterministic and typed-array based", () => {
    const forbidden = [
      "CanvasRenderingContext2D",
      "OffscreenCanvas",
      "ImageData",
      "GPUDevice",
      "GPUTexture",
      "GPUBuffer",
      "Worker",
      "document",
      "window",
      "navigator",
    ];
    for (const identifier of forbidden) {
      expect(analysis.identifiers.has(identifier), identifier).toBe(false);
    }
    expect(analysis.identifiers.has("Float32Array")).toBe(true);
    expect(analysis.nondeterministicCalls).toEqual([]);
  });

  it("exposes recipe, oracle and provider lifecycle boundaries", () => {
    const expected = [
      "StudioSpectralPigmentRecipe",
      "StudioSpectralPigmentMixArtifact",
      "StudioSpectralPigmentMixReceipt",
      "StudioSpectralPigmentProvider",
      "StudioSpectralPigmentError",
      "createStudioSpectralPigmentRecipe",
      "parseStudioSpectralPigmentRecipe",
      "serializeStudioSpectralPigmentRecipe",
      "mixStudioSpectralPigmentRecipe",
      "createStudioSpectralPigmentProvider",
    ];
    for (const name of expected) {
      expect(analysis.exported.has(name), name).toBe(true);
    }
    expect(source).toContain('"kubelka-munk-two-flux-spectral"');
    expect(source).toContain('"kubelka-munk-two-flux-unit-scattering"');
    expect(source).toContain('"cie-1931-2deg-analytic-fit"');
  });
});
