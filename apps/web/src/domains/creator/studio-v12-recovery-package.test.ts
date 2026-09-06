import {
  CommandBus,
  canonicalJson,
  createEmptyScene,
  projectDigest,
  recoverProject,
} from "@toonspectrum/studio-project-model";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import { createStudioOpfsAssetStore } from "./studio-opfs-asset-store";
import { createStudioOpfsMemoryFileSystem } from "./studio-opfs-filesystem";
import {
  buildStudioPackageArchiveBytes as buildStudioPackageArchiveBytesWithBackend,
} from "./studio-package-archive";
import { createSqliteJournalStore } from "./studio-sqlite-journal-store";
import {
  STUDIO_V12_RECOVERY_PACKAGE_MIME,
  StudioV12RecoveryPackageError,
  buildStudioV12RecoveryPackage as buildStudioV12RecoveryPackageWithBackend,
  createStudioV12RecoveryOpfsAttachmentTarget,
  importStudioV12RecoveryPackage,
  openStudioV12RecoveryPackage,
  restoreStudioV12RecoveryPackage,
  saveStudioV12RecoveryPackage,
} from "./studio-v12-recovery-package";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";
import type { StudioPackageArchiveEntry } from "./studio-package-archive";
import type { StudioV12RecoveryPackageErrorCode } from "./studio-v12-recovery-package";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LOCAL_SIGNATURE = 0x0403_4b50;
const CENTRAL_SIGNATURE = 0x0201_4b50;
const EOCD_SIGNATURE = 0x0605_4b50;

function buildStudioV12RecoveryPackage(
  input: Parameters<typeof buildStudioV12RecoveryPackageWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioV12RecoveryPackageWithBackend>[1]> = {},
): ReturnType<typeof buildStudioV12RecoveryPackageWithBackend> {
  return buildStudioV12RecoveryPackageWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function buildStudioPackageArchiveBytes(
  entries: Parameters<typeof buildStudioPackageArchiveBytesWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioPackageArchiveBytesWithBackend>[1]> = {},
): ReturnType<typeof buildStudioPackageArchiveBytesWithBackend> {
  return buildStudioPackageArchiveBytesWithBackend(entries, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

interface TestZipEntry {
  path: string;
  data: Uint8Array;
  centralOffset: number;
  centralPathOffset: number;
  localOffset: number;
  localPathOffset: number;
  dataOffset: number;
}

interface Fixture {
  database: StudioLocalDatabase;
  store: ReturnType<typeof createSqliteJournalStore>;
  built: Awaited<ReturnType<typeof buildStudioV12RecoveryPackage>>;
}

let sqlite3: StudioSqliteApiHandle;
const databases: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of databases) await database.close();
});

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  databases.push(database);
  return database;
}

async function fixture(options: { twoAttachments?: boolean } = {}): Promise<Fixture> {
  const database = await memoryDatabase();
  const store = createSqliteJournalStore(database, "recovery-source");
  const { bus, recovery } = await CommandBus.open(store, {
    snapshotEvery: 2,
    now: (() => {
      let now = 10_000;
      return () => (now += 10);
    })(),
  });
  expect(recovery.issues).toEqual([]);
  await bus.dispatch({ type: "scene/init", scene: createEmptyScene(640, 480) });
  await bus.dispatch({
    type: "scene/set-background",
    color: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
  });
  await bus.dispatch({
    type: "scene/set-background",
    color: { r: 0.4, g: 0.5, b: 0.6, a: 1 },
  });
  const attachments = [
    {
      data: encoder.encode("font-or-brush-binary-A"),
      mimeType: "application/octet-stream",
      rights: {
        owner: "Creator A",
        licenseSpdx: "CC0-1.0",
        attribution: ["Creator A"],
      },
      metadata: {
        name: "Brush tip A",
        kind: "brush-tip",
        sourceFormat: "png",
        tags: ["ink", "primary"],
      },
    },
    ...(options.twoAttachments
      ? [
          {
            data: encoder.encode("font-or-brush-binary-B"),
            mimeType: "font/woff2",
            rights: { owner: "Creator B", licenseSpdx: "OFL-1.1" },
            metadata: { name: "Font B", kind: "font", sourceFormat: "woff2" },
          },
        ]
      : []),
  ];
  const built = await buildStudioV12RecoveryPackage({
    project: {
      projectId: "project-recovery-1",
      workspaceId: "workspace-local-1",
      title: "Recovery fixture",
    },
    history: store,
    attachments,
    rights: {
      owner: "Creator A",
      licenseSpdx: "LicenseRef-Private",
      notices: ["Offline external recovery copy"],
    },
    metadata: {
      title: "Recovery fixture",
      description: "Stable IR only",
      tags: ["v12", "recovery"],
    },
  });
  return { database, store, built };
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function setUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value, true);
}

function parseTestZip(bytes: Uint8Array): TestZipEntry[] {
  const eocdOffset = bytes.byteLength - 22;
  expect(uint32(bytes, eocdOffset)).toBe(EOCD_SIGNATURE);
  const count = uint16(bytes, eocdOffset + 10);
  let cursor = uint32(bytes, eocdOffset + 16);
  const entries: TestZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(uint32(bytes, cursor)).toBe(CENTRAL_SIGNATURE);
    const dataBytes = uint32(bytes, cursor + 20);
    const pathBytes = uint16(bytes, cursor + 28);
    const extraBytes = uint16(bytes, cursor + 30);
    const commentBytes = uint16(bytes, cursor + 32);
    const localOffset = uint32(bytes, cursor + 42);
    expect(uint32(bytes, localOffset)).toBe(LOCAL_SIGNATURE);
    const localPathBytes = uint16(bytes, localOffset + 26);
    const localExtraBytes = uint16(bytes, localOffset + 28);
    const centralPathOffset = cursor + 46;
    const localPathOffset = localOffset + 30;
    const dataOffset = localPathOffset + localPathBytes + localExtraBytes;
    entries.push({
      path: decoder.decode(bytes.subarray(centralPathOffset, centralPathOffset + pathBytes)),
      data: bytes.slice(dataOffset, dataOffset + dataBytes),
      centralOffset: cursor,
      centralPathOffset,
      localOffset,
      localPathOffset,
      dataOffset,
    });
    cursor += 46 + pathBytes + extraBytes + commentBytes;
  }
  return entries;
}

async function rebuild(
  bytes: Uint8Array,
  replace: ReadonlyMap<string, Uint8Array> = new Map(),
  extras: readonly StudioPackageArchiveEntry[] = [],
): Promise<Uint8Array> {
  const entries = parseTestZip(bytes).map((entry) => ({
    path: entry.path,
    data: replace.get(entry.path) ?? entry.data,
  }));
  return buildStudioPackageArchiveBytes([...entries, ...extras]);
}

function jsonEntry(bytes: Uint8Array, path: string): Record<string, unknown> {
  const entry = parseTestZip(bytes).find((candidate) => candidate.path === path);
  if (!entry) throw new Error(`missing ${path}`);
  return JSON.parse(decoder.decode(entry.data)) as Record<string, unknown>;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function expectCode(
  promise: Promise<unknown>,
  code: StudioV12RecoveryPackageErrorCode,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof StudioV12RecoveryPackageError && error.code === code,
  );
}

async function signedHistoryMutation(
  bytes: Uint8Array,
  path: "history/journal-tail.json" | "history/snapshot.json",
  mutate: (value: unknown) => unknown,
): Promise<Uint8Array> {
  const entries = parseTestZip(bytes);
  const original = entries.find((entry) => entry.path === path);
  if (!original) throw new Error(`missing ${path}`);
  const nextValue = mutate(JSON.parse(decoder.decode(original.data)) as unknown);
  const nextBytes = encoder.encode(canonicalJson(nextValue));
  const manifest = jsonEntry(bytes, "manifest.json");
  const referenceKey = path.includes("snapshot") ? "snapshot" : "journalTail";
  const reference = manifest[referenceKey] as Record<string, unknown>;
  reference.contentHash = await sha256(nextBytes);
  reference.byteSize = nextBytes.byteLength;
  const totals = manifest.totals as Record<string, unknown>;
  const snapshotBytes = path === "history/snapshot.json"
    ? nextBytes.byteLength
    : entries.find((entry) => entry.path === "history/snapshot.json")?.data.byteLength ?? 0;
  const journalBytes = path === "history/journal-tail.json"
    ? nextBytes.byteLength
    : entries.find((entry) => entry.path === "history/journal-tail.json")!.data.byteLength;
  totals.payloadBytes =
    snapshotBytes + journalBytes + Number(totals.attachmentBytes ?? 0);
  return rebuild(
    bytes,
    new Map([
      [path, nextBytes],
      ["manifest.json", encoder.encode(canonicalJson(manifest))],
    ]),
  );
}

describe("V12 recovery package content-addressed vertical slice", () => {
  it("exports SQLite snapshot/journal and restores identical seq/digest into a new real SQLite DB", async () => {
    const source = await fixture({ twoAttachments: true });
    const imported = await importStudioV12RecoveryPackage(source.built.bytes);
    const destinationDatabase = await memoryDatabase();
    const destinationStore = createSqliteJournalStore(
      destinationDatabase,
      "recovery-destination",
    );
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assetStore = createStudioOpfsAssetStore({ fs: fileSystem });
    const restored = await restoreStudioV12RecoveryPackage(imported, {
      history: destinationStore,
      attachments: createStudioV12RecoveryOpfsAttachmentTarget(assetStore),
    });
    const sourceRecovered = await recoverProject(source.store);
    const destinationRecovered = await recoverProject(destinationStore);

    expect(imported.manifest.snapshot).toMatchObject({ seq: 2, slot: "A" });
    expect(imported.manifest.journalTail).toMatchObject({
      baseSeq: 2,
      firstSeq: 3,
      lastSeq: 3,
      count: 1,
    });
    expect(restored.seq).toBe(3);
    expect(destinationRecovered.seq).toBe(sourceRecovered.seq);
    expect(projectDigest(destinationRecovered.project!)).toBe(
      projectDigest(sourceRecovered.project!),
    );
    expect(projectDigest(restored.project)).toBe(source.built.manifest.recovered.projectDigest);
    expect(destinationRecovered.report.issues).toEqual([]);
    for (const attachment of imported.attachments) {
      expect(await assetStore.get(attachment.contentHash, { verify: true })).toEqual(
        attachment.bytes,
      );
    }
  });

  it("emits byte-identical ZIP bytes and canonical ordering for equivalent inputs", async () => {
    const source = await fixture({ twoAttachments: true });
    const second = await buildStudioV12RecoveryPackage({
      project: {
        title: "Recovery fixture",
        projectId: "project-recovery-1",
        workspaceId: "workspace-local-1",
      },
      history: source.store,
      attachments: [
        {
          data: encoder.encode("font-or-brush-binary-B"),
          mimeType: "font/woff2",
          rights: { licenseSpdx: "OFL-1.1", owner: "Creator B" },
          metadata: { sourceFormat: "woff2", kind: "font", name: "Font B" },
        },
        {
          data: encoder.encode("font-or-brush-binary-A"),
          mimeType: "application/octet-stream",
          rights: {
            licenseSpdx: "CC0-1.0",
            attribution: ["Creator A"],
            owner: "Creator A",
          },
          metadata: {
            tags: ["primary", "ink"],
            sourceFormat: "png",
            name: "Brush tip A",
            kind: "brush-tip",
          },
        },
      ],
      rights: {
        notices: ["Offline external recovery copy"],
        licenseSpdx: "LicenseRef-Private",
        owner: "Creator A",
      },
      metadata: {
        tags: ["recovery", "v12"],
        description: "Stable IR only",
        title: "Recovery fixture",
      },
    });
    expect(second.bytes).toEqual(source.built.bytes);
    expect(source.built.manifest.attachments.map(({ contentHash }) => contentHash)).toEqual(
      [...source.built.manifest.attachments.map(({ contentHash }) => contentHash)].sort(),
    );
    expect(parseTestZip(source.built.bytes).map(({ path }) => path)).toEqual([
      "manifest.json",
      "history/snapshot.json",
      "history/journal-tail.json",
      ...source.built.manifest.attachments.map(({ path }) => path),
    ]);
  });

  it("dedupes identical bytes only when rights and metadata are identical", async () => {
    const source = await fixture();
    const input = {
      data: encoder.encode("same"),
      rights: { owner: "A" },
      metadata: { name: "same" },
    };
    const deduped = await buildStudioV12RecoveryPackage({
      project: { projectId: "dedupe" },
      history: source.store,
      attachments: [input, { ...input, data: encoder.encode("same") }],
    });
    expect(deduped.manifest.attachments).toHaveLength(1);
    await expectCode(
      buildStudioV12RecoveryPackage({
        project: { projectId: "conflict" },
        history: source.store,
        attachments: [
          input,
          { ...input, data: encoder.encode("same"), rights: { owner: "B" } },
        ],
      }),
      "ATTACHMENT_CONFLICT",
    );
  });

  it("uses explicit local file ports and never invokes fetch/server transport", async () => {
    const source = await fixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let saved: Uint8Array | null = null;
    await saveStudioV12RecoveryPackage(
      {
        async save(file) {
          expect(file.mimeType).toBe(STUDIO_V12_RECOVERY_PACKAGE_MIME);
          saved = Uint8Array.from(file.bytes);
        },
      },
      "project.toonrecovery.zip",
      source.built,
    );
    const imported = await openStudioV12RecoveryPackage({
      open({ accept }) {
        expect(accept).toBe(STUDIO_V12_RECOVERY_PACKAGE_MIME);
        return Promise.resolve(saved!);
      },
    });
    expect(imported.manifest.project.projectId).toBe("project-recovery-1");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses to overwrite a non-empty history destination", async () => {
    const source = await fixture();
    const imported = await importStudioV12RecoveryPackage(source.built.bytes);
    await expectCode(
      restoreStudioV12RecoveryPackage(imported, { history: source.store }),
      "DESTINATION_NOT_EMPTY",
    );
  });

  it("rejects a CAS target hash mismatch before writing destination history", async () => {
    const source = await fixture();
    const imported = await importStudioV12RecoveryPackage(source.built.bytes);
    const destinationDatabase = await memoryDatabase();
    const destinationStore = createSqliteJournalStore(
      destinationDatabase,
      "recovery-cas-mismatch",
    );
    await expectCode(
      restoreStudioV12RecoveryPackage(imported, {
        history: destinationStore,
        attachments: {
          put: () => Promise.resolve(`sha256:${"0".repeat(64)}`),
        },
      }),
      "ATTACHMENT_REJECTED",
    );
    expect(await destinationStore.readEntries()).toEqual([]);
    expect(await destinationStore.readSnapshots()).toEqual([]);
  });
});

describe("V12 recovery package bounded hostile import", () => {
  it("rejects canonical path traversal before reading a manifest", async () => {
    const source = await fixture();
    const bytes = Uint8Array.from(source.built.bytes);
    const manifest = parseTestZip(bytes).find((entry) => entry.path === "manifest.json")!;
    const traversal = encoder.encode("../evil001.js");
    expect(traversal.byteLength).toBe(encoder.encode(manifest.path).byteLength);
    bytes.set(traversal, manifest.centralPathOffset);
    bytes.set(traversal, manifest.localPathOffset);
    await expectCode(importStudioV12RecoveryPackage(bytes), "PATH_INVALID");
  });

  it("rejects duplicate extraction paths including central/local agreement", async () => {
    const bytes = await buildStudioPackageArchiveBytes([
      { path: "a/a.json", data: encoder.encode("A") },
      { path: "b/b.json", data: encoder.encode("B") },
    ]);
    const mutated = Uint8Array.from(bytes);
    const entries = parseTestZip(mutated);
    const first = entries[0]!;
    const second = entries[1]!;
    const duplicate = encoder.encode(first.path);
    expect(duplicate.byteLength).toBe(encoder.encode(second.path).byteLength);
    mutated.set(duplicate, second.centralPathOffset);
    mutated.set(duplicate, second.localPathOffset);
    await expectCode(importStudioV12RecoveryPackage(mutated), "DUPLICATE_ENTRY");
  });

  it("rejects ZIP bomb declarations before allocating entry bytes", async () => {
    const source = await fixture();
    const bytes = Uint8Array.from(source.built.bytes);
    const entry = parseTestZip(bytes).at(-1)!;
    const declared = 200_000_001;
    setUint32(bytes, entry.centralOffset + 20, declared);
    setUint32(bytes, entry.centralOffset + 24, declared);
    setUint32(bytes, entry.localOffset + 18, declared);
    setUint32(bytes, entry.localOffset + 22, declared);
    await expectCode(importStudioV12RecoveryPackage(bytes), "ZIP_BOMB");
  });

  it("rejects an archive CRC mismatch", async () => {
    const source = await fixture();
    const bytes = Uint8Array.from(source.built.bytes);
    const attachment = parseTestZip(bytes).at(-1)!;
    bytes[attachment.dataOffset] = (bytes[attachment.dataOffset]! ^ 0xff) & 0xff;
    await expectCode(importStudioV12RecoveryPackage(bytes), "CRC_MISMATCH");
  });

  it("rejects attachment SHA-256 mismatch even when ZIP CRC was rebuilt", async () => {
    const source = await fixture();
    const attachment = parseTestZip(source.built.bytes).at(-1)!;
    const changed = Uint8Array.from(attachment.data);
    changed[0] = (changed[0]! ^ 0x01) & 0xff;
    const rebuilt = await rebuild(
      source.built.bytes,
      new Map([[attachment.path, changed]]),
    );
    await expectCode(importStudioV12RecoveryPackage(rebuilt), "HASH_MISMATCH");
  });

  it("rejects unknown manifest versions before attempting history recovery", async () => {
    const source = await fixture();
    const manifest = jsonEntry(source.built.bytes, "manifest.json");
    manifest.version = 99;
    const rebuilt = await rebuild(
      source.built.bytes,
      new Map([["manifest.json", encoder.encode(canonicalJson(manifest))]]),
    );
    await expectCode(importStudioV12RecoveryPackage(rebuilt), "UNKNOWN_VERSION");
  });

  it("rejects a CRC-torn journal even if an attacker recomputes outer SHA-256", async () => {
    const source = await fixture();
    const rebuilt = await signedHistoryMutation(
      source.built.bytes,
      "history/journal-tail.json",
      (value) => {
        const entries = value as Array<Record<string, unknown>>;
        return entries.map((entry, index) =>
          index === entries.length - 1
            ? { ...entry, crc: Number(entry.crc) ^ 1 }
            : entry,
        );
      },
    );
    await expectCode(importStudioV12RecoveryPackage(rebuilt), "HISTORY_INVALID");
  });

  it("rejects engine objects embedded in otherwise signed snapshot JSON", async () => {
    const source = await fixture();
    const rebuilt = await signedHistoryMutation(
      source.built.bytes,
      "history/snapshot.json",
      (value) => ({
        ...(value as Record<string, unknown>),
        engineObject: { provider: "vello", nativeHandle: 123 },
      }),
    );
    await expectCode(importStudioV12RecoveryPackage(rebuilt), "ENGINE_OBJECT_REJECTED");
  });

  it("rejects non-canonical duplicate/hash ordering in a signed manifest", async () => {
    const source = await fixture({ twoAttachments: true });
    const manifest = jsonEntry(source.built.bytes, "manifest.json");
    manifest.attachments = [...(manifest.attachments as unknown[])].reverse();
    const rebuilt = await rebuild(
      source.built.bytes,
      new Map([["manifest.json", encoder.encode(canonicalJson(manifest))]]),
    );
    await expectCode(importStudioV12RecoveryPackage(rebuilt), "MANIFEST_INVALID");
  });

  it("rejects unmanifested files instead of ignoring hidden payload", async () => {
    const source = await fixture();
    const rebuilt = await rebuild(source.built.bytes, new Map(), [
      { path: "hidden/payload.bin", data: encoder.encode("hidden") },
    ]);
    await expectCode(importStudioV12RecoveryPackage(rebuilt), "UNEXPECTED_ENTRY");
  });

  it("enforces lowered build/import budgets", async () => {
    const source = await fixture();
    await expectCode(
      buildStudioV12RecoveryPackage(
        {
          project: { projectId: "bounded" },
          history: source.store,
          attachments: [{ data: new Uint8Array(32) }],
        },
        { limits: { maxAttachmentBytes: 16 } },
      ),
      "LIMIT_EXCEEDED",
    );
    await expectCode(
      importStudioV12RecoveryPackage(source.built.bytes, {
        limits: { maxArchiveBytes: source.built.bytes.byteLength - 1 },
      }),
      "LIMIT_EXCEEDED",
    );
  });

  it("honors pre-abort and mid-Blob-read cancellation without history writes", async () => {
    const source = await fixture();
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      importStudioV12RecoveryPackage(source.built.bytes, { signal: preAborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const midAbort = new AbortController();
    class AbortingBlob extends Blob {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        midAbort.abort();
        return super.arrayBuffer();
      }
    }
    await expect(
      buildStudioV12RecoveryPackage(
        {
          project: { projectId: "cancel" },
          history: source.store,
          attachments: [
            { data: new AbortingBlob([encoder.encode("cancel-after-await")]) },
          ],
        },
        { signal: midAbort.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
