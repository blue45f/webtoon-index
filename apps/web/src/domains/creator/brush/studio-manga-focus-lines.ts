export type StudioMangaLineKind = "radial-focus" | "parallel-speed" | "burst-flash";

export interface StudioMangaFocusLinesSettings {
  kind: StudioMangaLineKind;
  centerX: number; // 0..1
  centerY: number; // 0..1
  innerRadius: number; // 0..1, clear center hole
  outerRadius: number; // 0..1, line end boundary
  density: number; // 0..1 (maps to line count: 20..400)
  lineWidth: number; // px thickness: 1..20
  irregularity: number; // 0..1 (length & spacing jitter)
  angle: number; // radians (for parallel speed lines)
  color: string; // hex or rgba
  seed: number;
}

// Simple deterministic random generator (Mulberry32)
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates the SVG path data for comic focus and speed lines.
 * Returns a string that can be used in a Path2D or SVG <path d="..." />
 */
export function generateStudioMangaLinesPathData(
  width: number,
  height: number,
  settings: StudioMangaFocusLinesSettings
): string {
  const rand = mulberry32(settings.seed);
  let path = "";

  const cx = settings.centerX * width;
  const cy = settings.centerY * height;
  const maxDim = Math.max(width, height);
  const rInner = settings.innerRadius * maxDim;
  const rOuter = settings.outerRadius * maxDim;

  const numLines = Math.floor(20 + settings.density * 380);

  if (settings.kind === "radial-focus" || settings.kind === "burst-flash") {
    // Both are radial, but burst-flash is generally sharper and can be tweaked
    for (let i = 0; i < numLines; i++) {
      const angleOffset = rand() * settings.irregularity * ((Math.PI * 2) / numLines);
      const angle = (i / numLines) * Math.PI * 2 + angleOffset;

      const lengthVariation = rand() * settings.irregularity;
      const variationScale = settings.kind === "radial-focus" ? 0.5 : 0.8;
      const startR = rInner + lengthVariation * (rOuter - rInner) * variationScale;
      const endR = rOuter;

      const startX = cx + Math.cos(angle) * startR;
      const startY = cy + Math.sin(angle) * startR;
      const endX = cx + Math.cos(angle) * endR;
      const endY = cy + Math.sin(angle) * endR;

      // We want wedges (tapered lines)
      // Base of the wedge at endR (outer edge), point at startR (inner edge)
      const wedgeBaseWidth = settings.lineWidth * (1 + rand() * settings.irregularity);
      const perpAngle = angle + Math.PI / 2;
      const p1X = endX + (Math.cos(perpAngle) * wedgeBaseWidth) / 2;
      const p1Y = endY + (Math.sin(perpAngle) * wedgeBaseWidth) / 2;
      const p2X = endX - (Math.cos(perpAngle) * wedgeBaseWidth) / 2;
      const p2Y = endY - (Math.sin(perpAngle) * wedgeBaseWidth) / 2;

      path += `M ${startX.toFixed(2)},${startY.toFixed(2)} L ${p1X.toFixed(2)},${p1Y.toFixed(2)} L ${p2X.toFixed(
        2
      )},${p2Y.toFixed(2)} Z `;
    }
  } else if (settings.kind === "parallel-speed") {
    const angle = settings.angle;
    const perpAngle = angle + Math.PI / 2;

    const diag = Math.sqrt(width * width + height * height);
    const centerWidth = width / 2;
    const centerHeight = height / 2;

    for (let i = 0; i < numLines; i++) {
      // position along the perpendicular line
      const perpPos = (rand() - 0.5) * diag * 1.5;

      // position along the parallel line
      const parallelStart = (rand() - 0.5) * diag * settings.irregularity;
      const length = diag * (0.5 + rand() * 0.5);
      const parallelEnd = parallelStart + length;

      const sx = centerWidth + Math.cos(perpAngle) * perpPos + Math.cos(angle) * parallelStart;
      const sy = centerHeight + Math.sin(perpAngle) * perpPos + Math.sin(angle) * parallelStart;

      const ex = centerWidth + Math.cos(perpAngle) * perpPos + Math.cos(angle) * parallelEnd;
      const ey = centerHeight + Math.sin(perpAngle) * perpPos + Math.sin(angle) * parallelEnd;

      const wedgeBaseWidth = settings.lineWidth * (1 + rand() * settings.irregularity);
      
      const p1X = sx + (Math.cos(perpAngle) * wedgeBaseWidth) / 2;
      const p1Y = sy + (Math.sin(perpAngle) * wedgeBaseWidth) / 2;
      const p2X = sx - (Math.cos(perpAngle) * wedgeBaseWidth) / 2;
      const p2Y = sy - (Math.sin(perpAngle) * wedgeBaseWidth) / 2;

      // Point at the end (ex, ey), base at the start (sx, sy)
      path += `M ${ex.toFixed(2)},${ey.toFixed(2)} L ${p1X.toFixed(2)},${p1Y.toFixed(2)} L ${p2X.toFixed(
        2
      )},${p2Y.toFixed(2)} Z `;
    }
  }

  return path.trim();
}

/**
 * Renders the lines directly to a 2D canvas context.
 */
export function renderStudioMangaLinesToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: StudioMangaFocusLinesSettings
): void {
  ctx.save?.();
  const pathData = generateStudioMangaLinesPathData(width, height, settings);
  const path = new Path2D(pathData);
  ctx.fillStyle = settings.color;
  ctx.fill(path);
  ctx.restore?.();
}

/**
 * Applies the lines as a filter over an existing ImageData.
 * Creates an internal canvas, composites the lines, and returns the new ImageData.
 */
export function applyStudioMangaFocusLinesFilter(
  source: ImageData,
  settings: StudioMangaFocusLinesSettings
): ImageData {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(source.width, source.height);
  } else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
  } else {
    // If no canvas environment is available, return a clone to avoid throwing
    const ImageDataCtor = typeof ImageData !== "undefined" ? ImageData : null;
    if (ImageDataCtor) {
      return new ImageDataCtor(new Uint8ClampedArray(source.data), source.width, source.height);
    }
    return source; // fallback
  }

  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return source;

  ctx.putImageData(source, 0, 0);
  
  // Need to bypass TypeScript complaints if Path2D is not available in OffscreenCanvas environment types
  if (typeof Path2D !== "undefined") {
    renderStudioMangaLinesToCanvas(ctx as CanvasRenderingContext2D, source.width, source.height, settings);
  }

  return ctx.getImageData(0, 0, source.width, source.height);
}
