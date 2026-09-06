// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioPatternFillPanel } from "./StudioPatternFillPanel";

afterEach(cleanup);

describe("StudioPatternFillPanel expanded swatches", () => {
  it("exposes the 24-pattern library behind a bounded searchable grid", () => {
    render(<StudioPatternFillPanel value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("패턴 24개");
    expect(screen.getByRole("searchbox", { name: "패턴 검색" }).className).toContain(
      "pointer-coarse:min-h-11"
    );
    expect(screen.getByRole("button", { name: "벌집" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "속도선" })).toBeTruthy();
  });

  it("finds a pattern by multiple Korean and English terms and applies it", () => {
    const onChange = vi.fn();
    render(<StudioPatternFillPanel value={null} onChange={onChange} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "패턴 검색" }), {
      target: { value: "hex 테크" },
    });
    expect(screen.getByRole("status").textContent).toContain("검색 결과 1개");
    fireEvent.click(screen.getByRole("button", { name: "벌집" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ patternId: "honeycomb" });
  });

  it("explains a search miss and restores the full catalog with the clear button", () => {
    render(<StudioPatternFillPanel value={null} onChange={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "패턴 검색" });

    fireEvent.change(search, { target: { value: "존재하지않는무늬xyz" } });
    expect(screen.getByText("일치하는 패턴이 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "패턴 검색어 지우기" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toContain("패턴 24개");
  });
});
