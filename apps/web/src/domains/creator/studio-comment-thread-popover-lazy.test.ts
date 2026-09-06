import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const registrySource = readFileSync(
  new URL("./studio-page-lazy-ui.ts", import.meta.url),
  "utf8"
);

describe("Studio comment thread popover lazy boundary", () => {
  it("shares one retryable intent loader between preload and activation", () => {
    expect(
      registrySource.match(/import\("\.\/StudioCommentThreadPopover"\)/gu)
    ).toHaveLength(1);
    expect(registrySource).toContain(
      "const studioCommentThreadPopoverLoader = createStudioIntentLazyLoader("
    );
    expect(registrySource).toContain(
      "studioCommentThreadPopoverLoader.load,\n  \"StudioCommentThreadPopover\""
    );
    expect(registrySource).toContain("studioCommentThreadPopoverLoader.preload();");
    expect(registrySource).toMatch(
      /export \{[\s\S]*StudioCommentThreadPopover,[\s\S]*preloadStudioCommentThreadPopover,[\s\S]*\};/u
    );
  });
});
