// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStudioStableHandlers } from "./studio-stable-handlers";

describe("useStudioStableHandlers", () => {
  it("keeps the handler bag identity while invoking the latest committed closure", () => {
    const effect = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useStudioStableHandlers({
          readLatest: () => value,
          writeLatest: () => effect(value),
        }),
      { initialProps: { value: "before" } },
    );
    const initialHandlers = result.current;

    expect(initialHandlers.readLatest()).toBe("before");
    initialHandlers.writeLatest();
    expect(effect).toHaveBeenLastCalledWith("before");

    rerender({ value: "after" });

    expect(result.current).toBe(initialHandlers);
    expect(initialHandlers.readLatest()).toBe("after");
    initialHandlers.writeLatest();
    expect(effect).toHaveBeenLastCalledWith("after");
  });
});
