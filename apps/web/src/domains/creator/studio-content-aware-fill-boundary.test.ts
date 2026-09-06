import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioPageCompositionSource();
const layerLiftCompositorSource = readFileSync(
  new URL("./layer/studio-layer-lift-compositor.ts", import.meta.url),
  "utf8",
);

function sourceBetween(
  source: string,
  startToken: string,
  endToken: string,
): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing source boundary: ${startToken} -> ${endToken}`);
  }
  return source.slice(start, end);
}

describe("Studio content-aware fill bundle boundary", () => {
  it("keeps the pixel kernel behind explicit Layer Lift composition", () => {
    expect(layerLiftCompositorSource).not.toMatch(
      /import\s+\{[^}]*contentAwareFillPixels[^}]*\}\s+from\s+["']\.\/studio-content-aware-fill["']/u,
    );
    expect(layerLiftCompositorSource).toContain(
      'await import("../studio-content-aware-fill")',
    );
  });

  it("loads the optional fill engine in parallel with image decoding after the user invokes it", () => {
    const applySource = sourceBetween(
      pageSource,
      "async function applyContentAwareFill()",
      "// 문지르기 브러시",
    );

    expect(pageSource).not.toMatch(
      /import\s+\{\s*bakeContentAwareFillToCanvas\s*\}\s+from\s+"\.\/studio-content-aware-fill"/u,
    );
    expect(
      pageSource.match(/import\("\.\/studio-content-aware-fill"\)/gu),
    ).toHaveLength(1);
    expect(applySource).toMatch(
      /const \[\{ bakeContentAwareFillToCanvasAsync \}, img\] = await Promise\.all\(\[\s*import\("\.\/studio-content-aware-fill"\),\s*loadStudioPixelEditImage\(target\.src\),\s*\]\)/u,
    );
    expect(applySource).toContain("bakeContentAwareFillToCanvasAsync");
    expect(applySource).toContain("yieldControl: yieldStudioPixelEditMainThread");
    expect(applySource).toContain("encodeStudioPixelEditResultPng");
    expect(applySource.indexOf("Promise.all")).toBeLessThan(
      applySource.indexOf("const w ="),
    );
  });
});
