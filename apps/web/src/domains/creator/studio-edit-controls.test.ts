import { describe, expect, it } from "vitest";

import {
  isStudioPasteScopeCurrent,
  resolveStudioEditAvailability,
  resolveStudioEditShortcut,
  isStudioUndoRedoChord,
  shouldHandleStudioEditEvent,
  STUDIO_EDIT_MENU_COMMAND_ORDER,
  STUDIO_EDIT_MENU_COMMANDS,
} from "./studio-edit-controls";

describe("studio edit menu catalog", () => {
  it("keeps the production command order and Magma-compatible shortcuts in one contract", () => {
    const legacyCommandContract = STUDIO_EDIT_MENU_COMMAND_ORDER.map((id) => {
      const command = STUDIO_EDIT_MENU_COMMANDS[id];
      return "shortcut" in command
        ? { id: command.id, label: command.label, shortcut: command.shortcut }
        : { id: command.id, label: command.label };
    });

    expect(legacyCommandContract).toEqual([
      { id: "undo", label: "실행취소", shortcut: "⌘Z" },
      { id: "redo", label: "다시실행", shortcut: "⌘⇧Z" },
      { id: "cut", label: "잘라내기", shortcut: "⌘X" },
      { id: "copy", label: "복사", shortcut: "⌘C" },
      { id: "paste", label: "붙여넣기", shortcut: "⌘V" },
      { id: "paste-in-place", label: "현재 위치에 붙여넣기", shortcut: "⌘⇧V" },
      { id: "paste-file", label: "이미지 파일 붙여넣기…" },
      { id: "select-all", label: "모두 선택", shortcut: "⌘A" },
      { id: "deselect", label: "선택 해제", shortcut: "⌘D" },
      { id: "invert-selection", label: "선택 반전", shortcut: "⌘⇧I" },
      { id: "clear-selection", label: "선택 제거", shortcut: "Delete" },
      { id: "duplicate", label: "복제", shortcut: "⌘J" },
      { id: "bring-front", label: "레이어 · 맨 위로", shortcut: "⌘⇧]" },
      { id: "bring-forward", label: "레이어 · 위로", shortcut: "⌘]" },
      { id: "send-back", label: "레이어 · 맨 뒤로", shortcut: "⌘⇧[" },
      { id: "send-backward", label: "레이어 · 뒤로", shortcut: "⌘[" },
      { id: "crop-layer", label: "레이어 자르기…" },
      { id: "history", label: "작업 내역" },
      { id: "pen-pressure", label: "펜 압력 설정…" },
      { id: "app-settings", label: "애플리케이션 설정…" },
    ]);
  });

  it("provides a stable translation key for every production command", () => {
    expect(
      STUDIO_EDIT_MENU_COMMAND_ORDER.map((id) => STUDIO_EDIT_MENU_COMMANDS[id].labelKey),
    ).toEqual(
      STUDIO_EDIT_MENU_COMMAND_ORDER.map((id) => `studio.mainMenu.edit.command.${id}`),
    );
  });
});

describe("studio edit availability", () => {
  const editableSelection = {
    historyIndex: 1,
    historyLength: 3,
    documentEmpty: false,
    hasElementSelection: true,
    hasSingleElementSelection: true,
    hasPixelSelection: false,
    hasPixelEditing: false,
    pixelBusy: false,
    selectedImage: false,
    rasterRetouchTargetAvailable: false,
    interactionLocked: false,
    mutationLocked: false,
    selectedContentMutationLocked: false,
    masterEditMode: false,
  } as const;

  it("enables element mutations and both history directions for an editable selection", () => {
    expect(resolveStudioEditAvailability(editableSelection)).toMatchObject({
      undoDisabled: false,
      redoDisabled: false,
      cutDisabled: false,
      copyDisabled: false,
      pasteDisabled: false,
      selectAllDisabled: false,
      deselectDisabled: false,
      duplicateDisabled: false,
      reorderDisabled: false,
    });
  });

  it("keeps read-only selection commands usable while mutation commands are locked", () => {
    expect(resolveStudioEditAvailability({ ...editableSelection, mutationLocked: true })).toEqual({
      undoDisabled: true,
      redoDisabled: true,
      cutDisabled: true,
      copyDisabled: false,
      pasteDisabled: true,
      selectAllDisabled: false,
      deselectDisabled: false,
      invertSelectionDisabled: true,
      clearSelectionDisabled: true,
      duplicateDisabled: true,
      reorderDisabled: true,
      cropLayerDisabled: true,
    });
  });

  it("keeps z-order commands available for a group or multi-selection", () => {
    expect(resolveStudioEditAvailability({
      ...editableSelection,
      hasSingleElementSelection: false,
    }).reorderDisabled).toBe(false);
  });

  it("blocks read-only selection inspection while a transient capture owns the page history", () => {
    expect(resolveStudioEditAvailability({
      ...editableSelection,
      interactionLocked: true,
    })).toMatchObject({
      copyDisabled: true,
      selectAllDisabled: true,
      deselectDisabled: true,
      invertSelectionDisabled: true,
    });
  });

  it("models pixel selection and master history independently", () => {
    expect(resolveStudioEditAvailability({
      ...editableSelection,
      hasElementSelection: true,
      hasPixelSelection: true,
      hasPixelEditing: true,
      selectedImage: true,
      rasterRetouchTargetAvailable: true,
      masterEditMode: true,
    })).toMatchObject({
      undoDisabled: true,
      redoDisabled: true,
      deselectDisabled: false,
      invertSelectionDisabled: false,
      clearSelectionDisabled: false,
      cropLayerDisabled: false,
    });
  });

  it("enables crop when the sole editable image can be auto-selected without a prior selection", () => {
    // Rail Crop + keyboard C already work via ensurePixelToolTarget; the Edit menu must match.
    expect(resolveStudioEditAvailability({
      ...editableSelection,
      hasElementSelection: false,
      hasSingleElementSelection: false,
      selectedImage: false,
      rasterRetouchTargetAvailable: true,
    }).cropLayerDisabled).toBe(false);
  });

  it("keeps crop disabled when no pixel-tool target is available or mutations are locked", () => {
    expect(resolveStudioEditAvailability({
      ...editableSelection,
      selectedImage: true,
      rasterRetouchTargetAvailable: false,
    }).cropLayerDisabled).toBe(true);
    expect(resolveStudioEditAvailability({
      ...editableSelection,
      selectedImage: true,
      rasterRetouchTargetAvailable: true,
      mutationLocked: true,
    }).cropLayerDisabled).toBe(true);
  });

  it("never exposes destructive pixel deletion while the image is locked or already busy", () => {
    const pixelSelection = {
      ...editableSelection,
      hasPixelSelection: true,
      hasPixelEditing: true,
      selectedImage: true,
    };
    expect(resolveStudioEditAvailability({
      ...pixelSelection,
      selectedContentMutationLocked: true,
    }).clearSelectionDisabled).toBe(true);
    expect(resolveStudioEditAvailability({
      ...pixelSelection,
      pixelBusy: true,
    }).clearSelectionDisabled).toBe(true);
  });

  it("disables empty-document selection actions", () => {
    expect(resolveStudioEditAvailability({
      ...editableSelection,
      historyIndex: 0,
      historyLength: 1,
      documentEmpty: true,
      hasElementSelection: false,
      hasSingleElementSelection: false,
    })).toMatchObject({
      undoDisabled: true,
      redoDisabled: true,
      cutDisabled: true,
      copyDisabled: true,
      selectAllDisabled: true,
      deselectDisabled: true,
      clearSelectionDisabled: true,
      duplicateDisabled: true,
      reorderDisabled: true,
    });
  });
});

describe("studio edit shortcuts", () => {
  it.each([
    [{ code: "KeyX", metaKey: true }, "cut"],
    [{ code: "KeyC", ctrlKey: true }, "copy"],
    [{ code: "KeyV", metaKey: true, shiftKey: true }, "paste-in-place"],
    [{ code: "KeyA", ctrlKey: true }, "select-all"],
    [{ code: "KeyD", metaKey: true }, "deselect"],
    [{ code: "KeyI", ctrlKey: true, shiftKey: true }, "invert-selection"],
    [{ code: "KeyJ", metaKey: true }, "duplicate"],
    [{ code: "BracketRight", metaKey: true, shiftKey: true }, "bring-front"],
    [{ code: "BracketRight", metaKey: true }, "bring-forward"],
    [{ code: "BracketLeft", metaKey: true }, "send-backward"],
    [{ code: "BracketLeft", metaKey: true, shiftKey: true }, "send-back"],
  ] as const)("maps %o to %s", (event, expected) => {
    expect(resolveStudioEditShortcut(event)).toBe(expected);
  });

  it("keeps the two bracket pairs symmetric — ⇧ always means 'all the way'", () => {
    // 업계 표준(Photoshop·클립스튜디오·일러스트레이터)과 같은 배치. 한쪽 쌍만 뒤집히면
    // 사용자는 ⌘[ 한 번에 레이어를 문서 맨 뒤로 날려버린다(측정된 D6 결함).
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }] as const) {
      expect(resolveStudioEditShortcut({ code: "BracketRight", ...modifier })).toBe("bring-forward");
      expect(resolveStudioEditShortcut({ code: "BracketLeft", ...modifier })).toBe("send-backward");
      expect(resolveStudioEditShortcut({ code: "BracketRight", ...modifier, shiftKey: true })).toBe("bring-front");
      expect(resolveStudioEditShortcut({ code: "BracketLeft", ...modifier, shiftKey: true })).toBe("send-back");
    }
  });

  it("advertises the chord each bracket resolver actually returns", () => {
    // 표기와 동작이 어긋나면 오작동보다 나쁘다 — 메뉴 라벨을 리졸버로 검증한다.
    const chordOf = (id: "bring-front" | "bring-forward" | "send-back" | "send-backward") =>
      STUDIO_EDIT_MENU_COMMANDS[id].shortcut;
    const resolvedChordOf = (event: Parameters<typeof resolveStudioEditShortcut>[0]) => {
      const id = resolveStudioEditShortcut(event);
      if (
        id !== "bring-front"
        && id !== "bring-forward"
        && id !== "send-back"
        && id !== "send-backward"
      ) {
        throw new Error(`Expected a layer-order shortcut, received ${String(id)}`);
      }
      return chordOf(id);
    };
    expect(resolvedChordOf({ code: "BracketLeft", metaKey: true })).toBe("⌘[");
    expect(resolvedChordOf({ code: "BracketLeft", metaKey: true, shiftKey: true })).toBe("⌘⇧[");
    expect(resolvedChordOf({ code: "BracketRight", metaKey: true })).toBe("⌘]");
    expect(resolvedChordOf({ code: "BracketRight", metaKey: true, shiftKey: true })).toBe("⌘⇧]");
  });

  it("does not steal plain paste, merged-copy, Alt, repeats, or IME input", () => {
    expect(resolveStudioEditShortcut({ code: "KeyV", metaKey: true })).toBeNull();
    expect(resolveStudioEditShortcut({ code: "KeyC", metaKey: true, shiftKey: true })).toBeNull();
    expect(resolveStudioEditShortcut({ code: "KeyX", metaKey: true, altKey: true })).toBeNull();
    expect(resolveStudioEditShortcut({ code: "KeyD", metaKey: true, repeat: true })).toBeNull();
    expect(resolveStudioEditShortcut({ code: "KeyA", metaKey: true, isComposing: true })).toBeNull();
    expect(resolveStudioEditShortcut({ code: "KeyA", metaKey: true, keyCode: 229 })).toBeNull();
  });
});

describe("studio edit event guard", () => {
  it("allows an untouched canvas/background event", () => {
    expect(shouldHandleStudioEditEvent({})).toBe(true);
  });

  it.each([
    "defaultPrevented",
    "composing",
    "typing",
    "editing",
    "insideShortcutBoundary",
    "modalOpen",
    "timelapseCapturing",
  ] as const)("blocks %s for both keydown and paste routing", (key) => {
    expect(shouldHandleStudioEditEvent({ [key]: true })).toBe(false);
  });

  // Two independent audits measured ⌘Z doing literally nothing — once with focus in the layer
  // navigator, once right after the filter dialog handed focus back to its menu trigger. Both
  // surfaces claim a shortcut boundary so that `B`/`E`/`Delete` cannot reach the document; undo
  // is the one command that must reach it anyway.
  it("lets undo through a panel's shortcut boundary", () => {
    expect(shouldHandleStudioEditEvent({ insideShortcutBoundary: true })).toBe(false);
    expect(
      shouldHandleStudioEditEvent({ insideShortcutBoundary: true, undoRedoIntent: true }),
    ).toBe(true);
  });

  it.each(["typing", "editing", "composing", "modalOpen", "timelapseCapturing"] as const)(
    "still blocks undo when %s",
    (key) => {
      // Inside a text field ⌘Z means "undo my typing"; behind a modal it must not reach the
      // document underneath. The exemption is for panel scopes only.
      expect(shouldHandleStudioEditEvent({ [key]: true, undoRedoIntent: true })).toBe(false);
    },
  );

  it("recognises the history chord on either platform modifier and nothing else", () => {
    expect(isStudioUndoRedoChord({ key: "z", metaKey: true })).toBe(true);
    expect(isStudioUndoRedoChord({ key: "Z", ctrlKey: true })).toBe(true);
    expect(isStudioUndoRedoChord({ key: "z" })).toBe(false);
    expect(isStudioUndoRedoChord({ key: "y", metaKey: true })).toBe(false);
    expect(isStudioUndoRedoChord({ metaKey: true })).toBe(false);
  });
});

describe("studio async paste scope", () => {
  const current = {
    mutationAllowed: true,
    reviewLocked: false,
    targetPageId: "page-a",
    currentPageId: "page-a",
    targetMasterEditMode: false,
    currentMasterEditMode: false,
  } as const;

  it("allows the same editable page and master surface after await", () => {
    expect(isStudioPasteScopeCurrent(current)).toBe(true);
  });

  it.each([
    { mutationAllowed: false },
    { reviewLocked: true },
    { currentPageId: "page-b" },
    { currentMasterEditMode: true },
  ])("rejects a stale or newly locked continuation: %o", (patch) => {
    expect(isStudioPasteScopeCurrent({ ...current, ...patch })).toBe(false);
  });
});
