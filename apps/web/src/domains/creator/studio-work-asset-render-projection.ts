
import type { StudioWorkAssetReference } from "./studio-work-asset-client";
import type { StudioWorkAssetHydrationState } from "./studio-work-asset-hydrator";

import {
  parseStudioWorkAssetSourceUri,
  STUDIO_WORK_ASSET_TYPES,
  studioWorkAssetReferenceKey,
} from "@/shared/lib/studio-work-asset-contract";

const WORK_ASSET_TYPES = new Set<string>(STUDIO_WORK_ASSET_TYPES);

export interface StudioWorkAssetSceneRecordLike {
  id: string;
  pageId: string;
  orderIndex: number;
  deleted: boolean;
  payload: {
    type: string;
    props: Record<string, unknown>;
  };
}

export interface StudioWorkAssetSceneReference {
  pageId: string;
  orderIndex: number;
  reference: StudioWorkAssetReference;
}

export interface StudioWorkAssetRenderPlaceholder {
  assetId: string;
  elementType: StudioWorkAssetReference["elementType"];
  status: "loading" | "error" | "ready";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
  message: string | null;
  /** Present only in the render projection; never serialize it. */
  resourceUrl?: string;
}

export interface StudioWorkAssetRenderProjection<TElement> {
  elements: TElement[];
  placeholders: StudioWorkAssetRenderPlaceholder[];
}

/**
 * Resolves a stable authored image source for transient, read-only consumers such as palettes,
 * thumbnails, and storyboards. Blob URLs are returned only from an exact ready hydration state;
 * callers must never write the result back to page history or the CRDT document.
 */
export function resolveStudioWorkAssetReadableImageSource(
  element: { id: string; type: string; src?: unknown },
  resolveState: (reference: StudioWorkAssetReference) => StudioWorkAssetHydrationState | null
): string | null {
  if (typeof element.src !== "string") return null;
  const reference = parseStudioWorkAssetSourceUri(element.src);
  if (!reference) return element.src;
  if (
    element.type !== "image" || reference.elementType !== "image" ||
    element.id !== reference.assetId
  ) return null;
  const state = exactState(resolveState(reference), reference);
  return state?.status === "ready" && state.source.type === "image"
    ? state.resourceUrl
    : null;
}

/**
 * Clones only preview elements whose immutable source can be resolved. Unready stable URIs stay in
 * the returned preview page so `StudioPageThumbnail` can render its explicit inert placeholder;
 * the authored page and every authored element retain their original source identity.
 */
export function projectStudioWorkAssetPageForReadOnlyPreview<
  TElement extends { id: string; type: string; src?: unknown },
  TPage extends { elements: readonly TElement[] },
>(input: {
  page: TPage;
  hydrationRevision: number;
  resolveState: (reference: StudioWorkAssetReference) => StudioWorkAssetHydrationState | null;
}): TPage {
  void input.hydrationRevision;
  let changed = false;
  const elements = input.page.elements.map((element) => {
    if (typeof element.src !== "string" || !parseStudioWorkAssetSourceUri(element.src)) {
      return element;
    }
    const source = resolveStudioWorkAssetReadableImageSource(element, input.resolveState);
    if (!source) return element;
    changed = true;
    return { ...element, src: source };
  });
  return changed ? { ...input.page, elements } : input.page;
}

export function resolveStudioWorkAssetHydrationScope(input: {
  workId: string | null;
  authUserId: string | null;
  remixId: string | null;
  documentStatus: string | null | undefined;
  canView: boolean;
}): string | null {
  return input.workId && input.authUserId && !input.remixId &&
    input.documentStatus === "active" && input.canView
    ? input.workId
    : null;
}

function isWorkAssetType(value: unknown): value is StudioWorkAssetReference["elementType"] {
  return typeof value === "string" && WORK_ASSET_TYPES.has(value);
}

export function collectStudioWorkAssetSceneReferences(
  records: readonly StudioWorkAssetSceneRecordLike[]
): StudioWorkAssetSceneReference[] {
  const unique = new Map<string, StudioWorkAssetSceneReference>();
  for (const record of records) {
    const elementType = record.payload.props.elementType;
    if (
      record.deleted ||
      record.payload.type !== "reference" ||
      !isWorkAssetType(elementType) ||
      Object.keys(record.payload.props).length === 1
    ) {
      continue;
    }
    const reference = { assetId: record.id, elementType };
    unique.set(studioWorkAssetReferenceKey(reference), {
      pageId: record.pageId,
      orderIndex: record.orderIndex,
      reference,
    });
  }
  return [...unique.values()].sort((left, right) =>
    left.pageId.localeCompare(right.pageId) ||
    left.orderIndex - right.orderIndex ||
    left.reference.assetId.localeCompare(right.reference.assetId)
  );
}

export function areStudioWorkAssetSceneReferencesEqual(
  left: readonly StudioWorkAssetSceneReference[],
  right: readonly StudioWorkAssetSceneReference[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((candidate, index) => {
    const other = right[index];
    return Boolean(
      other && candidate.pageId === other.pageId &&
      candidate.orderIndex === other.orderIndex &&
      candidate.reference.assetId === other.reference.assetId &&
      candidate.reference.elementType === other.reference.elementType
    );
  });
}

function finiteField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function geometry(
  source: Record<string, unknown> | undefined,
  orderIndex: number
): Pick<StudioWorkAssetRenderPlaceholder, "x" | "y" | "width" | "height" | "rotation"> {
  return {
    x: finiteField(source?.x, 36),
    y: finiteField(source?.y, 36 + Math.min(12, Math.max(0, orderIndex)) * 18),
    width: Math.max(48, finiteField(source?.width, 240)),
    height: Math.max(48, finiteField(source?.height, 140)),
    rotation: finiteField(source?.rotation, 0),
  };
}

function exactState(
  state: StudioWorkAssetHydrationState | null,
  reference: StudioWorkAssetReference
): StudioWorkAssetHydrationState | null {
  return state?.reference.assetId === reference.assetId &&
    state.reference.elementType === reference.elementType
    ? state
    : null;
}

function placeholderFor(
  sceneReference: StudioWorkAssetSceneReference,
  state: StudioWorkAssetHydrationState | null,
  source?: Record<string, unknown>
): StudioWorkAssetRenderPlaceholder {
  const reference = sceneReference.reference;
  const exact = exactState(state, reference);
  const stateSource = exact?.status === "ready"
    ? exact.source as unknown as Record<string, unknown>
    : source;
  const status = exact?.status === "ready" ? "ready" : exact?.status === "error" ? "error" : "loading";
  const typeLabel = reference.elementType === "image"
    ? "이미지"
    : reference.elementType === "vrm"
      ? "VRM"
      : "3D 배경";
  return {
    assetId: reference.assetId,
    elementType: reference.elementType,
    status,
    ...geometry(stateSource, sceneReference.orderIndex),
    label: status === "ready" ? `${typeLabel} 원본 준비됨` : `${typeLabel} 에셋 ${status === "error" ? "오류" : "불러오는 중"}`,
    message: exact?.status === "error" ? exact.message : null,
    ...(exact?.status === "ready" ? { resourceUrl: exact.resourceUrl } : {}),
  };
}

/**
 * Produces an ephemeral canvas-only view. Stable `work-asset://` sources in the authored page are
 * replaced by Blob URLs only in the returned array; loading/error records become inert visual
 * placeholders. The input array and its elements are never mutated.
 */
export function projectStudioWorkAssetPageForRender<
  TElement extends { id: string; type: string },
>(input: {
  pageId: string;
  elements: readonly TElement[];
  references: readonly StudioWorkAssetSceneReference[];
  hydrationRevision: number;
  resolveState: (reference: StudioWorkAssetReference) => StudioWorkAssetHydrationState | null;
}): StudioWorkAssetRenderProjection<TElement> {
  // The revision makes the external-store dependency explicit to React callers. State resolution
  // itself stays callback-based so this pure projection never receives a mutable Map reference.
  void input.hydrationRevision;
  const references = input.references.filter((candidate) => candidate.pageId === input.pageId);
  const referenceById = new Map(references.map((candidate) => [candidate.reference.assetId, candidate]));
  const represented = new Set<string>();
  const placeholders: StudioWorkAssetRenderPlaceholder[] = [];
  const elements: TElement[] = [];

  for (const element of input.elements) {
    const sceneReference = referenceById.get(element.id);
    if (!sceneReference || element.type !== sceneReference.reference.elementType) {
      elements.push(element);
      continue;
    }
    represented.add(element.id);
    const state = exactState(input.resolveState(sceneReference.reference), sceneReference.reference);
    if (state?.status === "ready" && element.type === "image") {
      elements.push({ ...element, src: state.resourceUrl } as TElement);
      continue;
    }
    // Once the authoritative CRDT topology declares this ID a work asset, no unverified local
    // data/file URL may stand in for it. Only the exact admitted server body can become renderable.
    placeholders.push(placeholderFor(
      sceneReference,
      state,
      element as unknown as Record<string, unknown>
    ));
  }

  for (const sceneReference of references) {
    if (represented.has(sceneReference.reference.assetId)) continue;
    const state = exactState(input.resolveState(sceneReference.reference), sceneReference.reference);
    if (state?.status === "ready" && state.source.type === "image") {
      elements.push({ ...state.source, src: state.resourceUrl } as unknown as TElement);
      continue;
    }
    placeholders.push(placeholderFor(sceneReference, state));
  }

  return { elements, placeholders };
}
