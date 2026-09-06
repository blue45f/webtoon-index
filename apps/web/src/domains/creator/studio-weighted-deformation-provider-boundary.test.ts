import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("./studio-weighted-deformation-provider.ts", import.meta.url),
  ),
  "utf8",
);

describe("Studio weighted deformation provider source boundary", () => {
  it("remains a renderer, DOM, network and character-format neutral CPU oracle", () => {
    expect(source).not.toMatch(/\b(?:document|window|navigator)\s*\./u);
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest)\b/u);
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:react|konva|three|pixi|vrm|gltf)[^"']*["']/iu,
    );
  });

  it("keeps deterministic quality and failure boundaries explicit", () => {
    expect(source).toContain("STUDIO_WEIGHTED_DEFORMATION_PROVIDER_VERSION");
    expect(source).toContain("STUDIO_WEIGHTED_DEFORMATION_BUDGETS");
    expect(source).toContain('"stale-epoch"');
    expect(source).toContain('"budget-exceeded"');
    expect(source).toContain("positionsSha256");
    expect(source).toContain('"copied-unchanged"');
  });
});
