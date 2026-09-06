// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_VRM_1_PUBLIC_LICENSE_URL } from "./studio-vrm-license-metadata";
import { inspectStudioVrmLicenseAuthority } from "./studio-vrm-license-product-gate";
import { StudioVrmCharacterLibraryPanel } from "./StudioVrmCharacterLibraryPanel";

import type { VrmLibraryEntry } from "./vrm-library";
import type { ComponentProps } from "react";

type PanelProps = ComponentProps<typeof StudioVrmCharacterLibraryPanel>;

class CharacterLibraryIntersectionObserver implements IntersectionObserver {
  static instances: CharacterLibraryIntersectionObserver[] = [];

  readonly root: Element | Document | null = null;
  readonly rootMargin: string;
  readonly scrollMargin: string = "0px";
  readonly thresholds: ReadonlyArray<number> = [0];
  private target: Element | null = null;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    CharacterLibraryIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.target = target;
  }

  unobserve(): void {
    this.target = null;
  }

  disconnect(): void {
    this.target = null;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Test helper — fire one intersecting notification for the observed sentinel. */
  trigger(isIntersecting = true): void {
    if (!this.target) return;
    this.callback(
      [{ isIntersecting, target: this.target } as IntersectionObserverEntry],
      this,
    );
  }
}

function createEntry(
  id: string,
  name: string,
  source: VrmLibraryEntry["source"] = "sample",
  patch: Partial<VrmLibraryEntry> = {},
): VrmLibraryEntry {
  return {
    id,
    name,
    source,
    thumbnail: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

function createDefaultProps(): PanelProps {
  return {
    hidden: false,
    entries: [createEntry("sample-1", "샘플 모델")],
    recentCharacterIds: [],
    libraryStatus: "ready",
    libraryError: "",
    activeModelId: "sample-1",
    deletingModelId: null,
    modelStatus: "ready",
    isUploading: false,
    onFileChange: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onCollapse: vi.fn(),
    onRetry: vi.fn(),
  };
}

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props = { ...createDefaultProps(), ...overrides };
  return { props, ...render(<StudioVrmCharacterLibraryPanel {...props} />) };
}

beforeEach(() => {
  CharacterLibraryIntersectionObserver.instances.length = 0;
  vi.stubGlobal("IntersectionObserver", CharacterLibraryIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StudioVrmCharacterLibraryPanel", () => {
  it("renders loading, error, upload-empty, and search-no-result states", () => {
    const view = renderPanel({ entries: [], libraryStatus: "loading" });

    expect(screen.getByText("저장된 캐릭터를 불러오는 중입니다.")).toBeTruthy();
    expect(screen.getByText(/업로드한 캐릭터가 아직 없습니다/)).toBeTruthy();
    expect(view.container.querySelector('[role="tabpanel"]')?.getAttribute("aria-busy")).toBe("true");

    view.rerender(
      <StudioVrmCharacterLibraryPanel
        {...view.props}
        entries={[]}
        libraryStatus="error"
        libraryError="라이브러리를 읽지 못했습니다."
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("라이브러리를 읽지 못했습니다.");
    fireEvent.click(screen.getByRole("button", { name: "라이브러리 다시 불러오기" }));
    expect(view.props.onRetry).toHaveBeenCalledOnce();

    view.rerender(
      <StudioVrmCharacterLibraryPanel
        {...view.props}
        entries={[createEntry("lumi", "루미")]}
        libraryStatus="ready"
      />,
    );
    fireEvent.change(screen.getByLabelText("캐릭터 라이브러리 검색"), {
      target: { value: "없는 캐릭터" },
    });
    expect(screen.getByText(/"없는 캐릭터"와 일치하는 캐릭터가 없어요/)).toBeTruthy();
    expect(screen.getByText("표시 0/0명")).toBeTruthy();
  });

  it("filters entries, resets the visible batch, and expands or collapses pagination", () => {
    const entries = Array.from({ length: 14 }, (_, index) =>
      createEntry(`character-${index + 1}`, `캐릭터 ${String(index + 1).padStart(2, "0")}`),
    );
    const onCollapse = vi.fn();
    renderPanel({ entries, onCollapse });

    expect(screen.getByText("표시 12/14명")).toBeTruthy();
    expect(screen.queryByText("캐릭터 13")).toBeNull();
    expect(screen.getByText(/스크롤하면 자동으로 더 표시/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /캐릭터 2명 더 보기/ }));
    expect(screen.getByText("표시 14/14명")).toBeTruthy();
    expect(screen.getByText("캐릭터 13")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "처음 12명만 보기" }));
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(screen.getByText("표시 12/14명")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /캐릭터 2명 더 보기/ }));
    fireEvent.change(screen.getByLabelText("캐릭터 라이브러리 검색"), {
      target: { value: "캐릭터 14" },
    });
    expect(screen.getByText("표시 1/1명")).toBeTruthy();
    expect(screen.getByText("캐릭터 14")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("캐릭터 라이브러리 검색"), {
      target: { value: "" },
    });
    expect(screen.getByText("표시 12/14명")).toBeTruthy();
    expect(screen.queryByText("캐릭터 13")).toBeNull();
  });

  it("expands the local window when the infinite-scroll sentinel intersects", () => {
    const entries = Array.from({ length: 14 }, (_, index) =>
      createEntry(`character-${index + 1}`, `캐릭터 ${String(index + 1).padStart(2, "0")}`),
    );
    renderPanel({ entries });

    expect(screen.getByText("표시 12/14명")).toBeTruthy();
    expect(screen.queryByText("캐릭터 13")).toBeNull();

    const observer = CharacterLibraryIntersectionObserver.instances.at(-1);
    expect(observer).toBeTruthy();
    act(() => {
      observer?.trigger(true);
    });

    expect(screen.getByText("표시 14/14명")).toBeTruthy();
    expect(screen.getByText("캐릭터 13")).toBeTruthy();
  });

  it("requests only the current 12-entry thumbnail window and advances durable metadata pages", () => {
    const entries = Array.from({ length: 14 }, (_, index) =>
      createEntry(`paged-${index + 1}`, `페이지 캐릭터 ${index + 1}`, "sqlite-opfs"),
    );
    const onVisibleWindowChange = vi.fn();
    const onLoadMore = vi.fn();
    renderPanel({
      entries,
      hasMoreEntries: true,
      onLoadMore,
      onVisibleWindowChange,
    });

    expect(onVisibleWindowChange).toHaveBeenLastCalledWith(entries.slice(0, 12));
    fireEvent.click(screen.getByRole("button", { name: /캐릭터 2명 더 보기/ }));
    expect(onVisibleWindowChange).toHaveBeenLastCalledWith(entries.slice(2, 14));
    fireEvent.click(screen.getByRole("button", {
      name: "저장된 캐릭터 다음 페이지 불러오기",
    }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("loads the next durable page when the sentinel intersects after the local window is exhausted", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      createEntry(`paged-${index + 1}`, `페이지 캐릭터 ${index + 1}`, "sqlite-opfs"),
    );
    const onLoadMore = vi.fn();
    renderPanel({
      entries,
      hasMoreEntries: true,
      onLoadMore,
    });

    expect(screen.getByRole("button", {
      name: "저장된 캐릭터 다음 페이지 불러오기",
    })).toBeTruthy();

    const observer = CharacterLibraryIntersectionObserver.instances.at(-1);
    expect(observer).toBeTruthy();
    act(() => {
      observer?.trigger(true);
    });
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("preserves recent character order and selects a recent entry once", () => {
    const entries = [
      createEntry("one", "하나"),
      createEntry("two", "둘"),
      createEntry("three", "셋"),
    ];
    const onSelect = vi.fn();
    renderPanel({
      entries,
      recentCharacterIds: ["three", "missing", "one", "two"],
      activeModelId: "one",
      onSelect,
    });

    const recentButtons = screen.getByText("최근 캐릭터").nextElementSibling;
    if (!(recentButtons instanceof HTMLElement)) throw new Error("missing recent character controls");
    expect(Array.from(recentButtons.querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "셋",
      "하나",
      "둘",
    ]);

    fireEvent.click(within(recentButtons).getByRole("button", { name: "셋" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(entries[2]);
  });

  it("reflects active, deleting, and uploading transactions without enabling duplicate actions", () => {
    const uploaded = createEntry("uploaded", "업로드 모델", "sqlite-opfs");
    renderPanel({
      entries: [createEntry("sample", "샘플 모델"), uploaded],
      activeModelId: uploaded.id,
      deletingModelId: uploaded.id,
      modelStatus: "loading",
      isUploading: true,
    });

    const uploadButton = screen.getByRole("button", { name: "VRM 업로드" }) as HTMLButtonElement;
    const activeButton = screen.getByRole("button", { name: "업로드 모델 선택" }) as HTMLButtonElement;
    const deleteButton = screen.getByRole("button", { name: "업로드 모델 삭제" }) as HTMLButtonElement;

    expect(uploadButton.disabled).toBe(true);
    expect(activeButton.disabled).toBe(true);
    expect(activeButton.getAttribute("aria-pressed")).toBe("true");
    expect(activeButton.parentElement?.className).toContain("border-accent/60");
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.querySelector(".animate-spin")).toBeTruthy();
    expect(viewBusyState()).toBe("true");
  });

  it("keeps thumbnails contained and distinguishes bundled and uploaded assets", () => {
    const view = renderPanel({
      entries: [
        createEntry("sample", "썸네일 샘플", "sample", { thumbnail: "data:image/png;base64,sample" }),
        createEntry("uploaded", "사용자 모델", "sqlite-opfs"),
      ],
      activeModelId: "sample",
    });

    const thumbnail = view.container.querySelector("img");
    expect(thumbnail?.getAttribute("alt")).toBe("");
    expect(thumbnail?.className).toContain("object-contain");
    expect(screen.getByText("번들")).toBeTruthy();
    expect(screen.getByText("SQLite/OPFS")).toBeTruthy();
  });

  it("shows unknown and restricted rights without disabling local model selection", () => {
    const restrictedAuthority = inspectStudioVrmLicenseAuthority({
      extensions: {
        VRMC_vrm: {
          specVersion: "1.0",
          meta: {
            name: "재배포 금지 모델",
            authors: ["Creator"],
            licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
            allowRedistribution: false,
          },
        },
      },
    });
    const unknown = createEntry("unknown", "미확인 모델", "sqlite-opfs");
    const restricted = createEntry("restricted", "제한 모델", "sqlite-opfs", {
      licenseAuthority: restrictedAuthority,
    });
    const onSelect = vi.fn();
    renderPanel({ entries: [unknown, restricted], activeModelId: "none", onSelect });

    expect(screen.getByText("권리 미확인")).toBeTruthy();
    expect(screen.getByText("재배포 제한")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "미확인 모델 선택" }));
    expect(onSelect).toHaveBeenCalledWith(unknown);
    fireEvent.click(screen.getByText("재배포 제한"));
    expect(screen.getByText("원본 파일 재배포 금지")).toBeTruthy();
    expect(screen.getByRole("link", { name: /라이선스 문서/ }).getAttribute("href"))
      .toBe(STUDIO_VRM_1_PUBLIC_LICENSE_URL);
  });

  it("owns a multiple .vrm file picker and forwards its change exactly once", () => {
    const onFileChange = vi.fn();
    const view = renderPanel({ onFileChange });
    const fileInput = screen.getByLabelText("VRM 캐릭터 파일 선택") as HTMLInputElement;
    const inputClick = vi.spyOn(fileInput, "click");

    expect(fileInput.accept).toBe(".vrm");
    expect(fileInput.multiple).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "VRM 업로드" }));
    expect(inputClick).toHaveBeenCalledOnce();

    fireEvent.change(fileInput, {
      target: { files: [new File(["vrm"], "character.vrm", { type: "model/gltf-binary" })] },
    });
    expect(onFileChange).toHaveBeenCalledOnce();
    expect(view.container.querySelector('input[type="file"]')).toBe(fileInput);
  });

  it("selects and deletes exactly once while stopping delete click propagation", () => {
    const entry = createEntry("uploaded", "업로드 대상", "sqlite-opfs");
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const onOuterClick = vi.fn();
    const props = {
      ...createDefaultProps(),
      entries: [entry],
      activeModelId: "different",
      onSelect,
      onDelete,
    };
    render(<StudioVrmCharacterLibraryPanel {...props} />);
    document.body.addEventListener("click", onOuterClick, { once: true });

    fireEvent.click(screen.getByRole("button", { name: "업로드 대상 삭제" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith(entry);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOuterClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "업로드 대상 선택" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(entry);
    expect(onOuterClick).toHaveBeenCalledOnce();
  });

  it("keeps labeled focus affordances and coarse-pointer delete targets", () => {
    renderPanel({ entries: [createEntry("uploaded", "접근성 모델", "sqlite-opfs")] });

    const panel = document.querySelector('[role="tabpanel"]');
    const search = screen.getByLabelText("캐릭터 라이브러리 검색");
    const upload = screen.getByRole("button", { name: "VRM 업로드" });
    const deleteButton = screen.getByRole("button", { name: "접근성 모델 삭제" });

    expect(panel?.id).toBe("vrm-character-section-library");
    expect(panel?.getAttribute("aria-labelledby")).toBe("vrm-character-subtab-library");
    expect(search.className).toContain("focus-visible:outline");
    expect(search.className).toContain("min-h-11");
    expect(upload.className).toContain("min-h-11");
    expect(deleteButton.className).toContain("size-9");
    expect(deleteButton.className).toContain("pointer-coarse:size-11");
  });
});

function viewBusyState() {
  return document.querySelector('[role="tabpanel"]')?.getAttribute("aria-busy");
}
