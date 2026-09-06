// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SCENE_TEMPLATES, SCENE_TEMPLATE_CATEGORIES, type SceneTemplate } from "../studio-scene-templates";

import { createStudioCatalogPreferencesRepository } from "./studio-catalog-preferences";
import { StudioSceneTemplateBrowser } from "./StudioSceneTemplateBrowser";

afterEach(cleanup);
function setup(onAdd: (template: SceneTemplate) => Promise<void> = vi.fn(async () => undefined)) {
  const values = new Map<string, string>();
  const repository = createStudioCatalogPreferencesRepository({ get: async (key) => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } });
  const acquire = async () => repository;
  const props = { templates: SCENE_TEMPLATES, categories: SCENE_TEMPLATE_CATEGORIES, loading: false, error: null, onAdd, acquirePreferences: acquire };
  return { ...render(<StudioSceneTemplateBrowser {...props} />), props, onAdd, repository };
}
describe("native scene browser", () => {
  it("previews before insertion and labels schematic fidelity honestly", async () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "고백 장면 구성 미리보기" }));
    const dialog = screen.getByRole("dialog", { name: "고백 장면" });
    expect(h.onAdd).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/완성 작화가 아닌 배치 구성도/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "장면 추가" }));
    await waitFor(() => expect(h.onAdd).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await h.repository.load("scenes")).recentIds[0]).toBe("confession");
  });
  it("blocks double submission until the native host completes", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const onAdd = vi.fn(() => pending); setup(onAdd);
    const add = screen.getByRole("button", { name: "고백 장면 추가" });
    fireEvent.click(add); fireEvent.click(add); expect(onAdd).toHaveBeenCalledOnce();
    await act(async () => { finish(); await pending; });
  });
  it("keeps preview open when insertion rejects and does not record false usage", async () => {
    const h = setup(vi.fn(async () => { throw new Error("failed"); }));
    fireEvent.click(screen.getByRole("button", { name: "고백 장면 구성 미리보기" }));
    fireEvent.click(screen.getByRole("button", { name: "장면 추가" }));
    await waitFor(() => expect(screen.getByText(/장면을 추가하지 못했습니다/)).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((await h.repository.load("scenes")).recentIds).toEqual([]);
  });
  it("persists favorite and view across remount then filters saved choices", async () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "고백 장면 즐겨찾기" }));
    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
    await waitFor(async () => expect(await h.repository.load("scenes")).toMatchObject({ favoriteIds: ["confession"], view: "list" }));
    h.unmount(); render(<StudioSceneTemplateBrowser {...h.props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "목록 보기" }).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: /즐겨찾기만/ }));
    expect(screen.getByRole("button", { name: "고백 장면 구성 미리보기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "액션 컷 구성 미리보기" })).toBeNull();
  });
  it("restores full catalog from an empty filtered search", () => {
    setup(); fireEvent.change(screen.getByRole("searchbox"), { target: { value: "없는소재-999" } });
    expect(screen.getByText("조건에 맞는 장면이 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "전체 장면 보기" }));
    expect(screen.getByRole("button", { name: "고백 장면 구성 미리보기" })).toBeTruthy();
  });
  it("Escape dismisses only the preview and never inserts", () => {
    const h = setup(); fireEvent.click(screen.getByRole("button", { name: "고백 장면 구성 미리보기" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(h.onAdd).not.toHaveBeenCalled();
  });
});
