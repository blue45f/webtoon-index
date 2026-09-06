import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), "apps/web/src/domains/creator", path), "utf8");
describe("Studio finish quality integration", () => {
  it("joins the existing lazy quality center rather than replacing it", () => {
    const panel = source("StudioContinuityPanel.tsx");
    const stack = source("StudioLazyPanelStack.tsx");
    expect(panel).toContain('from "./StudioFinishQualityView"');
    expect(panel).toContain("inspectStudioQualityFinishSupplement");
    expect(panel).toContain("...(finishSupplement?.issues ?? [])");
    expect(panel).toContain("inspectStudioQuality({");
    expect(stack).toContain("finishDocumentTitle={title}");
    expect(stack).toContain("finishComments={studioComments}");
    expect(stack).toContain("onSelectTarget");
    expect(stack).toContain("if (target.pageId && !setCurrentPageId(target.pageId)) return;");
  });
  it("retains stable identity and the broader accessible label", () => {
    const actions = source("StudioProjectReviewActions.tsx");
    expect(actions).toContain('id: "continuity"');
    expect(actions).toContain('label: "마감·품질 검사"');
    expect(actions).toContain('onSelect: handlers.openContinuityCheck');
  });
  it("includes supplemental evidence in review-receipt invalidation", () => {
    expect(source("studio-quality-inspection.ts")).toContain("supplementalIssues: input.supplementalIssues ?? []");
  });
});
