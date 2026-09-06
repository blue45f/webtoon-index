/**
 * scripts/verify-toolchain-coverage.mjs
 *
 * Proves that the test runner and the type checker are still LOOKING AT the code.
 *
 * `vitest.config.ts` pins an explicit `TEST_ROOTS` list precisely so that moving a tree
 * (`apps/web/src/` -> `apps/web/`, say) forces someone to edit that list. Its own comment then promises
 * that "scripts/verify-toolchain-coverage.mjs 의 수집 파일 수 floor 가 게이트를 터뜨린다" if the
 * edit is forgotten. That script did not exist. The comment described a guard nobody had built,
 * which is worse than no comment at all: every reader since has believed they were covered.
 *
 * Why a PER-ROOT floor rather than one global total. A single total cannot detect the failure it
 * needs to detect. Once the frontend lives under `apps/`, the `apps` glob absorbs the ~2,200 tests
 * that used to be counted under `src`, so the total is unchanged while `src` silently collects
 * nothing. Only a per-root floor notices that a tree stopped contributing.
 *
 * The same argument applies to `tsc`. `tsconfig.json` matches files by glob; if a tree moves out
 * from under those globs, the remaining matches keep the project non-empty, so **TS18003 never
 * fires and `tsc` exits 0 having checked almost nothing.** A green typecheck is not evidence that
 * anything was typechecked. This gate counts the actual input list.
 *
 * Usage:
 *   node scripts/verify-toolchain-coverage.mjs           # verify against the recorded floors
 *   node scripts/verify-toolchain-coverage.mjs --update  # re-record floors (review the diff!)
 *
 * Floors are a RATCHET: they only ever move up. Deleting tests is legitimate, but it has to be a
 * deliberate `--update` with the drop visible in the commit, never a silent slide.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { REPO_ROOT } from "./lib/repo-paths.mjs";

const BASELINE_PATH = join(REPO_ROOT, "scripts", "toolchain-coverage-baseline.json");
const VITEST_CONFIG_PATH = join(REPO_ROOT, "vitest.config.ts");

/**
 * Tolerance below the recorded floor. Zero on purpose: a single test file quietly leaving the
 * collection set is exactly the event this gate exists to catch, and unlike a byte-size ratchet
 * there is no measurement noise to absorb here.
 */
const ALLOWED_SHORTFALL = 0;

/**
 * Reads `TEST_ROOTS` out of vitest.config.ts rather than duplicating it. A second copy of the list
 * would drift, and a gate that checks a stale copy of the thing it guards is theatre.
 */
function readTestRoots() {
  const source = readFileSync(VITEST_CONFIG_PATH, "utf8");
  const match = source.match(/const\s+TEST_ROOTS\s*=\s*\[([^\]]*)\]/);
  if (!match) {
    throw new Error(
      "Could not find TEST_ROOTS in vitest.config.ts. If the collection roots moved or were "
      + "renamed, update this parser deliberately — do not delete the check.",
    );
  }
  const roots = [...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  if (roots.length === 0) {
    throw new Error("TEST_ROOTS parsed as empty. Refusing to certify zero coverage.");
  }
  return roots;
}

/**
 * Counts test files per root the way Vitest would, using git so that ignored and untracked
 * scratch files cannot inflate the number. `--cached --others --exclude-standard` matches what is
 * actually committed or stageable, which is the population a CI run would see.
 */
function countTestFilesByRoot(roots) {
  const stdout = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const testFile = /\.(test|spec)\.[cm]?[jt]sx?$/;
  const counts = Object.fromEntries(roots.map((root) => [root, 0]));
  for (const line of stdout.split("\n")) {
    const file = line.trim();
    if (!file || !testFile.test(file)) continue;
    for (const root of roots) {
      if (file === root || file.startsWith(`${root}/`)) {
        counts[root] += 1;
        break;
      }
    }
  }
  return counts;
}

/**
 * Asks the compiler itself what it is compiling. `--listFilesOnly` reports the resolved input set,
 * which is the only honest answer — reading the `include` globs would just re-derive the
 * assumption this gate is supposed to test. Declaration files and anything resolved out of
 * node_modules are excluded so the number tracks first-party source. Only existing files inside
 * the repository are counted, and a Set removes duplicate compiler output or package-manager chatter.
 */
function countTypecheckedFiles(project) {
  const configPath = join(REPO_ROOT, project);
  if (!existsSync(configPath)) return null;
  let stdout;
  try {
    stdout = execFileSync(
      "pnpm",
      ["exec", "tsc", "-p", project, "--listFilesOnly", "--incremental", "false", "--pretty", "false"],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
  } catch (error) {
    // `--listFilesOnly` still prints the file list when the project has type errors, so a non-zero
    // exit is not a reason to skip the count — this gate is about coverage, not correctness.
    stdout = error.stdout ?? "";
    if (!stdout) return null;
  }
  const files = new Set();
  for (const line of stdout.split("\n")) {
    const candidate = line.trim();
    if (!candidate || candidate.endsWith(".d.ts")) continue;
    const file = isAbsolute(candidate) ? candidate : resolve(REPO_ROOT, candidate);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    const repoRelative = relative(REPO_ROOT, file);
    if (
      repoRelative === ".."
      || repoRelative.startsWith(`..${sep}`)
      || isAbsolute(repoRelative)
      || repoRelative.split(sep).includes("node_modules")
    ) {
      continue;
    }
    files.add(repoRelative);
  }
  return files.size;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function main() { // NOSONAR javascript:S3776
  const update = process.argv.includes("--update");
  const roots = readTestRoots();
  const testCounts = countTestFilesByRoot(roots);
  const typecheckedFiles = countTypecheckedFiles("tsconfig.json");

  const measured = {
    testFilesByRoot: testCounts,
    testFilesTotal: Object.values(testCounts).reduce((a, b) => a + b, 0),
    typecheckedFiles,
  };

  if (update) {
    const next = {
      $comment:
        "Per-root floors for scripts/verify-toolchain-coverage.mjs. Ratchet only — regenerate with "
        + "`node scripts/verify-toolchain-coverage.mjs --update` and review the diff in the commit.",
      recordedAt: new Date().toISOString().slice(0, 10),
      ...measured,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`recorded floors -> ${relative(REPO_ROOT, BASELINE_PATH)}`);
    for (const root of roots) console.log(`  ${root}: ${testCounts[root]} test files`);
    console.log(`  typechecked files: ${typecheckedFiles ?? "(unavailable)"}`);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(
      `Missing ${relative(REPO_ROOT, BASELINE_PATH)}.\n`
      + "Record it once with: node scripts/verify-toolchain-coverage.mjs --update",
    );
    process.exit(1);
  }

  const failures = [];
  const notes = [];

  for (const root of roots) {
    const floor = baseline.testFilesByRoot?.[root];
    const actual = testCounts[root];
    if (floor === undefined) {
      notes.push(`new collection root "${root}" (${actual} files) — not yet in the baseline`);
      continue;
    }
    if (actual < floor - ALLOWED_SHORTFALL) {
      failures.push(
        `collection root "${root}" dropped from ${floor} to ${actual} test files. `
        + "If the tree moved, add its new location to TEST_ROOTS in vitest.config.ts; if tests were "
        + "deliberately removed, re-record with --update so the drop is visible in the commit.",
      );
    } else if (actual > floor) {
      notes.push(`${root}: ${floor} -> ${actual} (+${actual - floor})`);
    }
  }

  for (const root of Object.keys(baseline.testFilesByRoot ?? {})) {
    if (!roots.includes(root)) {
      failures.push(
        `collection root "${root}" disappeared from TEST_ROOTS in vitest.config.ts. Its `
        + `${baseline.testFilesByRoot[root]} test files are no longer collected by anything.`,
      );
    }
  }

  if (typeof baseline.typecheckedFiles === "number" && typeof typecheckedFiles === "number") {
    if (typecheckedFiles < baseline.typecheckedFiles - ALLOWED_SHORTFALL) {
      failures.push(
        `tsc input set shrank from ${baseline.typecheckedFiles} to ${typecheckedFiles} files. `
        + "A green typecheck over a shrinking input set is not evidence of anything — check whether "
        + "a tree moved out from under the tsconfig globs.",
      );
    } else if (typecheckedFiles > baseline.typecheckedFiles) {
      notes.push(`typechecked files: ${baseline.typecheckedFiles} -> ${typecheckedFiles}`);
    }
  }

  for (const note of notes) console.log(`note: ${note}`);

  if (failures.length > 0) {
    console.error("\ntoolchain coverage regressed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `toolchain coverage OK — ${measured.testFilesTotal} test files across ${roots.length} roots, `
    + `${typecheckedFiles ?? "?"} files typechecked.`,
  );
}

main();
