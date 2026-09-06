import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  openStudioLocalDatabase,
  type StudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "../studio-local-database";
import { createStudioOpfsAssetStore } from "../studio-opfs-asset-store";
import { createStudioOpfsMemoryFileSystem } from "../studio-opfs-filesystem";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
} from "./studio-bg3d-capture-adapter";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
  STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
  createStudioBg3dShotBatchPlan,
  type StudioBg3dShotBatchPlan,
} from "./studio-bg3d-shot-batch-plan";
import {
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_DATABASE_NAME,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_DATABASE_VERSION,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_DOWNLOAD_TTL_MS,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_MAX_JOBS,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_CAS_OWNER_PREFIX,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_CATALOG_KEY,
  STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_NAMESPACE,
  StudioBg3dShotBatchRecoveryError,
  createStudioBg3dShotBatchRecoveryStore,
  type StudioBg3dShotBatchRecoveryAuthorizationReceipt,
  type StudioBg3dShotBatchRecoveryRunExclusive,
} from "./studio-bg3d-shot-batch-recovery-store";

let fixtureSequence = 0;

async function forgeStoredJob(
  factory: IDBFactory,
  recoveryKey: string,
  mutate: (job: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_DATABASE_NAME,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_DATABASE_VERSION,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const transaction = database.transaction(["jobs"], "readwrite");
    const store = transaction.objectStore("jobs");
    const raw = await new Promise<unknown>((resolve, reject) => {
      const request = store.get(recoveryKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("stored recovery job fixture unavailable");
    }
    store.put(mutate(raw as Record<string, unknown>));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function readStoredRecord(
  factory: IDBFactory,
  storeName: "jobs" | "artifacts" | "leases" | "meta",
  key: IDBValidKey,
): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_DATABASE_NAME,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_DATABASE_VERSION,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const transaction = database.transaction([storeName], "readonly");
    const request = transaction.objectStore(storeName).get(key);
    return await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function delegatedFactory(
  backing: IDBFactory,
  shouldFailOpen: () => boolean,
): IDBFactory {
  return {
    cmp: backing.cmp.bind(backing),
    deleteDatabase: backing.deleteDatabase.bind(backing),
    open(name: string, version?: number) {
      if (shouldFailOpen()) throw new DOMException("transient IndexedDB failure", "UnknownError");
      return version === undefined ? backing.open(name) : backing.open(name, version);
    },
  } as IDBFactory;
}

const TEST_PNG_CRC_TABLE = (() => {
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

function testPngCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (TEST_PNG_CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function testPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, testPngCrc32(chunk.subarray(4, 8 + data.byteLength)), false);
  return chunk;
}

function testStoredDeflate(bytes: Uint8Array): Uint8Array {
  const blocks = Math.ceil(bytes.byteLength / 65_535);
  const result = new Uint8Array(2 + blocks * 5 + bytes.byteLength + 4);
  result.set([0x78, 0x01]);
  let sourceOffset = 0;
  let targetOffset = 2;
  for (let block = 0; block < blocks; block += 1) {
    const length = Math.min(65_535, bytes.byteLength - sourceOffset);
    const final = block === blocks - 1;
    result[targetOffset] = final ? 1 : 0;
    result[targetOffset + 1] = length & 0xff;
    result[targetOffset + 2] = length >>> 8;
    result[targetOffset + 3] = ~length & 0xff;
    result[targetOffset + 4] = (~length >>> 8) & 0xff;
    result.set(bytes.subarray(sourceOffset, sourceOffset + length), targetOffset + 5);
    sourceOffset += length;
    targetOffset += 5 + length;
  }
  let adlerA = 1;
  let adlerB = 0;
  for (const byte of bytes) {
    adlerA = (adlerA + byte) % 65_521;
    adlerB = (adlerB + adlerA) % 65_521;
  }
  new DataView(result.buffer).setUint32(targetOffset, (adlerB << 16) | adlerA, false);
  return result;
}

const VALID_RGBA8_PNGS = new Map<string, ArrayBuffer>();

function validRgba8Png(width: number, height: number): ArrayBuffer {
  const cacheKey = `${width}x${height}`;
  const cached = VALID_RGBA8_PNGS.get(cacheKey);
  if (cached) return cached.slice(0);
  const scanlines = new Uint8Array((width * 4 + 1) * height);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunks = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    testPngChunk("IHDR", ihdr),
    testPngChunk("IDAT", testStoredDeflate(scanlines)),
    testPngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.byteLength;
  }
  VALID_RGBA8_PNGS.set(cacheKey, png.buffer);
  return png.buffer.slice(0);
}

async function fixture(
  durability: "durable" | "memory",
): Promise<{ readonly plan: StudioBg3dShotBatchPlan; readonly sourceRevision: string }> {
  fixtureSequence += 1;
  const shot = { id: `shot-${fixtureSequence}`, name: `컷 ${fixtureSequence}` };
  const sourceRevision = serializeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    output: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output, exportHeight: 360 },
    shots: [shot],
  });
  if (!sourceRevision) throw new Error("canonical recovery test scene unavailable");
  const result = await createStudioBg3dShotBatchPlan([shot], {
    sourceRevision,
    scope: {
      durability,
      authUserId: durability === "durable" ? "user-a" : `memory-user-${fixtureSequence}`,
      workId: `work-${fixtureSequence}`,
      pageId: `page-${fixtureSequence}`,
      elementId: `element-${fixtureSequence}`,
    },
    capture: {
      owner: {
        backend: "three-webgl",
        engineId: "three",
        engineRevision: "184",
        implementationRevision: STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
        graphicsApi: "webgl2",
        profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
        sourceWidth: 640,
        sourceHeight: 360,
        maxPixels: 1_000_000,
        maxEdge: 4_096,
        deviceProfile: "desktop",
        textureScale: 1,
        lodBias: 0,
        ltPipelineId: STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
        pngEncodingId: STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
        psdEncodingId: STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
      },
      shots: [{
        shotId: shot.id,
        width: 640,
        height: 360,
        requestedHeight: 360,
        wasReduced: false,
        includeDepth: false,
        shadows: true,
        shadowMapSize: 1_024,
        background: { color: "#ffffff", alpha: 1 },
      }],
    },
    passes: ["beauty"],
  });
  if (!result.ok) throw new Error(result.message);
  return { plan: result.plan, sourceRevision };
}

function artifacts(plan: StudioBg3dShotBatchPlan) {
  const shot = plan.shots[0]!;
  return {
    images: [{
      shotId: shot.shotId,
      shotName: shot.shotName,
      width: shot.capture.width,
      height: shot.capture.height,
      pass: "beauty" as const,
      requestedHeight: shot.capture.requestedHeight,
      wasReduced: shot.capture.wasReduced,
      png: new Blob([validRgba8Png(shot.capture.width, shot.capture.height)], {
        type: "image/png",
      }),
    }],
    skippedArtifacts: [],
    layeredPsds: [],
    psdFallbacks: [],
  };
}

function skippedArtifacts(plan: StudioBg3dShotBatchPlan) {
  const shot = plan.shots[0]!;
  return {
    images: [],
    skippedArtifacts: [{
      shotId: shot.shotId,
      shotName: shot.shotName,
      pass: "beauty" as const,
      reason: "disabled" as const,
    }],
    layeredPsds: [],
    psdFallbacks: [],
  };
}

describe("Studio BG3D durable shot-batch recovery", () => {
  it("uses Web Crypto entropy when randomUUID is unavailable", async () => {
    const { plan, sourceRevision } = await fixture("memory");
    const originalCrypto = globalThis.crypto;
    const mathRandom = vi.spyOn(Math, "random");
    let invocation = 0;
    const getRandomValues = vi.fn((target: Uint8Array) => {
      invocation += 1;
      target.fill(invocation);
      return target;
    });
    vi.stubGlobal("crypto", {
      subtle: originalCrypto.subtle,
      getRandomValues,
    });

    try {
      const store = createStudioBg3dShotBatchRecoveryStore({
        indexedDB: null,
        heartbeat: false,
        storageManager: null,
      });
      const session = await store.acquire(plan, sourceRevision);
      const run = await store.startShot(session, plan.shots[0]!.shotId);

      expect(session.ownerId).toBe(`bg3d-batch-owner-${"01".repeat(16)}`);
      expect(session.leaseToken).toBe(`bg3d-batch-memory-lease-${"02".repeat(16)}`);
      expect(run.runId).toBe(`bg3d-batch-run-${"03".repeat(16)}`);
      expect(session.ownerId).not.toBe(session.leaseToken);
      expect(getRandomValues).toHaveBeenCalledTimes(3);
      expect(mathRandom).not.toHaveBeenCalled();
      await store.release(session);
    } finally {
      vi.unstubAllGlobals();
      mathRandom.mockRestore();
    }
  });

  it("fails closed with a typed error when Web Crypto entropy is incomplete", () => {
    vi.stubGlobal("crypto", {} as Crypto);

    try {
      let cause: unknown;
      try {
        createStudioBg3dShotBatchRecoveryStore({
          indexedDB: null,
          heartbeat: false,
          storageManager: null,
        });
      } catch (error) {
        cause = error;
      }

      expect(cause).toBeInstanceOf(StudioBg3dShotBatchRecoveryError);
      expect(cause).toMatchObject({ code: "storage-unavailable" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps an active same-tab memory session valid beyond the 30 second lease window", async () => {
    const { plan, sourceRevision } = await fixture("memory");
    let now = 10_000;
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: null,
      ownerId: "memory-owner-a",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    now += STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS * 3;

    await expect(store.completeShot(session, token, artifacts(plan))).resolves.toBeUndefined();
    expect(session.mode).toBe("memory");
    expect(session.queue.items[0]?.status).toBe("succeeded");
    expect(session.images).toHaveLength(1);
    await store.release(session);

    const resumed = await store.acquire(plan, sourceRevision);
    expect(resumed.images).toHaveLength(1);
    expect(resumed.queue.items[0]?.status).toBe("succeeded");
    await store.release(resumed);
  });

  it("heartbeats an active memory owner so another same-tab editor cannot take it over", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
    try {
      const { plan, sourceRevision } = await fixture("memory");
      const storeA = createStudioBg3dShotBatchRecoveryStore({
        indexedDB: null,
        ownerId: "memory-heartbeat-a",
        now: Date.now,
        heartbeat: true,
        storageManager: null,
      });
      const storeB = createStudioBg3dShotBatchRecoveryStore({
        indexedDB: null,
        ownerId: "memory-heartbeat-b",
        now: Date.now,
        heartbeat: false,
        storageManager: null,
      });
      const active = await storeA.acquire(plan, sourceRevision);

      await vi.advanceTimersByTimeAsync(STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS * 3);

      await expect(storeB.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "busy" });
      await storeA.release(active);
      const takeover = await storeB.acquire(plan, sourceRevision);
      await storeB.release(takeover);
    } finally {
      vi.useRealTimers();
    }
  });

  it("atomically persists a verified shot and rehydrates it in a fresh store instance", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const firstStore = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "durable-owner-a",
      heartbeat: false,
      storageManager: null,
    });
    const first = await firstStore.acquire(plan, sourceRevision);
    const token = await firstStore.startShot(first, plan.shots[0]!.shotId);
    await firstStore.completeShot(first, token, artifacts(plan));
    await firstStore.release(first);

    const secondStore = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "durable-owner-b",
      heartbeat: false,
      storageManager: null,
    });
    const restored = await secondStore.acquire(plan, sourceRevision);
    expect(restored.mode).toBe("durable");
    expect(restored.queue.items[0]?.status).toBe("succeeded");
    expect(restored.images).toHaveLength(1);
    expect(restored.totalArtifactBytes).toBe(validRgba8Png(640, 360).byteLength);
    await secondStore.release(restored);
  });

  it("timestamps the lease after a long artifact add so commit cannot publish an expired owner", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const baseline = 200_000;
    let simulateLongCommit = false;
    let commitClockReads = 0;
    const now = () => {
      if (!simulateLongCommit) return baseline;
      commitClockReads += 1;
      return commitClockReads <= 2
        ? baseline
        : baseline + STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS * 2;
    };
    const writer = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "slow-blob-writer",
      now,
      heartbeat: false,
      storageManager: null,
    });
    const contender = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "post-commit-contender",
      now,
      heartbeat: false,
      storageManager: null,
    });
    const session = await writer.acquire(plan, sourceRevision);
    const token = await writer.startShot(session, plan.shots[0]!.shotId);
    simulateLongCommit = true;

    await writer.completeShot(session, token, artifacts(plan));

    await expect(contender.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "busy" });
    await writer.release(session);
    const restored = await contender.acquire(plan, sourceRevision);
    expect(restored.images).toHaveLength(1);
    expect(restored.totalArtifactBytes).toBe(validRgba8Png(640, 360).byteLength);
    await contender.release(restored);
  });

  it("rejects a forged job ledger instead of rebuilding quota usage from declared totals", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const writer = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "ledger-writer",
      heartbeat: false,
      storageManager: null,
    });
    const session = await writer.acquire(plan, sourceRevision);
    const token = await writer.startShot(session, plan.shots[0]!.shotId);
    await writer.completeShot(session, token, artifacts(plan));
    await writer.release(session);
    await forgeStoredJob(database, plan.resumeKey, (job) => ({
      ...job,
      totalArtifactBytes: 0,
      artifactCount: 0,
    }));

    const reader = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "ledger-reader",
      heartbeat: false,
      storageManager: null,
    });
    await expect(reader.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("allows one owner, fences an expiry takeover, and rejects the stale writer", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    let now = 50_000;
    const storeA = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "tab-a",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const storeB = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "tab-b",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const sessionA = await storeA.acquire(plan, sourceRevision);
    const staleToken = await storeA.startShot(sessionA, plan.shots[0]!.shotId);
    await expect(storeB.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "busy" });

    now += STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS + 1;
    const sessionB = await storeB.acquire(plan, sourceRevision);
    expect(sessionB.fence).toBeGreaterThan(sessionA.fence);
    expect(sessionB.queue.items[0]?.status).toBe("pending");
    await expect(storeA.completeShot(sessionA, staleToken, artifacts(plan)))
      .rejects.toBeInstanceOf(StudioBg3dShotBatchRecoveryError);
    expect(sessionB.images).toHaveLength(0);
    await storeB.release(sessionB);
  });

  it("does not delete a newer memory takeover through a stale discard", async () => {
    const { plan, sourceRevision } = await fixture("memory");
    let now = 100_000;
    const storeA = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: null,
      ownerId: "memory-tab-a",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const storeB = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: null,
      ownerId: "memory-tab-b",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const stale = await storeA.acquire(plan, sourceRevision);
    now += STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS + 1;
    const current = await storeB.acquire(plan, sourceRevision);

    await expect(storeA.discard(stale)).rejects.toMatchObject({ code: "lease-lost" });
    await storeB.release(current);
    const recovered = await storeB.acquire(plan, sourceRevision);
    expect(recovered.queue.items[0]?.status).toBe("pending");
    await storeB.release(recovered);
  });

  it("retains a download-requested job for 24 hours and then collects job, Blob, and ledger", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    let now = 1_000_000;
    const firstStore = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "download-owner-a",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const completed = await firstStore.acquire(plan, sourceRevision);
    const token = await firstStore.startShot(completed, plan.shots[0]!.shotId);
    await firstStore.completeShot(completed, token, artifacts(plan));
    await firstStore.markDownloadRequested(completed);
    await firstStore.release(completed);

    now += STUDIO_BG3D_SHOT_BATCH_RECOVERY_DOWNLOAD_TTL_MS - 1;
    const beforeExpiry = await createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "download-owner-b",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    }).acquire(plan, sourceRevision);
    expect(beforeExpiry.images).toHaveLength(1);
    await createStudioBg3dShotBatchRecoveryStore({ indexedDB: database }).release(beforeExpiry);

    now += 2;
    const afterExpiryStore = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "download-owner-c",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const afterExpiry = await afterExpiryStore.acquire(plan, sourceRevision);
    expect(afterExpiry.images).toHaveLength(0);
    expect(afterExpiry.totalArtifactBytes).toBe(0);
    expect(afterExpiry.queue.items[0]?.status).toBe("pending");
    await afterExpiryStore.release(afterExpiry);
  });

  it("retries quota admission once, then degrades honestly to same-tab memory", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const estimate = vi.fn(async () => ({ usage: 0, quota: 64 * 1024 * 1024 }));
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "quota-owner",
      heartbeat: false,
      storageManager: { estimate, persist: async () => false },
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    await store.completeShot(session, token, artifacts(plan));

    expect(estimate).toHaveBeenCalledTimes(2);
    expect(session.mode).toBe("memory");
    expect(session.degradedReason).toMatch(/저장 용량/iu);
    expect(session.queue.items[0]?.status).toBe("succeeded");
    await store.release(session);
  });

  it("keeps durable authority when the single post-GC quota retry succeeds", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const estimate = vi.fn()
      .mockResolvedValueOnce({ usage: 0, quota: 64 * 1024 * 1024 })
      .mockResolvedValueOnce({ usage: 0, quota: 2 * 1024 * 1024 * 1024 });
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "quota-retry-owner",
      heartbeat: false,
      storageManager: { estimate, persist: async () => false },
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);

    await store.completeShot(session, token, artifacts(plan));

    expect(estimate).toHaveBeenCalledTimes(2);
    expect(session.mode).toBe("durable");
    expect(session.degradedReason).toBeNull();
    expect(session.queue.items[0]?.status).toBe("succeeded");
    await store.release(session);
  });

  it("fails a durable writer closed on generic storage loss instead of creating a memory split-brain", async () => {
    const backing = new IDBFactory();
    let failOpen = false;
    let now = 3_000_000;
    const { plan, sourceRevision } = await fixture("durable");
    const writer = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: delegatedFactory(backing, () => failOpen),
      ownerId: "ambiguous-storage-writer",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const session = await writer.acquire(plan, sourceRevision);
    const token = await writer.startShot(session, plan.shots[0]!.shotId);
    failOpen = true;

    await expect(writer.completeShot(session, token, artifacts(plan))).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    expect(session.mode).toBe("durable");
    expect(session.released).toBe(true);
    expect(session.images).toHaveLength(0);

    failOpen = false;
    const contender = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: backing,
      ownerId: "ambiguous-storage-contender",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    await expect(contender.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "busy" });
    now += STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS + 1;
    const takeover = await contender.acquire(plan, sourceRevision);
    expect(takeover.mode).toBe("durable");
    expect(takeover.queue.items[0]?.status).toBe("pending");
    expect(takeover.images).toHaveLength(0);
    await expect(writer.completeShot(session, token, artifacts(plan))).rejects.toMatchObject({
      code: "lease-lost",
    });
    await contender.release(takeover);
  });

  it("fails acquisition closed when an IndexedDB open error leaves durable authority ambiguous", async () => {
    const backing = new IDBFactory();
    let failOpen = true;
    const { plan, sourceRevision } = await fixture("durable");
    const unavailable = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: delegatedFactory(backing, () => failOpen),
      ownerId: "ambiguous-acquisition-writer",
      heartbeat: false,
      storageManager: null,
    });

    await expect(unavailable.acquire(plan, sourceRevision)).rejects.toMatchObject({
      code: "storage-unavailable",
    });

    failOpen = false;
    const durable = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: backing,
      ownerId: "ambiguous-acquisition-contender",
      heartbeat: false,
      storageManager: null,
    });
    const session = await durable.acquire(plan, sourceRevision);
    expect(session.mode).toBe("durable");
    await durable.release(session);
  });

  it("releases the exact provisional durable lease when acquire is aborted after lease admission", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const writer = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "abort-seed-writer",
      heartbeat: false,
      storageManager: null,
    });
    const seeded = await writer.acquire(plan, sourceRevision);
    const token = await writer.startShot(seeded, plan.shots[0]!.shotId);
    await writer.completeShot(seeded, token, artifacts(plan));
    await writer.release(seeded);

    let resolvePersistence!: (value: boolean) => void;
    const persistence = new Promise<boolean>((resolve) => {
      resolvePersistence = resolve;
    });
    const controller = new AbortController();
    const reader = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "abort-hydration-reader",
      heartbeat: false,
      storageManager: { estimate: async () => ({}), persist: () => persistence },
    });
    const pending = reader.acquire(plan, sourceRevision, { signal: controller.signal });
    await vi.waitFor(async () => {
      const lease = await readStoredRecord(database, "leases", plan.resumeKey);
      expect(lease).toMatchObject({ ownerId: "abort-hydration-reader" });
    });

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolvePersistence(false);
    expect(await readStoredRecord(database, "leases", plan.resumeKey)).toBeUndefined();

    const contender = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "post-abort-reader",
      heartbeat: false,
      storageManager: null,
    });
    const restored = await contender.acquire(plan, sourceRevision);
    expect(restored.images).toHaveLength(1);
    await contender.release(restored);
  });

  it("runs the async authorization gate after hashing and commits no artifact when it denies", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "authorization-gate-writer",
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    const authorizeBeforeCommit = vi.fn(async () => null);

    await expect(store.completeShot(session, token, artifacts(plan), {
      authorizeBeforeCommit,
    })).rejects.toMatchObject({ code: "access-denied" });
    expect(authorizeBeforeCommit).toHaveBeenCalledOnce();
    expect(session.totalArtifactBytes).toBe(0);
    expect(session.artifactStorageBytes).toBe(0);
    expect(session.images).toHaveLength(0);
    await store.release(session);

    const reader = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "authorization-gate-reader",
      heartbeat: false,
      storageManager: null,
    });
    const restored = await reader.acquire(plan, sourceRevision);
    expect(restored.queue.items[0]?.status).toBe("pending");
    expect(restored.images).toHaveLength(0);
    await reader.release(restored);
  });

  it("fences the final IndexedDB writes with a fresh server receipt and local epoch", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const now = 4_000_000;
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "authorization-receipt-writer",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    let localChecks = 0;

    await expect(store.completeShot(session, token, artifacts(plan), {
      authorizeBeforeCommit: async () => ({
        authorizedAt: now,
        expiresAt: now + STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS,
        isLocallyCurrent: () => {
          localChecks += 1;
          return localChecks < 3;
        },
      }),
    })).rejects.toMatchObject({ code: "access-denied" });
    expect(localChecks).toBe(3);
    expect(session.totalArtifactBytes).toBe(0);
    expect(session.images).toHaveLength(0);
    await store.release(session);

    const reader = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "authorization-receipt-reader",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const restored = await reader.acquire(plan, sourceRevision);
    expect(restored.queue.items[0]?.status).toBe("pending");
    expect(restored.images).toHaveLength(0);
    await reader.release(restored);
  });

  it("rejects an expired authorization receipt before storage mutation", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const now = 5_000_000;
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "expired-authorization-writer",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);

    await expect(store.completeShot(session, token, artifacts(plan), {
      authorizeBeforeCommit: () => ({
        authorizedAt: now - 1_000,
        expiresAt: now,
        isLocallyCurrent: () => true,
      }),
    })).rejects.toMatchObject({ code: "access-denied" });
    expect(session.totalArtifactBytes).toBe(0);
    await store.release(session);
  });

  it("obtains a new authorization receipt for the bounded post-quota retry", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const now = 6_000_000;
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "quota-authorization-writer",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    const originalAdd = FakeIDBObjectStore.prototype.add;
    let rejectFirstArtifactAdd = true;
    const addSpy = vi.spyOn(FakeIDBObjectStore.prototype, "add").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (rejectFirstArtifactAdd &&
        (value as { readonly kind?: unknown })?.kind ===
          "toonspectrum-bg3d-shot-batch-shot-artifacts") {
        rejectFirstArtifactAdd = false;
        throw new DOMException("simulated quota boundary", "QuotaExceededError");
      }
      return key === undefined
        ? originalAdd.call(this, value)
        : originalAdd.call(this, value, key);
    });
    let authorizations = 0;
    try {
      await store.completeShot(session, token, artifacts(plan), {
        authorizeBeforeCommit: () => {
          authorizations += 1;
          return {
            authorizedAt: now,
            expiresAt: now + STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS,
            isLocallyCurrent: () => true,
          };
        },
      });
    } finally {
      addSpy.mockRestore();
    }
    expect(authorizations).toBe(2);
    expect(session.queue.items[0]?.status).toBe("succeeded");
    expect(session.images).toHaveLength(1);
    await store.release(session);
  });

  it("aborts a pending authorization gate without committing artifacts", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "authorization-abort-writer",
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    const controller = new AbortController();
    let resolveAuthorization!: (
      authorized: StudioBg3dShotBatchRecoveryAuthorizationReceipt | null,
    ) => void;
    const authorization = new Promise<StudioBg3dShotBatchRecoveryAuthorizationReceipt | null>((resolve) => {
      resolveAuthorization = resolve;
    });
    const authorizeBeforeCommit = vi.fn(() => authorization);

    const pending = store.completeShot(session, token, artifacts(plan), {
      signal: controller.signal,
      authorizeBeforeCommit,
    });
    await vi.waitFor(() => expect(authorizeBeforeCommit).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const authorizedAt = Date.now();
    resolveAuthorization({
      authorizedAt,
      expiresAt: authorizedAt + 1_000,
      isLocallyCurrent: () => true,
    });
    expect(session.totalArtifactBytes).toBe(0);
    expect(session.artifactStorageBytes).toBe(0);
    expect(session.images).toHaveLength(0);
    await store.release(session);

    const reader = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "authorization-abort-reader",
      heartbeat: false,
      storageManager: null,
    });
    const restored = await reader.acquire(plan, sourceRevision);
    expect(restored.queue.items[0]?.status).toBe("pending");
    expect(restored.images).toHaveLength(0);
    await reader.release(restored);
  });

  it("accounts Job metadata and a zero-Blob skipped artifact, then subtracts both on discard", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "structured-ledger-writer",
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    await store.completeShot(session, token, skippedArtifacts(plan));

    expect(session.totalArtifactBytes).toBe(0);
    expect(session.jobStorageBytes).toBeGreaterThan(0);
    expect(session.artifactStorageBytes).toBeGreaterThan(0);
    expect(await readStoredRecord(database, "meta", "usage:v1")).toMatchObject({
      artifactBytes: 0,
      artifactCount: 1,
      jobCount: 1,
      structuredBytes: session.jobStorageBytes + session.artifactStorageBytes,
    });

    await store.discard(session);
    expect(await readStoredRecord(database, "meta", "usage:v1")).toMatchObject({
      artifactBytes: 0,
      artifactCount: 0,
      jobCount: 0,
      structuredBytes: 0,
    });
  });

  it("enforces the hard origin Job-count cap even when Jobs contain no Blob artifacts", async () => {
    const database = new IDBFactory();
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "job-count-writer",
      heartbeat: false,
      storageManager: null,
    });
    for (let index = 0; index < STUDIO_BG3D_SHOT_BATCH_RECOVERY_MAX_JOBS; index += 1) {
      const { plan, sourceRevision } = await fixture("durable");
      const session = await store.acquire(plan, sourceRevision);
      await store.release(session);
    }
    const overflow = await fixture("durable");
    await expect(store.acquire(overflow.plan, overflow.sourceRevision)).rejects.toMatchObject({
      code: "budget-exceeded",
    });
    expect(await readStoredRecord(database, "meta", "usage:v1")).toMatchObject({
      artifactBytes: 0,
      artifactCount: 0,
      jobCount: STUDIO_BG3D_SHOT_BATCH_RECOVERY_MAX_JOBS,
    });
  });

  it("leaves a running queue uncommitted when artifact validation fails", async () => {
    const database = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const store = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "invalid-owner-a",
      heartbeat: false,
      storageManager: null,
    });
    const session = await store.acquire(plan, sourceRevision);
    const token = await store.startShot(session, plan.shots[0]!.shotId);
    const invalid = artifacts(plan);
    invalid.images[0] = { ...invalid.images[0]!, width: 1 };
    await expect(store.completeShot(session, token, invalid)).rejects.toThrow(/고정 계획/iu);
    await store.release(session);

    const resumedStore = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: database,
      ownerId: "invalid-owner-b",
      heartbeat: false,
      storageManager: null,
    });
    const resumed = await resumedStore.acquire(plan, sourceRevision);
    expect(resumed.images).toHaveLength(0);
    expect(resumed.queue.items[0]?.status).toBe("pending");
    await resumedStore.release(resumed);
  });
});

let sqliteApiPromise: Promise<StudioSqliteApiHandle> | null = null;

function loadRealSqliteApi(): Promise<StudioSqliteApiHandle> {
  sqliteApiPromise ??= import("@sqlite.org/sqlite-wasm").then(async (module) =>
    (await module.default()) as unknown as StudioSqliteApiHandle);
  return sqliteApiPromise;
}

async function openNamedSqlite(filename: string): Promise<StudioLocalDatabase> {
  return openStudioLocalDatabase({
    vfs: "memory",
    memoryFilename: filename,
    loadSqlite: loadRealSqliteApi,
  });
}

function createTestRunExclusive(): StudioBg3dShotBatchRecoveryRunExclusive {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

function bindDatabaseWithKvFault(
  database: StudioLocalDatabase,
  shouldFail: () => boolean,
): StudioLocalDatabase {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "kvSet") {
        return async (...args: Parameters<StudioLocalDatabase["kvSet"]>) => {
          if (shouldFail()) throw new Error("forced sqlite commit fault");
          return target.kvSet(...args);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("Studio BG3D V12 SQLite/OPFS recovery authority", () => {
  it("persists a verified binary shot across a real sqlite-wasm close and reopen", async () => {
    const filename = `bg3d-shot-reopen-${crypto.randomUUID()}.sqlite3`;
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const runExclusive = createTestRunExclusive();
    const { plan, sourceRevision } = await fixture("durable");
    const firstDatabase = await openNamedSqlite(filename);
    const firstAssets = createStudioOpfsAssetStore({ fs: fileSystem });
    const firstStore = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => firstDatabase,
      acquireAssetStore: async () => firstAssets,
      runExclusive,
      ownerId: "sqlite-reopen-a",
      heartbeat: false,
      storageManager: null,
    });
    const first = await firstStore.acquire(plan, sourceRevision);
    const token = await firstStore.startShot(first, plan.shots[0]!.shotId);
    await firstStore.completeShot(first, token, artifacts(plan));
    const expectedBytes = first.totalArtifactBytes;
    await firstStore.release(first);
    const raw = await firstDatabase.kvGet(
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_NAMESPACE,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_CATALOG_KEY,
    );
    expect(raw).toContain("sha256:");
    expect(raw).not.toContain("data:image");
    expect(raw).not.toContain("iVBOR");
    expect(await firstAssets.ownerRefs(
      `${STUDIO_BG3D_SHOT_BATCH_RECOVERY_CAS_OWNER_PREFIX}${plan.resumeKey}`,
    )).toHaveLength(1);
    await firstDatabase.close();

    const reopenedDatabase = await openNamedSqlite(filename);
    const reopenedAssets = createStudioOpfsAssetStore({ fs: fileSystem });
    const reopenedStore = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => reopenedDatabase,
      acquireAssetStore: async () => reopenedAssets,
      runExclusive,
      ownerId: "sqlite-reopen-b",
      heartbeat: false,
      storageManager: null,
    });
    const restored = await reopenedStore.acquire(plan, sourceRevision);
    expect(restored.mode).toBe("durable");
    expect(restored.queue.items[0]?.status).toBe("succeeded");
    expect(restored.images).toHaveLength(1);
    expect(restored.images[0]?.png.size).toBe(expectedBytes);
    expect(restored.totalArtifactBytes).toBe(expectedBytes);
    await reopenedStore.release(restored);
    await reopenedDatabase.close();
  });

  it("does not auto-read a completed legacy IndexedDB job on product boot", async () => {
    const legacyDatabase = new IDBFactory();
    const { plan, sourceRevision } = await fixture("durable");
    const legacyStore = createStudioBg3dShotBatchRecoveryStore({
      indexedDB: legacyDatabase,
      ownerId: "legacy-seed",
      heartbeat: false,
      storageManager: null,
    });
    const legacy = await legacyStore.acquire(plan, sourceRevision);
    const legacyToken = await legacyStore.startShot(legacy, plan.shots[0]!.shotId);
    await legacyStore.completeShot(legacy, legacyToken, artifacts(plan));
    await legacyStore.release(legacy);

    const sqlite = await openNamedSqlite(`bg3d-no-legacy-${crypto.randomUUID()}.sqlite3`);
    const assets = createStudioOpfsAssetStore({ fs: createStudioOpfsMemoryFileSystem() });
    const product = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => sqlite,
      acquireAssetStore: async () => assets,
      runExclusive: createTestRunExclusive(),
      ownerId: "sqlite-product",
      heartbeat: false,
      storageManager: null,
    });
    const fresh = await product.acquire(plan, sourceRevision);
    expect(fresh.mode).toBe("durable");
    expect(fresh.images).toHaveLength(0);
    expect(fresh.queue.items[0]?.status).toBe("pending");
    expect(await sqlite.kvGet(
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_NAMESPACE,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_CATALOG_KEY,
    )).not.toBeNull();
    await product.release(fresh);
    await sqlite.close();
  });

  it("fails closed on a torn canonical SQLite catalog", async () => {
    const database = await openNamedSqlite(`bg3d-torn-${crypto.randomUUID()}.sqlite3`);
    const assets = createStudioOpfsAssetStore({ fs: createStudioOpfsMemoryFileSystem() });
    const runExclusive = createTestRunExclusive();
    const { plan, sourceRevision } = await fixture("durable");
    const writer = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => assets,
      runExclusive,
      ownerId: "torn-writer",
      heartbeat: false,
      storageManager: null,
    });
    const session = await writer.acquire(plan, sourceRevision);
    await writer.release(session);
    const raw = await database.kvGet(
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_NAMESPACE,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_CATALOG_KEY,
    );
    if (!raw) throw new Error("sqlite catalog fixture missing");
    await database.kvSet(
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_NAMESPACE,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_CATALOG_KEY,
      raw.slice(0, -1),
    );
    const reader = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => assets,
      runExclusive,
      ownerId: "torn-reader",
      heartbeat: false,
      storageManager: null,
    });
    await expect(reader.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "corrupt" });
    await database.close();
  });

  it("fails closed when an OPFS CAS artifact is modified after commit", async () => {
    const database = await openNamedSqlite(`bg3d-cas-corrupt-${crypto.randomUUID()}.sqlite3`);
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem });
    const runExclusive = createTestRunExclusive();
    const { plan, sourceRevision } = await fixture("durable");
    const writer = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => assets,
      runExclusive,
      ownerId: "cas-writer",
      heartbeat: false,
      storageManager: null,
    });
    const session = await writer.acquire(plan, sourceRevision);
    const token = await writer.startShot(session, plan.shots[0]!.shotId);
    await writer.completeShot(session, token, artifacts(plan));
    await writer.release(session);
    const refs = await assets.ownerRefs(
      `${STUDIO_BG3D_SHOT_BATCH_RECOVERY_CAS_OWNER_PREFIX}${plan.resumeKey}`,
    );
    const entry = refs[0] ? await assets.stat(refs[0]) : null;
    if (!entry) throw new Error("CAS fixture unavailable");
    const stored = fileSystem.snapshot().get(entry.path);
    if (!stored) throw new Error("CAS bytes unavailable");
    const corrupt = Uint8Array.from(stored);
    corrupt[Math.floor(corrupt.byteLength / 2)] ^= 0xff;
    await fileSystem.write(entry.path, corrupt);

    const reader = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => createStudioOpfsAssetStore({ fs: fileSystem }),
      runExclusive,
      ownerId: "cas-reader",
      heartbeat: false,
      storageManager: null,
    });
    await expect(reader.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "corrupt" });
    await database.close();
  });

  it("serializes contenders and rejects a stale owner after lease takeover", async () => {
    const database = await openNamedSqlite(`bg3d-fence-${crypto.randomUUID()}.sqlite3`);
    const assets = createStudioOpfsAssetStore({ fs: createStudioOpfsMemoryFileSystem() });
    const runExclusive = createTestRunExclusive();
    const { plan, sourceRevision } = await fixture("durable");
    let now = 100_000;
    const firstStore = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => assets,
      runExclusive,
      ownerId: "sqlite-fence-a",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const secondStore = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => assets,
      runExclusive,
      ownerId: "sqlite-fence-b",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const stale = await firstStore.acquire(plan, sourceRevision);
    await expect(secondStore.acquire(plan, sourceRevision)).rejects.toMatchObject({ code: "busy" });
    now += STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS + 1;
    const current = await secondStore.acquire(plan, sourceRevision);
    expect(current.fence).toBeGreaterThan(stale.fence);
    await expect(firstStore.startShot(stale, plan.shots[0]!.shotId)).rejects.toMatchObject({
      code: "lease-lost",
    });
    await secondStore.release(current);
    await database.close();
  });

  it("keeps the last committed checkpoint when the next SQLite commit faults", async () => {
    const database = await openNamedSqlite(`bg3d-fault-${crypto.randomUUID()}.sqlite3`);
    let failCommit = false;
    const faultyDatabase = bindDatabaseWithKvFault(database, () => failCommit);
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem });
    const runExclusive = createTestRunExclusive();
    const { plan, sourceRevision } = await fixture("durable");
    let now = 200_000;
    const writer = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => faultyDatabase,
      acquireAssetStore: async () => assets,
      runExclusive,
      ownerId: "fault-writer",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const session = await writer.acquire(plan, sourceRevision);
    const token = await writer.startShot(session, plan.shots[0]!.shotId);
    failCommit = true;
    await expect(writer.completeShot(session, token, artifacts(plan))).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    failCommit = false;
    now += STUDIO_BG3D_SHOT_BATCH_RECOVERY_LEASE_MS + 1;
    const restartedAssets = createStudioOpfsAssetStore({ fs: fileSystem });
    const reader = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => restartedAssets,
      runExclusive,
      ownerId: "fault-reader",
      now: () => now,
      heartbeat: false,
      storageManager: null,
    });
    const recovered = await reader.acquire(plan, sourceRevision);
    expect(recovered.images).toHaveLength(0);
    expect(recovered.queue.items[0]?.status).toBe("pending");
    expect(await restartedAssets.ownerRefs(
      `${STUDIO_BG3D_SHOT_BATCH_RECOVERY_CAS_OWNER_PREFIX}${plan.resumeKey}`,
    )).toEqual([]);
    await reader.release(recovered);
    await database.close();
  });

  it("keeps canonical Job ordering and acknowledgement/delete semantics", async () => {
    const database = await openNamedSqlite(`bg3d-order-${crypto.randomUUID()}.sqlite3`);
    const assets = createStudioOpfsAssetStore({ fs: createStudioOpfsMemoryFileSystem() });
    const runExclusive = createTestRunExclusive();
    const firstFixture = await fixture("durable");
    const secondFixture = await fixture("durable");
    const store = createStudioBg3dShotBatchRecoveryStore({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => assets,
      runExclusive,
      ownerId: "order-writer",
      heartbeat: false,
      storageManager: null,
    });
    const second = await store.acquire(secondFixture.plan, secondFixture.sourceRevision);
    await store.release(second);
    const first = await store.acquire(firstFixture.plan, firstFixture.sourceRevision);
    const token = await store.startShot(first, firstFixture.plan.shots[0]!.shotId);
    await store.completeShot(first, token, artifacts(firstFixture.plan));
    await store.markDownloadRequested(first);
    await store.discard(first);

    const raw = await database.kvGet(
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_NAMESPACE,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_SQLITE_CATALOG_KEY,
    );
    if (!raw) throw new Error("canonical catalog unavailable");
    const parsed = JSON.parse(raw) as { entries: Array<{ job: { recoveryKey: string } }> };
    const keys = parsed.entries.map(({ job }) => job.recoveryKey);
    expect(keys).toEqual([...keys].sort());
    expect(JSON.stringify(parsed)).toBe(raw);

    const deleted = await store.acquire(firstFixture.plan, firstFixture.sourceRevision);
    expect(deleted.images).toHaveLength(0);
    expect(deleted.queue.items[0]?.status).toBe("pending");
    await store.release(deleted);
    await database.close();
  });
});
