import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const editorSource = [
  readStudioBg3dEditorSource(),
  ...[
    "./StudioBg3dShapesPanel.tsx",
    "./StudioBg3dViewPanelContent.tsx",
    "./StudioBg3dLtPanel.tsx",
  ].map((fileName) => readFileSync(new URL(fileName, import.meta.url), "utf8")),
].join("\n");
const threeAlignmentSource = readFileSync(
  new URL("./studio-bg3d-three-model-alignment.ts", import.meta.url),
  "utf8"
);

function centerGroundCommandSource(): string {
  const start = editorSource.indexOf("function centerAndGroundSelectedEntity()");
  const end = editorSource.indexOf("function focusSelectedEntity()", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return editorSource.slice(start, end);
}

describe("Studio BG3D model origin alignment integration", () => {
  it("measures precise rendered geometry and converts the world result to parent-local space", () => {
    const command = centerGroundCommandSource();

    expect(command).toContain("resolveStudioBg3dThreeCenterGroundLocalPosition(object)");
    expect(threeAlignmentSource).toContain("new THREE.Box3().setFromObject(object, true)");
    expect(threeAlignmentSource).toContain("centerAndGroundWorldBoundsPosition(");
    expect(threeAlignmentSource).toContain("object.parent.worldToLocal(nextLocalPosition)");
    expect(threeAlignmentSource).toContain("return result.every(Number.isFinite) ? result : null;");
  });

  it("records the command immediately before publishing either runtime collection", () => {
    const command = centerGroundCommandSource();
    const history = command.indexOf("commitImmediateHistoryTransition(");
    const primitives = command.indexOf("setPrimitives(nextPrimitives)");
    const models = command.indexOf("setCustomModels(nextCustomModels)");

    expect(history).toBeGreaterThanOrEqual(0);
    expect(primitives).toBeGreaterThan(history);
    expect(models).toBeGreaterThan(history);
  });

  it("exposes accessible actions while preventing overlap, locked edits, and pending model bounds", () => {
    expect(editorSource.match(/aria-label="원점 · 바닥 정렬"/gu)).toHaveLength(3);
    expect(editorSource).toContain("selectedEntities.length > 1");
    expect(editorSource).toContain("selectedIsLocked");
    expect(editorSource).toContain("selectedCustomModel && !readyCloneIds.has(selectedCustomModel.id)");
    expect(editorSource).toContain("원점에 객체가 겹치지 않도록 한 번에 하나만 선택하세요.");
    expect(centerGroundCommandSource()).toContain("Math.abs(value - nextLocalPosition[index]) <= 1e-6");
  });
});
