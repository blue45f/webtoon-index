
import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readStudioPageCompositionSource();

function sourceBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("active stroke lifecycle integration boundary", () => {
  it("promotes and persists before destructive unmount cleanup", () => {
    const cleanup = sourceBetween(
      "runStudioDrawingUnmountLifecycle({",
      "globalThis.addEventListener(\"pagehide\""
    );

    expect(cleanup).toContain(
      "promoteActiveStroke: () => recoverActiveStrokeOnUnmountRef.current()"
    );
    expect(cleanup).toContain(
      "persistPendingStrokeEmergencyAutosaveRef.current(\"route-change\")"
    );
    expect(cleanup).toContain("cleanupDrawing: () => drawingUnmountCleanupRef.current()");
    expect(cleanup).toContain("disposePointerTransport:");
    expect(cleanup).toContain("pendingStrokeCommitsRef.current = null");
  });

  it("projects the active mark only into the local pending recovery batch", () => {
    const planner = sourceBetween(
      "function readActiveStrokeLifecycleRecovery()",
      "recoverActiveStrokeOnUnmountRef.current = () => {"
    );
    const recovery = sourceBetween(
      "recoverActiveStrokeOnUnmountRef.current = () => {",
      "drawingUnmountCleanupRef.current = () => {"
    );

    expect(planner).toContain("planStudioActiveStrokeUnmountRecovery({");
    expect(planner).toContain("stableElementIds: new Set(");
    expect(recovery).toContain('if (recovery.action !== "recover") return');
    expect(recovery).toContain("pendingStrokeCommitsRef.current = {");
    expect(recovery).not.toContain("publishStudioCrdtSceneTransition");
    expect(recovery).not.toContain("finalizeStroke");
    expect(recovery).not.toContain("commit(");
  });

  it("keeps interrupted master marks in a document-master recovery snapshot", () => {
    const planner = sourceBetween(
      "function readActiveStrokeLifecycleRecovery()",
      "recoverActiveStrokeOnUnmountRef.current = () => {"
    );
    const recovery = sourceBetween(
      "recoverActiveStrokeOnUnmountRef.current = () => {",
      "drawingUnmountCleanupRef.current = () => {"
    );

    expect(planner).toContain("const recoveringMaster = masterEditModeRef.current");
    expect(planner).toContain("pending: !recoveringMaster && existing");
    expect(recovery).toContain("lifecycleMasterStrokeRecoveryRef.current = recovery.pending.strokes.at(-1) ?? null");
    expect(source).toContain("master: durableMaster");
    expect(source).toContain("masterPendingFingerprint");
  });

  it("projects a live page or master prefix into pagehide storage without mutating the live session", () => {
    const persistence = sourceBetween(
      "persistPendingStrokeEmergencyAutosaveRef.current = (reason) => {",
      "function applyStudioProjectSnapshotWithPreparedDocuments("
    );

    expect(persistence).toContain("const activeRecovery = readActiveStrokeLifecycleRecovery()");
    expect(persistence).toContain("const effectivePendingBatch =");
    expect(persistence).toContain("const effectiveMasterStroke =");
    expect(persistence).toContain("studioActiveStrokeRecoveryFingerprint(");
    expect(persistence).toContain("pendingStrokeCommits: durableEffectivePendingBatch");
    expect(persistence).toContain("recoveredMasterStroke: effectiveMasterStroke");
    expect(persistence).not.toContain("pendingStrokeCommitsRef.current = {");
    expect(persistence).not.toContain("lifecycleMasterStrokeRecoveryRef.current =");
  });
});
