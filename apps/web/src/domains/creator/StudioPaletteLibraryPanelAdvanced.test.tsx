// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPalette, type StudioNamedPalette } from "./studio-palette-library";
import {
  StudioPaletteLibraryPanel,
  type StudioPaletteLibraryRepository,
} from "./StudioPaletteLibraryPanel";

describe("StudioPaletteLibraryPanel Advanced Features", () => {
  let inMemoryItems: StudioNamedPalette[] = [];
  let repository: StudioPaletteLibraryRepository;

  beforeEach(() => {
    inMemoryItems = [
      createPalette("액션 스릴러", ["#111111", "#ff0000", "#333333"]),
      createPalette("청춘 로맨스", ["#fff0f5", "#ffb6c1", "#ff69b4"]),
    ];

    repository = {
      authority: "injected",
      async list() {
        return [...inMemoryItems];
      },
      async save(palette) {
        const existing = inMemoryItems.findIndex((p) => p.id === palette.id);
        if (existing >= 0) inMemoryItems[existing] = palette;
        else inMemoryItems.push(palette);
        return [...inMemoryItems];
      },
      async rename(id, name) {
        const target = inMemoryItems.find((p) => p.id === id);
        if (target) (target as any).name = name;
        return [...inMemoryItems];
      },
      async delete(id) {
        inMemoryItems = inMemoryItems.filter((p) => p.id !== id);
        return [...inMemoryItems];
      },
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("duplicates a palette with copy icon button", async () => {
    render(
      <StudioPaletteLibraryPanel
        onPickColor={vi.fn()}
        repository={repository}
      />
    );

    const dupBtn = await screen.findByRole("button", { name: "액션 스릴러 팔레트 복제" });
    fireEvent.click(dupBtn);

    expect(await screen.findByText(/“액션 스릴러 \(사본\)”을\(를\) 복제했어요/)).toBeDefined();
    expect(inMemoryItems.some((p) => p.name === "액션 스릴러 (사본)")).toBe(true);
  });

  it("filters palettes by search query", async () => {
    render(
      <StudioPaletteLibraryPanel
        onPickColor={vi.fn()}
        repository={repository}
      />
    );

    // Wait for hydration
    await screen.findByText("액션 스릴러");
    expect(screen.getByText("청춘 로맨스")).toBeDefined();

    // Add 3rd item to trigger search bar appearance
    inMemoryItems.push(createPalette("판타지 모험", ["#00aa55"]));
    cleanup();

    render(
      <StudioPaletteLibraryPanel
        onPickColor={vi.fn()}
        repository={repository}
      />
    );

    const searchInput = await screen.findByRole("textbox", { name: "팔레트 검색" });
    fireEvent.change(searchInput, { target: { value: "로맨스" } });

    expect(screen.getByText("청춘 로맨스")).toBeDefined();
    expect(screen.queryByText("액션 스릴러")).toBeNull();
  });

  it("switches to Webtoon presets tab and copies a preset to repository", async () => {
    render(
      <StudioPaletteLibraryPanel
        onPickColor={vi.fn()}
        repository={repository}
      />
    );

    const presetsTab = await screen.findByRole("tab", { name: "웹툰 추천 프리셋 보기" });
    fireEvent.click(presetsTab);

    expect(screen.getByText("웹툰 인물 피부톤")).toBeDefined();
    expect(screen.getByText("골든아워 노을 하늘")).toBeDefined();

    const copyBtn = screen.getByRole("button", { name: "웹툰 인물 피부톤 내 팔레트로 저장" });
    fireEvent.click(copyBtn);

    expect(await screen.findByText(/웹툰 프리셋 “웹툰 인물 피부톤”을\(를\) 저장했어요/)).toBeDefined();
    expect(inMemoryItems.some((p) => p.name === "웹툰 인물 피부톤")).toBe(true);
  });
});
