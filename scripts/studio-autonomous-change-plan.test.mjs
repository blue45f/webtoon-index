import assert from "node:assert/strict";
import nodeTest from "node:test";
import { test as vitestTest } from "vitest";

const test = process.env.VITEST ? vitestTest : nodeTest;

import "./studio-merged-branch-cleanup.test.mjs";
import "./validate-studio-third-party-reuse.test.mjs";
import {
  classifyStudioChanges,
  summarizeStudioChangeClassification,
} from "./studio-autonomous-change-plan.mjs";

test("documentation-only changes do not trigger runtime risk gates", () => {
  const classification = classifyStudioChanges([
    "docs/studio-webgpu-notes.md",
    "README.md",
  ]);

  assert.equal(classification.docsOnly, true);
  assert.equal(classification.sourceChange, false);
  assert.equal(classification.highRisk, false);
  assert.equal(classification.needsBrowser, false);
  assert.equal(classification.needsBuild, false);
  assert.deepEqual(classification.categories, {
    canvas: false,
    storage: false,
    history: false,
    webgpu: false,
    ui: false,
    collaboration: false,
    deployment: false,
  });
  assert.match(summarizeStudioChangeClassification(classification), /documentation only/);
});

test("WebGPU renderer changes always inherit the canvas risk contract", () => {
  const classification = classifyStudioChanges([
    "packages/studio-engine-skia/src/webgpu/studio-present.wgsl",
  ]);

  assert.equal(classification.categories.webgpu, true);
  assert.equal(classification.categories.canvas, true);
  assert.equal(classification.highRisk, true);
  assert.equal(classification.needsBrowser, true);
  assert.equal(classification.needsBuild, true);
});

test("OPFS and recovery-journal changes trigger storage and browser gates", () => {
  const classification = classifyStudioChanges([
    "apps/web/src/domains/creator/persistence/studio-recovery-journal.ts",
    "apps/web/src/domains/creator/studio/components/runtime/studio-autosave-opfs-worker.ts",
  ]);

  assert.equal(classification.categories.storage, true);
  assert.equal(classification.highRisk, true);
  assert.equal(classification.needsBrowser, true);
  assert.equal(classification.needsBuild, true);
  assert.ok(classification.matches.storage.length >= 1);
});

test("command registry and undo stack changes trigger history and browser gates", () => {
  const classification = classifyStudioChanges([
    "packages/studio-command-registry/src/undo-transaction.ts",
  ]);

  assert.equal(classification.categories.history, true);
  assert.equal(classification.highRisk, true);
  assert.equal(classification.needsBrowser, true);
  assert.equal(classification.needsBuild, true);
});

test("inspector-only UI changes request browser and build validation without inventing storage risk", () => {
  const classification = classifyStudioChanges([
    "apps/web/src/domains/creator/inspector/StudioInspectorPanel.tsx",
  ]);

  assert.equal(classification.categories.ui, true);
  assert.equal(classification.categories.storage, false);
  assert.equal(classification.needsBrowser, true);
  assert.equal(classification.needsBuild, true);
});

test("deployment configuration is classified independently", () => {
  const classification = classifyStudioChanges([
    ".github/workflows/deploy-vercel.yml",
    "vite.config.ts",
  ]);

  assert.equal(classification.categories.deployment, true);
  assert.equal(classification.highRisk, false);
  assert.equal(classification.needsBrowser, false);
  assert.equal(classification.needsBuild, true);
});

test("control-plane workflow changes do not impersonate a runtime deployment", () => {
  const classification = classifyStudioChanges([
    ".github/workflows/studio-autonomous-risk-gate.yml",
    ".github/workflows/studio-seven-day-hourly-trigger.yml",
    "scripts/studio-competitor-watch.mjs",
  ]);

  assert.equal(classification.docsOnly, false);
  assert.equal(classification.sourceChange, true);
  assert.equal(classification.categories.deployment, false);
  assert.equal(classification.highRisk, false);
  assert.equal(classification.needsBrowser, false);
  assert.equal(classification.needsBuild, false);
  assert.match(summarizeStudioChangeClassification(classification), /general source change/);
});

test("paths are normalized, deduplicated, and sorted deterministically", () => {
  const classification = classifyStudioChanges([
    ".\\src\\domains\\creator\\canvas\\StudioCanvas.tsx",
    "apps/web/src/domains/creator/canvas/StudioCanvas.tsx",
    "  components/studio/brush/studio-brush-runtime.ts  ",
    "",
  ]);

  assert.deepEqual(classification.paths, [
    "apps/web/src/domains/creator/studio/components/brush/studio-brush-runtime.ts",
    "apps/web/src/domains/creator/canvas/StudioCanvas.tsx",
  ]);
  assert.equal(classification.changedCount, 2);
  assert.equal(classification.categories.canvas, true);
  assert.equal(classification.needsBrowser, true);
});

test("an empty diff remains explicit and does not run source gates", () => {
  const classification = classifyStudioChanges([]);

  assert.equal(classification.changedCount, 0);
  assert.equal(classification.sourceChange, false);
  assert.equal(classification.highRisk, false);
  assert.equal(classification.needsBrowser, false);
  assert.equal(summarizeStudioChangeClassification(classification), "no changed files");
});
