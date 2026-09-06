#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STUDIO_THIRD_PARTY_REUSE_REGISTRY_PATH =
  "docs/third-party/studio-reuse-registry.json";

export const STUDIO_THIRD_PARTY_REUSE_KINDS = Object.freeze([
  "source-code",
  "brush",
  "3d-asset",
  "model-weight",
  "ui-asset",
  "trademark-asset",
  "license-text",
]);

export const STUDIO_THIRD_PARTY_EVIDENCE_TYPES = Object.freeze([
  "public-license",
  "rights-holder-permission",
  "public-domain",
  "user-owned",
]);

export const STUDIO_THIRD_PARTY_ALLOWED_USES = Object.freeze([
  "commercial-use",
  "modify",
  "redistribute",
  "bundle",
  "brand-use",
  "model-output-use",
]);

const KIND_SET = new Set(STUDIO_THIRD_PARTY_REUSE_KINDS);
const EVIDENCE_TYPE_SET = new Set(STUDIO_THIRD_PARTY_EVIDENCE_TYPES);
const ALLOWED_USE_SET = new Set(STUDIO_THIRD_PARTY_ALLOWED_USES);
const INTEGRATION_MODES = new Set(["vendored", "runtime-download"]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PRIVATE_EVIDENCE_PATTERN = /^private-record:sha256:[0-9a-f]{64}$/u;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateHttpsUrl(value, label, issues) {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    issues.push(`${label} must be a non-empty trimmed HTTPS URL`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.includes(".")) {
      issues.push(`${label} must be a public HTTPS URL`);
    }
  } catch {
    issues.push(`${label} must be a valid HTTPS URL`);
  }
}

function isSafeRepositoryPath(value) {
  if (typeof value !== "string" || value.trim() !== value || !value) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function validateEvidenceReference(value, label, issues) {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    issues.push(`${label} must be a non-empty evidence reference`);
    return;
  }
  if (value.startsWith("https://")) {
    validateHttpsUrl(value, label, issues);
    return;
  }
  if (value.startsWith("repo:")) {
    if (!isSafeRepositoryPath(value.slice("repo:".length))) {
      issues.push(`${label} repo: reference must point to a safe repository path`);
    }
    return;
  }
  if (PRIVATE_EVIDENCE_PATTERN.test(value)) return;
  issues.push(`${label} must be HTTPS, repo:<path>, or private-record:sha256:<digest>`);
}

function requiredUsesFor(entry) {
  const required = new Set();
  if (entry.kind === "license-text") {
    required.add("redistribute");
    required.add("bundle");
    return required;
  }

  required.add("commercial-use");
  if (entry.integrationMode === "vendored") {
    required.add("redistribute");
    required.add("bundle");
  }
  if (["source-code", "brush", "3d-asset", "ui-asset"].includes(entry.kind)) {
    required.add("modify");
  }
  if (entry.kind === "model-weight") required.add("model-output-use");
  if (entry.kind === "trademark-asset") required.add("brand-use");
  return required;
}

export function validateStudioThirdPartyReuseRegistry(registry) { // NOSONAR javascript:S3776
  const issues = [];
  if (!isObject(registry)) return ["registry must be an object"];
  if (registry.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (typeof registry.updatedAt !== "string" || !DATE_PATTERN.test(registry.updatedAt)) {
    issues.push("updatedAt must use YYYY-MM-DD");
  }
  if (typeof registry.purpose !== "string" || registry.purpose.trim().length < 50) {
    issues.push("purpose must describe evidence-gated exact reuse and independent fallback");
  }
  if (!Array.isArray(registry.entries)) {
    issues.push("entries must be an array");
    return issues;
  }

  const ids = new Set();
  const destinationOwners = new Map();

  registry.entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    if (!isObject(entry)) {
      issues.push(`${prefix} must be an object`);
      return;
    }

    if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
      issues.push(`${prefix}.id must be lowercase kebab-case`);
    } else if (ids.has(entry.id)) {
      issues.push(`${prefix}.id duplicates ${entry.id}`);
    } else {
      ids.add(entry.id);
    }

    if (typeof entry.name !== "string" || entry.name.trim() !== entry.name || !entry.name) {
      issues.push(`${prefix}.name must be a non-empty trimmed string`);
    }
    if (!KIND_SET.has(entry.kind)) {
      issues.push(`${prefix}.kind is unsupported: ${String(entry.kind)}`);
    }
    if (!INTEGRATION_MODES.has(entry.integrationMode)) {
      issues.push(`${prefix}.integrationMode must be vendored or runtime-download`);
    }
    if (entry.status !== "approved") {
      issues.push(`${prefix}.status must be approved before exact reuse`);
    }

    validateHttpsUrl(entry.sourceUrl, `${prefix}.sourceUrl`, issues);
    if (typeof entry.sourceVersion !== "string" || !entry.sourceVersion.trim()) {
      issues.push(`${prefix}.sourceVersion must pin a release, revision, or immutable version`);
    }
    if (typeof entry.sourceHash !== "string" || !SHA256_PATTERN.test(entry.sourceHash)) {
      issues.push(`${prefix}.sourceHash must use sha256:<64 lowercase hex>`);
    }
    if (typeof entry.licenseId !== "string" || !entry.licenseId.trim()) {
      issues.push(`${prefix}.licenseId must identify the license or permission grant`);
    }

    const evidenceType = isObject(entry.evidence) ? entry.evidence.type : null;
    if (!isObject(entry.evidence)) {
      issues.push(`${prefix}.evidence must be an object`);
    } else {
      if (!EVIDENCE_TYPE_SET.has(entry.evidence.type)) {
        issues.push(`${prefix}.evidence.type is unsupported: ${String(entry.evidence.type)}`);
      }
      validateEvidenceReference(entry.evidence.reference, `${prefix}.evidence.reference`, issues);
      if (typeof entry.evidence.reviewedAt !== "string" || !DATE_PATTERN.test(entry.evidence.reviewedAt)) {
        issues.push(`${prefix}.evidence.reviewedAt must use YYYY-MM-DD`);
      }
    }

    if (evidenceType === "public-license" || entry.licenseUrl != null) {
      validateHttpsUrl(entry.licenseUrl, `${prefix}.licenseUrl`, issues);
    }
    if (
      (evidenceType === "rights-holder-permission" || evidenceType === "user-owned") &&
      typeof entry.licenseId === "string" &&
      !entry.licenseId.startsWith("LicenseRef-")
    ) {
      issues.push(`${prefix}.licenseId must use LicenseRef-* for private or user-owned grants`);
    }

    if (!Array.isArray(entry.allowedUses) || entry.allowedUses.length === 0) {
      issues.push(`${prefix}.allowedUses must contain explicit rights`);
    } else {
      const uses = new Set();
      for (const [useIndex, use] of entry.allowedUses.entries()) {
        if (!ALLOWED_USE_SET.has(use)) {
          issues.push(`${prefix}.allowedUses[${useIndex}] is unsupported: ${String(use)}`);
          continue;
        }
        if (uses.has(use)) issues.push(`${prefix}.allowedUses duplicates ${use}`);
        uses.add(use);
      }
      for (const requiredUse of requiredUsesFor(entry)) {
        if (!uses.has(requiredUse)) {
          issues.push(`${prefix}.allowedUses must include ${requiredUse}`);
        }
      }
    }

    if (!Array.isArray(entry.destinationPaths) || entry.destinationPaths.length === 0) {
      issues.push(`${prefix}.destinationPaths must list every integration destination`);
    } else {
      const localPaths = new Set();
      for (const [pathIndex, destinationPath] of entry.destinationPaths.entries()) {
        if (!isSafeRepositoryPath(destinationPath)) {
          issues.push(`${prefix}.destinationPaths[${pathIndex}] is not a safe repository path`);
          continue;
        }
        if (localPaths.has(destinationPath)) {
          issues.push(`${prefix}.destinationPaths duplicates ${destinationPath}`);
        }
        localPaths.add(destinationPath);
        const owner = destinationOwners.get(destinationPath);
        if (owner && owner !== entry.id) {
          issues.push(`${prefix}.destinationPaths claims ${destinationPath}, already owned by ${owner}`);
        } else if (entry.id) {
          destinationOwners.set(destinationPath, entry.id);
        }
      }
    }

    if (!isObject(entry.attribution) || typeof entry.attribution.required !== "boolean") {
      issues.push(`${prefix}.attribution must declare required as boolean`);
    } else if (entry.attribution.required) {
      if (!isSafeRepositoryPath(entry.attribution.noticePath)) {
        issues.push(`${prefix}.attribution.noticePath must be a safe repository path when required`);
      }
    } else if (entry.attribution.noticePath != null && !isSafeRepositoryPath(entry.attribution.noticePath)) {
      issues.push(`${prefix}.attribution.noticePath must be null or a safe repository path`);
    }
  });

  return issues;
}

export function summarizeStudioThirdPartyReuseRegistry(registry) {
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const byKind = Object.fromEntries(STUDIO_THIRD_PARTY_REUSE_KINDS.map((kind) => [kind, 0]));
  for (const entry of entries) {
    if (entry && typeof entry.kind === "string" && entry.kind in byKind) byKind[entry.kind] += 1;
  }
  return Object.freeze({ entryCount: entries.length, byKind: Object.freeze(byKind) });
}

function main() {
  const filePath = path.resolve(
    process.cwd(),
    process.argv[2] ?? STUDIO_THIRD_PARTY_REUSE_REGISTRY_PATH,
  );
  const registry = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const issues = validateStudioThirdPartyReuseRegistry(registry);
  if (issues.length > 0) {
    console.error(`Studio third-party reuse registry failed: ${issues.length} issue(s)`);
    for (const issue of issues) console.error(` - ${issue}`);
    process.exitCode = 1;
    return;
  }
  const summary = summarizeStudioThirdPartyReuseRegistry(registry);
  console.log(`Studio third-party reuse registry valid: ${summary.entryCount} approved entries`);
  console.log(JSON.stringify(summary, null, 2));
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
