import { describe, expect, it } from "vitest";

import {
  studioVectorAsyncCommandStaleReason,
  type StudioVectorAsyncCommandCurrent,
  type StudioVectorAsyncCommandSnapshot,
} from "./studio-vector-async-command-guard";

interface Element {
  readonly id: string;
  readonly locked?: boolean;
}

const first: Element = { id: "first" };
const second: Element = { id: "second" };

function snapshot(
  overrides: Partial<StudioVectorAsyncCommandSnapshot<Element>> = {},
): StudioVectorAsyncCommandSnapshot<Element> {
  return {
    runId: 4,
    pageId: "page-a",
    masterEditMode: false,
    selectedIds: ["first", "second"],
    sourceElements: [first, second],
    ...overrides,
  };
}

function current(
  overrides: Partial<StudioVectorAsyncCommandCurrent<Element>> = {},
): StudioVectorAsyncCommandCurrent<Element> {
  return {
    runId: 4,
    pageId: "page-a",
    masterEditMode: false,
    selectedIds: ["second", "first"],
    elements: [first, second],
    mutationAllowed: true,
    reviewLocked: false,
    isElementLocked: (element) => element.locked === true,
    ...overrides,
  };
}

describe("studioVectorAsyncCommandStaleReason", () => {
  it("admits the exact current sources while allowing selection order changes", () => {
    expect(studioVectorAsyncCommandStaleReason(snapshot(), current())).toBeNull();
  });

  it.each([
    ["superseded", current({ runId: 5 })],
    ["document-changed", current({ mutationAllowed: false })],
    ["surface-changed", current({ pageId: "page-b" })],
    ["surface-changed", current({ masterEditMode: true })],
    ["selection-changed", current({ selectedIds: ["first"] })],
    ["selection-changed", current({ selectedIds: ["first", "first"] })],
    [
      "source-changed",
      current({ elements: [{ ...first }, second] }),
    ],
    ["source-changed", current({ elements: [first] })],
    ["locked", current({ reviewLocked: true })],
    [
      "locked",
      current({
        isElementLocked: (element) => element.id === "second",
      }),
    ],
  ] as const)("rejects %s", (reason, state) => {
    expect(studioVectorAsyncCommandStaleReason(snapshot(), state)).toBe(reason);
  });
});
