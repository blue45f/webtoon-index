import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const files = {
  client: "studio-procedural-media-surface-worker-client.ts",
  host: "studio-procedural-media-surface-worker-host.ts",
  protocol: "studio-procedural-media-surface-worker-protocol.ts",
  entry: "studio-procedural-media-surface-provider.worker.ts",
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

describe("Studio procedural media surface Worker AST boundary", () => {
  it("keeps all CPU execution imports out of the client", () => {
    const client = analysis("client");
    expect(client.imports.map(({ specifier }) => specifier)).toEqual([
      "./studio-procedural-media-surface-worker-protocol",
    ]);
    expect(client.text).not.toContain(
      "createStudioProceduralMediaSurfaceProvider",
    );
    expect(client.text).not.toContain(
      "renderStudioProceduralMediaSurfaceCpuOracle",
    );
    expect(client.text).toContain("this.#workerFactory");
    expect(client.text).toContain("worker.terminate()");
    expect(client.text).toContain(
      "studioProceduralMediaSurfaceRequestTransfers",
    );
  });

  it("allows the CPU provider only behind the host and type-only protocol edge", () => {
    const host = analysis("host");
    const protocol = analysis("protocol");
    const entry = analysis("entry");
    expect(host.imports.map(({ specifier }) => specifier)).toContain(
      "./studio-procedural-media-surface-provider",
    );
    expect(host.text).toContain(
      "createStudioProceduralMediaSurfaceProvider",
    );
    expect(
      protocol.imports.find(
        ({ specifier }) =>
          specifier === "./studio-procedural-media-surface-provider",
      )?.typeOnly,
    ).toBe(true);
    expect(entry.imports.map(({ specifier }) => specifier)).toEqual([
      "./studio-procedural-media-surface-worker-host",
      "./studio-procedural-media-surface-worker-host",
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

  it("makes transfers, budgets, hard termination and no-fallback policy explicit", () => {
    const protocol = source("protocol");
    const client = source("client");
    const host = source("host");
    expect(protocol).toContain("maximumInputBytes");
    expect(protocol).toContain("maximumOutputBytes");
    expect(protocol).toContain("maximumResidentBytes");
    expect(protocol).toContain("maximumWorkUnits");
    expect(protocol).toContain("maximumOutputPixels");
    expect(protocol).toContain("mainThreadComputationFallback: false");
    expect(protocol).toContain("host-recomputed-sha256");
    expect(protocol).toContain(
      "verifyStudioProceduralMediaSurfaceWorkerPayloadIntegrity",
    );
    expect(protocol).toContain('subtle.digest(');
    expect(protocol).toContain("vectors.buffer");
    expect(protocol).toContain("heightField.buffer");
    expect(protocol).toContain("absorbency.buffer");
    expect(protocol).toContain("grain.buffer");
    expect(protocol).toContain("flow.buffer");
    expect(client).toContain("#operationReserved");
    expect(client).toContain("snapshotRuntimeAbortSignal");
    expect(client).toContain("safelyRemoveRuntimeAbortListener");
    expect(client).toContain("coreOriginX");
    expect(client).toContain("outputOriginX");
    expect(client).toContain('"startup-timeout"');
    expect(client).toContain('"operation-timeout"');
    expect(client).toContain('"messageerror"');
    expect(client).toContain('"protocol-error"');
    expect(client).toContain("#terminateWorker()");
    expect(host).toContain('"backpressure"');
    expect(host).toContain("AbortController");
    expect(host).toContain(
      "verifyStudioProceduralMediaSurfaceRenderReceiptIntegrity",
    );
    expect(host).toContain(
      "createStudioProceduralMediaSurfaceWorkerVerifiedAttestation",
    );
    const renderStart = client.indexOf("public async render(");
    const renderEnd = client.indexOf("public release()", renderStart);
    const renderSource = client.slice(renderStart, renderEnd);
    expect(
      renderSource.indexOf("this.#operationReserved = true"),
    ).toBeLessThan(renderSource.indexOf("snapshotRuntimeAbortSignal(signal)"));
    expect(
      renderSource.indexOf("this.#operationReserved = true"),
    ).toBeLessThan(
      renderSource.indexOf(
        "snapshotStudioProceduralMediaSurfaceWorkerRequest(candidate)",
      ),
    );
    expect(
      renderSource.lastIndexOf("this.#operationReserved = false"),
    ).toBeGreaterThan(renderSource.indexOf("this.#active = active"));
  });
});
