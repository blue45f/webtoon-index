import {
  STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_OUTPUT_BYTES,
  isStudioBg3dShotContactSheetResult,
  readStudioBg3dShotContactSheetPngDimensions,
  resolveStudioBg3dShotContactSheetLayout,
  validateStudioBg3dShotContactSheetImages,
  validateStudioBg3dShotContactSheetResult,
  type StudioBg3dShotContactSheetImage,
  type StudioBg3dShotContactSheetLayoutOptions,
  type StudioBg3dShotContactSheetOutput,
  type StudioBg3dShotContactSheetProgress,
  type StudioBg3dShotContactSheetResult,
} from "./studio-bg3d-shot-contact-sheet-contract";

export interface StudioBg3dShotContactSheetRuntime {
  createCanvas(width: number, height: number): OffscreenCanvas;
  createImageBitmap(png: Blob): Promise<ImageBitmap>;
}

export interface StudioBg3dShotContactSheetBuildOptions {
  readonly layout?: StudioBg3dShotContactSheetLayoutOptions;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dShotContactSheetProgress) => void;
}

function abortError(): Error {
  const error = new Error("컷 콘택트 시트 생성을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function unsupportedRuntimeError(): Error {
  const error = new Error("이 브라우저 Worker는 OffscreenCanvas PNG 합성을 지원하지 않습니다.");
  error.name = "NotSupportedError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function defaultRuntime(): StudioBg3dShotContactSheetRuntime {
  const CanvasConstructor = globalThis.OffscreenCanvas;
  const decode = globalThis.createImageBitmap;
  if (typeof CanvasConstructor !== "function" || typeof decode !== "function") {
    throw unsupportedRuntimeError();
  }
  return {
    createCanvas: (width, height) => new CanvasConstructor(width, height),
    createImageBitmap: (png) => decode(png),
  };
}

function safeClose(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    // A decoded bitmap must never remain intentionally live because close() itself misbehaved.
  }
}

function emitProgress(
  callback: StudioBg3dShotContactSheetBuildOptions["onProgress"],
  progress: StudioBg3dShotContactSheetProgress,
): void {
  try {
    callback?.(progress);
  } catch {
    // Rendering success must not depend on a diagnostic callback supplied by the caller.
  }
}

function drawTransparencyBackdrop(
  context: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.fillStyle = "#fafafa";
  context.fillRect(x, y, width, height);
  context.fillStyle = "#e4e4e7";
  const tile = 16;
  for (let tileY = 0; tileY < height; tileY += tile) {
    for (let tileX = 0; tileX < width; tileX += tile) {
      if (((tileX / tile) + (tileY / tile)) % 2 === 0) continue;
      context.fillRect(
        x + tileX,
        y + tileY,
        Math.min(tile, width - tileX),
        Math.min(tile, height - tileY),
      );
    }
  }
}

function drawShot(
  context: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  image: StudioBg3dShotContactSheetImage,
  globalIndex: number,
  slotIndex: number,
  layout: ReturnType<typeof resolveStudioBg3dShotContactSheetLayout>,
): void {
  if (
    !Number.isSafeInteger(bitmap.width) ||
    !Number.isSafeInteger(bitmap.height) ||
    bitmap.width !== image.width ||
    bitmap.height !== image.height
  ) {
    throw new TypeError("디코딩된 콘택트 시트 이미지 크기가 PNG IHDR와 일치하지 않습니다.");
  }
  const column = slotIndex % layout.columns;
  const row = Math.floor(slotIndex / layout.columns);
  const x = layout.padding + column * (layout.cellWidth + layout.gap);
  const y = layout.padding + row * (layout.cellHeight + layout.labelHeight + layout.gap);
  const scale = Math.min(layout.cellWidth / bitmap.width, layout.cellHeight / bitmap.height);
  const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale));
  const drawX = x + Math.floor((layout.cellWidth - drawWidth) / 2);
  const drawY = y + Math.floor((layout.cellHeight - drawHeight) / 2);

  // Transparent line-only LT passes stay visible against a light checkerboard instead of
  // disappearing as black strokes on a dark thumbnail cell.
  drawTransparencyBackdrop(context, x, y, layout.cellWidth, layout.cellHeight);
  context.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
  context.fillStyle = "#18181b";
  context.font = `600 ${Math.min(22, Math.max(12, Math.floor(layout.labelHeight * 0.42)))}px sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  const number = String(globalIndex + 1).padStart(3, "0");
  context.fillText(
    `${number} · ${image.shotName}`,
    x + 8,
    y + layout.cellHeight + layout.labelHeight / 2,
    Math.max(1, layout.cellWidth - 16),
  );
}

/**
 * Decodes and composites shots sequentially so at most one source ImageBitmap is live.
 * Production callers should run this function inside the dedicated contact-sheet Worker.
 */
export async function buildStudioBg3dShotContactSheets(
  images: readonly StudioBg3dShotContactSheetImage[],
  options: StudioBg3dShotContactSheetBuildOptions = {},
  runtime?: StudioBg3dShotContactSheetRuntime,
): Promise<StudioBg3dShotContactSheetResult> {
  await validateStudioBg3dShotContactSheetImages(images, options.signal);
  const layout = resolveStudioBg3dShotContactSheetLayout(images.length, options.layout);
  throwIfAborted(options.signal);
  const activeRuntime = runtime ?? defaultRuntime();
  const sheets: StudioBg3dShotContactSheetOutput[] = [];
  let completedShots = 0;
  let completedSheets = 0;
  let totalOutputBytes = 0;

  for (let sheetIndex = 0; sheetIndex < layout.sheetCount; sheetIndex += 1) {
    throwIfAborted(options.signal);
    const canvas = activeRuntime.createCanvas(layout.sheetWidth, layout.sheetHeight);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw unsupportedRuntimeError();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = layout.background;
    context.fillRect(0, 0, layout.sheetWidth, layout.sheetHeight);
    const start = sheetIndex * layout.capacity;
    const sheetImages = images.slice(start, start + layout.capacity);

    try {
      for (const [slotIndex, image] of sheetImages.entries()) {
        throwIfAborted(options.signal);
        const bitmap = await activeRuntime.createImageBitmap(image.png);
        try {
          throwIfAborted(options.signal);
          drawShot(context, bitmap, image, start + slotIndex, slotIndex, layout);
        } finally {
          safeClose(bitmap);
        }
        completedShots += 1;
        emitProgress(options.onProgress, {
          completedShots,
          totalShots: layout.shotCount,
          completedSheets,
          totalSheets: layout.sheetCount,
        });
      }
      throwIfAborted(options.signal);
      const png = await canvas.convertToBlob({ type: "image/png" });
      const dimensions = await readStudioBg3dShotContactSheetPngDimensions(
        png,
        STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES,
      );
      if (dimensions.width !== layout.sheetWidth || dimensions.height !== layout.sheetHeight) {
        throw new TypeError("생성된 콘택트 시트 PNG 크기가 Canvas 레이아웃과 일치하지 않습니다.");
      }
      totalOutputBytes += png.size;
      if (totalOutputBytes > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_OUTPUT_BYTES) {
        throw new RangeError("콘택트 시트 PNG 합계가 출력 메모리 예산을 벗어났습니다.");
      }
      sheets.push({
        sheetNumber: sheetIndex + 1,
        fileName: `contact-sheet-${String(sheetIndex + 1).padStart(3, "0")}.png`,
        width: layout.sheetWidth,
        height: layout.sheetHeight,
        shotIds: sheetImages.map((image) => image.shotId),
        png,
      });
      completedSheets += 1;
      emitProgress(options.onProgress, {
        completedShots,
        totalShots: layout.shotCount,
        completedSheets,
        totalSheets: layout.sheetCount,
      });
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  const result: StudioBg3dShotContactSheetResult = { layout, sheets };
  if (!isStudioBg3dShotContactSheetResult(result)) {
    throw new TypeError("생성된 콘택트 시트 결과가 내부 계약을 충족하지 않습니다.");
  }
  await validateStudioBg3dShotContactSheetResult(result, images, layout, options.signal);
  return result;
}
