import { describe, expect, it } from "vitest";

import {
  buildLezhinCoverImage,
  extractRemoteImageUrl,
  proxiedCoverUrl,
} from "../../../../../../scripts/crawl-helpers.mjs";

describe("crawler cover helpers", () => {
  it("레진 상세 HTML의 og:image를 프록시 표지 URL로 정규화한다", () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://ccdn.lezhin.com/v2/comics/5082862571421696/images/wide.jpg?updated=1770011250131" />
        </head>
      </html>
    `;

    expect(extractRemoteImageUrl(html)).toBe(
      "https://ccdn.lezhin.com/v2/comics/5082862571421696/images/wide.jpg?updated=1770011250131"
    );
    expect(proxiedCoverUrl(extractRemoteImageUrl(html))).toBe(
      "/api/cover?u=https%3A%2F%2Fccdn.lezhin.com%2Fv2%2Fcomics%2F5082862571421696%2Fimages%2Fwide.jpg%3Fupdated%3D1770011250131"
    );
  });

  it("레진 랭킹 항목만 있어도 알려진 CDN 썸네일 후보를 만든다", () => {
    expect(
      buildLezhinCoverImage({
        id: 5082862571421696,
        updatedAt: 1770011250131,
      })
    ).toBe(
      "https://ccdn.lezhin.com/v2/comics/5082862571421696/images/thumbnail.jpg?updated=1770011250131"
    );
  });

  it("중첩 객체의 cover, thumbnail, poster 계열 이미지 후보를 우선순위대로 찾는다", () => {
    const url = extractRemoteImageUrl({
      display: {
        bannerImage: "https://example.com/not-allowed.png",
        thumbnailImage: "https://ccdn.lezhin.com/v2/comics/1/images/thumbnail.jpg",
      },
      images: {
        poster: "https://kr-a.kakaopagecdn.com/P/C/1/bg/2x/test.webp",
      },
    });

    expect(url).toBe("https://ccdn.lezhin.com/v2/comics/1/images/thumbnail.jpg");
  });
});
