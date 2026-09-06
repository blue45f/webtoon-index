/**
 * Magma-style `?room=work-instant-…` jam rooms are not Creator ACL documents.
 * Cloudflare ticket subjects must stay inside `isRealtimeId` (no underscore).
 */
export const STUDIO_LIVE_JAM_WORK_ID_PREFIX = "work-instant-";

const STUDIO_LIVE_JAM_WORK_ID =
  /^work-instant-[0-9a-z]{1,16}-[0-9a-z]{4}$/;

export function isStudioLiveJamWorkId(value: string): boolean {
  return STUDIO_LIVE_JAM_WORK_ID.test(value);
}

export function isStudioLiveJamScope(scope: {
  readonly workId: string;
  readonly roomId: string;
}): boolean {
  return scope.workId === scope.roomId && isStudioLiveJamWorkId(scope.workId);
}

export function studioRealtimeJamGuestActorId(sessionId: string): string {
  return `guest:${sessionId}`;
}
