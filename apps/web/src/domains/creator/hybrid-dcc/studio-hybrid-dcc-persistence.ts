import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  STUDIO_HYBRID_DCC_RECOVERY_TIMEOUT_MS,
  type StudioHybridDccPersistenceUiState,
  type StudioHybridDccWorkspacePersistence,
} from "../studio-page-editor-types";

import { createStudioHybridDccLatestTaskQueue } from "./studio-hybrid-dcc-latest-task-queue";
import { resolveStudioHybridDccPersistenceAuthGate } from "./studio-hybrid-dcc-persistence-auth-gate";

import type { StudioHybridDccWorkspace } from "./studio-hybrid-dcc-workspace";

export interface StudioHybridDccPersistenceReceiptEvidence {
  readonly sequence: number;
  readonly sourceHash: `sha256:${string}`;
  readonly documentStateHash: string | null;
}

/**
 * Hybrid DCC 지속성 오케스트레이션 — StudioPage에서 추출한 상태/스코프 전환 ref 클러스터.
 * 라우트 내비게이션 절반(open/close/mode 전환)은 StudioPage에 남고, 이 훅은 OPFS 복구·
 * 자동 저장·auth 전환 중 in-memory 작업공간 이관만 소유한다. 계약은 추출 전 StudioPage와
 * 동일하다.
 */
export interface StudioHybridDccPersistenceContext {
  readonly autosaveKey: string;
  readonly hybridDccOpen: boolean;
  readonly liveRoomQueryParam: string | null;
  readonly studioAuthReady: boolean;
  readonly studioAuthUserId: string | null;
  readonly workId: string | null;
}

export interface StudioHybridDccPersistenceResult {
  readonly flushHybridDccWorkspacePersistence: () => void;
  readonly hybridDccPersistenceStatus: StudioHybridDccPersistenceUiState["status"];
  readonly hybridDccPersistenceReceipt: StudioHybridDccPersistenceReceiptEvidence | null;
  readonly hybridDccWorkspaceDocumentId: string;
  readonly hybridDccWorkspaceScope: string;
  readonly scheduleHybridDccWorkspacePersistence: (
    workspace: StudioHybridDccWorkspace
  ) => void;
  readonly scopedHybridDccWorkspace: StudioHybridDccWorkspace | undefined;
  readonly setHybridDccWorkspaceState: Dispatch<SetStateAction<{
    readonly scope: string;
    readonly workspace: StudioHybridDccWorkspace;
  } | null>>;
}

interface StudioHybridDccScopedWorkspace {
  readonly scope: string;
  readonly workspace: StudioHybridDccWorkspace;
}

interface StudioHybridDccScopeTransfer {
  readonly fromScope: string;
  readonly toScope: string;
  readonly workspace: StudioHybridDccWorkspace;
}

/**
 * Draft 원고의 지속성 식별자는 auth가 준비된 첫 렌더에 한 번만 고정된다 — StudioPage 추출 전
 * 계약 그대로 렌더 중 ref 시드/판독이며, react-compiler는 렌더 중 ref 접근을 거부하므로
 * 컴파일 경계 밖(모듈 헬퍼)에서 수행한다.
 */
function resolveStudioHybridDccPersistenceIdentity(
  hybridDccDraftPersistenceIdentityRef: MutableRefObject<{
    readonly ownerId: string;
    readonly workScope: string;
  } | null>,
  context: StudioHybridDccPersistenceContext
): { readonly ownerId: string; readonly workScope: string } {
  const { autosaveKey, liveRoomQueryParam, studioAuthReady, studioAuthUserId, workId } = context;
  if (studioAuthReady
    && !workId
    && !liveRoomQueryParam
    && !hybridDccDraftPersistenceIdentityRef.current) {
    hybridDccDraftPersistenceIdentityRef.current = {
      ownerId: studioAuthUserId ?? "guest",
      workScope: `draft:${autosaveKey}`,
    };
  }
  const hybridDccPersistenceOwnerId = workId || liveRoomQueryParam
    ? studioAuthUserId ?? "guest"
    : hybridDccDraftPersistenceIdentityRef.current?.ownerId ?? "auth-pending";
  const hybridDccPersistenceWorkScope = workId
    ? `work:${workId}`
    : liveRoomQueryParam
      ? `room:${liveRoomQueryParam}`
      : hybridDccDraftPersistenceIdentityRef.current?.workScope ?? "draft:auth-pending";
  return { ownerId: hybridDccPersistenceOwnerId, workScope: hybridDccPersistenceWorkScope };
}

/**
 * 스코프가 렌더 중 바뀌는 순간(auth 응답 등) 세션 전용 작업공간을 새 스코프로 동기 이관한다 —
 * 추출 전 StudioPage의 렌더 중 ref 이관 블록 그대로이며, 렌더 중 ref 접근이라 컴파일 경계
 * 밖에서 수행한다.
 */
function transferStudioHybridDccWorkspaceAcrossScopes(
  refs: {
    readonly hybridDccAuthFallbackScopeRef: MutableRefObject<string | null>;
    readonly hybridDccLatestWorkspaceRef: MutableRefObject<StudioHybridDccScopedWorkspace | null>;
    readonly hybridDccPreviousWorkspaceScopeRef: MutableRefObject<string>;
    readonly hybridDccScopeTransferRef: MutableRefObject<StudioHybridDccScopeTransfer | null>;
  },
  hybridDccWorkspaceScope: string,
  hybridDccWorkspaceState: StudioHybridDccScopedWorkspace | null
): void {
  const {
    hybridDccAuthFallbackScopeRef,
    hybridDccLatestWorkspaceRef,
    hybridDccPreviousWorkspaceScopeRef,
    hybridDccScopeTransferRef,
  } = refs;
  const previousHybridDccWorkspaceScope = hybridDccPreviousWorkspaceScopeRef.current;
  if (previousHybridDccWorkspaceScope !== hybridDccWorkspaceScope) {
    if (hybridDccAuthFallbackScopeRef.current === previousHybridDccWorkspaceScope) {
      const pendingWorkspace = hybridDccLatestWorkspaceRef.current?.scope
        === previousHybridDccWorkspaceScope
        ? hybridDccLatestWorkspaceRef.current.workspace
        : hybridDccWorkspaceState?.scope === previousHybridDccWorkspaceScope
          ? hybridDccWorkspaceState.workspace
          : null;
      if (pendingWorkspace) {
        hybridDccScopeTransferRef.current = {
          fromScope: previousHybridDccWorkspaceScope,
          toScope: hybridDccWorkspaceScope,
          workspace: pendingWorkspace,
        };
        // Re-key the live in-memory authority synchronously so an auth response arriving while the
        // artist edits cannot make the remounted dialog flash or emit a blank replacement.
        hybridDccLatestWorkspaceRef.current = {
          scope: hybridDccWorkspaceScope,
          workspace: pendingWorkspace,
        };
      }
    }
    hybridDccPreviousWorkspaceScopeRef.current = hybridDccWorkspaceScope;
  }
}

/** 저장 큐 가드가 읽는 현재 스코프 추적 — 렌더 중 ref 기록이라 컴파일 경계 밖에서 수행한다. */
function trackStudioHybridDccPersistenceScope(
  hybridDccPersistenceCurrentScopeRef: MutableRefObject<string>,
  hybridDccWorkspaceScope: string
): void {
  hybridDccPersistenceCurrentScopeRef.current = hybridDccWorkspaceScope;
}

/** 렌더가 소비하는 스코프 일치 작업공간 해석 — 렌더 중 ref 판독이라 컴파일 경계 밖에서 수행한다. */
function resolveScopedStudioHybridDccWorkspace(
  hybridDccScopeTransferRef: MutableRefObject<StudioHybridDccScopeTransfer | null>,
  hybridDccWorkspaceScope: string,
  hybridDccWorkspaceState: StudioHybridDccScopedWorkspace | null
): StudioHybridDccWorkspace | undefined {
  return hybridDccWorkspaceState?.scope === hybridDccWorkspaceScope
    ? hybridDccWorkspaceState.workspace
    : hybridDccScopeTransferRef.current?.toScope === hybridDccWorkspaceScope
      ? hybridDccScopeTransferRef.current.workspace
      : undefined;
}

export function useStudioHybridDccPersistence(
  context: StudioHybridDccPersistenceContext
): StudioHybridDccPersistenceResult {
  const { hybridDccOpen, studioAuthReady } = context;
  const hybridDccDraftPersistenceIdentityRef = useRef<{
    readonly ownerId: string;
    readonly workScope: string;
  } | null>(null);
  const {
    ownerId: hybridDccPersistenceOwnerId,
    workScope: hybridDccPersistenceWorkScope,
  } = resolveStudioHybridDccPersistenceIdentity(hybridDccDraftPersistenceIdentityRef, context);
  const hybridDccWorkspaceScope =
    `${hybridDccPersistenceOwnerId}\u0000${hybridDccPersistenceWorkScope}`;
  const hybridDccWorkspaceDocumentId = `hybrid-dcc-${hybridDccPersistenceWorkScope
    .replace(/[^A-Za-z0-9._~-]/gu, "-")
    .slice(0, 96)}`;
  const [hybridDccWorkspaceState, setHybridDccWorkspaceState] =
    useState<StudioHybridDccScopedWorkspace | null>(null);
  const hybridDccPersistenceRef =
    useRef<Promise<StudioHybridDccWorkspacePersistence | null> | null>(null);
  const hybridDccPersistenceTimerRef = useRef<number | null>(null);
  const hybridDccPersistenceScopeGenerationRef = useRef(0);
  const hybridDccPersistenceGenerationRef = useRef(0);
  const hybridDccPersistenceSaveQueueRef = useRef(createStudioHybridDccLatestTaskQueue());
  const hybridDccLatestWorkspaceRef = useRef<StudioHybridDccScopedWorkspace | null>(null);
  const hybridDccAuthFallbackScopeRef = useRef<string | null>(null);
  const hybridDccPreviousWorkspaceScopeRef = useRef(hybridDccWorkspaceScope);
  const hybridDccScopeTransferRef = useRef<StudioHybridDccScopeTransfer | null>(null);
  transferStudioHybridDccWorkspaceAcrossScopes(
    {
      hybridDccAuthFallbackScopeRef,
      hybridDccLatestWorkspaceRef,
      hybridDccPreviousWorkspaceScopeRef,
      hybridDccScopeTransferRef,
    },
    hybridDccWorkspaceScope,
    hybridDccWorkspaceState,
  );
  const [hybridDccPersistenceUiState, setHybridDccPersistenceUiState] =
    useState<StudioHybridDccPersistenceUiState>(() => ({
      scope: hybridDccWorkspaceScope,
      status: resolveStudioHybridDccPersistenceAuthGate(studioAuthReady).status,
    }));
  const [hybridDccPersistenceReceiptState, setHybridDccPersistenceReceiptState] = useState<{
    readonly scope: string;
    readonly receipt: StudioHybridDccPersistenceReceiptEvidence;
  } | null>(null);
  const hybridDccPersistenceStatus =
    hybridDccPersistenceUiState.scope === hybridDccWorkspaceScope
      ? hybridDccPersistenceUiState.status
      : "checking";
  const hybridDccPersistenceReceipt =
    hybridDccPersistenceReceiptState?.scope === hybridDccWorkspaceScope
      ? hybridDccPersistenceReceiptState.receipt
      : null;
  const hybridDccPersistenceCurrentScopeRef = useRef(hybridDccWorkspaceScope);
  trackStudioHybridDccPersistenceScope(
    hybridDccPersistenceCurrentScopeRef,
    hybridDccWorkspaceScope,
  );
  const hybridDccPersistenceEnabled = hybridDccOpen;

  useEffect(() => {
    let cancelled = false;
    let recoveryTimedOut = false;
    const scopeGeneration = ++hybridDccPersistenceScopeGenerationRef.current;
    const authGate = resolveStudioHybridDccPersistenceAuthGate(studioAuthReady);
    setHybridDccPersistenceUiState({
      scope: hybridDccWorkspaceScope,
      status: authGate.status,
    });
    if (!hybridDccPersistenceEnabled) {
      hybridDccPersistenceRef.current = null;
      return () => {
        cancelled = true;
      };
    }
    if (!authGate.shouldAttemptRecovery) {
      hybridDccPersistenceRef.current = null;
      // Session-only editing is available immediately, so transfer eligibility must become
      // authoritative in the same effect. Delaying this marker allowed an auth response to cancel
      // the old timeout and remount the DCC before its in-memory workspace moved to the new scope.
      // Without an authored pending workspace the render-time handoff remains empty, so an older
      // durable recovery can still load without being overwritten.
      hybridDccAuthFallbackScopeRef.current = hybridDccWorkspaceScope;
      return () => {
        cancelled = true;
      };
    }
    const persistenceSaveQueue = hybridDccPersistenceSaveQueueRef.current;
    const recoveryTimeoutId = window.setTimeout(() => {
      if (cancelled || scopeGeneration !== hybridDccPersistenceScopeGenerationRef.current) return;
      recoveryTimedOut = true;
      hybridDccPersistenceRef.current = null;
      setHybridDccPersistenceUiState({
        scope: hybridDccWorkspaceScope,
        status: "error",
      });
    }, STUDIO_HYBRID_DCC_RECOVERY_TIMEOUT_MS);
    const persistencePromise = Promise.all([
      import("../studio-opfs-filesystem"),
      import("./studio-hybrid-dcc-workspace-persistence"),
    ]).then(async ([{ selectStudioOpfsFileSystem }, {
      createStudioHybridDccWorkspacePersistenceFromFileSystem,
    }]) => {
      const lockManager = typeof navigator === "undefined" ? null : navigator.locks ?? null;
      if (!lockManager || typeof lockManager.request !== "function") {
        if (!cancelled) setHybridDccPersistenceUiState({
          scope: hybridDccWorkspaceScope,
          status: "session-only",
        });
        return null;
      }
      const selection = await selectStudioOpfsFileSystem(globalThis, {
        rootName: "toonspectrum-hybrid-dcc-v1",
      });
      if (recoveryTimedOut) return null;
      if (selection.kind !== "opfs") {
        if (!cancelled) setHybridDccPersistenceUiState({
          scope: hybridDccWorkspaceScope,
          status: "session-only",
        });
        return null;
      }
      const storage = typeof navigator === "undefined" ? null : navigator.storage;
      const persistence = createStudioHybridDccWorkspacePersistenceFromFileSystem({
        fileSystem: selection.fs,
        lockManager,
        quotaEstimator: storage && typeof storage.estimate === "function"
          ? { estimate: () => storage.estimate() }
          : null,
        scope: {
          userId: hybridDccPersistenceOwnerId,
          workId: hybridDccPersistenceWorkScope,
        },
        ownerId: `hybrid-dcc-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      });
      const loaded = await persistence.load();
      if (recoveryTimedOut) return null;
      if (cancelled || scopeGeneration !== hybridDccPersistenceScopeGenerationRef.current) {
        return persistence;
      }
      const scopeTransfer = hybridDccScopeTransferRef.current?.toScope
        === hybridDccWorkspaceScope
        ? hybridDccScopeTransferRef.current
        : null;
      if (scopeTransfer) {
        const pendingWorkspace = hybridDccLatestWorkspaceRef.current?.scope
          === hybridDccWorkspaceScope
          ? hybridDccLatestWorkspaceRef.current.workspace
          : scopeTransfer.workspace;
        setHybridDccWorkspaceState({
          scope: hybridDccWorkspaceScope,
          workspace: pendingWorkspace,
        });
        // `load()` has already admitted any prior durable authority. Saving the uninterrupted
        // session-only edit now creates a newer checkpoint, so neither side of the auth transition
        // is silently discarded.
        const receipt = await persistence.save(pendingWorkspace);
        if (hybridDccScopeTransferRef.current === scopeTransfer) {
          hybridDccScopeTransferRef.current = null;
        }
        if (hybridDccAuthFallbackScopeRef.current === scopeTransfer.fromScope) {
          hybridDccAuthFallbackScopeRef.current = null;
        }
        setHybridDccPersistenceUiState({
          scope: hybridDccWorkspaceScope,
          status: "saved",
        });
        setHybridDccPersistenceReceiptState({
          scope: hybridDccWorkspaceScope,
          receipt,
        });
        return persistence;
      }
      if (loaded.status === "restored") {
        setHybridDccWorkspaceState((current) => (
          current?.scope === hybridDccWorkspaceScope
            ? current
            : {
                scope: hybridDccWorkspaceScope,
                workspace: loaded.workspace,
              }
        ));
        setHybridDccPersistenceUiState({
          scope: hybridDccWorkspaceScope,
          status: "saved",
        });
      } else {
        setHybridDccPersistenceUiState({
          scope: hybridDccWorkspaceScope,
          status: "ready",
        });
      }
      return persistence;
    }).catch((cause: unknown) => {
      if (!cancelled && !recoveryTimedOut
        && scopeGeneration === hybridDccPersistenceScopeGenerationRef.current) {
        setHybridDccPersistenceUiState({
          scope: hybridDccWorkspaceScope,
          status: "error",
        });
        console.warn("Hybrid DCC workspace recovery is unavailable.", cause);
      }
      // A corrupt or unsupported durable record must not be overwritten by a fresh workspace.
      return null;
    }).finally(() => window.clearTimeout(recoveryTimeoutId));
    hybridDccPersistenceRef.current = persistencePromise;

    return () => {
      cancelled = true;
      window.clearTimeout(recoveryTimeoutId);
      hybridDccPersistenceGenerationRef.current += 1;
      const pending = hybridDccLatestWorkspaceRef.current;
      if (hybridDccPersistenceTimerRef.current !== null) {
        window.clearTimeout(hybridDccPersistenceTimerRef.current);
        hybridDccPersistenceTimerRef.current = null;
      }
      if (pending?.scope === hybridDccWorkspaceScope) {
        persistenceSaveQueue.enqueue(pending.scope, {
          run: async () => {
            const persistence = await persistencePromise;
            if (persistence) await persistence.save(pending.workspace);
          },
        });
      }
      if (hybridDccPersistenceRef.current === persistencePromise) {
        hybridDccPersistenceRef.current = null;
      }
    };
  }, [
    hybridDccPersistenceOwnerId,
    hybridDccPersistenceWorkScope,
    hybridDccWorkspaceScope,
    hybridDccPersistenceEnabled,
    studioAuthReady,
  ]);

  const persistHybridDccWorkspace = (
    pending: { readonly scope: string; readonly workspace: StudioHybridDccWorkspace },
    generation: number,
    persistencePromise: Promise<StudioHybridDccWorkspacePersistence | null>,
  ) => {
    hybridDccPersistenceSaveQueueRef.current.enqueue(pending.scope, {
      run: async () => {
        const persistence = await persistencePromise;
        if (!persistence) return;
        if (generation === hybridDccPersistenceGenerationRef.current
          && pending.scope === hybridDccPersistenceCurrentScopeRef.current) {
          setHybridDccPersistenceUiState({
            scope: pending.scope,
            status: "saving",
          });
        }
        const receipt = await persistence.save(pending.workspace);
        if (generation === hybridDccPersistenceGenerationRef.current
          && pending.scope === hybridDccPersistenceCurrentScopeRef.current) {
          setHybridDccPersistenceUiState({
            scope: pending.scope,
            status: "saved",
          });
          setHybridDccPersistenceReceiptState({
            scope: pending.scope,
            receipt,
          });
        }
      },
      onError: (cause: unknown) => {
        if (generation === hybridDccPersistenceGenerationRef.current
          && pending.scope === hybridDccPersistenceCurrentScopeRef.current) {
          setHybridDccPersistenceUiState({
            scope: pending.scope,
            status: "error",
          });
          console.warn("Hybrid DCC workspace autosave failed.", cause);
        }
      },
    });
  };

  const scheduleHybridDccWorkspacePersistence = (workspace: StudioHybridDccWorkspace) => {
    const pending = { scope: hybridDccWorkspaceScope, workspace } as const;
    if (hybridDccLatestWorkspaceRef.current?.scope === pending.scope
      && hybridDccLatestWorkspaceRef.current.workspace === workspace) return;
    hybridDccLatestWorkspaceRef.current = pending;
    const persistencePromise = hybridDccPersistenceRef.current;
    if (!persistencePromise || hybridDccPersistenceStatus === "session-only") return;
    if (hybridDccPersistenceTimerRef.current !== null) {
      window.clearTimeout(hybridDccPersistenceTimerRef.current);
    }
    const generation = ++hybridDccPersistenceGenerationRef.current;
    hybridDccPersistenceTimerRef.current = window.setTimeout(() => {
      hybridDccPersistenceTimerRef.current = null;
      persistHybridDccWorkspace(pending, generation, persistencePromise);
    }, 900);
  };

  const flushHybridDccWorkspacePersistence = () => {
    const pending = hybridDccLatestWorkspaceRef.current;
    const persistencePromise = hybridDccPersistenceRef.current;
    if (!pending || pending.scope !== hybridDccWorkspaceScope || !persistencePromise) return;
    if (hybridDccPersistenceTimerRef.current !== null) {
      window.clearTimeout(hybridDccPersistenceTimerRef.current);
      hybridDccPersistenceTimerRef.current = null;
    }
    const generation = ++hybridDccPersistenceGenerationRef.current;
    persistHybridDccWorkspace(pending, generation, persistencePromise);
  };
  const scopedHybridDccWorkspace = resolveScopedStudioHybridDccWorkspace(
    hybridDccScopeTransferRef,
    hybridDccWorkspaceScope,
    hybridDccWorkspaceState,
  );

  return {
    flushHybridDccWorkspacePersistence,
    hybridDccPersistenceReceipt,
    hybridDccPersistenceStatus,
    hybridDccWorkspaceDocumentId,
    hybridDccWorkspaceScope,
    scheduleHybridDccWorkspacePersistence,
    scopedHybridDccWorkspace,
    setHybridDccWorkspaceState,
  };
}
