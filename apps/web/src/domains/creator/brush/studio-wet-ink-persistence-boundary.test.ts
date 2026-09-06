import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./studio-wet-ink-persistence.ts", import.meta.url)),
  "utf8",
);

describe("Studio wet-ink persistence boundary", () => {
  it("remains renderer, DOM, network and vendor independent", () => {
    expect(source).not.toMatch(
      /\b(?:React|Konva|HTMLCanvasElement|CanvasRenderingContext2D|getContext)\b/u,
    );
    expect(source).not.toMatch(/\b(?:document|window)\s*\./u);
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest)\b/u);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:opencv|pixi|three|onnx)[^"']*["']/iu);
  });

  it("preserves explicit integrity, version and byte-budget gates", () => {
    expect(source).toContain("STUDIO_WET_INK_SNAPSHOT_VERSION");
    expect(source).toContain("maxSnapshotBytes");
    expect(source).toContain("sha256HexPortable");
    expect(source).toContain("studioWetInkFieldDigest");
    expect(source).toContain('"integrity-mismatch"');
    expect(source).toContain('"unsupported-version"');
  });
});
