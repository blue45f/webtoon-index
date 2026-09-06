import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const files = {
  client: "studio-fiber-bristle-brush-worker-client.ts",
  host: "studio-fiber-bristle-brush-worker-host.ts",
  protocol: "studio-fiber-bristle-brush-worker-protocol.ts",
  entry: "studio-fiber-bristle-brush-provider.worker.ts",
} as const;

function source(name: keyof typeof files): string {
  return readFileSync(new URL(`./${files[name]}`, import.meta.url), "utf8");
}

function analysis(name: keyof typeof files) {
  const text = source(name);
  const file = ts.createSourceFile(
    files[name],
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: Array<{ specifier: string; typeOnly: boolean }> = [];
  const identifiers = new Set<string>();
  const dynamicImports: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.importClause?.isTypeOnly ?? false,
      });
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) dynamicImports.push(node.arguments[0].text);
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { text, imports, identifiers, dynamicImports };
}

describe("Studio fiber bristle Worker AST boundary", () => {
  it("keeps all CPU execution imports out of the client", () => {
    const client = analysis("client");
    expect(client.imports.map(({ specifier }) => specifier)).toEqual([
      "./studio-fiber-bristle-brush-worker-protocol",
    ]);
    expect(client.text).not.toContain(
      "renderStudioFiberBristleBrushCpuOracle",
    );
    expect(client.text).not.toContain(
      "createStudioFiberBristleBrushProvider",
    );
    expect(client.text).toContain("this.#workerFactory");
    expect(client.text).toContain("worker.terminate()");
    expect(client.text).toContain("studioFiberBristleRequestTransfers");
  });

  it("allows the CPU provider only behind the dedicated host and type-only protocol edge", () => {
    const host = analysis("host");
    const protocol = analysis("protocol");
    const entry = analysis("entry");
    expect(host.imports.map(({ specifier }) => specifier)).toContain(
      "./studio-fiber-bristle-brush-provider",
    );
    expect(host.text).toContain("createStudioFiberBristleBrushProvider");
    expect(
      protocol.imports.find(
        ({ specifier }) =>
          specifier === "./studio-fiber-bristle-brush-provider",
      )?.typeOnly,
    ).toBe(true);
    expect(entry.imports.map(({ specifier }) => specifier)).toEqual([
      "./studio-fiber-bristle-brush-worker-host",
      "./studio-fiber-bristle-brush-worker-host",
    ]);
  });

  it("remains free of UI, renderer, network and dynamic-loader ownership", () => {
    const forbiddenIdentifiers = [
      "CanvasRenderingContext2D",
      "HTMLCanvasElement",
      "OffscreenCanvas",
      "ImageData",
      "WebGLRenderingContext",
      "GPUDevice",
      "GPUTexture",
      "React",
      "Konva",
      "Three",
      "Pixi",
      "document",
      "navigator",
      "fetch",
      "WebSocket",
      "XMLHttpRequest",
    ];
    for (const name of Object.keys(files) as Array<keyof typeof files>) {
      const file = analysis(name);
      expect(file.dynamicImports, name).toEqual([]);
      for (const identifier of forbiddenIdentifiers) {
        expect(
          file.identifiers.has(identifier),
          `${name}:${identifier}`,
        ).toBe(false);
      }
      expect(file.text).not.toMatch(
        /from\s+["'][^"']*(?:react|konva|three|pixi|canvas|webgpu)[^"']*["']/iu,
      );
    }
  });

  it("makes transfer, budgets, hard termination and no-fallback policy explicit", () => {
    const protocol = source("protocol");
    const client = source("client");
    const host = source("host");
    expect(protocol).toContain("maximumInputBytes");
    expect(protocol).toContain("maximumOutputBytes");
    expect(protocol).toContain("maximumWorkUnits");
    expect(protocol).toContain("maximumSamples");
    expect(protocol).toContain("maximumFibers");
    expect(protocol).toContain("mainThreadComputationFallback: false");
    expect(protocol).toContain("fiberTopology.buffer");
    expect(protocol).toContain("depositions.buffer");
    expect(protocol).toContain("finalLoads.buffer");
    expect(protocol).toContain("finalColors.buffer");
    expect(client).toContain("#operationReserved");
    expect(client).toContain('"startup-timeout"');
    expect(client).toContain('"operation-timeout"');
    expect(client).toContain('"messageerror"');
    expect(client).toContain('"protocol-error"');
    expect(client).toContain("#terminateWorker()");
    expect(host).toContain('"backpressure"');
    expect(host).toContain("AbortController");
  });
});
