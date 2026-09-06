import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (fileName: string) =>
  readFileSync(new URL(fileName, import.meta.url), "utf8");

describe("Studio asset placement UI boundary", () => {
  it("routes native balloons out of the generic element browser", () => {
    const assetMenu = read("./StudioAssetToolPopoverBody.tsx");
    const elementPanel = read("./StudioElementsPanel.tsx");

    expect(assetMenu).toContain('onOpenBubbles={() => setMenu("bubble")}');
    expect(elementPanel).toContain("편집 가능한 말풍선");
    expect(elementPanel).toContain("listStudioElementLibrary");
    expect(elementPanel).not.toContain("고급 도형·컷 패널·말풍선");
  });

  it("routes 3D object picks into production BG3D / VRM tools", () => {
    const assetMenu = read("./StudioAssetToolPopoverBody.tsx");
    const elementPanel = read("./StudioElementsPanel.tsx");

    expect(elementPanel).toContain("onOpenObjectInsert");
    expect(elementPanel).toContain("filterStudioObjectInsertItems");
    expect(elementPanel).toContain("planStudioObjectInsertPlacement");
    expect(elementPanel).toContain("writeStudioObjectInsertDragPayload");
    expect(elementPanel).toContain("3D 오브젝트");
    expect(assetMenu).toContain("onOpenObjectInsert=");
    expect(assetMenu).toContain("openStudioObjectInsert({");
    expect(assetMenu).toContain("plan.sourceId");
  });

  it("uses one drag writer for image-backed elements and native insertions", () => {
    const elementPanel = read("./StudioElementsPanel.tsx");
    const bubbleMenu = read("./lettering/StudioBubbleToolPopoverBody.tsx");
    const assetMenu = read("./StudioAssetMenuPanel.tsx");

    expect(elementPanel).toContain("writeStudioAssetDragPayload(");
    expect(bubbleMenu).toContain("writeStudioInsertDragPayload(event.dataTransfer");
    expect(assetMenu).toContain("writeStudioAssetDragPayload(");
    expect(elementPanel).toContain("정확한 위치 · Esc 취소");
    expect(bubbleMenu).toContain("드래그는");
  });

  it("keeps whole-canvas templates explicit and touch-safe instead of faking a drop anchor", () => {
    const assetPopover = read("./StudioAssetToolPopoverBody.tsx");

    expect(assetPopover).toContain("캔버스 전체를 바꾸는 템플릿");
    expect(assetPopover).toContain("클릭·탭으로 적용");
    expect(assetPopover.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("routes click, touch, and native drop placement through the same safe target contract", () => {
    const studioPage = read("./StudioCuttoonEditorHost.tsx");

    expect(studioPage).toContain("resolveStudioInsertTarget");
    expect(studioPage).toContain("consumeStudioInsertDropTransfer");
    expect(studioPage).toContain("consumedInsertDropTransfersRef");
    expect(studioPage).toContain('target.source === "selected-frame"');
    expect(studioPage.match(/resolveStudioInsertTarget\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
