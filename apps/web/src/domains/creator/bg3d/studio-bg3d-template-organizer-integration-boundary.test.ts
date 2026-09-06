import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

const sceneOpsSource = source("./studio-bg3d-editor-scene-ops-host.ts");
const placementSource = source("./studio-bg3d-editor-placement-host.ts");
const transformSource = source("./studio-bg3d-editor-transform-host.ts");
const sidebarSource = source("./StudioBg3dEditorSidebar.tsx");
const effectsSource = source("./useStudioBg3dEditorEffects.ts");
const runtimeBindingsSource = source("./studio-bg3d-editor-runtime-bindings.ts");
const organizerRuntimeSource = source("./studio-bg3d-template-organizer-runtime.ts");

function expectInOrder(value: string, markers: readonly string[]): void {
  let cursor = -1;
  for (const marker of markers) {
    const next = value.indexOf(marker, cursor + 1);
    expect(next, marker).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("Studio BG3D template organizer integration boundary", () => {
  it("tags and selects every built-in scene-template node as one instance", () => {
    const start = sceneOpsSource.indexOf("const addSceneTemplate = (templateId: string) =>");
    const end = sceneOpsSource.indexOf("const addRoomBuild = () =>", start);
    const addTemplate = sceneOpsSource.slice(start, end);

    expectInOrder(addTemplate, [
      "instantiateSceneTemplate(template, live.primitives.length)",
      "allocateStudioBg3dTemplateInstanceNodeIds({",
      'sourceKind: "catalog"',
      "const parts = rawParts.map",
      "physicsRuntimeSourceRef.current =",
      "setSelectedIds(new Set(allocation.nodeIds))",
    ]);
  });

  it("tags user-template nodes before hydration and selects the complete committed group", () => {
    const start = placementSource.indexOf("async function applyUserTemplate(");
    const end = placementSource.indexOf("h.applyUserTemplate = applyUserTemplate", start);
    const applyTemplate = placementSource.slice(start, end);

    expectInOrder(applyTemplate, [
      "const templateInstanceAllocation = allocateStudioBg3dTemplateInstanceNodeIds({",
      'sourceKind: "user"',
      "instantiateBg3dTemplateDocument(",
      "hydrateStudioBg3dDocumentToRuntime({",
      "orderStudioBg3dHierarchySelectionRootsFirst(insertedEntities)",
    ]);
  });

  it("commits arrange, reset, and delete as atomic history transitions", () => {
    const organizerHost = sceneOpsSource.slice(
      sceneOpsSource.indexOf("const templateInstances = collectStudioBg3dTemplateInstances"),
      sceneOpsSource.indexOf("// Refs shared across hosts"),
    );

    expect(organizerHost).toContain('import("./studio-bg3d-template-organizer-runtime")');
    expect(organizerRuntimeSource).toContain("planStudioBg3dTemplateInstanceArrangement({");
    expect(organizerRuntimeSource).toContain("h.readStudioBg3dTemplateNodeWorldBounds(node.id)");
    expect(organizerHost).toContain("h.readStudioBg3dTemplateNodeWorldBounds = (nodeId: string)");
    expect(organizerHost).toContain("readStudioBg3dTemplateStaticModelWorldBounds(");
    expect(organizerRuntimeSource).toContain("planStudioBg3dTemplateInstanceReset({");
    expect(organizerRuntimeSource).toContain("planStudioBg3dSceneEntityRemoval({");
    expect(organizerRuntimeSource.match(/commitImmediateHistoryTransition\(/gu)).toHaveLength(3);
    expect(organizerRuntimeSource.match(/physicsRuntimeSourceRef\.current =/gu)).toHaveLength(2);
    expect(organizerRuntimeSource).toContain("commitSceneEntityRemoval(plan)");
    expect(organizerHost).toContain("membershipInstanceIds: Object.freeze(");
    expect(organizerHost).toContain("sceneEpoch: ltInsertSceneEpochRef.current");
    expect(organizerRuntimeSource).toContain("requestOwnsCurrentSession(h, request)");
    expect(organizerRuntimeSource).toContain("requestMatchesCurrentScene(h, request)");
  });

  it("keeps hierarchy transforms and duplicates root-driven with remapped provenance", () => {
    const duplicate = sceneOpsSource.slice(
      sceneOpsSource.indexOf("const duplicateSelected = () =>"),
      sceneOpsSource.indexOf("h.duplicateSelected = duplicateSelected"),
    );

    expect(placementSource).toContain("orderStudioBg3dHierarchySelectionRootsFirst(insertedEntities)");
    expect(transformSource).toContain("hasStudioBg3dSelectedAncestor(");
    expect(transformSource).toContain("(ancestor) => !isBgObjectTransformBlocked(ancestor)");
    expect(transformSource).toContain("p.id !== firstSelectedId && hasSelectedTransformDriverAncestor(p)");
    expect(transformSource).toContain("m.id !== firstSelectedId && hasSelectedTransformDriverAncestor(m)");
    expect(duplicate).toContain("allocateStudioBg3dTemplateInstanceNodeIds({");
    expect(duplicate).toContain("instance.baselineOffset[0] + 0.4");
    expect(duplicate).toContain("instance.baselineOffset[2] + 0.4");
    expect(duplicate).toContain("taggedCloneIdBySourceId");
    expect(duplicate).toContain("resolveStudioBg3dDuplicateHierarchyPatch({ source, clone, cloneIdBySourceId })");
  });

  it("wires the dedicated organizer through the existing template panel only", () => {
    expect(sidebarSource).toContain("templates={BG_SCENE_TEMPLATES}");
    expect(sidebarSource).toContain("templateCategories={BG_SCENE_TEMPLATE_CATEGORIES}");
    expect(sidebarSource).toContain("compositePresets={COMPOSITE_PRESETS}");
    expect(sidebarSource).toContain("templateInstances={h.templateInstanceSummaries}");
    expect(sidebarSource).toContain("onArrangeAllTemplateInstances={h.arrangeAllTemplateInstances}");
    expect(sidebarSource).toContain("onResetAllTemplateInstances={h.resetAllTemplateInstances}");
    expect(sidebarSource).toContain("onDeleteAllTemplateInstances={h.deleteAllTemplateInstances}");
  });

  it("keeps the template surface out of initial BG3D activation until its tab opens", () => {
    expect(runtimeBindingsSource).not.toContain(
      'export { StudioBg3dSceneTemplatePanel } from "./StudioBg3dSceneTemplatePanel"',
    );
    expect(runtimeBindingsSource).toContain(
      'import("./StudioBg3dSceneTemplatePanel")',
    );
    expect(sidebarSource).toContain('activePanelTab === "templates" ? (');
    expect(sidebarSource).toContain("<Suspense fallback={(");
    expect(sceneOpsSource).toContain('import("./studio-bg3d-template-organizer-runtime")');
  });

  it("hydrates user-template labels when either the Models or Templates tab owns the surface", () => {
    expect(effectsSource).toContain(
      'if (!open || (!modelsPanelActivated && activePanelTab !== "templates")) return;',
    );
    expect(effectsSource).toContain(
      "[activePanelTab, modelsPanelActivated, open, setTemplateLibrary, setTemplateLibraryStatus]",
    );
  });
});
