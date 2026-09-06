// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { filterStudio2dScenes, getStudio2dAssetMetadata, STUDIO_2D_ASSET_METADATA, studio2dDisplayName } from "./studio-2d-asset-quality";
import { BG_SCENES, groupBgScenes } from "./studio-bg-scenes";
import { Studio2dSceneBrowser } from "./Studio2dSceneBrowser";
import { Studio2dScenePreview } from "./Studio2dScenePreview";

import type { Studio2dScene } from "./studio-2d-asset-quality";

const rooftop = BG_SCENES.find((scene) => scene.id === "webtoon-rooftop-sunset")!;
const title = studio2dDisplayName(rooftop);
function setPixels(image: HTMLElement, width = 1672, height = 941) {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
}
function browser(scene: Studio2dScene, onPick = vi.fn()) {
  return <Studio2dSceneBrowser groups={[{ genre: "테스트", scenes: [scene] }]} query="" onQueryChange={vi.fn()}
    genre="all" onGenreChange={vi.fn()} loading={false} error={null} disabled={false} onPick={onPick} />;
}
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1, item: () => null,
    [Symbol.iterator]: function* iterator() { yield {} as DOMRect; } } as DOMRectList);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("2D resilient image insertion", () => {
  it("does not equate the image load event with successful asynchronous decoding", async () => {
    const onPick = vi.fn(); render(browser(rooftop, onPick));
    const image = screen.getByAltText(title); setPixels(image);
    let ready!: () => void;
    Object.defineProperty(image, "decode", { value: () => new Promise<void>((resolve) => { ready = resolve; }) });
    fireEvent.load(image);
    const insert = screen.getByRole("button", { name: `${title} 삽입` });
    expect(insert.hasAttribute("disabled")).toBe(true); fireEvent.click(insert); expect(onPick).not.toHaveBeenCalled();
    await act(async () => { ready(); });
    expect(insert.hasAttribute("disabled")).toBe(false); fireEvent.click(insert);
    expect(onPick).toHaveBeenCalledExactlyOnceWith(rooftop);
  });
  it("surfaces decode failures instead of enabling insertion", async () => {
    render(browser(rooftop)); const image = screen.getByAltText(title); setPixels(image);
    Object.defineProperty(image, "decode", { value: () => Promise.reject(new Error("bad payload")) });
    await act(async () => { fireEvent.load(image); });
    expect(screen.getByRole("button", { name: "이미지 다시 불러오기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `${title} 삽입` })).toBeNull();
  });
  it("offers retry after a stalled preview request without accepting a late load", () => {
    vi.useFakeTimers(); const onPick = vi.fn();
    render(<Studio2dScenePreview scene={rooftop} disabled={false} onPick={onPick} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog"), image = within(dialog).getByAltText(title);
    act(() => { vi.advanceTimersByTime(20_001); });
    expect(within(dialog).getByRole("alert").textContent).toContain("시간이 초과");
    setPixels(image); fireEvent.load(image); fireEvent.click(within(dialog).getByRole("button", { name: "이 배경 삽입" }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "다시 불러오기" }));
    const retried = within(dialog).getByAltText(title); expect(retried).not.toBe(image);
    setPixels(retried); fireEvent.load(retried); fireEvent.click(within(dialog).getByRole("button", { name: "이 배경 삽입" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith(rooftop);
  });
  it("recovers a dimension mismatch without leaving stale pixel-view state", () => {
    const onPick = vi.fn(); render(<Studio2dScenePreview scene={rooftop} disabled={false} onPick={onPick} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog"); setPixels(within(dialog).getByAltText(title), 200, 200);
    fireEvent.load(within(dialog).getByAltText(title));
    expect(within(dialog).getByRole("alert").textContent).toContain("재검수 전");
    expect(within(dialog).getByRole("button", { name: "이 배경 삽입" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "다시 불러오기" }));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "원본 픽셀 보기" }).getAttribute("aria-pressed")).toBe("false");
    setPixels(within(dialog).getByAltText(title)); fireEvent.load(within(dialog).getByAltText(title));
    expect(within(dialog).getByRole("button", { name: "이 배경 삽입" }).hasAttribute("disabled")).toBe(false);
  });
  it("does not inherit readiness when a vector is replaced with the same scene ID", () => {
    const first = { id: "replace-vector", label: "벡터", genre: "테스트", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080" />' };
    const second = { ...first, svg: first.svg.replace('width="720"', 'width="600"') };
    const onPick = vi.fn(), view = render(browser(first, onPick));
    setPixels(screen.getByAltText("벡터"), 720, 1080); fireEvent.load(screen.getByAltText("벡터"));
    expect(screen.getByRole("button", { name: "벡터 삽입" }).hasAttribute("disabled")).toBe(false);
    view.rerender(browser(second, onPick));
    expect(screen.getByRole("button", { name: "벡터 삽입" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "벡터 삽입" })); expect(onPick).not.toHaveBeenCalled();
  });
  it("supports the text-free filter independently and resets it explicitly", () => {
    render(<Studio2dSceneBrowser groups={groupBgScenes(BG_SCENES)} query="" onQueryChange={vi.fn()} genre="all"
      onGenreChange={vi.fn()} loading={false} error={null} disabled={false} onPick={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("문자 형태 없는 이미지 배경만"));
    const ids = [...document.querySelectorAll("[data-studio-2d-asset]")].map((node) => node.getAttribute("data-studio-2d-asset"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.sort()).toEqual(STUDIO_2D_ASSET_METADATA.filter((asset) => !asset.containsText).map((asset) => asset.id).sort());
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect((screen.getByLabelText("문자 형태 없는 이미지 배경만") as HTMLInputElement).checked).toBe(false);
  });
  it("never treats unknown originals as text-free and composes with person-free filtering", () => {
    const unknown = { ...rooftop, id: "unknown", imgSrc: "/unknown.png" };
    const groups = [...groupBgScenes(BG_SCENES), { genre: "테스트", scenes: [unknown] }];
    const result = filterStudio2dScenes(groups, { textFreeOnly: true, emptySceneOnly: true });
    expect(result.length).toBeGreaterThan(0);
    for (const scene of result) {
      const metadata = getStudio2dAssetMetadata(scene);
      expect(metadata).toBeDefined(); expect(metadata?.containsText).toBe(false); expect(metadata?.containsPeople).toBe(false);
    }
    expect(result.some((scene) => scene.id === "unknown")).toBe(false);
  });
});
