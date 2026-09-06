import { describe, expect, it } from "vitest";

import {
  deleteDraftLayers,
  deleteEmptyLayers,
  deleteHiddenLayers,
  type LayerCleanupTargetItem,
} from "./studio-layer-batch-cleanup";

describe("studio-layer-batch-cleanup", () => {
  const testLayers: readonly LayerCleanupTargetItem[] = [
    { id: "1", name: "선화", visible: true, isDraft: false, isEmpty: false },
    { id: "2", name: "콘티 (초안)", visible: true, isDraft: true, isEmpty: false },
    { id: "3", name: "참고자료 (숨김)", visible: false, isDraft: false, isEmpty: false },
    { id: "4", name: "빈 레이어", visible: true, isDraft: false, isEmpty: true },
  ];

  it("deletes all hidden layers while preserving visible ones", () => {
    const result = deleteHiddenLayers(testLayers);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedLayers[0].id).toBe("3");
    expect(result.remainingLayers.map((l) => l.id)).toEqual(["1", "2", "4"]);
  });

  it("deletes all empty layers", () => {
    const result = deleteEmptyLayers(testLayers);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedLayers[0].id).toBe("4");
    expect(result.remainingLayers.map((l) => l.id)).toEqual(["1", "2", "3"]);
  });

  it("deletes all draft layers", () => {
    const result = deleteDraftLayers(testLayers);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedLayers[0].id).toBe("2");
    expect(result.remainingLayers.map((l) => l.id)).toEqual(["1", "3", "4"]);
  });
});
