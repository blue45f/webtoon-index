import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { createBrushLabRecipe, updateBrushLabSlot } from "../../apps/web/src/domains/creator/brush-lab/brush-lab-recipe";
import { readBrushLabWorkspace, writeBrushLabWorkspace } from "../../apps/web/src/domains/creator/brush-lab/brush-lab-workspace";

const workspace = () => ({
  brush: JSON.stringify({ marker: "native validation occurs at runtime", name: "현재" }),
  reference: JSON.stringify({ marker: "reference", name: "기준 A" }),
  recipe: updateBrushLabSlot(createBrushLabRecipe("ink-particle", 7), "tip", { sourceId: "pencil", locked: true }),
});

describe("Brush Lab portable workspace", () => {
  it("round-trips both full payloads, eight sources, locks and seed", () => {
    assert.deepEqual(readBrushLabWorkspace(writeBrushLabWorkspace(workspace())), workspace());
  });
  it("rejects a different generator revision rather than promising the same variants", () => {
    const payload = JSON.parse(writeBrushLabWorkspace(workspace()));
    for (const generatorRevision of [0, 1, 3, "2", null]) {
      assert.throws(() => readBrushLabWorkspace(JSON.stringify({ ...payload, generatorRevision })));
    }
  });
  it("rejects future schema, wrong kind and missing recipe before changing live state", () => {
    const payload = JSON.parse(writeBrushLabWorkspace(workspace()));
    for (const patch of [{ version: 2 }, { kind: "other" }, { recipe: null }, { recipe: [] }]) {
      assert.throws(() => readBrushLabWorkspace(JSON.stringify({ ...payload, ...patch })));
    }
  });
  it("retains canonical slot validation at the workspace boundary", () => {
    const payload = JSON.parse(writeBrushLabWorkspace(workspace()));
    payload.recipe.slots[0].id = "remote-code";
    assert.throws(() => readBrushLabWorkspace(JSON.stringify(payload)));
  });
  it("rejects multi-byte oversized individual brush payloads on both write and read", () => {
    const original = workspace();
    assert.throws(() => writeBrushLabWorkspace({ ...original, brush: JSON.stringify({ data: "한".repeat(360000) }) }));
    const payload = JSON.parse(writeBrushLabWorkspace(original));
    payload.reference = JSON.stringify({ data: "한".repeat(360000) });
    assert.throws(() => readBrushLabWorkspace(JSON.stringify(payload)));
  });
  it("rejects malformed nested payloads and oversized envelopes", () => {
    assert.throws(() => writeBrushLabWorkspace({ ...workspace(), brush: "[]" }));
    assert.throws(() => writeBrushLabWorkspace({ ...workspace(), reference: "broken" }));
    assert.throws(() => readBrushLabWorkspace(" ".repeat(3 * 1024 * 1024 + 1)));
  });
});
