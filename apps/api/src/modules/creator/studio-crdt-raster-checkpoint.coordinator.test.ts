import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
  readStudioCrdtRasterDocument,
} from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  canonicalStudioRasterJson,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterUndoOperation,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";

import {
  STUDIO_CRDT_SERVER_DURABLE_REPLICA_ID,
  StudioCrdtRasterCheckpointCoordinator,
  planStudioCrdtRasterCheckpoint,
  studioCrdtRasterCheckpointRequestHash,
  studioCrdtRasterCheckpointResultHash,
} from "./studio-crdt-raster-checkpoint.coordinator";
import {
  StudioCrdtRasterCheckpointLeaseError,
  StudioCrdtRasterCheckpointStorageError,
} from "./studio-crdt-raster-checkpoint.repository";
import { studioCrdtPayloadHash } from "./studio-crdt.repository";

import type {
  BuildStudioCrdtRasterCheckpointUpdate,
  ClaimStudioCrdtRasterCheckpointJobInput,
  DeferStudioCrdtRasterCheckpointJobInput,
  EnqueueStudioCrdtRasterCheckpointJobInput,
  FinalizeStudioCrdtRasterCheckpointJobInput,
  FinalizeStudioCrdtRasterCheckpointJobResult,
  StudioCrdtRasterCheckpointJobRecord,
  StudioCrdtRasterCheckpointRepository,
  SupersedeStudioCrdtRasterCheckpointJobInput,
} from "./studio-crdt-raster-checkpoint.repository";
import type {
  AppendStudioCrdtUpdateInput,
  AppendStudioCrdtUpdateResult,
  CompactStudioCrdtInput,
  StudioCrdtHydrationState,
  StudioCrdtRepository,
  StudioCrdtUpdateRecord,
  ValidateStudioCrdtAppend,
} from "./studio-crdt.repository";

const SURFACE = {
  version: STUDIO_RASTER_CRDT_VERSION,
  surfaceId: "surface-main",
  width: 128,
  height: 128,
  tileSize: 128,
} as const;
const sha = (character: string) => character.repeat(64);
const uuid = (value: number) => `50000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function asset(character = "d"): StudioRasterAssetReference {
  return {
    scope: "work",
    assetId: sha(character),
    sha256: sha(character),
    byteLength: 1_024,
    mediaType: "image/png",
    width: 128,
    height: 128,
  };
}

function operation(index: number, logicalClock = String(index + 1)): StudioRasterOperation {
  const payload = asset(index % 2 === 0 ? "a" : "b");
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId: uuid(index + 1),
    order: { logicalClock, actorId: "artist-a" },
    pageId: "page-1",
    layerId: "layer-ink",
    intent: "paint",
    kernel: STUDIO_RASTER_KERNEL,
    semanticParametersSha256: sha("c"),
    patches: [{
      tileX: 0,
      tileY: 0,
      region: { x: 0, y: 0, width: 16, height: 16 },
      effect: {
        kind: "composite",
        blendMode: "source-over",
        payload: { ...payload, width: 16, height: 16 },
      },
    }],
  };
}

function rasterDocument(operationCount = 16): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  doc.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT).set(
    SURFACE.surfaceId,
    canonicalStudioRasterJson(SURFACE)
  );
  const root = doc.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT);
  for (let index = 0; index < operationCount; index += 1) {
    const value = operation(index);
    root.set(
      value.operationId,
      canonicalStudioRasterJson({ surfaceId: SURFACE.surfaceId, operation: value })
    );
  }
  return doc;
}

function copyState(state: StudioCrdtHydrationState): StudioCrdtHydrationState {
  return {
    snapshot: state.snapshot && {
      ...state.snapshot,
      snapshot: Uint8Array.from(state.snapshot.snapshot),
      updatedAt: new Date(state.snapshot.updatedAt),
    },
    updates: state.updates.map((update) => ({
      ...update,
      payload: Uint8Array.from(update.payload),
      createdAt: new Date(update.createdAt),
    })),
  };
}

class MemoryCrdtRepository implements StudioCrdtRepository {
  readonly doc = new Y.Doc({ gc: false });
  sequence = 1n;

  constructor(source: Y.Doc) {
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(source));
  }

  state(): StudioCrdtHydrationState {
    return {
      snapshot: {
        workId: "work-1",
        snapshot: Y.encodeStateAsUpdate(this.doc),
        compactedSequence: this.sequence,
        updatedAt: new Date(0),
      },
      updates: [],
    };
  }

  async loadDocument(): Promise<StudioCrdtHydrationState> {
    return copyState(this.state());
  }

  async loadCatchUp(): Promise<StudioCrdtHydrationState> {
    return copyState(this.state());
  }

  async listUpdatesAfter(): Promise<StudioCrdtUpdateRecord[]> {
    return [];
  }

  async appendUpdate(
    _input: AppendStudioCrdtUpdateInput,
    _validate: ValidateStudioCrdtAppend
  ): Promise<AppendStudioCrdtUpdateResult> {
    throw new Error("not used by checkpoint coordinator tests");
  }

  async compact(_input: CompactStudioCrdtInput): Promise<boolean> {
    return false;
  }

  applyCheckpoint(payload: Uint8Array): bigint {
    Y.applyUpdate(this.doc, payload);
    this.sequence += 1n;
    return this.sequence;
  }
}

type MemoryJob = StudioCrdtRasterCheckpointJobRecord & { leaseToken: string | null };

class MemoryCheckpointRepository implements StudioCrdtRasterCheckpointRepository {
  readonly jobs = new Map<string, MemoryJob>();
  readonly storedAssets = new Map<string, string>();

  constructor(private readonly crdt: MemoryCrdtRepository) {}

  private key(workId: string, surfaceId: string): string {
    return JSON.stringify([workId, surfaceId]);
  }

  async enqueue(input: EnqueueStudioCrdtRasterCheckpointJobInput): Promise<boolean> {
    const key = this.key(input.workId, input.surfaceId);
    const existing = this.jobs.get(key);
    if (existing && existing.status !== "completed") return false;
    if (existing?.requestHash === input.requestHash) return false;
    this.jobs.set(key, {
      workId: input.workId,
      surfaceId: input.surfaceId,
      jobId: input.jobId,
      proofId: input.proofId,
      requestHash: input.requestHash,
      sourceSequence: input.sourceSequence,
      through: { ...input.through },
      status: "pending",
      attempt: 0,
      notBefore: new Date(input.now),
      leaseOwner: null,
      leaseExpiresAt: null,
      resultHash: null,
      resultCheckpointId: null,
      resultSequence: null,
      completedAt: null,
      createdAt: new Date(input.now),
      updatedAt: new Date(input.now),
      leaseToken: null,
    });
    return true;
  }

  async claim(
    input: ClaimStudioCrdtRasterCheckpointJobInput
  ): Promise<StudioCrdtRasterCheckpointJobRecord | null> {
    const job = this.jobs.get(this.key(input.workId, input.surfaceId));
    if (!job || job.status === "completed") return null;
    const ready = job.status === "pending"
      ? job.notBefore.getTime() <= input.now.getTime()
      : Boolean(job.leaseExpiresAt && job.leaseExpiresAt.getTime() <= input.now.getTime());
    if (!ready) return null;
    Object.assign(job, {
      status: "leased" as const,
      attempt: Math.min(32, job.attempt + 1),
      leaseOwner: input.coordinatorId,
      leaseExpiresAt: new Date(input.leaseExpiresAt),
      updatedAt: new Date(input.now),
      leaseToken: input.leaseToken,
    });
    return { ...job, through: { ...job.through } };
  }

  async defer(input: DeferStudioCrdtRasterCheckpointJobInput): Promise<boolean> {
    const job = this.jobs.get(this.key(input.workId, input.surfaceId));
    if (
      !job ||
      job.status !== "leased" ||
      job.jobId !== input.jobId ||
      job.leaseOwner !== input.coordinatorId ||
      job.leaseToken !== input.leaseToken
    ) throw new StudioCrdtRasterCheckpointLeaseError();
    Object.assign(job, {
      status: "pending" as const,
      notBefore: new Date(input.notBefore),
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: new Date(input.now),
    });
    return true;
  }

  async supersede(input: SupersedeStudioCrdtRasterCheckpointJobInput): Promise<boolean> {
    const job = this.jobs.get(this.key(input.workId, input.surfaceId));
    if (
      !job ||
      job.status !== "leased" ||
      job.jobId !== input.jobId ||
      job.leaseOwner !== input.coordinatorId ||
      job.leaseToken !== input.leaseToken
    ) throw new StudioCrdtRasterCheckpointLeaseError();
    Object.assign(job, {
      jobId: input.replacementJobId,
      proofId: input.replacementProofId,
      requestHash: input.replacementRequestHash,
      sourceSequence: input.replacementSourceSequence,
      through: { ...input.replacementThrough },
      status: "pending" as const,
      notBefore: new Date(input.notBefore),
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseToken: null,
      resultHash: null,
      resultCheckpointId: null,
      resultSequence: null,
      completedAt: null,
      createdAt: new Date(input.now),
      updatedAt: new Date(input.now),
    });
    return true;
  }

  async finalize(
    input: FinalizeStudioCrdtRasterCheckpointJobInput,
    build: BuildStudioCrdtRasterCheckpointUpdate
  ): Promise<FinalizeStudioCrdtRasterCheckpointJobResult> {
    const job = this.jobs.get(this.key(input.workId, input.surfaceId));
    if (
      !job ||
      job.jobId !== input.jobId ||
      job.leaseOwner !== input.coordinatorId ||
      job.leaseToken !== input.leaseToken
    ) throw new StudioCrdtRasterCheckpointLeaseError();
    if (job.status === "completed") {
      if (job.resultHash !== input.resultHash || job.resultSequence === null) {
        throw new StudioCrdtRasterCheckpointLeaseError();
      }
      return { inserted: false, checkpointId: job.jobId, sequence: job.resultSequence };
    }
    if (
      job.status !== "leased" ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt.getTime() <= input.now.getTime()
    ) throw new StudioCrdtRasterCheckpointLeaseError();
    const built = await build(job, this.crdt.state(), {} as never);
    for (const reference of built.assets) {
      if (this.storedAssets.get(reference.assetId) !== canonicalStudioRasterJson(reference)) {
        throw new StudioCrdtRasterCheckpointStorageError("missing or mismatched asset");
      }
    }
    const sequence = this.crdt.applyCheckpoint(built.payload);
    Object.assign(job, {
      status: "completed" as const,
      resultHash: input.resultHash,
      resultCheckpointId: job.jobId,
      resultSequence: sequence,
      completedAt: new Date(input.now),
      updatedAt: new Date(input.now),
    });
    return { inserted: true, checkpointId: job.jobId, sequence };
  }
}

const documents: Y.Doc[] = [];

afterEach(() => {
  for (const doc of documents.splice(0)) doc.destroy();
});

function setup(now: { value: Date }) {
  const source = rasterDocument();
  documents.push(source);
  const crdt = new MemoryCrdtRepository(source);
  documents.push(crdt.doc);
  const checkpoints = new MemoryCheckpointRepository(crdt);
  const coordinator = new StudioCrdtRasterCheckpointCoordinator(crdt, checkpoints, {
    now: () => new Date(now.value),
    operationThreshold: 16,
    leaseMs: 10_000,
    backoffBaseMs: 1_000,
    backoffMaxMs: 8_000,
  });
  return { source, crdt, checkpoints, coordinator };
}

describe("Studio semantic raster checkpoint coordinator", () => {
  it("plans only after the threshold and hashes the exact immutable prefix", () => {
    const below = rasterDocument(15);
    const ready = rasterDocument(16);
    documents.push(below, ready);
    expect(planStudioCrdtRasterCheckpoint({ doc: below, operationThreshold: 16 })).toBeNull();
    const plan = planStudioCrdtRasterCheckpoint({ doc: ready, operationThreshold: 16 });
    expect(plan).not.toBeNull();
    const log = readStudioCrdtRasterDocument(ready).logs.get(SURFACE.surfaceId)!;
    expect(plan?.requestHash).toBe(studioCrdtRasterCheckpointRequestHash(log, plan!.through));
    expect(plan?.operationCount).toBe(16);
  });

  it("never turns a post-commit scheduler outage into an editor update failure", async () => {
    const now = { value: new Date("2026-07-21T00:00:00.000Z") };
    const { crdt, checkpoints, coordinator } = setup(now);
    checkpoints.enqueue = async () => {
      throw new Error("checkpoint database unavailable");
    };
    await expect(
      coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence)
    ).resolves.toBe(false);
  });

  it("retries the durable enqueue on the next commit after a transient scheduler outage", async () => {
    const now = { value: new Date("2026-07-21T00:00:00.000Z") };
    const { crdt, checkpoints, coordinator } = setup(now);
    const enqueue = checkpoints.enqueue.bind(checkpoints);
    let attempts = 0;
    checkpoints.enqueue = async (input) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary checkpoint database outage");
      return enqueue(input);
    };

    await expect(coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence))
      .resolves.toBe(false);
    await expect(coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence))
      .resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it("survives a coordinator restart and atomically publishes one trusted checkpoint", async () => {
    const now = { value: new Date("2026-07-21T00:00:00.000Z") };
    const { crdt, checkpoints, coordinator } = setup(now);
    expect(await coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence)).toBe(true);

    const restarted = new StudioCrdtRasterCheckpointCoordinator(crdt, checkpoints, {
      now: () => new Date(now.value),
      operationThreshold: 16,
      leaseMs: 10_000,
    });
    const lease = await restarted.claim({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      coordinatorId: "renderer-seoul",
    });
    expect(lease).toMatchObject({
      sourceSequence: "1",
      maxTiles: 96,
      requiredReplicaIds: [STUDIO_CRDT_SERVER_DURABLE_REPLICA_ID],
    });
    expect(lease?.log.operations).toHaveLength(16);

    const tile = asset("d");
    checkpoints.storedAssets.set(tile.assetId, canonicalStudioRasterJson(tile));
    const completion = {
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      jobId: lease!.jobId,
      coordinatorId: lease!.coordinatorId,
      leaseToken: lease!.leaseToken,
      requestHash: lease!.requestHash,
      tiles: [{ tileX: 0, tileY: 0, asset: tile }],
    } as const;
    await expect(restarted.complete(completion)).resolves.toMatchObject({
      inserted: true,
      checkpointId: lease!.jobId,
      serverSequence: "2",
    });
    await expect(restarted.complete(completion)).resolves.toMatchObject({ inserted: false });
    expect(readStudioCrdtRasterDocument(crdt.doc).checkpoints).toHaveLength(1);
  });

  it("uses lease fencing so an expired worker cannot overwrite a reclaimed job", async () => {
    const now = { value: new Date("2026-07-21T00:00:00.000Z") };
    const { crdt, checkpoints, coordinator } = setup(now);
    await coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence);
    const first = await coordinator.claim({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      coordinatorId: "renderer-a",
    });
    await expect(coordinator.claim({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      coordinatorId: "renderer-b",
    })).resolves.toBeNull();

    now.value = new Date(now.value.getTime() + 10_001);
    const second = await coordinator.claim({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      coordinatorId: "renderer-b",
    });
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    const tile = asset("d");
    checkpoints.storedAssets.set(tile.assetId, canonicalStudioRasterJson(tile));
    await expect(coordinator.complete({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      jobId: first!.jobId,
      coordinatorId: first!.coordinatorId,
      leaseToken: first!.leaseToken,
      requestHash: first!.requestHash,
      tiles: [{ tileX: 0, tileY: 0, asset: tile }],
    })).rejects.toBeInstanceOf(StudioCrdtRasterCheckpointLeaseError);
    await expect(coordinator.complete({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      jobId: second!.jobId,
      coordinatorId: second!.coordinatorId,
      leaseToken: second!.leaseToken,
      requestHash: second!.requestHash,
      tiles: [{ tileX: 0, tileY: 0, asset: tile }],
    })).resolves.toMatchObject({ inserted: true });
  });

  it("defers a stale prefix with backoff instead of trusting coordinator pixels", async () => {
    const now = { value: new Date("2026-07-21T00:00:00.000Z") };
    const { crdt, checkpoints, coordinator } = setup(now);
    await coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence);
    const originalRequestHash = checkpoints.jobs.values().next().value?.requestHash;
    const late = operation(99, "1");
    crdt.doc.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      late.operationId,
      canonicalStudioRasterJson({ surfaceId: SURFACE.surfaceId, operation: late })
    );
    await expect(coordinator.claim({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      coordinatorId: "renderer-a",
    })).resolves.toBeNull();
    const job = checkpoints.jobs.values().next().value as MemoryJob;
    expect(job.status).toBe("pending");
    expect(job.notBefore.getTime()).toBeGreaterThan(now.value.getTime());
    expect(job.requestHash).not.toBe(originalRequestHash);
  });

  it("keeps a leased job uncommitted when a result asset is missing or mismatched", async () => {
    const now = { value: new Date("2026-07-21T00:00:00.000Z") };
    const { crdt, checkpoints, coordinator } = setup(now);
    await coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence);
    const lease = await coordinator.claim({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      coordinatorId: "renderer-a",
    });
    const tile = asset("d");
    const result = {
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      jobId: lease!.jobId,
      coordinatorId: lease!.coordinatorId,
      leaseToken: lease!.leaseToken,
      requestHash: lease!.requestHash,
      tiles: [{ tileX: 0, tileY: 0, asset: tile }],
    } as const;
    expect(studioCrdtRasterCheckpointResultHash(result)).toMatch(/^[a-f0-9]{64}$/u);
    await expect(coordinator.complete(result)).rejects.toBeInstanceOf(
      StudioCrdtRasterCheckpointStorageError
    );
    expect(checkpoints.jobs.values().next().value?.status).toBe("leased");
    expect(crdt.sequence).toBe(1n);
  });

  it("refuses completion when a later undo crosses the worker's closed horizon", async () => {
    const now = { value: new Date("2026-07-21T00:00:00.000Z") };
    const { crdt, checkpoints, coordinator } = setup(now);
    await coordinator.maybeEnqueue("work-1", crdt.doc, crdt.sequence);
    const lease = await coordinator.claim({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      coordinatorId: "renderer-a",
    });
    const undo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(200),
      targetOperationId: uuid(1),
      order: { logicalClock: "17", actorId: "artist-a" },
    };
    crdt.doc.getMap<string>(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).set(
      undo.undoOperationId,
      canonicalStudioRasterJson({ surfaceId: SURFACE.surfaceId, undoOperation: undo })
    );
    crdt.sequence += 1n;
    const tile = asset("d");
    checkpoints.storedAssets.set(tile.assetId, canonicalStudioRasterJson(tile));

    await expect(coordinator.complete({
      workId: "work-1",
      surfaceId: SURFACE.surfaceId,
      jobId: lease!.jobId,
      coordinatorId: lease!.coordinatorId,
      leaseToken: lease!.leaseToken,
      requestHash: lease!.requestHash,
      tiles: [{ tileX: 0, tileY: 0, asset: tile }],
    })).rejects.toThrow(/실행 취소가 봉인된/u);
    expect(checkpoints.jobs.values().next().value?.status).toBe("leased");
    expect(readStudioCrdtRasterDocument(crdt.doc).checkpoints).toHaveLength(0);
  });

  it("uses the existing SHA-256 receipt digest for the trusted system update", () => {
    expect(Buffer.from(studioCrdtPayloadHash(Uint8Array.of(1, 2, 3))).toString("hex")).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"
    );
  });
});
