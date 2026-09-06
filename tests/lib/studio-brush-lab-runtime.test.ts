import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { studioCoreBrushCatalogSelection } from "../../apps/web/src/domains/creator/brush/studio-brush-selection";
import { createBrushLabRecipe } from "../../apps/web/src/domains/creator/brush-lab/brush-lab-recipe";
import {
  brushLabDocumentFromSelection, brushLabSnapshotKey, compileBrushLabRecipe,
  createInitialBrushLabDocument, readBrushLabJson, writeBrushLabJson,
} from "../../apps/web/src/domains/creator/brush-lab/brush-lab-runtime";
import { BRUSH_PRESETS } from "../../apps/web/src/domains/creator/studio-brush";

import type { StudioBrushEngineProgramSet } from "../../apps/web/src/domains/creator/brush/studio-brush-engine-program-set";

const programs: StudioBrushEngineProgramSet = {
  version: 1, oil: { bristlePhysics: true, bristleLoadDynamics: false, impastoRelief: true },
};

describe("brush lab integration contracts", () => {
  it("materializes an actual default carrier", () => {
    const document = createInitialBrushLabDocument();
    assert.ok(BRUSH_PRESETS.some((preset) => preset.id === document.snapshot.brushId && preset.operation === "paint"));
  });
  it("preserves flattened engine programs through the native JSON round-trip", () => {
    const oil = BRUSH_PRESETS.find((preset) => preset.id === "oil");
    assert.ok(oil);
    const base = brushLabDocumentFromSelection(studioCoreBrushCatalogSelection(oil));
    const original = { ...base, snapshot: { ...base.snapshot, enginePrograms: programs } };
    const restored = readBrushLabJson(writeBrushLabJson(original)).document;
    assert.deepEqual(restored.snapshot.enginePrograms, programs);
    assert.equal(restored.snapshot.brushId, original.snapshot.brushId);
    assert.deepEqual(restored.snapshot.brushDynamics, original.snapshot.brushDynamics);
  });
  it("resets physical overrides when a carrier changes", () => {
    const initial = createInitialBrushLabDocument();
    const preset = BRUSH_PRESETS.find((item) => item.id === initial.snapshot.brushId);
    assert.ok(preset);
    const next = brushLabDocumentFromSelection(studioCoreBrushCatalogSelection(preset), { ...initial.snapshot, enginePrograms: programs });
    assert.equal(next.snapshot.enginePrograms, null);
  });
  it("does not accept erase operations as paint carriers", () => {
    const initial = createInitialBrushLabDocument();
    const preset = BRUSH_PRESETS.find((item) => item.id === initial.snapshot.brushId);
    assert.ok(preset);
    assert.throws(() => brushLabDocumentFromSelection({ ...studioCoreBrushCatalogSelection(preset), operation: "erase", drawMode: "eraser" }));
  });
  it("rejects stale-carrier recipes rather than silently switching renderers", async () => {
    await assert.rejects(() => compileBrushLabRecipe(createBrushLabRecipe("different-carrier"), createInitialBrushLabDocument()));
  });
  it("keeps programs and identity when applying an empty recipe", async () => {
    const original = createInitialBrushLabDocument();
    const result = await compileBrushLabRecipe(createBrushLabRecipe(original.carrierId), original);
    assert.equal(brushLabSnapshotKey(result), brushLabSnapshotKey(original));
  });
  it("rejects oversized, unknown and future file formats", () => {
    const file = JSON.parse(writeBrushLabJson(createInitialBrushLabDocument())) as Record<string, unknown>;
    assert.throws(() => readBrushLabJson(JSON.stringify({ ...file, version: 999 })));
    assert.throws(() => readBrushLabJson(JSON.stringify({ ...file, brushId: "no-such-runtime" })));
    assert.throws(() => readBrushLabJson(JSON.stringify({ ...file, kind: "script" })));
    assert.throws(() => readBrushLabJson(" ".repeat(1024 * 1024 + 1)));
  });
});
