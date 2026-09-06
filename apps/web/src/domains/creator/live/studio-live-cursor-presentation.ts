import { isStudioLiveCursorCleared } from "./studio-live-collaboration-protocol";

import type {
  StudioLivePeer,
  StudioLivePeerCursor,
} from "./studio-live-collaboration-room";
import type { StudioLiveCursorQualityTier } from "./studio-live-cursor-quality";

export interface StudioLiveCursorPresentationOptions {
  cursors: readonly StudioLivePeerCursor[];
  peers: readonly StudioLivePeer[];
  pageId: string;
  followingSessionId?: string | null;
  pinnedSessionIds?: ReadonlySet<string>;
  visible?: boolean;
  qualityTier?: StudioLiveCursorQualityTier | null;
}

function presentationLimit(tier: StudioLiveCursorQualityTier | null): number {
  if (tier === "constrained") return 20;
  if (tier === "balanced") return 40;
  return 64;
}

function activityScore(
  cursor: StudioLivePeerCursor,
  peer: StudioLivePeer | undefined,
  followingSessionId: string | null,
  pinnedSessionIds: ReadonlySet<string>
): number {
  if (pinnedSessionIds.has(cursor.participant.sessionId)) return 5;
  if (cursor.participant.sessionId === followingSessionId) return 4;
  if (cursor.cursor.drawing) return 3;
  if (peer?.visibility === "active") return 2;
  return 1;
}

/**
 * Figma-style cursor admission: cursor-chat authors, the followed collaborator, active strokes and
 * active editors win before idle pointers. Outbound cadence remains owned by the adaptive transport;
 * this function only bounds local DOM/SVG work and never affects CRDT, locks or another participant.
 */
export function selectStudioLivePresentedCursors({
  cursors,
  peers,
  pageId,
  followingSessionId = null,
  pinnedSessionIds = new Set<string>(),
  visible = true,
  qualityTier = null,
}: StudioLiveCursorPresentationOptions): StudioLivePeerCursor[] {
  if (!visible) return [];
  const peerBySession = new Map(peers.map((peer) => [peer.sessionId, peer] as const));
  const eligible = cursors.filter(
    (entry) =>
      !isStudioLiveCursorCleared(entry.cursor) && entry.cursor.pageId === pageId
  );

  eligible.sort((left, right) => {
    const scoreDelta =
      activityScore(
        right,
        peerBySession.get(right.participant.sessionId),
        followingSessionId,
        pinnedSessionIds
      ) -
      activityScore(
        left,
        peerBySession.get(left.participant.sessionId),
        followingSessionId,
        pinnedSessionIds
      );
    if (scoreDelta !== 0) return scoreDelta;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.participant.sessionId.localeCompare(right.participant.sessionId);
  });

  return eligible.slice(0, presentationLimit(qualityTier));
}
