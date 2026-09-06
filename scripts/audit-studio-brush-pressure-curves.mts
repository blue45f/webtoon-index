#!/usr/bin/env tsx
/**
 * Complete dynamic-catalogue pressure-curve audit.
 *
 * Low/high delta tests can miss a preset that behaves like a binary switch. This gate samples ten
 * hardware-pressure levels through the real dab planner and rejects accidental fixed, coarse or
 * abrupt responses. Intentionally pressure-invariant tools remain explicit controls.
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
  type NormalizedStudioBrushDynamicsSettings,
} from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import { studioBrushPackDescriptorById } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { materializeStudioBrushPackSelection } from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import {
  profileStudioBrushPressureCurve,
  STUDIO_BRUSH_PRESSURE_MAX_STEP_SHARE,
  STUDIO_BRUSH_PRESSURE_MIN_DISTINCT_STATES,
  STUDIO_BRUSH_PRESSURE_PROBE_LEVELS,
  type StudioBrushPressureCurveProfile,
} from "../apps/web/src/domains/creator/brush/studio-brush-pressure-curve-quality";

const CHECK = process.argv.includes("--check");
const OUT_DIR_ARGUMENT = process.argv.find((argument) => argument.startsWith("--out-dir="));
const OUT_DIR = path.resolve(
  process.cwd(),
  OUT_DIR_ARGUMENT?.slice("--out-dir=".length)
    || "artifacts/brush-pressure-curves",
);

/**
 * Mirrors the deliberate fixed-pressure controls proved by the complete core/pro planner test.
 * Core screentone and crosshatch use non-dynamic global-grid engines, so they do not enter this
 * dynamic-only audit.
 */
const INTENTIONAL_FIXED_DYNAMIC_IDS = new Set([
  "milli-pen-uniform",
  "web-pressure-flat",
  "screentone--sparse-grid",
  "pencil--side-shade",
]);
const DEFAULT_IDS = new Set(
  STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.map(({ id }) => id),
);

interface ProfileRow {
  readonly id: string;
  readonly name: string;
  readonly source: "core" | "pro";
  readonly runtimeBrushId: string;
  readonly defaultPortfolio: boolean;
  readonly intentionallyFixed: boolean;
  readonly profile: StudioBrushPressureCurveProfile;
}

function runtimeBrushIdFor(item: StudioBrushCatalogItem): string {
  const itemRuntime = (item as StudioBrushCatalogItem & { runtimeBrushId?: unknown }).runtimeBrushId;
  if (typeof itemRuntime === "string" && itemRuntime.length > 0) return itemRuntime;
  return studioBrushPackDescriptorById(item.id)?.runtimeBrushId ?? item.id;
}

function dynamicsFor(
  item: StudioBrushCatalogItem,
): NormalizedStudioBrushDynamicsSettings | null {
  return materializeStudioBrushPackSelection(item.id)?.brushDynamics
    ?? studioBrushDynamicsSettingsForBrushId(item.id)
    ?? null;
}

const rows: ProfileRow[] = [];
for (const item of STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS) {
  const settings = dynamicsFor(item);
  if (!settings) continue;
  const runtimeBrushId = runtimeBrushIdFor(item);
  rows.push({
    id: item.id,
    name: item.name,
    source: item.source,
    runtimeBrushId,
    defaultPortfolio: DEFAULT_IDS.has(item.id),
    intentionallyFixed: INTENTIONAL_FIXED_DYNAMIC_IDS.has(item.id),
    profile: profileStudioBrushPressureCurve({
      catalogId: item.id,
      runtimeBrushId,
      defaultWidth: item.defaultWidth,
      defaultOpacity: item.defaultOpacity,
      settings,
    }),
  });
}

const failures: string[] = [];
const warnings: string[] = [];
for (const row of rows) {
  const { analysis } = row.profile;
  if (row.intentionallyFixed && analysis.responsive) {
    failures.push(
      `${row.id}: intentionally fixed-pressure control became responsive`,
    );
  }
  if (!row.intentionallyFixed && !analysis.responsive) {
    failures.push(
      `${row.id}: dynamic brush is accidentally pressure-invariant`,
    );
  }
  if (!row.intentionallyFixed && analysis.coarseResponse) {
    failures.push(
      `${row.id}: only ${analysis.distinctStateCount} pressure states `
      + `(minimum ${STUDIO_BRUSH_PRESSURE_MIN_DISTINCT_STATES})`,
    );
  }
  if (!row.intentionallyFixed && analysis.abruptResponse) {
    failures.push(
      `${row.id}: one pressure interval owns ${(analysis.maxStepShare * 100).toFixed(1)}% `
      + `of response travel (maximum ${STUDIO_BRUSH_PRESSURE_MAX_STEP_SHARE * 100}%)`,
    );
  }
  if (!row.intentionallyFixed && analysis.reversalRatio > 0.75) {
    warnings.push(
      `${row.id}: pressure response reverses ${(analysis.reversalRatio * 100).toFixed(1)}% `
      + "beyond its direct low-to-high path",
    );
  }
}

const fixedObserved = rows.filter(({ profile }) => !profile.analysis.responsive);
const lowestContinuity = [...rows]
  .filter(({ intentionallyFixed }) => !intentionallyFixed)
  .sort((left, right) => (
    left.profile.analysis.continuityScore - right.profile.analysis.continuityScore
    || left.id.localeCompare(right.id)
  ))
  .slice(0, 30);
const highestReversal = [...rows]
  .filter(({ intentionallyFixed }) => !intentionallyFixed)
  .sort((left, right) => (
    right.profile.analysis.reversalRatio - left.profile.analysis.reversalRatio
    || left.id.localeCompare(right.id)
  ))
  .slice(0, 30);

const report = {
  version: "studio-brush-pressure-curve-audit-v1",
  generatedAt: new Date().toISOString(),
  checkMode: CHECK,
  thresholds: {
    pressureLevels: STUDIO_BRUSH_PRESSURE_PROBE_LEVELS,
    minimumDistinctStates: STUDIO_BRUSH_PRESSURE_MIN_DISTINCT_STATES,
    maximumStepShare: STUDIO_BRUSH_PRESSURE_MAX_STEP_SHARE,
  },
  summary: {
    listedBrushCount: STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length,
    dynamicProfileCount: rows.length,
    responsiveCount: rows.filter(({ profile }) => profile.analysis.responsive).length,
    fixedCount: fixedObserved.length,
    intentionallyFixedCount: INTENTIONAL_FIXED_DYNAMIC_IDS.size,
    coarseCount: rows.filter(({ profile }) => profile.analysis.coarseResponse).length,
    abruptCount: rows.filter(({ profile }) => profile.analysis.abruptResponse).length,
    warningCount: warnings.length,
    failureCount: failures.length,
  },
  failures,
  warnings,
  rows,
  lowestContinuity,
  highestReversal,
};

function escapeMarkdown(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ");
}

const markdown = [
  "# Studio full-range pressure-curve audit",
  "",
  `- Listed brushes: **${report.summary.listedBrushCount}**`,
  `- Dynamic planner profiles: **${report.summary.dynamicProfileCount}**`,
  `- Responsive: **${report.summary.responsiveCount}**`,
  `- Intentional fixed controls: **${report.summary.intentionallyFixedCount}**`,
  `- Coarse responses: **${report.summary.coarseCount}**`,
  `- Abrupt responses: **${report.summary.abruptCount}**`,
  `- Failures: **${report.summary.failureCount}**`,
  "",
  "## Hard failures",
  "",
  ...(failures.length > 0 ? failures.map((entry) => `- ${entry}`) : ["- None"]),
  "",
  "## Review warnings",
  "",
  ...(warnings.length > 0 ? warnings.map((entry) => `- ${entry}`) : ["- None"]),
  "",
  "## Lowest continuity scores",
  "",
  "| id | name | default | states | max-step | continuity | reversal |",
  "|---|---|:---:|---:|---:|---:|---:|",
  ...lowestContinuity.map((row) => {
    const analysis = row.profile.analysis;
    return `| ${escapeMarkdown(row.id)} | ${escapeMarkdown(row.name)} | `
      + `${row.defaultPortfolio ? "yes" : "no"} | ${analysis.distinctStateCount} | `
      + `${analysis.maxStepShare.toFixed(4)} | ${analysis.continuityScore.toFixed(4)} | `
      + `${analysis.reversalRatio.toFixed(4)} |`;
  }),
  "",
  "## Intentional fixed-pressure controls",
  "",
  ...(fixedObserved.length > 0
    ? fixedObserved.map((row) => `- ${row.id} — ${row.name}`)
    : ["- None"]),
  "",
  "## Interpretation",
  "",
  "- Ten stylus levels are planned with identical geometry, speed and seed.",
  "- Distinct states detect low/middle/high bucket behavior that a low-vs-high test cannot see.",
  "- Max-step share detects a single threshold jump even when the endpoints differ.",
  "- Reversal is reported for review rather than failed because inverse scatter/spacing can be an intentional material design.",
  "",
].join("\n");

await mkdir(OUT_DIR, { recursive: true });
await Promise.all([
  writeFile(
    path.join(OUT_DIR, "brush-pressure-curve-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(OUT_DIR, "brush-pressure-curve-audit.md"),
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
