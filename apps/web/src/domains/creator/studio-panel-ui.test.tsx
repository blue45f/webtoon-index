// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studioToolButtonClass, StudioSliderRow } from "./studio-panel-ui";

afterEach(cleanup);

describe("studioToolButtonClass", () => {
  it("keeps dense top-toolbar controls at least 44px tall on narrow viewports", () => {
    const className = studioToolButtonClass(false, { dense: true });

    expect(className).toContain("max-lg:h-11");
    expect(className).toContain("max-lg:min-h-11");
  });
});

describe("StudioSliderRow", () => {
  it("preserves immediate controlled onChange behavior when onCommit is omitted", () => {
    const onChange = vi.fn();
    render(
      <StudioSliderRow
        label="불투명도"
        min={0}
        max={100}
        step={1}
        value={50}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByRole("slider"), { target: { value: "65" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(65);
  });

  it("commits one deferred slider value when the pointer interaction finishes", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <StudioSliderRow
        label="격자 크기"
        min={8}
        max={160}
        step={1}
        value={40}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
    const slider = screen.getByRole("slider");

    fireEvent.change(slider, { target: { value: "52" } });
    fireEvent.change(slider, { target: { value: "64" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    fireEvent.lostPointerCapture(slider);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenLastCalledWith(64);
  });

  it("rolls a cancelled pointer preview back without committing it", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <StudioSliderRow
        label="각도"
        min={0}
        max={90}
        step={1}
        value={30}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
    const slider = screen.getByRole("slider");

    fireEvent.change(slider, { target: { value: "55" } });
    fireEvent.pointerCancel(slider);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(30);
    expect((slider as HTMLInputElement).value).toBe("30");
  });

  it.each(["lostpointercapture", "Escape"])(
    "rolls a %s preview back without committing it",
    (ending) => {
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(
        <StudioSliderRow
          label="각도"
          min={0}
          max={90}
          step={1}
          value={30}
          onChange={onChange}
          onCommit={onCommit}
        />
      );
      const slider = screen.getByRole("slider");

      fireEvent.change(slider, { target: { value: "55" } });
      if (ending === "Escape") fireEvent.keyDown(slider, { key: "Escape" });
      else fireEvent.lostPointerCapture(slider);
      fireEvent.blur(slider);

      expect(onCommit).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenLastCalledWith(30);
      expect((slider as HTMLInputElement).value).toBe("30");
    }
  );

  it("rolls a pending preview back when its panel unmounts before blur", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const view = render(
      <StudioSliderRow
        label="셀 크기"
        min={8}
        max={200}
        step={1}
        value={40}
        onChange={onChange}
        onCommit={onCommit}
      />
    );

    fireEvent.change(screen.getByRole("slider"), { target: { value: "88" } });
    view.unmount();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(40);
  });

  it("commits a blur once but never commits again on the following lost-capture event", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <StudioSliderRow
        label="셀 크기"
        min={8}
        max={200}
        step={1}
        value={40}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
    const slider = screen.getByRole("slider");

    fireEvent.change(slider, { target: { value: "72" } });
    fireEvent.blur(slider);
    fireEvent.lostPointerCapture(slider);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenLastCalledWith(72);
  });

  it("exposes a 44px coarse target and blocks disabled range changes", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <StudioSliderRow
        label="셀 크기"
        min={8}
        max={200}
        step={1}
        value={40}
        disabled
        onChange={onChange}
        onCommit={onCommit}
      />
    );
    const slider = screen.getByRole("slider") as HTMLInputElement;

    expect(slider.disabled).toBe(true);
    expect(slider.className).toContain("pointer-coarse:h-11");
    fireEvent.change(slider, { target: { value: "72" } });
    fireEvent.pointerUp(slider);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
