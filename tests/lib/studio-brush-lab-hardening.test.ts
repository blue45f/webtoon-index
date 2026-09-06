import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  BRUSH_LAB_HISTORY_ESTIMATED_BYTES,
  BRUSH_LAB_HISTORY_LIMIT,
  brushLabRecipeKey,
  commitBrushLabHistory,
  createBrushLabRecipe,
  generateBrushLabVariants,
  moveBrushLabHistory,
  resolveBrushLabTraits,
  updateBrushLabSlot,
} from "../../apps/web/src/domains/creator/brush-lab/brush-lab-recipe";

import type { BrushLabHistory, BrushLabRecipe } from "../../apps/web/src/domains/creator/brush-lab/brush-lab-recipe";

const seeded = (): BrushLabRecipe => {
  const recipe = createBrushLabRecipe("ink-particle", 42);
  return { ...recipe, slots: recipe.slots.map((slot) => ({ ...slot, sourceId: "pencil" })) };
};
const bytes = (history: BrushLabHistory<unknown>) => [...history.past, ...history.future]
  .reduce<number>((sum, value) => sum + JSON.stringify(value).length * 2, 0);

describe("Brush Lab bounded authoring", () => {
  it("changes exactly the requested number when alternatives exist", () => {
    const recipe = seeded();
    const variants = generateBrushLabVariants(recipe, ["pencil", "oil", "watercolor"], 12, 2);
    assert.equal(variants.length, 12);
    for (const variant of variants) assert.equal(variant.slots.filter((slot) => slot.sourceId !== "pencil").length, 2);
  });
  it("never spends a mutation on a saturated slot", () => {
    let recipe = seeded();
    recipe = updateBrushLabSlot(recipe, "tip", { sourceId: null });
    const variants = generateBrushLabVariants(recipe, ["pencil"], 12, 8);
    assert.equal(variants.length, 1);
    assert.equal(variants[0]!.slots[0]!.sourceId, "pencil");
  });
  it("terminates an exhausted source pool without meaningless candidates", () => {
    assert.deepEqual(generateBrushLabVariants(seeded(), ["pencil"], 12, 8), []);
  });
  it("keeps locks, donor order independence and recipe uniqueness", () => {
    const recipe = updateBrushLabSlot(seeded(), "tip", { locked: true });
    const first = generateBrushLabVariants(recipe, ["pencil", "oil", "watercolor"], 12, 8);
    assert.deepEqual(first, generateBrushLabVariants(recipe, ["watercolor", "oil", "pencil", "oil"], 12, 8));
    assert.equal(new Set(first.map(brushLabRecipeKey)).size, first.length);
    for (const variant of first) assert.deepEqual(variant.slots[0], recipe.slots[0]);
  });
  it("does not add equal JSON snapshots or destroy redo for a no-op", () => {
    const history = { past: [], present: { tip: 3 }, future: [{ tip: 4 }] };
    assert.equal(commitBrushLabHistory(history, { tip: 3 }), history);
  });
  it("caps large texture history by serialized size, not only entry count", () => {
    let history = { past: [], present: { id: 0, alpha: "한".repeat(120000) }, future: [] } as BrushLabHistory<{ id: number; alpha: string }>;
    for (let id = 1; id <= 40; id++) history = commitBrushLabHistory(history, { id, alpha: "한".repeat(120000) });
    assert.ok(history.past.length > 0 && history.past.length < BRUSH_LAB_HISTORY_LIMIT);
    assert.ok(bytes(history) <= BRUSH_LAB_HISTORY_ESTIMATED_BYTES);
    for (let index = 0; index < 20; index++) {
      history = moveBrushLabHistory(history, index % 2 ? "redo" : "undo");
      assert.ok(bytes(history) <= BRUSH_LAB_HISTORY_ESTIMATED_BYTES);
    }
  });
  it("keeps the current brush even when it exceeds the history budget", () => {
    const big = { alpha: "x".repeat(BRUSH_LAB_HISTORY_ESTIMATED_BYTES) };
    const history = commitBrushLabHistory({ past: [], present: { alpha: "" }, future: [] }, big);
    assert.equal(history.present, big);
    const undone = moveBrushLabHistory(history, "undo");
    assert.equal(undone.present.alpha, "");
    assert.deepEqual(undone.future, []);
  });
  it("never jumps over an oversized adjacent history state", () => {
    const history = { past: ["old"], present: "x".repeat(BRUSH_LAB_HISTORY_ESTIMATED_BYTES), future: [] };
    assert.deepEqual(commitBrushLabHistory(history, "new").past, []);
  });
  it("bounds 10,000 edits and retains immediate undo/redo identity", () => {
    let history: BrushLabHistory<number> = { past: [], present: 0, future: [] };
    for (let value = 1; value <= 10000; value++) history = commitBrushLabHistory(history, value);
    assert.equal(history.past.length, BRUSH_LAB_HISTORY_LIMIT);
    assert.deepEqual(moveBrushLabHistory(moveBrushLabHistory(history, "undo"), "redo"), history);
    assert.ok(bytes(history) <= BRUSH_LAB_HISTORY_ESTIMATED_BYTES);
  });
  it("rejects pre-cancelled composition before loading anything", async () => {
    const controller = new AbortController(); controller.abort();
    let loads = 0;
    await assert.rejects(resolveBrushLabTraits(seeded(), "baseline", async () => { loads++; return "source"; }, () => "mixed", controller.signal), { name: "AbortError" });
    assert.equal(loads, 0);
  });
  it("discards a late donor and never starts remaining loads after cancellation", async () => {
    const controller = new AbortController();
    let recipe = updateBrushLabSlot(createBrushLabRecipe("ink-particle"), "tip", { sourceId: "pencil" });
    recipe = updateBrushLabSlot(recipe, "surface", { sourceId: "oil" });
    let loads = 0; let merges = 0;
    await assert.rejects(resolveBrushLabTraits(recipe, "baseline", async () => {
      loads++; await Promise.resolve(); controller.abort(); return "source";
    }, () => { merges++; return "mixed"; }, controller.signal), { name: "AbortError" });
    assert.equal(loads, 1); assert.equal(merges, 0);
  });
  it("retains load deduplication and canonical merge order", async () => {
    let loads = 0;
    const result = await resolveBrushLabTraits(seeded(), [] as string[], async () => { loads++; return ["source"]; }, (slot, current) => [...current, slot]);
    assert.equal(loads, 1); assert.equal(result.length, 8); assert.equal(result[0], "tip");
  });
  it("contains non-JSON history without discarding the active value", () => {
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    const current = { value: 1 };
    const result = commitBrushLabHistory<unknown>({ past: [0], present: cycle, future: [] }, current);
    assert.equal(result.present, current); assert.deepEqual(result.past, []);
  });
});
