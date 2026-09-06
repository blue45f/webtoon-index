#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SUITE = process.env.QA_SUITE ?? "ui-inapp";
const REQUESTED_CASES = Object.freeze(
  (process.env.QA_CASE ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const CASE_PATTERN = (() => {
  const source = (process.env.QA_CASE_PATTERN ?? "").trim();
  if (!source) return null;
  try {
    return new RegExp(source, "u");
  } catch (error) {
    throw new Error(
      `Invalid QA_CASE_PATTERN ${JSON.stringify(source)}: ${String(error)}`,
      { cause: error },
    );
  }
})();
const ROOT = path.resolve(
  process.env.QA_RESULTS_DIR ?? `qa-results/studio-chromium-inapp/${SUITE}`,
);
const EVIDENCE_ROOT = path.resolve(
  process.env.QA_EVIDENCE_DIR ?? `artifacts/studio-chromium-inapp/${SUITE}`,
);
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL ?? "").replace(/\/+$/u, "");
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY ?? "KAN";
const JIRA_EMAIL = process.env.JIRA_EMAIL ?? "";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? "";
const JIRA_ASSIGNEE_ACCOUNT_ID = process.env.JIRA_ASSIGNEE_ACCOUNT_ID ?? "";
const GITHUB_RUN_URL = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "local";
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\))`, "gu");

const SUITES = Object.freeze({
  "ui-inapp": [
    command("inapp-route-matrix", "pnpm run verify:studio-inapp-browser", 18, "in-app-browser"),
    command("mobile-top", "pnpm run verify:studio-mobile-top", 15, "mobile-ui"),
    command("studio-lifecycle", "pnpm run verify:studio-lifecycle", 15, "lifecycle"),
    command("service-worker", "pnpm run verify:studio-service-worker", 15, "service-worker"),
    command("autosave-opfs", "pnpm run verify:studio-autosave-opfs", 18, "persistence"),
    command("autosave-two-tab", "pnpm run verify:studio-autosave-two-tab", 18, "multi-tab"),
    command(
      "community-market-deeplink",
      "pnpm exec playwright test --config playwright.market.config.ts --grep '스튜디오 마켓 딥링크 진입 시 커뮤니티 탭이 활성화된다|스튜디오에서 마켓 리소스를 설치'",
      22,
      "asset-marketplace",
    ),
  ],
  "3d-inapp": [
    command(
      "bg3d-inapp",
      'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-bg3d-inapp-editor',
      22,
      "bg3d-inapp",
    ),
    command(
      "studio-3d-visual",
      'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-3d-visual',
      30,
      "bg3d-visual",
    ),
    command("bg3d-engine-selection", "pnpm run verify:studio-bg3d-webgpu-engine", 18, "bg3d-engine"),
    command("bg3d-physics", "pnpm run verify:studio-bg3d-physics", 18, "bg3d-physics"),
    command(
      "studio-3d-console",
      'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-3d-console',
      22,
      "bg3d-console",
    ),
  ],
  "brush-raster": [
    command("studio-brushes", "pnpm run verify:studio-brushes", 30, "brush"),
    command("brush-latency", "pnpm run verify:studio-brush-latency", 35, "brush-latency"),
    command("living-ink-integration", "pnpm run verify:studio-living-ink-integration", 22, "living-ink"),
    command("native-raster-tools", "pnpm run verify:studio-native-raster-tools", 35, "raster-tools"),
    command("filter-dialog", "pnpm run verify:studio-filter-dialog", 25, "filter-dialog"),
    command(
      "webgpu-brush-parity",
      'TOONSPECTRUM_WEBGPU_HEADED=1 xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-engine-webgpu-brush-parity',
      20,
      "webgpu-brush",
    ),
    command(
      "professional-bristle",
      'TOONSPECTRUM_WEBGPU_HEADED=1 xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-professional-bristle-webgpu',
      20,
      "webgpu-bristle",
    ),
  ],
});

const KNOWN_JIRA = Object.freeze([
  ["KAN-2", /컬러 배경 추가|캡처할 3D 장면이 아직 준비되지|studio-bg3d-dialog.*expected.*0/iu],
  ["KAN-11", /menubar|게시하기.*(offscreen|clipped|화면 밖)|전체 화면 드로잉 종료.*(offscreen|clipped|화면 밖)|초안 저장.*clipped/iu],
  ["KAN-15", /workspace-dialog.*did not open|작업공간.*(intercepts pointer events|다이얼로그.*열리지|covered)/iu],
  ["KAN-16", /빠른 시작.*(offscreen|화면 밖)|말풍선.*offscreen|웹툰 흐름.*offscreen|컷 나누기.*offscreen|3D 배경 열기.*offscreen/iu],
  ["KAN-17", /small (tap )?target|터치 영역.*(42|36)|smaller than 44/iu],
  ["KAN-18", /Lift3D.*접근성 이름|unnamed control.*accent-accent|range.*accessible name/iu],
  ["KAN-19", /studio-central-3d-editor.*(resolved to 2|duplicate|strict mode)/iu],
  ["KAN-29", /원기둥 추가.*프레임이 바뀌지|cylinder.*frame.*(unchanged|did not change)/iu],
  ["KAN-33", /text\/html.*JavaScript MIME|stale.*chunk|새 버전이 준비됐습니다/iu],
  ["KAN-47", /Living Ink.*(granulation|ellipse|axis|fiber)|sumi-atmosphere|cai-wei-fiber/iu],
  ["KAN-48", /living-ink-controls|living-ink-system unavailable/iu],
  ["KAN-49", /device-lost.*fencing|runtime became device-lost|Device lost during dispatch/iu],
  ["KAN-50", /runtime submission 1 did not complete.*bristle|professional-bristle.*did not complete/iu],
  ["KAN-51", /initial present.*false|initial present failed|present unexpectedly reported rejection/iu],
  ["KAN-52", /Clarity|Stylize|Line Cleanup.*changedPixels.*0|studio-filter-dialog-title.*timeout/iu],
  ["KAN-53", /native-raster-tools|tool did not become aria-pressed|pixel-transform.*scenario did not complete/iu],
  ["KAN-54", /backing surface|allocated backing.*3|retained too many active backing/iu],
  ["KAN-55", /brush library after 3 attempt|canvas.*0x0|width or height of 0|observedCases.*0/iu],
  ["KAN-56", /studio-bg3d-canvas.*45|3D.*canvas.*not.*visible|could not drive the 3D editor/iu],
  ["KAN-57", /capable standalone browser was not promoted|blocked in-app browser was allowed|WebGL-only feature did not pin/iu],
  ["KAN-58", /assetMarket=community|community-marketplace.*not.*visible|커뮤니티 탭.*timeout/iu],
  ["KAN-59", /duplicated-reference-project|Duplicated reference revision/iu],
  ["KAN-60", /VRM texture paint 3D viewport did not render a frame/iu],
]);

function command(id, shell, timeoutMinutes, category) {
  return { id, shell, timeoutMinutes, category };
}

function clean(value) {
  return value.replace(ANSI, "").replace(/\r/gu, "").trim();
}

function normalise(value) {
  return clean(value)
    .replace(/\/home\/runner\/work\/[^\s"']+/gu, "<repo-path>")
    .replace(/\/tmp\/[^\s"']+/gu, "<tmp-path>")
    .replace(/127\.0\.0\.1:\d+/gu, "127.0.0.1:<port>")
    .replace(/\b\d{5,}\b/gu, "<id>")
    .replace(/\b\d+(?:\.\d+)?px\b/giu, "<px>")
    .replace(/rect=\[[^\]]+\]/giu, "rect=[<coords>]")
    .slice(0, 6_000);
}

function fingerprint(category, value) {
  return createHash("sha256").update(`${category}\n${normalise(value)}`).digest("hex");
}

function knownJiraFor(value) { // NOSONAR javascript:S3800
  return KNOWN_JIRA.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processGroupExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalProcessGroup(pid, signal) {
  if (!processGroupExists(pid)) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await sleep(100);
  }
  return !processGroupExists(pid);
}

/**
 * Every verifier is launched in a dedicated process group. Vite preview, Xvfb and Chromium can
 * outlive their shell after an otherwise successful command, so cleanup is mandatory on both
 * success and failure; only cleaning on timeout slowly exhausts the runner's RAM/GPU resources.
 */
async function terminateProcessGroup(pid, reason, graceMilliseconds = 2_000) {
  if (!processGroupExists(pid)) return;
  console.log(`[chromium-inapp-suite] CLEANUP pid=${pid} reason=${reason}`);
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForProcessGroupExit(pid, graceMilliseconds)) return;
  console.warn(`[chromium-inapp-suite] FORCE CLEANUP pid=${pid} reason=${reason}`);
  signalProcessGroup(pid, "SIGKILL");
  await waitForProcessGroupExit(pid, 2_000);
}

function selectCases(suite) {
  const requested = new Set(REQUESTED_CASES);
  const selected = suite.filter((testCase) => {
    if (requested.size > 0 && !requested.has(testCase.id)) return false;
    return !CASE_PATTERN || CASE_PATTERN.test(testCase.id);
  });
  if (selected.length === 0) {
    const available = suite.map((testCase) => testCase.id).join(", ");
    throw new Error(
      `No QA cases selected for suite ${SUITE}; QA_CASE=${JSON.stringify(REQUESTED_CASES.join(","))} ` +
        `QA_CASE_PATTERN=${JSON.stringify(CASE_PATTERN?.source ?? "")} available=[${available}]`,
    );
  }
  const missing = REQUESTED_CASES.filter((id) => !suite.some((testCase) => testCase.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown QA_CASE for suite ${SUITE}: ${missing.join(", ")}`);
  }
  return selected;
}

function tailForIssue(output, lines = 35) {
  const cleaned = clean(output);
  return cleaned.split("\n").slice(-lines).join("\n").slice(-12_000);
}

async function runCommand(testCase) {
  const caseDir = path.join(EVIDENCE_ROOT, testCase.id);
  await mkdir(caseDir, { recursive: true });
  const logPath = path.join(ROOT, `${testCase.id}.log`);
  const startedAt = new Date();
  const env = {
    ...process.env,
    CI: "1",
    TOONSPECTRUM_VERIFY_DIR: caseDir,
  };
  delete env.JIRA_API_TOKEN;
  delete env.JIRA_EMAIL;

  const child = spawn("bash", ["-lc", testCase.shell], {
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    output = `${output}${text}`.slice(-1_000_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  let timedOut = false;
  let timeoutCleanup = Promise.resolve();
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutCleanup = terminateProcessGroup(child.pid, `timeout:${testCase.id}`, 10_000);
  }, testCase.timeoutMinutes * 60_000);

  const exitCode = await new Promise((resolve) => {
    child.once("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
  clearTimeout(timer);
  await timeoutCleanup;
  await terminateProcessGroup(child.pid, `completed:${testCase.id}`);
  await writeFile(logPath, output, "utf8");

  const detail = timedOut
    ? `Timed out after ${testCase.timeoutMinutes} minutes.\n${tailForIssue(output)}`
    : tailForIssue(output);
  return {
    id: testCase.id,
    category: testCase.category,
    command: testCase.shell,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationSeconds: Number(((Date.now() - startedAt.getTime()) / 1_000).toFixed(1)),
    exitCode,
    timedOut,
    ok: exitCode === 0 && !timedOut,
    logPath: path.relative(process.cwd(), logPath),
    evidencePath: path.relative(process.cwd(), caseDir),
    detail,
  };
}

function adfFromMarkdown(markdown) {
  return {
    type: "doc",
    version: 1,
    content: markdown
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line.slice(0, 3_000) }],
      })),
  };
}

async function jiraRequest(endpoint, options = {}) {
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error("Jira REST credentials are not configured in GitHub Actions secrets");
  }
  const response = await fetch(`${JIRA_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(JIRA_EMAIL + ":" + JIRA_API_TOKEN).toString("base64")}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Jira API ${response.status}: ${text.slice(0, 1_000)}`);
  }
  return payload;
}

async function assignJira(issueKey) {
  if (!JIRA_ASSIGNEE_ACCOUNT_ID) return;
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({
      fields: { assignee: { accountId: JIRA_ASSIGNEE_ACCOUNT_ID } },
    }),
  });
}

async function addJiraComment(issueKey, result, fp) {
  const marker = `qa-chromium-inapp:${process.env.GITHUB_RUN_ID ?? "local"}:${SUITE}:${result.id}`;
  const body = [
    `<!-- ${marker} -->`,
    "## Chromium/인앱브라우저 전용 회귀 실행 업데이트",
    "",
    `- 실행: ${GITHUB_RUN_URL}`,
    `- Suite: \`${SUITE}\``,
    `- Case: \`${result.id}\``,
    `- Category: \`${result.category}\``,
    `- Browser scope: Chromium/Chrome 및 Chromium 기반 UA·viewport 인앱 에뮬레이션만`,
    `- 물리 앱 WebView 검증: 수행하지 않음`,
    `- 종료 코드: \`${result.exitCode}\``,
    `- Timeout: \`${result.timedOut}\``,
    `- Fingerprint: \`${fp}\``,
    "",
    "### 최신 오류 요약",
    "",
    "```text",
    result.detail.slice(-8_000),
    "```",
    "",
    `증거 경로: \`${result.evidencePath}\`, 로그: \`${result.logPath}\``,
  ].join("\n");
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: adfFromMarkdown(body) }),
  });
  await assignJira(issueKey);
}

async function findOrCreateJira(result, fp) {
  const label = `qa-chromium-${fp.slice(0, 16)}`;
  const jql = `project = ${JIRA_PROJECT_KEY} AND labels = "${label}"`;
  const query = new URLSearchParams({ jql, maxResults: "1", fields: "summary" });
  let searchResult;
  try {
    searchResult = await jiraRequest(`/rest/api/3/search/jql?${query}`);
  } catch {
    searchResult = await jiraRequest(`/rest/api/3/search?${query}`);
  }
  const existing = searchResult?.issues?.[0];
  if (existing?.key) {
    await addJiraComment(existing.key, result, fp);
    return { key: existing.key, created: false };
  }

  const description = [
    "## 자동 Chromium/인앱브라우저 회귀에서 신규 실패 지문 검출",
    "",
    `- 실행: ${GITHUB_RUN_URL}`,
    `- Suite: \`${SUITE}\``,
    `- Case: \`${result.id}\``,
    `- Category: \`${result.category}\``,
    `- Fingerprint: \`${fp}\``,
    `- 범위: Chrome/Chromium과 Chromium UA 기반 인앱브라우저 에뮬레이션`,
    `- 실제 물리 WebView 검증: 미수행`,
    "",
    "## 실제 결과",
    "",
    "```text",
    result.detail.slice(-10_000),
    "```",
    "",
    "## 기대 결과",
    "",
    "해당 Chrome/인앱 프로필에서 기능이 오류 없이 완료되고 사용자 조작과 시각 결과가 정상이어야 합니다.",
    "",
    "## 완료 조건",
    "",
    "- 동일 재현 명령이 3회 연속 통과한다.",
    "- Chromium 데스크톱과 모바일 인앱 프로필에서 회귀가 없다.",
    "- 콘솔·페이지 오류와 비정상 종료가 없다.",
  ].join("\n");

  const fields = {
    project: { key: JIRA_PROJECT_KEY },
    issuetype: { name: "버그" },
    summary: `[QA][Chromium/In-app][${result.category}] ${result.id} 회귀 실패`.slice(0, 250),
    description: adfFromMarkdown(description),
    labels: ["qa", "chromium", "in-app-browser", "automated", label],
  };
  if (JIRA_ASSIGNEE_ACCOUNT_ID) {
    fields.assignee = { accountId: JIRA_ASSIGNEE_ACCOUNT_ID };
  }
  const created = await jiraRequest("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return { key: created.key, created: true };
}

async function updateJira(results) {
  const configured = Boolean(JIRA_BASE_URL && JIRA_EMAIL && JIRA_API_TOKEN);
  const report = {
    configured,
    assigneeAccountIdConfigured: Boolean(JIRA_ASSIGNEE_ACCOUNT_ID),
    updates: [],
    errors: [],
  };
  if (!configured) {
    report.errors.push(
      "JIRA_EMAIL/JIRA_API_TOKEN secrets are unavailable; Jira updates must be applied through the connected Atlassian session.",
    );
    return report;
  }

  const unknownByFingerprint = new Map();
  for (const result of results.filter((item) => !item.ok)) {
    const fp = fingerprint(result.category, result.detail);
    const knownJira = knownJiraFor(result.detail);
    try {
      if (knownJira) {
        await addJiraComment(knownJira, result, fp);
        report.updates.push({ case: result.id, key: knownJira, created: false, known: true });
      } else {
        const record = unknownByFingerprint.get(fp) ?? { fp, results: [] };
        record.results.push(result);
        unknownByFingerprint.set(fp, record);
      }
    } catch (error) {
      report.errors.push(`${result.id}: ${String(error)}`);
    }
  }

  for (const record of unknownByFingerprint.values()) {
    if (record.results.length < 2) continue;
    try {
      const tracker = await findOrCreateJira(record.results.at(-1), record.fp);
      report.updates.push({
        case: record.results.map((item) => item.id).join(","),
        key: tracker.key,
        created: tracker.created,
        known: false,
        reproductions: record.results.length,
      });
    } catch (error) {
      report.errors.push(`unknown ${record.fp.slice(0, 16)}: ${String(error)}`);
    }
  }
  return report;
}

async function main() { // NOSONAR javascript:S3776
  const suite = SUITES[SUITE];
  if (!suite) throw new Error(`Unknown QA_SUITE: ${SUITE}`);
  const selectedCases = selectCases(suite);
  await mkdir(ROOT, { recursive: true });
  await mkdir(EVIDENCE_ROOT, { recursive: true });

  const results = [];
  console.log(
    `[chromium-inapp-suite] SELECTED suite=${SUITE} cases=${selectedCases.map((item) => item.id).join(",")}`,
  );
  for (const testCase of selectedCases) {
    console.log(`\n[chromium-inapp-suite] START ${testCase.id}: ${testCase.shell}`);
    const result = await runCommand(testCase);
    results.push(result);
    await appendFile(path.join(ROOT, "results.ndjson"), `${JSON.stringify(result)}\n`, "utf8");
    console.log(
      `[chromium-inapp-suite] ${result.ok ? "PASS" : "FAIL"} ${testCase.id} ` +
        `code=${result.exitCode} duration=${result.durationSeconds}s`,
    );
  }

  const jira = await updateJira(results);
  const summary = {
    generatedAt: new Date().toISOString(),
    suite: SUITE,
    requestedCases: REQUESTED_CASES,
    casePattern: CASE_PATTERN?.source ?? null,
    browserScope: "Chromium/Chrome and Chromium-based in-app UA/viewport emulation only",
    physicalDeviceVerified: false,
    commandCount: results.length,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
    jira,
  };
  await writeFile(path.join(ROOT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(ROOT, "jira-update.json"), `${JSON.stringify(jira, null, 2)}\n`, "utf8");

  const markdown = [
    `# Studio Chromium/In-app QA — ${SUITE}`,
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Commands: ${summary.commandCount}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Jira REST configured: ${jira.configured}`,
    `- Assignee configured: ${jira.assigneeAccountIdConfigured ? "김희준" : "no"}`,
    "",
    "> In-app results are Chromium engine UA/viewport/touch emulations. They are not physical KakaoTalk, Instagram, NAVER app WebView results.",
    "",
    "| Case | Result | Exit | Duration | Known Jira |",
    "|---|---:|---:|---:|---|",
    ...results.map((result) => {
      const key = result.ok ? "-" : knownJiraFor(result.detail) ?? "new-candidate";
      return `| ${result.id} | ${result.ok ? "PASS" : "FAIL"} | ${result.exitCode} | ${result.durationSeconds}s | ${key} |`;
    }),
    "",
    "## Jira updates",
    "",
    ...(jira.updates.length
      ? jira.updates.map(
          (item) => `- ${item.key}: ${item.created ? "created" : "updated"} (${item.case})`,
        )
      : ["- No Jira REST updates were applied by the runner."]),
    ...(jira.errors.length ? ["", "## Jira update warnings", "", ...jira.errors.map((error) => `- ${error}`)] : []),
    "",
  ].join("\n");
  await writeFile(path.join(ROOT, "summary.md"), `${markdown}\n`, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf8");
  }

  console.log(JSON.stringify({
    suite: SUITE,
    passed: summary.passed,
    failed: summary.failed,
    jiraUpdates: jira.updates.length,
    jiraErrors: jira.errors.length,
  }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error?.stack ?? error);
  await mkdir(ROOT, { recursive: true }).catch(() => undefined);
  await writeFile(
    path.join(ROOT, "fatal.json"),
    `${JSON.stringify({ at: new Date().toISOString(), suite: SUITE, error: String(error?.stack ?? error) }, null, 2)}\n`,
  ).catch(() => undefined);
  process.exitCode = 2;
});