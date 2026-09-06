#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  evaluateStudioAiQualityRun,
  formatStudioAiQualityEvaluationMarkdown,
  type StudioAiQualityRun,
} from "../apps/web/src/domains/creator/ai/studio-ai-quality-benchmark";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = argument("--input") ?? process.argv[2];
const reportPath = argument("--report");

if (!inputPath) {
  console.error(
    "Usage: pnpm exec tsx scripts/verify-studio-ai-quality.mts --input <run.json> [--report <report.md>]"
  );
  process.exit(2);
}

let run: StudioAiQualityRun;
try {
  run = JSON.parse(await readFile(resolve(inputPath), "utf8")) as StudioAiQualityRun;
} catch (error) {
  console.error(
    `Studio AI quality input could not be read: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(2);
}

const evaluation = evaluateStudioAiQualityRun(run);
const markdown = formatStudioAiQualityEvaluationMarkdown(run, evaluation);

if (reportPath) {
  await writeFile(resolve(reportPath), markdown, "utf8");
}
process.stdout.write(markdown);

process.exitCode = evaluation.passed ? 0 : 1;
