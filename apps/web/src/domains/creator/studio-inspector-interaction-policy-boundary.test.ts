import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";

const inspectorSource = readStudioInspectorAsideSurface();
const utilitySource = readFileSync(
  new URL("./StudioInspectorUtilityPanels.tsx", import.meta.url),
  "utf8",
);

describe("StudioInspectorAside interaction policy boundary", () => {
  it("gives the active drawing tool priority over a preserved element selection", () => {
    expect(inspectorSource).toContain(
      "resolveStudioInspectorContentMode({",
    );
    expect(inspectorSource).toContain(
      'inspectorContentMode === "drawing"',
    );
    expect(inspectorSource).toContain(
      'inspectorContentMode === "selection" && selected',
    );
    expect(inspectorSource).not.toContain(
      'selected === null && tool === "draw"',
    );
    expect(inspectorSource).toContain(
      "hasSelection: selected !== null || marqueeIds.length > 0",
    );
  });

  it("semantically disables selected mutations while exposing a separate escape action", () => {
    expect(inspectorSource).toContain(
      "disabled={inspectorInteractionPolicy.selection.disabled}",
    );
    expect(utilitySource).toContain(
      'data-studio-inspector-emergency-exit="true"',
    );
    expect(inspectorSource).toContain(
      "onExit={disarmAllPixelTools}",
    );
  });

  it("aligns page, layer and publish controls with the actual document mutation guard", () => {
    expect(inspectorSource).toContain(
      "gate={inspectorInteractionPolicy.page}",
    );
    expect(utilitySource).toContain(
      "disabled={gate.disabled}",
    );
    expect(inspectorSource).toContain(
      "readOnly={inspectorInteractionPolicy.global.disabled}",
    );
    expect(inspectorSource).toContain("<StudioInspectorPublishPanel");
    expect(utilitySource).toContain("readOnly={readOnly}");
    expect(inspectorSource).toContain(
      "const drawingAssistControlsDisabled = inspectorInteractionPolicy.page.disabled",
    );
  });
});
