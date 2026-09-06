import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildStudioPackageArchiveBlob as buildStudioPackageArchiveBlobWithBackend,
  buildStudioPackageArchiveBytes as buildStudioPackageArchiveBytesWithBackend,
  STUDIO_PACKAGE_ARCHIVE_LIMITS,
  type StudioPackageArchiveBuildOptions,
  type StudioPackageArchiveEntry,
  type StudioPackageArchiveError,
} from "./studio-package-archive";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function buildStudioPackageArchiveBytes(
  entries: readonly StudioPackageArchiveEntry[],
  options: StudioPackageArchiveBuildOptions = {},
): Promise<Uint8Array> {
  return buildStudioPackageArchiveBytesWithBackend(entries, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function buildStudioPackageArchiveBlob(
  entries: readonly StudioPackageArchiveEntry[],
  options: StudioPackageArchiveBuildOptions = {},
): Promise<Blob> {
  return buildStudioPackageArchiveBlobWithBackend(entries, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

interface ParsedEntry {
  path: string;
  data: Uint8Array;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  flags: number;
  method: number;
  dosDate: number;
  dosTime: number;
  localHeaderOffset: number;
  local: {
    signature: number;
    flags: number;
    method: number;
    crc32: number;
    compressedBytes: number;
    uncompressedBytes: number;
    path: string;
  };
}

interface ParsedArchive {
  entries: ParsedEntry[];
  centralDirectoryOffset: number;
  centralDirectoryBytes: number;
  eocdOffset: number;
  entryCount: number;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function independentCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function parseStoredZip(bytes: Uint8Array): ParsedArchive {
  if (bytes.byteLength < 22) throw new Error("EOCD가 없습니다.");
  const eocdOffset = bytes.byteLength - 22;
  if (uint32(bytes, eocdOffset) !== EOCD_SIGNATURE) throw new Error("EOCD signature가 다릅니다.");
  if (uint16(bytes, eocdOffset + 4) !== 0 || uint16(bytes, eocdOffset + 6) !== 0) {
    throw new Error("다중 디스크 ZIP은 지원하지 않습니다.");
  }
  if (uint16(bytes, eocdOffset + 20) !== 0) throw new Error("예상하지 않은 ZIP comment입니다.");

  const entryCount = uint16(bytes, eocdOffset + 10);
  if (uint16(bytes, eocdOffset + 8) !== entryCount) throw new Error("디스크 파일 수가 다릅니다.");
  const centralDirectoryBytes = uint32(bytes, eocdOffset + 12);
  const centralDirectoryOffset = uint32(bytes, eocdOffset + 16);
  if (centralDirectoryOffset + centralDirectoryBytes !== eocdOffset) {
    throw new Error("central directory 범위가 EOCD와 맞지 않습니다.");
  }

  const entries: ParsedEntry[] = [];
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(bytes, cursor) !== CENTRAL_SIGNATURE) throw new Error("central header가 없습니다.");
    const flags = uint16(bytes, cursor + 8);
    const method = uint16(bytes, cursor + 10);
    const dosTime = uint16(bytes, cursor + 12);
    const dosDate = uint16(bytes, cursor + 14);
    const crc32 = uint32(bytes, cursor + 16);
    const compressedBytes = uint32(bytes, cursor + 20);
    const uncompressedBytes = uint32(bytes, cursor + 24);
    const pathBytes = uint16(bytes, cursor + 28);
    const extraBytes = uint16(bytes, cursor + 30);
    const commentBytes = uint16(bytes, cursor + 32);
    const localHeaderOffset = uint32(bytes, cursor + 42);
    const path = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + pathBytes));

    if (uint32(bytes, localHeaderOffset) !== LOCAL_SIGNATURE) throw new Error("local header가 없습니다.");
    const localFlags = uint16(bytes, localHeaderOffset + 6);
    const localMethod = uint16(bytes, localHeaderOffset + 8);
    const localCrc32 = uint32(bytes, localHeaderOffset + 14);
    const localCompressedBytes = uint32(bytes, localHeaderOffset + 18);
    const localUncompressedBytes = uint32(bytes, localHeaderOffset + 22);
    const localPathBytes = uint16(bytes, localHeaderOffset + 26);
    const localExtraBytes = uint16(bytes, localHeaderOffset + 28);
    const localPath = textDecoder.decode(
      bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localPathBytes)
    );
    const dataOffset = localHeaderOffset + 30 + localPathBytes + localExtraBytes;
    const data = bytes.slice(dataOffset, dataOffset + localCompressedBytes);

    entries.push({
      path,
      data,
      crc32,
      compressedBytes,
      uncompressedBytes,
      flags,
      method,
      dosDate,
      dosTime,
      localHeaderOffset,
      local: {
        signature: uint32(bytes, localHeaderOffset),
        flags: localFlags,
        method: localMethod,
        crc32: localCrc32,
        compressedBytes: localCompressedBytes,
        uncompressedBytes: localUncompressedBytes,
        path: localPath,
      },
    });
    cursor += 46 + pathBytes + extraBytes + commentBytes;
  }
  if (cursor !== eocdOffset) throw new Error("central directory 길이가 다릅니다.");
  return { entries, centralDirectoryOffset, centralDirectoryBytes, eocdOffset, entryCount };
}

function errorCode(cause: unknown): string | undefined {
  return (cause as StudioPackageArchiveError | undefined)?.code;
}

describe("studio-package-archive ZIP32 writer", () => {
  it("writes unzip-compatible UTF-8 store entries, CRC32, central records, and EOCD", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const manifest = textEncoder.encode('{"schema":"toonspectrum.publish-package"}');
    const bytes = await buildStudioPackageArchiveBytes(
      [
        { path: "images/회차 01.png", data: new Blob([png], { type: "image/png" }) },
        { path: "manifest.json", data: manifest },
      ],
      { modifiedAt: "2026-07-10T12:34:56Z" }
    );

    const parsed = parseStoredZip(bytes);
    expect(parsed.entryCount).toBe(2);
    expect(parsed.centralDirectoryOffset).toBeGreaterThan(0);
    expect(parsed.centralDirectoryBytes).toBeGreaterThan(0);
    expect(parsed.entries.map(({ path }) => path)).toEqual(["images/회차 01.png", "manifest.json"]);
    expect(parsed.entries.map(({ data }) => data)).toEqual([png, manifest]);

    const expectedDosDate = ((2026 - 1980) << 9) | (7 << 5) | 10;
    const expectedDosTime = (12 << 11) | (34 << 5) | 28;
    for (const entry of parsed.entries) {
      expect(entry.flags & UTF8_FLAG).toBe(UTF8_FLAG);
      expect(entry.method).toBe(0);
      expect(entry.compressedBytes).toBe(entry.uncompressedBytes);
      expect(entry.crc32).toBe(independentCrc32(entry.data));
      expect(entry.dosDate).toBe(expectedDosDate);
      expect(entry.dosTime).toBe(expectedDosTime);
      expect(entry.local).toMatchObject({
        signature: LOCAL_SIGNATURE,
        flags: entry.flags,
        method: 0,
        crc32: entry.crc32,
        compressedBytes: entry.compressedBytes,
        uncompressedBytes: entry.uncompressedBytes,
        path: entry.path,
      });
    }
  });

  it("matches the standard CRC-32 check vector", async () => {
    const data = textEncoder.encode("123456789");
    const parsed = parseStoredZip(
      await buildStudioPackageArchiveBytes([{ path: "crc.txt", data }])
    );
    expect(parsed.entries[0]?.crc32).toBe(0xcbf4_3926);
    expect(parsed.entries[0]?.crc32).toBe(independentCrc32(data));
  });

  it("builds byte-identical archives by default and with explicit two-second ZIP timestamps", async () => {
    const entries = [{ path: "a.txt", data: textEncoder.encode("A") }];
    const first = await buildStudioPackageArchiveBytes(entries);
    const second = await buildStudioPackageArchiveBytes(entries);
    const even = await buildStudioPackageArchiveBytes(entries, {
      modifiedAt: "2026-07-10T12:34:56Z",
    });
    const odd = await buildStudioPackageArchiveBytes(entries, {
      modifiedAt: "2026-07-10T12:34:57Z",
    });
    expect(first).toEqual(second);
    expect(even).toEqual(odd);
    expect(parseStoredZip(first).entries[0]).toMatchObject({ dosDate: 33, dosTime: 0 });
  });

  it("returns a single ZIP-compatible Blob for .zip or .toonpkg callers", async () => {
    const entries = [{ path: "manifest.json", data: textEncoder.encode("{}") }];
    const bytes = await buildStudioPackageArchiveBytes(entries);
    const blob = await buildStudioPackageArchiveBlob(entries, {
      mimeType: "application/vnd.toonspectrum.package+zip",
    });
    expect(blob.type).toBe("application/vnd.toonspectrum.package+zip");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(parseStoredZip(new Uint8Array(await blob.arrayBuffer())).entryCount).toBe(1);
  });

  it("honors a pre-aborted build without reading or hashing archive sources", async () => {
    const controller = new AbortController();
    controller.abort();
    const blob = new Blob([Uint8Array.of(1, 2, 3)]);
    const read = vi.spyOn(blob, "arrayBuffer");

    await expect(
      buildStudioPackageArchiveBlob(
        [{ path: "cancelled.bin", data: blob }],
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
  });

  it("fails closed for a large Blob build when no Worker runtime is available", async () => {
    const data = new Uint8Array(1024 * 1024 + 1);

    await expect(
      buildStudioPackageArchiveBlobWithBackend(
        [{ path: "large.bin", data }],
        { crc32ExecutionMode: "worker" },
      ),
    ).rejects.toThrow(
      "CRC32 계산 Worker를 사용할 수 없습니다",
    );
    expect(data.byteLength).toBe(1024 * 1024 + 1);
  });

  it("preselects CRC execution at every browser and archive-Worker product boundary", () => {
    const packageSource = readFileSync(
      new URL("./studio-package-archive.ts", import.meta.url),
      "utf8",
    );
    expect(packageSource.match(/executionMode:\s*options\.crc32ExecutionMode\s*\?\?\s*"worker"/gu))
      .toHaveLength(2);

    const exportMenuSource = readFileSync(
      new URL("./export/StudioExportMenuPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(exportMenuSource.match(/crc32ExecutionMode:\s*"worker"/gu)).toHaveLength(2);

    const projectExportSource = readFileSync(
      new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(projectExportSource).toContain('crc32ExecutionMode: "worker"');

    const batchWorkerSource = readFileSync(
      new URL("./bg3d/studio-bg3d-shot-batch.worker.ts", import.meta.url),
      "utf8",
    );
    expect(batchWorkerSource).toContain('crc32ExecutionMode: "direct-headless"');

    const willReferenceSource = readFileSync(
      new URL("./studio-will-v1-opc-interchange.ts", import.meta.url),
      "utf8",
    );
    expect(willReferenceSource).toContain(
      'crc32ExecutionMode: options.crc32ExecutionMode ?? "direct-bounded"',
    );
    const willWorkerSource = readFileSync(
      new URL("./studio-will-v1-opc.worker.ts", import.meta.url),
      "utf8",
    );
    expect(willWorkerSource).toContain('crc32ExecutionMode: "direct-headless"');

    for (const relativePath of [
      "./studio-cbz-interchange.ts",
      "./studio-openraster-interchange.ts",
      "./studio-project-archive.ts",
      "./studio-v12-recovery-package.ts",
      "./bg3d/studio-bg3d-shot-batch.ts",
    ]) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source).toContain('crc32ExecutionMode: options.crc32ExecutionMode ?? "worker"');
      expect(source).not.toContain("allowLargeDirectArchiveCrcInHeadless");
    }
  });

  it("writes a valid empty ZIP32 archive", async () => {
    const bytes = await buildStudioPackageArchiveBytes([]);
    expect(bytes).toHaveLength(22);
    expect(parseStoredZip(bytes)).toMatchObject({
      entryCount: 0,
      centralDirectoryOffset: 0,
      centralDirectoryBytes: 0,
      eocdOffset: 0,
    });
  });

  it.each([
    "../secret.txt",
    "folder/../secret.txt",
    "folder/./file.txt",
    "/absolute/file.txt",
    "C:/windows.txt",
    "folder\\windows.txt",
    "folder//file.txt",
    "folder/CON.txt",
    "folder/trailing. ",
    "folder/unsafe\u202efile.txt",
    "．．／secret.txt",
    "folder/unpaired-\ud800.txt",
  ])("rejects unsafe or traversing path %s", async (path) => {
    await expect(
      buildStudioPackageArchiveBytes([{ path, data: new Uint8Array() }])
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "PATH_INVALID");
  });

  it("rejects case-folded and Unicode-normalized duplicate extraction paths", async () => {
    await expect(
      buildStudioPackageArchiveBytes([
        { path: "Images/Art.png", data: new Uint8Array() },
        { path: "images/art.png", data: new Uint8Array() },
      ])
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "PATH_DUPLICATE");

    await expect(
      buildStudioPackageArchiveBytes([
        { path: "café.txt", data: new Uint8Array() },
        { path: "cafe\u0301.txt", data: new Uint8Array() },
      ])
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "PATH_DUPLICATE");
  });

  it("rejects caller-lowered file count, entry, total, archive, and path limits", async () => {
    await expect(
      buildStudioPackageArchiveBytes(
        [
          { path: "a", data: new Uint8Array() },
          { path: "b", data: new Uint8Array() },
        ],
        { limits: { maxFiles: 1 } }
      )
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "ENTRY_COUNT_LIMIT");

    await expect(
      buildStudioPackageArchiveBytes([{ path: "a", data: Uint8Array.of(1, 2, 3) }], {
        limits: { maxEntryBytes: 2 },
      })
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "ENTRY_SIZE_LIMIT");

    await expect(
      buildStudioPackageArchiveBytes(
        [
          { path: "a", data: Uint8Array.of(1, 2) },
          { path: "b", data: Uint8Array.of(3, 4) },
        ],
        { limits: { maxTotalBytes: 3 } }
      )
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "TOTAL_SIZE_LIMIT");

    const unreadBlob = new Blob([]);
    const arrayBuffer = vi.spyOn(unreadBlob, "arrayBuffer");
    await expect(
      buildStudioPackageArchiveBytes([{ path: "a", data: unreadBlob }], {
        limits: { maxArchiveBytes: 40 },
      })
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "ARCHIVE_SIZE_LIMIT");
    expect(arrayBuffer).not.toHaveBeenCalled();

    await expect(
      buildStudioPackageArchiveBytes([{ path: "long-name.txt", data: new Uint8Array() }], {
        limits: { maxPathBytes: 4 },
      })
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "PATH_INVALID");
  });

  it("rejects ZIP32 overflow before reading an oversized Blob", async () => {
    const hugeBlob = new Blob([]);
    Object.defineProperty(hugeBlob, "size", { value: 0x1_0000_0000 });
    const arrayBuffer = vi.spyOn(hugeBlob, "arrayBuffer");
    await expect(
      buildStudioPackageArchiveBytes([{ path: "huge.bin", data: hugeBlob }])
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "ZIP32_OVERFLOW");
    expect(arrayBuffer).not.toHaveBeenCalled();

    const tooMany = Array<StudioPackageArchiveEntry>(65_536).fill({
      path: "same",
      data: new Uint8Array(),
    });
    await expect(buildStudioPackageArchiveBytes(tooMany)).rejects.toSatisfy(
      (cause: unknown) => errorCode(cause) === "ZIP32_OVERFLOW"
    );
  });

  it("rejects invalid deterministic timestamps and attempts to raise hard limits", async () => {
    const entries = [{ path: "a", data: new Uint8Array() }];
    for (const modifiedAt of ["2026-07-10T12:34:56", "1979-12-31T23:59:58Z", "invalid"]) {
      await expect(buildStudioPackageArchiveBytes(entries, { modifiedAt })).rejects.toSatisfy(
        (cause: unknown) => errorCode(cause) === "TIMESTAMP_INVALID"
      );
    }
    await expect(
      buildStudioPackageArchiveBytes(entries, {
        limits: { maxFiles: STUDIO_PACKAGE_ARCHIVE_LIMITS.maxFiles + 1 },
      })
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "LIMIT_INVALID");
  });

  it("reports deterministic per-entry progress after data and CRC preparation", async () => {
    const onProgress = vi.fn();
    await buildStudioPackageArchiveBytes(
      [
        { path: "one.bin", data: new Blob([Uint8Array.of(1, 2, 3)]) },
        { path: "two.bin", data: Uint8Array.of(4, 5) },
      ],
      { onProgress }
    );
    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([
      {
        completedFiles: 1,
        totalFiles: 2,
        processedBytes: 3,
        totalBytes: 5,
        path: "one.bin",
      },
      {
        completedFiles: 2,
        totalFiles: 2,
        processedBytes: 5,
        totalBytes: 5,
        path: "two.bin",
      },
    ]);
  });

  it("snapshots mutable byte inputs before awaiting earlier Blob reads", async () => {
    let release: (() => void) | undefined;
    const slowBlob = new Blob([Uint8Array.of(1)]);
    vi.spyOn(slowBlob, "arrayBuffer").mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = () => resolve(Uint8Array.of(1).buffer as ArrayBuffer);
        })
    );
    const mutable = Uint8Array.of(2);
    const archivePromise = buildStudioPackageArchiveBytes([
      { path: "first.bin", data: slowBlob },
      { path: "second.bin", data: mutable },
    ]);
    mutable[0] = 9;
    release?.();
    const parsed = parseStoredZip(await archivePromise);
    expect(parsed.entries[1]?.data).toEqual(Uint8Array.of(2));
  });

  it("rejects unsupported sources and Blob size mismatches", async () => {
    await expect(
      buildStudioPackageArchiveBytes([
        { path: "bad.bin", data: "not-bytes" as unknown as Uint8Array },
      ])
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "SOURCE_INVALID");

    const lyingBlob = new Blob([Uint8Array.of(1, 2)]);
    Object.defineProperty(lyingBlob, "size", { value: 3 });
    await expect(
      buildStudioPackageArchiveBytes([{ path: "lying.bin", data: lyingBlob }])
    ).rejects.toSatisfy((cause: unknown) => errorCode(cause) === "SOURCE_SIZE_MISMATCH");
  });
});
