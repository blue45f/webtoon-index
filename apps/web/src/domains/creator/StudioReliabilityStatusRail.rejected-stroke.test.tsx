// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getStudioRejectedStrokeRecords,
  recordStudioRejectedStroke,
  resetStudioRejectedStrokeRecovery,
  setStudioRejectedStrokeRestorer,
} from "./studio-rejected-stroke-recovery";
import { resetStudioReliabilityStatus } from "./studio-reliability-status-store";
import { disposeStudioSafeModeRuntime } from "./studio-safe-mode-runtime";
import { StudioReliabilityStatusRail } from "./StudioReliabilityStatusRail";

import type { DrawEl } from "./studio-element-model";
import type { StudioRejectedStrokeRecord } from "./studio-rejected-stroke-recovery";

const stroke = {
  id: "rejected-1",
  type: "draw",
  kind: "freehand",
  mode: "pen",
  points: [0, 0, 10, 10, 20, 18],
  pressures: [0.5, 0.5, 0.5],
  stroke: "#111827",
  strokeWidth: 6,
} as DrawEl;

afterEach(() => {
  cleanup();
  disposeStudioSafeModeRuntime();
  resetStudioReliabilityStatus();
  resetStudioRejectedStrokeRecovery();
});

describe("StudioReliabilityStatusRail — rejected stroke recovery", () => {
  it("shows nothing until a provider rejects a finished stroke", () => {
    render(<StudioReliabilityStatusRail />);
    expect(document.querySelector("[data-studio-rejected-stroke-notice]")).toBeNull();
  });

  it("offers an explicit restore and a dismiss for a parked stroke", () => {
    render(<StudioReliabilityStatusRail />);
    act(() => {
      recordStudioRejectedStroke({
        stroke,
        pageId: "page-1",
        provider: "WebGPU 라이브 잉크",
        reason: "device-lost",
        at: 1,
      });
    });

    const notice = document.querySelector("[data-studio-rejected-stroke-notice]");
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("data-studio-rejected-stroke-id")).toBe("rejected-1");
    expect(notice?.textContent).toContain("WebGPU 라이브 잉크");
    expect(notice?.textContent).toContain("그린 획은 보존돼 있습니다");
    expect(notice?.textContent).toContain("device-lost");

    // No editor registered a restorer yet: the record stays and the user is told why.
    fireEvent.click(screen.getByRole("button", { name: "획 복구" }));
    expect(getStudioRejectedStrokeRecords()).toHaveLength(1);
    expect(document.querySelector("[data-studio-rejected-stroke-outcome]")?.textContent).toContain(
      "지금은 복구할 수 없습니다",
    );

    const restorer = vi.fn((record: StudioRejectedStrokeRecord) => ({
      status: "restored" as const,
      recordId: record.id,
      restoredStrokeId: "fresh-id",
    }));
    setStudioRejectedStrokeRestorer(restorer);
    fireEvent.click(screen.getByRole("button", { name: "획 복구" }));
    expect(restorer).toHaveBeenCalledTimes(1);
    expect(restorer.mock.calls[0]?.[0]).toMatchObject({ id: "rejected-1", pageId: "page-1" });
    expect(getStudioRejectedStrokeRecords()).toHaveLength(0);
    expect(document.querySelector("[data-studio-rejected-stroke-notice]")).toBeNull();
    expect(document.querySelector("[data-studio-rejected-stroke-outcome]")?.textContent).toContain(
      "획을 문서에 복구했습니다",
    );
  });

  it("keeps a refused restore and lets the user throw the stroke away", () => {
    setStudioRejectedStrokeRestorer(() => ({
      status: "refused" as const,
      recordId: "rejected-1",
      reason: "다른 페이지에서 그린 획입니다.",
    }));
    render(<StudioReliabilityStatusRail />);
    act(() => {
      recordStudioRejectedStroke({
        stroke,
        pageId: "page-2",
        provider: "습식 매체",
        reason: "unavailable/runtime-rejected",
        at: 1,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "획 복구" }));
    expect(getStudioRejectedStrokeRecords()).toHaveLength(1);
    expect(document.querySelector("[data-studio-rejected-stroke-outcome]")?.textContent).toContain(
      "다른 페이지에서 그린 획입니다.",
    );

    fireEvent.click(screen.getByRole("button", { name: "버리기" }));
    expect(getStudioRejectedStrokeRecords()).toHaveLength(0);
    expect(document.querySelector("[data-studio-rejected-stroke-notice]")).toBeNull();
    expect(document.querySelector("[data-studio-rejected-stroke-outcome]")).toBeNull();
  });
});
