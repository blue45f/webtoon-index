// @vitest-environment jsdom

/**
 * 도움말 센터 호스트 UI 계약.
 *
 * 값의 정직성은 `studio-help-center-surfaces.test.ts` 가 순수 계층에서 잡는다.
 * 여기서는 그 계층이 **화면에 도달하는가**만 본다 — 메뉴 요청 → 다이얼로그,
 * 구역 전환, Esc 로 닫기, 그리고 버그 리포트 화면이 무엇을 담고 무엇을 빼는지
 * 사용자에게 먼저 보여 주는지.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  STUDIO_BUG_REPORT_EXCLUDED,
  STUDIO_BUG_REPORT_INCLUDED,
} from "./studio-bug-report-package";
import { openStudioHelpCenter } from "./studio-help-center-channel";
import { StudioHelpCenterHost } from "./StudioHelpCenterHost";

afterEach(cleanup);

async function openHelp(section: Parameters<typeof openStudioHelpCenter>[0]) {
  render(<StudioHelpCenterHost />);
  await act(async () => {
    openStudioHelpCenter(section);
  });
  // 첫 열기는 lazy 청크 로드 + 검색 색인 구성이 함께 일어나 기본 1초 타임아웃을 넘긴다.
  return screen.findByTestId("studio-help-center", undefined, { timeout: 10_000 });
}

describe("StudioHelpCenterHost", () => {
  it("요청 전에는 아무것도 그리지 않는다", () => {
    render(<StudioHelpCenterHost />);
    expect(screen.queryByTestId("studio-help-center")).toBeNull();
  });

  it("메뉴 요청을 받아 해당 구역을 연다", async () => {
    const dialog = await openHelp({ section: "terminology" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "CSP · Photoshop 용어 사전",
    );
  });

  it("용어 사전은 실제 별칭을 그려 준다", async () => {
    await openHelp({ section: "terminology" });
    const search = screen.getByPlaceholderText(/Paint Bucket/u);
    fireEvent.change(search, { target: { value: "Paint Bucket" } });
    expect(screen.getByText(/채우기/u)).toBeTruthy();
  });

  it("현재 도구 구역은 산문 도움말이 없다는 사실을 화면에 적는다", async () => {
    await openHelp({ section: "current-tool", toolCommandId: "tool.pen" });
    expect(screen.getByText(/산문 도움말 문서는 아직 없습니다/u)).toBeTruthy();
    // 비어 있다고 말하는 그 도움말 노드 id 를 그대로 밝힌다.
    expect(screen.getByText("help/tool/pen")).toBeTruthy();
    // 타사 별칭 칩은 카탈로그 실측치에서 나온다.
    expect(screen.getByText(/Freehand Brush Tool/u)).toBeTruthy();
  });

  it("도구를 모르면 추측하지 않는다", async () => {
    await openHelp({ section: "current-tool" });
    expect(screen.getByText(/확인하지 못했습니다/u)).toBeTruthy();
  });

  it("버그 리포트 구역은 담기는 것과 빠지는 것을 먼저 보여 준다", async () => {
    await openHelp({ section: "bug-report" });
    expect(screen.getByText("담기는 것")).toBeTruthy();
    expect(screen.getByText("담기지 않는 것")).toBeTruthy();
    for (const row of [...STUDIO_BUG_REPORT_INCLUDED, ...STUDIO_BUG_REPORT_EXCLUDED]) {
      expect(screen.getByText(row), row).toBeTruthy();
    }
  });

  it("구역을 바꿀 수 있고 Esc 로 닫힌다", async () => {
    await openHelp({ section: "terminology" });
    fireEvent.click(screen.getByRole("button", { name: "복구 가이드" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "복구 가이드",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("studio-help-center")).toBeNull();
  });

  it("닫은 뒤 포커스를 도움말을 연 트리거로 돌려준다", async () => {
    // 회귀 근거(브라우저 실측 2026-08-08): 도움말 9개 표면 중 튜토리얼·단축키 둘만 트리거로
    // 복귀했고, 도움말 센터 6개 구역과 통합 검색은 전부 `document.body` 로 떨어졌다.
    // 복원은 호스트가 거는 그물 한 곳이 책임진다 — 구역마다 따로 기억하지 않는다.
    const trigger = document.createElement("button");
    trigger.setAttribute("data-studio-main-menu-trigger", "help");
    document.body.append(trigger);
    trigger.focus();

    await openHelp({ section: "diagnostics" });
    expect(document.activeElement).not.toBe(trigger);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(screen.queryByTestId("studio-help-center")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });
});
