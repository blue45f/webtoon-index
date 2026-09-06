import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parseCLI } from "vitest/node";
import { parse as parseYaml } from "yaml";

const repositoryRoot = new URL("../", import.meta.url);

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, repositoryRoot), "utf8"));
}

function readYaml(relativePath) {
  return parseYaml(readFileSync(new URL(relativePath, repositoryRoot), "utf8"));
}

function readText(relativePath) {
  return readFileSync(new URL(relativePath, repositoryRoot), "utf8");
}

function runCommands(job) {
  return (job?.steps ?? [])
    .map((step) => step.run)
    .filter((command) => typeof command === "string");
}

function usesActions(job) {
  return (job?.steps ?? []).map((step) => step.uses).filter(Boolean);
}

const PLAYWRIGHT_INSTALL = "pnpm exec playwright install --with-deps chromium";
const ROOT_SHARD_COMMAND =
  "pnpm run test:root --shard=${{ matrix.shard }}/${{ strategy.job-total }}";
const HEADED_PARITY_COMMAND =
  'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-3d-console';

describe("database integration runner CI policy", () => {
  it("keeps the package entrypoints bound to the reviewed integration runners", () => {
    const packageManifest = readJson("package.json");

    expect(packageManifest.scripts?.["test:postgres:integration"]).toBe(
      "node scripts/run-postgres-integration-tests.mjs",
    );
    expect(packageManifest.scripts?.["test:redis:integration"]).toBe(
      "node scripts/run-redis-integration-tests.mjs",
    );
  });

  it("keeps `pnpm test` equal to the root suite plus the quiet perf-budget pass", () => {
    const packageManifest = readJson("package.json");

    // CI shards `test:root` and runs `test:perf` on its own runner; `pnpm test` must stay the
    // exact union so a local run and CI prove the same thing.
    expect(packageManifest.scripts?.["test:root"]).toBe("vitest run");
    expect(packageManifest.scripts?.test).toBe("pnpm run test:root && pnpm run test:perf");
    expect(packageManifest.scripts?.["test:perf"]).toBe(
      "vitest run --config vitest.perf.config.ts",
    );
    // The bundle-only build the browser gates use must be exactly the `vite build` half of
    // `build`: tsc is `noEmit`, so the dist is byte-identical and `typecheck` proves the types.
    expect(packageManifest.scripts?.build).toBe(
      "NODE_OPTIONS='--max-old-space-size=8192' tsc -p tsconfig.json && NODE_OPTIONS='--max-old-space-size=8192' vite build",
    );
    expect(packageManifest.scripts?.["build:bundle"]).toBe(
      "NODE_OPTIONS='--max-old-space-size=8192' vite build",
    );
    // pnpm runs `pre<script>`/`post<script>` around any script name. `build` gets the catalog
    // generation (apps/web/public/data/ is gitignored, so without it the bundle ships no catalog) and the
    // third-party notices plus CSP verification; the bundle-only build must get the same, or the
    // dist the browser gates drive is not the dist production serves.
    expect(packageManifest.scripts?.prebuild).toBe("pnpm catalog:gen");
    expect(packageManifest.scripts?.["prebuild:bundle"]).toBe("pnpm run prebuild");
    expect(packageManifest.scripts?.["postbuild:bundle"]).toBe("pnpm run postbuild");
    expect(packageManifest.scripts?.postbuild).toContain(
      "dist/legal/THIRD_PARTY_NOTICES.generated.md",
    );
  });

  it("never forwards a standalone `--` through `pnpm run`", () => {
    const workflow = readYaml(".github/workflows/ci.yml");

    // pnpm 11 passes a standalone `--` to the script verbatim. Vitest then puts everything after
    // it in options["--"] and Playwright stops parsing options at it, so `--shard` and `--grep`
    // silently vanish: every shard and both visual lanes ran the entire suite in run 2643.
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      for (const command of runCommands(job)) {
        for (const line of command.split("\n")) {
          if (!line.trimStart().startsWith("pnpm run ")) continue;
          expect(line.split(/\s+/u), `${jobId}: ${line.trim()}`).not.toContain("--");
        }
      }
    }
    for (const entry of workflow.jobs?.["studio-3d-visual"]?.strategy?.matrix?.include ?? []) {
      expect(entry.filter.split(/\s+/u), entry.lane).not.toContain("--");
    }
  });

  it.each([1, 2, 3])("passes matrix shard %i to the actual Vitest CLI parser", (shard) => {
    const workflow = readYaml(".github/workflows/ci.yml");
    const packageManifest = readJson("package.json");
    const total = workflow.jobs.test.strategy.matrix.shard.length;
    const prefix = "pnpm run test:root ";
    const command = runCommands(workflow.jobs.test).find((run) => run.startsWith(prefix));
    expect(command).toBeDefined();

    // pnpm 11 forwards a standalone `--` verbatim; Vitest puts everything after it in
    // options["--"] instead of parsing --shard. Inspect the real parser, not just the YAML text.
    const argumentsText = command.slice(prefix.length)
      .replace("${{ matrix.shard }}", String(shard))
      .replace("${{ strategy.job-total }}", String(total));
    const parsed = parseCLI([
      ...packageManifest.scripts["test:root"].split(/\s+/u),
      ...argumentsText.trim().split(/\s+/u),
    ]);

    expect(parsed.options.shard).toBe(`${shard}/${total}`);
    expect(parsed.options["--"]).toEqual([]);
    expect(parsed.filter).toEqual([]);
  });

  it("shards the root Vitest suite behind a Postgres service and runs the serial lane once", () => {
    const workflow = readYaml(".github/workflows/ci.yml");
    const shardJob = workflow.jobs?.test;
    const serialJob = workflow.jobs?.["test-serial"];
    const shardCommands = runCommands(shardJob);
    const serialCommands = runCommands(serialJob);

    expect(shardJob?.strategy?.matrix?.shard).toEqual([1, 2, 3]);
    expect(shardJob?.strategy?.["fail-fast"]).toBe(false);
    expect(shardJob?.name).toBe("test (${{ matrix.shard }}/${{ strategy.job-total }})");
    expect(shardJob?.services?.postgres?.image).toBe("postgres:16-alpine");
    expect(shardJob?.env).toMatchObject({
      DATABASE_URL: "postgres://webdex:webdex@localhost:5432/webdex",
      STUDIO_LIVE_POSTGRES_INTEGRATION_URL: "postgres://webdex:webdex@localhost:5432/webdex",
      STUDIO_LIVE_POSTGRES_RUNTIME_ROLE: "webdex_runtime",
    });
    expect(shardJob?.["timeout-minutes"]).toBe(30);

    // The browser probes in packages/studio-engine-* launch a real Chromium from Vitest.
    expect(shardCommands).toContain(PLAYWRIGHT_INSTALL);

    // Every shard provisions and migration-proves its own database before its slice of the suite.
    const stepNames = (shardJob?.steps ?? []).map((step) => step.name);
    const shardStepIndex = (shardJob?.steps ?? []).findIndex(
      (step) => step.run === ROOT_SHARD_COMMAND,
    );
    expect(shardStepIndex).toBeGreaterThanOrEqual(0);
    for (const provisioningStep of [
      "Provision and verify database schema",
      "Reproduce reviewed historical baseline through 0019",
      "Adopt verified history and apply genuine pending migrations",
      "Prove pending-only migration rerun",
      "Verify full runtime readiness and exact migration ledger",
    ]) {
      const index = stepNames.indexOf(provisioningStep);
      expect(index, provisioningStep).toBeGreaterThanOrEqual(0);
      expect(index, provisioningStep).toBeLessThan(shardStepIndex);
    }
    expect(shardJob?.steps?.[shardStepIndex]).toMatchObject({
      name: "Run this shard of the root Vitest suite with per-file progress",
      "timeout-minutes": 20,
      run: ROOT_SHARD_COMMAND,
    });
    expect(shardCommands.filter((command) => command === ROOT_SHARD_COMMAND)).toHaveLength(1);

    // The wall-clock budget pass needs a runner that is doing nothing else, then the disposable
    // Redis and workerd integrations ride the same quiet runner because each is seconds long.
    expect(serialJob?.name).toBe("test (serial lane)");
    expect(serialJob?.services).toBeUndefined();
    expect(serialJob?.strategy).toBeUndefined();
    expect(serialCommands).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm run test:perf",
      "pnpm run test:redis:integration",
      "pnpm run test:cloudflare-realtime",
    ]);

    // Nothing runs the full `pnpm run test` (root + perf) or repeats a serial-lane check elsewhere.
    const everyCommand = Object.values(workflow.jobs ?? {}).flatMap(runCommands);
    expect(everyCommand).not.toContain("pnpm run test");
    for (const once of [
      "pnpm run test:perf",
      "pnpm run test:redis:integration",
      "pnpm run test:cloudflare-realtime",
    ]) {
      expect(everyCommand.filter((command) => command === once), once).toHaveLength(1);
    }
  });

  it("derives migration summary expectations from the canonical manifest", () => {
    const workflow = readYaml(".github/workflows/ci.yml");
    const steps = workflow.jobs?.test?.steps ?? [];
    const adoptionStep = steps.find(
      (step) => step.name === "Adopt verified history and apply genuine pending migrations",
    );
    const rerunStep = steps.find(
      (step) => step.name === "Prove pending-only migration rerun",
    );

    expect(adoptionStep?.run).toContain(
      "manifest_count=\"$(grep -cve '^[[:space:]]*$' \"$manifest_path\")\"",
    );
    expect(adoptionStep?.run).toContain(
      "expected_applied=$((manifest_count - adoption_baseline - bootstrap_count))",
    );
    expect(adoptionStep?.run).toContain(
      "expected_verified=$((adoption_baseline + bootstrap_count))",
    );
    expect(adoptionStep?.run).not.toMatch(
      /19 adopted, \d+ applied, \d+ checksum-verified skips/u,
    );
    expect(rerunStep?.run).toContain(
      "0 applied, ${manifest_count} checksum-verified skips",
    );
    expect(rerunStep?.run).not.toMatch(
      /0 applied, \d+ checksum-verified skips/u,
    );
  });

  it("cancels superseded pull request runs without touching main", () => {
    const workflow = readYaml(".github/workflows/ci.yml");

    // A PR is one concurrency group, so a new push frees the six-plus runners its previous run
    // was holding. A main push is keyed by its own SHA: main runs never cancel or queue behind
    // each other, because each commit must keep its own red/green signal.
    expect(workflow.concurrency).toEqual({
      group: "${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
  });

  it("aggregates the required `core` check from every parallel gate", () => {
    const workflow = readYaml(".github/workflows/ci.yml");
    const coreJob = workflow.jobs?.core;
    const gateStep = coreJob?.steps?.find(
      (step) => step.name === "Require every core gate to succeed",
    );

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(coreJob?.name).toBe("core");
    expect(coreJob?.needs).toEqual(["lint", "typecheck", "build", "test", "test-serial"]);
    for (const dependency of coreJob?.needs ?? []) {
      expect(workflow.jobs?.[dependency], dependency).toBeDefined();
    }
    // A skipped required check reads as green to branch protection, so the gate must always run
    // and read the upstream results itself.
    expect(coreJob?.if).toBe("${{ always() }}");
    expect(coreJob?.services).toBeUndefined();
    expect(usesActions(coreJob)).toEqual([]);
    expect(gateStep?.env?.GATE_RESULTS).toBe("${{ toJSON(needs) }}");
    expect(gateStep?.run).toContain('select(.value.result != "success")');
    expect(gateStep?.run).toContain("exit 1");
    expect(gateStep?.["continue-on-error"]).not.toBe(true);

    // The checks that used to live inside the single core job each keep their own runner.
    expect(runCommands(workflow.jobs?.lint)).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm run validate:architecture",
      "pnpm run lint",
    ]);
    expect(runCommands(workflow.jobs?.typecheck)).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm run typecheck",
      "pnpm run typecheck:cloudflare-realtime",
    ]);
    const buildCommands = runCommands(workflow.jobs?.build);
    expect(buildCommands).toContain("pnpm run build");
    expect(buildCommands).toContain("pnpm run check:studio-bundle");
    expect(buildCommands).toContain("pnpm run build:all");
    expect(buildCommands.some((command) => command.includes("wrangler deploy"))).toBe(true);
  });

  it("keeps the Studio 3D parity proof on a fresh runner behind a hard release gate", () => {
    const packageManifest = readJson("package.json");
    const workflow = readYaml(".github/workflows/ci.yml");
    const parityJob = workflow.jobs?.["studio-3d-runtime"];
    const paritySteps = parityJob?.steps ?? [];
    const parityCommands = runCommands(parityJob);
    const releaseGate = workflow.jobs?.verify;

    const playwrightVersion = packageManifest.devDependencies?.playwright;
    expect(playwrightVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(packageManifest.devDependencies?.["@playwright/test"]).toBe(playwrightVersion);

    // The proof runs parallel to core on its own VM: no `needs`, no services, nothing shared.
    // 9a8f9f67 pinned every ci.yml job to ubuntu-24.04 so the runner image cannot drift under
    // the merge checks; a pinned image is still a fresh VM of its own.
    expect(parityJob).toMatchObject({
      "runs-on": "ubuntu-24.04",
      "timeout-minutes": 20,
      env: {
        NODE_OPTIONS: "--max-old-space-size=8192",
      },
    });
    expect(parityJob?.needs).toBeUndefined();
    expect(parityJob?.if).toBeUndefined();
    expect(parityJob?.services).toBeUndefined();
    // The trailing upload-artifact is the failure evidence path, not a runner dependency: it runs
    // only `if: failure()` and touches nothing before the proof. This job had failed seven times in
    // a row leaving no page state behind, which is why the sibling studio-3d-visual job already
    // carries the same step. Keeping it in this pinned list means a *new* action still trips the
    // contract, which is what "fresh runner" is guarding.
    expect(usesActions(parityJob)).toEqual([
      "actions/checkout@v6",
      "pnpm/action-setup@v6",
      "actions/setup-node@v6",
      "actions/upload-artifact@v4",
    ]);

    const checkout = paritySteps.find((step) => step.uses === "actions/checkout@v6");
    expect(checkout?.with?.["persist-credentials"]).toBe(false);

    const installIndex = parityCommands.indexOf("pnpm install --frozen-lockfile");
    const browserInstallIndex = parityCommands.indexOf(PLAYWRIGHT_INSTALL);
    const buildIndex = parityCommands.indexOf("pnpm run build:bundle");
    const parityIndex = parityCommands.indexOf(HEADED_PARITY_COMMAND);
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(browserInstallIndex).toBeGreaterThan(installIndex);
    expect(buildIndex).toBeGreaterThan(browserInstallIndex);
    expect(parityIndex).toBeGreaterThan(buildIndex);
    expect(
      parityCommands.filter((command) => command === HEADED_PARITY_COMMAND),
    ).toHaveLength(1);
    expect(parityCommands).not.toContain("pnpm run verify:studio-3d-console");

    const parityStep = paritySteps.find((step) => step.run === HEADED_PARITY_COMMAND);
    expect(parityStep?.if).toBeUndefined();
    expect(parityStep?.["continue-on-error"]).not.toBe(true);

    // No other job may run the headed parity proof: it belongs on this isolated runner only.
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      if (jobId === "studio-3d-runtime") continue;
      expect(runCommands(job).some((command) => command.includes("verify:studio-3d-console")), jobId)
        .toBe(false);
    }

    // The release-facing "CI / verify" check is core AND the proof. It needs the five core gates
    // directly rather than the `core` job: a gate job also waits for a runner, and on a saturated
    // queue that wait alone cost 30 minutes per hop (run 2643). A failed or cancelled upstream job
    // must still produce a failing verify, never a merge-neutral skipped one, so the gate always
    // runs and reads every result itself.
    expect(releaseGate?.name).toBe("verify");
    expect(releaseGate?.needs).toEqual([
      ...workflow.jobs.core.needs,
      "studio-3d-runtime",
    ]);
    expect(releaseGate?.if).toBe("${{ always() }}");
    expect(releaseGate?.services).toBeUndefined();
    expect(usesActions(releaseGate)).toEqual([]);
    const releaseGateStep = releaseGate?.steps?.find(
      (step) =>
        step.name === "Require every core gate and the Studio 3D runtime proof to succeed",
    );
    expect(releaseGateStep?.env?.GATE_RESULTS).toBe("${{ toJSON(needs) }}");
    expect(releaseGateStep?.run).toContain('select(.value.result != "success")');
    expect(releaseGateStep?.run).toContain("exit 1");
    expect(releaseGateStep?.if).toBeUndefined();
    expect(releaseGateStep?.["continue-on-error"]).not.toBe(true);
  });

  it("splits the browser gates into lanes that each build the bundle once", () => {
    const workflow = readYaml(".github/workflows/ci.yml");
    const spec = readText("e2e/studio-3d-visual-verification.spec.ts");

    // The 3D visual suite: one `@slow` case (7.5 minutes on SwiftShader) alone in one lane, every
    // other case in the second. Playwright's `--shard` splits by case count, which cannot balance
    // a single seven-minute case, so the split is by tag.
    const visualJob = workflow.jobs?.["studio-3d-visual"];
    expect(visualJob?.name).toBe("studio-3d-visual (${{ matrix.lane }})");
    expect(visualJob?.strategy?.["fail-fast"]).toBe(false);
    expect(visualJob?.strategy?.matrix?.include?.map((entry) => entry.filter)).toEqual([
      "--grep=@slow",
      "--grep-invert=@slow",
    ]);
    // No `--` between the script and the filter: pnpm 11 forwards a standalone `--` verbatim and
    // Playwright stops reading options at it, so both lanes ran the whole suite (run 2643).
    expect(runCommands(visualJob)).toContain(
      "pnpm run verify:studio-3d-visual ${{ matrix.filter }}",
    );
    expect(spec.match(/\{ tag: "@slow" \}/gu)).toHaveLength(1);
    expect(spec).toContain(
      'test("3D 배경이 기본 진입 경로에서 캔버스에 실제로 붙는다", { tag: "@slow" }',
    );

    // The in-app sweeps: two jobs, each with its own bundle build, covering the four verifiers
    // exactly once between them.
    const routeJob = workflow.jobs?.["studio-inapp-browser"];
    const featureJob = workflow.jobs?.["studio-inapp-feature-sweep"];
    const routeCommands = runCommands(routeJob);
    const featureCommands = runCommands(featureJob);
    expect(routeCommands).toContain("pnpm run build:bundle");
    expect(featureCommands).toContain("pnpm run build:bundle");
    expect(routeCommands).toContain("pnpm run verify:studio-inapp-browser");
    expect(routeCommands).toContain("pnpm run verify:studio-mobile-top");
    expect(featureCommands).toContain("pnpm run verify:studio-inapp-feature-sweep");
    expect(
      featureCommands.some((command) => command.includes("verify:studio-bg3d-inapp-editor")),
    ).toBe(true);
    for (const job of [routeJob, featureJob]) {
      const checkout = (job?.steps ?? []).find((step) => step.uses === "actions/checkout@v6");
      expect(checkout?.with?.["persist-credentials"]).toBe(false);
      expect(job?.needs).toBeUndefined();
    }

    // Every browser gate serves the same dist the tsc-inclusive `build` job produces; only the
    // `build` job pays for tsc, and it pays exactly once.
    const everyCommand = Object.values(workflow.jobs ?? {}).flatMap(runCommands);
    expect(everyCommand.filter((command) => command === "pnpm run build")).toHaveLength(1);
    expect(runCommands(workflow.jobs?.["studio-filter-dialog"])).toContain("pnpm run build:bundle");
  });
});
