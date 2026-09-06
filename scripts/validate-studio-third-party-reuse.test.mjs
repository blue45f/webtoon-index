import assert from "node:assert/strict";
import fs from "node:fs";
import nodeTest from "node:test";
import { test as vitestTest } from "vitest";

const test = process.env.VITEST ? vitestTest : nodeTest;

import {
  STUDIO_THIRD_PARTY_REUSE_REGISTRY_PATH,
  validateStudioThirdPartyReuseRegistry,
} from "./validate-studio-third-party-reuse.mjs";

const baseRegistry = () => ({
  schemaVersion: 1,
  updatedAt: "2026-09-02",
  purpose:
    "Evidence-gated registry for exact third-party reuse; when rights are absent or unclear, ToonSpectrum independently reimplements only the capability and workflow.",
  entries: [],
});

const sourceCodeEntry = () => ({
  id: "sample-render-core",
  name: "Sample Render Core",
  kind: "source-code",
  integrationMode: "vendored",
  status: "approved",
  sourceUrl: "https://github.com/example/render-core",
  sourceVersion: "v1.2.3",
  sourceHash: `sha256:${"a".repeat(64)}`,
  licenseId: "Apache-2.0",
  licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
  evidence: {
    type: "public-license",
    reference: "https://github.com/example/render-core/blob/v1.2.3/LICENSE",
    reviewedAt: "2026-09-02",
  },
  allowedUses: ["commercial-use", "modify", "redistribute", "bundle"],
  destinationPaths: ["vendor/render-core/index.ts"],
  attribution: {
    required: true,
    noticePath: "apps/web/public/legal/THIRD_PARTY_NOTICES.generated.md",
  },
});

test("the committed third-party reuse registry satisfies the evidence contract", () => {
  const registry = JSON.parse(fs.readFileSync(STUDIO_THIRD_PARTY_REUSE_REGISTRY_PATH, "utf8"));
  assert.deepEqual(validateStudioThirdPartyReuseRegistry(registry), []);
});

test("accepts an empty registry and an evidence-complete permissive source entry", () => {
  assert.deepEqual(validateStudioThirdPartyReuseRegistry(baseRegistry()), []);
  const registry = baseRegistry();
  registry.entries.push(sourceCodeEntry());
  assert.deepEqual(validateStudioThirdPartyReuseRegistry(registry), []);
});

test("rejects exact source reuse without modify, redistribute, and bundle rights", () => {
  const registry = baseRegistry();
  const entry = sourceCodeEntry();
  entry.allowedUses = ["commercial-use"];
  registry.entries.push(entry);
  const issues = validateStudioThirdPartyReuseRegistry(registry);
  assert.ok(issues.some((issue) => issue.includes("modify")));
  assert.ok(issues.some((issue) => issue.includes("redistribute")));
  assert.ok(issues.some((issue) => issue.includes("bundle")));
});

test("model weights require explicit output-use rights", () => {
  const registry = baseRegistry();
  const entry = sourceCodeEntry();
  entry.id = "sample-model";
  entry.kind = "model-weight";
  entry.allowedUses = ["commercial-use", "redistribute", "bundle"];
  entry.destinationPaths = ["models/sample/model.safetensors"];
  registry.entries.push(entry);
  const issues = validateStudioThirdPartyReuseRegistry(registry);
  assert.ok(issues.some((issue) => issue.includes("model-output-use")));
});

test("trademark assets require explicit brand-use permission", () => {
  const registry = baseRegistry();
  const entry = sourceCodeEntry();
  entry.id = "sample-logo";
  entry.kind = "trademark-asset";
  entry.allowedUses = ["commercial-use", "redistribute", "bundle"];
  entry.destinationPaths = ["apps/web/public/brands/sample-logo.svg"];
  registry.entries.push(entry);
  const issues = validateStudioThirdPartyReuseRegistry(registry);
  assert.ok(issues.some((issue) => issue.includes("brand-use")));
});

test("rejects unsafe destinations, mutable hashes, and unsupported evidence", () => {
  const registry = baseRegistry();
  const entry = sourceCodeEntry();
  entry.sourceHash = "main";
  entry.destinationPaths = ["../outside.ts"];
  entry.evidence.reference = "email from someone";
  registry.entries.push(entry);
  const issues = validateStudioThirdPartyReuseRegistry(registry);
  assert.ok(issues.some((issue) => issue.includes("sourceHash")));
  assert.ok(issues.some((issue) => issue.includes("safe repository path")));
  assert.ok(issues.some((issue) => issue.includes("private-record")));
});

test("accepts confidential written authorization by immutable digest without a public license URL", () => {
  const registry = baseRegistry();
  const entry = sourceCodeEntry();
  entry.evidence = {
    type: "rights-holder-permission",
    reference: `private-record:sha256:${"b".repeat(64)}`,
    reviewedAt: "2026-09-02",
  };
  entry.licenseId = "LicenseRef-RightsHolderPermission-2026-09-02";
  entry.licenseUrl = null;
  registry.entries.push(entry);
  assert.deepEqual(validateStudioThirdPartyReuseRegistry(registry), []);
});

test("private grants use an explicit LicenseRef identifier", () => {
  const registry = baseRegistry();
  const entry = sourceCodeEntry();
  entry.evidence = {
    type: "user-owned",
    reference: `private-record:sha256:${"c".repeat(64)}`,
    reviewedAt: "2026-09-02",
  };
  entry.licenseId = "proprietary";
  entry.licenseUrl = null;
  registry.entries.push(entry);
  const issues = validateStudioThirdPartyReuseRegistry(registry);
  assert.ok(issues.some((issue) => issue.includes("LicenseRef-*")));
});
