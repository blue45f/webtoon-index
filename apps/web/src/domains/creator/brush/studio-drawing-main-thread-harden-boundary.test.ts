/**
 * Guards the drawing-critical product path against regressions that reintroduce
 * synchronous full-frame PNG encode freezes on StudioPage.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx"),
  "utf8",
);

function sliceBetween(startToken: string, endToken: string): string {
  const start = pageSource.indexOf(startToken);
  const end = pageSource.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing boundary slice: ${startToken} -> ${endToken}`);
  }
  return pageSource.slice(start, end);
}

describe("studio drawing main-thread harden boundary", () => {
  it("selection adjust/transform/fill use async encode pipeline helpers", () => {
    const adjust = sliceBetween(
      "async function applyPixelSelectionAdjust(",
      "async function extractPixelSelectionToLayer(",
    );
    expect(adjust).toContain("runStudioPixelEditBakePipeline");
    expect(adjust).toContain("encodeStudioPixelEditResultPng");
    expect(adjust).not.toContain('.toDataURL("image/png")');

    const transform = sliceBetween(
      "async function applyPixelSelectionContentTransform(",
      "async function applyContentAwareFill(",
    );
    expect(transform).toContain("runStudioPixelEditBakePipeline");
    expect(transform).toContain("encodeStudioPixelEditResultPng");
    expect(transform).not.toContain('.toDataURL("image/png")');

    const fill = sliceBetween(
      "async function applyContentAwareFill(",
      "async function applyLiquifyStroke(",
    );
    expect(fill).toContain("bakeContentAwareFillToCanvasAsync");
    expect(fill).toContain("encodeStudioPixelEditResultPng");
    expect(fill).not.toContain('.toDataURL("image/png")');
  });

  it("layer/filter mask bake paths use async PNG encode", () => {
    const layerMask = sliceBetween(
      "async function bakeLayerMaskPaintStroke(",
      "function addLayerMask(",
    );
    expect(layerMask).toContain("encodeStudioPixelEditResultPng");
    expect(layerMask).not.toContain('.toDataURL("image/png")');

    const filterMask = sliceBetween(
      "async function bakeFilterMaskPaintStroke(",
      "function addFilterMask(",
    );
    expect(filterMask).toContain("encodeStudioPixelEditResultPng");
    expect(filterMask).not.toContain('.toDataURL("image/png")');
  });

  it("extended blend merge uses async PNG encode", () => {
    // 확장 블렌드 병합은 layer/studio-layer-operations 로 추출됐다 — 추출 파일에서 본문을 스캔한다.
    const layerOperationsSource = readFileSync(
      resolve(process.cwd(), "apps/web/src/domains/creator/layer/studio-layer-operations.ts"),
      "utf8",
    );
    expect(pageSource).toContain("applyExtendedBlendMergeDown");
    const start = layerOperationsSource.indexOf("async function applyExtendedBlendMergeDown()");
    const end = layerOperationsSource.indexOf("function handleLayerNavigatorAction(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = layerOperationsSource.slice(start, end);
    expect(body).toContain("encodeStudioPixelEditResultPng");
    expect(body).not.toContain('.toDataURL("image/png")');
  });
});
