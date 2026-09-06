const repo = process.env.GITHUB_REPOSITORY ?? "";
const token = process.env.GITHUB_TOKEN ?? "";
const runId = process.env.GITHUB_RUN_ID ?? "local";
const sha = process.env.GITHUB_SHA ?? "unknown";
const jiraBase = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");
const jiraEmail = process.env.JIRA_EMAIL ?? "";
const jiraToken = process.env.JIRA_API_TOKEN ?? "";
const jiraProject = process.env.JIRA_PROJECT_KEY ?? "KAN";

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "toonspectrum-soak", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${data?.message ?? text}`);
  return data;
}

async function ensureLabels() {
  for (const [name, color] of [["qa-soak", "B60205"], ["needs-triage", "FBCA04"], ["automated", "1D76DB"]]) {
    try { await github(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify({ name, color }) }); }
    catch (error) { if (!/422|already_exists|Validation Failed/i.test(String(error))) throw error; }
  }
}

function body(record) {
  const cases = record.occurrences.slice(-8).map((item) => `- ${item.observedAt} · ${item.variant} · ${item.scope} · \`${item.detail.replace(/`/g, "'").slice(0, 400)}\``).join("\n");
  return `<!-- studio-soak-fingerprint:${record.fingerprint} -->\n## 요약\n\n${record.title}\n\n## 자동 검증\n\n- 심각도 제안: **${record.severity}**\n- 카테고리: \`${record.category}\`\n- 재현 횟수: **${record.count}**\n- 커밋: \`${sha}\`\n- Actions run: https://github.com/${repo}/actions/runs/${runId}\n\n## 재현 사례\n\n${cases}\n\n## 기대 결과\n\n지원 브라우저·뷰포트·렌더링 조합에서 화면 잘림, 입력 차단, 무응답 또는 예외 없이 흐름이 완료되어야 합니다.\n\n## 완료 조건\n\n- [ ] 동일 fingerprint가 자동화에서 더 이상 발생하지 않는다.\n- [ ] 관련 조합 2개 이상에서 수정 결과를 확인한다.\n- [ ] 회귀 테스트를 상시 CI에 남긴다.\n\n> 장시간 QA가 자동 생성한 후보입니다. 제품 결함과 인프라 결함을 구분해 우선순위를 확정해 주세요.\n`;
}

async function jira(path, options = {}) {
  const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString("base64");
  const response = await fetch(`${jiraBase}${path}`, { ...options, headers: { Accept: "application/json", Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...(options.headers ?? {}) } });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Jira ${response.status}: ${text}`);
  return data;
}

export async function fileIssue(record, enabled) { // NOSONAR javascript:S3776
  if (!enabled || record.knownJira || record.tracker) return;
  try {
    const label = `qa-soak-${record.fingerprint.slice(0, 16)}`;
    if (jiraBase && jiraEmail && jiraToken) {
      const query = new URLSearchParams({ jql: `project = ${jiraProject} AND labels = \"${label}\"`, maxResults: "1" });
      const found = await jira(`/rest/api/3/search?${query}`);
      if (found.issues?.[0]) record.tracker = `Jira ${found.issues[0].key}`;
      else {
        const description = { type: "doc", version: 1, content: body(record).split("\n").map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line.slice(0, 1800) }] : [] })) };
        const created = await jira("/rest/api/3/issue", { method: "POST", body: JSON.stringify({ fields: { project: { key: jiraProject }, issuetype: { name: "버그" }, summary: `[QA-SOAK][${record.category}] ${record.title}`.slice(0, 250), labels: ["qa-soak", "automated", label], description } }) });
        record.tracker = `Jira ${created.key}`;
      }
    } else if (repo && token) {
      await ensureLabels();
      let existing = null;
      for (let page = 1; page <= 10 && !existing; page += 1) {
        const issues = await github(`/repos/${repo}/issues?state=all&labels=qa-soak&per_page=100&page=${page}`);
        existing = issues.find((issue) => !issue.pull_request && String(issue.body ?? "").includes(`studio-soak-fingerprint:${record.fingerprint}`));
        if (issues.length < 100) break;
      }
      if (existing) record.tracker = `GitHub #${existing.number}`;
      else {
        const created = await github(`/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title: `[QA-SOAK][${record.category}] ${record.title}`.slice(0, 250), body: body(record), labels: ["qa-soak", "needs-triage", "automated"] }) });
        record.tracker = `GitHub #${created.number}`;
      }
    }
    if (record.tracker) console.log(`[soak] TRACKER ${record.tracker} fp=${record.fingerprint.slice(0, 12)}`);
  } catch (error) {
    record.filingErrors.push(String(error));
    console.error(`[soak] filing failed: ${error}`);
  }
}
