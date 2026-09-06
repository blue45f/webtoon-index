#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function encodeGitRef(branch) {
  if (typeof branch !== "string" || !branch || branch.includes("\0")) {
    throw new Error("branch must be a non-empty ref name without null bytes");
  }
  return branch.split("/").map(encodeURIComponent).join("/");
}

export function compareProvesMerged(compare) {
  if (!compare || typeof compare !== "object") return false;
  return (
    (compare.status === "ahead" || compare.status === "identical")
    && Number(compare.behind_by ?? 0) === 0
  );
}

export function mergedPullRequestProvesHead(
  pull,
  repositoryFullName,
  defaultBranch,
  branch,
  currentSha,
) {
  return Boolean(
    pull
    && typeof pull === "object"
    && typeof pull.merged_at === "string"
    && pull.merged_at.length > 0
    && pull.base?.ref === defaultBranch
    && pull.head?.repo?.full_name === repositoryFullName
    && pull.head?.ref === branch
    && pull.head?.sha === currentSha
  );
}

export function classifyBranchDeletion({
  branch,
  defaultBranch,
  workflowBranch,
  protectedBranch,
  sameRepository,
  currentSha,
  compare,
  mergedPullRequestHeadMatch = false,
}) {
  if (!sameRepository) return { allowed: false, reason: "fork" };
  if (!branch || branch === defaultBranch) return { allowed: false, reason: "default-branch" };
  if (workflowBranch && branch === workflowBranch) return { allowed: false, reason: "active-workflow-branch" };
  if (protectedBranch) return { allowed: false, reason: "protected-branch" };
  if (!SHA_PATTERN.test(String(currentSha ?? ""))) return { allowed: false, reason: "invalid-sha" };
  if (compareProvesMerged(compare)) {
    return { allowed: true, reason: "merged-ancestor" };
  }
  if (mergedPullRequestHeadMatch) {
    return { allowed: true, reason: "merged-pull-request-head" };
  }
  return { allowed: false, reason: "unique-commits" };
}

function parseArguments(argv) {
  const parsed = { apply: false, all: false, pr: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") parsed.apply = true;
    else if (value === "--all") parsed.all = true;
    else if (value === "--pr") {
      const candidate = Number(argv[index + 1]);
      if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new Error("--pr requires a positive integer");
      parsed.pr = candidate;
      index += 1; // NOSONAR javascript:S2310
    } else if (value === "--help" || value === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  if (!parsed.help && parsed.all === Boolean(parsed.pr)) {
    throw new Error("choose exactly one of --all or --pr <number>");
  }
  return parsed;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/cleanup-merged-branches.mjs --pr <number> [--apply]",
    "  node scripts/cleanup-merged-branches.mjs --all [--apply]",
    "",
    "The command is dry-run by default. --apply enables deletion.",
  ].join("\n");
}

function repositoryParts(value) {
  const [owner, repo, extra] = String(value ?? "").split("/");
  if (!owner || !repo || extra) throw new Error("GITHUB_REPOSITORY must be owner/repo");
  return { owner, repo, fullName: `${owner}/${repo}` };
}

async function github(path, { method = "GET", body, token, accept = "application/vnd.github+json" } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "toonstudio-merged-branch-cleanup",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`GitHub API ${method} ${path} failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function paginate(path, token) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const join = path.includes("?") ? "&" : "?";
    const payload = await github(`${path}${join}per_page=100&page=${page}`, { token });
    if (!Array.isArray(payload)) throw new Error(`Expected paginated array from ${path}`);
    rows.push(...payload);
    if (payload.length < 100) return rows;
  }
}

async function repositoryState(repository, token) {
  const repo = await github(`/repos/${repository.owner}/${repository.repo}`, { token });
  const defaultBranch = repo?.default_branch;
  if (typeof defaultBranch !== "string" || !defaultBranch) throw new Error("Repository default branch is unavailable");
  return { defaultBranch };
}

async function compareBranchToDefault(repository, branchSha, defaultBranch, token) {
  if (!SHA_PATTERN.test(branchSha)) throw new Error(`Invalid branch SHA: ${branchSha}`);
  return github(
    `/repos/${repository.owner}/${repository.repo}/compare/${branchSha}...${encodeURIComponent(defaultBranch)}`,
    { token },
  );
}

async function openPullRequestsForBranch(repository, branch, token) {
  return paginate(
    `/repos/${repository.owner}/${repository.repo}/pulls?state=open&head=${encodeURIComponent(repository.owner + ":" + branch)}`,
    token,
  );
}

async function exactMergedPullRequestForBranch(
  repository,
  branch,
  currentSha,
  defaultBranch,
  token,
) {
  const pulls = await paginate(
    `/repos/${repository.owner}/${repository.repo}/pulls?state=closed&head=${encodeURIComponent(repository.owner + ":" + branch)}&sort=updated&direction=desc`,
    token,
  );
  return pulls.find((pull) => mergedPullRequestProvesHead(
    pull,
    repository.fullName,
    defaultBranch,
    branch,
    currentSha,
  )) ?? null;
}

async function reportAndMaybeClosePullRequests(repository, branch, pulls, token, apply, report) {
  for (const pull of pulls) {
    const item = { number: pull.number, branch, url: pull.html_url };
    if (apply) {
      await github(`/repos/${repository.owner}/${repository.repo}/issues/${pull.number}/comments`, {
        method: "POST",
        token,
        body: { body: `이 브랜치의 현재 HEAD가 이미 \`${report.defaultBranch}\`에 반영되어 중복 PR을 닫고 브랜치를 정리합니다.` },
      });
      await github(`/repos/${repository.owner}/${repository.repo}/pulls/${pull.number}`, {
        method: "PATCH",
        token,
        body: { state: "closed" },
      });
    }
    report.closedPullRequests.push({ ...item, applied: apply });
  }
}

async function currentRefSha(repository, branch, token) {
  try {
    const ref = await github(
      `/repos/${repository.owner}/${repository.repo}/git/ref/heads/${encodeGitRef(branch)}`,
      { token },
    );
    return typeof ref?.object?.sha === "string" ? ref.object.sha : null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function inspectAndMaybeDelete( // NOSONAR javascript:S3776
  repository,
  rawBranch,
  context,
  knownMergedPullRequest = null,
) {
  const { token, apply, defaultBranch, workflowBranch, report } = context;
  const name = rawBranch?.name;
  const currentSha = rawBranch?.commit?.sha;
  if (typeof name !== "string" || typeof currentSha !== "string") return;

  let compare = null;
  let mergedPullRequest = knownMergedPullRequest;
  if (name !== defaultBranch && name !== workflowBranch && !rawBranch.protected && SHA_PATTERN.test(currentSha)) {
    compare = await compareBranchToDefault(repository, currentSha, defaultBranch, token);
    if (!compareProvesMerged(compare) && !mergedPullRequest) {
      mergedPullRequest = await exactMergedPullRequestForBranch(
        repository,
        name,
        currentSha,
        defaultBranch,
        token,
      );
    }
  }
  const mergedPullRequestHeadMatch = mergedPullRequestProvesHead(
    mergedPullRequest,
    repository.fullName,
    defaultBranch,
    name,
    currentSha,
  );
  const decision = classifyBranchDeletion({
    branch: name,
    defaultBranch,
    workflowBranch,
    protectedBranch: Boolean(rawBranch.protected),
    sameRepository: true,
    currentSha,
    compare,
    mergedPullRequestHeadMatch,
  });
  if (!decision.allowed) {
    report.skipped.push({ branch: name, sha: currentSha, reason: decision.reason });
    return;
  }

  const openPulls = await openPullRequestsForBranch(repository, name, token);
  const nonDefaultPulls = openPulls.filter((pull) => pull.base?.ref !== defaultBranch);
  if (nonDefaultPulls.length > 0) {
    report.skipped.push({
      branch: name,
      sha: currentSha,
      reason: "open-nondefault-pull-request",
      pullRequests: nonDefaultPulls.map((pull) => pull.number),
    });
    return;
  }

  const verifiedSha = await currentRefSha(repository, name, token);
  if (verifiedSha === null) {
    report.skipped.push({ branch: name, sha: currentSha, reason: "already-deleted" });
    return;
  }
  if (verifiedSha !== currentSha) {
    report.skipped.push({
      branch: name,
      sha: currentSha,
      currentSha: verifiedSha,
      reason: "head-changed-after-verification",
    });
    return;
  }

  if (apply) {
    try {
      await github(`/repos/${repository.owner}/${repository.repo}/git/refs/heads/${encodeGitRef(name)}`, {
        method: "DELETE",
        token,
      });
    } catch (error) {
      if (error.status === 404) {
        report.skipped.push({ branch: name, sha: currentSha, reason: "already-deleted" });
        return;
      }
      throw error;
    }
  }
  await reportAndMaybeClosePullRequests(repository, name, openPulls, token, apply, report);
  report.deleted.push({
    branch: name,
    sha: currentSha,
    applied: apply,
    proof: decision.reason,
    mergedPullRequest: mergedPullRequest?.number ?? null,
  });
}

async function cleanupPullRequest(repository, number, context) {
  const pull = await github(`/repos/${repository.owner}/${repository.repo}/pulls/${number}`, { token: context.token });
  if (!pull?.merged) {
    context.report.skipped.push({ branch: pull?.head?.ref ?? "unknown", reason: "pull-request-not-merged", number });
    return;
  }
  if (pull.head?.repo?.full_name !== repository.fullName) {
    context.report.skipped.push({ branch: pull.head?.ref ?? "unknown", reason: "fork", number });
    return;
  }
  const branch = await github(
    `/repos/${repository.owner}/${repository.repo}/branches/${encodeGitRef(pull.head.ref)}`,
    { token: context.token },
  ).catch((error) => {
    if (error.status === 404) return null;
    throw error;
  });
  if (!branch) {
    context.report.skipped.push({ branch: pull.head.ref, reason: "already-deleted", number });
    return;
  }
  const exactDefaultBranchMerge = mergedPullRequestProvesHead(
    pull,
    repository.fullName,
    context.defaultBranch,
    branch.name,
    branch.commit.sha,
  )
    ? pull
    : null;
  await inspectAndMaybeDelete(repository, branch, context, exactDefaultBranchMerge);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required");
  const repository = repositoryParts(env.GITHUB_REPOSITORY);
  const { defaultBranch } = await repositoryState(repository, token);
  const report = {
    repository: repository.fullName,
    defaultBranch,
    mode: args.all ? "all" : "pull-request",
    pullRequest: args.pr,
    dryRun: !args.apply,
    deleted: [],
    closedPullRequests: [],
    skipped: [],
  };
  const context = {
    token,
    apply: args.apply,
    defaultBranch,
    workflowBranch: env.GITHUB_REF_NAME || null,
    report,
  };

  if (args.pr) await cleanupPullRequest(repository, args.pr, context);
  else {
    const branches = await paginate(`/repos/${repository.owner}/${repository.repo}/branches`, token);
    const sortedBranches = [...branches].sort((left, right) => left.name.localeCompare(right.name));
    for (const branch of sortedBranches) {
      await inspectAndMaybeDelete(repository, branch, context);
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
