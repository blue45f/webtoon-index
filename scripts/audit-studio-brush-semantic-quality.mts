#!/usr/bin/env tsx
/**
 * Runtime-grounded brush naming/material audit.
 *
 * This gate does not compare proprietary assets. It verifies that each Studio catalogue promise is
 * backed by Studio's own renderer contract and deterministic material planner, then reports the
 * nearest rendered-response pairs for curation.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import {
  studioBrushDynamicsSettingsForBrushId,
  type StudioBrushDynamicsSettings,
} from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import {
  listStudioBrushMaterialNearestPairs,
  profileStudioBrushMaterialDistinctness,
  type StudioBrushMaterialDistinctnessProfile,
} from "../apps/web/src/domains/creator/brush/studio-brush-material-distinctness";
import { studioBrushPackDescriptorById } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { materializeStudioBrushPackSelection } from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import {
  STUDIO_BRUSH_HAND_FEEL_PROFILES,
  STUDIO_BRUSH_TEXTURE_PROFILES,
} from "../apps/web/src/domains/creator/brush/studio-brush-quality-foundation";
import {
  STUDIO_BRUSH_QUALITY_PORTFOLIO,
} from "../apps/web/src/domains/creator/brush/studio-brush-quality-portfolio";
import {
  resolveStudioBrushRuntimeContract,
} from "../apps/web/src/domains/creator/brush/studio-brush-runtime-contract";
import {
  auditStudioBrushSemanticClaims,
  type StudioBrushSemanticAuditResult,
} from "../apps/web/src/domains/creator/brush/studio-brush-semantic-quality";

const CHECK = process.argv.includes("--check");
const OUT_DIR_ARGUMENT = process.argv.find((argument) => argument.startsWith("--out-dir="));
const OUT_DIR = path.resolve(
  process.cwd(),
  OUT_DIR_ARGUMENT?.slice("--out-dir=".length)
    || "artifacts/brush-semantic-quality",
);

const PORTFOLIO_BY_ID = new Map(
  STUDIO_BRUSH_QUALITY_PORTFOLIO.map((entry) => [entry.id, entry]),
);
const DEFAULT_PORTFOLIO_IDS = new Set(
  STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.map(({ id }) => id),
);

interface AuditedRow {
  readonly id: string;
  readonly name: string;
  readonly source: "core" | "pro";
  readonly operation: "erase" | "paint";
  readonly runtimeBrushId: string;
  readonly engine: string | null;
  readonly engineVariant: string | null;
  readonly tip: string | null;
  readonly texture: string | null;
  readonly dynamics: string | null;
  readonly pressureResponsive: boolean;
  readonly materialFingerprint: string | null;
  readonly semantic: StudioBrushSemanticAuditResult;
}

function recursivelyContainsPressureMapping(
  value: unknown,
  seen: Set<object> = new Set(),
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => recursivelyContainsPressureMapping(entry, seen));
  }
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.source === "pressure") return true;
  return Object.values(record).some((entry) => (
    recursivelyContainsPressureMapping(entry, seen)
  ));
}

function runtimeBrushIdFor(item: StudioBrushCatalogItem): string {
  return studioBrushPackDescriptorById(item.id)?.runtimeBrushId ?? item.id;
}

function dynamicSettingsFor(
  item: StudioBrushCatalogItem,
): StudioBrushDynamicsSettings | null {
  const selection = materializeStudioBrushPackSelection(item.id);
  return selection?.brushDynamics
    ?? studioBrushDynamicsSettingsForBrushId(item.id)
    ?? null;
}

function pressureResponsiveFor(
  item: StudioBrushCatalogItem,
  dynamics: StudioBrushDynamicsSettings | null,
): boolean {
  if (dynamics) return recursivelyContainsPressureMapping(dynamics);
  const contract = resolveStudioBrushRuntimeContract(runtimeBrushIdFor(item));
  return Boolean(
    contract
    && contract.dynamics !== "fixed-path"
    && contract.dynamics !== "global-grid",
  );
}

function materialProfileFor(
  item: StudioBrushCatalogItem,
  dynamics: StudioBrushDynamicsSettings | null,
): StudioBrushMaterialDistinctnessProfile | null {
  if (!dynamics) return null;
  return profileStudioBrushMaterialDistinctness({
    catalogId: item.id,
    runtimeBrushId: runtimeBrushIdFor(item),
    defaultWidth: item.defaultWidth,
    defaultOpacity: item.defaultOpacity,
    brushDynamics: dynamics,
  });
}

const materialProfiles: StudioBrushMaterialDistinctnessProfile[] = [];
const rows: AuditedRow[] = [];

for (const item of STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS) {
  const runtimeBrushId = runtimeBrushIdFor(item);
  const contract = resolveStudioBrushRuntimeContract(runtimeBrushId);
  const dynamics = dynamicSettingsFor(item);
  const materialProfile = materialProfileFor(item, dynamics);
  if (materialProfile) materialProfiles.push(materialProfile);
  const portfolio = PORTFOLIO_BY_ID.get(item.id);
  const pressureResponsive = pressureResponsiveFor(item, dynamics);
  const semantic = auditStudioBrushSemanticClaims({
    catalogId: item.id,
    runtimeBrushId,
    name: item.name,
    shortName: item.shortName,
    hint: item.hint,
    operation: item.operation,
    previewStyle: item.previewStyle,
    portfolioLabel: portfolio?.label,
    pressureResponsive,
    axes: portfolio
      ? {
          ...STUDIO_BRUSH_TEXTURE_PROFILES[portfolio.textureProfile].axes,
          ...STUDIO_BRUSH_HAND_FEEL_PROFILES[portfolio.handFeelProfile].axes,
        }
      : undefined,
    material: materialProfile
      ? {
          meanScatterRatio: materialProfile.response.geometry.meanScatterRatio,
          tipAlphaVariance: materialProfile.response.texture.tipAlphaVariance,
          grainMultiplierVariance:
            materialProfile.response.texture.grainMultiplierVariance,
          materialAlphaVariance:
            materialProfile.response.texture.materialAlphaVariance,
          occupiedRatio: materialProfile.response.texture.occupiedRatio,
          dualBlendMode: materialProfile.response.texture.dualBlendMode,
        }
      : null,
  });
  rows.push({
    id: item.id,
    name: item.name,
    source: item.source,
    operation: item.operation,
    runtimeBrushId,
    engine: contract?.engine ?? null,
    engineVariant: contract?.engineVariant ?? null,
    tip: contract?.tip ?? null,
    texture: contract?.texture ?? null,
    dynamics: contract?.dynamics ?? null,
    pressureResponsive,
    materialFingerprint: materialProfile?.behaviorFingerprint ?? null,
    semantic,
  });
}

const semanticErrors = rows.flatMap(({ semantic }) => (
  semantic.issues.filter(({ severity }) => severity === "error")
));
const semanticWarnings = rows.flatMap(({ semantic }) => (
  semantic.issues.filter(({ severity }) => severity === "warning")
));

const defaultMaterialProfiles = materialProfiles.filter(({ catalogId }) => (
  DEFAULT_PORTFOLIO_IDS.has(catalogId)
));
const defaultAllPairs = listStudioBrushMaterialNearestPairs(
  defaultMaterialProfiles,
  defaultMaterialProfiles.length * defaultMaterialProfiles.length,
);
const defaultNearestPairs = defaultAllPairs.slice(0, 30);
const listedNearestPairs = listStudioBrushMaterialNearestPairs(
  materialProfiles,
  50,
);
const defaultExactCollisions = defaultAllPairs.filter(
  ({ exactBehaviorCollision }) => exactBehaviorCollision,
);

const failures = [
  ...semanticErrors.map((entry) => `${entry.catalogId}: ${entry.messageKo}`),
  ...defaultExactCollisions.map((pair) => (
    `${pair.leftId} / ${pair.rightId}: default portfolio material response is byte-identical`
  )),
];

function markdownEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ");
}

const warningRows = rows.flatMap((row) => (
  row.semantic.issues
    .filter(({ severity }) => severity === "warning")
    .map((entry) => ({ row, entry }))
));
const report = {
  version: "studio-brush-semantic-quality-audit-v1",
  generatedAt: new Date().toISOString(),
  checkMode: CHECK,
  summary: {
    listedBrushCount: rows.length,
    defaultPortfolioCount: DEFAULT_PORTFOLIO_IDS.size,
    materialProfileCount: materialProfiles.length,
    semanticErrorCount: semanticErrors.length,
    semanticWarningCount: semanticWarnings.length,
    defaultExactMaterialCollisionCount: defaultExactCollisions.length,
    failureCount: failures.length,
  },
  failures,
  rows,
  defaultNearestPairs,
  listedNearestPairs,
};

const markdown = [
  "# Studio brush semantic and material-quality audit",
  "",
  `- Listed brushes: **${rows.length}**`,
  `- Default quality portfolio: **${DEFAULT_PORTFOLIO_IDS.size}**`,
  `- Deterministic material profiles: **${materialProfiles.length}**`,
  `- Semantic errors: **${semanticErrors.length}**`,
  `- Semantic warnings: **${semanticWarnings.length}**`,
  `- Exact material collisions in default portfolio: **${defaultExactCollisions.length}**`,
  "",
  "## Hard failures",
  "",
  ...(failures.length > 0 ? failures.map((entry) => `- ${entry}`) : ["- None"]),
  "",
  "## Naming/material warnings",
  "",
  "| id | name | runtime | engine | tip | texture | dynamics | warning |",
  "|---|---|---|---|---|---|---|---|",
  ...(warningRows.length > 0
    ? warningRows.map(({ row, entry }) => (
        `| ${markdownEscape(row.id)} | ${markdownEscape(row.name)} | `
        + `${markdownEscape(row.runtimeBrushId)} | ${markdownEscape(row.engine)} | `
        + `${markdownEscape(row.tip)} | ${markdownEscape(row.texture)} | `
        + `${markdownEscape(row.dynamics)} | ${markdownEscape(entry.messageKo)} |`
      ))
    : ["| — | — | — | — | — | — | — | None |"]),
  "",
  "## Nearest deterministic material responses — default portfolio",
  "",
  "| left | right | distance | exact |",
  "|---|---|---:|:---:|",
  ...defaultNearestPairs.map((pair) => (
    `| ${markdownEscape(pair.leftId)} | ${markdownEscape(pair.rightId)} | `
    + `${pair.distance.toFixed(6)} | ${pair.exactBehaviorCollision ? "yes" : "no"} |`
  )),
  "",
  "## Interpretation",
  "",
  "- Distance measures normalized spacing, size variation, scatter, flow/opacity buildup, tip alpha, grain, occupancy and dual-tip blending.",
  "- A warning is a curation task, not an automatic rename: authored alpha maps can carry evidence that the lightweight runtime contract cannot express.",
  "- A hard error means the selected runtime/operation is contradictory or missing, or two default representatives are exactly identical on the deterministic material probe.",
  "",
].join("\n");

await mkdir(OUT_DIR, { recursive: true });
await Promise.all([
  writeFile(
    path.join(OUT_DIR, "brush-semantic-quality-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(OUT_DIR, "brush-semantic-quality-audit.md"),
    `${markdown}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${path.relative(process.cwd(), OUT_DIR)}`);

if (CHECK && failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
