import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("AI super-suite production integration boundary", () => {
  it("keeps a non-lossy menu fallback when an optional host callback is absent", () => {
    const menu = source(
      "apps/web/src/domains/creator/studio-main-menu-items-production.ts"
    );

    expect(menu).toContain("requestStudioAiSuperSuiteOpen");
    expect(menu).toContain('ui.openStudioMenu("aiAssist")');
  });

  it("consumes late open requests and returns a lossless recipe to the image tool", () => {
    const popover = source(
      "apps/web/src/domains/creator/ai/StudioAiToolPopoverBody.tsx"
    );
    const modal = source(
      "apps/web/src/domains/creator/ai/StudioAiSuperSuiteModal.tsx"
    );

    const gateway = source("apps/web/src/domains/creator/ai/StudioAiSuperSuiteGateway.tsx");
    // The gateway mounts the modal through its loader module, which is the one lazy boundary
    // launchers also warm (`preload`) — so the import literal is asserted there.
    const loader = source("apps/web/src/domains/creator/ai/studio-ai-super-suite-loader.ts");
    expect(popover).toContain("requestStudioAiSuperSuiteOpen");
    expect(popover).toContain("<StudioAiSuperSuiteGateway onApplyPrompt={applySuperSuitePrompt}");
    expect(popover).not.toContain("useState(");
    expect(popover).not.toContain("import(");
    expect(gateway).toContain("subscribeStudioAiSuperSuiteOpenRequest");
    expect(gateway).toContain("compileStudioAiSuitePromptHandoff");
    expect(loader).toContain('import("./StudioAiSuperSuiteModal")');
    expect(gateway).toContain("studioAiSuperSuiteModalLoader.load");
    expect(popover).toContain('setMenu("aiAssist")');
    expect(modal).toContain("onApplyPromptRecipe");
  });
});
