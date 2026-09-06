import { peekStudioStageCssScale } from "./studio-live-visible-tap";

export interface StudioDrawCompletionInput {
  kind?: "freehand" | "line" | "rect" | "ellipse" | "star" | "arrow" | "triangle" | "polygon";
  points: readonly number[];
}
/**
 * A freehand tap is a valid paint/erase dot. Geometric tools still require a minimum drag so an
 * accidental click does not create an invisible shape in history.
 */
export function isCompleteStudioDrawOp(input: StudioDrawCompletionInput): boolean {
  const kind = input.kind ?? "freehand";
  if (kind === "freehand") return input.points.length >= 2;
  const [x1 = 0, y1 = 0, x2 = x1, y2 = y1] = input.points;
  if (kind === "line") return Math.hypot(x2 - x1, y2 - y1) >= 3;
  return Math.abs(x2 - x1) >= 3 && Math.abs(y2 - y1) >= 3;
}

/**
 * Taps and a single accepted freehand segment must become history-authoritative in the pointerup
 * task. Longer freehand paths and geometric shapes may use the deferred scene batching pipeline.
 */
export function isStudioImmediateFreehandCommit(input: StudioDrawCompletionInput): boolean {
  if ((input.kind ?? "freehand") !== "freehand") return false;
  if (input.points.length < 2 || input.points.length % 2 !== 0) return false;
  if (input.points.length <= 4) return true;
  // A zoomed-out webtoon page can map a long screen stroke to <24 document px. Point count
  // still distinguishes a coalesced tap from a continuous gesture. Eight or more samples is
  // never a tap — the 9-input smoke route is a full screen stroke even when document travel
  // stays under the 24px threshold.
  if (input.points.length >= 16) return false;

  // Browsers may deliver several coalesced samples for one tiny physical move. Counting array
  // entries alone misclassified that same short mark as a long deferred stroke on textured
  // brushes. Use document-space travel so a fast tap/flick stays immediately durable regardless
  // of input sampling density, while genuinely long strokes retain the batching optimization.
  let travel = 0;
  for (let index = 2; index < input.points.length; index += 2) {
    const previousX = input.points[index - 2];
    const previousY = input.points[index - 1];
    const x = input.points[index];
    const y = input.points[index + 1];
    if (![previousX, previousY, x, y].every(Number.isFinite)) return false;
    travel += Math.hypot(x! - previousX!, y! - previousY!);
    if (travel > 24) return false;
  }
  const viewScale = peekStudioStageCssScale();
  return travel * viewScale <= 24;
}
