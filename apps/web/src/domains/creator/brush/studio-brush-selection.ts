import {
  BRUSH_PRESETS,
  type BrushPreset,
  type StudioToolOperation,
} from "../studio-brush";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import { isStudioBrushPackCatalogId } from "./studio-brush-pack-id";

/**
 * Catalogue identity is deliberately separate from the renderer identity.
 *
 * Extended brush packs are materialized to one of the stable dynamic-dab engines and carry their
 * complete dynamics snapshot. A saved stroke therefore remains pixel-replayable even when the
 * optional catalogue chunk is unavailable or an older collaboration client opens the document.
 */
export interface StudioBrushCatalogSelection {
  catalogId: string;
  catalogName: string;
  runtimeBrushId: string;
  /** Authoritative artist operation. Renderer identity must never imply paint versus erase. */
  operation: StudioToolOperation;
  /** Compatibility projection for draw-tool consumers that have not migrated to `operation`. */
  drawMode?: "pen" | "eraser";
  defaultWidth: number;
  defaultOpacity: number;
  defaultColor?: string;
  brushDynamics: NormalizedStudioBrushDynamicsSettings | null;
}

const STUDIO_CORE_BRUSH_PRESET_BY_ID: ReadonlyMap<string, BrushPreset> = new Map(
  BRUSH_PRESETS.map((preset) => [preset.id, preset])
);

let studioBrushPackRuntimePromise:
  | Promise<typeof import("./studio-brush-pack-runtime")>
  | null = null;

function loadStudioBrushPackRuntime() {
  studioBrushPackRuntimePromise ??= import("./studio-brush-pack-runtime").catch((error) => {
    studioBrushPackRuntimePromise = null;
    throw error;
  });
  return studioBrushPackRuntimePromise;
}

export function studioCoreBrushCatalogSelection(
  preset: BrushPreset
): StudioBrushCatalogSelection {
  const sourceDynamics = studioBrushDynamicsSettingsForBrushId(preset.id);
  // The draw element owns catalogue/default opacity and retained rendering multiplies that value
  // after each dynamic dab. New catalogue selections therefore keep the internal opacity channel
  // neutral, just like the procedural pack runtime. Flow, pressure mappings and tip alpha retain
  // the medium's buildup character. Legacy strokes without a captured snapshot still resolve their
  // historical profile in StudioDrawNode and remain pixel-compatible.
  const brushDynamics = sourceDynamics
    ? normalizeStudioBrushDynamicsSettings({
        ...sourceDynamics,
        opacity: {
          ...sourceDynamics.opacity,
          base: 1,
        },
      })
    : null;
  return {
    catalogId: preset.id,
    catalogName: preset.name,
    runtimeBrushId: preset.id,
    operation: preset.operation,
    ...(preset.operation === "erase" ? { drawMode: "eraser" as const } : {}),
    defaultWidth: preset.defaultWidth,
    defaultOpacity: preset.defaultOpacity,
    ...(preset.defaultColor ? { defaultColor: preset.defaultColor } : {}),
    brushDynamics,
  };
}

/**
 * One fail-closed selector for the complete 234-tool catalogue.
 *
 * Core presets resolve synchronously from the canonical table. Procedural profiles keep their
 * physics chunk lazy, but both the desktop catalogue and mobile sheet receive the same durable
 * `StudioBrushCatalogSelection` payload and never guess a renderer fallback for an unknown id.
 */
export async function materializeStudioBrushCatalogSelection(
  catalogId: unknown
): Promise<StudioBrushCatalogSelection | null> {
  if (typeof catalogId !== "string" || !catalogId) return null;
  const corePreset = STUDIO_CORE_BRUSH_PRESET_BY_ID.get(catalogId);
  if (corePreset) return studioCoreBrushCatalogSelection(corePreset);
  if (!isStudioBrushPackCatalogId(catalogId)) return null;
  return (await loadStudioBrushPackRuntime()).materializeStudioBrushPackSelection(catalogId);
}

/** Warm only the optional procedural chunk when pointer/focus intent makes selection likely. */
export async function preloadStudioBrushCatalogSelection(catalogId: unknown): Promise<void> {
  if (!isStudioBrushPackCatalogId(catalogId)) return;
  await loadStudioBrushPackRuntime();
}

export function isStudioBrushCatalogSelection(
  value: unknown
): value is StudioBrushCatalogSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudioBrushCatalogSelection>;
  return typeof candidate.catalogId === "string"
    && candidate.catalogId.length > 0
    && typeof candidate.catalogName === "string"
    && candidate.catalogName.length > 0
    && typeof candidate.runtimeBrushId === "string"
    && candidate.runtimeBrushId.length > 0
    && (candidate.operation === "paint" || candidate.operation === "erase")
    && (
      candidate.operation === "erase"
        ? candidate.drawMode === "eraser"
        : candidate.drawMode === undefined || candidate.drawMode === "pen"
    )
    && typeof candidate.defaultWidth === "number"
    && Number.isFinite(candidate.defaultWidth)
    && typeof candidate.defaultOpacity === "number"
    && Number.isFinite(candidate.defaultOpacity)
    && (candidate.brushDynamics === null || typeof candidate.brushDynamics === "object");
}
