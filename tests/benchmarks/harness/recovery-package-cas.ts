import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  CommandBus,
  createEmptyScene,
  projectDigest,
  recoverProject,
} from "@toonspectrum/studio-project-model";

import { openStudioLocalDatabase } from "../../../apps/web/src/domains/creator/studio-local-database";
import { createSqliteJournalStore } from "../../../apps/web/src/domains/creator/studio-sqlite-journal-store";
import {
  buildStudioV12RecoveryPackage,
  importStudioV12RecoveryPackage,
  restoreStudioV12RecoveryPackage,
} from "../../../apps/web/src/domains/creator/studio-v12-recovery-package";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "../../../apps/web/src/domains/creator/studio-local-database";

interface Blake3Candidate {
  hash(input: Uint8Array): Uint8Array;
}

interface Blake3PackageJson {
  version: string;
  license: string;
}

function percentile(samples: readonly number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function statistics(samples: readonly number[]) {
  return {
    samples: samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

async function timed<T>(task: () => Promise<T>): Promise<{ elapsed: number; value: T }> {
  const started = performance.now();
  const value = await task();
  return { elapsed: performance.now() - started, value };
}

function xorshiftBytes(byteLength: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

async function hashCandidates() {
  const input = xorshiftBytes(8 * 1024 * 1024, 0x12_34_56_78);
  await crypto.subtle.digest("SHA-256", input);
  const shaSamples: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    const started = performance.now();
    await crypto.subtle.digest("SHA-256", input);
    shaSamples.push(performance.now() - started);
  }

  const require = createRequire(import.meta.url);
  const wranglerEntry = require.resolve("wrangler");
  const wranglerRequire = createRequire(wranglerEntry);
  const blake3 = wranglerRequire("blake3-wasm") as Blake3Candidate;
  const packageJsonPath = wranglerRequire.resolve("blake3-wasm/package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Blake3PackageJson;
  const browserWasmPath = resolve(
    dirname(packageJsonPath),
    "dist/wasm/browser/blake3_js_bg.wasm",
  );
  const browserWasmBytes = (await stat(browserWasmPath)).size;
  blake3.hash(input);
  const blakeSamples: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    const started = performance.now();
    blake3.hash(input);
    blakeSamples.push(performance.now() - started);
  }
  return {
    inputBytes: input.byteLength,
    sha256WebCrypto: {
      ...statistics(shaSamples),
      directRuntimeDependency: true,
      incrementalBundleBytes: 0,
      license: "Web Platform API",
      browserSupport: "SubtleCrypto.digest('SHA-256')",
    },
    blake3WasmCandidate: {
      ...statistics(blakeSamples),
      version: packageJson.version,
      license: packageJson.license,
      directRuntimeDependency: false,
      installedVia: "wrangler devDependency transitively",
      browserWasmBytes,
      browserSupport: "separate WebAssembly module and async initialization",
    },
  };
}

async function main(): Promise<void> {
  const sqliteModule = await import("@sqlite.org/sqlite-wasm");
  const sqlite3 = (await sqliteModule.default()) as unknown as StudioSqliteApiHandle;
  const databases: StudioLocalDatabase[] = [];
  const openDatabase = async () => {
    const database = await openStudioLocalDatabase({
      vfs: "memory",
      loadSqlite: () => Promise.resolve(sqlite3),
    });
    databases.push(database);
    return database;
  };

  try {
    const sourceDatabase = await openDatabase();
    const sourceStore = createSqliteJournalStore(sourceDatabase, "benchmark-source");
    const { bus } = await CommandBus.open(sourceStore, {
      snapshotEvery: 32,
      now: (() => {
        let value = 1_000;
        return () => (value += 1);
      })(),
    });
    await bus.dispatch({ type: "scene/init", scene: createEmptyScene(2_048, 2_048) });
    for (let index = 1; index <= 32; index += 1) {
      const channel = index / 32;
      await bus.dispatch({
        type: "scene/set-background",
        color: { r: channel, g: 1 - channel, b: channel / 2, a: 1 },
      });
    }
    const attachments = Array.from({ length: 8 }, (_, index) => ({
      data: xorshiftBytes(128 * 1024, index + 1),
      mimeType: "application/octet-stream",
      rights: { owner: `benchmark-owner-${index}`, licenseSpdx: "CC0-1.0" },
      metadata: { name: `attachment-${index}`, kind: "benchmark" },
    }));
    const buildInput = {
      project: { projectId: "benchmark-project", title: "Recovery CAS benchmark" },
      history: sourceStore,
      attachments,
      rights: { owner: "benchmark", licenseSpdx: "CC0-1.0" },
      metadata: { tags: ["benchmark", "v12"] },
    } as const;

    const first = await buildStudioV12RecoveryPackage(buildInput);
    const second = await buildStudioV12RecoveryPackage(buildInput);
    const exportSamples: number[] = [];
    const importSamples: number[] = [];
    const memoryAtStart = process.memoryUsage();
    let observedPeakRss = memoryAtStart.rss;
    let observedPeakArrayBuffers = memoryAtStart.arrayBuffers;
    for (let index = 0; index < 30; index += 1) {
      const built = await timed(() => buildStudioV12RecoveryPackage(buildInput));
      exportSamples.push(built.elapsed);
      const imported = await timed(() => importStudioV12RecoveryPackage(built.value.bytes));
      importSamples.push(imported.elapsed);
      const memory = process.memoryUsage();
      observedPeakRss = Math.max(observedPeakRss, memory.rss);
      observedPeakArrayBuffers = Math.max(observedPeakArrayBuffers, memory.arrayBuffers);
    }

    const restoreSamples: number[] = [];
    let restoredSeq = 0;
    let restoredDigest = "";
    for (let index = 0; index < 12; index += 1) {
      const imported = await importStudioV12RecoveryPackage(first.bytes);
      const destinationDatabase = await openDatabase();
      const destinationStore = createSqliteJournalStore(
        destinationDatabase,
        `benchmark-destination-${index}`,
      );
      const restored = await timed(() =>
        restoreStudioV12RecoveryPackage(imported, { history: destinationStore }),
      );
      restoreSamples.push(restored.elapsed);
      restoredSeq = restored.value.seq;
      restoredDigest = projectDigest(restored.value.project);
    }
    const sourceRecovered = await recoverProject(sourceStore);
    const hashResults = await hashCandidates();
    const memoryAtEnd = process.memoryUsage();
    observedPeakRss = Math.max(observedPeakRss, memoryAtEnd.rss);
    observedPeakArrayBuffers = Math.max(
      observedPeakArrayBuffers,
      memoryAtEnd.arrayBuffers,
    );
    const result = {
      schema: "toonspectrum.studio-v12-recovery-package-benchmark",
      version: 1,
      measuredAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        sqlite: "@sqlite.org/sqlite-wasm 3.53.0-build1",
        databaseVfs: "memory",
      },
      workload: {
        scene: { width: 2_048, height: 2_048 },
        recoveredSeq: sourceRecovered.seq,
        snapshotSeq: first.manifest.snapshot?.seq ?? null,
        journalTailEntries: first.manifest.journalTail.count,
        attachments: attachments.length,
        attachmentBytes: first.manifest.totals.attachmentBytes,
        packageBytes: first.bytes.byteLength,
        iterations: { export: 30, import: 30, restoreToFreshSqlite: 12 },
      },
      quality: {
        deterministicExportBytes: Buffer.compare(first.bytes, second.bytes) === 0,
        sourceSeq: sourceRecovered.seq,
        restoredSeq,
        sourceProjectDigest: projectDigest(sourceRecovered.project!),
        restoredProjectDigest: restoredDigest,
        digestAndSeqEqual:
          sourceRecovered.seq === restoredSeq &&
          projectDigest(sourceRecovered.project!) === restoredDigest,
        importedAttachmentHashesVerified: first.manifest.attachments.length,
      },
      latency: {
        export: statistics(exportSamples),
        importAuthenticate: statistics(importSamples),
        restoreToFreshSqlite: statistics(restoreSamples),
      },
      memory: {
        measurement: "Node process observation; not browser OPFS/WASM peak",
        startRssBytes: memoryAtStart.rss,
        startArrayBuffersBytes: memoryAtStart.arrayBuffers,
        observedPeakRssBytes: observedPeakRss,
        observedPeakRssDeltaBytes: observedPeakRss - memoryAtStart.rss,
        observedPeakArrayBuffersBytes: observedPeakArrayBuffers,
        observedPeakArrayBuffersDeltaBytes:
          observedPeakArrayBuffers - memoryAtStart.arrayBuffers,
        endRssBytes: memoryAtEnd.rss,
        endArrayBuffersBytes: memoryAtEnd.arrayBuffers,
      },
      hashCandidates: hashResults,
      verdict: {
        selected: "webcrypto-sha256",
        reason: [
          "existing Studio project archive and OPFS CAS address compatibility",
          "zero incremental runtime bundle bytes",
          "direct browser platform support",
          "BLAKE3 is only a non-addressable transitive dev dependency",
        ],
        blake3ReplacementCondition:
          "Direct dependency, lazy browser chunk, multi-device throughput, and dual-address migration must jointly beat SHA-256 without breaking existing sha256 references.",
      },
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    for (const database of databases) await database.close();
  }
}

await main();
