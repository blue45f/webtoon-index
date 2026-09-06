// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioLiveWetInkOverlayHost } from "./StudioLiveInkHosts";

import type { StudioLiveWetInkOverlayRenderer } from "./studio-live-wet-ink-overlay";

describe("StudioLiveWetInkOverlayHost capability gate", () => {
  it("mounts native canvases so InkWash can paint without a GPU receipt", () => {
    const attach = vi.fn();
    const setSurface = vi.fn();
    const renderer = { attach, setSurface } as unknown as StudioLiveWetInkOverlayRenderer;
    const view = render(
      <StudioLiveWetInkOverlayHost
        renderer={renderer}
        left={0}
        top={0}
        width={900}
        height={1_200}
        documentScale={1}
        documentWidth={900}
        flipX={false}
      />,
    );

    expect(view.container.querySelector(
      '[data-studio-live-wet-ink-active="true"]',
    )).not.toBeNull();
    expect(view.container.querySelector(
      '[data-studio-live-wet-ink-settled="true"]',
    )).not.toBeNull();
    expect(attach).toHaveBeenCalledWith({
      activeCanvas: expect.any(HTMLCanvasElement),
      settledCanvas: expect.any(HTMLCanvasElement),
    });
    expect(setSurface).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      width: 900,
      height: 1_200,
      documentScale: 1,
      documentWidth: 900,
      flipX: false,
    });
  });
});
