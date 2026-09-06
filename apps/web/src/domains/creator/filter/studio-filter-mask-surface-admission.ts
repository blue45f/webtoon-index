import {
  isStudioFilterMaskSurfaceId,
  type StudioFilterMaskSurfaceId,
} from "@/shared/lib/studio-filter-mask-surface-contract";

export interface StudioFilterMaskSurfaceAdmissionElement {
  readonly id: string;
  readonly type: string;
  readonly filterMaskSrc?: string;
  readonly filterMaskSurfaceId?: string;
  readonly filterMaskEnabled?: boolean;
}

export interface StudioFilterMaskSurfaceHistoryAdmissionResult<TPage> {
  readonly history: TPage[][];
  readonly changed: boolean;
  readonly previousCurrentPages: readonly TPage[];
  readonly nextCurrentPages: readonly TPage[];
}

/**
 * Canonicalizes one already-visible inline Magic mask without creating a second undo step.
 *
 * Only snapshots that still own the exact target id + inline PNG are rewritten. A later mask edit
 * therefore wins over a delayed publication receipt, while undo/redo snapshots that represent the
 * same insertion gain the same immutable surface identity.
 */
export function attachStudioFilterMaskSurfaceAcrossHistory<
  TElement extends StudioFilterMaskSurfaceAdmissionElement,
  TPage extends { readonly elements: readonly TElement[] },
>(input: {
  readonly history: readonly (readonly TPage[])[];
  readonly currentIndex: number;
  readonly targetElementId: string;
  readonly expectedInlineSource: string;
  readonly surfaceId: StudioFilterMaskSurfaceId | string;
}): StudioFilterMaskSurfaceHistoryAdmissionResult<TPage> {
  if (!isStudioFilterMaskSurfaceId(input.surfaceId)) {
    throw new Error("승인된 필터 마스크 surface ID가 올바르지 않습니다.");
  }
  if (
    input.targetElementId.length === 0
    || !input.expectedInlineSource.startsWith("data:image/png;base64,")
  ) {
    throw new Error("필터 마스크 승인 대상이 올바르지 않습니다.");
  }

  const currentIndex = Math.max(
    0,
    Math.min(input.currentIndex, Math.max(0, input.history.length - 1))
  );
  const previousCurrentPages = input.history[currentIndex] ?? [];
  const currentOwnsInlineMask = previousCurrentPages.some((page) =>
    page.elements.some((element) =>
      element.id === input.targetElementId
      && element.type === "image"
      && element.filterMaskSrc === input.expectedInlineSource
      && (
        element.filterMaskSurfaceId === undefined
        || element.filterMaskSurfaceId === input.surfaceId
      )
    )
  );
  if (!currentOwnsInlineMask) {
    return {
      history: input.history.map((snapshot) => [...snapshot]),
      changed: false,
      previousCurrentPages,
      nextCurrentPages: previousCurrentPages,
    };
  }

  let changed = false;
  const history = input.history.map((snapshot) => {
    let snapshotChanged = false;
    const pages = snapshot.map((page) => {
      let pageChanged = false;
      const elements = page.elements.map((element) => {
        if (
          element.id !== input.targetElementId
          || element.type !== "image"
          || element.filterMaskSrc !== input.expectedInlineSource
          || (
            element.filterMaskSurfaceId !== undefined
            && element.filterMaskSurfaceId !== input.surfaceId
          )
        ) {
          return element;
        }
        if (
          element.filterMaskSurfaceId === input.surfaceId
          && element.filterMaskEnabled === true
        ) {
          return element;
        }
        pageChanged = true;
        return {
          ...element,
          filterMaskSurfaceId: input.surfaceId,
          filterMaskEnabled: true,
        };
      });
      if (!pageChanged) return page;
      snapshotChanged = true;
      return { ...page, elements } as TPage;
    });
    if (!snapshotChanged) return [...snapshot];
    changed = true;
    return pages;
  });

  return {
    history,
    changed,
    previousCurrentPages,
    nextCurrentPages: history[currentIndex] ?? [],
  };
}
