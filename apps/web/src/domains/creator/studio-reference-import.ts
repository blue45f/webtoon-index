import { isGifFile } from "./studio-gif-element";
import {
  STUDIO_UPLOAD_MAX_SOURCE_BATCH_BYTES,
  STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES,
} from "./studio-upload-image-safety";

export const STUDIO_REFERENCE_IMPORT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";

const SUPPORTED_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SUPPORTED_EXTENSION_PATTERN = /\.(gif|jpe?g|png|webp)$/iu;

export interface StudioReferenceImportFileLike {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StudioReferenceImportPlan<T extends StudioReferenceImportFileLike> {
  files: T[];
  unsupported: T[];
  overflow: T[];
}

function sourceName(file: Pick<StudioReferenceImportFileLike, "name">): string {
  const trimmed = file.name.trim();
  return trimmed ? `“${trimmed.slice(0, 120)}”` : "선택한 이미지";
}

export function isStudioReferenceImportFile(
  file: Pick<StudioReferenceImportFileLike, "name" | "type">
): boolean {
  const mimeType = file.type.trim().toLowerCase();
  if (mimeType) return SUPPORTED_MIME_TYPES.has(mimeType);
  return SUPPORTED_EXTENSION_PATTERN.test(file.name.trim());
}

/** Keeps source order while separating unsupported files and board-capacity overflow. */
export function planStudioReferenceImports<T extends StudioReferenceImportFileLike>(
  files: readonly T[],
  remainingSlots: number
): StudioReferenceImportPlan<T> {
  const supported: T[] = [];
  const unsupported: T[] = [];
  for (const file of files) {
    if (isStudioReferenceImportFile(file)) supported.push(file);
    else unsupported.push(file);
  }
  const slotCount = Math.max(0, Math.floor(remainingSlots));
  return {
    files: supported.slice(0, slotCount),
    unsupported,
    overflow: supported.slice(slotCount),
  };
}

/** Applies the Studio-wide 12 MB/file and 48 MB/batch source budgets, including GIF. */
export function assertStudioReferenceImportBatch(
  files: readonly Pick<StudioReferenceImportFileLike, "name" | "size" | "type">[]
): number {
  let totalBytes = 0;
  for (const file of files) {
    if (!isStudioReferenceImportFile(file)) {
      throw new Error(
        `${sourceName(file)} 형식은 지원하지 않습니다. PNG, JPG, WebP 또는 GIF를 사용해 주세요.`
      );
    }
    if (!Number.isSafeInteger(file.size) || file.size < 1) {
      throw new Error(`${sourceName(file)} 파일이 비어 있거나 크기를 확인할 수 없습니다.`);
    }
    if (file.size > STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES) {
      throw new Error(`${sourceName(file)} 원본이 12MB를 초과합니다. 먼저 크기를 줄여 주세요.`);
    }
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > STUDIO_UPLOAD_MAX_SOURCE_BATCH_BYTES) {
      throw new Error("한 번에 가져온 참고 이미지가 48MB를 초과합니다. 나눠서 추가해 주세요.");
    }
  }
  return totalBytes;
}

/** GIF bypasses the raster header inspector, so verify its signature before browser decoding. */
export async function assertStudioReferenceGifSignature(
  file: StudioReferenceImportFileLike
): Promise<void> {
  if (!isGifFile(file)) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hasSignature = bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61;
  if (!hasSignature) {
    throw new Error(`${sourceName(file)} GIF 헤더를 확인하지 못했습니다.`);
  }
}

export function isStudioReferenceEditablePasteTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !target) return false;
  const element = target instanceof Element
    ? target
    : typeof Node !== "undefined" && target instanceof Node
      ? target.parentElement
      : null;
  if (!element) return false;
  return Boolean(element.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
  ));
}
