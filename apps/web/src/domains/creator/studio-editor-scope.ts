export interface StudioEditorInstanceScope {
  authScopeKey: string | null;
  workId: string | null;
  remixId: string | null;
  draftSessionEpoch?: number;
}

export interface StudioDraftIdentityScope {
  routeKey: string;
  claimedAuthScopeKey: string | null;
  epoch: number;
}

export function createStudioDraftIdentityScope(
  routeKey: string,
  authScopeKey: string | null
): StudioDraftIdentityScope {
  return { routeKey, claimedAuthScopeKey: authScopeKey, epoch: 0 };
}

/**
 * guest 초안은 최초 로그인 계정이 같은 editor instance에서 이어받는다. 한 번 계정에 귀속된 뒤
 * logout/다른 계정 전환이 일어나면 epoch를 올려 즉시 빈 instance로 격리한다.
 */
export function advanceStudioDraftIdentityScope(
  current: StudioDraftIdentityScope,
  routeKey: string,
  authScopeKey: string | null
): StudioDraftIdentityScope {
  if (current.routeKey !== routeKey) {
    return {
      routeKey,
      claimedAuthScopeKey: authScopeKey,
      epoch: current.epoch + 1,
    };
  }
  if (current.claimedAuthScopeKey === null) {
    return authScopeKey === null
      ? current
      : { ...current, claimedAuthScopeKey: authScopeKey };
  }
  if (current.claimedAuthScopeKey === authScopeKey) return current;
  return {
    ...current,
    claimedAuthScopeKey: authScopeKey,
    epoch: current.epoch + 1,
  };
}

export interface StudioEditorAsyncScope extends Pick<StudioEditorInstanceScope, "authScopeKey" | "workId"> {
  mounted: boolean;
  aborted: boolean;
}

export interface StudioEditorMutationTicket
  extends Pick<StudioEditorInstanceScope, "authScopeKey" | "workId"> {
  accessGeneration: number;
  documentGeneration: number;
}

export interface StudioEditorMutationState extends StudioEditorAsyncScope {
  accessGeneration: number;
  documentGeneration: number;
  locked: boolean;
}

export interface StudioEditorCollaborationLockState {
  /** 권한·원본 hydration·revision 충돌 등 CRDT와 무관한 기존 문서 잠금. */
  documentAccessLocked: boolean;
  /** 서버 공유 원고에서 실제 연산 채널이 필요한 편집 세션인지 여부. */
  operationSyncRequired: boolean;
  /** 같은 room 세대의 document/runtime pair와 최초 remote frontier 병합이 모두 끝났는지 여부. */
  operationSyncReady: boolean;
}

/**
 * Presence 연결은 CRDT 모듈 로딩과 초기 frontier 동기화보다 먼저 준비될 수 있다. 공유 편집은
 * document와 scene runtime이 한 쌍으로 노출되고 최초 remote frontier가 화면 history에
 * 병합되기 전까지 fail-closed로 유지해 그 사이의 로컬 변경이 서버 연산 로그에서 빠지는 일을
 * 막는다. 신규/리믹스 로컬 초안에는 이 추가 잠금을 적용하지 않는다.
 */
export function isStudioEditorCollaborationLocked({
  documentAccessLocked,
  operationSyncRequired,
  operationSyncReady,
}: StudioEditorCollaborationLockState): boolean {
  return documentAccessLocked || (operationSyncRequired && !operationSyncReady);
}

export function isStudioEditorAsyncScopeCurrent(
  request: Pick<StudioEditorInstanceScope, "authScopeKey" | "workId">,
  current: StudioEditorAsyncScope
): boolean {
  return (
    current.mounted &&
    !current.aborted &&
    request.authScopeKey === current.authScopeKey &&
    request.workId === current.workId
  );
}

/**
 * 네트워크/워커를 기다리는 동안 팀 역할이 edit에서 view로 바뀌면, 이전 render가 캡처한
 * `collaborationDocumentLocked=false`를 신뢰하지 않는다. scope와 access generation이 모두
 * 그대로이고 최신 권한도 편집 가능할 때만 비동기 결과를 문서 state에 반영한다.
 */
export function isStudioEditorMutationContinuationAllowed(
  ticket: StudioEditorMutationTicket,
  current: StudioEditorMutationState
): boolean {
  return (
    isStudioEditorAsyncScopeCurrent(ticket, current) &&
    !current.locked &&
    ticket.accessGeneration === current.accessGeneration &&
    ticket.documentGeneration === current.documentGeneration
  );
}

/**
 * 공유 문서 PATCH 응답은 전체 owner detail/doc을 돌려주지 않는다. cached detail의 revision만
 * 전진시키면 오래된 doc이 최신처럼 보이므로, 성공 시 반드시 폐기해 다음 owner 도구가 재조회한다.
 */
export function invalidateStudioOwnerDetailAfterSharedSave<T>(_cached: T | null): null {
  return null;
}

export function isStudioSourceHydrationPending(
  workId: string | null,
  remixId: string | null,
  hydrated: boolean
): boolean {
  return Boolean((workId || remixId) && !hydrated);
}

export function isStudioCuttoonSourceFormat(format: unknown): format is "cuttoon" {
  return format === "cuttoon";
}

/**
 * 저장된 원고는 계정과 작품을 React instance 경계에 포함해 이전 scope의 문서 state가 단 한
 * 프레임도 재사용되지 않게 한다. 신규·리믹스는 로그인 전 로컬 편집을 보존해야 해 계정과 분리한다.
 */
export function studioEditorInstanceKey({
  authScopeKey,
  workId,
  remixId,
  draftSessionEpoch = 0,
}: StudioEditorInstanceScope): string {
  if (workId) return JSON.stringify(["work", authScopeKey ?? "guest", workId]);
  if (remixId) return JSON.stringify(["remix", remixId, draftSessionEpoch]);
  return JSON.stringify(["new", draftSessionEpoch]);
}
