import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  addStudioPromisePayoffEntry,
  createEmptyStudioPromisePayoffLedger,
  diagnoseStudioPromisePayoffLedger,
  mergeStudioPromisePayoffLedgers,
  nextStudioPromisePayoffEntryId,
  nextStudioPromisePayoffLinkId,
  normalizeStudioPromisePayoffLedger,
  patchStudioPromisePayoffEntry,
  removeStudioPromisePayoffEntry,
  searchStudioPromisePayoffLedger,
  serializeStudioPromisePayoffLedger,
  setStudioPromisePayoffCurrentEpisode,
  studioPromisePayoffDeadlineState,
  summarizeStudioPromisePayoffLedger,
  STUDIO_PROMISE_PAYOFF_MAX_ENTRIES,
  STUDIO_PROMISE_PAYOFF_MAX_LINKS,
  STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH,
  StudioPromisePayoffLedgerSchema,
  type StudioPromisePayoffEntry,
  type StudioPromisePayoffLedger,
} from "./studio-promise-payoff-ledger";

function storyLink(
  id: string,
  episode: number,
  frameId: string,
  note = ""
) {
  return {
    id,
    episode,
    pageId: `page-${episode}`,
    frameId,
    label: `${episode}화 ${frameId}`,
    note,
  };
}

function fixture(): StudioPromisePayoffLedger {
  let ledger = createEmptyStudioPromisePayoffLedger(20);
  ledger = addStudioPromisePayoffEntry(ledger, {
    id: "promise-clock",
    kind: "foreshadow",
    title: "깨진 시계의 주인",
    summary: "1화의 깨진 시계가 범인의 정체와 연결된다.",
    status: "foreshadow",
    urgency: "high",
    owner: "김작가",
    visibility: "editorial",
    spoilerLevel: "major",
    dueEpisode: 24,
    seed: storyLink("clock-seed", 1, "frame-12", "깨진 시계를 클로즈업"),
    foreshadows: [
      storyLink("clock-clue-15", 15, "frame-7", "같은 문양을 다시 보여 준다."),
      storyLink("clock-clue-7", 7, "frame-3", "범인이 시간을 묻는다."),
    ],
  });
  ledger = addStudioPromisePayoffEntry(ledger, {
    id: "promise-letter",
    kind: "mystery",
    title: "봉인된 편지",
    status: "seed",
    urgency: "critical",
    dueEpisode: 19,
    seed: storyLink("letter-seed", 3, "frame-2"),
  });
  ledger = addStudioPromisePayoffEntry(ledger, {
    id: "promise-train",
    kind: "reader-question",
    title: "마지막 열차는 어디로 가나",
    status: "intentional-non-payoff",
    urgency: "low",
    dueEpisode: null,
    intentionalNonPayoffReason: "시즌 2의 열린 결말로 남긴다.",
    seed: storyLink("train-seed", 18, "frame-9"),
  });
  return ledger;
}

describe("studio Promise·Payoff ledger canonical contract", () => {
  it("normalizes legacy aliases, compatibility text, links, and ordering", () => {
    const ledger = normalizeStudioPromisePayoffLedger({
      reviewEpisode: "15",
      promises: [{
        entryId: " promise-b ",
        type: "FORESHADOW",
        name: "  ３화의 시계  ",
        description: "  장기 복선  ",
        priority: "HIGH",
        assignee: " 편집자 ",
        audience: "EDITORIAL",
        spoiler: "MAJOR",
        payoffDueEpisode: "24",
        seedLink: {
          linkId: "seed-b",
          episodeNumber: "3",
          cutId: "frame-4",
          sceneLabel: "3화 4컷",
        },
        clues: [
          storyLink("clue-15", 15, "f15"),
          storyLink("clue-7", 7, "f7"),
          storyLink("clue-7", 8, "duplicate"),
        ],
      }, {
        id: "promise-a",
        title: "첫 번째",
      }, {
        title: "ID 없음",
      }],
    });

    expect(ledger.currentEpisode).toBe(15);
    expect(ledger.entries.map(({ id }) => id)).toEqual(["promise-a", "promise-b"]);
    expect(ledger.entries[1]).toMatchObject({
      title: "3화의 시계",
      summary: "장기 복선",
      kind: "foreshadow",
      urgency: "high",
      owner: "편집자",
      visibility: "editorial",
      spoilerLevel: "major",
      dueEpisode: 24,
      seed: { id: "seed-b", episode: 3, frameId: "frame-4" },
    });
    expect(ledger.entries[1]?.foreshadows.map(({ id }) => id)).toEqual([
      "clue-7",
      "clue-15",
    ]);
    expect(StudioPromisePayoffLedgerSchema.parse(ledger)).toEqual(ledger);
  });

  it("uses deterministic, gap-filling stable IDs without clocks or randomness", () => {
    let ledger = createEmptyStudioPromisePayoffLedger();
    ledger = addStudioPromisePayoffEntry(ledger, {
      id: "promise-1",
      title: "첫째",
    });
    ledger = addStudioPromisePayoffEntry(ledger, {
      id: "promise-3",
      title: "셋째",
    });
    expect(nextStudioPromisePayoffEntryId(ledger)).toBe("promise-2");

    const longEntry = ledger.entries[0] as StudioPromisePayoffEntry;
    expect(nextStudioPromisePayoffLinkId(longEntry, "foreshadow"))
      .toBe("promise-1-foreshadow-1");
  });

  it("adds, patches, removes, and changes the review episode immutably", () => {
    const empty = createEmptyStudioPromisePayoffLedger(4);
    const added = addStudioPromisePayoffEntry(empty, {
      id: "promise-key",
      kind: "quest",
      title: "잃어버린 열쇠",
    });
    const patched = patchStudioPromisePayoffEntry(added, "promise-key", {
      status: "partial-payoff",
      dueEpisode: 12,
      foreshadows: [storyLink("key-clue", 8, "frame-5")],
    });
    const advanced = setStudioPromisePayoffCurrentEpisode(patched, 10);
    const removed = removeStudioPromisePayoffEntry(advanced, "promise-key");

    expect(empty.entries).toHaveLength(0);
    expect(added.entries[0]).toMatchObject({ status: "seed", dueEpisode: null });
    expect(patched.entries[0]).toMatchObject({
      status: "partial-payoff",
      dueEpisode: 12,
    });
    expect(advanced.currentEpisode).toBe(10);
    expect(removed.entries).toHaveLength(0);
    expect(removeStudioPromisePayoffEntry(removed, "missing")).toEqual(removed);
    expect(() => setStudioPromisePayoffCurrentEpisode(advanced, 0)).toThrow(/1 이상/u);
    expect(() =>
      patchStudioPromisePayoffEntry(advanced, "promise-key", { id: "changed" } as never)
    ).toThrow(/수정할 수 없는/u);
  });

  it("bounds long text, links, and entry growth", () => {
    const bounded = addStudioPromisePayoffEntry(
      createEmptyStudioPromisePayoffLedger(),
      {
        id: "bounded",
        title: "가".repeat(500),
        summary: "나".repeat(STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH + 50),
        foreshadows: Array.from(
          { length: STUDIO_PROMISE_PAYOFF_MAX_LINKS + 10 },
          (_, index) => storyLink(`clue-${index}`, index + 1, `frame-${index}`)
        ),
      }
    );
    expect(Array.from(bounded.entries[0]?.title ?? "")).toHaveLength(180);
    expect(Array.from(bounded.entries[0]?.summary ?? "")).toHaveLength(
      STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH
    );
    expect(bounded.entries[0]?.foreshadows).toHaveLength(
      STUDIO_PROMISE_PAYOFF_MAX_LINKS
    );

    let full = createEmptyStudioPromisePayoffLedger();
    for (let index = 0; index < STUDIO_PROMISE_PAYOFF_MAX_ENTRIES; index += 1) {
      full = addStudioPromisePayoffEntry(full, {
        id: `promise-${index}`,
        title: `${index}`,
      });
    }
    expect(() => addStudioPromisePayoffEntry(full)).toThrow(/최대/u);
  });

  it("serializes the same normalized content byte-identically", () => {
    const ledger = fixture();
    const shuffled = {
      ...ledger,
      entries: [...ledger.entries].toReversed(),
    };
    expect(serializeStudioPromisePayoffLedger(shuffled))
      .toBe(serializeStudioPromisePayoffLedger(ledger));
    expect(normalizeStudioPromisePayoffLedger("{broken")).toEqual(
      createEmptyStudioPromisePayoffLedger()
    );
  });
});

describe("studio Promise·Payoff warnings, filters, and summary", () => {
  it.each([
    [19, "future"],
    [22, "due-soon"],
    [24, "due-now"],
    [25, "overdue"],
  ] as const)("derives the deadline state at episode %i", (currentEpisode, expected) => {
    const entry = fixture().entries.find(({ id }) => id === "promise-clock");
    expect(entry).toBeTruthy();
    expect(studioPromisePayoffDeadlineState(entry as StudioPromisePayoffEntry, currentEpisode))
      .toBe(expected);
  });

  it("suppresses deadline alarms for completed and intentionally unresolved promises", () => {
    const source = fixture().entries[1] as StudioPromisePayoffEntry;
    expect(studioPromisePayoffDeadlineState(
      { ...source, status: "payoff" },
      30
    )).toBe("closed");
    expect(studioPromisePayoffDeadlineState(
      { ...source, status: "intentional-non-payoff" },
      30
    )).toBe("closed");
  });

  it("warns about overdue unresolved promises and structural gaps in canonical order", () => {
    const warnings = diagnoseStudioPromisePayoffLedger(fixture());
    expect(warnings[0]).toMatchObject({
      code: "OVERDUE",
      severity: "critical",
      entryId: "promise-letter",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings.some(({ entryId, code }) =>
      entryId === "promise-train" && code === "UNSCHEDULED_PAYOFF"
    )).toBe(false);
  });

  it("detects impossible story ordering and missing completion evidence", () => {
    let ledger = createEmptyStudioPromisePayoffLedger(10);
    ledger = addStudioPromisePayoffEntry(ledger, {
      id: "broken-order",
      title: "순서 오류",
      status: "payoff",
      seed: storyLink("seed", 10, "frame-1"),
      foreshadows: [
        storyLink("early", 8, "frame-2"),
        storyLink("late", 20, "frame-3"),
      ],
      payoff: storyLink("payoff", 15, "frame-4"),
    });
    ledger = addStudioPromisePayoffEntry(ledger, {
      id: "intentional",
      title: "열린 결말",
      status: "intentional-non-payoff",
    });
    const codes = diagnoseStudioPromisePayoffLedger(ledger)
      .map(({ entryId, code }) => `${entryId}:${code}`);
    expect(codes).toEqual(expect.arrayContaining([
      "broken-order:FORESHADOW_BEFORE_SEED",
      "broken-order:FORESHADOW_AFTER_PAYOFF",
      "intentional:MISSING_INTENTIONAL_REASON",
    ]));
  });

  it("summarizes open, closed, deadline, and warning states", () => {
    expect(summarizeStudioPromisePayoffLedger(fixture())).toEqual({
      total: 3,
      unresolved: 2,
      seeded: 1,
      foreshadowing: 1,
      partiallyPaid: 0,
      paidOff: 0,
      intentionalNonPayoff: 1,
      dueSoon: 0,
      dueNow: 0,
      overdue: 1,
      unscheduled: 0,
      warningEntries: 1,
    });
  });

  it("combines query, status, unresolved, warning, and owner filters", () => {
    const ledger = fixture();
    expect(searchStudioPromisePayoffLedger(ledger, {
      query: "범인 frame-7",
      statuses: ["foreshadow"],
      unresolvedOnly: true,
      owner: "김작가",
    }).map(({ id }) => id)).toEqual(["promise-clock"]);
    expect(searchStudioPromisePayoffLedger(ledger, {
      warningOnly: true,
    }).map(({ id }) => id)).toEqual(["promise-letter"]);
    expect(searchStudioPromisePayoffLedger(ledger, {
      unresolvedOnly: true,
    }).map(({ id }) => id)).toEqual(["promise-clock", "promise-letter"]);
  });
});

describe("studio Promise·Payoff deterministic merge", () => {
  it("unions clues while preserving current scalar decisions", () => {
    const current = addStudioPromisePayoffEntry(
      createEmptyStudioPromisePayoffLedger(10),
      {
        id: "shared",
        title: "현재 제목",
        status: "foreshadow",
        foreshadows: [storyLink("clue-a", 3, "frame-a")],
      }
    );
    const incoming = addStudioPromisePayoffEntry(
      createEmptyStudioPromisePayoffLedger(12),
      {
        id: "shared",
        title: "가져온 제목",
        summary: "가져온 설명",
        status: "payoff",
        foreshadows: [storyLink("clue-b", 7, "frame-b")],
      }
    );
    const merged = mergeStudioPromisePayoffLedgers(current, incoming);
    expect(merged).toMatchObject({
      addedIds: [],
      updatedIds: ["shared"],
      keptIds: [],
    });
    expect(merged.ledger.currentEpisode).toBe(12);
    expect(merged.ledger.entries[0]).toMatchObject({
      title: "현재 제목",
      summary: "가져온 설명",
      status: "foreshadow",
    });
    expect(merged.ledger.entries[0]?.foreshadows.map(({ id }) => id))
      .toEqual(["clue-a", "clue-b"]);
    expect(
      mergeStudioPromisePayoffLedgers(current, incoming, "replace-existing")
        .ledger.entries[0]?.title
    ).toBe("가져온 제목");
    expect(
      mergeStudioPromisePayoffLedgers(current, incoming, "keep-existing").keptIds
    ).toEqual(["shared"]);
  });

  it("does not depend on network, clocks, or randomness", () => {
    const source = readFileSync(
      resolve("apps/web/src/domains/creator/studio-promise-payoff-ledger.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toContain("Date.");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("randomUUID");
  });
});
