// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioUiPreferencesRepository } from "./studio-ui-preferences-sqlite";
import { StudioElementsPanel } from "./StudioElementsPanel";

import type {
  StudioSvgProductDecision,
  StudioSvgProductInput,
} from "./studio-svg-vello-product-router";

afterEach(() => {
  cleanup();
});

function createUiPreferencesHarness(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  const repository = createStudioUiPreferencesRepository({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  });
  return { values, acquire: async () => repository };
}

const stablePreferences = createUiPreferencesHarness();

describe("StudioElementsPanel expanded catalog UX", () => {
  it("consumes the SVG product tournament in the real Elements tile while preserving the source item", async () => {
    const resolve = vi.fn(async (
      _input: StudioSvgProductInput,
    ): Promise<StudioSvgProductDecision> => ({
      kind: "studio-svg-product-decision" as const,
      revision: 2 as const,
      assetId: "shape-superellipse",
      sourceDigest: `sha256:${"0".repeat(64)}` as const,
      selectedProviderId: "vello-svg-native" as const,
      providerId: "rejected" as const,
      route: "fail-closed" as const,
      audit: null,
      pixels: null,
      sourcePreserved: true as const,
      editable: false,
      interactiveGpuReadbackBytes: 0 as const,
      reasons: ["selected provider unavailable"],
      warnings: [],
      unsupported: [],
    }));
    const onAdd = vi.fn();
    render(
      <StudioElementsPanel
        onAdd={onAdd}
        previewTournament={{ resolve }}
        acquireUiPreferences={stablePreferences.acquire}
      />,
    );

    const tile = screen.getByTitle("슈퍼타원");
    fireEvent.pointerEnter(tile);
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    const routedInput = resolve.mock.calls[0]?.[0];
    expect(routedInput).toMatchObject({
      assetId: "shape-superellipse",
      trust: "bundled-catalog",
      selectedProviderId: "vello-svg-native",
    });
    expect(routedInput?.svg).toContain("<svg");
    const preview = tile.querySelector('[data-studio-svg-product-preview="true"]');
    await waitFor(() => {
      expect(preview?.getAttribute("data-studio-svg-preview-provider")).toBe("rejected");
    });
    expect(preview?.querySelector("img")?.className).toContain("invisible");
    expect(preview?.querySelector("img")?.getAttribute("data-studio-svg-source-placeholder"))
      .toBe("hidden");

    fireEvent.click(tile);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0]?.[0].svg).toBe(routedInput?.svg);
  });

  it("keeps the large catalog navigable with scrollable categories and touch targets", () => {
    render(<StudioElementsPanel onAdd={vi.fn()} acquireUiPreferences={stablePreferences.acquire} />);

    expect(screen.getByText("요소 · 도형")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "요소 검색" }).className).toContain("min-h-10");
    expect(screen.getByRole("tab", { name: "도형" }).className).toContain("pointer-coarse:min-h-11");
    expect(screen.getByRole("tab", { name: "컷 패널" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "말풍선" })).toBeNull();
    expect(screen.getByRole("tab", { name: "효과음" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "효과선" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "배경 패턴" })).toBeTruthy();
    expect(screen.getByTitle("슈퍼타원")).toBeTruthy();
    expect(screen.getByTitle("베지어 곡선")).toBeTruthy();
  });

  it("routes editable balloons to one canonical tool and explains placement modes", () => {
    const onOpenBubbles = vi.fn();
    render(<StudioElementsPanel onAdd={vi.fn()} onOpenBubbles={onOpenBubbles} acquireUiPreferences={stablePreferences.acquire} />);

    expect(screen.getByText("클릭·탭")).toBeTruthy();
    expect(screen.getByText("끌어 놓기")).toBeTruthy();
    expect(screen.getByText(/Esc 취소/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /편집 가능한 말풍선/u }));
    expect(onOpenBubbles).toHaveBeenCalledOnce();
  });

  it("exposes a 3D object rail that plans placement and openTarget for the host", () => {
    const onOpenObjectInsert = vi.fn();
    render(
      <StudioElementsPanel
        onAdd={vi.fn()}
        onOpenObjectInsert={onOpenObjectInsert}
        canvasWidth={800}
        canvasHeight={1200}
        acquireUiPreferences={stablePreferences.acquire}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /3D 오브젝트/u }));
    expect(screen.getByText("요소 · 3D 오브젝트")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "3D 오브젝트 검색" })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "3D 오브젝트 검색" }), {
      target: { value: "검" },
    });
    const sword = screen.getByRole("button", { name: /검,/u });
    expect(sword.getAttribute("data-studio-object-open-target")).toBe("vrm-poser");
    fireEvent.click(sword);

    expect(onOpenObjectInsert).toHaveBeenCalledOnce();
    const request = onOpenObjectInsert.mock.calls[0]?.[0];
    expect(request?.item.sourceId).toBe("sword");
    expect(request?.plan.openTarget).toBe("vrm-poser");
    expect(request?.plan.width).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("searchbox", { name: "3D 오브젝트 검색" }), {
      target: { value: "classroom" },
    });
    const classroom = document.querySelector(
      '[data-studio-object-insert="obj-scene-classroom"]',
    );
    expect(classroom).not.toBeNull();
    fireEvent.click(classroom!);
    expect(onOpenObjectInsert.mock.calls.at(-1)?.[0]?.plan.openTarget).toBe(
      "bg3d-templates",
    );
    expect(onOpenObjectInsert.mock.calls.at(-1)?.[0]?.item.sourceId).toBe(
      "classroom",
    );
  });

  it("exports element tiles through the shared image-backed drag contract", () => {
    render(<StudioElementsPanel onAdd={vi.fn()} acquireUiPreferences={stablePreferences.acquire} />);
    const tile = screen.getByTitle("슈퍼타원");
    const setData = vi.fn();
    fireEvent.dragStart(tile, { dataTransfer: { effectAllowed: "none", setData } });

    expect(setData).toHaveBeenCalledOnce();
    expect(setData.mock.calls[0]?.[0]).toBe("application/json-asset");
    expect(JSON.parse(setData.mock.calls[0]?.[1])).toMatchObject({
      source: "local",
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });

  it("exports 3D object tiles through the object-insert drag contract with openTarget", () => {
    render(
      <StudioElementsPanel
        onAdd={vi.fn()}
        onOpenObjectInsert={vi.fn()}
        canvasWidth={800}
        canvasHeight={1200}
        acquireUiPreferences={stablePreferences.acquire}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /3D 오브젝트/u }));
    fireEvent.change(screen.getByRole("searchbox", { name: "3D 오브젝트 검색" }), {
      target: { value: "검" },
    });
    const sword = screen.getByRole("button", { name: /검,/u });
    const setData = vi.fn();
    fireEvent.dragStart(sword, { dataTransfer: { effectAllowed: "none", setData } });

    expect(setData).toHaveBeenCalledOnce();
    expect(setData.mock.calls[0]?.[0]).toBe("application/x-studio-object-insert+json");
    expect(JSON.parse(setData.mock.calls[0]?.[1])).toMatchObject({
      kind: "studio-object-insert",
      openTarget: "vrm-poser",
      sourceId: "sword",
      itemId: "obj-prop-sword",
    });
  });

  it("switches packs and places the selected SVG asset", () => {
    const onAdd = vi.fn();
    render(<StudioElementsPanel onAdd={onAdd} acquireUiPreferences={stablePreferences.acquire} />);

    fireEvent.click(screen.getByRole("tab", { name: "컷 패널" }));
    expect(screen.getByText("10개")).toBeTruthy();
    fireEvent.click(screen.getByTitle("5컷 만화 리듬"));

    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0]?.[0]).toMatchObject({
      id: "panel-five-manga",
      category: "panel",
    });
  });

  it("supports multi-term purpose search and a clear action", () => {
    render(<StudioElementsPanel onAdd={vi.fn()} acquireUiPreferences={stablePreferences.acquire} />);

    fireEvent.click(screen.getByRole("tab", { name: "전체" }));
    const search = screen.getByRole("searchbox", { name: "요소 검색" });
    fireEvent.change(search, { target: { value: "focus corner" } });

    expect(screen.getByTitle("코너 집중선")).toBeTruthy();
    expect(screen.queryByTitle("중앙 집중선")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "검색어 지우기" }));
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("hydrates and persists recent elements through the SQLite/OPFS preference repository", async () => {
    const preferences = createUiPreferencesHarness({
      "elements-recent": JSON.stringify({ version: 1, ids: ["shape-superellipse"] }),
    });
    const { container } = render(
      <StudioElementsPanel onAdd={vi.fn()} acquireUiPreferences={preferences.acquire} />,
    );

    await waitFor(() => {
      expect(screen.getAllByTitle("슈퍼타원").length).toBeGreaterThanOrEqual(2);
      expect(
        container.firstElementChild?.getAttribute("data-studio-ui-preferences-authority"),
      ).toBe("sqlite-opfs");
    });

    fireEvent.click(screen.getByTitle("베지어 곡선"));
    await waitFor(() => {
      expect(preferences.values.get("elements-recent")).toContain("shape-bezier");
    });
  });

  it("keeps element placement available but marks failed persistence as memory-only", async () => {
    const onAdd = vi.fn();
    const { container } = render(
      <StudioElementsPanel
        onAdd={onAdd}
        acquireUiPreferences={async () => { throw new Error("SQLite unavailable"); }}
      />,
    );
    expect((await screen.findByText(/최근 요소는 .*이번 탭에서만 유지/u)).textContent)
      .toContain("이번 탭에서만 유지");
    expect(
      container.firstElementChild?.getAttribute("data-studio-ui-preferences-authority"),
    ).toBe("memory-only");
    fireEvent.click(screen.getByTitle("슈퍼타원"));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
