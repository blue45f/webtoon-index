// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioColorPopover } from "./StudioColorPopover";

class FakeEyeDropper {
  open = vi.fn(async () => ({ sRGBHex: "#abcdef" }));
}

beforeEach(() => {
  Object.defineProperty(window, "EyeDropper", {
    configurable: true,
    value: FakeEyeDropper,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "EyeDropper");
  vi.restoreAllMocks();
});

describe("StudioColorPopover", () => {
  it("uses rich hints only for explanatory controls and keeps swatches native-title free", async () => {
    const onChange = vi.fn();
    render(
      <StudioColorPopover
        value="#123456"
        onChange={onChange}
        recentColors={["#123456", "#654321"]}
        label="브러시·도형 색상"
        purpose="brush-shape"
      />
    );

    const trigger = screen.getByRole("button", { name: "브러시·도형 색상" });
    expect(trigger.hasAttribute("title")).toBe(false);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.closest('[data-studio-tool-hint-target="true"]')).not.toBeNull();

    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "브러시·도형 색상 선택" });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector("[title]")).toBeNull();
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);

    const recentCurrent = screen.getByRole("radio", { name: "최근 색상 #123456 선택" });
    expect(recentCurrent.getAttribute("aria-checked")).toBe("true");
    expect(recentCurrent.closest('[data-studio-tool-hint-target="true"]')).toBeNull();

    const recentOther = screen.getByRole("radio", { name: "최근 색상 #654321 선택" });
    fireEvent.click(recentOther);
    expect(onChange).toHaveBeenCalledWith("#654321");

    const eyedropper = screen.getByRole("button", { name: "화면 전체에서 색 가져오기" });
    expect(eyedropper.closest('[data-studio-tool-hint-target="true"]')).not.toBeNull();
    expect(eyedropper.hasAttribute("title")).toBe(false);

    const paletteFamily = await screen.findByRole("button", { name: "피부톤" });
    expect(paletteFamily.closest('[data-studio-tool-hint-target="true"]')).not.toBeNull();
    expect(paletteFamily.hasAttribute("title")).toBe(false);

    const hairPaletteFamily = screen.getByRole("button", { name: "헤어 내추럴" });
    fireEvent.click(hairPaletteFamily);
    await waitFor(() => expect(hairPaletteFamily.getAttribute("aria-pressed")).toBe("true"));

    const paletteSwatch = await screen.findByRole("radio", {
      name: "헤어 내추럴 색상 #1b1b22 선택",
    });
    expect(paletteSwatch.closest('[data-studio-tool-hint-target="true"]')).toBeNull();
    expect(paletteSwatch.hasAttribute("title")).toBe(false);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "헥스 색상 코드" }));
    });
  });

  it("keeps the authored-canvas eyedropper available without browser EyeDropper support", async () => {
    Reflect.deleteProperty(window, "EyeDropper");
    const onRequestCanvasEyedropper = vi.fn();
    render(
      <StudioColorPopover
        value="#123456"
        onChange={vi.fn()}
        recentColors={[]}
        onRequestCanvasEyedropper={onRequestCanvasEyedropper}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "색상 선택" }));
    const canvasPicker = await screen.findByRole("button", { name: "캔버스에서 정밀 색 가져오기" });
    expect(canvasPicker.getAttribute("aria-keyshortcuts")).toBe("I");
    expect(screen.queryByRole("button", { name: "화면 전체에서 색 가져오기" })).toBeNull();
    fireEvent.click(canvasPicker);
    expect(onRequestCanvasEyedropper).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "색상 선택 선택" })).toBeNull();
  });

  it("closes with Escape and restores focus to the color trigger", async () => {
    render(
      <StudioColorPopover
        value="#123456"
        onChange={vi.fn()}
        recentColors={[]}
        label="말풍선 색상"
        purpose="bubble-fill"
      />
    );

    const trigger = screen.getByRole("button", { name: "말풍선 색상" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "말풍선 색상 선택" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "말풍선 색상 선택" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // Focusing the hinted trigger starts a best-effort chunk preload. Drain that request and any
    // nested preview imports before Vitest tears down its module environment.
    await vi.dynamicImportSettled();
  });

  it("keeps the portaled popup inside a short mobile viewport and dismisses outside", async () => {
    const widthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const heightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 340,
    });

    try {
      render(
        <>
          <StudioColorPopover
            value="#123456"
            onChange={vi.fn()}
            recentColors={[]}
            label="모바일 색상"
          />
          <button type="button">바깥</button>
        </>
      );

      const trigger = screen.getByRole("button", { name: "모바일 색상" });
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        bottom: 820,
        height: 44,
        left: 342,
        right: 386,
        top: 776,
        width: 44,
        x: 342,
        y: 776,
        toJSON: () => ({}),
      });

      fireEvent.click(trigger);
      const dialog = await screen.findByRole("dialog", { name: "모바일 색상 선택" });
      await waitFor(() => expect(dialog.style.visibility).toBe("visible"));

      const left = Number.parseFloat(dialog.style.left);
      const top = Number.parseFloat(dialog.style.top);
      const width = Number.parseFloat(dialog.style.width);
      const maxHeight = Number.parseFloat(dialog.style.maxHeight);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(left + width).toBeLessThanOrEqual(382);
      expect(top + maxHeight).toBeLessThanOrEqual(836);

      fireEvent.pointerDown(screen.getByRole("button", { name: "바깥" }));
      expect(screen.queryByRole("dialog", { name: "모바일 색상 선택" })).toBeNull();
    } finally {
      if (widthDescriptor) Object.defineProperty(window, "innerWidth", widthDescriptor);
      if (heightDescriptor) Object.defineProperty(window, "innerHeight", heightDescriptor);
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
      }
    }
  });
});
