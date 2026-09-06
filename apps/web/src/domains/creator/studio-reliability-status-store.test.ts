import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStudioReliabilityChannel,
  composeStudioSafeModeQuality,
  describeStudioSafeModeReason,
  enterStudioSafeMode,
  exitStudioSafeModeManually,
  getStudioReliabilityStatusSnapshot,
  isStudioSafeModeActive,
  reportStudioReliabilitySignal,
  resetStudioReliabilityStatus,
  resolveStudioSafeModeReason,
  STUDIO_SAFE_MODE_FULL_QUALITY,
  studioSafeModeQuality,
  subscribeStudioReliabilityStatus,
} from "./studio-reliability-status-store";

afterEach(() => {
  resetStudioReliabilityStatus();
});

describe("studio reliability status store", () => {
  it("surfaces a reported failure on the snapshot the status rail reads", () => {
    expect(getStudioReliabilityStatusSnapshot().save).toBeNull();

    reportStudioReliabilitySignal({
      channel: "save",
      level: "failed",
      title: "임시저장에 실패했습니다",
      at: 10,
    });

    const snapshot = getStudioReliabilityStatusSnapshot();
    expect(snapshot.save?.level).toBe("failed");
    expect(snapshot.save?.title).toBe("임시저장에 실패했습니다");
  });

  it("notifies subscribers once per distinct signal and never for a repeat", () => {
    const listener = vi.fn();
    subscribeStudioReliabilityStatus(listener);

    const signal = {
      channel: "gpu",
      level: "degraded",
      title: "GPU 연결이 끊겼습니다",
      at: 1,
    } as const;
    reportStudioReliabilitySignal(signal);
    const first = getStudioReliabilityStatusSnapshot();
    reportStudioReliabilitySignal({ ...signal });

    expect(listener).toHaveBeenCalledTimes(1);
    // 같은 내용 재보고는 스냅샷 참조를 바꾸지 않아 렌더를 유발하지 않는다.
    expect(getStudioReliabilityStatusSnapshot()).toBe(first);
  });

  it("keeps a stable snapshot identity while nothing changes", () => {
    expect(getStudioReliabilityStatusSnapshot()).toBe(
      getStudioReliabilityStatusSnapshot(),
    );
  });

  it("clears a channel back to silence once it recovers", () => {
    reportStudioReliabilitySignal({
      channel: "storage",
      level: "failed",
      title: "저장소 압박",
      at: 2,
    });
    clearStudioReliabilityChannel("storage");
    expect(getStudioReliabilityStatusSnapshot().storage).toBeNull();
  });

  it("enters safe mode with the reason and a lowered quality, never touching the document", () => {
    enterStudioSafeMode("gpu-device-lost", 100);

    const { safeMode } = getStudioReliabilityStatusSnapshot();
    expect(safeMode.active).toBe(true);
    expect(safeMode.reasons).toEqual(["gpu-device-lost"]);
    expect(safeMode.enteredAt).toBe(100);
    expect(safeMode.quality.gpuLanesDisabled).toBe(true);
    expect(safeMode.quality.livingInkSuspended).toBe(true);
    // 문서 의미는 손대지 않는다 — 강제 지점이 있는 품질 축만 있다.
    expect(Object.keys(safeMode.quality).sort()).toEqual([
      "gpuLanesDisabled",
      "livingInkSuspended",
    ]);
  });

  it("accumulates reasons and only leaves safe mode when the last one resolves", () => {
    enterStudioSafeMode("gpu-device-lost", 1);
    enterStudioSafeMode("storage-pressure", 2);
    expect(getStudioReliabilityStatusSnapshot().safeMode.reasons).toEqual([
      "gpu-device-lost",
      "storage-pressure",
    ]);
    // 진입 시각은 첫 사유 기준을 유지한다.
    expect(getStudioReliabilityStatusSnapshot().safeMode.enteredAt).toBe(1);

    resolveStudioSafeModeReason("gpu-device-lost");
    expect(isStudioSafeModeActive()).toBe(true);
    // GPU 사유가 풀렸으니 GPU 레인은 돌아오고, 저장소 사유의 저하만 남는다.
    expect(studioSafeModeQuality().gpuLanesDisabled).toBe(false);
    expect(studioSafeModeQuality().livingInkSuspended).toBe(true);

    resolveStudioSafeModeReason("storage-pressure");
    expect(isStudioSafeModeActive()).toBe(false);
    expect(studioSafeModeQuality()).toEqual(STUDIO_SAFE_MODE_FULL_QUALITY);
  });

  it("ignores a duplicate reason and an unknown resolve", () => {
    enterStudioSafeMode("gpu-device-lost", 1);
    enterStudioSafeMode("gpu-device-lost", 5);
    expect(getStudioReliabilityStatusSnapshot().safeMode.reasons).toEqual([
      "gpu-device-lost",
    ]);

    resolveStudioSafeModeReason("storage-pressure");
    expect(isStudioSafeModeActive()).toBe(true);
  });

  it("lets the user leave safe mode manually and re-enters on a new failure", () => {
    enterStudioSafeMode("gpu-device-lost", 1);
    exitStudioSafeModeManually();

    const dismissed = getStudioReliabilityStatusSnapshot().safeMode;
    expect(dismissed.active).toBe(false);
    expect(dismissed.manuallyDismissed).toBe(true);
    expect(dismissed.quality).toEqual(STUDIO_SAFE_MODE_FULL_QUALITY);

    // 수동 해제가 이후의 실패를 무음으로 만들면 그 자체가 숨은 실패다.
    enterStudioSafeMode("storage-pressure", 9);
    expect(getStudioReliabilityStatusSnapshot().safeMode.active).toBe(true);
    expect(getStudioReliabilityStatusSnapshot().safeMode.manuallyDismissed).toBe(false);
  });

  it("composes the lowest quality across reasons", () => {
    expect(composeStudioSafeModeQuality([])).toEqual(STUDIO_SAFE_MODE_FULL_QUALITY);
    expect(composeStudioSafeModeQuality(["storage-pressure"])).toEqual({
      gpuLanesDisabled: false,
      livingInkSuspended: true,
    });
    expect(
      composeStudioSafeModeQuality(["gpu-device-lost", "storage-pressure"]),
    ).toEqual({
      gpuLanesDisabled: true,
      livingInkSuspended: true,
    });
  });

  it("describes every reason in user-facing Korean", () => {
    for (const reason of [
      "gpu-device-lost",
      "gpu-permanently-demoted",
      "storage-pressure",
      "manual",
    ] as const) {
      expect(describeStudioSafeModeReason(reason).length).toBeGreaterThan(0);
    }
  });
});
