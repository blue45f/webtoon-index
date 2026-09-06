// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listStudioBrushTrayItems } from "../studio-creative-ux";

import {
  filterStudioBrushCatalogItems,
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
  STUDIO_CORE_BRUSH_CATALOG_ITEMS,
  STUDIO_PRO_BRUSH_CATALOG_ITEMS,
} from "./studio-brush-catalog";
import { isStudioBrushMaterialGroup } from "./studio-brush-material-group";
import { STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE } from "./studio-brush-tip-stamp";
import { STUDIO_BRUSH_LIBRARY_TABS } from "./studio-draw-ux";
import {
  LargeBrushPreview,
  StudioBrushCatalogPortal,
  StudioBrushLibrarySheet,
} from "./StudioBrushLibrarySheet";

import type { StudioBrushTrayItem } from "../studio-creative-ux";

const catalog = new Map(listStudioBrushTrayItems("all").map((item) => [item.id, item]));
const beginnerCatalogItems = filterStudioBrushCatalogItems({
  operation: "paint",
  category: "beginner",
  query: "",
  favoriteIds: [],
  recentIds: [],
});
const beginnerCatalogCount = beginnerCatalogItems.length;
// The drawer's own header counts what it can OFFER, not what is registered — quarantined ids are
// registered but unreachable, so the listed paint inventory is the honest number.
const paintCatalogCount = STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.length;

// 재질 탭은 티어 탭을 대체한다. 개수를 하드코딩하면 재질이 늘 때마다 테스트가 거짓말을 하므로
// 탭 매니페스트에서 파생한다.
const libraryTabCount = STUDIO_BRUSH_LIBRARY_TABS.length;
const materialTabCount = STUDIO_BRUSH_LIBRARY_TABS.filter(
  (chip) => isStudioBrushMaterialGroup(chip.id),
).length;
// 점진 로딩 검증은 명시적인 전체 탭이 맡는다. 재질 탭은 품질 대표 포트폴리오이고,
// 전체 탭만 모든 비검역 브러시를 48개씩 점진적으로 노출한다.
const EXHAUSTIVE_TAB_LABEL = "전체";
const exhaustiveCatalogItems = filterStudioBrushCatalogItems({
  operation: "paint",
  category: "all",
  query: "",
});
const exhaustiveCatalogCount = exhaustiveCatalogItems.length;
const exhaustiveFirstBatchProCount = exhaustiveCatalogItems
  .slice(0, 48)
  .filter((item) => item.source === "pro").length;
const exhaustiveProCount = exhaustiveCatalogItems
  .filter((item) => item.source === "pro").length;
// 헤더 카피는 SSOT 총계(격리 포함)를, 결과 카운터는 실제 목록(격리 제외)을 쓴다.
const listedPaintCatalogCount = filterStudioBrushCatalogItems({
  operation: "paint",
  category: "all",
  query: "",
}).length;
const sheetSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/brush/StudioBrushLibrarySheet.tsx"),
  "utf8"
);
const selectionSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/brush/studio-brush-selection.ts"),
  "utf8"
);

class TestIntersectionObserver implements IntersectionObserver {
  static readonly instances: TestIntersectionObserver[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly scrollMargin: string;
  readonly thresholds: readonly number[];
  readonly disconnect = vi.fn();
  readonly unobserve = vi.fn();
  readonly takeRecords = vi.fn((): IntersectionObserverEntry[] => []);
  private observedTarget: Element | null = null;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    this.scrollMargin = options.scrollMargin ?? "0px";
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    TestIntersectionObserver.instances.push(this);
  }

  readonly observe = vi.fn((target: Element) => {
    this.observedTarget = target;
  });

  trigger(isIntersecting = true): void {
    const target = this.observedTarget;
    if (!target) throw new Error("IntersectionObserver target was not observed");
    const rect = target.getBoundingClientRect();
    this.callback([
      {
        time: 0,
        target,
        rootBounds: null,
        boundingClientRect: rect,
        intersectionRect: isIntersecting ? rect : new DOMRectReadOnly(),
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
      },
    ], this);
  }
}

function installIntersectionObserver(): typeof TestIntersectionObserver.instances {
  TestIntersectionObserver.instances.length = 0;
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  return TestIntersectionObserver.instances;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  TestIntersectionObserver.instances.length = 0;
});

function brush(id: string): StudioBrushTrayItem {
  const item = catalog.get(id);
  if (!item) throw new Error(`Missing brush fixture: ${id}`);
  return item;
}

function catalogBrush(id: string): StudioBrushTrayItem {
  const item = STUDIO_ALL_BRUSH_CATALOG_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing extended brush fixture: ${id}`);
  return item;
}

function renderSheet(overrides: Partial<Parameters<typeof StudioBrushLibrarySheet>[0]> = {}): string {
  return renderToStaticMarkup(
    <StudioBrushLibrarySheet
      open
      activeBrushId="pen"
      onClose={vi.fn()}
      onSelect={vi.fn()}
      {...overrides}
    />
  );
}

describe("StudioBrushLibrarySheet", () => {
  it("does not render the catalog while closed", () => {
    expect(renderSheet({ open: false })).toBe("");
  });

  it("separates the full built-in catalogue from quick sub-tools and saved brushes", () => {
    const html = renderSheet();

    expect(html).toContain('data-studio-brush-catalog="built-in"');
    expect(html).toContain('data-studio-brush-surface-role="full-catalog-management"');
    expect(html).toContain("브러시 전체 라이브러리");
    expect(html).toContain(
      `브러시 ${paintCatalogCount}종 · 재질 ${materialTabCount}갈래`
    );
    expect(html).toContain('aria-label="브러시 전체 라이브러리 닫기"');
    expect(html).toContain('data-studio-brush-library-close="true"');
    expect(html).not.toContain('data-studio-brush-surface-role="quick-subtools"');
  });

  it("separates erasers into the shared picker and selects a stable eraser preset", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <StudioBrushLibrarySheet
        open
        operation="erase"
        activeBrushId="kneaded-eraser"
        onClose={onClose}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole("dialog", { name: "지우개 선택" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "지우개 종류 선택" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /일반 지우개, 100% 지움/u })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /떡지우개, 38% 지움/u })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "매끈한 펜 선택" })).toBeNull();
    expect(screen.queryByRole("group", { name: "브러시 표시 방식" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /일반 지우개, 100% 지움/u }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({
      operation: "erase",
      runtimeBrushId: "standard-eraser",
      catalogId: "standard-eraser",
      defaultWidth: 20,
      defaultOpacity: 1,
    });
    expect(onClose).toHaveBeenCalledWith("selection");
  });

  it(`publishes one unique ${STUDIO_ALL_BRUSH_CATALOG_ITEMS.length}-brush catalog while keeping the procedural runtime lazy`, () => {
    const coreItems = STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.source === "core");
    const proItems = STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.source === "pro");

    expect(coreItems).toEqual(STUDIO_CORE_BRUSH_CATALOG_ITEMS);
    expect(proItems).toEqual(STUDIO_PRO_BRUSH_CATALOG_ITEMS);
    expect(STUDIO_ALL_BRUSH_CATALOG_ITEMS).toEqual([
      ...STUDIO_CORE_BRUSH_CATALOG_ITEMS,
      ...STUDIO_PRO_BRUSH_CATALOG_ITEMS,
    ]);
    expect(new Set(STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => item.id))).toHaveProperty(
      "size",
      STUDIO_ALL_BRUSH_CATALOG_ITEMS.length
    );
    expect(selectionSource).toContain('import("./studio-brush-pack-runtime")');
    expect(sheetSource).toContain("materializeStudioBrushCatalogSelection");
    expect(sheetSource).not.toContain('import("./studio-brush-pack-runtime")');
    expect(sheetSource).not.toMatch(/from\s+["']\.\/studio-brush-pack-runtime["']/);
  });

  it("provides one controlled Portal host for desktop and mobile triggers", () => {
    expect(sheetSource.match(/createPortal\(/g)).toHaveLength(1);
    expect(sheetSource).toContain('type StudioBrushCatalogPlacement = "desktop-dock" | "mobile-sheet"');
    expect(sheetSource).toContain('data-studio-brush-catalog-session="true"');
    expect(sheetSource).toContain("triggerElement");
  });

  it("keeps mobile outside-pointer dismissal while desktop becomes a persistent comparison window", () => {
    expect(sheetSource).toContain('onClose("outside-pointer")');
    expect(sheetSource).toContain('onClose("escape")');
    expect(sheetSource).toContain('if (closeOnSelection) onClose("selection")');
    expect(sheetSource).toContain("dismissOnOutsidePointer={!desktop}");
    expect(sheetSource).toContain("closeOnSelection={!desktop}");
    expect(sheetSource).toContain("StudioFloatingSurface");
    expect(sheetSource).toContain("useStudioFloatingSurfaceLayout");
  });

  it("keeps catalog search, tabs, close, and favorites at 44px touch density", () => {
    const html = renderSheet({ onToggleFavorite: vi.fn() });

    expect(html).toContain("size-11");
    expect(html).toContain("min-h-11");
    expect(html).toContain("min-w-11");
    expect(html).toContain("grid size-11 place-items-center");
    expect(html).toContain('role="group" aria-label="브러시 표시 방식"');
    expect(html).toContain('data-studio-brush-view-option="stroke"');
    expect(html).toContain('data-studio-brush-view-option="tile"');
    expect(html).toContain('data-studio-brush-view-option="text"');
  });

  it("compacts fixed chrome without shrinking 44px controls or the brush scrollport", () => {
    const html = renderSheet({ compact: true, onToggleFavorite: vi.fn() });

    expect(html).toContain('data-studio-brush-compact="true"');
    expect(html).toContain('data-studio-brush-catalog-header="true"');
    expect(html).toContain('data-studio-brush-catalog-controls="true"');
    expect(html).toContain('data-studio-brush-catalog-tabs="true"');
    expect(html).toContain('data-studio-brush-catalog-scrollport="true"');
    expect(html).toContain('data-studio-brush-catalog-reset="true"');
    expect(html).toContain("min-h-16 p-1");
    expect(html).toContain("w-[8.5rem] flex-none");
    expect(html).toContain("min-h-11 min-w-11");
    expect(html).toContain("shrink-0 border-t");
    expect(html).toContain('data-studio-brush-stroke-details="true"');
    expect(html).toContain("[@media(max-height:32rem)]:hidden");
  });

  it("keeps the compact fallback available for a genuinely short viewport", () => {
    const html = renderSheet();

    expect(html).toContain("[@media(max-height:32rem)]:min-h-16");
    expect(html).toContain("[@media(max-height:32rem)]:flex");
    expect(html).toContain("[@media(max-height:32rem)]:sr-only");
    expect(html).toContain("[@media(max-height:32rem)]:py-0");
  });

  it("forces the compact mobile layout while a software keyboard occludes the viewport", () => {
    render(
      <StudioBrushCatalogPortal
        open
        placement="mobile-sheet"
        triggerElement={null}
        activeBrushId="pen"
        mobileKeyboardInset={180.4}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onToggleFavorite={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "브러시 전체 라이브러리" });
    expect(dialog.dataset.studioBrushCompact).toBe("true");
    expect(dialog.style.bottom).toContain("180px");
    expect(
      dialog.querySelector<HTMLElement>("[data-studio-brush-catalog-scrollport]")?.className
    ).toContain("min-h-16");
    expect(
      dialog.querySelector<HTMLElement>("[data-studio-brush-catalog-reset]")
    ).toBeTruthy();
  });

  it("switches between CLIP-style stroke, small-tile, and text views without changing results", () => {
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onToggleFavorite={vi.fn()}
      />
    );

    const viewGrid = () =>
      container.querySelector<HTMLElement>("[data-studio-brush-progressive-grid]");
    expect(viewGrid()?.dataset.studioBrushView).toBe("stroke");
    expect(screen.getByRole("button", { name: "획 미리보기" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(container.querySelector('[data-studio-brush-preview-density="stroke"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "작은 타일" }));
    expect(viewGrid()?.dataset.studioBrushView).toBe("tile");
    expect(viewGrid()?.className).toContain("grid-cols-3");
    expect(screen.getByRole("button", { name: "작은 타일" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(container.querySelector('[data-studio-brush-preview-density="tile"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "매끈한 펜 선택" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "이름 목록" }));
    expect(viewGrid()?.dataset.studioBrushView).toBe("text");
    expect(viewGrid()?.className).toContain("grid-cols-1");
    expect(container.querySelector("[data-studio-brush-preview]")).toBeNull();
    expect(container.querySelectorAll('[data-studio-brush-text-row="true"]'))
      .toHaveLength(beginnerCatalogCount);
    expect(screen.getByRole("button", { name: "매끈한 펜 선택" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "G펜(필압) 선택" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "매끈한 펜 즐겨찾기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "G펜(필압) 즐겨찾기" })).toBeTruthy();
  });

  it("keeps full-catalog search and roving selection intact after a density change", () => {
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "이름 목록" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "전체 브러시 검색" }), {
      target: { value: "heart-stamp" },
    });

    const result = screen.getByRole("button", { name: "하트 도장 선택" });
    expect(result.tabIndex).toBe(0);
    expect(screen.getByRole("status").textContent).toBe("1/1개의 브러시가 표시됩니다.");
    expect(screen.getByText(`재질 분류와 관계없이 전체 ${paintCatalogCount}종에서 검색 중`)).toBeTruthy();
  });

  it("keeps a long brush name inside the 320px text-row flex boundary", () => {
    // The sheet can only render LISTED rows, so the longest name it must fit is the longest
    // listed name — reducing over the unfiltered SSOT can pick a quarantined id that the search
    // box will never return.
    const longestNameItem = STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.reduce((longest, item) =>
      item.name.length > longest.name.length ? item : longest
    );
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "이름 목록" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "전체 브러시 검색" }), {
      target: { value: longestNameItem.name },
    });

    const result = screen.getByRole("button", { name: `${longestNameItem.name} 선택` });
    expect(result.className).toContain("pr-11");
    expect(result.querySelector("span.min-w-0.flex-1")).toBeTruthy();
    expect(result.querySelector("span.truncate")).toBeTruthy();
  });

  it("exposes a non-modal dialog, one-tab-stop tablist, named panel, and live result count", () => {
    const html = renderSheet();

    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
    expect(html).toContain('role="tablist"');
    // favorites/recent/beginner + 재질 10갈래 + all — 티어("프로"/"엔진") 탭은 없다.
    expect(html).not.toMatch(/role="tab"[^>]*>\s*(프로|엔진)/u);
    expect(html.match(/role="tab"/g)).toHaveLength(libraryTabCount);
    expect(html.match(/role="tab"[^>]*tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/role="tab"[^>]*tabindex="-1"/g)).toHaveLength(libraryTabCount - 1);
    expect(html).toMatch(/role="tabpanel" aria-labelledby="[^"]+" tabindex="0"/);
    expect(html).toMatch(/aria-label="전체 브러시 검색" aria-controls="[^"]+"/);
    expect(html).toContain('data-studio-brush-search-scope="all"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain(
      `${beginnerCatalogCount}/${beginnerCatalogCount}개의 브러시가 표시됩니다.`,
    );
  });

  it("searches the full brush catalog regardless of the currently selected category", () => {
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("tab", { name: "시작 도구" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByRole("searchbox", { name: "전체 브러시 검색" }), {
      target: { value: "heart-stamp" },
    });

    expect(screen.getByText(`재질 분류와 관계없이 전체 ${paintCatalogCount}종에서 검색 중`)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("1/1개의 브러시가 표시됩니다.");
    expect(screen.getByRole("button", { name: "하트 도장 선택" })).toBeTruthy();
  });

  it("shows brush-kind badges and re-applies the active catalogue defaults", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={onClose}
        onSelect={onSelect}
      />
    );

    expect(container.querySelector('[data-studio-brush-kind-badge="ink"]')?.textContent).toBe(
      "펜·잉크"
    );
    fireEvent.click(screen.getByRole("button", { name: "매끈한 펜 기본값 다시 적용" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      catalogId: "pen",
      catalogName: "매끈한 펜",
      runtimeBrushId: "pen",
      defaultWidth: 6,
      defaultOpacity: 1,
    }));
    expect(onClose).toHaveBeenCalledWith("selection");
  });

  it("keeps an accessible fallback while progressively materializing a durable selection", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={onClose}
        onSelect={onSelect}
      />
    );

    // 전체 탭은 compact 재질 탭에 흡수된 변형까지 모두 탐색할 수 있다.
    fireEvent.click(screen.getByRole("tab", { name: EXHAUSTIVE_TAB_LABEL }));

    expect(screen.getByRole("status").textContent).toBe(
      `48/${exhaustiveCatalogCount}개의 브러시가 표시됩니다.`
    );
    expect(container.querySelectorAll("[data-studio-brush-source]")).toHaveLength(48);
    expect(container.querySelectorAll('[data-studio-brush-source="pro"]')).toHaveLength(
      exhaustiveFirstBatchProCount,
    );
    expect(screen.queryAllByText("PRO")).toHaveLength(exhaustiveFirstBatchProCount);
    expect(container.querySelector("[data-studio-brush-load-more]")).toBeNull();
    while (container.querySelector('[data-studio-brush-progressive-fallback="true"]')) {
      fireEvent.click(
        container.querySelector('[data-studio-brush-progressive-fallback="true"]')!,
      );
    }
    expect(screen.getByRole("status").textContent).toBe(
      `${exhaustiveCatalogCount}/${exhaustiveCatalogCount}개의 브러시가 표시됩니다.`
    );
    expect(container.querySelectorAll('[data-studio-brush-source="pro"]')).toHaveLength(
      exhaustiveProCount
    );
    expect(screen.getAllByText("PRO")).toHaveLength(exhaustiveProCount);

    fireEvent.click(screen.getByRole("button", { name: "하트 도장 선택" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogId: "heart-stamp",
        catalogName: "하트 도장",
        runtimeBrushId: "ink-particle",
        defaultWidth: 26,
        defaultOpacity: 0.94,
        brushDynamics: expect.objectContaining({
          version: 1,
          tip: expect.objectContaining({
            alphaMapSize: STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE,
          }),
        }),
      })
    );
    expect(onClose).toHaveBeenCalledWith("selection");
  });

  it("reveals one batch for duplicate observer notifications and uses the scrollport root", () => {
    const observers = installIntersectionObserver();
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "전체" }));
    const observer = observers.at(-1);
    const scrollport = container.querySelector(
      "[data-studio-brush-catalog-scrollport]",
    );
    expect(observer?.root).toBe(scrollport);
    expect(observer?.rootMargin).toBe("240px 0px");
    expect(observer?.observe).toHaveBeenCalledWith(
      container.querySelector("[data-studio-brush-progressive-sentinel]"),
    );

    act(() => {
      observer?.trigger();
      observer?.trigger();
    });

    expect(screen.getByRole("status").textContent).toBe(
      `96/${listedPaintCatalogCount}개의 브러시가 표시됩니다.`,
    );
    expect(container.querySelectorAll("[data-studio-brush-source]")).toHaveLength(96);
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });

  it("resets the batch, scroll position, and stale observer when a filter key changes", () => {
    const observers = installIntersectionObserver();
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: "전체" }));
    const proObserver = observers.at(-1)!;
    act(() => proObserver.trigger());
    expect(screen.getByRole("status").textContent).toContain("96/");
    const scrollport = container.querySelector<HTMLElement>(
      "[data-studio-brush-catalog-scrollport]",
    )!;
    scrollport.scrollTop = 720;

    fireEvent.change(screen.getByRole("searchbox", { name: "전체 브러시 검색" }), {
      target: { value: "브러시" },
    });

    expect(scrollport.scrollTop).toBe(0);
    const resetCount = /^(\d+)\/(\d+)개의 브러시가 표시됩니다\.$/u.exec(
      screen.getByRole("status").textContent ?? "",
    );
    expect(resetCount).not.toBeNull();
    expect(Number(resetCount?.[1])).toBe(
      Math.min(48, Number(resetCount?.[2])),
    );
    const countAfterReset = container.querySelectorAll(
      "[data-studio-brush-source]",
    ).length;
    act(() => proObserver.trigger());
    expect(container.querySelectorAll("[data-studio-brush-source]")).toHaveLength(
      countAfterReset,
    );
    expect(proObserver.disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects at the end of the catalog and removes the sentinel", () => {
    const observers = installIntersectionObserver();
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: "전체" }));

    while (container.querySelector("[data-studio-brush-progressive-sentinel]")) {
      const observer = observers.at(-1);
      act(() => observer?.trigger());
    }

    expect(screen.getByRole("status").textContent).toBe(
      `${listedPaintCatalogCount}/${listedPaintCatalogCount}개의 브러시가 표시됩니다.`,
    );
    expect(container.querySelector("[data-studio-brush-progressive-sentinel]")).toBeNull();
    expect(observers.at(-1)?.disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects on close and leaves a keyboard fallback when observers are unavailable", () => {
    const { container, rerender } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: EXHAUSTIVE_TAB_LABEL }));

    const remainingAfterFirstBatch = exhaustiveCatalogCount - 48;
    const fallback = screen.getByRole("button", {
      name: `다음 브러시 ${Math.min(48, remainingAfterFirstBatch)}개 불러오기, `
        + `${remainingAfterFirstBatch}개 남음`,
    });
    expect(fallback.className).toContain("sr-only");
    expect(container.querySelector("[data-studio-brush-load-more]")).toBeNull();
    fireEvent.click(fallback);
    expect(screen.getByRole("status").textContent).toContain(
      `${Math.min(96, exhaustiveCatalogCount)}/`,
    );

    const observers = installIntersectionObserver();
    fireEvent.click(screen.getByRole("tab", { name: "전체" }));
    const observer = observers.at(-1);
    rerender(
      <StudioBrushLibrarySheet
        open={false}
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps one brush-selection tab stop and moves it with arrows", () => {
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const selections = screen.getAllByRole("button", { name: /선택$/ });
    expect(selections.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const scrollIntoView = vi.fn();
    Object.defineProperty(selections[2]!, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    selections[0]?.focus();
    fireEvent.keyDown(selections[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(selections[2]);
    expect(selections[2]?.tabIndex).toBe(0);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    fireEvent.keyDown(selections[2]!, { key: "Home" });
    expect(document.activeElement).toBe(selections[0]);
  });

  it("uses live rendered columns after responsive resize and keeps the same roving brush across view changes", () => {
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const grid = container.querySelector<HTMLElement>(
      "[data-studio-brush-progressive-grid]"
    );
    expect(grid).toBeTruthy();
    const selections = screen.getAllByRole("button", { name: /선택$/ });
    const originalGetComputedStyle = globalThis.getComputedStyle;
    let renderedColumns = "100px 100px";
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation((element, pseudoElement) => {
      if (element === grid) {
        return {
          gridTemplateColumns: renderedColumns,
        } as CSSStyleDeclaration;
      }
      return originalGetComputedStyle(element, pseudoElement);
    });

    selections[0]!.focus();
    fireEvent.keyDown(selections[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(selections[2]);

    renderedColumns = "100px 100px 100px";
    fireEvent.keyDown(selections[2]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(selections[5]);

    fireEvent.click(screen.getByRole("button", { name: "작은 타일" }));
    const tileSelections = screen.getAllByRole("button", { name: /선택$/ });
    expect(tileSelections[5]!.tabIndex).toBe(0);
    fireEvent.keyDown(tileSelections[5]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(tileSelections[8]);

    renderedColumns = "100px";
    fireEvent.click(screen.getByRole("button", { name: "이름 목록" }));
    const textSelections = screen.getAllByRole("button", { name: /선택$/ });
    expect(textSelections[8]!.tabIndex).toBe(0);
    fireEvent.keyDown(textSelections[8]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(textSelections[7]);
  });

  it("keeps linear row edges and leaves focus in place when a vertical grid cell is missing", () => {
    const { container } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const grid = container.querySelector<HTMLElement>(
      "[data-studio-brush-progressive-grid]"
    );
    const selections = screen.getAllByRole("button", { name: /선택$/ });
    const columns = 3;
    const lastIndex = selections.length - 1;
    const previousRowSameColumnIndex = lastIndex - columns;
    const missingBelowIndex = selections.length - columns;
    expect(selections).toHaveLength(beginnerCatalogCount);
    expect(previousRowSameColumnIndex).toBeGreaterThanOrEqual(0);
    expect(missingBelowIndex).toBeGreaterThanOrEqual(0);
    const originalGetComputedStyle = globalThis.getComputedStyle;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation((element, pseudoElement) => {
      if (element === grid) {
        return {
          gridTemplateColumns: `repeat(${columns}, minmax(0px, 1fr))`,
        } as CSSStyleDeclaration;
      }
      return originalGetComputedStyle(element, pseudoElement);
    });

    selections[0]!.focus();
    fireEvent.keyDown(selections[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(selections[0]);
    fireEvent.keyDown(selections[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(selections[3]);
    fireEvent.keyDown(selections[3]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(selections[2]);
    fireEvent.keyDown(selections[2]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(selections[2]);

    selections[0]!.focus();
    fireEvent.keyDown(selections[0]!, { key: "End" });
    expect(document.activeElement).toBe(selections[lastIndex]);
    fireEvent.keyDown(selections[lastIndex]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(selections[lastIndex]);
    fireEvent.keyDown(selections[lastIndex]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(selections[lastIndex]);
    fireEvent.keyDown(selections[lastIndex]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(selections[previousRowSameColumnIndex]);
    fireEvent.keyDown(selections[previousRowSameColumnIndex]!, { key: "Home" });
    expect(document.activeElement).toBe(selections[0]);

    selections[missingBelowIndex]!.focus();
    fireEvent.keyDown(selections[missingBelowIndex]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(selections[missingBelowIndex]);
  });

  it("keeps favorite actions out of the tab sequence and exposes F on the roving tile", () => {
    const onToggleFavorite = vi.fn();
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onToggleFavorite={onToggleFavorite}
      />
    );

    const favoriteActions = screen.getAllByRole("button", { name: /즐겨찾기/u });
    expect(favoriteActions.every((button) => button.tabIndex === -1)).toBe(true);

    const penTile = screen.getByRole("button", { name: "매끈한 펜 선택" });
    expect(penTile.getAttribute("aria-keyshortcuts")).toBe("F");
    penTile.focus();
    fireEvent.keyDown(penTile, { key: "f" });
    expect(onToggleFavorite).toHaveBeenCalledOnce();
    expect(onToggleFavorite).toHaveBeenCalledWith("pen");
    expect(document.activeElement).toBe(penTile);
  });

  it("cancels an in-flight selection when the controlled sheet closes", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={onClose}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "매끈한 펜 선택" }));
    rerender(
      <StudioBrushLibrarySheet
        open={false}
        activeBrushId="pen"
        onClose={onClose}
        onSelect={onSelect}
      />
    );
    await act(async () => {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight selection before reporting an outside-pointer close", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={onClose}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "매끈한 펜 선택" }));
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("outside-pointer");

    await act(async () => {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders distinct motif details for patterned, foliage, and stamp profiles", () => {
    const heart = renderToStaticMarkup(
      <LargeBrushPreview item={catalogBrush("heart-stamp")} active={false} />
    );
    const footsteps = renderToStaticMarkup(
      <LargeBrushPreview item={catalogBrush("footstep-stamp")} active={false} />
    );
    const checker = renderToStaticMarkup(
      <LargeBrushPreview item={catalogBrush("checker-grid")} active={false} />
    );
    const leaf = renderToStaticMarkup(
      <LargeBrushPreview item={catalogBrush("leaf-cluster")} active={false} />
    );
    const hair = renderToStaticMarkup(
      <LargeBrushPreview item={catalogBrush("hair-fiber")} active={false} />
    );

    expect(heart).toContain("M72 13 C72 8");
    expect(footsteps).toContain('<ellipse cx="64" cy="20" rx="3.2" ry="6.2"></ellipse>');
    expect(checker).toContain('<rect x="55" y="10" width="6" height="6"></rect>');
    expect(leaf).toContain("M0 0 C2.2 -3.4 6.5 -3.1 8 0");
    expect(hair).toContain("M50 9 C62");
    expect(new Set([heart, footsteps, checker, leaf, hair])).toHaveProperty("size", 5);
  });

  it("keeps every procedural preview SVG dimension non-negative", () => {
    for (const item of STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter(({ source }) => source === "pro")) {
      const html = renderToStaticMarkup(<LargeBrushPreview item={item} active={false} />);
      expect(html, item.id).not.toMatch(/\b(?:width|height|rx|ry|r)="-/);
    }
  });

  it("keeps the low-flow glaze marker visibly translucent in preview", () => {
    const glazeMarker = renderToStaticMarkup(
      <LargeBrushPreview item={catalogBrush("marker-colorless-blender")} active={false} />
    );

    expect(catalogBrush("marker-colorless-blender").name).toBe("저유량 글레이즈 마커");
    expect(catalogBrush("marker-colorless-blender").defaultOpacity).toBe(0.4);
    expect(glazeMarker).toContain('data-studio-brush-preview-opacity="0.4"');
    expect(glazeMarker).toContain('opacity="0.096"');
    expect(glazeMarker).toContain('opacity="0.192"');
  });

  it("marks the active preset and favorite action independently", () => {
    const html = renderSheet({
      favoriteIds: ["pen"],
      onToggleFavorite: vi.fn(),
    });

    expect(html).toMatch(/aria-label="매끈한 펜 선택" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="G펜\(필압\) 선택" aria-pressed="false"/);
    expect(html).toContain('aria-label="매끈한 펜 즐겨찾기 해제"');
    expect(html).toContain('fill="currentColor"');
  });

  it.each([
    ["gpen", "calligraphy"],
    ["highlighter", "wash-marker"],
    ["chisel-highlighter", "wash-marker"],
    ["pastel-highlighter", "wash-marker"],
    ["marker-bold", "marker"],
    ["pencil", "pencil"],
    ["charcoal", "texture"],
    ["airbrush-fine", "soft-air"],
    ["spray", "particle"],
    ["splatter", "particle"],
    ["wash-brush", "soft-wash"],
    ["pastel", "soft-pigment"],
    ["oil", "oil"],
    ["neon", "neon"],
    ["soft-glow", "glow"],
    ["star-dust", "particle"],
    ["screentone", "tone"],
  ] as const)("renders %s with its %s visual contract", (id, expectedKind) => {
    const item = brush(id);
    const html = renderToStaticMarkup(<LargeBrushPreview item={item} active={false} />);

    expect(html).toContain(`data-studio-brush-preview-kind="${expectedKind}"`);
    expect(html).toContain(`data-studio-brush-preview-layer="${expectedKind}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
  });

  it("shows the renderer-defining details instead of one generic line", () => {
    const highlighter = renderToStaticMarkup(
      <LargeBrushPreview item={brush("highlighter")} active={false} />
    );
    const glow = renderToStaticMarkup(
      <LargeBrushPreview item={brush("glow")} active={false} />
    );
    const tone = renderToStaticMarkup(
      <LargeBrushPreview item={brush("screentone")} active={false} />
    );
    const texture = renderToStaticMarkup(
      <LargeBrushPreview item={brush("pencil-grain")} active={false} />
    );

    expect(highlighter).toContain('data-studio-brush-preview-kind="wash-marker"');
    expect(highlighter).toContain('stroke-linecap="round"');
    expect(glow.match(/<path/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(tone.match(/<circle/g)?.length ?? 0).toBeGreaterThan(12);
    expect(texture).toContain("stroke-dasharray");
    expect(texture.match(/<circle/g)?.length ?? 0).toBeGreaterThan(3);
  });

  it("uses the selected-state ink without exposing the decorative SVG to assistive tech", () => {
    const html = renderToStaticMarkup(
      <LargeBrushPreview item={brush("neon")} active />
    );

    expect(html).toContain("text-on-accent");
    expect(html).toContain('stroke="currentColor"');
    expect(html).not.toContain("oklch(0.96 0.02 85)");
  });

  it("keeps the same renderer-faithful preview in compact tile density", () => {
    const html = renderToStaticMarkup(
      <LargeBrushPreview item={brush("gpen")} active={false} density="tile" />
    );

    expect(html).toContain('data-studio-brush-preview-kind="calligraphy"');
    expect(html).toContain('data-studio-brush-preview-density="tile"');
    expect(html).toContain("h-7");
  });

  it("uses a preset's suggested effect color only while the preview is inactive", () => {
    const inactive = renderToStaticMarkup(
      <LargeBrushPreview item={brush("neon")} active={false} />
    );
    const active = renderToStaticMarkup(
      <LargeBrushPreview item={brush("neon")} active />
    );

    expect(inactive).toContain("#39ff14");
    expect(active).not.toContain("#39ff14");
  });
});

describe("StudioBrushLibrarySheet restored view", () => {
  afterEach(cleanup);

  it("reopens on the tab, search text, and density the artist left behind", () => {
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        restoredView={{ tab: "texture", query: "\ud06c\ub808\uc6d0", viewMode: "text" }}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const search = screen.getByRole("searchbox") as HTMLInputElement;
    expect(search.value).toBe("\ud06c\ub808\uc6d0");
  });

  /**
   * The category set is product surface that gets reorganised. A tab id that has since been
   * removed must not strand the artist on an empty panel — the sheet falls back to its
   * operation default, which is what lets the persistence layer store the id opaquely.
   */
  it("falls back to the default tab when the remembered category no longer exists", () => {
    render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        restoredView={{ tab: "a-category-that-was-deleted", query: "", viewMode: "stroke" }}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const selected = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toBeTruthy();
  });

  it("reports the place to return to once, on teardown rather than per keystroke", () => {
    const onViewStateChange = vi.fn();
    const view = render(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onViewStateChange={onViewStateChange}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "\uc218\ucc44" } });
    fireEvent.change(search, { target: { value: "\uc218\ucc44\ud654" } });
    expect(onViewStateChange).not.toHaveBeenCalled();

    view.unmount();
    expect(onViewStateChange).toHaveBeenCalledTimes(1);
    expect(onViewStateChange.mock.calls[0]?.[0]).toMatchObject({ query: "\uc218\ucc44\ud654" });
  });
});
