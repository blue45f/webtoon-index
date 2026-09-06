import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

import { StudioBg3dShaperTooningStudioPanel } from "./StudioBg3dShaperTooningStudioPanel";

describe("StudioBg3dShaperTooningStudioPanel", () => {
  it("renders all 3 studio modes: Shaper Character, Tooning Emotion, Storyboard PSD", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dShaperTooningStudioPanel onExportPsd={vi.fn()} />,
    );

    expect(markup).toContain("셰이퍼 캐릭터");
    expect(markup).toContain("투닝 표정 &amp; SFX");
    expect(markup).toContain("세로 연출 &amp; PSD");

    // Default Shaper tab
    expect(markup).toContain("웹툰 체형 프로포션 (아키타입)");
    expect(markup).toContain("8등신 소년만화 히어로");
    expect(markup).toContain("4등신 SD 치비 캐릭터");
    expect(markup).toContain("3D 표면 직접 잉킹 (3D Inking)");
  });

  it("renders properly with disabled flag", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dShaperTooningStudioPanel disabled />,
    );

    expect(markup).toContain("disabled");
  });
});
