import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-physics-particle-brush-provider.ts",
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
      ts.canHaveModifiers(statement)
      && ts.getModifiers(statement)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exports.add(declaration.name.text);
        }
      } else if (
        (
          ts.isFunctionDeclaration(statement)
          || ts.isClassDeclaration(statement)
          || ts.isInterfaceDeclaration(statement)
          || ts.isTypeAliasDeclaration(statement)
        )
        && statement.name
      ) exports.add(statement.name.text);
    }
  }
  visit(file);
  return {
    staticImports,
    dynamicImports,
    identifiers,
    exports,
    nondeterministicCalls,
  };
}

const analysis = analyzeModule();

describe("Studio physics particle brush clean-room AST boundary", () => {
  it("depends only on the portable digest primitive", () => {
    expect(analysis.staticImports).toEqual(["./studio-sha256"]);
    expect(analysis.dynamicImports).toEqual([]);
  });

  it("has no UI, raster, GPU, worker, network, media-input, or engine boundary", () => {
    const forbiddenIdentifiers = [
      "CanvasRenderingContext2D",
      "OffscreenCanvas",
      "HTMLCanvasElement",
      "ImageData",
      "GPU",
      "GPUDevice",
      "GPUTexture",
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
      "MediaStream",
      "MediaDevices",
      "AudioContext",
      "microphone",
      "postMessage",
    ];
    for (const identifier of forbiddenIdentifiers) {
      expect(analysis.identifiers.has(identifier), identifier).toBe(false);
    }
    expect(source).not.toMatch(/\bvendor(?:Id|Mode|Name|Code)?\b/iu);
    expect(source).not.toMatch(/\b(?:audio|microphone)\b/iu);
  });

  it("exposes only generic modes and renderer-neutral typed-array artifacts", () => {
    expect(source).toContain('"orbital" | "flow" | "spring-net"');
    expect(source).toContain('"radial" | "chain" | "ring"');
    expect(source).toContain("Float32Array");
    expect(source).toContain("Uint32Array");
    expect(source).toContain('"straight-unassociated-coverage"');
    expect(source).toContain('"normalized-path-weight"');
    expect(source).toContain('"additive-linear-energy"');
  });

  it("exports a compact recipe, request, artifact, receipt, and lifecycle API", () => {
    const expectedExports = [
      "STUDIO_PHYSICS_PARTICLE_BRUSH_REVISION",
      "STUDIO_PHYSICS_PARTICLE_APPEND_POLICY",
      "STUDIO_PHYSICS_PARTICLE_BRUSH_BUDGETS",
      "StudioPhysicsParticleBrushRecipe",
      "StudioPhysicsParticleBrushRequest",
      "StudioPhysicsParticleBrushArtifact",
      "StudioPhysicsParticleBrushReceipt",
      "StudioPhysicsParticleBrushError",
      "StudioPhysicsParticleBrushProvider",
      "createStudioPhysicsParticleBrushProvider",
    ];
    for (const name of expectedExports) {
      expect(analysis.exports.has(name), name).toBe(true);
    }
    expect(source).toContain('"prefix-validated-fixed-station-exact"');
    expect(source).toContain('"complete" | "fail-closed"');
  });

  it("uses seeded hashes instead of clock or random inputs", () => {
    expect(analysis.nondeterministicCalls).toEqual([]);
    expect(source).toContain("deterministicUnit");
    expect(source).toContain("fixedTimeStepSeconds");
    expect(source).toContain("spawnSpacing");
  });

  it("preflights owned memory and yields only at bounded work slices", () => {
    expect(source).toContain("preflightFlowField");
    expect(source).toContain("preflightPreviousArtifactMetadata");
    expect(source).toContain("validatePreviousArtifactArrays");
    expect(source).toContain("checkedByteSum");
    expect(source).not.toContain("Array.from(input.heights)");
    expect(source).toContain("COOPERATIVE_WORK_CHUNK = 131_072");
    expect(source).toContain("workSinceYield >= COOPERATIVE_WORK_CHUNK");
    expect(source).toContain("await yieldTask()");
    expect(source).toContain("createCooperativeYieldScheduler");
    expect(source).toContain("clearTimeout(current.timer)");
    expect(source).toContain("hashBytesCooperatively");
    expect(source).toContain('subtle.digest("SHA-256", source)');
  });

  it("cleans internal lifecycle state before hostile listener cleanup", () => {
    const internalCleanup = source.lastIndexOf(
      "if (activeController === controller) activeController = null",
    );
    const externalCleanup = source.lastIndexOf(
      "removeAbortListenerSafely(signalBridge, onAbort)",
    );
    expect(internalCleanup).toBeGreaterThan(0);
    expect(externalCleanup).toBeGreaterThan(internalCleanup);
    expect(source).toContain("normalizeAbortSignal");
    expect(source).toContain("addAbortListenerSafely");
    expect(source).toContain("abortSignalIsAbortedSafely");
  });
});
