import { describe, expect, it } from "vitest";

import {
  addReferenceItem,
  createVisualReferenceBoard,
  extractDominantColorPalette,
  queryReferencesByTag,
  removeReferenceItem,
  updateReferenceItemTransform,
  type VisualReferenceItem,
} from "./studio-linked-reference-board";

describe("Studio Linked Visual Reference Board", () => {
  const item1: VisualReferenceItem = {
    id: "ref_char_1",
    kind: "image",
    title: "주인공 의상 레퍼런스",
    sourceUri: "blob:ref_01.png",
    transform: { x: 100, y: 100, width: 400, height: 600, rotationDeg: 0, scale: 1.0, opacity: 0.9 },
    isPinnedAlwaysOnTop: true,
    boundTags: ["character:hero", "costume:winter", "panel:p_01"],
    offlineCached: true,
  };

  const item2: VisualReferenceItem = {
    id: "ref_bg_1",
    kind: "3d-snapshot",
    title: "교실 배경 원근",
    sourceUri: "blob:ref_bg.png",
    transform: { x: 600, y: 100, width: 800, height: 500, rotationDeg: 0, scale: 1.0, opacity: 1.0 },
    isPinnedAlwaysOnTop: false,
    boundTags: ["location:classroom", "perspective:wide"],
    offlineCached: true,
  };

  it("creates reference board and manages items", () => {
    let board = createVisualReferenceBoard({ id: "board_1", title: "메인 레퍼런스 보드" });
    board = addReferenceItem(board, item1);
    board = addReferenceItem(board, item2);

    expect(board.items).toHaveLength(2);

    board = updateReferenceItemTransform(board, "ref_char_1", { opacity: 0.5, scale: 1.2 });
    expect(board.items.find((i) => i.id === "ref_char_1")?.transform.opacity).toBe(0.5);

    board = removeReferenceItem(board, "ref_char_1");
    expect(board.items).toHaveLength(1);
  });

  it("extracts dominant color palette from pixel samples", () => {
    const pixels: [number, number, number][] = [
      [255, 0, 0],
      [255, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];

    const palette = extractDominantColorPalette(pixels, 2);
    expect(palette).toHaveLength(2);
    // Red bin should be first
    expect(palette[0].toLowerCase()).toBe("#ff0000");
  });

  it("queries references by semantic tags and panel ids", () => {
    const board = createVisualReferenceBoard({ id: "b", title: "보드", items: [item1, item2] });

    const heroRefs = queryReferencesByTag(board, "character:hero");
    expect(heroRefs).toHaveLength(1);
    expect(heroRefs[0].id).toBe("ref_char_1");

    const classRefs = queryReferencesByTag(board, "classroom");
    expect(classRefs).toHaveLength(1);
    expect(classRefs[0].id).toBe("ref_bg_1");
  });
});
