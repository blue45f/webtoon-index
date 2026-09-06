import { CANVAS_W } from "../studio-assets";
import { uid } from "../studio-id";
import { createBlankPage } from "../studio-pages";
import { STUDIO_PROJECT_MAX_PAGES } from "../studio-project-file";

import { loadStudioPsdImportModule } from "./studio-document-export-loaders";

import type {
  PendingStudioInterchangeImport,
  StudioInterchangeImportChoice,
} from "../studio-document-interchange-commit";
import type { StudioEditorMutationTicket } from "../studio-editor-scope";
import type { PageState } from "../studio-page-state";
import type { PendingStudioWillV1Import } from "../studio-will-v1-import-bridge";
import type { ChangeEvent } from "react";

export interface StudioInterchangeImportStatus {
  readonly tone: "good" | "warn" | "bad";
  readonly text: string;
}

/**
 * Everything the ORA/CBZ/WILL/PSD import flows read from the editor. Extends the
 * useStudioProjectArchiveOrchestration seam: a factory receives an explicit input object and
 * returns the handlers, while epoch/abort exclusivity keeps living in StudioPage refs so a
 * re-render never resets an in-flight inspection.
 */
export interface StudioInterchangeImportOrchestrationInput {
  readonly interchangeImportBusy: boolean;
  readonly psdImportBusy: boolean;
  readonly pages: PageState[];
  readonly activePage: PageState;
  readonly master: { readonly elements: readonly { readonly id: string }[] };
  readonly isMobile: boolean;
  readonly collaborationDocumentLocked: boolean;
  readonly activePageMutationLocked: boolean;
  readonly pendingInterchangeImport:
    PendingStudioInterchangeImport | PendingStudioWillV1Import | null;
  readonly interchangeImportChoice: StudioInterchangeImportChoice;
  readonly willImportChoice: StudioInterchangeImportChoice | null;
  readonly documentImportEpochRef: { current: number };
  readonly documentImportOperationRef: {
    current: {
      readonly epoch: number;
      readonly kind: "archive-apply" | "archive-inspect" | "psd-inspect";
    } | null;
  };
  readonly interchangeImportAbortRef: { current: AbortController | null };
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  readonly canApplyStudioMutation: (ticket: StudioEditorMutationTicket) => boolean;
  readonly commitPages: (nextPages: PageState[]) => boolean;
  readonly setCurrentPageId: (next: string) => void;
  readonly setError: (message: string | null) => void;
  readonly setInterchangeImportBusy: (busy: boolean) => void;
  readonly setInterchangeImportStatus: (
    status: StudioInterchangeImportStatus | null
  ) => void;
  readonly setPsdImportBusy: (busy: boolean) => void;
  readonly setPsdImportStatus: (
    status: { readonly tone: "good" | "warn"; readonly text: string } | null
  ) => void;
  readonly setPendingInterchangeImport: (
    pending: PendingStudioInterchangeImport | PendingStudioWillV1Import | null
  ) => void;
  readonly setInterchangeImportChoice: (
    choice: StudioInterchangeImportChoice
  ) => void;
  readonly setWillImportChoice: (
    choice: StudioInterchangeImportChoice | null
  ) => void;
  readonly setProjectActionsOpen: (open: boolean) => void;
}

export interface StudioInterchangeImportOrchestration {
  readonly cancelInterchangeImport: () => void;
  readonly handleImportInterchangeArchive: (
    e: ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
  readonly handleImportPsd: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  readonly dismissPendingInterchangeImport: () => void;
  readonly applyPendingInterchangeImport: (
    selectedChoiceId?: string | null
  ) => Promise<void>;
}

/**
 * Document interchange import flows extracted from StudioPage. Behavior-identical move: the
 * bodies below are verbatim (only relative dynamic-import specifiers changed for the export/
 * directory), with dependencies received through {@link input} instead of component closure.
 */
export function createStudioInterchangeImportOrchestration(
  input: StudioInterchangeImportOrchestrationInput,
): StudioInterchangeImportOrchestration {
  const {
    interchangeImportBusy,
    psdImportBusy,
    pages,
    activePage,
    master,
    isMobile,
    collaborationDocumentLocked,
    activePageMutationLocked,
    pendingInterchangeImport,
    interchangeImportChoice,
    willImportChoice,
    documentImportEpochRef,
    documentImportOperationRef,
    interchangeImportAbortRef,
    captureStudioMutationTicket,
    canApplyStudioMutation,
    commitPages,
    setCurrentPageId,
    setError,
    setInterchangeImportBusy,
    setInterchangeImportStatus,
    setPsdImportBusy,
    setPsdImportStatus,
    setPendingInterchangeImport,
    setInterchangeImportChoice,
    setWillImportChoice,
    setProjectActionsOpen,
  } = input;

  function cancelInterchangeImport() {
    documentImportEpochRef.current += 1;
    const activeOperation = documentImportOperationRef.current;
    if (activeOperation?.kind === "archive-inspect" || activeOperation?.kind === "archive-apply") {
      documentImportOperationRef.current = null;
    }
    interchangeImportAbortRef.current?.abort();
    interchangeImportAbortRef.current = null;
    setInterchangeImportBusy(false);
    setInterchangeImportStatus({ tone: "warn", text: "문서 안전 검사를 취소했어요." });
  }

  async function handleImportInterchangeArchive(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (
      !file ||
      interchangeImportBusy ||
      psdImportBusy ||
      documentImportOperationRef.current !== null
    ) return;
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (extension !== ".ora" && extension !== ".cbz" && extension !== ".will") {
      setInterchangeImportStatus({
        tone: "bad",
        text: "이 경로에서는 OpenRaster(.ora), Comic Book ZIP(.cbz), bounded WILL v1(.will)만 가져올 수 있어요.",
      });
      return;
    }

    if (extension === ".cbz" && pages.length >= STUDIO_PROJECT_MAX_PAGES) {
      setInterchangeImportStatus({
        tone: "bad",
        text: `프로젝트 저장 한도 ${STUDIO_PROJECT_MAX_PAGES}페이지에 도달했어요. 기존 페이지를 정리한 뒤 CBZ를 가져와 주세요.`,
      });
      return;
    }

    interchangeImportAbortRef.current?.abort();
    const importEpoch = documentImportEpochRef.current + 1;
    documentImportEpochRef.current = importEpoch;
    documentImportOperationRef.current = { epoch: importEpoch, kind: "archive-inspect" };
    const controller = new AbortController();
    interchangeImportAbortRef.current = controller;
    setInterchangeImportBusy(true);
    setInterchangeImportStatus({
      tone: "warn",
      text: extension === ".ora"
        ? "OpenRaster 구조·PNG·메모리 예산을 검사하는 중…"
        : extension === ".cbz"
          ? "CBZ 페이지 순서·이미지 header·메모리 예산을 검사하는 중…"
          : "전용 Worker에서 bounded WILL v1 구조·경로·메모리 예산을 검사하는 중…",
    });
    try {
      if (extension === ".will") {
        const { inspectStudioWillV1Import } = await import("../studio-will-v1-import-bridge"
        );
        const inspected = await inspectStudioWillV1Import(file, file.name, {
          canvasWidth: CANVAS_W,
          currentPageElementCount: activePage.elements.length,
          canAddPage: pages.length < STUDIO_PROJECT_MAX_PAGES,
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          interchangeImportAbortRef.current !== controller ||
          documentImportEpochRef.current !== importEpoch
        ) return;
        setPendingInterchangeImport(inspected);
        setWillImportChoice(null);
        setInterchangeImportStatus({
          tone: inspected.preview.constraints?.some(({ gate }) => gate === "blocking")
            ? "bad"
            : inspected.adaptations.length > 0 || inspected.skipped.length > 0
              ? "warn"
              : "good",
          text: `WILL v1 경로 ${inspected.result.paths.length.toLocaleString("ko-KR")}개를 검증했어요. 적용 위치와 변환 손실을 직접 확인해 주세요.`,
        });
        setProjectActionsOpen(false);
        return;
      }
      const [
        { studioDocumentImportDeviceProfile },
        { inspectStudioDocumentInterchangeArchive },
      ] = await Promise.all([
        import("../studio-document-import-device-profile"),
        import("../studio-document-interchange-commit"),
      ]);
      const deviceProfile = studioDocumentImportDeviceProfile(isMobile, pages.length);
      const inspected = await inspectStudioDocumentInterchangeArchive(file, {
        extension,
        signal: controller.signal,
        canvasWidth: CANVAS_W,
        maxEmbeddedBytes: deviceProfile.maxEmbeddedBytes,
        currentPageCount: pages.length,
        canAddPage: pages.length < STUDIO_PROJECT_MAX_PAGES,
        openRasterLimits: deviceProfile.openRasterLimits,
        cbzLimits: deviceProfile.cbzLimits,
      });
      if (
        controller.signal.aborted ||
        interchangeImportAbortRef.current !== controller ||
        documentImportEpochRef.current !== importEpoch
      ) return;
      setPendingInterchangeImport(inspected.pending);
      setInterchangeImportChoice(inspected.choice);
      setInterchangeImportStatus(inspected.status);
      setProjectActionsOpen(false);
    } catch (cause) {
      if (controller.signal.aborted || documentImportEpochRef.current !== importEpoch) return;
      const message = cause instanceof Error ? cause.message : "문서 파일을 안전하게 검사하지 못했어요.";
      setInterchangeImportStatus({ tone: "bad", text: message });
      setError(message);
    } finally {
      if (
        interchangeImportAbortRef.current === controller &&
        documentImportOperationRef.current?.kind === "archive-inspect" &&
        documentImportOperationRef.current.epoch === importEpoch
      ) {
        documentImportOperationRef.current = null;
        interchangeImportAbortRef.current = null;
        setInterchangeImportBusy(false);
      }
    }
  }

  // PSD 레이어 가져오기 — ag-psd로 파싱한 뒤 공통 손실 미리보기에서 해상도·편집성·프로젝트
  // 포함 예산과 새 페이지/현재 페이지 배치를 명시적으로 확인하고 적용한다.
  async function handleImportPsd(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (
      !file ||
      psdImportBusy ||
      interchangeImportBusy ||
      documentImportOperationRef.current !== null
    ) return;
    interchangeImportAbortRef.current?.abort();
    interchangeImportAbortRef.current = null;
    const importEpoch = documentImportEpochRef.current + 1;
    documentImportEpochRef.current = importEpoch;
    documentImportOperationRef.current = { epoch: importEpoch, kind: "psd-inspect" };
    const mutationTicket = captureStudioMutationTicket();
    setPsdImportBusy(true);
    setPsdImportStatus(null);
    try {
      const [
        { importPsdFile, psdImportResultMessage },
        { createStudioPsdImportLossPreview },
        { studioDocumentImportDeviceProfile },
      ] = await Promise.all([
        loadStudioPsdImportModule(),
        import("../studio-document-interchange-preview"),
        import("../studio-document-import-device-profile"),
      ]);
      const deviceProfile = studioDocumentImportDeviceProfile(isMobile, pages.length);
      const result = await importPsdFile(file, CANVAS_W);
      if (documentImportEpochRef.current !== importEpoch) return;
      if (!canApplyStudioMutation(mutationTicket)) return;
      if (result.elements.length === 0) {
        setPsdImportStatus({ tone: "warn", text: psdImportResultMessage(result) });
        return;
      }
      const preview = createStudioPsdImportLossPreview(file.name, result, {
        canvasWidth: CANVAS_W,
        maxEmbeddedBytes: deviceProfile.maxEmbeddedBytes,
        currentPageCount: pages.length,
      });
      setPendingInterchangeImport({ kind: "psd", fileName: file.name, result, preview });
      setInterchangeImportChoice(
        pages.length >= STUDIO_PROJECT_MAX_PAGES ? "current-page" : "new-page",
      );
      setProjectActionsOpen(false);
      setPsdImportStatus({
        tone: "warn",
        text: `${psdImportResultMessage(result)} · 적용 전 편집성 손실과 배치 방식을 확인해 주세요.`,
      });
    } catch (err) {
      if (documentImportEpochRef.current !== importEpoch) return;
      setPsdImportStatus({
        tone: "warn",
        text: err instanceof Error ? err.message : "PSD 파일을 읽지 못했어요.",
      });
    } finally {
      if (
        documentImportOperationRef.current?.kind === "psd-inspect" &&
        documentImportOperationRef.current.epoch === importEpoch
      ) {
        documentImportOperationRef.current = null;
        setPsdImportBusy(false);
      }
    }
  }

  function dismissPendingInterchangeImport() {
    if (interchangeImportBusy) {
      cancelInterchangeImport();
      return;
    }
    setPendingInterchangeImport(null);
    setWillImportChoice(null);
  }

  async function applyPendingInterchangeImport(selectedChoiceId?: string | null) {
    const pending = pendingInterchangeImport;
    if (
      !pending ||
      interchangeImportBusy ||
      collaborationDocumentLocked ||
      documentImportOperationRef.current !== null
    ) return;
    const requestedChoice: StudioInterchangeImportChoice | null =
      selectedChoiceId === "current-page"
        ? "current-page"
        : selectedChoiceId === "new-page"
          ? "new-page"
          : pending.kind === "will-v1"
            ? willImportChoice
            : interchangeImportChoice;
    if (pending.kind === "will-v1" && requestedChoice === null) {
      setInterchangeImportStatus({
        tone: "bad",
        text: "WILL v1을 새 페이지 또는 현재 페이지 중 어디에 추가할지 먼저 선택해 주세요.",
      });
      return;
    }
    const applyChoice: StudioInterchangeImportChoice =
      requestedChoice ?? interchangeImportChoice;
    const anchorPageId = activePage.id;
    if (
      pending.kind !== "cbz" &&
      applyChoice === "new-page" &&
      pages.length >= STUDIO_PROJECT_MAX_PAGES
    ) {
      setInterchangeImportStatus({
        tone: "bad",
        text: `프로젝트 저장 한도 ${STUDIO_PROJECT_MAX_PAGES}페이지에 도달했어요. 현재 페이지 위에 배치하거나 기존 페이지를 정리해 주세요.`,
      });
      return;
    }
    if (
      pending.kind === "cbz" &&
      pages.length > STUDIO_PROJECT_MAX_PAGES - pending.result.pages.length
    ) {
      setInterchangeImportStatus({
        tone: "bad",
        text: `CBZ를 추가하면 프로젝트 저장 한도 ${STUDIO_PROJECT_MAX_PAGES}페이지를 넘습니다. 파일을 나누거나 기존 페이지를 정리해 주세요.`,
      });
      return;
    }
    if (applyChoice === "current-page" && activePageMutationLocked) {
      setInterchangeImportStatus({
        tone: "bad",
        text: "현재 페이지가 검토 잠금 상태라 레이어를 추가할 수 없어요. 새 페이지로 가져와 주세요.",
      });
      return;
    }

    interchangeImportAbortRef.current?.abort();
    const applyEpoch = documentImportEpochRef.current + 1;
    documentImportEpochRef.current = applyEpoch;
    documentImportOperationRef.current = { epoch: applyEpoch, kind: "archive-apply" };
    const controller = new AbortController();
    interchangeImportAbortRef.current = controller;
    const mutationTicket = captureStudioMutationTicket();
    setInterchangeImportBusy(true);
    setInterchangeImportStatus({ tone: "warn", text: "검증된 이미지와 레이어를 문서에 적용하는 중…" });
    const commitImportedPages = (nextPages: PageState[]): boolean => {
      if (commitPages(nextPages)) return true;
      setInterchangeImportStatus({
        tone: "bad",
        text: "적용 직전에 문서 상태가 바뀌어 가져오기를 멈췄어요. 손실 확인 창에서 다시 시도해 주세요.",
      });
      return false;
    };
    const canCommitImport = (): boolean => {
      if (canApplyStudioMutation(mutationTicket)) return true;
      setInterchangeImportStatus({
        tone: "bad",
        text: "검사하는 동안 다른 편집이 반영되어 가져오기를 멈췄어요. 최신 문서에서 다시 시도해 주세요.",
      });
      return false;
    };
    try {
      if (pending.kind === "will-v1") {
        const { prepareStudioWillV1ImportCommit } = await import("../studio-will-v1-import-bridge"
        );
        const draft = prepareStudioWillV1ImportCommit(pending, {
          destination: applyChoice,
          currentPageElementCount: activePage.elements.length,
          existingElementIds: new Set([
            ...pages.flatMap((page) => page.elements.map(({ id }) => id)),
            ...master.elements.map(({ id }) => id),
          ]),
        });
        if (!canCommitImport()) return;
        let nextPages: PageState[];
        let selectedPageId: string | null = null;
        if (applyChoice === "current-page") {
          nextPages = pages.map((page) => page.id === anchorPageId
            ? {
                ...page,
                canvasH: Math.max(page.canvasH, draft.pageHeight),
                elements: [...page.elements, ...draft.elements],
              }
            : page);
        } else {
          const page = {
            ...createBlankPage(uid, draft.pageHeight),
            name: draft.title,
            elements: [...draft.elements],
          } as PageState;
          const anchorIndex = pages.findIndex(({ id }) => id === anchorPageId);
          if (anchorIndex < 0) {
            throw new Error("WILL v1을 추가할 기준 페이지를 찾지 못했어요.");
          }
          nextPages = [...pages];
          nextPages.splice(anchorIndex + 1, 0, page);
          selectedPageId = page.id;
        }
        if (!commitImportedPages(nextPages)) return;
        if (selectedPageId) setCurrentPageId(selectedPageId);
        setInterchangeImportStatus(draft.status);
        setPendingInterchangeImport(null);
        setWillImportChoice(null);
        setError(null);
        return;
      }
      const [
        { prepareStudioDocumentInterchangeCommit },
        { studioDocumentImportDeviceProfile },
      ] = await Promise.all([
        import("../studio-document-interchange-commit"),
        import("../studio-document-import-device-profile"),
      ]);
      const deviceProfile = studioDocumentImportDeviceProfile(isMobile, pages.length);
      const draft = await prepareStudioDocumentInterchangeCommit(pending, {
        pages,
        anchorPageId,
        choice: applyChoice,
        canvasWidth: CANVAS_W,
        createId: uid,
        createBlankPage: (createId, canvasHeight) => (
          createBlankPage(createId, canvasHeight) as PageState
        ),
        maxEmbeddedBytes: deviceProfile.maxEmbeddedBytes,
        signal: controller.signal,
      });
      if (!canCommitImport()) return;
      if (!commitImportedPages(draft.pages)) return;
      if (draft.selectedPageId) setCurrentPageId(draft.selectedPageId);
      setInterchangeImportStatus(draft.status);
      if (draft.psdStatus) setPsdImportStatus(draft.psdStatus);
      setPendingInterchangeImport(null);
      setError(null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "문서 가져오기를 적용하지 못했어요.";
      setInterchangeImportStatus({ tone: "bad", text: message });
      setError(message);
    } finally {
      if (
        interchangeImportAbortRef.current === controller &&
        documentImportOperationRef.current?.kind === "archive-apply" &&
        documentImportOperationRef.current.epoch === applyEpoch
      ) {
        documentImportOperationRef.current = null;
        interchangeImportAbortRef.current = null;
        setInterchangeImportBusy(false);
      }
    }
  }

  return {
    cancelInterchangeImport,
    handleImportInterchangeArchive,
    handleImportPsd,
    dismissPendingInterchangeImport,
    applyPendingInterchangeImport,
  };
}
