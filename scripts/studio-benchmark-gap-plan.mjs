#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STUDIO_BENCHMARK_GAP_PLAN_VERSION = 1;

export const DEFAULT_STUDIO_BENCHMARK_REGISTRY_PATHS = Object.freeze([
  "docs/benchmarks/studio-competitor-registry.json",
  "docs/benchmarks/studio-emerging-product-registry.json",
  "docs/benchmarks/studio-webtoon-ecosystem-registry.json",
  "docs/benchmarks/studio-research-registry.json",
]);

const PRIORITY_WEIGHT = Object.freeze({
  P0: 3,
  P1: 2,
  P2: 1,
});

const TOKEN_ALIASES = Object.freeze({
  "speech-bubble": ["balloon", "bubble", "lettering", "text"],
  "speech-bubbles": ["balloon", "bubble", "lettering", "text"],
  "automatic-speech-bubbles": ["balloon", "bubble", "lettering", "text"],
  "vertical-scroll": ["comic", "episode", "page", "panel", "pagination"],
  "panel-layout": ["comic", "page", "panel", "gutter", "layout"],
  "automatic-panel-layout": ["comic", "page", "panel", "gutter", "layout"],
  "character-consistency": ["character", "continuity", "variant", "revision", "asset"],
  "style-consistency": ["continuity", "variant", "revision", "asset"],
  "style-variants": ["variant", "revision", "asset"],
  "pose-capture": ["pose", "rig", "ik", "humanoid", "retarget"],
  "camera-pose-capture": ["pose", "rig", "ik", "humanoid", "camera"],
  "motion-capture": ["animation", "pose", "rig", "retarget", "timeline"],
  "single-camera-motion-capture": ["animation", "pose", "rig", "retarget", "timeline"],
  "layered-psd": ["psd", "import", "export", "interchange", "layer"],
  "layered-psd-export": ["psd", "import", "export", "interchange", "layer"],
  "psd-layer-export": ["psd", "import", "export", "interchange", "layer"],
  "multi-language": ["text", "lettering", "translation", "typography"],
  "multi-language-translation": ["text", "lettering", "translation", "typography"],
  "contextual-glossary-translation": ["text", "lettering", "translation", "typography"],
  "surface-direct-drawing": ["surface", "uv", "texture", "paint"],
  "three-d-asset-warehouse": ["material", "asset", "library", "marketplace", "three", "model"],
  "sketchup-direct-import": ["import", "glb", "gltf", "model", "validation"],
  "unreal-maya-blender-export": ["export", "interchange", "model", "animation"],
  "stage-by-stage-regeneration": ["structured", "layer", "mask", "control", "proposal", "alternative"],
  "offline-first": ["offline", "storage", "recovery", "sync", "conflict"],
  "offline-first-conti": ["offline", "storage", "recovery", "sync", "storyboard"],
  "creator-analytics": ["quality", "delivery", "diagnostic", "publication", "analytics"],
  "community-management": ["collaboration", "comment", "review", "publication"],
  "browser-full-resolution-export": ["export", "quality", "delivery", "browser"],
  "speaker-tts": ["audio", "dialogue", "storyboard", "timeline"],
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/3d/gu, "three-d")
    .replace(/[^a-z0-9가-힣]+/gu, "-")
    .replace(/(?:^-+|-+$)/gu, "");
}

function tokenWords(value) {
  const normalized = normalizeToken(value);
  if (!normalized) return [];
  return normalized.split("-").filter(Boolean);
}

function expandedWords(value) {
  const normalized = normalizeToken(value);
  const words = new Set(tokenWords(normalized));
  for (const alias of TOKEN_ALIASES[normalized] ?? []) {
    for (const word of tokenWords(alias)) words.add(word);
  }
  return words;
}

function registryRecords(document) {
  for (const key of ["products", "items", "papers", "research", "sources", "entries"]) {
    if (Array.isArray(document?.[key])) return document[key];
  }
  return [];
}

function normalizeProduct(raw, registryId) {
  const id = normalizeToken(raw?.id || raw?.slug || raw?.name);
  if (!id) return null;
  const focus = asArray(raw?.focus).map(cleanString).filter(Boolean);
  const laneHints = asArray(raw?.laneHints).map(normalizeToken).filter(Boolean);
  return {
    id,
    name: cleanString(raw?.name) || id,
    category: cleanString(raw?.category) || "unspecified",
    priority: Object.hasOwn(PRIORITY_WEIGHT, raw?.priority) ? raw.priority : "P2",
    focus,
    laneHints,
    registryIds: [registryId],
    officialUrl: cleanString(raw?.officialUrl),
    watchUrl: cleanString(raw?.watchUrl),
    region: cleanString(raw?.region),
    stage: cleanString(raw?.stage),
  };
}

function mergeProducts(products) {
  const byId = new Map();
  for (const product of products) {
    const existing = byId.get(product.id);
    if (!existing) {
      byId.set(product.id, {
        ...product,
        focus: [...new Set(product.focus)],
        laneHints: [...new Set(product.laneHints)],
        registryIds: [...new Set(product.registryIds)],
      });
      continue;
    }
    const priority =
      PRIORITY_WEIGHT[product.priority] > PRIORITY_WEIGHT[existing.priority]
        ? product.priority
        : existing.priority;
    byId.set(product.id, {
      ...existing,
      name: existing.name || product.name,
      category: existing.category === "unspecified" ? product.category : existing.category,
      priority,
      focus: [...new Set([...existing.focus, ...product.focus])],
      laneHints: [...new Set([...existing.laneHints, ...product.laneHints])],
      registryIds: [...new Set([...existing.registryIds, ...product.registryIds])],
      officialUrl: existing.officialUrl || product.officialUrl,
      watchUrl: existing.watchUrl || product.watchUrl,
      region: existing.region || product.region,
      stage: existing.stage || product.stage,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeLane(raw) {
  const id = normalizeToken(raw?.id);
  if (!id) return null;
  const searchable = [
    id,
    cleanString(raw?.title),
    ...asArray(raw?.focusTerms),
    ...asArray(raw?.fallbackTracks),
    ...asArray(raw?.pathHints),
  ].filter(Boolean);
  const words = new Set();
  const phrases = new Set();
  for (const token of searchable) {
    const normalized = normalizeToken(token);
    if (normalized) phrases.add(normalized);
    for (const word of expandedWords(token)) words.add(word);
  }
  return {
    id,
    title: cleanString(raw?.title) || id,
    issueQueue: asArray(raw?.issueQueue).filter((value) => Number.isInteger(value)),
    searchable,
    phrases,
    words,
  };
}

export function scoreStudioBenchmarkProductAgainstLane(product, lane) { // NOSONAR javascript:S3776
  let score = product.laneHints.includes(lane.id) ? 50 : 0;
  const matchedFocus = [];

  for (const focus of product.focus) {
    const normalizedFocus = normalizeToken(focus);
    const focusWords = expandedWords(focus);
    let focusScore = 0;

    if (lane.phrases.has(normalizedFocus)) focusScore += 12;
    if (
      [...lane.phrases].some(
        (phrase) => phrase.includes(normalizedFocus) || normalizedFocus.includes(phrase),
      )
    ) {
      focusScore += 5;
    }

    let overlap = 0;
    for (const word of focusWords) {
      if (word.length <= 1) continue;
      if (lane.words.has(word)) overlap += 1;
    }
    focusScore += overlap * 2;

    if (focusScore > 0) {
      score += focusScore;
      matchedFocus.push(focus);
    }
  }

  score += PRIORITY_WEIGHT[product.priority] ?? 1;
  return {
    laneId: lane.id,
    laneTitle: lane.title,
    score,
    matchedFocus: [...new Set(matchedFocus)],
    issueQueue: lane.issueQueue,
  };
}

export function buildStudioBenchmarkGapPlan({ // NOSONAR javascript:S3776
  campaign,
  registries,
  generatedAt = new Date().toISOString(),
}) {
  const lanes = asArray(campaign?.lanes).map(normalizeLane).filter(Boolean);
  if (lanes.length === 0) throw new Error("Campaign has no valid lanes");

  const registryMeta = [];
  const rawProducts = [];
  for (const registry of registries) {
    const registryId = normalizeToken(
      registry?.id || registry?.name || registry?.path || `registry-${registryMeta.length + 1}`,
    );
    const document = registry?.document ?? registry;
    const records = registryRecords(document);
    registryMeta.push({
      id: registryId,
      updatedAt: cleanString(document?.updatedAt),
      productCount: records.length,
    });
    for (const raw of records) {
      const normalized = normalizeProduct(raw, registryId);
      if (normalized) rawProducts.push(normalized);
    }
  }

  const products = mergeProducts(rawProducts).map((product) => {
    const ranked = lanes
      .map((lane) => scoreStudioBenchmarkProductAgainstLane(product, lane))
      .sort((a, b) => b.score - a.score || a.laneId.localeCompare(b.laneId));
    const topScore = ranked[0]?.score ?? 0;
    const topLanes = ranked
      .filter((candidate) => candidate.score > PRIORITY_WEIGHT[product.priority])
      .slice(0, 3);
    const matchedFocus = new Set(topLanes.flatMap((candidate) => candidate.matchedFocus));
    return {
      ...product,
      topScore,
      topLanes,
      unmappedFocus: product.focus.filter((focus) => !matchedFocus.has(focus)),
    };
  });

  const lanePlans = lanes.map((lane) => {
    const assignments = products
      .flatMap((product) =>
        product.topLanes
          .filter((candidate) => candidate.laneId === lane.id)
          .map((candidate) => ({
            productId: product.id,
            productName: product.name,
            priority: product.priority,
            score: candidate.score,
            matchedFocus: candidate.matchedFocus,
            registryIds: product.registryIds,
          })),
      )
      .sort(
        (a, b) =>
          (PRIORITY_WEIGHT[b.priority] ?? 1) - (PRIORITY_WEIGHT[a.priority] ?? 1) ||
          b.score - a.score ||
          a.productId.localeCompare(b.productId),
      );
    return {
      id: lane.id,
      title: lane.title,
      issueQueue: lane.issueQueue,
      assignmentCount: assignments.length,
      priorityScore: assignments.reduce(
        (sum, assignment) => sum + (PRIORITY_WEIGHT[assignment.priority] ?? 1),
        0,
      ),
      assignments,
    };
  }).sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      b.assignmentCount - a.assignmentCount ||
      a.id.localeCompare(b.id),
  );

  const unmappedProducts = products
    .filter((product) => product.topLanes.length === 0)
    .map((product) => product.id);

  return {
    schemaVersion: STUDIO_BENCHMARK_GAP_PLAN_VERSION,
    generatedAt,
    campaignId: cleanString(campaign?.campaignId),
    sourceRegistries: registryMeta,
    stats: {
      laneCount: lanes.length,
      productCount: products.length,
      mappedProductCount: products.length - unmappedProducts.length,
      unmappedProductCount: unmappedProducts.length,
      focusTermCount: products.reduce((sum, product) => sum + product.focus.length, 0),
      unmappedFocusTermCount: products.reduce(
        (sum, product) => sum + product.unmappedFocus.length,
        0,
      ),
    },
    lanePlans,
    products,
    unmappedProducts,
  };
}

export function renderStudioBenchmarkGapPlanMarkdown(plan) {
  const lines = [
    "# Studio benchmark → implementation lane plan",
    "",
    `- Generated: ${plan.generatedAt}`,
    `- Campaign: ${plan.campaignId || "unspecified"}`,
    `- Products: ${plan.stats.productCount}`,
    `- Mapped products: ${plan.stats.mappedProductCount}`,
    `- Unmapped focus terms: ${plan.stats.unmappedFocusTermCount}`,
    "",
    "## Highest-pressure lanes",
    "",
  ];

  for (const lane of plan.lanePlans.filter((item) => item.assignmentCount > 0).slice(0, 15)) {
    const issueList = lane.issueQueue.map((issue) => "#" + issue).join(", ");
    const issues = lane.issueQueue.length > 0 ? ` · ${issueList}` : "";
    lines.push(`### ${lane.id}${issues}`);
    lines.push("");
    for (const assignment of lane.assignments.slice(0, 8)) {
      const focus = assignment.matchedFocus.slice(0, 5).join(", ") || "explicit lane hint";
      lines.push(
        `- **${assignment.productName}** (${assignment.priority}, score ${assignment.score}) — ${focus}`,
      );
    }
    lines.push("");
  }

  const unmapped = plan.products.filter((product) => product.unmappedFocus.length > 0);
  lines.push("## Unmapped or weakly mapped focus");
  lines.push("");
  if (unmapped.length === 0) {
    lines.push("- None");
  } else {
    for (const product of unmapped.slice(0, 30)) {
      lines.push(`- **${product.name}** — ${product.unmappedFocus.join(", ")}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    campaignPath: "docs/automation/studio-seven-day-campaign.json",
    registryPaths: [],
    jsonOutput: null,
    markdownOutput: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--campaign") {
      options.campaignPath = value;
      index += 1; // NOSONAR javascript:S2310
    } else if (argument === "--registry") {
      options.registryPaths.push(value);
      index += 1; // NOSONAR javascript:S2310
    } else if (argument === "--json-output") {
      options.jsonOutput = value;
      index += 1; // NOSONAR javascript:S2310
    } else if (argument === "--markdown-output") {
      options.markdownOutput = value;
      index += 1; // NOSONAR javascript:S2310
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function generatedAtFromEnvironment() {
  const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH);
  if (Number.isFinite(sourceDateEpoch) && sourceDateEpoch >= 0) {
    return new Date(sourceDateEpoch * 1000).toISOString();
  }
  return new Date().toISOString();
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const registryPaths =
    options.registryPaths.length > 0
      ? options.registryPaths
      : DEFAULT_STUDIO_BENCHMARK_REGISTRY_PATHS;
  const campaign = readJson(options.campaignPath);
  const registries = registryPaths
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      id: path.basename(filePath, path.extname(filePath)),
      path: filePath,
      document: readJson(filePath),
    }));
  if (registries.length === 0) throw new Error("No benchmark registries were found");

  const plan = buildStudioBenchmarkGapPlan({
    campaign,
    registries,
    generatedAt: generatedAtFromEnvironment(),
  });
  const markdown = renderStudioBenchmarkGapPlanMarkdown(plan);
  const json = `${JSON.stringify(plan, null, 2)}\n`;

  if (options.jsonOutput) {
    ensureParent(options.jsonOutput);
    fs.writeFileSync(options.jsonOutput, json, "utf8");
  }
  if (options.markdownOutput) {
    ensureParent(options.markdownOutput);
    fs.writeFileSync(options.markdownOutput, markdown, "utf8");
  }

  if (!options.jsonOutput && !options.markdownOutput) process.stdout.write(json);
  process.stderr.write(
    `studio benchmark gap plan: ${plan.stats.mappedProductCount}/${plan.stats.productCount} products mapped across ${plan.stats.laneCount} lanes\n`,
  );
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`studio benchmark gap planning failed: ${message}`);
    process.exitCode = 1;
  }
}
