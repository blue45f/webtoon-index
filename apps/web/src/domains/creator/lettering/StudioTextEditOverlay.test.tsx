// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bubbleVerticalPadding } from "./studio-bubble-text-fit";
import StudioTextEditOverlay, { StudioTextEditFallbackModal } from "./StudioTextEditOverlay";

import type { El } from "../studio-element-model";
import type Konva from "konva";

/**
 * 이 파일이 지키는 계약(2026-08 브라우저 감사에서 실측된 두 결함).
 *
 * D2 — 타이핑 중 무음 절단: Konva.Text 는 고정 height 를 넘는 줄을 경고 없이 버린다. 예전
 *      applyLiveValue 는 autoShrinkText 가 켜졌을 때만 상자를 다시 계산해, 기본(꺼짐) 모드에서는
 *      첫 상자 크기 그대로 굳었다 — 103자 대사에서 49자가 조용히 사라졌다.
 * D7 — 폴백 모달 IME: 한글 조합 중 Escape 가 "조합 취소"가 아니라 모달 닫기로 흘러가 입력이
 *      전부 소실됐다. 인라인 오버레이에는 있던 가드가 폴백 모달에는 없었다.
 */

/** applyLiveValue 가 실제로 만지는 Konva.Text 표면만 흉내 낸 최소 스텁. */
function fakeTextNode(initial: {
  text: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  width: number;
  height: number;
  x: number;
  y: number;
}) {
  const state = { ...initial };
  const accessor = <K extends keyof typeof state>(key: K) =>
    ((value?: (typeof state)[K]) => {
      if (value === undefined) return state[key];
      state[key] = value;
      return undefined;
    }) as unknown as () => (typeof state)[K];
  const node = {
    state,
    batchDraws: 0,
    text: accessor("text"),
    fontSize: accessor("fontSize"),
    lineHeight: accessor("lineHeight"),
    letterSpacing: accessor("letterSpacing"),
    width: accessor("width"),
    height: accessor("height"),
    x: accessor("x"),
    y: accessor("y"),
    fontFamily: () => "Pretendard, sans-serif",
    fontStyle: () => "bold",
    align: () => "center",
    fill: () => "#111111",
    getAbsoluteTransform: () => ({ getMatrix: () => [1, 0, 0, 1, 0, 0] }),
    getLayer: () => ({ batchDraw: () => { node.batchDraws += 1; } }),
  };
  return node;
}

function bubbleEl(overrides: Partial<Extract<El, { type: "bubble" }>> = {}): El {
  return {
    align: "center",
    fill: "#ffffff",
    fontSize: 24,
    height: 240,
    id: "bubble-1",
    rotation: 0,
    text: "짧은 대사",
    textFill: "#111111",
    type: "bubble",
    variant: "speech",
    width: 300,
    x: 0,
    y: 0,
    ...overrides,
  } as El;
}

beforeEach(() => {
  // jsdom 은 2D 컨텍스트가 없어 측정기가 근사로 폴백한다. 결정적 비교를 위해 전각 폭을 흉내 낸다.
  const context = {
    font: "",
    measureText: (value: string) => ({ width: [...value].length * 24 }),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => (contextId === "2d" ? context : null)) as
      typeof HTMLCanvasElement.prototype.getContext
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioTextEditOverlay live bubble sizing", () => {
  function renderOverlay(el: El, node: ReturnType<typeof fakeTextNode>) {
    const onCommit = vi.fn();
    const group = { findOne: () => node as unknown as Konva.Text };
    render(
      <StudioTextEditOverlay
        elementId={el.id}
        elementById={new Map([[el.id, el]])}
        nodeRefsRef={{ current: { [el.id]: group as unknown as Konva.Node } }}
        effScale={1}
        stageOriginOffsetX={0}
        stageOriginOffsetY={0}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    return { onCommit };
  }

  it("grows the paint box while typing so a 103-char line keeps every character", () => {
    const el = bubbleEl();
    const padding = bubbleVerticalPadding(24);
    const boxHeight = 240 - padding.top - padding.bottom;
    const node = fakeTextNode({
      text: "짧은 대사",
      fontSize: 24,
      lineHeight: 1.35,
      letterSpacing: 0.3,
      width: 300 - 14 * 2,
      height: boxHeight,
      x: 14,
      y: padding.top,
    });
    renderOverlay(el, node);

    const long = "가".repeat(103);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: long } });

    expect(node.state.text).toBe(long);
    // 한 줄에 들어가는 글자 수 × 줄 수가 상자 높이를 훌쩍 넘는 입력 — 페인트 상자가 커져야 한다.
    expect(node.state.height).toBeGreaterThan(boxHeight);
    // 필요한 줄 수 전체를 담을 만큼(줄 수 × fontSize × lineHeight 이상).
    const charsPerLine = Math.floor(node.state.width / 24);
    const neededLines = Math.ceil(103 / charsPerLine);
    expect(neededLines).toBe(10);
    // 부동소수 결합 순서 차이만큼의 여유(1e-6)를 두고 "필요한 줄 수를 전부 담는다"를 확인한다.
    expect(node.state.height + 1e-6).toBeGreaterThanOrEqual(neededLines * 24 * 1.35);
    // 넓힌 만큼 y 를 위로 되돌려 시각 중심은 유지한다.
    expect(node.state.y).toBeCloseTo(padding.top - (node.state.height - boxHeight) / 2);
    expect(node.batchDraws).toBeGreaterThan(0);
  });

  it("keeps the paint box untouched when the typed line still fits", () => {
    const el = bubbleEl();
    const padding = bubbleVerticalPadding(24);
    const boxHeight = 240 - padding.top - padding.bottom;
    const node = fakeTextNode({
      text: "짧은 대사",
      fontSize: 24,
      lineHeight: 1.35,
      letterSpacing: 0.3,
      width: 300 - 14 * 2,
      height: boxHeight,
      x: 14,
      y: padding.top,
    });
    renderOverlay(el, node);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "여전히 짧다" } });

    expect(node.state.height).toBe(boxHeight);
    expect(node.state.y).toBe(padding.top);
  });

  it("shrinks the font instead of the box when 크기 고정(autoShrinkText) is on", () => {
    const el = bubbleEl({ autoShrinkText: true, autoShrinkMinFontSize: 10 });
    const padding = bubbleVerticalPadding(24);
    const boxHeight = 240 - padding.top - padding.bottom;
    const node = fakeTextNode({
      text: "짧은 대사",
      fontSize: 24,
      lineHeight: 1.35,
      letterSpacing: 0.3,
      width: 300 - 14 * 2,
      height: boxHeight,
      x: 14,
      y: padding.top,
    });
    renderOverlay(el, node);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "가".repeat(103) } });

    expect(node.state.fontSize).toBeLessThan(24);
    // "크기 고정"은 상자를 넘기지 않겠다는 모드라 페인트 상자를 넓히지 않는다.
    expect(node.state.height).toBeLessThanOrEqual(240);
  });
});

describe("StudioTextEditFallbackModal IME guard", () => {
  function renderModal() {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const el = bubbleEl({ vertical: true, text: "안녕" });
    render(
      <StudioTextEditFallbackModal
        elementId={el.id}
        elementById={new Map([[el.id, el]])}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    return { onCancel, onCommit, textarea: screen.getByRole("textbox") };
  }

  it("does not cancel while a Korean IME composition is in flight", () => {
    const { onCancel, textarea } = renderModal();
    fireEvent.keyDown(textarea, { key: "Escape", isComposing: true });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not cancel on the WebKit legacy 229 confirmation keydown", () => {
    const { onCancel, textarea } = renderModal();
    fireEvent.keyDown(textarea, { key: "Escape", keyCode: 229 });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("still cancels and commits on plain keys", () => {
    const { onCancel, onCommit, textarea } = renderModal();
    fireEvent.change(textarea, { target: { value: "고친 대사" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onCommit).toHaveBeenCalledWith("고친 대사");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
