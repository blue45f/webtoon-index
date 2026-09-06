import { parseStudioWorkAssetSourceUri } from "@/shared/lib/studio-work-asset-contract";

export const STUDIO_WORK_ASSET_DESTRUCTIVE_EDIT_REASON =
  "팀 에셋 원본은 안전한 버전 교체가 준비될 때까지 픽셀을 직접 굽는 편집을 사용할 수 없어요. 배치·필터 같은 비파괴 편집을 이용해 주세요.";

export function studioWorkAssetDestructiveEditReason(element: {
  id: string;
  type: string;
  src?: unknown;
} | null): string | null {
  if (!element || element.type !== "image" || typeof element.src !== "string") return null;
  const reference = parseStudioWorkAssetSourceUri(element.src);
  return reference?.elementType === "image" && reference.assetId === element.id
    ? STUDIO_WORK_ASSET_DESTRUCTIVE_EDIT_REASON
    : null;
}

export function studioWorkAssetSourceReplacementReason(
  element: { id: string; type: string; src?: unknown } | null,
  patch: Record<string, unknown>
): string | null {
  const reason = studioWorkAssetDestructiveEditReason(element);
  if (!reason || !Object.hasOwn(patch, "src") || patch.src === element?.src) return null;
  return reason;
}

/**
 * Guards bulk/coalesced transitions (timeline scrubs, frame capture, history tools) that bypass
 * the single-element patch helper. Removing an element remains legal because the CRDT bridge
 * tombstones it while retaining its immutable reference props; only in-place source replacement
 * would downgrade the durable reference to a topology-only legacy envelope.
 */
export function studioWorkAssetSourceTransitionReason(
  previous: readonly { id: string; type: string; src?: unknown }[],
  next: readonly { id: string; type: string; src?: unknown }[]
): string | null {
  const nextById = new Map(next.map((element) => [element.id, element] as const));
  for (const element of previous) {
    const nextElement = nextById.get(element.id);
    if (!nextElement) continue;
    const reason = studioWorkAssetSourceReplacementReason(element, { src: nextElement.src });
    if (reason) return reason;
  }
  return null;
}

/** Compares source identity across a whole document, including elements moved between pages. */
export function studioWorkAssetDocumentSourceTransitionReason(
  previousPages: readonly {
    elements: readonly { id: string; type: string; src?: unknown }[];
  }[],
  nextPages: readonly {
    elements: readonly { id: string; type: string; src?: unknown }[];
  }[]
): string | null {
  return studioWorkAssetSourceTransitionReason(
    previousPages.flatMap((page) => page.elements),
    nextPages.flatMap((page) => page.elements)
  );
}
