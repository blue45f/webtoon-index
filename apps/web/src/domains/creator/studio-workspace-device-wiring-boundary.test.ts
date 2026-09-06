import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  STUDIO_WORKSPACE_DEVICE_KINDS,
  listStudioWorkspaces,
  resolveStudioWorkspaceDeviceLayout,
  type StudioWorkspaceState,
} from "./studio-workspaces";


function studioPageSource(): string {
  return readStudioCuttoonEditorSource();
}

/**
 * Device overrides shipped as a model, a migration and twelve curated profiles before anything
 * called them, so every artist on a pen display got desktop docks and no test failed. A model with
 * no consumer is indistinguishable from a deleted feature at runtime, which is what these assert.
 */
describe("workspace device overrides reach the studio", () => {
  it("resolves the presented layout when a workspace is applied", () => {
    const source = studioPageSource();
    expect(source).toContain("resolveStudioWorkspaceDeviceLayout(layout, deviceKind)");
    // The docks must be seeded from the resolved layout, not from the authored one beside it.
    expect(source).toContain("setLeftPanelOpenWithOverride(presented.desktop.leftPanelOpen)");
    expect(source).toContain("setRightPanelOpenWithOverride(presented.desktop.rightPanelOpen)");
    expect(source).toContain("leftResizeSetWidthRef.current(presented.desktop.leftPanelWidth)");
    expect(source).toContain("rightResizeSetWidthRef.current(presented.desktop.rightPanelWidth)");
  });

  it("feeds the resolved handedness to the on-canvas controls, not the raw preference", () => {
    const source = studioPageSource();
    expect(source).toContain("resolveStudioWorkspaceControlSide(");
    expect(source).toContain("handedness={workspaceControlSide === \"left\" ? \"left\" : \"right\"}");
    // The raw preference reaching a control surface again would silently retire the override.
    expect(source).not.toContain("handedness={workspaceState.mobileControlSide");
  });

  it("persists what the artist sees without rewriting the authored profile", () => {
    // Autosave feeds `updateStudioWorkspaceLiveLayout`, which touches liveLayout alone. If a device
    // resolution ever reached the workspace snapshot instead, a pen-display session would rewrite
    // the profile the artist authored on a desktop.
    const source = studioPageSource();
    expect(source).toContain(
      "updateStudioWorkspaceLiveLayout(workspacePersistence.state, nextLayout)",
    );
    expect(source).toContain("persistStudioWorkspaceStateFromEffect(");
    expect(source).not.toContain("resolveStudioWorkspaceDeviceLayout(nextLayout");
  });

  it("folds the screen's geometry back to authored form before it is stored", () => {
    // The device-resolved geometry must not reach `liveLayout.desktop`: it is shared by every
    // surface and by the menu's save buttons, so one phone visit would otherwise collapse the
    // desktop docks for good. Both assembly sites — the memo the menu reads and the autosave
    // effect — have to de-resolve. The behavioural proof lives in
    // studio-workspace-authored-layout-boundary.test.ts; this only guards the call sites.
    const source = studioPageSource();
    expect(source.match(/captureStudioWorkspaceDeviceLayout\(/g) ?? []).toHaveLength(2);
  });
});

describe("every default profile answers for every device", () => {
  const state = { customWorkspaces: [] } as unknown as StudioWorkspaceState;

  it("returns a usable layout for each profile and device pair", () => {
    const profiles = listStudioWorkspaces(state);
    expect(profiles.length).toBeGreaterThanOrEqual(12);
    for (const profile of profiles) {
      for (const device of STUDIO_WORKSPACE_DEVICE_KINDS) {
        const resolved = resolveStudioWorkspaceDeviceLayout(profile.layout, device);
        expect(resolved.desktop.leftPanelWidth).toBeGreaterThan(0);
        expect(resolved.desktop.rightPanelWidth).toBeGreaterThan(0);
      }
      // No device argument is the desktop default and must never alter the authored geometry.
      expect(resolveStudioWorkspaceDeviceLayout(profile.layout, null).desktop)
        .toEqual(profile.layout.desktop);
    }
  });
});
