import {
  STUDIO_BRUSH_TEXTURE_PROFILES,
  type StudioBrushQualityPortfolioEntry,
  type StudioBrushTextureProfileId,
} from "./studio-brush-quality-foundation";
import { STUDIO_BRUSH_QUALITY_PORTFOLIO } from "./studio-brush-quality-portfolio-data";

export * from "./studio-brush-quality-foundation";

export { STUDIO_BRUSH_QUALITY_PORTFOLIO };

export const STUDIO_BRUSH_QUALITY_PORTFOLIO_IDS: readonly string[] =
  Object.freeze(STUDIO_BRUSH_QUALITY_PORTFOLIO.map((entry) => entry.id));

export const STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS = Object.freeze({
  total: STUDIO_BRUSH_QUALITY_PORTFOLIO.length,
  paint: STUDIO_BRUSH_QUALITY_PORTFOLIO.filter((entry) => entry.medium !== "eraser").length,
  erase: STUDIO_BRUSH_QUALITY_PORTFOLIO.filter((entry) => entry.medium === "eraser").length,
  essential: STUDIO_BRUSH_QUALITY_PORTFOLIO.filter((entry) => entry.tier === "essential").length,
  specialist: STUDIO_BRUSH_QUALITY_PORTFOLIO.filter((entry) => entry.tier === "specialist").length,
});

export const STUDIO_BRUSH_QUALITY_PORTFOLIO_CORE_IDS: readonly string[] =
  Object.freeze(
    STUDIO_BRUSH_QUALITY_PORTFOLIO
      .filter((entry) => entry.source === "core")
      .map((entry) => entry.id),
  );

export const STUDIO_BRUSH_QUALITY_PORTFOLIO_PRO_IDS: readonly string[] =
  Object.freeze(
    STUDIO_BRUSH_QUALITY_PORTFOLIO
      .filter((entry) => entry.source === "pro")
      .map((entry) => entry.id),
  );

const PORTFOLIO_BY_ID: ReadonlyMap<string, StudioBrushQualityPortfolioEntry> =
  new Map(STUDIO_BRUSH_QUALITY_PORTFOLIO.map((entry) => [entry.id, entry]));

const aliasPairs: readonly (readonly [string, string])[] =
  STUDIO_BRUSH_QUALITY_PORTFOLIO.flatMap((entry) =>
    entry.absorbedIds.map((aliasId) => [aliasId, entry.id] as const)
  );

const duplicateAliasIds = aliasPairs
  .map(([aliasId]) => aliasId)
  .filter((aliasId, index, all) => all.indexOf(aliasId) !== index);

if (duplicateAliasIds.length > 0) {
  throw new Error(
    `Studio brush quality portfolio has duplicate aliases: ${[...new Set(duplicateAliasIds)].join(", ")}`,
  );
}

export const STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE:
Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(aliasPairs));

export function studioBrushQualityPortfolioEntryById(
  id: unknown,
): StudioBrushQualityPortfolioEntry | null {
  return typeof id === "string" ? PORTFOLIO_BY_ID.get(id) ?? null : null;
}

export function isStudioBrushQualityPortfolioId(id: unknown): id is string {
  return typeof id === "string" && PORTFOLIO_BY_ID.has(id);
}

export function resolveStudioBrushQualityRepresentativeId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  if (PORTFOLIO_BY_ID.has(id)) return id;
  return STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE[id] ?? null;
}

export function listStudioBrushQualityAliasesForRepresentative(
  id: unknown,
): readonly string[] {
  return studioBrushQualityPortfolioEntryById(id)?.absorbedIds ?? [];
}

export function studioBrushQualityFingerprintDistance(
  left: StudioBrushTextureProfileId,
  right: StudioBrushTextureProfileId,
): number {
  const a = STUDIO_BRUSH_TEXTURE_PROFILES[left].axes;
  const b = STUDIO_BRUSH_TEXTURE_PROFILES[right].axes;
  return Math.hypot(
    a.edgeSoftness - b.edgeSoftness,
    a.grain - b.grain,
    a.wetness - b.wetness,
    a.bristle - b.bristle,
    a.particleScatter - b.particleScatter,
    a.opacityBuildUp - b.opacityBuildUp,
    a.anisotropy - b.anisotropy,
  ) / Math.sqrt(7);
}

export const STUDIO_BRUSH_FULLSCREEN_LONG_STROKE_EXPERIMENT = Object.freeze({
  schemaVersion: 1,
  viewport: Object.freeze({ width: 1600, height: 1000 }),
  paritySamples: 600,
  performanceSamples: 3_200,
  route: Object.freeze({
    kind: "viewport-s-curve",
    horizontalFillRatio: 0.92,
    verticalFillRatio: 0.72,
    edgeInsetRatio: 0.04,
  }),
  zoomInspection: Object.freeze([1, 4, 8, 16, 32]),
  phases: Object.freeze([
    "blank",
    "live-halfway",
    "released-immediate",
    "committed-300ms",
    "settled-900ms",
    "undo-idle",
  ]),
  engineModes: Object.freeze([
    "current-authority",
    "gpu-candidate-when-declared",
  ]),
  promotionRule:
    "quality score must be no worse; GPU wins only on a quality-equivalent result",
});
