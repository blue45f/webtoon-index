import { describe, expect, it } from "vitest";

import { defaultStudioAppSettings } from "../studio-app-settings";

import {
  adjustStudioBrushOpacity,
  adjustStudioBrushWidth,
  resolveStudioDrawingShortcut,
  shouldPreserveStudioTabNavigation,
} from "./studio-drawing-shortcuts";

describe("resolveStudioDrawingShortcut", () => {
  it("B는 펜, E는 펜·지우개 토글로 해석한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "KeyB", key: "b" })).toEqual({ type: "select-pen" });
    expect(resolveStudioDrawingShortcut({ code: "KeyE", key: "e" })).toEqual({ type: "select-eraser" });
  });

  it("가상 키보드·브라우저 자동화가 축약 code를 보내도 key 의미로 보완한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "b", key: "b" })).toEqual({ type: "select-pen" });
    expect(resolveStudioDrawingShortcut({ code: "E", key: "E" })).toEqual({ type: "select-eraser" });
    expect(resolveStudioDrawingShortcut({ code: "]", key: "]" })).toEqual({
      type: "adjust-width",
      delta: 1,
    });
  });

  it("B/E 자동 반복은 무시해 도구가 진동하지 않게 한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "KeyB", repeat: true })).toBeNull();
    expect(resolveStudioDrawingShortcut({ code: "KeyE", repeat: true })).toBeNull();
  });

  it("브래킷은 ±1px, Shift 브래킷은 ±5px이며 반복을 허용한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "BracketLeft", repeat: true })).toEqual({
      type: "adjust-width",
      delta: -1,
    });
    expect(resolveStudioDrawingShortcut({ code: "BracketRight", shiftKey: true })).toEqual({
      type: "adjust-width",
      delta: 5,
    });
  });

  it("Option/Alt 브래킷은 불투명도를 5%p 조절한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "BracketLeft", altKey: true })).toEqual({
      type: "adjust-opacity",
      delta: -0.05,
    });
    expect(resolveStudioDrawingShortcut({ code: "BracketRight", altKey: true, shiftKey: true })).toEqual({
      type: "adjust-opacity",
      delta: 0.05,
    });
  });

  it("Cmd/Ctrl 브래킷은 기존 레이어 명령에 양보한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "BracketLeft", metaKey: true })).toBeNull();
    expect(resolveStudioDrawingShortcut({ code: "BracketRight", ctrlKey: true })).toBeNull();
  });

  it("Shift/Option으로 key가 변형돼도 물리 code로 안정적으로 해석한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "BracketLeft", key: "{", shiftKey: true })).toEqual({
      type: "adjust-width",
      delta: -5,
    });
    expect(resolveStudioDrawingShortcut({ code: "BracketRight", key: "‘", altKey: true })).toEqual({
      type: "adjust-opacity",
      delta: 0.05,
    });
  });

  it("IME 조합과 keyCode 229는 무시한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "KeyB", isComposing: true })).toBeNull();
    expect(resolveStudioDrawingShortcut({ code: "KeyE", keyCode: 229 })).toBeNull();
  });

  it("Digit1–6은 최근 브러시 슬롯 호출로 해석한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "Digit1" })).toEqual({
      type: "recall-brush-slot",
      index: 0,
    });
    expect(resolveStudioDrawingShortcut({ code: "Digit6" })).toEqual({
      type: "recall-brush-slot",
      index: 5,
    });
    expect(resolveStudioDrawingShortcut({ code: "Digit1", shiftKey: true })).toBeNull();
  });

  it("Tab은 브라우저 포커스 이동으로 보존하고 Backquote만 크롬 토글로 해석한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "Tab" })).toBeNull();
    expect(resolveStudioDrawingShortcut({ code: "Tab", shiftKey: true })).toBeNull();
    expect(resolveStudioDrawingShortcut({ code: "Tab", metaKey: true })).toBeNull();
    expect(resolveStudioDrawingShortcut({ code: "Backquote" })).toEqual({ type: "toggle-chrome" });
    expect(resolveStudioDrawingShortcut({ key: "`" })).toEqual({ type: "toggle-chrome" });
    expect(resolveStudioDrawingShortcut({ code: "Backquote", shiftKey: true })).toBeNull();
  });

  it("크롬 토글은 명시적 캔버스에서만 허용하고 나머지 문서 포커스를 보존한다", () => {
    expect(shouldPreserveStudioTabNavigation({ tagName: "BUTTON", tabIndex: 0 })).toBe(true);
    expect(shouldPreserveStudioTabNavigation({ tagName: "SPAN", tabIndex: 0 })).toBe(true);
    expect(shouldPreserveStudioTabNavigation({ tagName: "DIV", role: "treeitem", tabIndex: -1 })).toBe(true);
    expect(shouldPreserveStudioTabNavigation({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(
      shouldPreserveStudioTabNavigation({
        tagName: "DIV",
        role: "group",
        tabIndex: 0,
        canvasViewportFocused: true,
      })
    ).toBe(false);
    expect(shouldPreserveStudioTabNavigation({ tagName: "BODY", tabIndex: -1 })).toBe(true);
    expect(shouldPreserveStudioTabNavigation({ tagName: "DIV", tabIndex: -1 })).toBe(true);
    expect(shouldPreserveStudioTabNavigation({})).toBe(true);
  });

  it("CSP/Photoshop/Procreate 계열 색·보정·잠금 단축키를 해석한다", () => {
    expect(resolveStudioDrawingShortcut({ code: "KeyX" })).toEqual({ type: "swap-colors" });
    expect(resolveStudioDrawingShortcut({ code: "KeyD" })).toEqual({ type: "default-colors" });
    expect(resolveStudioDrawingShortcut({ code: "KeyS" })).toEqual({ type: "cycle-stabilizer" });
    // 계약 변경(2026-08): ⇧S는 보기 리졸버가 `현재 보기 저장`으로 먼저 소비한다.
    // 예전처럼 여기서 ⇧S를 주장하면 크기 잠금이 도달 불가 dead branch가 되므로 ⇧⌥S로 옮겼다.
    expect(resolveStudioDrawingShortcut({ code: "KeyS", shiftKey: true })).toBeNull();
    expect(
      resolveStudioDrawingShortcut({ code: "KeyS", altKey: true, shiftKey: true })
    ).toEqual({ type: "toggle-size-lock" });
    expect(resolveStudioDrawingShortcut({ code: "KeyS", altKey: true })).toEqual({
      type: "toggle-opacity-lock",
    });
    expect(resolveStudioDrawingShortcut({ code: "KeyF" })).toEqual({ type: "toggle-canvas-flip-h" });
    // Cmd+D is the document deselect command — not default colors.
    expect(resolveStudioDrawingShortcut({ code: "KeyD", metaKey: true })).toBeNull();
  });

  it("options.shortcuts가 있으면 레지스트리 코드를 우선하고 리맵·언바인드 시 하드코드를 막는다", () => {
    const base = defaultStudioAppSettings().shortcuts;

    // Default registry: pen stays B, flip is H (not legacy KeyF hard-code).
    expect(
      resolveStudioDrawingShortcut({ code: "KeyB", key: "b" }, { shortcuts: base })
    ).toEqual({ type: "select-pen" });
    expect(
      resolveStudioDrawingShortcut({ code: "KeyH", key: "h" }, { shortcuts: base })
    ).toEqual({ type: "toggle-canvas-flip-h" });
    expect(
      resolveStudioDrawingShortcut({ code: "KeyF", key: "f" }, { shortcuts: base })
    ).toBeNull();
    expect(
      resolveStudioDrawingShortcut({ code: "Backquote", key: "`" }, { shortcuts: base })
    ).toEqual({ type: "toggle-chrome" });

    // Remap pen away from B → K; default B must not fire.
    const remapped = { ...base, "tool-pen": "K" };
    expect(
      resolveStudioDrawingShortcut({ code: "KeyK", key: "k" }, { shortcuts: remapped })
    ).toEqual({ type: "select-pen" });
    expect(
      resolveStudioDrawingShortcut({ code: "KeyB", key: "b" }, { shortcuts: remapped })
    ).toBeNull();

    // Unbound eraser: hard-code E must not fire.
    const unbound = { ...base, "tool-eraser": "" };
    expect(
      resolveStudioDrawingShortcut({ code: "KeyE", key: "e" }, { shortcuts: unbound })
    ).toBeNull();

    // Brush size still on defaults: Shift±5 hard-code variants remain.
    expect(
      resolveStudioDrawingShortcut({ code: "BracketLeft", shiftKey: true }, { shortcuts: base })
    ).toEqual({ type: "adjust-width", delta: -5 });

    // Brush remapped: old bracket hard-code suppressed; new chord works.
    const brushRemap = { ...base, "brush-smaller": "Q", "brush-larger": "W" };
    expect(
      resolveStudioDrawingShortcut({ code: "KeyQ", key: "q" }, { shortcuts: brushRemap })
    ).toEqual({ type: "adjust-width", delta: -1 });
    expect(
      resolveStudioDrawingShortcut({ code: "BracketLeft" }, { shortcuts: brushRemap })
    ).toBeNull();
    // Opacity (not customizable) still uses Alt+bracket.
    expect(
      resolveStudioDrawingShortcut({ code: "BracketLeft", altKey: true }, { shortcuts: brushRemap })
    ).toEqual({ type: "adjust-opacity", delta: -0.05 });

    // Partial map: only remapped pen is owned; eraser hard-code still works.
    expect(
      resolveStudioDrawingShortcut({ code: "KeyE", key: "e" }, { shortcuts: { "tool-pen": "K" } })
    ).toEqual({ type: "select-eraser" });
  });
});

describe("드로잉 단축키 수치 조절", () => {
  it("브러시 크기를 허용 범위로 clamp하고 비정상 입력도 정규화한다", () => {
    // 상한은 BRUSH_STROKE_WIDTH_RANGE[1](=80) — UI 슬라이더와 동일 계약.
    expect(adjustStudioBrushWidth(1, -5)).toBe(1);
    expect(adjustStudioBrushWidth(80, 5)).toBe(80);
    expect(adjustStudioBrushWidth(Number.NaN, 5)).toBe(6);
  });

  it("불투명도를 0.05~1로 clamp하고 소수 오차를 누적하지 않는다", () => {
    expect(adjustStudioBrushOpacity(0.05, -0.05)).toBe(0.05);
    expect(adjustStudioBrushOpacity(0.1, -0.05)).toBe(0.05);
    expect(adjustStudioBrushOpacity(1, 0.05)).toBe(1);
    expect(adjustStudioBrushOpacity(0.7, 0.05)).toBe(0.75);
    expect(adjustStudioBrushOpacity(0.7, -0.05)).toBe(0.65);
  });
});
