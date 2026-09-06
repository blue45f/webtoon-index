
import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource, readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioPageCompositionSource();
const editorSource = readStudioCuttoonEditorSource();

function sourceBetween(start: string, end: string): string {
  const startIndex = studioPageSource.indexOf(start);
  const endIndex = studioPageSource.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
  return studioPageSource.slice(startIndex, endIndex);
}

describe("continuous drawing selection boundary", () => {
  it("does not reopen the properties inspector when a deferred stroke settles", () => {
    const deferredFlush = sourceBetween(
      "flushPendingStrokeCommitsRef.current = () => {",
      "discardPendingStrokeCommitsRef.current = () => {"
    );

    expect(deferredFlush).toContain("queueCommittedStrokeSurfaceHandoff");
    expect(deferredFlush).not.toContain("setSelectedId(");
    expect(deferredFlush).not.toContain('openInspectorRoute({ primary: "properties" }');
  });

  it("keeps pen and shape tools in continuous drawing context after pointerup", () => {
    const start = "const finished = releasePlan.stroke;";
    const end = "if (releasePlan.quickShapeAnnouncementKind)";
    const startIndex = editorSource.indexOf(start);
    const endIndex = editorSource.indexOf(end, startIndex + start.length);
    expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
    expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
    const pointerRelease = editorSource.slice(startIndex, endIndex);

    expect(pointerRelease).not.toContain("requestAnimationFrame");
    expect(pointerRelease).not.toContain("setSelectedId(");
    expect(studioPageSource).not.toContain("openCompletedStrokeProperties");
    expect(editorSource).not.toContain("openCompletedStrokeProperties");
  });
});
