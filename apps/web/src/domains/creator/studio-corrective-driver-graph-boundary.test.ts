import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("./studio-corrective-driver-graph.ts", import.meta.url),
  ),
  "utf8",
);

describe("Studio corrective driver graph source boundary", () => {
  it("remains renderer, UI, character-format and network independent", () => {
    expect(source).not.toMatch(
      /\b(?:new|extends|implements)\s+(?:Konva|THREE|VRM|HTMLCanvasElement|CanvasRenderingContext2D)\b/u,
    );
    expect(source).not.toMatch(/\b(?:document|window|navigator)\s*\./u);
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest)\b/u);
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:react|konva|three|pixi|vrm)[^"']*["']/iu,
    );
  });

  it("keeps version, budget, integrity and deterministic bake boundaries explicit", () => {
    expect(source).toContain("STUDIO_CORRECTIVE_DRIVER_GRAPH_VERSION");
    expect(source).toContain("STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS");
    expect(source).toContain("graphSha256");
    expect(source).toContain("valuesSha256");
    expect(source).toContain("float32Bytes");
    expect(source).toContain('"unsupported-version"');
    expect(source).toContain('"budget-exceeded"');
  });
});
