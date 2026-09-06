// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioSceneSnapshot,
  StudioSceneSnapshotLibraryError,
} from "./studio-scene-snapshot-library";
import { StudioSceneSnapshotPanel } from "./StudioSceneSnapshotPanel";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";
import type { StudioSceneSnapshot } from "./studio-scene-snapshot-library";
import type { StudioSceneSnapshotRepository } from "./StudioSceneSnapshotPanel";

function pageFixture(): PageState {
  return {
    id: "page-current",
    name: "옥상 재회",
    note: "해질녘 감정 장면",
    elements: [
      {
        id: "bubble-1",
        type: "bubble",
        variant: "speech",
        text: "늦었네.",
        x: 20,
        y: 30,
        width: 200,
        height: 90,
        fill: "#ffffff",
        textFill: "#111111",
        rotation: 0,
      },
    ] as El[],
    bg: "#f6d3bd",
    bgGrad: ["#f6d3bd", "#8a6b8e"],
    canvasH: 1_440,
  };
}

function snapshotFixture(
  overrides: Partial<StudioSceneSnapshot> = {}
): StudioSceneSnapshot {
  const snapshot = createStudioSceneSnapshot(
    {
      name: "옥상 장면",
      tags: ["로맨스", "해질녘"],
      page: pageFixture(),
      theme: "soft",
      sourceWorkId: "work-1",
    },
    { id: "scene-1", now: 1_000 }
  );
  return { ...snapshot, ...overrides };
}

function repositoryFixture(
  entries: StudioSceneSnapshot[] = []
): StudioSceneSnapshotRepository {
  return {
    list: vi.fn(async () => entries),
    save: vi.fn(async (snapshot) => [snapshot, ...entries]),
    duplicate: vi.fn(async () => entries),
    delete: vi.fn(async () => entries),
  };
}

afterEach(cleanup);

describe("StudioSceneSnapshotPanel", () => {
  it("shows an honest private-library boundary with independent mobile scroll and 44px controls", async () => {
    const snapshot = snapshotFixture();
    render(
      <StudioSceneSnapshotPanel
        sourcePage={pageFixture()}
        theme="soft"
        onApply={vi.fn()}
        repository={repositoryFixture([snapshot])}
      />
    );

    expect(await screen.findByText("옥상 장면")).toBeTruthy();
    expect(screen.getByText("개인 · 이 기기 전용")).toBeTruthy();
    expect(screen.getByText(/팀 공유와 에셋 마켓 게시는 아직 지원하지 않습니다/u)).toBeTruthy();
    expect(
      document.querySelector("[data-studio-scene-snapshot-scroll-body='true']")?.className
    ).toContain("overflow-y-auto");
    expect(
      screen.getByRole("button", { name: "현재 페이지 스냅샷 보관" }).className
    ).toContain("min-h-11");
    expect(screen.getByRole("searchbox", { name: "장면 스냅샷 검색" }).className).toContain(
      "min-h-11"
    );
    expect(screen.getByRole("button", { name: "적용" }).className).toContain("min-h-11");

    fireEvent.change(screen.getByRole("searchbox", { name: "장면 스냅샷 검색" }), {
      target: { value: "없는 태그" },
    });
    expect(screen.getByText("검색 결과가 없습니다")).toBeTruthy();
  });

  it("captures the whole current page metadata, theme and normalized tags", async () => {
    const repository = repositoryFixture();
    render(
      <StudioSceneSnapshotPanel
        sourcePage={pageFixture()}
        theme="vivid"
        sourceWorkId="work-current"
        onApply={vi.fn()}
        repository={repository}
      />
    );
    await waitFor(() => expect(repository.list).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "최종 옥상 장면" },
    });
    fireEvent.change(screen.getByLabelText("태그"), {
      target: { value: "로맨스, 옥상, 로맨스" },
    });
    fireEvent.click(screen.getByRole("button", { name: "현재 페이지 스냅샷 보관" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledOnce());
    const saved = vi.mocked(repository.save).mock.calls[0]![0];
    expect(saved).toMatchObject({
      name: "최종 옥상 장면",
      tags: ["로맨스", "옥상"],
      theme: "vivid",
      sourceWorkId: "work-current",
      page: {
        id: "page-current",
        name: "옥상 재회",
        note: "해질녘 감정 장면",
        canvasH: 1_440,
        bg: "#f6d3bd",
        bgGrad: ["#f6d3bd", "#8a6b8e"],
      },
    });
    expect(await screen.findByText("최종 옥상 장면")).toBeTruthy();
  });

  it("delegates replacement confirmation to onApply with an isolated clone", async () => {
    const snapshot = snapshotFixture();
    const onApply = vi.fn();
    render(
      <StudioSceneSnapshotPanel
        sourcePage={pageFixture()}
        theme="soft"
        onApply={onApply}
        repository={repositoryFixture([snapshot])}
      />
    );

    await screen.findByText("옥상 장면");
    expect(screen.getByText(/현재 페이지 전체가 이 스냅샷으로 교체됩니다/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledOnce();
    const applied = onApply.mock.calls[0]![0] as StudioSceneSnapshot;
    expect(applied).not.toBe(snapshot);
    expect(applied.page).not.toBe(snapshot.page);
    (applied.page.elements[0] as { text: string }).text = "적용 측 변경";
    expect((snapshot.page.elements[0] as { text: string }).text).toBe("늦었네.");
  });

  it("duplicates and deletes through explicit row actions without a second dialog", async () => {
    const original = snapshotFixture();
    const copy = snapshotFixture({
      id: "scene-copy",
      name: "옥상 장면 복사본",
      version: 2,
      createdAt: 2_000,
      updatedAt: 2_000,
    });
    const repository = repositoryFixture([original]);
    vi.mocked(repository.duplicate).mockResolvedValue([copy, original]);
    vi.mocked(repository.delete).mockResolvedValue([copy]);
    render(
      <StudioSceneSnapshotPanel
        sourcePage={pageFixture()}
        theme="soft"
        onApply={vi.fn()}
        repository={repository}
      />
    );

    const originalName = await screen.findByText("옥상 장면");
    const originalRow = originalName.closest("li")!;
    fireEvent.click(within(originalRow).getByRole("button", { name: "복제" }));
    await waitFor(() => expect(repository.duplicate).toHaveBeenCalledWith("scene-1"));
    expect(await screen.findByText("옥상 장면 복사본")).toBeTruthy();

    const refreshedOriginalRow = screen.getByText("옥상 장면").closest("li")!;
    fireEvent.click(within(refreshedOriginalRow).getByRole("button", { name: "삭제" }));
    expect(within(refreshedOriginalRow).getByText("이 장면을 삭제할까요?")).toBeTruthy();
    fireEvent.click(within(refreshedOriginalRow).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(repository.delete).toHaveBeenCalledWith("scene-1"));
    expect(screen.queryByText("옥상 장면")).toBeNull();
    expect(screen.getByText("옥상 장면 복사본")).toBeTruthy();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  });

  it("fences a stale asynchronous hydration after the repository changes", async () => {
    let resolveFirst!: (entries: StudioSceneSnapshot[]) => void;
    const first = repositoryFixture();
    vi.mocked(first.list).mockImplementation(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const fresh = snapshotFixture({ id: "scene-fresh", name: "새 SQLite 권위" });
    const second = repositoryFixture([fresh]);
    const view = render(
      <StudioSceneSnapshotPanel
        sourcePage={pageFixture()}
        theme="soft"
        onApply={vi.fn()}
        repository={first}
      />
    );

    view.rerender(
      <StudioSceneSnapshotPanel
        sourcePage={pageFixture()}
        theme="soft"
        onApply={vi.fn()}
        repository={second}
      />
    );
    expect(await screen.findByText("새 SQLite 권위")).toBeTruthy();
    resolveFirst([snapshotFixture({ id: "scene-stale", name: "오래된 IndexedDB 권위" })]);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText("오래된 IndexedDB 권위")).toBeNull();
    expect(screen.getByText("새 SQLite 권위")).toBeTruthy();
  });

  it("turns storage failures into actionable local-only guidance", async () => {
    const repository = repositoryFixture();
    vi.mocked(repository.list).mockRejectedValue(
      new StudioSceneSnapshotLibraryError(
        "storage-unavailable",
        "IndexedDB unavailable"
      )
    );
    render(
      <StudioSceneSnapshotPanel
        sourcePage={pageFixture()}
        theme="classic"
        onApply={vi.fn()}
        repository={repository}
      />
    );

    expect(
      await screen.findByText(
        "SQLite/OPFS 개인 장면 라이브러리를 사용할 수 없습니다. 저장되지 않았습니다."
      )
    ).toBeTruthy();
    expect(
      document.querySelector("[data-studio-scene-snapshot-authority='unavailable']")
    ).toBeTruthy();
  });
});
