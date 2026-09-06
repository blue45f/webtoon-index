// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readStudioExportResolutionDpi,
  resetStudioExportResolutionDpi,
} from "../render/studio-raster-resolution-metadata";
import { STUDIO_Z } from "../studio-z-index";

import { resetStudioExportGeometryDraft } from "./studio-export-geometry-draft";
import {
  formatExportPageRangeLabel,
  planMultiPageExportCapture,
} from "./studio-export-package-preflight";
import { StudioExportMenuPanel } from "./StudioExportMenuPanel";

vi.mock("../studio-cbz-interchange", () => ({
  buildStudioCbzBlob: vi.fn(async () => ({
    blob: new Blob(["cbz"], { type: "application/vnd.comicbook+zip" }),
    warnings: [],
  })),
}));

function pngCanvas(width = 8, height = 12): HTMLCanvasElement {
  const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], {
    type: "image/png",
  });
  return {
    width,
    height,
    toBlob: (callback: BlobCallback) => callback(png),
  } as unknown as HTMLCanvasElement;
}

const baseProps = {
  canvasWidth: 800,
  canvasHeight: 1200,
  exportScale: 1 as const,
  exportFormat: "png" as const,
  exportTransparent: false,
  exportPresetId: null as string | null,
  watermark: {
    enabled: false,
    text: "",
    opacity: 0.2,
    position: "br" as const,
    size: 0.028,
  },
  isExporting: false,
  exportTitle: "test",
  setExportScale: vi.fn(),
  setExportFormat: vi.fn(),
  setExportTransparent: vi.fn(),
  setExportPresetId: vi.fn(),
  setWatermark: vi.fn(),
  onCopyToClipboard: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Print geometry deliberately survives panel unmounts in product; isolate it per case.
  resetStudioExportGeometryDraft();
  resetStudioExportResolutionDpi();
});

describe("StudioExportMenuPanel commercial chrome", () => {
  it("ships a fixed, body-safe panel shell (not menubar-clipped absolute)", () => {
    const html = renderToStaticMarkup(
      <StudioExportMenuPanel
        {...baseProps}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />
    );
    expect(html).toContain('data-studio-export-menu-panel="true"');
    expect(html).toContain("fixed");
    // Regression: sm:absolute was clipped by menubar overflow-x-auto.
    expect(html).not.toMatch(/sm:absolute|lg:absolute/);
    expect(html).toContain("z-[100]");
    expect(STUDIO_Z.menubarMenu).toBeGreaterThanOrEqual(100);
  });
});

describe("StudioExportMenuPanel export geometry controls reachability", () => {
  it("exposes geometry presets + DPI/trim/bleed editors with Korean a11y labels", () => {
    const html = renderToStaticMarkup(
      <StudioExportMenuPanel
        {...baseProps}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );

    // Preset buttons (data-testids already in product).
    expect(html).toContain('data-testid="export-geometry-preset-webtoon72"');
    expect(html).toContain('data-testid="export-geometry-preset-print300-b6"');
    expect(html).toContain('data-testid="export-geometry-preset-print300-a4"');
    expect(html).toContain("화면 72");
    expect(html).toContain("인쇄 B6 300");
    expect(html).toContain("인쇄 A4 300");
    expect(html).toContain('aria-label="지오메트리 프리셋"');

    // Number inputs reachable for package preflight editors.
    expect(html).toContain('data-testid="export-geometry-dpi"');
    expect(html).toContain('data-testid="export-geometry-trim-w"');
    expect(html).toContain('data-testid="export-geometry-trim-h"');
    expect(html).toContain('data-testid="export-geometry-bleed"');
    expect(html).toContain('aria-label="내보내기 해상도 DPI"');
    expect(html).toContain('aria-label="도련 블리드 밀리미터"');
    expect(html).toContain('aria-label="재단 트림 폭 밀리미터"');
    expect(html).toContain('aria-label="재단 트림 높이 밀리미터"');
    expect(html).toContain("인쇄 지오메트리");

    // Recommend-scale only appears after trim is set (print preset path).
    expect(html).not.toContain('data-testid="export-geometry-recommend-scale"');
  });

  it("applies print geometry presets into inputs and reveals recommend-scale", () => {
    const setExportScale = vi.fn();
    const setExportPresetId = vi.fn();
    render(
      <StudioExportMenuPanel
        {...baseProps}
        pageCount={1}
        pageLabels={["1"]}
        setExportScale={setExportScale}
        setExportPresetId={setExportPresetId}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );

    const dpi = screen.getByTestId("export-geometry-dpi") as HTMLInputElement;
    const bleed = screen.getByTestId("export-geometry-bleed") as HTMLInputElement;
    const trimW = screen.getByTestId("export-geometry-trim-w") as HTMLInputElement;
    const trimH = screen.getByTestId("export-geometry-trim-h") as HTMLInputElement;

    // Default is screen geometry (no trim).
    expect(dpi.value).toBe("72");
    expect(bleed.value).toBe("");
    expect(trimW.value).toBe("");
    expect(trimH.value).toBe("");
    expect(screen.queryByTestId("export-geometry-recommend-scale")).toBeNull();

    fireEvent.click(screen.getByTestId("export-geometry-preset-print300-b6"));

    expect(dpi.value).toBe("300");
    expect(bleed.value).toBe("3");
    expect(trimW.value).toBe("148");
    expect(trimH.value).toBe("210");
    expect(
      screen.getByTestId("export-geometry-preset-print300-b6").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByTestId("export-geometry-recommend-scale")).toBeTruthy();
    expect(screen.getByTestId("export-geometry-recommend-scale").textContent).toContain(
      "배율 권장",
    );

    fireEvent.click(screen.getByTestId("export-geometry-preset-print300-a4"));
    expect(dpi.value).toBe("300");
    expect(trimW.value).toBe("210");
    expect(trimH.value).toBe("297");
    expect(bleed.value).toBe("3");
    expect(
      screen.getByTestId("export-geometry-preset-print300-a4").getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("export-geometry-recommend-scale"));
    expect(setExportScale).toHaveBeenCalled();
    expect(setExportPresetId).toHaveBeenCalledWith(null);

    // Screen preset clears trim/bleed again.
    fireEvent.click(screen.getByTestId("export-geometry-preset-webtoon72"));
    expect(dpi.value).toBe("72");
    expect(bleed.value).toBe("");
    expect(trimW.value).toBe("");
    expect(trimH.value).toBe("");
    expect(screen.queryByTestId("export-geometry-recommend-scale")).toBeNull();
    expect(
      screen.getByTestId("export-geometry-preset-webtoon72").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("lets DPI/trim/bleed number inputs update package geometry state", () => {
    render(
      <StudioExportMenuPanel
        {...baseProps}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );

    const dpi = screen.getByTestId("export-geometry-dpi") as HTMLInputElement;
    const bleed = screen.getByTestId("export-geometry-bleed") as HTMLInputElement;
    const trimW = screen.getByTestId("export-geometry-trim-w") as HTMLInputElement;
    const trimH = screen.getByTestId("export-geometry-trim-h") as HTMLInputElement;

    fireEvent.change(dpi, { target: { value: "150" } });
    fireEvent.change(bleed, { target: { value: "2" } });
    fireEvent.change(trimW, { target: { value: "100" } });
    fireEvent.change(trimH, { target: { value: "150" } });

    expect(dpi.value).toBe("150");
    expect(bleed.value).toBe("2");
    expect(trimW.value).toBe("100");
    expect(trimH.value).toBe("150");
    // Manual edits drop preset pressed state and still surface recommend-scale once trim is set.
    expect(
      screen.getByTestId("export-geometry-preset-webtoon72").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByTestId("export-geometry-recommend-scale")).toBeTruthy();
    expect(screen.getByText(/DPI 150/)).toBeTruthy();
    expect(screen.getByText(/트림 100×150mm/)).toBeTruthy();
    expect(screen.getByText(/도련 2mm/)).toBeTruthy();
  });
});

describe("planMultiPageExportCapture", () => {
  it("prefers indices mode when parent provides capturePagesForIndices", () => {
    expect(
      planMultiPageExportCapture({
        pageIndices: [1, 2],
        pageCount: 4,
        hasIndicesCapture: true,
      })
    ).toEqual({ mode: "indices", indices: [1, 2] });
  });

  it("falls back to all for a full range without indices capture", () => {
    expect(
      planMultiPageExportCapture({
        pageIndices: [0, 1, 2],
        pageCount: 3,
        hasIndicesCapture: false,
      })
    ).toEqual({ mode: "all", indices: [0, 1, 2] });
  });

  it("slices after full capture when range is a proper subset and indices capture is missing", () => {
    expect(
      planMultiPageExportCapture({
        pageIndices: [1, 2],
        pageCount: 4,
        hasIndicesCapture: false,
      })
    ).toEqual({ mode: "all-then-slice", indices: [1, 2] });
  });

  it("keeps empty indices when preflight rejected the range", () => {
    expect(
      planMultiPageExportCapture({
        pageIndices: [],
        pageCount: 4,
        hasIndicesCapture: true,
      })
    ).toEqual({ mode: "all", indices: [] });
  });
});

describe("StudioExportMenuPanel page-range capture paths", () => {
  it("formats Korean range labels for status chrome", () => {
    expect(formatExportPageRangeLabel(2, 4)).toBe("페이지 2–4");
    expect(formatExportPageRangeLabel(3, 3)).toBe("페이지 3");
  });

  it("prefers capturePagesForIndices over capturePagesForPreset for CBZ when range is set", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:cbz"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const capturePagesForPreset = vi.fn(async () => [
      pngCanvas(),
      pngCanvas(),
      pngCanvas(),
      pngCanvas(),
    ]);
    const capturePagesForIndices = vi.fn(async (indices: number[]) =>
      indices.map(() => pngCanvas())
    );

    render(
      <StudioExportMenuPanel
        {...baseProps}
        pageCount={4}
        pageLabels={["1", "2", "3", "4"]}
        capturePagesForPreset={capturePagesForPreset}
        capturePagesForIndices={capturePagesForIndices}
      />
    );

    // Narrow package range to pages 2–3 (1-based inputs → indices [1, 2]).
    fireEvent.change(screen.getByLabelText("내보내기 시작 페이지"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("내보내기 끝 페이지"), {
      target: { value: "3" },
    });

    expect(screen.getByRole("button", { name: "CBZ · 2P" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "CBZ · 2P" }));

    await waitFor(() => {
      expect(capturePagesForIndices).toHaveBeenCalledWith([1, 2]);
    });
    expect(capturePagesForPreset).not.toHaveBeenCalled();

    const archiveStatus = document.querySelector(
      '[aria-label="문서 교환 포맷"] [aria-live="polite"]'
    );
    await waitFor(() => {
      expect(archiveStatus?.textContent).toMatch(/CBZ 2페이지와 ComicInfo\.xml/u);
      expect(archiveStatus?.textContent).toMatch(/페이지 2–3/u);
    });
  });

  it("slices full capture when indices prop is absent but range is partial", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:cbz"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const capturePagesForPreset = vi.fn(async () => [
      pngCanvas(),
      pngCanvas(),
      pngCanvas(),
    ]);

    render(
      <StudioExportMenuPanel
        {...baseProps}
        pageCount={3}
        pageLabels={["1", "2", "3"]}
        capturePagesForPreset={capturePagesForPreset}
      />
    );

    fireEvent.change(screen.getByLabelText("내보내기 시작 페이지"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("내보내기 끝 페이지"), {
      target: { value: "3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "CBZ · 2P" }));

    await waitFor(() => {
      expect(capturePagesForPreset).toHaveBeenCalledWith("all");
    });

    const archiveStatus = document.querySelector(
      '[aria-label="문서 교환 포맷"] [aria-live="polite"]'
    );
    await waitFor(() => {
      // Only two pages encoded after slice (not the full 3 captured).
      expect(archiveStatus?.textContent).toMatch(/CBZ 2페이지/u);
      expect(archiveStatus?.textContent).toMatch(/페이지 2–3/u);
    });
  });
});

describe("StudioExportMenuPanel print resolution honesty", () => {
  it("states the DPI the current scale really delivers and blocks the 300 DPI claim", () => {
    render(
      <StudioExportMenuPanel
        {...baseProps}
        canvasWidth={720}
        canvasHeight={1080}
        exportScale={3}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );

    fireEvent.click(screen.getByTestId("export-geometry-preset-print300-a4"));

    // 720×1080 at 3× is 2160×3240 px — 254 DPI on a 216×303 mm sheet, not the requested 300.
    expect(screen.getByTestId("export-geometry-actual").textContent).toContain("2160×3240px");
    expect(screen.getByTestId("export-geometry-actual").textContent).toContain("254DPI");

    const alert = screen.getByTestId("export-geometry-dpi-alert");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("254DPI");
    expect(alert.textContent).toContain("300DPI");
    expect(alert.textContent).toContain("3.55×");
  });

  it("recommends the exact scale that reaches the target instead of clamping to 3×", () => {
    const setExportScale = vi.fn();
    render(
      <StudioExportMenuPanel
        {...baseProps}
        canvasWidth={720}
        canvasHeight={1080}
        exportScale={3}
        pageCount={1}
        pageLabels={["1"]}
        setExportScale={setExportScale}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );

    fireEvent.click(screen.getByTestId("export-geometry-preset-print300-a4"));
    const recommend = screen.getByTestId("export-geometry-recommend-scale");
    expect(recommend.textContent).toContain("배율 권장");
    expect(recommend.textContent).toContain("3.55×");
    fireEvent.click(recommend);
    expect(setExportScale).toHaveBeenCalledWith(3.55);
  });

  it("never promises that trim/bleed are applied to the pixels", () => {
    const html = renderToStaticMarkup(
      <StudioExportMenuPanel
        {...baseProps}
        canvasWidth={720}
        canvasHeight={1080}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );
    expect(html).toContain("트림·도련은 픽셀에 적용하지 않습니다");
    expect(html).toContain("pHYs");
    expect(html).toContain("목표 DPI");
  });

  it("publishes the delivered DPI so encoders tag the file with the same number the UI shows", () => {
    render(
      <StudioExportMenuPanel
        {...baseProps}
        canvasWidth={720}
        canvasHeight={1080}
        exportScale={3}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );
    // Screen geometry publishes the plain DPI setting.
    expect(readStudioExportResolutionDpi()).toBe(72);

    fireEvent.click(screen.getByTestId("export-geometry-preset-print300-a4"));
    // Print geometry publishes the measured DPI, not the requested 300.
    expect(Math.round(readStudioExportResolutionDpi() ?? 0)).toBe(254);
  });

  it("keeps the chosen print geometry across panel unmounts", () => {
    const first = render(
      <StudioExportMenuPanel
        {...baseProps}
        canvasWidth={720}
        canvasHeight={1080}
        exportScale={3}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );
    fireEvent.click(screen.getByTestId("export-geometry-preset-print300-a4"));
    expect((screen.getByTestId("export-geometry-dpi") as HTMLInputElement).value).toBe("300");
    // Closing the export menu unmounts the panel — the geometry must not evaporate with it.
    first.unmount();

    render(
      <StudioExportMenuPanel
        {...baseProps}
        canvasWidth={720}
        canvasHeight={1080}
        exportScale={3}
        pageCount={1}
        pageLabels={["1"]}
        capturePagesForPreset={vi.fn(async () => [])}
      />,
    );
    expect((screen.getByTestId("export-geometry-dpi") as HTMLInputElement).value).toBe("300");
    expect((screen.getByTestId("export-geometry-trim-w") as HTMLInputElement).value).toBe("210");
    expect((screen.getByTestId("export-geometry-trim-h") as HTMLInputElement).value).toBe("297");
    expect((screen.getByTestId("export-geometry-bleed") as HTMLInputElement).value).toBe("3");
    expect(Math.round(readStudioExportResolutionDpi() ?? 0)).toBe(254);
  });
});
