import { confirmStudioDestructiveAction } from "../studio-destructive-action-preview";
import {
  settleStudioDestructiveCommit,
  studioQuickComicReplaceRequest,
  studioSceneSnapshotReplaceRequest,
  studioStartFromExampleRequest,
} from "../studio-destructive-command-catalog";
import { comipoSeedsToEls } from "../studio-page-comipo-seeds";
import {
  loadStudioComipoAssembly,
  type StudioComipoAssemblyModule,
} from "../studio-page-lazy-ui";
import { pageDisplayName } from "../studio-page-meta";
import {
  QUICK_SAMPLE_CANVAS_H,
  createQuickSampleFrames,
} from "../studio-page-shell-runtime";

import type { TemplateSpec } from "../studio-assets";
import type { ComipoAssemblyInput } from "../studio-comipo-assembly";
import type { StudioEditorMutationTicket } from "../studio-editor-scope";
import type { StudioMenu, Tool } from "../studio-editor-tool-model";
import type { El } from "../studio-element-model";
import type { PageState } from "../studio-page-state";
import type { StudioSceneSnapshot } from "../studio-scene-snapshot-library";

export interface StudioQuickComicOptions {
  elements: El[];
  pages: PageState[];
  activePage: PageState;
  activePageIndex: number;
  collaborationDocumentLocked: boolean;
  collaborationLockMessage: () => string;
  pagesHistoryRef: React.MutableRefObject<PageState[][]>;
  pagesHiRef: React.MutableRefObject<number>;
  comipoActionBusyRef: React.MutableRefObject<boolean>;
  captureStudioMutationTicket: () => StudioEditorMutationTicket;
  canApplyStudioMutation: (ticket: StudioEditorMutationTicket) => boolean;
  setCanvasH: (h: number) => void;
  setBg: (bg: string) => void;
  setBgGrad: (grad: string[] | null) => void;
  setWebtoonTheme: (theme: "soft" | "classic" | "vivid") => void;
  setCurrentTemplate: (tpl: TemplateSpec | null) => void;
  setTool: (tool: Tool) => void;
  setMenu: (menu: StudioMenu | null) => void;
  setSelectedId: (id: string | null) => void;
  setMarqueeIds: (ids: string[]) => void;
  setQuickComicOpen: (open: boolean) => void;
  setSceneSnapshotOpen: (open: boolean) => void;
  dismissQuickStart: () => void;
  commit: (els: El[]) => boolean;
  commitPages: (pages: PageState[]) => boolean;
  undo: () => void;
  announceDrawingShortcut: (msg: string) => void;
  setError: (err: string | null) => void;
}

export function useStudioQuickComic(options: StudioQuickComicOptions) {
  const {
    elements,
    pages,
    activePage,
    activePageIndex,
    collaborationDocumentLocked,
    collaborationLockMessage,
    pagesHistoryRef,
    pagesHiRef,
    comipoActionBusyRef,
    captureStudioMutationTicket,
    canApplyStudioMutation,
    setCanvasH,
    setBg,
    setBgGrad,
    setWebtoonTheme,
    setCurrentTemplate,
    setTool,
    setMenu,
    setSelectedId,
    setMarqueeIds,
    setQuickComicOpen,
    setSceneSnapshotOpen,
    dismissQuickStart,
    commit,
    commitPages,
    undo,
    announceDrawingShortcut,
    setError,
  } = options;

  function captureDeferredComipoAction() {
    return {
      mutationTicket: captureStudioMutationTicket(),
      history: pagesHistoryRef.current,
      historyIndex: pagesHiRef.current,
    };
  }

  function canApplyDeferredComipoAction(
    action: ReturnType<typeof captureDeferredComipoAction>
  ): boolean {
    if (!canApplyStudioMutation(action.mutationTicket)) return false;
    if (
      pagesHistoryRef.current !== action.history ||
      pagesHiRef.current !== action.historyIndex
    ) {
      setError("원고가 바뀌어 오래된 템플릿 결과를 적용하지 않았어요. 다시 실행해 주세요.");
      return false;
    }
    return true;
  }

  async function applyQuickComicInput(input: ComipoAssemblyInput) {
    if (collaborationDocumentLocked) {
      setError(collaborationLockMessage());
      return;
    }
    if (comipoActionBusyRef.current) return;
    const quickComicRequest = studioQuickComicReplaceRequest(elements.length);
    if (elements.length > 0 && !(await confirmStudioDestructiveAction(quickComicRequest))) {
      return;
    }

    const deferredAction = captureDeferredComipoAction();
    comipoActionBusyRef.current = true;
    try {
      const { assembleComipoPage } = await loadStudioComipoAssembly();
      if (!canApplyDeferredComipoAction(deferredAction)) return;
      const assembled = assembleComipoPage(input);
      if (!assembled?.composable) {
        setError("컷 안에 장면과 대사를 배치하지 못했어요. 이전 단계에서 구성을 조정해 주세요.");
        return;
      }
      setCanvasH(assembled.canvasH);
      setBg("#ffffff");
      setBgGrad(null);
      setWebtoonTheme("soft");
      setCurrentTemplate(null);
      setTool("select");
      setMenu(null);
      setSelectedId(null);
      if (
        !settleStudioDestructiveCommit(
          quickComicRequest,
          commit(comipoSeedsToEls(assembled.seeds)),
          undo
        )
      ) return;
      setQuickComicOpen(false);
      announceDrawingShortcut(
        `빠른 웹툰 완성 · ${assembled.frameCount}컷 · 말풍선 ${assembled.bubbleCount}개`
      );
    } catch (error) {
      console.error("Failed to apply the Quick Comic assembly:", error);
      if (canApplyDeferredComipoAction(deferredAction)) {
        setError("빠른 웹툰 조립 엔진을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      comipoActionBusyRef.current = false;
    }
  }

  async function applySceneSnapshot(snapshot: StudioSceneSnapshot) {
    if (collaborationDocumentLocked) {
      setError(collaborationLockMessage());
      return;
    }
    const sceneSnapshotRequest = studioSceneSnapshotReplaceRequest({
      pageName: pageDisplayName(activePage, activePageIndex),
      sceneName: snapshot.name,
      currentElementCount: activePage.elements.length,
      incomingElementCount: snapshot.page.elements.length,
    });
    if (!(await confirmStudioDestructiveAction(sceneSnapshotRequest))) return;
    const restoredPage: PageState = {
      ...snapshot.page,
      id: activePage.id,
    };
    const nextPages = pages.map((page) =>
      page.id === activePage.id ? restoredPage : page
    );
    if (
      !settleStudioDestructiveCommit(
        sceneSnapshotRequest,
        commitPages(nextPages),
        undo
      )
    ) return;
    setWebtoonTheme(snapshot.theme);
    setSelectedId(null);
    setMarqueeIds([]);
    setTool("select");
    setMenu(null);
    setSceneSnapshotOpen(false);
    announceDrawingShortcut(
      `장면 스냅샷 적용 · ${snapshot.name} · 레이어 ${restoredPage.elements.length}개`
    );
  }

  async function startFromExample() {
    if (collaborationDocumentLocked) {
      setError(collaborationLockMessage());
      return;
    }
    if (comipoActionBusyRef.current) return;
    const exampleRequest = studioStartFromExampleRequest(elements.length);
    if (elements.length > 0 && !(await confirmStudioDestructiveAction(exampleRequest))) return;

    const deferredAction = captureDeferredComipoAction();
    comipoActionBusyRef.current = true;
    let assembled: ReturnType<StudioComipoAssemblyModule["assembleComipoPage"]> = null;
    try {
      const { assembleComipoPage } = await loadStudioComipoAssembly();
      if (!canApplyDeferredComipoAction(deferredAction)) return;
      assembled = assembleComipoPage({
        layoutId: "layout_talk_2_bubbles",
        sceneTemplateId: "confession",
        dialogueScript: "민수: 스튜디오에 오신 걸 환영해요!\n지영: 3D 캐릭터·말풍선·컷 템플릿을 바로 써 보세요.",
      });
    } catch (error) {
      console.error("Failed to load the Studio example assembler:", error);
      if (!canApplyDeferredComipoAction(deferredAction)) return;
      setError("고급 예시 장면을 불러오지 못해 기본 컷으로 시작했어요.");
    } finally {
      comipoActionBusyRef.current = false;
    }
    if (!assembled) {
      setCanvasH(QUICK_SAMPLE_CANVAS_H);
      setBg("#ffffff");
      setBgGrad(null);
      setWebtoonTheme("soft");
      setTool("select");
      setMenu(null);
      setSelectedId(null);
      settleStudioDestructiveCommit(
        exampleRequest,
        commit([...createQuickSampleFrames()]),
        undo
      );
      dismissQuickStart();
      return;
    }
    if (!assembled.composable) {
      setError("예시 페이지를 조립하지 못했습니다. 레이아웃을 다시 시도해 주세요.");
      return;
    }
    const sample: El[] = comipoSeedsToEls(assembled.seeds);

    setCanvasH(assembled.canvasH);
    setBg("#ffffff");
    setBgGrad(null);
    setWebtoonTheme("soft");
    setTool("select");
    setMenu(null);
    setSelectedId(null);
    settleStudioDestructiveCommit(exampleRequest, commit(sample), undo);
    dismissQuickStart();
  }

  return {
    captureDeferredComipoAction,
    canApplyDeferredComipoAction,
    applyQuickComicInput,
    applySceneSnapshot,
    startFromExample,
  };
}
