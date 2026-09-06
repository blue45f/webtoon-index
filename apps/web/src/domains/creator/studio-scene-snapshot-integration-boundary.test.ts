import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioCuttoonEditorSource();
const modalBoundariesSource = readFileSync(
  new URL("./studio-page-modal-lazy-boundaries.ts", import.meta.url),
  "utf8"
);

describe("scene snapshot Studio integration boundary", () => {
  it("keeps the library lazy and applies the full page through document history", () => {
    expect(modalBoundariesSource).toContain('import("./StudioSceneSnapshotDialog")');
    expect(pageSource).toContain("const [sceneSnapshotOpen, setSceneSnapshotOpen]");
    expect(pageSource).toMatch(
      /const restoredPage: PageState = \{\s+\.\.\.snapshot\.page,\s+id: activePage\.id,/u
    );
    expect(pageSource).toContain("commitPages(nextPages)");
    expect(pageSource).toContain("setWebtoonTheme(snapshot.theme);");
    expect(pageSource).toContain("setSceneSnapshotOpen(false);");
  });

  it("does not apply a snapshot without the explicit replacement confirmation", () => {
    const handlerStart = pageSource.indexOf("function applySceneSnapshot(");
    const nextHandler = pageSource.indexOf("async function startFromExample", handlerStart);
    const handlerSource = pageSource.slice(handlerStart, nextHandler);

    expect(handlerStart).toBeGreaterThan(-1);
    // 승인 표면은 네이티브 confirm 에서 "무엇이 사라지는지" preview 로 바뀌었지만,
    // 커밋보다 먼저라는 계약은 그대로다.
    expect(handlerSource).toContain("confirmStudioDestructiveAction(sceneSnapshotRequest)");
    expect(handlerSource.indexOf("confirmStudioDestructiveAction(")).toBeLessThan(
      handlerSource.indexOf("commitPages(nextPages)")
    );
    // 커밋 거절이 조용히 사라지지 않는다.
    expect(handlerSource).toContain("settleStudioDestructiveCommit(");
  });
});
