#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STUDIO_COMPETITOR_REGISTRY_PATH =
  "docs/benchmarks/studio-competitor-registry.json";

export const STUDIO_COMPETITOR_CATEGORIES = Object.freeze([
  "comic-drawing",
  "image-editor",
  "mobile-drawing",
  "natural-media",
  "vector-infinite-canvas",
  "storyboard",
  "animation-2d",
  "rigging-avatar",
  "3d-dcc",
  "material-marketplace",
  "collaboration-design",
  "ai-creative",
]);

const PRIORITIES = new Set(["P0", "P1", "P2"]);
const CATEGORY_SET = new Set(STUDIO_COMPETITOR_CATEGORIES);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FOCUS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MINIMUM_PRODUCT_COUNT = 50;
const TRUSTED_DOMAIN_BRIDGES = new Set([
  "adobe.com|mixamo.com",
  "mixamo.com|adobe.com",
  "corel.com|painterartist.com",
  "painterartist.com|corel.com",
]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHttpsUrl(value, label, issues) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    issues.push(`${label} must be a non-empty trimmed string`);
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      issues.push(`${label} must use https`);
      return null;
    }
    if (!url.hostname.includes(".")) {
      issues.push(`${label} must contain a public hostname`);
      return null;
    }
    return url;
  } catch {
    issues.push(`${label} must be a valid URL`);
    return null;
  }
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function domainFamily(hostname) {
  return String(hostname)
    .toLocaleLowerCase("en")
    .split(".")
    .filter(Boolean)
    .slice(-2)
    .join(".");
}

export function shareStudioOfficialDomainFamily(leftHostname, rightHostname) {
  const left = domainFamily(leftHostname);
  const right = domainFamily(rightHostname);
  if (!left || !right) return false;
  return left === right || TRUSTED_DOMAIN_BRIDGES.has(`${left}|${right}`);
}

export function validateStudioCompetitorRegistry(registry, options = {}) { // NOSONAR javascript:S3776
  const minimumProductCount =
    Number.isInteger(options.minimumProductCount) && options.minimumProductCount >= 0
      ? options.minimumProductCount
      : MINIMUM_PRODUCT_COUNT;
  const requireEveryCategory = options.requireEveryCategory !== false;
  const issues = [];

  if (!isObject(registry)) return ["registry must be an object"];
  if (registry.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (typeof registry.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(registry.updatedAt)) {
    issues.push("updatedAt must use YYYY-MM-DD");
  }
  if (typeof registry.purpose !== "string" || registry.purpose.trim().length < 40) {
    issues.push("purpose must explain the benchmarking and clean-room boundary");
  }
  if (!Array.isArray(registry.products)) {
    issues.push("products must be an array");
    return issues;
  }
  if (registry.products.length < minimumProductCount) {
    issues.push(
      `products must contain at least ${minimumProductCount} entries (found ${registry.products.length})`,
    );
  }

  const ids = new Set();
  const names = new Set();
  const categoryCounts = Object.fromEntries(
    STUDIO_COMPETITOR_CATEGORIES.map((category) => [category, 0]),
  );

  registry.products.forEach((product, index) => {
    const prefix = `products[${index}]`;
    if (!isObject(product)) {
      issues.push(`${prefix} must be an object`);
      return;
    }

    if (typeof product.id !== "string" || !ID_PATTERN.test(product.id)) {
      issues.push(`${prefix}.id must be a lowercase kebab-case identifier`);
    } else if (ids.has(product.id)) {
      issues.push(`${prefix}.id duplicates ${product.id}`);
    } else {
      ids.add(product.id);
    }

    const normalizedName =
      typeof product.name === "string" ? product.name.toLocaleLowerCase("en") : "";
    if (typeof product.name !== "string" || product.name.trim() !== product.name || !product.name) {
      issues.push(`${prefix}.name must be a non-empty trimmed string`);
    } else if (names.has(normalizedName)) {
      issues.push(`${prefix}.name duplicates ${product.name}`);
    } else {
      names.add(normalizedName);
    }

    if (typeof product.category !== "string" || !CATEGORY_SET.has(product.category)) {
      issues.push(`${prefix}.category is not supported: ${String(product.category)}`);
    } else {
      categoryCounts[product.category] += 1;
    }

    if (!PRIORITIES.has(product.priority)) {
      issues.push(`${prefix}.priority must be P0, P1, or P2`);
    }

    const officialUrl = parseHttpsUrl(product.officialUrl, `${prefix}.officialUrl`, issues);
    const watchUrl = parseHttpsUrl(product.watchUrl, `${prefix}.watchUrl`, issues);
    if (officialUrl && watchUrl) {
      const officialGitHubSource = watchUrl.hostname.toLocaleLowerCase("en") === "github.com";
      if (
        !officialGitHubSource &&
        !shareStudioOfficialDomainFamily(officialUrl.hostname, watchUrl.hostname)
      ) {
        issues.push(
          `${prefix}.watchUrl must stay on the official domain family or an official GitHub repository`,
        );
      }
    }

    if (!Array.isArray(product.focus) || product.focus.length === 0) {
      issues.push(`${prefix}.focus must contain at least one capability tag`);
    } else {
      const normalizedFocus = [];
      for (const [focusIndex, focus] of product.focus.entries()) {
        if (typeof focus !== "string" || !FOCUS_PATTERN.test(focus)) {
          issues.push(`${prefix}.focus[${focusIndex}] must be lowercase kebab-case`);
          continue;
        }
        normalizedFocus.push(focus);
      }
      if (uniqueStrings(normalizedFocus).length !== normalizedFocus.length) {
        issues.push(`${prefix}.focus must not contain duplicate tags`);
      }
    }
  });

  if (requireEveryCategory) {
    for (const [category, count] of Object.entries(categoryCounts)) {
      if (count === 0) issues.push(`category ${category} has no products`);
    }
  }
  return issues;
}

export function summarizeStudioCompetitorRegistry(registry) { // NOSONAR javascript:S3776
  const products = Array.isArray(registry?.products) ? registry.products : [];
  const byPriority = Object.fromEntries([...PRIORITIES].map((priority) => [priority, 0]));
  const byCategory = Object.fromEntries(
    STUDIO_COMPETITOR_CATEGORIES.map((category) => [category, 0]),
  );
  const focusCounts = new Map();

  for (const product of products) {
    if (typeof product?.priority === "string" && Object.hasOwn(byPriority, product.priority)) {
      byPriority[product.priority] += 1;
    }
    if (typeof product?.category === "string" && Object.hasOwn(byCategory, product.category)) {
      byCategory[product.category] += 1;
    }
    if (Array.isArray(product?.focus)) {
      for (const focus of product.focus) {
        if (typeof focus !== "string") continue;
        focusCounts.set(focus, (focusCounts.get(focus) ?? 0) + 1);
      }
    }
  }

  const topFocus = [...focusCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([focus, count]) => ({ focus, count }));

  return Object.freeze({
    productCount: products.length,
    byPriority: Object.freeze({ ...byPriority }),
    byCategory: Object.freeze({ ...byCategory }),
    topFocus: Object.freeze(topFocus),
  });
}

function main() {
  const filePath = path.resolve(
    process.cwd(),
    process.argv[2] ?? STUDIO_COMPETITOR_REGISTRY_PATH,
  );
  const registry = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const issues = validateStudioCompetitorRegistry(registry);
  if (issues.length > 0) {
    console.error(`Studio competitor registry validation failed: ${issues.length} issue(s)`);
    for (const issue of issues) console.error(` - ${issue}`);
    process.exitCode = 1;
    return;
  }

  const summary = summarizeStudioCompetitorRegistry(registry);
  console.log(
    `Studio competitor registry valid: ${summary.productCount} products across ${STUDIO_COMPETITOR_CATEGORIES.length} categories`,
  );
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
