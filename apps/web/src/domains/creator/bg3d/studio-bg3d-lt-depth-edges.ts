/**
 * Worker-safe depth contour extraction for the 3D line-and-tone pipeline.
 *
 * A raw Sobel response treats every projected depth slope as ink and produces a response on both
 * sides of an occlusion. This stage instead compares opposite one-sided depth changes. A smooth
 * slope has matching near/far changes and cancels, while a depth step is kept only on the nearer
 * (occluding) surface. Optional second-order curvature restores subtle form/crease cues without
 * reintroducing the far-side halo at a large discontinuity.
 *
 * The input can be Three/WebGL device depth or already-linear normalized depth. Relative scaling
 * against the current sample's remaining range compensates the strong far-distance compression of
 * device depth while preserving exact cancellation on a linear ramp.
 */

export const STUDIO_BG3D_LT_DEPTH_EDGE_MAX_PIXELS = 8_388_608;

export interface StudioBg3dLtDepthEdgeInput {
  readonly width: number;
  readonly height: number;
  /** Top-down, normalized depth. Smaller values are closer to the camera. */
  readonly depth: Float32Array;
  /** Includes bounded second-order form/crease cues in addition to foreground contours. */
  readonly includeCreases: boolean;
}

const MINIMUM_DEPTH_RANGE = 1 / 1_024;
const LARGE_DISCONTINUITY = 0.125;
const DIAGONAL_DISTANCE_WEIGHT = Math.SQRT1_2;

function assertInput(input: StudioBg3dLtDepthEdgeInput): void {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("LT depth edge input must be an object.");
  }
  if (!Number.isSafeInteger(input.width) || input.width < 1) {
    throw new RangeError("LT depth edge width must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(input.height) || input.height < 1) {
    throw new RangeError("LT depth edge height must be a positive safe integer.");
  }
  const pixelCount = input.width * input.height;
  if (
    !Number.isSafeInteger(pixelCount) ||
    pixelCount > STUDIO_BG3D_LT_DEPTH_EDGE_MAX_PIXELS
  ) {
    throw new RangeError(
      `LT depth edge input exceeds the ${STUDIO_BG3D_LT_DEPTH_EDGE_MAX_PIXELS}-pixel budget.`
    );
  }
  if (!(input.depth instanceof Float32Array)) {
    throw new TypeError("LT depth edge samples must be a Float32Array.");
  }
  if (input.depth.length !== pixelCount) {
    throw new RangeError("LT depth edge length must equal width * height.");
  }
  if (typeof input.includeCreases !== "boolean") {
    throw new TypeError("LT depth edge includeCreases must be a boolean.");
  }
  for (const value of input.depth) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError("LT depth edge samples must be finite and normalized to [0, 1].");
    }
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

type DirectionalDepthScratch = [farther: number, nearer: number, curvature: number];

function writeDirectionalFeatures(
  center: number,
  first: number,
  second: number,
  inverseRange: number,
  distanceWeight: number,
  output: DirectionalDepthScratch
): void {
  const firstDelta = (first - center) * inverseRange * distanceWeight;
  const secondDelta = (second - center) * inverseRange * distanceWeight;
  output[0] = Math.max(0, firstDelta, secondDelta);
  output[1] = Math.max(0, -firstDelta, -secondDelta);
  // Opposite deltas sum to zero on a planar/ramp depth field. Their sum is the centered second
  // derivative, which retains a projected ridge or valley without responding to constant slope.
  output[2] = Math.abs(firstDelta + secondDelta);
}

/**
 * Returns a fresh one-byte normalized response per pixel. Canvas-border pixels remain zero: their
 * missing opposite sample cannot distinguish a real contour from the edge of the capture. Alpha
 * silhouette extraction is handled independently by the LT renderer.
 */
export function extractStudioBg3dLtDepthEdges(
  input: StudioBg3dLtDepthEdgeInput
): Uint8ClampedArray {
  assertInput(input);
  const { width, height, depth, includeCreases } = input;
  const response = new Uint8ClampedArray(width * height);
  if (width < 3 || height < 3) return response;
  // Reuse one numeric scratch buffer. The maximum admitted image has millions of pixels, so
  // allocating direction tuples or objects inside the loop would turn a bounded raster pass into
  // avoidable garbage-collector pressure.
  const direction: DirectionalDepthScratch = [0, 0, 0];

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const center = depth[index];
      const inverseRange = 1 / Math.max(MINIMUM_DEPTH_RANGE, 1 - center);
      let farther = 0;
      let nearer = 0;
      let curvature = 0;
      writeDirectionalFeatures(
        center,
        depth[index - 1],
        depth[index + 1],
        inverseRange,
        1,
        direction
      );
      farther = Math.max(farther, direction[0]);
      nearer = Math.max(nearer, direction[1]);
      curvature = Math.max(curvature, direction[2]);
      writeDirectionalFeatures(
        center,
        depth[index - width],
        depth[index + width],
        inverseRange,
        1,
        direction
      );
      farther = Math.max(farther, direction[0]);
      nearer = Math.max(nearer, direction[1]);
      curvature = Math.max(curvature, direction[2]);
      writeDirectionalFeatures(
        center,
        depth[index - width - 1],
        depth[index + width + 1],
        inverseRange,
        DIAGONAL_DISTANCE_WEIGHT,
        direction
      );
      farther = Math.max(farther, direction[0]);
      nearer = Math.max(nearer, direction[1]);
      curvature = Math.max(curvature, direction[2]);
      writeDirectionalFeatures(
        center,
        depth[index - width + 1],
        depth[index + width - 1],
        inverseRange,
        DIAGONAL_DISTANCE_WEIGHT,
        direction
      );
      farther = Math.max(farther, direction[0]);
      nearer = Math.max(nearer, direction[1]);
      curvature = Math.max(curvature, direction[2]);

      // A constant slope exposes comparable nearer and farther deltas and cancels. At an
      // occlusion, only the foreground pixel has a dominant farther neighbor, so the far surface
      // receives no duplicate halo.
      const foregroundContour = Math.max(0, farther - nearer);
      let feature = foregroundContour;
      if (includeCreases) {
        const span = Math.max(farther, nearer);
        // Large depth steps are contour territory: retain curvature only on the selected
        // occluding side. Small second derivatives remain useful form/crease information.
        const crease = span < LARGE_DISCONTINUITY || foregroundContour > 0 ? curvature : 0;
        feature = Math.max(feature, crease);
      }
      response[index] = Math.round(clamp01(feature) * 255);
    }
  }
  return response;
}
