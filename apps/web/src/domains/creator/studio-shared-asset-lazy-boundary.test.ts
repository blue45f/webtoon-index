import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const source = readStudioPageCompositionSource();

describe("shared asset lazy-content integration boundary", () => {
  it("click insert가 await 이전 page/master scope를 캡처하고 같은 scope일 때만 커밋한다", () => {
    const start = source.indexOf("async function onUseSharedAsset(");
    const end = source.indexOf("async function onDeleteSharedAsset(", start);
    const handler = source.slice(start, end);
    const targetPageIndex = handler.indexOf("const targetPageId = activePage.id;");
    const targetMasterIndex = handler.indexOf("const targetMasterEditMode = masterEditMode;");
    const awaitIndex = handler.indexOf("await loadCommunityAssetContent(asset)");

    expect(targetPageIndex).toBeGreaterThan(0);
    expect(targetMasterIndex).toBeGreaterThan(targetPageIndex);
    expect(awaitIndex).toBeGreaterThan(targetMasterIndex);
    expect(handler).toContain("isStudioPasteScopeCurrent({");
    expect(handler).toContain("currentPageId: currentPageIdRef.current");
    expect(handler).toContain("currentMasterEditMode: masterEditModeRef.current");
    expect(handler.indexOf("recordCommunityAssetUse(asset.id)")).toBeGreaterThan(
      handler.indexOf("addRenderedImage(content.dataUrl")
    );
  });

  it("asset drop은 lazy parser 전에 좌표·scope를 고정하고 await 직후 stale mutation을 거부한다", () => {
    const start = source.indexOf("// 2) 내부 에셋 패널에서 드래그한 경우.");
    const end = source.indexOf("// 우클릭 컨텍스트 메뉴", start);
    const handler = source.slice(start, end);
    const pointIndex = handler.indexOf("const assetDropPoint = dropStagePoint();");
    const parserAwaitIndex = handler.indexOf(
      'await import("./studio-shared-asset-drag")'
    );
    const scopeGuardIndex = handler.indexOf("isStudioPasteScopeCurrent({", parserAwaitIndex);
    const contentAwaitIndex = handler.indexOf("await loadCommunityAssetContent(asset)");

    expect(source).not.toContain(
      'import { parseStudioAssetDragPayload } from "./studio-shared-asset-drag"'
    );
    expect(pointIndex).toBeGreaterThan(0);
    expect(parserAwaitIndex).toBeGreaterThan(pointIndex);
    expect(scopeGuardIndex).toBeGreaterThan(parserAwaitIndex);
    expect(contentAwaitIndex).toBeGreaterThan(scopeGuardIndex);
    expect(handler).toContain("mutationAllowed: canApplyStudioMutation(mutationTicket)");
    expect(handler).toContain("currentPageId: currentPageIdRef.current");
    expect(handler).toContain("currentMasterEditMode: masterEditModeRef.current");
    expect(handler).toContain("}, assetDropPoint);");
    expect(handler).toContain("if (inserted) recordCommunityAssetUse(asset.id)");
  });
});
