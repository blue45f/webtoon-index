// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BRAND_KIT_FONT, type BrandKit } from "./studio-brand-kit";
import { StudioBrandKitSqliteRepositoryError } from "./studio-brand-kit-sqlite-repository";
import {
  StudioBrandKitPanel,
  type StudioBrandKitLibraryRepository,
  type StudioBrandKitPaletteRepository,
} from "./StudioBrandKitPanel";

const EMPTY_PALETTE_REPOSITORY: StudioBrandKitPaletteRepository = {
  authority: "injected",
  async list() {
    return [];
  },
};

function kitFixture(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    id: "brand-kit-1",
    name: "기존 브랜드",
    createdAt: 1,
    updatedAt: 1,
    paletteId: null,
    headingFont: DEFAULT_BRAND_KIT_FONT,
    bodyFont: DEFAULT_BRAND_KIT_FONT,
    logo: null,
    ...overrides,
  };
}

function renderPanel(repository: StudioBrandKitLibraryRepository) {
  return render(
    <StudioBrandKitPanel
      onPickColor={vi.fn()}
      canApplyFont={false}
      onApplyFont={vi.fn()}
      onApplyLogo={vi.fn()}
      repository={repository}
      paletteRepository={EMPTY_PALETTE_REPOSITORY}
    />
  );
}

async function openCreatorAndName(name: string): Promise<void> {
  await screen.findByText("주입 저장소");
  fireEvent.click(screen.getByRole("button", { name: "새 브랜드 킷" }));
  fireEvent.change(screen.getByPlaceholderText("브랜드 킷 이름"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "브랜드 킷 만들기" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioBrandKitPanel durable authority", () => {
  it("hydrates from the injected async repository", async () => {
    const repository: StudioBrandKitLibraryRepository = {
      authority: "injected",
      async list() {
        return [kitFixture()];
      },
      async save(kit) {
        return [kit];
      },
      async rename() {
        throw new Error("not reached");
      },
      async delete() {
        throw new Error("not reached");
      },
    };
    renderPanel(repository);

    expect(await screen.findByText("기존 브랜드")).toBeTruthy();
    expect(screen.getByText("주입 저장소")).toBeTruthy();
  });

  it("keeps a failed durable mutation in explicit current-tab memory", async () => {
    const repository: StudioBrandKitLibraryRepository = {
      authority: "injected",
      async list() {
        return [];
      },
      async save() {
        throw new Error("OPFS quota unavailable");
      },
      async rename() {
        throw new Error("not reached");
      },
      async delete() {
        throw new Error("not reached");
      },
    };
    renderPanel(repository);

    await openCreatorAndName("오프라인 브랜드");

    expect(await screen.findByText("현재 탭 메모리 임시 · 새로고침 시 사라짐")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("현재 탭 메모리에만 유지");
    expect(screen.getByText("오프라인 브랜드")).toBeTruthy();
  });

  it("rejects a canonical limit failure without pretending it was saved in memory", async () => {
    const repository: StudioBrandKitLibraryRepository = {
      authority: "injected",
      async list() {
        return [];
      },
      async save() {
        throw new StudioBrandKitSqliteRepositoryError("limit", "브랜드 킷 40개 상한");
      },
      async rename() {
        throw new Error("not reached");
      },
      async delete() {
        throw new Error("not reached");
      },
    };
    renderPanel(repository);

    await openCreatorAndName("잘리면 안 되는 브랜드");

    expect((await screen.findByRole("alert")).textContent).toContain("40개 상한");
    expect(screen.getByText("주입 저장소")).toBeTruthy();
    expect(screen.queryByText("잘리면 안 되는 브랜드")).toBeNull();
  });

  it("fences a subscription hydration started during save from overwriting the mutation", async () => {
    const stale = kitFixture({ id: "stale-kit", name: "오래된 브랜드" });
    let listCalls = 0;
    let listener: (() => void) | undefined;
    let releaseStale: ((kits: BrandKit[]) => void) | undefined;
    const staleRead = new Promise<BrandKit[]>((resolve) => {
      releaseStale = resolve;
    });
    const repository: StudioBrandKitLibraryRepository = {
      authority: "injected",
      async list() {
        listCalls += 1;
        return listCalls === 1 ? [] : staleRead;
      },
      async save(kit) {
        listener?.();
        return [kit];
      },
      async rename() {
        throw new Error("not reached");
      },
      async delete() {
        throw new Error("not reached");
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    renderPanel(repository);

    await openCreatorAndName("새 브랜드");
    expect(await screen.findByText(/브랜드 킷을 만들었어요/u)).toBeTruthy();

    await act(async () => {
      releaseStale?.([stale]);
      await staleRead;
    });
    expect(screen.queryByText("오래된 브랜드")).toBeNull();
    expect(screen.getByText("새 브랜드")).toBeTruthy();
  });
});
