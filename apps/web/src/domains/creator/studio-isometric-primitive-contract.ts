/**
 * Lightweight inspector/page contract for editable isometric primitives.
 *
 * Keep this module free of geometry implementation so the relatively large planner stays behind
 * StudioPage's literal dynamic import until a user actually creates a primitive.
 */

export const STUDIO_ISOMETRIC_COORDINATE_MAX = 10_000_000;
export const STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MIN = 1;
export const STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MAX = 1_000_000;
export const STUDIO_ISOMETRIC_STAIRS_STEPS_MIN = 1;
export const STUDIO_ISOMETRIC_STAIRS_STEPS_MAX = 24;
export const STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MIN = 8;
export const STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX = 64;

export type StudioIsometricPrimitiveKind = "box" | "cylinder" | "stairs" | "wedge";

/** Size-only payload emitted by the inspector; StudioPage supplies the current origin and angle. */
export type StudioIsometricPrimitiveSpec =
  | {
      kind: "box" | "wedge";
      width: number;
      depth: number;
      height: number;
    }
  | {
      kind: "cylinder";
      width: number;
      depth: number;
      height: number;
      segments: number;
    }
  | {
      kind: "stairs";
      width: number;
      depth: number;
      height: number;
      steps: number;
    };
