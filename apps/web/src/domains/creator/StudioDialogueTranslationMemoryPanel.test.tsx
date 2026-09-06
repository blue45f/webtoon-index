// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStudioTranslationMemoryEntry,
  saveStudioTranslationMemory,
  STUDIO_TRANSLATION_MEMORY_KIND,
  STUDIO_TRANSLATION_MEMORY_STORAGE_KEY,
  type StudioTranslationMemoryLoadResult,
} from "./studio-translation-memory";
import {
  StudioDialogueTranslationMemoryPanel,
  type StudioDialogueTranslationMemoryPanelProps,
} from "./StudioDialogueTranslationMemoryPanel";

import type { StudioTranslationMemoryPersistence } from "./studio-translation-memory-sqlite-persistence";

const BASE_PROPS: StudioDialogueTranslationMemoryPanelProps = {
  workScope: "episode-01",
  sourceText: "오늘도 정말 반가워, 민수야!",
  speaker: "유나",
  sourceLocale: "ko-KR",
  targetLocale: "en-US",
  sourceRevision: "revision-1",
  storage: window.localStorage,
  onReuse: () => {},
};

function renderPanel(
  overrides: Partial<StudioDialogueTranslationMemoryPanelProps> = {}
) {
  const onReuse = vi.fn();
  const result = render(
    <StudioDialogueTranslationMemoryPanel
      {...BASE_PROPS}
      onReuse={onReuse}
      {...overrides}
    />
  );
  return { ...result, onReuse };
}

function seedApproved(
  overrides: Partial<Parameters<typeof createStudioTranslationMemoryEntry>[0]> = {}
) {
  const created = createStudioTranslationMemoryEntry({
    workScope: "episode-01",
    sourceText: "오늘도 정말 반가워, 민수야!",
    speaker: "유나",
    sourceLocale: "ko-KR",
    targetLocale: "en-US",
    sourceRevision: "revision-1",
    translation: "It is so good to see you again, Minsu!",
    status: "approved",
    now: 100,
    ...overrides,
  });
  if (!created.ok) throw new Error(created.error);
  expect(saveStudioTranslationMemory(localStorage, [created.entry]).ok).toBe(
    true
  );
  return created.entry;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioDialogueTranslationMemoryPanel local-only contract", () => {
  it("honestly discloses the explicit host-storage compatibility seam", () => {
    const { container } = renderPanel({ onClose: vi.fn() });

    expect(
      container
        .querySelector("[data-studio-translation-memory]")
        ?.getAttribute("data-studio-translation-memory")
    ).toBe("local-only");
    expect(
      container
        .querySelector("[data-studio-translation-memory]")
        ?.getAttribute("data-studio-translation-memory-authority")
    ).toBe("storage-compat");
    expect(screen.getByText("호스트 로컬 저장소 사용")).toBeTruthy();
    expect(
      screen.getByText(/서버·팀원·다른 기기에는 자동 동기화하지 않습니다/u)
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "JSON 내보내기" }).hasAttribute(
        "disabled"
      )
    ).toBe(true);
    expect(screen.getByText("JSON 가져오기")).toBeTruthy();
    expect(screen.getByRole("button", { name: "번역 메모리 닫기" })).toBeTruthy();
    expect(screen.getByText("작품 episode-01")).toBeTruthy();
    expect(screen.getByText("ko-KR → en-US")).toBeTruthy();
    expect(screen.getByText("화자 유나")).toBeTruthy();
  });

  it("falls back to session memory without pretending it was persisted", () => {
    renderPanel({ storage: null, initialTranslation: "Hello" });

    expect(screen.getByText("현재 탭 메모리에서만 유지")).toBeTruthy();
    expect(screen.getByText(/새로고침하면 사라질 수 있습니다/u)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "번역을 초안으로 저장" })
    );
    expect(
      screen.getAllByText(/로컬 저장소가 없어 현재 탭에서만 유지됩니다/u)
        .length
    ).toBeGreaterThanOrEqual(1);
  });

  it("uses async SQLite by default and never probes the former localStorage key", async () => {
    const legacy = seedApproved();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    let resolveLoad!: (
      result: Awaited<ReturnType<StudioTranslationMemoryPersistence["load"]>>,
    ) => void;
    const persistence: StudioTranslationMemoryPersistence = {
      load: vi.fn(
        () =>
          new Promise<StudioTranslationMemoryLoadResult>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
      save: vi.fn(async () => ({ ok: true })),
    };

    const { container } = renderPanel({ storage: undefined, persistence });
    expect(
      container
        .querySelector("[data-studio-translation-memory]")
        ?.getAttribute("data-studio-translation-memory-authority")
    ).toBe("sqlite");
    expect(screen.getByText("SQLite 번역 메모리 불러오는 중")).toBeTruthy();
    expect(getItem).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad({ entries: [], status: "empty" });
    });
    expect(screen.getByText("SQLite/OPFS에 로컬 저장")).toBeTruthy();
    expect(screen.queryByText(legacy.translation)).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("hydrates validated SQLite entries and ignores a late result after unmount", async () => {
    const approved = seedApproved();
    let resolveFirst!: (
      result: Awaited<ReturnType<StudioTranslationMemoryPersistence["load"]>>,
    ) => void;
    const firstPersistence: StudioTranslationMemoryPersistence = {
      load: () =>
        new Promise<StudioTranslationMemoryLoadResult>((resolve) => {
          resolveFirst = resolve;
        }),
      save: vi.fn(async () => ({ ok: true })),
    };
    const first = renderPanel({ storage: undefined, persistence: firstPersistence });
    first.unmount();
    await act(async () => {
      resolveFirst({ entries: [approved], status: "ok" });
    });
    expect(firstPersistence.save).not.toHaveBeenCalled();

    const secondPersistence: StudioTranslationMemoryPersistence = {
      load: vi.fn(
        async (): Promise<StudioTranslationMemoryLoadResult> => ({
          entries: [approved],
          status: "ok",
        }),
      ),
      save: vi.fn(async () => ({ ok: true })),
    };
    renderPanel({ storage: undefined, persistence: secondPersistence });
    expect(await screen.findByText(approved.translation)).toBeTruthy();
    expect(screen.getByText("승인됨")).toBeTruthy();
  });

  it("fails closed on corrupt SQLite state and surfaces save failures", async () => {
    const save = vi.fn(async () => ({
      ok: false as const,
      error: "SQLite quota exceeded",
    }));
    const corruptPersistence: StudioTranslationMemoryPersistence = {
      load: vi.fn(
        async (): Promise<StudioTranslationMemoryLoadResult> => ({
          entries: [],
          status: "invalid",
          error: "번역 메모리 JSON을 해석하지 못했습니다.",
        }),
      ),
      save,
    };
    const first = renderPanel({
      storage: undefined,
      persistence: corruptPersistence,
      initialTranslation: "Hello",
    });
    await screen.findByText("번역 메모리 JSON을 해석하지 못했습니다.");
    expect(
      screen
        .getByRole("button", { name: "번역을 초안으로 저장" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(save).not.toHaveBeenCalled();
    first.unmount();

    const failingPersistence: StudioTranslationMemoryPersistence = {
      load: vi.fn(
        async (): Promise<StudioTranslationMemoryLoadResult> => ({
          entries: [],
          status: "empty",
        }),
      ),
      save,
    };
    renderPanel({
      storage: undefined,
      persistence: failingPersistence,
      initialTranslation: "Hello",
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "번역을 초안으로 저장" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "번역을 초안으로 저장" }),
    );
    expect(
      (await screen.findAllByText(/SQLite quota exceeded/u)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("현재 탭 메모리에서만 유지")).toBeTruthy();
  });

  it("serializes rapid UI saves and keeps the newest authored snapshot last", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const translations: string[] = [];
    const save = vi.fn(
      async (entries: readonly { readonly translation: string }[]) => {
        translations.push(entries[0]?.translation ?? "");
        if (translations.length === 1) await firstGate;
        return { ok: true as const };
      },
    );
    const persistence: StudioTranslationMemoryPersistence = {
      load: async () => ({ entries: [], status: "empty" }),
      save,
    };
    renderPanel({ storage: undefined, persistence });
    await screen.findByText("SQLite/OPFS에 로컬 저장");

    const editor = screen.getByRole("textbox", { name: "번역문 초안" });
    fireEvent.change(editor, { target: { value: "First" } });
    fireEvent.click(
      screen.getByRole("button", { name: "번역을 초안으로 저장" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    fireEvent.change(editor, { target: { value: "Second" } });
    fireEvent.click(
      screen.getByRole("button", { name: "수정본을 초안으로 저장" }),
    );
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst();
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(translations).toEqual(["First", "Second"]);
  });
});

describe("StudioDialogueTranslationMemoryPanel author workflow", () => {
  it("saves, reviews, approves, explicitly reuses and invalidates an exact entry", () => {
    const { onReuse } = renderPanel();
    const editor = screen.getByRole("textbox", { name: "번역문 초안" });

    fireEvent.change(editor, {
      target: { value: "It is great to see you again, Minsu!" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "번역을 초안으로 저장" })
    );

    expect(screen.getByRole("region", { name: "정확히 일치하는 번역" })).toBeTruthy();
    expect(screen.getByText("초안")).toBeTruthy();
    expect(
      JSON.parse(
        localStorage.getItem(STUDIO_TRANSLATION_MEMORY_STORAGE_KEY) ?? "{}"
      )
    ).toMatchObject({
      kind: STUDIO_TRANSLATION_MEMORY_KIND,
      entries: [{ status: "draft" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "검토 완료" }));
    expect(screen.getByText("검토됨")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(screen.getByText("승인됨")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "번역 재사용" }));
    expect(onReuse).toHaveBeenCalledWith(
      "It is great to see you again, Minsu!",
      expect.objectContaining({ status: "approved" })
    );

    fireEvent.click(screen.getByRole("button", { name: "무효화" }));
    expect(screen.getByText("원문 변경 · 재검토 필요")).toBeTruthy();
    expect(screen.getByText("초안")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "번역 재사용" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("shows fuzzy entries as manual suggestions and never auto-applies them", () => {
    seedApproved();
    const { onReuse } = renderPanel({
      sourceText: "오늘도 정말 반가워 민수야!",
      sourceRevision: "revision-2",
    });

    expect(screen.getByRole("region", { name: "유사 번역 제안" })).toBeTruthy();
    expect(screen.getByText(/유사 번역은/u)).toBeTruthy();
    expect(screen.getByText(/자동 적용하지 않습니다/u)).toBeTruthy();
    expect(onReuse).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "번역 재사용" }));
    expect(onReuse).toHaveBeenCalledTimes(1);
  });

  it("blocks reuse and approval when the current glossary conflicts", () => {
    seedApproved({
      sourceText: "민수가 왔다.",
      translation: "Minsoo is here.",
    });
    renderPanel({
      sourceText: "민수가 왔다.",
      speaker: "유나",
      glossaryRules: [{ sourceTerm: "민수", targetTerm: "Minsu" }],
    });

    expect(screen.getByText("용어집 충돌 1건")).toBeTruthy();
    expect(screen.getByText(/Minsu/u)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "번역 재사용" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("surfaces revision drift as stale and lets the author persist invalidation", () => {
    seedApproved();
    renderPanel({ sourceRevision: "revision-2" });

    expect(screen.getByText("원문 변경 · 재검토 필요")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "번역 재사용" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "승인" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "무효화" }));
    expect(screen.getByText(/재검토 대상으로 표시했습니다/u)).toBeTruthy();
    expect(
      JSON.parse(
        localStorage.getItem(STUDIO_TRANSLATION_MEMORY_STORAGE_KEY) ?? "{}"
      ).entries[0]
    ).toMatchObject({ stale: true, status: "draft" });
  });
});
