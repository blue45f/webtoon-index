import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioCuttoonEditorSource();
const studioCanvasViewportSource = readFileSync(
  new URL("./canvas/StudioCanvasViewport.tsx", import.meta.url),
  "utf8",
);
const studioCanvasStickyBannersSource = readFileSync(
  new URL("./canvas/StudioCanvasStickyBanners.tsx", import.meta.url),
  "utf8",
);
const studioCanvasModalsOverlaySource = readFileSync(
  new URL("./canvas/StudioCanvasModalsOverlay.tsx", import.meta.url),
  "utf8",
);
// 의도된 변경(2026-08, B-09): handleSave 오케스트레이션이 studio-page-save-pipeline.ts 의
// runStudioPageSavePipeline 으로 추출되어, 저장 flush/잠금 순서 계약은 그 파일을 직접 읽는다.
const savePipelineSource = readFileSync(
  new URL("./studio-page-save-pipeline.ts", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = studioPageSource.indexOf(start);
  const endIndex = studioPageSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return studioPageSource.slice(startIndex, endIndex);
}

describe("pending stroke lifecycle source contract", () => {
  it("서버 저장 잠금 전에 대기 획을 flush하고 같은 savePages로 이미지와 서버 doc 투영을 만든다", () => {
    const handleSave = savePipelineSource.slice(
      savePipelineSource.indexOf("export async function runStudioPageSavePipeline(")
    );
    const flushIndex = handleSave.indexOf("flushPendingStrokeCommitsRef.current()");
    const lockIndex = handleSave.indexOf("documentSaveInFlightRef.current = true");

    expect(flushIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThan(flushIndex);
    expect(handleSave).toContain("const savePages = saveHistory[saveHistoryIndex] ?? pages");
    expect(handleSave).toMatch(
      /const serverSavePages = projectStudioFilterMaskPagesForServerSave\(\s+savePages,/u
    );
    expect(handleSave).toContain("for (const page of savePages)");
    expect(handleSave).toContain("pagesList: serverSavePages");
    expect(handleSave).not.toContain("for (const page of pages)");
  });

  it("같은 task의 연속 commit은 render closure 대신 ref history를 전진시킨다", () => {
    const commit = sourceBetween("function commit(\n", "// 같은 key의 연속 동작이면");

    expect(commit).toContain("const currentHistory = pagesHistoryRef.current");
    expect(commit).toContain("const commitBasePages = currentHistory[currentHistoryIndex] ?? pages");
    expect(commit).toContain("appendStudioPagesHistorySnapshot(");
    expect(commit.indexOf("pagesHistoryRef.current = appended.history")).toBeLessThan(
      commit.indexOf("setPagesHistory(appended.history)")
    );
    expect(commit.indexOf("pagesHiRef.current = appended.historyIndex")).toBeLessThan(
      commit.indexOf("setPagesHi(appended.historyIndex)")
    );
  });

  it("같은 task의 coalesced 입력도 최신 ref snapshot을 교체하고 journal을 단조 전진시킨다", () => {
    const commitCoalesced = sourceBetween(
      "function commitCoalesced(",
      "// 커밋 지연 파이프라인의 동기화/폐기"
    );

    expect(commitCoalesced).toContain("const currentHistory = pagesHistoryRef.current");
    expect(commitCoalesced).toContain("const commitBasePages = currentHistory[currentHistoryIndex] ?? pages");
    expect(commitCoalesced).toContain("previousHistoryIndex: currentHistoryIndex");
    expect(commitCoalesced).toContain("nextHistoryIndex,");
    expect(commitCoalesced).not.toContain("const localNextPages = pages.map");
    expect(commitCoalesced.indexOf("pagesHistoryRef.current = nextHistory")).toBeLessThan(
      commitCoalesced.indexOf("setPagesHistory(nextHistory)")
    );
    expect(commitCoalesced.indexOf("pagesHiRef.current = nextHistoryIndex")).toBeLessThan(
      commitCoalesced.indexOf("setPagesHi(nextHistoryIndex)")
    );
  });

  it("원격 CRDT·승인 자산 재조정은 state updater 밖에서 history ref와 journal을 함께 rebase한다", () => {
    const admission = sourceBetween(
      "studioWorkAssetAdmissionCoordinator.sync({",
      "const observeSceneElements = ("
    );
    const remoteFrontier = sourceBetween(
      "const applyFrontier = (",
      "applyFrontier({"
    );
    const hydratedAssets = sourceBetween(
      "const referenceSources = readyStudioWorkAssetImageSources(studioWorkAssetHydrator);",
      "// useCallback: 렌더 중 호출되는 메시지 헬퍼"
    );

    // Intentional change: the admission block moved into live/studio-collaboration-wiring, where the
    // authority-ref write happens through a module helper (react-compiler forbids mutating injected
    // hook-argument refs inside effect scope). The ref-before-state contract is unchanged.
    expect(admission).toContain("commitStudioWorkAssetAdmittedHistory(pagesHistoryRef, admitted.history)");
    expect(admission).toContain("rebaseStudioHistoryJournal(");
    expect(remoteFrontier).toContain("const currentHistory = pagesHistoryRef.current");
    expect(remoteFrontier).toContain("pagesHistoryRef.current = reconciled.history");
    expect(remoteFrontier).toContain('"remote CRDT reconciliation"');
    expect(remoteFrontier).not.toContain("setPagesHistoryState((history)");
    expect(hydratedAssets).toContain("const currentHistory = pagesHistoryRef.current");
    expect(hydratedAssets).toContain("pagesHistoryRef.current = reconciled.history");
    expect(hydratedAssets).toContain('"work asset hydration reconciliation"');
    expect(hydratedAssets).not.toContain("setPagesHistoryState((history)");
  });

  it("비동기 journal client는 Studio effect 수명에 묶여 Strict Mode 재설정과 실제 unmount를 처리한다", () => {
    // rebaseStudioHistoryJournal 은 이제 useCallback 이다 — React Compiler 가 이 훅을 `??=`
    // 에서 통째로 bail out 하므로 함수 선언으로 두면 렌더마다 새 정체성이 되고, 그 값을 의존성에
    // 담은 CRDT frontier layout effect 가 매 렌더 재실행되어 React #185 로 에디터가 무너졌다.
    const journalSetup = sourceBetween(
      "const pagesHistoryCommandJournalRef = useRef",
      "const rebaseStudioHistoryJournal = useCallback("
    );

    expect(journalSetup).toContain("createStudioPageHistoryCommandJournalClient()");
    expect(journalSetup).toMatch(/use(?:Layout)?Effect\(\(\) =>/);
    expect(journalSetup).toContain("client?.dispose()");
    expect(journalSetup).toContain("pagesHistoryCommandJournalRef.current = null");
  });

  it("route/page lifecycle은 안정 상태와 대기 획을 내구 저장소에만 요청한다", () => {
    const persistence = sourceBetween(
      "persistPendingStrokeEmergencyAutosaveRef.current = (reason) =>",
      "function applyStudioProjectSnapshotWithPreparedDocuments"
    );

    expect(persistence).toContain("hasDirtyStableState");
    expect(persistence).toContain("hasDirtyPendingState");
    expect(persistence).toContain("receiptEligiblePendingStrokes");
    expect(persistence).toContain("hasExactSelectedGpuFinalReceipt(stroke.id)");
    expect(persistence).toContain("pending: durableEffectivePendingBatch");
    expect(persistence).toContain("createStudioLifecycleEmergencyAutosave");
    expect(persistence).not.toContain("writeStudioLifecycleAutosave");
    expect(persistence).not.toContain("localStorage.setItem");
    expect(persistence).toContain("Promise.any(durableWrites)");
    expect(persistence).toContain("reportStudioAutosaveFailure(cause)");
  });

  it("포인터업 task 안에서 이탈 가드를 무장하고 다음 navigation task 전에 내구 저장을 시작한다", () => {
    const queue = sourceBetween(
      "function queueDeferredStrokeCommit(finished: DrawEl)",
      "const scheduleMarqueeRect =",
    );

    expect(queue).toContain("setUnloadGuardArmed(true)");
    expect(queue).toContain("globalThis.queueMicrotask(() => {");
    expect(queue).toContain("selectedGpuStrokeRequiresFinalReceipt(finished.id)");
    expect(queue).toContain("!hasExactSelectedGpuFinalReceipt(finished.id)");
    expect(queue).toContain('persistPendingStrokeEmergencyAutosaveRef.current("pointerup")');
    expect(queue.indexOf("setUnloadGuardArmed(true)")).toBeLessThan(
      queue.indexOf("globalThis.queueMicrotask(() => {")
    );
  });

  it("복구 탐지 전 primary를 보존하고 교차 페이지 입력은 성공한 flush 뒤에만 허용한다", () => {
    // 984251d8c 이후 페이지 선택 게이트는 호스트 안에서 useCallback 형태로 남았다.
    const pageSelection = sourceBetween(
      "const setCurrentPageId = useCallback((next:",
      "setCurrentPageIdState(nextPageId);"
    );
    const drawingStart = sourceBetween(
      "if (tool === \"draw\")",
      "// A CRDT stroke has its own conflict-free operation stream"
    );
    const flushPipeline = sourceBetween(
      "flushPendingStrokeCommitsRef.current = () =>",
      "discardPendingStrokeCommitsRef.current = () =>"
    );
    const pageCommit = sourceBetween(
      "function commitPages(\n",
      "function patchPageReview"
    );

    expect(pageSelection).toContain("pendingBatch.pageId !== nextPageId");
    expect(pageSelection).toContain("!flushPendingStrokeCommitsRef.current()");
    expect(pageSelection).toContain("drawingRef.current || requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()");
    expect(studioCanvasViewportSource).toContain("<StudioCanvasViewportHudOverlays");
    expect(studioCanvasStickyBannersSource).toContain("if (!setCurrentPageId(pageId)) return;");
    expect(studioCanvasModalsOverlaySource).toContain("if (!setCurrentPageId(pageId)) return;");
    expect(drawingStart).toContain("pendingBatch.pageId !== activePage.id");
    expect(drawingStart).toContain("!flushPendingStrokeCommitsRef.current()");
    expect(flushPipeline).toContain("return false");
    expect(flushPipeline).toContain("return true");
    expect(flushPipeline).toContain(
      "pendingBatchAwaitsSelectedGpuFinalReceipt(pendingBeforeReceiptGate)",
    );
    expect(flushPipeline.indexOf("pendingBatchAwaitsSelectedGpuFinalReceipt"))
      .toBeLessThan(flushPipeline.indexOf("takePendingStrokeCommits()"));
    expect(pageCommit).toContain("pendingBatch && !flushPendingStrokeCommitsRef.current()");
    expect(pageCommit).toContain("options.pendingStrokePolicy !== \"drop\"");
    expect(pageCommit).toContain("projectStudioPendingStrokes(nextPages");
    expect(pageCommit).toContain("const currentHistory = pagesHistoryRef.current");
    expect(pageCommit).toContain("drawingRef.current || requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()");
  });

  it("복구와 프로젝트 교체는 활성·대기 획을 문서 경계 너머로 운반하지 않는다", () => {
    // Intentional change (2026-08, B-17): restoreAutosave's body moved to
    // studio-page-autosave-runtime.ts; the composed editor surface still carries it verbatim.
    const restore = sourceBetween(
      "export async function restoreStudioAutosaveRecovery(",
      "export interface StudioAutosaveDurableAuthorityContext"
    );
    // ctx 구조 분해는 알파벳 순이라 실행 순서가 아니다 — 본문부터 센다.
    const restoreBody = restore.slice(restore.indexOf("} = ctx;"));
    const replacement = sourceBetween(
      "function applyStudioProjectSnapshotWithPreparedDocuments",
      "async function applyStudioProjectSnapshot("
    );

    expect(restoreBody.indexOf("prepareStudioDocumentReplacement")).toBeLessThan(
      restoreBody.indexOf("captureStudioMutationTicket")
    );
    expect(restore).toContain("requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()");
    expect(restore).toContain("pendingStrokeCommitsRef.current");
    expect(restore).toContain("pagesHistoryRef.current = [restoredPages]");
    expect(replacement).toContain('prepareStudioDocumentReplacement("프로젝트를 교체")');
    expect(replacement).toContain("const currentHistory = pagesHistoryRef.current");
    expect(replacement).toContain("appendStudioPagesHistorySnapshot(");
    expect(replacement.indexOf("pagesHistoryRef.current = appended.history")).toBeLessThan(
      replacement.indexOf("setPagesHistory(appended.history)")
    );
  });
});
