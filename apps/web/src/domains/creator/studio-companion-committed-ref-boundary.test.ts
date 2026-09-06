import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(resolve(process.cwd(), "apps/web/src/domains/creator", fileName), "utf8");
}

describe("Studio companion committed external refs", () => {
  it("publishes presentation-safe state to the channel guard only after commit", () => {
    const page = source("StudioToolsCompanionPage.tsx");
    const derivation = page.indexOf("const presentationSafe =");
    const post = page.indexOf("function post(", derivation);
    const boundary = page.slice(derivation, post);

    expect(derivation).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(derivation);
    expect(boundary).toContain("useLayoutEffect(() => {");
    expect(boundary).toContain("presentationSafeRef.current = presentationSafe;");
    expect(boundary).not.toMatch(
      /const presentationSafe =[\s\S]*?\n\s*presentationSafeRef\.current = presentationSafe;\n\s*\n\s*function post/u
    );
  });

  it("mirrors reference viewport and preview state from commit-phase effects", () => {
    const display = source("StudioCompanionReferenceDisplay.tsx");
    const stateStart = display.indexOf("const [zoom, setZoom]");
    const handlerStart = display.indexOf("const handleNativeWheel", stateStart);
    const boundary = display.slice(stateStart, handlerStart);

    expect(stateStart).toBeGreaterThan(-1);
    expect(handlerStart).toBeGreaterThan(stateStart);
    expect(boundary.match(/useLayoutEffect\(\(\) => \{/gu)).toHaveLength(2);
    expect(boundary).toContain("zoomRef.current = zoom;");
    expect(boundary).toContain("panRef.current = pan;");
    expect(boundary).toContain("connectedPreviewRef.current = connectedPreview;");
    expect(boundary).not.toContain(
      "connectedPreviewRef.current = connectionStatus === \"connected\" ? visiblePreview : null;"
    );
  });
});
