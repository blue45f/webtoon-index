// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { placeStudioEyedropperLoupe, studioEyedropperLoupeCrosshair } from "./studio-eyedropper-loupe";
import { createStudioEyedropperPreviewStore } from "./studio-eyedropper-preview-store";
import { StudioEyedropperLoupe, StudioEyedropperLoupeHost } from "./StudioEyedropperLoupe";

const capture = {
  imageData: {
    data: new Uint8ClampedArray(11 * 11 * 4).fill(255),
    width: 11,
    height: 11,
  },
  sampleX: 5,
  sampleY: 5,
  averageRadius: 0,
  plan: {
    x: 0,
    y: 0,
    width: 11,
    height: 11,
    sampleX: 5,
    sampleY: 5,
    averageRadius: 0,
    loupeRadius: 5,
    pixelCount: 121,
  },
};

const sample = {
  hex: "#c04020",
  rgba: [192, 64, 32, 255] as const,
  sampleCount: 1,
  candidateCount: 1,
  averageRadius: 0,
};

beforeEach(() => {
  const context = {
    clearRect: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => (
      contextId === "2d"
        ? context as unknown as CanvasRenderingContext2D
        : null
    )) as typeof HTMLCanvasElement.prototype.getContext
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("placeStudioEyedropperLoupe", () => {
  it("prefers the right side for a mouse and flips left near the viewport edge", () => {
    expect(placeStudioEyedropperLoupe({
      pointer: { clientX: 100, clientY: 200, pointerType: "mouse" },
      viewport: { width: 800, height: 600 },
    })).toMatchObject({ left: 118, side: "right" });
    const nearRight = placeStudioEyedropperLoupe({
      pointer: { clientX: 790, clientY: 200, pointerType: "pen" },
      viewport: { width: 800, height: 600 },
    });
    expect(nearRight.side).toBe("left");
    expect(nearRight.left).toBeGreaterThanOrEqual(8);
  });

  it("places a touch loupe above the finger and keeps it in a small viewport", () => {
    const placement = placeStudioEyedropperLoupe({
      pointer: { clientX: 190, clientY: 600, pointerType: "touch" },
      viewport: { width: 390, height: 700 },
    });
    expect(placement.side).toBe("above");
    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.left + 152).toBeLessThanOrEqual(382);
    expect(placement.top).toBeGreaterThanOrEqual(8);
  });

  it("maps an edge-clipped neighborhood sample to the rendered pixel center", () => {
    expect(studioEyedropperLoupeCrosshair({
      imageWidth: 7,
      imageHeight: 8,
      sampleX: 1,
      sampleY: 2,
      viewSize: 112,
    })).toEqual({ left: 28, top: 35, pixelSize: 14 });
  });
});

describe("StudioEyedropperLoupe", () => {
  it("renders through body portal with neighborhood, sampled/current HEX, and reference context", () => {
    render(<StudioEyedropperLoupe
      open
      pointer={{ clientX: 100, clientY: 100, pointerType: "mouse" }}
      capture={capture}
      sample={sample}
      target="primary"
      currentTargetColor="#123456"
      referenceLabel="현재 레이어"
      layerName="선화"
      viewport={{ width: 800, height: 600 }}
    />);
    const loupe = document.querySelector('[data-studio-eyedropper-loupe="true"]');
    expect(loupe?.parentElement).toBe(document.body);
    expect(loupe?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("#c04020")).toBeTruthy();
    expect(screen.getByText("#123456")).toBeTruthy();
    expect(screen.getByText("현재 레이어 · 선화")).toBeTruthy();
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
  });

  it("does not mount without an open capture", () => {
    const { rerender } = render(<StudioEyedropperLoupe
      open={false}
      pointer={{ clientX: 0, clientY: 0 }}
      capture={capture}
      sample={sample}
      target="secondary"
      currentTargetColor="#123456"
      referenceLabel="표시색"
    />);
    expect(document.querySelector('[data-studio-eyedropper-loupe="true"]')).toBeNull();
    rerender(<StudioEyedropperLoupe
      open
      pointer={{ clientX: 0, clientY: 0 }}
      capture={null}
      sample={null}
      target="secondary"
      currentTargetColor="#123456"
      referenceLabel="표시색"
    />);
    expect(document.querySelector('[data-studio-eyedropper-loupe="true"]')).toBeNull();
  });

  it("lets the isolated host subscribe without lifting hover frames into StudioPage", () => {
    let scheduled: FrameRequestCallback | null = null;
    const store = createStudioEyedropperPreviewStore({
      request: (callback) => {
        scheduled = callback;
        return 1;
      },
      cancel: vi.fn(),
    });
    render(<StudioEyedropperLoupeHost store={store} />);
    expect(document.querySelector('[data-studio-eyedropper-loupe="true"]')).toBeNull();
    act(() => {
      store.publish({
        pointer: { clientX: 40, clientY: 40, pointerType: "pen" },
        capture,
        sample,
        target: "primary",
        currentTargetColor: "#123456",
        referenceLabel: "표시색",
        viewport: { width: 800, height: 600 },
      });
    });
    act(() => {
      (scheduled as FrameRequestCallback | null)?.(16);
    });
    expect(document.querySelector('[data-studio-eyedropper-loupe="true"]')).not.toBeNull();
    act(() => {
      store.hide();
    });
    expect(document.querySelector('[data-studio-eyedropper-loupe="true"]')).toBeNull();
  });
});
