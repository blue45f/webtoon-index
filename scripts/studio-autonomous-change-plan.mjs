#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const CATEGORY_NAMES = Object.freeze([
  "canvas",
  "storage",
  "history",
  "webgpu",
  "ui",
  "collaboration",
  "deployment",
]);

const CATEGORY_RULES = Object.freeze({
  canvas: Object.freeze([
    /(^|\/)(canvas|brush|stroke|raster|vector|selection|transform)(\/|[-_.])/i,
    /Studio(?:Canvas|Draw|Stage|Selection|Transform|Brush|Vector|Raster)/,
    /^packages\/studio-(?:brush-platform|engine-|command-registry)/,
    /^crates\/.*(?:brush|canvas|raster|stroke)/i,
    /studio-(?:native-raster|artist-journey|canvas-surfaces|canvas-chrome|brush)/i,
  ]),
  storage: Object.freeze([
    /(^|\/)(?:opfs|autosave|persistence|storage|snapshot|codec|serialization|serializer)(\/|[-_.])/i,
    /(?:project|document|workspace)-(?:file|codec|store|storage|snapshot|persistence)/i,
    /(?:serialize|deserialize|migration|manifest|checksum|recovery-journal)/i,
    /(?:sqlite|indexeddb|idb|psd|ora|clip-format)/i,
    /studio-(?:lifecycle|autosave|service-worker|tile-storage)/i,
  ]),
  history: Object.freeze([
    /(^|\/)(?:undo|redo|history|command|transaction|mutation|operation)(\/|[-_.])/i,
    /studio-command-registry/i,
    /(?:undo|redo|history|transaction|command-stack|operation-log)/i,
    /Studio(?:Command|History|Undo|Redo)/,
  ]),
  webgpu: Object.freeze([
    /(?:^|[-_/])webgpu(?:[-_/]|$)/i,
    /(?:^|[-_/])wgsl(?:[-_/]|$)/i,
    /(?:gpu-committed|gpu-surface|gpu-filter|gpu-brush|gpu-texture|gpu-buffer)/i,
    /studio-engine-(?:skia|webgpu)/i,
    /(?:canvaskit|vello|hokusai|tiledoc-webgpu)/i,
    /(?:^|[-_/])wasm(?:[-_/]|$)/i,
  ]),
  ui: Object.freeze([
    /(^|\/)(?:inspector|panel|popover|dialog|menu|toolbar|toolbelt|chrome|palette|dock|workspace)(\/|[-_.])/i,
    /Studio(?:Inspector|Panel|Popover|Dialog|Menu|Toolbar|ToolBelt|Chrome|Palette|Workspace)/,
    /studio-(?:menus|icons|mobile-top|inspector-walkthrough|inapp-browser)/i,
  ]),
  collaboration: Object.freeze([
    /(?:^|[-_/])(?:crdt|yjs|socket|collaboration|presence|realtime)(?:[-_/]|$)/i,
    /(?:remote-cursor|soft-lock|lease-lock|live-room|studio-live)/i,
    /^deploy\/cloudflare-realtime\//,
  ]),
  deployment: Object.freeze([
    // Repository automation is not automatically a runtime deployment change. Only workflows
    // whose filename declares an actual deploy/release target request production build and bundle
    // validation; coordination, CI, benchmark-watch and branch-cleanup workflows stay API-free
    // control-plane changes and are covered by the contract tests above the targeted gates.
    /^\.github\/workflows\/(?:deploy|release|production|vercel|netlify|cloudflare|service-worker)(?:[-_.]|$)/i,
    /^deploy\//,
    /(?:^|\/)(?:vercel|netlify|service-worker|sw)(?:[-_./]|$)/i,
    /(?:^|\/)(?:vite\.config|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/,
    /(?:csp|bundle-budget|deployment|production-build)/i,
  ]),
});

const DOCUMENTATION_RULES = Object.freeze([
  /^docs\//,
  /(?:^|\/)README(?:\.[^/]+)?$/i,
  /(?:^|\/)(?:PRODUCT|DESIGN|DEPLOY|DIFFERENTIATION|MONETIZATION)\.md$/i,
  /\.md$/i,
  /^\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\//,
]);

function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

function uniqueSortedPaths(inputPaths) {
  return [...new Set(inputPaths.map(normalizePath).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function matchesAny(path, rules) {
  return rules.some((rule) => rule.test(path));
}

function emptyCategories() {
  return Object.fromEntries(CATEGORY_NAMES.map((name) => [name, false]));
}

export function classifyStudioChanges(inputPaths) { // NOSONAR javascript:S3776
  const paths = uniqueSortedPaths(inputPaths);
  const docsOnly = paths.length > 0 && paths.every((path) => matchesAny(path, DOCUMENTATION_RULES));
  const categories = emptyCategories();
  const matches = Object.fromEntries(CATEGORY_NAMES.map((name) => [name, []]));

  if (!docsOnly) {
    for (const path of paths) {
      for (const category of CATEGORY_NAMES) {
        if (!matchesAny(path, CATEGORY_RULES[category])) continue;
        categories[category] = true;
        matches[category].push(path);
      }
    }

    // Every WebGPU/WASM renderer change can alter the visible canvas even when the changed path
    // does not contain a brush/raster keyword. Treat it as a canvas change to prevent a false-low
    // risk plan.
    if (categories.webgpu) categories.canvas = true;
  }

  const highRisk = categories.canvas || categories.storage || categories.history || categories.webgpu;
  const sourceChange = paths.length > 0 && !docsOnly;
  const needsBrowser = sourceChange && (highRisk || categories.ui);
  const needsBuild = sourceChange && (highRisk || categories.ui || categories.deployment);

  return Object.freeze({
    paths: Object.freeze(paths),
    changedCount: paths.length,
    docsOnly,
    sourceChange,
    highRisk,
    needsBrowser,
    needsBuild,
    categories: Object.freeze({ ...categories }),
    matches: Object.freeze(
      Object.fromEntries(
        CATEGORY_NAMES.map((name) => [name, Object.freeze([...new Set(matches[name])])]),
      ),
    ),
  });
}

export function summarizeStudioChangeClassification(classification) {
  const active = CATEGORY_NAMES.filter((name) => classification.categories[name]);
  if (classification.changedCount === 0) return "no changed files";
  if (classification.docsOnly) return `documentation only (${classification.changedCount} files)`;
  if (active.length === 0) return `general source change (${classification.changedCount} files)`;
  return `${active.join(", ")} (${classification.changedCount} files)`;
}

function parseArguments(argv) {
  const options = {
    pathsFile: null,
    githubOutput: null,
    json: false,
    paths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--paths-file") {
      options.pathsFile = argv[index + 1] ?? null;
      index += 1; // NOSONAR javascript:S2310
      continue;
    }
    if (argument === "--github-output") {
      options.githubOutput = argv[index +1] ?? null;
      index += 1; // NOSONAR javascript:S2310
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--") {
      options.paths.push(...argv.slice(index + 1));
      break;
    }
    if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    options.paths.push(argument);
  }

  return options;
}

function readChangedPaths(options) {
  const paths = [...options.paths];
  if (options.pathsFile) {
    const text = fs.readFileSync(options.pathsFile, "utf8");
    paths.push(...text.split(/\r?\n/u));
  }
  if (!options.pathsFile && paths.length === 0 && !process.stdin.isTTY) {
    paths.push(...fs.readFileSync(0, "utf8").split(/\r?\n/u));
  }
  return paths;
}

function appendGitHubOutputs(outputPath, classification) {
  const summary = summarizeStudioChangeClassification(classification)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  const lines = [
    `changed_count=${classification.changedCount}`,
    `docs_only=${classification.docsOnly}`,
    `source_change=${classification.sourceChange}`,
    `high_risk=${classification.highRisk}`,
    `needs_browser=${classification.needsBrowser}`,
    `needs_build=${classification.needsBuild}`,
    `summary=${summary}`,
    ...CATEGORY_NAMES.map((name) => `${name}=${classification.categories[name]}`),
  ];
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function serializeClassification(classification) {
  return {
    ...classification,
    paths: [...classification.paths],
    categories: { ...classification.categories },
    matches: Object.fromEntries(
      CATEGORY_NAMES.map((name) => [name, [...classification.matches[name]]]),
    ),
    summary: summarizeStudioChangeClassification(classification),
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.pathsFile && !fs.existsSync(options.pathsFile)) {
    throw new Error(`Changed-path file does not exist: ${options.pathsFile}`);
  }
  if (options.githubOutput && !options.githubOutput.trim()) {
    throw new Error("--github-output requires a non-empty path");
  }

  const classification = classifyStudioChanges(readChangedPaths(options));
  if (options.githubOutput) appendGitHubOutputs(options.githubOutput, classification);

  const serialized = serializeClassification(classification);
  if (options.json || options.githubOutput) {
    process.stdout.write(`${JSON.stringify(serialized, null, 2)}\n`);
  } else {
    process.stdout.write(`${serialized.summary}\n`);
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`studio autonomous change classification failed: ${message}`);
    process.exitCode = 1;
  }
}
