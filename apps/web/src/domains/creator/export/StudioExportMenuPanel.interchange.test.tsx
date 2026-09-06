// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioExportMenuPanel } from "./StudioExportMenuPanel";

vi.mock("../studio-cbz-interchange", () => ({
  buildStudioCbzBlob: vi.fn(async () => ({
    blob: new Blob(["cbz"], { type: "application/vnd.comicbook+zip" }),
    warnings: [],
  })),
}));

vi.mock("../studio-openraster-interchange", () => ({
  buildStudioOpenRasterBlob: vi.fn(async () => ({
    blob: new Blob(["ora"], { type: "image/openraster" }),
    warnings: [],
  })),
}));

function pngCanvas(width = 8, height = 12): HTMLCanvasElement {
  const png = new Blob([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
  ], { type: "image/png" });
  return {
    width,
    height,
    toBlob: (callback: BlobCallback) => callback(png),
  } as unknown as HTMLCanvasElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioExportMenuPanel open raster interchange", () => {
  it("exposes five honest formats and downloads the selected encoded payload", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:raster") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const exportCurrentPageToRasterInterchange = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      extension: ".tga",
      mimeType: "image/x-tga",
      warnings: [],
      lossy: false,
    });
    render(
      <StudioExportMenuPanel
        canvasWidth={800}
        canvasHeight={1200}
        exportScale={1}
        exportFormat="png"
        exportTransparent
        exportPresetId={null}
        watermark={{ enabled: false, text: "", opacity: 0.2, position: "br", size: 0.028 }}
        isExporting={false}
        exportTitle={'chapter:01/"hero"'}
        pageCount={1}
        pageLabels={["1"]}
        setExportScale={vi.fn()}
        setExportFormat={vi.fn()}
        setExportTransparent={vi.fn()}
        setExportPresetId={vi.fn()}
        setWatermark={vi.fn()}
        onCopyToClipboard={vi.fn()}
        capturePagesForPreset={vi.fn(async () => [])}
        exportCurrentPageToRasterInterchange={exportCurrentPageToRasterInterchange}
      />
    );

    const format = screen.getByRole("combobox", { name: "공개 래스터 내보내기 형식" });
    expect(format.querySelectorAll("option")).toHaveLength(6);
    fireEvent.change(format, { target: { value: "tga" } });
    fireEvent.click(screen.getByRole("button", { name: "TGA 저장" }));

    await waitFor(() => expect(exportCurrentPageToRasterInterchange).toHaveBeenCalledWith("tga"));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText("TGA 파일을 저장했어요.")).toBeTruthy();
  });

  it("shows codec loss warnings instead of claiming a lossless BMP export", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:raster") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const callback = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([0x42, 0x4d]),
      extension: ".bmp",
      mimeType: "image/bmp",
      warnings: ["투명 픽셀을 흰색 배경에 합성했습니다."],
      lossy: true,
    });
    render(
      <StudioExportMenuPanel
        canvasWidth={2}
        canvasHeight={2}
        exportScale={1}
        exportFormat="png"
        exportTransparent
        exportPresetId={null}
        watermark={{ enabled: false, text: "", opacity: 0.2, position: "br", size: 0.028 }}
        isExporting={false}
        exportTitle="test"
        pageCount={1}
        pageLabels={["1"]}
        setExportScale={vi.fn()}
        setExportFormat={vi.fn()}
        setExportTransparent={vi.fn()}
        setExportPresetId={vi.fn()}
        setWatermark={vi.fn()}
        onCopyToClipboard={vi.fn()}
        capturePagesForPreset={vi.fn(async () => [])}
        exportCurrentPageToRasterInterchange={callback}
      />
    );
    fireEvent.change(screen.getByRole("combobox", { name: "공개 래스터 내보내기 형식" }), {
      target: { value: "bmp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "BMP 저장" }));
    await waitFor(() => expect(screen.getByText(/투명 픽셀을 흰색 배경/u)).toBeTruthy());
  });

  it("exports all captured pages as a CBZ with ComicInfo metadata", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:cbz") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const capturePagesForPreset = vi.fn(async () => [pngCanvas(), pngCanvas()]);
    render(
      <StudioExportMenuPanel
        canvasWidth={800}
        canvasHeight={1200}
        exportScale={1}
        exportFormat="png"
        exportTransparent
        exportPresetId={null}
        watermark={{ enabled: false, text: "", opacity: 0.2, position: "br", size: 0.028 }}
        isExporting={false}
        exportTitle="episode: 02"
        pageCount={2}
        pageLabels={["1", "2"]}
        setExportScale={vi.fn()}
        setExportFormat={vi.fn()}
        setExportTransparent={vi.fn()}
        setExportPresetId={vi.fn()}
        setWatermark={vi.fn()}
        onCopyToClipboard={vi.fn()}
        capturePagesForPreset={capturePagesForPreset}
      />
    );

    const cbzButton = screen.getByRole("button", { name: "CBZ · 2P" });
    fireEvent.click(cbzButton);

    await waitFor(() => expect(cbzButton.textContent).toContain("CBZ · 2P"));
    const cbzStatus = document.querySelector('[aria-label="문서 교환 포맷"] [aria-live="polite"]');
    expect(cbzStatus?.textContent).toMatch(/CBZ 2페이지와 ComicInfo\.xml/u);
    expect(capturePagesForPreset).toHaveBeenCalledWith("all");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "application/vnd.comicbook+zip" }));
  });

  it("labels the current ORA path as a flattened one-layer interchange", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:ora") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const capturePagesForPreset = vi.fn(async () => [pngCanvas(24, 36)]);
    render(
      <StudioExportMenuPanel
        canvasWidth={24}
        canvasHeight={36}
        exportScale={1}
        exportFormat="png"
        exportTransparent
        exportPresetId={null}
        watermark={{ enabled: false, text: "", opacity: 0.2, position: "br", size: 0.028 }}
        isExporting={false}
        exportTitle="chapter"
        pageCount={1}
        pageLabels={["1"]}
        setExportScale={vi.fn()}
        setExportFormat={vi.fn()}
        setExportTransparent={vi.fn()}
        setExportPresetId={vi.fn()}
        setWatermark={vi.fn()}
        onCopyToClipboard={vi.fn()}
        capturePagesForPreset={capturePagesForPreset}
      />
    );

    const oraButton = screen.getByRole("button", { name: "ORA" });
    fireEvent.click(oraButton);

    await waitFor(() => expect(oraButton.textContent).toContain("ORA"));
    const oraStatus = document.querySelector('[aria-label="문서 교환 포맷"] [aria-live="polite"]');
    expect(oraStatus?.textContent).toMatch(/OpenRaster를 저장했어요/u);
    expect(capturePagesForPreset).toHaveBeenCalledWith("current");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "image/openraster" }));
  });

  it("exports validated InkML and reports intentionally skipped semantics", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:inkml") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const exportCurrentPageToInkMl = vi.fn(async () => ({
      xml: "<ink/>",
      mediaType: "application/inkml+xml" as const,
      exportedStrokeIds: ["stroke-1"],
      skipped: [{ elementId: "eraser-1", reason: "eraser-semantic-not-representable" as const }],
      conformance: {} as never,
    }));
    render(
      <StudioExportMenuPanel
        canvasWidth={800}
        canvasHeight={1200}
        exportScale={1}
        exportFormat="png"
        exportTransparent
        exportPresetId={null}
        watermark={{ enabled: false, text: "", opacity: 0.2, position: "br", size: 0.028 }}
        isExporting={false}
        exportTitle="episode:ink"
        pageCount={1}
        pageLabels={["1"]}
        setExportScale={vi.fn()}
        setExportFormat={vi.fn()}
        setExportTransparent={vi.fn()}
        setExportPresetId={vi.fn()}
        setWatermark={vi.fn()}
        onCopyToClipboard={vi.fn()}
        capturePagesForPreset={vi.fn(async () => [])}
        exportCurrentPageToInkMl={exportCurrentPageToInkMl}
      />
    );

    expect(
      screen
        .getByRole("region", { name: "문서 교환 포맷" })
        .querySelector("div.grid")
        ?.className,
    ).toContain("grid-cols-3");
    expect(
      screen
        .getByRole("spinbutton", { name: "내보내기 시작 페이지" })
        .parentElement?.parentElement?.className,
    ).toContain("grid-cols-2");

    fireEvent.click(screen.getByRole("button", { name: "InkML" }));

    await waitFor(() => expect(exportCurrentPageToInkMl).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/InkML 1개 획을 검증해 저장했어요/u)).toBeTruthy();
    expect(screen.getByText(/숨김·지우개·도형 1개/u)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/inkml+xml;charset=utf-8" }),
    );
  });
});
