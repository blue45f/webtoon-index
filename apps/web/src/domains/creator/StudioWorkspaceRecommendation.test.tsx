import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { resolveStudioWorkspaceRecommendation } from "./studio-workspace-recommendation";
import { STUDIO_DEFAULT_WORKSPACES } from "./studio-workspaces";
import { StudioWorkspaceRecommendation } from "./StudioWorkspaceRecommendation";

describe("StudioWorkspaceRecommendation", () => {
  it("renders a compact, accessible one-click transition card", () => {
    const recommendation = resolveStudioWorkspaceRecommendation(
      STUDIO_DEFAULT_WORKSPACES,
      "storyboard"
    );
    if (!recommendation) throw new Error("workspace recommendation missing");

    const html = renderToStaticMarkup(
      <StudioWorkspaceRecommendation recommendation={recommendation} onSelect={vi.fn()} />
    );

    expect(html).toContain('data-testid="studio-workspace-recommendation"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain("클립 스튜디오형");
    expect(html).toContain("클립 스튜디오에서 익숙했던 레이어 중심 동선");
    expect(html).toContain("왼쪽 페이지 · 오른쪽 레이어·속성 · 캔버스 우선 배치");
    expect(html).toContain('aria-label="클립 스튜디오형 작업공간으로 전환"');
    expect(html).toContain('data-workspace-id="csp-migration"');
    expect(html).toContain("min-h-11");
  });
});
