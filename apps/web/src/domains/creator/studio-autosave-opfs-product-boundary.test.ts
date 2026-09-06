import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const studioPage = readStudioPageCompositionSource();
const autosaveSession = readFileSync(
  new URL("./studio-autosave-opfs-session.ts", import.meta.url),
  "utf8",
);
const autosaveRuntime = readFileSync(
  new URL("./useStudioAutosaveDocumentRuntime.ts", import.meta.url),
  "utf8",
);
const storageRecoveryRuntime = readFileSync(
  new URL("./studio-storage-recovery-runtime.ts", import.meta.url),
  "utf8",
);
// Intentional change (2026-08, B-09): the handleSave orchestration moved to
// studio-page-save-pipeline.ts, so the durable-tombstone ordering reads it there.
const savePipeline = readFileSync(
  new URL("./studio-page-save-pipeline.ts", import.meta.url),
  "utf8",
);
// Intentional change (2026-08, B-17): the restore/durable-tombstone/clear/backup bodies moved to
// studio-page-autosave-runtime.ts, so those source slices read them there. StudioPage keeps thin
// same-named wrappers, and every guard/ordering contract below is unchanged.
const autosaveRuntimeActions = readFileSync(
  new URL("./studio-page-autosave-runtime.ts", import.meta.url),
  "utf8",
);

function sourceBetween(
  source: string,
  start: string,
  end: string,
): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Studio OPFS + SQLite autosave product boundary", () => {
  it("loads both heavy authorities lazily and disposes the document-scoped OPFS session", () => {
    const setup = sourceBetween(
      autosaveRuntime,
      "const autosaveOpfsSessionRef",
      "  return {",
    );

    expect(setup).toContain('import("./studio-autosave-opfs-session")');
    // 문서 열기 시점에 leader/follower 를 정하고, 그 결정에 맞는 쓰기 능력의 세션을 받는다.
    expect(setup).toContain("openStudioAutosaveDocumentSession(autosaveKey)");
    expect(setup).toContain("autosaveOpfsSessionRef.current = sessionPromise");
    expect(setup).toContain("opened?.session?.dispose()");
    // 임차권은 세션 정리 **뒤에** 놓는다 — 순서가 뒤집히면 follower 가 살아 있는 writer 위로
    // 승격해 같은 문서에 두 저장 권위가 생긴다.
    expect(setup.indexOf("opened?.session?.dispose()")).toBeLessThan(
      setup.indexOf("opened?.lease.release()"),
    );
    expect(setup).toContain('import("./studio-autosave-sqlite-store")');
    expect(setup).toContain("acquireStudioAutosaveSqliteStore()");
    expect(setup).toContain("autosaveSqliteStoreRef.current = storePromise");
    expect(studioPage).not.toContain(
      'import { StudioAutosaveOpfsSession } from "./studio-autosave-opfs-session";',
    );
  });

  it("commits normal autosave through OPFS/SQLite without writing browser KV", () => {
    const autosave = sourceBetween(
      studioPage,
      "// 오토세이브 임시저장 리스너",
      "// 서버 자동저장",
    );

    expect(autosave).toContain("persistStudioAutosaveWithOpfsPrimary");
    expect(autosave).toContain("sessionPromise ?? Promise.resolve(null)");
    expect(autosave).toContain("sqlitePromise ?? Promise.resolve(null)");
    expect(autosave).toContain("sqlite,");
    expect(autosave).toContain("storage: globalThis.localStorage");
    expect(autosave).not.toContain("localStorage.setItem");
    const persistIndex = autosave.indexOf("persistStudioAutosaveWithOpfsPrimary");
    expect(persistIndex).toBeLessThan(
      autosave.indexOf("studioLifecycleDurableGenerationRef.current = Math.max", persistIndex),
    );
    expect(autosave).toContain("Keep the current in-memory generation dirty");
    expect(autosaveSession).not.toContain("storage.setItem");
  });

  it("tombstones a previous recovery snapshot when Undo returns the document to empty", () => {
    const autosave = sourceBetween(
      studioPage,
      "// 오토세이브 임시저장 리스너",
      "// 서버 자동저장",
    );

    expect(autosave).toContain("hasMeaningfulAutosaveContent");
    expect(autosave).toContain("hasExistingAutosaveAuthority");
    expect(autosave).toContain("if (session) attempted.push(session.clear(savedAt))");
    expect(autosave).toContain("if (sqlite) attempted.push(sqlite.clear(autosaveKey, savedAt))");
    expect(autosave).toContain("results.length === 0");
    expect(autosave).toContain("studioRevisionProjectGenerationRef.current !== scheduledGeneration");
    expect(autosave.indexOf("Promise.allSettled(attempted)")).toBeLessThan(
      autosave.indexOf("globalThis.localStorage.removeItem(autosaveKey)"),
    );
  });

  it("reconciles the newest durable checkpoint before exposing the recovery banner", () => {
    const discovery = sourceBetween(
      studioPage,
      "// 로드 시 임시저장 확인 리스너",
      "function prepareStudioDocumentReplacement",
    );

    expect(discovery).toContain("reconcileStudioAutosaveWithOpfsPrimary");
    expect(discovery).toContain("saved = reconciliation.candidate");
    expect(discovery).toContain("autosaveRecoveryCandidateRef.current = saved");
    expect(discovery.indexOf("saved = reconciliation.candidate")).toBeLessThan(
      discovery.indexOf("setHasAutosave(Boolean(saved))"),
    );
    expect(discovery).toContain("if (cancelled) return");
    expect(discovery).toContain("allowLegacy: false");
    expect(discovery).not.toContain("allowLegacy: !workId");
  });

  it("never promotes the pre-V12 singleton autosave into a product recovery", () => {
    expect(studioPage).not.toContain(
      "readStudioAutosave(localStorage, autosaveKey, !workId && !remixId)",
    );
    expect(studioPage).not.toContain("allowLegacy: !workId && !remixId");
    expect(studioPage).toContain("allowLegacy: false");
  });

  it("retains the reconciled durable candidate for restore and backup without rereading its browser mirror", () => {
    const restore = sourceBetween(
      autosaveRuntimeActions,
      "export async function restoreStudioAutosaveRecovery(",
      "export interface StudioAutosaveDurableAuthorityContext",
    );
    const backupIndex = autosaveRuntimeActions.indexOf(
      "export function downloadStudioAutosaveBackup(",
    );
    expect(backupIndex).toBeGreaterThanOrEqual(0);
    const backup = autosaveRuntimeActions.slice(backupIndex);

    expect(restore).toContain("const saved = autosaveRecoveryCandidateRef.current");
    expect(restore).toContain('saved.authority === "browser-storage-compatibility"');
    expect(restore).not.toContain("readStudioAutosave(");
    expect(restore).not.toContain("localStorage");
    expect(backup).toContain("const saved = autosaveRecoveryCandidateRef.current");
    expect(backup).toContain("serializeStudioAutosave(saved.payload)");
    expect(backup).not.toContain("readStudioAutosave(");
    expect(backup).not.toContain("localStorage");
  });

  it("makes browser-only compatibility recovery backup-only and explicitly non-durable", () => {
    const discovery = sourceBetween(
      studioPage,
      "// 로드 시 임시저장 확인 리스너",
      "function prepareStudioDocumentReplacement",
    );

    expect(discovery).toContain('saved?.authority === "browser-storage-compatibility"');
    expect(discovery).toContain('? "legacy-unversioned"');
    expect(discovery).toContain("reportStudioSaveAuthorityDegraded(");
    expect(discovery).toContain("JSON 백업만 허용합니다");
    expect(autosaveSession).not.toContain("writeAutosaveCompatibilitySnapshot");
  });

  it("never exposes browser KV as a successful persistence authority", () => {
    expect(autosaveSession).toContain(
      "export type StudioAutosavePersistenceAuthority = StudioAutosaveDurableAuthority",
    );
    expect(storageRecoveryRuntime).not.toContain('"browser-storage-fallback"');
    expect(storageRecoveryRuntime).toContain("현재 작업은 이 탭 메모리에만 남아 있어요");
  });

  it("records a durable tombstone for explicit clear and successful server save", () => {
    const clear = sourceBetween(
      autosaveRuntimeActions,
      "export function clearStudioAutosaveDurableAuthority(",
      "export interface StudioAutosaveBackupContext",
    );
    const saveHandler = savePipeline.slice(
      savePipeline.indexOf("export async function runStudioPageSavePipeline("),
    );

    expect(clear).toContain("if (session) attempted.push(session.clear(savedAt))");
    expect(clear).toContain("if (sqlite) attempted.push(sqlite.clear(autosaveKey, savedAt))");
    expect(clear).toContain("export async function requestStudioAutosaveClear(");
    expect(clear.indexOf("clearAutosaveDurableAuthority()")).toBeLessThan(
      clear.indexOf("localStorage.removeItem(autosaveKey)"),
    );
    const acceptedMutationIndex = saveHandler.lastIndexOf(
      "if (!canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true }))",
    );
    const durableClearIndex = saveHandler.indexOf("clearAutosaveDurableAuthority()", acceptedMutationIndex);
    const browserMirrorClearIndex = saveHandler.indexOf(
      "localStorage.removeItem(autosaveKey)",
      durableClearIndex,
    );
    expect(acceptedMutationIndex).toBeGreaterThanOrEqual(0);
    expect(durableClearIndex).toBeGreaterThan(acceptedMutationIndex);
    expect(browserMirrorClearIndex).toBeGreaterThan(durableClearIndex);
  });

  it("keeps pagehide non-blocking while accepting success only from OPFS/SQLite", () => {
    const lifecycle = sourceBetween(
      studioPage,
      "persistPendingStrokeEmergencyAutosaveRef.current = (reason) =>",
      "function applyStudioProjectSnapshotWithPreparedDocuments",
    );

    expect(lifecycle).not.toContain("writeStudioLifecycleAutosave(");
    expect(lifecycle).not.toContain("localStorage.setItem");
    expect(lifecycle).toContain("await session.write(emergency.payload)");
    expect(lifecycle).toContain("await sqlite.write(autosaveKey, emergency.payload)");
    expect(lifecycle).toContain("Promise.any(durableWrites)");
    expect(lifecycle).toContain("noteStudioSaveSucceeded(authority)");
    expect(lifecycle).toContain("reportStudioAutosaveFailure(cause)");
  });
});
