import assert from "node:assert/strict";
import fs from "node:fs";
import nodeTest from "node:test";
import { test as vitestTest } from "vitest";

const test = process.env.VITEST ? vitestTest : nodeTest;

import {
  STUDIO_SEVEN_DAY_CAMPAIGN_CONFIG_PATH,
} from "./studio-seven-day-campaign.mjs";
import { evaluateStudioCampaignPatch } from "./studio-campaign-patch-policy.mjs";

const config = JSON.parse(fs.readFileSync(STUDIO_SEVEN_DAY_CAMPAIGN_CONFIG_PATH, "utf8"));

const change = (path, additions = 10, deletions = 0, extra = {}) => ({
  status: "M",
  path,
  additions,
  deletions,
  binary: false,
  oldMode: "100644",
  newMode: "100644",
  ...extra,
});

test("accepts a bounded source change accompanied by a focused test", () => {
  const result = evaluateStudioCampaignPatch(config, [
    change("apps/web/src/domains/creator/studio-smart-shape-edit.ts", 80, 3),
    change("apps/web/src/domains/creator/studio-smart-shape-edit.test.ts", 70, 0, { status: "A" }),
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.sourceChanged, true);
  assert.equal(result.testChanged, true);
  assert.equal(result.changedFiles, 2);
  assert.equal(result.changedLines, 153);
  assert.equal(result.fileModeChanged, false);
});

test("rejects source changes without a focused test", () => {
  const result = evaluateStudioCampaignPatch(config, [
    change("apps/web/src/domains/creator/studio-new-engine.ts", 120, 0, { status: "A" }),
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("require at least one focused test")));
});

test("rejects workflow, dependency, lockfile, environment, deployment, and database migration mutations", () => {
  const result = evaluateStudioCampaignPatch(config, [
    change(".github/workflows/agent.yml"),
    change("package.json"),
    change("pnpm-lock.yaml"),
    change(".env.production"),
    change("deploy/oci/service.sh"),
    change("apps/api/src/db/migrations/9999_campaign.sql"),
    change("apps/api/src/db/schema.ts"),
    change("scripts/run-production-database-migrations.mjs"),
  ]);

  assert.equal(result.ok, false);
  for (const pathname of [
    ".github/workflows/agent.yml",
    "package.json",
    "pnpm-lock.yaml",
    ".env.production",
    "deploy/oci/service.sh",
    "apps/api/src/db/migrations/9999_campaign.sql",
    "apps/api/src/db/schema.ts",
    "scripts/run-production-database-migrations.mjs",
  ]) {
    assert.ok(result.issues.some((issue) => issue.includes(pathname)));
  }
  assert.equal(result.workflowChanged, true);
  assert.equal(result.dependencyChanged, true);
});

test("rejects build configuration, verification scripts, tools, and arbitrary root files", () => {
  const result = evaluateStudioCampaignPatch(config, [
    change("vite.config.ts"),
    change("scripts/check-studio-bundle.mjs"),
    change("tools/generated-runner.mjs"),
    change("unexpected-root.json"),
  ]);

  assert.equal(result.ok, false);
  for (const pathname of [
    "vite.config.ts",
    "scripts/check-studio-bundle.mjs",
    "tools/generated-runner.mjs",
    "unexpected-root.json",
  ]) {
    assert.ok(result.issues.some((issue) => issue.includes(pathname)));
  }
});

test("rejects patches that exceed changed-file or changed-line budgets", () => {
  const tooManyFiles = Array.from(
    { length: config.agent.maxChangedFiles + 1 },
    (_, index) => change(`docs/campaign/note-${index}.md`, 1),
  );
  const fileResult = evaluateStudioCampaignPatch(config, tooManyFiles);
  assert.equal(fileResult.ok, false);
  assert.ok(fileResult.issues.some((issue) => issue.includes("changed files exceed limit")));

  const lineResult = evaluateStudioCampaignPatch(config, [
    change("docs/campaign/large.md", config.agent.maxChangedLines + 1),
  ]);
  assert.equal(lineResult.ok, false);
  assert.ok(lineResult.issues.some((issue) => issue.includes("changed lines exceed limit")));
});

test("rejects file deletion and binary payload mutations", () => {
  const result = evaluateStudioCampaignPatch(config, [
    change("apps/web/src/domains/creator/legacy.ts", 0, 40, { status: "D", newMode: "000000" }),
    change("apps/web/public/assets/external-model.glb", 0, 0, { status: "A", binary: true }),
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("may not delete files")));
  assert.ok(result.issues.some((issue) => issue.includes("binary payloads")));
});

test("rejects symbolic links and submodules even inside allowed source paths", () => {
  const result = evaluateStudioCampaignPatch(config, [
    change("apps/web/src/domains/creator/external-link.ts", 1, 0, {
      status: "A",
      oldMode: "000000",
      newMode: "120000",
    }),
    change("vendor/external-engine", 1, 0, {
      status: "A",
      oldMode: "000000",
      newMode: "160000",
    }),
    change("apps/web/src/domains/creator/external-link.test.ts", 20, 0, { status: "A" }),
    change("docs/third-party/studio-reuse-registry.json", 20, 1),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.fileModeChanged, true);
  assert.ok(result.issues.some((issue) => issue.includes("symbolic links")));
  assert.ok(result.issues.some((issue) => issue.includes("submodules")));
});

test("external payload paths require an exact reuse-registry update and focused test", () => {
  const withoutRegistry = evaluateStudioCampaignPatch(config, [
    change("vendor/paint-engine/index.ts", 50, 0, { status: "A" }),
    change("tests/vendor/paint-engine.test.ts", 30, 0, { status: "A" }),
  ]);
  assert.equal(withoutRegistry.ok, false);
  assert.equal(withoutRegistry.externalPayload, true);
  assert.ok(withoutRegistry.issues.some((issue) => issue.includes("reuse-registry.json")));

  const withoutTest = evaluateStudioCampaignPatch(config, [
    change("vendor/paint-engine/index.ts", 50, 0, { status: "A" }),
    change("docs/third-party/studio-reuse-registry.json", 20, 1),
  ]);
  assert.equal(withoutTest.ok, false);
  assert.ok(withoutTest.issues.some((issue) => issue.includes("focused test")));

  const withRegistryAndTest = evaluateStudioCampaignPatch(config, [
    change("vendor/paint-engine/index.ts", 50, 0, { status: "A" }),
    change("tests/vendor/paint-engine.test.ts", 30, 0, { status: "A" }),
    change("docs/third-party/studio-reuse-registry.json", 20, 1),
  ]);
  assert.equal(withRegistryAndTest.ok, true);
  assert.equal(withRegistryAndTest.registryChanged, true);
});

test("an empty agent diff is explicitly rejected", () => {
  const result = evaluateStudioCampaignPatch(config, []);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, ["patch is empty"]);
});
