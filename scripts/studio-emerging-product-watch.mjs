#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildStudioCompetitorWatchReport,
  renderStudioCompetitorWatchMarkdown,
} from "./studio-competitor-watch.mjs";
import { validateStudioCompetitorRegistry } from "./validate-studio-competitor-registry.mjs";

export const STUDIO_EMERGING_PRODUCT_REGISTRY_PATH =
  "docs/benchmarks/studio-emerging-product-registry.json";

export function validateStudioEmergingProductRegistry(registry) {
  return validateStudioCompetitorRegistry(registry, {
    minimumProductCount: 1,
    requireEveryCategory: false,
  });
}

export function renderStudioEmergingProductWatchMarkdown(report) {
  return renderStudioCompetitorWatchMarkdown(report)
    .replace("<!-- studio-competitor-watch -->", "<!-- studio-emerging-product-watch -->")
    .replace("## Studio competitor source watch", "## Studio emerging-product source watch");
}

function parseArguments(argv) {
  const options = {
    output: null,
    markdown: null,
    registryPath: STUDIO_EMERGING_PRODUCT_REGISTRY_PATH,
    timeoutMs: 15_000,
    concurrency: 4,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      options.output = argv[++index]; // NOSONAR javascript:S2310
    } else if (argument === "--markdown") {
      options.markdown = argv[++index]; // NOSONAR javascript:S2310
    } else if (argument === "--registry") {
      options.registryPath = argv[++index]; // NOSONAR javascript:S2310
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]); // NOSONAR javascript:S2310
    } else if (argument === "--concurrency") {
      options.concurrency = Number(argv[++index]); // NOSONAR javascript:S2310
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
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const registryPath = path.resolve(process.cwd(), options.registryPath);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const issues = validateStudioEmergingProductRegistry(registry);
  if (issues.length > 0) {
    const issueList = issues.map((issue) => " - " + issue).join("\n");
    throw new Error(`Emerging-product registry is invalid:\n${issueList}`);
  }

  const report = await buildStudioCompetitorWatchReport(registry, {
    all: true,
    timeoutMs: options.timeoutMs,
    concurrency: options.concurrency,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderStudioEmergingProductWatchMarkdown(report);

  if (options.output) fs.writeFileSync(path.resolve(options.output), json, "utf8");
  if (options.markdown) fs.writeFileSync(path.resolve(options.markdown), markdown, "utf8");
  if (!options.output && !options.markdown) process.stdout.write(markdown);

  console.error(
    `Emerging-product watch complete: ${report.okCount}/${report.selectedCount} reachable; aggregate ${report.aggregateHash}`,
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
