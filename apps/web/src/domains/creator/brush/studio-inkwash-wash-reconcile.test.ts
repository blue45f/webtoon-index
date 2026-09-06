import { beforeEach, describe, expect, it } from "vitest";

import {
  getStudioInkwashWash,
  readStudioInkwashWashDocumentCell,
  resetStudioInkwashWash,
  studioInkwashWashAppliedEntries,
  studioInkwashWashDisplay,
} from "./studio-inkwash-wash";
import {
  planStudioWetInkBrushReplay,
  reconcileStudioInkwashWashWithDocument,
} from "./studio-wet-ink-brush-runtime";

import type { DrawEl, El } from "../studio-element-model";

/**
 * 공유 워시는 침착만 알고 삭제를 몰랐다. Undo 한 수묵 펜 획의 안료가 필드에 남아 있다가, 같은
 * 경로에 물붓(안료 0)을 긋는 순간 워시 전체가 표시되면서 지운 획이 되살아났다(브라우저 실측:
 * pen 1580px → Undo 0px → water 1374px). 문서 대조는 사라지거나 바뀐 획이 있을 때만 남은 획을
 * 문서 순서대로 다시 침착해 워시를 재구성한다.
 */

function inkwash(
  id: string,
  brush: "inkwash-pen" | "inkwash-water-brush",
  x0: number,
  x1: number,
  y: number,
): DrawEl {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    const t = index / 8;
    points.push(x0 + (x1 - x0) * t, y + 2 * t);
    pressures.push(0.6);
  }
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    brush,
    brushCatalogId: brush,
    points,
    pressures,
    stroke: "#7c5cfc",
    strokeWidth: 12,
    opacity: 0.7,
    watercolorPipeline: "causal-walker-v2",
  } as unknown as DrawEl;
}

function pigmentAlongPath(x0: number, x1: number, y: number): number {
  const wash = getStudioInkwashWash();
  if (!wash) return 0;
  let total = 0;
  for (let x = x0; x <= x1; x += 4) {
    const cell = readStudioInkwashWashDocumentCell(wash, x, y + 1);
    if (!cell) continue;
    total += cell.mobile[0] + cell.mobile[1] + cell.mobile[2]
      + cell.fixed[0] + cell.fixed[1] + cell.fixed[2];
  }
  return total;
}

function displayAlpha(): number {
  const upload = studioInkwashWashDisplay();
  if (!upload) return 0;
  let alpha = 0;
  for (let index = 3; index < upload.rgba.length; index += 4) alpha += upload.rgba[index]!;
  return alpha;
}

function commit(element: DrawEl): void {
  const plan = planStudioWetInkBrushReplay(element, { phase: "committed" });
  expect(plan.ok).toBe(true);
}

describe("reconcileStudioInkwashWashWithDocument", () => {
  beforeEach(() => {
    resetStudioInkwashWash();
    reconcileStudioInkwashWashWithDocument([]);
  });

  it("leaves a growing document alone", () => {
    const pen = inkwash("pen-a", "inkwash-pen", 40, 240, 60);
    commit(pen);
    const before = pigmentAlongPath(40, 240, 60);
    expect(before).toBeGreaterThan(0);

    expect(reconcileStudioInkwashWashWithDocument([pen])).toBe(false);
    const water = inkwash("water-b", "inkwash-water-brush", 40, 240, 120);
    commit(water);
    expect(reconcileStudioInkwashWashWithDocument([pen, water])).toBe(false);

    // Growth only: the wash may re-allocate its field to fit the new stroke, but nothing was
    // re-deposited — both strokes stay applied and the pen's pigment is carried over exactly.
    expect(studioInkwashWashAppliedEntries().map(([id]) => id)).toEqual(["pen-a", "water-b"]);
    expect(pigmentAlongPath(40, 240, 60)).toBeCloseTo(before, 6);
  });

  it("drops the pigment of an undone stroke so a later water stroke cannot resurrect it", () => {
    const pen = inkwash("pen-a", "inkwash-pen", 40, 240, 60);
    commit(pen);
    expect(reconcileStudioInkwashWashWithDocument([pen])).toBe(false);
    expect(pigmentAlongPath(40, 240, 60)).toBeGreaterThan(0);

    // Undo: the element leaves the document.
    expect(reconcileStudioInkwashWashWithDocument([])).toBe(true);
    expect(getStudioInkwashWash()).toBeNull();
    expect(studioInkwashWashAppliedEntries()).toEqual([]);

    // The water brush over the same path shows only what the document holds: nothing.
    const water = inkwash("water-b", "inkwash-water-brush", 40, 240, 60);
    commit(water);
    expect(pigmentAlongPath(40, 240, 60)).toBe(0);
    expect(displayAlpha()).toBe(0);
  });

  it("keeps a settled stroke the deferred commit has not delivered to the document yet", () => {
    const pen = inkwash("pen-pending", "inkwash-pen", 40, 240, 60);
    // The live overlay settles into the wash before the element exists in the page.
    commit(pen);
    expect(reconcileStudioInkwashWashWithDocument([])).toBe(false);
    expect(pigmentAlongPath(40, 240, 60)).toBeGreaterThan(0);

    // Once the document has shown the id, its disappearance is a removal.
    expect(reconcileStudioInkwashWashWithDocument([pen])).toBe(false);
    expect(reconcileStudioInkwashWashWithDocument([])).toBe(true);
    expect(getStudioInkwashWash()).toBeNull();
  });

  it("rebuilds when a stroke moved so no pigment stays at the old place", () => {
    const pen = inkwash("pen-a", "inkwash-pen", 40, 240, 60);
    commit(pen);
    expect(reconcileStudioInkwashWashWithDocument([pen])).toBe(false);

    const moved = {
      ...pen,
      points: pen.points.map((value, index) => (index % 2 === 1 ? value + 100 : value)),
    } as DrawEl;
    expect(reconcileStudioInkwashWashWithDocument([moved])).toBe(true);
    expect(pigmentAlongPath(40, 240, 60)).toBe(0);
    expect(pigmentAlongPath(40, 240, 160)).toBeGreaterThan(0);
    expect(studioInkwashWashAppliedEntries().map(([id]) => id)).toEqual(["pen-a"]);
  });

  it("re-deposits the surviving strokes in document order and ignores non-wash elements", () => {
    const first = inkwash("pen-1", "inkwash-pen", 40, 240, 60);
    const second = inkwash("pen-2", "inkwash-pen", 40, 240, 140);
    const third = inkwash("pen-3", "inkwash-pen", 40, 240, 220);
    commit(first);
    commit(second);
    commit(third);
    const text = { id: "text-1", type: "text", x: 0, y: 0, text: "x" } as unknown as El;
    expect(reconcileStudioInkwashWashWithDocument([first, text, second, third])).toBe(false);

    expect(reconcileStudioInkwashWashWithDocument([first, text, third])).toBe(true);
    expect(pigmentAlongPath(40, 240, 140)).toBe(0);
    expect(pigmentAlongPath(40, 240, 60)).toBeGreaterThan(0);
    expect(pigmentAlongPath(40, 240, 220)).toBeGreaterThan(0);
    expect(studioInkwashWashAppliedEntries().map(([id]) => id)).toEqual(["pen-1", "pen-3"]);
    expect(getStudioInkwashWash()!.journal.map((entry) => entry.id)).toEqual(["pen-1", "pen-3"]);
  });
});
