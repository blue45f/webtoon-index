#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  HOKUSAI_PACKAGE_DIRECTORY,
  parseCargoLockPackages,
  validateHokusaiReleaseContract,
} from "./studio-hokusai-wasm-release-contract.mjs";
import {
  verifyCheckedInHokusaiArtifacts,
} from "./verify-studio-hokusai-wasm.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const PACKAGE_JSON_PATH = join(REPOSITORY_ROOT, "package.json");
const LOCKFILE_PATH = join(REPOSITORY_ROOT, "pnpm-lock.yaml");
const REPOSITORY_NOTICE_PATH = join(
  REPOSITORY_ROOT,
  "THIRD_PARTY_NOTICES.md",
);
const VELLO_PACKAGE_DIRECTORY = join(
  REPOSITORY_ROOT,
  "crates",
  "studio-engine-vello",
);
const VELLO_THIRD_PARTY_INVENTORY_PATH = join(
  VELLO_PACKAGE_DIRECTORY,
  "THIRD_PARTY_INVENTORY.json",
);
const SHIPPED_NOTICE_MANIFEST_NAME = "THIRD_PARTY_NOTICES.sha256";
const VELLO_ARTIFACT_POLICIES = Object.freeze([
  Object.freeze({
    id: "pkg",
    features: Object.freeze([]),
    expectedExternalPackageCount: 85,
    requiredPackages: Object.freeze([
      "vello_cpu@0.2.0",
      "vello_common@0.2.0",
      "parley@0.11.0",
      "harfrust@0.10.0",
      "skrifa@0.43.2",
      "skrifa@0.44.0",
    ]),
  }),
  Object.freeze({
    id: "pkg-gpu",
    features: Object.freeze(["fabric", "lottie", "svg"]),
    expectedExternalPackageCount: 144,
    requiredPackages: Object.freeze([
      "vello@0.9.0",
      "vello_cpu@0.2.0",
      "velato@0.11.0",
      "vello_svg@0.10.0",
      "usvg@0.46.0",
      "wgpu@29.0.4",
      "parley@0.11.0",
      "harfrust@0.10.0",
      "skrifa@0.42.1",
      "skrifa@0.43.2",
      "skrifa@0.44.0",
    ]),
  }),
]);
const VELLO_REQUIRED_NOTICE_FILES = Object.freeze([
  "THIRD_PARTY_INVENTORY.json",
  "pkg/NOTICE",
  "pkg/THIRD_PARTY_LICENSES.txt",
  "pkg-gpu/NOTICE",
  "pkg-gpu/THIRD_PARTY_LICENSES.txt",
]);

export const OPAQUE_WASM_POLICIES = Object.freeze([
  Object.freeze({
    id: "google-ink-mesh",
    directory: join(
      REPOSITORY_ROOT,
      "packages",
      "studio-brush-platform",
      "src",
      "ink-mesh",
    ),
    artifactFiles: Object.freeze(["ink_mesh.mjs", "ink_mesh.wasm"]),
    requiredNoticeFiles: Object.freeze([
      "THIRD_PARTY_INVENTORY.json",
      "NOTICE",
      "LICENSE-GOOGLE-INK",
      "LICENSE-ABSEIL",
    ]),
    components: Object.freeze([
      Object.freeze({
        name: "google/ink",
        version: "1.1.0",
        commit: "1d0daba661f3035f42f3649b8e6a0061b47aa759",
        license: "Apache-2.0",
        upstream: "https://github.com/google/ink",
        copiedLicense: "LICENSE-GOOGLE-INK",
        sourceLicensePath: join(homedir(), "toolchains", "ink", "LICENSE"),
        sourceLicenseSha256:
          "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
      }),
      Object.freeze({
        name: "abseil-cpp",
        version: "20260526.0",
        commit: "5650e9cf76d3be4318d5fa3af38ee483ddfd5e4a",
        license: "Apache-2.0",
        upstream: "https://github.com/abseil/abseil-cpp",
        copiedLicense: "LICENSE-ABSEIL",
        sourceLicensePath: join(
          homedir(),
          "toolchains",
          "abseil-cpp",
          "LICENSE",
        ),
        sourceLicenseSha256:
          "c79a7fea0e3cac04cd43f20e7b648e5a0ff8fa5344e644b0ee09ca1162b62747",
      }),
    ]),
  }),
  Object.freeze({
    id: "google-ink-stroke-modeler",
    directory: join(
      REPOSITORY_ROOT,
      "packages",
      "studio-brush-platform",
      "src",
      "ink-modeler",
    ),
    artifactFiles: Object.freeze([
      "ink_stroke_modeler.mjs",
      "ink_stroke_modeler.wasm",
    ]),
    requiredNoticeFiles: Object.freeze([
      "THIRD_PARTY_INVENTORY.json",
      "NOTICE",
      "LICENSE-GOOGLE-INK-STROKE-MODELER",
      "LICENSE-ABSEIL",
    ]),
    components: Object.freeze([
      Object.freeze({
        name: "google/ink-stroke-modeler",
        version: "0.1.0",
        commit: "f2388813b0b25bc3e33d143d369a8367ab2e30c8",
        license: "Apache-2.0",
        upstream: "https://github.com/google/ink-stroke-modeler",
        copiedLicense: "LICENSE-GOOGLE-INK-STROKE-MODELER",
        sourceLicensePath: join(
          homedir(),
          "toolchains",
          "ink-stroke-modeler",
          "LICENSE",
        ),
        sourceLicenseSha256:
          "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
      }),
      Object.freeze({
        name: "abseil-cpp",
        version: "20250512.0",
        commit: "bc257a88f7c1939f24e0379f14a3589e926c950c",
        license: "Apache-2.0",
        upstream: "https://github.com/abseil/abseil-cpp",
        copiedLicense: "LICENSE-ABSEIL",
        sourceLicensePath: join(
          homedir(),
          "toolchains",
          "ink-stroke-modeler",
          "build-wasm",
          "_deps",
          "abseil-cpp-src",
          "LICENSE",
        ),
        sourceLicenseSha256:
          "c79a7fea0e3cac04cd43f20e7b648e5a0ff8fa5344e644b0ee09ca1162b62747",
      }),
    ]),
  }),
  Object.freeze({
    id: "libmypaint",
    directory: join(
      REPOSITORY_ROOT,
      "packages",
      "studio-brush-platform",
      "src",
      "libmypaint",
    ),
    artifactFiles: Object.freeze(["mypaint-wasm.mjs", "mypaint-wasm.wasm"]),
    requiredNoticeFiles: Object.freeze([
      "THIRD_PARTY_INVENTORY.json",
      "NOTICE",
      "COPYING",
    ]),
    components: Object.freeze([
      Object.freeze({
        name: "libmypaint",
        version: "1.6.1",
        commit: "2768251dacce3939136c839aeca413f4aa4241d0",
        license: "ISC",
        upstream: "https://github.com/mypaint/libmypaint",
        copiedLicense: "COPYING",
        sourceLicensePath: join(
          homedir(),
          "toolchains",
          "libmypaint",
          "COPYING",
        ),
        sourceLicenseSha256:
          "1246cef097bd4b57ad0fb1127cf131af7aeb06e0c00a6aff5dd5b7603303b149",
      }),
    ]),
  }),
]);
const OCCT_BOUNDARY_DOCUMENT_PATH = join(
  REPOSITORY_ROOT,
  "docs",
  "third-party",
  "opencascade-lgpl.md",
);
const OCCT_PACKAGE_VERSION = "1.1.1";
const OCCT_SOURCE_COMMIT = "33d9a6fa21ca4fa711da7066655aa2ba854545ee";
const OCCT_NPM_INTEGRITY =
  "sha512-lw6/vOl86+CkJ8d3V01mlbGAC0A49gc1HbwGcqGeKjk5SGRLiF15jyUuA8aYEvizcPNTu4Ta4A+Ut2DJgsa7AQ==";
const OCCT_WASM_SHA256 =
  "6cc2f3fa1611d32ad7563f7092aa1bf58741124302630cef7d21561ecd7b7284";

const REVIEWED_LICENSE_EXPRESSIONS = new Set([
  "0BSD",
  "(MIT AND Zlib)",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT OR Apache-2.0",
  "MPL-2.0",
  "Public Domain",
  "SGI-B-2.0",
  "Unlicense",
]);

const REVIEWED_LICENSE_FILE_DIGESTS = new Map([
  [
    "422fa324bf754acb2f48918039858f39bc31cc1a710b492906889f9363d6b09e",
    "MIT",
  ],
]);

const HYBRID_PROVIDER_DEPENDENCIES = Object.freeze({
  "@gltf-transform/core": "4.4.2",
  "@gltf-transform/extensions": "4.4.2",
  "@gltf-transform/functions": "4.4.2",
  "@resvg/resvg-wasm": "2.6.2",
  "@techstark/opencv-js": "5.0.0-release.1",
  harfbuzzjs: "1.4.0",
  "manifold-3d": "3.5.1",
  "onnxruntime-web": "1.27.0",
  "opencascade.js": "1.1.1",
  "p5.brush": "2.2.1",
  paper: "0.12.18",
  "perfect-freehand": "1.2.3",
  rbush: "4.0.1",
  rhino3dm: "8.32.1",
  "three-mesh-bvh": "0.9.13",
  "web-ifc": "0.0.77",
  xatlasjs: "0.2.0",
});

const ONNX_RUNTIME_MIT_NOTICE = `MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const HOKUSAI_MIT_NOTICE = `MIT License

Copyright (c) 2026 Re:Earth and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const WASM_BINDGEN_MIT_NOTICE = `Copyright (c) 2014 Alex Crichton

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.`;

/**
 * First-party modules that embed hand-ported third-party code (no npm/cargo
 * artifact carries their notice). Each entry pins a checked-in verbatim
 * license copy whose permission notice must reach the generated dist notice.
 * Missing or altered copies fail the audit — the same fail-closed posture as
 * the opaque WASM inventories.
 */
export const EMBEDDED_FIRST_PARTY_PORT_NOTICES = Object.freeze([
  Object.freeze({
    label:
      "dli/paint (Fluid Paint) painting.frag CPU port — src/domains/creator/studio-impasto-relief-shading-v1.ts — MIT",
    licensePath: join(REPOSITORY_ROOT, "third_party", "dli-paint", "LICENSE"),
    upstream: "https://github.com/dli/paint/blob/master/LICENSE",
    requiredMarkers: Object.freeze([
      "Copyright (c) 2017 David Li",
      "Permission is hereby granted",
    ]),
  }),
  Object.freeze({
    label:
      "dli/paint (Fluid Paint) brush.js PBD chain + splat.frag + painting.frag WGSL port — src/domains/creator/render/studio-gpu-bristle-wgsl.ts — MIT",
    licensePath: join(REPOSITORY_ROOT, "third_party", "dli-paint", "LICENSE"),
    upstream: "https://github.com/dli/paint/blob/master/LICENSE",
    requiredMarkers: Object.freeze([
      "Copyright (c) 2017 David Li",
      "Permission is hereby granted",
    ]),
  }),
  Object.freeze({
    label:
      "croquis.js (@disjukr/croquis-js 0.0.3) capsule pen + pulled-string port — src/domains/creator/studio-croquis-capsule-pen-v1.ts — MIT option of (MIT OR Apache-2.0)",
    licensePath: join(
      REPOSITORY_ROOT,
      "third_party",
      "croquis-js",
      "LICENSE-MIT",
    ),
    upstream: "https://github.com/disjukr/croquis.js",
    requiredMarkers: Object.freeze([
      "JongChan Choi",
      "Permission is hereby granted",
    ]),
  }),
  Object.freeze({
    label:
      "Klecks brush tip kernel re-implementations — src/domains/creator/studio-oss-brush-kernels.ts — MIT",
    licensePath: join(REPOSITORY_ROOT, "third_party", "klecks", "LICENSE"),
    upstream: "https://github.com/bitbof/klecks/blob/main/LICENSE",
    requiredMarkers: Object.freeze([
      "bitbof",
      "Permission is hereby granted",
    ]),
  }),
]);

export function readEmbeddedFirstPartyPortDocuments(
  ports = EMBEDDED_FIRST_PARTY_PORT_NOTICES,
) {
  return ports.map((port) => {
    if (!existsSync(port.licensePath) || !statSync(port.licensePath).isFile()) {
      throw new Error(
        `First-party embedded port license copy is missing: ${relative(REPOSITORY_ROOT, port.licensePath)}`,
      );
    }
    const text = readFileSync(port.licensePath, "utf8");
    for (const marker of port.requiredMarkers) {
      if (!text.includes(marker)) {
        throw new Error(
          `First-party embedded port license changed and needs review: ${relative(REPOSITORY_ROOT, port.licensePath)} no longer contains "${marker}".`,
        );
      }
    }
    return {
      labels: new Set([port.label]),
      sources: new Set([
        port.upstream,
        relative(REPOSITORY_ROOT, port.licensePath),
      ]),
      text,
    };
  });
}

const REVIEWED_RUST_LICENSE_EXPRESSIONS = new Set([
  "(MIT OR Apache-2.0) AND Unicode-3.0",
  "0BSD OR MIT OR Apache-2.0",
  "Apache-2.0 OR MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "MIT",
  "MIT OR Apache-2.0",
  "MIT OR Apache-2.0 OR Zlib",
  "MIT OR Zlib OR Apache-2.0",
  "MIT/Apache-2.0",
  "Unicode-3.0",
  "Unlicense OR MIT",
  "Zlib",
  "Zlib OR Apache-2.0 OR MIT",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeNoticeText(value) {
  return String(value).replaceAll("\r\n", "\n").trim();
}

function packageKey({ name, version }) {
  return `${name}@${version}`;
}

function assertPlainRelativePath(path, label) {
  if (
    typeof path !== "string"
    || path.length === 0
    || path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} contains an unsafe relative path: ${String(path)}`);
  }
}

export function parseLockedNoticeManifest(text) {
  const entries = new Map();
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/u);
    if (!match) {
      throw new Error(`Malformed third-party notice manifest line: ${line}`);
    }
    const [, digest, path] = match;
    assertPlainRelativePath(path, "Third-party notice manifest");
    if (entries.has(path)) {
      throw new Error(`Duplicate third-party notice manifest entry: ${path}`);
    }
    entries.set(path, digest);
  }
  if (entries.size === 0) {
    throw new Error("Third-party notice manifest is empty.");
  }
  return entries;
}

export function validateLockedNoticeFiles(
  directory,
  requiredFiles,
  { manifestName = SHIPPED_NOTICE_MANIFEST_NAME } = {},
) {
  const manifestPath = join(directory, manifestName);
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    throw new Error(
      `Shipped third-party notice manifest is missing: ${relative(REPOSITORY_ROOT, manifestPath)}`,
    );
  }
  const entries = parseLockedNoticeManifest(readFileSync(manifestPath, "utf8"));
  const expectedPaths = [...requiredFiles].sort();
  const actualPaths = [...entries.keys()].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `Shipped third-party notice file set changed in ${relative(REPOSITORY_ROOT, directory)}: expected ${expectedPaths.join(", ")}; found ${actualPaths.join(", ")}.`,
    );
  }
  for (const [path, expectedDigest] of entries) {
    const absolutePath = join(directory, path);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`Required shipped third-party notice file is missing: ${path}`);
    }
    const actualDigest = sha256(readFileSync(absolutePath));
    if (actualDigest !== expectedDigest) {
      throw new Error(
        `Shipped third-party notice hash mismatch for ${path}: expected ${expectedDigest}, found ${actualDigest}.`,
      );
    }
  }
  return entries;
}

function writeLockedNoticeManifest(directory, requiredFiles) {
  const lines = [
    "# ToonSpectrum shipped third-party notice lock v1",
    ...[...requiredFiles]
      .sort()
      .map((path) => `${sha256(readFileSync(join(directory, path)))}  ${path}`),
    "",
  ];
  writeFileSync(
    join(directory, SHIPPED_NOTICE_MANIFEST_NAME),
    lines.join("\n"),
    "utf8",
  );
}

function assertStringArray(value, label) {
  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
}

function assertExactStringSet(actual, expected, label) {
  assertStringArray(actual, label);
  const actualSorted = [...new Set(actual)].sort();
  const expectedSorted = [...new Set(expected)].sort();
  if (
    actualSorted.length !== actual.length
    || JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)
  ) {
    throw new Error(
      `${label} changed: expected ${expectedSorted.join(", ")}; found ${actualSorted.join(", ")}.`,
    );
  }
}

function parseLicenseBundle(bundleText, expectedDigests, artifactId) {
  const found = new Map();
  const pattern = /----- BEGIN LICENSE ([0-9a-f]{64}) -----\n([\s\S]*?)\n----- END LICENSE \1 -----/gu;
  for (const match of bundleText.matchAll(pattern)) {
    const [, digest, text] = match;
    if (found.has(digest)) {
      throw new Error(`${artifactId} license bundle repeats ${digest}.`);
    }
    const normalized = normalizeNoticeText(text);
    if (sha256(normalized) !== digest) {
      throw new Error(`${artifactId} license bundle text does not match ${digest}.`);
    }
    found.set(digest, normalized);
  }
  assertExactStringSet(
    [...found.keys()],
    expectedDigests,
    `${artifactId} license document set`,
  );
  return found;
}

function validateVelloArtifactFiles(directory, artifact) {
  if (!Array.isArray(artifact.files) || artifact.files.length !== 2) {
    throw new Error(`${artifact.id} must pin its JavaScript and WASM artifacts.`);
  }
  const expectedPaths = [
    `${artifact.id}/studio_engine_vello.js`,
    `${artifact.id}/studio_engine_vello_bg.wasm`,
  ].sort();
  assertExactStringSet(
    artifact.files.map(({ path }) => path),
    expectedPaths,
    `${artifact.id} binary artifact set`,
  );
  for (const file of artifact.files) {
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
      throw new Error(`${artifact.id} contains an invalid artifact digest.`);
    }
    const absolutePath = join(directory, file.path);
    if (!existsSync(absolutePath) || sha256(readFileSync(absolutePath)) !== file.sha256) {
      throw new Error(`${artifact.id} shipped binary no longer matches ${file.path}.`);
    }
  }
}

export function validateVelloThirdPartyInventory({ // NOSONAR javascript:S3776
  directory = VELLO_PACKAGE_DIRECTORY,
  inventory = readJson(join(directory, "THIRD_PARTY_INVENTORY.json")),
  manifestText = readFileSync(join(directory, "Cargo.toml"), "utf8"),
  lockText = readFileSync(join(directory, "Cargo.lock"), "utf8"),
  validateFiles = true,
} = {}) {
  if (validateFiles) {
    validateLockedNoticeFiles(directory, VELLO_REQUIRED_NOTICE_FILES);
  }
  if (
    inventory.schemaVersion !== 1
    || inventory.engine !== "studio-engine-vello"
    || inventory.target !== "wasm32-unknown-unknown"
  ) {
    throw new Error("Vello third-party inventory header changed or is malformed.");
  }
  if (
    inventory.cargoManifestSha256 !== sha256(manifestText)
    || inventory.cargoLockSha256 !== sha256(lockText)
  ) {
    throw new Error("Vello Cargo.toml/Cargo.lock changed without a reviewed notice inventory refresh.");
  }

  const lockPackages = parseCargoLockPackages(lockText);
  const lockByKey = new Map(lockPackages.map((entry) => [packageKey(entry), entry]));
  if (!Array.isArray(inventory.packages) || inventory.packages.length === 0) {
    throw new Error("Vello third-party package inventory is empty.");
  }
  const packagesByKey = new Map();
  for (const entry of inventory.packages) {
    const key = packageKey(entry);
    if (packagesByKey.has(key)) {
      throw new Error(`Vello third-party inventory repeats ${key}.`);
    }
    const locked = lockByKey.get(key);
    if (!locked) {
      throw new Error(`Vello third-party inventory includes a package absent from Cargo.lock: ${key}.`);
    }
    if (
      entry.checksum !== (locked.checksum || null)
      || entry.source !== (locked.source || "path:crates/vendor/wgpu-toon")
    ) {
      throw new Error(`Vello locked source/checksum changed for ${key}.`);
    }
    if (!REVIEWED_RUST_LICENSE_EXPRESSIONS.has(entry.license)) {
      throw new Error(`Vello package has an unreviewed Rust license: ${key} — ${String(entry.license)}.`);
    }
    assertStringArray(entry.licenseDocumentDigests, `${key} license documents`);
    if (typeof entry.upstream !== "string" || entry.upstream.length === 0) {
      throw new Error(`Vello package is missing upstream provenance: ${key}.`);
    }
    packagesByKey.set(key, entry);
  }

  if (!Array.isArray(inventory.licenseDocuments) || inventory.licenseDocuments.length === 0) {
    throw new Error("Vello license document inventory is empty.");
  }
  const documentByDigest = new Map();
  for (const document of inventory.licenseDocuments) {
    if (
      typeof document.sha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(document.sha256)
      || documentByDigest.has(document.sha256)
    ) {
      throw new Error("Vello license document inventory contains an invalid or duplicate digest.");
    }
    assertStringArray(document.sources, `${document.sha256} license sources`);
    assertStringArray(document.packages, `${document.sha256} license packages`);
    documentByDigest.set(document.sha256, document);
  }
  for (const [key, entry] of packagesByKey) {
    for (const digest of entry.licenseDocumentDigests) {
      const document = documentByDigest.get(digest);
      if (!document || !document.packages.includes(key)) {
        throw new Error(`${key} is missing a locked copied license document.`);
      }
    }
  }

  if (!Array.isArray(inventory.artifacts) || inventory.artifacts.length !== 2) {
    throw new Error("Vello inventory must describe exactly pkg and pkg-gpu.");
  }
  const artifactById = new Map(inventory.artifacts.map((entry) => [entry.id, entry]));
  const artifactPackageUnion = new Set();
  const collectedDocuments = new Map();
  for (const policy of VELLO_ARTIFACT_POLICIES) {
    const artifact = artifactById.get(policy.id);
    if (!artifact) throw new Error(`Vello inventory is missing ${policy.id}.`);
    assertExactStringSet(
      artifact.features,
      policy.features,
      `${policy.id} Cargo feature set`,
    );
    assertStringArray(artifact.packages, `${policy.id} package inventory`);
    if (
      new Set(artifact.packages).size !== artifact.packages.length
      || artifact.packages.length !== policy.expectedExternalPackageCount
    ) {
      throw new Error(
        `${policy.id} package inventory must contain exactly ${policy.expectedExternalPackageCount} unique external crates.`,
      );
    }
    for (const key of artifact.packages) {
      if (!packagesByKey.has(key)) {
        throw new Error(`${policy.id} references an unreviewed package: ${key}.`);
      }
      artifactPackageUnion.add(key);
    }
    for (const key of policy.requiredPackages) {
      if (!artifact.packages.includes(key)) {
        throw new Error(`${policy.id} is missing required shipped package ${key}.`);
      }
    }
    validateVelloArtifactFiles(directory, artifact);

    if (validateFiles) {
      const expectedDocumentDigests = [
        ...new Set(
          artifact.packages.flatMap(
            (key) => packagesByKey.get(key).licenseDocumentDigests,
          ),
        ),
      ].sort();
      const bundlePath = join(directory, policy.id, "THIRD_PARTY_LICENSES.txt");
      const bundleDocuments = parseLicenseBundle(
        readFileSync(bundlePath, "utf8"),
        expectedDocumentDigests,
        policy.id,
      );
      const notice = readFileSync(join(directory, policy.id, "NOTICE"), "utf8");
      for (const key of artifact.packages) {
        if (!notice.includes(key)) {
          throw new Error(`${policy.id}/NOTICE omitted ${key}.`);
        }
      }
      for (const [digest, text] of bundleDocuments) {
        collectedDocuments.set(digest, {
          digest,
          labels: new Set(documentByDigest.get(digest).packages),
          sources: new Set(documentByDigest.get(digest).sources),
          text,
        });
      }
    }
  }
  assertExactStringSet(
    [...artifactPackageUnion],
    [...packagesByKey.keys()],
    "Vello reviewed artifact package union",
  );

  return {
    inventory,
    cpuPackageCount: artifactById.get("pkg").packages.length,
    gpuPackageCount: artifactById.get("pkg-gpu").packages.length,
    documents: [...collectedDocuments.values()].sort((left, right) =>
      left.digest.localeCompare(right.digest),
    ),
  };
}

function validateOpaqueComponent(policyComponent, inventoryComponent, directory) {
  for (const field of ["name", "version", "commit", "license", "upstream", "copiedLicense"]) {
    if (inventoryComponent?.[field] !== policyComponent[field]) {
      throw new Error(
        `${policyComponent.name} opaque WASM provenance changed at ${field}.`,
      );
    }
  }
  const licensePath = join(directory, policyComponent.copiedLicense);
  const licenseDigest = sha256(readFileSync(licensePath));
  if (
    licenseDigest !== policyComponent.sourceLicenseSha256
    || inventoryComponent.licenseSha256 !== licenseDigest
  ) {
    throw new Error(`${policyComponent.name} shipped license copy changed or is missing.`);
  }
  return {
    digest: sha256(normalizeNoticeText(readFileSync(licensePath, "utf8"))),
    labels: new Set([
      `${policyComponent.name}@${policyComponent.version} — ${policyComponent.license}`,
    ]),
    sources: new Set([
      `${policyComponent.upstream}/blob/${policyComponent.commit}/${basename(policyComponent.sourceLicensePath)}`,
    ]),
    text: normalizeNoticeText(readFileSync(licensePath, "utf8")),
  };
}

export function validateOpaqueWasmThirdPartyInventory(
  policy,
  { directory = policy.directory, inventory = readJson(join(directory, "THIRD_PARTY_INVENTORY.json")), validateFiles = true } = {},
) {
  if (validateFiles) {
    validateLockedNoticeFiles(directory, policy.requiredNoticeFiles);
  }
  if (
    inventory.schemaVersion !== 1
    || inventory.artifactId !== policy.id
    || !Array.isArray(inventory.components)
    || inventory.components.length !== policy.components.length
  ) {
    throw new Error(`${policy.id} opaque WASM inventory is malformed.`);
  }
  const componentByName = new Map(
    inventory.components.map((component) => [component.name, component]),
  );
  const documents = policy.components.map((component) =>
    validateOpaqueComponent(
      component,
      componentByName.get(component.name),
      directory,
    ),
  );
  if (!Array.isArray(inventory.artifacts)) {
    throw new Error(`${policy.id} artifact inventory is missing.`);
  }
  assertExactStringSet(
    inventory.artifacts.map(({ path }) => path),
    policy.artifactFiles,
    `${policy.id} artifact file set`,
  );
  for (const artifact of inventory.artifacts) {
    const artifactPath = join(directory, artifact.path);
    if (
      typeof artifact.sha256 !== "string"
      || !existsSync(artifactPath)
      || sha256(readFileSync(artifactPath)) !== artifact.sha256
    ) {
      throw new Error(`${policy.id} artifact provenance no longer matches ${artifact.path}.`);
    }
  }
  if (validateFiles) {
    const notice = readFileSync(join(directory, "NOTICE"), "utf8");
    for (const component of policy.components) {
      if (!notice.includes(component.name) || !notice.includes(component.commit)) {
        throw new Error(`${policy.id}/NOTICE omitted ${component.name} provenance.`);
      }
    }
  }
  return { inventory, documents };
}

export function validateShippedEngineNotices() {
  const vello = validateVelloThirdPartyInventory();
  const opaque = OPAQUE_WASM_POLICIES.map((policy) =>
    validateOpaqueWasmThirdPartyInventory(policy),
  );
  const documents = new Map();
  for (const document of [
    ...vello.documents,
    ...opaque.flatMap((entry) => entry.documents),
  ]) {
    const existing = documents.get(document.digest);
    if (existing) {
      for (const label of document.labels) existing.labels.add(label);
      for (const source of document.sources) existing.sources.add(source);
    } else {
      documents.set(document.digest, document);
    }
  }
  return {
    vello,
    opaque,
    documents: [...documents.values()].sort((left, right) =>
      left.digest.localeCompare(right.digest),
    ),
  };
}

function parseCargoTreePackageKeys(treeText) {
  const keys = new Set();
  for (const rawLine of treeText.split("\n")) {
    const line = rawLine
      .trim()
      .replace(/ \(\*\)$/u, "")
      .replace(/ \(proc-macro\)$/u, "")
      .replace(/ \([^)]*[\\/][^)]*\)$/u, "");
    if (!line) continue;
    const match = line.match(/^([^ ]+) v([^ ]+)$/u);
    if (!match) {
      throw new Error(`Cannot parse Vello cargo tree package line: ${rawLine}`);
    }
    const [, name, version] = match;
    if (name !== "studio-engine-vello") keys.add(`${name}@${version}`);
  }
  return [...keys].sort();
}

function runVelloCargo(commandArguments) {
  return execFileSync("cargo", commandArguments, {
    cwd: VELLO_PACKAGE_DIRECTORY,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function collectVelloFeaturePackages(features) {
  const argumentsList = [
    "tree",
    "--offline",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
    "--edges",
    "normal",
    "--prefix",
    "none",
    "--no-default-features",
  ];
  if (features.length > 0) {
    argumentsList.push("--features", features.join(","));
  }
  return parseCargoTreePackageKeys(runVelloCargo(argumentsList));
}

function stableCargoLicenseSource(packageMetadata, licensePath) {
  if (packageMetadata.source?.startsWith("registry+")) {
    return `https://crates.io/crates/${packageMetadata.name}/${packageMetadata.version}/source/${basename(licensePath)}`;
  }
  return relative(REPOSITORY_ROOT, licensePath);
}

function renderVelloLicenseBundle(artifact, packageByKey, documentByDigest) {
  const documentDigests = [
    ...new Set(
      artifact.packages.flatMap(
        (key) => packageByKey.get(key).licenseDocumentDigests,
      ),
    ),
  ].sort();
  const sections = documentDigests.map((digest) => {
    const document = documentByDigest.get(digest);
    return `Packages: ${document.packages.filter((key) => artifact.packages.includes(key)).join(", ")}
Sources: ${document.sources.join(", ")}
----- BEGIN LICENSE ${digest} -----
${document.text}
----- END LICENSE ${digest} -----`;
  });
  return `ToonSpectrum shipped Rust/WASM third-party license bundle

Artifact: ${artifact.id}
Target: wasm32-unknown-unknown
Cargo features: ${artifact.features.length > 0 ? artifact.features.join(",") : "(none)"}
External crates: ${artifact.packages.length}

The text between every BEGIN/END marker is copied verbatim from the locally
resolved crate archive or reviewed vendored source after CRLF-to-LF and final
whitespace normalization. The SHA-256 in the marker covers that normalized
license text only. Package/source lines are ToonSpectrum inventory metadata
and do not alter the upstream license terms.

${sections.join("\n\n")}
`;
}

function renderVelloArtifactNotice(artifact, packageByKey) {
  const rows = artifact.packages.map((key) => {
    const entry = packageByKey.get(key);
    return `| ${key} | ${entry.license} | ${entry.upstream} |`;
  });
  return `ToonSpectrum studio-engine-vello third-party NOTICE

Artifact: ${artifact.id}
Target: wasm32-unknown-unknown
Cargo features: ${artifact.features.length > 0 ? artifact.features.join(",") : "(none)"}
Locked external crates: ${artifact.packages.length}

This NOTICE accompanies the checked-in JavaScript/WASM artifact. Exact license
texts are in THIRD_PARTY_LICENSES.txt and the machine-checked provenance is in
../THIRD_PARTY_INVENTORY.json. No upstream NOTICE file was omitted: crate root
LICENSE, COPYING, and NOTICE files discovered in the reviewed source graph are
copied into the bundle and hash-locked.

| Package | SPDX/license expression | Upstream |
| --- | --- | --- |
${rows.join("\n")}
`;
}

function refreshVelloThirdPartyNotices() { // NOSONAR javascript:S3776
  const artifacts = VELLO_ARTIFACT_POLICIES.map((policy) => ({
    id: policy.id,
    features: [...policy.features],
    packages: collectVelloFeaturePackages(policy.features),
    files: [
      `${policy.id}/studio_engine_vello.js`,
      `${policy.id}/studio_engine_vello_bg.wasm`,
    ].map((path) => ({ path, sha256: sha256(readFileSync(join(VELLO_PACKAGE_DIRECTORY, path))) })),
  }));
  for (const policy of VELLO_ARTIFACT_POLICIES) {
    const artifact = artifacts.find(({ id }) => id === policy.id);
    if (artifact.packages.length !== policy.expectedExternalPackageCount) {
      throw new Error(
        `${policy.id} cargo tree changed: expected ${policy.expectedExternalPackageCount}, found ${artifact.packages.length}.`,
      );
    }
  }

  const metadata = JSON.parse(
    runVelloCargo([
      "metadata",
      "--offline",
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      "wasm32-unknown-unknown",
      "--no-default-features",
      "--features",
      "lottie,fabric,svg",
    ]),
  );
  const metadataByKey = new Map(
    metadata.packages.map((entry) => [packageKey(entry), entry]),
  );
  const lockText = readFileSync(join(VELLO_PACKAGE_DIRECTORY, "Cargo.lock"), "utf8");
  const lockByKey = new Map(
    parseCargoLockPackages(lockText).map((entry) => [packageKey(entry), entry]),
  );
  const packageKeys = [...new Set(artifacts.flatMap(({ packages }) => packages))].sort();
  const velloMetadata = metadataByKey.get("vello@0.9.0");
  const canonicalDualLicenseFiles = findRootLicenseFiles(dirname(velloMetadata.manifest_path));
  if (canonicalDualLicenseFiles.length < 2) {
    throw new Error("Vello canonical MIT/Apache license files are unavailable.");
  }

  const documentRecords = new Map();
  const packages = [];
  for (const key of packageKeys) {
    const packageMetadata = metadataByKey.get(key);
    const lockPackage = lockByKey.get(key);
    if (!packageMetadata || !lockPackage) {
      throw new Error(`Cannot resolve reviewed Vello package metadata for ${key}.`);
    }
    if (!REVIEWED_RUST_LICENSE_EXPRESSIONS.has(packageMetadata.license)) {
      throw new Error(`Unreviewed Vello Rust license: ${key} — ${String(packageMetadata.license)}.`);
    }
    let licenseFiles = findRootLicenseFiles(dirname(packageMetadata.manifest_path));
    let licenseEvidence = "crate-or-vendored-root-files";
    if (licenseFiles.length === 0) {
      if (!/MIT.*Apache|Apache.*MIT/u.test(packageMetadata.license)) {
        throw new Error(`${key} has no root license file and no reviewed canonical fallback.`);
      }
      licenseFiles = canonicalDualLicenseFiles;
      licenseEvidence = "declared-spdx-with-vello-canonical-mit-apache-copies";
    }
    const licenseDocumentDigests = [];
    for (const licensePath of licenseFiles) {
      const text = normalizeNoticeText(readFileSync(licensePath, "utf8"));
      const digest = sha256(text);
      licenseDocumentDigests.push(digest);
      const existing = documentRecords.get(digest) ?? {
        sha256: digest,
        sources: new Set(),
        packages: new Set(),
        text,
      };
      existing.sources.add(
        stableCargoLicenseSource(
          licenseEvidence.startsWith("declared-spdx") ? velloMetadata : packageMetadata,
          licensePath,
        ),
      );
      existing.packages.add(key);
      documentRecords.set(digest, existing);
    }
    packages.push({
      name: packageMetadata.name,
      version: packageMetadata.version,
      license: packageMetadata.license,
      checksum: lockPackage.checksum || null,
      source: lockPackage.source || "path:crates/vendor/wgpu-toon",
      upstream:
        packageMetadata.repository
        || packageMetadata.homepage
        || `https://crates.io/crates/${packageMetadata.name}/${packageMetadata.version}`,
      licenseEvidence,
      licenseDocumentDigests: [...new Set(licenseDocumentDigests)].sort(),
    });
  }

  const licenseDocuments = [...documentRecords.values()]
    .map((document) => ({
      sha256: document.sha256,
      sources: [...document.sources].sort(),
      packages: [...document.packages].sort(),
      text: document.text,
    }))
    .sort((left, right) => left.sha256.localeCompare(right.sha256));
  const packageByKey = new Map(packages.map((entry) => [packageKey(entry), entry]));
  const documentByDigest = new Map(
    licenseDocuments.map((entry) => [entry.sha256, entry]),
  );
  for (const artifact of artifacts) {
    writeFileSync(
      join(VELLO_PACKAGE_DIRECTORY, artifact.id, "NOTICE"),
      renderVelloArtifactNotice(artifact, packageByKey),
      "utf8",
    );
    writeFileSync(
      join(VELLO_PACKAGE_DIRECTORY, artifact.id, "THIRD_PARTY_LICENSES.txt"),
      renderVelloLicenseBundle(artifact, packageByKey, documentByDigest),
      "utf8",
    );
  }
  const inventory = {
    schemaVersion: 1,
    engine: "studio-engine-vello",
    target: "wasm32-unknown-unknown",
    cargoManifestSha256: sha256(
      readFileSync(join(VELLO_PACKAGE_DIRECTORY, "Cargo.toml")),
    ),
    cargoLockSha256: sha256(lockText),
    artifacts,
    packages,
    licenseDocuments: licenseDocuments.map(
      ({ sha256: digest, sources, packages: documentPackages }) => ({
        sha256: digest,
        sources,
        packages: documentPackages,
      }),
    ),
  };
  writeFileSync(
    VELLO_THIRD_PARTY_INVENTORY_PATH,
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8",
  );
  writeLockedNoticeManifest(
    VELLO_PACKAGE_DIRECTORY,
    VELLO_REQUIRED_NOTICE_FILES,
  );
  return inventory;
}

function renderOpaqueNotice(policy, inventory) {
  const componentRows = inventory.components.map(
    (component) =>
      `| ${component.name} | ${component.version} | ${component.commit} | ${component.license} | ${component.upstream} | ${component.copiedLicense} |`,
  );
  const artifactRows = inventory.artifacts.map(
    (artifact) => `| ${artifact.path} | ${artifact.sha256} |`,
  );
  return `ToonSpectrum opaque WASM third-party NOTICE

Artifact lane: ${policy.id}

The binary files below are independently emitted Emscripten artifacts. This
NOTICE, the copied upstream license files, THIRD_PARTY_INVENTORY.json, and
THIRD_PARTY_NOTICES.sha256 form the fail-closed provenance boundary. The
upstream source distributions used here contain no separate NOTICE file.

| Component | Version | Commit | License | Upstream | Copied license |
| --- | --- | --- | --- | --- | --- |
${componentRows.join("\n")}

| Shipped artifact | SHA-256 |
| --- | --- |
${artifactRows.join("\n")}
`;
}

function refreshOpaqueWasmThirdPartyNotice(policy) {
  for (const component of policy.components) {
    if (!existsSync(component.sourceLicensePath)) {
      throw new Error(
        `${policy.id} source license is unavailable: ${component.sourceLicensePath}`,
      );
    }
    const sourceBytes = readFileSync(component.sourceLicensePath);
    if (sha256(sourceBytes) !== component.sourceLicenseSha256) {
      throw new Error(`${policy.id} source license changed for ${component.name}.`);
    }
    writeFileSync(join(policy.directory, component.copiedLicense), sourceBytes);
  }
  const inventory = {
    schemaVersion: 1,
    artifactId: policy.id,
    components: policy.components.map((component) => ({
      name: component.name,
      version: component.version,
      commit: component.commit,
      license: component.license,
      upstream: component.upstream,
      copiedLicense: component.copiedLicense,
      licenseSha256: component.sourceLicenseSha256,
    })),
    artifacts: policy.artifactFiles.map((path) => ({
      path,
      sha256: sha256(readFileSync(join(policy.directory, path))),
    })),
  };
  writeFileSync(
    join(policy.directory, "THIRD_PARTY_INVENTORY.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(policy.directory, "NOTICE"),
    renderOpaqueNotice(policy, inventory),
    "utf8",
  );
  writeLockedNoticeManifest(policy.directory, policy.requiredNoticeFiles);
  return inventory;
}

export function refreshShippedEngineNotices() {
  const vello = refreshVelloThirdPartyNotices();
  const opaque = OPAQUE_WASM_POLICIES.map((policy) =>
    refreshOpaqueWasmThirdPartyNotice(policy),
  );
  return { vello, opaque };
}

function escapeTableCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeAuthor(author) {
  if (typeof author === "object" && author !== null) {
    return typeof author.name === "string" ? author.name.trim() : "";
  }
  if (typeof author !== "string") return "";
  return author.split(/[<(]/u, 1)[0].trim();
}

function normalizeHomepage(packageJson) {
  if (typeof packageJson.homepage === "string") {
    return packageJson.homepage.trim();
  }
  const repository =
    typeof packageJson.repository === "string"
      ? packageJson.repository
      : packageJson.repository?.url;
  if (typeof repository !== "string") return "";
  return repository
    .replace(/^git\+/u, "")
    .replace(/^git:\/\//u, "https://")
    .replace(/\.git$/u, "");
}

function normalizeLicenseExpression(license) {
  if (typeof license === "string") return license.trim();
  if (Array.isArray(license)) {
    return [
      ...new Set(
        license
          .map((entry) => normalizeLicenseExpression(entry))
          .filter(Boolean),
      ),
    ].join(" OR ");
  }
  if (
    typeof license === "object"
    && license !== null
    && (
      typeof license.type === "string"
      || typeof license.name === "string"
    )
  ) {
    return String(license.type ?? license.name).trim();
  }
  return "";
}

function inferLicenseExpressionFromFiles(packagePath) {
  for (const path of findRootLicenseFiles(packagePath)) {
    const normalized = readFileSync(path, "utf8")
      .replaceAll("\r\n", "\n")
      .trim();
    const reviewedExpression = REVIEWED_LICENSE_FILE_DIGESTS.get(
      sha256(normalized),
    );
    if (reviewedExpression) return reviewedExpression;
  }
  return "";
}

function resolveInstalledPackagePath(packageName, fromDirectory) {
  let currentDirectory = resolve(fromDirectory);
  while (true) {
    const candidate = join(
      currentDirectory,
      "node_modules",
      ...packageName.split("/"),
    );
    if (existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    if (currentDirectory === REPOSITORY_ROOT) break;
    const parentDirectory = dirname(currentDirectory);
    const repositoryRelativeParent = relative(
      REPOSITORY_ROOT,
      parentDirectory,
    );
    if (
      parentDirectory === currentDirectory
      || repositoryRelativeParent === ".."
      || repositoryRelativeParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
      break;
    }
    currentDirectory = parentDirectory;
  }
  return null;
}

function readWorkspaceImporterDirectories() {
  const lockfile = parseYaml(readFileSync(LOCKFILE_PATH, "utf8"));
  if (
    typeof lockfile !== "object"
    || lockfile === null
    || typeof lockfile.importers !== "object"
    || lockfile.importers === null
  ) {
    throw new Error("pnpm-lock.yaml is missing its workspace importer graph.");
  }
  return Object.keys(lockfile.importers)
    .sort()
    .map((importer) => {
      const directory = resolve(REPOSITORY_ROOT, importer);
      const relativeDirectory = relative(REPOSITORY_ROOT, directory);
      if (
        relativeDirectory === ".."
        || relativeDirectory.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
      ) {
        throw new Error(`Workspace importer escapes the repository: ${importer}`);
      }
      if (!existsSync(join(directory, "package.json"))) {
        throw new Error(`Workspace importer has no package.json: ${importer}`);
      }
      return directory;
    });
}

export function readFilesystemLicenseInventory() { // NOSONAR javascript:S3776
  const pendingPackagePaths = [];
  for (const importerDirectory of readWorkspaceImporterDirectories()) {
    const importerPackageJson = readJson(
      join(importerDirectory, "package.json"),
    );
    const directDependencies = {
      ...(importerPackageJson.dependencies ?? {}),
      ...(importerPackageJson.optionalDependencies ?? {}),
    };
    for (const packageName of Object.keys(directDependencies).sort()) {
      const packagePath = resolveInstalledPackagePath(
        packageName,
        importerDirectory,
      );
      if (!packagePath) {
        if (packageName in (importerPackageJson.optionalDependencies ?? {})) {
          continue;
        }
        throw new Error(
          `Required production dependency is not installed: ${packageName}`,
        );
      }
      pendingPackagePaths.push(packagePath);
    }
  }

  const visitedPackagePaths = new Set();
  const groupedPackages = new Map();
  while (pendingPackagePaths.length > 0) {
    const packagePath = realpathSync(pendingPackagePaths.shift());
    if (visitedPackagePaths.has(packagePath)) continue;
    visitedPackagePaths.add(packagePath);

    const packageJson = readJson(join(packagePath, "package.json"));
    if (
      typeof packageJson.name !== "string"
      || packageJson.name.length === 0
      || typeof packageJson.version !== "string"
      || packageJson.version.length === 0
    ) {
      throw new Error(`Installed package metadata is malformed: ${packagePath}`);
    }

    if (!packageJson.private) {
      const license =
        normalizeLicenseExpression(
          packageJson.license ?? packageJson.licenses,
        )
        || inferLicenseExpressionFromFiles(packagePath);
      if (!REVIEWED_LICENSE_EXPRESSIONS.has(license)) {
        throw new Error(
          `Unreviewed production license expression: ${license || "(missing)"} (${packageJson.name}@${packageJson.version})`,
        );
      }
      const key = `${packageJson.name}\u0000${license}`;
      const existing = groupedPackages.get(key) ?? {
        name: packageJson.name,
        versions: new Set(),
        paths: new Set(),
        license,
        authors: new Set(),
        homepages: new Set(),
      };
      existing.versions.add(packageJson.version);
      existing.paths.add(packagePath);
      const author = normalizeAuthor(packageJson.author);
      const homepage = normalizeHomepage(packageJson);
      if (author) existing.authors.add(author);
      if (homepage) existing.homepages.add(homepage);
      groupedPackages.set(key, existing);
    }

    const optionalDependencies = packageJson.optionalDependencies ?? {};
    const requiredDependencies = packageJson.dependencies ?? {};
    for (const packageName of Object.keys(requiredDependencies).sort()) {
      const dependencyPath = resolveInstalledPackagePath(packageName, packagePath);
      if (!dependencyPath) {
        if (packageName in optionalDependencies) continue;
        throw new Error(
          `Required production dependency is not installed: ${packageJson.name}@${packageJson.version} -> ${packageName}`,
        );
      }
      pendingPackagePaths.push(dependencyPath);
    }
    for (const packageName of Object.keys(optionalDependencies).sort()) {
      const dependencyPath = resolveInstalledPackagePath(packageName, packagePath);
      if (dependencyPath) pendingPackagePaths.push(dependencyPath);
    }
    for (const packageName of Object.keys(packageJson.peerDependencies ?? {}).sort()) {
      const dependencyPath = resolveInstalledPackagePath(packageName, packagePath);
      if (dependencyPath) pendingPackagePaths.push(dependencyPath);
    }
  }

  if (groupedPackages.size === 0) {
    throw new Error("Installed production dependency graph is empty.");
  }

  return [...groupedPackages.values()]
    .map((entry) => ({
      name: entry.name,
      versions: [...entry.versions].sort(),
      paths: [...entry.paths].sort(),
      license: entry.license,
      author: [...entry.authors].sort()[0] ?? "",
      homepage: [...entry.homepages].sort()[0] ?? "",
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name)
        || left.versions.join(",").localeCompare(right.versions.join(",")),
    );
}

function findRootLicenseFiles(packagePath) {
  let names;
  try {
    names = readdirSync(packagePath);
  } catch {
    return [];
  }
  return names
    .filter((name) =>
      /^(?:licen[sc]e|copying|notice)(?:[._-].*)?$/iu.test(name),
    )
    .map((name) => join(packagePath, name))
    .filter((path) => {
      try {
        return statSync(path).isFile() && statSync(path).size <= 2_000_000;
      } catch {
        return false;
      }
    })
    .sort();
}

function collectMplFallback() {
  const storePath = join(REPOSITORY_ROOT, "node_modules", ".pnpm");
  if (!existsSync(storePath)) return null;
  const candidates = readdirSync(storePath)
    .filter((name) => name.startsWith("lightningcss@"))
    .sort();
  for (const candidate of candidates) {
    const path = join(
      storePath,
      candidate,
      "node_modules",
      "lightningcss",
      "LICENSE",
    );
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").trim();
    if (text.includes("Mozilla Public License Version 2.0")) {
      return {
        label: "MPL-2.0 full text (from the installed lightningcss package)",
        path,
        text,
      };
    }
  }
  return null;
}

export function parsePnpmLicenseInventory(raw) { // NOSONAR javascript:S3776
  const grouped = JSON.parse(raw);
  const entries = [];
  for (const [licenseExpression, packages] of Object.entries(grouped)) {
    if (!REVIEWED_LICENSE_EXPRESSIONS.has(licenseExpression)) {
      throw new Error(
        `Unreviewed production license expression: ${licenseExpression}`,
      );
    }
    for (const packageRecord of packages) {
      const versions = Array.isArray(packageRecord.versions)
        ? [...packageRecord.versions].map(String).sort()
        : [];
      const paths = Array.isArray(packageRecord.paths)
        ? [...packageRecord.paths].map(String).sort()
        : [];
      if (
        typeof packageRecord.name !== "string"
        || packageRecord.name.length === 0
        || versions.length === 0
        || paths.length === 0
      ) {
        throw new Error(
          `Malformed pnpm license inventory entry for ${String(packageRecord.name)}`,
        );
      }
      entries.push({
        name: packageRecord.name,
        versions,
        paths,
        license: licenseExpression,
        author:
          typeof packageRecord.author === "string" ? packageRecord.author : "",
        homepage:
          typeof packageRecord.homepage === "string"
            ? packageRecord.homepage
            : "",
      });
    }
  }
  return entries.sort(
    (left, right) =>
      left.name.localeCompare(right.name)
      || left.versions.join(",").localeCompare(right.versions.join(",")),
  );
}

export function isRecoverablePnpmLicenseInventoryError(error) {
  let stderr = "";
  if (typeof error?.stderr === "string") stderr = error.stderr;
  else if (Buffer.isBuffer(error?.stderr)) stderr = error.stderr.toString("utf8");
  let stdout = "";
  if (typeof error?.stdout === "string") stdout = error.stdout;
  else if (Buffer.isBuffer(error?.stdout)) stdout = error.stdout.toString("utf8");
  return `${String(error?.message ?? "")}\n${stderr}\n${stdout}`.includes(
    "ERR_PNPM_MISSING_PACKAGE_INDEX_FILE",
  );
}

export function readResolvedLicenseInventory({
  source = "pnpm",
  runPnpmLicenseList = () =>
    execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["licenses", "list", "--prod", "--json"],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
} = {}) {
  if (source === "filesystem") {
    return readFilesystemLicenseInventory();
  }
  if (source !== "pnpm") {
    throw new Error(`Unsupported license inventory source: ${source}`);
  }
  try {
    const raw = runPnpmLicenseList();
    return parsePnpmLicenseInventory(raw);
  } catch (error) {
    if (!isRecoverablePnpmLicenseInventoryError(error)) {
      if (error?.stderr) process.stderr.write(error.stderr);
      throw error;
    }
    process.stderr.write(
      "pnpm's cached package index is incomplete; verifying the installed production dependency graph directly.\n",
    );
    return readFilesystemLicenseInventory();
  }
}

function validateDirectDependencies(packageJson, inventory) {
  const productionDependencies = packageJson.dependencies ?? {};
  for (const [name, version] of Object.entries(HYBRID_PROVIDER_DEPENDENCIES)) {
    if (productionDependencies[name] !== version) {
      throw new Error(
        `${name} must remain pinned to ${version}; found ${String(productionDependencies[name])}.`,
      );
    }
    const resolved = inventory.find(
      (entry) => entry.name === name && entry.versions.includes(version),
    );
    if (!resolved) {
      throw new Error(`${name}@${version} is absent from the resolved graph.`);
    }
  }
}

function collectLicenseDocuments(inventory, additionalDocuments = []) { // NOSONAR javascript:S3776
  const documents = new Map();
  const missing = [];

  function addDocument(labelsInput, sourcesInput, text) {
    const labels = Array.isArray(labelsInput) ? labelsInput : [labelsInput];
    const sources = Array.isArray(sourcesInput) ? sourcesInput : [sourcesInput];
    const normalized = normalizeNoticeText(text);
    if (!normalized) return;
    const digest = sha256(normalized);
    const existing = documents.get(digest);
    if (existing) {
      for (const label of labels) existing.labels.add(label);
      for (const source of sources) existing.sources.add(source);
      return;
    }
    documents.set(digest, {
      labels: new Set(labels),
      sources: new Set(sources),
      text: normalized,
    });
  }

  for (const entry of inventory) {
    const files = [...new Set(entry.paths.flatMap(findRootLicenseFiles))];
    if (files.length === 0) {
      missing.push(entry);
      continue;
    }
    for (const file of files) {
      addDocument(
        `${entry.name}@${entry.versions.join(", ")} — ${entry.license}`,
        relative(REPOSITORY_ROOT, file),
        readFileSync(file, "utf8"),
      );
    }
  }

  addDocument(
    "onnxruntime-web / onnxruntime-common 1.27.0 — MIT",
    "https://github.com/microsoft/onnxruntime/blob/v1.27.0/LICENSE",
    ONNX_RUNTIME_MIT_NOTICE,
  );
  addDocument(
    "Hokusai brush/core/tile-mem 0.3.0 — MIT option",
    "https://github.com/reearth/hokusai/blob/f7e998173c0e7427b95afe0b6947e3103da60f00/LICENSE-MIT",
    HOKUSAI_MIT_NOTICE,
  );
  addDocument(
    "wasm-bindgen 0.2.123 family — MIT option",
    "https://github.com/wasm-bindgen/wasm-bindgen/blob/0.2.123/LICENSE-MIT",
    WASM_BINDGEN_MIT_NOTICE,
  );
  addDocument(
    "Hokusai brush/core/tile-mem 0.3.0 — Apache-2.0 option",
    "https://github.com/reearth/hokusai/blob/f7e998173c0e7427b95afe0b6947e3103da60f00/LICENSE-APACHE",
    readFileSync(
      join(HOKUSAI_PACKAGE_DIRECTORY, "LICENSE-APACHE"),
      "utf8",
    ),
  );
  addDocument(
    "wasm-bindgen 0.2.123 family — Apache-2.0 option",
    "https://github.com/wasm-bindgen/wasm-bindgen/blob/0.2.123/LICENSE-APACHE",
    readFileSync(
      join(HOKUSAI_PACKAGE_DIRECTORY, "LICENSE-APACHE"),
      "utf8",
    ),
  );
  addDocument(
    "unicode-ident 1.0.24 data tables — Unicode-3.0",
    "https://github.com/dtolnay/unicode-ident/blob/1.0.24/LICENSE-UNICODE",
    readFileSync(
      join(HOKUSAI_PACKAGE_DIRECTORY, "LICENSE-UNICODE"),
      "utf8",
    ),
  );

  const mplFallback = collectMplFallback();
  if (!mplFallback) {
    throw new Error(
      "A complete MPL-2.0 text is required to package @resvg/resvg-wasm.",
    );
  }
  addDocument(
    mplFallback.label,
    relative(REPOSITORY_ROOT, mplFallback.path),
    mplFallback.text,
  );

  const xatlasCompanion = join(
    REPOSITORY_ROOT,
    "node_modules",
    "xatlasjs",
    "dist",
    "xatlas.js.LICENSE.txt",
  );
  if (!existsSync(xatlasCompanion)) {
    throw new Error("xatlasjs Comlink companion attribution is missing.");
  }
  const xatlasCompanionText = readFileSync(xatlasCompanion, "utf8").trim();
  if (
    !xatlasCompanionText.includes("Copyright 2019 Google LLC")
    || !xatlasCompanionText.includes("Apache-2.0")
  ) {
    throw new Error("xatlasjs Comlink attribution has changed and needs review.");
  }
  addDocument(
    "Comlink runtime embedded by xatlasjs 0.2.0 — Apache-2.0",
    relative(REPOSITORY_ROOT, xatlasCompanion),
    xatlasCompanionText,
  );
  for (const document of readEmbeddedFirstPartyPortDocuments()) {
    addDocument([...document.labels], [...document.sources], document.text);
  }
  for (const document of additionalDocuments) {
    addDocument(
      [...document.labels],
      [...document.sources],
      document.text,
    );
  }

  const sortedMissing = [...missing].sort((left, right) => left.name.localeCompare(right.name));
  return {
    documents: [...documents.entries()]
      .map(([digest, document]) => ({ digest, ...document }))
      .sort((left, right) => left.digest.localeCompare(right.digest)),
    missing: sortedMissing,
  };
}

function validateRepositoryPolicy() {
  const notice = readFileSync(REPOSITORY_NOTICE_PATH, "utf8");
  const requiredFragments = [
    "https://github.com/yisibl/resvg-js/tree/v2.6.2",
    "https://github.com/microsoft/onnxruntime/tree/v1.27.0",
    "https://github.com/dulnan/lazy-brush",
    "https://github.com/steveruizok/perfect-freehand",
    "https://github.com/acamposuribe/p5.brush",
    "https://github.com/processing/p5.js",
    "https://github.com/brendankenny/libtess.js",
    "https://github.com/reearth/hokusai/tree/f7e998173c0e7427b95afe0b6947e3103da60f00",
    "https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.123",
    "`hokusai-brush`, `hokusai-core`, and `hokusai-tile-mem`",
    "`wasm-bindgen` family",
    "`unicode-ident` data tables",
    "pnpm run verify:studio-hokusai-wasm",
    "does not statically import the resolved `p5` peer",
    "Comlink runtime embedded by `xatlasjs`",
    "opencascade.js@1.1.1",
    OCCT_SOURCE_COMMIT,
    OCCT_NPM_INTEGRITY,
    OCCT_WASM_SHA256,
    "docs/third-party/opencascade-lgpl.md",
    "pnpm run audit:licenses",
    "https://github.com/dli/paint",
    "https://github.com/disjukr/croquis.js",
    "https://github.com/bitbof/klecks",
    "third_party/dli-paint/LICENSE",
    "third_party/croquis-js/LICENSE-MIT",
    "third_party/klecks/LICENSE",
    "studio-impasto-relief-shading-v1.ts",
    "studio-gpu-bristle-wgsl.ts",
    "studio-croquis-capsule-pen-v1.ts",
    "studio-oss-brush-kernels.ts",
    "dist/legal/THIRD_PARTY_NOTICES.generated.md",
    "crates/studio-engine-vello/THIRD_PARTY_INVENTORY.json",
    "crates/studio-engine-vello/pkg/THIRD_PARTY_LICENSES.txt",
    "crates/studio-engine-vello/pkg-gpu/THIRD_PARTY_LICENSES.txt",
    "packages/studio-brush-platform/src/ink-mesh/THIRD_PARTY_INVENTORY.json",
    "packages/studio-brush-platform/src/ink-modeler/THIRD_PARTY_INVENTORY.json",
    "packages/studio-brush-platform/src/libmypaint/THIRD_PARTY_INVENTORY.json",
    "google/ink-stroke-modeler",
    "abseil-cpp",
    "libmypaint",
  ];
  for (const fragment of requiredFragments) {
    if (!notice.includes(fragment)) {
      throw new Error(`Repository notice is missing required text: ${fragment}`);
    }
  }
}

function validateOpenCascadeReleaseBoundary() {
  const packageDirectory = join(REPOSITORY_ROOT, "node_modules", "opencascade.js");
  const packageJsonPath = join(packageDirectory, "package.json");
  const readmePath = join(packageDirectory, "README.md");
  const wasmPath = join(packageDirectory, "dist", "opencascade.wasm.wasm");
  for (const path of [
    packageJsonPath,
    readmePath,
    wasmPath,
    OCCT_BOUNDARY_DOCUMENT_PATH,
  ]) {
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`OpenCascade release boundary input is missing: ${relative(REPOSITORY_ROOT, path)}`);
    }
  }

  const metadata = readJson(packageJsonPath);
  if (
    metadata.name !== "opencascade.js"
    || metadata.version !== OCCT_PACKAGE_VERSION
    || metadata.license !== "LGPL-2.1-only"
  ) {
    throw new Error("The reviewed opencascade.js version/license boundary changed.");
  }

  const upstreamReadme = readFileSync(readmePath, "utf8");
  if (!upstreamReadme.includes(OCCT_SOURCE_COMMIT)) {
    throw new Error("The installed opencascade.js artifact no longer identifies the reviewed OCCT commit.");
  }
  const installedWasmDigest = sha256(readFileSync(wasmPath));
  if (installedWasmDigest !== OCCT_WASM_SHA256) {
    throw new Error(
      `The reviewed OpenCascade WASM binary changed: expected ${OCCT_WASM_SHA256}, found ${installedWasmDigest}.`,
    );
  }

  const lockfile = readFileSync(LOCKFILE_PATH, "utf8");
  if (
    !lockfile.includes(`opencascade.js@${OCCT_PACKAGE_VERSION}:`)
    || !lockfile.includes(`integrity: ${OCCT_NPM_INTEGRITY}`)
  ) {
    throw new Error("The reviewed opencascade.js npm artifact integrity changed.");
  }

  const boundaryDocument = readFileSync(OCCT_BOUNDARY_DOCUMENT_PATH, "utf8");
  for (const fragment of [
    OCCT_SOURCE_COMMIT,
    OCCT_NPM_INTEGRITY,
    OCCT_WASM_SHA256,
    "independently emitted",
    "Legal review status",
    "without source modifications",
  ]) {
    if (!boundaryDocument.includes(fragment)) {
      throw new Error(`OpenCascade LGPL boundary is missing required evidence: ${fragment}`);
    }
  }
}

function validateBrowserDistribution() { // NOSONAR javascript:S3776
  const distPath = join(REPOSITORY_ROOT, "dist");
  if (!existsSync(distPath)) return;

  const pending = [distPath];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }
      const relativePath = relative(distPath, path);
      if (relativePath.startsWith(`legal${process.platform === "win32" ? "\\" : "/"}`)) {
        continue;
      }
      if (/sharp-libvips|libvips-cpp/iu.test(relativePath)) {
        throw new Error(
          `Native sharp/libvips runtime leaked into the Vite distribution: ${relativePath}`,
        );
      }
      if (
        /\.(?:css|html|js|json|map|md|txt)$/iu.test(name)
        && stat.size <= 16 * 1024 * 1024
      ) {
        const text = readFileSync(path, "utf8");
        if (/@img\/sharp-libvips|libvips-cpp/iu.test(text)) {
          throw new Error(
            `Native sharp/libvips marker leaked into the Vite distribution: ${relativePath}`,
          );
        }
      }
    }
  }
}

function renderNotice(
  packageJson,
  inventory,
  rustInventory,
  engineNotices,
  documents,
  missing,
) {
  const lockfileHash = sha256(readFileSync(LOCKFILE_PATH));
  const rows = inventory
    .map(
      (entry) =>
        `| \`${escapeTableCell(entry.name)}\` | ${escapeTableCell(entry.versions.join(", "))} | ${escapeTableCell(entry.license)} | ${escapeTableCell(entry.author || "not supplied")} | ${entry.homepage ? "<" + escapeTableCell(entry.homepage) + ">" : "not supplied"} |`,
    )
    .join("\n");

  const missingRows = missing
    .map(
      (entry) =>
        `| \`${escapeTableCell(entry.name)}\` | ${escapeTableCell(entry.versions.join(", "))} | ${escapeTableCell(entry.license)} | ${entry.homepage ? "<" + escapeTableCell(entry.homepage) + ">" : "not supplied"} |`,
    )
    .join("\n");

  const rustRows = rustInventory
    .map(
      (entry) =>
        `| \`${escapeTableCell(entry.name)}\` | ${escapeTableCell(entry.version)} | ${escapeTableCell(entry.license)} | \`${escapeTableCell(entry.checksum)}\` | <${escapeTableCell(entry.homepage)}> |`,
    )
    .join("\n");

  const velloInventory = engineNotices.vello.inventory;
  const velloRows = velloInventory.packages
    .map((entry) => {
      const artifacts = velloInventory.artifacts
        .filter((artifact) => artifact.packages.includes(packageKey(entry)))
        .map(({ id }) => id)
        .join(", ");
      return `| \`${escapeTableCell(entry.name)}\` | ${escapeTableCell(entry.version)} | ${escapeTableCell(entry.license)} | ${escapeTableCell(artifacts)} | \`${escapeTableCell(entry.checksum ?? "path-pinned")}\` | <${escapeTableCell(entry.upstream)}> |`;
    })
    .join("\n");
  const opaqueRows = engineNotices.opaque
    .flatMap(({ inventory: opaqueInventory }) =>
      opaqueInventory.components.map(
        (component) =>
          `| \`${escapeTableCell(opaqueInventory.artifactId)}\` | \`${escapeTableCell(component.name)}\` | ${escapeTableCell(component.version)} | \`${escapeTableCell(component.commit)}\` | ${escapeTableCell(component.license)} | <${escapeTableCell(component.upstream)}> |`,
      ),
    )
    .join("\n");

  const licenseTexts = documents
    .map((document, index) => {
      const labels = [...document.labels].sort().join("; ");
      const sources = [...document.sources].sort().join("; ");
      return `## License text ${index + 1}: ${labels}

- SHA-256: \`${document.digest}\`
- Collected from: ${sources}

\`\`\`text
${document.text}
\`\`\``;
    })
    .join("\n\n");

  return `# ToonSpectrum generated third-party notices

This artifact was generated from the resolved pnpm production graph, the
Hokusai and Vello Cargo lock graphs, and the locked provenance manifests for
independently emitted opaque WASM engines. It is deliberately broader than the
browser bundle so transitive runtime obligations remain visible. Package
archives without a root license file are called out explicitly; reviewed
canonical/source notices and shipped license copies are included below.

- Application: \`${packageJson.name}@${packageJson.version}\`
- Lockfile SHA-256: \`${lockfileHash}\`
- Production inventory entries: ${inventory.length}
- Pinned Hokusai Rust/WASM dependency entries: ${rustInventory.length}
- Pinned Vello CPU \`pkg\` external crate entries: ${engineNotices.vello.cpuPackageCount}
- Pinned Vello GPU \`pkg-gpu\` external crate entries: ${engineNotices.vello.gpuPackageCount}
- Locked opaque WASM provenance inventories: ${engineNotices.opaque.length}
- Distinct collected license texts: ${documents.length}
- Packages without a root license file: ${missing.length}
- Exact MPL-2.0 source for unmodified resvg 2.6.2:
  <https://github.com/yisibl/resvg-js/tree/v2.6.2>
- Exact ONNX Runtime 1.27.0 source:
  <https://github.com/microsoft/onnxruntime/tree/v1.27.0>
- Exact Hokusai 0.3.0 source commit:
  <https://github.com/reearth/hokusai/tree/f7e998173c0e7427b95afe0b6947e3103da60f00>
- Exact wasm-bindgen 0.2.123 source:
  <https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.123>
- Exact OCCT source commit used by unmodified opencascade.js 1.1.1:
  <https://git.dev.opencascade.org/gitweb/?p=occt.git;a=commit;h=${OCCT_SOURCE_COMMIT}>
- opencascade.js 1.1.1 npm artifact integrity:
  \`${OCCT_NPM_INTEGRITY}\`
- Independently emitted OpenCascade WASM SHA-256:
  \`${OCCT_WASM_SHA256}\`

## Resolved production inventory

| Package | Version(s) | SPDX/license expression | Metadata author | Homepage |
| --- | --- | --- | --- | --- |
${rows}

## Pinned Hokusai Rust/WASM inventory

This inventory is validated against
\`packages/studio-hokusai-wasm/Cargo.toml\` and its checked-in Cargo v4 lockfile.
The Hokusai provider crates resolve exactly to 0.3.0 and the complete
\`wasm-bindgen\` family resolves exactly to 0.2.123. A new or changed Cargo
package fails the release audit until its license is reviewed.

| Crate | Version | SPDX/license expression | crates.io checksum | Upstream source |
| --- | --- | --- | --- | --- |
${rustRows}

## Pinned Vello CPU/GPU Rust/WASM inventories

The two shipped Vello artifacts are separately resolved for
\`wasm32-unknown-unknown\`. The CPU artifact uses no optional Cargo features.
The GPU artifact uses the exact \`fabric,lottie,svg\` feature set. Their package
sets, Cargo.lock checksums, binary hashes, upstream metadata, and copied license
documents are validated against
\`crates/studio-engine-vello/THIRD_PARTY_INVENTORY.json\` and
\`THIRD_PARTY_NOTICES.sha256\`. A missing crate, artifact, NOTICE, or license
copy fails the release audit.

| Crate | Version | SPDX/license expression | Artifact(s) | crates.io checksum | Upstream source |
| --- | --- | --- | --- | --- | --- |
${velloRows}

## Locked opaque WASM engine provenance

Google Ink Mesh, Google Ink Stroke Modeler, their exact Abseil revisions, and
libmypaint are independently emitted Emscripten artifacts. Each source artifact
directory ships a machine-readable inventory, hash-locked NOTICE, and exact
upstream license copies. Binary SHA-256 values are also pinned in those
inventories without replacing the existing engine integrity manifests.

| Artifact lane | Component | Version | Commit | License | Upstream source |
| --- | --- | --- | --- | --- | --- |
${opaqueRows}

## Packages whose npm archive has no root license file

These entries remain in the inventory rather than being silently omitted.
Their declared SPDX expression, metadata attribution and source location are
preserved. The reviewed ONNX Runtime MIT notice, full MPL-2.0 text and embedded
xatlas/Comlink attribution are included in the collected texts below.

| Package | Version(s) | SPDX/license expression | Homepage |
| --- | --- | --- | --- |
${missingRows}

## Collected license and attribution texts

${licenseTexts}
`;
}

export function main(argumentsList = process.argv.slice(2)) { // NOSONAR javascript:S3776
  const refreshEngineNotices = argumentsList.includes(
    "--refresh-shipped-engine-notices",
  );
  const outputFlag = argumentsList.indexOf("--output");
  const outputPath =
    outputFlag >= 0 && argumentsList[outputFlag + 1]
      ? resolve(REPOSITORY_ROOT, argumentsList[outputFlag + 1])
      : null;
  const checkOnly = argumentsList.includes("--check");
  const inventorySourceFlag = argumentsList.indexOf("--inventory-source");
  const inventorySource =
    inventorySourceFlag >= 0
      ? argumentsList[inventorySourceFlag + 1]
      : "pnpm";

  if (refreshEngineNotices) {
    if (checkOnly || outputFlag >= 0) {
      throw new Error(
        "--refresh-shipped-engine-notices cannot be combined with --check or --output.",
      );
    }
    const refreshed = refreshShippedEngineNotices();
    const validated = validateShippedEngineNotices();
    process.stdout.write(
      `Refreshed shipped engine notices (${refreshed.vello.artifacts[0].packages.length} Vello CPU crates, ${refreshed.vello.artifacts[1].packages.length} Vello GPU crates, ${validated.opaque.length} opaque WASM inventories).\n`,
    );
    return;
  }

  if (outputFlag >= 0 && !outputPath) {
    throw new Error("--output requires a repository-relative file path.");
  }
  if (!checkOnly && !outputPath) {
    throw new Error("Use --check or --output <path>.");
  }
  if (!inventorySource) {
    throw new Error("--inventory-source requires pnpm or filesystem.");
  }

  const packageJson = readJson(PACKAGE_JSON_PATH);
  const inventory = readResolvedLicenseInventory({
    source: inventorySource,
  });
  const rustInventory = validateHokusaiReleaseContract();
  verifyCheckedInHokusaiArtifacts();
  const engineNotices = validateShippedEngineNotices();
  validateDirectDependencies(packageJson, inventory);
  validateRepositoryPolicy();
  validateOpenCascadeReleaseBoundary();
  const { documents, missing } = collectLicenseDocuments(
    inventory,
    engineNotices.documents,
  );
  const generatedNotice = renderNotice(
    packageJson,
    inventory,
    rustInventory,
    engineNotices,
    documents,
    missing,
  );

  if (generatedNotice.length < 50_000) {
    throw new Error("Generated notice is unexpectedly incomplete.");
  }

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, generatedNotice, "utf8");
    if (
      !existsSync(outputPath)
      || readFileSync(outputPath, "utf8") !== generatedNotice
    ) {
      throw new Error("Generated notice could not be verified after writing.");
    }
    validateBrowserDistribution();
    process.stdout.write(
      `Wrote ${relative(REPOSITORY_ROOT, outputPath)} (${inventory.length} pnpm entries, ${engineNotices.vello.cpuPackageCount}/${engineNotices.vello.gpuPackageCount} Vello CPU/GPU crates, ${engineNotices.opaque.length} opaque WASM inventories, ${documents.length} license texts).\n`,
    );
  } else {
    validateBrowserDistribution();
    process.stdout.write(
      `License audit passed (${inventory.length} pnpm entries, ${engineNotices.vello.cpuPackageCount}/${engineNotices.vello.gpuPackageCount} Vello CPU/GPU crates, ${engineNotices.opaque.length} opaque WASM inventories, ${documents.length} license texts, ${missing.length} npm packages without a root license file).\n`,
    );
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
