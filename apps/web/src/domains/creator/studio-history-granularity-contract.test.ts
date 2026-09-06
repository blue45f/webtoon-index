/**
 * 히스토리 신뢰 계약 — "⌘Z 한 번이 무엇을 되돌리는가"의 소스 계약.
 *
 * 브라우저 감사에서 셋이 함께 나왔다.
 *  E. 250ms 미만 간격의 획 3개가 undo 한 단계로 뭉쳐 통째로 사라졌다(해칭 전멸).
 *  B. 복구 배너의 "비우기"가 확인 없이 유일한 복구본을 영구 삭제했다.
 *  G. 캐릭터 바이블·Writer Room 편집 뒤의 ⌘Z 가 화면 밖 캔버스 획을 지웠다.
 *
 * 셋 다 "사용자가 만진 것과 다른 대상이 사라진다"는 같은 실패다. 여기서는 그 세 경로가
 * 다시 뒤집히지 않도록 StudioPage 의 해당 구간을 소스로 고정한다.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource, readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioPageCompositionSource();
// Intentional change: the deferred-stroke commit engine (commit/commitCoalesced/
// expandDeferredStrokeCommitHistory/commitPages) moved into
// studio-cuttoon-editor/studio-deferred-stroke-commit.ts. Slices that start at an extracted
// symbol scan the composed editor surface; the contract itself is unchanged.
const studioEditorSource = readStudioCuttoonEditorSource();
// Intentional change (2026-08, B-17): restoreAutosave/clearAutosave bodies moved to
// studio-page-autosave-runtime.ts (StudioPage keeps thin same-named wrappers). The guard,
// approval-seam and journal-reset contracts below are unchanged — only the file they live in.
const autosaveRuntimeSource = readFileSync(
  new URL("./studio-page-autosave-runtime.ts", import.meta.url),
  "utf8",
);
const catalogSource = readFileSync(
  new URL("./studio-destructive-command-catalog.ts", import.meta.url),
  "utf8",
);
const statusRailSource = readFileSync(
  new URL("./canvas/StudioCanvasStatusRail.tsx", import.meta.url),
  "utf8",
);

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function sourceBetween(start: string, end: string): string {
  return sliceBetween(studioPageSource, start, end);
}

function autosaveRuntimeBetween(start: string, end: string): string {
  return sliceBetween(autosaveRuntimeSource, start, end);
}

// 사이드카 setter·기록·수화는 1ebbc478 에서 history/studio-page-sidecars-controller.ts 로 추출됐다.
// 계약(플러시 → 기록 순서, before/after 스냅샷)은 그대로이므로 그 파일에서 확인한다.
const sidecarControllerSource = readFileSync(
  new URL("./history/studio-page-sidecars-controller.ts", import.meta.url),
  "utf8",
);

function sidecarBetween(start: string, end: string): string {
  return sliceBetween(sidecarControllerSource, start, end);
}

function editorSourceBetween(start: string, end: string): string {
  const startIndex = studioEditorSource.indexOf(start);
  const endIndex = studioEditorSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return studioEditorSource.slice(startIndex, endIndex);
}

describe("E — 지연 커밋 배치는 획 개수만큼의 히스토리 항목으로 들어간다", () => {
  it("flush 는 배치 커밋 뒤 히스토리를 획 단위로 펼친다", () => {
    const flush = sourceBetween(
      "flushPendingStrokeCommitsRef.current = () => {",
      "discardPendingStrokeCommitsRef.current = () => {",
    );

    // 발행·검증은 배치 단위 1회 그대로 — 획마다 commit() 을 부르면 같은 태스크의 장면 발행이
    // 겹쳐 "중복된 드로우 식별자"로 거절된다(브라우저 실측).
    expect(flush).toContain("commit([...baseElements, ...batch.strokes], undefined, batch.pageId)");
    expect(flush.indexOf("expandDeferredStrokeCommitHistory(batch)")).toBeGreaterThan(
      flush.indexOf("if (!committed)"),
    );
  });

  it("펼치기는 뒤쪽 획만 걷어낸 접두 스냅샷을 되돌려 끼운다", () => {
    const expand = editorSourceBetween(
      "function expandDeferredStrokeCommitHistory(batch: PendingStrokeCommitBatch)",
      "// 커밋 지연 파이프라인의 동기화/폐기",
    );

    expect(expand).toContain("if (batch.strokes.length < 2) return;");
    expect(expand).toContain("batch.strokes.slice(kept).map((stroke) => stroke.id)");
    expect(expand).toContain("page.elements.filter((element) => !dropped.has(element.id))");
    expect(expand).toContain("appendStudioPagesHistorySnapshot(accHistory, accIndex, snapshot)");
    expect(expand).toContain("recordStudioHistoryTransition({");
    // 기준 스냅샷이 상한에 밀려 사라졌으면 펼치지 않는다(엉뚱한 상태로 점프 금지).
    expect(expand).toContain("if (!finalPages || !basePages) return;");
    expect(expand).toContain("pagesHiRef.current = accIndex");
  });

  it("undo 는 대기 배치를 폐기하지 않고 먼저 히스토리에 안착시킨다", () => {
    const undo = sourceBetween("function undo() {", "function redo() {");

    expect(undo).toContain(
      "if (pendingStrokeCommitsRef.current && !flushPendingStrokeCommitsRef.current())",
    );
    // flush 는 ref 만 동기 전진시킨다 — 렌더 클로저의 pagesHi 를 읽으면 방금 안착한 획을
    // 건너뛰고 그 앞 스냅샷으로 점프한다.
    expect(undo).toContain("const undoHistory = pagesHistoryRef.current");
    expect(undo).toContain("const nextIndex = Math.max(0, undoIndex - 1)");
    expect(undo).not.toContain("Math.max(0, pagesHi - 1)");
    expect(undo).not.toContain("pagesHistory[nextIndex]");
  });
});

describe("B — 복구 배너의 비우기는 파괴 승인 seam을 지난다", () => {
  it("clearAutosave 는 되돌릴 수 없음 등급의 승인 트랜잭션으로 감싼다", () => {
    const clear = autosaveRuntimeBetween(
      "export async function requestStudioAutosaveClear(",
      "export interface StudioAutosaveBackupContext",
    );

    expect(clear).toContain("studioClearAutosaveRequest({");
    expect(clear).toContain("runStudioDestructiveAction({");
    expect(clear).toContain("clearAutosaveRecord();");
    // 승인 없이 저장소를 직접 지우는 경로가 남아 있으면 안 된다.
    expect(clear).not.toContain("localStorage.removeItem(autosaveKey)");
  });

  it("사라지는 페이지 수·요소 수를 실제 임시저장본에서 센다", () => {
    const clear = autosaveRuntimeBetween(
      "export async function requestStudioAutosaveClear(",
      "export interface StudioAutosaveBackupContext",
    );

    expect(clear).toContain("saved?.payload.pagesList ?? []");
    expect(clear).toContain("pageCount: savedPages.length");
    expect(clear).toContain("total + (page.elements?.length ?? 0)");
  });

  it("카탈로그 항목은 되돌릴 수 없음이며 안전한 취소 라벨을 준다", () => {
    const request = catalogSource.slice(
      catalogSource.indexOf("export function studioClearAutosaveRequest("),
    );
    const body = request.slice(0, request.indexOf("\n}\n") + 1);

    expect(body).toContain('id: "studio.autosave.clear"');
    expect(body).toContain('reversibility: "irreversible"');
    expect(body).toContain('cancelLabel: "그대로 두기"');
    expect(body).toContain("복구하기");
  });

  it("승인 창이 닫히면 포커스는 파괴 버튼이 아니라 복구 쪽으로 돌아간다", () => {
    expect(statusRailSource).toContain("const autosaveSafeActionRef = useRef<HTMLButtonElement | null>(null)");
    expect(statusRailSource).toContain("autosaveSafeActionRef.current?.focus()");
    expect(statusRailSource).toContain("onClick={requestClearAutosave}");
  });
});

/**
 * G 는 원래 "사이드카 편집 뒤의 ⌘Z 가 화면 밖 캔버스 획을 지운다"는 파괴였고, 1회성 배리어가
 * 그 파괴만 막았다(사이드카 자체는 여전히 되돌릴 수 없었다). 이제 통합 저널이 사이드카 편집을
 * 진짜 undo 단계로 만들었으므로 배리어는 사라졌다. 계약은 더 강해졌다 — "엉뚱한 걸 지우지
 * 않는다" 에서 "만진 그것을 되돌린다" 로.
 */
describe("G — 사이드카 편집은 캔버스와 한 시간 순서로 되돌아간다", () => {
  it("사이드카 setter 가 통합 저널에 이전/다음 문서를 남긴다", () => {
    // 배리어와 그 고지는 남아 있으면 안 된다 — 되돌릴 수 있는 편집을 못 되돌린다고 거짓말한다.
    expect(studioPageSource).not.toContain("sidecarHistoryBarrierRef");
    expect(studioPageSource).not.toContain("실행 취소(⌘Z) 대상이 아니에요");

    for (const target of ["characterBible", "writerRoom"]) {
      const setter = target === "characterBible"
        ? sidecarBetween(
            "const setCharacterBible = (next: Parameters<typeof setCharacterBibleState>[0]) => {",
            "const setWriterRoom = (next:",
          )
        : sidecarBetween(
            "const setWriterRoom = (next: Parameters<typeof setWriterRoomState>[0]) => {",
            "function restoreStudioSidecarDocument(",
          );

      // 렌더 클로저가 아니라 ref 에서 읽어야 한 태스크의 연속 편집이 같은 `before` 를 겹쳐 쓰지 않는다.
      expect(setter).toContain(".current");
      expect(setter).toContain("recordStudioSidecarHistoryEntry({");
      expect(setter).toContain(`target: "${target}"`);
      expect(setter).toContain("before,");
      expect(setter).toContain("after,");
    }
  });

  it("사이드카 기록은 대기 획 배치를 먼저 안착시켜 시간 순서를 지킨다", () => {
    const record = sidecarBetween(
      "function recordStudioSidecarHistoryEntry(entry: StudioPageHistorySidecarEntry): void {",
      "const setCharacterBible =",
    );

    // 배치는 나중에 flush 된다 — 먼저 안착시키지 않으면 "획 → 사이드카" 가 저널에서 뒤집힌다.
    // 컨트롤러는 훅(onBeforeRecordSidecar)을 먼저 부르고, 호스트가 그 훅에 대기 배치 flush 를 건다.
    expect(record.indexOf("onBeforeRecordSidecar?.()")).toBeLessThan(
      record.indexOf("recordStudioHistoryJournalSidecarEdit"),
    );
    expect(record.indexOf("onBeforeRecordSidecar?.()")).toBeGreaterThanOrEqual(0);
    // 984251d8c 이후 호스트는 useStudioDocumentSidecarsRuntime 에 `beforeRecordSidecar` 로 걸고,
    // 그 런타임이 컨트롤러의 onBeforeRecordSidecar 로 그대로 넘긴다.
    const wiring = sourceBetween("beforeRecordSidecar: () => {", "commitStudioHistoryJournal,");
    expect(wiring).toContain("if (pendingStrokeCommitsRef.current) flushPendingStrokeCommitsRef.current();");
    expect(studioPageSource).toContain("onBeforeRecordSidecar: beforeRecordSidecar,");
  });

  it("undo 는 최신 항목이 사이드카면 문서만 되돌리고 pagesHi 는 건드리지 않는다", () => {
    const undo = sourceBetween("function undo() {", "function redo() {");
    const flushIndex = undo.indexOf("if (pendingStrokeCommitsRef.current && !flushPendingStrokeCommitsRef.current())");
    const journalIndex = undo.indexOf("const undoEntry = readStudioHistoryJournalUndoEntry(historyJournalRef.current)");
    const historyIndex = undo.indexOf("const undoHistory = pagesHistoryRef.current");

    // flush 는 저널을 동기 전진시킨다 — 조회보다 먼저 와야 방금 안착한 획이 최신 항목으로 보인다.
    expect(flushIndex).toBeGreaterThanOrEqual(0);
    expect(journalIndex).toBeGreaterThan(flushIndex);
    expect(historyIndex).toBeGreaterThan(journalIndex);

    const sidecarBranch = undo.slice(journalIndex, historyIndex);
    expect(sidecarBranch).toContain('if (undoEntry?.kind === "sidecar")');
    expect(sidecarBranch).toContain('restoreStudioSidecarDocument(undoEntry, "undo")');
    expect(sidecarBranch).toContain("return;");
    // 사이드카 분기는 캔버스 히스토리를 절대 움직이지 않는다 — 그게 이 버그의 본체였다.
    expect(sidecarBranch).not.toContain("setPagesHi(");
    expect(sidecarBranch).not.toContain("pagesHiRef.current =");
  });

  it("redo 가 undo 를 거울처럼 되짚는다", () => {
    const redo = sourceBetween("function redo() {", "companionHistoryHandlerRef.current =");

    expect(redo).toContain("readStudioHistoryJournalRedoEntry(historyJournalRef.current)");
    expect(redo).toContain('restoreStudioSidecarDocument(redoEntry, "redo")');
    expect(redo).toContain('stepStudioHistoryJournal(historyJournalRef.current, "redo")');
  });

  it("저널은 스냅샷 히스토리가 앞을 버릴 때 같이 버린다", () => {
    // 상한을 넘겨 잘려 나간 스냅샷 단계 수만큼 저널도 `pages` 항목을 버려야 둘이 어긋나지 않는다.
    // 저널 기록기는 useStudioUnifiedHistoryJournal 로 추출되면서 useCallback 형태가 됐다.
    const record = sourceBetween(
      "const recordStudioHistoryJournalPages = useCallback((",
      "const resetStudioHistoryJournal = useCallback((",
    );
    expect(record).toContain("recordStudioHistoryJournalPagesSteps(historyJournalRef.current, {");
    expect(record).toContain("addedSteps,");
    expect(record).toContain("nextUndoDepth,");

    // 새 단계를 만드는 모든 경로가 실제 결과 인덱스를 그대로 넘긴다(기대값을 다시 계산하지 않는다).
    // 커밋 엔진 경로(commit/commitCoalesced/펼치기)는 studio-deferred-stroke-commit.ts 로
    // 추출됐으므로 합성 에디터 소스에서 확인한다.
    for (const site of [
      "recordStudioHistoryJournalPages(1, appended.historyIndex);",
      "recordStudioHistoryJournalPages(batch.strokes.length - 1, accIndex);",
    ]) {
      expect(studioEditorSource).toContain(site);
    }
    // 합치기 분기는 새 단계가 없다 — 저널도 늘리지 않는다.
    expect(studioEditorSource).toContain(
      "if (!replacesCurrentSnapshot) recordStudioHistoryJournalPages(1, nextHistoryIndex);",
    );
  });

  it("문서 전체 수화는 저널을 비우고 사이드카 항목을 남기지 않는다", () => {
    const restore = autosaveRuntimeBetween(
      "export async function restoreStudioAutosaveRecovery(",
      "export interface StudioAutosaveDurableAuthorityContext",
    );
    expect(restore).toContain("resetStudioHistoryJournal();");
    expect(restore).toContain("hydrateStudioSidecarDocuments({");

    const hydrate = sidecarBetween(
      "function hydrateStudioSidecarDocuments(input: {",
      "  return {\n    characterBible,",
    );
    // 수화는 사용자의 편집이 아니다 — raw setter 로 가고 저널 항목을 만들지 않는다.
    expect(hydrate).toContain("setCharacterBibleState(input.characterBible);");
    expect(hydrate).toContain("setWriterRoomState(input.writerRoom);");
    expect(hydrate).not.toContain("recordStudioSidecarHistoryEntry");
  });
});
