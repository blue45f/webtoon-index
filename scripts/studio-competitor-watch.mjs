#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  STUDIO_COMPETITOR_REGISTRY_PATH,
  validateStudioCompetitorRegistry,
} from "./validate-studio-competitor-registry.mjs";

const REPORT_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_BODY_BYTES = 2_000_000;
const USER_AGENT =
  "ToonSpectrum-Studio-Competitor-Watch/1.0 (+https://github.com/blue45f/toonspectrum)";

function decodeBasicEntities(value) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

export function normalizeCompetitorBody(input) {
  return decodeBasicEntities(String(input ?? ""))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\b(?:csrf|nonce|request|session)[-_ ]?(?:token|id)\b\s*[:=]\s*\S+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_BODY_BYTES);
}

export function extractCompetitorPageTitle(input) {
  const match = String(input ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
  return match ? normalizeCompetitorBody(match[1]).slice(0, 180) : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function buildCompetitorFingerprint(results) {
  const stableRows = [...results]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((result) => ({
      id: result.id,
      ok: result.ok,
      status: result.status,
      finalUrl: result.finalUrl,
      title: result.title,
      etag: result.etag,
      lastModified: result.lastModified,
      contentHash: result.contentHash,
      errorCode: result.errorCode,
    }));
  return sha256(JSON.stringify(stableRows));
}

export function selectStudioCompetitors(registry, options = {}) {
  const products = Array.isArray(registry?.products) ? registry.products : [];
  if (options.all === true) return [...products];
  const priorities = new Set(options.priorities?.length ? options.priorities : ["P0"]);
  return products.filter((product) => priorities.has(product.priority));
}

function classifyFetchError(error) {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error instanceof Error && /timeout/iu.test(error.message)) return "timeout";
  if (error instanceof Error && /content length|response body/iu.test(error.message)) return "body-limit";
  if (error instanceof TypeError) return "network";
  return "unknown";
}

async function readBoundedBody(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new Error(`content length ${contentLength} exceeds ${MAX_BODY_BYTES}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new Error(`response body ${buffer.byteLength} exceeds ${MAX_BODY_BYTES}`);
  }
  return buffer.toString("utf8");
}

async function inspectCompetitor(product, timeoutMs) {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(product.watchUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
        "user-agent": USER_AGENT,
      },
    });
    const body = await readBoundedBody(response);
    const normalized = normalizeCompetitorBody(body);
    return {
      id: product.id,
      name: product.name,
      priority: product.priority,
      category: product.category,
      sourceUrl: product.watchUrl,
      finalUrl: response.url,
      ok: response.ok,
      status: response.status,
      title: extractCompetitorPageTitle(body),
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
      contentHash: sha256(normalized),
      normalizedBytes: Buffer.byteLength(normalized),
      errorCode: response.ok ? "" : `http-${response.status}`,
      error: response.ok ? "" : `HTTP ${response.status}`,
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: product.id,
      name: product.name,
      priority: product.priority,
      category: product.category,
      sourceUrl: product.watchUrl,
      finalUrl: "",
      ok: false,
      status: 0,
      title: "",
      etag: "",
      lastModified: "",
      contentHash: "",
      normalizedBytes: 0,
      errorCode: classifyFetchError(error),
      error: message.slice(0, 300),
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function buildStudioCompetitorWatchReport(registry, options = {}) {
  const selected = selectStudioCompetitors(registry, options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const results = await mapWithConcurrency(selected, concurrency, (product) =>
    inspectCompetitor(product, timeoutMs),
  );
  const okCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - okCount;
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    selectedCount: results.length,
    okCount,
    failedCount,
    aggregateHash: buildCompetitorFingerprint(results),
    results,
  };
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/gu, " ").trim();
}

export function renderStudioCompetitorWatchMarkdown(report) {
  const lines = [
    "<!-- studio-competitor-watch -->",
    "## Studio competitor source watch",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Sources: ${report.selectedCount}`,
    `- Reachable: ${report.okCount}`,
    `- Failed or blocked: ${report.failedCount}`,
    `- Aggregate: \`${report.aggregateHash}\``,
    "",
    "| Product | Category | Status | Page title / error | Last modified | Fingerprint |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];
  for (const result of report.results) {
    const status = result.ok ? `✅ ${result.status}` : `⚠️ ${result.status || result.errorCode}`;
    const title = result.ok ? result.title || "(no title)" : result.error || result.errorCode;
    lines.push(
      `| ${escapeMarkdown(result.name)} | ${escapeMarkdown(result.category)} | ${status} | ${escapeMarkdown(title)} | ${escapeMarkdown(result.lastModified || "-")} | \`${result.contentHash.slice(0, 12) || "-"}\` |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) { // NOSONAR javascript:S3776
  const options = {
    all: false,
    priorities: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    concurrency: DEFAULT_CONCURRENCY,
    output: null,
    markdown: null,
    registryPath: STUDIO_COMPETITOR_REGISTRY_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") {
      options.all = true;
    } else if (argument === "--priority") {
      options.priorities.push(argv[++index]); // NOSONAR javascript:S2310
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]); // NOSONAR javascript:S2310
    } else if (argument === "--concurrency") {
      options.concurrency = Number(argv[++index]); // NOSONAR javascript:S2310
    } else if (argument === "--output") {
      options.output = argv[++index]; // NOSONAR javascript:S2310
    } else if (argument === "--markdown") {
      options.markdown = argv[++index]; // NOSONAR javascript:S2310
    } else if (argument === "--registry") {
      options.registryPath = argv[++index]; // NOSONAR javascript:S2310
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) {
    throw new Error("--timeout-ms must be an integer between 1000 and 60000");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 12) {
    throw new Error("--concurrency must be an integer between 1 and 12");
  }
  for (const priority of options.priorities) {
    if (!["P0", "P1", "P2"].includes(priority)) {
      throw new Error(`Unsupported priority: ${priority}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const registryPath = path.resolve(process.cwd(), options.registryPath);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const issues = validateStudioCompetitorRegistry(registry);
  if (issues.length > 0) {
    const issueList = issues.map((issue) => " - " + issue).join("\n");
    throw new Error(`Registry is invalid:\n${issueList}`);
  }
  const report = await buildStudioCompetitorWatchReport(registry, options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderStudioCompetitorWatchMarkdown(report);
  if (options.output) fs.writeFileSync(path.resolve(options.output), json, "utf8");
  if (options.markdown) fs.writeFileSync(path.resolve(options.markdown), markdown, "utf8");
  if (!options.output && !options.markdown) process.stdout.write(markdown);
  console.error(
    `Competitor watch complete: ${report.okCount}/${report.selectedCount} reachable; aggregate ${report.aggregateHash}`,
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
