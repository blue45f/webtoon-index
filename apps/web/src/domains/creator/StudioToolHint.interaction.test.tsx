// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_TOOL_HINT_SCROLL_HOVER_SUPPRESSION_MS,
  StudioToolHintPreferencesProvider,
  StudioToolHintTarget,
} from "./StudioToolHint";

function renderHint(id: string, touchHoldDelayMs = 480) {
  return render(
    <StudioToolHintPreferencesProvider
      mode="compact"
      touchHoldDelayMs={touchHoldDelayMs}
      reduceMotion
    >
      <StudioToolHintTarget
        hint={{ id, title: `도구 ${id}`, description: `${id} 동작을 설명합니다.` }}
      >
        <button type="button">{id}</button>
      </StudioToolHintTarget>
    </StudioToolHintPreferencesProvider>
  );
}

function renderHintPair(mode: "compact" | "rich" = "compact") {
  return render(
    <StudioToolHintPreferencesProvider
      mode={mode}
      touchHoldDelayMs={480}
      reduceMotion
    >
      <StudioToolHintTarget
        hint={{ id: "pen", title: "펜", description: "선을 그립니다." }}
      >
        <button type="button">펜</button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        hint={{ id: "eraser", title: "지우개", description: "선을 지웁니다." }}
      >
        <button type="button">지우개</button>
      </StudioToolHintTarget>
    </StudioToolHintPreferencesProvider>
  );
}

function RemountingBrushHint() {
  const [selected, setSelected] = useState(false);
  return (
    <StudioToolHintPreferencesProvider
      mode="compact"
      touchHoldDelayMs={480}
      reduceMotion
    >
      <StudioToolHintTarget
        key={selected ? "selected" : "idle"}
        hint={{ id: "brush/ink", title: "잉크 펜", description: "잉크 선을 그립니다." }}
      >
        <button type="button" onClick={() => setSelected(true)}>
          {selected ? "선택된 잉크 펜" : "잉크 펜 선택"}
        </button>
      </StudioToolHintTarget>
    </StudioToolHintPreferencesProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("StudioToolHint touch intent", () => {
  it("exposes one disabled button and opens its unavailable help from a non-interactive focus proxy", async () => {
    render(
      <StudioToolHintPreferencesProvider
        mode="compact"
        touchHoldDelayMs={480}
        reduceMotion
      >
        <StudioToolHintTarget
          disabled
          unavailableReason="먼저 편집할 레이어를 선택하세요."
          hint={{ id: "locked-fill", title: "채우기", description: "닫힌 영역을 채웁니다." }}
        >
          <button type="button" disabled>채우기</button>
        </StudioToolHintTarget>
      </StudioToolHintPreferencesProvider>
    );

    const disabledButton = screen.getByRole("button", { name: "채우기" });
    const helpTarget = screen.getByRole("group", { name: "채우기" });

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect((disabledButton as HTMLButtonElement).disabled).toBe(true);
    expect(disabledButton.getAttribute("aria-disabled")).toBe("true");
    expect(helpTarget.getAttribute("tabindex")).toBe("0");

    fireEvent.focus(helpTarget);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("닫힌 영역을 채웁니다.");
    expect(tooltip.textContent).toContain("먼저 편집할 레이어를 선택하세요.");
    expect(helpTarget.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("cancels a pending long-press when a touch becomes a drag", () => {
    vi.useFakeTimers();
    renderHint("크기", 480);
    const target = screen.getByRole("button", { name: "크기" });

    fireEvent.pointerDown(target, {
      pointerId: 7,
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(target, {
      pointerId: 7,
      pointerType: "touch",
      clientX: 36,
      clientY: 20,
    });
    act(() => vi.advanceTimersByTime(600));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not let an older hover delay replace a newly focused hint", () => {
    vi.useFakeTimers();
    renderHintPair();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "펜" }));
    fireEvent.focus(screen.getByRole("button", { name: "지우개" }));

    expect(screen.getByRole("tooltip").textContent).toContain("선을 지웁니다.");
    act(() => vi.advanceTimersByTime(320));

    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip").textContent).toContain("선을 지웁니다.");
    expect(screen.queryByText("선을 그립니다.")).toBeNull();
  });

  it("keeps a stationary touch eligible for long-press help", () => {
    vi.useFakeTimers();
    renderHint("불투명도", 480);
    const target = screen.getByRole("button", { name: "불투명도" });

    fireEvent.pointerDown(target, {
      pointerId: 11,
      pointerType: "touch",
      clientX: 24,
      clientY: 18,
    });
    act(() => vi.advanceTimersByTime(480));

    expect(screen.getByRole("tooltip").textContent).toContain("불투명도 동작을 설명합니다.");
  });

  it("clears global pointer suppression when its provider unmounts", () => {
    vi.useFakeTimers();
    const first = renderHint("첫 도구");
    fireEvent.pointerDown(screen.getByRole("button", { name: "첫 도구" }), {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 12,
      clientY: 12,
    });
    first.unmount();

    renderHint("다음 도구");
    fireEvent.mouseEnter(screen.getByRole("button", { name: "다음 도구" }));
    act(() => vi.advanceTimersByTime(280));

    expect(screen.getByRole("tooltip").textContent).toContain("다음 도구 동작을 설명합니다.");
  });

  it("does not automatically repeat the same tooltip after it was shown", () => {
    vi.useFakeTimers();
    renderHint("잉크 펜");
    const target = screen.getByRole("button", { name: "잉크 펜" });

    fireEvent.mouseEnter(target);
    act(() => vi.advanceTimersByTime(280));
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(target, { clientX: 500, clientY: 500 });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(target);
    act(() => vi.advanceTimersByTime(320));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps another tool discoverable while the previous tool is cooling down", () => {
    vi.useFakeTimers();
    renderHintPair();
    const pen = screen.getByRole("button", { name: "펜" });
    const eraser = screen.getByRole("button", { name: "지우개" });

    fireEvent.mouseEnter(pen);
    act(() => vi.advanceTimersByTime(280));
    fireEvent.mouseLeave(pen, { clientX: 500, clientY: 500 });
    act(() => vi.advanceTimersByTime(300));

    fireEvent.mouseEnter(eraser);
    act(() => vi.advanceTimersByTime(280));
    expect(screen.getByRole("tooltip").textContent).toContain("선을 지웁니다.");
  });

  it("lets keyboard focus explicitly reopen help during a hover cooldown", () => {
    vi.useFakeTimers();
    renderHint("연필");
    const target = screen.getByRole("button", { name: "연필" });

    fireEvent.mouseEnter(target);
    act(() => vi.advanceTimersByTime(280));
    fireEvent.mouseLeave(target, { clientX: 500, clientY: 500 });
    act(() => vi.advanceTimersByTime(300));

    fireEvent.focus(target);
    expect(screen.getByRole("tooltip").textContent).toContain("연필 동작을 설명합니다.");
  });

  it("does not reopen a selected brush coach when its control remounts under the pointer", () => {
    vi.useFakeTimers();
    render(<RemountingBrushHint />);
    const initialTarget = screen.getByRole("button", { name: "잉크 펜 선택" });

    fireEvent.pointerDown(initialTarget, {
      pointerId: 9,
      pointerType: "mouse",
      clientX: 24,
      clientY: 24,
    });
    fireEvent.click(initialTarget, { clientX: 24, clientY: 24 });
    const selectedTarget = screen.getByRole("button", { name: "선택된 잉크 펜" });

    fireEvent.pointerMove(window, {
      pointerId: 9,
      pointerType: "mouse",
      clientX: 48,
      clientY: 24,
    });
    fireEvent.mouseEnter(selectedTarget);
    act(() => vi.advanceTimersByTime(320));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes passive hover help on wheel and suppresses remount-under-pointer noise briefly", () => {
    vi.useFakeTimers();
    renderHintPair();
    const pen = screen.getByRole("button", { name: "펜" });
    const eraser = screen.getByRole("button", { name: "지우개" });

    fireEvent.mouseEnter(pen);
    act(() => vi.advanceTimersByTime(280));
    expect(screen.getByRole("tooltip").textContent).toContain("선을 그립니다.");

    fireEvent.wheel(window);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(eraser);
    act(() => vi.advanceTimersByTime(320));
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() =>
      vi.advanceTimersByTime(STUDIO_TOOL_HINT_SCROLL_HOVER_SUPPRESSION_MS + 1)
    );
    fireEvent.mouseLeave(eraser, { clientX: 500, clientY: 500 });
    fireEvent.mouseEnter(eraser);
    act(() => vi.advanceTimersByTime(280));

    expect(screen.getByRole("tooltip").textContent).toContain("선을 지웁니다.");
  });

  it("keeps deliberate keyboard help open while scroll suppresses passive replacement", () => {
    vi.useFakeTimers();
    renderHintPair("rich");
    const pen = screen.getByRole("button", { name: "펜" });
    const eraser = screen.getByRole("button", { name: "지우개" });

    fireEvent.focus(pen);
    const focusedTooltip = screen.getByRole("tooltip");
    expect(focusedTooltip.textContent).toContain("선을 그립니다.");

    fireEvent.scroll(window);
    expect(screen.getByRole("tooltip").textContent).toContain("선을 그립니다.");

    fireEvent.mouseEnter(eraser);
    act(() => vi.advanceTimersByTime(320));
    expect(screen.getByRole("tooltip").textContent).toContain("선을 그립니다.");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("treats touch movement as a pan and suppresses the hover that follows it", () => {
    vi.useFakeTimers();
    renderHintPair();
    const pen = screen.getByRole("button", { name: "펜" });
    const eraser = screen.getByRole("button", { name: "지우개" });

    fireEvent.pointerDown(pen, {
      pointerId: 21,
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(window, {
      pointerId: 21,
      pointerType: "touch",
      clientX: 32,
      clientY: 20,
    });
    fireEvent.pointerUp(window, {
      pointerId: 21,
      pointerType: "touch",
      clientX: 32,
      clientY: 20,
    });

    fireEvent.mouseEnter(eraser);
    act(() => vi.advanceTimersByTime(320));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps touch long-press help compact even when rich previews are enabled", () => {
    vi.useFakeTimers();
    renderHintPair("rich");
    const pen = screen.getByRole("button", { name: "펜" });

    fireEvent.pointerDown(pen, {
      pointerId: 31,
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    act(() => vi.advanceTimersByTime(480));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.getAttribute("data-studio-tool-hint-expanded")).toBe("false");
    expect(tooltip.textContent).not.toContain("동작 미리보기");
    expect(tooltip.textContent).not.toContain("잠시 머물러 미리보기");

    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
