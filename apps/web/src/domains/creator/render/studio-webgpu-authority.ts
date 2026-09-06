import {
  sameStudioGpuStrokes,
  snapshotStudioGpuStrokes,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";

import type { StudioWebGpuViewportSurfacePlan } from "./studio-webgpu-viewport";

export interface StudioWebGpuAuthorityFrame {
  readonly strokes: readonly StudioGpuStroke[];
  readonly committedElementIds: readonly string[];
  readonly draftElementId: string | null;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly viewport: StudioWebGpuViewportSurfacePlan;
}

export type StudioWebGpuAuthorityInput = StudioWebGpuAuthorityFrame;

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left === right || (
    left.length === right.length
    && left.every((value, index) => value === right[index])
  );
}

export function sameStudioWebGpuViewportSurface(
  left: StudioWebGpuViewportSurfacePlan,
  right: StudioWebGpuViewportSurfacePlan
): boolean {
  return Object.is(left.surface.left, right.surface.left)
    && Object.is(left.surface.top, right.surface.top)
    && Object.is(left.surface.width, right.surface.width)
    && Object.is(left.surface.height, right.surface.height)
    && Object.is(left.transform.scaleX, right.transform.scaleX)
    && Object.is(left.transform.scaleY, right.transform.scaleY)
    && Object.is(left.transform.offsetX, right.transform.offsetX)
    && Object.is(left.transform.offsetY, right.transform.offsetY)
    && left.transform.flipX === right.transform.flipX;
}

export function snapshotStudioWebGpuAuthority(
  input: StudioWebGpuAuthorityInput
): StudioWebGpuAuthorityFrame {
  return {
    strokes: snapshotStudioGpuStrokes(input.strokes),
    committedElementIds: [...input.committedElementIds],
    draftElementId: input.draftElementId,
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    viewport: {
      surface: { ...input.viewport.surface },
      transform: { ...input.viewport.transform },
    },
  };
}

/**
 * Exact authority check for hiding source Konva pixels. It deliberately compares every semantic
 * operation and viewport field rather than trusting the engine fingerprint alone.
 */
export function isStudioWebGpuAuthorityCurrent(
  authority: StudioWebGpuAuthorityFrame | null,
  current: StudioWebGpuAuthorityInput
): authority is StudioWebGpuAuthorityFrame {
  return authority !== null
    && current.strokes.length > 0
    && Object.is(authority.documentWidth, current.documentWidth)
    && Object.is(authority.documentHeight, current.documentHeight)
    && authority.draftElementId === current.draftElementId
    && sameStringArray(authority.committedElementIds, current.committedElementIds)
    && sameStudioWebGpuViewportSurface(authority.viewport, current.viewport)
    && sameStudioGpuStrokes(authority.strokes, current.strokes);
}
