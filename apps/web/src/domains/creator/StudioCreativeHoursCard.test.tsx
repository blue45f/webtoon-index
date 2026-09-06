// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCreativeWorkTimeTracker,
  recordCreativeActivity,
} from "./studio-creative-work-time-tracker";
import { StudioCreativeHoursCard } from "./StudioCreativeHoursCard";

afterEach(() => {
  cleanup();
});

describe("StudioCreativeHoursCard", () => {
  it("renders accumulated work time and stroke metrics", () => {
    let tracker = createCreativeWorkTimeTracker("project-1", 3600, 500, 0); // 1 hour, 500 strokes
    tracker = recordCreativeActivity(tracker, true, 10000); // 10s later

    render(<StudioCreativeHoursCard tracker={tracker} />);

    expect(screen.getByText("내 창작 시간 (Creative Hours)")).not.toBeNull();
    expect(screen.getByText(/1시간 0분/u)).not.toBeNull();
    expect(screen.getByText("501회")).not.toBeNull();
  });

  it("handles reset session callback", () => {
    const onReset = vi.fn();
    const tracker = createCreativeWorkTimeTracker("project-2", 120, 10, 0);

    render(<StudioCreativeHoursCard tracker={tracker} onResetSession={onReset} />);

    const resetBtn = screen.getByRole("button", { name: "세션 시간 초기화" });
    fireEvent.click(resetBtn);

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
