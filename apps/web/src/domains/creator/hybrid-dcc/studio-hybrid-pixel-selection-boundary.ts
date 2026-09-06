/**
 * Product boundary for hybrid pixel-selection expand/contract.
 *
 * Geometry remains expandContractSelection (vector authority). OpenCV morphology always runs on a
 * deterministic alpha mask sampled from the selection so the hybrid filter path is exercised on
 * every expand/contract product action — not only unit tests.
 */

import {
  createStudioOpenCvImageProvider,
  type StudioOpenCvImageProviderOptions,
  type StudioOpenCvImageResult,
} from "../studio-opencv-image-provider";
import {
  expandContractSelection,
  isSelectionUsable,
  pointInSelection,
  type PixelSelection,
} from "../studio-selection-tools";

import {
  runHybridSelectionMaskMorphology,
  type StudioHybridObjectPickCandidate,
} from "./studio-hybrid-brush-filter-edit-runtime";


export const STUDIO_HYBRID_PIXEL_SELECTION_BOUNDARY_VERSION = 1 as const;

export type StudioHybridSelectionBoundaryDirection = "expand" | "contract";

/**
 * Sample a selection into a single-channel mask (255 = selected). Pure, DOM-free, deterministic.
 */
export function rasterizePixelSelectionToAlphaMask(
  selection: PixelSelection | null,
  width: number,
  height: number,
): Uint8Array | null {
  if (!isSelectionUsable(selection)) return null;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > 512
    || height > 512
  ) {
    return null;
  }
  const mask = new Uint8Array(width * height);
  const aspect = height / width;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      if (pointInSelection(selection, { x: u, y: v }, { aspect })) {
        mask[y * width + x] = 255;
      }
    }
  }
  return mask;
}

export type StudioHybridPixelSelectionBoundaryResult = Readonly<{
  /** Vector expand/contract result (product authority for the marquee). */
  readonly selection: PixelSelection | null;
  /** OpenCV morph result for the sampled mask; null only when selection unusable or mask failed. */
  readonly morph: StudioOpenCvImageResult | null;
  readonly direction: StudioHybridSelectionBoundaryDirection;
  readonly geometryApplied: boolean;
  readonly morphInvoked: boolean;
}>;

/**
 * Product apply path for expand/contract: geometry change + mandatory OpenCV morph on mask sample.
 */
export async function applyHybridPixelSelectionBoundaryChange(
  selection: PixelSelection | null,
  amountNorm: number,
  options?: Readonly<{
    maskWidth?: number;
    maskHeight?: number;
    requestEpoch?: number;
    runtimeLoader?: StudioOpenCvImageProviderOptions["runtimeLoader"];
  }>,
): Promise<StudioHybridPixelSelectionBoundaryResult> {
  const direction: StudioHybridSelectionBoundaryDirection = amountNorm >= 0 ? "expand" : "contract";
  const next = expandContractSelection(selection, amountNorm);
  const geometryApplied = next !== selection;

  if (!isSelectionUsable(selection)) {
    return Object.freeze({
      selection: next,
      morph: null,
      direction,
      geometryApplied,
      morphInvoked: false,
    });
  }

  const maskWidth = options?.maskWidth ?? 48;
  const maskHeight = options?.maskHeight ?? 48;
  const mask = rasterizePixelSelectionToAlphaMask(selection, maskWidth, maskHeight);
  if (!mask) {
    return Object.freeze({
      selection: next,
      morph: null,
      direction,
      geometryApplied,
      morphInvoked: false,
    });
  }

  const morph = await runHybridSelectionMaskMorphology({
    width: maskWidth,
    height: maskHeight,
    mask,
    mode: direction === "expand" ? "dilate" : "erode",
    kernelSize: 3,
    iterations: 1,
    requestEpoch: options?.requestEpoch ?? 1,
    runtimeLoader: options?.runtimeLoader,
  });

  return Object.freeze({
    selection: next,
    morph,
    direction,
    geometryApplied,
    morphInvoked: true,
  });
}

/**
 * Sync product expand used when the UI must remain synchronous: geometry first, then morph is
 * scheduled. Returns geometry immediately; callers await `morphPromise` for the OpenCV receipt.
 */
export function applyHybridPixelSelectionBoundaryChangeSync(
  selection: PixelSelection | null,
  amountNorm: number,
  options?: Parameters<typeof applyHybridPixelSelectionBoundaryChange>[2],
): Readonly<{
  readonly selection: PixelSelection | null;
  readonly morphPromise: Promise<StudioOpenCvImageResult | null>;
  readonly direction: StudioHybridSelectionBoundaryDirection;
}> {
  const direction: StudioHybridSelectionBoundaryDirection = amountNorm >= 0 ? "expand" : "contract";
  const next = expandContractSelection(selection, amountNorm);
  const morphPromise = (async () => {
    if (!isSelectionUsable(selection)) return null;
    const maskWidth = options?.maskWidth ?? 48;
    const maskHeight = options?.maskHeight ?? 48;
    const mask = rasterizePixelSelectionToAlphaMask(selection, maskWidth, maskHeight);
    if (!mask) return null;
    return runHybridSelectionMaskMorphology({
      width: maskWidth,
      height: maskHeight,
      mask,
      mode: direction === "expand" ? "dilate" : "erode",
      kernelSize: 3,
      iterations: 1,
      requestEpoch: options?.requestEpoch ?? 1,
      runtimeLoader: options?.runtimeLoader,
    });
  })();
  return Object.freeze({ selection: next, morphPromise, direction });
}

/** Re-export for product hosts that need the OpenCV provider type on the same path. */
export { createStudioOpenCvImageProvider };

export type { StudioHybridObjectPickCandidate };
