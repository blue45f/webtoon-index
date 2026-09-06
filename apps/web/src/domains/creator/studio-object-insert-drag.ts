/**
 * Drag envelope for Canva-style 3D object inserts (Elements → BG3D / VRM).
 * Separate from image `json-asset` payloads so canvas drop can open production tools.
 */

import type {
  StudioObjectInsertItem,
  StudioObjectInsertOpenTarget,
  StudioObjectInsertPlacementPlan,
} from "./studio-object-insert-catalog";

export const STUDIO_OBJECT_INSERT_DRAG_MIME =
  "application/x-studio-object-insert+json" as const;
export const STUDIO_OBJECT_INSERT_DRAG_VERSION = 1 as const;
export const STUDIO_OBJECT_INSERT_DRAG_MAX_PAYLOAD_LENGTH = 4_096;

export interface StudioObjectInsertDragPayload {
  readonly kind: "studio-object-insert";
  readonly version: typeof STUDIO_OBJECT_INSERT_DRAG_VERSION;
  readonly itemId: string;
  readonly sourceId: string;
  readonly openTarget: StudioObjectInsertOpenTarget;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export function serializeStudioObjectInsertDragPayload(input: {
  readonly item: StudioObjectInsertItem;
  readonly plan: StudioObjectInsertPlacementPlan;
}): string {
  const payload: StudioObjectInsertDragPayload = {
    kind: "studio-object-insert",
    version: STUDIO_OBJECT_INSERT_DRAG_VERSION,
    itemId: input.item.id,
    sourceId: input.plan.sourceId,
    openTarget: input.plan.openTarget,
    label: input.item.label,
    width: input.plan.width,
    height: input.plan.height,
  };
  return JSON.stringify(payload);
}

export type StudioWritableObjectInsertDataTransfer = Pick<
  DataTransfer,
  "setData" | "effectAllowed"
>;

/** Write the 3D object-insert envelope onto a drag session (Elements rail → canvas). */
export function writeStudioObjectInsertDragPayload(
  dataTransfer: StudioWritableObjectInsertDataTransfer,
  input: {
    readonly item: StudioObjectInsertItem;
    readonly plan: StudioObjectInsertPlacementPlan;
  },
): void {
  dataTransfer.setData(
    STUDIO_OBJECT_INSERT_DRAG_MIME,
    serializeStudioObjectInsertDragPayload(input),
  );
  dataTransfer.effectAllowed = "copy";
}

export function parseStudioObjectInsertDragPayload(
  value: string,
): StudioObjectInsertDragPayload | null {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > STUDIO_OBJECT_INSERT_DRAG_MAX_PAYLOAD_LENGTH
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.kind !== "studio-object-insert") return null;
  if (candidate.version !== STUDIO_OBJECT_INSERT_DRAG_VERSION) return null;
  if (typeof candidate.itemId !== "string" || candidate.itemId.trim().length === 0) {
    return null;
  }
  if (typeof candidate.sourceId !== "string" || candidate.sourceId.trim().length === 0) {
    return null;
  }
  if (
    candidate.openTarget !== "bg3d-editor"
    && candidate.openTarget !== "vrm-poser"
    && candidate.openTarget !== "bg3d-templates"
  ) {
    return null;
  }
  if (typeof candidate.label !== "string") return null;
  if (
    typeof candidate.width !== "number"
    || typeof candidate.height !== "number"
    || !Number.isFinite(candidate.width)
    || !Number.isFinite(candidate.height)
    || candidate.width <= 0
    || candidate.height <= 0
  ) {
    return null;
  }
  return {
    kind: "studio-object-insert",
    version: STUDIO_OBJECT_INSERT_DRAG_VERSION,
    itemId: candidate.itemId.trim(),
    sourceId: candidate.sourceId.trim(),
    openTarget: candidate.openTarget,
    label: candidate.label,
    width: candidate.width,
    height: candidate.height,
  };
}

/** Map a catalog plan into page-level seed fields for BG3D / VRM open. */
export function resolveStudioObjectInsertOpenSeed(input: {
  readonly openTarget: StudioObjectInsertOpenTarget;
  readonly sourceId: string;
}): {
  readonly bg3dSeedTemplateId: string | null;
  readonly bg3dSeedPrimitiveKind: string | null;
  readonly poserSeedPropId: string | null;
} {
  const sourceId = input.sourceId.trim();
  if (!sourceId) {
    return Object.freeze({
      bg3dSeedTemplateId: null,
      bg3dSeedPrimitiveKind: null,
      poserSeedPropId: null,
    });
  }
  if (input.openTarget === "vrm-poser") {
    return Object.freeze({
      bg3dSeedTemplateId: null,
      bg3dSeedPrimitiveKind: null,
      poserSeedPropId: sourceId,
    });
  }
  if (input.openTarget === "bg3d-templates") {
    return Object.freeze({
      bg3dSeedTemplateId: sourceId,
      bg3dSeedPrimitiveKind: null,
      poserSeedPropId: null,
    });
  }
  return Object.freeze({
    bg3dSeedTemplateId: null,
    bg3dSeedPrimitiveKind: sourceId,
    poserSeedPropId: null,
  });
}
