import { normalizeStudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import { recoverInterruptedStudioAiOperations } from "./ai/studio-ai-provenance-recorder";
import { requireStudioDrawingPointerTransport } from "./brush/studio-drawing-pointer-transport";
import {
  LEGACY_STUDIO_AUTOSAVE_KEY,
  serializeStudioAutosave,
  studioLifecycleAutosaveSidecarKey,
  studioSharedAutosaveCompatibility,
} from "./studio-autosave";
import { normalizeStudioCharacterBible } from "./studio-character-bible";
import { normalizeStudioCommentsDocument } from "./studio-comments";
import { runStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioClearAutosaveRequest } from "./studio-destructive-command-catalog";
import { normalizeDocumentMaster, type DocumentMaster } from "./studio-master-page";
import { normalizePageReviewState } from "./studio-page-review";
import {
  publishPackageCreditsFromPack,
  publishPackageSettingsFromPack,
  type createStudioPageHistoryCommandJournalClient,
} from "./studio-page-shell-runtime";
import { normalizeStudioPublicationAnalyticsDeferred } from "./studio-publication-analytics-loader";
import { normalizeStudioPublishPackSettings } from "./studio-publish-preflight";
import { normalizeStudioReferenceBoardDocument } from "./studio-reference-board";
import { loadStudioReleaseScheduleRuntime } from "./studio-release-schedule-loader";
import { studioWorkAssetDocumentSourceTransitionReason } from "./studio-work-asset-edit-guard";
import { normalizeStudioWriterRoomDocument } from "./studio-writer-room";

import type { StudioDrawingPointerTransport } from "./brush/studio-drawing-pointer-transport";
import type {
  StudioAutosaveOpfsSession,
  StudioAutosaveRecoveryCandidate,
} from "./studio-autosave-opfs-session";
import type { StudioAutosaveSqlitePort } from "./studio-autosave-sqlite-store";
import type { PendingStrokeCommitBatch } from "./studio-cuttoon-editor/studio-deferred-stroke-commit";
import type { StudioEditorMutationTicket } from "./studio-editor-scope";
import type { DrawEl, El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";
import type { StudioSharedDocument } from "./studio-shared-document-client";
import type { MutableRefObject } from "react";

/**
 * StudioPage 자동저장 런타임 추출(2026-08, B-17) — 문서 교체 가드와 복구 배너가 부르는 네 동작
 * (복구 · 내구 권위 tombstone · 기록 비우기 · JSON 백업 내려받기). 본문은 StudioPage 원본의
 * verbatim 이동이고, 상태/refs/세터는 페이지가 소유한 채 ctx 로만 주입된다.
 *
 * 페이지에는 같은 이름의 얇은 래퍼 함수 선언만 남는다 — effect 안에서 참조되는 심볼의 안정성을
 * react-hooks/exhaustive-deps 가 컴포넌트 스코프 함수 선언에 대해서만 전이 증명하기 때문이다.
 */

type StudioPublishPackSettings = ReturnType<typeof normalizeStudioPublishPackSettings>;
type StudioReleaseScheduleRuntime = Awaited<
  ReturnType<typeof loadStudioReleaseScheduleRuntime>
>;

/** 대기 획 배치 ref — StudioPage 가 들고 있는 (timer 포함) 형태 그대로. */
type StudioPendingStrokeCommitsRef = MutableRefObject<
  | (PendingStrokeCommitBatch & { timer: ReturnType<typeof setTimeout> | null })
  | null
>;

/** 문서 교체 가드가 읽는 페이지 소유 상태 — 전부 참조 안정(ref 박스·세터). */
export interface StudioDocumentReplacementGuardContext {
  readonly drawingRef: MutableRefObject<DrawEl | null>;
  readonly drawingPointerTransportRef: MutableRefObject<StudioDrawingPointerTransport | null>;
  readonly pendingStrokeCommitsRef: StudioPendingStrokeCommitsRef;
  readonly flushPendingStrokeCommitsRef: MutableRefObject<() => boolean>;
  readonly setError: (message: string | null) => void;
}

/**
 * 현재 획·대기 획을 문서 경계 너머로 운반하지 않기 위한 공통 가드.
 * (StudioPage 의 prepareStudioDocumentReplacement 본문 — verbatim 이동.)
 */
export function guardStudioDocumentReplacement(
  ctx: StudioDocumentReplacementGuardContext,
  label: string,
  options: { flushPending: boolean } = { flushPending: false }
): boolean {
  const {
    drawingRef,
    drawingPointerTransportRef,
    pendingStrokeCommitsRef,
    flushPendingStrokeCommitsRef,
    setError,
  } = ctx;
  if (drawingRef.current || requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()) {
    setError(`현재 획을 마친 뒤 ${label}할 수 있어요.`);
    return false;
  }
  if (pendingStrokeCommitsRef.current) {
    if (!options.flushPending) {
      setError(`${label}하는 동안 새 획이 생겨 적용하지 않았어요. 획을 마친 뒤 다시 시도해 주세요.`);
      return false;
    }
    if (!flushPendingStrokeCommitsRef.current()) {
      setError(
        `마지막 획을 확정하지 못해 ${label}하지 않았어요. 잠금·동기화 상태를 확인한 뒤 다시 시도해 주세요.`
      );
      return false;
    }
  }
  return true;
}

/**
 * 임시저장 복구가 읽고 쓰는 페이지 소유 상태.
 *
 * `prepareStudioDocumentReplacement` 는 페이지의 래퍼를 그대로 주입받는다 — 이동한 본문이
 * 원본과 한 글자도 다르지 않게 하기 위한 seam 이다.
 */
export interface StudioAutosaveRestoreContext {
  readonly autosaveRecoveryCandidateRef: MutableRefObject<StudioAutosaveRecoveryCandidate | null>;
  readonly canApplyStudioMutation: (ticket: StudioEditorMutationTicket) => boolean;
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  readonly collaborationDocumentLocked: boolean;
  readonly collaborationLockMessage: () => string;
  readonly drawingPointerTransportRef: MutableRefObject<StudioDrawingPointerTransport | null>;
  readonly drawingRef: MutableRefObject<DrawEl | null>;
  readonly hydrateStudioSidecarDocuments: (input: {
    readonly characterBible: ReturnType<typeof normalizeStudioCharacterBible>;
    readonly writerRoom: ReturnType<typeof normalizeStudioWriterRoomDocument>;
  }) => void;
  readonly pages: PageState[];
  readonly pagesHiRef: MutableRefObject<number>;
  readonly pagesHistoryCommandJournalRef: MutableRefObject<ReturnType<
    typeof createStudioPageHistoryCommandJournalClient
  > | null>;
  readonly pagesHistoryRef: MutableRefObject<PageState[][]>;
  readonly pendingStrokeCommitsRef: StudioPendingStrokeCommitsRef;
  readonly prepareStudioDocumentReplacement: (
    label: string,
    options?: { flushPending: boolean }
  ) => boolean;
  readonly resetAdvancedFillForDocumentReplacement: () => void;
  readonly resetStudioHistoryJournal: () => void;
  readonly resetStudioHistoryRetention: () => void;
  readonly setAiProvenance: (next: ReturnType<typeof normalizeStudioAiProvenanceDocument>) => void;
  readonly setAutosaveRestoreBlockedReason: (
    next: "legacy-unversioned" | "work-mismatch" | "revision-mismatch" | null
  ) => void;
  readonly setCurrentPageId: (next: string) => unknown;
  readonly setDescription: (next: string) => void;
  readonly setError: (message: string | null) => void;
  readonly setHasAutosave: (next: boolean) => void;
  readonly setMaster: (next: DocumentMaster<El>) => void;
  readonly setPagesHi: (next: number) => void;
  readonly setPagesHistory: (next: PageState[][]) => void;
  readonly setPanelGutter: (next: number) => void;
  readonly setPublicationAnalytics: (
    next: Awaited<ReturnType<typeof normalizeStudioPublicationAnalyticsDeferred>>
  ) => void;
  readonly setPublishAiDisclosure: (next: StudioPublishPackSettings["disclosure"]) => void;
  readonly setPublishAiUsage: (next: StudioPublishPackSettings["aiUsage"]) => void;
  readonly setPublishCompliance: (next: StudioPublishPackSettings["compliance"]) => void;
  readonly setPublishPackageCredits: (
    next: ReturnType<typeof publishPackageCreditsFromPack>
  ) => void;
  readonly setPublishPackageSettings: (
    next: ReturnType<typeof publishPackageSettingsFromPack>
  ) => void;
  readonly setPublishProfile: (next: StudioPublishPackSettings["profile"]) => void;
  readonly setReferenceBoard: (
    next: ReturnType<typeof normalizeStudioReferenceBoardDocument>
  ) => unknown;
  readonly setReleaseSchedule: (
    next: ReturnType<StudioReleaseScheduleRuntime["normalizeStudioReleaseSchedule"]>
  ) => void;
  readonly setStudioComments: (
    next: ReturnType<typeof normalizeStudioCommentsDocument>
  ) => unknown;
  readonly setTagsText: (next: string) => void;
  readonly setTitle: (next: string) => void;
  readonly setWebtoonTheme: (next: "classic" | "soft" | "vivid") => void;
  readonly sharedDocument: StudioSharedDocument | null;
  readonly workId: string | null;
}

/**
 * 복구 배너의 "복구하기". 내구 권위에서 조정된 후보만 문서로 되돌리고, 준비 도중 시작된
 * 획/원고 변경은 적용을 취소한다.
 * (StudioPage 의 restoreAutosave 본문 — verbatim 이동.)
 */
export async function restoreStudioAutosaveRecovery(
  ctx: StudioAutosaveRestoreContext
): Promise<void> {
  const {
    autosaveRecoveryCandidateRef,
    canApplyStudioMutation,
    captureStudioMutationTicket,
    collaborationDocumentLocked,
    collaborationLockMessage,
    drawingPointerTransportRef,
    drawingRef,
    hydrateStudioSidecarDocuments,
    pages,
    pagesHiRef,
    pagesHistoryCommandJournalRef,
    pagesHistoryRef,
    pendingStrokeCommitsRef,
    prepareStudioDocumentReplacement,
    resetAdvancedFillForDocumentReplacement,
    resetStudioHistoryJournal,
    resetStudioHistoryRetention,
    setAiProvenance,
    setAutosaveRestoreBlockedReason,
    setCurrentPageId,
    setDescription,
    setError,
    setHasAutosave,
    setMaster,
    setPagesHi,
    setPagesHistory,
    setPanelGutter,
    setPublicationAnalytics,
    setPublishAiDisclosure,
    setPublishAiUsage,
    setPublishCompliance,
    setPublishPackageCredits,
    setPublishPackageSettings,
    setPublishProfile,
    setReferenceBoard,
    setReleaseSchedule,
    setStudioComments,
    setTagsText,
    setTitle,
    setWebtoonTheme,
    sharedDocument,
    workId,
  } = ctx;
    if (collaborationDocumentLocked) {
      setError(collaborationLockMessage());
      return;
    }
    if (!prepareStudioDocumentReplacement("임시저장본을 복구", { flushPending: true })) return;
    const mutationTicket = captureStudioMutationTicket();
    try {
      const saved = autosaveRecoveryCandidateRef.current;
      if (!saved) {
        setError("복구할 내구 임시저장 데이터를 찾지 못했어요.");
        return;
      }
      if (saved.authority === "browser-storage-compatibility") {
        setAutosaveRestoreBlockedReason("legacy-unversioned");
        setError(
          "내구 저장소에서 확인되지 않은 호환 백업은 자동 복구하지 않아요. JSON 백업으로 내려받아 보관해 주세요."
        );
        return;
      }
      {
        if (workId && sharedDocument) {
          const compatibility = studioSharedAutosaveCompatibility(saved.payload, {
            workId,
            revision: sharedDocument.revision,
          });
          if (!compatibility.compatible) {
            setAutosaveRestoreBlockedReason(compatibility.reason);
            setError(
              compatibility.reason === "revision-mismatch"
                ? "임시저장본의 서버 revision이 현재 공동 문서와 달라 자동 복구를 차단했어요. JSON 백업으로 내려받아 수동 병합해 주세요."
                : "출처 revision을 확인할 수 없는 공동 임시저장본이라 자동 복구를 차단했어요. JSON 백업으로 내려받아 보관해 주세요."
            );
            return;
          }
        }
        const parsed = saved.payload;
        const [
          { normalizeStudioReleaseSchedule },
          normalizedPublicationAnalytics,
        ] = await Promise.all([
          loadStudioReleaseScheduleRuntime(),
          normalizeStudioPublicationAnalyticsDeferred(parsed.publicationAnalytics),
        ]);
        if (
          drawingRef.current
          || requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()
          || pendingStrokeCommitsRef.current
        ) {
          setError("임시저장본을 준비하는 동안 새 획이 시작되어 복구하지 않았어요. 획을 마친 뒤 다시 시도해 주세요.");
          return;
        }
        if (!canApplyStudioMutation(mutationTicket)) {
          setError("임시저장본을 준비하는 동안 원고가 변경되어 복구하지 않았어요. 다시 확인해 주세요.");
          return;
        }
        if (parsed.pagesList.length > 0) {
          const restoredPages = parsed.pagesList.map((page) => ({
            ...page,
            ...((page as Record<string, unknown>)?.review !== undefined
              ? { review: normalizePageReviewState((page as Record<string, unknown>).review) }
              : {}),
          })) as PageState[];
          const currentHistory = pagesHistoryRef.current;
          const currentHistoryIndex = Math.max(
            0,
            Math.min(pagesHiRef.current, Math.max(0, currentHistory.length - 1))
          );
          const currentPages = currentHistory[currentHistoryIndex] ?? pages;
          const workAssetReason = studioWorkAssetDocumentSourceTransitionReason(
            currentPages,
            restoredPages
          );
          if (workAssetReason) {
            setError(workAssetReason);
            return;
          }
          resetAdvancedFillForDocumentReplacement();
          pagesHistoryCommandJournalRef.current?.rebase({
            pages: restoredPages,
            historyIndex: 0,
          });
          pagesHistoryRef.current = [restoredPages];
          pagesHiRef.current = 0;
          // 히스토리를 통째로 갈아치웠으니 통합 저널도 처음부터 — 남은 항목은 사라진 스냅샷을 가리킨다.
          resetStudioHistoryRetention();
          resetStudioHistoryJournal();
          setPagesHistory([restoredPages]);
          setPagesHi(0);
          const restoredCurrentId = restoredPages.some((page) => page.id === parsed.currentPageId)
            ? parsed.currentPageId!
            : restoredPages[0].id;
          setCurrentPageId(restoredCurrentId);
        }
        if (typeof parsed.title === "string") setTitle(parsed.title);
        if (typeof parsed.description === "string") setDescription(parsed.description);
        if (typeof parsed.tagsText === "string") setTagsText(parsed.tagsText);
        if (parsed.webtoonTheme === "classic" || parsed.webtoonTheme === "soft" || parsed.webtoonTheme === "vivid") {
          setWebtoonTheme(parsed.webtoonTheme);
        }
        if (typeof parsed.panelGutter === "number" && Number.isFinite(parsed.panelGutter)) {
          setPanelGutter(parsed.panelGutter);
        }
        const publishPack = normalizeStudioPublishPackSettings(parsed.publishPack);
        setPublishProfile(publishPack.profile);
        setPublishAiUsage(publishPack.aiUsage);
        setPublishAiDisclosure(publishPack.disclosure);
        setPublishCompliance(publishPack.compliance);
        setPublishPackageSettings(publishPackageSettingsFromPack(parsed.publishPack));
        setPublishPackageCredits(publishPackageCreditsFromPack(parsed.publishPack));
        hydrateStudioSidecarDocuments({
          characterBible: normalizeStudioCharacterBible(parsed.characterBible),
          writerRoom: normalizeStudioWriterRoomDocument(parsed.writerRoom),
        });
        setAiProvenance(
          recoverInterruptedStudioAiOperations(
            normalizeStudioAiProvenanceDocument(parsed.aiProvenance)
          )
        );
        setStudioComments(normalizeStudioCommentsDocument(parsed.comments));
        setReleaseSchedule(normalizeStudioReleaseSchedule(parsed.releaseSchedule));
        setPublicationAnalytics(normalizedPublicationAnalytics);
        setReferenceBoard(normalizeStudioReferenceBoardDocument(parsed.referenceBoard));
        // 문서 마스터 복구 — 백업에 없으면 빈 마스터(하위호환).
        setMaster(normalizeDocumentMaster(parsed.master) as DocumentMaster<El>);
        autosaveRecoveryCandidateRef.current = null;
        setAutosaveRestoreBlockedReason(null);
        setHasAutosave(false);
      }
    } catch {
      setError("임시저장 복구에 실패했어요.");
    }
}

/** 내구 tombstone 이 읽는 페이지 소유 상태. */
export interface StudioAutosaveDurableAuthorityContext {
  readonly autosaveKey: string;
  readonly autosaveOpfsSessionRef: MutableRefObject<Promise<StudioAutosaveOpfsSession | null> | null>;
  readonly autosaveSqliteStoreRef: MutableRefObject<Promise<StudioAutosaveSqlitePort | null> | null>;
}

/**
 * OPFS/SQLite 내구 권위에 tombstone 을 남긴다 — 브라우저 KV 만 지우면 다음 재진입에서 오래된
 * 내구 스냅샷이 되살아난다.
 * (StudioPage 의 clearAutosaveDurableAuthority 본문 — verbatim 이동.)
 */
export function clearStudioAutosaveDurableAuthority(
  ctx: StudioAutosaveDurableAuthorityContext
): void {
  const { autosaveKey, autosaveOpfsSessionRef, autosaveSqliteStoreRef } = ctx;
    const sessionPromise = autosaveOpfsSessionRef.current;
    const sqlitePromise = autosaveSqliteStoreRef.current;
    if (!sessionPromise && !sqlitePromise) return;
    const savedAt = new Date().toISOString();
    void Promise.all([
      sessionPromise ?? Promise.resolve(null),
      sqlitePromise ?? Promise.resolve(null),
    ])
      .then(async ([session, sqlite]) => {
        const attempted: Promise<unknown>[] = [];
        if (session) attempted.push(session.clear(savedAt));
        if (sqlite) attempted.push(sqlite.clear(autosaveKey, savedAt));
        const results = await Promise.allSettled(attempted);
        if (
          results.length > 0
          && results.every((result) => result.status === "rejected")
        ) {
          throw new AggregateError(
            results.map((result) =>
              result.status === "rejected" ? result.reason : null
            ),
            "Studio durable autosave tombstones failed",
          );
        }
      })
      .catch((cause: unknown) => {
        if (import.meta.env.DEV) {
          console.warn("Studio durable autosave tombstone could not be written.", cause);
        }
      });
}

/** 임시저장 기록 비우기가 읽고 쓰는 페이지 소유 상태. */
export interface StudioAutosaveRecordClearContext {
  readonly autosaveKey: string;
  readonly autosaveRecoveryCandidateRef: MutableRefObject<StudioAutosaveRecoveryCandidate | null>;
  readonly clearAutosaveDurableAuthority: () => void;
  readonly remixId: string | null;
  readonly setAutosaveRestoreBlockedReason: (
    next: "legacy-unversioned" | "work-mismatch" | "revision-mismatch" | null
  ) => void;
  readonly setHasAutosave: (next: boolean) => void;
  readonly workId: string | null;
}

/**
 * 내구 권위 tombstone 먼저, 그 다음 브라우저 미러 — 순서가 뒤집히면 지워지지 않은 내구 사본이
 * 다음 재진입에서 되살아난다.
 * (StudioPage 의 clearAutosaveRecord 본문 — verbatim 이동.)
 */
export function clearStudioAutosaveRecord(ctx: StudioAutosaveRecordClearContext): void {
  const {
    autosaveKey,
    autosaveRecoveryCandidateRef,
    clearAutosaveDurableAuthority,
    remixId,
    setAutosaveRestoreBlockedReason,
    setHasAutosave,
    workId,
  } = ctx;
    clearAutosaveDurableAuthority();
    try {
      localStorage.removeItem(autosaveKey);
      localStorage.removeItem(studioLifecycleAutosaveSidecarKey(autosaveKey));
      if (!workId && !remixId) localStorage.removeItem(LEGACY_STUDIO_AUTOSAVE_KEY);
    } catch {
      // 무시
    }
    autosaveRecoveryCandidateRef.current = null;
    setHasAutosave(false);
    setAutosaveRestoreBlockedReason(null);
}

/** 복구 배너 "비우기" 승인 트랜잭션이 읽는 페이지 소유 상태. */
export interface StudioClearAutosaveContext {
  readonly autosaveRecoveryCandidateRef: MutableRefObject<StudioAutosaveRecoveryCandidate | null>;
  readonly clearAutosaveRecord: () => void;
}

/**
 * 복구 배너의 "비우기".
 *
 * 이 버튼은 브라우저가 죽었을 때 남은 **유일한 사본**을 localStorage·OPFS·SQLite 에서
 * 한꺼번에 지운다. 히스토리 커밋이 아니라 ⌘Z 로도 돌아오지 않는데, 예전에는 확인 한 번
 * 없이 클릭 즉시 실행됐다 — 훨씬 덜 위험한 페이지 삭제에는 확인 모달이 있는데도.
 * 파괴 승인 seam(되돌릴 수 없음 등급)에 태우고 무엇이 몇 개 사라지는지 먼저 보여준다.
 * (StudioPage 의 clearAutosave 본문 — verbatim 이동.)
 */
export async function requestStudioAutosaveClear(
  ctx: StudioClearAutosaveContext
): Promise<void> {
  const { autosaveRecoveryCandidateRef, clearAutosaveRecord } = ctx;
    const saved = autosaveRecoveryCandidateRef.current;
    const savedPages = saved?.payload.pagesList ?? [];
    const savedAt = saved ? new Date(saved.savedAt) : null;
    const savedAtLabel =
      savedAt && Number.isFinite(savedAt.getTime())
        ? savedAt.toLocaleString("ko-KR")
        : undefined;
    const request = studioClearAutosaveRequest({
      pageCount: savedPages.length,
      elementCount: savedPages.reduce(
        (total, page) => total + (page.elements?.length ?? 0),
        0,
      ),
      ...(savedAtLabel ? { savedAtLabel } : {}),
    });
    // runStudioDestructiveAction 이 승인·실행·결과 고지를 한 흐름으로 묶는다 — 거절도
    // 실패도 원장에 남으므로 "눌렀는데 아무 일도 없다"가 생기지 않는다.
    await runStudioDestructiveAction({
      request,
      execute: () => {
        clearAutosaveRecord();
      },
    });
}

/** JSON 백업 내려받기가 읽는 페이지 소유 상태. */
export interface StudioAutosaveBackupContext {
  readonly autosaveRecoveryCandidateRef: MutableRefObject<StudioAutosaveRecoveryCandidate | null>;
  readonly setError: (message: string | null) => void;
  readonly title: string;
}

/**
 * 조정된 내구 후보를 그대로 JSON 으로 내려받는다 — 브라우저 미러를 다시 읽지 않는다.
 * (StudioPage 의 downloadAutosaveBackup 본문 — verbatim 이동.)
 */
export function downloadStudioAutosaveBackup(ctx: StudioAutosaveBackupContext): void {
  const { autosaveRecoveryCandidateRef, setError, title } = ctx;
    try {
      const saved = autosaveRecoveryCandidateRef.current;
      if (!saved) {
        setError("내려받을 임시저장 데이터를 찾지 못했어요.");
        return;
      }
      const blob = new Blob([serializeStudioAutosave(saved.payload)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(title.trim() || "toonspectrum-autosave").replace(/[\\/:*?"<>|]+/g, "-")}-autosave.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setError(null);
    } catch {
      setError("임시저장 JSON 백업을 만들지 못했어요.");
    }
}
