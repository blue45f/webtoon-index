/**
 * Renderer-neutral payload contracts produced by Studio's lazy 3D editors.
 *
 * These values cross from the heavyweight Three/React capture surfaces into the document insert
 * controller. Keep this leaf type-only so insertion policy never points back at those components.
 */

import type { StudioBg3dSceneDocument } from "../bg3d/studio-bg3d-scene-document";
import type { StudioBg3dSharedStageInsertProjection } from "../studio-shared-3d-insert-contract";
import type { StudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";

export type StudioBg3dLtRasterLayerRole =
  | "color" | "main-line" | "texture-line" | "tone";

export interface StudioBackground3DLtLayer {
  readonly role: StudioBg3dLtRasterLayerRole;
  readonly pngDataUrl: string;
  readonly width: number;
  readonly height: number;
}

/** Full-frame LT selection mask with engine-neutral `obj/<scene-node-id>` identity. */
export interface StudioBackground3DMagicFilterMask {
  readonly pngDataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly selectedObjectStableId: string;
}

export interface StudioBackground3DInsertResult extends StudioBg3dSharedStageInsertProjection {
  readonly kind: "separated";
  readonly width: number;
  readonly height: number;
  /** Back-to-front paint order: color/tone, texture line, main line. */
  readonly layers: readonly StudioBackground3DLtLayer[];
  /** Flattened fallback for document surfaces that intentionally do not support layer groups. */
  readonly compositePngDataUrl: string;
  /** Finite camera vanishing points normalized to the captured image placement. */
  readonly perspectiveGuides: readonly {
    readonly axis: "world-x" | "world-y" | "world-z";
    readonly x: number;
    readonly y: number;
  }[];
  /** Optional single-object Magic Layer mask captured in the same frame as every LT raster. */
  readonly magicFilterMask?: StudioBackground3DMagicFilterMask;
  readonly bg3dScene: StudioBg3dSceneDocument;
}

export type StudioVrmPoserInsertResult = {
  pngDataUrl: string;
  /** Capture raster size in pixels — the PNG's natural dimensions. */
  width: number;
  height: number;
  /**
   * Logical size the insert should occupy on the document at 100% zoom, in canvas units.
   * Captures render at devicePixelRatio × supersample density, so displaying at the raster size
   * would make the layer physically oversized; omitting these falls back to the raster size for
   * older callers. Must not exceed the raster size — the insert never upscales past natural
   * pixels.
   */
  displayWidth?: number;
  displayHeight?: number;
  scene: StudioVrmSceneDocument;
};
