import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  admitStudioBg3dKtx2Transcode,
  attestStudioBg3dKtx2TranscoderAssets,
  STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST,
  type StudioBg3dAttestedKtx2Transcoder,
} from "./studio-bg3d-ktx2-transcoder-contract";
import { inspectStudioBg3dBasisKtx2 } from "./studio-bg3d-ktx2-validation";

// Pinned copies of Three r184's official 40x40 Basis examples. Keeping these tiny fixtures inline
// makes the release gate deterministic and offline while retaining their exact upstream bytes.
// Source: https://github.com/mrdoob/three.js/tree/r184/examples/textures/ktx2 (MIT license).
const ETC1S_BASE64 = [
  "q0tUWCAyMLsNChoKAAAAAAEAAAAoAAAAKAAAAAAAAAAAAAAAAQAAAAYAAAABAAAA4AAAACwAAAAMAQAANAAAAEABAAAAAAAADgIA",
  "AAAAAAB/AwAAAAAAAEcAAAAAAAAAAAAAAAAAAABiAwAAAAAAAB0AAAAAAAAAAAAAAAAAAABXAwAAAAAAAAsAAAAAAAAAAAAAAAAA",
  "AABSAwAAAAAAAAUAAAAAAAAAAAAAAAAAAABQAwAAAAAAAAIAAAAAAAAAAAAAAAAAAABOAwAAAAAAAAIAAAAAAAAAAAAAAAAAAAAs",
  "AAAAAAAAAAIAKACjAQIAAwMAAAAAAAAAAAAAAAA/AAAAAAAAAAAA/////zAAAABLVFh3cml0ZXIAa3R4IGNyZWF0ZSB2NC4zLjF+",
  "MSAvIGxpYmt0eCB2NC4zLjB+MQARAEcATgAAAOIAAABSAAAAAAAAAAAAAAAAAAAARwAAAAAAAAAAAAAAAAAAAAAAAAAdAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAsAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAIA",
  "AAAAAAAAAAAAAB5ABIEBAIBAYFfmDwwQIJKAAABAQHB2SXmAchEQ4JHAAACAELHeUAcDAYgAAAAAEAhqLNu1NsfYtHSTp3J/U0WP",
  "vYwSIPsfugAGwtwABJgH4gpIw1AUQE9vIk3KgxLURRzukCFqxIc6FtIOXYpgBwvi5qiT6A9cHoKDm+AiDtIpivgLPiz+gIKTHyEC",
  "APwAQwPgIXrwEXA4HHt/RIAGiACRyAIizgE4HP2EPkAHpCNJJ09zVm6lKzf5Jb1aztlud+D7GQbRk+ZLs9HBUJ/ATFUBA8QEIZjB",
  "C4BhmEEAE1Woqh7QZtk8yxRQM5MqBBFpQS1TmKtuFsV4Y3cwjL/xFR7vR5RnH+td9u+OuS4/H1bx3h8C71M4+bKQbKX1ZHJR1P/l",
  "1el4uXk7WjhSN/sJa1MAweMAAQCCom8AhWQeJzMYwRhGMJAVKOXgoqygXP/vRwARAAQAEIRh3aAo0A0RWGs5EAGzd7H3QMYJxiei",
  "0IhGi0RFwhs4ASYCAAAAAACQG0AA8gHy3qGF4QEuYTjZ3nE0bP8GPllu//5Lqne6388gOMYi00HDcP+QIFER2H8Z2lMkgvcuQHWQ",
  "LCvp8ubDLDhx17OZv071GWV3ZrKyXZnEJt9IHqsx0jOHrPtc7ZmCasMv7Mh3dS7JB6XsDRpeoK1x87oqJtwCAAsA",
].join("");

const UASTC_BASE64 = [
  "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",
  "CQAAAAAAAAAAAA==",
].join("");

// Khronos KTX-Software-CTS (Apache-2.0), official 8x8 UASTC + Zstd input corpus.
// Source: clitests/input/ktx2/valid_R8G8B8A8_SRGB_2D_UASTC_ZSTD_1.ktx2
const UASTC_ZSTD_BASE64 = [
  "q0tUWCAyMLsNChoKAAAAAAEAAAAIAAAACAAAAAAAAAAAAAAAAQAAAAEAAAACAAAAaAAAACwAAACUAAAAYAAAAAAAAAAAAAAA",
  "AAAAAAAAAAD0AAAAAAAAAEkAAAAAAAAAQAAAAAAAAAAsAAAAAAAAAAIAKACmAQIAAwMAABAAAAAAAAAAAAB/AwAAAAAAAAAA",
  "/////yUAAABLVFh3cml0ZXIAVW5pZGVudGlmaWVkIGFwcCAvIGxpYmt0eCAAAAAALQAAAEtUWHdyaXRlclNjUGFyYW1zAC0t",
  "dWFzdGMtcXVhbGl0eSAwIC0tenN0ZCAxAAAAACi1L/0gQAECACYgwaMgDubjMRpAIm1s6/9mIMGjJE/23/AJQCJtbOv/JiAx",
  "M0H2n8MJYEAibWTr/zYgETJF94+/SHBAom1s6/8=",
].join("");

interface BasisKtx2File {
  close(): void;
  delete(): void;
  getFaces(): number;
  getHasAlpha(): boolean;
  getHeight(): number;
  getImageTranscodedSizeInBytes(
    level: number,
    layer: number,
    face: number,
    format: number,
  ): number;
  getLayers(): number;
  getLevels(): number;
  getWidth(): number;
  isETC1S(): boolean;
  isUASTC(): boolean;
  isValid(): boolean;
  startTranscoding(): number;
  transcodeImage(
    destination: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    unused: number,
    getAlphaForOpaqueFormats: number,
    channel0: number,
  ): number;
}

interface BasisModule {
  readonly KTX2File: new (bytes: Uint8Array) => BasisKtx2File;
  initializeBasis(): void;
}

type BasisFactory = (options: {
  readonly wasmBinary: Uint8Array;
  readonly print: () => void;
  readonly printErr: () => void;
}) => Promise<BasisModule>;

const TRANSCODER_DIRECTORY = path.resolve(
  process.cwd(),
  "node_modules/three/examples/jsm/libs/basis",
);
const TRANSCODER_JS_PATH = path.join(TRANSCODER_DIRECTORY, "basis_transcoder.js");
const TRANSCODER_WASM_PATH = path.join(TRANSCODER_DIRECTORY, "basis_transcoder.wasm");

const CORPUS = [
  Object.freeze({
    name: "2d_etc1s.ktx2",
    bytes: Uint8Array.from(Buffer.from(ETC1S_BASE64, "base64")),
    sourceSha256: "e56ddcc757fc73ff06bb0dac2a3533ce79c1e196ad895a3ff7dcc4d9de6b9d5d",
    outputSha256: "d3a17387fc97d0e6a4e33d89efb1d9b6b8dec35fdbd29a0681a92711c12d8d7d",
    colorModel: "etc1s" as const,
  }),
  Object.freeze({
    name: "2d_uastc.ktx2",
    bytes: Uint8Array.from(Buffer.from(UASTC_BASE64, "base64")),
    sourceSha256: "21b6912cae1f074ae3eda1b751f43c36eafc7eb83f3af71f85bba2ccbafce125",
    outputSha256: "3ddb27e6b0205edc773c65cac42ec178c7d36cec7ea638e0ad3b3f925f4d0db1",
    colorModel: "uastc" as const,
  }),
] as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function loadPinnedBasisFactory(javascript: Uint8Array): BasisFactory {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(javascript);
  const wrapper = new Script(
    `(function (require, module, exports, __filename, __dirname) {\n${source}\nreturn BASIS;\n})`,
    { filename: TRANSCODER_JS_PATH },
  ).runInThisContext() as (
    require: NodeJS.Require,
    module: { exports: unknown },
    exports: object,
    filename: string,
    directory: string,
  ) => BasisFactory;
  const module = { exports: {} };
  const require = createRequire(pathToFileURL(TRANSCODER_JS_PATH));
  return wrapper(require, module, module.exports, TRANSCODER_JS_PATH, TRANSCODER_DIRECTORY);
}

async function loadAttestedBasisModule(): Promise<{
  readonly capability: StudioBg3dAttestedKtx2Transcoder;
  readonly module: BasisModule;
}> {
  const javascript = Uint8Array.from(readFileSync(TRANSCODER_JS_PATH));
  const wasm = Uint8Array.from(readFileSync(TRANSCODER_WASM_PATH));
  const capability = await attestStudioBg3dKtx2TranscoderAssets({ javascript, wasm });
  expect(capability).not.toBeNull();
  if (!capability) throw new Error("Pinned Three Basis transcoder integrity mismatch.");

  const verifiedAssets = capability.copyVerifiedAssets();
  javascript[javascript.byteLength - 1] ^= 1;
  wasm[wasm.byteLength - 1] ^= 1;
  // Executable source comes from the private snapshots retained during attestation, not from a
  // second read of caller-owned arrays that can change between hashing and evaluation.
  const factory = loadPinnedBasisFactory(verifiedAssets.javascript);
  const module = await factory({
    wasmBinary: verifiedAssets.wasm,
    print: () => undefined,
    printErr: () => undefined,
  });
  module.initializeBasis();
  return { capability, module };
}

function transcodeAllMipsToRgba32(
  module: BasisModule,
  bytes: Uint8Array,
  hasAlpha = false,
): Uint8Array {
  const file = new module.KTX2File(bytes);
  try {
    expect(file.isValid()).toBe(true);
    expect(file.getLayers()).toBe(0);
    expect(file.getFaces()).toBe(1);
    expect(file.getHasAlpha()).toBe(hasAlpha);
    expect(file.startTranscoding()).toBe(1);

    const mipmaps: Uint8Array[] = [];
    for (let level = 0; level < file.getLevels(); level += 1) {
      const byteLength = file.getImageTranscodedSizeInBytes(level, 0, 0, 13); // RGBA32
      const output = new Uint8Array(byteLength);
      expect(file.transcodeImage(output, level, 0, 0, 13, 0, -1, -1)).toBe(1);
      mipmaps.push(output);
    }
    const totalBytes = mipmaps.reduce((total, mipmap) => total + mipmap.byteLength, 0);
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const mipmap of mipmaps) {
      output.set(mipmap, offset);
      offset += mipmap.byteLength;
    }
    return output;
  } finally {
    file.close();
    file.delete();
  }
}

function transcodeFirstMip(
  module: BasisModule,
  bytes: Uint8Array,
  format: number,
): Uint8Array {
  const file = new module.KTX2File(bytes);
  try {
    expect(file.isValid()).toBe(true);
    expect(file.startTranscoding()).toBe(1);
    const output = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, format));
    expect(file.transcodeImage(output, 0, 0, 0, format, 0, -1, -1)).toBe(1);
    return output;
  } finally {
    file.close();
    file.delete();
  }
}

describe("Studio KTX2 pinned transcoder release gate", () => {
  it("pins Three r184 and exact executable asset bytes before evaluation", async () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "node_modules/three/package.json"), "utf-8"),
    ) as { version?: unknown };
    expect(packageJson.version).toBe("0.184.0");

    const javascript = Uint8Array.from(readFileSync(TRANSCODER_JS_PATH));
    const wasm = Uint8Array.from(readFileSync(TRANSCODER_WASM_PATH));
    expect(javascript.byteLength).toBe(STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.javascript.byteLength);
    expect(wasm.byteLength).toBe(STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.byteLength);
    expect(`sha256:${sha256(javascript)}`).toBe(
      STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.javascript.sha256,
    );
    expect(`sha256:${sha256(wasm)}`).toBe(
      STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.sha256,
    );
    await expect(attestStudioBg3dKtx2TranscoderAssets({ javascript, wasm })).resolves.not.toBeNull();

    const tamperedWasm = Uint8Array.from(wasm);
    tamperedWasm[tamperedWasm.byteLength - 1] ^= 1;
    await expect(attestStudioBg3dKtx2TranscoderAssets({
      javascript,
      wasm: tamperedWasm,
    })).resolves.toBeNull();
  });

  it("actually decodes official ETC1S and UASTC mip chains to stable RGBA32 checksums", async () => {
    const { capability, module } = await loadAttestedBasisModule();

    for (const fixture of CORPUS) {
      expect(sha256(fixture.bytes), fixture.name).toBe(fixture.sourceSha256);
      expect(inspectStudioBg3dBasisKtx2(fixture.bytes), fixture.name).toEqual({
        width: 40,
        height: 40,
        levelCount: 6,
        estimatedDecodedBytes: 8_520,
        colorModel: fixture.colorModel,
        supercompression: fixture.colorModel === "etc1s" ? "basis-lz" : "none",
      });
      const mutableSource = Uint8Array.from(fixture.bytes);
      const admission = await admitStudioBg3dKtx2Transcode(mutableSource, {
        capability,
        expectedSha256: fixture.sourceSha256,
      });
      expect(admission, fixture.name).toMatchObject({
        sourceByteLength: fixture.bytes.byteLength,
        sourceSha256: `sha256:${fixture.sourceSha256}`,
        estimatedDecodedBytes: 8_520,
      });
      if (!admission) throw new Error(`KTX2 admission failed for ${fixture.name}`);

      mutableSource[mutableSource.byteLength - 1] ^= 1;
      const verifiedSource = admission.copyVerifiedSource();
      expect(sha256(verifiedSource), fixture.name).toBe(fixture.sourceSha256);
      verifiedSource[verifiedSource.byteLength - 1] ^= 1;
      expect(sha256(admission.copyVerifiedSource()), fixture.name).toBe(fixture.sourceSha256);

      const output = transcodeAllMipsToRgba32(module, admission.copyVerifiedSource());
      expect(output.byteLength, fixture.name).toBe(8_520);
      expect(sha256(output), fixture.name).toBe(fixture.outputSha256);
    }
  });

  it("decodes official Khronos UASTC+Zstd and pins portable pixels plus GPU-target bytes", async () => {
    const { capability, module } = await loadAttestedBasisModule();
    const fixture = Uint8Array.from(Buffer.from(UASTC_ZSTD_BASE64, "base64"));
    expect(fixture.byteLength).toBe(317);
    expect(sha256(fixture)).toBe(
      "5bd7d650fa1ca300d3dc6be7a292d0e79c58d3592f57b1a2d12b4c9e8aac8c4d",
    );
    expect(inspectStudioBg3dBasisKtx2(fixture)).toEqual({
      width: 8,
      height: 8,
      levelCount: 1,
      estimatedDecodedBytes: 256,
      colorModel: "uastc",
      supercompression: "zstandard",
    });
    await expect(admitStudioBg3dKtx2Transcode(fixture, { capability })).resolves.toMatchObject({
      sourceByteLength: 317,
      estimatedDecodedBytes: 256,
      supercompression: "zstandard",
    });

    // RGBA32 is the portable pixel golden. Compressed outputs are deterministic byte goldens for
    // target selection/regression only; GPU context loss and driver decompression are renderer tests.
    expect(sha256(transcodeAllMipsToRgba32(module, fixture, true))).toBe(
      "c770e0f532e9fb639f74ae9179390e81e791071df85965d3b286c02d94b908a6",
    );
    const gpuTargetByteGoldens = [
      ["ETC1_RGB", 0, 32, "4bbc6f28ad6bbf3a9a4171baf291935a652100058049df84341e2999f86c5b53"],
      ["ETC2_RGBA", 1, 64, "7b62d4101286b775da2d7f81adf75b6edc8f8bffb554d62eb2e49e1a6c5aee50"],
      ["BC1_RGB", 2, 32, "799e2fe7f5516e36d54ceaaa409a74bd38923a456f710546248be149fe699de0"],
      ["BC3_RGBA", 3, 64, "34c4a9d708a56b67f48bc62a382208942038648baca99af8b39bbef037f85246"],
      ["BC7_M6_RGBA", 6, 64, "e0f7b9cd5c4036231f254f1c571678d892b5319fa9c0e7820260738ce671cd3b"],
      ["ASTC_4x4_RGBA", 10, 64, "2ad46761d18c4b2893447f958f45ff43358b5f6807b85d9a121299149bf71092"],
    ] as const;
    for (const [name, format, byteLength, checksum] of gpuTargetByteGoldens) {
      const output = transcodeFirstMip(module, fixture, format);
      expect(output.byteLength, name).toBe(byteLength);
      expect(sha256(output), name).toBe(checksum);
    }
  });

  it("rejects checksum drift and shape-equal forged capabilities before decoding", async () => {
    const { capability } = await loadAttestedBasisModule();
    const fixture = CORPUS[1];
    const tamperedPayload = Uint8Array.from(fixture.bytes);
    tamperedPayload[tamperedPayload.byteLength - 1] ^= 1;
    // UASTC envelope geometry remains structurally valid, demonstrating why a payload hash gate is
    // independent of — and stronger than — metadata/offset validation alone.
    expect(inspectStudioBg3dBasisKtx2(tamperedPayload)).not.toBeNull();
    await expect(admitStudioBg3dKtx2Transcode(tamperedPayload, {
      capability,
      expectedSha256: fixture.sourceSha256,
    })).resolves.toBeNull();

    const forgedCapability = Object.freeze({ ...capability });
    await expect(admitStudioBg3dKtx2Transcode(fixture.bytes, {
      capability: forgedCapability,
      expectedSha256: fixture.sourceSha256,
    })).resolves.toBeNull();
  });

  it("enforces caller-lowered source/decoded ceilings and rejects unavailable digests", async () => {
    const { capability } = await loadAttestedBasisModule();
    const fixture = CORPUS[0];

    await expect(admitStudioBg3dKtx2Transcode(fixture.bytes, {
      capability,
      maxSourceBytes: fixture.bytes.byteLength - 1,
    })).resolves.toBeNull();
    await expect(admitStudioBg3dKtx2Transcode(fixture.bytes, {
      capability,
      maxDecodedBytes: 8_519,
    })).resolves.toBeNull();
    await expect(admitStudioBg3dKtx2Transcode(fixture.bytes, {
      capability,
      maxSourceBytes: Number.POSITIVE_INFINITY,
    })).resolves.toBeNull();
    await expect(admitStudioBg3dKtx2Transcode(fixture.bytes, {
      capability,
      expectedSha256: "not-a-checksum",
    })).resolves.toBeNull();
    await expect(admitStudioBg3dKtx2Transcode(fixture.bytes, {
      capability,
      digest: async () => new Uint8Array(31),
    })).resolves.toBeNull();
  });
});
