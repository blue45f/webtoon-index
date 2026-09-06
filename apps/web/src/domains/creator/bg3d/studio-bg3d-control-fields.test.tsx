// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BgAnimationPlayhead,
  LtRangeControl,
  LtToggleRow,
  PanoramaRotationNumberField,
  Vec3Field,
} from "./studio-bg3d-control-fields";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Studio BG3D control fields", () => {
  it("routes range, toggle, and vector edits through their typed callbacks", () => {
    const onRangeChange = vi.fn();
    const onToggleChange = vi.fn();
    const onVectorCommit = vi.fn();
    render(
      <>
        <LtRangeControl
          id="light-strength"
          label="조명 세기"
          min={0}
          max={2}
          step={0.1}
          value={0.5}
          valueText="50%"
          onChange={onRangeChange}
        />
        <LtToggleRow checked={false} label="윤곽선" onChange={onToggleChange} />
        <Vec3Field
          label="위치"
          values={[1.234, 2, 3]}
          step={0.01}
          precision={2}
          touchFriendly
          onCommit={onVectorCommit}
        />
      </>,
    );

    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0]!, { target: { value: "1.4" } });
    const toggle = screen.getByRole("switch", { name: "윤곽선" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    const xInput = screen.getByRole("spinbutton", { name: "위치 X" }) as HTMLInputElement;
    expect(xInput.value).toBe("1.23");
    expect(xInput.closest("label")?.className).toContain("pointer-coarse:min-h-11");
    fireEvent.change(xInput, { target: { value: "4.25" } });

    expect(onRangeChange).toHaveBeenCalledWith(1.4);
    expect(onToggleChange).toHaveBeenCalledWith(true);
    expect(onVectorCommit).toHaveBeenCalledWith(0, 4.25);
  });

  it("clamps panorama drafts on blur and cancels them on Escape", () => {
    const onCommit = vi.fn();
    render(<PanoramaRotationNumberField value={15} onCommit={onCommit} />);
    const input = screen.getByRole("spinbutton", {
      name: "360도 환경 배경 수평 회전 각도",
    }) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "240" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenLastCalledWith(180);

    onCommit.mockClear();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-90" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(input.value).toBe("15");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("samples live animation time locally without turning timer ticks into commits", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const readLiveTime = vi.fn(() => 2.5);
    render(
      <BgAnimationPlayhead
        active
        modelId="model-1"
        playback={{
          clipIndex: 0,
          playing: true,
          loop: "repeat",
          timeSeconds: 1,
          timeScale: 1,
          weight: 1,
        }}
        durationSeconds={4}
        readLiveTime={readLiveTime}
        onCommit={onCommit}
      />,
    );

    expect(screen.getByRole("status", { name: "현재 애니메이션 시간" }).textContent).toContain(
      "1.00s / 4.00s",
    );
    act(() => vi.advanceTimersByTime(100));
    expect(readLiveTime).toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "현재 애니메이션 시간" }).textContent).toContain(
      "2.50s / 4.00s",
    );
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("slider", { name: "애니메이션 시간" }), {
      target: { value: "3" },
    });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(3);
  });
});
