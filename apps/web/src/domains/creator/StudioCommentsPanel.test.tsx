// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  StudioCommentsPanel,
  type StudioCommentsPanelProps,
} from "./StudioCommentsPanel";

import type {
  StudioCommentActor,
  StudioCommentThread,
  StudioCommentsDocument,
} from "./studio-comments";

const source = readFileSync(resolve("apps/web/src/domains/creator/StudioCommentsPanel.tsx"), "utf8");
const studioPageSource = readStudioPageCompositionSource();
// 의도된 변경(2026-08, B-06): 전역 keydown 디스패처(⇧C·tool-comment·Esc 캐스케이드)가
// studio-page-shortcut-dispatcher.ts 로 추출되어, 단축키 분기 검증은 그 파일을 스캔한다.
const studioShortcutDispatcherSource = readFileSync(
  resolve("apps/web/src/domains/creator/studio-page-shortcut-dispatcher.ts"),
  "utf8"
);
// 의도된 변경(2026-08, B-06): 라이브 새로고침 큐 본문(queueStudioTeamCommentLiveRefresh)은
// studio-page-comments-runtime.ts 로 추출 — StudioPage 는 팩토리 배선과 handler ref 대입만 가진다.
const studioCommentsRuntimeSource = readFileSync(
  resolve("apps/web/src/domains/creator/studio-page-comments-runtime.ts"),
  "utf8"
);
// Intentional change: the live-room comment subscription moved into the extracted
// collaboration wiring hook, so the comment-changed gate is pinned against that file.
const studioCollaborationWiringSource = readFileSync(
  resolve("apps/web/src/domains/creator/live/studio-collaboration-wiring.ts"),
  "utf8"
);
const studioEditorViewSource = [
  "StudioCuttoonEditorView.tsx",
  "StudioCuttoonEditorHosts.tsx",
  "StudioCuttoonEditorDialogs.tsx",
  "StudioCuttoonEditorChrome.tsx",
  "StudioCuttoonEditorWorkspace.tsx",
  "StudioCuttoonEditorCanvasColumn.tsx",
  "StudioCuttoonEditorInspectorColumn.tsx",
  "StudioCuttoonEditorPanels.tsx",
  "StudioCuttoonEditorSessionDialogs.tsx",
  "StudioCuttoonEditorContextMenu.tsx",
].map((name) =>
  readFileSync(resolve(`src/domains/creator/studio-cuttoon-editor/${name}`), "utf8"),
).join("\n");
const studioShellSource = `${studioPageSource}\n${studioEditorViewSource}`;
const studioLazyPanelStackSource = readFileSync(
  resolve("apps/web/src/domains/creator/StudioLazyPanelStack.tsx"),
  "utf8"
);
const studioCommentsPanelSessionSource = readFileSync(
  resolve("apps/web/src/domains/creator/StudioCommentsPanelSession.tsx"),
  "utf8"
);
const studioCanvasOverlaySource = readFileSync(
  resolve("apps/web/src/domains/creator/live/StudioLiveCanvasOverlay.tsx"),
  "utf8"
);
const studioPointCommentComposerSource = readFileSync(
  resolve("apps/web/src/domains/creator/StudioPointCommentComposer.tsx"),
  "utf8"
);
const studioPageLazyUiSource = readFileSync(
  resolve("apps/web/src/domains/creator/studio-page-lazy-ui.ts"),
  "utf8"
);

const NOW = "2026-07-26T00:00:00.000Z";
const CURRENT_ACTOR: StudioCommentActor = { id: "actor-self", displayName: "김작가" };
const REVIEWER: StudioCommentActor = { id: "actor-reviewer", displayName: "검토자" };

function makeThread(
  overrides: Partial<StudioCommentThread> = {}
): StudioCommentThread {
  return {
    id: "thread-1",
    author: REVIEWER,
    body: "말풍선 줄바꿈과 오탈자를 확인해 주세요.",
    mentions: [],
    createdAt: NOW,
    updatedAt: NOW,
    anchor: { type: "frame", pageId: "page-1", frameId: "frame-2" },
    replies: [],
    resolved: false,
    ...overrides,
  };
}

function renderedThread(threadId: string): HTMLElement {
  const element = globalThis.document.querySelector<HTMLElement>(
    `[data-studio-comment-thread-id="${threadId}"]`
  );
  if (!element) throw new Error(`thread ${threadId} is not rendered`);
  return element;
}

function makeDocument(
  threads: readonly StudioCommentThread[] = [makeThread()]
): StudioCommentsDocument {
  return { version: 1, threads: [...threads] };
}

function makePanelProps(
  overrides: Partial<StudioCommentsPanelProps> = {}
): StudioCommentsPanelProps {
  return {
    open: true,
    onClose: vi.fn(),
    document: makeDocument(),
    onChange: vi.fn().mockResolvedValue(true),
    activeAnchor: null,
    currentActor: CURRENT_ACTOR,
    anchorOptions: [
      {
        anchor: { type: "frame", pageId: "page-1", frameId: "frame-2" },
        label: "1페이지 · 2컷",
      },
    ],
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioCommentsPanel review rail contract", () => {
  it("coexists with the canvas instead of blocking the viewport as a modal", () => {
    expect(source).toContain('data-studio-comments-rail="true"');
    expect(source).toContain("sm:right-3 sm:left-auto");
    expect(source).toContain("h-[min(62dvh,36rem)]");
    expect(source).toContain("bottom-[calc(7rem+env(safe-area-inset-bottom))]");
    expect(source).not.toContain('aria-modal="true"');
    expect(source).not.toContain("body.style.overflow");
    expect(source).toContain('setComposerExpanded(false);');
    expect(source).not.toContain("hasThreadAtAnchor");
    expect(source).not.toContain("FOCUSABLE_SELECTOR");
  });

  it("keeps keyboard close/send and focus restoration semantics", () => {
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("event.nativeEvent.isComposing");
    expect(source.match(/nativeEvent\.isComposing/g)?.length).toBeGreaterThanOrEqual(5);
    expect(source).toContain("reviewRail?.contains(activeElement)");
    expect(source).toContain("focusReviewRail");
    expect(source).toContain("event.currentTarget.form?.requestSubmit()");
    expect(source).toContain("<dialog");
    expect(source).toContain("aria-labelledby={titleId}");
    expect(source).toContain("aria-describedby={descriptionId}");
    expect(source).toContain('id="studio-comments-review-dialog"');
  });

  it("opens a compact single-click point composer instead of forcing the full review rail", () => {
    expect(studioPageSource).toContain("setPointCommentComposer({");
    expect(studioPageSource).toContain('commentId: createStudioCommentMessageId("comment")');
    expect(studioPageSource).toContain("setCommentsOpen(false)");
    expect(studioPageSource).toContain("submitStudioPointComment");
    expect(studioPointCommentComposerSource).toContain(
      'data-studio-point-comment-composer="true"'
    );
    expect(studioPointCommentComposerSource).not.toContain(
      'data-studio-point-comment-backdrop="true"'
    );
    expect(studioPointCommentComposerSource).toContain(
      "data-studio-point-comment-layout={position.mode}"
    );
    expect(studioPointCommentComposerSource).not.toContain('aria-modal="true"');
    expect(studioPointCommentComposerSource).toContain('aria-label="위치 댓글 내용"');
    expect(studioPointCommentComposerSource).toContain("globalThis.visualViewport");
    expect(studioPointCommentComposerSource).toContain(
      "event.currentTarget.form?.requestSubmit()"
    );
    expect(studioCanvasOverlaySource).toContain('data-studio-comment-pin-preview="true"');
    expect(studioPageSource).toContain("studioCommentMutationReceiptOwnsDraft(");
    expect(studioPageSource).toContain("restoreStudioCanvasViewportFocus");
    expect(studioPageSource).toContain("if (!setStudioComments(nextDocument)) return false");
  });

  it("keeps Magma-style comment placement active after success but exits on explicit cancel", () => {
    const submitStart = studioPageSource.indexOf("async function submitStudioPointComment");
    const submitEnd = studioPageSource.indexOf(
      "async function markStudioCommentThreadRead",
      submitStart
    );
    const submitSource = studioPageSource.slice(submitStart, submitEnd);
    const cancelStart = studioPageSource.indexOf("function cancelStudioPointCommentComposer");
    const cancelEnd = studioPageSource.indexOf("useEffect(() =>", cancelStart);
    const cancelSource = studioPageSource.slice(cancelStart, cancelEnd);
    const disarmStart = studioPageSource.indexOf("function disarmAllPixelTools()");
    const disarmEnd = studioPageSource.indexOf(
      "function finishPolyLassoSession()",
      disarmStart
    );
    const disarmSource = studioPageSource.slice(disarmStart, disarmEnd);

    expect(studioPageSource).toContain("commentPlacementPhaseRef");
    expect(studioPageSource).toContain('const commentPlacementActive = commentPlacementPhase !== "idle"');
    // Two surfaces show the comment tool as still armed while the composer is open — that is the
    // Magma-style behaviour this test guards. They no longer take the flag the same way: the mobile
    // dock still receives a JSX prop, while the left tool rail moved onto the EditorClient factory
    // during the rail/client split. Assert both wirings so narrowing either one back to the
    // placing-only `commentPinArmed` (which would hide the 해제 affordance mid-compose) fails here.
    expect(studioShellSource.match(/commentPinArmed=\{commentPlacementActive\}/gu)).toHaveLength(1);
    expect(studioShellSource.match(/commentPinArmed: commentPlacementActive,/gu)).toHaveLength(1);
    expect(studioPageSource).toContain('setStudioCommentPlacementPhase("placing")');
    expect(studioPageSource).toContain('setStudioCommentPlacementPhase("composing")');
    expect(studioPageSource).toContain("stopStudioCommentPlacementSession");
    expect(submitSource).toContain(
      'commentPlacementPhaseRef.current === "composing"'
    );
    expect(submitSource).toContain(
      'setStudioCommentPlacementPhase(continuePlacement ? "placing" : "idle")'
    );
    expect(submitSource).toContain("다음 위치를 선택하세요");
    expect(cancelSource).toContain("stopStudioCommentPlacementSession()");
    expect(cancelSource).not.toContain('setStudioCommentPlacementPhase("placing")');
    expect(disarmSource).toContain("stopStudioCommentPlacementSession()");
    expect(studioShortcutDispatcherSource).toMatch(
      /else if \(commentPinArmed\) \{[\s\S]*?stopStudioCommentPlacementSession\(\)/u
    );
    expect(studioPageSource).toMatch(
      /if \(viewTool !== null\) \{[\s\S]*?stopStudioCommentPlacementEffect\(\)/u
    );
    expect(studioShortcutDispatcherSource).toContain(
      'if (!e.repeat && matchStudioShortcut(sc["tool-comment"], e))'
    );
  });

  it("moves a single point pin directly with permission and activity-sequence fences", () => {
    // 의도된 변경(2026-08, B-06): 재앵커 본문은 화면 투영과 함께 comments-runtime 으로 추출됐다.
    const reanchorStart = studioCommentsRuntimeSource.indexOf(
      "async function reanchorStudioCommentPin"
    );
    const reanchorEnd = studioCommentsRuntimeSource.indexOf(
      "return reanchorStudioCommentPin;",
      reanchorStart
    );
    const reanchorSource = studioCommentsRuntimeSource.slice(reanchorStart, reanchorEnd);

    expect(reanchorStart).toBeGreaterThanOrEqual(0);
    expect(reanchorEnd).toBeGreaterThan(reanchorStart);
    expect(studioCanvasOverlaySource).toContain("projectStudioCommentPointerToPointAnchor");
    expect(studioCanvasOverlaySource).toContain("nudgeStudioCommentPointAnchor");
    expect(studioCanvasOverlaySource).toContain("setPointerCapture");
    expect(studioCanvasOverlaySource).toContain("Alt+Shift+ArrowLeft");
    expect(studioCanvasOverlaySource).toContain(
      'data-studio-comment-pin-reanchorable={reanchorable ? "true" : undefined}'
    );
    expect(studioPageSource).toContain("studioCommentPinReanchorableThreadIds");
    expect(reanchorSource).toContain("studioTeamCommentCapabilities?.reanchor !== true");
    expect(reanchorSource).toContain("expectedActivitySequence: expectedSequence.toString()");
    expect(reanchorSource).toContain("mergeStudioTeamCommentMutationReceipt(");
    expect(reanchorSource).toContain("applyStudioTeamCommentReanchorReceipt(");
    expect(reanchorSource).toContain("studioTeamCommentReanchorQueueRef.current.set");
    expect(reanchorSource).toContain("previousUpdatedAt");
    expect(reanchorSource).toContain("void reanchorStudioCommentPin(queued)");
    expect(studioShellSource).toContain(
      "studioCommentThreadPopoverScreenProjectionHandlers.getScreenPoint"
    );
  });

  it("refreshes only the changed live thread instead of polling every comment", () => {
    const refreshStart = studioCommentsRuntimeSource.indexOf(
      "function queueStudioTeamCommentLiveRefresh"
    );
    const refreshEnd = studioCommentsRuntimeSource.indexOf(
      "return { refreshStudioTeamComments, queueStudioTeamCommentLiveRefresh }",
      refreshStart
    );
    const refreshSource = studioCommentsRuntimeSource.slice(refreshStart, refreshEnd);

    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(refreshEnd).toBeGreaterThan(refreshStart);
    // 큐가 여전히 live comment-changed 이벤트 핸들러로 연결되는지는 StudioPage 배선으로 고정한다.
    expect(studioPageSource).toContain(
      "studioLiveCommentEventHandlerRef.current = queueStudioTeamCommentLiveRefresh"
    );
    expect(studioCollaborationWiringSource).toContain('event.type !== "comment-changed"');
    expect(refreshSource).toContain("studioTeamCommentLiveTargetSequenceRef");
    expect(refreshSource).toContain("studioTeamCommentLiveRefreshFlightRef");
    expect(refreshSource).toContain("getStudioTeamCommentThread(");
    expect(refreshSource).toContain("{ messageLimit: 51 }");
    expect(refreshSource).toContain("decideStudioTeamCommentLiveResponse");
    expect(refreshSource).toContain("targetSequence: latestTarget");
    expect(refreshSource).toContain('liveDecision.status === "retry"');
    expect(refreshSource).toContain("liveDecision.remainsUnread");
    expect(refreshSource).not.toContain("listAllStudioTeamComments(");
    expect(refreshSource).not.toContain("setInterval(");
  });

  it("preloads the compact composer without pulling the full review rail into pin placement", () => {
    const toggleStart = studioPageSource.indexOf("function startStudioCommentPlacementSession()");
    const toggleEnd = studioPageSource.indexOf("const [pointCommentAnchor", toggleStart);
    const toggleSource = studioPageSource.slice(toggleStart, toggleEnd);

    expect(toggleStart).toBeGreaterThanOrEqual(0);
    expect(toggleEnd).toBeGreaterThan(toggleStart);
    expect(studioPageLazyUiSource).toContain(
      'import("./StudioPointCommentComposer").then((mod) => ({'
    );
    expect(studioPageLazyUiSource).toContain("studioPointCommentComposerLoader.load");
    expect(studioPageLazyUiSource).toContain("studioPointCommentComposerLoader.preload()");
    expect(studioPageLazyUiSource).not.toContain(
      'import("./live/StudioLiveCanvasOverlay").then((mod) => ({ default: mod.StudioPointCommentComposer }))'
    );
    expect(studioCanvasOverlaySource).not.toContain("StudioPointCommentComposer");
    expect(toggleSource).toContain("preloadStudioPointCommentComposer();");
    expect(toggleSource).not.toContain("preloadStudioCommentsPanelSession();");
    expect(studioPageSource).toMatch(
      /function openStudioCommentInbox\([^)]*\)[\s\S]*?preloadStudioCommentsPanelSession\(\);/u
    );
  });

  it("exposes one permission-aware desktop inbox trigger tied to the review dialog", () => {
    expect(studioShellSource).toContain('data-studio-comments-inbox="true"');
    expect(studioShellSource).toContain('aria-controls="studio-comments-review-dialog"');
    expect(studioShellSource).toContain(
      "disabled={collaborationDocumentLocked && !sharedDocument?.capabilities.view}"
    );
    expect(studioShellSource).toContain("lg:inline-flex");
    expect(studioShellSource).toMatch(/commentsOpen\s*\?\s*"댓글 검토함 닫기"/u);
    expect(studioShellSource).toContain('id: "menubar-comment-inbox"');
    expect(studioShellSource).toContain('preview: "comment-inbox"');
    expect(studioShellSource).toContain('openStudioCommentCount > 99 ? "99+" : openStudioCommentCount');
  });

  it("keeps the inbox dense until the user explicitly composes and restores anchor context", () => {
    expect(source).toContain("composerExpanded");
    expect(source).toContain("composerAnchor");
    expect(source).toContain("composerAnchorValid");
    expect(source).toContain("composerAnchorLabelSnapshot");
    expect(source).toContain("frozenComposerAnchorOption");
    expect(source).toContain("isAnchorValid(composerAnchor)");
    expect(source).toContain("댓글을 연결한 위치가 삭제되었습니다");
    expect(source).toContain("anchor: composerAnchor");
    expect(source).toContain("선택한 피드백 위치");
    expect(source).toContain("위치 변경");
    expect(source).toContain(
      'setFilter(preserveReplyDraft ? "all" : activeAnchor ? "current" : "all")'
    );
    expect(source).toContain("!preserveReplyDraft");
    expect(source).toContain("flex min-w-0 items-start gap-2");
    expect(source).toContain("uniqueStudioCommentAnchorOptions(anchorOptions)");
    expect(source).toContain("const seenAnchorKeys = new Set<string>()");
    expect(source).not.toContain("anchorOptions.findIndex");
  });

  it("switches pin placement into a compact Figma-style composer without review filters", () => {
    expect(source).toContain("reviewRailClassName");
    expect(source).toContain('composerExpanded ? "새 댓글" : "검토 댓글"');
    expect(source).toContain("클릭한 위치에 바로 피드백을 남겨요.");
    expect(source).toContain("composerLocationPickerOpen");
    expect(source).toContain("위치 변경");
    expect(source).toContain("{!composerExpanded ? (");
    expect(source).toContain("수정할 점이나 확인이 필요한 내용을 남겨 주세요.");
    expect(source).not.toContain("@이름으로 함께 볼 사람");
  });

  it("reuses mutation ids only while the retried comment or reply payload stays identical", () => {
    expect(source).toContain("pendingNewCommentIdRef");
    expect(source).toContain("pendingReplyIdRef");
    expect(source).toContain("payloadSignature");
    expect(source).toContain("pendingNewCommentIdRef.current?.payloadSignature === payloadSignature");
    expect(source).toContain('pendingReplyIdRef.current?.threadId === threadId');
    expect(source).toContain("pendingReplyIdRef.current.payloadSignature === payloadSignature");
    expect(source).toContain("preserveReplyDraft");
    expect(source).toContain("activeReplyThreadId === thread.id");
    expect(source).toContain("&& !thread.resolved");
    expect(source).toContain("id: pendingReply.replyId");
  });

  it("adds deterministic review sorting without removing search and status filters", () => {
    expect(source).toContain('type CommentSort = "recent" | "oldest" | "location"');
    expect(source).toContain("최근 활동순");
    expect(source).toContain("오래된 활동순");
    expect(source).toContain("위치순");
    expect(source).toContain("getAnchorLabel(left.anchor, anchorOptions).localeCompare");
  });

  it("adds a personalized review filter, mention-aware search, and sequential keyboard review", () => {
    expect(source).toContain('value: "mine"');
    expect(source).toContain("studioCommentThreadCurrentActorRelation");
    expect(source).toContain("thread.mentions.map");
    expect(source).toContain('aria-keyshortcuts="J K /"');
    expect(source).toContain("moveReviewFocus");
    expect(source).toContain("댓글 검색 지우기");
  });

  it("moves keyboard focus to the newest thread when a canvas pin selects an anchor", () => {
    expect(source).toContain("focusRequest");
    expect(source).toContain("focusRequest.threadId");
    expect(source).toContain("focusRequest.requestId");
    expect(source).toContain("pendingFocusThreadIdRef");
    expect(source).toContain('[data-studio-comment-thread-id]');
    expect(source).toContain('thread.focus({ preventScroll: true })');
    expect(source).toContain('thread.scrollIntoView({ block: "nearest", behavior: "auto" })');
    expect(studioCanvasOverlaySource).toContain("aria-keyshortcuts={keyboardShortcuts}");
    expect(studioCanvasOverlaySource).toContain(
      '"ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter"'
    );
    expect(studioCanvasOverlaySource).toContain("focusCommentPin(pin.key, destination)");
  });

  it("restores rail focus after resolve or reopen removes a filtered thread", () => {
    expect(source).toContain("aria-pressed={thread.resolved}");
    expect(source).toContain("if (!saved) return;");
    expect(source).toContain("focusReviewRail();");
  });

  it("exposes guarded edit operations for the current actor", () => {
    // 비교기는 studio-comment-inbox-filter 로 옮겨 검수함 필터와 같은 정체성 규칙을 쓴다.
    expect(source).toContain("studioCommentActorsRepresentSamePerson(thread.author, currentActor)");
    expect(source).toContain("studioCommentActorsRepresentSamePerson(reply.author, currentActor)");
    expect(source).toContain("editStudioCommentThread(document");
    expect(source).toContain("editStudioCommentReply(document");
  });

  it("keeps viewer-specific unread and pin visibility controls out of the document model", () => {
    expect(source).toContain('value: "unread"');
    expect(source).toContain("unreadThreadIds.has(thread.id)");
    expect(source).toContain("onMarkThreadRead(threadId)");
    expect(source).toContain("onMarkAllRead()");
    expect(source).toContain("onTogglePinsHidden");
    expect(source).toContain("댓글·작성자·멘션 검색");
    expect(source).not.toContain("thread.unread =");
  });

  it("keeps pre-server document comments visible without exposing team mutation actions", () => {
    expect(source).toContain("readOnlyThreadIds.has(thread.id)");
    expect(source).toContain("로컬 보관본 · 읽기 전용");
    expect(source).toContain("const canReply =");
    expect(source).toContain("&& capabilities.reply");
    expect(source).toContain("!isReadOnlyArchive && capabilities.resolve");
  });

  it("keeps quick replies inline, touch-sized, and free from a duplicate reply action", () => {
    expect(source).toContain('data-studio-comment-quick-reply="true"');
    expect(source).toContain('data-studio-comment-inline-reply="true"');
    expect(source).toContain('aria-keyshortcuts="Meta+Enter Control+Enter Escape"');
    expect(source).toContain("min-h-11 w-full");
    expect(source).toContain("sm:opacity-0 sm:group-hover:opacity-100");
    expect(source).not.toContain("답글{thread.replies.length");
    expect(source).not.toContain("shadow-[inset_3px");
  });

  it("renders comment sync failures in a dedicated rail status instead of collaboration notices", () => {
    expect(source).toContain("팀 댓글 동기화 지연");
    expect(source).toContain('aria-live="polite"');
  });

  it("uses explicit event-driven refresh instead of polling the complete team history", () => {
    expect(studioPageSource).toContain("createStudioTeamCommentRefreshSession");
    expect(studioPageSource).toContain('request("panel-open")');
    // 의도된 변경(2026-08, B-06): manual 요청은 추출된 comments-runtime 의 refresh 본문이 보낸다.
    expect(studioCommentsRuntimeSource).toContain('request("manual")');
    expect(studioPageSource).not.toContain("commentsOpen ? 5_000 : 30_000");
    expect(source).toContain("팀 댓글 새로고침");
    expect(source).toContain("motion-reduce:animate-none");
  });

  it("keeps server review state out of the persisted project comment document", () => {
    expect(studioPageSource).toContain("const [studioTeamComments, setStudioTeamCommentsState]");
    expect(studioShellSource).toContain("studioComments={studioCommentViewDocument}");
    expect(studioPageSource).toContain("comments: studioComments");
    expect(studioPageSource).not.toContain("comments: studioCommentViewDocument");
  });

  it("keeps retry ids mounted across rail close and validates frozen anchors across the controller boundary", () => {
    expect(studioLazyPanelStackSource).toContain("commentsPanelMounted ? (");
    expect(studioLazyPanelStackSource).toContain("<StudioCommentsPanelSession");
    expect(studioCommentsPanelSessionSource).toContain("<StudioCommentsPanel");
    expect(studioCommentsPanelSessionSource).toContain("open={commentsOpen}");
    expect(studioCommentsPanelSessionSource).toContain(
      "isAnchorValid={isStudioCommentAnchorValid}"
    );
    expect(studioShellSource).toContain("commentsPanelMounted={commentsPanelMounted}");
    expect(studioPageSource).toContain("const isStudioCommentAnchorValid = useCallback");
  });

  it("cancels pin placement explicitly and never marks an entire clustered pin as read", () => {
    // 의도된 변경(2026-08, B-06): Esc 취소 안내는 추출된 keydown 디스패처의 분기다.
    expect(studioShortcutDispatcherSource).toContain('announceDrawingShortcut("댓글 핀 배치 취소")');
    expect(studioPageSource).toContain("studioCommentFocusRequestSequenceRef");
    expect(studioPageSource).toContain('setStudioCommentPlacementPhase("idle")');
    expect(studioPageSource).toContain(
      "void markStudioCommentThreadRead(selection.selected.id)"
    );
    expect(studioPageSource).toContain("void markStudioCommentThreadRead(nextThread.id)");
    expect(studioPageSource).not.toContain("Promise.all(threadIds.map");
  });

  it("keeps mobile review controls to two compact rows", () => {
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain("sr-only sm:not-sr-only");
    expect(source).toContain('aria-label="댓글 정렬"');
    expect(source).not.toContain('className="basis-full"');
  });
});

describe("StudioCommentsPanel personalized review workflow", () => {
  it("collects authored, participated, assigned, and mentioned threads and searches mention names", async () => {
    const selfAuthored = makeThread({
      id: "thread-self-authored",
      author: CURRENT_ACTOR,
      body: "내가 남긴 피드백",
    });
    const participated = makeThread({
      id: "thread-participated",
      body: "답글로 참여한 피드백",
      replies: [{
        id: "reply-self",
        author: CURRENT_ACTOR,
        body: "제가 확인할게요.",
        mentions: [],
        createdAt: NOW,
        updatedAt: NOW,
      }],
    });
    const assigned = makeThread({
      id: "thread-assigned",
      body: "내 담당 피드백",
      assignee: CURRENT_ACTOR,
    });
    const mentioned = makeThread({
      id: "thread-mentioned",
      body: "나를 부른 피드백",
      mentions: [CURRENT_ACTOR],
    });
    const unrelated = makeThread({
      id: "thread-unrelated",
      body: "다른 팀 피드백",
      mentions: [{ id: "actor-color-lead", displayName: "채색 리드" }],
    });

    render(
      <StudioCommentsPanel
        {...makePanelProps({
          document: makeDocument([
            selfAuthored,
            participated,
            assigned,
            mentioned,
            unrelated,
          ]),
        })}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: /나와 관련\s*4/u }));
    expect(globalThis.document.querySelectorAll("[data-studio-comment-thread-id]")).toHaveLength(4);
    // 관계 배지는 각 스레드 안에서 찾는다 — "내 담당"·"나를 멘션"은 필터 칩 라벨과도 겹친다.
    expect(within(renderedThread("thread-self-authored")).getByText("내 댓글")).toBeTruthy();
    expect(within(renderedThread("thread-participated")).getByText("내가 참여")).toBeTruthy();
    expect(within(renderedThread("thread-assigned")).getByText("내 담당")).toBeTruthy();
    expect(within(renderedThread("thread-mentioned")).getByText("나를 멘션")).toBeTruthy();
    expect(screen.queryByText("다른 팀 피드백")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /내 담당\s*1/u }));
    expect(globalThis.document.querySelectorAll("[data-studio-comment-thread-id]")).toHaveLength(1);
    expect(screen.getByText("내 담당 피드백")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /나를 멘션\s*1/u }));
    expect(globalThis.document.querySelectorAll("[data-studio-comment-thread-id]")).toHaveLength(1);
    expect(screen.getByText("나를 부른 피드백")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /전체\s*5/u }));
    const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "댓글 검색" });
    fireEvent.change(search, { target: { value: "채색 리드" } });
    expect(globalThis.document.querySelectorAll("[data-studio-comment-thread-id]")).toHaveLength(1);
    expect(screen.getByText("다른 팀 피드백")).toBeTruthy();
  });

  it("moves through visible threads with J/K and clears search with Escape before closing", async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const onClose = vi.fn();
    const threads = [
      makeThread({
        id: "thread-oldest",
        body: "첫 번째 피드백",
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      }),
      makeThread({
        id: "thread-middle",
        body: "두 번째 피드백",
        createdAt: "2026-07-26T01:00:00.000Z",
        updatedAt: "2026-07-26T01:00:00.000Z",
      }),
      makeThread({
        id: "thread-newest",
        body: "세 번째 피드백",
        createdAt: "2026-07-26T02:00:00.000Z",
        updatedAt: "2026-07-26T02:00:00.000Z",
      }),
    ];

    try {
      render(
        <StudioCommentsPanel
          {...makePanelProps({ document: makeDocument(threads), onClose })}
        />
      );

      const dialog = await screen.findByRole("dialog", { name: "검토 댓글" });
      await screen.findByText("세 번째 피드백");
      const newest = globalThis.document.querySelector<HTMLElement>(
        '[data-studio-comment-thread-id="thread-newest"]'
      );
      const middle = globalThis.document.querySelector<HTMLElement>(
        '[data-studio-comment-thread-id="thread-middle"]'
      );
      expect(newest?.tabIndex).toBe(0);

      fireEvent.keyDown(dialog, { key: "j" });
      await waitFor(() => expect(globalThis.document.activeElement).toBe(middle));
      fireEvent.keyDown(middle as HTMLElement, { key: "k" });
      await waitFor(() => expect(globalThis.document.activeElement).toBe(newest));

      fireEvent.keyDown(dialog, { key: "/" });
      const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "댓글 검색" });
      expect(globalThis.document.activeElement).toBe(search);
      fireEvent.change(search, { target: { value: "두 번째" } });
      fireEvent.keyDown(search, { key: "Escape" });
      expect(search.value).toBe("");
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });
});

describe("StudioCommentsPanel review-to-task suggestions", () => {
  it("expands one local task proposal with evidence, scope, and completion conditions", () => {
    render(<StudioCommentsPanel {...makePanelProps()} />);

    const toggle = screen.getByRole("button", { name: "작업 제안" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className).toContain("min-h-11");
    expect(toggle.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const proposal = screen.getByRole("region", { name: "식자와 대사 표현 점검" });
    expect(within(proposal).getByText("식자")).toBeTruthy();
    expect(within(proposal).getByText("우선순위 보통")).toBeTruthy();
    expect(within(proposal).getByText("1페이지 · 2컷")).toBeTruthy();
    expect(within(proposal).getByText("로컬 규칙 기반")).toBeTruthy();
    expect(within(proposal).getByText("완료 조건")).toBeTruthy();
    expect(
      within(proposal).getByText("말풍선 안에서 글자가 잘리지 않고 읽기 순서가 자연스럽습니다.")
    ).toBeTruthy();
  });

  it("converts an open mutable suggestion to the current actor in one document change", async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    const originalDocument = makeDocument();
    render(<StudioCommentsPanel {...makePanelProps({ document: originalDocument, onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: "작업 제안" }));
    const convert = screen.getByRole("button", { name: "내 작업으로 전환" });
    expect((convert as HTMLButtonElement).disabled).toBe(false);
    expect(convert.className).toContain("min-h-11");
    fireEvent.click(convert);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const nextDocument = onChange.mock.calls[0]?.[0] as StudioCommentsDocument;
    expect(nextDocument).not.toBe(originalDocument);
    expect(nextDocument.threads[0]?.assignee).toEqual(CURRENT_ACTOR);
    expect(nextDocument.threads[0]?.resolved).toBe(false);
  });

  it.each([
    {
      name: "read-only archive",
      props: {
        readOnlyThreadIds: new Set(["thread-1"]),
      } satisfies Partial<StudioCommentsPanelProps>,
      buttonName: "내 작업으로 전환",
      reason: "읽기 전용 보관 댓글은 작업으로 전환할 수 없습니다.",
    },
    {
      name: "resolved thread",
      props: {
        document: makeDocument([
          makeThread({
            resolved: true,
            resolvedAt: NOW,
            resolvedBy: REVIEWER,
          }),
        ]),
      } satisfies Partial<StudioCommentsPanelProps>,
      buttonName: "내 작업으로 전환",
      reason: "해결된 댓글은 다시 연 뒤 작업으로 전환할 수 있습니다.",
    },
    {
      name: "missing assignment permission",
      props: {
        capabilities: { assign: false },
        mutationDisabledReason: "검토자 권한에서는 담당자를 바꿀 수 없습니다.",
      } satisfies Partial<StudioCommentsPanelProps>,
      buttonName: "내 작업으로 전환",
      reason: "검토자 권한에서는 담당자를 바꿀 수 없습니다.",
    },
    {
      name: "already assigned to self",
      props: {
        document: makeDocument([makeThread({ assignee: CURRENT_ACTOR })]),
      } satisfies Partial<StudioCommentsPanelProps>,
      buttonName: "내 작업으로 지정됨",
      reason: "이미 내 작업으로 지정되어 있습니다.",
    },
  ])("keeps $name suggestions inspectable but mutation-safe", ({ props, buttonName, reason }) => {
    const onChange = vi.fn().mockResolvedValue(true);
    render(<StudioCommentsPanel {...makePanelProps({ ...props, onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: "작업 제안" }));
    const convert = screen.getByRole("button", { name: buttonName });
    expect((convert as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
    fireEvent.click(convert);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps only one task proposal expanded to control comment-card density", () => {
    const second = makeThread({
      id: "thread-2",
      body: "3D 원근과 소실점을 확인해 주세요.",
      anchor: { type: "page", pageId: "page-1" },
    });
    render(
      <StudioCommentsPanel
        {...makePanelProps({ document: makeDocument([makeThread(), second]) })}
      />
    );

    const letteringThread = globalThis.document.querySelector<HTMLElement>(
      '[data-studio-comment-thread-id="thread-1"]'
    );
    const perspectiveThread = globalThis.document.querySelector<HTMLElement>(
      '[data-studio-comment-thread-id="thread-2"]'
    );
    expect(letteringThread).not.toBeNull();
    expect(perspectiveThread).not.toBeNull();

    fireEvent.click(
      within(letteringThread as HTMLElement).getByRole("button", { name: "작업 제안" })
    );
    expect(globalThis.document.querySelectorAll("[data-studio-review-task=true]")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "식자와 대사 표현 점검" })).toBeTruthy();

    fireEvent.click(
      within(perspectiveThread as HTMLElement).getByRole("button", { name: "작업 제안" })
    );
    expect(globalThis.document.querySelectorAll("[data-studio-review-task=true]")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "식자와 대사 표현 점검" })).toBeNull();
    expect(screen.getByRole("region", { name: "3D와 원근 구성 보정" })).toBeTruthy();
  });
});
