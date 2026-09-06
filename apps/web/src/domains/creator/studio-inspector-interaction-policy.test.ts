import { describe, expect, it } from "vitest";

import {
  resolveStudioInspectorContentMode,
  resolveStudioInspectorInteractionPolicy,
  studioInspectorToolToggleDisabled,
} from "./studio-inspector-interaction-policy";

function policy(
  patch: Partial<
    Parameters<typeof resolveStudioInspectorInteractionPolicy>[0]
  > = {},
) {
  return resolveStudioInspectorInteractionPolicy({
    saving: false,
    collaborationDocumentLocked: false,
    activeSurfaceReviewLocked: false,
    selectedContentMutationLocked: false,
    masterEditMode: false,
    ...patch,
  });
}

describe("studio inspector interaction policy", () => {
  it.each([
    [
      "collaboration permission",
      { collaborationDocumentLocked: true },
      "공동 문서 편집 권한이 없어 변경할 수 없어요.",
    ],
    [
      "saving",
      { saving: true },
      "저장이 끝난 뒤 변경할 수 있어요.",
    ],
    [
      "review lock",
      { activeSurfaceReviewLocked: true },
      "검토 잠금을 해제한 뒤 변경할 수 있어요.",
    ],
  ] as const)(
    "applies the %s lock to global, page and selected mutations",
    (_label, patch, reason) => {
      const result = policy(patch);

      expect(result.global).toEqual({ disabled: true, reason });
      expect(result.page).toEqual({ disabled: true, reason });
      expect(result.selection).toEqual({ disabled: true, reason });
    },
  );

  it("applies a selected-layer lock only to selected content", () => {
    const result = policy({ selectedContentMutationLocked: true });

    expect(result.global.disabled).toBe(false);
    expect(result.page.disabled).toBe(false);
    expect(result.selection).toEqual({
      disabled: true,
      reason: "선택한 레이어의 잠금을 해제한 뒤 변경할 수 있어요.",
    });
  });

  it("keeps master element editing available while locking page-only controls", () => {
    const result = policy({ masterEditMode: true });

    expect(result.global.disabled).toBe(false);
    expect(result.selection.disabled).toBe(false);
    expect(result.page).toEqual({
      disabled: true,
      reason: "마스터 편집을 마친 뒤 페이지 설정을 변경할 수 있어요.",
    });
  });

  it("keeps the active tool's exit toggle available under a mutation lock", () => {
    const gate = policy({ saving: true }).selection;

    expect(studioInspectorToolToggleDisabled(gate, false)).toBe(true);
    expect(studioInspectorToolToggleDisabled(gate, true)).toBe(false);
  });
});

describe("studio inspector content priority", () => {
  it("shows drawing controls whenever the draw tool is active, without clearing selection", () => {
    expect(
      resolveStudioInspectorContentMode({
        tool: "draw",
        hasSelection: true,
      }),
    ).toBe("drawing");
  });

  it("returns to the preserved selection when a non-drawing tool becomes active", () => {
    expect(
      resolveStudioInspectorContentMode({
        tool: "select",
        hasSelection: true,
      }),
    ).toBe("selection");
  });

  it("uses the empty state only when neither drawing nor a selection owns the Inspector", () => {
    expect(
      resolveStudioInspectorContentMode({
        tool: "select",
        hasSelection: false,
      }),
    ).toBe("empty");
  });
});
