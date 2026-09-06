import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_INSERT_DRAG_MIME,
} from "./studio-insert-drag-core";
import { STUDIO_OBJECT_INSERT_DRAG_MIME } from "./studio-object-insert-drag";

export type StudioAssetTransferLike = Pick<DataTransfer, "types" | "items" | "files">;

function safeTransferList<T>(value: unknown): T[] {
  if (value === null || value === undefined) return [];
  try {
    return Array.from(value as ArrayLike<T>);
  } catch {
    // A foreign/malformed synthetic drag must not escape into the editor's drop command.
    return [];
  }
}

export function studioTransferHasFiles(dataTransfer: StudioAssetTransferLike): boolean {
  return safeTransferList<string>(dataTransfer.types).includes("Files");
}

/**
 * Accept known Studio payloads and image files while rejecting known non-image files.
 * Some browsers hide file metadata during dragover; an empty file list is therefore
 * treated as undecided until drop, where the caller can issue a precise rejection.
 */
export function studioTransferCanInsert(dataTransfer: StudioAssetTransferLike): boolean {
  const types = new Set(safeTransferList<string>(dataTransfer.types));
  if (
    types.has(STUDIO_ASSET_DRAG_MIME) ||
    types.has(STUDIO_INSERT_DRAG_MIME) ||
    types.has(STUDIO_OBJECT_INSERT_DRAG_MIME)
  ) return true;
  if (!types.has("Files")) return false;

  const fileItems = safeTransferList<DataTransferItem>(dataTransfer.items)
    .filter((item) => item?.kind === "file");
  if (fileItems.length > 0) {
    return fileItems.some((item) => !item.type || item.type.startsWith("image/"));
  }

  const files = safeTransferList<File>(dataTransfer.files);
  return files.length === 0 || files.some((file) => file.type.startsWith("image/"));
}
