import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
export const HOKUSAI_PACKAGE_DIRECTORY = join(
  REPOSITORY_ROOT,
  "packages",
  "studio-hokusai-wasm",
);
export const HOKUSAI_PKG_DIRECTORY = join(
  HOKUSAI_PACKAGE_DIRECTORY,
  "pkg",
);
export const HOKUSAI_INTEGRITY_MANIFEST_PATH = join(
  HOKUSAI_PKG_DIRECTORY,
  "INTEGRITY.sha256",
);

export const HOKUSAI_RELEASE_TOOLCHAIN = Object.freeze({
  cargo: "1.97.1",
  rustc: "1.97.1",
  wasmPack: "0.15.0",
});

export const HOKUSAI_DIRECT_DEPENDENCIES = Object.freeze({
  "hokusai-brush": "0.3.0",
  "hokusai-core": "0.3.0",
  "hokusai-tile-mem": "0.3.0",
  "wasm-bindgen": "0.2.123",
});

const REVIEWED_CRATES_IO_SOURCE =
  "registry+https://github.com/rust-lang/crates.io-index";

export const HOKUSAI_RUST_LOCK_CHECKSUMS = Object.freeze({
  "bumpalo@3.20.3":
    "72f5acc6cb2ba439de613abc23857ec3d78374d8ed5ac84e9d11336e87da8649",
  "cfg-if@1.0.4":
    "9330f8b2ff13f34540b44e946ef35111825727b38d33286ef986142615121801",
  "hokusai-brush@0.3.0":
    "553185ffcdcf55251cd02a2d0be297cd2ac0bf9f8fae50cffb70ddbadc70fee4",
  "hokusai-core@0.3.0":
    "4d0fdc01003e0256eb9bed701ce25b12f9af19bb33bf2340b77babc56960dce9",
  "hokusai-tile-mem@0.3.0":
    "baaeddb70dce44dad67dccd058b30c5eac889a5a36e5c19f5ac76c7711bf45d0",
  "itoa@1.0.18":
    "8f42a60cbdf9a97f5d2305f08a87dc4e09308d1276d28c869c684d7777685682",
  "memchr@2.8.3":
    "cf8baf1c55e62ffcace7a9f06f4bd9cd3f0c4beb022d3b367256b91b87513d98",
  "once_cell@1.21.4":
    "9f7c3e4beb33f85d45ae3e3a1792185706c8e16d043238c593331cc7cd313b50",
  "proc-macro2@1.0.107":
    "985e7ec9bb745e6ce6535b544d84d6cd6f7ad8bd711c398938ae983b91a766d9",
  "quote@1.0.47":
    "1fbf4db142a473a8d80c26bbf18454ed458bf8d26c8219c331daecfdbd079001",
  "rustversion@1.0.23":
    "cf54715a573b99ac80df0bc206da022bcd442c974952c7b9720069370852e21f",
  "serde@1.0.229":
    "4148590afebada386688f18773da617792bf2ef03ffc1e4cbd2b1d45b023e0ba",
  "serde_core@1.0.229":
    "67dca2c9c51e58a4791a4b1ed58308b39c64224d349a935ab5039aa360942a48",
  "serde_derive@1.0.229":
    "e7a5d71263a5a7d47b41f6b3f06ba276f10cc18b0931f1799f710578e2309348",
  "serde_json@1.0.151":
    "c841b55ecdae098c80dcae9cf767f6f8a0c2cdb3416bbef72181df4d0fe73f14",
  "syn@2.0.119":
    "872831b642d1a07999a962a351ed35b955ea2cfc8f3862091e2a240a84f17297",
  "syn@3.0.3":
    "53e9bae58849f64dfa4f5d5ae372c8341f7305f82a3868709269343628b659a3",
  "thiserror@2.0.19":
    "09a43598840e33d5b0331f38c5e30d13bb11c11210a4b58f0d9b18a5a5eefcd9",
  "thiserror-impl@2.0.19":
    "43cbfe0cf76104d42a574802844187e84a305e531ed54455f11fbde0f10541cd",
  "unicode-ident@1.0.24":
    "e6e4313cd5fcd3dad5cafa179702e2b244f760991f45397d14d4ebf38247da75",
  "wasm-bindgen@0.2.123":
    "a254a4b10c19a76f09a27640e7ffbf9bc30bf67e16a3bf28aaefa4920fe81563",
  "wasm-bindgen-macro@0.2.123":
    "24a40fc75b0ec6f3746ceb10d36f53a93dcd68a93b11b6445983945d79eba0dc",
  "wasm-bindgen-macro-support@0.2.123":
    "908f34bd9b9ce3d4caf07b72dfab63d61504d156856c6bd3cd87fa350cf3985b",
  "wasm-bindgen-shared@0.2.123":
    "7acbf7616c27b194bbb550bf77ed0c2c3e5b7fd1260a93082b95fb7f47959b92",
  "zmij@1.0.23":
    "29666d0abbfad1e3dc4dcf6144730dd3a3ab225bbbdac83319345b1b44ccfc1b",
});

const REVIEWED_RUST_LICENSE_EXPRESSIONS = new Set([
  "(MIT OR Apache-2.0) AND Unicode-3.0",
  "MIT",
  "MIT OR Apache-2.0",
  "Unlicense OR MIT",
]);

export const HOKUSAI_RUST_DEPENDENCY_POLICY = Object.freeze([
  {
    name: "bumpalo",
    version: "3.20.3",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/fitzgen/bumpalo",
  },
  {
    name: "cfg-if",
    version: "1.0.4",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/rust-lang/cfg-if",
  },
  {
    name: "hokusai-brush",
    version: "0.3.0",
    license: "MIT OR Apache-2.0",
    homepage:
      "https://github.com/reearth/hokusai/tree/f7e998173c0e7427b95afe0b6947e3103da60f00",
  },
  {
    name: "hokusai-core",
    version: "0.3.0",
    license: "MIT OR Apache-2.0",
    homepage:
      "https://github.com/reearth/hokusai/tree/f7e998173c0e7427b95afe0b6947e3103da60f00",
  },
  {
    name: "hokusai-tile-mem",
    version: "0.3.0",
    license: "MIT OR Apache-2.0",
    homepage:
      "https://github.com/reearth/hokusai/tree/f7e998173c0e7427b95afe0b6947e3103da60f00",
  },
  {
    name: "itoa",
    version: "1.0.18",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/itoa",
  },
  {
    name: "memchr",
    version: "2.8.3",
    license: "Unlicense OR MIT",
    homepage: "https://github.com/BurntSushi/memchr",
  },
  {
    name: "once_cell",
    version: "1.21.4",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/matklad/once_cell",
  },
  {
    name: "proc-macro2",
    version: "1.0.107",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/proc-macro2",
  },
  {
    name: "quote",
    version: "1.0.47",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/quote",
  },
  {
    name: "rustversion",
    version: "1.0.23",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/rustversion",
  },
  {
    name: "serde",
    version: "1.0.229",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/serde-rs/serde",
  },
  {
    name: "serde_core",
    version: "1.0.229",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/serde-rs/serde",
  },
  {
    name: "serde_derive",
    version: "1.0.229",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/serde-rs/serde",
  },
  {
    name: "serde_json",
    version: "1.0.151",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/serde-rs/json",
  },
  {
    name: "syn",
    version: "2.0.119",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/syn",
  },
  {
    name: "syn",
    version: "3.0.3",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/syn",
  },
  {
    name: "thiserror",
    version: "2.0.19",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/thiserror",
  },
  {
    name: "thiserror-impl",
    version: "2.0.19",
    license: "MIT OR Apache-2.0",
    homepage: "https://github.com/dtolnay/thiserror",
  },
  {
    name: "unicode-ident",
    version: "1.0.24",
    license: "(MIT OR Apache-2.0) AND Unicode-3.0",
    homepage: "https://github.com/dtolnay/unicode-ident",
  },
  {
    name: "wasm-bindgen",
    version: "0.2.123",
    license: "MIT OR Apache-2.0",
    homepage:
      "https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.123",
  },
  {
    name: "wasm-bindgen-macro",
    version: "0.2.123",
    license: "MIT OR Apache-2.0",
    homepage:
      "https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.123/crates/macro",
  },
  {
    name: "wasm-bindgen-macro-support",
    version: "0.2.123",
    license: "MIT OR Apache-2.0",
    homepage:
      "https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.123/crates/macro-support",
  },
  {
    name: "wasm-bindgen-shared",
    version: "0.2.123",
    license: "MIT OR Apache-2.0",
    homepage:
      "https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.123/crates/shared",
  },
  {
    name: "zmij",
    version: "1.0.23",
    license: "MIT",
    homepage: "https://github.com/dtolnay/zmij",
  },
]);

function cargoPackageKey({ name, version }) {
  return `${name}@${version}`;
}

export function parseCargoLockPackages(lockText) {
  return lockText
    .split(/^\[\[package\]\]\s*$/mu)
    .slice(1)
    .map((block) => {
      const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/mu)?.[1] ?? "";
      const version =
        block.match(/^version\s*=\s*"([^"]+)"\s*$/mu)?.[1] ?? "";
      const source =
        block.match(/^source\s*=\s*"([^"]+)"\s*$/mu)?.[1] ?? "";
      const checksum =
        block.match(/^checksum\s*=\s*"([^"]+)"\s*$/mu)?.[1] ?? "";
      if (!name || !version) {
        throw new Error("Cargo.lock contains a malformed package entry.");
      }
      return { name, version, source, checksum };
    })
    .sort((left, right) =>
      cargoPackageKey(left).localeCompare(cargoPackageKey(right)),
    );
}

function requireExactCargoManifestValue(manifestText, key, expected) {
  const expression = new RegExp(
    `^${key}\\s*=\\s*"([^"]+)"\\s*$`,
    "mu",
  );
  const actual = manifestText.match(expression)?.[1] ?? "";
  if (actual !== expected) {
    throw new Error(
      `studio-hokusai-wasm Cargo.toml must pin ${key} to ${expected}; found ${actual || "(missing)"}.`,
    );
  }
}

export function validateHokusaiReleaseContract({ // NOSONAR javascript:S3776
  manifestText = readFileSync(
    join(HOKUSAI_PACKAGE_DIRECTORY, "Cargo.toml"),
    "utf8",
  ),
  lockText = readFileSync(
    join(HOKUSAI_PACKAGE_DIRECTORY, "Cargo.lock"),
    "utf8",
  ),
} = {}) {
  requireExactCargoManifestValue(manifestText, "version", "0.1.0");
  requireExactCargoManifestValue(
    manifestText,
    "license",
    "MIT OR Apache-2.0",
  );
  for (const [name, version] of Object.entries(HOKUSAI_DIRECT_DEPENDENCIES)) {
    requireExactCargoManifestValue(manifestText, name, `=${version}`);
  }

  const packages = parseCargoLockPackages(lockText);
  const localPackages = packages.filter(
    ({ name }) => name === "studio-hokusai-wasm",
  );
  if (
    localPackages.length !== 1
    || localPackages[0].version !== "0.1.0"
    || localPackages[0].source
    || localPackages[0].checksum
  ) {
    throw new Error(
      "Cargo.lock must contain exactly one local studio-hokusai-wasm@0.1.0 package.",
    );
  }

  const externalPackages = packages.filter(
    ({ name }) => name !== "studio-hokusai-wasm",
  );
  const expectedKeys = HOKUSAI_RUST_DEPENDENCY_POLICY
    .map(cargoPackageKey)
    .sort();
  const expectedChecksumKeys = Object.keys(
    HOKUSAI_RUST_LOCK_CHECKSUMS,
  ).sort();
  if (
    JSON.stringify(expectedChecksumKeys)
    !== JSON.stringify(expectedKeys)
  ) {
    throw new Error(
      "Reviewed Hokusai Rust dependency metadata and checksum policy differ.",
    );
  }
  const actualKeys = externalPackages.map(cargoPackageKey).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `Cargo.lock Rust dependency graph changed.\nExpected: ${expectedKeys.join(", ")}\nActual: ${actualKeys.join(", ")}`,
    );
  }

  const policyByKey = new Map(
    HOKUSAI_RUST_DEPENDENCY_POLICY.map((entry) => [
      cargoPackageKey(entry),
      entry,
    ]),
  );
  for (const entry of externalPackages) {
    if (entry.source !== REVIEWED_CRATES_IO_SOURCE) {
      throw new Error(
        `Cargo.lock dependency source differs from the reviewed crates.io registry: ${cargoPackageKey(entry)}.`,
      );
    }
    const key = cargoPackageKey(entry);
    const expectedChecksum = HOKUSAI_RUST_LOCK_CHECKSUMS[key];
    if (entry.checksum !== expectedChecksum) {
      throw new Error(
        `Cargo.lock checksum differs from the reviewed value: ${key}.`,
      );
    }
    const policy = policyByKey.get(key);
    if (!policy || !REVIEWED_RUST_LICENSE_EXPRESSIONS.has(policy.license)) {
      throw new Error(
        `Unreviewed Rust/WASM license: ${policy?.license ?? "(missing)"} (${cargoPackageKey(entry)}).`,
      );
    }
  }

  for (const [name, expectedVersion] of Object.entries(
    HOKUSAI_DIRECT_DEPENDENCIES,
  )) {
    const matches = externalPackages.filter((entry) => entry.name === name);
    if (
      matches.length !== 1
      || matches[0].version !== expectedVersion
    ) {
      throw new Error(
        `${name} must resolve exactly once at ${expectedVersion}.`,
      );
    }
  }

  return HOKUSAI_RUST_DEPENDENCY_POLICY.map((policy) => {
    const resolved = externalPackages.find(
      (entry) => cargoPackageKey(entry) === cargoPackageKey(policy),
    );
    return {
      ...policy,
      checksum: resolved.checksum,
    };
  });
}
