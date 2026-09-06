import { describe, expect, it } from "vitest";

import {
  addStoryCard,
  createStudioStoryCorkboard,
  fractionalIndexBetween,
  generateTasksFromCorkboard,
  projectCorkboardToPanelSequence,
  removeStoryCard,
  reorderStoryCard,
  updateStoryCard,
  validateStoryCorkboard,
  type StoryCard,
} from "./studio-story-corkboard";

describe("Studio Linked Story Corkboard", () => {
  function makeCard(id: string, orderKey: string, partial: Partial<StoryCard> = {}): StoryCard {
    return {
      id,
      kind: "scene",
      title: `Scene ${id}`,
      orderKey,
      status: "draft",
      emotionalTone: "tense",
      boundPanelIds: [`p_${id}_1`, `p_${id}_2`],
      boundShotIds: [`s_${id}_1`],
      ...partial,
    };
  }

  it("fractional indexing computes ordered midpoints between keys", () => {
    const k1 = fractionalIndexBetween(null, null);
    expect(k1).toBe("n");

    const kBefore = fractionalIndexBetween(null, "n");
    expect(kBefore.localeCompare("n")).toBeLessThan(0);

    const kAfter = fractionalIndexBetween("n", null);
    expect(kAfter.localeCompare("n")).toBeGreaterThan(0);

    const kBetween = fractionalIndexBetween("a", "c");
    expect(kBetween).toBe("b");
  });

  it("creates, adds and validates corkboard cards", () => {
    const board = createStudioStoryCorkboard({ id: "cb_1", title: "시즌 1 콘티 보드" });
    expect(board.id).toBe("cb_1");
    expect(board.cards).toEqual([]);

    const c1 = makeCard("c1", "a", { title: "도입부 만남" });
    const c2 = makeCard("c2", "b", { title: "갈등 발생" });
    const board1 = addStoryCard(board, c1);
    const board2 = addStoryCard(board1, c2);

    expect(board2.cards).toHaveLength(2);
    expect(board2.cards[0].id).toBe("c1");
    expect(board2.cards[1].id).toBe("c2");

    const diags = validateStoryCorkboard(board2);
    expect(diags).toEqual([]);
  });

  it("detects dangling parent and circular parent references", () => {
    const c1 = makeCard("c1", "a", { parentId: "c2" });
    const c2 = makeCard("c2", "b", { parentId: "c1" });
    const board = createStudioStoryCorkboard({ id: "cb_err", title: "오류 보드", cards: [c1, c2] });

    const diags = validateStoryCorkboard(board);
    expect(diags.some((d) => d.code === "CIRCULAR_PARENT")).toBe(true);

    const cDangling = makeCard("c3", "c", { parentId: "non_existent" });
    const boardDangling = createStudioStoryCorkboard({ id: "cb_dang", title: "댕글링", cards: [cDangling] });
    const dangDiags = validateStoryCorkboard(boardDangling);
    expect(dangDiags.some((d) => d.code === "DANGLING_PARENT")).toBe(true);
  });

  it("updates, reorders and removes cards", () => {
    const c1 = makeCard("c1", "a");
    const c2 = makeCard("c2", "m");
    const c3 = makeCard("c3", "z");
    let board = createStudioStoryCorkboard({ id: "cb_1", title: "보드", cards: [c1, c2, c3] });

    // Update
    board = updateStoryCard(board, "c2", { title: "수정된 장면 2", status: "approved" });
    expect(board.cards.find((c) => c.id === "c2")?.title).toBe("수정된 장면 2");

    // Reorder c3 between c1 and c2
    board = reorderStoryCard(board, "c3", "c1", "c2");
    expect(board.cards.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);

    // Remove
    board = removeStoryCard(board, "c1");
    expect(board.cards.map((c) => c.id)).toEqual(["c3", "c2"]);
  });

  it("projects corkboard to panel sequence and generates tasks", () => {
    const c1 = makeCard("c1", "a", { boundPanelIds: ["p1", "p2"], boundShotIds: ["s1"], emotionalTone: "joyful" });
    const c2 = makeCard("c2", "b", { boundPanelIds: ["p3"], boundShotIds: ["s2"], emotionalTone: "tense" });
    const board = createStudioStoryCorkboard({ id: "cb_1", title: "보드", cards: [c1, c2] });

    const projection = projectCorkboardToPanelSequence(board);
    expect(projection).toHaveLength(2);
    expect(projection[0]).toEqual({
      cardId: "c1",
      cardTitle: "Scene c1",
      kind: "scene",
      emotionalTone: "joyful",
      panelIds: ["p1", "p2"],
      shotIds: ["s1"],
    });

    const tasks = generateTasksFromCorkboard(board);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe("task:corkboard:c1");
    expect(tasks[0].title).toBe("[SCENE] Scene c1");
  });
});
