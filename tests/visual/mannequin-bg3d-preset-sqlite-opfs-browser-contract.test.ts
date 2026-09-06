import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MANNEQUIN_BG3D_SQLITE_OPFS_LOAD_SAMPLES,
  MANNEQUIN_BG3D_SQLITE_OPFS_REPORT_SCHEMA_VERSION,
  MANNEQUIN_BG3D_SQLITE_OPFS_SAVE_SAMPLES,
  validateMannequinBg3dSqliteOpfsEvidence,
  type MannequinBg3dSqliteOpfsArtifact,
  type MannequinBg3dSqliteOpfsDiagnostics,
} from "../benchmarks/harness/mannequin-bg3d-preset-sqlite-opfs-browser";

const ROOT = resolve(import.meta.dirname, "../..");
const CLIENT_PATH = resolve(
  ROOT,
  "tests/benchmarks/harness/mannequin-bg3d-preset-sqlite-opfs-browser-client.ts",
);
const PAGE_PATH = resolve(
  ROOT,
  "tests/benchmarks/harness/mannequin-bg3d-preset-sqlite-opfs-browser-page.ts",
);
const ORCHESTRATOR_PATH = resolve(
  ROOT,
  "tests/benchmarks/harness/mannequin-bg3d-preset-sqlite-opfs-browser.ts",
);
const RESULT_PATH = resolve(
  ROOT,
  "tests/benchmarks/results/mannequin-bg3d-preset-sqlite-opfs-browser.json",
);
const REPOSITORY_PATH = resolve(
  ROOT,
  "apps/web/src/domains/creator/scene-3d/studio-mannequin-bg3d-preset-sqlite-repository.ts",
);

function artifact(): MannequinBg3dSqliteOpfsArtifact {
  return JSON.parse(readFileSync(RESULT_PATH, "utf8")) as MannequinBg3dSqliteOpfsArtifact;
}

function passingDiagnostics(): MannequinBg3dSqliteOpfsDiagnostics {
  return {
    browserVersion: "test",
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    errorResponses: [],
    requests: [],
    responses: [],
    responseHeaders: {
      contentSecurityPolicy: "script-src 'self' 'wasm-unsafe-eval'",
      crossOriginOpenerPolicy: "same-origin",
      crossOriginEmbedderPolicy: "require-corp",
      crossOriginResourcePolicy: "same-origin",
    },
  };
}

describe("Mannequin and BG3D LT Chromium SQLite OPFS evidence", () => {
  it("runs both option-free repositories through the shared OPFS runtime with no fallback API", () => {
    const client = readFileSync(CLIENT_PATH, "utf8");
    const repository = readFileSync(REPOSITORY_PATH, "utf8");
    expect(client).toContain("createStudioMannequinStateSqliteRepository();");
    expect(client).toContain("createStudioBg3dLtPresetSqliteRepository();");
    expect(client).toContain("acquireStudioLocalDatabase(() => openStudioLocalDatabase({");
    expect(client).toContain('vfs: "opfs"');
    expect(client).toContain("closeStudioLocalDatabaseRuntime()");
    expect(client).not.toContain('vfs: "memory"');
    expect(client).not.toContain("localStorage.getItem");
    expect(client).not.toContain("localStorage.setItem");
    expect(client).not.toContain("window.localStorage");
    expect(repository).toContain(
      "const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase",
    );
    expect(repository).not.toContain("localStorage");
  });

  it("pins schema-maximum fixtures and at least one hundred samples per operation", () => {
    const client = readFileSync(CLIENT_PATH, "utf8");
    expect(MANNEQUIN_BG3D_SQLITE_OPFS_SAVE_SAMPLES).toBeGreaterThanOrEqual(100);
    expect(MANNEQUIN_BG3D_SQLITE_OPFS_LOAD_SAMPLES).toBeGreaterThanOrEqual(100);
    expect(client).toContain("const SAVE_SAMPLE_COUNT = 100");
    expect(client).toContain("const LOAD_SAMPLE_COUNT = 100");
    expect(client).toContain("for (const jointId of STUDIO_MANNEQUIN_JOINT_IDS)");
    expect(client).toContain("length: STUDIO_BG3D_LT_PRESET_MAX_COUNT");
    expect(client).toContain("STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH");
    expect(client).toContain("STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH");
  });

  it("terminates the committed seed Worker without close and verifies in a distinct Worker", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    expect(source).toContain('runWorkerPhase("termination-seed"');
    expect(source).toContain("seed.worker.terminate()");
    expect(source).toContain('runWorkerPhase("termination-verify"');
    expect(source.indexOf("seed.worker.terminate()"))
      .toBeLessThan(source.indexOf('runWorkerPhase("termination-verify"'));
  });

  it("serves a minified Vite production build with Worker and wasm isolation headers", () => {
    const source = readFileSync(ORCHESTRATOR_PATH, "utf8");
    expect(source).toContain('minify: true');
    expect(source).toContain('target: "es2022"');
    expect(source).toContain('"Cross-Origin-Opener-Policy": "same-origin"');
    expect(source).toContain('"Cross-Origin-Embedder-Policy": "require-corp"');
    expect(source).toContain('"Cross-Origin-Resource-Policy": "same-origin"');
    expect(source).toContain("'wasm-unsafe-eval'");
    expect(source).toContain('args: ["--no-sandbox", "--enable-precise-memory-info"]');
  });

  it("pins passing raw Chromium evidence", () => {
    const result = artifact();
    expect(result.schemaVersion).toBe(MANNEQUIN_BG3D_SQLITE_OPFS_REPORT_SCHEMA_VERSION);
    expect(result.generatedAt).toMatch(/^20\d\d-/u);
    expect(result.status).toBe("pass");
    expect(result.pass).toBe(true);
    expect(result.validationIssues).toEqual([]);
    expect(validateMannequinBg3dSqliteOpfsEvidence(
      result.benchmark,
      result.diagnostics,
      result.productionBuild.assets,
    )).toEqual([]);
  });

  it("retains all raw distributions, canonical digests, and semantic receipts", () => {
    const result = artifact();
    const benchmark = result.benchmark as {
      normal: {
        authority: {
          memoryDatabaseOpenCount: number;
          localStorageReadCount: number;
          localStorageWriteCount: number;
          localStorageFallbackUsed: boolean;
          memoryFallbackUsed: boolean;
        };
        mannequin: {
          canonicalBytes: number;
          canonicalSha256: string;
          reopenedSha256: string;
          reopenedSemanticExact: boolean;
          saves: { distribution: { samplesMs: unknown[] } };
          loads: { distribution: { samplesMs: unknown[] } };
        };
        bg3dLt: {
          presetCount: number;
          canonicalBytes: number;
          canonicalSha256: string;
          reopenedSha256: string;
          reopenedSemanticExact: boolean;
          saves: { distribution: { samplesMs: unknown[] } };
          loads: { distribution: { samplesMs: unknown[] } };
        };
        memory: {
          before: Record<string, unknown>;
          after: Record<string, unknown>;
        };
      };
      forcedTermination: {
        workerTerminateCalled: boolean;
        closeCalledBeforeTerminate: boolean;
        verify: {
          reopenedCanonicalExact: boolean;
          mannequin: { canonicalBytesExact: boolean; semanticExact: boolean };
          bg3dLt: { canonicalBytesExact: boolean; semanticExact: boolean };
        };
      };
    };
    expect(benchmark.normal.mannequin.saves.distribution.samplesMs)
      .toHaveLength(MANNEQUIN_BG3D_SQLITE_OPFS_SAVE_SAMPLES);
    expect(benchmark.normal.mannequin.loads.distribution.samplesMs)
      .toHaveLength(MANNEQUIN_BG3D_SQLITE_OPFS_LOAD_SAMPLES);
    expect(benchmark.normal.bg3dLt.saves.distribution.samplesMs)
      .toHaveLength(MANNEQUIN_BG3D_SQLITE_OPFS_SAVE_SAMPLES);
    expect(benchmark.normal.bg3dLt.loads.distribution.samplesMs)
      .toHaveLength(MANNEQUIN_BG3D_SQLITE_OPFS_LOAD_SAMPLES);
    expect(benchmark.normal.mannequin.canonicalBytes).toBeGreaterThan(0);
    expect(benchmark.normal.bg3dLt.canonicalBytes).toBeGreaterThan(0);
    expect(benchmark.normal.bg3dLt.presetCount).toBe(32);
    expect(benchmark.normal.mannequin.canonicalSha256)
      .toBe(benchmark.normal.mannequin.reopenedSha256);
    expect(benchmark.normal.bg3dLt.canonicalSha256)
      .toBe(benchmark.normal.bg3dLt.reopenedSha256);
    expect(benchmark.normal.mannequin.reopenedSemanticExact).toBe(true);
    expect(benchmark.normal.bg3dLt.reopenedSemanticExact).toBe(true);
    expect(benchmark.normal.authority).toEqual(expect.objectContaining({
      memoryDatabaseOpenCount: 0,
      localStorageReadCount: 0,
      localStorageWriteCount: 0,
      localStorageFallbackUsed: false,
      memoryFallbackUsed: false,
    }));
    expect(benchmark.forcedTermination).toEqual(expect.objectContaining({
      workerTerminateCalled: true,
      closeCalledBeforeTerminate: false,
    }));
    expect(benchmark.forcedTermination.verify.reopenedCanonicalExact).toBe(true);
    expect(benchmark.forcedTermination.verify.mannequin).toEqual(expect.objectContaining({
      canonicalBytesExact: true,
      semanticExact: true,
    }));
    expect(benchmark.forcedTermination.verify.bg3dLt).toEqual(expect.objectContaining({
      canonicalBytesExact: true,
      semanticExact: true,
    }));
  });

  it("records unavailable Worker memory APIs as literal null", () => {
    const result = artifact();
    const memory = (result.benchmark as {
      normal: { memory: { before: Record<string, unknown>; after: Record<string, unknown> } };
    }).normal.memory;
    for (const receipt of [memory.before, memory.after]) {
      if (receipt.performanceMemoryApiExposed === false) {
        expect(receipt.performanceMemory).toBeNull();
      }
      if (receipt.userAgentSpecificMemoryApiExposed === false) {
        expect(receipt.userAgentSpecificMemory).toBeNull();
        expect(receipt.userAgentSpecificMemoryError).toBeNull();
      }
    }
  });

  it("rejects memory/localStorage fallback, sample truncation, fake memory, and fake termination", () => {
    const result = artifact();
    const assets = result.productionBuild.assets;

    const fallback = structuredClone(result.benchmark) as {
      normal: { authority: Record<string, unknown> };
    };
    fallback.normal.authority.memoryDatabaseOpenCount = 1;
    fallback.normal.authority.localStorageReadCount = 1;
    fallback.normal.authority.memoryFallbackUsed = true;
    expect(validateMannequinBg3dSqliteOpfsEvidence(
      fallback,
      passingDiagnostics(),
      assets,
    )).toContain("authority receipt does not prove two V12 OPFS opens with zero fallback");

    const truncated = structuredClone(result.benchmark) as {
      normal: { mannequin: { saves: { distribution: { samplesMs: unknown[] } } } };
    };
    truncated.normal.mannequin.saves.distribution.samplesMs.pop();
    expect(validateMannequinBg3dSqliteOpfsEvidence(
      truncated,
      passingDiagnostics(),
      assets,
    )).toContain("mannequin canonical save/load/reopen evidence is incomplete");

    const fakeMemory = structuredClone(result.benchmark) as {
      normal: { memory: { before: Record<string, unknown> } };
    };
    fakeMemory.normal.memory.before.userAgentSpecificMemoryApiExposed = false;
    fakeMemory.normal.memory.before.userAgentSpecificMemory = { bytes: 0 };
    expect(validateMannequinBg3dSqliteOpfsEvidence(
      fakeMemory,
      passingDiagnostics(),
      assets,
    )).toContain(
      "memory evidence uses a placeholder instead of measured values or honest nulls",
    );

    const fakeTermination = structuredClone(result.benchmark) as {
      forcedTermination: { closeCalledBeforeTerminate: boolean };
    };
    fakeTermination.forcedTermination.closeCalledBeforeTerminate = true;
    expect(validateMannequinBg3dSqliteOpfsEvidence(
      fakeTermination,
      passingDiagnostics(),
      assets,
    )).toContain(
      "forced Dedicated Worker termination did not recover both exact canonical rows",
    );
  });
});
