import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/** Concatenate the BG3D editor split so source-scan tests can follow moved tokens. */
export function readStudioBg3dEditorSource(): string {
  return [
    "./StudioBackground3DTypes.ts",
    "./studio-bg3d-editor-runtime-bindings.ts",
    "./StudioBackground3D.tsx",
    "./StudioBg3dCaptureBridge.tsx",
    "./studio-bg3d-editor-host.ts",
    "./studio-bg3d-editor-session-host.ts",
    "./useStudioBg3dEditorState.ts",
    "./studio-bg3d-editor-view-model.ts",
    "./useStudioBg3dEditorEffects.ts",
    "./useStudioBg3dEditorRestoreEffects.ts",
    "./studio-bg3d-editor-scene-ops-host.ts",
    "./studio-bg3d-editor-transform-host.ts",
    "./studio-bg3d-editor-placement-host.ts",
    "./studio-bg3d-editor-lt-host.ts",
    "./studio-bg3d-editor-shot-host.ts",
    "./studio-bg3d-editor-capture-host.ts",
    "./studio-bg3d-editor-insert-host.ts",
    "./studio-bg3d-editor-generic-host.ts",
    "./studio-bg3d-editor-selection-view-model.ts",
    "./studio-bg3d-editor-layout-view-model.ts",
    "./studio-bg3d-editor-measure-host.ts",
    "./studio-bg3d-editor-physics-host.ts",
    "./studio-bg3d-editor-misc-host.ts",
    "./StudioBg3dEditorSceneGraph.tsx",
    "./StudioBg3dEditorViewport.tsx",
    "./StudioBg3dEditorSidebar.tsx",
    "./StudioBg3dEditorSidebarExtras.tsx",
    "./StudioBg3dEditorModal.tsx",
    "./useStudioBg3dEditor.ts",
  ]
    .map((rel) => readFileSync(resolve(baseDir, rel), "utf8"))
    .join("\n");
}
