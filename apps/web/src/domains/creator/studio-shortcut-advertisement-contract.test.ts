import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveStudioDrawingShortcut } from "./brush/studio-drawing-shortcuts";
import { resolveStudioViewShortcut } from "./studio-view-controls";

/**
 * §15 UX 감사(2026-08, docs/rewrite/ux-audit-v5.md §2.4)가 찾은 두 부류의 단축키 결함을 고정한다.
 *
 * 1. **광고만 되고 바인딩이 없는 화음** — 메뉴는 `⌘S`를 보여주는데 핸들러가 없어 브라우저의
 *    "페이지 저장"이 대신 떴다.
 * 2. **리졸버 충돌** — `⇧S`를 보기 리졸버와 그리기 리졸버가 동시에 주장했고, 보기가 먼저
 *    실행되므로 크기 잠금은 실행될 수 없는 dead branch였다.
 *
 * 마스터 핸들러가 리졸버를 순차 실행하는 구조(StudioPage)라 충돌은 타입으로 잡히지 않는다.
 * 화음 전수 스윕으로 "두 리졸버가 같은 화음을 주장하지 않는다"를 계약으로 못 박는다.
 */

// 의도된 변경(2026-08, B-06): 마스터 keydown 디스패처 본문이 StudioPage.tsx 에서
// studio-page-shortcut-dispatcher.ts 로 추출되어, ⌘S 바인딩 스캔은 그 파일을 읽는다.
const shortcutDispatcherSource = readFileSync(
  new URL("./studio-page-shortcut-dispatcher.ts", import.meta.url),
  "utf8",
);
const menuGroupsSource = readFileSync(
  new URL("./studio-main-menu-items-document.ts", import.meta.url),
  "utf8",
);

const SWEPT_CODES = [
  "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI",
  "KeyJ", "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR",
  "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6",
  "BracketLeft", "BracketRight", "Backquote", "Equal", "Minus",
  "Home", "End", "F11",
] as const;

const MODIFIER_COMBINATIONS = [
  { altKey: false, shiftKey: false },
  { altKey: false, shiftKey: true },
  { altKey: true, shiftKey: false },
  { altKey: true, shiftKey: true },
] as const;

function chordLabel(code: string, altKey: boolean, shiftKey: boolean): string {
  return `${shiftKey ? "Shift+" : ""}${altKey ? "Alt+" : ""}${code}`;
}

describe("studio shortcut advertisement contract", () => {
  it("keeps the view and drawing resolvers from claiming the same chord", () => {
    const collisions: string[] = [];

    for (const code of SWEPT_CODES) {
      for (const modifiers of MODIFIER_COMBINATIONS) {
        const event = { code, ...modifiers };
        const view = resolveStudioViewShortcut(event);
        const drawing = resolveStudioDrawingShortcut(event);
        if (view !== null && drawing !== null) {
          collisions.push(
            `${chordLabel(code, modifiers.altKey, modifiers.shiftKey)} → view:${view} / drawing:${drawing.type}`,
          );
        }
      }
    }

    expect(collisions).toEqual([]);
  });

  it("keeps every drawing shortcut variant reachable past the view resolver", () => {
    // 감사 근거: ⇧S 크기 잠금이 보기 리졸버에 가려 한 번도 실행되지 않았다.
    const reachable = new Set<string>();
    for (const code of SWEPT_CODES) {
      for (const modifiers of MODIFIER_COMBINATIONS) {
        const event = { code, ...modifiers };
        if (resolveStudioViewShortcut(event) !== null) continue;
        const drawing = resolveStudioDrawingShortcut(event);
        if (drawing) reachable.add(drawing.type);
      }
    }

    expect(reachable).toContain("toggle-size-lock");
    expect(reachable).toContain("toggle-opacity-lock");
    expect(reachable).toContain("cycle-stabilizer");
    expect(reachable).toContain("select-pen");
    expect(reachable).toContain("select-eraser");
  });

  it("binds the size lock to Shift+Alt+S only, so the saved-view chord stays intact", () => {
    expect(resolveStudioViewShortcut({ code: "KeyS", shiftKey: true })).toBe("save-view");
    expect(resolveStudioDrawingShortcut({ code: "KeyS", shiftKey: true })).toBeNull();
    expect(
      resolveStudioDrawingShortcut({ code: "KeyS", shiftKey: true, altKey: true }),
    ).toEqual({ type: "toggle-size-lock" });
    expect(resolveStudioViewShortcut({ code: "KeyS", shiftKey: true, altKey: true })).toBeNull();
  });

  it("backs the advertised ⌘S save shortcut with a real handler", () => {
    // 메뉴가 `⌘S`를 계속 광고한다(광고를 지우는 것도 유효한 해법이므로 함께 고정한다).
    expect(menuGroupsSource).toContain('shortcut: "⌘S"');

    const handlerStart = shortcutDispatcherSource.indexOf("return (e: KeyboardEvent) => {");
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handlerEnd = shortcutDispatcherSource.indexOf(
      "const editShortcut = resolveStudioEditShortcut(e);",
      handlerStart,
    );
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = shortcutDispatcherSource.slice(handlerStart, handlerEnd);

    const saveBindingStart = handler.indexOf('&& e.code === "KeyS"');
    expect(saveBindingStart).toBeGreaterThanOrEqual(0);
    const saveBinding = handler.slice(saveBindingStart, saveBindingStart + 600);
    expect(saveBinding).toContain("e.preventDefault();");
    expect(saveBinding).toContain('void handleSave("draft");');
    expect(saveBinding).toContain("collaborationDocumentLocked");

    // 편집 게이트보다 앞에 있어야 제목·대사 입력 중에도 저장이 동작한다.
    expect(handler.indexOf('&& e.code === "KeyS"')).toBeLessThan(
      handler.indexOf("if (!shouldHandleStudioEditEvent({"),
    );
  });
});
