import {
  composeAnimationFrameNodes,
  composeMat2d,
  rotateMat2d,
  scaleMat2d,
  sceneDigest,
  sceneIRSchema,
  transformSceneNodes,
  translateMat2d,
} from "@toonspectrum/studio-project-model";

import type {
  AnimationGraphIR,
  CameraSampleIR,
  ColorIR,
  Mat2d,
  SceneIR,
  SceneNodeIR,
} from "@toonspectrum/studio-project-model";

/**
 * V12 §13 animation-lane production utilities: per-frame X-sheet composition
 * with the camera *baked* into node geometry, so every SceneIR engine renders
 * the camera move identically without a camera concept of its own.
 *
 * Pure module — no React, no engine import. Frames come back as schema-valid
 * SceneIR plus a digest, so batch output and determinism checks share one
 * structure.
 */

const WHITE: ColorIR = { r: 1, g: 1, b: 1, a: 1 };

/**
 * Camera → view matrix (the bake transform):
 *
 *   V = R(rotationDeg) · S(scale) · T(−x, −y)
 *
 * i.e. the camera target (x, y) is translated to the origin first, then the
 * world is scaled and rotated about that origin (the camera pivot). A world
 * point p lands at `R·S·(p − c)`; the camera position itself always bakes to
 * the scene origin. Uniform scale keeps stroke widths exact (|det|^0.5 = s).
 */
export function cameraViewMatrix(camera: CameraSampleIR): Mat2d {
  return composeMat2d(
    rotateMat2d(camera.rotationDeg),
    composeMat2d(
      scaleMat2d(camera.scale, camera.scale),
      translateMat2d(-camera.x, -camera.y),
    ),
  );
}

/** Inclusive integer frame window `from..to`. */
export interface AnimationFrameRange {
  from: number;
  to: number;
}

export interface RenderAnimationFramesOptions {
  /** Output scene dimensions (SceneIR requires them; the graph has none). */
  widthPx: number;
  heightPx: number;
  /** Frame background; defaults to opaque white. */
  background?: ColorIR;
}

export interface RenderedAnimationFrame {
  frame: number;
  /** Schema-valid scene with the frame's camera baked into node geometry. */
  scene: SceneIR;
  /** FNV-1a digest of the scene — equal inputs must produce equal digests. */
  sceneDigest: string;
  /** Composition + camera-bake warnings for this frame, merged in order. */
  warnings: string[];
}

export interface RenderAnimationFramesResult {
  frames: RenderedAnimationFrame[];
}

function assertFrameRange(frameRange: AnimationFrameRange): void {
  const { from, to } = frameRange;
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new TypeError(
      `frameRange must use integer frames, got ${from}..${to}`,
    );
  }
  if (from > to) {
    throw new RangeError(`frameRange.from (${from}) must be <= frameRange.to (${to})`);
  }
}

/**
 * Renders the frame sequence `from..to` (inclusive): each frame is composed
 * from the X-sheet (exposure holds included), the sampled camera is baked into
 * the node geometry via the view matrix above, and the result is re-parsed
 * through sceneIRSchema so it is always a valid engine input. Warnings from
 * composition (unresolved cels, out-of-duration frames) and from the bake
 * (non-uniform/singular camera scale) are merged per frame — never dropped.
 */
export function renderAnimationFrames(
  graph: AnimationGraphIR,
  frameRange: AnimationFrameRange,
  resolveCel: (celId: string) => SceneNodeIR[] | null,
  options: RenderAnimationFramesOptions,
): RenderAnimationFramesResult {
  assertFrameRange(frameRange);
  const frames: RenderedAnimationFrame[] = [];
  for (let frame = frameRange.from; frame <= frameRange.to; frame += 1) {
    const composition = composeAnimationFrameNodes(graph, frame, resolveCel);
    const baked = transformSceneNodes(
      composition.nodes,
      cameraViewMatrix(composition.camera),
    );
    const scene = sceneIRSchema.parse({
      version: 11,
      width: options.widthPx,
      height: options.heightPx,
      background: options.background ?? WHITE,
      nodes: baked.nodes,
    });
    frames.push({
      frame,
      scene,
      sceneDigest: sceneDigest(scene),
      warnings: [...composition.warnings, ...baked.warnings],
    });
  }
  return { frames };
}
