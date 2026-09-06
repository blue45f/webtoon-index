import { useEffect, useRef, useState, type RefObject } from "react";

import { remapStudioBg3dLtCopiedBundles } from "./bg3d/studio-bg3d-lt-copy-remap";
import { hasTrack, normalizeAnimationTimelineDoc } from "./studio-anim-tracks";
import { CANVAS_W } from "./studio-assets";
import {
  isStudioPasteScopeCurrent,
  shouldHandleStudioEditEvent,
} from "./studio-edit-controls";
import { uid } from "./studio-id";
import { createLayerGroup, missingLayerGroupIds, type LayerGroup } from "./studio-layers";
import { loadStudioCanvasImageFile } from "./studio-legacy-editor-runtime-helpers";
import {
  buildClipboardPayload,
  clipboardPayloadMatchesMembers,
  collectCopyElements,
  parseClipboardPayload,
  planClipboardPaste,
  readClipboardFallback,
  serializeClipboardPayload,
  studioClipboardFallbackStorageKey,
  withPageMeta,
  writeClipboardFallback,
  type StudioClipboardPayload,
} from "./studio-page-meta";
import { withShotTag } from "./studio-panel-shot-tags";

import type { AnimationTimelineDoc } from "./studio-anim-tracks";
import type { StudioEditorMutationTicket } from "./studio-editor-scope";
import type { Tool } from "./studio-editor-tool-model";
import type { El, ImageEl } from "./studio-element-model";
import type { CanvasImagePlacement } from "./studio-image-placement";
import type { PageState } from "./studio-page-state";
import type { StudioPublishAiProvenance } from "./studio-publish-preflight";

export interface UseStudioPageClipboardOptions {
  readonly activePage: PageState;
  readonly pages: PageState[];
  readonly masterEditMode: boolean;
  readonly activeSurfaceReviewLocked: boolean;
  readonly activeSurfaceReviewLockedRef: RefObject<boolean>;
  readonly collaborationDocumentLocked: boolean;
  readonly collaborationLockMessage: () => string;
  readonly elements: El[];
  readonly selectedId: string | null;
  readonly marqueeIds: string[];
  readonly groups: LayerGroup[];
  readonly animTimeline: AnimationTimelineDoc;
  readonly canvasH: number;
  readonly editing: { id: string } | null;
  readonly timelapseCapturing: boolean;
  readonly studioAuthUserId: string | null;
  readonly workId: string | null;
  readonly currentPageIdRef: RefObject<string>;
  readonly masterEditModeRef: RefObject<boolean>;
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  readonly canApplyStudioMutation: (ticket: StudioEditorMutationTicket) => boolean;
  readonly deleteLayerElements: (ids: string[]) => boolean;
  readonly commit: (
    nextElements: El[],
    extraPatch?: Partial<Omit<PageState, "id" | "elements">>,
  ) => boolean;
  readonly commitPages: (nextPages: PageState[]) => boolean;
  readonly nextAssetInsertionPlacement: () => CanvasImagePlacement;
  readonly addRenderedImage: (
    src: string,
    width: number,
    height: number,
    aiProvenance?: StudioPublishAiProvenance,
    isAnimatedGif?: boolean,
    elementPatch?: Partial<ImageEl> & { name?: string },
    placement?: CanvasImagePlacement,
  ) => boolean;
  readonly setMarqueeIds: (ids: string[]) => void;
  readonly setSelectedId: (id: string | null) => void;
  readonly setTool: (tool: Tool) => void;
  readonly announceDrawingShortcut: (text: string) => void;
  readonly setError: (error: string | null) => void;
}

export function useStudioPageClipboard({
  activePage,
  pages,
  masterEditMode,
  activeSurfaceReviewLocked,
  activeSurfaceReviewLockedRef,
  collaborationDocumentLocked,
  collaborationLockMessage,
  elements,
  selectedId,
  marqueeIds,
  groups,
  animTimeline,
  canvasH,
  editing,
  timelapseCapturing,
  studioAuthUserId,
  workId,
  currentPageIdRef,
  masterEditModeRef,
  captureStudioMutationTicket,
  canApplyStudioMutation,
  deleteLayerElements,
  commit,
  commitPages,
  nextAssetInsertionPlacement,
  addRenderedImage,
  setMarqueeIds,
  setSelectedId,
  setTool,
  announceDrawingShortcut,
  setError,
}: UseStudioPageClipboardOptions) {
  const [metaEditPageId, setMetaEditPageId] = useState<string | null>(null);

  function commitPageMeta(pageId: string, patch: { name?: string | null; note?: string | null }) {
    const next = withPageMeta(pages, pageId, patch);
    if (next !== pages) commitPages(next);
  }

  function commitShotTag(
    pageId: string,
    patch: { shotType?: string | null; cameraAngle?: string | null },
  ) {
    const next = withShotTag(pages, pageId, patch);
    if (next !== pages) commitPages(next);
  }

  const pasteSeqRef = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  const studioClipboardPayloadRef = useRef<StudioClipboardPayload | null>(null);
  const studioClipboardScopeKey = studioClipboardFallbackStorageKey({
    authScopeKey: studioAuthUserId,
    workId,
  });
  const studioClipboardScopeRef = useRef(studioClipboardScopeKey);
  if (studioClipboardScopeRef.current !== studioClipboardScopeKey) {
    studioClipboardScopeRef.current = studioClipboardScopeKey;
    studioClipboardPayloadRef.current = null;
    pasteSeqRef.current = { key: "", count: 0 };
  }

  function studioClipboardSessionStorage(): Storage | null {
    try {
      return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
    } catch {
      return null;
    }
  }

  function captureSelectedStudioClipboard(): {
    payload: StudioClipboardPayload;
    memberIds: string[];
  } | null {
    const members = collectCopyElements(elements, selectedId, marqueeIds);
    if (members.length === 0) return null;
    const memberIds = members.map((member) => member.id);
    const expectedGroupIds = masterEditMode
      ? []
      : [
          ...new Set(
            members.flatMap((member) =>
              member.groupId && groups.some((group) => group.id === member.groupId)
                ? [member.groupId]
                : [],
            ),
          ),
        ];
    const expectedTrackIds = masterEditMode
      ? []
      : members
          .filter((member) => member.type === "image" && hasTrack(animTimeline, member.id))
          .map((member) => member.id);
    const payload = buildClipboardPayload(
      members,
      {
        canvasW: CANVAS_W,
        canvasH,
        pageId: activePage.id,
      },
      Date.now(),
      masterEditMode
        ? undefined
        : {
            groups,
            animationTimeline: animTimeline,
          },
    );
    if (
      !clipboardPayloadMatchesMembers(payload, memberIds, {
        groupIds: expectedGroupIds,
        trackIds: expectedTrackIds,
      })
    ) {
      setError("선택한 레이어 중 안전하게 복사할 수 없는 데이터가 있어 작업을 취소했습니다.");
      return null;
    }
    return {
      payload,
      memberIds,
    };
  }

  function persistStudioClipboardPayload(payload: StudioClipboardPayload) {
    studioClipboardPayloadRef.current = payload;
    writeClipboardFallback(studioClipboardSessionStorage(), payload, studioClipboardScopeKey);
    void globalThis.navigator?.clipboard?.writeText(serializeClipboardPayload(payload)).catch(() => {});
    pasteSeqRef.current = { key: "", count: 0 };
  }

  function copySelectedElements(): boolean {
    const captured = captureSelectedStudioClipboard();
    if (!captured) return false;
    persistStudioClipboardPayload(captured.payload);
    return true;
  }

  function cutSelectedElements(): boolean {
    if (activeSurfaceReviewLocked) return false;
    const captured = captureSelectedStudioClipboard();
    if (!captured) return false;
    persistStudioClipboardPayload(captured.payload);
    if (!deleteLayerElements(captured.memberIds)) return false;
    announceDrawingShortcut("잘라내기");
    return true;
  }

  function applyStudioClipboardPayload(
    payload: StudioClipboardPayload,
    placement: "cascade" | "in-place",
    announcement?: string,
  ): boolean {
    if (activeSurfaceReviewLocked) return false;
    const samePage = payload.source.pageId === activePage.id;
    const seqKey = `${payload.copiedAt}:${activePage.id}`;
    let nextPasteSequence: { key: string; count: number } | null = null;
    let offsetSteps: number | undefined;
    if (placement === "in-place") {
      offsetSteps = 0;
    } else if (samePage) {
      const count = pasteSeqRef.current.key === seqKey ? pasteSeqRef.current.count + 1 : 1;
      nextPasteSequence = { key: seqKey, count };
      offsetSteps = count;
    }
    const plan = planClipboardPaste(
      payload,
      { canvasW: CANVAS_W, canvasH, pageId: activePage.id },
      uid,
      offsetSteps === undefined ? undefined : { offsetSteps },
    );
    if (!plan) return false;
    const plannedElements = plan.els as unknown as El[];
    const insertedElements = remapStudioBg3dLtCopiedBundles(plannedElements, masterEditMode);
    const insertedGroupIds = new Set(
      insertedElements.flatMap((element) => (element.groupId ? [element.groupId] : [])),
    );
    const preservedPastedGroups = plan.groups.filter((group) => insertedGroupIds.has(group.id));
    const pastedGroups = masterEditMode
      ? []
      : [
          ...preservedPastedGroups,
          ...missingLayerGroupIds(insertedElements, [...groups, ...preservedPastedGroups]).map(
            (groupId, index) =>
              createLayerGroup(
                groupId,
                `붙여넣은 그룹 ${groups.length + preservedPastedGroups.length + index + 1}`,
              ),
          ),
        ];
    const hasPastedAnimationTracks = !masterEditMode && Object.keys(plan.animationTracks).length > 0;
    const nextAnimationTimeline = hasPastedAnimationTracks
      ? normalizeAnimationTimelineDoc({
          ...animTimeline,
          frameCount: Math.max(animTimeline.frameCount, plan.animationFrameCount ?? 1),
          tracks: { ...animTimeline.tracks, ...plan.animationTracks },
        })
      : animTimeline;
    const extraPatch: Partial<Omit<PageState, "id" | "elements">> = {
      ...(pastedGroups.length > 0 ? { groups: [...groups, ...pastedGroups] } : {}),
      ...(hasPastedAnimationTracks ? { animTimeline: nextAnimationTimeline } : {}),
    };
    if (
      !commit(
        [...elements, ...insertedElements],
        Object.keys(extraPatch).length > 0 ? extraPatch : undefined,
      )
    ) {
      return false;
    }
    if (nextPasteSequence) pasteSeqRef.current = nextPasteSequence;
    setMarqueeIds(plan.ids.length > 1 ? plan.ids : []);
    setSelectedId(plan.ids.length === 1 ? plan.ids[0] : null);
    setTool("select");
    announceDrawingShortcut(
      announcement ?? (placement === "in-place" ? "현재 위치에 붙여넣기" : "붙여넣기"),
    );
    return true;
  }

  async function pasteStudioElementsFromClipboard(placement: "cascade" | "in-place"): Promise<boolean> {
    if (activeSurfaceReviewLocked) {
      setError(
        collaborationDocumentLocked
          ? collaborationLockMessage()
          : "이 페이지는 검토 잠금 상태예요. 잠금을 해제한 뒤 붙여넣어 주세요.",
      );
      return false;
    }
    const mutationTicket = captureStudioMutationTicket();
    const targetPageId = activePage.id;
    const targetMasterEditMode = masterEditMode;

    let systemInspected = false;
    let unsupportedSystemContent = false;
    let systemPayload: StudioClipboardPayload | null = null;
    const clipboard = globalThis.navigator?.clipboard;
    try {
      if (clipboard && typeof clipboard.read === "function") {
        const items = await clipboard.read();
        systemInspected = true;
        for (const item of items) {
          if (item.types.includes("text/plain")) {
            const text = await (await item.getType("text/plain")).text();
            systemPayload = parseClipboardPayload(text);
            if (!systemPayload && text.trim()) unsupportedSystemContent = true;
          }
          if (item.types.some((type) => type.startsWith("image/"))) {
            unsupportedSystemContent = true;
          }
          if (systemPayload) break;
        }
      } else if (clipboard && typeof clipboard.readText === "function") {
        const text = await clipboard.readText();
        systemInspected = true;
        systemPayload = parseClipboardPayload(text);
        unsupportedSystemContent = !systemPayload && text.trim().length > 0;
      }
    } catch {
      // Clipboard read permission is optional. The in-memory/session fallback remains authoritative.
    }

    if (
      !isStudioPasteScopeCurrent({
        mutationAllowed: canApplyStudioMutation(mutationTicket),
        reviewLocked: activeSurfaceReviewLockedRef.current,
        targetPageId,
        currentPageId: currentPageIdRef.current,
        targetMasterEditMode,
        currentMasterEditMode: masterEditModeRef.current,
      })
    ) {
      announceDrawingShortcut("페이지나 원고 상태가 바뀌어 붙여넣기를 취소했습니다");
      return false;
    }

    if (systemPayload) return applyStudioClipboardPayload(systemPayload, placement);
    if (systemInspected && unsupportedSystemContent) {
      announceDrawingShortcut("외부 이미지·텍스트는 ⌘V 또는 이미지 파일 붙여넣기를 사용하세요");
      return false;
    }
    const fallback =
      studioClipboardPayloadRef.current ??
      readClipboardFallback(studioClipboardSessionStorage(), studioClipboardScopeKey);
    if (fallback) return applyStudioClipboardPayload(fallback, placement);
    announceDrawingShortcut("붙여넣을 Studio 요소가 없습니다");
    return false;
  }

  function duplicateSelected() {
    const captured = captureSelectedStudioClipboard();
    if (!captured) return;
    applyStudioClipboardPayload(captured.payload, "cascade", "복제");
  }

  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  useEffect(() => {
    pasteRef.current = (e: ClipboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.getAttribute("role") === "textbox");
      const insideShortcutBoundary =
        target !== null &&
        target.closest("[data-studio-shortcut-boundary='true'], [aria-modal='true']") !== null;
      const modalOpen =
        typeof document !== "undefined" &&
        [...document.querySelectorAll<HTMLElement>("[aria-modal='true']")].some(
          (modal) => !modal.hidden && !modal.inert && modal.getClientRects().length > 0,
        );
      if (
        !e.isTrusted ||
        !shouldHandleStudioEditEvent({
          defaultPrevented: e.defaultPrevented,
          typing,
          editing: Boolean(editing),
          insideShortcutBoundary,
          modalOpen,
          timelapseCapturing,
        })
      ) {
        return;
      }
      const clipboardText = e.clipboardData?.getData("text/plain") ?? "";
      const clipboardItems = Array.from(e.clipboardData?.items ?? []);
      const hasClipboardImage = clipboardItems.some((item) => item.type.startsWith("image/"));
      const elementPayload =
        parseClipboardPayload(clipboardText) ??
        (clipboardText.trim() || hasClipboardImage
          ? null
          : studioClipboardPayloadRef.current ??
            readClipboardFallback(studioClipboardSessionStorage(), studioClipboardScopeKey));
      if (elementPayload && applyStudioClipboardPayload(elementPayload, "cascade")) {
        e.preventDefault();
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const mutationTicket = captureStudioMutationTicket();
        const targetPageId = activePage.id;
        const targetMasterEditMode = masterEditMode;
        const insertionPlacement = nextAssetInsertionPlacement();
        void (async () => {
          try {
            const { src, width, height, isAnimatedGif } = await loadStudioCanvasImageFile(file);
            if (
              !isStudioPasteScopeCurrent({
                mutationAllowed: canApplyStudioMutation(mutationTicket),
                reviewLocked: activeSurfaceReviewLockedRef.current,
                targetPageId,
                currentPageId: currentPageIdRef.current,
                targetMasterEditMode,
                currentMasterEditMode: masterEditModeRef.current,
              })
            ) {
              return;
            }
            addRenderedImage(
              src,
              width,
              height,
              undefined,
              isAnimatedGif,
              undefined,
              insertionPlacement,
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : "이미지 붙여넣기 실패");
          }
        })();
        return;
      }
    };
  });

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => pasteRef.current(e);
    globalThis.addEventListener("paste", onPaste);
    return () => globalThis.removeEventListener("paste", onPaste);
  }, []);

  return {
    metaEditPageId,
    setMetaEditPageId,
    commitPageMeta,
    commitShotTag,
    copySelectedElements,
    cutSelectedElements,
    applyStudioClipboardPayload,
    pasteStudioElementsFromClipboard,
    duplicateSelected,
  };
}
