export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS = 64;
export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SOURCE_DIMENSION = 4_096;
export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SOURCE_BYTES = 24 * 1024 * 1024;
export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_SOURCE_BYTES = 384 * 1024 * 1024;
export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_OUTPUT_BYTES = 128 * 1024 * 1024;
export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHEET_PIXELS = 16_777_216;
export const STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_PIXELS = 134_217_728;

export interface StudioBg3dShotContactSheetImage {
  readonly shotId: string;
  readonly shotName: string;
  readonly width: number;
  readonly height: number;
  readonly png: Blob;
}

export interface StudioBg3dShotContactSheetLayoutOptions {
  readonly columns?: number;
  readonly rows?: number;
  readonly cellWidth?: number;
  readonly cellHeight?: number;
  readonly gap?: number;
  readonly padding?: number;
  readonly labelHeight?: number;
  readonly background?: string;
}

export interface StudioBg3dShotContactSheetLayout {
  readonly shotCount: number;
  readonly columns: number;
  readonly rows: number;
  readonly capacity: number;
  readonly sheetCount: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly padding: number;
  readonly labelHeight: number;
  readonly background: string;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
}

export interface StudioBg3dShotContactSheetOutput {
  readonly sheetNumber: number;
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly shotIds: readonly string[];
  readonly png: Blob;
}

export interface StudioBg3dShotContactSheetResult {
  readonly layout: StudioBg3dShotContactSheetLayout;
  readonly sheets: readonly StudioBg3dShotContactSheetOutput[];
}

export interface StudioBg3dShotContactSheetProgress {
  readonly completedShots: number;
  readonly totalShots: number;
  readonly completedSheets: number;
  readonly totalSheets: number;
}

const IMAGE_KEYS = ["shotId", "shotName", "width", "height", "png"] as const;
const LAYOUT_OPTION_KEYS = [
  "columns",
  "rows",
  "cellWidth",
  "cellHeight",
  "gap",
  "padding",
  "labelHeight",
  "background",
] as const;
const LAYOUT_KEYS = [
  "shotCount",
  "columns",
  "rows",
  "capacity",
  "sheetCount",
  "cellWidth",
  "cellHeight",
  "gap",
  "padding",
  "labelHeight",
  "background",
  "sheetWidth",
  "sheetHeight",
] as const;
const OUTPUT_KEYS = ["sheetNumber", "fileName", "width", "height", "shotIds", "png"] as const;
const RESULT_KEYS = ["layout", "sheets"] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const UNSAFE_TEXT_PATTERN = /\p{Cc}/u;
const EXTERNAL_REFERENCE_PATTERN = /(?:\b(?:blob|data|file|https?):|:\/\/|\bwww\.)/iu;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_NAME_LENGTH = 80;
const MIN_PNG_HEADER_BYTES = 24;

const DEFAULT_LAYOUT = {
  columns: 4,
  rows: 3,
  cellWidth: 512,
  cellHeight: 288,
  gap: 16,
  padding: 24,
  labelHeight: 40,
  background: "#f4f4f5",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isValidShotName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return normalized === value &&
    normalized.length > 0 &&
    Array.from(normalized).length <= MAX_NAME_LENGTH &&
    !UNSAFE_TEXT_PATTERN.test(normalized) &&
    !EXTERNAL_REFERENCE_PATTERN.test(normalized);
}

function abortError(): Error {
  const error = new Error("컷 콘택트 시트 생성을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function isPngBlobMetadata(value: unknown, maximumBytes: number): value is Blob {
  return value instanceof Blob &&
    value.type === "image/png" &&
    value.size >= MIN_PNG_HEADER_BYTES &&
    value.size <= maximumBytes;
}

function readBigEndianUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

export async function readStudioBg3dShotContactSheetPngDimensions(
  png: Blob,
  maximumBytes: number,
): Promise<{ readonly width: number; readonly height: number }> {
  if (!isPngBlobMetadata(png, maximumBytes)) {
    throw new TypeError("콘택트 시트 PNG의 MIME 또는 크기가 안전 예산을 벗어났습니다.");
  }
  const bytes = new Uint8Array(await png.slice(0, MIN_PNG_HEADER_BYTES).arrayBuffer());
  if (
    bytes.length !== MIN_PNG_HEADER_BYTES ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte) ||
    readBigEndianUint32(bytes, 8) !== 13 ||
    bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52
  ) {
    throw new TypeError("콘택트 시트 PNG signature 또는 IHDR가 올바르지 않습니다.");
  }
  const width = readBigEndianUint32(bytes, 16);
  const height = readBigEndianUint32(bytes, 20);
  if (width < 1 || height < 1) {
    throw new TypeError("콘택트 시트 PNG의 IHDR 크기가 올바르지 않습니다.");
  }
  return { width, height };
}

export function isStudioBg3dShotContactSheetLayoutOptions(
  value: unknown,
): value is StudioBg3dShotContactSheetLayoutOptions | undefined {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, LAYOUT_OPTION_KEYS)) return false;
  return (value.columns === undefined || isIntegerInRange(value.columns, 1, 8)) &&
    (value.rows === undefined || isIntegerInRange(value.rows, 1, 8)) &&
    (value.cellWidth === undefined || isIntegerInRange(value.cellWidth, 128, 1_024)) &&
    (value.cellHeight === undefined || isIntegerInRange(value.cellHeight, 72, 1_024)) &&
    (value.gap === undefined || isIntegerInRange(value.gap, 0, 64)) &&
    (value.padding === undefined || isIntegerInRange(value.padding, 0, 128)) &&
    (value.labelHeight === undefined || isIntegerInRange(value.labelHeight, 24, 96)) &&
    (value.background === undefined || (
      typeof value.background === "string" && HEX_COLOR_PATTERN.test(value.background)
    ));
}

export function resolveStudioBg3dShotContactSheetLayout(
  shotCount: number,
  options: StudioBg3dShotContactSheetLayoutOptions = {},
): StudioBg3dShotContactSheetLayout {
  if (!isIntegerInRange(shotCount, 1, STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS)) {
    throw new RangeError(`콘택트 시트는 1~${STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS}개 컷만 지원합니다.`);
  }
  if (!isStudioBg3dShotContactSheetLayoutOptions(options)) {
    throw new TypeError("콘택트 시트 레이아웃 옵션이 올바르지 않습니다.");
  }
  const columns = options.columns ?? DEFAULT_LAYOUT.columns;
  const rows = options.rows ?? DEFAULT_LAYOUT.rows;
  const cellWidth = options.cellWidth ?? DEFAULT_LAYOUT.cellWidth;
  const cellHeight = options.cellHeight ?? DEFAULT_LAYOUT.cellHeight;
  const gap = options.gap ?? DEFAULT_LAYOUT.gap;
  const padding = options.padding ?? DEFAULT_LAYOUT.padding;
  const labelHeight = options.labelHeight ?? DEFAULT_LAYOUT.labelHeight;
  const background = (options.background ?? DEFAULT_LAYOUT.background).toLowerCase();
  const capacity = columns * rows;
  const sheetCount = Math.ceil(shotCount / capacity);
  const sheetWidth = padding * 2 + columns * cellWidth + Math.max(0, columns - 1) * gap;
  const sheetHeight = padding * 2 + rows * (cellHeight + labelHeight) + Math.max(0, rows - 1) * gap;
  const sheetPixels = sheetWidth * sheetHeight;
  if (
    sheetWidth > 8_192 ||
    sheetHeight > 8_192 ||
    sheetPixels > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHEET_PIXELS ||
    sheetPixels * sheetCount > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_PIXELS
  ) {
    throw new RangeError("콘택트 시트 레이아웃이 Canvas 픽셀 예산을 벗어났습니다.");
  }
  return {
    shotCount,
    columns,
    rows,
    capacity,
    sheetCount,
    cellWidth,
    cellHeight,
    gap,
    padding,
    labelHeight,
    background,
    sheetWidth,
    sheetHeight,
  };
}

export function isStudioBg3dShotContactSheetImageList(
  value: unknown,
): value is readonly StudioBg3dShotContactSheetImage[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS
  ) {
    return false;
  }
  let totalBytes = 0;
  const shotIds = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, IMAGE_KEYS)) return false;
    if (
      typeof candidate.shotId !== "string" ||
      !ID_PATTERN.test(candidate.shotId) ||
      shotIds.has(candidate.shotId) ||
      !isValidShotName(candidate.shotName) ||
      !isIntegerInRange(candidate.width, 1, STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SOURCE_DIMENSION) ||
      !isIntegerInRange(candidate.height, 1, STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SOURCE_DIMENSION) ||
      !isPngBlobMetadata(candidate.png, STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SOURCE_BYTES)
    ) {
      return false;
    }
    shotIds.add(candidate.shotId);
    totalBytes += candidate.png.size;
    if (totalBytes > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_SOURCE_BYTES) return false;
  }
  return true;
}

export async function validateStudioBg3dShotContactSheetImages(
  images: unknown,
  signal?: AbortSignal,
): Promise<void> {
  if (!isStudioBg3dShotContactSheetImageList(images)) {
    throw new TypeError("콘택트 시트 입력 컷이 안전한 형식 또는 예산을 벗어났습니다.");
  }
  for (const image of images) {
    throwIfAborted(signal);
    const dimensions = await readStudioBg3dShotContactSheetPngDimensions(
      image.png,
      STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SOURCE_BYTES,
    );
    if (dimensions.width !== image.width || dimensions.height !== image.height) {
      throw new TypeError("콘택트 시트 PNG IHDR와 선언된 컷 크기가 일치하지 않습니다.");
    }
  }
  throwIfAborted(signal);
}

function isResolvedLayout(value: unknown): value is StudioBg3dShotContactSheetLayout {
  if (!isRecord(value) || !hasOnlyKeys(value, LAYOUT_KEYS)) return false;
  try {
    const resolved = resolveStudioBg3dShotContactSheetLayout(
      value.shotCount as number,
      {
        columns: value.columns as number,
        rows: value.rows as number,
        cellWidth: value.cellWidth as number,
        cellHeight: value.cellHeight as number,
        gap: value.gap as number,
        padding: value.padding as number,
        labelHeight: value.labelHeight as number,
        background: value.background as string,
      },
    );
    return LAYOUT_KEYS.every((key) => value[key] === resolved[key]);
  } catch {
    return false;
  }
}

export function isStudioBg3dShotContactSheetResult(
  value: unknown,
): value is StudioBg3dShotContactSheetResult {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS) || !isResolvedLayout(value.layout)) {
    return false;
  }
  if (!Array.isArray(value.sheets) || value.sheets.length !== value.layout.sheetCount) return false;
  let totalBytes = 0;
  let totalShots = 0;
  for (const [index, candidate] of value.sheets.entries()) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, OUTPUT_KEYS)) return false;
    const expectedCount = Math.min(value.layout.capacity, value.layout.shotCount - totalShots);
    if (
      candidate.sheetNumber !== index + 1 ||
      candidate.fileName !== `contact-sheet-${String(index + 1).padStart(3, "0")}.png` ||
      candidate.width !== value.layout.sheetWidth ||
      candidate.height !== value.layout.sheetHeight ||
      !Array.isArray(candidate.shotIds) ||
      candidate.shotIds.length !== expectedCount ||
      candidate.shotIds.some((id) => typeof id !== "string" || !ID_PATTERN.test(id)) ||
      new Set(candidate.shotIds).size !== candidate.shotIds.length ||
      !isPngBlobMetadata(candidate.png, STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES)
    ) {
      return false;
    }
    totalShots += candidate.shotIds.length;
    totalBytes += candidate.png.size;
    if (totalBytes > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_OUTPUT_BYTES) return false;
  }
  return totalShots === value.layout.shotCount;
}

export async function validateStudioBg3dShotContactSheetResult(
  value: unknown,
  images: readonly StudioBg3dShotContactSheetImage[],
  expectedLayout: StudioBg3dShotContactSheetLayout,
  signal?: AbortSignal,
): Promise<void> {
  if (!isStudioBg3dShotContactSheetResult(value)) {
    throw new TypeError("콘택트 시트 Worker 결과 형식 또는 예산이 올바르지 않습니다.");
  }
  if (LAYOUT_KEYS.some((key) => value.layout[key] !== expectedLayout[key])) {
    throw new TypeError("콘택트 시트 Worker 결과 레이아웃이 요청과 일치하지 않습니다.");
  }
  for (const [index, sheet] of value.sheets.entries()) {
    throwIfAborted(signal);
    const start = index * expectedLayout.capacity;
    const expectedShotIds = images.slice(start, start + expectedLayout.capacity).map((image) => image.shotId);
    if (
      sheet.shotIds.length !== expectedShotIds.length ||
      sheet.shotIds.some((shotId, shotIndex) => shotId !== expectedShotIds[shotIndex])
    ) {
      throw new TypeError("콘택트 시트 Worker 결과의 컷 순서가 요청과 일치하지 않습니다.");
    }
    const dimensions = await readStudioBg3dShotContactSheetPngDimensions(
      sheet.png,
      STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES,
    );
    if (dimensions.width !== sheet.width || dimensions.height !== sheet.height) {
      throw new TypeError("콘택트 시트 Worker PNG IHDR와 결과 크기가 일치하지 않습니다.");
    }
  }
  throwIfAborted(signal);
}
