// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dCinematicDirectorPanel } from "./StudioBg3dCinematicDirectorPanel";

import type { StudioBg3dShot } from "./studio-bg3d-scene-document";

describe("StudioBg3dCinematicDirectorPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders transition controls, continuity review and local shot deck actions", () => {
    const handleBookmark = vi.fn();
    const handleShake = vi.fn();

    render(
      <StudioBg3dCinematicDirectorPanel
        onApplyShotBookmark={handleBookmark}
        onTriggerShake={handleShake}
      />,
    );

    expect(screen.getByText("시네마틱 카메라 & 컷 디렉터")).toBeDefined();
    expect(screen.getByText("하이 앵글 부감 (High Angle)")).toBeDefined();
    expect(screen.getByText("컷 연속성 검사")).toBeDefined();
    expect(screen.getByText("저장된 웹툰 컷 덱")).toBeDefined();
    expect(screen.getByLabelText("카메라 전환 설정")).toBeDefined();

    fireEvent.click(screen.getByText("지진/붕괴 진동"));
    expect(handleShake).toHaveBeenCalledTimes(1);
    expect(handleShake.mock.calls[0][0].preset).toBe("earthquake-rumble");

    fireEvent.click(screen.getByRole("button", { name: "현재 설정으로 컷 추가" }));
    expect(handleBookmark).toHaveBeenCalledTimes(1);
    expect(handleBookmark.mock.calls[0][0].transitionSeconds).toBe(0.8);
    expect(screen.getByText("01화 컷 4")).toBeDefined();
  });

  it("connects production shot capture, apply, reorder, remove and AI reference callbacks", () => {
    const shots: readonly StudioBg3dShot[] = [
      {
        id: "shot-a",
        name: "대화 와이드",
        camera: { position: [0, 1.6, 6], target: [0, 1.4, 0], fovDegrees: 50 },
      },
      {
        id: "shot-b",
        name: "표정 클로즈업",
        camera: { position: [0, 1.6, 2], target: [0, 1.5, 0], fovDegrees: 24 },
      },
    ];
    const capture = vi.fn();
    const apply = vi.fn();
    const move = vi.fn();
    const remove = vi.fn();
    const aiReference = vi.fn();

    render(
      <StudioBg3dCinematicDirectorPanel
        productionShots={shots}
        baseCamera={{ position: [0, 1.6, 6], target: [0, 1.4, 0], fovDegrees: 45 }}
        onCaptureCurrentShot={capture}
        onApplyProductionShot={apply}
        onMoveProductionShot={move}
        onRemoveProductionShot={remove}
        onUseCurrentFrameAsAiReference={aiReference}
      />,
    );

    expect(screen.getByText("장면 연동")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "현재 장면을 컷으로 저장" }));
    expect(capture).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("표정 클로즈업 위로 이동"));
    expect(move).toHaveBeenCalledWith("shot-b", 0);

    fireEvent.click(screen.getAllByRole("button", { name: "이동" })[0]!);
    expect(apply).toHaveBeenCalledWith("shot-a");

    fireEvent.click(screen.getByLabelText("대화 와이드 삭제"));
    expect(remove).toHaveBeenCalledWith("shot-a");

    fireEvent.click(screen.getByRole("button", { name: "현재 컷을 AI 구도·포즈 참조로 보내기" }));
    expect(aiReference).toHaveBeenCalledTimes(1);
  });
});
