import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  resolveStudioInitialPrimaryTool,
  type StudioRememberedPrimaryTool,
} from "./studio-initial-primary-tool";
import { acquireProductStudioUiPreferencesRepository } from "./studio-legacy-editor-runtime-helpers";
import { STUDIO_LOCAL_DATABASE_OWNERSHIP_BUSY_SESSION_HINT } from "./studio-local-database-ownership";
import {
  createStudioWorkspaceDefaultState,
  normalizeStudioWorkspaceStateForOwner,
  updateStudioWorkspaceLiveLayout,
  type StudioWorkspaceId,
  type StudioWorkspaceLayout,
  type StudioWorkspaceLoadResult,
  type StudioWorkspaceSaveResult,
  type StudioWorkspaceState,
} from "./studio-workspaces";

import type { StudioWorkspaceLayoutSource } from "./studio-menu-session-model";
import type { PendingStudioWorkspaceSync } from "./studio-page-editor-ui-contracts";
import type { StudioUiBooleanPreferenceKey } from "./studio-ui-preferences-sqlite";
import type {
  StudioWorkspacePersistenceRuntime,
  StudioWorkspaceRuntimeSaveResult,
} from "./studio-workspace-sqlite-runtime";

/**
 * StudioPage에서 추출한 작업공간 SQLite/OPFS 지속성 클러스터 — owner-scoped hydration,
 * dirty revision fence, BroadcastChannel invalidation 3-way merge, 그리고 패널 열림
 * 오버라이드/불리언 UI 환경설정 hydration. 상태·ref 선언은 StudioPage가 소유하고 이 파일은
 * 효과·저장 경로만 소유한다. 계약과 세대/펜스 로직은 추출 전 StudioPage와 동일하다.
 *
 * react-compiler가 이 파일의 훅을 컴파일하므로, 훅 인자에서 파생된 ref 별칭의 변이는 모두
 * 컴파일 경계 밖(모듈 함수)에서 수행한다 — live/studio-collaboration-wiring.ts와 같은 패턴.
 */
export interface StudioPageWorkspacePersistenceContext {
  readonly applyStudioWorkspaceLayout: (
    layout: StudioWorkspaceLayout,
    workspaceId?: StudioWorkspaceId,
    source?: StudioWorkspaceLayoutSource,
    clearSyncNotice?: boolean
  ) => void;
  readonly currentWorkspaceOwnerScope: string;
  readonly drawingPaletteDragging: boolean;
  readonly drawingPaletteDraggingRef: MutableRefObject<boolean>;
  readonly leftResize: { readonly dragging: boolean };
  readonly liveWorkspaceLayout: StudioWorkspaceLayout;
  readonly liveWorkspaceLayoutRef: MutableRefObject<StudioWorkspaceLayout>;
  readonly pendingExternalWorkspaceSync: PendingStudioWorkspaceSync | null;
  readonly pendingExternalWorkspaceSyncRef:
    MutableRefObject<PendingStudioWorkspaceSync | null>;
  readonly rightResize: { readonly dragging: boolean };
  readonly setPendingExternalWorkspaceSync:
    Dispatch<SetStateAction<PendingStudioWorkspaceSync | null>>;
  readonly setWorkspaceMenuEpoch: Dispatch<SetStateAction<number>>;
  readonly setWorkspacePersistence: Dispatch<SetStateAction<StudioWorkspaceLoadResult>>;
  readonly setWorkspaceSyncNotice: Dispatch<SetStateAction<string | null>>;
  readonly setWorkspaceSyncRetryEpoch: Dispatch<SetStateAction<number>>;
  readonly studioAuthUserId: string | null;
  readonly workspaceDirtyRevisionRef: MutableRefObject<number>;
  readonly workspaceHydrationGenerationRef: MutableRefObject<number>;
  readonly workspacePersistenceRef: MutableRefObject<StudioWorkspaceLoadResult>;
  readonly workspaceRuntimeRef: MutableRefObject<StudioWorkspacePersistenceRuntime | null>;
  readonly workspaceSyncBaseStateRef: MutableRefObject<StudioWorkspaceState>;
  readonly workspaceSyncRetryEpoch: number;
  readonly workspaceSyncSequenceRef: MutableRefObject<number>;
}

export interface StudioPageWorkspacePersistenceResult {
  readonly persistStudioWorkspaceState: (
    nextState: StudioWorkspaceState
  ) => StudioWorkspaceSaveResult;
}

type StudioWorkspaceLayoutApplier = StudioPageWorkspacePersistenceContext[
  "applyStudioWorkspaceLayout"
];

/** 지속성 스냅샷 ref+state 동기 갱신 — 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다. */
function commitStudioWorkspacePersistenceSnapshot(
  context: StudioPageWorkspacePersistenceContext,
  next: StudioWorkspaceLoadResult
): void {
  context.workspacePersistenceRef.current = next;
  context.setWorkspacePersistence(next);
}

/** 보류된 외부 동기화 ref+state 동기 교체 — 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다. */
function replaceStudioPendingExternalWorkspaceSync(
  context: StudioPageWorkspacePersistenceContext,
  next: PendingStudioWorkspaceSync | null
): void {
  context.pendingExternalWorkspaceSyncRef.current = next;
  context.setPendingExternalWorkspaceSync(next);
}

function runtimeFailureNotice(
  result: Pick<StudioWorkspaceRuntimeSaveResult, "failure" | "authority">,
): string | null {
  if (result.failure === "owner-mismatch") {
    return "계정이 바뀌어 이전 작업공간 변경을 저장하지 않았어요.";
  }
  if (result.failure === "ownership-busy") {
    return STUDIO_LOCAL_DATABASE_OWNERSHIP_BUSY_SESSION_HINT;
  }
  if (result.authority === "memory-only" || result.failure) {
    return "SQLite/OPFS 저장을 사용할 수 없어 작업공간 변경을 현재 세션에 유지하고 있어요.";
  }
  return null;
}

function persistStudioWorkspaceStateWithContext(
  context: StudioPageWorkspacePersistenceContext,
  nextState: StudioWorkspaceState,
): StudioWorkspaceSaveResult {
  const {
    currentWorkspaceOwnerScope,
    pendingExternalWorkspaceSyncRef,
    setWorkspaceSyncNotice,
    workspaceDirtyRevisionRef,
    workspacePersistenceRef,
    workspaceRuntimeRef,
    workspaceSyncBaseStateRef,
  } = context;
  const updateWorkspacePersistenceSnapshot = (next: StudioWorkspaceLoadResult): void =>
    commitStudioWorkspacePersistenceSnapshot(context, next);
  const ownerScope = currentWorkspaceOwnerScope;
  const current = workspacePersistenceRef.current;
  const scopedState = normalizeStudioWorkspaceStateForOwner(nextState, ownerScope);
  const guardRevision = workspaceDirtyRevisionRef.current + 1;
  workspaceDirtyRevisionRef.current = guardRevision;

  const blockedByOwner = current.ownerScope !== ownerScope;
  const blockedByExternalMerge = pendingExternalWorkspaceSyncRef.current !== null;
  const optimistic: StudioWorkspaceLoadResult = {
    ...current,
    state: blockedByOwner ? current.state : scopedState,
    ownerScope,
    status: "session-only",
    failure: blockedByOwner ? "owner-mismatch" : null,
  };
  if (!blockedByOwner) updateWorkspacePersistenceSnapshot(optimistic);

  if (blockedByOwner || blockedByExternalMerge) {
    setWorkspaceSyncNotice(
      blockedByOwner
        ? "계정 전환 중이라 이전 작업공간 변경을 저장하지 않았어요."
        : "다른 탭의 변경과 안전하게 합치는 동안 이 작업공간 변경은 현재 세션에 유지돼요.",
    );
    return Object.freeze({
      state: optimistic.state,
      ownerScope,
      status: "session-only" as const,
      failure: blockedByOwner ? "owner-mismatch" as const : null,
    });
  }

  const runtime = workspaceRuntimeRef.current;
  if (!runtime || runtime.ownerScope !== ownerScope) {
    setWorkspaceSyncNotice(
      "SQLite/OPFS 작업공간 저장소를 준비하는 동안 변경을 현재 세션에 유지하고 있어요.",
    );
    return Object.freeze({
      state: scopedState,
      ownerScope,
      status: "session-only" as const,
      failure: "storage-unavailable" as const,
    });
  }

  void runtime.save(scopedState, current.ownerScope, guardRevision).then((result) => {
    if (
      workspaceRuntimeRef.current !== runtime
      || result.ownerScope !== currentWorkspaceOwnerScope
      || result.guardRevision !== workspaceDirtyRevisionRef.current
    ) {
      return;
    }
    const nextPersistence: StudioWorkspaceLoadResult = {
      ...workspacePersistenceRef.current,
      state: result.state,
      ownerScope: result.ownerScope,
      source: result.status === "persisted" ? "current" : "default",
      status: result.status,
      failure: result.failure,
    };
    if (result.status === "persisted" && result.failure === null) {
      workspaceSyncBaseStateRef.current = result.state;
    }
    updateWorkspacePersistenceSnapshot(nextPersistence);
    setWorkspaceSyncNotice(runtimeFailureNotice(result));
  }).catch(() => {
    if (workspaceRuntimeRef.current !== runtime) return;
    setWorkspaceSyncNotice(
      "SQLite/OPFS 작업공간 저장을 확인하지 못해 변경을 현재 세션에 유지하고 있어요.",
    );
  });

  return Object.freeze({
    state: scopedState,
    ownerScope,
    status: "session-only" as const,
    failure: null,
  });
}

// owner가 바뀔 때마다 별도의 SQLite/OPFS runtime을 열고, 늦은 hydration은 dirty revision
// fence로 막는다. BroadcastChannel은 상태를 운반하지 않고 revision invalidation만 전달한다.
function runStudioWorkspaceOwnerHydration(
  context: StudioPageWorkspacePersistenceContext,
  applyStudioWorkspaceLayoutFromEffect: StudioWorkspaceLayoutApplier,
): () => void {
  const {
    currentWorkspaceOwnerScope,
    drawingPaletteDraggingRef,
    pendingExternalWorkspaceSyncRef,
    setWorkspaceSyncNotice,
    studioAuthUserId,
    workspaceDirtyRevisionRef,
    workspaceHydrationGenerationRef,
    workspacePersistenceRef,
    workspaceRuntimeRef,
    workspaceSyncBaseStateRef,
    workspaceSyncSequenceRef,
  } = context;
  const updateWorkspacePersistenceSnapshot = (next: StudioWorkspaceLoadResult): void =>
    commitStudioWorkspacePersistenceSnapshot(context, next);
  const replacePendingExternalWorkspaceSync = (
    next: PendingStudioWorkspaceSync | null,
  ): void => replaceStudioPendingExternalWorkspaceSync(context, next);
  const generation = workspaceHydrationGenerationRef.current + 1;
  workspaceHydrationGenerationRef.current = generation;
  workspaceDirtyRevisionRef.current = 0;
  const ownerScope = currentWorkspaceOwnerScope;
  workspaceRuntimeRef.current?.close();
  workspaceRuntimeRef.current = null;

  const defaultState = createStudioWorkspaceDefaultState(studioAuthUserId);
  const initialPersistence: StudioWorkspaceLoadResult = {
    state: defaultState,
    ownerScope,
    source: "default",
    status: "session-only",
    failure: null,
  };
  workspaceSyncBaseStateRef.current = defaultState;
  replacePendingExternalWorkspaceSync(null);
  updateWorkspacePersistenceSnapshot(initialPersistence);
  applyStudioWorkspaceLayoutFromEffect(
    defaultState.liveLayout,
    defaultState.activeWorkspaceId,
    "owner-scope-change",
    false,
  );

  let active = true;
  let runtime: StudioWorkspacePersistenceRuntime | null = null;
  let unsubscribe: () => void = () => undefined;
  void import("./studio-workspace-sqlite-runtime").then(async (module) => {
    if (!active || workspaceHydrationGenerationRef.current !== generation) return;
    runtime = module.createStudioWorkspacePersistenceRuntime({
      userId: studioAuthUserId,
    });
    workspaceRuntimeRef.current = runtime;
    unsubscribe = runtime.subscribeInvalidation((invalidation) => {
      if (
        workspaceRuntimeRef.current !== runtime
        || invalidation.ownerScope !== ownerScope
      ) {
        return;
      }
      const previous = pendingExternalWorkspaceSyncRef.current;
      const sequence = workspaceSyncSequenceRef.current + 1;
      workspaceSyncSequenceRef.current = sequence;
      replacePendingExternalWorkspaceSync({
        ownerScope,
        authorityRevision: Math.max(
          invalidation.revision,
          previous?.ownerScope === ownerScope ? previous.authorityRevision : 0,
        ),
        sequence,
        baseState:
          previous?.ownerScope === ownerScope
            ? previous.baseState
            : workspaceSyncBaseStateRef.current,
      });
      if (drawingPaletteDraggingRef.current) {
        setWorkspaceSyncNotice(
          "팔레트 크기 조절 중이라 다른 탭의 작업공간 변경을 보류했어요.",
        );
      }
    });

    const result = await runtime.hydrate({
      getCurrentState: () => {
        const current = workspacePersistenceRef.current;
        return current.ownerScope === ownerScope ? current.state : defaultState;
      },
      getDirtyRevision: () => workspaceDirtyRevisionRef.current,
    });
    if (
      !active
      || workspaceRuntimeRef.current !== runtime
      || workspaceHydrationGenerationRef.current !== generation
      || result.ownerScope !== ownerScope
      || result.guardRevision !== workspaceDirtyRevisionRef.current
    ) {
      return;
    }
    workspaceSyncBaseStateRef.current = result.state;
    updateWorkspacePersistenceSnapshot({
      state: result.state,
      ownerScope: result.ownerScope,
      source: result.source,
      status: result.status,
      failure: result.failure,
    });
    applyStudioWorkspaceLayoutFromEffect(
      result.state.liveLayout,
      result.state.activeWorkspaceId,
      "owner-scope-change",
      false,
    );
    setWorkspaceSyncNotice(
      result.failure === "ownership-busy"
        ? null
        : result.authority === "memory-only"
          ? "SQLite/OPFS 작업공간 저장소를 열지 못해 현재 세션에서 계속 작업할 수 있어요."
          : result.conflictPaths.length > 0
            ? "초기 작업공간을 현재 세션 변경과 안전하게 합쳤어요."
            : null,
    );
  }).catch(() => {
    if (!active || workspaceHydrationGenerationRef.current !== generation) return;
    setWorkspaceSyncNotice(
      "SQLite/OPFS 작업공간 모듈을 열지 못해 변경을 현재 세션에 유지하고 있어요.",
    );
  });

  return () => {
    active = false;
    unsubscribe();
    if (runtime && workspaceRuntimeRef.current === runtime) {
      workspaceRuntimeRef.current = null;
    }
    runtime?.close();
  };
}

// 드래그나 작업공간 메뉴 편집과 겹친 외부 revision은 상호작용 종료 뒤 SQLite에서 다시
// 읽고 base/local/external 3-way merge한다. 같은 경로 충돌만 현재 탭 우선으로 남긴다.
function replayStudioPendingExternalWorkspaceSync(
  context: StudioPageWorkspacePersistenceContext,
  applyStudioWorkspaceLayoutFromEffect: StudioWorkspaceLayoutApplier,
): (() => void) | undefined {
  const {
    currentWorkspaceOwnerScope,
    drawingPaletteDragging,
    leftResize,
    liveWorkspaceLayoutRef,
    pendingExternalWorkspaceSync,
    pendingExternalWorkspaceSyncRef,
    rightResize,
    setWorkspaceMenuEpoch,
    setWorkspaceSyncNotice,
    setWorkspaceSyncRetryEpoch,
    workspaceDirtyRevisionRef,
    workspacePersistenceRef,
    workspaceRuntimeRef,
    workspaceSyncBaseStateRef,
    workspaceSyncSequenceRef,
  } = context;
  const updateWorkspacePersistenceSnapshot = (next: StudioWorkspaceLoadResult): void =>
    commitStudioWorkspacePersistenceSnapshot(context, next);
  const replacePendingExternalWorkspaceSync = (
    next: PendingStudioWorkspaceSync | null,
  ): void => replaceStudioPendingExternalWorkspaceSync(context, next);
  if (
    leftResize.dragging
    || rightResize.dragging
    || drawingPaletteDragging
    || !pendingExternalWorkspaceSync
  ) {
    return;
  }

  const pendingSync = pendingExternalWorkspaceSync;
  const ownerScope = currentWorkspaceOwnerScope;
  const runtime = workspaceRuntimeRef.current;
  if (
    pendingSync.ownerScope !== ownerScope
    || !runtime
    || runtime.ownerScope !== ownerScope
    || workspacePersistenceRef.current.ownerScope !== ownerScope
  ) {
    replacePendingExternalWorkspaceSync(null);
    setWorkspaceSyncNotice(
      "계정이 바뀌어 이전 탭에서 보류한 작업공간 변경을 반영하지 않았어요.",
    );
    return;
  }

  let cancelled = false;
  let deferredWorkspaceMenu: HTMLElement | null = null;
  let retryFrame: number | null = null;
  const retryAfterWorkspaceMenu = () => {
    if (retryFrame !== null) return;
    retryFrame = globalThis.requestAnimationFrame(() => {
      retryFrame = null;
      setWorkspaceSyncRetryEpoch((current) => current + 1);
    });
  };
  const deferWhileWorkspaceMenuOpen = () => {
    const workspaceMenu = document.querySelector<HTMLElement>(
      '[data-testid="studio-workspace-dialog"]:not([hidden])',
    );
    if (!workspaceMenu) return false;
    setWorkspaceSyncNotice(
      "작업공간 편집을 마치면 다른 탭의 변경과 자동으로 합칠게요.",
    );
    if (deferredWorkspaceMenu !== workspaceMenu) {
      deferredWorkspaceMenu?.removeEventListener("focusout", retryAfterWorkspaceMenu);
      deferredWorkspaceMenu = workspaceMenu;
      workspaceMenu.addEventListener("focusout", retryAfterWorkspaceMenu, {
        once: true,
      });
    }
    return true;
  };
  const cancelPendingMerge = () => {
    cancelled = true;
    deferredWorkspaceMenu?.removeEventListener("focusout", retryAfterWorkspaceMenu);
    if (retryFrame !== null) globalThis.cancelAnimationFrame(retryFrame);
  };
  if (deferWhileWorkspaceMenuOpen()) return cancelPendingMerge;

  void runtime.reconcile({
    sourceOwnerScope: ownerScope,
    baseState: pendingSync.baseState,
    getLocalState: () => {
      const current = workspacePersistenceRef.current;
      return updateStudioWorkspaceLiveLayout(
        current.ownerScope === ownerScope ? current.state : pendingSync.baseState,
        liveWorkspaceLayoutRef.current,
      );
    },
    getDirtyRevision: () => workspaceDirtyRevisionRef.current,
  }).then((result) => {
    if (cancelled || workspaceRuntimeRef.current !== runtime) return;
    const latestPending = pendingExternalWorkspaceSyncRef.current;
    if (
      !latestPending
      || latestPending.sequence !== pendingSync.sequence
      || latestPending.authorityRevision !== pendingSync.authorityRevision
      || result.ownerScope !== ownerScope
    ) {
      return;
    }
    if (deferWhileWorkspaceMenuOpen()) return;
    if (result.guardRevision !== workspaceDirtyRevisionRef.current) {
      const sequence = workspaceSyncSequenceRef.current + 1;
      workspaceSyncSequenceRef.current = sequence;
      replacePendingExternalWorkspaceSync({ ...latestPending, sequence });
      return;
    }

    workspaceSyncBaseStateRef.current = result.state;
    replacePendingExternalWorkspaceSync(null);
    updateWorkspacePersistenceSnapshot({
      ...workspacePersistenceRef.current,
      state: result.state,
      ownerScope: result.ownerScope,
      source: result.status === "persisted" ? "current" : "default",
      status: result.status,
      failure: result.failure,
    });
    applyStudioWorkspaceLayoutFromEffect(
      result.state.liveLayout,
      result.state.activeWorkspaceId,
      "external-sync",
      false,
    );
    setWorkspaceMenuEpoch((current) => current + 1);
    setWorkspaceSyncNotice(
      result.conflictPaths.length > 0
        ? "다른 탭의 변경을 합쳤어요. 겹친 "
          + result.conflictPaths.length
          + "개 설정은 현재 탭을 유지했습니다."
        : result.status === "persisted"
          ? "다른 탭의 변경과 현재 배치를 안전하게 합쳤어요."
          : runtimeFailureNotice(result),
    );
  }).catch(() => {
    if (cancelled || workspaceRuntimeRef.current !== runtime) return;
    const latestPending = pendingExternalWorkspaceSyncRef.current;
    if (!latestPending || latestPending.sequence !== pendingSync.sequence) return;
    const current = workspacePersistenceRef.current;
    const localState = updateStudioWorkspaceLiveLayout(
      current.state,
      liveWorkspaceLayoutRef.current,
    );
    replacePendingExternalWorkspaceSync(null);
    updateWorkspacePersistenceSnapshot({
      ...current,
      state: localState,
      status: "session-only",
      failure: "verification-failed",
    });
    setWorkspaceSyncNotice(
      "다른 탭의 변경을 합치지 못해 현재 배치를 이 세션에 유지했어요.",
    );
  });
  return cancelPendingMerge;
}

export function useStudioPageWorkspacePersistence(
  context: StudioPageWorkspacePersistenceContext
): StudioPageWorkspacePersistenceResult {
  const {
    applyStudioWorkspaceLayout,
    currentWorkspaceOwnerScope,
    drawingPaletteDragging,
    leftResize,
    liveWorkspaceLayout,
    pendingExternalWorkspaceSync,
    rightResize,
    studioAuthUserId,
    workspaceSyncRetryEpoch,
  } = context;
  const applyStudioWorkspaceLayoutFromEffect = useEffectEvent(applyStudioWorkspaceLayout);
  // useEffectEvent: 본문은 항상 커밋 시점의 최신 컨텍스트를 읽고, 재실행 트리거는 아래 의존성
  // 배열이 단독으로 소유한다 — 추출 전 StudioPage 클로저 캡처와 동일한 계약.
  const runStudioWorkspaceOwnerHydrationFromEffect = useEffectEvent(
    () => runStudioWorkspaceOwnerHydration(context, applyStudioWorkspaceLayoutFromEffect),
  );
  const replayStudioPendingExternalWorkspaceSyncFromEffect = useEffectEvent(
    () => replayStudioPendingExternalWorkspaceSync(
      context,
      applyStudioWorkspaceLayoutFromEffect,
    ),
  );
  useEffect(
    () => runStudioWorkspaceOwnerHydrationFromEffect(),
    [currentWorkspaceOwnerScope, studioAuthUserId],
  );
  useEffect(
    () => replayStudioPendingExternalWorkspaceSyncFromEffect(),
    [
      currentWorkspaceOwnerScope,
      drawingPaletteDragging,
      leftResize.dragging,
      liveWorkspaceLayout,
      pendingExternalWorkspaceSync,
      rightResize.dragging,
      studioAuthUserId,
      workspaceSyncRetryEpoch,
    ],
  );
  return {
    persistStudioWorkspaceState: (nextState: StudioWorkspaceState) =>
      persistStudioWorkspaceStateWithContext(context, nextState),
  };
}

/**
 * 데스크톱 좌/우 패널 열림 오버라이드 — 사용자가 명시적으로 연/닫은 패널은 캔버스 넓게 쓰기
 * 복원 스냅샷과 프레젠테이션 강제 열림 상태를 함께 갱신한다. StudioPage 추출 전 계약 그대로.
 */
export interface StudioWorkspacePanelOpenOverridesContext {
  readonly canvasWidePanelRestoreRef:
    MutableRefObject<{ left: boolean; right: boolean }>;
  readonly leftPanelOpenRef: MutableRefObject<boolean>;
  readonly rightPanelOpenRef: MutableRefObject<boolean>;
  readonly setForceLeftPanelOpen: Dispatch<SetStateAction<boolean>>;
  readonly setForceRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  readonly setLeftPanelOpen: Dispatch<SetStateAction<boolean>>;
  readonly setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
}

export interface StudioWorkspacePanelOpenOverrides {
  readonly setLeftPanelOpenWithOverride: (
    next: SetStateAction<boolean>,
    options?: { preserveWideRestore?: boolean }
  ) => void;
  readonly setRightPanelOpenWithOverride: (
    next: SetStateAction<boolean>,
    options?: { preserveWideRestore?: boolean }
  ) => void;
}

/** 우측 패널 오버라이드 본문 — 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다. */
function applyStudioRightPanelOpenWithOverride(
  context: Pick<
    StudioWorkspacePanelOpenOverridesContext,
    | "canvasWidePanelRestoreRef"
    | "leftPanelOpenRef"
    | "setForceRightPanelOpen"
    | "setRightPanelOpen"
  >,
  next: SetStateAction<boolean>,
  options: { preserveWideRestore?: boolean },
): void {
  const {
    canvasWidePanelRestoreRef,
    leftPanelOpenRef,
    setForceRightPanelOpen,
    setRightPanelOpen,
  } = context;
  if (typeof next === "function") {
    setRightPanelOpen((current) => {
      const nextValue = next(current);
      if (!options.preserveWideRestore) {
        canvasWidePanelRestoreRef.current = {
          left: leftPanelOpenRef.current,
          right: nextValue,
        };
      }
      setForceRightPanelOpen(nextValue);
      return nextValue;
    });
    return;
  }
  if (!options.preserveWideRestore) {
    canvasWidePanelRestoreRef.current = {
      left: leftPanelOpenRef.current,
      right: next,
    };
  }
  setForceRightPanelOpen(next);
  setRightPanelOpen(next);
}

/** 좌측 패널 오버라이드 본문 — 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다. */
function applyStudioLeftPanelOpenWithOverride(
  context: Pick<
    StudioWorkspacePanelOpenOverridesContext,
    | "canvasWidePanelRestoreRef"
    | "rightPanelOpenRef"
    | "setForceLeftPanelOpen"
    | "setLeftPanelOpen"
  >,
  next: SetStateAction<boolean>,
  options: { preserveWideRestore?: boolean },
): void {
  const {
    canvasWidePanelRestoreRef,
    rightPanelOpenRef,
    setForceLeftPanelOpen,
    setLeftPanelOpen,
  } = context;
  if (typeof next === "function") {
    setLeftPanelOpen((current) => {
      const nextValue = next(current);
      if (!options.preserveWideRestore) {
        canvasWidePanelRestoreRef.current = {
          left: nextValue,
          right: rightPanelOpenRef.current,
        };
      }
      setForceLeftPanelOpen(nextValue);
      return nextValue;
    });
    return;
  }
  if (!options.preserveWideRestore) {
    canvasWidePanelRestoreRef.current = {
      left: next,
      right: rightPanelOpenRef.current,
    };
  }
  setForceLeftPanelOpen(next);
  setLeftPanelOpen(next);
}

export function useStudioWorkspacePanelOpenOverrides(
  context: StudioWorkspacePanelOpenOverridesContext
): StudioWorkspacePanelOpenOverrides {
  const {
    canvasWidePanelRestoreRef,
    leftPanelOpenRef,
    rightPanelOpenRef,
    setForceLeftPanelOpen,
    setForceRightPanelOpen,
    setLeftPanelOpen,
    setRightPanelOpen,
  } = context;
  const setRightPanelOpenWithOverride = useCallback((
    next: SetStateAction<boolean>,
    options: { preserveWideRestore?: boolean } = {}
  ) => {
    applyStudioRightPanelOpenWithOverride({
      canvasWidePanelRestoreRef,
      leftPanelOpenRef,
      setForceRightPanelOpen,
      setRightPanelOpen,
    }, next, options);
  }, [canvasWidePanelRestoreRef, leftPanelOpenRef, setForceRightPanelOpen, setRightPanelOpen]);
  const setLeftPanelOpenWithOverride = useCallback((
    next: SetStateAction<boolean>,
    options: { preserveWideRestore?: boolean } = {}
  ) => {
    applyStudioLeftPanelOpenWithOverride({
      canvasWidePanelRestoreRef,
      rightPanelOpenRef,
      setForceLeftPanelOpen,
      setLeftPanelOpen,
    }, next, options);
  }, [canvasWidePanelRestoreRef, rightPanelOpenRef, setForceLeftPanelOpen, setLeftPanelOpen]);
  return { setLeftPanelOpenWithOverride, setRightPanelOpenWithOverride };
}

/**
 * 페이지 소유 불리언 UI 환경설정(SQLite/OPFS) hydration — 키별 사용자 revision 펜스로 늦은
 * load가 세션 중 사용자의 새 선택을 덮지 않게 한다. StudioPage 추출 전 계약 그대로.
 */
export interface StudioUiBooleanPreferenceHydrationContext {
  readonly aiNoticeAcknowledgedRef: MutableRefObject<boolean>;
  readonly mobileHintDismissedRef: MutableRefObject<boolean>;
  readonly quickStartDismissedRef: MutableRefObject<boolean>;
  readonly setAiNoticeAcknowledged: Dispatch<SetStateAction<boolean>>;
  readonly setAppSettingsPersistenceState:
    Dispatch<SetStateAction<"loading" | "saved" | "session-only">>;
  readonly setMobileHintDismissed: Dispatch<SetStateAction<boolean>>;
  readonly setQuickStartDismissed: Dispatch<SetStateAction<boolean>>;
  /**
   * 유일한 비-불리언 승객. "마지막에 쓰던 기본 도구"는 코치·모바일 힌트와 같은 부팅 게이트
   * (`uiBooleanPreferencesReady`) 뒤에서만 쓸모가 있어서, 별도 왕복을 하나 더 여는 대신 같은
   * 배치에 얹는다. 늦은 로드가 사용자의 선택을 덮는 문제는 호출부가 "이미 도구를 활성화했는가"
   * 로 막는다(이 값은 최초 1회 적용 이후 읽히지 않는다).
   */
  readonly setRememberedPrimaryTool: Dispatch<
    SetStateAction<StudioRememberedPrimaryTool | null>
  >;
  readonly setStudioCommentPinsHiddenState: Dispatch<SetStateAction<boolean>>;
  readonly setUiBooleanPreferencesReady: Dispatch<SetStateAction<boolean>>;
  readonly studioCommentPinsHiddenRef: MutableRefObject<boolean>;
  readonly uiBooleanPreferenceRevisionsRef:
    MutableRefObject<Record<StudioUiBooleanPreferenceKey, number>>;
}

/** 불리언 환경설정 hydration 본문 — 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다. */
function hydrateStudioUiBooleanPreferences(
  context: StudioUiBooleanPreferenceHydrationContext
): () => void {
  const {
    aiNoticeAcknowledgedRef,
    mobileHintDismissedRef,
    quickStartDismissedRef,
    setAiNoticeAcknowledged,
    setAppSettingsPersistenceState,
    setMobileHintDismissed,
    setQuickStartDismissed,
    setRememberedPrimaryTool,
    setStudioCommentPinsHiddenState,
    setUiBooleanPreferencesReady,
    studioCommentPinsHiddenRef,
    uiBooleanPreferenceRevisionsRef,
  } = context;
  let cancelled = false;
  const revisionsAtStart = { ...uiBooleanPreferenceRevisionsRef.current };
  void acquireProductStudioUiPreferencesRepository()
    .then(async (repository) => {
      const [primaryTool, ...results] = await Promise.allSettled([
        repository.loadPrimaryTool(),
        repository.loadBooleanPreference("ai-notice-acknowledged"),
        repository.loadBooleanPreference("quick-start-dismissed"),
        repository.loadBooleanPreference("mobile-hint-dismissed"),
        repository.loadBooleanPreference("comment-pins-hidden"),
      ] as const);
      if (cancelled) return;

      // 실패는 조용히 "기억 없음"으로 접는다 — 시작 도구는 안전한 기본값이 있어서, 이 하나를
      // 못 읽었다고 환경설정 전체를 session-only 로 강등할 이유가 없다.
      if (primaryTool.status === "fulfilled") setRememberedPrimaryTool(primaryTool.value);

      let degraded = false;
      const reconcile = async (
        key: StudioUiBooleanPreferenceKey,
        result: PromiseSettledResult<boolean>,
        current: () => boolean,
        apply: (value: boolean) => void,
      ): Promise<void> => {
        if (result.status === "fulfilled") {
          if (uiBooleanPreferenceRevisionsRef.current[key] === revisionsAtStart[key]) {
            apply(result.value);
            return;
          }
        } else if (uiBooleanPreferenceRevisionsRef.current[key] === revisionsAtStart[key]) {
          degraded = true;
          return;
        }
        try {
          await repository.saveBooleanPreference(key, current());
        } catch {
          degraded = true;
        }
      };

      await reconcile(
        "ai-notice-acknowledged",
        results[0],
        () => aiNoticeAcknowledgedRef.current,
        (value) => {
          aiNoticeAcknowledgedRef.current = value;
          setAiNoticeAcknowledged(value);
        },
      );
      await reconcile(
        "quick-start-dismissed",
        results[1],
        () => quickStartDismissedRef.current,
        (value) => {
          quickStartDismissedRef.current = value;
          setQuickStartDismissed(value);
        },
      );
      await reconcile(
        "mobile-hint-dismissed",
        results[2],
        () => mobileHintDismissedRef.current,
        (value) => {
          mobileHintDismissedRef.current = value;
          setMobileHintDismissed(value);
        },
      );
      await reconcile(
        "comment-pins-hidden",
        results[3],
        () => studioCommentPinsHiddenRef.current,
        (value) => {
          studioCommentPinsHiddenRef.current = value;
          setStudioCommentPinsHiddenState(value);
        },
      );
      if (!cancelled) {
        setUiBooleanPreferencesReady(true);
        if (degraded) setAppSettingsPersistenceState("session-only");
      }
    })
    .catch(() => {
      if (cancelled) return;
      setUiBooleanPreferencesReady(true);
      setAppSettingsPersistenceState("session-only");
    });
  return () => {
    cancelled = true;
  };
}

export function useStudioUiBooleanPreferenceHydration(
  context: StudioUiBooleanPreferenceHydrationContext
): void {
  // useEffectEvent: 컨텍스트 멤버는 전부 안정(ref/setter)이라 마운트 1회 실행 계약이 유지된다.
  const hydrateStudioUiBooleanPreferencesFromEffect = useEffectEvent(
    () => hydrateStudioUiBooleanPreferences(context),
  );
  useEffect(() => hydrateStudioUiBooleanPreferencesFromEffect(), []);
}

/** 마지막으로 쓴 기본 도구를 남긴다 — 다음 방문의 시작 도구가 된다. 실패는 조용히 넘긴다:
 * 못 기억해도 안전한 기본값으로 열리므로 환경설정 전체를 강등할 이유가 없다. */
export function persistStudioPrimaryTool(tool: StudioRememberedPrimaryTool): void {
  void acquireProductStudioUiPreferencesRepository()
    .then((repository) => repository.savePrimaryTool(tool))
    .catch(() => undefined);
}

/**
 * 첫 획까지의 거리 — 손님은 브러시로 바꾸는 조작 없이 바로 그릴 수 있어야 한다.
 *
 * 마운트가 아니라 코치와 같은 "부팅 완료" 게이트 뒤에서 딱 한 번 적용한다: 그 전에는 기억된
 * 도구도, 문서에 내용이 있는지도 알 수 없어 잘못된 도구로 깜빡인다. 그 사이 사용자가 이미
 * 도구를 골랐다면(`primaryToolActivatedRef`) 아무것도 하지 않는다. `select` 는 호스트의 마운트
 * 상태와 같으므로 전이가 필요 없다 — 그래서 호출부는 "그리기로 시작하라"는 명령 하나만 준다.
 */
export function useStudioInitialPrimaryTool(context: {
  readonly autosaveChecked: boolean;
  readonly hasExistingContent: boolean;
  readonly primaryToolActivatedRef: MutableRefObject<boolean>;
  readonly rememberedPrimaryTool: StudioRememberedPrimaryTool | null;
  readonly startDrawing: () => void;
  readonly uiBooleanPreferencesReady: boolean;
  readonly workHydrated: boolean;
}): void {
  const { autosaveChecked, uiBooleanPreferencesReady, workHydrated } = context;
  const applyInitialPrimaryTool = useEffectEvent(() => {
    if (context.primaryToolActivatedRef.current) return;
    const next = resolveStudioInitialPrimaryTool({
      rememberedTool: context.rememberedPrimaryTool,
      hasExistingContent: context.hasExistingContent,
    });
    if (next === "draw") context.startDrawing();
  });
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!uiBooleanPreferencesReady || !workHydrated || !autosaveChecked) return;
    if (appliedRef.current) return;
    appliedRef.current = true;
    applyInitialPrimaryTool();
  }, [autosaveChecked, uiBooleanPreferencesReady, workHydrated]);
}
