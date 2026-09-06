import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function expectTokenOrder(value: string, tokens: readonly string[]): void {
  let cursor = -1;
  for (const token of tokens) {
    const index = value.indexOf(token, cursor + 1);
    expect(index, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("studio save payload ownership boundary", () => {
  it("keeps the leaf pure and separate from publish/compliance validation", () => {
    const payload = source("./studio-save-payload.ts");

    expect(payload).not.toMatch(/from\s+["']react["']/u);
    expect(payload).not.toMatch(/studio-publish-(?:preflight|compliance)/u);
    expect(payload).not.toMatch(
      /\b(?:fetch|Blob|File|localStorage|AbortController|AbortSignal)\b|\bapi\s*\./u,
    );
    expect(payload).not.toMatch(
      /\b(?:createWork|updateWork|updateStudioSharedDocument|assertStudioApiJsonPayloadSize)\s*\(/u,
    );
    expect(payload).not.toMatch(
      /authoritativeSaveBarrier|studioCrdt|\b(?:toast|setError|setSaving)\b/iu,
    );
    expect(payload.split("\n").length).toBeLessThanOrEqual(200);
  });

  it("keeps capture, freshness, transport, CRDT, and cleanup ordering in the save pipeline", () => {
    const page = source("./StudioCuttoonEditorHost.tsx");
    // Intentional change (2026-08, B-09): the handleSave orchestration moved to
    // studio-page-save-pipeline.ts; StudioPage keeps only the deps-forwarding
    // wrapper, so the ordering contract reads the extracted pipeline function.
    const pipeline = source("./studio-page-save-pipeline.ts");
    const lazyRegistry = source("./studio-page-lazy-ui.ts");
    const saveStart = pipeline.indexOf("export async function runStudioPageSavePipeline(");
    expect(saveStart).toBeGreaterThanOrEqual(0);
    const save = pipeline.slice(saveStart);

    expect(page).not.toContain('from "./studio-save-payload"');
    expect(pipeline).not.toContain('from "./studio-save-payload"');
    expect(page).toContain('await runStudioPageSavePipeline(status, {');
    expect(lazyRegistry.match(/import\("\.\/studio-save-payload"\)/gu)).toHaveLength(1);
    expect(save).toContain("await loadStudioSavePayloadRuntime()");
    expect(save).toContain("validateStudioPublishPreflight(");
    expect(save).toContain("publishComplianceResult.readyForDestinationReview");
    expect(save).toContain("new AbortController()");
    expect(save).toContain("await authoritativeSaveBarrier(10_000)");
    expect(save).toContain("await captureReadyStageForPage(page)");
    expect(save).toContain("await downscaleStudioCanvasDataUrl(pageImages[0] || \"\", 480)");
    expect(save).toContain("await updateStudioSharedDocument(");
    expect(save).toContain("await updateWork(");
    expect(save).toContain("await createWork(");
    expect(save).toContain("localStorage.removeItem(autosaveKey)");
    expect(save).toContain("finally {");
    expect(save).not.toMatch(/tagsText\s*\.split/u);

    expectTokenOrder(save, [
      "validateStudioPublishPreflight(",
      "sharedDocumentSaveAbortRef.current?.abort()",
      "await authoritativeSaveBarrier(10_000)",
      "await captureReadyStageForPage(page)",
      "await downscaleStudioCanvasDataUrl(pageImages[0] || \"\", 480)",
      "await loadStudioSavePayloadRuntime()",
      "buildStudioSavePayload({",
    ]);

    const sharedTransport = save.slice(save.indexOf("if (workId && sharedDocument)"));
    expectTokenOrder(sharedTransport, [
      'await import("./studio-shared-document-client")',
      "!saveScopeStillCurrent()",
      "authoritativeCrdtServerSequence === null",
      "buildStudioSharedSavePatch({",
      "assertStudioApiJsonPayloadSize(sharedPatch)",
      "await updateStudioSharedDocument(",
      "!isStudioSharedDocumentScopeCurrent(",
    ]);

    const directTransport = save.slice(
      save.indexOf('await import("@/src/infrastructure/creator-client")'),
    );
    expectTokenOrder(directTransport, [
      'await import("@/src/infrastructure/creator-client")',
      "!saveScopeStillCurrent()",
      "buildStudioDirectWorkSavePlan({",
      'if (directSavePlan.kind === "update")',
      "assertStudioApiJsonPayloadSize(directSavePlan.payload)",
      "await updateWork(",
    ]);

    expectTokenOrder(save, [
      "if (!canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })) {",
      "localStorage.removeItem(autosaveKey)",
      "navigate(`/create/${savedWorkId}`)",
      "catch (err)",
      "finally {",
      "documentSaveInFlightRef.current = false",
    ]);
  });
});
