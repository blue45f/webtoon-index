import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { toast, useToastStore } from "../toast-store";

describe("toast-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("메시지를 큐에 추가하고 id 를 반환", () => {
    const id = toast("담았어요");
    expect(id).toBeGreaterThan(0);
    const list = useToastStore.getState().toasts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ message: "담았어요", tone: "default" });
  });

  it("빈/공백 메시지는 무시", () => {
    expect(toast("   ")).toBe(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("기본 지속시간 후 자동으로 사라진다", () => {
    toast("사라질 거예요");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2400);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("동시에 3개를 초과하면 가장 오래된 것을 밀어낸다", () => {
    toast("1");
    toast("2");
    toast("3");
    toast("4");
    const list = useToastStore.getState().toasts;
    expect(list).toHaveLength(3);
    expect(list.map((t) => t.message)).toEqual(["2", "3", "4"]);
  });

  it("dismiss 로 특정 토스트만 제거", () => {
    const id = toast("a");
    toast("b");
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["b"]);
  });

  it("tone 옵션을 보존", () => {
    toast("성공", { tone: "success" });
    expect(useToastStore.getState().toasts[0].tone).toBe("success");
  });
});
