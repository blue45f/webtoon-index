import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

/**
 * The floating "크리에이티브 모드" pill sat on top of the mobile editing dock and
 * stole pointer hits. Those tools now live on the menubar (그리기 / 캔버스 / 3D /
 * 협업) so the dock stays reachable and URL-backed 3D sculpt / brush surfaces
 * own the same jobs.
 */
const editorSource = readStudioCuttoonEditorSource();
const brushMenu = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-main-menu-items-brush.ts"),
  "utf8",
);
const canvasMenu = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-main-menu-items-authoring.ts"),
  "utf8",
);
const storyMenu = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-main-menu-items-story.ts"),
  "utf8",
);
const collabMenu = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/studio-main-menu-items-collaboration.ts"),
  "utf8",
);

describe("Studio creative modes surface", () => {
  it("does not mount a dock-covering floating launcher", () => {
    expect(editorSource).not.toContain('data-studio-creative-modes-trigger="true"');
    expect(editorSource).not.toContain('data-studio-creative-modes-panel="true"');
  });

  it("places former creative-mode tools on the matching menubar groups", () => {
    expect(brushMenu).toContain('commandId: "brush.pixel-art"');
    expect(brushMenu).toContain("픽셀 아트");
    expect(brushMenu).toContain('commandId: "brush.silk-flow"');
    expect(brushMenu).toContain("실크 대칭");
    expect(canvasMenu).toContain('commandId: "canvas.sticky-note"');
    expect(canvasMenu).toContain("스티키 노트");
    expect(storyMenu).toContain('commandId: "insert.sculpt-3d"');
    expect(storyMenu).toContain("3D 스컬프트…");
    expect(collabMenu).toContain('commandId: "collaboration.ephemeral-board"');
    expect(collabMenu).toContain("빠른 화이트보드…");
  });
});
