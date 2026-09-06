// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioUiPreferencesRepository } from "../studio-ui-preferences-sqlite";
import { StudioElementsPanel } from "../StudioElementsPanel";

import { createStudioCatalogPreferencesRepository } from "./studio-catalog-preferences";

afterEach(cleanup);
function setup() {
  const values = new Map<string, string>();
  const store = { get: async (k: string) => values.get(k) ?? null, set: async (k: string, v: string) => { values.set(k, v); }, delete: async (k: string) => { values.delete(k); } };
  const ui = createStudioUiPreferencesRepository(store); const catalog = createStudioCatalogPreferencesRepository(store);
  const onAdd = vi.fn();
  const props = { onAdd, acquireUiPreferences: async () => ui, acquireCatalogPreferences: async () => catalog };
  return { ...render(<StudioElementsPanel {...props} />), props, onAdd, catalog };
}
describe("elements detail and filtering", () => {
  it("separates detail from quick insert and states that flattened SVG internals are not editable", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "슈퍼타원 상세 미리보기" }));
    expect(h.onAdd).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "슈퍼타원" });
    expect(within(dialog).getByText(/이미지 요소/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "캔버스에 추가" }));
    expect(h.onAdd).toHaveBeenCalledOnce(); expect(h.onAdd.mock.calls[0][0].id).toBe("shape-superellipse");
  });
  it("filters favorites without inserting and restores durable selection on remount", async () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "슈퍼타원 즐겨찾기" }));
    await waitFor(async () => expect((await h.catalog.load("elements")).favoriteIds).toContain("shape-superellipse"));
    expect(h.onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "즐겨찾기만 표시" }));
    expect(screen.queryByTitle("베지어 곡선")).toBeNull();
    expect(screen.getByTitle("슈퍼타원")).toBeTruthy();
  });
  it("category keyboard navigation moves the selection and does not intercept composing text", () => {
    setup(); const tab = screen.getByRole("tab", { name: "도형" });
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "컷 패널" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "컷 패널" }), { key: "ArrowRight", isComposing: true });
    expect(screen.getByRole("tab", { name: "컷 패널" }).getAttribute("aria-selected")).toBe("true");
  });
});
