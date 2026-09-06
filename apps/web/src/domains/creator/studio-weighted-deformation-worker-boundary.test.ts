import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const files = {
  client: "studio-weighted-deformation-worker-client.ts",
  host: "studio-weighted-deformation-worker-host.ts",
  protocol: "studio-weighted-deformation-worker-protocol.ts",
  worker: "studio-weighted-deformation-provider.worker.ts",
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
    ) {
      return [];
    }
    return [statement.moduleSpecifier.text];
  });
}

describe("Studio weighted deformation Worker source boundary", () => {
  it("keeps the CPU oracle executable out of the browser client", () => {
    expect(imports("client")).toEqual([
      "./studio-weighted-deformation-worker-protocol",
    ]);
    expect(source("client")).not.toContain(
      "applyStudioWeightedDeformation",
    );
    expect(source("protocol")).toContain(
      "mainThreadComputationFallback",
    );
    expect(source("client")).toContain("this.worker.terminate()");
    expect(source("client")).toContain(
      "studioWeightedDeformationRequestTransfers",
    );
  });

  it("allows the CPU oracle only in the dedicated Worker host", () => {
    expect(imports("host")).toContain(
      "./studio-weighted-deformation-provider",
    );
    expect(source("host")).toContain("applyStudioWeightedDeformation");
    expect(imports("worker")).toEqual([
      "./studio-weighted-deformation-worker-host",
      "./studio-weighted-deformation-worker-host",
    ]);
    expect(source("worker")).toContain(
      "installStudioWeightedDeformationWorkerHost",
    );
  });

  it("remains renderer, UI, DOM and network neutral", () => {
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
        /\b(?:fetch|WebSocket|XMLHttpRequest)\b/u,
      );
      expect(text).not.toContain("getContext(");
    }
  });

  it("keeps strict budgets, epochs, backpressure and failure boundaries explicit", () => {
    const protocol = source("protocol");
    const client = source("client");
    const host = source("host");
    expect(protocol).toContain("maxInputBytes");
    expect(protocol).toContain("maxOutputBytes");
    expect(protocol).toContain("maxWorkUnits");
    expect(protocol).toContain("mainThreadComputationFallback: false");
    expect(client).toContain("operationReserved");
    expect(client).toContain('"operation-timeout"');
    expect(client).toContain('"messageerror"');
    expect(host).toContain('"backpressure"');
    expect(host).toContain('"stale-epoch"');
    expect(host).toContain("AbortController");
  });
});
