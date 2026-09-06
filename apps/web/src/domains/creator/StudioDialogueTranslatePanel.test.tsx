// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  openStudioLocalDatabase,
  type StudioLocalDatabase,
} from "./studio-local-database";
import {
  createStudioTranslationMemoryEntry,
} from "./studio-translation-memory";
import { createStudioTranslationMemorySqlitePersistence } from "./studio-translation-memory-sqlite-persistence";
import { StudioDialogueTranslatePanel } from "./StudioDialogueTranslatePanel";

import type { BubbleTextMeasurer } from "./lettering/studio-bubble-text-fit";

const databaseRuntime = vi.hoisted(() => ({ acquire: vi.fn() }));

vi.mock("./studio-local-database-runtime", () => ({
  acquireStudioLocalDatabase: databaseRuntime.acquire,
}));

const pages = [
  {
    id: "page-1",
    elements: [
      {
        id: "bubble-1",
        type: "bubble",
        text: "다시 만나서 반가워.",
        x: 20,
        y: 40,
      },
    ],
  },
] as const;

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof StudioDialogueTranslatePanel>> = {}
) {
  const onDraftChange = vi.fn();
  render(
    <StudioDialogueTranslatePanel
      pages={pages}
      configured
      activeLocale="source"
      availableLocales={[]}
      coverageFor={() => ({ total: 1, translated: 0 })}
      targetLocale="en-US"
      onTargetLocaleChange={vi.fn()}
      glossary=""
      onGlossaryChange={vi.fn()}
      busy={false}
      progress={null}
      error={null}
      draft={new Map([["bubble-1", "Good to see you again."]])}
      onGenerate={vi.fn()}
      onDraftChange={onDraftChange}
      onApplyDraft={vi.fn()}
      onDiscardDraft={vi.fn()}
      onSwitchLocale={vi.fn()}
      onClose={vi.fn()}
      workScope="work-translation-1"
      {...overrides}
    />
  );
  return { onDraftChange };
}

let database: StudioLocalDatabase;

beforeEach(async () => {
  localStorage.clear();
  database = await openStudioLocalDatabase({ vfs: "memory" });
  databaseRuntime.acquire.mockResolvedValue(database);
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  databaseRuntime.acquire.mockReset();
  await database.close();
});

describe("StudioDialogueTranslatePanel translation-memory bridge", () => {
  it("opens a local translation-memory surface from each draft row", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "메모리" }));

    expect(
      await screen.findByRole("heading", { name: "번역 메모리" })
    ).toBeTruthy();
    expect(screen.getByText("작품 work-translation-1")).toBeTruthy();
    expect(screen.getByText("source → en-US")).toBeTruthy();
    expect(screen.getByText("다시 만나서 반가워.")).toBeTruthy();
  });

  it("reuses an explicitly approved match without applying it to the canvas", async () => {
    const created = createStudioTranslationMemoryEntry({
      workScope: "work-translation-1",
      sourceText: "다시 만나서 반가워.",
      sourceLocale: "source",
      targetLocale: "en-US",
      sourceRevision: "page-1:bubble-1:다시 만나서 반가워.",
      translation: "It is good to see you again.",
      status: "approved",
      now: 1,
    });
    if (!created.ok) throw new Error(created.error);
    const persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: async () => database,
    });
    await expect(persistence.save([created.entry])).resolves.toEqual({ ok: true });
    const { onDraftChange } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "메모리" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "번역 재사용" })
    );

    expect(onDraftChange).toHaveBeenCalledWith(
      "bubble-1",
      "It is good to see you again."
    );
    expect(screen.getByRole("button", { name: "적용" })).toBeTruthy();
  });
});

// ── 현지화 QA 화면 ──────────────────────────────────────────────────────────

/** 결정적 측정기 — 글자 하나를 fontPx×0.6 폭으로 센다(캔버스 없이 넘침 판정을 재현한다). */
const qaMeasurer: BubbleTextMeasurer = {
  measureWidth: (text, fontPx) => text.length * fontPx * 0.6,
};

const OVERFLOWING = "THIS SENTENCE IS FAR TOO LONG FOR THE TINY BALLOON IT WAS PLACED INTO.";

const qaPages = [
  {
    id: "page-1",
    elements: [
      { id: "bubble-1", type: "bubble", text: "안녕, 오랜만이야.", x: 20, y: 40, width: 400, height: 200, fontSize: 14 },
      { id: "bubble-2", type: "bubble", text: "정말 반가워.", x: 20, y: 260, width: 60, height: 30, fontSize: 24 },
    ],
  },
] as const;

function qaPanel(
  overrides: Partial<React.ComponentProps<typeof StudioDialogueTranslatePanel>> = {}
) {
  return (
    <StudioDialogueTranslatePanel
      pages={qaPages}
      configured
      activeLocale="source"
      availableLocales={[]}
      coverageFor={() => ({ total: 2, translated: 0 })}
      targetLocale="en"
      onTargetLocaleChange={vi.fn()}
      glossary=""
      onGlossaryChange={vi.fn()}
      busy={false}
      progress={null}
      error={null}
      draft={
        new Map([
          ["bubble-1", "Long time no see."],
          ["bubble-2", OVERFLOWING],
        ])
      }
      onGenerate={vi.fn()}
      onDraftChange={vi.fn()}
      onApplyDraft={vi.fn()}
      onDiscardDraft={vi.fn()}
      onSwitchLocale={vi.fn()}
      onClose={vi.fn()}
      measurer={qaMeasurer}
      {...overrides}
    />
  );
}

describe("StudioDialogueTranslatePanel 현지화 QA 화면", () => {
  it("메뉴에서 QA 화면으로 열리면 초안을 자동 검사하고, 발견이 초안 행과 캔버스로 되짚는다", () => {
    const onQaOpenChange = vi.fn();
    const onRevealCue = vi.fn();
    render(qaPanel({ qaOpen: true, onQaOpenChange, onRevealCue }));

    expect(screen.getByRole("button", { name: "현지화 QA" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByText(/번역 초안\(적용 전\)/)).toBeTruthy();
    // 60×30 상자에 든 긴 영문 초안은 중대(Major) 넘침 — 점수와 무관하게 글자 라벨로 읽힌다.
    expect(screen.getByText("미달")).toBeTruthy();
    expect(screen.getAllByText("중대").length).toBeGreaterThan(0);
    expect(screen.getByText(/검사한 대사/).parentElement?.textContent).toContain("2개");

    // 같은 대사에 넘침 + 문체 발견이 함께 붙어 캡션이 발견마다 한 번씩 그려진다 — 첫 발견을 잡는다.
    const caption = screen.getAllByText(/1페이지 · THIS SENTENCE/)[0];
    fireEvent.click(
      within(caption.parentElement as HTMLElement).getByRole("button", { name: "초안에서 고치기" })
    );

    expect(onRevealCue).toHaveBeenCalledWith("page-1", "bubble-2");
    expect(onQaOpenChange).toHaveBeenCalledWith(false);
  });

  it("깨끗한 초안은 통과 + 빈 상태로 그린다", () => {
    render(
      qaPanel({
        qaOpen: true,
        pages: [{ id: "page-1", elements: [qaPages[0].elements[0]] }],
        draft: new Map([["bubble-1", "ALL GOOD."]]),
      })
    );

    expect(screen.getByText("통과")).toBeTruthy();
    expect(screen.getByText("지적할 곳이 없어요")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "초안에서 고치기" })).toBeNull();
  });

  it("qaOpen 을 넘기지 않은 기존 호출부에서는 헤더 토글이 화면을 스스로 전환한다", () => {
    render(qaPanel());

    expect(screen.getByRole("button", { name: "적용" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "현지화 QA" }));
    expect(screen.getByText(/번역 초안\(적용 전\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "현지화 QA" }));
    expect(screen.getByRole("button", { name: "적용" })).toBeTruthy();
  });

  it("검사 뒤 초안이 바뀌면 낡은 점수를 그대로 두지 않고 다시 검사를 요구한다", () => {
    const view = render(qaPanel({ qaOpen: true }));
    const banner = "검사 뒤 대사가 바뀌었어요. 다시 검사해 주세요.";
    expect(screen.queryByText(banner)).toBeNull();

    view.rerender(
      qaPanel({
        qaOpen: true,
        draft: new Map([
          ["bubble-1", "Long time no see!"],
          ["bubble-2", OVERFLOWING],
        ]),
      })
    );
    expect(screen.getByText(banner)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다시 검사" }));
    expect(screen.queryByText(banner)).toBeNull();
  });
});
