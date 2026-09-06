// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioFloatingToolPopover } from "./studio-chrome-ui";

afterEach(() => {
  cleanup();
});

describe("StudioFloatingToolPopover portal contract", () => {
  it("keeps the open popover outside its toolbar owner and removes it when closed", () => {
    const view = render(
      <div data-toolbar-owner="true">
        <StudioFloatingToolPopover id="asset-group" open>
          <button type="button">에셋 적용</button>
        </StudioFloatingToolPopover>
      </div>
    );

    const owner = view.container.querySelector("[data-toolbar-owner]");
    const popover = document.body.querySelector(
      '[data-studio-tool-popover="asset-group"]'
    );

    expect(owner).not.toBeNull();
    expect(popover).not.toBeNull();
    expect(popover?.parentElement).toBe(document.body);
    expect(owner?.contains(popover)).toBe(false);
    expect(popover?.getAttribute("role")).toBe("dialog");
    expect(popover?.getAttribute("aria-modal")).toBe("false");
    expect(popover?.textContent).toContain("에셋 적용");

    view.rerender(
      <div data-toolbar-owner="true">
        <StudioFloatingToolPopover id="asset-group" open={false}>
          <button type="button">에셋 적용</button>
        </StudioFloatingToolPopover>
      </div>
    );

    expect(
      document.body.querySelector('[data-studio-tool-popover="asset-group"]')
    ).toBeNull();
  });
});
