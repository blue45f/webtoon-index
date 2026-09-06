// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { attachStudioDismissableSurface } from "./studio-dismissable-surface";

function mount(): { launcher: HTMLButtonElement; outside: HTMLDivElement; surface: HTMLDivElement } {
  document.body.innerHTML = "";
  const surface = document.createElement("div");
  const inner = document.createElement("button");
  surface.append(inner);
  const launcher = document.createElement("button");
  const outside = document.createElement("div");
  document.body.append(surface, launcher, outside);
  return { launcher, outside, surface };
}

function pointerDown(target: Element): void {
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("attachStudioDismissableSurface", () => {
  it("dismisses on Escape and on a pointer press outside the surface", () => {
    const { outside, surface } = mount();
    const onDismiss = vi.fn();
    const detach = attachStudioDismissableSurface({ onDismiss, surface });

    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    pointerDown(outside);
    expect(onDismiss).toHaveBeenCalledTimes(2);

    detach();
  });

  it("keeps presses inside the surface, and on the ignored launcher, from dismissing", () => {
    const { launcher, surface } = mount();
    const onDismiss = vi.fn();
    const detach = attachStudioDismissableSurface({
      ignore: [launcher],
      onDismiss,
      surface,
    });

    pointerDown(surface.querySelector("button")!);
    pointerDown(surface);
    pointerDown(launcher);
    expect(onDismiss).not.toHaveBeenCalled();

    detach();
  });

  it("leaves Escape to a nested modal and stops listening after detach", () => {
    const { outside, surface } = mount();
    const onDismiss = vi.fn();
    const detach = attachStudioDismissableSurface({ onDismiss, surface });

    const nested = document.createElement("div");
    nested.setAttribute("aria-modal", "true");
    const nestedControl = document.createElement("button");
    nested.append(nestedControl);
    document.body.append(nested);
    nestedControl.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(onDismiss).not.toHaveBeenCalled();

    detach();
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    pointerDown(outside);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
