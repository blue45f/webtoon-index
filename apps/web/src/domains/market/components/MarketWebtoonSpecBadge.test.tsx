import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarketWebtoonSpecBadge } from "./MarketWebtoonSpecBadge";

describe("MarketWebtoonSpecBadge", () => {
  it("renders only explicitly supplied technical and rights evidence", () => {
    const markup = renderToStaticMarkup(
      <MarketWebtoonSpecBadge
        format="glb"
        polycountGrade="optimal-webtoon"
        hasLineExtraction={true}
        isNoAiProtected={true}
        licenseTier="solo-creator"
      />,
    );

    expect(markup).toContain("GLB");
    expect(markup).toContain("웹툰 최적화");
    expect(markup).toContain("은선 렌더링 지원");
    expect(markup).toContain("NoAI 조건 공개");
    expect(markup).toContain("1인 작가 상업");
  });

  it("does not invent optional badges from defaults", () => {
    const formatOnly = renderToStaticMarkup(
      <MarketWebtoonSpecBadge format="portable-json" />,
    );
    expect(formatOnly).toContain("PORTABLE-JSON");
    expect(formatOnly).not.toContain("웹툰 최적화");
    expect(formatOnly).not.toContain("은선 렌더링 지원");
    expect(formatOnly).not.toContain("NoAI");
    expect(formatOnly).not.toContain("1인 작가 상업");
    expect(renderToStaticMarkup(<MarketWebtoonSpecBadge />)).toBe("");
  });

  it("renders heavy warning badge when measured metadata supplies the grade", () => {
    const markup = renderToStaticMarkup(
      <MarketWebtoonSpecBadge polycountGrade="heavy-warning" />,
    );
    expect(markup).toContain("고밀도 (LOD 권장)");
  });
});
