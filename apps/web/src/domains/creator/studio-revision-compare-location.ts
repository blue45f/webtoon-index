import type { StudioRevisionChange } from "./studio-revision-diff";

export interface StudioRevisionCompareLocation {
  pageId: string;
  elementId?: string;
}

export function studioRevisionCurrentLocation(
  change: StudioRevisionChange
): StudioRevisionCompareLocation | null {
  // A local→target reparent descriptor points `pageId` at the destination that does not contain
  // the element yet. Navigation before restore must open its current (previous) page instead.
  const pageId = change.kind === "element-reparented"
    ? change.previousPageId
    : change.pageId ?? change.previousPageId;
  if (!pageId) return null;
  return { pageId, ...(change.elementId ? { elementId: change.elementId } : {}) };
}
