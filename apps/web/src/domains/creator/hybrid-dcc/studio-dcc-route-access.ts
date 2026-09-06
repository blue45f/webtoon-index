export type StudioDccRouteAccess = "allowed" | "denied" | "pending";

export interface StudioDccRouteAccessInput {
  readonly collaborationOperationSyncPending: boolean;
  readonly documentReloadRequired: boolean;
  readonly expectsSharedDocument: boolean;
  readonly liveRoom: boolean;
  readonly liveRoomEditAuthorityReady: boolean;
  readonly remixId: string | null;
  readonly sharedDocumentAccess: "comment" | "edit" | "view" | null;
  readonly sharedDocumentCanView: boolean;
  readonly sharedDocumentStatus: "active" | null;
  readonly studioAuthReady: boolean;
  readonly studioAuthUserId: string | null;
  readonly workHydrated: boolean;
  readonly workHydrationFailed: boolean;
  readonly workHydrationUnsupportedFormat: boolean;
  readonly workId: string | null;
}

/**
 * Resolves whether the route may mount the mutable Hybrid DCC authority.
 *
 * A saved-work URL is not an authorization receipt. Its route stays intact while auth,
 * document hydration, and the first collaboration frontier settle, but the local OPFS
 * workspace is not opened until the same authenticated document scope is editable.
 */
export function resolveStudioDccRouteAccess({
  collaborationOperationSyncPending,
  documentReloadRequired,
  expectsSharedDocument,
  liveRoom,
  liveRoomEditAuthorityReady,
  remixId,
  sharedDocumentAccess,
  sharedDocumentCanView,
  sharedDocumentStatus,
  studioAuthReady,
  studioAuthUserId,
  workHydrated,
  workHydrationFailed,
  workHydrationUnsupportedFormat,
  workId,
}: StudioDccRouteAccessInput): StudioDccRouteAccess {
  if (
    documentReloadRequired
    || workHydrationFailed
    || workHydrationUnsupportedFormat
  ) {
    return "denied";
  }

  // A genuinely new local draft has no server document identity to authorize. A remix is not a
  // blank draft: its source must finish hydrating before a DCC authority can bind to the result.
  if (workId === null && remixId === null && !liveRoom && !expectsSharedDocument) {
    return "allowed";
  }

  if (!studioAuthReady || !workHydrated) return "pending";
  // Live rooms do not expose StudioSharedDocument. Their authority is the reconciled CRDT plus
  // the durable operation outbox, supplied as one explicit receipt by StudioPage. A room-scoped
  // remix must not bypass that receipt merely because its source has finished hydrating.
  if (workId === null && liveRoom) {
    return liveRoomEditAuthorityReady ? "allowed" : "pending";
  }
  if (workId === null && remixId !== null) return "allowed";
  if (workId !== null && studioAuthUserId === null) return "denied";
  if (!expectsSharedDocument) return "denied";
  if (sharedDocumentStatus === null || sharedDocumentAccess === null) return "pending";
  if (!sharedDocumentCanView || sharedDocumentAccess !== "edit") return "denied";
  if (collaborationOperationSyncPending) return "pending";
  return "allowed";
}
