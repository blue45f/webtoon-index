// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  requestStudioInspectorFocus,
  resetStudioInspectorFocusForTest,
  studioInspectorFocusTokenFor,
} from "./studio-inspector-focus";
import { StudioInspectorSection } from "./StudioInspectorSection";

beforeEach(() => {
  resetStudioInspectorFocusForTest();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  resetStudioInspectorFocusForTest();
  vi.unstubAllGlobals();
});

describe("StudioInspectorSection focus navigation", () => {
  it("opens, reveals and focuses a collapsed section requested by search", async () => {
    render(
      <StudioInspectorSection sectionId="element.typography">
        <label>
          글꼴
          <input />
        </label>
      </StudioInspectorSection>,
    );

    const header = screen.getByRole("button", { name: "글꼴" });
    expect(header.getAttribute("aria-expanded")).toBe("false");

    act(() => requestStudioInspectorFocus("element.typography"));

    await waitFor(() => {
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(header);
    });
    expect(screen.getByLabelText("글꼴")).not.toBeNull();
    expect(
      header.closest("section")?.getAttribute("data-inspector-section-highlighted"),
    ).toBe("true");
    expect(studioInspectorFocusTokenFor("element.typography")).toBe(0);
  });

  it("keeps a request pending until its target mounts, then consumes it", async () => {
    act(() => requestStudioInspectorFocus("element.typography"));
    expect(studioInspectorFocusTokenFor("element.typography")).toBeGreaterThan(0);

    render(
      <StudioInspectorSection sectionId="element.typography">
        <label>
          글꼴
          <input />
        </label>
      </StudioInspectorSection>,
    );

    const header = screen.getByRole("button", { name: "글꼴" });
    await waitFor(() => {
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(header);
    });
    expect(studioInspectorFocusTokenFor("element.typography")).toBe(0);
  });

  it("does not replay a consumed request after the target remounts", async () => {
    const firstMount = render(
      <StudioInspectorSection sectionId="element.typography">
        <span>첫 마운트</span>
      </StudioInspectorSection>,
    );

    act(() => requestStudioInspectorFocus("element.typography"));
    const firstHeader = screen.getByRole("button", { name: "글꼴" });
    await waitFor(() => expect(document.activeElement).toBe(firstHeader));
    expect(studioInspectorFocusTokenFor("element.typography")).toBe(0);
    firstMount.unmount();

    const outside = document.createElement("button");
    outside.textContent = "캔버스 작업 계속";
    document.body.append(outside);
    outside.focus();

    render(
      <StudioInspectorSection sectionId="element.typography">
        <span>다시 마운트</span>
      </StudioInspectorSection>,
    );

    const remountedHeader = screen.getByRole("button", { name: "글꼴" });
    expect(remountedHeader.getAttribute("aria-expanded")).toBe("false");
    expect(
      remountedHeader.closest("section")?.getAttribute("data-inspector-section-highlighted"),
    ).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
