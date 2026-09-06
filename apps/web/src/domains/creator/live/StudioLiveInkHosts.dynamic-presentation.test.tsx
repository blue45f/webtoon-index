// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioLiveDynamicBrushOverlayHost } from "./StudioLiveInkHosts";

import type { StudioLiveDynamicBrushOverlayRenderer } from "./studio-live-dynamic-brush-overlay";

afterEach(cleanup);

describe("StudioLiveDynamicBrushOverlayHost presentation surfaces", () => {
  it("keeps full-opacity coverage hidden and exposes a separate Canvas2D presentation surface", () => {
    const attach = vi.fn();
    const setSurface = vi.fn();
    const renderer = {
      attach,
      setSurface,
    } as unknown as StudioLiveDynamicBrushOverlayRenderer;
    const view = render(
      <StudioLiveDynamicBrushOverlayHost
        renderer={renderer}
        left={4}
        top={8}
        width={900}
        height={1_200}
        documentScale={1.5}
        documentWidth={900}
        flipX={false}
      />,
    );

    const coverage = view.container.querySelector<HTMLCanvasElement>(
      '[data-studio-live-dynamic-coverage="true"]',
    );
    const presentation = view.container.querySelector<HTMLCanvasElement>(
      '[data-studio-live-dynamic-active="true"]',
    );
    const settled = view.container.querySelector<HTMLCanvasElement>(
      '[data-studio-live-dynamic-settled="true"]',
    );
    expect(coverage).not.toBeNull();
    expect(coverage?.classList.contains("hidden")).toBe(true);
    expect(presentation).not.toBeNull();
    expect(presentation?.classList.contains("hidden")).toBe(false);
    expect(presentation?.style.opacity).toBe("");
    expect(attach).toHaveBeenCalledWith({
      activeCanvas: coverage,
      presentationCanvas: presentation,
      settledCanvas: settled,
    });
    expect(setSurface).toHaveBeenCalledWith({
      left: 4,
      top: 8,
      width: 900,
      height: 1_200,
      documentScale: 1.5,
      documentWidth: 900,
      flipX: false,
    });

    view.unmount();
    expect(attach).toHaveBeenLastCalledWith(null);
  });
});
