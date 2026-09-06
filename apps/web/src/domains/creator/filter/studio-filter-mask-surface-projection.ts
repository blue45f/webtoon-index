import type { StudioFilterMaskSurfaceHydrationState } from "./studio-filter-mask-surface-hydrator";

import {
  isStudioFilterMaskSurfaceId,
} from "@/shared/lib/studio-filter-mask-surface-contract";

export interface StudioFilterMaskSurfaceElementLike {
  readonly id: string;
  readonly type: string;
  readonly filterMaskSurfaceId?: unknown;
  readonly filterMaskSrc?: unknown;
  readonly filterMaskEnabled?: unknown;
}

export interface StudioInlineFilterMaskMutationPatch {
  readonly filterMaskSrc?: string | undefined;
  readonly filterMaskEnabled?: boolean | undefined;
}

export interface StudioFilterMaskSurfaceRenderProjection<TElement> {
  readonly elements: TElement[];
  readonly pendingSurfaceIds: readonly string[];
  readonly errorSurfaceIds: readonly string[];
}

function exactHydrationState(
  surfaceId: string,
  state: StudioFilterMaskSurfaceHydrationState | null
): StudioFilterMaskSurfaceHydrationState | null {
  return state?.surfaceId === surfaceId ? state : null;
}

/**
 * Makes a newly authored inline mask authoritative in one immutable element transition.
 *
 * A durable surface ID describes one immutable historical bitmap. Reusing that ID after paint,
 * replace, invert, or delete would let hydration project the old bitmap over the new inline PNG
 * and would make server-save/archive treat the stale surface as canonical. Explicit `undefined`
 * mutations are removed as own-properties as well, because the portable archive intentionally
 * treats the mere presence of `filterMaskSurfaceId` as a reference that must be materialized.
 */
export function applyStudioInlineFilterMaskMutation<
  TElement extends StudioFilterMaskSurfaceElementLike,
  TPatch extends object,
>(
  element: TElement,
  patch: TPatch & StudioInlineFilterMaskMutationPatch
): TElement {
  const next = { ...element, ...patch } as Record<string, unknown>;
  delete next.filterMaskSurfaceId;
  if (Object.hasOwn(patch, "filterMaskSrc") && patch.filterMaskSrc === undefined) {
    delete next.filterMaskSrc;
  }
  if (Object.hasOwn(patch, "filterMaskEnabled") && patch.filterMaskEnabled === undefined) {
    delete next.filterMaskEnabled;
  }
  return next as TElement;
}

/**
 * Collects only canonical authored refs. Invalid/unversioned strings are intentionally excluded
 * from network hydration; the render projection still strips any inline fallback for them so an
 * untrusted malformed ref cannot silently widen a masked filter to the whole image.
 */
export function collectStudioFilterMaskSurfaceIds(
  elements: readonly StudioFilterMaskSurfaceElementLike[]
): string[] {
  const unique = new Set<string>();
  for (const element of elements) {
    if (
      element.type === "image"
      && isStudioFilterMaskSurfaceId(element.filterMaskSurfaceId)
    ) {
      unique.add(element.filterMaskSurfaceId);
    }
  }
  return [...unique].sort();
}

/**
 * Produces a render-only element view. A ready exact surface receives its Blob URL; pending,
 * failed, stale, or malformed refs have `filterMaskSrc` removed so the renderer fails closed.
 * Authored elements and page history are never mutated.
 */
export function projectStudioFilterMaskSurfacesForRender<
  TElement extends StudioFilterMaskSurfaceElementLike,
>(input: {
  readonly elements: TElement[];
  readonly hydrationRevision: number;
  readonly resolveState: (
    surfaceId: string
  ) => StudioFilterMaskSurfaceHydrationState | null;
}): StudioFilterMaskSurfaceRenderProjection<TElement> {
  void input.hydrationRevision;
  const pendingSurfaceIds = new Set<string>();
  const errorSurfaceIds = new Set<string>();
  let changed = false;
  const elements = input.elements.map((element) => {
    const rawSurfaceId = element.filterMaskSurfaceId;
    if (element.type !== "image" || typeof rawSurfaceId !== "string" || rawSurfaceId.length === 0) {
      return element;
    }
    if (!isStudioFilterMaskSurfaceId(rawSurfaceId)) {
      if (element.filterMaskSrc === undefined) return element;
      changed = true;
      const { filterMaskSrc: _discarded, ...projected } = element;
      return projected as TElement;
    }
    const state = exactHydrationState(rawSurfaceId, input.resolveState(rawSurfaceId));
    if (state?.status === "ready") {
      if (element.filterMaskSrc === state.resourceUrl) return element;
      changed = true;
      return { ...element, filterMaskSrc: state.resourceUrl };
    }
    if (state?.status === "error") errorSurfaceIds.add(rawSurfaceId);
    else pendingSurfaceIds.add(rawSurfaceId);
    if (element.filterMaskSrc === undefined) return element;
    changed = true;
    const { filterMaskSrc: _discarded, ...projected } = element;
    return projected as TElement;
  });
  return {
    elements: changed ? elements : input.elements,
    pendingSurfaceIds: [...pendingSurfaceIds].sort(),
    errorSurfaceIds: [...errorSurfaceIds].sort(),
  };
}

function isBlobUrl(value: unknown): value is string {
  return typeof value === "string" && /^blob:/iu.test(value);
}

function projectElementForServerSave<
  TElement extends StudioFilterMaskSurfaceElementLike,
>(
  element: TElement,
  isDurableSurface: (surfaceId: string) => boolean
): TElement {
  if (isBlobUrl(element.filterMaskSrc)) {
    throw new Error("렌더 전용 필터 마스크 Blob URL은 작품 문서에 저장할 수 없습니다.");
  }
  if (
    element.type !== "image"
    || !isStudioFilterMaskSurfaceId(element.filterMaskSurfaceId)
    || !isDurableSurface(element.filterMaskSurfaceId)
    || element.filterMaskSrc === undefined
  ) {
    return element;
  }
  const { filterMaskSrc: _discarded, ...projected } = element;
  return projected as TElement;
}

/**
 * Removes only inline fallbacks whose exact immutable surface is already durable. Local drafts,
 * unacknowledged refs, and legacy inline masks stay portable. Blob URLs are always rejected.
 */
export function projectStudioFilterMaskPagesForServerSave<
  TElement extends StudioFilterMaskSurfaceElementLike,
  TPage extends { readonly elements: readonly TElement[] },
>(
  pages: readonly TPage[],
  isDurableSurface: (surfaceId: string) => boolean
): TPage[] {
  return pages.map((page) => {
    let changed = false;
    const elements = page.elements.map((element) => {
      const projected = projectElementForServerSave(element, isDurableSurface);
      if (projected !== element) changed = true;
      return projected;
    });
    return changed ? { ...page, elements } : page;
  });
}

export function projectStudioFilterMaskElementsForServerSave<
  TElement extends StudioFilterMaskSurfaceElementLike,
>(
  elements: readonly TElement[],
  isDurableSurface: (surfaceId: string) => boolean
): TElement[] {
  return elements.map((element) => projectElementForServerSave(element, isDurableSurface));
}
