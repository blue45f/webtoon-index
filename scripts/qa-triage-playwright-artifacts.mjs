import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const inputRoot = path.resolve(process.argv[2] ?? "artifact-input");
const outputFile = path.resolve(
  process.argv[3] ?? "qa-results/extended-matrix-artifact-summary.md",
);
const decodedRoot = path.join(inputRoot, ".decoded-playwright-reports");
const MAX_TEXT_BYTES = 12 * 1024 * 1024;
const MAX_SNIPPETS = 700;

const textExtensions = new Set([
  ".json",
  ".jsonl",
  ".md",
  ".txt",
  ".log",
  ".xml",
  ".yaml",
  ".yml",
  ".csv",
]);
const specialNames = new Set([
  "error-context.md",
  ".last-run.json",
  "results.json",
  "result.json",
  "summary.json",
  "report.json",
  "report.md",
]);
const signalPatterns = [
  /(?:^|\b)(?:FAIL(?:ED|URE)?|ERROR|Error:|Timeout|Timed out|Expected:|Received:|locator|assert(?:ion)?)(?:\b|:)/iu,
  /(?:^|\b)(?:mismatch|panic|uncaught|pageerror|requestfailed|offscreen|clipped|overflow|blank screen|WebGL|WebGPU|aria-modal|accessible name|not found|not visible|did not open|outside viewport)(?:\b|:)/iu,
];
const hasSignal = (value) => signalPatterns.some((pattern) => pattern.test(value));
const ignorablePattern = /$^/u;

function rel(file) {
  return path.relative(inputRoot, file).replaceAll(path.sep, "/");
}

function redact(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/giu, "$1[REDACTED]")
    .replace(/((?:password|secret|token|cookie|session(?:Id|Token)?)\s*["'=:\s]+)[^\s,"'}]+/giu, "$1[REDACTED]")
    .replace(/(toonspectrum-auth-session=)[^;\s]+/giu, "$1[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{45,}\b/gu, (match) => `[LONG_VALUE:${match.length}]`);
}

function compact(value, max = 1_200) {
  return redact(value).replace(/\s+/gu, " ").trim().slice(0, max);
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function walk(root) {
  const files = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  await visit(root);
  return files;
}

async function decodePlaywrightHtmlReports(files) {
  await mkdir(decodedRoot, { recursive: true });
  const decoded = [];
  let index = 0;
  for (const file of files) {
    if (path.basename(file) !== "index.html" || !/playwright-report/iu.test(rel(file))) continue;
    const size = (await stat(file)).size;
    if (size > 150 * 1024 * 1024) continue;
    const html = await readFile(file, "utf8").catch(() => "");
    const match = html.match(
      /<script[^>]+id=["']playwrightReportBase64["'][^>]*>\s*data:application\/zip;base64,([a-z0-9+/=\r\n]+)\s*<\/script>/iu,
    );
    if (!match) continue;
    const targetDir = path.join(decodedRoot, `${String(index).padStart(3, "0")}-${fingerprint(rel(file))}`);
    const zipFile = `${targetDir}.zip`;
    await mkdir(targetDir, { recursive: true });
    await writeFile(zipFile, Buffer.from(match[1].replace(/\s+/gu, ""), "base64"));
    const unzip = spawnSync("unzip", ["-q", "-o", zipFile, "-d", targetDir], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    decoded.push({
      source: rel(file),
      target: rel(targetDir),
      status: unzip.status,
      stderr: compact(unzip.stderr, 600),
    });
    index += 1;
  }
  return decoded;
}

function recursivelyCollectFailures(value, source, out, pointer = "$", depth = 0) { // NOSONAR javascript:S3776
  if (depth > 12 || out.length >= MAX_SNIPPETS) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      recursivelyCollectFailures(value[index], source, out, `${pointer}[${index}]`, depth + 1);
      if (out.length >= MAX_SNIPPETS) return;
    }
    return;
  }
  if (!value || typeof value !== "object") return;

  const object = value;
  const title = object.title ?? object.name ?? object.testId ?? object.id ?? object.case ?? object.command;
  const status = object.status ?? object.outcome ?? object.conclusion ?? object.state;
  const passed = object.passed ?? object.ok ?? object.success;
  const error = object.error ?? object.errors ?? object.failure ?? object.message ?? object.stderr;
  const negativeStatus = typeof status === "string" && /fail|error|timedout|timeout|unexpected|broken/iu.test(status);
  const negativeBoolean = passed === false;
  const errorSignal = typeof error === "string" && hasSignal(error) && !ignorablePattern.test(error);
  const errorArray = Array.isArray(error) && error.length > 0;

  if (negativeStatus || negativeBoolean || errorSignal || errorArray) {
    const snapshot = compact(JSON.stringify({ title, status, passed, error }), 1_800);
    if (snapshot) {
      out.push({
        source,
        pointer,
        fingerprint: fingerprint(snapshot),
        text: snapshot,
      });
    }
  }

  for (const [key, child] of Object.entries(object)) {
    if (["attachments", "stdout", "stderr", "image", "buffer", "body"].includes(key) && typeof child !== "string") continue;
    recursivelyCollectFailures(child, source, out, `${pointer}.${key}`, depth + 1);
    if (out.length >= MAX_SNIPPETS) return;
  }
}

async function scanFiles(files) { // NOSONAR javascript:S3776
  const contexts = [];
  const jsonFailures = [];
  const signalLines = [];
  const inventory = [];

  for (const file of files) {
    const relative = rel(file);
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    inventory.push({ file: relative, bytes: info.size });

    const extension = path.extname(file).toLowerCase();
    const special = specialNames.has(path.basename(file));
    if ((!textExtensions.has(extension) && !special) || info.size > MAX_TEXT_BYTES) continue;

    const content = await readFile(file, "utf8").catch(() => "");
    if (!content || content.slice(0, 4_000).includes(String.fromCharCode(0))) continue;

    if (special || /error-context|failure|failed|summary|result/iu.test(relative)) {
      const trimmed = compact(content, 10_000);
      if (trimmed) contexts.push({ source: relative, fingerprint: fingerprint(trimmed), text: trimmed });
    }

    if (extension === ".json" || path.basename(file).endsWith(".json")) {
      try {
        recursivelyCollectFailures(JSON.parse(content), relative, jsonFailures);
      } catch {
        // Some Playwright artifacts are JSONL or partial JSON; line scan below still applies.
      }
    }

    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (signalLines.length >= MAX_SNIPPETS) break;
      const line = compact(lines[index], 1_600);
      if (!line || line.length > 1_500 || ignorablePattern.test(line) || !hasSignal(line)) continue;
      signalLines.push({
        source: relative,
        line: index + 1,
        fingerprint: fingerprint(line),
        text: line,
      });
    }
  }

  return { contexts, jsonFailures, signalLines, inventory };
}

function dedupe(items, key) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(item);
  }
  return output;
}

function artifactName(relative) {
  return relative.split("/")[0] || "root";
}

function formatBytes(bytes) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

async function main() {
  const originalFiles = await walk(inputRoot);
  const decodedReports = await decodePlaywrightHtmlReports(originalFiles);
  const allFiles = await walk(inputRoot);
  const { contexts, jsonFailures, signalLines, inventory } = await scanFiles(allFiles);

  const uniqueContexts = dedupe(contexts, (item) => `${item.source}:${item.fingerprint}`).slice(0, 100);
  const uniqueJsonFailures = dedupe(jsonFailures, (item) => `${item.source}:${item.pointer}:${item.fingerprint}`).slice(0, 300);
  const uniqueSignals = dedupe(signalLines, (item) => `${item.source}:${item.fingerprint}`).slice(0, 300);

  const artifactStats = new Map();
  for (const item of inventory) {
    const artifact = artifactName(item.file);
    const current = artifactStats.get(artifact) ?? { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += item.bytes;
    artifactStats.set(artifact, current);
  }

  const lines = [
    "# Extended Studio QA artifact triage",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Input root: \`${inputRoot}\``,
    `- Files scanned: ${inventory.length}`,
    `- Embedded Playwright reports decoded: ${decodedReports.length}`,
    `- Failure-context files: ${uniqueContexts.length}`,
    `- Structured negative records: ${uniqueJsonFailures.length}`,
    `- Unique signal lines: ${uniqueSignals.length}`,
    "",
    "## Artifact inventory",
    "",
    "| Artifact | Files | Approx. size |",
    "|---|---:|---:|",
    ...[...artifactStats.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `| \`${name}\` | ${value.files} | ${formatBytes(value.bytes)} |`),
    "",
    "## Decoded Playwright reports",
    "",
    ...(decodedReports.length
      ? decodedReports.map((item) =>
          `- \`${item.source}\` → \`${item.target}\` — exit ${item.status}${item.stderr ? " — " + item.stderr : ""}`
        )
      : ["- No embedded report ZIPs were detected."]),
    "",
    "## Structured failure records",
    "",
    ...(uniqueJsonFailures.length
      ? uniqueJsonFailures.map((item) =>
          `- **${item.fingerprint}** \`${item.source}\` \`${item.pointer}\` — ${item.text}`
        )
      : ["- No structured negative records found."]),
    "",
    "## Failure and error contexts",
    "",
    ...(uniqueContexts.length
      ? uniqueContexts.map((item) =>
          `### ${item.fingerprint} — \`${item.source}\`\n\n${item.text}\n`
        )
      : ["- No dedicated failure context files found."]),
    "",
    "## Unique signal lines",
    "",
    ...(uniqueSignals.length
      ? uniqueSignals.map((item) =>
          `- **${item.fingerprint}** \`${item.source}:${item.line}\` — ${item.text}`
        )
      : ["- No matching signal lines found."]),
    "",
    "## Notes",
    "",
    "- This report extracts evidence; it does not automatically classify every test failure as a product bug.",
    "- Setup errors, unsupported CI GPU paths, stale snapshots, and incorrect test expectations require separate triage.",
    "- Long credential-like values are redacted before this file is committed.",
    "",
  ];

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${lines.join("\n")}\n`);
  console.log(`Wrote ${outputFile}`);
  console.log(`Structured failures: ${uniqueJsonFailures.length}`);
  console.log(`Contexts: ${uniqueContexts.length}`);
  console.log(`Signals: ${uniqueSignals.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
