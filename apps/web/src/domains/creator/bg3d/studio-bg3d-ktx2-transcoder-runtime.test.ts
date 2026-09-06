import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  createStudioBg3dKtx2TranscoderRuntime,
  StudioBg3dKtx2TranscoderRuntimeError,
  type StudioBg3dBasisFactory,
  type StudioBg3dBasisFactoryEvaluator,
  type StudioBg3dBasisModule,
} from "./studio-bg3d-ktx2-transcoder-runtime";

// Khronos KTX-Software-CTS, Apache-2.0. This tiny official 8x8 fixture exercises UASTC + Zstd.
// Source: clitests/input/ktx2/valid_R8G8B8A8_SRGB_2D_UASTC_ZSTD_1.ktx2
const UASTC_ZSTD_BASE64 = [
  "q0tUWCAyMLsNChoKAAAAAAEAAAAIAAAACAAAAAAAAAAAAAAAAQAAAAEAAAACAAAAaAAAACwAAACUAAAAYAAAAAAAAAAAAAAA",
  "AAAAAAAAAAD0AAAAAAAAAEkAAAAAAAAAQAAAAAAAAAAsAAAAAAAAAAIAKACmAQIAAwMAABAAAAAAAAAAAAB/AwAAAAAAAAAA",
  "/////yUAAABLVFh3cml0ZXIAVW5pZGVudGlmaWVkIGFwcCAvIGxpYmt0eCAAAAAALQAAAEtUWHdyaXRlclNjUGFyYW1zAC0t",
  "dWFzdGMtcXVhbGl0eSAwIC0tenN0ZCAxAAAAACi1L/0gQAECACYgwaMgDubjMRpAIm1s6/9mIMGjJE/23/AJQCJtbOv/JiAx",
  "M0H2n8MJYEAibWTr/zYgETJF94+/SHBAom1s6/8=",
].join("");

const TRANSCODER_DIRECTORY = path.resolve(
  process.cwd(),
  "node_modules/three/examples/jsm/libs/basis",
);
const TRANSCODER_JS_PATH = path.join(TRANSCODER_DIRECTORY, "basis_transcoder.js");
const TRANSCODER_WASM_PATH = path.join(TRANSCODER_DIRECTORY, "basis_transcoder.wasm");

const EXECUTABLE_ASSETS = Object.freeze({
  javascript: Uint8Array.from(readFileSync(TRANSCODER_JS_PATH)),
  wasm: Uint8Array.from(readFileSync(TRANSCODER_WASM_PATH)),
});
const UASTC_ZSTD = Uint8Array.from(Buffer.from(UASTC_ZSTD_BASE64, "base64"));

function digest(bytes: Uint8Array): Promise<Uint8Array> {
  return Promise.resolve(Uint8Array.from(createHash("sha256").update(bytes).digest()));
}

function loadAssets() {
  return Promise.resolve({
    javascript: Uint8Array.from(EXECUTABLE_ASSETS.javascript),
    wasm: Uint8Array.from(EXECUTABLE_ASSETS.wasm),
  });
}

const evaluateWithNodeVm: StudioBg3dBasisFactoryEvaluator = (javascript) => {
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
  ) => StudioBg3dBasisFactory;
  const module = { exports: {} };
  return wrapper(
    createRequire(pathToFileURL(TRANSCODER_JS_PATH)),
    module,
    module.exports,
    TRANSCODER_JS_PATH,
    TRANSCODER_DIRECTORY,
  );
};

function fakeModule(options: {
  readonly transcodeResult?: number;
  readonly closeThrows?: boolean;
  readonly close?: () => void;
  readonly delete?: () => void;
} = {}): StudioBg3dBasisModule {
  return {
    initializeBasis: () => undefined,
    KTX2File: class {
      close(): void {
        options.close?.();
        if (options.closeThrows) throw new Error("close failed");
      }

      delete(): void {
        options.delete?.();
      }

      getFaces(): number { return 1; }
      getHeight(): number { return 8; }
      getImageTranscodedSizeInBytes(): number { return 256; }
      getLayers(): number { return 0; }
      getLevels(): number { return 1; }
      getWidth(): number { return 8; }
      isETC1S(): boolean { return false; }
      isUASTC(): boolean { return true; }
      isValid(): boolean { return true; }
      startTranscoding(): number { return 1; }
      transcodeImage(destination: Uint8Array): number {
        destination.fill(0x7f);
        return options.transcodeResult ?? 1;
      }
    },
  };
}

function evaluateFakeModule(module: StudioBg3dBasisModule): StudioBg3dBasisFactoryEvaluator {
  return () => async () => module;
}

describe("StudioBg3dKtx2TranscoderRuntime", () => {
  it("self-attests and pretranscodes an official UASTC+Zstd payload in the runtime realm", async () => {
    const runtime = await createStudioBg3dKtx2TranscoderRuntime({
      loadAssets,
      evaluateFactory: evaluateWithNodeVm,
      digest,
      generation: 7,
      now: (() => {
        let value = 100;
        return () => value += 4;
      })(),
    });

    await expect(runtime.pretranscode(UASTC_ZSTD, { digest })).resolves.toEqual({
      sourceSha256: "sha256:5bd7d650fa1ca300d3dc6be7a292d0e79c58d3592f57b1a2d12b4c9e8aac8c4d",
      width: 8,
      height: 8,
      levelCount: 1,
      colorModel: "uastc",
      supercompression: "zstandard",
      decodedByteLength: 256,
      rgba32Fnv1a: "fnv1a32:3e3c484d",
    });
    expect(runtime.metrics).toMatchObject({
      generation: 7,
      initializationDurationMs: 4,
      attestedAssetBytes: 584_862,
      jobsStarted: 1,
      jobsSucceeded: 1,
      sourceBytesAdmitted: 317,
      decodedBytesVerified: 256,
      peakMipAllocationBytes: 256,
      peakEstimatedJobHeapBytes: 1_207,
      filesCreated: 1,
      filesClosed: 1,
      filesDeleted: 1,
      liveFiles: 0,
      cleanupFailures: 0,
    });
  });

  it("rejects modified executable assets before evaluating any source", async () => {
    const evaluateFactory = vi.fn<StudioBg3dBasisFactoryEvaluator>();
    const corruptedWasm = Uint8Array.from(EXECUTABLE_ASSETS.wasm);
    corruptedWasm[corruptedWasm.byteLength - 1] ^= 1;

    await expect(createStudioBg3dKtx2TranscoderRuntime({
      loadAssets: async () => ({
        javascript: Uint8Array.from(EXECUTABLE_ASSETS.javascript),
        wasm: corruptedWasm,
      }),
      evaluateFactory,
      digest,
    })).rejects.toMatchObject({ code: "asset-integrity" });
    expect(evaluateFactory).not.toHaveBeenCalled();
  });

  it("hardens abort, disposal, and fresh-generation recovery boundaries", async () => {
    const first = await createStudioBg3dKtx2TranscoderRuntime({
      loadAssets,
      evaluateFactory: evaluateFakeModule(fakeModule()),
      digest,
      generation: 1,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(first.pretranscode(UASTC_ZSTD, {
      digest,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(first.metrics).toMatchObject({
      jobsStarted: 1,
      jobsCancelled: 1,
      filesCreated: 0,
      liveFiles: 0,
    });

    first.dispose();
    await expect(first.pretranscode(UASTC_ZSTD, { digest })).rejects.toMatchObject({
      code: "disposed",
    });
    expect(first.metrics.disposed).toBe(true);

    const recovered = await createStudioBg3dKtx2TranscoderRuntime({
      loadAssets,
      evaluateFactory: evaluateFakeModule(fakeModule()),
      digest,
      generation: 2,
    });
    await expect(recovered.pretranscode(UASTC_ZSTD, { digest })).resolves.toMatchObject({
      decodedByteLength: 256,
    });
    const callerOwned = Uint8Array.from(UASTC_ZSTD);
    const snapshottedJob = recovered.pretranscode(callerOwned, { digest });
    callerOwned[0] = 0;
    await expect(snapshottedJob).resolves.toMatchObject({ decodedByteLength: 256 });
    expect(recovered.metrics).toMatchObject({ generation: 2, jobsSucceeded: 2, liveFiles: 0 });
  });

  it("always closes and deletes decoder files, including transcode and close failures", async () => {
    const close = vi.fn();
    const deleteFile = vi.fn();
    const runtime = await createStudioBg3dKtx2TranscoderRuntime({
      loadAssets,
      evaluateFactory: evaluateFakeModule(fakeModule({
        transcodeResult: 0,
        closeThrows: true,
        close,
        delete: deleteFile,
      })),
      digest,
    });

    await expect(runtime.pretranscode(UASTC_ZSTD, { digest })).rejects.toBeInstanceOf(
      StudioBg3dKtx2TranscoderRuntimeError,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(deleteFile).toHaveBeenCalledOnce();
    expect(runtime.metrics).toMatchObject({
      jobsFailed: 1,
      filesCreated: 1,
      filesClosed: 0,
      filesDeleted: 1,
      liveFiles: 0,
      cleanupFailures: 1,
      disposed: true,
    });

    const poisonedAfterDecode = await createStudioBg3dKtx2TranscoderRuntime({
      loadAssets,
      evaluateFactory: evaluateFakeModule(fakeModule({ closeThrows: true })),
      digest,
    });
    await expect(poisonedAfterDecode.pretranscode(UASTC_ZSTD, { digest })).rejects.toMatchObject({
      code: "transcode-failed",
    });
    expect(poisonedAfterDecode.metrics).toMatchObject({
      jobsSucceeded: 0,
      jobsFailed: 1,
      liveFiles: 0,
      cleanupFailures: 1,
      disposed: true,
    });
  });
});
