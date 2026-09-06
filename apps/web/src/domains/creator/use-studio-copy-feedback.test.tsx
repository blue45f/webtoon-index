// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudioCopyFeedback } from "./use-studio-copy-feedback";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "execCommand");
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

function Harness({ resetMs = 1500 }: { resetMs?: number }) {
  const feedback = useStudioCopyFeedback(resetMs);
  return (
    <div>
      <button type="button" onClick={() => feedback.copy("a", "가")}>
        copy-a
      </button>
      <button type="button" onClick={() => feedback.copy("b", "나")}>
        copy-b
      </button>
      <span data-testid="a">{feedback.statusFor("a") ?? "idle"}</span>
      <span data-testid="b">{feedback.statusFor("b") ?? "idle"}</span>
    </div>
  );
}

describe("useStudioCopyFeedback", () => {
  it("성공한 항목만 copied 로 표시하고 resetMs 뒤 되돌린다", async () => {
    stubClipboard(() => Promise.resolve());
    render(<Harness resetMs={30} />);

    fireEvent.click(screen.getByText("copy-a"));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("copied"));
    expect(screen.getByTestId("b").textContent).toBe("idle");

    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("idle"));
  });

  it("두 경로가 모두 막히면 failed 를 남긴다 — 거짓 성공을 만들지 않는다", async () => {
    stubClipboard(() => Promise.reject(new Error("blocked")));
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
      writable: true,
    });
    render(<Harness />);

    fireEvent.click(screen.getByText("copy-a"));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("failed"));
  });

  it("연타 시 늦게 끝난 앞선 복사가 최신 뱃지를 덮지 않는다", async () => {
    const pending: (() => void)[] = [];
    stubClipboard(
      () =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        })
    );
    render(<Harness />);

    fireEvent.click(screen.getByText("copy-a"));
    fireEvent.click(screen.getByText("copy-b"));
    expect(pending).toHaveLength(2);

    // b(최신)를 먼저 끝내고, 그 뒤에 a(구식)를 끝낸다.
    pending[1]?.();
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("copied"));
    pending[0]?.();

    await Promise.resolve();
    expect(screen.getByTestId("a").textContent).toBe("idle");
    expect(screen.getByTestId("b").textContent).toBe("copied");
  });

  it("언마운트 뒤 리셋 타이머가 상태를 건드리지 않는다", async () => {
    stubClipboard(() => Promise.resolve());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(<Harness resetMs={20} />);

    fireEvent.click(screen.getByText("copy-a"));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("copied"));
    view.unmount();

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
