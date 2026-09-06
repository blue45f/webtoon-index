import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPage = readStudioCuttoonEditorSource();

function count(token: string): number {
  return studioPage.split(token).length - 1;
}

describe("Studio history retention UI boundary", () => {
  it("observes every append authority without counting coalesced replacements", () => {
    expect(studioPage).toContain("observeStudioHistoryRetentionAppend");
    expect(count("noteStudioHistoryRetention(appended);")).toBe(5);

    const coalescedStart = studioPage.indexOf("if (replacesCurrentSnapshot) {");
    const coalescedEnd = studioPage.indexOf(
      "recordStudioHistoryTransition({",
      coalescedStart
    );
    const coalescedBranch = studioPage.slice(coalescedStart, coalescedEnd);
    expect(coalescedBranch).toContain("} else {");
    expect(coalescedBranch).toContain("noteStudioHistoryRetention(appended);");
    expect(coalescedBranch.indexOf("noteStudioHistoryRetention(appended);")).toBeGreaterThan(
      coalescedBranch.indexOf("} else {")
    );

    const batchStart = studioPage.indexOf(
      "function expandDeferredStrokeCommitHistory"
    );
    const batchEnd = studioPage.indexOf(
      "pagesHistoryRef.current = accHistory;",
      batchStart
    );
    const batchLoop = studioPage.slice(batchStart, batchEnd);
    expect(batchLoop).toContain("for (let kept = 1;");
    expect(batchLoop).toContain("noteStudioHistoryRetention(appended);");
  });

  it("resets document-scoped diagnostics on both hard hydration paths", () => {
    // The retention state moved into useStudioHistoryRetention (984251d8c). The server hydration
    // path no longer open-codes the ref+setState pair; both hard paths now call the one reset,
    // and that reset is still the only place a fresh diagnostics state is committed.
    expect(count("resetStudioHistoryRetention();")).toBe(2);
    expect(
      count("commitStudioHistoryRetention(createStudioHistoryRetentionUiState());")
    ).toBe(1);

    const autosaveReset = studioPage.slice(
      studioPage.indexOf("pagesHistoryRef.current = [restoredPages];"),
      studioPage.indexOf("setPagesHistory([restoredPages]);")
    );
    expect(autosaveReset).toContain("resetStudioHistoryRetention();");

    const serverHydration = studioPage.slice(
      studioPage.indexOf("const hydratedPages = hydratedProject.pagesList"),
      studioPage.indexOf("setPagesHistoryState([hydratedPages]);")
    );
    expect(serverHydration).toContain("resetStudioHistoryRetention();");
  });

  it("exposes honest last-measured diagnostics and the authoritative undo depth", () => {
    expect(studioPage).toContain("data-studio-history-entry-count={pagesHistory.length}");
    expect(studioPage).toContain("data-studio-history-undo-depth={pagesHi}");
    expect(studioPage).toContain("data-studio-history-last-measured-retained-bytes");
    expect(studioPage).toContain("data-studio-history-last-measured-budget-bytes");
    expect(studioPage).toContain("data-studio-history-last-measured-entry-bytes");
    expect(studioPage).not.toContain("data-studio-history-retained-bytes=");
  });

  it("remounts the polite atomic status only for a new eviction receipt", () => {
    const noticeStart = studioPage.indexOf("studioHistoryRetention.notice &&");
    const noticeEnd = studioPage.indexOf("{/* 게시·로그인 안내", noticeStart);
    const notice = studioPage.slice(noticeStart, noticeEnd);

    expect(notice).toContain("key={studioHistoryRetention.notice.id}");
    expect(notice).toContain('role="status"');
    expect(notice).toContain('aria-live="polite"');
    expect(notice).toContain('aria-atomic="true"');
    expect(notice).toContain("studioHistoryRetention.notice.message");
    expect(notice).not.toContain("pagesHistory.length - 1");
  });
});
