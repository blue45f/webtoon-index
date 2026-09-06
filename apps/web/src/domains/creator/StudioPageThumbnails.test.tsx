// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioPageThumbnail } from "./StudioPageThumbnails";

class ThumbnailIntersectionObserver implements IntersectionObserver {
  static instances: ThumbnailIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  private target: Element | null = null;

  constructor(private readonly callback: IntersectionObserverCallback, options = {}) {
    this.rootMargin = (options as IntersectionObserverInit).rootMargin ?? "0px";
    ThumbnailIntersectionObserver.instances.push(this);
  }

  disconnect(): void {
    this.target = null;
  }

  observe(target: Element): void {
    this.target = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element): void {
    if (this.target === target) this.target = null;
  }

  emit(isIntersecting: boolean): void {
    if (!this.target) throw new Error("thumbnail observer target is missing");
    this.callback([{ isIntersecting, target: this.target } as IntersectionObserverEntry], this);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  ThumbnailIntersectionObserver.instances.length = 0;
});

describe("StudioPageThumbnail work assets", () => {
  it("renders an inert collaboration placeholder instead of an invalid SVG image href", () => {
    const html = renderToStaticMarkup(
      <StudioPageThumbnail page={{
        id: "page-1",
        bg: "#fff",
        bgGrad: null,
        canvasH: 1080,
        elements: [{
          id: "asset-1",
          type: "image",
          src: "work-asset://image/asset-1",
          x: 10,
          y: 20,
          width: 300,
          height: 400,
          rotation: 0,
        }],
      }} />
    );
    expect(html).toContain("data-work-asset-placeholder=\"true\"");
    expect(html).toContain("검증된 이미지 바이트를 안전하게 불러오는 중");
    expect(html).not.toContain("href=\"work-asset://");
  });

  it("mounts raster presentation only near the thumbnail viewport and releases it on exit", () => {
    vi.stubGlobal("IntersectionObserver", ThumbnailIntersectionObserver);
    const { container } = render(
      <StudioPageThumbnail page={{
        id: "page-windowed",
        bg: "#fff",
        bgGrad: null,
        canvasH: 1080,
        elements: [{
          id: "image-windowed",
          type: "image",
          src: "data:image/png;base64,AA==",
          x: 10,
          y: 20,
          width: 300,
          height: 400,
          rotation: 0,
        }],
      }} />,
    );
    const observer = ThumbnailIntersectionObserver.instances[0];
    expect(observer?.rootMargin).toBe("320px 0px");
    expect(container.querySelector("image")).toBeNull();

    act(() => observer?.emit(true));
    expect(container.querySelector("image")?.getAttribute("href")).toBe(
      "data:image/png;base64,AA==",
    );
    act(() => observer?.emit(false));
    expect(container.querySelector("image")).toBeNull();
  });
});
