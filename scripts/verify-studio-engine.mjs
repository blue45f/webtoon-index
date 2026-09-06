#!/usr/bin/env node
/**
 * V11 engine-layer verification gate.
 *
 * 1. Integrity: the committed vello wasm pkg must match INTEGRITY.sha256
 *    (same release-contract idea as studio-hokusai-wasm — generated artifacts
 *    are pinned, never hand-edited).
 * 2. Contracts: typecheck every *-v11 package.
 * 3. Behavior: run the V11 test scope (packages, cross-renderer diff, shadow
 *    parity) through the root vitest config.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG_DIR = join(ROOT, "crates", "studio-engine-vello", "pkg");
// V12 lane 2 (ADR-0011): separate GPU artifact built with
// `wasm-pack build --target web --release --out-dir pkg-gpu -- --features gpu`.
const PKG_GPU_DIR = join(ROOT, "crates", "studio-engine-vello", "pkg-gpu");
// V12 lane 11 (ADR-0011): pinned libmypaint v1.6.1 emcc build (MyPaint
// reference parity lane) — artifacts + bridge sources are hash-pinned.
const LIBMYPAINT_DIR = join(
  ROOT,
  "packages",
  "studio-brush-platform",
  "src",
  "libmypaint",
);
// V12 lane 3 (ADR-0011): google/ink-stroke-modeler emscripten PoC artifact
// (commit-pinned wasm + C bridge, quarantined lane — see its README.md).
const INK_MODELER_DIR = join(
  ROOT,
  "packages",
  "studio-brush-platform",
  "src",
  "ink-modeler",
);
// V12 lane 3 / §11.2 (ADR-0011): google/ink brush-geometry mesh artifact
// (commit-pinned direct-emcc subset build + C bridge — see its README.md).
const INK_MESH_DIR = join(
  ROOT,
  "packages",
  "studio-brush-platform",
  "src",
  "ink-mesh",
);

function fail(message) {
  console.error(`verify:studio-engine FAILED — ${message}`);
  process.exit(1);
}

// 1. wasm pkg integrity (CPU lane + GPU browser lane)
function verifyPkgIntegrity(pkgDir, label, rebuildHint) {
  const manifest = readFileSync(join(pkgDir, "INTEGRITY.sha256"), "utf8");
  for (const line of manifest.split("\n")) {
    // Blank lines and `#` metadata pins (toolchain/source versions) are
    // allowed — the hokusai-style manifests carry build provenance comments.
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (!match) fail(`unparseable ${label} INTEGRITY line: ${line}`);
    const [, expected, file] = match;
    const actual = createHash("sha256")
      .update(readFileSync(join(pkgDir, file)))
      .digest("hex");
    if (actual !== expected) {
      fail(`${label}/${file} hash mismatch — ${rebuildHint}`);
    }
  }
  console.log(`vello wasm ${label} integrity: OK`);
}

verifyPkgIntegrity(
  PKG_DIR,
  "pkg",
  "rebuild via wasm-pack (crates/studio-engine-vello) and refresh INTEGRITY.sha256",
);
verifyPkgIntegrity(
  PKG_GPU_DIR,
  "pkg-gpu",
  "rebuild via `wasm-pack build --target web --release --out-dir pkg-gpu -- --features gpu` " +
    "(then re-apply the eslint-disable banner per docs/engines/vello-baseline.md §2) and refresh INTEGRITY.sha256",
);
verifyPkgIntegrity(
  INK_MODELER_DIR,
  "ink-modeler",
  "rebuild via emcc per packages/studio-brush-platform/src/ink-modeler/README.md " +
    "(re-apply the two-line @generated banner) and refresh INTEGRITY.sha256",
);
verifyPkgIntegrity(
  INK_MESH_DIR,
  "ink-mesh",
  "rebuild via emcc per packages/studio-brush-platform/src/ink-mesh/README.md " +
    "(re-apply the two-line @generated banner) and refresh INTEGRITY.sha256",
);
verifyPkgIntegrity(
  LIBMYPAINT_DIR,
  "libmypaint",
  "rebuild via packages/studio-brush-platform/src/libmypaint/bridge/build.sh " +
    "(pins libmypaint v1.6.1 + emcc, re-applies the eslint-disable banner and refreshes INTEGRITY.sha256)",
);

const STUDIO_ENGINE_PACKAGES = [
  "@toonspectrum/studio-project-model",
  "@toonspectrum/studio-engine-registry",
  "@toonspectrum/studio-command-registry",
  "@toonspectrum/studio-engine-skia",
  "@toonspectrum/studio-engine-vello",
  "@toonspectrum/studio-brush-platform",
  "@toonspectrum/studio-format-gateway",
];

// 2. package + benchmark-harness typechecks
const harnessTsc = spawnSync(
  "pnpm",
  ["exec", "tsc", "-p", "tests/benchmarks/harness/tsconfig.json"],
  { cwd: ROOT, stdio: "inherit" },
);
if (harnessTsc.status !== 0) fail("typecheck failed: tests/benchmarks/harness");
for (const name of STUDIO_ENGINE_PACKAGES) {
  const result = spawnSync("pnpm", ["--filter", name, "typecheck"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) fail(`typecheck failed: ${name}`);
}

// 3. V11 test scope
const test = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "packages/studio-project-model",
    "packages/studio-engine-registry",
    "packages/studio-command-registry",
    "packages/studio-engine-skia",
    "packages/studio-engine-vello",
    "packages/studio-brush-platform",
    "packages/studio-format-gateway",
    "tests/visual",
    "tests/fault-injection",
    "apps/web/src/domains/creator/studio-surface-plan-shadow.test.ts",
    "apps/web/src/domains/creator/filter/studio-filter-island-plan.test.ts",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
if (test.status !== 0) fail("V11 vitest scope failed");

console.log("verify:studio-engine PASSED");
