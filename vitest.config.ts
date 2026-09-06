import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

import { resolveVitestDatabaseTarget } from "./scripts/run-postgres-integration-tests.mjs";
import { PERF_BUDGET_TEST_FILES } from "./vitest.perf-budget-files.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));

// 테스트가 실제로 존재하는 트리 목록(2026-08-21 기준 수집 루트 전부).
// Vitest 기본 include 는 "루트 아래 아무 데나" 라서, 트리 하나가 통째로 옮겨가거나 사라져도
// 남은 글롭이 조용히 더 적은 파일을 수집하고 스위트는 그대로 초록으로 통과한다. 수집 루트를
// 명시해두면 트리 이동(예: src/ -> apps/web)이 이 목록 수정을 강제하고, 빠뜨린 경우
// scripts/verify-toolchain-coverage.mjs 의 수집 파일 수 floor 가 게이트를 터뜨린다.
const TEST_ROOTS = ["apps", "deploy", "packages", "scripts", "tests"];

// Read .env.local only as a last candidate. resolveVitestDatabaseTarget accepts
// it only when it is loopback; a Neon/production URL is never inherited by the
// root test suite. DB-backed tests opt in with TEST_DATABASE_URL.
const envPath = path.resolve(root, ".env.local");
let envFileDatabaseUrl: string | undefined;
if (existsSync(envPath)) {
  try {
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    const dbUrl = match?.[1];
    if (dbUrl) {
      envFileDatabaseUrl = dbUrl.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // Ignore
  }
}

const testDatabaseTarget = resolveVitestDatabaseTarget({
  environment: process.env,
  envFileDatabaseUrl,
});
process.env.DATABASE_URL = testDatabaseTarget.databaseUrl;

export default defineConfig({
  resolve: {
    alias: {
      "@/shared": path.resolve(root, "apps/web/src/shared"),
      "@/domains": path.resolve(root, "apps/web/src/domains"),
      "@": path.resolve(root, "apps/web"),
    },
  },
  test: {
    // 수집 루트를 이 설정 파일의 디렉터리에 고정한다(기본값은 process.cwd()라 어디서
    // 실행하느냐에 따라 수집 범위가 달라진다).
    root,
    // Vitest 기본 include 와 동일한 파일명 규칙을, 위에서 명시한 트리에만 적용한다.
    include: TEST_ROOTS.map((dir) => `${dir}/**/*.{test,spec}.?(c|m)[jt]s?(x)`),
    environment: "node",
    setupFiles: [path.resolve(root, "vitest.setup.ts")],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Studio and Three.js test graphs are intentionally broad. Letting Vitest
    // mirror every logical CPU makes those workers compete for transform cache
    // and memory, which is slower and can turn sub-second assertions into
    // load-dependent timeouts. Four workers keeps local hooks and CI bounded.
    maxWorkers: 4,
    // .claude/worktrees/ 는 에이전트 워크플로가 격리 작업용으로 만드는 임시 git worktree(전역
    // gitignore 대상이라 커밋되진 않지만, vitest 기본 include 는 gitignore 를 안 따라가므로 이
    // 안에 있는 이 저장소의 사본까지 전부 다시 스캔해버린다) — 명시적으로 제외한다.
    // Cloudflare workerd integration은 `cloudflare:test` 가상 모듈과 전용 pool이 필요하므로
    // 루트 Node suite에 섞지 않고 `pnpm test:cloudflare-realtime`에서만 실행한다.
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/worktrees/**",
      "deploy/cloudflare-realtime/integration/**",
      // Playwright browser E2E (run via `pnpm exec playwright test`, not Vitest).
      "e2e/**",
      // Wall-clock budget tests run in their own quiet pass after this one
      // (vitest.perf.config.ts) — see vitest.perf-budget-files.mjs for why.
      ...PERF_BUDGET_TEST_FILES,
    ],
  },
});
