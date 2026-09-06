// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterShaperMobileSheet } from "./CharacterShaperMobileSheet";

afterEach(cleanup);

describe("CharacterShaperMobileSheet", () => {
  it("renders a labelled region with a slider handle reflecting the snap state", () => {
    const onStateChange = vi.fn();
    render(
      <CharacterShaperMobileSheet state="half" onStateChange={onStateChange} title="프리셋과 정밀 조절">
        <p>내용</p>
      </CharacterShaperMobileSheet>,
    );
    const region = screen.getByRole("region", { name: "프리셋과 정밀 조절" });
    expect(region.getAttribute("data-character-shaper-sheet")).toBe("half");
    const handle = screen.getByRole("slider");
    expect(handle.getAttribute("aria-valuenow")).toBe("1");
    expect(handle.getAttribute("aria-valuetext")).toBe("시트 높이 반쯤 열림");
    expect(handle.getAttribute("aria-label")).toContain("위아래로 밀거나 눌러");
    expect(screen.getByText("내용")).toBeTruthy();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onStateChange).toHaveBeenLastCalledWith("full");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onStateChange).toHaveBeenLastCalledWith("collapsed");
    fireEvent.click(handle);
    expect(onStateChange).toHaveBeenLastCalledWith("full");
    fireEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(onStateChange).toHaveBeenLastCalledWith("collapsed");
  });

  it("hides the body when collapsed and offers 펼치기", () => {
    const onStateChange = vi.fn();
    render(
      <CharacterShaperMobileSheet state="collapsed" onStateChange={onStateChange} title="프리셋과 정밀 조절">
        <p>내용</p>
      </CharacterShaperMobileSheet>,
    );
    expect(screen.getByText("내용").closest("[hidden]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "펼치기" }));
    expect(onStateChange).toHaveBeenLastCalledWith("half");
    const handle = screen.getByRole("slider");
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onStateChange).toHaveBeenLastCalledWith("collapsed");
  });
});
