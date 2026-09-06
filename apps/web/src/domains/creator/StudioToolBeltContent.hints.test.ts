import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { STUDIO_VIEW_ACTION_HINTS } from "./studio-view-action-hints";

const sourceFiles = [
  "./StudioToolBeltContent.tsx",
  "./StudioToolBeltCanvasControls.tsx",
  "./StudioToolBeltQuickActions.tsx",
  "./StudioToolBeltCreateModeGroups.tsx",
  "./StudioToolBeltCreateModeUtilityButtons.tsx",
  "./StudioToolBeltCreateModeInsertTools.tsx",
].map((path) => {
  const url = new URL(path, import.meta.url);
  const text = readFileSync(url, "utf8");
  return ts.createSourceFile(url.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
});
const allSource = sourceFiles.map((file) => file.getFullText()).join("\n");

function jsxTagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

function nativeControls(
  tagName: "button" | "label",
  targetFiles: ts.SourceFile[],
): ts.JsxOpeningLikeElement[] {
  const controls: ts.JsxOpeningLikeElement[] = [];
  for (const sourceFile of targetFiles) {
    function visit(node: ts.Node): void {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        && jsxTagName(node) === tagName
      ) {
        controls.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return controls;
}

function jsxAttribute(
  node: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name
  );
}

function nearestHintTarget(node: ts.Node): ts.JsxOpeningLikeElement | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      const opening = ts.isJsxElement(current) ? current.openingElement : current;
      const openingName = jsxTagName(opening);
      if (openingName === "StudioToolBeltHintTarget" || openingName === "StudioToolHintTarget") {
        return opening;
      }
    }
    current = current.parent;
  }
  return null;
}

describe("Studio ToolBelt rich hint coverage", () => {
  it("routes every native ToolBelt button through the shared single-open hint target", () => {
    const buttons = nativeControls("button", sourceFiles);

    expect(buttons).toHaveLength(39);
    expect(buttons.filter((button) => nearestHintTarget(button) === null)).toEqual([]);
    expect(allSource).toContain('<StudioToolHintTarget preferredSide="bottom" {...props} />');
    expect(allSource).not.toContain('role="tooltip"');
  });

  it("removes competing native titles while keeping icon controls named", () => {
    const buttons = nativeControls("button", sourceFiles);
    const uploadLabels = nativeControls("label", sourceFiles).filter((label) =>
      label.parent.getText().includes('type="file"')
    );

    expect(buttons.filter((button) => jsxAttribute(button, "title"))).toEqual([]);
    expect(uploadLabels).toHaveLength(1);
    expect(uploadLabels.filter((label) => nearestHintTarget(label) === null)).toEqual([]);
    expect(uploadLabels.filter((label) => jsxAttribute(label, "title"))).toEqual([]);
    expect(allSource).toContain("accept={studioCanvasImageAccept}");
    expect(allSource).toContain("focus-within:outline-accent");

    for (const accessibleName of [
      "실행취소",
      "다시실행",
      "작업 내역",
      "타임랩스 녹화",
      "스토리보드 그리드 보기",
      "팀 작업 공간",
      "마감·품질 검사",
      "세로 스크롤 미리보기",
      "다중 레이어 타임라인",
    ]) {
      expect(allSource).toContain(`aria-label="${accessibleName}`);
    }
    expect(STUDIO_VIEW_ACTION_HINTS.zoomOut.title).toBe("축소");
    expect(STUDIO_VIEW_ACTION_HINTS.zoomIn.title).toBe("확대");
    expect(allSource).toContain(
      'aria-label={pageEditLocked ? "페이지 검토, 현재 편집 잠금" : "페이지 검토와 편집 잠금"}'
    );
    expect(allSource).toContain("aria-label={`문서 댓글${openStudioCommentCount");
  });

  it("makes every disabled native control keyboard-discoverable with an exact reason", () => {
    const disabledButtons = nativeControls("button", sourceFiles).filter((button) =>
      Boolean(jsxAttribute(button, "disabled"))
    );

    expect(disabledButtons.length).toBeGreaterThanOrEqual(8);
    for (const button of disabledButtons) {
      const target = nearestHintTarget(button);
      expect(target, button.getText()).not.toBeNull();
      expect(jsxAttribute(target!, "disabled"), button.getText()).toBeDefined();
      expect(jsxAttribute(target!, "unavailableReason"), button.getText()).toBeDefined();
    }
  });

  it("keeps mobile fill actionable while its shared hint explains recovery", () => {
    const fillButton = nativeControls("button", sourceFiles).find((button) =>
      jsxAttribute(button, "onClick")?.getText().includes("toggleAdvancedFill")
    );

    expect(fillButton).toBeDefined();
    expect(jsxAttribute(fillButton!, "disabled")).toBeUndefined();
    expect(jsxAttribute(fillButton!, "className")?.getText()).not.toContain("disabled:");

    const target = nearestHintTarget(fillButton!);
    expect(target).not.toBeNull();
    expect(jsxAttribute(target!, "disabled")).toBeUndefined();
    expect(jsxAttribute(target!, "unavailableReason")?.getText()).toContain(
      "안전한 단일 래스터 후보",
    );
  });

  it("keeps stateful actions on purpose-built previews instead of generic fallbacks", () => {
    expect(allSource).toContain('aria-label="템플릿·에셋"');
    expect(allSource).toContain('className="max-[359px]:hidden">템플릿·</span>에셋');
    expect(allSource).toContain('aria-label="컷 추가 · 만화 패널"');
    expect(allSource).toContain('/> 컷 추가');
    expect(allSource).toContain('"컷 패널 추가",');

    for (const [key, preview, variant] of [
      ["panelAdd", "panel-layout", "add"],
      ["panelSplit", "panel-layout", "split-diagonal"],
      ["panelDiagonalize", "panel-layout", "diagonalize"],
      ["panelStraighten", "panel-layout", "straighten"],
      ["character3d", "character-3d", null],
      ["mannequin3d", "mannequin-3d", null],
      ["background", "background-library", null],
      ["style", "style-library", null],
      ["storyboard", "storyboard-grid", null],
      ["review", "review-workflow", null],
      ["team", "team-collaboration", null],
      ["continuity", "continuity-check", null],
      ["scrollPreview", "vertical-preview", null],
      ["workspaceFocus", "workspace-focus", null],
      ["maximizeWindow", "fullscreen", "maximize-window"],
      ["restoreWindow", "fullscreen", "restore-window"],
      ["fullscreen", "fullscreen", "fullscreen"],
      ["exitFullscreen", "fullscreen", "exit-fullscreen"],
      ["canvasOnly", "fullscreen", "canvas-only"],
    ] as const) {
      const keyText = `  ${key}: studioToolHintFromLabel(`;
      const entryStart = allSource.indexOf(keyText);
      expect(entryStart, `missing hint ${key}`).toBeGreaterThanOrEqual(0);
      const entry = allSource.slice(entryStart, allSource.indexOf("\n  ),", entryStart) + 5);
      expect(entry).toContain(`"${preview}"`);
      if (variant) expect(entry).toContain(`"${variant}"`);
    }

    for (const [toolBeltKey, sharedKey, previewVariant] of [
      ["zoomOut", "zoomOut", "zoom-out"],
      ["zoomIn", "zoomIn", "zoom-in"],
      ["actualSize", "actualSize", "actual-size"],
      ["fitWidth", "fitWidth", "fit-width"],
      ["resetView", "reset", "reset"],
    ] as const) {
      expect(allSource).toContain(
        `${toolBeltKey}: STUDIO_VIEW_ACTION_HINTS.${sharedKey}`
      );
      expect(STUDIO_VIEW_ACTION_HINTS[sharedKey]).toMatchObject({
        preview: "zoom-view",
        previewVariant,
      });
    }
  });
});
