import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_INSERT_DRAG_MIME,
  type StudioInsertDragPayload,
  type StudioWritableDataTransfer,
} from "./studio-insert-drag-core";

export function serializeStudioInsertDragPayload(
  payload: StudioInsertDragPayload
): string {
  return JSON.stringify(payload);
}

export function writeStudioInsertDragPayload(
  dataTransfer: StudioWritableDataTransfer,
  payload: StudioInsertDragPayload
): void {
  dataTransfer.setData(STUDIO_INSERT_DRAG_MIME, serializeStudioInsertDragPayload(payload));
  dataTransfer.effectAllowed = "copy";
}

export function writeStudioAssetDragPayload(
  dataTransfer: StudioWritableDataTransfer,
  serializedPayload: string
): void {
  dataTransfer.setData(STUDIO_ASSET_DRAG_MIME, serializedPayload);
  dataTransfer.effectAllowed = "copy";
}
