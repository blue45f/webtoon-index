// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_WILL_V1_OPC_ASSURANCE } from "../studio-will-v1-opc-interchange";

import {
  STUDIO_WILL_V1_EXPORT_DISCLAIMER,
  STUDIO_WILL_V1_EXPORT_PROFILE_LABEL,
} from "./studio-will-v1-export-bridge";
import { StudioExportMenuPanel } from "./StudioExportMenuPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioExportMenuPanel WILL v1 public-spec profile", () => {
  it("downloads the bounded Worker result while keeping official certification claims out of the UI", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:will"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const exportCurrentPageToWillV1 = vi.fn(async () => ({
      bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      extension: ".will" as const,
      mediaType: "application/vnd.toonspectrum.will-v1-bounded+zip" as const,
      profileLabel: STUDIO_WILL_V1_EXPORT_PROFILE_LABEL,
      disclaimer: STUDIO_WILL_V1_EXPORT_DISCLAIMER,
      exportedStrokeIds: ["stroke-1", "stroke-2"],
      skipped: [{
        elementId: "eraser-1",
        reason: "eraser-semantic-not-representable" as const,
      }],
      adaptations: [],
      loss: {
        status: "exact" as const,
        quantization: "truncate-toward-zero" as const,
        items: [],
      },
      assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
    }));

    render(
      <StrictMode>
        <StudioExportMenuPanel
          canvasWidth={800}
          canvasHeight={1_200}
          exportScale={1}
          exportFormat="png"
          exportTransparent
          exportPresetId={null}
          watermark={{ enabled: false, text: "", opacity: 0.2, position: "br", size: 0.028 }}
          isExporting={false}
          exportTitle="episode:will"
          pageCount={1}
          pageLabels={["1"]}
          setExportScale={vi.fn()}
          setExportFormat={vi.fn()}
          setExportTransparent={vi.fn()}
          setExportPresetId={vi.fn()}
          setWatermark={vi.fn()}
          onCopyToClipboard={vi.fn()}
          capturePagesForPreset={vi.fn(async () => [])}
          exportCurrentPageToWillV1={exportCurrentPageToWillV1}
        />
      </StrictMode>,
    );

    const exchangeRegion = screen.getByRole("region", { name: "문서 교환 포맷" });
    expect(exchangeRegion.querySelector("div.grid")?.className).toContain("grid-cols-2");
    expect(
      screen.getByText(/Wacom 공식 SDK·인증 파일이 아닙니다/u),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "WILL v1" }));

    await waitFor(() => expect(exportCurrentPageToWillV1).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "application/vnd.toonspectrum.will-v1-bounded+zip",
      }),
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/WILL v1 2개 획을 저장했어요/u)).toBeTruthy();
    expect(screen.getByText(/표현할 수 없는 1개 요소/u)).toBeTruthy();
    expect(
      screen.getAllByText(/Wacom 공식 SDK·인증 파일이 아닙니다/u),
    ).toHaveLength(2);
  });
});
