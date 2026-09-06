import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const backgroundSource = readStudioBg3dEditorSource();
const shapesPanelSource = readFileSync(
  new URL("./StudioBg3dShapesPanel.tsx", import.meta.url),
  "utf8",
);
const starterPanelSource = readFileSync(
  new URL("./StudioBg3dProceduralStarterPanel.tsx", import.meta.url),
  "utf8",
);

describe("BG3D procedural starter UI integration boundary", () => {
  it("routes insertion through the fail-closed planner and live scene authority", () => {
    expect(backgroundSource).toContain(
      'from "./studio-bg3d-procedural-scene-usage"',
    );
    expect(backgroundSource).toContain(
      "planStudioBg3dProceduralStarterInsertion({",
    );
    expect(backgroundSource).toContain(
      "const live = physicsRuntimeSourceRef.current;",
    );
    expect(backgroundSource).toContain(
      "physicsRuntimeSourceRef.current = { ...live, primitives: nextPrimitives };",
    );
    expect(backgroundSource).toContain(
      "setSelectedIds(new Set([plan.primitives[0].id]));",
    );
  });

  it("connects the leaf browser only through the shapes panel context", () => {
    expect(shapesPanelSource).toContain(
      'from "./StudioBg3dProceduralStarterPanel"',
    );
    expect(shapesPanelSource).toContain("<StudioBg3dProceduralStarterPanel");
    expect(shapesPanelSource).toContain(
      "disabledReason={proceduralStarterDisabledReason}",
    );
    expect(shapesPanelSource).toContain("onInsert={addProceduralStarterAsset}");
    expect(backgroundSource).toContain("addProceduralStarterAsset,");
    expect(backgroundSource).toContain("proceduralStarterDisabledReason,");
  });

  it("keeps rights, search, budget, and mobile touch affordances visible in the leaf", () => {
    expect(starterPanelSource).toContain("오리지널 · CC0");
    expect(starterPanelSource).toContain('aria-label="절차형 3D 에셋 검색"');
    expect(starterPanelSource).toContain("asset.budget.triangles");
    expect(starterPanelSource).toContain("disabled={Boolean(disabledReason)}");
    expect(starterPanelSource).toContain("min-h-11");
  });
});
