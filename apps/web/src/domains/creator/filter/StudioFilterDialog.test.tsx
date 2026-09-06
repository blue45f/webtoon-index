// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioUiPreferencesRepository } from "../studio-ui-preferences-sqlite";

import { STUDIO_FILTER_DIALOG_CATALOG } from "./studio-filter-catalog";
import {
  STUDIO_FILTER_LIBRARY_DATA_POLICY,
  type ProductFilterLibraryRepository,
  type StudioFilterLibraryPreset,
} from "./studio-filter-library-sqlite-repository";
import { StudioFilterDialog } from "./StudioFilterDialog";

const filterDialogCatalogCount = STUDIO_FILTER_DIALOG_CATALOG.length;
const transformFilterCount = STUDIO_FILTER_DIALOG_CATALOG.filter(
  ({ group }) => group === "transform",
).length;

const filterDialogSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/filter/StudioFilterDialog.tsx"),
  "utf8",
);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.body.replaceChildren();
});

const CANVAS_RECT = {
  bottom: 700,
  height: 500,
  left: 300,
  right: 1200,
  top: 200,
  width: 900,
  x: 300,
  y: 200,
} as const;

/** 실제 스튜디오와 같은 형태의 루트 + 포커스 가능한 작업 캔버스 뷰포트(jsdom은 레이아웃이 없다). */
function mountStudioRootWithCanvas(): {
  root: HTMLElement;
  rootRef: { current: HTMLElement | null };
  viewport: HTMLElement;
} {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  viewport.setAttribute("data-studio-canvas-viewport", "");
  viewport.tabIndex = 0;
  const rect = { ...CANVAS_RECT, toJSON: () => ({}) } as DOMRect;
  viewport.getBoundingClientRect = () => rect;
  viewport.getClientRects = () => [rect] as unknown as DOMRectList;
  root.append(viewport);
  document.body.append(root);
  return { root, rootRef: { current: root }, viewport };
}

function backdrop(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-studio-modal-backdrop='true']")!;
}

function createUiPreferencesHarness() {
  const values = new Map<string, string>();
  const repository = createStudioUiPreferencesRepository({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  });
  return {
    values,
    acquire: async () => repository,
  };
}

/**
 * jsdom에는 레이아웃이 없어 모든 요소가 getClientRects().length === 0이고, 그러면 모달이 초기
 * 포커스를 다이얼로그 안으로 못 옮긴다. 그 상태로 언마운트하면 React가 커밋 뮤테이션 단계에서
 * "커밋 직전 포커스"(= 런처)를 되돌려 놓아, 실제 브라우저에서는 일어나지 않는 결과가 나온다.
 * 최소한의 레이아웃만 흉내 내 진짜 포커스 복귀 경로를 측정한다.
 */
function withStubbedLayout<T>(run: () => T): T {
  const original = Element.prototype.getClientRects;
  const rect = { ...CANVAS_RECT, toJSON: () => ({}) } as DOMRect;
  Element.prototype.getClientRects = function getClientRects() {
    return [rect] as unknown as DOMRectList;
  };
  try {
    return run();
  } finally {
    Element.prototype.getClientRects = original;
  }
}

function renderMotionFilterDialog(
  mutationLocked = false,
  targetKind: "image" | "page-composite" = "image",
  options: { applying?: boolean; mutationLockReason?: string } = {},
): string {
  return renderToStaticMarkup(
    <StudioFilterDialog
      activeKey="filter:motion-blur"
      kind="motion-blur"
      image={{}}
      initialDraft={{ kind: "motion-blur", distance: 12, angle: -45 }}
      rootRef={createRef<HTMLElement>()}
      targetKind={targetKind}
      mutationLocked={mutationLocked}
      mutationLockReason={options.mutationLockReason}
      applying={options.applying}
      onPreview={vi.fn()}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

function renderInteractiveMotionFilterDialog(
  acquireUiPreferences = createUiPreferencesHarness().acquire,
) {
  const onApply = vi.fn();
  render(
    <StudioFilterDialog
      activeKey="filter:motion-blur"
      kind="motion-blur"
      image={{}}
      initialDraft={{ kind: "motion-blur", distance: 12, angle: -45 }}
      rootRef={createRef<HTMLElement>()}
      acquireUiPreferences={acquireUiPreferences}
      onPreview={vi.fn()}
      onApply={onApply}
      onClose={vi.fn()}
    />,
  );
  return { onApply };
}

describe("StudioFilterDialog", () => {
  it("renders a narrow-screen-safe number layout and keeps signed values visible", () => {
    const html = renderMotionFilterDialog();

    expect(html).toContain("grid-cols-[minmax(0,1fr)_5.5rem]");
    expect(html).toContain(
      "min-[420px]:grid-cols-[minmax(5rem,1fr)_minmax(0,2fr)_5.5rem]",
    );
    expect(html).toContain('aria-label="각도 숫자"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('value="-45"');
  });

  it("preserves empty and negative editing drafts until blur or Enter commits them", () => {
    expect(filterDialogSource).toContain(
      "const [numberDraft, setNumberDraft] = useState<string | null>(null)",
    );
    expect(filterDialogSource).toContain("isEditableNumberDraft(event.target.value)");
    expect(filterDialogSource).toContain('normalized === ""');
    expect(filterDialogSource).toContain('normalized === "-"');
    expect(filterDialogSource).toContain(
      "onBlur={(event) => commitNumberDraft(event.currentTarget.value)}",
    );
    expect(filterDialogSource).toContain('if (event.key === "Enter")');
    expect(filterDialogSource).not.toContain('type="number"');
  });

  it("hides the pointer backdrop from assistive technology without hiding the dialog", () => {
    const html = renderMotionFilterDialog();

    expect(html).toContain(
      'tabindex="-1" aria-hidden="true" data-studio-modal-backdrop="true"',
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-describedby="studio-filter-dialog-description"');
    expect(html).not.toContain('aria-label="필터 창 닫기"');
  });

  it("keeps image targeting as the default non-destructive workflow", () => {
    const html = renderMotionFilterDialog();

    expect(html).toContain("선택한 이미지 레이어에 비파괴 필터로 적용합니다.");
    expect(html).not.toContain('id="studio-filter-composite-notice"');
  });

  it("defaults an active pixel selection to inside and exposes whole/outside scopes", () => {
    const onApply = vi.fn();
    render(
      <StudioFilterDialog
        activeKey="filter:motion-blur-selection"
        kind="motion-blur"
        image={{}}
        initialDraft={{ kind: "motion-blur", distance: 12, angle: -45 }}
        rootRef={createRef<HTMLElement>()}
        selectionAvailable
        selectionFeatherPx={8}
        selectionInverted
        onPreview={vi.fn()}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("group", { name: "적용 범위" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "선택 안" }) as HTMLInputElement).checked)
      .toBe(true);
    expect(screen.getByText(/현재 선택\(반전\).*페더 8px/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "선택 안에 적용" })).toBeTruthy();

    fireEvent.click(screen.getByText("선택 밖"));
    fireEvent.click(screen.getByRole("button", { name: "선택 밖에 적용" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[2]).toBe("outside");
  });

  it("keeps selection scope hidden for page composites", () => {
    const html = renderToStaticMarkup(
      <StudioFilterDialog
        activeKey="filter:page-selection"
        kind="motion-blur"
        image={{}}
        rootRef={createRef<HTMLElement>()}
        targetKind="page-composite"
        selectionAvailable
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).not.toContain("적용 범위");
    expect(html).not.toContain("선택 안에 적용");
  });

  it("explains page compositing, source preservation, and one-step undo accessibly", () => {
    const html = renderMotionFilterDialog(false, "page-composite");

    expect(html).toContain(
      'aria-describedby="studio-filter-dialog-description studio-filter-composite-notice"',
    );
    expect(html).toContain(
      "현재 보이는 페이지를 편집 가능한 합성 레이어로 만들고, 원본 레이어를 보존한 채 필터를 적용합니다.",
    );
    expect(html).toContain('id="studio-filter-composite-notice" role="note"');
    expect(html).toContain("원본은 그대로 유지됩니다.");
    expect(html).toContain(
      "적용 후 실행 취소 한 번으로 새 합성 레이어만 제거할 수 있습니다.",
    );
  });

  it("describes both page compositing and the lock state when mutation is blocked", () => {
    const html = renderMotionFilterDialog(true, "page-composite");

    expect(html).toContain(
      'aria-describedby="studio-filter-dialog-description studio-filter-composite-notice studio-filter-lock-message"',
    );
  });

  it("uses at least 44px mobile and coarse-pointer targets for frequent actions", () => {
    const html = renderMotionFilterDialog();

    expect(html).toContain("h-11 w-full cursor-pointer");
    expect(html).toContain("pointer-coarse:h-11");
    expect(html).toContain("size-11 shrink-0");
    expect(html).toContain("pointer-coarse:size-11");
    expect(html.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(html.match(/pointer-coarse:min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("explains a locked mutation visibly and to assistive technology", () => {
    const html = renderMotionFilterDialog(true);

    expect(html).toContain(
      'aria-describedby="studio-filter-dialog-description studio-filter-lock-message"',
    );
    expect(html).toContain('id="studio-filter-lock-message"');
    expect(html).toContain('role="status"');
    expect(html).toContain("선택한 이미지 또는 문서가 잠겨 있어 적용할 수 없습니다.");
    expect(html).toContain(
      'disabled="" aria-describedby="studio-filter-lock-message"',
    );
    expect(html).toContain(">적용</button>");
    expect(html).not.toContain(">저장</button>");
  });

  it("uses the exact supplied mutation lock reason instead of the generic copy", () => {
    const reason = "공동 편집 동기화 중에는 필터 레이어를 추가할 수 없습니다.";
    const html = renderMotionFilterDialog(true, "image", {
      mutationLockReason: reason,
    });

    expect(html).toContain(`role="status" aria-live="polite" aria-atomic="true"`);
    expect(html).toContain(reason);
    expect(html).not.toContain("선택한 이미지 또는 문서가 잠겨 있어 적용할 수 없습니다.");
    expect(html).toContain('aria-describedby="studio-filter-lock-message"');
  });

  it("announces an in-flight apply, blocks reset and apply re-entry, and keeps dismissal available", () => {
    const html = renderMotionFilterDialog(false, "page-composite", { applying: true });

    expect(html.match(/aria-busy="true"/g)?.length ?? 0).toBe(2);
    expect(html).toContain(">적용 중…</button>");
    expect(html).not.toContain(">적용</button>");
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/<button type="button"[^>]*>취소<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*aria-label="[^"]+ 닫기"[^>]*>/);
    expect(filterDialogSource).toContain("if (applying) return;");
    expect(filterDialogSource).toContain("if (mutationLocked || applying) return;");
  });

  it("keeps brightness and contrast controls inside the renderer's exact ±80 range", () => {
    expect(filterDialogSource).toMatch(/label="밝기\/명도"[\s\S]*?min=\{-80\}[\s\S]*?max=\{80\}/u);
    expect(filterDialogSource).toMatch(/label="명도"[\s\S]*?min=\{-80\}[\s\S]*?max=\{80\}/u);
    expect(filterDialogSource).toMatch(/label="대비"[\s\S]*?min=\{-80\}[\s\S]*?max=\{80\}/u);
  });

  it("surfaces a matching preset from the SQLite product repository", async () => {
    const sqlPreset: StudioFilterLibraryPreset = {
      id: "creator-pack:filter-pack:vignette-1",
      packageId: "filter-pack",
      entryId: "vignette-1",
      name: "대사 집중 비네트",
      engine: "vignette",
      values: { darkness: 35, size: 45, roundness: 100, feather: 60 },
      installedAt: 1_000,
      updatedAt: 1_000,
      category: "creator-pack",
      favorite: false,
      sortOrder: 0,
      packageVersion: "12.0.0",
      packageFingerprint: "fixture",
    };
    const product: ProductFilterLibraryRepository = {
      authority: "sqlite",
      legacyDataPolicy: STUDIO_FILTER_LIBRARY_DATA_POLICY,
      repository: {
        query: vi.fn().mockResolvedValue({
          items: [sqlPreset],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        }),
        getById: vi.fn(),
        put: vi.fn(),
        putMany: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        setFavorite: vi.fn(),
      },
    };
    render(
      <StudioFilterDialog
        activeKey="filter:vignette"
        kind="vignette"
        image={{}}
        rootRef={createRef<HTMLElement>()}
        acquireFilterLibrary={() => Promise.resolve(product)}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("대사 집중 비네트")).toBeTruthy());
    expect(screen.getByText("1개 · 무제한 · 로컬 SQL")).toBeTruthy();
    expect(product.repository.query).toHaveBeenCalledWith({
      cursor: null,
      engine: "vignette",
      limit: 128,
    });
  });

  it("labels the SQLite-unavailable memory session as non-persistent and never unlimited", async () => {
    const sessionPreset: StudioFilterLibraryPreset = {
      id: "creator-pack:session:vignette-1",
      packageId: "session",
      entryId: "vignette-1",
      name: "세션 비네트",
      engine: "vignette",
      values: { darkness: 30, size: 50, roundness: 90, feather: 55 },
      installedAt: 2_000,
      updatedAt: 2_000,
      category: "creator-pack",
      favorite: false,
      sortOrder: 0,
      packageVersion: "12.0.0",
      packageFingerprint: "session-only",
    };
    const product: ProductFilterLibraryRepository = {
      authority: "memory-session",
      legacyDataPolicy: STUDIO_FILTER_LIBRARY_DATA_POLICY,
      repository: {
        query: vi.fn().mockResolvedValue({
          items: [sessionPreset],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        }),
        getById: vi.fn(),
        put: vi.fn(),
        putMany: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        setFavorite: vi.fn(),
      },
    };
    const { container } = render(
      <StudioFilterDialog
        activeKey="filter:vignette-session"
        kind="vignette"
        image={{}}
        rootRef={createRef<HTMLElement>()}
        acquireFilterLibrary={() => Promise.resolve(product)}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(
      "1개 · 비영속 메모리 세션 · 브라우저 종료 시 사라짐",
    )).toBeTruthy());
    expect(container.querySelector("[data-studio-filter-library-authority]")
      ?.getAttribute("data-studio-filter-library-authority")).toBe("memory-session");
    expect(screen.getByText("현재 세션 Creator Pack 필터 프리셋")).toBeTruthy();
    expect(screen.getByText(/현재 세션에만 유지됩니다/u)).toBeTruthy();
    expect(container.textContent).not.toContain("무제한");
    expect(container.textContent).not.toContain("호환 저장소");
  });

  it("keyset-pages installed SQL presets instead of rendering the whole catalog", async () => {
    const first: StudioFilterLibraryPreset = {
      id: "creator-pack:filter-pack:vignette-1",
      packageId: "filter-pack",
      entryId: "vignette-1",
      name: "첫 프리셋",
      engine: "vignette",
      values: { darkness: 35, size: 45, roundness: 100, feather: 60 },
      installedAt: 1_000,
      updatedAt: 1_000,
      category: "creator-pack",
      favorite: false,
      sortOrder: 0,
      packageVersion: "12.0.0",
      packageFingerprint: "fixture",
    };
    const second = {
      ...first,
      id: "creator-pack:filter-pack:vignette-2",
      entryId: "vignette-2",
      name: "둘째 프리셋",
      sortOrder: 1,
    };
    const cursor = {
      favorite: false,
      sortOrder: 0,
      updatedAt: 1_000,
      id: first.id,
    };
    const query = vi.fn()
      .mockResolvedValueOnce({
        items: [first],
        nextCursor: cursor,
        hasMore: true,
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        items: [second],
        nextCursor: null,
        hasMore: false,
        totalCount: 2,
      });
    const product: ProductFilterLibraryRepository = {
      authority: "sqlite",
      legacyDataPolicy: STUDIO_FILTER_LIBRARY_DATA_POLICY,
      repository: {
        query,
        getById: vi.fn(),
        put: vi.fn(),
        putMany: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        setFavorite: vi.fn(),
      },
    };
    render(
      <StudioFilterDialog
        activeKey="filter:vignette-paged"
        kind="vignette"
        image={{}}
        rootRef={createRef<HTMLElement>()}
        acquireFilterLibrary={() => Promise.resolve(product)}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const loadMore = await screen.findByRole("button", { name: "더 불러오기 (1/2)" });
    expect(screen.queryByText("둘째 프리셋")).toBeNull();
    fireEvent.click(loadMore);
    await waitFor(() => expect(screen.getByText("둘째 프리셋")).toBeTruthy());
    expect(query).toHaveBeenNthCalledWith(2, {
      cursor,
      engine: "vignette",
      limit: 128,
    });
    expect(screen.queryByRole("button", { name: /더 불러오기/u })).toBeNull();
  });

  it("renders schema-driven sliders for filter-pack kinds (vignette)", () => {
    const html = renderToStaticMarkup(
      <StudioFilterDialog
        activeKey="filter:vignette"
        kind="vignette"
        image={{}}
        rootRef={createRef<HTMLElement>()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain(">비네트</h2>");
    for (const label of ["어둡기", "크기", "둥글기", "페더"]) {
      expect(html).toContain(`>${label}</label>`);
      expect(html).toContain(`aria-label="${label} 숫자"`);
    }
    // 첫 파라미터가 초기 포커스 대상이다.
    expect(html).toContain('data-autofocus="true"');
  });

  it("renders native color pickers for the duotone filter-pack kind", () => {
    const html = renderToStaticMarkup(
      <StudioFilterDialog
        activeKey="filter:duotone"
        kind="duotone"
        image={{ duotoneShadow: "#102030", duotoneHighlight: "#f0e0d0" }}
        rootRef={createRef<HTMLElement>()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain(">세피아 / 듀오톤</h2>");
    expect(html.match(/type="color"/g)?.length ?? 0).toBe(2);
    // 현재 이미지의 듀오톤 색을 되읽어 초기값으로 쓴다(다시 열기 패리티).
    expect(html).toContain('value="#102030"');
    expect(html).toContain('value="#f0e0d0"');
    expect(html).toContain("어두운 영역 색");
    expect(html).toContain("밝은 영역 색");
  });

  it("renders deterministic union-wave controls with edge and alpha behavior explained", () => {
    const html = renderToStaticMarkup(
      <StudioFilterDialog
        activeKey="filter:ripple-warp"
        kind="ripple-warp"
        image={{}}
        rootRef={createRef<HTMLElement>()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain(">동심원 물결</h2>");
    for (const label of ["진폭", "파장", "중심 X", "중심 Y", "위상"]) {
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).toContain("가장자리는 반복 없이 고정해 빈 틈을 막고");
    expect(html).toContain("투명도는 원본 그대로");
    expect(html).toContain("같은 시드는 언제나 같은 결과");
  });

  it("reopens a filter-pack kind from a stored last-filter draft", () => {
    const html = renderToStaticMarkup(
      <StudioFilterDialog
        activeKey="filter:mosaic"
        kind="mosaic"
        image={{}}
        initialDraft={{ kind: "mosaic", values: { cell: 24 } }}
        rootRef={createRef<HTMLElement>()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain(">모자이크 / 픽셀화</h2>");
    expect(html).toContain('value="24"');
  });

  it("opens a narrow-safe visual gallery and searches the applicable catalog", () => {
    renderInteractiveMotionFilterDialog();

    const gallery = screen.getByRole("region", { name: "필터 갤러리" });
    const openButton = within(gallery).getByRole("button", {
      name: /다른 필터 둘러보기/,
    });
    expect(openButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(openButton);
    expect(openButton.getAttribute("aria-expanded")).toBe("true");
    expect(within(gallery).getByText(`${filterDialogCatalogCount}개 필터`)).toBeTruthy();
    expect(within(gallery).getAllByRole("button", { name: /필터 선택$/ }))
      .toHaveLength(filterDialogCatalogCount);

    fireEvent.change(within(gallery).getByRole("searchbox", { name: "필터 검색" }), {
      target: { value: "CRT" },
    });
    expect(within(gallery).getByText("1개 필터")).toBeTruthy();
    expect(
      within(gallery).getByRole("button", { name: "스캔라인 (CRT) 필터 선택" }),
    ).toBeTruthy();
  });

  it("filters by category and keeps every gallery control touch-safe", () => {
    renderInteractiveMotionFilterDialog();
    const gallery = screen.getByRole("region", { name: "필터 갤러리" });
    fireEvent.click(
      within(gallery).getByRole("button", { name: /다른 필터 둘러보기/ }),
    );
    // The category strip is a radiogroup: exactly one category is active, and nine independent
    // aria-pressed toggles said otherwise.
    fireEvent.click(within(gallery).getByRole("radio", { name: "변형·왜곡" }));
    expect(within(gallery).getByRole("radio", { name: "변형·왜곡" }).getAttribute("aria-checked"))
      .toBe("true");

    expect(within(gallery).getByText(`${transformFilterCount}개 필터`)).toBeTruthy();
    expect(within(gallery).getAllByRole("button", { name: /필터 선택$/ }))
      .toHaveLength(transformFilterCount);
    expect(filterDialogSource).toContain("min-h-11 w-full min-w-0");
    expect(filterDialogSource).toContain("grid-cols-2");
    expect(filterDialogSource).toContain("max-h-[min(44dvh,24rem)]");
    // ArrowUp/ArrowDown move by one visual row, so a later grid-cols-3 must not silently
    // desync the arrow step from what the artist sees.
    expect(filterDialogSource).toContain("STUDIO_FILTER_GALLERY_COLUMNS = 2");
  });

  it("keeps the expanded gallery to one tab stop per card", () => {
    renderInteractiveMotionFilterDialog();
    const gallery = screen.getByRole("region", { name: "필터 갤러리" });
    fireEvent.click(
      within(gallery).getByRole("button", { name: /다른 필터 둘러보기/ }),
    );
    // Scope the stars to the grid: the browse toggle's own name ends in 즐겨찾기 too, and
    // counting from the gallery region sweeps it in.
    const grid = within(screen.getByRole("group", { name: "필터 카드" }));
    const cards = grid.getAllByRole("button", { name: /필터 선택$/ });
    expect(cards).toHaveLength(filterDialogCatalogCount);
    expect(cards.filter((card) => card.tabIndex === 0)).toHaveLength(1);
    expect(cards.filter((card) => card.tabIndex === -1))
      .toHaveLength(filterDialogCatalogCount - 1);
    expect(
      grid.getAllByRole("button", { name: /즐겨찾기$/ }).filter((star) => star.tabIndex === 0),
    ).toHaveLength(1);
  });

  it("moves gallery focus by row and column without leaving the grid", () => {
    renderInteractiveMotionFilterDialog();
    const gallery = screen.getByRole("region", { name: "필터 갤러리" });
    fireEvent.click(
      within(gallery).getByRole("button", { name: /다른 필터 둘러보기/ }),
    );
    const grid = within(screen.getByRole("group", { name: "필터 카드" }));
    const cards = grid.getAllByRole("button", { name: /필터 선택$/ });
    const nameOf = (index: number) => cards[index]!.getAttribute("aria-label");

    cards[0]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(nameOf(1));

    cards[0]!.focus();
    // Two columns, so one row down is two cards along.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(nameOf(2));

    cards[0]!.focus();
    // Clamped, not wrapped: wrapping here would throw focus to the bottom of a scrolling grid.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(nameOf(0));

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(nameOf(cards.length - 1));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(nameOf(0));
  });

  it("hands the roving stop to the first remaining card when a search drops it", () => {
    renderInteractiveMotionFilterDialog();
    const gallery = screen.getByRole("region", { name: "필터 갤러리" });
    fireEvent.click(
      within(gallery).getByRole("button", { name: /다른 필터 둘러보기/ }),
    );
    const grid = () => within(screen.getByRole("group", { name: "필터 카드" }));
    const before = grid().getAllByRole("button", { name: /필터 선택$/ });
    fireEvent.focus(before.at(-1)!);

    // Search runs per keystroke, so the remembered card disappears constantly. Without the
    // fallback the grid would be left with no tabbable entry at all.
    fireEvent.change(within(gallery).getByRole("searchbox", { name: "필터 검색" }), {
      target: { value: "가우시안" },
    });
    const after = grid().getAllByRole("button", { name: /필터 선택$/ });
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before.length);
    const tabbable = after.filter((card) => card.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(after[0]);
  });

  it("persists filter favorites in SQLite preferences and restores the favorites view", async () => {
    const preferences = createUiPreferencesHarness();
    const first = renderInteractiveMotionFilterDialog(preferences.acquire);
    const firstGallery = screen.getByRole("region", { name: "필터 갤러리" });
    fireEvent.click(
      within(firstGallery).getByRole("button", { name: /다른 필터 둘러보기/ }),
    );
    // The name stays put and aria-pressed carries the state; swapping the name too announced the
    // undo action as already done.
    const favorite = within(firstGallery).getByRole("button", { name: "글리치 즐겨찾기" });
    expect(favorite.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(favorite);
    expect(
      within(firstGallery).getByRole("button", { name: "글리치 즐겨찾기" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(first.onApply).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(preferences.values.get("effect-favorites")).toContain("filter:glitch");
    });

    cleanup();
    renderInteractiveMotionFilterDialog(preferences.acquire);
    await waitFor(() => {
      expect(
        screen.getByRole("dialog").getAttribute("data-studio-ui-preferences-authority"),
      ).toBe("sqlite-opfs");
    });
    const secondGallery = screen.getByRole("region", { name: "필터 갤러리" });
    fireEvent.click(
      within(secondGallery).getByRole("button", { name: /다른 필터 둘러보기/ }),
    );
    fireEvent.click(within(secondGallery).getByRole("radio", { name: "즐겨찾기" }));
    expect(
      within(secondGallery).getByRole("button", { name: "글리치 필터 선택" }),
    ).toBeTruthy();
  });

  it("discloses memory-only favorites when SQLite/OPFS preferences are unavailable", async () => {
    renderInteractiveMotionFilterDialog(async () => {
      throw new Error("SQLite unavailable");
    });
    expect((await screen.findByRole("status")).textContent).toContain("이번 탭에서만 유지");
    expect(
      screen.getByRole("dialog").getAttribute("data-studio-ui-preferences-authority"),
    ).toBe("memory-only");
  });

  it("switches filter kinds in place, remembers recents, and preserves apply semantics", () => {
    const { onApply } = renderInteractiveMotionFilterDialog();
    const gallery = screen.getByRole("region", { name: "필터 갤러리" });
    fireEvent.click(
      within(gallery).getByRole("button", { name: /다른 필터 둘러보기/ }),
    );
    fireEvent.change(within(gallery).getByRole("searchbox", { name: "필터 검색" }), {
      target: { value: "렌즈 플레어" },
    });
    fireEvent.click(
      within(gallery).getByRole("button", { name: "렌즈 플레어 필터 선택" }),
    );

    expect(screen.getByRole("heading", { name: "렌즈 플레어" })).toBeTruthy();
    expect(
      within(gallery).getByRole("button", { name: /다른 필터 둘러보기/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[1]).toMatchObject({ kind: "lens-flare" });
  });

  it("cuts the canvas out of the scrim while the canvas preview is on, without changing dismissal", () => {
    const { rootRef } = mountStudioRootWithCanvas();
    const onClose = vi.fn();
    render(
      <StudioFilterDialog
        activeKey="filter:motion-blur"
        kind="motion-blur"
        image={{}}
        rootRef={rootRef}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={onClose}
      />,
    );

    const scrim = backdrop();
    expect(scrim.dataset.studioFilterPreviewCutout).toBe("true");
    const bands = [...scrim.querySelectorAll("span")].filter((band) =>
      band.className.includes("backdrop-blur-sm"),
    );
    expect(bands).toHaveLength(4);
    // 캔버스 사각형(300,200 ~ 1200,700)이 어느 밴드에도 칠해지지 않는다.
    expect(bands.map((band) => band.getAttribute("style"))).toEqual([
      "top: 0px; left: 0px; right: 0px; height: 200px;",
      "top: 700px; left: 0px; right: 0px; bottom: 0px;",
      "top: 200px; left: 0px; width: 300px; height: 500px;",
      "top: 200px; left: 1200px; right: 0px; height: 500px;",
    ]);
    // 클릭 캐처는 여전히 화면 전체 하나 — 바깥 클릭 해제 동작은 그대로다.
    expect(scrim.className).toContain("absolute inset-0");
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores the whole-screen scrim when the artist turns the canvas preview off", () => {
    const { rootRef } = mountStudioRootWithCanvas();
    render(
      <StudioFilterDialog
        activeKey="filter:motion-blur"
        kind="motion-blur"
        image={{}}
        rootRef={rootRef}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "캔버스 미리보기" }));

    const scrim = backdrop();
    expect(scrim.dataset.studioFilterPreviewCutout).toBeUndefined();
    const bands = [...scrim.querySelectorAll("span")].filter((band) =>
      band.className.includes("backdrop-blur-sm"),
    );
    expect(bands).toHaveLength(1);
    expect(bands[0]?.className).toContain("inset-0");
  });

  it("returns focus to the working canvas instead of the shortcut-swallowing menu trigger", () => {
    withStubbedLayout(() => {
      const { root, rootRef, viewport } = mountStudioRootWithCanvas();
      const menu = document.createElement("nav");
      menu.setAttribute("data-studio-shortcut-boundary", "true");
      const trigger = document.createElement("button");
      menu.append(trigger);
      root.append(menu);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const view = render(
        <StudioFilterDialog
          activeKey="filter:motion-blur"
          kind="motion-blur"
          image={{}}
          rootRef={rootRef}
          onPreview={vi.fn()}
          onApply={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      // 모달은 먼저 다이얼로그 안으로 포커스를 가져간다.
      expect(document.activeElement).not.toBe(trigger);

      view.unmount();

      expect(document.activeElement).toBe(viewport);
    });
  });

  it("keeps the default trigger restoration when the launcher does not swallow shortcuts", () => {
    withStubbedLayout(() => {
      const { root, rootRef } = mountStudioRootWithCanvas();
      const trigger = document.createElement("button");
      root.append(trigger);
      trigger.focus();

      const view = render(
        <StudioFilterDialog
          activeKey="filter:motion-blur"
          kind="motion-blur"
          image={{}}
          rootRef={rootRef}
          onPreview={vi.fn()}
          onApply={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      view.unmount();

      expect(document.activeElement).toBe(trigger);
    });
  });
});
