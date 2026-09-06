// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MARKETPLACE_BRUSH_SNAPSHOT_REQUEST_EVENT,
  MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT,
} from "./MarketplaceBrushPublishShortcut";
import { MarketplaceBrushStudioBridge } from "./MarketplaceBrushStudioBridge";

beforeEach(() => {
  window.history.replaceState(null, "", "/studio?workspace=brush-studio");
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function requestSnapshot(requestId: string): Promise<unknown> {
  return new Promise((resolve) => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ requestId: string; snapshot: unknown }>).detail;
      if (detail.requestId !== requestId) return;
      window.removeEventListener(MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT, listener);
      resolve(detail.snapshot);
    };
    window.addEventListener(MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT, listener);
    window.dispatchEvent(new CustomEvent(MARKETPLACE_BRUSH_SNAPSHOT_REQUEST_EVENT, {
      detail: { requestId },
    }));
  });
}

describe("MarketplaceBrushStudioBridge", () => {
  it("keeps the publishing shortcut hidden while Brush Studio is closed", () => {
    render(<MarketplaceBrushStudioBridge snapshot={{ name: "Ink" }} visible={false} />);
    expect(screen.queryByTestId("brush-studio-marketplace-shortcut")).toBeNull();
  });

  it("publishes the exact latest normalized Brush Studio snapshot", async () => {
    const first = {
      name: "Layered pencil",
      enginePrograms: [{ id: "pencil", kind: "dry-media" }],
      brushDynamics: { pressure: 0.8 },
    };
    const view = render(<MarketplaceBrushStudioBridge snapshot={first} visible />);
    expect(screen.getByTestId("brush-studio-marketplace-shortcut")).toBeTruthy();

    let captured: unknown;
    await act(async () => {
      captured = await requestSnapshot("first");
    });
    expect(captured).toEqual(first);

    const second = {
      ...first,
      name: "Layered pencil + glow",
      enginePrograms: [
        ...first.enginePrograms,
        { id: "glow", kind: "glow", opacity: 0.4 },
      ],
    };
    view.rerender(<MarketplaceBrushStudioBridge snapshot={second} visible />);

    await act(async () => {
      captured = await requestSnapshot("second");
    });
    expect(captured).toEqual(second);
  });
});
