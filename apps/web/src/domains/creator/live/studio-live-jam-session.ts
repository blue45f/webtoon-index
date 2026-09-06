import { STUDIO_LIVE_JAM_WORK_ID_PREFIX } from "../../../shared/lib/studio-live-jam-scope";
import { buildStudioLiveShareHref } from "../creator-studio-links";

export {
  isStudioLiveJamScope,
  isStudioLiveJamWorkId,
  STUDIO_LIVE_JAM_WORK_ID_PREFIX,
} from "../../../shared/lib/studio-live-jam-scope";

export const STUDIO_LIVE_ROOM_SEARCH_PARAM = "room";

export function readStudioLiveRoomQuery(
  search: string | URLSearchParams | null | undefined
): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const room = params?.get(STUDIO_LIVE_ROOM_SEARCH_PARAM)?.trim() ?? "";
  return room.length > 0 ? room : null;
}

export function createStudioLiveInstantWorkId(
  now: () => number = Date.now,
  random: () => number = Math.random
): string {
  const salt = random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${STUDIO_LIVE_JAM_WORK_ID_PREFIX}${now().toString(36)}-${salt}`;
}

export function resolveStudioLiveSessionWorkId(input: {
  workId: string | null;
  roomId: string | null;
  draftWorkId?: string | null;
  instantWorkId: string;
}): string {
  return input.workId
    ?? input.roomId
    ?? input.draftWorkId
    ?? input.instantWorkId;
}

const STUDIO_LIVE_SHARED_PAGE_ID_MAX = 160;

/**
 * Instant jam rooms have no saved page list. A random first-page UUID made
 * "follow this tab" fail because the follower never had that id.
 */
export function studioLiveSharedBootstrapPageId(workId: string): string {
  const trimmed = workId.trim();
  if (!trimmed) return "";
  const id = `jam-page-${trimmed}`;
  return id.length <= STUDIO_LIVE_SHARED_PAGE_ID_MAX
    ? id
    : id.slice(0, STUDIO_LIVE_SHARED_PAGE_ID_MAX);
}

export function shouldSeedStudioLiveSharedBootstrapPage(savedWorkId: string | null): boolean {
  return savedWorkId == null;
}

/** Server ACL document. A Magma-style `?room=` jam is not a shared work document. */
export function shouldExpectStudioSharedDocument(input: {
  workAuthScopeKey: string | null;
  workId: string | null;
  remixId: string | null;
}): boolean {
  return Boolean(input.workAuthScopeKey && input.workId && !input.remixId);
}

/** Socket.IO is required for saved team/draft rooms and Magma-style public jam rooms. */
export function shouldRequireStudioLiveServer(input: {
  expectsSharedDocument: boolean;
  draftCollaborationReady: boolean;
  /** Instant / `?room=` jam. Two browsers cannot share BroadcastChannel. */
  liveJam?: boolean;
}): boolean {
  return input.expectsSharedDocument
    || input.draftCollaborationReady
    || input.liveJam === true;
}

export function shouldPublishStudioLiveJamRoom(input: {
  workId: string | null;
  remixId: string | null;
  roomId: string | null;
}): boolean {
  return !input.workId && !input.remixId && !input.roomId;
}

export function withStudioLiveJamRoom(
  search: string | URLSearchParams,
  roomId: string
): URLSearchParams {
  const next = new URLSearchParams(search);
  next.set(STUDIO_LIVE_ROOM_SEARCH_PARAM, roomId);
  return next;
}

export function openStudioLiveCompanionTab(
  roomId: string,
  openWindow: (
    url: string,
    target: string,
    features: string
  ) => Window | null = (url, target, features) => window.open(url, target, features)
): boolean {
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  const opened = openWindow(
    buildStudioLiveShareHref(roomId, origin),
    "_blank",
    "noopener,noreferrer"
  );
  return opened !== null;
}
