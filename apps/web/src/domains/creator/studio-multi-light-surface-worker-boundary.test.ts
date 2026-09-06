import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const files = {
  client: "studio-multi-light-surface-worker-client.ts",
  host: "studio-multi-light-surface-worker-host.ts",
  protocol: "studio-multi-light-surface-worker-protocol.ts",
  worker: "studio-multi-light-surface-provider.worker.ts",
} as const;

function source(name: keyof typeof files): string {
  return readFileSync(new URL(`./${files[name]}`, import.meta.url), "utf8");
}

function imports(name: keyof typeof files): readonly string[] {
  const text = source(name);
  const file = ts.createSourceFile(
    files[name],
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return file.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
    ) return [];
    return [statement.moduleSpecifier.text];
  });
}

describe("Studio multi-light surface Worker source boundary", () => {
  it("keeps the CPU oracle executable out of the browser client", () => {
    expect(imports("client")).toEqual([
      "./studio-multi-light-surface-worker-protocol",
    ]);
    expect(source("client")).not.toContain(
      "renderStudioMultiLightSurfaceCpuOracle",
    );
    expect(source("client")).not.toContain(
      "createStudioMultiLightSurfaceProvider",
    );
    expect(source("protocol")).toContain(
      "mainThreadComputationFallback: false",
    );
    expect(source("client")).toContain("this.worker.terminate()");
    expect(source("client")).toContain(
      "studioMultiLightSurfaceRequestTransfers",
    );
  });

  it("allows provider execution only in the dedicated Worker host", () => {
    expect(imports("host")).toContain(
      "./studio-multi-light-surface-provider",
    );
    expect(source("host")).toContain(
      "createStudioMultiLightSurfaceProvider",
    );
    expect(imports("worker")).toEqual([
      "./studio-multi-light-surface-worker-host",
      "./studio-multi-light-surface-worker-host",
    ]);
    expect(source("worker")).toContain(
      "installStudioMultiLightSurfaceWorkerHost",
    );
  });

  it("remains UI, renderer, DOM, storage and network neutral", () => {
    for (const name of Object.keys(files) as Array<keyof typeof files>) {
      const text = source(name);
      expect(imports(name)).not.toEqual(
        expect.arrayContaining([
          "react",
          "konva",
          "three",
          "pixi.js",
        ]),
      );
      expect(text).not.toMatch(
        /from\s+["'][^"']*(?:react|konva|three|pixi)[^"']*["']/iu,
      );
      expect(text).not.toMatch(/\b(?:document|navigator)\s*\./u);
      expect(text).not.toMatch(
        /\b(?:fetch|WebSocket|XMLHttpRequest|indexedDB|localStorage)\b/u,
      );
      expect(text).not.toContain("getContext(");
    }
  });

  it("makes transfer, budgets, epochs and hard-failure policy explicit", () => {
    const protocol = source("protocol");
    const client = source("client");
    const host = source("host");
    expect(protocol).toContain("maximumInputBytes");
    expect(protocol).toContain("maximumOutputBytes");
    expect(protocol).toContain("maximumResidentBytes");
    expect(protocol).toContain("maximumWorkUnits");
    expect(protocol).toContain("resourceHash");
    expect(protocol.indexOf("const inputBytes = sourceDeclaration.bytes"))
      .toBeLessThan(protocol.indexOf("const source = copyImage("));
    expect(client).toContain("operationReserved");
    expect(client).toContain('"operation-timeout"');
    expect(client).toContain('"messageerror"');
    expect(host).toContain('"backpressure"');
    expect(host).toContain('"device-epoch"');
    expect(host).toContain("AbortController");
  });
});
