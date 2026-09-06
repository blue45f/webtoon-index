import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Studio UX convergence boundary", () => {
  it("mounts one global workspace navigator and exposes root preference data", () => {
    const view = source(
      "apps/web/src/domains/creator/studio-cuttoon-editor/StudioCuttoonEditorView.tsx",
    );
    expect(view).toContain('import { StudioWorkspaceNavigator } from "../StudioWorkspaceNavigator";');
    expect(view.match(/<StudioWorkspaceNavigator\s*\/>/gu)).toHaveLength(1);
    expect(view).toContain('id="studio-app-shell"');
    expect(view).toContain("data-studio-ui-density={uiDensityMode}");
    expect(view).toContain("data-studio-reduce-motion=");
    expect(view).toContain("data-studio-device-kind=");
  });

  it("gives every major workspace region a stable focus landmark", () => {
    const chrome = source("apps/web/src/domains/creator/studio-chrome-ui.tsx");
    const workspace = source(
      "apps/web/src/domains/creator/studio-cuttoon-editor/StudioCuttoonEditorWorkspace.tsx",
    );
    const canvas = source(
      "apps/web/src/domains/creator/studio-cuttoon-editor/StudioCuttoonEditorCanvasColumn.tsx",
    );
    const inspector = source(
      "apps/web/src/domains/creator/StudioInspectorAsideShell.tsx",
    );

    expect(chrome).toContain('id = "studio-menubar"');
    expect(chrome).toContain('id = "studio-tool-belt"');
    expect(chrome).toContain('id = "studio-tool-rail"');
    expect(chrome).toContain('id = "studio-status-bar"');
    expect(workspace).toContain('id="studio-workspace"');
    expect(canvas).toContain('id="studio-canvas-workspace"');
    expect(inspector).toContain('id="studio-inspector"');
  });

  it("keeps legacy empty states on the unified state primitive", () => {
    const panelUi = source("apps/web/src/domains/creator/studio-panel-ui.tsx");
    expect(panelUi).toContain('import { StudioSurfaceState } from "./StudioSurfaceState";');
    expect(panelUi).toContain('<StudioSurfaceState\n      state="empty"');
  });

  it("upgrades the overloaded project sheet into a searchable grouped center", () => {
    const menubar = source("apps/web/src/domains/creator/StudioMenubarContent.tsx");
    expect(menubar).toContain("StudioProjectCenterSearch");
    expect(menubar).toContain("StudioProjectCenterSection");
    expect(menubar).toContain('aria-label="프로젝트 센터"');
    expect(menubar).toContain("기획 · 제작");
    expect(menubar).toContain("버전 · 가져오기");
    expect(menubar).toContain("연출 · 게시 · 검수");
  });
});
