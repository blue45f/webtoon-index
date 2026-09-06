import { describe, expect, it } from "vitest";

import {
  findChangedLockedPageId,
  isPageReviewLocked,
  normalizePageReviewState,
  PAGE_REVIEW_STATUS_LABELS,
  PAGE_REVIEW_STATUSES,
  patchPageReviewState,
} from "./studio-page-review";

describe("studio page review", () => {
  it("normalizes malformed data to an editable draft", () => {
    expect(normalizePageReviewState(null)).toEqual({ status: "draft", locked: false });
    expect(normalizePageReviewState({ status: "unknown", locked: "yes", assignee: 3 })).toEqual({
      status: "draft",
      locked: false,
    });
  });

  it("trims bounded review fields and preserves a valid timestamp", () => {
    expect(
      normalizePageReviewState({
        status: "changes-requested",
        locked: true,
        assignee: "  편집자  ",
        note: "  말풍선 수정  ",
        updatedAt: "2026-07-10T00:00:00.000Z",
      })
    ).toEqual({
      status: "changes-requested",
      locked: true,
      assignee: "편집자",
      note: "말풍선 수정",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it("patches one review state with an audit timestamp", () => {
    expect(
      patchPageReviewState(
        { status: "draft", locked: false },
        { status: "approved", locked: true },
        new Date("2026-07-10T01:00:00.000Z")
      )
    ).toEqual({ status: "approved", locked: true, updatedAt: "2026-07-10T01:00:00.000Z" });
  });

  it("reports explicit locks independently from review status", () => {
    expect(isPageReviewLocked({ status: "approved", locked: false })).toBe(false);
    expect(isPageReviewLocked({ status: "draft", locked: true })).toBe(true);
  });

  it("defines a label for every status", () => {
    for (const status of PAGE_REVIEW_STATUSES) expect(PAGE_REVIEW_STATUS_LABELS[status]).toBeTruthy();
  });

  it("allows reorder and insertion while detecting replacement or removal of a locked page", () => {
    const unlocked = { id: "draft", review: { status: "draft", locked: false }, value: 1 };
    const locked = { id: "approved", review: { status: "approved", locked: true }, value: 2 };
    const inserted = { id: "new", value: 0 };

    expect(findChangedLockedPageId([unlocked, locked], [inserted, locked, unlocked])).toBeNull();
    expect(
      findChangedLockedPageId([unlocked, locked], [unlocked, { ...locked, value: 3 }])
    ).toBe("approved");
    expect(findChangedLockedPageId([unlocked, locked], [unlocked])).toBe("approved");
  });
});
