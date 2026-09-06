import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  BRUSH_LAB_HISTORY_LIMIT, BRUSH_LAB_SLOT_IDS, brushLabRecipeKey, commitBrushLabHistory,
  createBrushLabRecipe, generateBrushLabVariants, moveBrushLabHistory, parseBrushLabRecipe,
  resolveBrushLabTraits, updateBrushLabSlot,
} from "../../apps/web/src/domains/creator/brush-lab/brush-lab-recipe";

import type { BrushLabHistory } from "../../apps/web/src/domains/creator/brush-lab/brush-lab-recipe";

const base = () => createBrushLabRecipe("ink-particle", 42);
const donors = ["watercolor", "oil", "ink-particle", "pencil"];

describe("brush lab recipe contract", () => {
  it("round-trips eight canonical, independent slots", () => {
    const recipe = base();
    assert.deepEqual(parseBrushLabRecipe(JSON.stringify(recipe)), recipe);
    assert.deepEqual(recipe.slots.map((slot) => slot.id), [...BRUSH_LAB_SLOT_IDS]);
  });
  it("restores canonical ordering without changing source identity", () => {
    const recipe = updateBrushLabSlot(base(), "tip", { sourceId: "pencil", locked: true });
    assert.deepEqual(parseBrushLabRecipe(JSON.stringify({ ...recipe, slots: [...recipe.slots].reverse() })), recipe);
  });
  it("rejects unknown versions and invalid seeds", () => {
    for (const version of [0, 2, "1", null]) assert.throws(() => parseBrushLabRecipe(JSON.stringify({ ...base(), version })));
    for (const seed of [-1, 1.2, 4294967296, "42", null]) assert.throws(() => parseBrushLabRecipe(JSON.stringify({ ...base(), seed })));
  });
  it("rejects duplicate, missing and unknown slots", () => {
    const recipe = base();
    for (const slots of [recipe.slots.slice(1), [...recipe.slots.slice(1), recipe.slots[1]], [...recipe.slots.slice(1), { id: "script", sourceId: null, locked: false }]]) {
      assert.throws(() => parseBrushLabRecipe(JSON.stringify({ ...recipe, slots })));
    }
  });
  it("rejects executable URLs, oversized data and ambiguous locks", () => {
    assert.throws(() => createBrushLabRecipe("https://evil.example/engine.js"));
    assert.throws(() => parseBrushLabRecipe(" ".repeat(32769)));
    assert.throws(() => parseBrushLabRecipe(JSON.stringify({ ...base(), slots: base().slots.map((slot) => ({ ...slot, locked: 1 })) })));
  });
  it("copies only known fields from imported JSON", () => {
    const recipe = parseBrushLabRecipe(JSON.stringify({ ...base(), rendererUrl: "https://evil.example", nested: {} }));
    assert.equal("rendererUrl" in recipe, false);
  });
  it("is deterministic and independent of donor arrival order", () => {
    const first = generateBrushLabVariants(base(), donors);
    assert.equal(first.length, 8);
    assert.deepEqual(first, generateBrushLabVariants(base(), [...donors].reverse()));
    assert.deepEqual(first, generateBrushLabVariants(base(), [...donors, ...donors]));
  });
  it("preserves all locked choices and never mutates the input", () => {
    const recipe = updateBrushLabSlot(base(), "tip", { sourceId: "pencil", locked: true });
    const before = JSON.stringify(recipe);
    for (const variant of generateBrushLabVariants(recipe, donors, 12, 8)) {
      assert.deepEqual(variant.slots.find((slot) => slot.id === "tip"), recipe.slots.find((slot) => slot.id === "tip"));
      assert.equal(variant.carrierId, recipe.carrierId);
    }
    assert.equal(JSON.stringify(recipe), before);
  });
  it("deduplicates recipe identity without claiming visual uniqueness", () => {
    const variants = generateBrushLabVariants(base(), donors, 12, 2);
    assert.equal(new Set(variants.map(brushLabRecipeKey)).size, variants.length);
    assert.ok(variants.every((variant) => brushLabRecipeKey(variant) !== brushLabRecipeKey(base())));
  });
  it("has bounded output, including exhausted and fully locked spaces", () => {
    const locked = { ...base(), slots: base().slots.map((slot) => ({ ...slot, locked: true })) };
    assert.deepEqual(generateBrushLabVariants(locked, donors), []);
    assert.deepEqual(generateBrushLabVariants(base(), []), []);
    assert.deepEqual(generateBrushLabVariants(base(), donors, Infinity), []);
    assert.ok(generateBrushLabVariants(base(), donors, 1000000).length <= 12);
    assert.ok(generateBrushLabVariants(base(), ["pencil"], 12, 8).length <= 1);
  });
  it("changes at most the requested number of unlocked slots", () => {
    for (const variant of generateBrushLabVariants(base(), donors, 8, 2)) {
      assert.ok(variant.slots.filter((slot) => slot.sourceId !== null).length <= 2);
    }
  });
  it("loads each selected source once before applying any changes", async () => {
    let recipe = updateBrushLabSlot(base(), "tip", { sourceId: "pencil" });
    recipe = updateBrushLabSlot(recipe, "surface", { sourceId: "pencil" });
    let loads = 0;
    const result = await resolveBrushLabTraits(recipe, { values: [] as string[] }, async () => { loads++; return { values: ["source"] }; }, (slot, current) => ({ values: [...current.values, slot] }));
    assert.equal(loads, 1);
    assert.deepEqual(result.values, ["tip", "surface"]);
  });
  it("fails atomically when a donor is missing", async () => {
    let recipe = updateBrushLabSlot(base(), "tip", { sourceId: "pencil" });
    recipe = updateBrushLabSlot(recipe, "surface", { sourceId: "missing" });
    let merges = 0;
    await assert.rejects(() => resolveBrushLabTraits(recipe, "original", async (id) => id === "missing" ? null : id, () => { merges++; return "changed"; }));
    assert.equal(merges, 0);
  });
  it("keeps the exact baseline when no donors are selected", async () => {
    const original = { renderer: "authoritative" };
    const result = await resolveBrushLabTraits(base(), original, async () => { throw new Error("must not load"); }, () => { throw new Error("must not merge"); });
    assert.equal(result, original);
  });
  it("bounds history and implements undo/redo without mutating old state", () => {
    let history: BrushLabHistory<number> = { past: [], present: 0, future: [] };
    const initial = history;
    for (let value = 1; value <= 100; value++) history = commitBrushLabHistory(history, value);
    assert.equal(history.past.length, BRUSH_LAB_HISTORY_LIMIT);
    const undone = moveBrushLabHistory(history, "undo");
    assert.equal(undone.present, 99);
    assert.deepEqual(moveBrushLabHistory(undone, "redo"), history);
    assert.deepEqual(initial, { past: [], present: 0, future: [] });
  });
  it("clears redo after a new edit and safely handles empty history", () => {
    const history: BrushLabHistory<number> = { past: [1], present: 2, future: [3] };
    assert.deepEqual(commitBrushLabHistory(history, 9).future, []);
    const empty: BrushLabHistory<number> = { past: [], present: 0, future: [] };
    assert.equal(moveBrushLabHistory(empty, "undo"), empty);
    assert.equal(moveBrushLabHistory(empty, "redo"), empty);
  });
});
