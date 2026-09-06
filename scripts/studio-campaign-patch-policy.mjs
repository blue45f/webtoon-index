#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  STUDIO_SEVEN_DAY_CAMPAIGN_CONFIG_PATH,
  validateStudioSevenDayCampaignConfig,
} from "./studio-seven-day-campaign.mjs";

const ALLOWED_PATH_RULES = Object.freeze([
  /^(?:src|components|packages|crates|apps|lib|hooks|e2e|tests|docs|vendor|models)\//u,
  /^public\/(?:assets|brushes|models|materials|textures|third-party)\//u,
  /^(?:README|PRODUCT|DESIGN|DEPLOY|DIFFERENTIATION|MONETIZATION|STUDIO_MANUAL)\.md$/u,
]);

const FORBIDDEN_PATH_RULES = Object.freeze([
  /^\.git/u,
  /^\.github\//u,
  /(^|\/)package\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
  /(^|\/)package-lock\.json$/u,
  /(^|\/)yarn\.lock$/u,
  /(^|\/)bun\.lockb?$/u,
  /(^|\/)(?:Cargo\.toml|Cargo\.lock|pyproject\.toml|poetry\.lock|uv\.lock|go\.mod|go\.sum)$/u,
  /(^|\/)requirements[^/]*\.txt$/u,
  /(^|\/)\.env(?:\.|$)/u,
  /(^|\/)\.npmrc$/u,
  /^deploy\//u,
  /^scripts\//u,
  /^tools\//u,
  /^vercel\.json$/u,
  /^(?:vite|vitest|playwright|eslint|postcss|tailwind|commitlint|turbo|tsconfig)(?:\.|$)/u,
  /^apps\/api\/src\/db\/(?:migrations(?:\/|$)|schema(?:\.|\/|$))/u,
  /^lib\/db\/(?:migrations(?:\/|$)|schema(?:\.|\/|$))/u,
  /^drizzle(?:\.|\/|$)/u,
  /^docs\/automation\/studio-seven-day-campaign\.json$/u,
  /^docs\/third-party\/studio-owner-attestation-2026-09-02\.md$/u,
  /^docs\/studio-third-party-reuse-policy-2026-09-02\.md$/u,
]);

const SOURCE_PATH_RULES = Object.freeze([
  /^(?:src|components|packages|crates|apps)\//u,
  /^(?:lib|hooks|vendor|models)\//u,
  /^public\/(?:assets|brushes|models|materials|textures|third-party)\//u,
]);

const TEST_PATH_RULES = Object.freeze([
  /(?:^|\/)__tests__\//u,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/u,
  /^e2e\//u,
  /^tests\//u,
]);

const EXTERNAL_PAYLOAD_RULES = Object.freeze([
  /^vendor\//u,
  /^models\//u,
  /^public\/(?:assets|brushes|models|materials|textures|third-party)\//u,
  /^src\/.*\.(?:glb|gltf|vrm|ktx2|hdr|exr|abr|sut|safetensors|onnx)$/iu,
]);

function normalizePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function matches(pathname, rules) {
  return rules.some((rule) => rule.test(pathname));
}

export function evaluateStudioCampaignPatch(config, changes) { // NOSONAR javascript:S3776
  const issues = [];
  const normalized = changes.map((change) => ({
    status: String(change.status ?? "M").slice(0, 1),
    path: normalizePath(change.path),
    additions: Number.isFinite(Number(change.additions)) ? Number(change.additions) : 0,
    deletions: Number.isFinite(Number(change.deletions)) ? Number(change.deletions) : 0,
    binary: change.binary === true,
    oldMode: String(change.oldMode ?? ""),
    newMode: String(change.newMode ?? change.mode ?? ""),
  }));

  if (normalized.length === 0) issues.push("patch is empty");
  if (normalized.length > config.agent.maxChangedFiles) {
    issues.push(`changed files exceed limit ${config.agent.maxChangedFiles}: ${normalized.length}`);
  }
  const changedLines = normalized.reduce((sum, change) => sum + change.additions + change.deletions, 0);
  if (changedLines > config.agent.maxChangedLines) {
    issues.push(`changed lines exceed limit ${config.agent.maxChangedLines}: ${changedLines}`);
  }

  for (const change of normalized) {
    if (!change.path) {
      issues.push("patch contains an empty path");
      continue;
    }
    if (!matches(change.path, ALLOWED_PATH_RULES)) {
      issues.push(`agent path is outside the campaign allowlist: ${change.path}`);
    }
    if (matches(change.path, FORBIDDEN_PATH_RULES)) {
      issues.push(`agent may not modify protected path: ${change.path}`);
    }
    if (change.status === "D") issues.push(`agent may not delete files: ${change.path}`);
    if (change.binary) issues.push(`agent patch may not add or modify binary payloads: ${change.path}`);
    if (change.newMode === "120000") {
      issues.push(`agent patch may not create or modify symbolic links: ${change.path}`);
    }
    if (change.newMode === "160000") {
      issues.push(`agent patch may not create or modify gitlinks or submodules: ${change.path}`);
    }
  }

  const sourceChanges = normalized.filter((change) => matches(change.path, SOURCE_PATH_RULES));
  const testChanges = normalized.filter((change) => matches(change.path, TEST_PATH_RULES));
  if (config.quality.requireTestForSourceChange && sourceChanges.length > 0 && testChanges.length === 0) {
    issues.push("source changes require at least one focused test change");
  }

  const externalPayload = normalized.some((change) => matches(change.path, EXTERNAL_PAYLOAD_RULES));
  const registryChanged = normalized.some(
    (change) => change.path === "docs/third-party/studio-reuse-registry.json",
  );
  if (externalPayload && !registryChanged) {
    issues.push("external payload changes require docs/third-party/studio-reuse-registry.json");
  }
  if (externalPayload && testChanges.length === 0) {
    issues.push("external payload changes require at least one focused test change");
  }

  const workflowChanged = normalized.some((change) => change.path.startsWith(".github/"));
  const dependencyChanged = normalized.some(
    (change) => /(^|\/)(?:package\.json|pnpm-lock\.yaml|Cargo\.toml|Cargo\.lock)$/u.test(change.path),
  );
  const fileModeChanged = normalized.some(
    (change) => change.oldMode !== change.newMode && (change.oldMode || change.newMode),
  );

  return Object.freeze({
    ok: issues.length === 0,
    issues: Object.freeze(issues),
    changedFiles: normalized.length,
    changedLines,
    sourceChanged: sourceChanges.length > 0,
    testChanged: testChanges.length > 0,
    externalPayload,
    registryChanged,
    workflowChanged,
    dependencyChanged,
    fileModeChanged,
    changes: Object.freeze(normalized),
  });
}

function parseNameStatus(text) {
  return String(text ?? "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [rawStatus, ...parts] = line.split("\t");
      return { status: rawStatus?.slice(0, 1) || "M", path: parts.at(-1) || "" };
    });
}

function parseNumstat(text) {
  const rows = new Map();
  for (const line of String(text ?? "").split(/\r?\n/u).filter(Boolean)) {
    const [additions, deletions, ...parts] = line.split("\t");
    const pathname = normalizePath(parts.at(-1));
    rows.set(pathname, {
      additions: additions === "-" ? 0 : Number(additions),
      deletions: deletions === "-" ? 0 : Number(deletions),
      binary: additions === "-" || deletions === "-",
    });
  }
  return rows;
}

function parseRawModes(text) {
  const rows = new Map();
  for (const line of String(text ?? "").split(/\r?\n/u).filter(Boolean)) {
    const [metadata, ...parts] = line.split("\t");
    if (!metadata.startsWith(":")) continue;
    const [oldMode = "", newMode = ""] = metadata.slice(1).split(/\s+/u);
    const pathname = normalizePath(parts.at(-1));
    if (!pathname) continue;
    rows.set(pathname, { oldMode, newMode });
  }
  return rows;
}

export function collectStudioCampaignGitChanges(base = "HEAD") {
  const nameStatus = execFileSync("git", ["diff", "--name-status", "--find-renames", base, "--"], {
    encoding: "utf8",
  });
  const numstat = execFileSync("git", ["diff", "--numstat", "--find-renames", base, "--"], {
    encoding: "utf8",
  });
  const raw = execFileSync(
    "git",
    ["diff", "--raw", "--no-abbrev", "--find-renames", base, "--"],
    { encoding: "utf8" },
  );
  const stats = parseNumstat(numstat);
  const modes = parseRawModes(raw);
  return parseNameStatus(nameStatus).map((change) => ({
    ...change,
    ...(stats.get(normalizePath(change.path)) ?? { additions: 0, deletions: 0, binary: false }),
    ...(modes.get(normalizePath(change.path)) ?? { oldMode: "", newMode: "" }),
  }));
}

function parseArguments(argv) {
  const options = {
    base: "HEAD",
    configPath: STUDIO_SEVEN_DAY_CAMPAIGN_CONFIG_PATH,
    outputPath: null,
    githubOutputPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base") options.base = argv[++index]; // NOSONAR javascript:S2310
    else if (argument === "--config") options.configPath = argv[++index]; // NOSONAR javascript:S2310
    else if (argument === "--output") options.outputPath = argv[++index]; // NOSONAR javascript:S2310
    else if (argument === "--github-output") options.githubOutputPath = argv[++index]; // NOSONAR javascript:S2310
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function appendGitHubOutputs(filePath, result) {
  fs.appendFileSync(
    filePath,
    [
      `ok=${result.ok}`,
      `changed_files=${result.changedFiles}`,
      `changed_lines=${result.changedLines}`,
      `source_changed=${result.sourceChanged}`,
      `test_changed=${result.testChanged}`,
      `external_payload=${result.externalPayload}`,
    ].join("\n") + "\n",
    "utf8",
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(path.resolve(options.configPath), "utf8"));
  const configIssues = validateStudioSevenDayCampaignConfig(config);
  if (configIssues.length > 0) throw new Error(`Campaign config is invalid: ${configIssues.join("; ")}`);
  const result = evaluateStudioCampaignPatch(config, collectStudioCampaignGitChanges(options.base));
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.outputPath) fs.writeFileSync(path.resolve(options.outputPath), serialized, "utf8");
  else process.stdout.write(serialized);
  if (options.githubOutputPath) appendGitHubOutputs(options.githubOutputPath, result);
  if (!result.ok) {
    for (const issue of result.issues) console.error(`campaign patch policy: ${issue}`);
    process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
