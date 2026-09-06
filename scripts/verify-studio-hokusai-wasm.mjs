#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOKUSAI_INTEGRITY_MANIFEST_PATH,
  HOKUSAI_PACKAGE_DIRECTORY,
  HOKUSAI_PKG_DIRECTORY,
  HOKUSAI_RELEASE_TOOLCHAIN,
  REPOSITORY_ROOT,
  validateHokusaiReleaseContract,
} from "./studio-hokusai-wasm-release-contract.mjs";

const REQUIRED_PACKAGE_FILES = Object.freeze([
  "LICENSE-APACHE",
  "LICENSE-MIT",
  "LICENSE-UNICODE",
  "README.md",
  "package.json",
  "studio_hokusai_wasm.d.ts",
  "studio_hokusai_wasm.js",
  "studio_hokusai_wasm_bg.wasm",
  "studio_hokusai_wasm_bg.wasm.d.ts",
]);

const BUILD_INPUT_FILES = Object.freeze([
  "Cargo.lock",
  "Cargo.toml",
  "LICENSE-APACHE",
  "LICENSE-MIT",
  "LICENSE-UNICODE",
  "README.md",
  "src/lib.rs",
]);

/*
 * The manifest deliberately seals ONLY the crate inputs and the built package.
 *
 * It used to seal the repo's root package.json and this release script too, which meant a
 * script rename or a dependency bump invalidated a supply-chain attestation that had
 * nothing to do with either, and repairing it demanded a full rebuild on the pinned Rust
 * toolchain. That is friction without a matching guarantee: the license inventory is
 * re-validated from package.json and the lockfile on every `audit:licenses` run anyway.
 * What only the manifest can prove is that the checked-in WASM is the one this checked-in
 * Rust source builds — so that, and nothing else, is what it seals.
 */

const REQUIRED_PACKAGE_JSON_FILES = Object.freeze([
  "INTEGRITY.sha256",
  "LICENSE-APACHE",
  "LICENSE-MIT",
  "LICENSE-UNICODE",
  "README.md",
  "studio_hokusai_wasm.d.ts",
  "studio_hokusai_wasm.js",
  "studio_hokusai_wasm_bg.wasm",
  "studio_hokusai_wasm_bg.wasm.d.ts",
]);

const FORBIDDEN_WASM_PATH_MARKERS = Object.freeze([
  "/Users/",
  "/home/",
  "/toonspectrum-build/tmp-root/toonspectrum-hokusai-wasm-",
  "\\Users\\",
]);

const RELEASE_SOURCE_DATE_EPOCH = "946684800";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertRegularFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`${label} must be a regular file: ${path}.`);
  }
}

function integrityRecordPath(kind, path) {
  return `${kind}/${path.replaceAll("\\", "/")}`;
}

function collectIntegrityRecords({
  packageDirectory = HOKUSAI_PACKAGE_DIRECTORY,
  pkgDirectory = HOKUSAI_PKG_DIRECTORY,
} = {}) {
  return [
    ...BUILD_INPUT_FILES.map((path) => ({
      path: integrityRecordPath("source", path),
      digest: sha256File(join(packageDirectory, path)),
    })),
    ...REQUIRED_PACKAGE_FILES.map((path) => ({
      path: integrityRecordPath("pkg", path),
      digest: sha256File(join(pkgDirectory, path)),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export function renderIntegrityManifest(options = {}) {
  const records = collectIntegrityRecords(options);
  return `# ToonSpectrum Studio Hokusai WASM reproducible release manifest
# rustc ${HOKUSAI_RELEASE_TOOLCHAIN.rustc}
# cargo ${HOKUSAI_RELEASE_TOOLCHAIN.cargo}
# wasm-pack ${HOKUSAI_RELEASE_TOOLCHAIN.wasmPack}
# wasm-bindgen 0.2.123
${records.map(({ digest, path }) => `${digest}  ${path}`).join("\n")}
`;
}

function assertExactFlatPackageDirectory(
  directory,
  expectedFileNames,
) {
  const actualEntries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of actualEntries) {
    if (!entry.isFile()) {
      throw new Error(
        `Hokusai WASM package may contain only reviewed top-level regular files; found ${entry.name}.`,
      );
    }
  }
  const actualFileNames = actualEntries.map(({ name }) => name);
  const expected = [...expectedFileNames].sort((left, right) =>
    left.localeCompare(right),
  );
  if (JSON.stringify(actualFileNames) !== JSON.stringify(expected)) {
    throw new Error(
      `Hokusai WASM package file set changed.\nExpected: ${expected.join(", ")}\nActual: ${actualFileNames.join(", ")}`,
    );
  }
}

export function assertSafeHokusaiWasmBinary(
  wasmPath,
  {
    additionalForbiddenMarkers = [],
  } = {},
) {
  assertRegularFile(wasmPath, "Hokusai WASM binary");
  const wasm = readFileSync(wasmPath);
  if (!WebAssembly.validate(wasm)) {
    throw new Error("Hokusai WASM binary is not a valid WebAssembly module.");
  }
  const markers = [
    ...FORBIDDEN_WASM_PATH_MARKERS,
    homedir(),
    REPOSITORY_ROOT,
    tmpdir(),
    ...additionalForbiddenMarkers,
  ]
    .filter((marker) => typeof marker === "string" && marker.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const marker of new Set(markers)) {
    if (wasm.includes(Buffer.from(marker))) {
      throw new Error(
        `Hokusai WASM binary contains a forbidden local build path marker: ${marker}.`,
      );
    }
  }
}

export function verifyCheckedInHokusaiArtifacts({ // NOSONAR javascript:S3776
  packageDirectory = HOKUSAI_PACKAGE_DIRECTORY,
  pkgDirectory = HOKUSAI_PKG_DIRECTORY,
  integrityManifestPath = HOKUSAI_INTEGRITY_MANIFEST_PATH,
} = {}) {
  for (const path of [...BUILD_INPUT_FILES, ...REQUIRED_PACKAGE_FILES]) {
    const baseDirectory = BUILD_INPUT_FILES.includes(path)
      ? packageDirectory
      : pkgDirectory;
    const candidate = join(baseDirectory, path);
    if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
      throw new Error(
        `Hokusai WASM release input/output is missing: ${relative(REPOSITORY_ROOT, candidate)}.`,
      );
    }
  }
  if (
    !existsSync(integrityManifestPath)
    || !lstatSync(integrityManifestPath).isFile()
  ) {
    throw new Error(
      `Hokusai WASM integrity manifest is missing: ${relative(REPOSITORY_ROOT, integrityManifestPath)}.`,
    );
  }

  assertExactFlatPackageDirectory(pkgDirectory, [
    ...REQUIRED_PACKAGE_FILES,
    basename(integrityManifestPath),
  ]);

  const expectedManifest = renderIntegrityManifest({
    packageDirectory,
    pkgDirectory,
  });
  const actualManifest = readFileSync(integrityManifestPath, "utf8");
  if (actualManifest !== expectedManifest) {
    throw new Error(
      "Hokusai WASM release inputs or checked-in outputs do not match INTEGRITY.sha256. Run `pnpm run build:studio-hokusai-wasm` with the pinned toolchain and review the generated diff.",
    );
  }

  const packageJson = JSON.parse(
    readFileSync(join(pkgDirectory, "package.json"), "utf8"),
  );
  if (
    packageJson.name !== "studio-hokusai-wasm"
    || packageJson.version !== "0.1.0"
    || packageJson.license !== "(MIT OR Apache-2.0) AND Unicode-3.0"
    || packageJson.private !== true
    || packageJson.sideEffects !== false
  ) {
    throw new Error(
      "Hokusai WASM generated package metadata must remain private, side-effect-free and match the reviewed package/version/license.",
    );
  }
  const packagedFiles = [...(packageJson.files ?? [])].sort();
  const requiredPublishedFiles = [...REQUIRED_PACKAGE_JSON_FILES].sort();
  if (JSON.stringify(packagedFiles) !== JSON.stringify(requiredPublishedFiles)) {
    throw new Error(
      "Hokusai WASM package.json must seal the WASM/JS/types, integrity manifest, README and all reviewed license notices.",
    );
  }
  for (const licenseName of [
    "LICENSE-APACHE",
    "LICENSE-MIT",
    "LICENSE-UNICODE",
  ]) {
    const sourceLicense = readFileSync(join(packageDirectory, licenseName));
    const packagedLicense = readFileSync(join(pkgDirectory, licenseName));
    if (!sourceLicense.equals(packagedLicense)) {
      throw new Error(
        `Hokusai WASM package ${licenseName} differs from its reviewed source notice.`,
      );
    }
  }
  const mitNotice = readFileSync(
    join(pkgDirectory, "LICENSE-MIT"),
    "utf8",
  );
  if (
    !mitNotice.includes("Copyright (c) 2026 ToonSpectrum contributors")
    || !mitNotice.includes("Copyright (c) 2026 Re:Earth and contributors")
  ) {
    throw new Error(
      "Hokusai WASM MIT notice must retain ToonSpectrum and Re:Earth attribution.",
    );
  }
  assertSafeHokusaiWasmBinary(
    join(pkgDirectory, "studio_hokusai_wasm_bg.wasm"),
  );

  return {
    records: collectIntegrityRecords({ packageDirectory, pkgDirectory }),
    wasmBytes: statSync(
      join(pkgDirectory, "studio_hokusai_wasm_bg.wasm"),
    ).size,
  };
}

function findExecutable(name, fallbackPaths = []) {
  const probe = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [name],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const discovered = probe.status === 0
    ? probe.stdout.trim().split(/\r?\n/u)[0]
    : "";
  if (discovered) return discovered;
  for (const path of fallbackPaths) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `${name} was not found. Install the pinned Hokusai WASM release toolchain first.`,
  );
}

function verifyToolVersion(executable, expected, label) {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} version probe failed: ${result.stderr || result.stdout}`,
    );
  }
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/u)?.[1] ?? "";
  if (match !== expected) {
    throw new Error(
      `${label} must be ${expected} for byte-reproducible Hokusai WASM output; found ${match || result.stdout.trim()}.`,
    );
  }
}

function resolvePinnedToolchain() {
  const cargo = findExecutable("cargo", [
    "/opt/homebrew/opt/rustup/bin/cargo",
  ]);
  const rustc = findExecutable("rustc", [
    "/opt/homebrew/opt/rustup/bin/rustc",
  ]);
  const wasmPack = findExecutable(
    process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack",
  );
  verifyToolVersion(cargo, HOKUSAI_RELEASE_TOOLCHAIN.cargo, "cargo");
  verifyToolVersion(rustc, HOKUSAI_RELEASE_TOOLCHAIN.rustc, "rustc");
  verifyToolVersion(
    wasmPack,
    HOKUSAI_RELEASE_TOOLCHAIN.wasmPack,
    "wasm-pack",
  );
  return { cargo, rustc, wasmPack };
}

function normalizeGeneratedPackage(directory) {
  rmSync(join(directory, ".gitignore"), { force: true });
  copyFileSync(
    join(HOKUSAI_PACKAGE_DIRECTORY, "LICENSE-UNICODE"),
    join(directory, "LICENSE-UNICODE"),
  );
  const packageJsonPath = join(directory, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  packageJson.private = true;
  packageJson.license = "(MIT OR Apache-2.0) AND Unicode-3.0";
  packageJson.files = [...REQUIRED_PACKAGE_JSON_FILES];
  packageJson.sideEffects = false;
  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  assertExactFlatPackageDirectory(directory, REQUIRED_PACKAGE_FILES);
}

function createIsolatedCargoHome(
  buildDirectory,
  sourceEnvironment = process.env,
) {
  const sourceCargoHome =
    sourceEnvironment.CARGO_HOME
    ?? join(sourceEnvironment.HOME ?? homedir(), ".cargo");
  const isolatedCargoHome = join(buildDirectory, "cargo-home");
  mkdirSync(isolatedCargoHome, { recursive: true });
  for (const name of ["git", "registry"]) {
    const sourcePath = join(sourceCargoHome, name);
    if (!existsSync(sourcePath)) continue;
    symlinkSync(
      sourcePath,
      join(isolatedCargoHome, name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  return isolatedCargoHome;
}

export function createHokusaiReleaseBuildEnvironment({
  buildDirectory,
  cargo,
  rustc,
  wasmPack,
  sourceEnvironment = process.env,
}) {
  const home = sourceEnvironment.HOME ?? homedir();
  const cargoHome = createIsolatedCargoHome(
    buildDirectory,
    sourceEnvironment,
  );
  const rustupHome =
    sourceEnvironment.RUSTUP_HOME ?? join(home, ".rustup");
  const targetDirectory = join(buildDirectory, "target");
  const temporaryDirectory = join(buildDirectory, "tmp");
  mkdirSync(targetDirectory, { recursive: true });
  mkdirSync(temporaryDirectory, { recursive: true });
  const path = [
    dirname(cargo),
    dirname(rustc),
    dirname(wasmPack),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .join(process.platform === "win32" ? ";" : ":");
  const remapRoots = [
    {
      source: REPOSITORY_ROOT,
      destination: "/toonspectrum-build/repository",
    },
    {
      source: sourceEnvironment.CARGO_HOME ?? join(home, ".cargo"),
      destination: "/toonspectrum-build/cargo-home",
    },
    {
      source: cargoHome,
      destination: "/toonspectrum-build/cargo-home",
    },
    {
      source: buildDirectory,
      destination: "/toonspectrum-build/session",
    },
    {
      source: home,
      destination: "/toonspectrum-build/home",
    },
    {
      source: tmpdir(),
      destination: "/toonspectrum-build/tmp-root",
    },
  ]
    .filter(({ source }) => Boolean(source))
    .filter(
      ({ source }, index, entries) =>
        entries.findIndex((entry) => entry.source === source) === index,
    )
    // rustc applies the last matching remap to nested prefixes. Keep broad
    // roots first so repository, isolated Cargo and build-session mappings win.
    .sort((left, right) => left.source.length - right.source.length);
  const remapFlags = remapRoots.map(
    ({ source, destination }) =>
      `--remap-path-prefix=${source}=${destination}`,
  );
  return Object.freeze({
    PATH: path,
    HOME: home,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    CARGO_TARGET_DIR: targetDirectory,
    CARGO_NET_OFFLINE: "true",
    CARGO_INCREMENTAL: "0",
    CARGO_ENCODED_RUSTFLAGS: remapFlags.join("\u001f"),
    CARGO_TERM_COLOR: "never",
    RUSTC: rustc,
    RUST_BACKTRACE: "0",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    SOURCE_DATE_EPOCH: RELEASE_SOURCE_DATE_EPOCH,
    TMPDIR: temporaryDirectory,
  });
}

function buildIntoTemporaryDirectory() {
  const { cargo, rustc, wasmPack } = resolvePinnedToolchain();
  const buildDirectory = mkdtempSync(
    join(tmpdir(), "toonspectrum-hokusai-wasm-"),
  );
  const packageDirectory = join(buildDirectory, "pkg");
  const environment = createHokusaiReleaseBuildEnvironment({
    buildDirectory,
    cargo,
    rustc,
    wasmPack,
  });
  const result = spawnSync(
    wasmPack,
    [
      "build",
      HOKUSAI_PACKAGE_DIRECTORY,
      "--target",
      "web",
      "--release",
      "--out-dir",
      packageDirectory,
      "--out-name",
      "studio_hokusai_wasm",
      "--",
      "--frozen",
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    rmSync(buildDirectory, { recursive: true, force: true });
    throw new Error(
      `Pinned Hokusai WASM build failed.\n${result.stdout}\n${result.stderr}`,
    );
  }
  normalizeGeneratedPackage(packageDirectory);
  assertSafeHokusaiWasmBinary(
    join(packageDirectory, "studio_hokusai_wasm_bg.wasm"),
    { additionalForbiddenMarkers: [buildDirectory] },
  );
  return Object.freeze({ buildDirectory, packageDirectory });
}

function compareGeneratedPackage(generatedPackageDirectory, expectedDirectory) {
  assertExactFlatPackageDirectory(
    generatedPackageDirectory,
    REQUIRED_PACKAGE_FILES,
  );
  for (const name of REQUIRED_PACKAGE_FILES) {
    const rebuiltPath = join(generatedPackageDirectory, name);
    const checkedInPath = join(expectedDirectory, name);
    if (!existsSync(rebuiltPath)) {
      throw new Error(`Pinned rebuild did not produce ${name}.`);
    }
    const rebuiltDigest = sha256File(rebuiltPath);
    const checkedInDigest = sha256File(checkedInPath);
    if (rebuiltDigest !== checkedInDigest) {
      throw new Error(
        `Pinned Hokusai WASM rebuild differs for ${name}: checked-in=${checkedInDigest}, rebuilt=${rebuiltDigest}.`,
      );
    }
  }
}

function runCargoTests() {
  const { cargo, rustc } = resolvePinnedToolchain();
  const buildDirectory = mkdtempSync(
    join(tmpdir(), "toonspectrum-hokusai-test-"),
  );
  const environment = createHokusaiReleaseBuildEnvironment({
    buildDirectory,
    cargo,
    rustc,
    wasmPack: findExecutable(
      process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack",
    ),
  });
  let result;
  try {
    result = spawnSync(
      cargo,
      [
        "test",
        "--frozen",
        "--manifest-path",
        join(HOKUSAI_PACKAGE_DIRECTORY, "Cargo.toml"),
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        env: environment,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } finally {
    rmSync(buildDirectory, { recursive: true, force: true });
  }
  if (result.status !== 0) {
    throw new Error(
      `Hokusai WASM Rust tests failed.\n${result.stdout}\n${result.stderr}`,
    );
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

function writeBuiltPackage(generatedPackageDirectory) {
  mkdirSync(HOKUSAI_PKG_DIRECTORY, { recursive: true });
  for (const name of REQUIRED_PACKAGE_FILES) {
    const sourcePath = join(generatedPackageDirectory, name);
    if (!existsSync(sourcePath)) {
      throw new Error(`Pinned build did not produce ${name}.`);
    }
    copyFileSync(sourcePath, join(HOKUSAI_PKG_DIRECTORY, name));
  }
  writeFileSync(
    HOKUSAI_INTEGRITY_MANIFEST_PATH,
    renderIntegrityManifest(),
    "utf8",
  );
}

/**
 * Rewrites the manifest without rebuilding, and only when the artifacts are untouched.
 *
 * The manifest also used to seal the repo's root package.json and the release scripts, so
 * every routine edit to either invalidated it and the only documented repair was a full
 * rebuild on the pinned Rust toolchain. This mode is the migration path off that: it
 * refuses to write unless every `source/` and `pkg/` digest is byte-identical to the one
 * already sealed, so a modified WASM can never be laundered through here — that still
 * requires `--build` with the pinned toolchain.
 */
function resealManifest() {
  const manifestPath = HOKUSAI_INTEGRITY_MANIFEST_PATH;
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) {
    throw new Error(
      `Hokusai WASM integrity manifest is missing: ${relative(REPOSITORY_ROOT, manifestPath)}.`,
    );
  }
  const sealedDigests = new Map(
    readFileSync(manifestPath, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [digest, path] = line.split(/\s+/u);
        return [path, digest];
      }),
  );
  const records = collectIntegrityRecords();
  for (const record of records) {
    const sealed = sealedDigests.get(record.path);
    if (sealed === record.digest) continue;
    throw new Error(
      `Refusing to reseal: ${record.path} changed (sealed ${sealed ?? "absent"}, now `
      + `${record.digest}). Rebuild with \`pnpm run build:studio-hokusai-wasm\` on the `
      + "pinned toolchain instead.",
    );
  }
  const dropped = [...sealedDigests.keys()].filter(
    (path) => !records.some((record) => record.path === path),
  );
  const next = renderIntegrityManifest();
  if (next === readFileSync(manifestPath, "utf8")) {
    process.stdout.write("Hokusai WASM manifest is already current.\n");
    return;
  }
  writeFileSync(manifestPath, next, "utf8");
  verifyCheckedInHokusaiArtifacts();
  process.stdout.write(
    `Resealed the Hokusai WASM manifest with artifacts untouched`
    + (dropped.length > 0 ? `; dropped ${dropped.length} stale record(s):\n` + dropped.map((path) => `  ${path}\n`).join("") : ".\n"),
  );
}

export function main(argumentsList = process.argv.slice(2)) {
  if (
    argumentsList.length !== 1
    || !["--build", "--check", "--rebuild", "--reseal", "--test"].includes(
      argumentsList[0],
    )
  ) {
    throw new Error(
      "Use exactly one of --build, --check, --rebuild, --reseal, or --test.",
    );
  }

  validateHokusaiReleaseContract();
  const command = argumentsList[0];
  if (command === "--check") {
    const { records, wasmBytes } = verifyCheckedInHokusaiArtifacts();
    process.stdout.write(
      `Hokusai WASM release gate passed (${records.length} integrity records, ${wasmBytes} WASM bytes).\n`,
    );
    return;
  }
  if (command === "--reseal") {
    resealManifest();
    return;
  }
  if (command === "--test") {
    runCargoTests();
    return;
  }

  const firstBuild = buildIntoTemporaryDirectory();
  try {
    if (command === "--build") {
      writeBuiltPackage(firstBuild.packageDirectory);
      verifyCheckedInHokusaiArtifacts();
      process.stdout.write(
        "Built and sealed the checked-in Hokusai WASM package with the pinned toolchain.\n",
      );
      return;
    }
    verifyCheckedInHokusaiArtifacts();
    compareGeneratedPackage(
      firstBuild.packageDirectory,
      HOKUSAI_PKG_DIRECTORY,
    );
    const secondBuild = buildIntoTemporaryDirectory();
    try {
      compareGeneratedPackage(
        secondBuild.packageDirectory,
        HOKUSAI_PKG_DIRECTORY,
      );
      compareGeneratedPackage(
        secondBuild.packageDirectory,
        firstBuild.packageDirectory,
      );
      process.stdout.write(
        "Two isolated pinned Hokusai WASM rebuilds are byte-identical to each other and the checked-in package.\n",
      );
    } finally {
      rmSync(secondBuild.buildDirectory, { recursive: true, force: true });
    }
  } finally {
    rmSync(firstBuild.buildDirectory, { recursive: true, force: true });
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
