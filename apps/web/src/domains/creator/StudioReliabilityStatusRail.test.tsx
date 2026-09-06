// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetStudioDestructiveActionLedger,
  setStudioDestructiveConfirmPresenter,
} from "./studio-destructive-action-preview";
import {
  settleStudioDestructiveCommit,
  studioDeleteCheckpointRequest,
  studioRemoveEmeresUnderlaysRequest,
} from "./studio-destructive-command-catalog";
import {
  enterStudioSafeMode,
  getStudioReliabilityStatusSnapshot,
  reportStudioReliabilitySignal,
  resetStudioReliabilityStatus,
} from "./studio-reliability-status-store";
import { disposeStudioSafeModeRuntime } from "./studio-safe-mode-runtime";
import { StudioReliabilityStatusRail } from "./StudioReliabilityStatusRail";

afterEach(() => {
  cleanup();
  disposeStudioSafeModeRuntime();
  resetStudioReliabilityStatus();
  resetStudioDestructiveActionLedger();
});

describe("StudioReliabilityStatusRail", () => {
  it("costs the canvas nothing while nothing has failed", () => {
    // 예전에는 "저장·GPU 이상 없음" 한 줄이 흐름 안에서 26px(글 18px + mb 8px)을 상시
    // 예약했다. 그 줄은 아무것도 알려주지 않으면서 그리기 면적만 먹었다.
    render(<StudioReliabilityStatusRail />);

    expect(screen.queryByText("저장·GPU 이상 없음")).toBeNull();
    expect(document.querySelector("[data-studio-reliability-idle]")).toBeNull();
    expect(document.querySelector("[data-studio-safe-mode-banner]")).toBeNull();
    // 조용할 때는 고지(live region) 자체가 없다 — 읽어 줄 새 소식이 없기 때문.
    expect(screen.queryAllByRole("status")).toEqual([]);

    const rail = document.querySelector("[data-studio-reliability-status-rail]");
    expect(rail).not.toBeNull();
    expect(rail?.getAttribute("data-studio-reliability-tone")).toBe("quiet");
    // 흐름 밖 계약: 무엇이 켜지든 캔버스 스테이지 기하는 바뀌지 않는다.
    expect(rail?.className).toContain("absolute");
    expect(rail?.className).toContain("pointer-events-none");
  });

  it("still exposes save·GPU·storage on demand through a focusable chip", () => {
    render(<StudioReliabilityStatusRail />);

    const chip = screen.getByRole("button", { name: "저장·GPU·저장소 상태 · 이상 없음" });
    // 마우스 호버 전용이 아니다 — 버튼이므로 탭 포커스와 Enter/Space 로 열린다.
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.getAttribute("aria-controls")).toBe("studio-reliability-detail");
    expect(document.getElementById("studio-reliability-detail")).toBeNull();

    act(() => {
      fireEvent.click(chip);
    });

    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const detail = document.getElementById("studio-reliability-detail");
    expect(detail).not.toBeNull();
    expect(
      detail?.querySelector('[data-studio-reliability-detail-channel="save"]')?.textContent,
    ).toBe("이상 없음");
    expect(
      detail?.querySelector('[data-studio-reliability-detail-channel="gpu"]')?.textContent,
    ).toBe("이상 없음");
    expect(
      detail?.querySelector('[data-studio-reliability-detail-channel="storage"]')?.textContent,
    ).toBe("이상 없음");
    expect(
      detail?.querySelector('[data-studio-reliability-detail-channel="safe-mode"]')?.textContent,
    ).toBe("꺼짐");

    act(() => {
      fireEvent.keyDown(chip, { key: "Escape" });
    });
    expect(document.getElementById("studio-reliability-detail")).toBeNull();
  });

  it("reads the current failure back out of the on-demand panel", () => {
    render(<StudioReliabilityStatusRail />);

    act(() => {
      reportStudioReliabilitySignal({
        channel: "save",
        level: "failed",
        title: "임시저장에 실패했습니다",
        at: 1,
      });
    });

    const chip = screen.getByRole("button", {
      name: "저장·GPU·저장소 상태 · 처리하지 못한 실패 있음",
    });
    act(() => {
      fireEvent.click(chip);
    });

    expect(
      document.querySelector('[data-studio-reliability-detail-channel="save"]')?.textContent,
    ).toBe("임시저장에 실패했습니다");
    expect(
      document.querySelector('[data-studio-reliability-detail-channel="gpu"]')?.textContent,
    ).toBe("이상 없음");
  });

  it("brings a GPU demotion that used to be console-only onto the screen", () => {
    render(<StudioReliabilityStatusRail />);

    act(() => {
      reportStudioReliabilitySignal({
        channel: "gpu",
        level: "degraded",
        title: "GPU 연결이 끊겨 선택한 GPU 기능을 사용할 수 없습니다",
        detail: "그림은 그대로예요.",
        at: 1,
      });
    });

    const row = document.querySelector('[data-studio-reliability-signal="gpu"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-studio-reliability-level")).toBe("degraded");
    // 실제 문제는 예전 그대로 스스로 튀어나오고, 스크린 리더에도 그대로 읽힌다.
    expect(row?.getAttribute("role")).toBe("status");
    expect(row?.getAttribute("aria-live")).toBe("polite");
    expect(
      screen.getByText("GPU 연결이 끊겨 선택한 GPU 기능을 사용할 수 없습니다"),
    ).toBeTruthy();
    expect(screen.getByText("그림은 그대로예요.")).toBeTruthy();
    expect(
      document
        .querySelector("[data-studio-reliability-status-rail]")
        ?.getAttribute("data-studio-reliability-tone"),
    ).toBe("degraded");
  });

  it("shows each failing channel independently", () => {
    render(<StudioReliabilityStatusRail />);

    act(() => {
      reportStudioReliabilitySignal({
        channel: "save",
        level: "failed",
        title: "임시저장에 실패했습니다",
        at: 1,
      });
      reportStudioReliabilitySignal({
        channel: "storage",
        level: "failed",
        title: "저장 공간이 부족합니다",
        at: 2,
      });
    });

    expect(document.querySelector('[data-studio-reliability-signal="save"]')).not.toBeNull();
    expect(document.querySelector('[data-studio-reliability-signal="storage"]')).not.toBeNull();
  });

  it("announces safe mode with its reasons and lets the user leave it", () => {
    render(<StudioReliabilityStatusRail />);

    act(() => {
      enterStudioSafeMode("gpu-permanently-demoted", 5);
    });

    const banner = document.querySelector("[data-studio-safe-mode-banner]");
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("role")).toBe("status");
    expect(screen.getByText(/그림과 문서는 그대로예요/)).toBeTruthy();
    expect(
      screen.getByText(/GPU가 반복해서 끊겨 이번 세션의 GPU 기능을 중단했습니다/),
    ).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "안전 모드 해제" }));
    });

    expect(document.querySelector("[data-studio-safe-mode-banner]")).toBeNull();
    expect(getStudioReliabilityStatusSnapshot().safeMode.manuallyDismissed).toBe(true);
  });

  it("offers an undo round trip after a reversible destruction", () => {
    const undo = vi.fn();
    render(<StudioReliabilityStatusRail />);

    act(() => {
      settleStudioDestructiveCommit(studioRemoveEmeresUnderlaysRequest(4), true, undo);
    });

    expect(screen.getByText(/이메레스 밑그림 4개/)).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    });

    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "실행 취소" })).toBeNull();
  });

  it("never offers undo for an irreversible destruction", () => {
    setStudioDestructiveConfirmPresenter(() => true);
    render(<StudioReliabilityStatusRail />);

    act(() => {
      settleStudioDestructiveCommit(
        studioDeleteCheckpointRequest({ checkpointName: "1화" }),
        true,
        () => undefined,
      );
    });

    expect(screen.getByText(/영구히 지웠어요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "실행 취소" })).toBeNull();
    expect(screen.getByRole("button", { name: "닫기" })).toBeTruthy();
  });

  it("keeps a refused destruction on screen instead of letting it vanish", () => {
    render(<StudioReliabilityStatusRail />);

    act(() => {
      settleStudioDestructiveCommit(studioRemoveEmeresUnderlaysRequest(4), false);
    });

    const notice = document.querySelector("[data-studio-destructive-action-notice]");
    expect(notice?.getAttribute("data-studio-destructive-outcome")).toBe("refused");
    expect(screen.getByText(/적용하지 못했습니다/)).toBeTruthy();
  });
});
