import { describe, expect, it } from "vitest";

import {
  createStudioPagesHistoryCommandJournal,
  summarizeStudioHistorySnapshot,
} from "./studio-pages-history-command-journal";

function pages(elementCount: number, id = "page-1") {
  return [
    {
      id,
      elements: Array.from({ length: elementCount }, (_, index) => ({
        id: `element-${index}`,
      })),
      canvasH: 2_000,
    },
  ];
}

describe("StudioPagesHistoryCommandJournal", () => {
  it("records bounded forward and inverse snapshot receipts", () => {
    const bridge = createStudioPagesHistoryCommandJournal();

    bridge.recordTransition({
      mutationKind: "elements.commit",
      previousPages: pages(1),
      nextPages: pages(2),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });

    const plan = bridge.replayPlan();
    expect(plan.recordCount).toBe(1);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.operations[0]).toMatchObject({
      kind: "studio.history.transition",
      payload: {
        mutationKind: "elements.commit",
        snapshot: {
          historyIndex: 1,
          pageCount: 1,
          elementCount: 2,
        },
      },
    });
    expect(JSON.parse(bridge.serialize())).toMatchObject({
      format: "toonspectrum:studio-command-journal",
      version: 1,
    });
  });

  it("gives same-count, same-index content edits distinct forward and inverse identities", () => {
    const bridge = createStudioPagesHistoryCommandJournal();
    const previousPages = [
      {
        id: "page-1",
        elements: [
          {
            id: "element-1",
            x: 10,
            text: "before",
            points: [0, 1],
            fill: "#111111",
          },
        ],
        canvasH: 2_000,
      },
    ];
    const nextPages = [
      {
        id: "page-1",
        elements: [
          {
            id: "element-1",
            x: 11,
            text: "after",
            points: [0, 2],
            fill: "#eeeeee",
          },
        ],
        canvasH: 2_000,
      },
    ];

    bridge.recordTransition({
      mutationKind: "element.patch",
      previousPages,
      nextPages,
      previousHistoryIndex: 4,
      nextHistoryIndex: 4,
    });

    const serialized = JSON.parse(bridge.serialize()) as {
      records: Array<{
        command: {
          payloadChecksum: string;
          payload: { snapshot: { contentDigest: string } };
        };
        inverse: {
          payloadChecksum: string;
          payload: { snapshot: { contentDigest: string } };
        };
      }>;
    };
    const record = serialized.records[0];
    expect(record?.command.payload.snapshot.contentDigest).not.toBe(
      record?.inverse.payload.snapshot.contentDigest
    );
    expect(record?.command.payloadChecksum).not.toBe(
      record?.inverse.payloadChecksum
    );
  });

  it("collapses consecutive pointer edits into one final forward/inverse transition", () => {
    const bridge = createStudioPagesHistoryCommandJournal();

    bridge.recordTransition({
      mutationKind: "transform.drag",
      previousPages: pages(1),
      nextPages: pages(2),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
      coalesceKey: "transform:selected",
    });
    bridge.recordTransition({
      mutationKind: "transform.drag",
      previousPages: pages(2),
      nextPages: pages(3),
      previousHistoryIndex: 1,
      nextHistoryIndex: 1,
      coalesceKey: "transform:selected",
    });

    expect(bridge.recordUndo({ pages: pages(1), historyIndex: 0 })).toBe("recorded");
    const undoBatch = bridge.replayPlan().batches.at(-1);
    expect(undoBatch?.operations).toHaveLength(1);
    expect(undoBatch?.operations.map((operation) =>
      (operation.payload as { snapshot: { elementCount: number } }).snapshot.elementCount
    )).toEqual([1]);

    expect(bridge.recordRedo({ pages: pages(3), historyIndex: 1 })).toBe("recorded");
    const redoBatch = bridge.replayPlan().batches.at(-1);
    expect(redoBatch?.operations.map((operation) =>
      (operation.payload as { snapshot: { elementCount: number } }).snapshot.elementCount
    )).toEqual([3]);
  });

  it("does not append every coalesced pointer sample before a journal boundary", () => {
    const bridge = createStudioPagesHistoryCommandJournal();
    for (let index = 0; index < 256; index += 1) {
      bridge.recordTransition({
        mutationKind: "transform.drag",
        previousPages: pages(index + 1),
        nextPages: pages(index + 2),
        previousHistoryIndex: index === 0 ? 0 : 1,
        nextHistoryIndex: 1,
        coalesceKey: "transform:selected",
      });
    }

    const plan = bridge.replayPlan();
    expect(plan.recordCount).toBe(1);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.operations).toHaveLength(1);
    expect(
      (plan.batches[0]?.operations[0]?.payload as {
        snapshot: { elementCount: number };
      }).snapshot.elementCount
    ).toBe(257);
  });

  it("keeps actor undo/redo ordering aligned across divergent history", () => {
    const bridge = createStudioPagesHistoryCommandJournal();
    bridge.recordTransition({
      mutationKind: "first",
      previousPages: pages(0),
      nextPages: pages(1),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });
    bridge.recordTransition({
      mutationKind: "second",
      previousPages: pages(1),
      nextPages: pages(2),
      previousHistoryIndex: 1,
      nextHistoryIndex: 2,
    });

    expect(bridge.recordUndo({ pages: pages(1), historyIndex: 1 })).toBe("recorded");
    bridge.recordTransition({
      mutationKind: "divergent",
      previousPages: pages(1),
      nextPages: pages(3),
      previousHistoryIndex: 1,
      nextHistoryIndex: 2,
    });

    expect(bridge.recordRedo({ pages: pages(3), historyIndex: 2 })).toBe("rebased");
    expect(bridge.recordUndo({ pages: pages(1), historyIndex: 1 })).toBe("rebased");
  });

  it("compacts a bounded prefix and continues a verified global sequence", () => {
    const bridge = createStudioPagesHistoryCommandJournal({
      maxRecords: 8,
      compactAt: 4,
    });
    for (let index = 0; index < 6; index += 1) {
      bridge.recordTransition({
        mutationKind: `step-${index}`,
        previousPages: pages(index),
        nextPages: pages(index + 1),
        previousHistoryIndex: index,
        nextHistoryIndex: index + 1,
      });
    }

    const plan = bridge.replayPlan();
    expect(plan.checkpoint).not.toBeNull();
    expect(plan.recordCount).toBe(2);
    expect(plan.nextSequence).toBe(7);
    expect(plan.checkpoint).toMatchObject({
      upToSequence: 4,
      state: {
        historyIndex: 4,
        elementCount: 4,
      },
    });
  });

  it("resets the local command horizon after an external history replacement", () => {
    const bridge = createStudioPagesHistoryCommandJournal();
    bridge.recordTransition({
      mutationKind: "before-reset",
      previousPages: pages(0),
      nextPages: pages(1),
      previousHistoryIndex: 0,
      nextHistoryIndex: 1,
    });
    bridge.reset();

    expect(bridge.replayPlan()).toMatchObject({
      checkpoint: null,
      recordCount: 0,
      nextSequence: 1,
    });
    expect(bridge.recordUndo({ pages: pages(0), historyIndex: 0 })).toBe("rebased");
  });

  it("rebases an undo horizon miss to the authoritative resulting snapshot", () => {
    const bridge = createStudioPagesHistoryCommandJournal();
    const targetPages = [
      {
        id: "page-result",
        elements: [{ id: "same-count", x: 42, fill: "#ef4444" }],
        canvasH: 3_200,
      },
    ];

    expect(
      bridge.recordUndo({ pages: targetPages, historyIndex: 7 })
    ).toBe("rebased");

    expect(bridge.replayPlan()).toMatchObject({
      checkpoint: {
        id: "checkpoint:history-rebase",
        upToSequence: 0,
        state: {
          historyIndex: 7,
          pageCount: 1,
          elementCount: 1,
          pages: [
            {
              id: "page-result",
              elementCount: 1,
              canvasH: 3_200,
            },
          ],
        },
      },
      recordCount: 0,
      nextSequence: 1,
    });
    expect(
      bridge.recordRedo({ pages: targetPages, historyIndex: 7 })
    ).toBe("rebased");
  });
});

describe("summarizeStudioHistorySnapshot", () => {
  it("bounds identity strings and exposes only structural page metadata", () => {
    const summary = summarizeStudioHistorySnapshot(
      [
        {
          id: "x".repeat(300),
          elements: [{ secret: "never copied" }],
          canvasH: 4_000,
        },
      ],
      3
    );

    expect(summary.pages[0]?.id).toHaveLength(128);
    expect(summary).toMatchObject({
      historyIndex: 3,
      pageCount: 1,
      elementCount: 1,
      pages: [
        {
          id: "x".repeat(128),
          elementCount: 1,
          canvasH: 4_000,
        },
      ],
    });
    expect(summary.contentDigest).toMatch(/^shs1-[0-9a-f]{16}$/u);
    expect(summary.pages[0]?.contentDigest).toMatch(/^shs1-[0-9a-f]{16}$/u);
  });

  it("distinguishes same-shape x, text, points, and fill mutations without copying content", () => {
    const variants = [
      { id: "element-1", x: 1, text: "before", points: [0, 1], fill: "#000000" },
      { id: "element-1", x: 2, text: "before", points: [0, 1], fill: "#000000" },
      { id: "element-1", x: 1, text: "after", points: [0, 1], fill: "#000000" },
      { id: "element-1", x: 1, text: "before", points: [0, 2], fill: "#000000" },
      { id: "element-1", x: 1, text: "before", points: [0, 1], fill: "#ffffff" },
    ];
    const summaries = variants.map((element) =>
      summarizeStudioHistorySnapshot(
        [{ id: "page-1", elements: [element], canvasH: 2_000 }],
        4
      )
    );

    expect(
      new Set(summaries.map((summary) => summary.contentDigest)).size
    ).toBe(variants.length);
    expect(
      new Set(
        summaries.map((summary) => summary.pages[0]?.contentDigest)
      ).size
    ).toBe(variants.length);
    expect(
      summaries.every((summary) => JSON.stringify(summary).length < 500)
    ).toBe(true);
  });

  it("stores only a fixed-size digest for large element strings", () => {
    const secret = "data:image/png;base64," + "A".repeat(200_000);
    const summary = summarizeStudioHistorySnapshot(
      [
        {
          id: "page-1",
          elements: [{ id: "image-1", src: secret }],
          canvasH: 2_000,
        },
      ],
      1
    );
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain(secret.slice(0, 1_000));
    expect(serialized.length).toBeLessThan(500);
  });

  it("includes changes beyond the bounded per-page preview in the snapshot digest", () => {
    const makeManyPages = (lastX: number) =>
      Array.from({ length: 201 }, (_, index) => ({
        id: `page-${index}`,
        elements: [{ id: `element-${index}`, x: index === 200 ? lastX : index }],
        canvasH: 2_000,
      }));

    const before = summarizeStudioHistorySnapshot(makeManyPages(1), 2);
    const after = summarizeStudioHistorySnapshot(makeManyPages(2), 2);

    expect(before.pages).toHaveLength(200);
    expect(before.pageCount).toBe(201);
    expect(after.contentDigest).not.toBe(before.contentDigest);
  });
});
