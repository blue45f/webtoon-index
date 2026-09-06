/**
 * Static quality/texture audit for the curated Studio brush portfolio.
 *
 * Writes JSON, CSV and Markdown receipts. It never promotes a GPU backend: it only records the
 * declared quality gate and engine pin. Browser evidence from the full-screen matrix is required
 * before a GPU candidate may replace an authority backend.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  studioBrushCatalogItemById,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import {
  STUDIO_BRUSH_HAND_FEEL_PROFILES,
  STUDIO_BRUSH_QUALITY_ENGINE_PINS,
  STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS,
  STUDIO_BRUSH_TEXTURE_PROFILES,
} from "../apps/web/src/domains/creator/brush/studio-brush-quality-foundation";
import {
  STUDIO_BRUSH_FULLSCREEN_LONG_STROKE_EXPERIMENT,
  STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE,
  STUDIO_BRUSH_QUALITY_PORTFOLIO,
  STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS,
} from "../apps/web/src/domains/creator/brush/studio-brush-quality-portfolio";
import { isStudioBrushQuarantinedPresetId } from "../apps/web/src/domains/creator/brush/studio-brush-quarantine";

const outputDirectory = join(
  process.env.TOONSPECTRUM_VERIFY_DIR ?? tmpdir(),
  "studio-brush-quality-portfolio",
);
mkdirSync(outputDirectory, { recursive: true });

const failures: string[] = [];
const warningPairs: Array<{
  left: string;
  right: string;
  distance: number;
  reason: string;
}> = [];

const sq = (value: number) => value * value;
const profileDistance = (
  leftId: (typeof STUDIO_BRUSH_QUALITY_PORTFOLIO)[number]["id"],
  rightId: (typeof STUDIO_BRUSH_QUALITY_PORTFOLIO)[number]["id"],
): number => {
  const left = STUDIO_BRUSH_QUALITY_PORTFOLIO.find((entry) => entry.id === leftId)!;
  const right = STUDIO_BRUSH_QUALITY_PORTFOLIO.find((entry) => entry.id === rightId)!;
  const textureLeft = STUDIO_BRUSH_TEXTURE_PROFILES[left.textureProfile].axes;
  const textureRight = STUDIO_BRUSH_TEXTURE_PROFILES[right.textureProfile].axes;
  const feelLeft = STUDIO_BRUSH_HAND_FEEL_PROFILES[left.handFeelProfile].axes;
  const feelRight = STUDIO_BRUSH_HAND_FEEL_PROFILES[right.handFeelProfile].axes;
  const textureDistance = Math.sqrt(
    sq(textureLeft.edgeSoftness - textureRight.edgeSoftness)
    + sq(textureLeft.grain - textureRight.grain)
    + sq(textureLeft.wetness - textureRight.wetness)
    + sq(textureLeft.bristle - textureRight.bristle)
    + sq(textureLeft.particleScatter - textureRight.particleScatter)
    + sq(textureLeft.opacityBuildUp - textureRight.opacityBuildUp)
    + sq(textureLeft.anisotropy - textureRight.anisotropy),
  ) / Math.sqrt(7);
  const feelDistance = Math.sqrt(
    sq(feelLeft.pressureResponse - feelRight.pressureResponse)
    + sq(feelLeft.tiltResponse - feelRight.tiltResponse)
    + sq(feelLeft.velocityResponse - feelRight.velocityResponse)
    + sq(feelLeft.accumulation - feelRight.accumulation)
    + sq(feelLeft.stabilization - feelRight.stabilization),
  ) / Math.sqrt(5);
  return textureDistance * 0.6 + feelDistance * 0.4;
};

const ids = STUDIO_BRUSH_QUALITY_PORTFOLIO.map((entry) => entry.id);
if (new Set(ids).size !== ids.length) failures.push("duplicate representative ids");
if (
  STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.map((item) => item.id).join("\0")
  !== ids.join("\0")
) {
  failures.push("default quality catalogue order differs from the quality portfolio");
}
if (STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS.total !== 48) failures.push("portfolio total is not 48");
if (STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS.paint !== 46) failures.push("paint total is not 46");
if (STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS.erase !== 2) failures.push("eraser total is not 2");

const qualityWeight = STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS.textureFidelity
  + STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS.handFeel
  + STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS.liveCommitConsistency
  + STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS.geometryFidelity;
const performanceWeight = STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS.performance
  + STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS.memoryStability;
if (Math.abs(qualityWeight - 0.85) > 1e-9) failures.push(`quality weight is ${qualityWeight}, expected 0.85`);
if (Math.abs(performanceWeight - 0.15) > 1e-9) failures.push(`performance weight is ${performanceWeight}, expected 0.15`);

const rows = STUDIO_BRUSH_QUALITY_PORTFOLIO.map((entry) => {
  const catalog = studioBrushCatalogItemById(entry.id);
  if (!catalog) failures.push(`${entry.id}: representative is not registered`);
  if (catalog && catalog.source !== entry.source) {
    failures.push(`${entry.id}: source ${catalog.source} differs from ${entry.source}`);
  }
  if (isStudioBrushQuarantinedPresetId(entry.id)) failures.push(`${entry.id}: representative is quarantined`);
  const pin = STUDIO_BRUSH_QUALITY_ENGINE_PINS[entry.enginePin];
  const texture = STUDIO_BRUSH_TEXTURE_PROFILES[entry.textureProfile];
  const hand = STUDIO_BRUSH_HAND_FEEL_PROFILES[entry.handFeelProfile];
  return {
    id: entry.id,
    label: entry.label,
    source: entry.source,
    tier: entry.tier,
    medium: entry.medium,
    signature: entry.signature,
    distinctness: entry.distinctness,
    textureProfile: entry.textureProfile,
    handFeelProfile: entry.handFeelProfile,
    liveCommitGate: entry.liveCommitGate,
    enginePin: entry.enginePin,
    liveBackend: pin.liveBackend,
    commitBackend: pin.commitBackend,
    gpuPreferredWhenQualityEquivalent: pin.gpuPreferredWhenQualityEquivalent,
    absorbedCount: entry.absorbedIds.length,
    absorbedIds: entry.absorbedIds.join(" "),
    ...texture.axes,
    ...hand.axes,
  };
});

const signatures = rows.map((row) => row.signature);
if (new Set(signatures).size !== signatures.length) failures.push("duplicate representative signatures");

const aliases = Object.entries(STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE);
for (const [alias, representative] of aliases) {
  if (ids.includes(alias)) failures.push(`${alias}: alias is also a representative`);
  if (!ids.includes(representative)) failures.push(`${alias}: representative ${representative} is missing`);
  const catalog = studioBrushCatalogItemById(alias);
  if (!catalog) failures.push(`${alias}: absorbed alias is not registered`);
  if (STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.some((item) => item.id === alias)) {
    failures.push(`${alias}: absorbed alias remains in the default picker`);
  }
  if (
    catalog
    && !isStudioBrushQuarantinedPresetId(alias)
    && !STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.some((item) => item.id === alias)
  ) {
    failures.push(`${alias}: non-quarantined absorbed alias is not searchable`);
  }
}

for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
    const left = STUDIO_BRUSH_QUALITY_PORTFOLIO[leftIndex]!;
    const right = STUDIO_BRUSH_QUALITY_PORTFOLIO[rightIndex]!;
    const distance = profileDistance(left.id, right.id);
    if (distance <= 0.08) {
      warningPairs.push({
        left: left.id,
        right: right.id,
        distance,
        reason: left.signature === right.signature
          ? "same signature"
          : "close authored texture/hand-feel fingerprint; distinct signatures retained",
      });
    }
  }
}

const report = {
  kind: "toonspectrum-studio-brush-quality-portfolio-audit-v1",
  generatedAt: new Date().toISOString(),
  counts: {
    registered: STUDIO_ALL_BRUSH_CATALOG_ITEMS.length,
    searchable: STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length,
    defaultPortfolio: rows.length,
    hiddenFromDefault: STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length - rows.length,
    reductionRatio: 1 - rows.length / STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length,
    aliases: aliases.length,
    closeRepresentativePairs: warningPairs.length,
  },
  weights: STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS,
  experiment: STUDIO_BRUSH_FULLSCREEN_LONG_STROKE_EXPERIMENT,
  rows,
  closeRepresentativePairs: warningPairs,
  failures,
};

const csvEscape = (value: unknown): string => {
  const text = String(value ?? "");
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const headers = Object.keys(rows[0] ?? {});
const csv = [
  headers.join(","),
  ...rows.map((row) => headers.map((header) => csvEscape(row[header as keyof typeof row])).join(",")),
].join("\n") + "\n";

const markdown = [
  "# Studio brush quality portfolio audit",
  "",
  `- Registered: ${report.counts.registered}`,
  `- Searchable: ${report.counts.searchable}`,
  `- Default portfolio: ${report.counts.defaultPortfolio}`,
  `- Default reduction: ${(report.counts.reductionRatio * 100).toFixed(1)}%`,
  `- Absorbed aliases: ${report.counts.aliases}`,
  `- Quality/performance weights: ${(qualityWeight * 100).toFixed(0)}% / ${(performanceWeight * 100).toFixed(0)}%`,
  `- Failures: ${failures.length}`,
  "",
  "| Brush | Medium | Texture | Hand feel | Gate | Live → commit | GPU tie | Absorbed |",
  "| --- | --- | --- | --- | --- | --- | ---: | ---: |",
  ...rows.map((row) =>
    `| ${row.id} | ${row.medium} | ${row.textureProfile} | ${row.handFeelProfile} | ${row.liveCommitGate} | ${row.liveBackend} → ${row.commitBackend} | ${row.gpuPreferredWhenQualityEquivalent ? "yes" : "no"} | ${row.absorbedCount} |`,
  ),
  "",
  ...(failures.length > 0 ? ["## Failures", "", ...failures.map((failure) => `- ${failure}`)] : []),
].join("\n") + "\n";

writeFileSync(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(outputDirectory, "portfolio.csv"), csv);
writeFileSync(join(outputDirectory, "report.md"), markdown);

console.log(JSON.stringify(report.counts));
console.log(`quality portfolio receipt: ${outputDirectory}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`[portfolio-audit] ${failure}`);
  process.exitCode = 1;
}
