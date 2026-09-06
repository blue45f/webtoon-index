// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getStudioBg3dProceduralStarterAsset,
  type StudioBg3dProceduralInsertionPlan,
} from "./studio-bg3d-procedural-starter-pack";
import { StudioBg3dProceduralStarterPanel } from "./StudioBg3dProceduralStarterPanel";

function successPlan(assetId: string): StudioBg3dProceduralInsertionPlan {
  const asset = getStudioBg3dProceduralStarterAsset(assetId);
  if (!asset) throw new Error("fixture asset is missing");
  return {
    ok: true,
    asset,
    instanceId: `${assetId}-test`,
    primitives: asset.parts.map((part, index) => ({
      id: `${assetId}-test.${index}`,
      kind: part.kind,
      position: [...part.offset],
      rotation: [...part.rotation],
      scale: [...part.scale],
      color: part.color,
    })),
    nextUsage: asset.budget,
  };
}

afterEach(cleanup);

describe("StudioBg3dProceduralStarterPanel", () => {
  it("exposes original/CC0 provenance and paginates the expanded catalog", () => {
    render(
      <StudioBg3dProceduralStarterPanel onInsert={(assetId) => successPlan(assetId)} />,
    );

    expect(screen.getByText("오리지널 · CC0")).toBeTruthy();
    expect(screen.getByText(/직접 제작 · CC0 1.0/)).toBeTruthy();
    expect(screen.getByText("17개 찾음 · WebGL2/WebGPU 공용 · 외부 리소스 0")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /장면에 추가$/ })).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "에셋 11개 더 보기" }));
    expect(screen.getAllByRole("button", { name: /장면에 추가$/ })).toHaveLength(17);
    expect(screen.getByRole("button", { name: "처음 6개만 보기" })).toBeTruthy();
  });

  it("searches and combines a keyboard-accessible category filter", () => {
    render(
      <StudioBg3dProceduralStarterPanel onInsert={(assetId) => successPlan(assetId)} />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "절차형 3D 에셋 검색" }), {
      target: { value: "가구" },
    });
    expect(screen.getAllByRole("button", { name: /장면에 추가$/ })).toHaveLength(6);

    fireEvent.click(screen.getByRole("radio", { name: "문·창호" }));
    expect(screen.getByText("0개 찾음 · WebGL2/WebGPU 공용 · 외부 리소스 0")).toBeTruthy();
    expect(screen.getByText("검색과 카테고리에 맞는 에셋이 없습니다.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "검색·필터 초기화" }));
    expect(screen.getByRole("radio", { name: "전체" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("inserts an asset and announces editable part count", () => {
    const onInsert = vi.fn((assetId: string) => successPlan(assetId));
    render(<StudioBg3dProceduralStarterPanel onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: "오픈 룸 셸 장면에 추가" }));

    expect(onInsert).toHaveBeenCalledWith("ts3d-room-shell-v1");
    expect(screen.getByRole("status").textContent).toContain(
      "오픈 룸 셸을(를) 4개 편집 파츠로 추가했습니다.",
    );
  });

  it("announces an actionable budget rejection", () => {
    render(
      <StudioBg3dProceduralStarterPanel
        onInsert={() => ({ ok: false, reason: "draw-call-budget-exceeded" })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "오픈 룸 셸 장면에 추가" }));
    expect(screen.getByRole("alert").textContent).toContain("드로우콜 예산이 부족");
  });

  it("disables every insertion target while the scene is busy", () => {
    const onInsert = vi.fn((assetId: string) => successPlan(assetId));
    render(
      <StudioBg3dProceduralStarterPanel
        disabledReason="3D 장면을 복원하는 중입니다."
        onInsert={onInsert}
      />,
    );

    expect(screen.getByText("3D 장면을 복원하는 중입니다.")).toBeTruthy();
    for (const button of screen.getAllByRole("button", { name: /장면에 추가$/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(onInsert).not.toHaveBeenCalled();
  });
});
