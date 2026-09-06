#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const STUDIO_BRANCH_CLEANUP_PROTECTED_PATTERNS = Object.freeze([
  /^(?:main|master|develop|development|staging|production|gh-pages)$/u,
  /^(?:release|hotfix)(?:\/|$)/u,
]);

function normalizeBranchName(value) {
  return String(value ?? "").trim();
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function branchSha(branch) {
  if (!isObject(branch)) return "";
  if (typeof branch.sha === "string") return branch.sha;
  if (isObject(branch.commit) && typeof branch.commit.sha === "string") {
    return branch.commit.sha;
  }
  return "";
}

function branchName(branch) {
  return isObject(branch) ? normalizeBranchName(branch.name) : "";
}

function pullHeadRepository(pull) {
  return isObject(pull?.head?.repo) && typeof pull.head.repo.full_name === "string"
    ? pull.head.repo.full_name
    : "";
}

function pullHeadRef(pull) {
  return isObject(pull?.head) ? normalizeBranchName(pull.head.ref) : "";
}

function pullHeadSha(pull) {
  return isObject(pull?.head) && typeof pull.head.sha === "string" ? pull.head.sha : "";
}

function isMergedPull(pull) {
  return isObject(pull) && typeof pull.merged_at === "string" && pull.merged_at.length > 0;
}

export function isProtectedStudioBranchName(
  name,
  protectedPatterns = STUDIO_BRANCH_CLEANUP_PROTECTED_PATTERNS,
) {
  const normalized = normalizeBranchName(name);
  return normalized.length === 0 || protectedPatterns.some((pattern) => pattern.test(normalized));
}

export function selectMergedStudioBranchCleanupCandidates({ // NOSONAR javascript:S3776
  repository,
  defaultBranch,
  branches,
  openPulls = [],
  closedPulls = [],
  protectedPatterns = STUDIO_BRANCH_CLEANUP_PROTECTED_PATTERNS,
}) {
  const normalizedRepository = String(repository ?? "").trim();
  const normalizedDefault = normalizeBranchName(defaultBranch);
  const openHeads = new Set(
    openPulls
      .filter((pull) => pullHeadRepository(pull) === normalizedRepository)
      .map(pullHeadRef)
      .filter(Boolean),
  );
  const mergedByHead = new Map();

  for (const pull of closedPulls) {
    if (!isMergedPull(pull)) continue;
    if (pullHeadRepository(pull) !== normalizedRepository) continue;
    const headRef = pullHeadRef(pull);
    const headSha = pullHeadSha(pull);
    if (!headRef || !headSha) continue;
    const existing = mergedByHead.get(headRef) ?? [];
    existing.push({
      number: Number.isInteger(pull.number) ? pull.number : null,
      headSha,
      mergedAt: pull.merged_at,
    });
    mergedByHead.set(headRef, existing);
  }

  const candidates = [];
  for (const branch of branches) {
    const name = branchName(branch);
    const sha = branchSha(branch);
    if (!name || !sha) continue;
    if (name === normalizedDefault) continue;
    if (branch.protected === true) continue;
    if (isProtectedStudioBranchName(name, protectedPatterns)) continue;
    if (openHeads.has(name)) continue;

    const exactMergedPulls = (mergedByHead.get(name) ?? []).filter(
      (pull) => pull.headSha === sha,
    );
    if (exactMergedPulls.length === 0) continue;

    candidates.push({
      branch: name,
      sha,
      mergedPullNumbers: exactMergedPulls
        .map((pull) => pull.number)
        .filter(Number.isInteger)
        .sort((left, right) => left - right),
      latestMergedAt: exactMergedPulls
        .map((pull) => pull.mergedAt)
        .sort()
        .at(-1),
    });
  }

  return candidates.sort((left, right) => left.branch.localeCompare(right.branch));
}

function parseArguments(argv) { // NOSONAR javascript:S3776
  const options = {
    repository: process.env.GITHUB_REPOSITORY ?? "",
    token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
    apply: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repository") {
      options.repository = argv[index + 1] ?? "";
      index += 1; // NOSONAR javascript:S2310
      continue;
    }
    if (argument === "--token") {
      options.token = argv[index + 1] ?? "";
      index += 1; // NOSONAR javascript:S2310
      continue;
    }
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (!/^[^/\s]+\/[^/\s]+$/u.test(options.repository)) {
    throw new Error("--repository must use owner/name format");
  }
  if (options.apply && !options.token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN is required with --apply");
  }
  return options;
}

function createGitHubClient({ repository, token }) { // NOSONAR javascript:S3776
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "toonspectrum-studio-branch-cleanup",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const request = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    if (response.status === 404 && init.allowNotFound) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub ${init.method ?? "GET"} ${path} failed: ${response.status} ${body.slice(0, 500)}`,
      );
    }
    if (response.status === 204) return null;
    return response.json();
  };

  const listPaginated = async (path, perPage = 100) => {
    const rows = [];
    for (let page = 1; page <= 20; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await request(`${path}${separator}per_page=${perPage}&page=${page}`);
      if (!Array.isArray(batch)) throw new Error(`Expected array from ${path}`);
      rows.push(...batch);
      if (batch.length < perPage) break;
    }
    return rows;
  };

  const [owner] = repository.split("/");
  return { request, listPaginated, owner };
}

async function collectRepositoryState(options) {
  const client = createGitHubClient(options);
  const repository = await client.request(`/repos/${options.repository}`);
  const branches = await client.listPaginated(`/repos/${options.repository}/branches`);
  const openPulls = await client.listPaginated(
    `/repos/${options.repository}/pulls?state=open&sort=updated&direction=desc`,
  );
  const closedPulls = [];

  for (const branch of branches) {
    const name = branchName(branch);
    if (!name || name === repository.default_branch || branch.protected === true) continue;
    if (isProtectedStudioBranchName(name)) continue;
    const params = new URLSearchParams({
      state: "closed",
      head: `${client.owner}:${name}`,
      sort: "updated",
      direction: "desc",
    });
    const pulls = await client.listPaginated(
      `/repos/${options.repository}/pulls?${params.toString()}`,
    );
    closedPulls.push(...pulls);
  }

  return {
    client,
    defaultBranch: repository.default_branch,
    branches,
    openPulls,
    closedPulls,
  };
}

async function deleteCandidate(client, repository, candidate) {
  const encodedBranch = candidate.branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const refPath = `/repos/${repository}/git/ref/heads/${encodedBranch}`;
  const ref = await client.request(refPath, { allowNotFound: true });
  if (!ref) return { ...candidate, status: "already-deleted" };
  if (ref.object?.sha !== candidate.sha) {
    return { ...candidate, status: "skipped-head-moved", currentSha: ref.object?.sha ?? null };
  }

  const params = new URLSearchParams({
    state: "open",
    head: `${client.owner}:${candidate.branch}`,
    per_page: "1",
  });
  const openPulls = await client.request(`/repos/${repository}/pulls?${params.toString()}`);
  if (Array.isArray(openPulls) && openPulls.length > 0) {
    return { ...candidate, status: "skipped-open-pr" };
  }

  await client.request(refPath, { method: "DELETE" });
  return { ...candidate, status: "deleted" };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const state = await collectRepositoryState(options);
  const candidates = selectMergedStudioBranchCleanupCandidates({
    repository: options.repository,
    defaultBranch: state.defaultBranch,
    branches: state.branches,
    openPulls: state.openPulls,
    closedPulls: state.closedPulls,
  });

  const results = [];
  if (options.apply) {
    for (const candidate of candidates) {
      results.push(await deleteCandidate(state.client, options.repository, candidate));
    }
  } else {
    results.push(...candidates.map((candidate) => ({ ...candidate, status: "dry-run" })));
  }

  const summary = {
    repository: options.repository,
    mode: options.apply ? "apply" : "dry-run",
    branchCount: state.branches.length,
    candidateCount: candidates.length,
    deletedCount: results.filter((result) => result.status === "deleted").length,
    results,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  console.log(
    `Studio merged branch cleanup: ${summary.deletedCount} deleted, ${summary.candidateCount} eligible (${summary.mode})`,
  );
  for (const result of results) {
    console.log(` - ${result.status}: ${result.branch} @ ${result.sha}`);
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
