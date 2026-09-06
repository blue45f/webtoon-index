#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildStudioCompetitorWatchReport } from "./studio-competitor-watch.mjs";

export const STUDIO_RESEARCH_REGISTRY_PATH = "docs/benchmarks/studio-research-registry.json";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_BODY_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const PRIORITIES = new Set(["P0", "P1", "P2"]);
const USER_AGENT =
  "ToonSpectrum-Studio-Research-Watch/1.0 (+https://github.com/blue45f/toonspectrum)";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validHttps(value) {
  if (typeof value !== "string" || value.trim() !== value || !value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

function validTag(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function validateStudioResearchRegistry(registry) { // NOSONAR javascript:S3776
  const issues = [];
  if (!isObject(registry)) return ["registry must be an object"];
  if (registry.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (typeof registry.updatedAt !== "string" || !DATE_PATTERN.test(registry.updatedAt)) {
    issues.push("updatedAt must use YYYY-MM-DD");
  }
  if (typeof registry.purpose !== "string" || registry.purpose.trim().length < 60) {
    issues.push("purpose must describe the research-to-prototype contract");
  }
  if (!Array.isArray(registry.papers) || registry.papers.length < 8) {
    issues.push("papers must contain at least 8 primary-source seeds");
  }
  if (!Array.isArray(registry.queries) || registry.queries.length < 4) {
    issues.push("queries must contain at least 4 discovery searches");
  }

  const ids = new Set();
  for (const [index, paper] of (registry.papers ?? []).entries()) {
    const prefix = `papers[${index}]`;
    if (!isObject(paper)) {
      issues.push(`${prefix} must be an object`);
      continue;
    }
    if (!validTag(paper.id)) issues.push(`${prefix}.id must be lowercase kebab-case`);
    else if (ids.has(paper.id)) issues.push(`${prefix}.id duplicates ${paper.id}`);
    else ids.add(paper.id);
    if (typeof paper.title !== "string" || !paper.title.trim()) {
      issues.push(`${prefix}.title must be non-empty`);
    }
    if (typeof paper.publishedAt !== "string" || !DATE_PATTERN.test(paper.publishedAt)) {
      issues.push(`${prefix}.publishedAt must use YYYY-MM-DD`);
    }
    if (!validHttps(paper.officialUrl)) issues.push(`${prefix}.officialUrl must be HTTPS`);
    if (!validHttps(paper.watchUrl)) issues.push(`${prefix}.watchUrl must be HTTPS`);
    if (!PRIORITIES.has(paper.priority)) issues.push(`${prefix}.priority must be P0, P1, or P2`);
    if (!Array.isArray(paper.focus) || paper.focus.length === 0 || !paper.focus.every(validTag)) {
      issues.push(`${prefix}.focus must contain kebab-case tags`);
    }
  }

  const queryIds = new Set();
  for (const [index, query] of (registry.queries ?? []).entries()) {
    const prefix = `queries[${index}]`;
    if (!isObject(query)) {
      issues.push(`${prefix} must be an object`);
      continue;
    }
    if (!validTag(query.id)) issues.push(`${prefix}.id must be lowercase kebab-case`);
    else if (queryIds.has(query.id)) issues.push(`${prefix}.id duplicates ${query.id}`);
    else queryIds.add(query.id);
    if (query.endpoint !== "https://export.arxiv.org/api/query") {
      issues.push(`${prefix}.endpoint must use the official arXiv export API`);
    }
    if (typeof query.searchQuery !== "string" || query.searchQuery.length < 8) {
      issues.push(`${prefix}.searchQuery must be non-empty`);
    }
    if (!Number.isInteger(query.maxResults) || query.maxResults < 1 || query.maxResults > 50) {
      issues.push(`${prefix}.maxResults must be an integer from 1 to 50`);
    }
    if (!Array.isArray(query.focus) || query.focus.length === 0 || !query.focus.every(validTag)) {
      issues.push(`${prefix}.focus must contain kebab-case tags`);
    }
  }
  return issues;
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function tagText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu"));
  return match ? decodeXml(match[1]) : "";
}

export function parseArxivAtomFeed(xml, query) {
  const entries = [];
  const blocks = String(xml ?? "").match(/<entry\b[\s\S]*?<\/entry>/giu) ?? [];
  for (const block of blocks) {
    const idUrl = tagText(block, "id");
    const arxivMatch = idUrl.match(/arxiv\.org\/abs\/([^/?#]+)/iu);
    const id = arxivMatch?.[1]?.replace(/v\d+$/iu, "") ?? idUrl;
    const title = tagText(block, "title");
    const summary = tagText(block, "summary");
    const published = tagText(block, "published");
    const updated = tagText(block, "updated");
    const authors = [...block.matchAll(/<author\b[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/giu)]
      .map((match) => decodeXml(match[1]))
      .filter(Boolean)
      .slice(0, 12);
    const categories = [...block.matchAll(/<category\b[^>]*term=["']([^"']+)["'][^>]*\/?\s*>/giu)]
      .map((match) => decodeXml(match[1]))
      .filter(Boolean);
    if (!id || !title) continue;
    entries.push({
      id,
      url: idUrl,
      title,
      summary,
      published,
      updated,
      authors,
      categories: [...new Set(categories)],
      queryId: query.id,
      focus: [...query.focus],
    });
  }
  return entries;
}

async function readBoundedText(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    throw new Error(`content length ${length} exceeds ${MAX_BODY_BYTES}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new Error(`response body ${buffer.byteLength} exceeds ${MAX_BODY_BYTES}`);
  }
  return buffer.toString("utf8");
}

async function fetchArxivQuery(query, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${query.endpoint}?search_query=${query.searchQuery}&start=0&max_results=${query.maxResults}&sortBy=submittedDate&sortOrder=descending`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.5",
        "user-agent": USER_AGENT,
      },
    });
    const body = await readBoundedText(response);
    return {
      id: query.id,
      ok: response.ok,
      status: response.status,
      url: response.url,
      error: response.ok ? "" : `HTTP ${response.status}`,
      entries: response.ok ? parseArxivAtomFeed(body, query) : [],
    };
  } catch (error) {
    return {
      id: query.id,
      ok: false,
      status: 0,
      url,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error),
      entries: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

export function mergeResearchEntries(queryReports) {
  const byId = new Map();
  for (const report of queryReports) {
    for (const entry of report.entries ?? []) {
      const existing = byId.get(entry.id);
      if (!existing) {
        byId.set(entry.id, { ...entry, queryIds: [entry.queryId], focus: [...entry.focus] });
        continue;
      }
      const newer = String(entry.updated) > String(existing.updated) ? entry : existing;
      byId.set(entry.id, {
        ...newer,
        queryIds: [...new Set([...(existing.queryIds ?? []), entry.queryId])].sort(),
        focus: [...new Set([...(existing.focus ?? []), ...entry.focus])].sort(),
      });
    }
  }
  return [...byId.values()].sort(
    (left, right) => String(right.updated || right.published).localeCompare(String(left.updated || left.published)) || left.id.localeCompare(right.id),
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function buildResearchFingerprint(seedReport, entries, queryReports) {
  const stable = {
    seedAggregate: seedReport.aggregateHash,
    queries: queryReports.map((report) => ({ id: report.id, ok: report.ok, status: report.status })).sort((a, b) => a.id.localeCompare(b.id)),
    entries: entries.map((entry) => ({ id: entry.id, updated: entry.updated, title: entry.title, focus: entry.focus })),
  };
  return sha256(JSON.stringify(stable));
}

export async function buildStudioResearchWatchReport(registry, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const seedRegistry = {
    products: registry.papers.map((paper) => ({
      ...paper,
      name: paper.title,
      category: "research",
    })),
  };
  const [seedReport, queryReports] = await Promise.all([
    buildStudioCompetitorWatchReport(seedRegistry, {
      all: true,
      timeoutMs,
      concurrency: options.concurrency ?? 4,
    }),
    Promise.all(registry.queries.map((query) => fetchArxivQuery(query, timeoutMs))),
  ]);
  const entries = mergeResearchEntries(queryReports);
  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    seedReport,
    queryReports,
    discoveredCount: entries.length,
    entries,
    aggregateHash: buildResearchFingerprint(seedReport, entries, queryReports),
  };
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/gu, " ").trim();
}

export function renderStudioResearchWatchMarkdown(report, options = {}) {
  const limit = options.limit ?? 20;
  const failedQueries = report.queryReports.filter((query) => !query.ok);
  const lines = [
    "<!-- studio-research-watch -->",
    "## Studio research and paper watch",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Seed sources reachable: ${report.seedReport.okCount}/${report.seedReport.selectedCount}`,
    `- Discovery queries healthy: ${report.queryReports.length - failedQueries.length}/${report.queryReports.length}`,
    `- Distinct papers discovered: ${report.discoveredCount}`,
    `- Aggregate: \`${report.aggregateHash}\``,
    "",
    "| Updated | Paper | Categories | Capability targets |",
    "| --- | --- | --- | --- |",
  ];
  for (const entry of report.entries.slice(0, limit)) {
    lines.push(
      `| ${escapeMarkdown((entry.updated || entry.published || "-").slice(0, 10))} | ${escapeMarkdown(entry.title)} | ${escapeMarkdown(entry.categories.join(", ") || "-")} | ${escapeMarkdown(entry.focus.join(", "))} |`,
    );
  }
  if (failedQueries.length > 0) {
    lines.push("", "### Query failures", "");
    for (const query of failedQueries) lines.push(`- ${query.id}: ${escapeMarkdown(query.error || query.status)}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    registryPath: STUDIO_RESEARCH_REGISTRY_PATH,
    output: null,
    markdown: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    concurrency: 4,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--registry") options.registryPath = argv[++index]; // NOSONAR javascript:S2310
    else if (argument === "--output") options.output = argv[++index]; // NOSONAR javascript:S2310
    else if (argument === "--markdown") options.markdown = argv[++index]; // NOSONAR javascript:S2310
    else if (argument === "--timeout-ms") options.timeoutMs = Number(argv[++index]); // NOSONAR javascript:S2310
    else if (argument === "--concurrency") options.concurrency = Number(argv[++index]); // NOSONAR javascript:S2310
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) {
    throw new Error("--timeout-ms must be an integer between 1000 and 60000");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 12) {
    throw new Error("--concurrency must be an integer between 1 and 12");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const registry = JSON.parse(fs.readFileSync(path.resolve(options.registryPath), "utf8"));
  const issues = validateStudioResearchRegistry(registry);
  if (issues.length > 0) {
    const issueList = issues.map((issue) => " - " + issue).join("\n");
    throw new Error(`Research registry is invalid:\n${issueList}`);
  }
  const report = await buildStudioResearchWatchReport(registry, options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderStudioResearchWatchMarkdown(report);
  if (options.output) fs.writeFileSync(path.resolve(options.output), json, "utf8");
  if (options.markdown) fs.writeFileSync(path.resolve(options.markdown), markdown, "utf8");
  if (!options.output && !options.markdown) process.stdout.write(markdown);
  console.error(
    `Research watch complete: ${report.discoveredCount} papers; aggregate ${report.aggregateHash}`,
  );
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
