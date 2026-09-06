import fs from "node:fs";
import path from "node:path";

import {
  validateNoDuplicateVercelTrigger,
  validateVercelFallbackWorkflow,
} from "./vercel-workflow-policy.mjs";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts || {};

const issues = [];

// Required docs. ToonSpectrum keeps product/design guides at the repo root and
// deeper references (ranking math, competitor analysis) under docs/.
// (AGENTS.md/CLAUDE.md are intentionally git-ignored globally — agent guides
//  are not committed — so they are NOT validated here.)
const requiredPaths = [
  "README.md",
  "ARCHITECTURE.md",
  "PRODUCT.md",
  "DESIGN.md",
  "docs/ranking-architecture.md",
  "docs/competitor-analysis.md",
  "docs/architecture/frontend-layered-architecture.md",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "commitlint.config.cjs",
  ".github/workflows/catalog-update.yml",
  ".github/workflows/deploy-vercel.yml",
  ".github/workflows/related-info-update.yml",
  "deploy/oci/.env.example",
  "deploy/oci/crawl-update.sh",
  "scripts/vercel-workflow-policy.mjs",
  "scripts/vercel-workflow-policy.test.mjs",
  "apps/web/src/app/routes/app-route-definition.ts",
  "apps/web/src/app/routes/groups/app-routes.tsx",
  "apps/web/src/domains/creator/studio-router/routes/StudioEditorRoute.tsx",
  "apps/web/src/domains/creator/studio-router/routes/StudioPublishRoute.tsx",
  "apps/web/src/domains/creator/studio-cuttoon-editor/runtime/useStudioDocumentAccessRuntime.ts",
  ".husky/pre-commit",
  ".husky/commit-msg",
];
for (const file of requiredPaths) {
  if (!exists(file)) issues.push(`missing file: ${file}`);
}

// Root Vite app entry points (index.html -> src/app/main.tsx).
const requiredEntries = [
  "apps/web/index.html",
  "apps/web/public",
  "apps/web/src/app/main.tsx",
  "apps/web/config/vite-manual-chunks.ts",
  "apps/web/tests/browser-fixtures/studio-catalog/index.html",
  "apps/web/tools/browser-harnesses/hybrid-dcc-e2e.html",
  "vite.config.ts",
];
for (const entry of requiredEntries) {
  if (!exists(entry)) issues.push(`missing app entry: ${entry}`);
}

// 앱 진입점은 정확히 하나(index.html -> src/app/main.tsx)여야 한다. 실험용 브라우저 하네스가
// src 루트에 `*-main.ts(x)` 로, 그 페이지가 레포 루트에 `*.html` 로 눌러앉으면 "앱 소스"와
// "일회성 실험"이 같은 트리에서 구분되지 않는다. 하네스의 집은 apps/web/tools/browser-harnesses/다.
const SRC_ROOT_ENTRY_PATTERN = /(?:^|-)main\.tsx?$/;
if (exists("apps/web/src")) {
  for (const entry of fs.readdirSync(path.join(ROOT, "apps/web/src"), { withFileTypes: true })) {
    if (!entry.isFile() || !SRC_ROOT_ENTRY_PATTERN.test(entry.name)) continue;
    issues.push(
      `entry-shaped module at the src root: apps/web/src/${entry.name}`
      + ` (the app entry is apps/web/src/app/main.tsx; browser harnesses belong in apps/web/tools/browser-harnesses/)`,
    );
  }
}
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  issues.push(
    `stray HTML entry at the repo root: ${entry.name}`
    + ` (only apps/web/index.html is the application entry; harness pages belong in apps/web/tools/browser-harnesses/)`,
  );
}
if (!exists("apps/web/tools/browser-harnesses")) {
  issues.push("missing harness home: apps/web/tools/browser-harnesses/");
}
if (exists("tools/browser-harnesses")) {
  issues.push("legacy browser harness directory at repository root: tools/browser-harnesses/");
}
if (exists("tests/browser-fixtures/studio-catalog")) {
  issues.push("duplicate Studio catalog fixture at repository root: tests/browser-fixtures/studio-catalog/");
}

// 린트 예외 원장 + 그 원장과 호스트 결합도를 지키는 두 래칫 테스트. 이 셋 중 하나라도
// 사라지면 "기계적 추출" 상태가 다시 아무도 안 보는 곳으로 숨는다.
const LEGACY_EXCEPTIONS_LEDGER = "eslint.legacy-exceptions.json";
if (!exists(LEGACY_EXCEPTIONS_LEDGER)) {
  issues.push(`missing lint exception ledger: ${LEGACY_EXCEPTIONS_LEDGER}`);
} else {
  try {
    const ledger = JSON.parse(read(LEGACY_EXCEPTIONS_LEDGER));
    for (const key of ["compilerOptOutFiles", "closureBagFiles"]) {
      if (!Array.isArray(ledger[key])) {
        issues.push(`${LEGACY_EXCEPTIONS_LEDGER}: "${key}" must be an array of globs`);
      }
    }
  } catch (error) {
    issues.push(`${LEGACY_EXCEPTIONS_LEDGER}: not parseable JSON (${error.message})`);
  }
}
for (const guard of [
  "apps/web/src/domains/creator/studio-host-architecture-ratchet.test.ts",
  "scripts/eslint-legacy-exceptions.test.mjs",
]) {
  if (!exists(guard)) issues.push(`missing architecture guard test: ${guard}`);
}

// Frontend code belongs under apps/web; keep the repository root limited to workspace infrastructure.
for (const legacyRoot of ["components", "hooks", "lib", "public", "shared", "src", "styles"]) {
  if (exists(legacyRoot)) issues.push("legacy frontend directory at repository root: " + legacyRoot + "/");
}

// Root scripts wired into the build/lint/test chain.
// V11.1 §12.1/§Phase 8 — 인플레이스 교체 가드: 병렬 Studio 앱·버전 접미사 소스 경로 금지.
const forbiddenParallelPaths = [
  "apps/studio-web-v11",
  "apps/asset-market-v11",
  "apps/benchmark-lab-v11",
  "studio-v11",
];
for (const forbidden of forbiddenParallelPaths) {
  if (exists(forbidden)) issues.push(`forbidden parallel studio path exists: ${forbidden}`);
}

// One-off QA receipts are execution artifacts, not maintained source. Keeping dated trigger notes
// in the tree makes repository search noisy and gives transient evidence the same status as ADRs.
for (const receiptDir of [".github/qa", "qa-results", "scripts/qa/runs"]) {
  if (exists(receiptDir)) {
    issues.push(`ephemeral QA receipt directory belongs in Actions artifacts: ${receiptDir}`);
  }
}
for (const base of ["packages", "crates", "apps"]) {
  if (!exists(base)) continue;
  for (const entry of fs.readdirSync(path.join(ROOT, base))) {
    if (/-v\d+$/.test(entry)) {
      issues.push(`version-suffixed source directory violates V11.1: ${base}/${entry}`);
    }
  }
}

const requiredScripts = [
  "dev",
  "build",
  "build:all",
  "lint",
  "typecheck",
  "test",
  "check:studio-bundle",
  "validate:architecture",
  "verify:csp",
  "verify:toolchain-coverage",
  "verify:studio-menus",
  "verify:studio-icons",
];
for (const script of requiredScripts) {
  if (!scripts[script]) issues.push(`missing script: ${script}`);
}

const expectedCspCommand = "node scripts/verify-vercel-csp.mjs apps/web/index.html";
if (scripts["verify:csp"] !== expectedCspCommand) {
  issues.push(`verify:csp must target the canonical entry: ${expectedCspCommand}`);
}

const canonicalWorkflowReferences = [
  {
    file: ".github/workflows/studio-asset-browser.yml",
    required: "      - apps/web/tests/browser-fixtures/studio-catalog/**",
    forbidden: "\n      - tests/browser-fixtures/studio-catalog/**",
  },
  {
    file: ".github/workflows/studio-promo-video.yml",
    required: "apps/web/tools/browser-harnesses/promo-e2e.html",
    forbidden: "\n      - 'tools/browser-harnesses/promo-e2e.html'",
  },
  {
    file: ".github/workflows/studio-wearable-runtime-review.yml",
    required: "cp apps/web/tools/browser-harnesses/props-compare-main.ts",
    forbidden: "cp tools/browser-harnesses/props-compare-main.ts",
  },
];
for (const { file, required, forbidden } of canonicalWorkflowReferences) {
  const source = read(file);
  if (!source.includes(required)) issues.push(`${file}: missing canonical web path ${required.trim()}`);
  if (source.includes(forbidden)) issues.push(`${file}: stale root path ${forbidden.trim()}`);
}

// pnpm workspace members declared in pnpm-workspace.yaml must exist on disk.
if (exists("pnpm-workspace.yaml")) {
  const ws = read("pnpm-workspace.yaml");
  // `packages:` 블록의 리스트 항목만 워크스페이스 글롭으로 본다. (다른 최상위 키,
  // 예: onlyBuiltDependencies/minimumReleaseAgeExclude 의 `- 항목`은 패키지가 아님.)
  const pkgBlock = ws.match(/^packages:\s*\n((?:[ \t]*-[ \t]*.*\n?)+)/m)?.[1] ?? ""; // NOSONAR S5852 신뢰된 로컬 입력(pnpm-workspace.yaml), 빌드타임 검증 스크립트
  const globs = [...pkgBlock.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1].trim());
  for (const glob of globs) {
    if (glob === ".") continue; // root package
    const base = glob.replace(/\/\*+$/, "");
    if (!exists(base)) issues.push(`workspace dir missing: ${base} (from "${glob}")`);
  }
}

// The NestJS API workspace package must have a name + build script
// (build:all runs `pnpm -r run build` across the workspace).
const apiPkgPath = "apps/api/package.json";
if (!exists(apiPkgPath)) {
  issues.push(`missing workspace package: ${apiPkgPath}`);
} else {
  const apiPkg = JSON.parse(read(apiPkgPath));
  if (!apiPkg.name) issues.push(`apps/api has no "name"`);
  if (!apiPkg.scripts || !apiPkg.scripts.build) issues.push(`apps/api has no "build" script`);
}

// Vercel Git Integration is the primary production path. Keep the Actions CLI
// path manual-only, project-bound, and exactly pinned so configuring its three
// secrets later cannot deploy a wrong project or silently adopt a new release.
const vercelDeployWorkflowPath = ".github/workflows/deploy-vercel.yml";
if (exists(vercelDeployWorkflowPath)) {
  for (const issue of validateVercelFallbackWorkflow(read(vercelDeployWorkflowPath))) {
    issues.push(`${vercelDeployWorkflowPath}: ${issue}`);
  }
}

// Scheduled content commits are ordinary main pushes. Explicit CLI/hook
// dispatches duplicate Vercel Git Integration builds and consume runner quota.
for (const workflowPath of [
  ".github/workflows/catalog-update.yml",
  ".github/workflows/related-info-update.yml",
]) {
  if (!exists(workflowPath)) continue;
  for (const issue of validateNoDuplicateVercelTrigger(read(workflowPath), { workflow: true })) {
    issues.push(`${workflowPath}: ${issue}`);
  }
}
for (const automationPath of ["deploy/oci/crawl-update.sh", "deploy/oci/.env.example"]) {
  if (!exists(automationPath)) continue;
  for (const issue of validateNoDuplicateVercelTrigger(read(automationPath))) {
    issues.push(`${automationPath}: ${issue}`);
  }
}

if (issues.length > 0) {
  console.error(`architecture validation failed: ${issues.length} issue(s)`);
  for (const item of issues) console.error(` - ${item}`);
  process.exit(1);
}

console.log("architecture validation passed: docs, workspace members, and scripts are consistent");
