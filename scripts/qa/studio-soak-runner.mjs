#!/usr/bin/env node

/**
 * Long-running Studio QA loop.
 * Product failures are recorded and de-duplicated, not allowed to terminate the loop.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const phase = process.env.SOAK_PHASE ?? "ux-persistence";
const durationMinutes = positiveInt(process.env.SOAK_DURATION_MINUTES, 310);
const repeatThreshold = positiveInt(process.env.SOAK_REPEAT_THRESHOLD, 2);
const autoFile = /^(1|true|yes)$/i.test(process.env.SOAK_AUTO_FILE_ISSUES ?? "true");
const root = resolve(process.env.SOAK_RESULTS_DIR ?? join("artifacts", "studio-soak", phase));
const deadline = Date.now() + durationMinutes * 60_000;
const startedAt = new Date();
const repo = process.env.GITHUB_REPOSITORY ?? "";
const githubToken = process.env.GITHUB_TOKEN ?? "";
const jiraBase = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");
const jiraEmail = process.env.JIRA_EMAIL ?? "";
const jiraToken = process.env.JIRA_API_TOKEN ?? "";
const jiraProject = process.env.JIRA_PROJECT_KEY ?? "KAN";
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const ansi = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\))`, "g");

const variants = [
  ["ko-seoul-light-motion", { TZ: "Asia/Seoul", TOONSPECTRUM_VERIFY_LOCALE: "ko-KR", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "light", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "no-preference" }],
  ["ko-seoul-dark-reduced", { TZ: "Asia/Seoul", TOONSPECTRUM_VERIFY_LOCALE: "ko-KR", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "dark", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "reduce" }],
  ["en-utc-light-reduced", { TZ: "UTC", TOONSPECTRUM_VERIFY_LOCALE: "en-US", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "light", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "reduce" }],
  ["en-utc-dark-motion", { TZ: "UTC", TOONSPECTRUM_VERIFY_LOCALE: "en-US", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "dark", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "no-preference" }],
];

const tests = {
  "ux-persistence": [
    t("inapp-route-matrix", "pnpm run verify:studio-inapp-browser", 46, "mobile-inapp"),
    t("cross-browser-route-matrix", "node scripts/qa/verify-studio-cross-browser-matrix.mjs", 34, "cross-browser"),
    t("mobile-top-matrix", "pnpm run verify:studio-mobile-top", 24, "mobile-layout"),
    t("studio-launch", "pnpm run verify:studio-launch", 22, "launch"),
    t("studio-lifecycle", "pnpm run verify:studio-lifecycle", 24, "lifecycle"),
    t("service-worker", "pnpm run verify:studio-service-worker", 22, "offline-cache"),
    t("artist-journey", "pnpm run verify:studio-artist-journey", 32, "journey"),
    t("autosave-opfs", "pnpm run verify:studio-autosave-opfs", 26, "persistence"),
    t("autosave-two-tab", "pnpm run verify:studio-autosave-two-tab", 28, "multi-tab"),
    t("menus", "pnpm run verify:studio-menus", 22, "menus"),
    t("canvas-chrome", "pnpm run verify:studio-canvas-chrome", 22, "canvas-ui"),
    t("canvas-surfaces", "pnpm run verify:studio-canvas-surfaces", 24, "canvas-ui"),
    t("companion", "pnpm run verify:studio-companion", 28, "companion"),
    t("inspector-walkthrough", "pnpm run verify:studio-inspector-walkthrough", 28, "inspector"),
    t("filter-dialog", "pnpm run verify:studio-filter-dialog", 22, "filters"),
    t("ux-task-benchmark", "pnpm run verify:studio-ux-task-benchmark", 28, "ux-performance"),
    t("groups", "pnpm run verify:studio-groups", 22, "groups"),
    t("icons", "pnpm run verify:studio-icons", 18, "accessibility"),
  ],
  "rendering-brush-3d": [
    t("bg3d-inapp-matrix", 'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-bg3d-inapp-editor', 42, "bg3d-inapp"),
    t("studio-3d-visual", 'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-3d-visual', 38, "bg3d-visual"),
    t("studio-brushes", "pnpm run verify:studio-brushes", 32, "brush"),
    t("brush-latency", "pnpm run verify:studio-brush-latency", 28, "brush-performance"),
    t("native-raster-tools", "pnpm run verify:studio-native-raster-tools", 30, "raster"),
    t("gpu-filters", "pnpm run verify:studio-gpu-filters", 28, "gpu-filter"),
    t("hokusai-live-integration", "pnpm run verify:studio-hokusai-live-integration", 30, "brush-hokusai"),
    t("living-ink-integration", "pnpm run verify:studio-living-ink-integration", 30, "living-ink"),
    t("hybrid-dcc-integration", "pnpm run verify:studio-hybrid-dcc-integration", 34, "hybrid-dcc"),
    t("p5-brush-runtime", "pnpm run verify:studio-p5-brush-real-runtime", 24, "brush-p5"),
    t("webgpu-brush-parity", "pnpm run verify:studio-engine-webgpu-brush-parity", 24, "webgpu"),
    t("webgpu-filter-parity", "pnpm run verify:studio-engine-webgpu-filter-parity", 24, "webgpu"),
    t("bg3d-physics", "pnpm run verify:studio-bg3d-physics", 28, "bg3d-physics"),
    t("studio-3d-console", "pnpm run verify:studio-3d-console", 24, "bg3d-console"),
    t("vello-candidate", "pnpm run verify:studio-vello-candidate", 26, "renderer-vello"),
    t("professional-bristle-webgpu", "pnpm run verify:studio-professional-bristle-webgpu", 24, "brush-webgpu"),
    t("dynamic-dual-tip-webgpu-v2", "pnpm run verify:studio-dynamic-dual-tip-webgpu-v2", 24, "brush-webgpu"),
    t("canvaskit-quality-worker", "pnpm run verify:studio-canvaskit-quality-worker", 24, "renderer-canvaskit"),
  ],
};

const knownJira = [
  ["KAN-11", /(menubar lane clips|전체 화면 드로잉 종료.*(offscreen|clipped)|게시하기.*(offscreen|clipped)|초안 저장.*clipped)/i],
  ["KAN-15", /(workspace-dialog.*did not open|작업공간.*(intercepts pointer events|다이얼로그.*열리지))/i],
  ["KAN-16", /(빠른 시작.*(offscreen|화면 밖)|말풍선·텍스트.*offscreen|웹툰 흐름으로 시작.*offscreen|컷 나누기.*offscreen|3D 배경 열기.*offscreen)/i],
  ["KAN-17", /(small (tap )?target.*(페이지 목록 열기|다운로드 2× PNG|1페이지 복제)|터치 영역.*(42\.0|36\.0))/i],
  ["KAN-18", /(unnamed control.*accent-accent|Lift3D.*접근성 이름|icon-only control without an accessible name)/i],
  ["KAN-14", /(Production migration manifest must list every numbered SQL migration|0035_creator_marketplace_3d_asset_kind)/i],
  ["KAN-13", /(studio-bg3d-dialog.*(Expected|Received)|캡처할 3D 장면이 아직 준비되지|컬러 배경 추가.*(완료되지|열린 채))/i],
  ["KAN-19", /(strict mode violation.*studio-central-3d-editor|studio-central-3d-editor.*resolved to \d+ elements|data-testid.*studio-central-3d-editor.*duplicate)/i],
  ["KAN-20", /(snapshot.*(missing|does not exist).*1440.*900|desktop-1440.*snapshot|visual.*baseline.*1440)/i],
];

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function t(id, command, timeout, category) { return { id, command, timeout, category }; }
function clean(value) { return value.replace(ansi, "").replace(/\s+/g, " ").trim(); }
function signature(value) {
  return clean(value)
    .replace(/\/home\/runner\/work\/[^\s"']+/g, "<repo-path>")
    .replace(/\/tmp\/[^\s"']+/g, "<tmp-path>")
    .replace(/rect=\[[^\]]+\]/gi, "rect=[<coords>]")
    .replace(/\bvw=\d+\b/gi, "vw=<width>")
    .replace(/\b\d+(?:\.\d+)?px\b/gi, "<px>")
    .replace(/\b(?:320|360|390|412|430|768|1440)(?:px)?\b/gi, "<width>")
    .replace(/\b\d+\s*[×x]\s*\d+\b/g, "<size>")
    .replace(/\b\d{5,}\b/g, "<id>")
    .slice(0, 1400);
}
function fingerprint(category, detail) {
  return createHash("sha256").update(`${category}\n${signature(detail)}`).digest("hex");
}
function severity(detail, timedOut) {
  if (timedOut || /(fatal|segmentation|out of memory|browser.*crash|data loss|corrupt)/i.test(detail)) return "critical";
  if (/(page error|console error|offscreen|clipped|did not open|timeout|blank viewport|insertion|삽입)/i.test(detail)) return "high";
  if (/(small (tap )?target|unnamed control|overflow|warn)/i.test(detail)) return "medium";
  return "low";
}
function titleFor(detail, testId) {
  const body = clean(detail).replace(/^(FAIL|warn):\s*/i, "").slice(0, 130);
  if (/offscreen/i.test(body)) return `${body.replace(/^offscreen control:\s*/i, "")} — 화면 밖 이탈`;
  if (/small (tap )?target/i.test(body)) return `${body.replace(/^small (tap )?target:\s*/i, "")} — 터치 영역 미달`;
  if (/unnamed control/i.test(body)) return `${body.replace(/^unnamed control:\s*/i, "")} — 접근성 이름 누락`;
  return `${testId}: ${body}`;
}
function knownFor(detail) { return knownJira.find(([, re]) => re.test(detail))?.[0] ?? null; } // NOSONAR javascript:S3800

async function run(testCase, variant, cycle) {
  const dir = join(root, `cycle-${String(cycle).padStart(3, "0")}`, variant[0]);
  await mkdir(dir, { recursive: true });
  const logPath = join(dir, `${testCase.id}.log`);
  const env = { ...process.env, ...variant[1], CI: "1", TOONSPECTRUM_VERIFY_DIR: join(dir, `${testCase.id}-evidence`) };
  delete env.JIRA_API_TOKEN;
  delete env.JIRA_EMAIL;
  const child = spawn("bash", ["-lc", testCase.command], { detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const collect = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    output = `${output}${text}`.slice(-360_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }, 8_000).unref();
  }, testCase.timeout * 60_000);
  const exitCode = await new Promise((resolveExit) => child.once("close", (code, signal) => resolveExit(code ?? (signal ? 128 : 1))));
  clearTimeout(timer);
  await writeFile(logPath, output, "utf8");
  return { output, exitCode, timedOut, logPath };
}

function findingsFrom(testCase, variant, cycle, result) {
  const lines = result.output.replace(ansi, "").split(/\r?\n/);
  const candidates = [];
  for (const line of lines) {
    const match = line.match(/^\[(verify-[^\]]+|soak)\]\s*(.*?)\s+(FAIL|warn):\s*(.+)$/i);
    if (match) candidates.push({ scope: match[2], level: match[3].toLowerCase(), detail: match[4] });
  }
  if (result.timedOut) candidates.push({ scope: testCase.id, level: "FAIL", detail: `test timed out after ${testCase.timeout} minutes` });
  if (result.exitCode !== 0 && candidates.length === 0) {
    const tail = clean(lines.slice(-20).join(" ")) || `command exited ${result.exitCode}`;
    candidates.push({ scope: testCase.id, level: "FAIL", detail: tail });
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const detail = `${candidate.scope}: ${candidate.detail}`;
    const fp = fingerprint(testCase.category, detail);
    if (!unique.has(fp)) unique.set(fp, {
      category: testCase.category,
      commandId: testCase.id,
      cycle,
      detail: clean(candidate.detail).slice(0, 2500),
      fingerprint: fp,
      knownJira: knownFor(detail),
      logPath: result.logPath,
      observedAt: new Date().toISOString(),
      scope: clean(candidate.scope),
      severity: severity(detail, result.timedOut),
      title: titleFor(candidate.detail, testCase.id),
      variant: variant[0],
    });
  }
  return [...unique.values()];
}

async function github(path, options = {}) {
  if (!githubToken || !repo) throw new Error("GitHub issue filing is not configured");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2022-11-28", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${text.slice(0, 500)}`);
  return payload;
}
async function jira(path, options = {}) {
  if (!jiraBase || !jiraEmail || !jiraToken) throw new Error("Jira issue filing is not configured");
  const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString("base64");
  const response = await fetch(`${jiraBase}${path}`, {
    ...options,
    headers: { Accept: "application/json", Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Jira API ${response.status}: ${text.slice(0, 500)}`);
  return payload;
}
function markdown(record) {
  const examples = record.examples.slice(-5).map((x) => `- ${x.observedAt} / ${x.variant} / cycle ${x.cycle}: ${x.scope} — ${x.detail}`).join("\n");
  return `<!-- studio-soak-fingerprint:${record.fingerprint} -->\n## 자동 장시간 QA에서 반복 재현됨\n\n- Phase: \`${phase}\`\n- Category: \`${record.category}\`\n- Severity: **${record.severity}**\n- Reproductions: **${record.count}**\n- Commit: \`${process.env.GITHUB_SHA ?? "unknown"}\`\n- Workflow run: \`${process.env.GITHUB_RUN_ID ?? "local"}\`\n- Fingerprint: \`${record.fingerprint}\`\n\n## 관찰 예시\n${examples}\n\n## 기대 결과\n해당 기능이 지원 브라우저·뷰포트·렌더러 조합에서 오류 없이 완료되고, 컨트롤이 표시·조작 가능해야 합니다.\n\n## 실제 결과\n위 조건에서 동일 정규화 fingerprint가 반복 검출되었습니다. 원본 로그와 스크린샷은 workflow artifact에 포함됩니다.\n\n## 완료 조건\n- [ ] 재현 조합에서 문제가 더 이상 발생하지 않는다.\n- [ ] 관련 회귀 테스트가 통과한다.\n- [ ] 인접 브라우저·뷰포트·렌더러 조합에 회귀가 없다.\n`;
}
function adf(record) {
  return { type: "doc", version: 1, content: markdown(record).split("\n").filter(Boolean).map((text) => ({ type: "paragraph", content: [{ type: "text", text: text.slice(0, 3000) }] })) };
}
async function fileIssue(record) { // NOSONAR javascript:S3776
  if (!autoFile || record.knownJira || record.tracker) return;
  const label = `qa-soak-${record.fingerprint.slice(0, 16)}`;
  try {
    if (jiraBase && jiraEmail && jiraToken) {
      const q = new URLSearchParams({ jql: `project = ${jiraProject} AND labels = "${label}"`, maxResults: "1", fields: "summary" });
      let existing = [];
      try { existing = (await jira(`/rest/api/3/search/jql?${q}`)).issues ?? []; } catch { existing = (await jira(`/rest/api/3/search?${q}`)).issues ?? []; }
      if (existing[0]) record.tracker = { type: "jira", key: existing[0].key, created: false };
      else {
        const issue = await jira("/rest/api/3/issue", { method: "POST", body: JSON.stringify({ fields: { project: { key: jiraProject }, issuetype: { name: "버그" }, summary: `[QA-SOAK][${record.category}] ${record.title}`.slice(0, 250), description: adf(record), labels: ["qa-soak", "automated", label] } }) });
        record.tracker = { type: "jira", key: issue.key, created: true };
      }
    } else {
      const query = encodeURIComponent(`repo:${repo} is:issue in:body "studio-soak-fingerprint:${record.fingerprint}"`);
      const existing = (await github(`/search/issues?q=${query}&per_page=1`)).items?.[0];
      if (existing) record.tracker = { type: "github", key: `#${existing.number}`, created: false };
      else {
        const issue = await github(`/repos/${repo}/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `[QA-SOAK][${record.category}] ${record.title}`.slice(0, 250), body: markdown(record) }) });
        record.tracker = { type: "github", key: `#${issue.number}`, created: true };
      }
    }
    console.log(`[soak] tracker ${record.tracker.created ? "created" : "reused"}: ${record.tracker.type} ${record.tracker.key}`);
  } catch (error) {
    record.filingErrors.push({ at: new Date().toISOString(), message: String(error) });
    console.error(`[soak] issue filing failed: ${error}`);
  }
}

function mergeSeverity(a, b) {
  const order = ["low", "medium", "high", "critical"];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}
async function summarize(records, executions, infra) {
  const findings = [...records.values()].sort((a, b) => b.count - a.count);
  const data = { phase, configuredDurationMinutes: durationMinutes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), wallClockMinutes: Number(((Date.now() - startedAt.getTime()) / 60000).toFixed(2)), executionCount: executions.length, executions, findings, infrastructureErrors: infra };
  await writeFile(join(root, "summary.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  const rows = findings.map((x) => `| ${x.severity} | ${x.count} | ${x.knownJira ?? x.tracker?.key ?? "pending"} | ${x.title.replace(/\|/g, "\\|")} | \`${x.fingerprint.slice(0, 12)}\` |`);
  const md = [`# Studio soak QA — ${phase}`, "", `- Configured: ${durationMinutes} minutes`, `- Actual: ${data.wallClockMinutes} minutes`, `- Executions: ${executions.length}`, `- Unique findings: ${findings.length}`, "", "| Severity | Count | Tracker | Finding | Fingerprint |", "|---|---:|---|---|---|", ...(rows.length ? rows : ["| - | 0 | - | No findings | - |"]), ""].join("\n");
  await writeFile(join(root, "summary.md"), md, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md, "utf8");
}

async function main() { // NOSONAR javascript:S3776
  const suite = tests[phase];
  if (!suite) throw new Error(`Unknown phase: ${phase}`);
  await mkdir(root, { recursive: true });
  const records = new Map();
  const executions = [];
  const infra = [];
  console.log(`[soak] phase=${phase} duration=${durationMinutes}m tests=${suite.length} threshold=${repeatThreshold}`);
  let index = 0;
  let cycle = 1;
  while (Date.now() < deadline - 120_000) {
    const testCase = suite[index % suite.length];
    const variant = variants[index % variants.length];
    const began = new Date();
    try {
      const result = await run(testCase, variant, cycle);
      executions.push({ test: testCase.id, variant: variant[0], cycle, startedAt: began.toISOString(), finishedAt: new Date().toISOString(), exitCode: result.exitCode, timedOut: result.timedOut, logPath: result.logPath });
      for (const finding of findingsFrom(testCase, variant, cycle, result)) {
        await appendFile(join(root, "findings.ndjson"), `${JSON.stringify(finding)}\n`, "utf8");
        const record = records.get(finding.fingerprint) ?? { category: finding.category, commandId: finding.commandId, count: 0, examples: [], filingErrors: [], fingerprint: finding.fingerprint, knownJira: finding.knownJira, severity: finding.severity, title: finding.title, tracker: null };
        record.count += 1;
        record.severity = mergeSeverity(record.severity, finding.severity);
        record.knownJira ||= finding.knownJira;
        record.examples.push(finding);
        record.examples = record.examples.slice(-20);
        records.set(record.fingerprint, record);
        console.log(`[soak] finding count=${record.count} severity=${record.severity} known=${record.knownJira ?? "no"} fp=${record.fingerprint.slice(0, 12)} ${record.title}`);
        if (record.count >= repeatThreshold || record.severity === "critical") await fileIssue(record);
      }
    } catch (error) {
      infra.push({ at: new Date().toISOString(), test: testCase.id, cycle, message: String(error?.stack ?? error) });
      console.error(`[soak] infrastructure error: ${error?.stack ?? error}`);
    }
    await summarize(records, executions, infra);
    index += 1;
    if (index % suite.length === 0) cycle += 1;
  }
  for (const record of records.values()) if (record.count >= repeatThreshold || record.severity === "critical") await fileIssue(record);
  await summarize(records, executions, infra);
  console.log(`[soak] COMPLETE phase=${phase} executions=${executions.length} uniqueFindings=${records.size}`);
}

main().catch(async (error) => {
  console.error(error?.stack ?? error);
  await mkdir(root, { recursive: true }).catch(() => undefined);
  await writeFile(join(root, "fatal.json"), JSON.stringify({ at: new Date().toISOString(), error: String(error?.stack ?? error), phase }, null, 2)).catch(() => undefined);
  process.exitCode = 2;
});
