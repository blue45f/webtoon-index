import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  encodeStudioOriginalAssetSvg,
  STUDIO_ORIGINAL_FREE_ASSETS,
  STUDIO_RETIRED_ORIGINAL_FREE_ASSETS,
} from "./studio-original-free-asset-packs";
import {
  STUDIO_ASSET_DRAG_MAX_IMAGE_AXIS,
  STUDIO_ASSET_DRAG_MAX_IMAGE_PIXELS,
  STUDIO_ASSET_DRAG_MAX_PAYLOAD_LENGTH,
  STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES,
  parseStudioAssetDragPayload,
  serializeStudioCommunityAssetDragPayload,
  serializeStudioLocalAssetDragPayload,
} from "./studio-shared-asset-drag";
import { STUDIO_ASSET_DATA_URL_MAX_CHARS } from "./studio-upload-image-safety";

const sharedAssetDragSource = readFileSync(
  new URL("./studio-shared-asset-drag.ts", import.meta.url),
  "utf8",
);

function svgDragPayload(svgDataUrl: string): string {
  return serializeStudioLocalAssetDragPayload({
    src: svgDataUrl,
    width: 360,
    height: 240,
  });
}

function base64Svg(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function percentSvg(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

describe("shared asset drag payload", () => {
  it("keeps the eager drag parser independent from the IndexedDB asset library", () => {
    expect(sharedAssetDragSource).not.toContain('from "./studio-asset-library"');
    expect(STUDIO_ASSET_DRAG_MAX_PAYLOAD_LENGTH).toBe(
      STUDIO_ASSET_DATA_URL_MAX_CHARS + 1_024,
    );
  });

  it("community payload에는 원본·preview를 넣지 않고 assetId만 직렬화한다", () => {
    const payload = serializeStudioCommunityAssetDragPayload("asset-1");
    expect(JSON.parse(payload)).toEqual({ source: "community", assetId: "asset-1" });
    expect(payload).not.toContain("data:image");
    expect(parseStudioAssetDragPayload(payload)).toEqual({ source: "community", assetId: "asset-1" });
  });

  it("local payload와 source 이전의 정상 data URL 레거시 payload를 계속 복원한다", () => {
    const payload = serializeStudioLocalAssetDragPayload({
      src: "data:image/png;base64,AA==",
      width: 80,
      height: 40,
    });
    expect(parseStudioAssetDragPayload(payload)).toEqual({
      source: "local",
      src: "data:image/png;base64,AA==",
      width: 80,
      height: 40,
    });
    const legacySrc = "data:image/webp;base64,YQ";
    expect(parseStudioAssetDragPayload(JSON.stringify({
      src: legacySrc,
      width: 1,
      height: 1,
    }))).toEqual({ source: "local", src: legacySrc, width: 1, height: 1 });
  });

  it("base64와 percent-encoded SVG를 모두 허용해 절차형 원본 drag를 보존한다", () => {
    const safeSvg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs>'
      + '<rect fill="url(#g)"/><use href="#g"/></svg>';
    expect(parseStudioAssetDragPayload(svgDragPayload(base64Svg(safeSvg)))).not.toBeNull();
    expect(parseStudioAssetDragPayload(svgDragPayload(percentSvg(safeSvg)))).not.toBeNull();
    const allLegacyAndSelectableAssets = [...STUDIO_ORIGINAL_FREE_ASSETS, ...STUDIO_RETIRED_ORIGINAL_FREE_ASSETS];
    expect(allLegacyAndSelectableAssets).toHaveLength(32);
    for (const asset of allLegacyAndSelectableAssets) {
      expect(parseStudioAssetDragPayload(svgDragPayload(
        encodeStudioOriginalAssetSvg(asset.svg)
      ))).not.toBeNull();
    }
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>active</div></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://tracker.test/x"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="//tracker.test/x"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://tracker/x";</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@im/**/port "https://tracker.test/x";</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://tracker.test/x)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" to="https://tracker.test/x"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "https://tracker.test/x">]><svg/>',
  ])("active/external SVG %s를 base64와 percent 양쪽에서 거부한다", (svg) => {
    expect(parseStudioAssetDragPayload(svgDragPayload(base64Svg(svg)))).toBeNull();
    expect(parseStudioAssetDragPayload(svgDragPayload(percentSvg(svg)))).toBeNull();
  });

  it("SVG 디코드 예산을 초과하는 base64와 percent payload를 거부한다", () => {
    const oversizedSvg = `<svg>${"x".repeat(
      STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES
    )}</svg>`;
    expect(parseStudioAssetDragPayload(svgDragPayload(base64Svg(oversizedSvg)))).toBeNull();
    expect(parseStudioAssetDragPayload(svgDragPayload(percentSvg(oversizedSvg)))).toBeNull();
  });

  it("깨진 id·알 수 없는 source·추가 필드·임의 레거시 src를 fail-closed로 거부한다", () => {
    expect(parseStudioAssetDragPayload("not-json")).toBeNull();
    expect(parseStudioAssetDragPayload('{"source":"community","assetId":""}')).toBeNull();
    expect(parseStudioAssetDragPayload(
      '{"source":"community","assetId":"asset-1","src":"data:image/png;base64,AA"}'
    )).toBeNull();
    expect(parseStudioAssetDragPayload('{"source":"remote","src":"x","width":1,"height":1}')).toBeNull();
    expect(parseStudioAssetDragPayload('{"source":"local","src":"x","width":0,"height":1}')).toBeNull();
    expect(parseStudioAssetDragPayload(JSON.stringify({
      src: "legacy",
      width: 1,
      height: 1,
    }))).toBeNull();
    expect(parseStudioAssetDragPayload(JSON.stringify({
      source: "local",
      src: "data:image/png;base64,AA",
      width: 1,
      height: 1,
      extra: true,
    }))).toBeNull();
  });

  it.each([
    "https://example.test/tracker.png",
    "http://example.test/image.png",
    "blob:https://example.test/id",
    "javascript:alert(1)",
    "data:text/html,%3Cscript%3E1%3C/script%3E",
    "data:image/svg+xml;charset=utf-8,%GG",
    "data:image/png;base64,A",
  ])("remote/blob/active 또는 손상 src %s를 거부한다", (src) => {
    expect(parseStudioAssetDragPayload(JSON.stringify({
      source: "local",
      src,
      width: 10,
      height: 10,
    }))).toBeNull();
  });

  it("직렬화 길이·축·픽셀 예산을 넘는 payload를 JSON parse 전에 거부한다", () => {
    expect(parseStudioAssetDragPayload("x".repeat(
      STUDIO_ASSET_DRAG_MAX_PAYLOAD_LENGTH + 1
    ))).toBeNull();
    expect(parseStudioAssetDragPayload(serializeStudioLocalAssetDragPayload({
      src: "data:image/png;base64,AA",
      width: STUDIO_ASSET_DRAG_MAX_IMAGE_AXIS + 1,
      height: 1,
    }))).toBeNull();
    expect(parseStudioAssetDragPayload(serializeStudioLocalAssetDragPayload({
      src: "data:image/png;base64,AA",
      width: Math.ceil(Math.sqrt(STUDIO_ASSET_DRAG_MAX_IMAGE_PIXELS)) + 1,
      height: Math.ceil(Math.sqrt(STUDIO_ASSET_DRAG_MAX_IMAGE_PIXELS)),
    }))).toBeNull();
  });
});
