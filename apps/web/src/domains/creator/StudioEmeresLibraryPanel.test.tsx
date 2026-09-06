// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioEmeresLibraryPanel,
  type StudioEmeresLibraryRepository,
} from "./StudioEmeresLibraryPanel";

import type { StudioEmeresLibraryItem } from "./studio-emeres-library";

function item(id: string, name: string): StudioEmeresLibraryItem {
  return {
    id,
    name,
    createdAt: 1_000,
    updatedAt: 1_000,
    src: "data:image/png;base64,YQ==",
    width: 320,
    height: 240,
  };
}

function repositoryFixture(
  entries: StudioEmeresLibraryItem[] = [],
): StudioEmeresLibraryRepository {
  return {
    authority: "injected",
    list: vi.fn(async () => entries),
    save: vi.fn(async (entry) => [entry, ...entries]),
    rename: vi.fn(async () => entries),
    setCategory: vi.fn(async () => entries),
    delete: vi.fn(async () => entries),
  };
}

afterEach(cleanup);

describe("StudioEmeresLibraryPanel SQLite authority UI", () => {
  it("hydrates asynchronously and identifies the injected repository seam", async () => {
    const repository = repositoryFixture([item("emeres-a", "옥상 밑그림")]);
    render(
      <StudioEmeresLibraryPanel
        onPickItem={vi.fn()}
        repository={repository}
      />,
    );

    expect(screen.getByText("SQLite/OPFS 보관함 확인 중")).toBeTruthy();
    expect(await screen.findByText("옥상 밑그림")).toBeTruthy();
    expect(repository.list).toHaveBeenCalledOnce();
    expect(
      document.querySelector("[data-studio-emeres-authority='injected']"),
    ).toBeTruthy();
  });

  it("keeps an accepted mutation only in explicitly labelled tab memory after SQLite failure", async () => {
    const authored = item("emeres-a", "삭제할 틀");
    const repository = repositoryFixture([authored]);
    vi.mocked(repository.delete).mockRejectedValue(new Error("OPFS quota"));
    render(
      <StudioEmeresLibraryPanel
        onPickItem={vi.fn()}
        repository={repository}
      />,
    );

    await screen.findByText("삭제할 틀");
    fireEvent.click(screen.getByRole("button", { name: "삭제할 틀 틀 삭제" }));

    await waitFor(() => {
      expect(screen.queryByText("삭제할 틀")).toBeNull();
      expect(
        screen.getByText("현재 탭 메모리 임시 · 새로고침 시 사라짐"),
      ).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toContain("OPFS quota");
    expect(
      document.querySelector("[data-studio-emeres-authority='memory']"),
    ).toBeTruthy();
  });

  it("fences a stale hydration result after the repository changes", async () => {
    let resolveFirst!: (entries: StudioEmeresLibraryItem[]) => void;
    const first = repositoryFixture();
    vi.mocked(first.list).mockImplementation(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const second = repositoryFixture([item("fresh", "새 권위")]);
    const view = render(
      <StudioEmeresLibraryPanel onPickItem={vi.fn()} repository={first} />,
    );

    view.rerender(
      <StudioEmeresLibraryPanel onPickItem={vi.fn()} repository={second} />,
    );
    expect(await screen.findByText("새 권위")).toBeTruthy();
    resolveFirst([item("stale", "오래된 권위")]);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText("오래된 권위")).toBeNull();
    expect(screen.getByText("새 권위")).toBeTruthy();
  });
});
