import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const commentsPanelSource = readFileSync(
  new URL("./StudioCommentsPanel.tsx", import.meta.url),
  "utf8"
);
const threadPopoverSource = readFileSync(
  new URL("./StudioCommentThreadPopover.tsx", import.meta.url),
  "utf8"
);

describe("Studio focused comment inbox integration", () => {
  it("keeps assigned and mentioned quick views wired to the review rail", () => {
    expect(commentsPanelSource).toContain('{ value: "assigned", label: "내 담당" }');
    expect(commentsPanelSource).toContain('{ value: "mentioned", label: "나를 멘션" }');
    expect(commentsPanelSource).toContain("studioCommentThreadAssignedToActor(thread, currentActor)");
    expect(commentsPanelSource).toContain("studioCommentThreadMentionsActor(thread, currentActor)");
  });

  it("supports fast keyboard submission without taking Enter away from multiline editing", () => {
    // 새 댓글 작성기와 핀 빠른 답글은 등록 단축키만 갖고, 검수 레일 답글은 Esc 취소까지 노출한다.
    expect(commentsPanelSource.match(/aria-keyshortcuts="Control\+Enter Meta\+Enter"/g)).toHaveLength(1);
    expect(commentsPanelSource).toContain('aria-keyshortcuts="Meta+Enter Control+Enter Escape"');
    expect(threadPopoverSource).toContain('aria-keyshortcuts="Control+Enter Meta+Enter"');
    expect(commentsPanelSource).toContain("event.currentTarget.form?.requestSubmit()");
    expect(threadPopoverSource).toContain("event.currentTarget.form?.requestSubmit()");
  });
});
