// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addStudioProductionBibleEntry,
  createEmptyStudioProductionBible,
  type StudioProductionBiblePersistenceResult,
} from "./studio-production-bible";
import { StudioProductionBibleWorkspace } from "./StudioProductionBibleWorkspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioProductionBibleWorkspace", () => {
  it("binds the product default to V12 SQLite without a legacy browser-store repository", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/web/src/domains/creator/StudioProductionBibleWorkspace.tsx"),
      "utf8"
    );
    expect(source).toContain("createStudioProductionBibleSqlitePersistence()");
    expect(source).not.toContain("new StudioProductionBibleLocalRepository");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("indexedDB");
  });

  it("loads the isolated work scope only when opened and persists edits", async () => {
    const loadedBible = addStudioProductionBibleEntry(
      createEmptyStudioProductionBible(),
      { id: "location-library", kind: "location", name: "학교 도서관" }
    );
    const load = vi.fn(async (): Promise<StudioProductionBiblePersistenceResult> => ({
      bible: loadedBible,
      backend: "sqlite",
      persisted: true,
      localOnly: true,
    }));
    const save = vi.fn(async (_key, bible): Promise<StudioProductionBiblePersistenceResult> => ({
      bible,
      backend: "sqlite",
      persisted: true,
      localOnly: true,
    }));
    const repository = { load, save };
    const { rerender } = render(
      <StudioProductionBibleWorkspace
        open={false}
        onClose={vi.fn()}
        userId="artist-a"
        workId="episode-1"
        repository={repository}
      />
    );

    expect(load).not.toHaveBeenCalled();
    rerender(
      <StudioProductionBibleWorkspace
        open
        onClose={vi.fn()}
        userId="artist-a"
        workId="episode-1"
        repository={repository}
      />
    );

    expect((await screen.findAllByText("학교 도서관")).length).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledWith(
      "toonspectrum-studio-production-bible:v12:artist-a:work:episode-1"
    );
    fireEvent.click(screen.getAllByRole("button", { name: "소품" })[0]!);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByText("이 기기 SQLite/OPFS 저장 · 서버 동기화 없음"))
      .toBeTruthy();
  });

  it("surfaces memory-only durability without claiming cloud sync", async () => {
    const repository = {
      load: vi.fn(async (): Promise<StudioProductionBiblePersistenceResult> => ({
        bible: createEmptyStudioProductionBible(),
        backend: "memory",
        persisted: false,
        localOnly: true,
        warning: "브라우저 저장소가 차단되었습니다.",
      })),
      save: vi.fn(),
    };
    render(
      <StudioProductionBibleWorkspace
        open
        onClose={vi.fn()}
        repository={repository}
      />
    );

    expect(await screen.findByText("메모리 임시 · 새로고침 전까지")).toBeTruthy();
    expect(screen.getByText("브라우저 저장소가 차단되었습니다.")).toBeTruthy();
    expect(screen.queryByText(/클라우드/u)).toBeNull();
  });

  it("generation-fences a late load after the user has already authored a newer edit", async () => {
    let resolveLoad!: (result: StudioProductionBiblePersistenceResult) => void;
    const load = vi.fn(() => new Promise<StudioProductionBiblePersistenceResult>((resolve) => {
      resolveLoad = resolve;
    }));
    const save = vi.fn(async (_key, bible): Promise<StudioProductionBiblePersistenceResult> => ({
      bible,
      backend: "sqlite",
      persisted: true,
      localOnly: true,
    }));
    render(
      <StudioProductionBibleWorkspace
        open
        onClose={vi.fn()}
        workId="race"
        repository={{ load, save }}
      />
    );

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button", { name: "소품" })[0]!);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    resolveLoad({
      bible: addStudioProductionBibleEntry(createEmptyStudioProductionBible(), {
        id: "stale-location",
        kind: "location",
        name: "늦게 도착한 과거 문서",
      }),
      backend: "sqlite",
      persisted: true,
      localOnly: true,
    });

    await waitFor(() => {
      expect(screen.queryByText("늦게 도착한 과거 문서")).toBeNull();
      expect(screen.getAllByText("소품 1").length).toBeGreaterThan(0);
    });
  });

  it("surfaces an unavailable SQLite authority separately from memory recovery", async () => {
    const repository = {
      load: vi.fn(async (): Promise<StudioProductionBiblePersistenceResult> => ({
        bible: createEmptyStudioProductionBible(),
        backend: "unavailable",
        persisted: false,
        localOnly: true,
        warning: "OPFS 권한이 없습니다.",
      })),
      save: vi.fn(),
    };
    render(
      <StudioProductionBibleWorkspace open onClose={vi.fn()} repository={repository} />
    );

    expect(await screen.findByText("SQLite/OPFS 사용 불가 · 저장되지 않음"))
      .toBeTruthy();
    expect(screen.getByText("OPFS 권한이 없습니다.")).toBeTruthy();
  });
});
