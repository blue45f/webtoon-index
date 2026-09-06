// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dismissStudioRejectedStroke,
  getStudioRejectedStrokeRecords,
  recordStudioRejectedStroke,
  resetStudioRejectedStrokeRecovery,
  restoreStudioRejectedStroke,
} from "./studio-rejected-stroke-recovery";
import {
  restoreStudioRejectedStrokeIntoDocument,
  studioRejectedLiveSurfaceMessage,
  useStudioRejectedStrokeRecoveryHost,
} from "./studio-rejected-stroke-recovery-host";

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

function record(pageId: string): StudioRejectedStrokeRecord {
  return Object.freeze({
    id: stroke.id,
    pageId,
    stroke: Object.freeze(structuredClone(stroke)),
    provider: "WebGPU 라이브 잉크",
    reason: "device-lost",
    at: 1,
  });
}

afterEach(() => {
  cleanup();
  resetStudioRejectedStrokeRecovery();
});

describe("restoreStudioRejectedStrokeIntoDocument", () => {
  it("re-queues the geometry under a fresh id through the ordinary deferred commit", () => {
    const queued: DrawEl[] = [];
    const outcome = restoreStudioRejectedStrokeIntoDocument(
      record("page-1"),
      "page-1",
      (finished) => queued.push(finished),
      () => "fresh-id",
    );
    expect(outcome).toEqual({ status: "restored", recordId: "rejected-1", restoredStrokeId: "fresh-id" });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ id: "fresh-id", points: [0, 0, 10, 10, 20, 18] });
    // The document receives its own mutable copy, never the frozen snapshot.
    expect(Object.isFrozen(queued[0]!.points)).toBe(false);
  });

  it("refuses a record from another page and queues nothing", () => {
    const queue = vi.fn();
    expect(restoreStudioRejectedStrokeIntoDocument(record("page-2"), "page-1", queue)).toMatchObject({
      status: "refused",
      recordId: "rejected-1",
    });
    expect(queue).not.toHaveBeenCalled();
  });
});

describe("useStudioRejectedStrokeRecoveryHost", () => {
  it("registers the restorer for the mount, follows the latest page, and unregisters on unmount", () => {
    const queue = vi.fn();
    const view = renderHook(
      (input: { activePageId: string }) =>
        useStudioRejectedStrokeRecoveryHost({
          activePageId: input.activePageId,
          queueDeferredStrokeCommit: queue,
        }),
      { initialProps: { activePageId: "page-1" } },
    );

    // Salvage uses the active page by default and an explicit page when given.
    expect(view.result.current.salvageRejectedStroke(stroke, "WebGPU 라이브 잉크", "timeout")).toEqual({
      action: "salvage",
      strokeId: "rejected-1",
    });
    expect(getStudioRejectedStrokeRecords()[0]).toMatchObject({ pageId: "page-1" });
    dismissStudioRejectedStroke("rejected-1");
    recordStudioRejectedStroke({ stroke, pageId: "page-2", provider: "습식 매체", reason: "x" });

    // Page 2 record while page 1 is active → refused; after switching pages → restored.
    expect(restoreStudioRejectedStroke("rejected-1")).toMatchObject({ status: "refused" });
    view.rerender({ activePageId: "page-2" });
    expect(restoreStudioRejectedStroke("rejected-1")).toMatchObject({ status: "restored" });
    expect(queue).toHaveBeenCalledTimes(1);
    expect(getStudioRejectedStrokeRecords()).toHaveLength(0);

    recordStudioRejectedStroke({ stroke, pageId: "page-2", provider: "습식 매체", reason: "x" });
    view.unmount();
    expect(restoreStudioRejectedStroke("rejected-1")).toEqual({
      status: "unavailable",
      recordId: "rejected-1",
    });
  });
});

describe("studioRejectedLiveSurfaceMessage", () => {
  it("tells the user whether the finished mark survived", () => {
    expect(studioRejectedLiveSurfaceMessage("WebGPU 라이브 잉크", "사유: timeout", true)).toContain(
      "'획 복구'로 되살릴 수 있습니다",
    );
    expect(studioRejectedLiveSurfaceMessage("WebGPU 라이브 잉크", "사유: timeout", false)).toContain(
      "현재 획을 취소했습니다",
    );
  });
});
