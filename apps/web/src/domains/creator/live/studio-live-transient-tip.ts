/** One reversible tip patch, not a bitmap per stroke and never a canvas readback. */
export interface StudioLiveTipBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface TipRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/**
 * Round live tips are previews, not repeated pigment stamps. Save only the affected backing-pixel
 * rectangle before painting a cap and restore it before appending the next stable segment. A
 * single scratch canvas is reused during a gesture and released at its end. drawImage preserves
 * the pixels without getImageData, which would stall the GPU and require an origin-clean canvas.
 */
export class StudioLiveTransientTip {
  private backing: HTMLCanvasElement | null = null;
  private rectangle: TipRectangle | null = null;

  get retainedPixelCount(): number {
    return this.backing ? this.backing.width * this.backing.height : 0;
  }

  show(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    bounds: StudioLiveTipBounds,
    paint: () => void,
  ): boolean {
    this.restore(canvas, context);
    const { a, b, c, d, e, f } = context.getTransform();
    const values = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, a, b, c, d, e, f];
    if (!values.every(Number.isFinite) || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return false;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [bounds.minY, bounds.maxY]) {
        xs.push(a * x + c * y + e);
        ys.push(b * x + d * y + f);
      }
    }
    // Include the antialiased fringe, snap to backing pixels, and clip before allocating.
    const x = Math.max(0, Math.floor(Math.min(...xs)) - 2);
    const y = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    const width = Math.min(canvas.width, Math.ceil(Math.max(...xs)) + 2) - x;
    const height = Math.min(canvas.height, Math.ceil(Math.max(...ys)) + 2) - y;
    if (width <= 0 || height <= 0) return false;
    const backing = this.backing ?? canvas.ownerDocument?.createElement("canvas");
    if (!backing) return false;
    // Reuse capacity without ever exceeding the current live surface's bounded allocation.
    const capacityWidth = Math.min(canvas.width, Math.max(width, this.backing?.width ?? 0));
    const capacityHeight = Math.min(canvas.height, Math.max(height, this.backing?.height ?? 0));
    if (backing.width !== capacityWidth) backing.width = capacityWidth;
    if (backing.height !== capacityHeight) backing.height = capacityHeight;
    this.backing = backing;
    const backup = backing.getContext("2d");
    if (!backup) { this.discard(true); return false; }
    backup.save();
    try {
      backup.setTransform(1, 0, 0, 1, 0, 0);
      backup.globalAlpha = 1;
      backup.globalCompositeOperation = "source-over";
      backup.clearRect(0, 0, width, height);
      backup.drawImage(canvas, x, y, width, height, 0, 0, width, height);
    } finally {
      backup.restore();
    }
    this.rectangle = { x, y, width, height, canvasWidth: canvas.width, canvasHeight: canvas.height };
    try {
      paint();
    } catch (error) {
      this.restore(canvas, context);
      throw error;
    }
    return true;
  }

  restore(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
    const rect = this.rectangle;
    this.rectangle = null;
    if (!rect || !this.backing) return;
    // Resizing resets pixels. Never restore a previous surface's pixels into the new surface.
    if (canvas.width !== rect.canvasWidth || canvas.height !== rect.canvasHeight) return;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.clearRect(rect.x, rect.y, rect.width, rect.height);
      context.drawImage(this.backing, 0, 0, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
    } finally {
      context.restore();
    }
  }

  /** Called before surface replay/clear; release=true at gesture end or detach. */
  discard(release = false): void {
    this.rectangle = null;
    if (release && this.backing) {
      this.backing.width = 1;
      this.backing.height = 1;
      this.backing = null;
    }
  }
}
