import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const pageUrl = new URL("./StudioCuttoonEditorHost.tsx", import.meta.url);
const source = readFileSync(pageUrl, "utf8");
const file = ts.createSourceFile(
  pageUrl.pathname,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
// Intentional change (2026-08, B-09): the handleSave orchestration body moved to
// studio-page-save-pipeline.ts (runStudioPageSavePipeline); the cloud-save entry
// contracts parse that function while StudioPage keeps the deps-forwarding wrapper.
const pipelineUrl = new URL("./studio-page-save-pipeline.ts", import.meta.url);
const pipelineSource = readFileSync(pipelineUrl, "utf8");
const pipelineFile = ts.createSourceFile(
  pipelineUrl.pathname,
  pipelineSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function declaredFunction(sourceFile: ts.SourceFile, name: string): string {
  let match: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!match) throw new Error(`Missing function ${name}`);
  return (match as ts.FunctionDeclaration).getText(sourceFile);
}

function nestedFunction(name: string): string {
  return name === "handleSave"
    ? declaredFunction(pipelineFile, "runStudioPageSavePipeline")
    : declaredFunction(file, name);
}

describe("Studio linked-3D cloud-save entry boundary", () => {
  it("stages a never-saved document through hidden work rather than direct create", () => {
    const save = nestedFunction("handleSave");

    expect(save).toContain('"./studio-linked-3d-new-work-cloud-save"');
    expect(save).toContain("saveStudioLinked3dNewWorkThroughCloudRoom({");
    expect(save).toContain('intent: "cloud-save"');
    expect(save).toContain("ensureStudioLinked3dPassCloudProject({");
    expect(save).toContain("createPayload: directSavePlan.payload");
    expect(save).toContain("updateWork: async (provisionalWorkId, stagedPayload, signal)");
    expect(save).toContain("promote: promoteCreatorDraftCollaborationRoom");
    expect(save).toContain("retireIdentity: retireStudioDraftCollaborationIdentity");
    expect(save).toContain("if (stagedLinkedNewWork)");
    expect(save).toContain('stagedLinkedNewWork?.outcome === "recovered-existing"');
    expect(save).toContain("withStudioLinked3dCloudSaveRecoveryState(");
    expect(save).not.toContain("const stagedPayload = { ...directSavePlan.payload, baseRevision }");
    expect(save).not.toContain("연결형 3D pass가 있는 새 작품은 cloud PNG를 먼저 결박할 작품 ID가 필요");
  });

  it("blocks linked remix hydration and saving before cloud or draft-room authority opens", () => {
    const parsedProject = source.indexOf("const parsedProject = creatorWorkSnapshotToStudioProject(w)");
    const routeRemixFence = source.indexOf("if (remixId && hasLinked3dRender)", parsedProject);
    const cloudHydration = source.indexOf("hydrateStudioLinked3dPassCloudProject({", parsedProject);
    expect(parsedProject).toBeGreaterThanOrEqual(0);
    expect(routeRemixFence).toBeGreaterThan(parsedProject);
    expect(cloudHydration).toBeGreaterThan(routeRemixFence);

    const save = nestedFunction("handleSave");
    const saveRemixFence = save.indexOf("payload.remixFromId !== undefined");
    const identityLoad = save.indexOf("let draftIdentity = draftCollaboration?.identity");
    expect(saveRemixFence).toBeGreaterThanOrEqual(0);
    expect(identityLoad).toBeGreaterThan(saveRemixFence);
  });

  it("restores retryable draft readiness when staging fails", () => {
    const save = nestedFunction("handleSave");

    expect(save).toContain('status: "provisioning"');
    expect(save).toContain('status: "error"');
    expect(save).toContain("identity: draftIdentity");
    expect(save).toContain("throw cause");
  });

  it("preserves autosave when recovering an already-promoted work", () => {
    const save = nestedFunction("handleSave");
    const recovery = save.indexOf('stagedLinkedNewWork?.outcome === "recovered-existing"');
    const clearAutosave = save.indexOf("clearAutosaveDurableAuthority()", recovery);
    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(save.slice(recovery, clearAutosave)).toContain("return;");
    expect(clearAutosave).toBeGreaterThan(recovery);
  });

  it("compensates uncommitted immutable uploads after every stale or failed save exit", () => {
    const save = nestedFunction("handleSave");
    const upload = save.indexOf("linkedCloudUploadReceipts = await ensureStudioLinked3dPassCloudProject");
    const freshness = save.indexOf("if (!saveScopeStillCurrent()) return;", upload);
    const compensation = save.lastIndexOf("compensateStudioLinked3dPassCloudUploads({");
    const saveFinally = save.lastIndexOf("} finally {");
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(freshness).toBeGreaterThan(upload);
    expect(saveFinally).toBeGreaterThan(freshness);
    expect(compensation).toBeGreaterThan(saveFinally);
    expect(save).toContain("!linkedCloudSaveCommitted");
    expect(save).toContain("linkedCloudUploadReceipts.length > 0");
    const directReceiptCheck = save.indexOf("work.id !== directSavePlan.workId");
    const committed = save.indexOf("linkedCloudSaveCommitted = true", directReceiptCheck);
    expect(directReceiptCheck).toBeGreaterThanOrEqual(0);
    expect(committed).toBeGreaterThan(directReceiptCheck);
    expect(save).toContain("staged.id !== provisionalWorkId");
  });
});
