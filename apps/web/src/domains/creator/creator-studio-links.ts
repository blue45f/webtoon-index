// 창작 스튜디오 딥링크 빌더 — 시리즈·챌린지·리믹스·팬창작·업로드 모드를 URL로 전달한다.

export type StudioLinkParams = {
  seriesId?: string | null;
  challengeId?: string | null;
  remixId?: string | null;
  titleId?: string | null;
  workId?: string | null;
  mode?: "upload" | null;
};

export function studioCreationLinkParams(
  params: Pick<StudioLinkParams, "workId" | "titleId" | "seriesId" | "challengeId">
): Pick<StudioLinkParams, "titleId" | "seriesId" | "challengeId"> {
  // Query relationship aliases are an intent for creating a new work. Once an existing work is
  // opened, its server document (including a restored revision) is authoritative; replaying a
  // stale deep-link alias on the next content save could silently undo that restore.
  if (params.workId) {
    return { titleId: null, seriesId: null, challengeId: null };
  }
  return {
    titleId: params.titleId ?? null,
    seriesId: params.seriesId ?? null,
    challengeId: params.challengeId ?? null,
  };
}

export function buildStudioHref(params: StudioLinkParams = {}): string {
  const search = new URLSearchParams();
  if (params.workId) search.set("id", params.workId);
  if (params.remixId) search.set("remix", params.remixId);
  if (params.titleId) search.set("titleId", params.titleId);
  if (params.seriesId) search.set("seriesId", params.seriesId);
  if (params.challengeId) search.set("challengeId", params.challengeId);
  if (params.mode === "upload") search.set("mode", "upload");
  const query = search.toString();
  return query ? `/studio?${query}` : "/studio";
}

/**
 * Magma-style same-session invite. `room` is the live presence/cursor/CRDT key.
 * Pass `savedWorkId` only for an existing work document — a jam room must not set `id`,
 * or the second tab will treat the instant session as a server work and lock the canvas.
 */
export function buildStudioLiveShareHref(
  roomId: string,
  origin?: string,
  savedWorkId?: string | null
): string {
  const search = new URLSearchParams();
  if (savedWorkId) search.set("id", savedWorkId);
  search.set("room", roomId);
  const path = `/studio?${search.toString()}`;
  return origin ? new URL(path, origin).toString() : path;
}

export function parseStudioSearchParams(search: URLSearchParams): {
  workId: string | null;
  remixId: string | null;
  titleId: string | null;
  seriesId: string | null;
  challengeId: string | null;
  mode: "upload" | null;
} {
  const mode = search.get("mode");
  return {
    workId: search.get("id"),
    remixId: search.get("remix"),
    titleId: search.get("titleId"),
    seriesId: search.get("seriesId"),
    challengeId: search.get("challengeId"),
    mode: mode === "upload" ? "upload" : null,
  };
}
