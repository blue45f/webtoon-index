import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const pageSource = readStudioPageCompositionSource();
const menuSource = readFileSync(
  new URL("./StudioWorkspaceMenu.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string, label: string): string {
  const startIndex = pageSource.indexOf(start);
  const endIndex = pageSource.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Missing ${label}: ${start} -> ${end}`);
  }
  return pageSource.slice(startIndex, endIndex);
}

describe("V5 specialist workspace product launch boundary", () => {
  it("carries the selected workspace identity through every menu apply action", () => {
    const calls = menuSource.match(/onApplyLayout\([^;]+\);/gu) ?? [];
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call).toContain("next.activeWorkspaceId");
    }
  });

  it("launches production vector, animation, and pose surfaces from the workspace apply path", () => {
    // Intentional change (B-08 extraction): the persistence cluster (and its
    // applyStudioWorkspaceLayoutFromEffect wrapper) moved to
    // studio-page-workspace-persistence.ts, so the apply block in StudioPage now
    // ends at the extracted hook's call site.
    const apply = sourceBetween(
      "function applyStudioWorkspaceLayout(",
      "useStudioPageWorkspacePersistence(",
      "workspace apply function",
    );
    expect(apply).toContain("workspaceId?: StudioWorkspaceId");
    expect(apply).toContain("applyStudioWorkspaceLaunchSurface(workspaceId)");

    const launch = sourceBetween(
      "function applyStudioWorkspaceLaunchSurface(",
      "const initialWorkspaceLaunchId",
      "specialist launch function",
    );
    expect(launch).toContain('case "vector-design"');
    expect(launch).toContain('activatePrimaryCanvasTool("draw", "shape")');
    expect(launch).toContain('openInspectorRoute({ primary: "layers", image: "transform" })');
    expect(launch).toContain('case "animation"');
    expect(launch).toContain("setTimelinePlaying(false)");
    expect(launch).toContain("setTimelineOpen(true)");
    expect(launch).toContain("enabled: true");
    expect(launch).toContain('case "pose-3d"');
    expect(launch).toContain("setMannequinPoserOpen(true)");
  });

  it("reopens a persisted specialist workspace after initial hydration", () => {
    const initialLaunch = sourceBetween(
      "const initialWorkspaceLaunchId",
      "const [pageSequenceOpen",
      "initial specialist launch",
    );
    expect(initialLaunch).toContain("workspaceState.activeWorkspaceId");
    expect(initialLaunch).toContain(
      "applyInitialStudioWorkspaceLaunch(initialWorkspaceLaunchId)",
    );
  });
});
