// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioVrmForgeRangeControl } from "./StudioVrmForgeRangeControl";

describe("StudioVrmForgeRangeControl", () => {
  it("supports slider, exact number, step, and reset input", () => {
    const onChange = vi.fn();
    const view = render(
      <StudioVrmForgeRangeControl
        label="얼굴 너비"
        value={1.05}
        minimum={0.84}
        maximum={1.18}
        step={0.01}
        defaultValue={1}
        unit="×"
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("slider", { name: "얼굴 너비" }), {
      target: { value: "1.1" },
    });
    expect(onChange).toHaveBeenLastCalledWith(1.1);

    fireEvent.click(screen.getByRole("button", { name: "얼굴 너비 한 단계 늘리기" }));
    expect(onChange).toHaveBeenLastCalledWith(1.06);

    fireEvent.change(screen.getByRole("spinbutton", { name: "얼굴 너비 정확한 값" }), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenLastCalledWith(1.18);

    fireEvent.click(screen.getByRole("button", { name: "얼굴 너비 기본값으로 복원" }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    view.unmount();
  });
});
