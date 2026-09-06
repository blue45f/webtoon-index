import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarketWebtoon3dViewerModal } from "./MarketWebtoon3dViewerModal";

describe("MarketWebtoon3dViewerModal", () => {
  it("renders null when open is false", () => {
    const markup = renderToStaticMarkup(
      <MarketWebtoon3dViewerModal open={false} onClose={() => {}} assetTitle="테스트 에셋" />,
    );
    expect(markup).toBe("");
  });

  it("renders 3D interactive viewer controls when open is true", () => {
    const markup = renderToStaticMarkup(
      <MarketWebtoon3dViewerModal
        open={true}
        onClose={() => {}}
        assetTitle="황실 대연회장 3D"
        format="glb"
        triangleCount={65000}
        vertexCount={42000}
        onImportToStudio={() => {}}
      />,
    );

    expect(markup).toContain("황실 대연회장 3D · 3D 렌더 모드 예시");
    expect(markup).toContain("컬러 텍스처");
    expect(markup).toContain("웹툰 은선");
    expect(markup).toContain("셀 셰이딩");
    expect(markup).toContain("흑백 명암");
    expect(markup).toContain("주간");
    expect(markup).toContain("노을");
    expect(markup).toContain("야경");
    expect(markup).toContain("Studio에서 확인하기");
  });
});
