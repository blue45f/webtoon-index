/**
 * CSP-style sub tool palette data layer.
 *
 * The compact palette exposes one materially distinct representative per common hand-feel lane.
 * Absorbed aliases remain registered/searchable in the full library and replay in saved documents.
 */
import { BRUSH_PRESETS, type BrushPreset } from "../studio-brush";

import { STUDIO_BRUSH_DISCOVERY } from "./studio-brush-discovery";
import { isStudioBrushQuarantinedPresetId } from "./studio-brush-quarantine";

export type StudioSubToolPaletteCategoryId =
  | "pen"
  | "pencil"
  | "brush"
  | "airbrush"
  | "eraser"
  | "manga";

export type StudioSubToolPaletteDrawMode = "pen" | "eraser";

export interface StudioSubToolPaletteItem {
  id: string;
  name: string;
  shortcut?: string;
  hint?: string;
  searchAliases?: readonly string[];
}

export interface StudioSubToolPaletteCategory {
  id: StudioSubToolPaletteCategoryId;
  label: string;
  drawMode: StudioSubToolPaletteDrawMode;
  tools: readonly StudioSubToolPaletteItem[];
}

interface StudioSubToolPaletteCategorySeed {
  id: StudioSubToolPaletteCategoryId;
  label: string;
  drawMode: StudioSubToolPaletteDrawMode;
  presetIds: readonly string[];
}

const STUDIO_SUB_TOOL_PALETTE_CATEGORY_SEEDS: readonly StudioSubToolPaletteCategorySeed[] = [
  {
    id: "pen",
    label: "펜·선화",
    drawMode: "pen",
    presetIds: ["gpen", "pen", "fountain-pen"],
  },
  {
    id: "pencil",
    label: "연필·목탄",
    drawMode: "pen",
    presetIds: ["pencil", "pencil--side-shade", "charcoal--compressed-edge"],
  },
  {
    id: "brush",
    label: "채색·물감",
    drawMode: "pen",
    presetIds: [
      "watercolor",
      "marker",
      "gouache--matte-body",
      "oil--filbert-ribbon",
    ],
  },
  {
    id: "airbrush",
    label: "분사·입자",
    drawMode: "pen",
    presetIds: ["airbrush", "spray", "splatter"],
  },
  {
    id: "eraser",
    label: "지우개",
    drawMode: "eraser",
    presetIds: ["standard-eraser", "kneaded-eraser"],
  },
  {
    id: "manga",
    label: "만화·톤",
    drawMode: "pen",
    presetIds: ["screentone", "web-cross-hatch-pen", "web-radial-burst"],
  },
];

const CORE_PRESET_BY_ID: ReadonlyMap<string, BrushPreset> = new Map(
  BRUSH_PRESETS.map((preset) => [preset.id, preset]),
);

function presetDrawMode(preset: BrushPreset): StudioSubToolPaletteDrawMode {
  return preset.operation === "erase" ? "eraser" : "pen";
}

export const STUDIO_SUB_TOOL_PALETTE_CATEGORIES: readonly StudioSubToolPaletteCategory[] =
  Object.freeze(
    STUDIO_SUB_TOOL_PALETTE_CATEGORY_SEEDS.map((seed) =>
      Object.freeze({
        id: seed.id,
        label: seed.label,
        drawMode: seed.drawMode,
        tools: Object.freeze(
          seed.presetIds.flatMap((presetId): StudioSubToolPaletteItem[] => {
            const preset = CORE_PRESET_BY_ID.get(presetId);
            if (!preset) return [];
            if (isStudioBrushQuarantinedPresetId(preset.id)) return [];
            if (presetDrawMode(preset) !== seed.drawMode) return [];
            return [Object.freeze({
              id: preset.id,
              name: preset.name,
              hint: STUDIO_BRUSH_DISCOVERY[preset.id]?.hint,
              searchAliases: preset.searchAliases,
            })];
          }),
        ),
      }),
    ),
  );

export const STUDIO_SUB_TOOL_PALETTE_DEFAULT_CATEGORY_ID: StudioSubToolPaletteCategoryId =
  "pen";

const CATEGORY_BY_ID: ReadonlyMap<string, StudioSubToolPaletteCategory> = new Map(
  STUDIO_SUB_TOOL_PALETTE_CATEGORIES.map((category) => [category.id, category]),
);

const CATEGORY_ID_BY_PRESET_ID: ReadonlyMap<string, StudioSubToolPaletteCategoryId> =
  new Map(
    STUDIO_SUB_TOOL_PALETTE_CATEGORIES.flatMap((category) =>
      category.tools.map(
        (tool) => [tool.id, category.id] as [string, StudioSubToolPaletteCategoryId],
      ),
    ),
  );

export function studioSubToolPaletteCategoryById(
  categoryId: unknown,
): StudioSubToolPaletteCategory | null {
  return typeof categoryId === "string"
    ? CATEGORY_BY_ID.get(categoryId) ?? null
    : null;
}

export function studioSubToolPaletteCategoryIdForBrushId(
  brushId: unknown,
): StudioSubToolPaletteCategoryId | null {
  return typeof brushId === "string"
    ? CATEGORY_ID_BY_PRESET_ID.get(brushId) ?? null
    : null;
}

export function studioSubToolPalettePresetById(subToolId: unknown): BrushPreset | null {
  if (typeof subToolId !== "string") return null;
  if (!CATEGORY_ID_BY_PRESET_ID.has(subToolId)) return null;
  return CORE_PRESET_BY_ID.get(subToolId) ?? null;
}
