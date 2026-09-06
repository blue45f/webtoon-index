import { deflateRawSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { buildStudioPackageArchiveBytes } from "./studio-package-archive";
import {
  readStudioZipArchive,
  StudioZipReaderError,
  type StudioZipReaderErrorCode,
} from "./studio-zip-reader";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UTF8_FLAG = 0x0800;

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crc32Table[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

interface ZipFixtureEntry {
  path: string;
  data?: Uint8Array;
  compressedData?: Uint8Array;
  method?: number;
  flags?: number;
  versionNeeded?: number;
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
  declaredCompressedBytes?: number;
  declaredUncompressedBytes?: number;
  declaredCrc32?: number;
  diskStart?: number;
}

function buildZipFixture(entries: readonly ZipFixtureEntry[], comment = ""): Uint8Array {
  const prepared = entries.map((entry) => {
    const path = encoder.encode(entry.path);
    const data = entry.data ?? new Uint8Array();
    const compressedData = entry.compressedData ?? data;
    const localExtra = entry.localExtra ?? new Uint8Array();
    const centralExtra = entry.centralExtra ?? localExtra;
    return {
      ...entry,
      path,
      data,
      compressedData,
      localExtra,
      centralExtra,
      flags: entry.flags ?? UTF8_FLAG,
      method: entry.method ?? 0,
      versionNeeded: entry.versionNeeded ?? 20,
      compressedBytes: entry.declaredCompressedBytes ?? compressedData.byteLength,
      uncompressedBytes: entry.declaredUncompressedBytes ?? data.byteLength,
      crc: entry.declaredCrc32 ?? crc32(data),
      localOffset: 0,
    };
  });
  let localBytes = 0;
  for (const entry of prepared) {
    entry.localOffset = localBytes;
    localBytes += 30 + entry.path.byteLength + entry.localExtra.byteLength + entry.compressedData.byteLength;
  }
  const centralBytes = prepared.reduce(
    (sum, entry) => sum + 46 + entry.path.byteLength + entry.centralExtra.byteLength,
    0
  );
  const commentBytes = encoder.encode(comment);
  const output = new Uint8Array(localBytes + centralBytes + 22 + commentBytes.byteLength);
  const view = new DataView(output.buffer);

  let offset = 0;
  for (const entry of prepared) {
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, entry.versionNeeded, true);
    view.setUint16(offset + 6, entry.flags, true);
    view.setUint16(offset + 8, entry.method, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.compressedBytes, true);
    view.setUint32(offset + 22, entry.uncompressedBytes, true);
    view.setUint16(offset + 26, entry.path.byteLength, true);
    view.setUint16(offset + 28, entry.localExtra.byteLength, true);
    output.set(entry.path, offset + 30);
    output.set(entry.localExtra, offset + 30 + entry.path.byteLength);
    output.set(
      entry.compressedData,
      offset + 30 + entry.path.byteLength + entry.localExtra.byteLength
    );
    offset += 30 + entry.path.byteLength + entry.localExtra.byteLength + entry.compressedData.byteLength;
  }

  const centralOffset = offset;
  for (const entry of prepared) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, entry.versionNeeded, true);
    view.setUint16(offset + 8, entry.flags, true);
    view.setUint16(offset + 10, entry.method, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.compressedBytes, true);
    view.setUint32(offset + 24, entry.uncompressedBytes, true);
    view.setUint16(offset + 28, entry.path.byteLength, true);
    view.setUint16(offset + 30, entry.centralExtra.byteLength, true);
    view.setUint16(offset + 34, entry.diskStart ?? 0, true);
    view.setUint32(offset + 42, entry.localOffset, true);
    output.set(entry.path, offset + 46);
    output.set(entry.centralExtra, offset + 46 + entry.path.byteLength);
    offset += 46 + entry.path.byteLength + entry.centralExtra.byteLength;
  }

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, centralBytes, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, commentBytes.byteLength, true);
  output.set(commentBytes, offset + 22);
  return output;
}

async function expectZipError(
  promise: Promise<unknown>,
  code: StudioZipReaderErrorCode
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (cause) {
    expect(cause).toBeInstanceOf(StudioZipReaderError);
    expect((cause as StudioZipReaderError).code).toBe(code);
  }
}

describe("readStudioZipArchive", () => {
  it("reads writer-produced stored entries from bytes and Blob sources", async () => {
    const source = await buildStudioPackageArchiveBytes(
      [
        { path: "hello.txt", data: encoder.encode("안녕") },
        { path: "nested/data.bin", data: new Uint8Array([1, 2, 3]) },
      ],
      { crc32ExecutionMode: "direct-headless" },
    );

    const archive = await readStudioZipArchive(source);
    expect(archive.entries.map((entry) => entry.path)).toEqual([
      "hello.txt",
      "nested/data.bin",
    ]);
    expect(decoder.decode(await archive.readEntry("hello.txt"))).toBe("안녕");
    expect([...await archive.readEntry("nested/data.bin")]).toEqual([1, 2, 3]);

    const blobSource = new Uint8Array(source.byteLength);
    blobSource.set(source);
    const blobArchive = await readStudioZipArchive(new Blob([blobSource.buffer]));
    const blob = await blobArchive.readEntryBlob("hello.txt", "text/plain");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("안녕");
  });

  it("preserves physical entry order, directories, and a bounded UTF-8 comment", async () => {
    const archive = await readStudioZipArchive(
      buildZipFixture(
        [
          { path: "data/" },
          { path: "data/2.txt", data: encoder.encode("two") },
          { path: "data/1.txt", data: encoder.encode("one") },
        ],
        "ToonSpectrum"
      )
    );

    expect(archive.comment).toBe("ToonSpectrum");
    expect(archive.entries.map((entry) => entry.path)).toEqual([
      "data/",
      "data/2.txt",
      "data/1.txt",
    ]);
    expect(archive.entries[0]?.directory).toBe(true);
    expect(await archive.readEntry("data/")).toEqual(new Uint8Array());
  });

  it("uses an injected raw-DEFLATE adapter and authenticates its output", async () => {
    const original = encoder.encode("raw deflate payload");
    const compressed = new Uint8Array([9, 8, 7, 6]);
    const inflateRaw = vi.fn(async () => original.slice());
    const archive = await readStudioZipArchive(
      buildZipFixture([
        { path: "compressed.txt", data: original, compressedData: compressed, method: 8 },
      ]),
      { inflateRaw }
    );

    expect(decoder.decode(await archive.readEntry("compressed.txt"))).toBe(
      "raw deflate payload"
    );
    expect(inflateRaw).toHaveBeenCalledWith(
      compressed,
      expect.objectContaining({ path: "compressed.txt", expectedBytes: original.byteLength })
    );
  });

  it("uses DecompressionStream raw-DEFLATE when the runtime provides it", async () => {
    const original = encoder.encode("browser raw deflate payload");
    const compressed = new Uint8Array(deflateRawSync(original));
    const archive = await readStudioZipArchive(
      buildZipFixture([
        { path: "stream.txt", data: original, compressedData: compressed, method: 8 },
      ])
    );

    expect(decoder.decode(await archive.readEntry("stream.txt"))).toBe(
      "browser raw deflate payload"
    );
  });

  it("rejects zip-slip, absolute, reserved, and ambiguous duplicate paths", async () => {
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "../escape.txt" }])),
      "PATH_INVALID"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "/absolute.txt" }])),
      "PATH_INVALID"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "CON.txt" }])),
      "PATH_INVALID"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "Page.png" }, { path: "page.png" }])),
      "PATH_DUPLICATE"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "data" }, { path: "data/page.png" }])),
      "PATH_DUPLICATE"
    );
  });

  it("rejects encrypted, data-descriptor, unsupported-compression, and ZIP64 entries", async () => {
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "encrypted", flags: UTF8_FLAG | 0x0001 }])),
      "ENCRYPTED_UNSUPPORTED"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "descriptor", flags: UTF8_FLAG | 0x0008 }])),
      "DATA_DESCRIPTOR_UNSUPPORTED"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "bzip", method: 12 }])),
      "COMPRESSION_UNSUPPORTED"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "zip64", versionNeeded: 45 }])),
      "ZIP64_UNSUPPORTED"
    );
    await expectZipError(
      readStudioZipArchive(
        buildZipFixture([
          { path: "zip64-extra", centralExtra: new Uint8Array([1, 0, 0, 0]) },
        ])
      ),
      "ZIP64_UNSUPPORTED"
    );
  });

  it("enforces count, entry, total, archive, path, ratio, and central-directory budgets", async () => {
    const twoEntries = buildZipFixture([{ path: "a" }, { path: "b" }]);
    await expectZipError(
      readStudioZipArchive(twoEntries, { limits: { maxEntries: 1 } }),
      "ENTRY_COUNT_LIMIT"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "large", data: new Uint8Array(5) }]), {
        limits: { maxEntryUncompressedBytes: 4 },
      }),
      "ENTRY_SIZE_LIMIT"
    );
    await expectZipError(
      readStudioZipArchive(
        buildZipFixture([
          { path: "a", data: new Uint8Array(3) },
          { path: "b", data: new Uint8Array(3) },
        ]),
        { limits: { maxTotalUncompressedBytes: 5 } }
      ),
      "TOTAL_SIZE_LIMIT"
    );
    await expectZipError(
      readStudioZipArchive(twoEntries, { limits: { maxArchiveBytes: twoEntries.byteLength - 1 } }),
      "ARCHIVE_SIZE_LIMIT"
    );
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "long-name" }]), {
        limits: { maxPathBytes: 4 },
      }),
      "PATH_INVALID"
    );
    await expectZipError(
      readStudioZipArchive(
        buildZipFixture([
          {
            path: "bomb",
            data: new Uint8Array(101),
            compressedData: new Uint8Array(1),
            method: 8,
          },
        ])
      ),
      "ZIP_BOMB"
    );
    await expectZipError(
      readStudioZipArchive(twoEntries, { limits: { maxCentralDirectoryBytes: 1 } }),
      "CENTRAL_DIRECTORY_INVALID"
    );
  });

  it("rejects local/central mismatches, record gaps, trailing data, and multi-disk metadata", async () => {
    const mismatch = buildZipFixture([{ path: "match.txt", data: encoder.encode("ok") }]);
    mismatch[30] = "M".charCodeAt(0);
    await expectZipError(readStudioZipArchive(mismatch), "LOCAL_HEADER_INVALID");

    const gap = buildZipFixture([{ path: "one" }, { path: "two" }]);
    const firstCentral = gap.indexOf(0x50, 40);
    const centralView = new DataView(gap.buffer);
    centralView.setUint32(firstCentral + 42 + 46 + 3, 34, true);
    await expectZipError(readStudioZipArchive(gap), "LOCAL_HEADER_INVALID");

    const trailing = new Uint8Array(buildZipFixture([{ path: "a" }]).byteLength + 1);
    trailing.set(buildZipFixture([{ path: "a" }]));
    await expectZipError(readStudioZipArchive(trailing), "CENTRAL_DIRECTORY_INVALID");

    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "split", diskStart: 1 }])),
      "MULTI_DISK_UNSUPPORTED"
    );
  });

  it("verifies extracted CRC, declared size, adapter result type, and entry lookup", async () => {
    const crcMismatch = buildZipFixture([
      { path: "bad-crc", data: encoder.encode("data"), declaredCrc32: 0 },
    ]);
    const crcArchive = await readStudioZipArchive(crcMismatch);
    await expectZipError(crcArchive.readEntry("bad-crc"), "CRC_MISMATCH");

    const compressed = buildZipFixture([
      {
        path: "size",
        data: encoder.encode("right"),
        compressedData: new Uint8Array([1]),
        method: 8,
      },
    ]);
    const shortArchive = await readStudioZipArchive(compressed, {
      inflateRaw: async () => encoder.encode("no"),
    });
    await expectZipError(shortArchive.readEntry("size"), "DECOMPRESSION_FAILED");

    const wrongTypeArchive = await readStudioZipArchive(compressed, {
      inflateRaw: async () => "wrong" as unknown as Uint8Array,
    });
    await expectZipError(wrongTypeArchive.readEntry("size"), "DECOMPRESSION_FAILED");
    await expectZipError(wrongTypeArchive.readEntry("missing"), "ENTRY_NOT_FOUND");
  });

  it("honors AbortSignal before parsing and extraction", async () => {
    const controller = new AbortController();
    controller.abort();
    await expectZipError(
      readStudioZipArchive(buildZipFixture([{ path: "a" }]), { signal: controller.signal }),
      "ABORTED"
    );

    const archive = await readStudioZipArchive(
      buildZipFixture([{ path: "a", data: encoder.encode("value") }])
    );
    await expectZipError(
      archive.readEntry("a", { signal: controller.signal }),
      "ABORTED"
    );
  });
});
