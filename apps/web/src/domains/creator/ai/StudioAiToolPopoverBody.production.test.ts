import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const popover = read("./StudioAiToolPopoverBody.tsx");
const episodeGateway = read("./StudioAiEpisodeProductionGateway.tsx");
const episodeLoader = read("./studio-ai-episode-production-loader.ts");
const suiteGateway = read("./StudioAiSuperSuiteGateway.tsx");
const suiteLoader = read("./studio-ai-super-suite-loader.ts");

describe("StudioAiToolPopoverBody webtoon AI production wiring", () => {
  it("keeps both advanced modals off the initial studio chunk, behind intent-owned gateways", () => {
    // The popover owns neither a dialog lifetime nor a lazy boundary; the gateways do.
    expect(popover).not.toContain("import(");
    expect(popover).not.toContain("useState(");
    expect(episodeLoader).toContain('import("./StudioAiEpisodeProductionModal")');
    expect(episodeLoader).toContain("createStudioIntentLazyLoader");
    expect(episodeGateway).toContain("lazyRetry(");
    expect(episodeGateway).toContain("studioAiEpisodeProductionModalLoader.load");
    expect(suiteLoader).toContain('import("./StudioAiSuperSuiteModal")');
    expect(suiteLoader).toContain("createStudioIntentLazyLoader");
    expect(suiteGateway).toContain("studioAiSuperSuiteModalLoader.load");
  });

  it("launches episode production and the super suite through intent, with chunk warm-up", () => {
    expect(popover).toContain(
      "onOpenEpisodeProduction={() => requestStudioAiEpisodeProductionOpen()}"
    );
    expect(popover).toContain(
      "onPreloadEpisodeProduction={preloadStudioAiEpisodeProductionModal}"
    );
    expect(popover).toContain("requestStudioAiSuperSuiteOpen()");
    expect(popover).toContain("onPreloadSuperSuite={preloadStudioAiSuperSuiteModal}");
    expect(popover).toContain(
      "<StudioAiEpisodeProductionGateway onApplyPrompt={applyEpisodeBatchPrompt} />"
    );
    expect(popover).toContain(
      "<StudioAiSuperSuiteGateway onApplyPrompt={applySuperSuitePrompt} />"
    );
  });

  it("hands approved prompts back to the existing non-destructive AI tool flow", () => {
    expect(popover).toContain('setAiAssistTool("composition")');
    expect(popover).toContain("setAiCompositionDraft(trimmed)");
    expect(popover).toContain("pushStudioAiRecentPrompt");
    expect(popover).toContain('setMenu("aiAssist")');
  });
});
