import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const files = {
  client: "studio-paper-vector-refinement-worker-client.ts",
  protocol: "studio-paper-vector-refinement-worker-protocol.ts",
  worker: "studio-paper-vector-refinement.worker.ts",
  provider: "studio-paper-vector-refinement-provider.ts",
  geometry: "../render/studio-engine-vector-geometry-provider.ts",
} as const;

function source(name: keyof typeof files): string {
  return readFileSync(new URL(`./${files[name]}`, import.meta.url), "utf8");
}

function imports(name: keyof typeof files): Array<{
  readonly specifier: string;
  readonly typeOnly: boolean;
}> {
  const file = ts.createSourceFile(
    files[name],
    source(name),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: Array<{ specifier: string; typeOnly: boolean }> = [];
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      found.push({
        specifier: statement.moduleSpecifier.text,
        typeOnly: statement.importClause?.isTypeOnly ?? false,
      });
    }
  }
  return found;
}

describe("Studio Paper vector-refinement Worker boundary", () => {
  it("keeps the Paper provider value import exclusively in the Worker", () => {
    const providerSpecifier = "./studio-paper-vector-refinement-provider";
    const clientProviderImport = imports("client").find(
      ({ specifier }) => specifier === providerSpecifier,
    );
    const protocolProviderImport = imports("protocol").find(
      ({ specifier }) => specifier === providerSpecifier,
    );
    const workerProviderImport = imports("worker").find(
      ({ specifier }) => specifier === providerSpecifier,
    );

    expect(clientProviderImport?.typeOnly).toBe(true);
    expect(protocolProviderImport?.typeOnly).toBe(true);
    expect(workerProviderImport?.typeOnly).toBe(false);
    expect(source("worker")).toContain(
      "createStudioPaperVectorRefinementProvider",
    );
    expect(source("client")).not.toContain(
      "createStudioPaperVectorRefinementProvider",
    );
    expect(source("protocol")).not.toContain(
      "createStudioPaperVectorRefinementProvider",
    );
  });

  it("uses a literal Vite module Worker URL and never falls back on main thread", () => {
    const client = source("client");
    expect(client).toContain(
      'new URL("./studio-paper-vector-refinement.worker.ts", import.meta.url)',
    );
    expect(client).toContain('type: "module"');
    expect(client).toContain("worker.terminate()");
    expect(client).toContain("mainThreadFallback: false");
    expect(client).not.toContain('import("paper")');
    expect(client).not.toContain("PaperScope");
    expect(client).not.toContain("refineOnMainThread");
    expect(source("protocol")).not.toContain('import("paper")');
    expect(source("worker")).not.toContain('import("paper")');
    expect(source("geometry")).toContain(
      'paperLibraryPromise ??= import("paper")',
    );
  });

  it("keeps Worker execution detached from UI, scene, history and persistence", () => {
    const worker = source("worker");
    for (const forbidden of [
      "StudioPage",
      "React",
      "Konva",
      "Pixi",
      "CanvasRenderingContext2D",
      "document.",
      "localStorage",
      "fetch(",
      "WebSocket",
      "commit(",
      "undo(",
    ]) {
      expect(worker, forbidden).not.toContain(forbidden);
    }
    expect(worker).toContain("scope.close()");
    expect(worker).toContain("provider?.dispose()");
    expect(worker).toContain(
      "studioPaperVectorRefinementWorkerArtifactTransfers",
    );
  });

  it("makes strict transfers, leases, timeouts and generation fencing explicit", () => {
    const protocol = source("protocol");
    const client = source("client");
    expect(protocol).toContain("TextDecoder(\"utf-8\", { fatal: true })");
    expect(protocol).toContain("value.byteOffset !== 0");
    expect(protocol).toContain("buffer instanceof ArrayBuffer");
    expect(protocol).toContain("pathDataUtf8.buffer");
    expect(protocol).toContain("contour.points.buffer");
    expect(protocol).toContain("maxOutputFlattenedPoints");
    expect(client).toContain("processWideLeaseOwner");
    expect(client).toContain("#operationReserved");
    expect(client).toContain("#startupTimeoutMilliseconds");
    expect(client).toContain("#operationTimeoutMilliseconds");
    expect(client).toContain("binding.generation !== this.#generation");
    expect(client).toContain('"messageerror"');
    expect(client).toContain("#recycleWorker");
  });
});
