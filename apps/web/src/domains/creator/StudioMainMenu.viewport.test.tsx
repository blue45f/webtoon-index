// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioMainMenu } from "./StudioMainMenu";

vi.mock("./StudioToolHint", () => ({
  StudioToolHintTarget: ({ children }: { children: import("react").ReactNode }) => <>{children}</>,
}));
vi.mock("./studio-main-menu-intent-preload", () => ({
  preloadStudioMainMenuGroupRuntime: vi.fn(),
}));

let root: Root | null = null;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mountMenu() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<StudioMainMenu groups={[{
      id: "file", label: "파일", items: Array.from({ length: 20 }, (_, index) => ({
        id: `command-${index}`, label: `명령 ${index}`, disabled: index === 19, onSelect: vi.fn(),
      })),
    }]} />);
  });
  const trigger = document.querySelector<HTMLButtonElement>("[data-studio-main-menu-trigger='file']");
  if (!trigger) throw new Error("menu trigger not rendered");
  return trigger;
}

async function press(target: HTMLElement, key: string, isComposing = false) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true, cancelable: true }));
  });
}

async function open(trigger: HTMLButtonElement) {
  await act(async () => { trigger.click(); });
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 1)); });
  const menu = document.querySelector<HTMLElement>("[data-studio-main-menu-panel]");
  if (!menu) throw new Error("menu panel not rendered");
  return menu;
}

describe("StudioMainMenu viewport integration", () => {
  it("opens the last discoverable command with ArrowUp, including disabled commands", async () => {
    const trigger = await mountMenu();
    await press(trigger, "ArrowUp");
    expect(document.activeElement?.getAttribute("data-studio-menu-item-id")).toBe("command-19");
    expect(document.activeElement?.getAttribute("aria-disabled")).toBe("true");
  });

  it("opens the first command with ArrowDown and preserves Home/End navigation", async () => {
    const trigger = await mountMenu();
    await press(trigger, "ArrowDown");
    expect(document.activeElement?.getAttribute("data-studio-menu-item-id")).toBe("command-0");
    await press(document.activeElement as HTMLElement, "End");
    expect(document.activeElement?.getAttribute("data-studio-menu-item-id")).toBe("command-19");
    await press(document.activeElement as HTMLElement, "Home");
    expect(document.activeElement?.getAttribute("data-studio-menu-item-id")).toBe("command-0");
  });

  it("does not open a menu while a Korean/Japanese/Chinese IME is composing", async () => {
    const trigger = await mountMenu();
    await press(trigger, "ArrowDown", true);
    expect(document.querySelector("[data-studio-main-menu-panel]")).toBeNull();
  });

  it("keeps the menu during IME Escape but closes and restores focus for ordinary Escape", async () => {
    const trigger = await mountMenu();
    const menu = await open(trigger);
    await press(menu, "Escape", true);
    expect(document.querySelector("[data-studio-main-menu-panel]")).not.toBeNull();
    await press(menu, "Escape");
    expect(document.querySelector("[data-studio-main-menu-panel]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("applies above-trigger transform and the actual available height", async () => {
    const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 320, height: 300 });
    vi.stubGlobal("visualViewport", viewport);
    const trigger = await mountMenu();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 260, y: 250, left: 260, top: 250, right: 320, bottom: 282, width: 60, height: 32, toJSON: () => ({}),
    });
    const menu = await open(trigger);
    expect(menu.dataset.studioMainMenuSide).toBe("top");
    expect(menu.style.transform).toBe("translateY(-100%)");
    expect(menu.style.maxHeight).toBe("232px");
    expect(menu.style.minWidth).toBe("248px");
    expect(menu.style.maxWidth).toBe("248px");
  });

  it("subscribes to visual viewport changes, coalesces frames and removes listeners", async () => {
    const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 320, height: 300 });
    vi.stubGlobal("visualViewport", viewport);
    const remove = vi.spyOn(viewport, "removeEventListener");
    const trigger = await mountMenu();
    const menu = await open(trigger);
    let pending: FrameRequestCallback | null = null;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pending = callback;
      return 123;
    });
    viewport.height = 160;
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { (pending as FrameRequestCallback | null)?.(0); });
    expect(menu.style.maxHeight).toBe("136px");
    await act(async () => root?.unmount());
    root = null;
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
