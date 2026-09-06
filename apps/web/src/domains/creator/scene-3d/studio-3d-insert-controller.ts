import type {
  StudioBackground3DInsertResult,
  StudioVrmPoserInsertResult,
} from "./studio-3d-insert-contract";
import type { StudioEditorMutationTicket } from "../studio-editor-scope";

export type Studio3dInsertMutationAdmission = (
  ticket: StudioEditorMutationTicket
) => boolean;

export interface StudioVrmInsertTarget {
  readonly type: string;
  readonly width?: number;
}

export interface StudioVrmTargetPatch {
  readonly src: string;
  readonly height: number;
  readonly vrmScene: StudioVrmPoserInsertResult["scene"];
}

export interface StudioVrmNewImageInsert {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly elementPatch: {
    readonly vrmScene: StudioVrmPoserInsertResult["scene"];
    readonly name: string;
  };
}

export type StudioVrmInsertHandler = (
  result: StudioVrmPoserInsertResult
) => boolean;

export type StudioBg3dInsertHandler = (
  result: StudioBackground3DInsertResult
) => boolean | Promise<boolean>;

export interface StudioBg3dPerspectiveGuideAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly flipped?: boolean;
  readonly flippedY?: boolean;
  readonly skewX?: number;
  readonly skewY?: number;
}

export interface StudioBg3dCanvasPerspectiveGuide {
  readonly axis: StudioBackground3DInsertResult["perspectiveGuides"][number]["axis"];
  readonly x: number;
  readonly y: number;
}

const MAX_NORMALIZED_GUIDE_DISTANCE = 100_000;

/**
 * Maps renderer-normalized vanishing points only when the LT anchor has an axis-aligned transform.
 * A rotated/flipped/skewed bundle needs a full element-transform projection; guessing with its
 * bounding box would silently author a wrong ruler, so that case deliberately fails closed.
 */
export function mapStudioBg3dPerspectiveGuidesToAnchor(
  guides: StudioBackground3DInsertResult["perspectiveGuides"],
  anchor: StudioBg3dPerspectiveGuideAnchor
): readonly StudioBg3dCanvasPerspectiveGuide[] {
  if (
    !Number.isFinite(anchor.x)
    || !Number.isFinite(anchor.y)
    || !Number.isFinite(anchor.width)
    || anchor.width <= 0
    || !Number.isFinite(anchor.height)
    || anchor.height <= 0
    || !Number.isFinite(anchor.rotation ?? 0)
    || Math.abs(anchor.rotation ?? 0) >= 1e-6
    || anchor.flipped === true
    || anchor.flippedY === true
    || !Number.isFinite(anchor.skewX ?? 0)
    || !Number.isFinite(anchor.skewY ?? 0)
    || Math.abs(anchor.skewX ?? 0) >= 1e-6
    || Math.abs(anchor.skewY ?? 0) >= 1e-6
    || !Array.isArray(guides)
    || guides.length > 3
  ) {
    return [];
  }

  const axes = new Set<string>();
  const mapped: StudioBg3dCanvasPerspectiveGuide[] = [];
  for (const guide of guides) {
    if (
      !guide
      || (guide.axis !== "world-x" && guide.axis !== "world-y" && guide.axis !== "world-z")
      || axes.has(guide.axis)
      || !Number.isFinite(guide.x)
      || !Number.isFinite(guide.y)
      || Math.abs(guide.x) > MAX_NORMALIZED_GUIDE_DISTANCE
      || Math.abs(guide.y) > MAX_NORMALIZED_GUIDE_DISTANCE
    ) {
      return [];
    }
    const x = anchor.x + guide.x * anchor.width;
    const y = anchor.y + guide.y * anchor.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    axes.add(guide.axis);
    mapped.push({ axis: guide.axis, x, y });
  }
  return mapped;
}

export interface ApplyStudioVrmInsertResultInput {
  readonly result: StudioVrmPoserInsertResult;
  readonly mutationTicket: StudioEditorMutationTicket | null;
  readonly admitMutation: Studio3dInsertMutationAdmission;
  readonly targetElementId?: string;
  readonly resolveTarget: (
    elementId: string
  ) => StudioVrmInsertTarget | null | undefined;
  readonly patchTarget: (
    elementId: string,
    patch: StudioVrmTargetPatch
  ) => boolean;
  readonly appendImage: (insert: StudioVrmNewImageInsert) => boolean;
}

export interface ApplyStudioBg3dInsertResultInput {
  readonly result: StudioBackground3DInsertResult;
  readonly mutationTicket: StudioEditorMutationTicket | null;
  readonly admitMutation: Studio3dInsertMutationAdmission;
  readonly targetElementId?: string;
  readonly applyRenderedImage: (
    result: StudioBackground3DInsertResult,
    targetElementId?: string
  ) => boolean | Promise<boolean>;
}

function isPositiveFiniteDimension(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Captures render at devicePixelRatio × supersample density; the element should occupy the
 * logical display size so the extra pixels become sharpness instead of physical size. Both
 * display dimensions must be valid and no larger than the raster — a hostile or partial pair
 * falls back to the raster size, which is never an upscale.
 */
function resolveVrmInsertDisplaySize(
  result: StudioVrmPoserInsertResult
): { readonly width: number; readonly height: number } {
  const { displayWidth, displayHeight } = result;
  if (
    isPositiveFiniteDimension(displayWidth)
    && isPositiveFiniteDimension(displayHeight)
    && displayWidth <= result.width
    && displayHeight <= result.height
  ) {
    return { width: displayWidth, height: displayHeight };
  }
  return { width: result.width, height: result.height };
}

export function applyStudioVrmInsertResult({
  result,
  mutationTicket,
  admitMutation,
  targetElementId,
  resolveTarget,
  patchTarget,
  appendImage,
}: ApplyStudioVrmInsertResultInput): boolean {
  if (!mutationTicket || !admitMutation(mutationTicket)) return false;
  if (
    !isPositiveFiniteDimension(result.width)
    || !isPositiveFiniteDimension(result.height)
  ) {
    return false;
  }

  if (targetElementId) {
    const target = resolveTarget(targetElementId);
    if (
      !target
      || target.type !== "image"
      || !isPositiveFiniteDimension(target.width)
    ) {
      return false;
    }
    return patchTarget(targetElementId, {
      src: result.pngDataUrl,
      height: Math.max(1, Math.round(target.width * (result.height / result.width))),
      vrmScene: result.scene,
    });
  }

  const displaySize = resolveVrmInsertDisplaySize(result);
  return appendImage({
    src: result.pngDataUrl,
    width: displaySize.width,
    height: displaySize.height,
    elementPatch: {
      vrmScene: result.scene,
      name: "3D 데생 인형",
    },
  });
}

export function applyStudioBg3dInsertResult({
  result,
  mutationTicket,
  admitMutation,
  targetElementId,
  applyRenderedImage,
}: ApplyStudioBg3dInsertResultInput): boolean | Promise<boolean> {
  if (!mutationTicket || !admitMutation(mutationTicket)) return false;
  return applyRenderedImage(result, targetElementId);
}
