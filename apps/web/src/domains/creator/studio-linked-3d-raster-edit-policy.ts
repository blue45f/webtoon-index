import { STUDIO_LINKED_3D_PASS_LOCATOR_PREFIX } from "./studio-linked-3d-pass-transaction";

export const STUDIO_LINKED_3D_PASS_DESTRUCTIVE_EDIT_REASON =
  "연결된 3D 선화는 원본 Scene과 패스 영수증이 함께 관리돼요. 픽셀을 직접 바꾸려면 편집 가능한 정적 복사본을 먼저 만들어 주세요.";

export interface StudioLinked3dRasterSourceLike {
  readonly type: string;
  readonly src?: unknown;
}

/**
 * Reserved linked-pass sources are read-only Canvas authorities. Malformed values under the same
 * namespace are blocked too; they must never fall through to a browser URL loader or pixel tool.
 */
export function studioLinked3dPassDestructiveEditReason(
  element: StudioLinked3dRasterSourceLike | null,
): string | null {
  return element?.type === "image"
    && typeof element.src === "string"
    && element.src.startsWith("studio-opfs-cas:")
    ? STUDIO_LINKED_3D_PASS_DESTRUCTIVE_EDIT_REASON
    : null;
}

/** Prevents an in-place source replacement while allowing metadata-only and same-source patches. */
export function studioLinked3dPassSourceReplacementReason(
  element: StudioLinked3dRasterSourceLike | null,
  patch: Readonly<Record<string, unknown>>,
): string | null {
  const reason = studioLinked3dPassDestructiveEditReason(element);
  if (
    !reason
    || !Object.hasOwn(patch, "src")
    || patch.src === element?.src
  ) return null;
  return reason;
}

/** Defensive namespace predicate for loaders that must reject rather than navigate reserved URLs. */
export function isStudioLinked3dReservedRasterSource(value: unknown): value is string {
  return typeof value === "string"
    && (value.startsWith("studio-opfs-cas:")
      || value.startsWith(STUDIO_LINKED_3D_PASS_LOCATOR_PREFIX));
}
