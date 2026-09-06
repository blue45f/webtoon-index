import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EMBEDDED_FIRST_PARTY_PORT_NOTICES,
  OPAQUE_WASM_POLICIES,
  isRecoverablePnpmLicenseInventoryError,
  parsePnpmLicenseInventory,
  readEmbeddedFirstPartyPortDocuments,
  readFilesystemLicenseInventory,
  readResolvedLicenseInventory,
  validateLockedNoticeFiles,
  validateOpaqueWasmThirdPartyInventory,
  validateShippedEngineNotices,
  validateVelloThirdPartyInventory,
} from "../generate-third-party-notices.mjs";

const REPOSITORY_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCRIPT_PATH = join(
  REPOSITORY_ROOT,
  "scripts",
  "generate-third-party-notices.mjs",
);
const VELLO_DIRECTORY = join(
  REPOSITORY_ROOT,
  "crates",
  "studio-engine-vello",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

describe("generated third-party notice inventory", () => {
  it("only treats pnpm's missing cached package index as recoverable", () => {
    expect(
      isRecoverablePnpmLicenseInventoryError({
        stdout: JSON.stringify({
          error: {
            code: "ERR_PNPM_MISSING_PACKAGE_INDEX_FILE",
            message: "Failed to find package index",
          },
        }),
      }),
    ).toBe(true);
    expect(
      isRecoverablePnpmLicenseInventoryError({
        stderr: "ERR_PNPM_OUTDATED_LOCKFILE",
      }),
    ).toBe(false);
  });

  it("falls back only for the exact recoverable pnpm cache error", () => {
    const fallback = readResolvedLicenseInventory({
      runPnpmLicenseList: () => {
        throw Object.assign(new Error("pnpm failed"), {
          stdout: Buffer.from(
            JSON.stringify({
              error: {
                code: "ERR_PNPM_MISSING_PACKAGE_INDEX_FILE",
                message: "missing package index",
              },
            }),
          ),
        });
      },
    });

    expect(fallback.length).toBeGreaterThan(500);
    expect(() =>
      readResolvedLicenseInventory({
        runPnpmLicenseList: () => {
          throw Object.assign(new Error("pnpm failed"), {
            stderr: Buffer.from("ERR_PNPM_OUTDATED_LOCKFILE"),
          });
        },
      }),
    ).toThrow("pnpm failed");
  });

  it("rejects unreviewed license expressions from pnpm", () => {
    expect(() =>
      parsePnpmLicenseInventory(
        JSON.stringify({
          Proprietary: [
            {
              name: "unexpected-package",
              versions: ["1.0.0"],
              paths: ["/tmp/unexpected-package"],
            },
          ],
        }),
      ),
    ).toThrow("Unreviewed production license expression");
  });

  it("keeps the reviewed p5.brush standalone dependency licenses auditable", () => {
    const inventory = parsePnpmLicenseInventory(
      JSON.stringify({
        MIT: [
          {
            name: "p5.brush",
            versions: ["2.2.1"],
            paths: ["/tmp/p5-brush"],
          },
        ],
        "LGPL-2.1": [
          {
            name: "p5",
            versions: ["2.3.1"],
            paths: ["/tmp/p5"],
          },
        ],
        "SGI-B-2.0": [
          {
            name: "libtess",
            versions: ["1.2.2"],
            paths: ["/tmp/libtess"],
          },
        ],
      }),
    );

    expect(inventory.map(({ name, license }) => [name, license])).toEqual([
      ["libtess", "SGI-B-2.0"],
      ["p5", "LGPL-2.1"],
      ["p5.brush", "MIT"],
    ]);
  });

  it("accepts the reviewed dual-license expression used by Hokusai WASM", () => {
    const inventory = parsePnpmLicenseInventory(
      JSON.stringify({
        "MIT OR Apache-2.0": [
          {
            name: "dual-licensed-wasm-provider",
            versions: ["0.3.0"],
            paths: ["/tmp/dual-licensed-wasm-provider"],
          },
        ],
      }),
    );

    expect(inventory[0]).toMatchObject({
      name: "dual-licensed-wasm-provider",
      license: "MIT OR Apache-2.0",
    });
  });

  it("reconstructs a complete reviewed production graph from installed packages", () => {
    const inventory = readFilesystemLicenseInventory();

    expect(inventory.length).toBeGreaterThan(500);
    expect(
      inventory.every(
        (entry) =>
          entry.versions.length > 0
          && entry.paths.length > 0
          && entry.paths.every((path) => existsSync(join(path, "package.json"))),
      ),
    ).toBe(true);
    expect(
      inventory.some(
        (entry) =>
          entry.name === "@dimforge/rapier3d-deterministic-compat"
          && entry.versions.includes("0.19.3")
          && entry.license === "Apache-2.0",
      ),
    ).toBe(true);
  });

  it("validates both Vello feature inventories and every opaque WASM provenance boundary", () => {
    const result = validateShippedEngineNotices();

    expect(result.vello.cpuPackageCount).toBe(85);
    expect(result.vello.gpuPackageCount).toBe(144);
    expect(result.opaque).toHaveLength(3);
    expect(
      result.vello.inventory.artifacts.find(({ id }) => id === "pkg-gpu"),
    ).toMatchObject({
      features: ["fabric", "lottie", "svg"],
    });
    expect(
      result.vello.inventory.packages.map(({ name, version }) =>
        `${name}@${version}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        "vello@0.9.0",
        "velato@0.11.0",
        "vello_svg@0.10.0",
        "usvg@0.46.0",
        "parley@0.11.0",
        "harfrust@0.10.0",
        "skrifa@0.42.1",
        "skrifa@0.43.2",
        "skrifa@0.44.0",
      ]),
    );
    expect(
      result.opaque.flatMap(({ inventory }) =>
        inventory.components.map(({ name }) => name),
      ),
    ).toEqual([
      "google/ink",
      "abseil-cpp",
      "google/ink-stroke-modeler",
      "abseil-cpp",
      "libmypaint",
    ]);
  });

  it("fails when a Vello feature inventory omits a shipped Cargo package", () => {
    const inventory = JSON.parse(
      readFileSync(
        join(VELLO_DIRECTORY, "THIRD_PARTY_INVENTORY.json"),
        "utf8",
      ),
    );
    inventory.packages = inventory.packages.filter(
      ({ name, version }) => `${name}@${version}` !== "vello@0.9.0",
    );

    expect(() =>
      validateVelloThirdPartyInventory({
        directory: VELLO_DIRECTORY,
        inventory,
        validateFiles: false,
      }),
    ).toThrow("pkg-gpu references an unreviewed package: vello@0.9.0");
  });

  it("fails when an opaque WASM inventory omits a component or artifact", () => {
    const policy = OPAQUE_WASM_POLICIES[0];
    const inventory = JSON.parse(
      readFileSync(
        join(policy.directory, "THIRD_PARTY_INVENTORY.json"),
        "utf8",
      ),
    );
    const missingComponent = structuredClone(inventory);
    missingComponent.components.pop();
    expect(() =>
      validateOpaqueWasmThirdPartyInventory(policy, {
        inventory: missingComponent,
        validateFiles: false,
      }),
    ).toThrow("opaque WASM inventory is malformed");

    const missingArtifact = structuredClone(inventory);
    missingArtifact.artifacts.pop();
    expect(() =>
      validateOpaqueWasmThirdPartyInventory(policy, {
        inventory: missingArtifact,
        validateFiles: false,
      }),
    ).toThrow("artifact file set changed");
  });

  it("fails when a hash-pinned opaque WASM artifact file is omitted", () => {
    const policy = OPAQUE_WASM_POLICIES[0];
    const directory = mkdtempSync(
      join(tmpdir(), "toonspectrum-opaque-engine-artifact-test-"),
    );
    try {
      for (const path of [
        ...policy.requiredNoticeFiles,
        "THIRD_PARTY_NOTICES.sha256",
        policy.artifactFiles[0],
      ]) {
        copyFileSync(join(policy.directory, path), join(directory, path));
      }
      const inventory = JSON.parse(
        readFileSync(
          join(policy.directory, "THIRD_PARTY_INVENTORY.json"),
          "utf8",
        ),
      );

      expect(() =>
        validateOpaqueWasmThirdPartyInventory(policy, {
          directory,
          inventory,
        }),
      ).toThrow(
        `artifact provenance no longer matches ${policy.artifactFiles[1]}`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails when a hash-locked shipped license copy is omitted or changed", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "toonspectrum-engine-notice-lock-test-"),
    );
    const requiredFiles = ["LICENSE", "NOTICE", "THIRD_PARTY_INVENTORY.json"];
    try {
      for (const path of requiredFiles) {
        writeFileSync(join(directory, path), `${path}\n`, "utf8");
      }
      const sortedRequiredFiles = [...requiredFiles].sort();
      writeFileSync(
        join(directory, "THIRD_PARTY_NOTICES.sha256"),
        `${sortedRequiredFiles.map(
          (path) => `${sha256(readFileSync(join(directory, path)))}  ${path}`,
        ).join("\n")}\n`,
        "utf8",
      );
      expect(validateLockedNoticeFiles(directory, requiredFiles).size).toBe(3);

      rmSync(join(directory, "THIRD_PARTY_INVENTORY.json"));
      expect(() =>
        validateLockedNoticeFiles(directory, requiredFiles),
      ).toThrow(
        "Required shipped third-party notice file is missing: THIRD_PARTY_INVENTORY.json",
      );
      writeFileSync(
        join(directory, "THIRD_PARTY_INVENTORY.json"),
        "THIRD_PARTY_INVENTORY.json\n",
        "utf8",
      );

      rmSync(join(directory, "LICENSE"));
      expect(() =>
        validateLockedNoticeFiles(directory, requiredFiles),
      ).toThrow("Required shipped third-party notice file is missing: LICENSE");

      writeFileSync(join(directory, "LICENSE"), "changed\n", "utf8");
      expect(() =>
        validateLockedNoticeFiles(directory, requiredFiles),
      ).toThrow("Shipped third-party notice hash mismatch for LICENSE");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("collects the embedded first-party port licenses fail-closed", () => {
    // Adversarial-review probe (Lens 2): the dli/paint and croquis.js code
    // ports shipped without any distribution-notice coverage. Before the fix
    // these exports did not exist and the generated dist notice omitted both
    // upstreams; now the checked-in verbatim copies are mandatory inputs.
    expect(
      EMBEDDED_FIRST_PARTY_PORT_NOTICES.map(({ licensePath }) =>
        licensePath.slice(licensePath.indexOf("third_party")),
      ),
    ).toEqual([
      join("third_party", "dli-paint", "LICENSE"),
      join("third_party", "dli-paint", "LICENSE"),
      join("third_party", "croquis-js", "LICENSE-MIT"),
      join("third_party", "klecks", "LICENSE"),
    ]);

    const documents = readEmbeddedFirstPartyPortDocuments();
    expect(documents).toHaveLength(4);
    for (const document of documents) {
      expect(document.text).toContain("Permission is hereby granted");
      expect(document.text).toContain(
        "The above copyright notice and this permission notice shall be included",
      );
    }
    expect(documents[0].text).toContain("Copyright (c) 2017 David Li");
    expect(documents[1].text).toContain("Copyright (c) 2017 David Li");
    expect(documents[2].text).toContain("JongChan Choi");
    expect(documents[3].text).toContain("bitbof");

    const directory = mkdtempSync(
      join(tmpdir(), "toonspectrum-embedded-port-license-test-"),
    );
    try {
      const missing = [
        {
          ...EMBEDDED_FIRST_PARTY_PORT_NOTICES[0],
          licensePath: join(directory, "LICENSE"),
        },
      ];
      expect(() => readEmbeddedFirstPartyPortDocuments(missing)).toThrow(
        "First-party embedded port license copy is missing",
      );

      writeFileSync(
        join(directory, "LICENSE"),
        "MIT License\n\nCopyright (c) 2017 David Li (http://david.li)\n",
        "utf8",
      );
      expect(() => readEmbeddedFirstPartyPortDocuments(missing)).toThrow(
        "First-party embedded port license changed and needs review",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes the full legal audit without pnpm's package index", () => {
    const output = execFileSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--check",
        "--inventory-source",
        "filesystem",
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
      },
    );

    expect(output).toMatch(
      /^License audit passed \(\d+ pnpm entries, 85\/144 Vello CPU\/GPU crates, 3 opaque WASM inventories, \d+ license texts, \d+ npm packages without a root license file\)\.\n$/u,
    );
  });

  it("writes complete pnpm, Hokusai, Vello, and opaque WASM notices", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "toonspectrum-third-party-notice-test-"),
    );
    const outputPath = join(directory, "THIRD_PARTY_NOTICES.generated.md");
    try {
      execFileSync(
        process.execPath,
        [
          SCRIPT_PATH,
          "--output",
          outputPath,
          "--inventory-source",
          "filesystem",
        ],
        {
          cwd: REPOSITORY_ROOT,
          encoding: "utf8",
        },
      );
      const notice = readFileSync(outputPath, "utf8");
      expect(notice).toContain("## Pinned Hokusai Rust/WASM inventory");
      expect(notice).toContain(
        "| `hokusai-core` | 0.3.0 | MIT OR Apache-2.0 |",
      );
      expect(notice).toContain(
        "| `wasm-bindgen` | 0.2.123 | MIT OR Apache-2.0 |",
      );
      expect(notice).toContain(
        "Copyright (c) 2026 Re:Earth and contributors",
      );
      expect(notice).toContain("Copyright (c) 2014 Alex Crichton");
      expect(notice).toContain("UNICODE LICENSE V3");
      expect(notice).toContain("Copyright © 1991-2023 Unicode, Inc.");
      expect(notice).toContain(
        "33d9a6fa21ca4fa711da7066655aa2ba854545ee",
      );
      expect(notice).toContain(
        "sha512-lw6/vOl86+CkJ8d3V01mlbGAC0A49gc1HbwGcqGeKjk5SGRLiF15jyUuA8aYEvizcPNTu4Ta4A+Ut2DJgsa7AQ==",
      );
      expect(notice).toContain(
        "6cc2f3fa1611d32ad7563f7092aa1bf58741124302630cef7d21561ecd7b7284",
      );
      expect(notice).toContain("## Pinned Vello CPU/GPU Rust/WASM inventories");
      expect(notice).toContain("| `vello` | 0.9.0 | Apache-2.0 OR MIT | pkg-gpu |");
      expect(notice).toContain("| `velato` | 0.11.0 | Apache-2.0 OR MIT | pkg-gpu |");
      expect(notice).toContain("| `vello_svg` | 0.10.0 | Apache-2.0 OR MIT | pkg-gpu |");
      expect(notice).toContain("| `harfrust` | 0.10.0 | MIT | pkg, pkg-gpu |");
      expect(notice).toContain("## Locked opaque WASM engine provenance");
      expect(notice).toContain("`google/ink-stroke-modeler`");
      expect(notice).toContain("`abseil-cpp`");
      expect(notice).toContain("`libmypaint`");
      // Lens-2 regression: MIT permission notices for the hand-ported
      // dli/paint, croquis.js, and Klecks code must reach the dist notice.
      // These four assertions fail on the pre-fix generator.
      expect(notice).toContain(
        "dli/paint (Fluid Paint) painting.frag CPU port",
      );
      expect(notice).toContain("Copyright (c) 2017 David Li");
      expect(notice).toContain(
        "croquis.js (@disjukr/croquis-js 0.0.3) capsule pen + pulled-string port",
      );
      expect(notice).toContain("JongChan Choi");
      expect(notice).toContain(
        "Klecks brush tip kernel re-implementations",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
