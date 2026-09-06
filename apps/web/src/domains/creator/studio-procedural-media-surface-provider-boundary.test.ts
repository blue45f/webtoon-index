import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fileUrl = new URL("./studio-procedural-media-surface-provider.ts",
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

describe("Studio procedural media surface clean-room AST boundary", () => {
  it("allows only the portable integrity dependency and no dynamic loader", () => {
    expect(staticImports).toEqual(["./studio-sha256"]);
    expect(dynamicImports).toEqual([]);
  });

  it("owns no UI, renderer, host surface, Worker or network handle", () => {
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
    ];
    for (const identifier of forbiddenIdentifiers) {
      expect(identifiers.has(identifier), identifier).toBe(false);
    }
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:react|konva|three|pixi|canvas|webgpu)[^"']*["']/iu,
    );
  });

  it("keeps global-coordinate tiling, periodicity, flow and budgets explicit", () => {
    expect(nondeterministicCalls).toEqual([]);
    expect(identifiers.has("Float32Array")).toBe(true);
    expect(source).toContain("STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS");
    expect(source).toContain(
      '"cpu-f32-global-coordinate-oracle"',
    );
    expect(source).toContain(
      '"global-origin-with-symmetric-halo"',
    );
    expect(source).toContain('"integer-fourier-torus"');
    expect(source).toContain(
      '"global-central-difference-composite-height"',
    );
    expect(source).toContain("downhillWeight");
    expect(source).toContain("tangentWeight");
    expect(source).toContain("maximumResidentBytes");
    expect(source).toContain("maximumWorkUnits");
    expect(source).toContain('"backpressure"');
    expect(source).toContain('"aborted"');
    expect(source).toContain('"disposed"');
  });

  it("snapshots admission and cooperatively invalidates active work", () => {
    expect(source).toContain("snapshotProviderRequestAdmission");
    expect(source).toContain("snapshotRuntimeAbortSignal");
    expect(source).toContain("COOPERATIVE_PIXEL_CHUNK");
    expect(source).toContain("COOPERATIVE_HASH_FLOAT_CHUNK");
    expect(source).toContain("renderPreparedCooperatively");
    expect(source).toContain("createCooperativeTaskScheduler");
    expect(source).toContain("new MessageChannel()");
    expect(source).toContain("channel.port2.postMessage(undefined)");
    expect(source).not.toContain("setTimeout(resolve, 0)");
    expect(source).toContain("hashFloat32Cooperatively");
    expect(source).toContain('subtle.digest("SHA-256", bytes)');
    expect(source).toContain("safelyRemoveRuntimeAbortListener");
    const renderStart = source.indexOf("public async render(");
    const renderEnd = source.indexOf(
      "public advanceEngineEpoch()",
      renderStart,
    );
    const renderSource = source.slice(renderStart, renderEnd);
    const firstAwait = renderSource.indexOf("await ");
    expect(renderStart).toBeGreaterThanOrEqual(0);
    expect(renderEnd).toBeGreaterThan(renderStart);
    expect(firstAwait).toBeGreaterThanOrEqual(0);
    expect(renderSource.slice(firstAwait)).not.toContain("request.");
    expect(
      renderSource.indexOf("this.#admissionReserved = true"),
    ).toBeLessThan(
      renderSource.indexOf("snapshotProviderRequestAdmission(request)"),
    );
    expect(
      renderSource.lastIndexOf("this.#admissionReserved = false"),
    ).toBeGreaterThan(renderSource.indexOf("this.#active = execution"));
    const cleanupStart = renderSource.indexOf("const cleanup =");
    const cleanupEnd = renderSource.indexOf(
      "const rollbackAdmission =",
      cleanupStart,
    );
    const cleanupSource = renderSource.slice(cleanupStart, cleanupEnd);
    expect(cleanupSource.indexOf("this.#active = null")).toBeLessThan(
      cleanupSource.indexOf("safelyRemoveRuntimeAbortListener"),
    );
    const epochSource = source.slice(
      renderEnd,
      source.indexOf("public snapshot()", renderEnd),
    );
    expect(epochSource).not.toContain(
      "Cannot advance the media surface epoch during execution.",
    );
  });

  it("exports recipe, CPU oracle, provider and channel receipt boundaries", () => {
    const expectedExports = [
      "StudioProceduralMediaSurfaceRecipe",
      "StudioProceduralMediaSurfaceRegion",
      "StudioProceduralMediaSurfaceArtifact",
      "StudioProceduralMediaSurfaceReceipt",
      "StudioProceduralMediaSurfaceError",
      "StudioProceduralMediaSurfaceProvider",
      "createStudioProceduralMediaSurfaceRecipe",
      "parseStudioProceduralMediaSurfaceRecipe",
      "renderStudioProceduralMediaSurfaceCpuOracle",
      "verifyStudioProceduralMediaSurfaceRenderReceiptIntegrity",
      "createStudioProceduralMediaSurfaceProvider",
    ];
    for (const name of expectedExports) {
      expect(exportedNames.has(name), name).toBe(true);
    }
    expect(source).toContain("heightHash");
    expect(source).toContain("absorbencyHash");
    expect(source).toContain("grainHash");
    expect(source).toContain("flowHash");
    expect(source).not.toMatch(
      /\b(?:vendor|photoshop|painter|fresco|clipstudio|corel|adobe)\b/iu,
    );
  });
});
