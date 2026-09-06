import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioGpuPinReceiptWatchdog } from "./studio-webgpu-pin-receipt-watchdog";

afterEach(() => {
  vi.useRealTimers();
});

describe("StudioGpuPinReceiptWatchdog", () => {
  it("keeps an absolute first-visible deadline during a 60 Hz append burst", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new StudioGpuPinReceiptWatchdog({ timeoutMs: 300, onTimeout });

    watchdog.begin("frame:1");
    for (let frame = 2; frame <= 19; frame += 1) {
      vi.advanceTimersByTime(16);
      watchdog.request(`frame:${frame}`);
    }
    vi.advanceTimersByTime(12);

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith("first-visible", "frame:19");
  });

  it("does not let later requests extend the first post-visible progress deadline", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new StudioGpuPinReceiptWatchdog({ timeoutMs: 300, onTimeout });

    watchdog.begin("frame:1");
    expect(watchdog.receipt("frame:1")).toBe(true);
    watchdog.request("frame:2");
    vi.advanceTimersByTime(200);
    watchdog.request("frame:3");
    vi.advanceTimersByTime(100);

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith("progress", "frame:3");
  });

  it("clears a deadline only for the exact current receipt", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new StudioGpuPinReceiptWatchdog({ timeoutMs: 300, onTimeout });

    watchdog.begin("frame:1");
    watchdog.request("frame:2");
    expect(watchdog.hasExactReceipt("frame:2")).toBe(false);
    expect(watchdog.receipt("frame:1")).toBe(false);
    vi.advanceTimersByTime(299);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(watchdog.receipt("frame:2")).toBe(true);
    expect(watchdog.hasExactReceipt("frame:2")).toBe(true);
    vi.advanceTimersByTime(1);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("accepts a synchronous receipt recorded just before the request is armed", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new StudioGpuPinReceiptWatchdog({ timeoutMs: 300, onTimeout });

    expect(watchdog.receipt("frame:1")).toBe(false);
    watchdog.begin("frame:1");
    vi.advanceTimersByTime(300);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("lets one request carry its own budget without moving the live deadline", () => {
    // 완성된 획의 최종 영수증은 라이브 지연 예산으로 재면 안 된다 — 지연 커밋 렌더가 한 프레임
    // 예산을 넘기는 순간 제품이 그 획을 지웠다("현재 획을 취소했습니다").
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new StudioGpuPinReceiptWatchdog({ timeoutMs: 300, onTimeout });

    watchdog.begin("frame:1");
    expect(watchdog.receipt("frame:1")).toBe(true);
    watchdog.request("terminal:1", 2_000);
    vi.advanceTimersByTime(1_500);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith("progress", "terminal:1");
  });

  it("applies a terminal budget that arrives while a pointer-frame deadline is outstanding", () => {
    // 실제 순서는 항상 이렇다: 포인터 프레임이 300 ms 시한을 걸어둔 채로 포인터업의 최종
    // 요청이 도착한다. 그 시한을 그대로 물려받으면 2000 ms 예산은 한 번도 적용되지 않고
    // 완성된 획이 취소된다.
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new StudioGpuPinReceiptWatchdog({ timeoutMs: 300, onTimeout });

    watchdog.begin("frame:1");
    expect(watchdog.receipt("frame:1")).toBe(true);
    watchdog.request("frame:2");
    vi.advanceTimersByTime(120);
    watchdog.request("terminal:1", 2_000);
    vi.advanceTimersByTime(500);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_600);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith("progress", "terminal:1");
  });

  it("keeps the live budget for a pointer frame that passes no override", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new StudioGpuPinReceiptWatchdog({ timeoutMs: 300, onTimeout });

    watchdog.begin("frame:1");
    expect(watchdog.receipt("frame:1")).toBe(true);
    watchdog.request("frame:2");
    vi.advanceTimersByTime(301);

    expect(onTimeout).toHaveBeenCalledWith("progress", "frame:2");
  });
});
