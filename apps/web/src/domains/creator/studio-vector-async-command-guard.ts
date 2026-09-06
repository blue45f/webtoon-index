/**
 * Fail-closed guard for settled vector commands that cross an async boundary.
 *
 * Paper.js Boolean/refinement work may finish after the artist has switched
 * pages, undone a change, selected another path, edited a source element, or
 * received a collaboration/review lock. The geometry result is only a
 * suggestion; this guard proves that the exact command snapshot is still the
 * current document surface before Studio's canonical `commit()` may consume it.
 */

export interface StudioVectorAsyncCommandSnapshot<Element extends { readonly id: string }> {
  readonly runId: number;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly selectedIds: readonly string[];
  readonly sourceElements: readonly Element[];
}

export interface StudioVectorAsyncCommandCurrent<Element extends { readonly id: string }> {
  readonly runId: number;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly selectedIds: readonly string[];
  readonly elements: readonly Element[];
  readonly mutationAllowed: boolean;
  readonly reviewLocked: boolean;
  readonly isElementLocked: (element: Element) => boolean;
}

export type StudioVectorAsyncCommandStaleReason =
  | "superseded"
  | "document-changed"
  | "surface-changed"
  | "selection-changed"
  | "source-changed"
  | "locked";

function sameIdentifierSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== left.length || new Set(right).size !== right.length) {
    return false;
  }
  for (const id of right) {
    if (!leftSet.has(id)) return false;
  }
  return true;
}

export function studioVectorAsyncCommandStaleReason<
  Element extends { readonly id: string },
>(
  snapshot: StudioVectorAsyncCommandSnapshot<Element>,
  current: StudioVectorAsyncCommandCurrent<Element>,
): StudioVectorAsyncCommandStaleReason | null {
  if (snapshot.runId !== current.runId) return "superseded";
  if (!current.mutationAllowed) return "document-changed";
  if (
    snapshot.pageId !== current.pageId
    || snapshot.masterEditMode !== current.masterEditMode
  ) {
    return "surface-changed";
  }
  if (!sameIdentifierSet(snapshot.selectedIds, current.selectedIds)) {
    return "selection-changed";
  }

  const currentById = new Map(current.elements.map((element) => [
    element.id,
    element,
  ]));
  for (const source of snapshot.sourceElements) {
    if (currentById.get(source.id) !== source) return "source-changed";
  }
  if (
    current.reviewLocked
    || snapshot.sourceElements.some((source) => current.isElementLocked(source))
  ) {
    return "locked";
  }
  return null;
}
