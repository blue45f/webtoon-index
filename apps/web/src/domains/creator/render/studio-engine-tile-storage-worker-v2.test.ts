import { describe, expect, it, vi } from "vitest";

import {
  canonicalStudioCommandJson,
  studioCommandPayloadChecksum,
  type StudioCommandJsonValue,
} from "../studio-command-journal";

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
} from "./studio-engine-tile-authority";
import {
  STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
  STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND,
  type StudioEngineTileStorageCommitRequest,
} from "./studio-engine-tile-storage-bridge";
import {
  StudioEngineTileStorageWorkerV2,
  StudioEngineTileStorageWorkerV2Error,
  type StudioEngineTileStorageWorkerV2FaultStage,
  type StudioEngineTileStorageWorkerV2Lease,
  type StudioEngineTileStorageWorkerV2LeasePort,
  type StudioEngineTileStorageWorkerV2ShardBackend,
} from "./studio-engine-tile-storage-worker-v2";
import { studioTileDocDigest } from "./studio-tiledoc-digest";

const encoder = new TextEncoder();

function json(value: unknown): StudioCommandJsonValue {
  return value as StudioCommandJsonValue;
}

function bytesChecksum(bytes: Uint8Array): string {
  return `bytes-v1:${studioTileDocDigest(bytes)}`;
}

function request(
  overrides: Readonly<{
    requestSequence?: number;
    transactionSequence?: number;
    expectedDurableRevision?: number;
    commandSequence?: number;
    baseDocumentRevision?: number;
    journalLogicalByteOffset?: bigint;
    tileLogicalByteOffset?: bigint;
    tileBaseRevision?: number;
    fill?: number;
  }> = {},
  shardBytes = BigInt(16),
): StudioEngineTileStorageCommitRequest {
  const requestSequence = overrides.requestSequence ?? 1;
  const transactionSequence = overrides.transactionSequence ?? 1;
  const expectedDurableRevision = overrides.expectedDurableRevision ?? 0;
  const commandSequence = overrides.commandSequence ?? 1;
  const baseDocumentRevision = overrides.baseDocumentRevision ?? 0;
  const documentRevision = baseDocumentRevision + 1;
  const journalLogicalByteOffset =
    overrides.journalLogicalByteOffset ?? BigInt(0);
  const tileLogicalByteOffset =
    overrides.tileLogicalByteOffset ?? BigInt(5);
  const tileBaseRevision = overrides.tileBaseRevision ?? 0;
  const tileRevision = tileBaseRevision + 1;
  const tileValues = new Uint16Array(8);
  tileValues.fill(overrides.fill ?? 0x3c00);
  const tileData = tileValues.buffer.slice(0);
  const tileDigest = studioEngineRgba16FloatTileDigest(tileData);
  const commandIdentity = `command:${commandSequence}`;
  const layerId = "ink";
  const journalBody = {
    sequence: transactionSequence,
    documentId: "future-doc",
    commandIdentity,
    commandSequence,
    baseDocumentRevision,
    documentRevision,
    layerId,
    baseLayerRevision: baseDocumentRevision,
    layerRevision: documentRevision,
    deltas: [{
      index: 0,
      tileId: "tile:0",
      contentDigest: tileDigest,
    }],
  };
  const recordDigest = studioCommandPayloadChecksum(json(journalBody));
  const journalText = canonicalStudioCommandJson({
    ...journalBody,
    recordDigest,
  });
  const journalData = encoder.encode(journalText);
  const journalPayloadChecksum = bytesChecksum(journalData);
  const tile = {
    index: 0,
    tileId: "tile:0",
    column: 0,
    row: 0,
    layerId,
    layerIndex: 0,
    logicalTileIndex: BigInt(0),
    logicalByteOffset: tileLogicalByteOffset,
    shardIndex: tileLogicalByteOffset / shardBytes,
    shardByteOffset: tileLogicalByteOffset % shardBytes,
    baseTileRevision: tileBaseRevision,
    tileRevision,
    byteLength: tileData.byteLength,
    contentDigest: tileDigest,
    payloadChecksum: tileDigest,
    data: tileData,
  };
  const identityChecksum = studioCommandPayloadChecksum({
    authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    documentId: "future-doc",
    commandIdentity,
    commandSequence,
    baseDocumentRevision,
    documentRevision,
    layerId,
    baseLayerRevision: baseDocumentRevision,
    layerRevision: documentRevision,
    transactionSequence,
    journal: {
      logicalByteOffset: journalLogicalByteOffset.toString(),
      byteLength: journalData.byteLength,
      recordDigest,
      payloadChecksum: journalPayloadChecksum,
    },
    tiles: [{
      index: 0,
      tileId: tile.tileId,
      layerId,
      logicalTileIndex: tile.logicalTileIndex.toString(),
      logicalByteOffset: tile.logicalByteOffset.toString(),
      shardIndex: tile.shardIndex.toString(),
      shardByteOffset: tile.shardByteOffset.toString(),
      tileRevision,
      byteLength: tile.byteLength,
      contentDigest: tile.contentDigest,
    }],
  });
  return {
    kind: STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND,
    version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
    authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    requestSequence,
    sessionEpoch: 7,
    transactionSequence,
    transactionIdentity: `studio-engine-storage-v2:${identityChecksum}`,
    expectedDurableRevision,
    documentId: "future-doc",
    commandIdentity,
    commandSequence,
    baseDocumentRevision,
    documentRevision,
    writeCount: 2,
    totalPayloadBytes: BigInt(journalData.byteLength + tileData.byteLength),
    journal: {
      sequence: transactionSequence,
      logicalByteOffset: journalLogicalByteOffset,
      byteLength: journalData.byteLength,
      recordDigest,
      payloadChecksum: journalPayloadChecksum,
      data: journalData.buffer.slice(
        journalData.byteOffset,
        journalData.byteOffset + journalData.byteLength,
      ),
    },
    tiles: [tile],
  };
}

type FileName = "document" | "wal" | "markers";

class MemoryShardBackend
implements StudioEngineTileStorageWorkerV2ShardBackend {
  public readonly kind = "memory-sync-shards" as const;
  public readonly shardBytes: bigint;
  public readonly events: string[] = [];
  public readonly writes: Array<{
    readonly file: FileName;
    readonly shardIndex: bigint;
    readonly shardByteOffset: number;
    readonly byteLength: number;
  }> = [];

  #volatile = new Map<string, Uint8Array>();
  #durable = new Map<string, Uint8Array>();
  #volatileLengths = new Map<FileName, bigint>();
  #durableLengths = new Map<FileName, bigint>();

  public constructor(shardBytes = BigInt(16)) {
    this.shardBytes = shardBytes;
    for (const file of ["document", "wal", "markers"] as const) {
      this.#volatileLengths.set(file, BigInt(0));
      this.#durableLengths.set(file, BigInt(0));
    }
  }

  public logicalByteLength(file: FileName): bigint {
    return this.#volatileLengths.get(file) ?? BigInt(0);
  }

  public read(
    file: FileName,
    shardIndex: bigint,
    shardByteOffset: number,
    byteLength: number,
    signal: AbortSignal,
  ): Uint8Array {
    if (signal.aborted) throw signal.reason;
    const globalOffset =
      shardIndex * this.shardBytes + BigInt(shardByteOffset);
    if (
      globalOffset + BigInt(byteLength)
      > (this.#volatileLengths.get(file) ?? BigInt(0))
    ) {
      throw new Error("short read");
    }
    const source = this.#volatile.get(this.#key(file, shardIndex));
    const output = new Uint8Array(byteLength);
    if (source) {
      output.set(
        source.subarray(shardByteOffset, shardByteOffset + byteLength),
      );
    }
    return output;
  }

  public write(
    file: FileName,
    shardIndex: bigint,
    shardByteOffset: number,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): void {
    if (signal.aborted) throw signal.reason;
    if (
      !Number.isSafeInteger(shardByteOffset)
      || shardByteOffset < 0
      || BigInt(shardByteOffset + bytes.byteLength) > this.shardBytes
    ) {
      throw new Error("unsafe local offset");
    }
    const key = this.#key(file, shardIndex);
    const required = shardByteOffset + bytes.byteLength;
    const previous = this.#volatile.get(key);
    const next = new Uint8Array(Math.max(previous?.byteLength ?? 0, required));
    if (previous) next.set(previous);
    next.set(bytes, shardByteOffset);
    this.#volatile.set(key, next);
    const end =
      shardIndex * this.shardBytes
      + BigInt(shardByteOffset)
      + BigInt(bytes.byteLength);
    const previousLength = this.#volatileLengths.get(file) ?? BigInt(0);
    if (end > previousLength) this.#volatileLengths.set(file, end);
    this.events.push(`write:${file}`);
    this.writes.push({
      file,
      shardIndex,
      shardByteOffset,
      byteLength: bytes.byteLength,
    });
  }

  public flush(file: FileName, signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason;
    for (const key of [...this.#durable.keys()]) {
      if (key.startsWith(`${file}:`)) this.#durable.delete(key);
    }
    for (const [key, bytes] of this.#volatile) {
      if (key.startsWith(`${file}:`)) {
        this.#durable.set(key, Uint8Array.from(bytes));
      }
    }
    this.#durableLengths.set(
      file,
      this.#volatileLengths.get(file) ?? BigInt(0),
    );
    this.events.push(`flush:${file}`);
  }

  public truncate(
    file: FileName,
    logicalByteLength: bigint,
    signal: AbortSignal,
  ): void {
    if (signal.aborted) throw signal.reason;
    const finalShard = logicalByteLength === BigInt(0)
      ? null
      : (logicalByteLength - BigInt(1)) / this.shardBytes;
    for (const key of [...this.#volatile.keys()]) {
      if (!key.startsWith(`${file}:`)) continue;
      const shardIndex = BigInt(key.slice(file.length + 1));
      if (finalShard === null || shardIndex > finalShard) {
        this.#volatile.delete(key);
      }
    }
    if (finalShard !== null) {
      const key = this.#key(file, finalShard);
      const bytes = this.#volatile.get(key);
      const localLength = Number(
        ((logicalByteLength - BigInt(1)) % this.shardBytes) + BigInt(1),
      );
      if (bytes && bytes.byteLength > localLength) {
        this.#volatile.set(key, bytes.slice(0, localLength));
      }
    }
    this.#volatileLengths.set(file, logicalByteLength);
    this.events.push(`truncate:${file}`);
  }

  public crash(): void {
    this.#volatile = this.#clone(this.#durable);
    this.#volatileLengths = new Map(this.#durableLengths);
    this.events.push("crash");
  }

  public truncateDurable(file: FileName, byteLength: bigint): void {
    this.#durableLengths.set(file, byteLength);
    const finalShard = byteLength === BigInt(0)
      ? null
      : (byteLength - BigInt(1)) / this.shardBytes;
    for (const key of [...this.#durable.keys()]) {
      if (!key.startsWith(`${file}:`)) continue;
      const shardIndex = BigInt(key.slice(file.length + 1));
      if (finalShard === null || shardIndex > finalShard) {
        this.#durable.delete(key);
      }
    }
    if (finalShard !== null) {
      const key = this.#key(file, finalShard);
      const bytes = this.#durable.get(key);
      const localLength = Number(
        ((byteLength - BigInt(1)) % this.shardBytes) + BigInt(1),
      );
      if (bytes && bytes.byteLength > localLength) {
        this.#durable.set(key, bytes.slice(0, localLength));
      }
    }
  }

  public durableLength(file: FileName): bigint {
    return this.#durableLengths.get(file) ?? BigInt(0);
  }

  public readDocument(globalByteOffset: bigint, byteLength: number): Uint8Array {
    const output = new Uint8Array(byteLength);
    const readSignal = new AbortController().signal;
    let completed = 0;
    while (completed < byteLength) {
      const offset = globalByteOffset + BigInt(completed);
      const shardIndex = offset / this.shardBytes;
      const shardByteOffset = Number(offset % this.shardBytes);
      const span = Math.min(
        byteLength - completed,
        Number(this.shardBytes) - shardByteOffset,
      );
      output.set(
        this.read(
          "document",
          shardIndex,
          shardByteOffset,
          span,
          readSignal,
        ),
        completed,
      );
      completed += span;
    }
    return output;
  }

  #key(file: FileName, shardIndex: bigint): string {
    return `${file}:${shardIndex.toString()}`;
  }

  #clone(source: Map<string, Uint8Array>): Map<string, Uint8Array> {
    return new Map(
      [...source].map(([key, bytes]) => [key, Uint8Array.from(bytes)]),
    );
  }
}

class LeasePort implements StudioEngineTileStorageWorkerV2LeasePort {
  #lease: StudioEngineTileStorageWorkerV2Lease | null = null;
  #sequence = 0;

  public acquire(input: {
    readonly documentId: string;
    readonly ownerId: string;
    readonly leaseEpoch: number;
  }): StudioEngineTileStorageWorkerV2Lease {
    if (this.#lease) throw new Error("lease held");
    this.#sequence += 1;
    this.#lease = Object.freeze({
      documentId: input.documentId,
      ownerId: input.ownerId,
      leaseEpoch: input.leaseEpoch,
      token: `lease:${this.#sequence}`,
    });
    return this.#lease;
  }

  public assert(lease: StudioEngineTileStorageWorkerV2Lease): void {
    if (lease !== this.#lease) throw new Error("lease lost");
  }

  public release(lease: StudioEngineTileStorageWorkerV2Lease): void {
    if (lease === this.#lease) this.#lease = null;
  }

  public crash(): void {
    this.#lease = null;
  }
}

function worker(
  backend: MemoryShardBackend,
  leasePort: LeasePort,
  faultStage?: StudioEngineTileStorageWorkerV2FaultStage,
  ownerId = "owner:1",
): StudioEngineTileStorageWorkerV2 {
  let fired = false;
  return new StudioEngineTileStorageWorkerV2({
    documentId: "future-doc",
    ownerId,
    sessionEpoch: 7,
    leaseEpoch: 11,
    backend,
    leasePort,
    windowBytes: 5,
    faultInjector: faultStage
      ? (point) => {
          if (!fired && point.stage === faultStage) {
            fired = true;
            throw new Error(`crash:${faultStage}`);
          }
        }
      : undefined,
  });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("StudioEngineTileStorageWorkerV2", () => {
  it("orders WAL flush, full tile writes, marker, document flush, marker flush, then ACK", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const commit = request({}, backend.shardBytes);

    const ack = await runtime.commit(commit, { signal: signal() });

    expect(ack).toMatchObject({
      disposition: "committed",
      complete: true,
      durableRevision: 1,
      transactionIdentity: commit.transactionIdentity,
    });
    const walFlush = backend.events.indexOf("flush:wal");
    const firstDocumentWrite = backend.events.indexOf("write:document");
    const markerWrite = backend.events.indexOf("write:markers");
    const documentFlush = backend.events.indexOf("flush:document");
    const markerFlush = backend.events.indexOf("flush:markers");
    expect(walFlush).toBeGreaterThan(-1);
    expect(walFlush).toBeLessThan(firstDocumentWrite);
    expect(firstDocumentWrite).toBeLessThan(markerWrite);
    expect(markerWrite).toBeLessThan(documentFlush);
    expect(documentFlush).toBeLessThan(markerFlush);
    expect(runtime.frontier()).toMatchObject({
      durableRevision: 1,
      documentRevision: 1,
      commandSequence: 1,
      transactionSequence: 1,
    });
    expect(Object.isFrozen(ack)).toBe(true);
  });

  it("splits offsets above Number.MAX_SAFE_INTEGER before Number conversion", async () => {
    const backend = new MemoryShardBackend(BigInt(16));
    const runtime = worker(backend, new LeasePort());
    const logicalOffset = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(37);
    const commit = request(
      { tileLogicalByteOffset: logicalOffset },
      backend.shardBytes,
    );

    await runtime.commit(commit, { signal: signal() });

    const writes = backend.writes.filter((entry) => entry.file === "document");
    expect(writes.length).toBeGreaterThan(1);
    expect(writes[0]!.shardIndex).toBe(logicalOffset / backend.shardBytes);
    expect(writes.every((entry) =>
      Number.isSafeInteger(entry.shardByteOffset)
      && entry.shardByteOffset >= 0
      && BigInt(entry.shardByteOffset + entry.byteLength)
        <= backend.shardBytes
    )).toBe(true);
  });

  it("returns an exact idempotent replay ACK without another storage write", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const first = request({}, backend.shardBytes);
    await runtime.commit(first, { signal: signal() });
    const writes = backend.writes.length;
    const replay = { ...first, requestSequence: 2 };

    const ack = await runtime.commit(replay, { signal: signal() });

    expect(ack.disposition).toBe("idempotent-replay");
    expect(ack.requestSequence).toBe(2);
    expect(backend.writes).toHaveLength(writes);
  });

  it("fails closed when a durable transaction sequence has another identity", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    await runtime.commit(request({}, backend.shardBytes), { signal: signal() });
    const conflict = request({ fill: 0x4000 }, backend.shardBytes);

    await expect(
      runtime.commit(conflict, { signal: signal() }),
    ).rejects.toMatchObject({
      code: "identity-conflict",
    } satisfies Partial<StudioEngineTileStorageWorkerV2Error>);
  });

  it("rejects replay metadata that is outside the canonical transaction identity", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const committed = request({}, backend.shardBytes);
    await runtime.commit(committed, { signal: signal() });

    await expect(
      runtime.commit({
        ...committed,
        requestSequence: 2,
        expectedDurableRevision: 99,
      }, { signal: signal() }),
    ).rejects.toMatchObject({ code: "identity-conflict" });
  });

  it("rejects a sequence gap without poisoning the valid next commit", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const gap = request({
      transactionSequence: 2,
      commandSequence: 2,
      baseDocumentRevision: 1,
    }, backend.shardBytes);

    await expect(
      runtime.commit(gap, { signal: signal() }),
    ).rejects.toMatchObject({ code: "sequence-conflict" });
    await expect(
      runtime.commit(request({}, backend.shardBytes), { signal: signal() }),
    ).resolves.toMatchObject({ durableRevision: 1 });
  });

  it("advances the durable frontier monotonically across transactions", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const first = request({}, backend.shardBytes);
    await runtime.commit(first, { signal: signal() });
    const second = request({
      requestSequence: 2,
      transactionSequence: 2,
      expectedDurableRevision: 1,
      commandSequence: 2,
      baseDocumentRevision: 1,
      journalLogicalByteOffset: BigInt(first.journal.byteLength),
      tileBaseRevision: 1,
      fill: 0x4200,
    }, backend.shardBytes);

    const ack = await runtime.commit(second, { signal: signal() });

    expect(ack.durableRevision).toBe(2);
    expect(runtime.frontier()).toMatchObject({
      durableRevision: 2,
      transactionSequence: 2,
      commandSequence: 2,
      documentRevision: 2,
    });
  });

  it("enforces one exclusive document lease", async () => {
    const backend = new MemoryShardBackend();
    const leases = new LeasePort();
    const first = worker(backend, leases);
    const second = worker(backend, leases, undefined, "owner:2");
    await first.open();

    await expect(second.open()).rejects.toMatchObject({
      code: "lease-lost",
    });
  });

  it("fails closed when the document lease is lost before commit", async () => {
    const backend = new MemoryShardBackend();
    const leases = new LeasePort();
    const runtime = worker(backend, leases);
    await runtime.open();
    leases.crash();

    await expect(
      runtime.commit(request({}, backend.shardBytes), { signal: signal() }),
    ).rejects.toMatchObject({ code: "lease-lost" });
  });

  it("honors an already-aborted commit without writing", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const controller = new AbortController();
    controller.abort(new Error("cancel"));

    await expect(
      runtime.commit(request({}, backend.shardBytes), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(backend.writes).toHaveLength(0);
  });

  it("disposes the lease and permanently rejects later work", async () => {
    const backend = new MemoryShardBackend();
    const leases = new LeasePort();
    const runtime = worker(backend, leases);
    await runtime.open();
    await runtime.dispose();

    await expect(runtime.open()).rejects.toMatchObject({ code: "disposed" });
    await expect(
      runtime.commit(request({}, backend.shardBytes), { signal: signal() }),
    ).rejects.toMatchObject({ code: "disposed" });
  });

  it("does not expose a transaction whose WAL never flushed", async () => {
    const backend = new MemoryShardBackend();
    const leases = new LeasePort();
    const crashing = worker(backend, leases, "after-wal-write");
    await expect(
      crashing.commit(request({}, backend.shardBytes), { signal: signal() }),
    ).rejects.toThrow("crash:after-wal-write");
    backend.crash();
    leases.crash();

    const restarted = worker(backend, leases, undefined, "owner:restart");
    const recovery = await restarted.open();

    expect(recovery).toMatchObject({
      status: "ready",
      recoveredTransactions: 0,
      frontier: { durableRevision: 0 },
    });
  });

  it.each([
    "after-wal-flush",
    "after-tile-write",
    "after-marker-write",
    "after-document-flush",
    "after-marker-flush",
    "before-ack",
  ] as const)(
    "recovers the exact transaction after a crash at %s",
    async (stage) => {
      const backend = new MemoryShardBackend();
      const leases = new LeasePort();
      const commit = request({}, backend.shardBytes);
      const crashing = worker(backend, leases, stage);
      await expect(
        crashing.commit(commit, { signal: signal() }),
      ).rejects.toThrow(`crash:${stage}`);
      backend.crash();
      leases.crash();

      const restarted = worker(backend, leases, undefined, "owner:restart");
      const recovery = await restarted.open();
      const replay = await restarted.commit(
        { ...commit, requestSequence: 2 },
        { signal: signal() },
      );

      expect(recovery.status).toBe("ready");
      expect(recovery.frontier.durableRevision).toBe(1);
      expect(replay).toMatchObject({
        disposition: "idempotent-replay",
        requestSequence: 2,
        durableRevision: 1,
      });
      expect([
        ...backend.readDocument(
          commit.tiles[0]!.logicalByteOffset,
          commit.tiles[0]!.byteLength,
        ),
      ]).toEqual([...new Uint8Array(commit.tiles[0]!.data)]);
    },
  );

  it("reports retry-required for a torn durable WAL without partial authority", async () => {
    const backend = new MemoryShardBackend();
    const leases = new LeasePort();
    const crashing = worker(backend, leases, "after-wal-flush");
    await expect(
      crashing.commit(request({}, backend.shardBytes), { signal: signal() }),
    ).rejects.toThrow("crash:after-wal-flush");
    const walLength = backend.durableLength("wal");
    backend.truncateDurable("wal", walLength - BigInt(1));
    backend.crash();
    leases.crash();

    const restarted = worker(backend, leases, undefined, "owner:restart");
    const recovery = await restarted.open();

    expect(recovery).toMatchObject({
      status: "retry-required",
      reason: "torn-wal",
      frontier: { durableRevision: 0 },
    });
    expect(backend.durableLength("document")).toBe(BigInt(0));
  });

  it("rejects payload tampering before the WAL boundary", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const valid = request({}, backend.shardBytes);
    const tamperedData = valid.tiles[0]!.data.slice(0);
    new Uint8Array(tamperedData)[0] ^= 0xff;
    const tampered = {
      ...valid,
      tiles: [{ ...valid.tiles[0]!, data: tamperedData }],
    };

    await expect(
      runtime.commit(tampered, { signal: signal() }),
    ).rejects.toMatchObject({ code: "invalid-payload" });
    expect(backend.writes).toHaveLength(0);
  });

  it("serializes concurrent commits and preserves exact frontier order", async () => {
    const backend = new MemoryShardBackend();
    const runtime = worker(backend, new LeasePort());
    const first = request({}, backend.shardBytes);
    const second = request({
      requestSequence: 2,
      transactionSequence: 2,
      expectedDurableRevision: 1,
      commandSequence: 2,
      baseDocumentRevision: 1,
      journalLogicalByteOffset: BigInt(first.journal.byteLength),
      tileBaseRevision: 1,
      fill: 0x4200,
    }, backend.shardBytes);

    const [firstAck, secondAck] = await Promise.all([
      runtime.commit(first, { signal: signal() }),
      runtime.commit(second, { signal: signal() }),
    ]);

    expect([firstAck.durableRevision, secondAck.durableRevision]).toEqual([1, 2]);
    expect(runtime.frontier().durableRevision).toBe(2);
  });

  it("calls the fault hook at every durable boundary in documented order", async () => {
    const backend = new MemoryShardBackend();
    const stages: StudioEngineTileStorageWorkerV2FaultStage[] = [];
    const runtime = new StudioEngineTileStorageWorkerV2({
      documentId: "future-doc",
      ownerId: "owner:events",
      sessionEpoch: 7,
      leaseEpoch: 11,
      backend,
      leasePort: new LeasePort(),
      faultInjector(point) {
        stages.push(point.stage);
      },
    });

    await runtime.commit(request({}, backend.shardBytes), { signal: signal() });

    expect(stages).toEqual([
      "after-wal-write",
      "after-wal-flush",
      "after-tile-write",
      "after-marker-write",
      "after-document-flush",
      "after-marker-flush",
      "before-ack",
    ]);
  });

  it("does not narrow a huge logical document offset in the backend API", async () => {
    const backend = new MemoryShardBackend(BigInt(64));
    const write = vi.spyOn(backend, "write");
    const runtime = worker(backend, new LeasePort());
    const offset = (BigInt(1) << BigInt(60)) + BigInt(11);

    await runtime.commit(
      request({ tileLogicalByteOffset: offset }, backend.shardBytes),
      { signal: signal() },
    );

    const documentCalls = write.mock.calls.filter(([file]) => file === "document");
    expect(documentCalls[0]![1]).toBe(offset / backend.shardBytes);
    expect(documentCalls[0]![2]).toBe(Number(offset % backend.shardBytes));
  });
});
