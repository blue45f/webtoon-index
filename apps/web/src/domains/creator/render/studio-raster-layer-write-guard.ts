import { isEffectivelyLocked } from "../studio-layers";

import type { PageState } from "../studio-page-state";

export interface StudioRasterLayerWriteGuardState {
  readonly page: PageState | null;
  readonly pageId: string;
  readonly operationId: string;
  readonly layerId: string;
}

/**
 * Local early-rejection mirror of the authoritative server layer admission. This does not grant
 * permission—the server remains authoritative—but prevents an encode/upload when the current
 * page projection already proves that the vector source or its owning group is locked/stale.
 */
export function canPublishStudioRasterLayer(
  input: StudioRasterLayerWriteGuardState
): boolean {
  const page = input.page;
  if (!page || page.id !== input.pageId) return false;
  const element = page.elements.find(({ id }) => id === input.operationId);
  if (!element || element.type !== "draw") return false;
  if ((element.groupId ?? "page-root") !== input.layerId) return false;
  const groups = page.groups ?? [];
  if (
    input.layerId !== "page-root"
    && !groups.some(({ id }) => id === input.layerId)
  ) return false;
  return !isEffectivelyLocked(element, groups);
}
