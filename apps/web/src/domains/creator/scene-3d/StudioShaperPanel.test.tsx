// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioShaperPanel } from "./StudioShaperPanel";

describe("StudioShaperPanel", () => {
  afterEach(cleanup);

  it("presents an independent ToonStudio workflow with three task tabs", () => {
    render(<StudioShaperPanel />);

    expect(screen.getByText("웹툰 캐릭터 셰이퍼")).toBeTruthy();
    expect(screen.getByText("TOONSTUDIO")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "캐릭터 레시피" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "추천·포즈" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "출력" })).toBeTruthy();
    expect(screen.queryByText("네이버웹툰 3D 스타일")).toBeNull();
  });

  it("only commits categories that the active mannequin can actually render", () => {
    const onSelectionChange = vi.fn();
    render(<StudioShaperPanel onSelectionChange={onSelectionChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "체형" }));
    fireEvent.click(screen.getByRole("button", { name: "SD 귀여운 3등신" }));

    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ body: "body-chibi" }),
    );

    const hair = screen.getByRole("tab", { name: "헤어" });
    expect((hair as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(hair);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("applies only supported slices from an archetype recipe", () => {
    const onSelectionChange = vi.fn();
    render(<StudioShaperPanel onSelectionChange={onSelectionChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "추천·포즈" }));
    fireEvent.click(screen.getByRole("button", { name: /학원 로맨스 주인공 지원 범주 적용/u }));

    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        face: "face-oval",
        eye: "eye-romance",
        nose: "nose-dot",
        body: "body-slim-female",
        bodypose: "pose-hip",
        hair: "hair-short",
      }),
    );
  });

  it("routes pose review and scene output to real host callbacks", () => {
    const onExportPsd = vi.fn();
    const onInsertCanvas = vi.fn();
    const onTriggerPoseScanner = vi.fn();
    render(
      <StudioShaperPanel
        onExportPsd={onExportPsd}
        onInsertCanvas={onInsertCanvas}
        onTriggerPoseScanner={onTriggerPoseScanner}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "추천·포즈" }));
    fireEvent.click(screen.getByRole("button", { name: "사진 위 랜드마크로 포즈 검수" }));
    expect(onTriggerPoseScanner).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "출력" }));
    fireEvent.click(screen.getByRole("button", { name: "현재 장면을 캔버스에 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "레이어드 PSD 내보내기" }));
    expect(onInsertCanvas).toHaveBeenCalledTimes(1);
    expect(onExportPsd).toHaveBeenCalledTimes(1);
  });

  it("never fabricates a fallback PSD or surface-paint mode", () => {
    render(<StudioShaperPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "출력" }));

    expect((screen.getByRole("button", { name: "레이어드 PSD 내보내기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/가짜 픽셀이나 빈 PSD를 만들지 않습니다/u)).toBeTruthy();
    expect(screen.getByText(/데생 인형에는 존재하지 않는 UV 기능/u)).toBeTruthy();
  });
});
