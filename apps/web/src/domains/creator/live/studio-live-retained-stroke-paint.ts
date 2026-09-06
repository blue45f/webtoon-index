/**
 * Round-cap suffix stroke shared by live highlighter travel and the eraser preview.
 * One-point suffixes still emit a cap so a coalesced sample is visible.
 */
export function paintStudioLiveRetainedRoundStroke(
  context: CanvasRenderingContext2D,
  pairs: readonly { readonly x: number; readonly y: number }[],
  start: number,
  style: {
    readonly stroke: string;
    readonly width: number;
    readonly opacity: number;
    readonly composite?: GlobalCompositeOperation;
  },
): void {
  if (pairs.length === 0) return;
  const from = Math.max(0, Math.min(start, pairs.length - 1));
  context.globalCompositeOperation = style.composite ?? "source-over";
  context.globalAlpha = Math.max(0, Math.min(1, style.opacity));
  context.strokeStyle = style.stroke;
  context.fillStyle = style.stroke;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(0.5, style.width);
  context.beginPath();
  context.moveTo(pairs[from]!.x, pairs[from]!.y);
  if (from + 1 >= pairs.length) {
    context.lineTo(pairs[from]!.x, pairs[from]!.y);
  } else {
    for (let index = from + 1; index < pairs.length; index += 1) {
      context.lineTo(pairs[index]!.x, pairs[index]!.y);
    }
  }
  context.stroke();
}
