import { describe, expect, it } from "vitest";

import {
  addStudioCharacter,
  createEmptyStudioCharacterBible,
  patchStudioCharacter,
  removeStudioCharacter,
  reorderStudioCharacter,
  type StudioCharacterBible,
} from "./studio-character-bible";
import {
  createStudioHistoryJournal,
  countStudioHistoryJournalPagesEntries,
  readStudioHistoryJournalRedoEntry,
  readStudioHistoryJournalUndoEntry,
  recordStudioHistoryJournalPagesSteps,
  recordStudioHistoryJournalSidecarEdit,
  seekStudioHistoryJournalToPagesDepth,
  stepStudioHistoryJournal,
  STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES,
  STUDIO_HISTORY_JOURNAL_SIDECAR_COALESCE_MS,
  type StudioHistoryJournal,
  type StudioHistoryJournalSidecarEntry,
} from "./studio-history-journal";
import { STUDIO_PAGES_HISTORY_MAX_ENTRIES } from "./studio-history-retention-budget";
import { appendStudioPagesHistorySnapshot } from "./studio-pending-stroke-durability";
import {
  createEmptyStudioWriterRoomDocument,
  type StudioWriterRoomDocument,
} from "./studio-writer-room";

type Bible = { readonly label: string };
type Writer = { readonly logline: string };
type Journal = StudioHistoryJournal<Bible, Writer>;

function bibleEdit(
  before: string,
  after: string,
  at: number
): StudioHistoryJournalSidecarEntry<Bible, Writer> {
  return { kind: "sidecar", target: "characterBible", before: { label: before }, after: { label: after }, at };
}

function writerEdit(
  before: string,
  after: string,
  at: number
): StudioHistoryJournalSidecarEntry<Bible, Writer> {
  return { kind: "sidecar", target: "writerRoom", before: { logline: before }, after: { logline: after }, at };
}

/** 캔버스 커밋 한 번(상한에 걸리지 않는 평범한 경우). */
function commitPagesStep(journal: Journal, nextUndoDepth: number): Journal {
  return recordStudioHistoryJournalPagesSteps(journal, { addedSteps: 1, nextUndoDepth });
}

describe("교차 시나리오 — 획 A → 사이드카 → 획 B 는 한 시간 순서로 되돌아간다", () => {
  it("⌘Z 세 번이 B, 사이드카, A 순으로 되돌리고 redo 세 번이 전부 되살린다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = commitPagesStep(journal, 1); // 획 A
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("옛 로그라인", "새 로그라인", 1_000));
    journal = commitPagesStep(journal, 2); // 획 B

    expect(journal.entries.map((entry) => entry.kind)).toEqual(["pages", "sidecar", "pages"]);
    expect(journal.cursor).toBe(3);

    // ⌘Z ① — 획 B
    expect(readStudioHistoryJournalUndoEntry(journal)).toEqual({ kind: "pages" });
    journal = stepStudioHistoryJournal(journal, "undo");

    // ⌘Z ② — 사이드카(캔버스는 건드리지 않는다)
    const sidecar = readStudioHistoryJournalUndoEntry(journal);
    expect(sidecar).toMatchObject({ kind: "sidecar", target: "writerRoom", before: { logline: "옛 로그라인" } });
    journal = stepStudioHistoryJournal(journal, "undo");

    // ⌘Z ③ — 획 A
    expect(readStudioHistoryJournalUndoEntry(journal)).toEqual({ kind: "pages" });
    journal = stepStudioHistoryJournal(journal, "undo");
    expect(journal.cursor).toBe(0);
    expect(readStudioHistoryJournalUndoEntry(journal)).toBeNull();

    // ⇧⌘Z 세 번 — 같은 순서를 거꾸로
    expect(readStudioHistoryJournalRedoEntry(journal)).toEqual({ kind: "pages" });
    journal = stepStudioHistoryJournal(journal, "redo");
    expect(readStudioHistoryJournalRedoEntry(journal)).toMatchObject({
      kind: "sidecar",
      after: { logline: "새 로그라인" },
    });
    journal = stepStudioHistoryJournal(journal, "redo");
    expect(readStudioHistoryJournalRedoEntry(journal)).toEqual({ kind: "pages" });
    journal = stepStudioHistoryJournal(journal, "redo");
    expect(journal.cursor).toBe(3);
    expect(readStudioHistoryJournalRedoEntry(journal)).toBeNull();
  });

  it("사이드카를 되돌린 뒤의 새 캔버스 커밋은 redo 가지를 함께 버린다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = commitPagesStep(journal, 1);
    journal = recordStudioHistoryJournalSidecarEdit(journal, bibleEdit("없음", "하람", 0));
    journal = stepStudioHistoryJournal(journal, "undo");

    journal = commitPagesStep(journal, 2);

    expect(journal.entries.map((entry) => entry.kind)).toEqual(["pages", "pages"]);
    expect(journal.cursor).toBe(2);
    expect(readStudioHistoryJournalRedoEntry(journal)).toBeNull();
  });

  it("사이드카 편집도 redo 가지를 버린다 — 캔버스 커밋과 같은 계약", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = commitPagesStep(journal, 1);
    journal = commitPagesStep(journal, 2);
    journal = stepStudioHistoryJournal(journal, "undo");

    journal = recordStudioHistoryJournalSidecarEdit(journal, bibleEdit("없음", "하람", 0));

    expect(journal.entries.map((entry) => entry.kind)).toEqual(["pages", "sidecar"]);
    expect(readStudioHistoryJournalRedoEntry(journal)).toBeNull();
  });
});

describe("합치기 — 키 입력마다 항목이 생기지 않는다", () => {
  it("같은 사이드카의 연속 편집은 한 항목으로 합쳐지고 before 는 사슬의 첫 값을 유지한다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("", "새", 0));
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("새", "새 로", 120));
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("새 로", "새 로그라인", 260));

    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]).toMatchObject({
      kind: "sidecar",
      before: { logline: "" },
      after: { logline: "새 로그라인" },
    });
  });

  it("합치기 창을 넘기면 새 항목이 생긴다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("", "새", 0));
    journal = recordStudioHistoryJournalSidecarEdit(
      journal,
      writerEdit("새", "새 로그라인", STUDIO_HISTORY_JOURNAL_SIDECAR_COALESCE_MS + 1)
    );

    expect(journal.entries).toHaveLength(2);
  });

  it("대상이 다르면 창 안이어도 합치지 않는다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("", "새", 0));
    journal = recordStudioHistoryJournalSidecarEdit(journal, bibleEdit("없음", "하람", 10));

    expect(journal.entries).toHaveLength(2);
  });

  it("사이에 캔버스 커밋이 끼면 합치기 사슬이 끊긴다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("", "새", 0));
    journal = commitPagesStep(journal, 1);
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("새", "새 로그라인", 10));

    expect(journal.entries.map((entry) => entry.kind)).toEqual(["sidecar", "pages", "sidecar"]);
  });
});

describe("상한 — 저널이 무한히 자라지 않는다", () => {
  it("스냅샷 히스토리가 앞을 버리면 저널도 같은 수의 pages 항목을 앞에서 버린다", () => {
    // 실제 유지 경계 동작을 그대로 쓴다 — 상수를 복제하면 둘이 갈라진다.
    let history: number[][] = [[0]];
    let historyIndex = 0;
    let journal: Journal = createStudioHistoryJournal();
    journal = recordStudioHistoryJournalSidecarEdit(journal, bibleEdit("없음", "하람", 0));

    // 개수 방벽(2,000)을 실제로 넘겨 앞자르기가 돌게 만든다.
    for (let step = 1; step <= STUDIO_PAGES_HISTORY_MAX_ENTRIES + 60; step += 1) {
      const appended = appendStudioPagesHistorySnapshot(history, historyIndex, [step]);
      history = appended.history as number[][];
      historyIndex = appended.historyIndex;
      journal = recordStudioHistoryJournalPagesSteps(journal, {
        addedSteps: 1,
        nextUndoDepth: historyIndex,
      });
    }

    expect(history).toHaveLength(STUDIO_PAGES_HISTORY_MAX_ENTRIES);
    expect(countStudioHistoryJournalPagesEntries(journal.entries)).toBe(historyIndex);
    expect(journal.cursor).toBe(journal.entries.length);
    // 캔버스를 2,060번 커밋했다고 되돌릴 수 있던 캐릭터 바이블 편집을 잃지는 않는다.
    expect(journal.entries[0]).toMatchObject({ kind: "sidecar" });
  });

  /**
   * 예산제가 새로 여는 경로 — 개수 상한 시절에는 한 전이가 스냅샷을 정확히 1개만 버렸다.
   * 무거운 커밋 하나가 예산을 여러 엔트리분 넘기면 N 개를 한 번에 버린다. 두 불변식이
   * 그 전이를 통과해야 undo 가 스냅샷과 어긋나지 않는다.
   */
  it("한 전이에서 pages 항목 N개가 앞에서 잘려도 두 불변식이 유지된다", () => {
    const retention = { budgetBytes: 8_000, minEntries: 2 };
    type Page = { id: string; elements: { id: string; points?: number[] }[] };
    let history: Page[][] = [[{ id: "page", elements: [{ id: "stroke", points: [0, 0] }] }]];
    let historyIndex = 0;
    let journal: Journal = createStudioHistoryJournal();
    // 캔버스보다 오래된 사이드카 — 앞자르기가 이걸 건드리면 안 된다.
    journal = recordStudioHistoryJournalSidecarEdit(journal, bibleEdit("없음", "하람", 0));

    for (let step = 0; step < 8; step += 1) {
      const previous = history[historyIndex]![0]!;
      const appended = appendStudioPagesHistorySnapshot(
        history,
        historyIndex,
        [{ ...previous, elements: [...previous.elements, { id: `light-${step}` }] }],
        retention
      );
      history = appended.history;
      historyIndex = appended.historyIndex;
      journal = recordStudioHistoryJournalPagesSteps(journal, {
        addedSteps: 1,
        nextUndoDepth: historyIndex,
      });
    }
    expect(countStudioHistoryJournalPagesEntries(journal.entries)).toBe(8);

    const base = history[historyIndex]![0]!;
    const heavy: Page[] = [{
      ...base,
      elements: base.elements.map((element, index) =>
        index === 0 ? { ...element, points: Array.from({ length: 6_000 }, () => 1) } : element
      ),
    }];
    const appended = appendStudioPagesHistorySnapshot(history, historyIndex, heavy, retention);
    journal = recordStudioHistoryJournalPagesSteps(journal, {
      addedSteps: 1,
      nextUndoDepth: appended.historyIndex,
    });

    // 이 전이가 실제로 N(>1)개를 버렸는지 먼저 확인한다 — 안 그러면 테스트가 아무것도 안 지킨다.
    expect(appended.evictedCount).toBeGreaterThan(1);
    // 불변식 A: 커서 앞의 `pages` 수 == pagesHi.
    expect(
      countStudioHistoryJournalPagesEntries(journal.entries.slice(0, journal.cursor))
    ).toBe(appended.historyIndex);
    // 불변식 B: 전체 `pages` 수 == pagesHistory.length - 1.
    expect(countStudioHistoryJournalPagesEntries(journal.entries)).toBe(
      appended.history.length - 1
    );
    expect(journal.cursor).toBe(journal.entries.length);
    // 오래된 사이드카는 캔버스 앞자르기에 휩쓸리지 않는다.
    expect(journal.entries[0]).toMatchObject({ kind: "sidecar" });
  });

  it("N-퇴출 전이 뒤에도 ⌘Z 가 저널 순서대로 걸어간다", () => {
    let journal: Journal = createStudioHistoryJournal();
    for (let step = 1; step <= 6; step += 1) journal = commitPagesStep(journal, step);
    journal = recordStudioHistoryJournalSidecarEdit(journal, writerEdit("옛", "새", 0));
    journal = commitPagesStep(journal, 7);

    // 스냅샷 3개가 한 번에 잘려 나간 전이(pagesHi 7 → 5).
    journal = recordStudioHistoryJournalPagesSteps(journal, { addedSteps: 1, nextUndoDepth: 5 });

    expect(countStudioHistoryJournalPagesEntries(journal.entries)).toBe(5);
    // 앞에서 잘려 나간 것은 `pages` 3개뿐이다 — 그보다 오래된 자리에 있던 사이드카는
    // 스냅샷 히스토리에 기대지 않으므로 제자리에 남는다.
    expect(journal.entries.map((entry) => entry.kind)).toEqual([
      "pages", "pages", "pages", "sidecar", "pages", "pages",
    ]);
    expect(journal.cursor).toBe(journal.entries.length);
    expect(readStudioHistoryJournalUndoEntry(journal)).toEqual({ kind: "pages" });
  });
  it("사이드카 항목은 상한에서 가장 오래된 것부터 버린다", () => {
    let journal: Journal = createStudioHistoryJournal();
    for (let step = 0; step < STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES + 40; step += 1) {
      journal = recordStudioHistoryJournalSidecarEdit(
        journal,
        bibleEdit(`${step}`, `${step + 1}`, step * (STUDIO_HISTORY_JOURNAL_SIDECAR_COALESCE_MS + 1))
      );
    }

    expect(journal.entries).toHaveLength(STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES);
    expect(journal.cursor).toBe(STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES);
    expect(journal.entries[0]).toMatchObject({ before: { label: "40" } });
  });

  /**
   * 사이드카를 200 에 남겨 두면 비대칭이 생긴다 — 긴 세션 뒤 ⌘Z 가 캔버스 단계는 수천 칸
   * 걸어가는데 그 구간의 오래된 로그라인 편집만 조용히 사라진다. 사이드카 페이로드는 참조 보관
   * 이라 엔트리당 포인터 수준이므로 개수가 옳은 게이트이고, 그 개수는 캔버스 방벽과 같아야 한다.
   */
  it("사이드카 상한은 캔버스 개수 방벽과 같은 상수를 쓴다", () => {
    expect(STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES).toBe(STUDIO_PAGES_HISTORY_MAX_ENTRIES);
  });
});

describe("펼치기·점프 — 스냅샷 히스토리의 나머지 모양들", () => {
  it("지연 배치 펼치기(획 N개)는 pages 항목 N개로 들어간다", () => {
    let journal: Journal = createStudioHistoryJournal();
    // commit() 이 1개를 넣고, expandDeferredStrokeCommitHistory 가 나머지 N-1 개를 더한다.
    journal = recordStudioHistoryJournalPagesSteps(journal, { addedSteps: 1, nextUndoDepth: 1 });
    journal = recordStudioHistoryJournalPagesSteps(journal, { addedSteps: 2, nextUndoDepth: 3 });

    expect(countStudioHistoryJournalPagesEntries(journal.entries)).toBe(3);
    expect(journal.cursor).toBe(3);
  });

  it("합치기 커밋(새 단계 없음)은 저널을 그대로 둔다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = commitPagesStep(journal, 1);
    const before = journal;
    journal = recordStudioHistoryJournalPagesSteps(journal, { addedSteps: 0, nextUndoDepth: 1 });

    expect(journal.entries).toEqual(before.entries);
    expect(journal.cursor).toBe(before.cursor);
  });

  it("임의 인덱스 점프는 사이드카를 완료 쪽에 남긴 채 커서를 맞춘다", () => {
    let journal: Journal = createStudioHistoryJournal();
    journal = recordStudioHistoryJournalSidecarEdit(journal, bibleEdit("없음", "하람", 0));
    journal = commitPagesStep(journal, 1);
    journal = commitPagesStep(journal, 2);

    // 점프는 사이드카 문서를 되돌리지 않는다 — 사이드카 항목이 커서 앞(완료)에 남아야 일치한다.
    const jumped = seekStudioHistoryJournalToPagesDepth(journal, 0);
    expect(jumped.cursor).toBe(1);
    expect(jumped.entries.slice(0, jumped.cursor).map((entry) => entry.kind)).toEqual(["sidecar"]);

    expect(seekStudioHistoryJournalToPagesDepth(journal, 1).cursor).toBe(2);
    expect(seekStudioHistoryJournalToPagesDepth(journal, 2).cursor).toBe(3);
  });

  it("빈 저널은 undo·redo 대상이 없다", () => {
    const journal: Journal = createStudioHistoryJournal();
    expect(readStudioHistoryJournalUndoEntry(journal)).toBeNull();
    expect(readStudioHistoryJournalRedoEntry(journal)).toBeNull();
    expect(stepStudioHistoryJournal(journal, "undo")).toBe(journal);
    expect(stepStudioHistoryJournal(journal, "redo")).toBe(journal);
  });
});

describe("스냅샷 참조를 담아도 안전하다 — 사이드카 변경 함수는 입력을 건드리지 않는다", () => {
  it("캐릭터 바이블 변경 함수는 원본을 그대로 둔다", () => {
    const empty = createEmptyStudioCharacterBible();
    const withOne = addStudioCharacter(empty, { id: "c-1", name: "하람" });
    const withTwo = addStudioCharacter(withOne, { id: "c-2", name: "연희" });

    const before: StudioCharacterBible = withTwo;
    const beforeJson = JSON.stringify(before);

    patchStudioCharacter(before, "c-1", { role: "주인공" });
    removeStudioCharacter(before, "c-2");
    reorderStudioCharacter(before, "c-1", 1);
    addStudioCharacter(before, { id: "c-3", name: "태오" });

    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(empty.characters).toHaveLength(0);
    expect(withOne.characters).toHaveLength(1);
  });

  it("Writer Room 빈 문서 생성은 매번 새 객체를 준다", () => {
    const first: StudioWriterRoomDocument = createEmptyStudioWriterRoomDocument();
    const second = createEmptyStudioWriterRoomDocument();

    expect(first).not.toBe(second);
    expect(first.stages).not.toBe(second.stages);
  });
});
