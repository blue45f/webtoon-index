// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { studio2dDisplayName } from "./studio-2d-asset-quality";
import { BG_SCENES, groupBgScenes } from "./studio-bg-scenes";
import { BG_SCENES_EXTRA } from "./studio-bg-scenes-extra";
import { Studio2dSceneBrowser } from "./Studio2dSceneBrowser";

import type { Studio2dScene } from "./studio-2d-asset-quality";

const groups = groupBgScenes([...BG_SCENES, ...BG_SCENES_EXTRA]);
const rooftop = BG_SCENES.find((scene) => scene.id === "webtoon-rooftop-sunset")!;
const title = studio2dDisplayName(rooftop);

function Harness() {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("all");
  return <Studio2dSceneBrowser groups={groups} query={query} onQueryChange={setQuery} genre={genre} onGenreChange={setGenre}
    loading={false} error={null} disabled={false} onPick={vi.fn()} />;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1, item: () => null,
    [Symbol.iterator]: function* iterator() { yield {} as DOMRect; } } as DOMRectList);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("2D content discovery and source replacement", () => {
  it("exposes combined detail filters and resets all of them", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("장소·시간·문자 필터"));
    fireEvent.change(screen.getByLabelText("장소"), { target: { value: "실내" } });
    fireEvent.change(screen.getByLabelText("시간대"), { target: { value: "밤" } });
    fireEvent.click(screen.getByLabelText("문자 형태 없는 이미지 배경만"));
    fireEvent.change(screen.getByLabelText("소재 구분"), { target: { value: "large" } });
    expect(screen.getByRole("status").textContent).toBe("2개 장면");
    expect(screen.getByText("장소·시간·문자 필터 · 3개 적용")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getByRole("status").textContent).toBe("64개 장면");
    expect((screen.getByLabelText("장소") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("시간대") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("문자 형태 없는 이미지 배경만") as HTMLInputElement).checked).toBe(false);
  });
  it("can clear only detailed content conditions while preserving query and genre", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("배경 이름·장소·분위기 검색"), { target: { value: "태블릿" } });
    fireEvent.change(screen.getByLabelText("장르"), { target: { value: "일상·학원" } });
    fireEvent.click(screen.getByText("장소·시간·문자 필터"));
    fireEvent.change(screen.getByLabelText("장소"), { target: { value: "실외" } });
    expect(screen.getByText(/조건에 맞는 배경이 없습니다/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "장소·시간·문자 조건만 지우기" }));
    expect((screen.getByLabelText("배경 이름·장소·분위기 검색") as HTMLInputElement).value).toBe("태블릿");
    expect((screen.getByLabelText("장르") as HTMLSelectElement).value).toBe("일상·학원");
    expect(screen.getByRole("status").textContent).toBe("1개 장면");
  });
  it("resets pagination and scroll for every new content filter", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("장소·시간·문자 필터"));
    const grid = document.querySelector<HTMLElement>("[data-studio-2d-grid]")!;
    for (const [label, value] of [["장소", "실내"], ["시간대", "밤"]]) {
      grid.scrollTop = 700;
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(grid.scrollTop).toBe(0);
    }
    grid.scrollTop = 700;
    fireEvent.click(screen.getByLabelText("문자 형태 없는 이미지 배경만"));
    expect(grid.scrollTop).toBe(0);
  });
  it("shows embedded people and text warnings on cards before opening a preview", () => {
    render(<Harness />);
    const cafe = screen.getByAltText(studio2dDisplayName(BG_SCENES.find((item) => item.id === "webtoon-cafe")!)).closest("article")!;
    expect(within(cafe).getByText("인물 포함 · 문자 형태 포함")).toBeTruthy();
    expect(within(cafe).getByText("실내 · 낮")).toBeTruthy();
  });
  it("requires a fresh load when SVG bytes change under the same catalog ID", () => {
    const original: Studio2dScene = { id: "changing-vector", label: "벡터 변경", genre: "daily", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' };
    const replacement = { ...original, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>' };
    const onPick = vi.fn();
    const props = { query: "", onQueryChange: vi.fn(), genre: "all", onGenreChange: vi.fn(), loading: false, error: null, disabled: false, onPick };
    const { rerender } = render(<Studio2dSceneBrowser {...props} groups={[{ genre: "일상·학원", scenes: [original] }]} />);
    const oldImage = screen.getByAltText("벡터 변경");
    Object.defineProperty(oldImage, "naturalWidth", { value: 100 });
    Object.defineProperty(oldImage, "naturalHeight", { value: 100 });
    fireEvent.load(oldImage);
    expect(screen.getByRole("button", { name: "벡터 변경 삽입" }).hasAttribute("disabled")).toBe(false);
    rerender(<Studio2dSceneBrowser {...props} groups={[{ genre: "일상·학원", scenes: [replacement] }]} />);
    expect(screen.getByRole("button", { name: "벡터 변경 삽입" }).hasAttribute("disabled")).toBe(true);
    fireEvent.load(oldImage); // Late completion from the removed image cannot unlock the replacement.
    fireEvent.click(screen.getByRole("button", { name: "벡터 변경 삽입" }));
    expect(onPick).not.toHaveBeenCalled();
    const newImage = screen.getByAltText("벡터 변경");
    expect(newImage).not.toBe(oldImage);
    Object.defineProperty(newImage, "naturalWidth", { value: 200 });
    Object.defineProperty(newImage, "naturalHeight", { value: 100 });
    fireEvent.load(newImage);
    fireEvent.click(screen.getByRole("button", { name: "벡터 변경 삽입" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith(replacement);
  });
  it.each(["removed", "replaced"])("cannot insert a %s catalog source through an already-open preview", (change) => {
    const onPick = vi.fn();
    const props = { query: "", onQueryChange: vi.fn(), genre: "all", onGenreChange: vi.fn(), loading: false, error: null, disabled: false, onPick };
    const { rerender } = render(<Studio2dSceneBrowser {...props} groups={[{ genre: "로맨스", scenes: [rooftop] }]} />);
    fireEvent.click(screen.getByRole("button", { name: `${title} 확대 미리보기` }));
    expect(screen.getByRole("dialog", { name: title })).toBeTruthy();
    const next = change === "removed" ? [] : [{ ...rooftop, imgSrc: "/new-source.png" }];
    rerender(<Studio2dSceneBrowser {...props} groups={[{ genre: "로맨스", scenes: next }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Studio2dSceneBrowser {...props} groups={[{ genre: "로맨스", scenes: [rooftop] }]} />);
    expect(screen.queryByRole("dialog")).toBeNull(); // Reappearing assets must not reopen a dismissed preview.
    expect(onPick).not.toHaveBeenCalled();
  });
});
