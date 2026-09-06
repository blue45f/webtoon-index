import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

import { StudioBg3dSpatialWebtoonPanel } from "./StudioBg3dSpatialWebtoonPanel";

describe("StudioBg3dSpatialWebtoonPanel", () => {
  it("renders all 4 spatial tabs: AR diorama, VR gallery, spatial audio, and hand tracking", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dSpatialWebtoonPanel onModeChange={vi.fn()} />,
    );

    expect(markup).toContain("AR 디오라마");
    expect(markup).toContain("VR 갤러리");
    expect(markup).toContain("공간 음향");
    expect(markup).toContain("핸드 트래킹");

    // Default AR tab contents
    expect(markup).toContain("AR 배치 대상 평면");
    expect(markup).toContain("책상 위 디오라마");
    expect(markup).toContain("바닥 1:1 실물");
    expect(markup).toContain("AR 축척 스케일");
    expect(markup).toContain("바닥 실시간 그림자 캐처 (Shadow Plane)");
  });

  it("renders disabled state when disabled prop is provided", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dSpatialWebtoonPanel disabled />,
    );

    expect(markup).toContain("disabled");
  });
});
