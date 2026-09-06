/**
 * Shared Stage fields carried by a BG3D insert without transferring VRM ownership to the raster.
 * This leaf stays type-only so the document controller never imports renderer/runtime code.
 */

export interface StudioBg3dSharedStageInsertProjection {
  /** Full-fidelity VRM sources baked in this capture; Studio may hide, but never delete, them. */
  readonly linkedCharacterCapture?: {
    readonly kind: "full-fidelity-linked-vrm-capture";
    readonly elementIds: readonly string[];
    /** Exact root placement captured for this background; the VRM source is not rewritten. */
    readonly stagePlacements: readonly {
      readonly elementId: string;
      readonly expectedRuntimeKey: string;
      readonly transform: {
        readonly position: readonly [number, number, number];
        readonly rotationY: number;
      };
    }[];
  };
  /** Explicit user intent for the page-owned background/character association. */
  readonly sharedStageMutation?: {
    readonly kind: "background-only" | "connect" | "refresh" | "relink" | "unlink";
  };
  /** Output representation is independent from the shared Stage relationship mutation. */
  readonly materialization?: {
    readonly kind: "editable-lt-bundle" | "detached-editable-composite";
  };
}
