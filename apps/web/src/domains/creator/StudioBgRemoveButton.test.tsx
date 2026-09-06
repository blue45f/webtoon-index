/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBgRemoveButton } from "./StudioBgRemoveButton";

const removeBackground = vi.hoisted(() => vi.fn());

vi.mock("./studio-bg-remove", () => ({ removeBackground }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudioBgRemoveButton", () => {
  it("keeps the foreground engine behind the explicit quick action", () => {
    const source = readFileSync(
      "apps/web/src/domains/creator/StudioBgRemoveButton.tsx",
      "utf8",
    );

    expect(source).not.toMatch(
      /import\s+\{\s*removeBackground\s*\}\s+from\s+["']\.\/studio-bg-remove["']/u,
    );
    expect(source).toContain('await import("./studio-bg-remove")');
  });

  it("prioritizes the non-destructive layer flow and keeps quick removal separate", () => {
    const onOpenLayerLift = vi.fn();
    render(
      <StudioBgRemoveButton
        src="data:image/png;base64,source"
        onResult={vi.fn()}
        onOpenLayerLift={onOpenLayerLift}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /컷 레이어 복원/u }));
    expect(onOpenLayerLift).toHaveBeenCalledOnce();
    expect(screen.getByText(/실행 취소 한 번/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "빠른 배경 제거" })).toBeTruthy();
    expect(screen.getByText("기기 처리")).toBeTruthy();
  });

  it("explains why layer restoration is unavailable instead of hiding it", () => {
    render(
      <StudioBgRemoveButton
        src="data:image/png;base64,source"
        onResult={vi.fn()}
        onOpenLayerLift={vi.fn()}
        layerLiftDisabledReason="그룹에 속한 이미지는 먼저 그룹에서 분리해 주세요."
      />,
    );

    expect(screen.getByRole("button", { name: /컷 레이어 복원/u }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("status").textContent)
      .toContain("그룹에 속한 이미지는");
  });

  it("runs the legacy destructive action only from the explicit quick button", async () => {
    removeBackground.mockResolvedValue("data:image/png;base64,foreground");
    const onResult = vi.fn();
    render(
      <StudioBgRemoveButton
        src="data:image/png;base64,source"
        onResult={onResult}
        onOpenLayerLift={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "빠른 배경 제거" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(
      "data:image/png;base64,foreground",
    ));
    expect(removeBackground).toHaveBeenCalledWith(
      "data:image/png;base64,source",
    );
  });
});
