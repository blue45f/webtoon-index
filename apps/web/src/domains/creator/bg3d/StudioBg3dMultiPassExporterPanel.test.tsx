// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dMultiPassExporterPanel } from "./StudioBg3dMultiPassExporterPanel";

describe("StudioBg3dMultiPassExporterPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all production pass families and starts the default export", () => {
    const handleExport = vi.fn();
    render(<StudioBg3dMultiPassExporterPanel onStartMultiPassExport={handleExport} />);

    expect(screen.getByText("멀티패스 레이어 자동 분리 내보내기")).toBeDefined();
    expect(screen.getByText("01_선화 (Line Art)")).toBeDefined();
    expect(screen.getByText("02_밑색 (Flat Color)")).toBeDefined();
    expect(screen.getByText("08_법선 벡터 (Normal)")).toBeDefined();
    expect(screen.getByText("10_재질 ID (Material ID)")).toBeDefined();
    expect(screen.getByText("11_모션 벡터 (Velocity)")).toBeDefined();
    expect(screen.getByLabelText("멀티패스 예산")).toBeDefined();

    fireEvent.click(screen.getByText("레이어별 패스 렌더링 & 다운로드 시작"));
    expect(handleExport).toHaveBeenCalledTimes(1);
    expect(handleExport.mock.calls[0][0].includeLineArt).toBe(true);
    expect(handleExport.mock.calls[0][0].includeFlatColor).toBe(true);
    expect(handleExport.mock.calls[0][0].includeNormalMap).toBe(false);
  });

  it("applies the AI control-map preset before exporting", () => {
    const handleExport = vi.fn();
    render(<StudioBg3dMultiPassExporterPanel onStartMultiPassExport={handleExport} />);

    fireEvent.click(screen.getByRole("button", { name: "AI 제어맵" }));
    expect(screen.getByText("5개 패스")).toBeDefined();
    fireEvent.click(screen.getByText("레이어별 패스 렌더링 & 다운로드 시작"));

    const config = handleExport.mock.calls[0][0];
    expect(config.includeLineArt).toBe(true);
    expect(config.includeFlatColor).toBe(false);
    expect(config.includeDepthMap).toBe(true);
    expect(config.includeNormalMap).toBe(true);
    expect(config.includeObjectIdMask).toBe(true);
    expect(config.includeMaterialIdMask).toBe(true);
  });

  it("marks manual pass changes as custom instead of falsely selecting the complete preset", () => {
    render(<StudioBg3dMultiPassExporterPanel />);
    const completePreset = screen.getByRole("button", { name: "전체 패스" });

    fireEvent.click(screen.getByRole("button", { name: /08_법선 벡터/ }));

    expect(screen.getByText("사용자 설정")).toBeDefined();
    expect(completePreset.className).not.toContain("bg-accent text-accent-fg");
    expect(screen.getByRole("button", { name: /08_법선 벡터/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("disables every export action when the parent scene is locked", () => {
    render(<StudioBg3dMultiPassExporterPanel disabled />);
    expect(screen.getByText("레이어별 패스 렌더링 & 다운로드 시작").closest("button")?.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "전체 패스" }).hasAttribute("disabled")).toBe(true);
  });
});
