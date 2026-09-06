// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getStudio2dAssetMetadata, studio2dDisplayName } from "./studio-2d-asset-quality";
import { BG_SCENES, groupBgScenes } from "./studio-bg-scenes";
import { BG_SCENES_EXTRA } from "./studio-bg-scenes-extra";
import { Studio2dSceneBrowser } from "./Studio2dSceneBrowser";

import type { Studio2dScene } from "./studio-2d-asset-quality";

const groups = groupBgScenes([...BG_SCENES, ...BG_SCENES_EXTRA]);
const rooftop = BG_SCENES.find((scene) => scene.id === "webtoon-rooftop-sunset")!;
const title = studio2dDisplayName(rooftop);

function Harness({ onPick = vi.fn(), disabled = false, initialGenre = "all" }: {
  onPick?: (scene: Studio2dScene) => void;
  disabled?: boolean;
  initialGenre?: string;
}) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState(initialGenre);
  return <Studio2dSceneBrowser groups={groups} query={query} onQueryChange={setQuery} genre={genre} onGenreChange={setGenre}
    loading={false} error={null} disabled={disabled} onPick={onPick} />;
}

function loadImage(image: HTMLElement, scene = rooftop, overrideWidth?: number) {
  const metadata = getStudio2dAssetMetadata(scene)!;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: overrideWidth ?? metadata.width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: metadata.height });
  fireEvent.load(image);
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1, item: () => null,
    [Symbol.iterator]: function* iterator() { yield {} as DOMRect; } } as DOMRectList);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("2D scene browser", () => {
  it("pages the complete production catalog without counting any scene twice", () => {
    render(<Harness />);
    expect(screen.getByRole("status").textContent).toBe("64개 장면");
    expect(document.querySelectorAll("[data-studio-2d-asset]")).toHaveLength(48);
    fireEvent.click(screen.getByRole("button", { name: "장면 더 보기 (16개 남음)" }));
    const ids = [...document.querySelectorAll("[data-studio-2d-asset]")].map((node) => node.getAttribute("data-studio-2d-asset"));
    expect(ids).toHaveLength(64);
    expect(new Set(ids).size).toBe(64);
    expect(screen.queryByRole("button", { name: /장면 더 보기/u })).toBeNull();
  });
  it("returns to the first results when filters or search change after scrolling", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "장면 더 보기 (16개 남음)" }));
    const grid = document.querySelector<HTMLElement>("[data-studio-2d-grid]")!;
    grid.scrollTop = 800;
    fireEvent.change(screen.getByLabelText("소재 구분"), { target: { value: "recommended" } });
    expect(grid.scrollTop).toBe(0);
    expect(document.querySelectorAll("[data-studio-2d-asset]")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(document.querySelectorAll("[data-studio-2d-asset]")).toHaveLength(48);
    expect(screen.getByRole("button", { name: "장면 더 보기 (16개 남음)" })).toBeTruthy();
  });
  it("finds metadata tags and independent genre/recommendation filters", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("배경 이름·장소·분위기 검색"), { target: { value: "실내 태블릿" } });
    expect(document.querySelectorAll("[data-studio-2d-asset]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    fireEvent.change(screen.getByLabelText("소재 구분"), { target: { value: "recommended" } });
    expect(document.querySelectorAll("[data-studio-2d-asset]")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("장르"), { target: { value: "로맨스" } });
    expect(document.querySelectorAll("[data-studio-2d-asset]")).toHaveLength(1);
    expect(screen.getByText(title)).toBeTruthy();
  });
  it("recovers obsolete recommendation genre state without emptying the catalog", () => {
    render(<Harness initialGenre="추천" />);
    expect((screen.getByLabelText("장르") as HTMLSelectElement).value).toBe("all");
    expect(document.querySelectorAll("[data-studio-2d-asset]").length).toBeGreaterThan(0);
  });
  it("does not silently relax incompatible filters and provides a reset", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("소재 구분"), { target: { value: "large" } });
    fireEvent.change(screen.getByLabelText("원본 비율"), { target: { value: "portrait" } });
    expect(screen.getByText(/조건에 맞는 배경이 없습니다/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(document.querySelectorAll("[data-studio-2d-asset]").length).toBeGreaterThan(0);
  });
  it("blocks insertion until browser image decoding succeeds and passes the exact original scene", () => {
    const onPick = vi.fn(); render(<Harness onPick={onPick} />);
    const insert = screen.getByRole("button", { name: `${title} 삽입` });
    expect(insert.hasAttribute("disabled")).toBe(true);
    fireEvent.click(insert); expect(onPick).not.toHaveBeenCalled();
    loadImage(screen.getByAltText(title));
    fireEvent.click(insert); expect(onPick).toHaveBeenCalledExactlyOnceWith(rooftop);
  });
  it("keeps insertion disabled in master/busy mode even after decoding", () => {
    const onPick = vi.fn(); render(<Harness disabled onPick={onPick} />);
    loadImage(screen.getByAltText(title));
    fireEvent.click(screen.getByRole("button", { name: `${title} 삽입` }));
    expect(onPick).not.toHaveBeenCalled();
  });
  it("retries an image error without inserting a broken original", () => {
    render(<Harness />);
    const card = screen.getByAltText(title).closest("article")!;
    fireEvent.error(within(card).getByAltText(title));
    expect(within(card).queryByRole("button", { name: `${title} 삽입` })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "이미지 다시 불러오기" }));
    expect(within(card).getByRole("button", { name: `${title} 삽입` }).hasAttribute("disabled")).toBe(true);
    loadImage(within(card).getByAltText(title));
    expect(within(card).getByRole("button", { name: `${title} 삽입` }).hasAttribute("disabled")).toBe(false);
  });
  it("opens a separately labelled modal without inserting, supports pixel view and Escape", () => {
    const onPick = vi.fn(); render(<Harness onPick={onPick} />);
    const launcher = screen.getByRole("button", { name: `${title} 확대 미리보기` });
    launcher.focus(); fireEvent.click(launcher);
    const dialog = screen.getByRole("dialog", { name: title });
    expect(onPick).not.toHaveBeenCalled();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const image = within(dialog).getByAltText(title);
    loadImage(image);
    fireEvent.click(within(dialog).getByRole("button", { name: "원본 픽셀 보기" }));
    expect(image.style.width).toBe(`${getStudio2dAssetMetadata(rooftop)!.width}px`);
    expect(within(dialog).getByText(/이용 권리 기록 미확인/u)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });
  it("blocks metadata/dimension mismatch inside the modal", () => {
    const onPick = vi.fn(); render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: `${title} 확대 미리보기` }));
    const dialog = screen.getByRole("dialog", { name: title });
    loadImage(within(dialog).getByAltText(title), rooftop, 200);
    expect(within(dialog).getByRole("alert").textContent).toContain("재검수 전 삽입할 수 없습니다");
    fireEvent.click(within(dialog).getByRole("button", { name: "이 배경 삽입" }));
    expect(onPick).not.toHaveBeenCalled();
  });
  it("inserts only after full preview decoding and closes the modal", () => {
    const onPick = vi.fn(); render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: `${title} 확대 미리보기` }));
    const dialog = screen.getByRole("dialog", { name: title });
    const insert = within(dialog).getByRole("button", { name: "이 배경 삽입" });
    expect(insert.hasAttribute("disabled")).toBe(true);
    loadImage(within(dialog).getByAltText(title));
    fireEvent.click(insert);
    expect(onPick).toHaveBeenCalledExactlyOnceWith(rooftop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("preserves source aspect ratios and lazy-loads grid images", () => {
    render(<Harness />);
    const image = screen.getByAltText(title);
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.className).toContain("object-contain");
    expect(screen.getAllByText("소형 컷용 · 확대 주의")).toHaveLength(20);
  });
});
