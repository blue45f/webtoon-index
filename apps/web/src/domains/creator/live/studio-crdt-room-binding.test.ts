import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioCrdtDocument,
  type StudioCrdtDrawStrokePayload,
} from "./studio-crdt-document";
import { createStudioCrdtServerAckError } from "./studio-crdt-operation-error";
import {
  StudioCrdtOutboxCorruptionError,
  type StudioCrdtOutbox,
  type StudioCrdtOutboxRetryMetadata,
} from "./studio-crdt-outbox";
import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  decodeStudioCrdtStateVector,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  encodeStudioCrdtUpdate,
  type StudioCrdtRemoteUpdate,
  type StudioCrdtSyncRequest,
  type StudioCrdtSyncResponse,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  StudioCrdtRoomBinding,
  type StudioCrdtBindingStatus,
} from "./studio-crdt-room-binding";

import type {
  PreserveStudioCrdtRecoveryFrontierInput,
  PreserveStudioCrdtRejectionMarkerInput,
  StudioCrdtPermanentRejectionMarker,
  StudioCrdtRecoveryVault,
  StudioCrdtRecoveryVaultEntry,
} from "./studio-crdt-recovery-vault";
import type {
  StudioLiveCrdtRoomEvent,
  StudioLiveRoom,
  StudioLiveRoomEvent,
} from "./studio-live-collaboration-room";

function payload(x: number): StudioCrdtDrawStrokePayload {
  return {
    version: 1,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [x, x, x + 1, x + 1],
    pressures: [0.4, 0.8],
    stroke: "#123456",
    strokeWidth: 6,
  };
}

function add(document: StudioCrdtDocument, id: string, x: number): void {
  document.addStroke({
    id,
    pageId: "page-a",
    layerId: "page-root",
    payload: payload(x),
  });
}

class FakeRoom {
  ready = true;
  readonly mode: "local" | "server";
  readonly workId = "work-a";
  readonly participant = { sessionId: "self", displayName: "Me", role: "editor" as const };
  readonly crdtListeners = new Set<(event: StudioLiveCrdtRoomEvent) => void>();
  readonly roomListeners = new Set<(event: StudioLiveRoomEvent) => void>();
  readonly publications: StudioCrdtUpdateRequest[] = [];
  server: StudioCrdtDocument;
  failuresRemaining = 0;
  nextPublishError: Error | null = null;
  nextSyncError: Error | null = null;
  nextSyncBarrier: Promise<void> | null = null;
  syncFailuresRemaining = 0;
  hangPublications = false;
  publishBarrier: Promise<void> | null = null;
  serverSequence = 0;
  syncRequests = 0;

  constructor(server: StudioCrdtDocument, mode: "local" | "server" = "server") {
    this.server = server;
    this.mode = mode;
  }

  subscribeCrdt(listener: (event: StudioLiveCrdtRoomEvent) => void): () => void {
    this.crdtListeners.add(listener);
    return () => this.crdtListeners.delete(listener);
  }

  subscribe(listener: (event: StudioLiveRoomEvent) => void): () => void {
    this.roomListeners.add(listener);
    return () => this.roomListeners.delete(listener);
  }

  async requestCrdtSync(request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse> {
    this.syncRequests += 1;
    const syncBarrier = this.nextSyncBarrier;
    this.nextSyncBarrier = null;
    if (syncBarrier) await syncBarrier;
    if (this.nextSyncError) {
      const error = this.nextSyncError;
      this.nextSyncError = null;
      throw error;
    }
    if (this.syncFailuresRemaining > 0) {
      this.syncFailuresRemaining -= 1;
      throw new Error("temporary sync failure");
    }
    const diff = this.server.encodeStateAsUpdate(decodeStudioCrdtStateVector(request.stateVector));
    const response: StudioCrdtSyncResponse = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: this.workId,
      requestId: request.requestId,
      transferId: "11111111-1111-4111-8111-111111111111",
      chunks: encodeStudioCrdtSyncChunks(diff),
      chunkCount: encodeStudioCrdtSyncChunks(diff).length,
      totalBytes: diff.byteLength,
      serverStateVector: encodeStudioCrdtStateVector(this.server.encodeStateVector()),
      serverSequence: String(this.serverSequence),
    };
    for (const listener of this.crdtListeners) {
      listener({ type: "sync-response", response, senderSessionId: null });
    }
    return response;
  }

  async publishCrdtUpdate(request: StudioCrdtUpdateRequest) {
    this.publications.push(request);
    if (this.hangPublications) return new Promise<never>(() => undefined);
    if (this.publishBarrier) await this.publishBarrier;
    if (this.nextPublishError) {
      const error = this.nextPublishError;
      this.nextPublishError = null;
      throw error;
    }
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("temporary disconnect");
    }
    this.server.applyUpdate(decodeStudioCrdtUpdate(request.update));
    this.serverSequence += 1;
    return {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: this.workId,
      updateId: request.updateId,
      serverSequence: String(this.serverSequence),
      serverStateVector: encodeStudioCrdtStateVector(this.server.encodeStateVector()),
      duplicate: false,
    };
  }

  respondCrdtSync(): boolean {
    return true;
  }

  emitRemote(update: StudioCrdtRemoteUpdate): void {
    for (const listener of this.crdtListeners) {
      listener({ type: "update", update, senderSessionId: "peer" });
    }
  }
}

function room(value: FakeRoom): StudioLiveRoom {
  return value as unknown as StudioLiveRoom;
}

class MemoryOutbox implements StudioCrdtOutbox {
  readonly requests = new Map<string, StudioCrdtUpdateRequest>();

  async list(scope: string, workId: string): Promise<StudioCrdtUpdateRequest[]> {
    return [...this.requests.entries()]
      .filter(([key, request]) => key.startsWith(`${scope}:`) && request.workId === workId)
      .map(([, request]) => ({ ...request }));
  }

  async put(scope: string, request: StudioCrdtUpdateRequest): Promise<void> {
    this.requests.set(`${scope}:${request.updateId}`, { ...request });
  }

  async remove(scope: string, _workId: string, updateId: string): Promise<void> {
    this.requests.delete(`${scope}:${updateId}`);
  }
}

class DurableMemoryOutbox extends MemoryOutbox {
  getStatus() {
    return {
      state: "durable" as const,
      message: "테스트 브라우저 복구 저장소가 정상입니다.",
    };
  }
}

class RetryMetadataMemoryOutbox extends DurableMemoryOutbox {
  readonly retries: Array<{
    scope: string;
    workId: string;
    updateId: string;
    metadata: StudioCrdtOutboxRetryMetadata;
  }> = [];

  async recordRetry(
    scope: string,
    workId: string,
    updateId: string,
    metadata: StudioCrdtOutboxRetryMetadata,
  ): Promise<void> {
    this.retries.push({ scope, workId, updateId, metadata });
  }
}

class MemoryRecoveryVault implements StudioCrdtRecoveryVault {
  readonly entries: StudioCrdtRecoveryVaultEntry[] = [];
  readonly rejectionMarkers: StudioCrdtPermanentRejectionMarker[] = [];

  async preserveRejectionMarker(
    input: PreserveStudioCrdtRejectionMarkerInput
  ): Promise<StudioCrdtPermanentRejectionMarker> {
    const existing = this.rejectionMarkers.find((marker) =>
      marker.scope === input.scope &&
      marker.workId === input.workId &&
      marker.rejectedUpdateId === input.rejectedUpdateId
    );
    if (existing) return { ...existing };
    const marker: StudioCrdtPermanentRejectionMarker = {
      ...input,
      createdAt: this.rejectionMarkers.length + 1,
    };
    this.rejectionMarkers.push(marker);
    return { ...marker };
  }

  async listRejectionMarkers(
    scope: string,
    workId: string
  ): Promise<StudioCrdtPermanentRejectionMarker[]> {
    return this.rejectionMarkers
      .filter((marker) => marker.scope === scope && marker.workId === workId)
      .map((marker) => ({ ...marker }));
  }

  async preserve(
    input: PreserveStudioCrdtRecoveryFrontierInput
  ): Promise<StudioCrdtRecoveryVaultEntry> {
    const entry: StudioCrdtRecoveryVaultEntry = {
      vaultId: `vault-${this.entries.length + 1}`,
      scope: input.scope,
      workId: input.workId,
      status: "pending-export",
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      rejectedUpdateId: input.rejectedUpdateId,
      updates: input.updates.map((request) => ({ ...request })),
      createdAt: this.entries.length + 1,
      exportedAt: null,
    };
    this.entries.push(entry);
    return { ...entry, updates: entry.updates.map((request) => ({ ...request })) };
  }

  async list(scope: string, workId: string): Promise<StudioCrdtRecoveryVaultEntry[]> {
    return this.entries
      .filter((entry) => entry.scope === scope && entry.workId === workId)
      .map((entry) => ({ ...entry, updates: entry.updates.map((request) => ({ ...request })) }));
  }

  async markExported(scope: string, workId: string, vaultId: string): Promise<void> {
    const entry = this.entries.find((candidate) =>
      candidate.scope === scope && candidate.workId === workId && candidate.vaultId === vaultId
    );
    if (!entry) throw new Error("missing recovery entry");
    entry.status = "exported";
    entry.exportedAt = 100;
  }
}

class FailingRecoveryVault extends MemoryRecoveryVault {
  override async preserve(): Promise<StudioCrdtRecoveryVaultEntry> {
    throw new Error("recovery vault write failed");
  }
}

class UnreadableRecoveryVault extends MemoryRecoveryVault {
  override async list(): Promise<StudioCrdtRecoveryVaultEntry[]> {
    throw new Error("corrupted recovery vault");
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("StudioCrdtRoomBinding", () => {
  it("performs bidirectional state-vector repair before becoming ready", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    add(server, "server-stroke", 10);
    add(client, "offline-stroke", 20);
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      randomId: (() => {
        let value = 0;
        return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
      })(),
    });

    await binding.start();

    expect(client.getStrokes().map((stroke) => stroke.id).sort()).toEqual([
      "offline-stroke",
      "server-stroke",
    ]);
    expect(server.getStrokes().map((stroke) => stroke.id).sort()).toEqual([
      "offline-stroke",
      "server-stroke",
    ]);
    expect(fake.publications).toHaveLength(1);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("does not drain a restored Base64 outbox before the initial authoritative sync", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const source = new StudioCrdtDocument();
    add(source, "restored-before-sync", 15);
    const outbox = new MemoryOutbox();
    const request: StudioCrdtUpdateRequest = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      updateId: "00000000-0000-4000-8000-000000000015",
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(source.encodeStateAsUpdate()),
    };
    await outbox.put("user-initial-sync", request);
    const fake = new FakeRoom(server);
    let releaseSync: () => void = () => undefined;
    fake.nextSyncBarrier = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-initial-sync",
    });

    const starting = binding.start();
    await vi.waitFor(() => expect(fake.syncRequests).toBe(1));
    binding.flush();
    await Promise.resolve();
    expect(fake.publications).toEqual([]);
    expect(outbox.requests.get(`user-initial-sync:${request.updateId}`)?.update).toBe(
      request.update
    );

    releaseSync();
    await starting;
    expect(fake.publications).toHaveLength(1);
    expect(fake.publications[0]).toEqual(request);
    expect(server.getStroke("restored-before-sync")).not.toBeNull();

    binding.close();
    source.destroy();
    client.destroy();
    server.destroy();
  });

  it("flushes a sub-frame edit, waits for its authoritative ACK, then reconciles the final server frontier", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();

    add(client, "save-fenced-stroke", 21);
    const result = await binding.flushAndWaitForAuthoritativeAck();

    expect(server.getStroke("save-fenced-stroke")).not.toBeNull();
    expect(fake.publications).toHaveLength(1);
    expect(fake.syncRequests).toBe(2);
    expect(result).toMatchObject({
      serverSequence: "1",
      acknowledgedAt: expect.any(Number),
    });

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("pulls a missing remote frontier during the final save reconciliation", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    add(server, "remote-before-save", 22);
    fake.serverSequence = 1;

    const result = await binding.flushAndWaitForAuthoritativeAck();

    expect(client.getStroke("remote-before-save")).not.toBeNull();
    expect(result.serverSequence).toBe("1");
    expect(fake.syncRequests).toBe(2);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("waits for a pre-existing sync and starts a new sync after the pending drain", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    let releasePreExistingSync: () => void = () => undefined;
    fake.nextSyncBarrier = new Promise<void>((resolve) => {
      releasePreExistingSync = resolve;
    });

    const preExistingSync = binding.syncNow();
    await vi.waitFor(() => expect(fake.syncRequests).toBe(2));
    const saveBarrier = binding.flushAndWaitForAuthoritativeAck();
    releasePreExistingSync();

    await expect(preExistingSync).resolves.toBeUndefined();
    await expect(saveBarrier).resolves.toMatchObject({ serverSequence: "0" });
    expect(fake.syncRequests).toBe(3);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("rejects save on transient final sync failure and enters terminal recovery on permanent sync failure", async () => {
    const server = new StudioCrdtDocument();
    const transientClient = new StudioCrdtDocument();
    const transientRoom = new FakeRoom(server);
    const transientBinding = new StudioCrdtRoomBinding({
      document: transientClient,
      room: room(transientRoom),
    });
    await transientBinding.start();
    transientRoom.nextSyncError = new Error("temporary final sync failure");

    await expect(
      transientBinding.flushAndWaitForAuthoritativeAck()
    ).rejects.toThrow("temporary final sync failure");
    expect(transientBinding.recoveryRequired).toBe(false);
    transientBinding.close();
    transientClient.destroy();

    const permanentClient = new StudioCrdtDocument();
    const permanentRoom = new FakeRoom(server);
    const permanentBinding = new StudioCrdtRoomBinding({
      document: permanentClient,
      room: room(permanentRoom),
    });
    await permanentBinding.start();
    permanentRoom.nextSyncError = createStudioCrdtServerAckError(
      "storage_corruption",
      "server frontier is corrupt"
    );

    await expect(
      permanentBinding.flushAndWaitForAuthoritativeAck()
    ).rejects.toThrow("server frontier is corrupt");
    expect(permanentBinding.getRecoveryRequiredState()).toMatchObject({
      code: "storage_corruption",
      recoveryExportAvailable: false,
    });

    permanentBinding.close();
    permanentClient.destroy();
    server.destroy();
  });

  it("applies remote updates without publishing an echo", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    const publicationCount = fake.publications.length;
    const peer = new StudioCrdtDocument();
    add(peer, "peer-stroke", 30);
    const update = peer.encodeStateAsUpdate();
    server.applyUpdate(update);
    fake.serverSequence = 1;

    fake.emitRemote({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      updateId: "22222222-2222-4222-8222-222222222222",
      serverSequence: "1",
      update: encodeStudioCrdtUpdate(update),
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(client.getStroke("peer-stroke")).not.toBeNull();
    expect(fake.publications).toHaveLength(publicationCount);

    binding.close();
    peer.destroy();
    client.destroy();
    server.destroy();
  });

  it("retries a failed publish with the same durable update id", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    fake.failuresRemaining = 1;
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();

    add(client, "local-stroke", 40);
    await vi.advanceTimersByTimeAsync(40);
    expect(fake.publications).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);

    expect(fake.publications).toHaveLength(2);
    expect(fake.publications[0]?.updateId).toBe(fake.publications[1]?.updateId);
    expect(server.getStroke("local-stroke")).not.toBeNull();

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("retries a typed transient server rejection with the same durable update id", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    fake.nextPublishError = createStudioCrdtServerAckError(
      "rate_limited",
      "temporary CRDT backpressure"
    );
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();

    add(client, "rate-limited-stroke", 42);
    await vi.advanceTimersByTimeAsync(40);
    expect(fake.publications).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);

    expect(fake.publications).toHaveLength(2);
    expect(fake.publications[0]?.updateId).toBe(fake.publications[1]?.updateId);
    expect(server.getStroke("rate-limited-stroke")).not.toBeNull();
    expect(binding.recoveryRequired).toBe(false);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("preserves a permanently rejected frontier in the recovery vault before removing the resend copy", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    fake.nextPublishError = createStudioCrdtServerAckError(
      "invalid_payload",
      "server rejected the document update"
    );
    const outbox = new MemoryOutbox();
    const recoveryVault = new MemoryRecoveryVault();
    const statuses: StudioCrdtBindingStatus[] = [];
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault,
      outboxScope: "user-permanent-rejection",
      onStatus: (status) => statuses.push(status),
    });
    await binding.start();

    add(client, "permanently-rejected-stroke", 44);
    await vi.advanceTimersByTimeAsync(40);
    await vi.runAllTicks();

    expect(fake.publications).toHaveLength(1);
    expect(outbox.requests.size).toBe(0);
    expect(recoveryVault.entries).toHaveLength(1);
    expect(recoveryVault.entries[0]).toMatchObject({
      status: "pending-export",
      failureCode: "invalid_payload",
      rejectedUpdateId: fake.publications[0]?.updateId,
    });
    expect(recoveryVault.entries[0]?.updates).toHaveLength(1);
    expect(binding.recoveryRequired).toBe(true);
    expect(binding.getRecoveryRequiredState()).toMatchObject({
      code: "invalid_payload",
      updateId: fake.publications[0]?.updateId,
      recoveryUpdateCount: 1,
      outboxCleanupAtRisk: false,
      recoveryVaultId: "vault-1",
      recoveryExportAvailable: true,
    });
    expect(statuses.at(-1)).toMatchObject({
      state: "recovery-required",
      code: "invalid_payload",
      collaborativeEditsBlocked: true,
      retryable: false,
      recoveryUpdateCount: 1,
      recoveryVaultId: "vault-1",
      recoveryExportAvailable: true,
    });

    await vi.advanceTimersByTimeAsync(20_000);
    add(client, "blocked-after-rejection", 45);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.publications).toHaveLength(1);
    expect(server.getStroke("permanently-rejected-stroke")).toBeNull();
    expect(server.getStroke("blocked-after-rejection")).toBeNull();

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("flushes a sub-frame local batch into the recovery frontier before a delayed permanent rejection locks editing", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    let releasePublish: () => void = () => undefined;
    fake.publishBarrier = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    fake.nextPublishError = createStudioCrdtServerAckError(
      "invalid_payload",
      "delayed permanent rejection"
    );
    const outbox = new MemoryOutbox();
    const recoveryVault = new MemoryRecoveryVault();
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault,
      outboxScope: "user-delayed-permanent-rejection",
    });
    await binding.start();

    add(client, "rejected-in-flight", 44);
    await vi.advanceTimersByTimeAsync(40);
    expect(fake.publications).toHaveLength(1);

    // This edit remains inside the document's <40 ms batch when the first publication is rejected.
    add(client, "batched-before-terminal-boundary", 45);
    releasePublish();
    await vi.waitFor(() => expect(binding.recoveryRequired).toBe(true));

    expect(fake.publications).toHaveLength(1);
    expect(recoveryVault.entries).toHaveLength(1);
    expect(recoveryVault.entries[0]?.updates).toHaveLength(2);
    expect(binding.getRecoveryRequiredState()).toMatchObject({
      code: "invalid_payload",
      recoveryUpdateCount: 2,
      recoveryVaultId: "vault-1",
      recoveryExportAvailable: true,
    });
    expect(outbox.requests.size).toBe(0);

    const recovered = new StudioCrdtDocument();
    for (const request of recoveryVault.entries[0]?.updates ?? []) {
      recovered.applyUpdate(decodeStudioCrdtUpdate(request.update));
    }
    expect(recovered.getStroke("rejected-in-flight")).not.toBeNull();
    expect(recovered.getStroke("batched-before-terminal-boundary")).not.toBeNull();

    binding.close();
    recovered.destroy();
    client.destroy();
    server.destroy();
  });

  it("never deletes the resend copy when the independent recovery vault write fails", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    fake.nextPublishError = createStudioCrdtServerAckError(
      "invalid_payload",
      "server rejected the document update"
    );
    const outbox = new MemoryOutbox();
    const recoveryVault = new FailingRecoveryVault();
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault,
      outboxScope: "user-vault-failure",
    });
    await binding.start();

    add(client, "rejected-but-retained", 45);
    await vi.advanceTimersByTimeAsync(40);
    await vi.runAllTicks();

    expect(fake.publications).toHaveLength(1);
    expect(outbox.requests.size).toBe(1);
    expect(binding.getRecoveryRequiredState()).toMatchObject({
      recoveryExportAvailable: false,
      recoveryVaultId: null,
      outboxCleanupAtRisk: true,
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.publications).toHaveLength(1);

    binding.close();
    client.destroy();

    const reopenedClient = new StudioCrdtDocument();
    const reopenedRoom = new FakeRoom(server);
    const reopenedBinding = new StudioCrdtRoomBinding({
      document: reopenedClient,
      room: room(reopenedRoom),
      outbox,
      recoveryVault,
      outboxScope: "user-vault-failure",
    });
    await reopenedBinding.start();

    expect(reopenedBinding.getRecoveryRequiredState()).toMatchObject({
      code: "invalid_payload",
      recoveryExportAvailable: false,
      outboxCleanupAtRisk: true,
    });
    expect(reopenedRoom.publications).toHaveLength(0);
    expect(reopenedRoom.syncRequests).toBe(0);
    expect(reopenedClient.getStroke("rejected-but-retained")).toBeNull();
    expect(outbox.requests.size).toBe(1);

    reopenedBinding.close();
    reopenedClient.destroy();
    server.destroy();
  });

  it("blocks reopen on a pending recovery frontier and never replays it after explicit export", async () => {
    const server = new StudioCrdtDocument();
    const rejectedSource = new StudioCrdtDocument();
    add(rejectedSource, "rejected-from-previous-session", 46);
    const rejectedRequest: StudioCrdtUpdateRequest = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      updateId: "55555555-5555-4555-8555-555555555555",
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(rejectedSource.encodeStateAsUpdate()),
    };
    const outbox = new MemoryOutbox();
    await outbox.put("user-pending-recovery", rejectedRequest);
    const recoveryVault = new MemoryRecoveryVault();
    const recoveryEntry = await recoveryVault.preserve({
      scope: "user-pending-recovery",
      workId: "work-a",
      failureCode: "invalid_payload",
      failureMessage: "server rejected update",
      rejectedUpdateId: rejectedRequest.updateId,
      updates: [rejectedRequest],
    });
    const lockedClient = new StudioCrdtDocument();
    const lockedRoom = new FakeRoom(server);
    const lockedBinding = new StudioCrdtRoomBinding({
      document: lockedClient,
      room: room(lockedRoom),
      outbox,
      recoveryVault,
      outboxScope: "user-pending-recovery",
    });

    await lockedBinding.start();

    expect(lockedBinding.recoveryRequired).toBe(true);
    expect(lockedBinding.getRecoveryRequiredState()).toMatchObject({
      recoveryVaultId: recoveryEntry.vaultId,
      recoveryExportAvailable: true,
      recoveryUpdateCount: 1,
    });
    expect(lockedRoom.syncRequests).toBe(0);
    expect(lockedRoom.publications).toHaveLength(0);
    expect(lockedClient.getStroke("rejected-from-previous-session")).toBeNull();
    expect(outbox.requests.size).toBe(1);
    lockedBinding.close();
    lockedClient.destroy();

    await recoveryVault.markExported(
      "user-pending-recovery",
      "work-a",
      recoveryEntry.vaultId
    );
    const authoritativeClient = new StudioCrdtDocument();
    const authoritativeRoom = new FakeRoom(server);
    const authoritativeBinding = new StudioCrdtRoomBinding({
      document: authoritativeClient,
      room: room(authoritativeRoom),
      outbox,
      recoveryVault,
      outboxScope: "user-pending-recovery",
    });

    await authoritativeBinding.start();

    expect(authoritativeBinding.recoveryRequired).toBe(false);
    expect(authoritativeRoom.syncRequests).toBe(1);
    expect(authoritativeRoom.publications).toHaveLength(0);
    expect(authoritativeClient.getStroke("rejected-from-previous-session")).toBeNull();
    expect(server.getStroke("rejected-from-previous-session")).toBeNull();
    expect(outbox.requests.size).toBe(0);
    expect(recoveryVault.entries[0]).toMatchObject({ status: "exported" });

    authoritativeBinding.close();
    authoritativeClient.destroy();
    rejectedSource.destroy();
    server.destroy();
  });

  it("fails closed without reading or replaying the outbox when the recovery vault is unreadable", async () => {
    const server = new StudioCrdtDocument();
    const rejectedSource = new StudioCrdtDocument();
    add(rejectedSource, "must-not-replay-without-vault", 47);
    const rejectedRequest: StudioCrdtUpdateRequest = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      updateId: "66666666-6666-4666-8666-666666666666",
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(rejectedSource.encodeStateAsUpdate()),
    };
    const outbox = new MemoryOutbox();
    await outbox.put("user-unreadable-recovery", rejectedRequest);
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new UnreadableRecoveryVault(),
      outboxScope: "user-unreadable-recovery",
    });

    await binding.start();

    expect(binding.getRecoveryRequiredState()).toMatchObject({
      code: "recovery_vault_unavailable",
      recoveryExportAvailable: false,
      outboxCleanupAtRisk: true,
    });
    expect(fake.syncRequests).toBe(0);
    expect(fake.publications).toHaveLength(0);
    expect(client.getStroke("must-not-replay-without-vault")).toBeNull();
    expect(outbox.requests.size).toBe(1);

    binding.close();
    client.destroy();
    rejectedSource.destroy();
    server.destroy();
  });

  it("locks a replacement editor when its durable outbox contains an unreadable row", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const outbox: StudioCrdtOutbox = {
      async list() {
        throw new StudioCrdtOutboxCorruptionError();
      },
      async put() {
        return undefined;
      },
      async remove() {
        return undefined;
      },
    };
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-corrupt-outbox",
    });

    await binding.start();

    expect(binding.getRecoveryRequiredState()).toMatchObject({
      code: "outbox_unreadable",
      outboxCleanupAtRisk: true,
      recoveryExportAvailable: false,
    });
    expect(fake.syncRequests).toBe(0);
    expect(fake.publications).toHaveLength(0);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("keeps viewer documents read-only while still receiving sync state", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    add(server, "visible-stroke", 50);
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      canEdit: false,
    });
    await binding.start();
    add(client, "forbidden-local", 60);
    await vi.advanceTimersByTimeAsync(100);

    expect(client.getStroke("visible-stroke")).not.toBeNull();
    expect(fake.publications).toHaveLength(0);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("emits structured pending, durability, transport, and authoritative ACK telemetry", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const statuses: StudioCrdtBindingStatus[] = [];
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      onStatus: (status) => statuses.push(status),
    });
    await binding.start();

    const beforeAck = Date.now();
    add(client, "telemetry-stroke", 51);
    await vi.advanceTimersByTimeAsync(40);

    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: "syncing",
        pendingCount: 1,
        persistenceDurability: "unavailable",
        transportReady: true,
      }),
    ]));
    expect(statuses.at(-1)).toMatchObject({
      state: "ready",
      pendingCount: 0,
      transportReady: true,
      lastAckAt: expect.any(Number),
      lastAckServerSequence: "1",
    });
    expect(statuses.at(-1)?.lastAckAt).toBeGreaterThanOrEqual(beforeAck);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("truthfully marks offline pending edits as browser-durable only after outbox health is checked", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const outbox = new DurableMemoryOutbox();
    const statuses: StudioCrdtBindingStatus[] = [];
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-offline-telemetry",
      onStatus: (status) => statuses.push(status),
    });
    await binding.start();
    fake.ready = false;

    add(client, "offline-telemetry-stroke", 52);
    await vi.advanceTimersByTimeAsync(40);

    expect(statuses.at(-1)).toMatchObject({
      state: "retrying",
      pendingCount: 1,
      persistenceDurability: "durable",
      transportReady: false,
      lastAckAt: null,
      lastAckServerSequence: null,
    });
    expect(outbox.requests.size).toBe(1);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("persists bounded retry metadata before scheduling a retryable publication", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    fake.failuresRemaining = 1;
    const outbox = new RetryMetadataMemoryOutbox();
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-retry-metadata",
    });
    await binding.start();

    add(client, "retry-metadata-stroke", 53);
    await vi.advanceTimersByTimeAsync(40);
    await vi.runAllTicks();

    expect(outbox.retries).toHaveLength(1);
    expect(outbox.retries[0]).toMatchObject({
      scope: "user-retry-metadata",
      workId: fake.workId,
      updateId: fake.publications[0]?.updateId,
      metadata: {
        attemptCount: 1,
        errorCode: "transport_error",
        errorMessage: "temporary disconnect",
      },
    });
    expect(
      outbox.retries[0]!.metadata.nextRetryAt -
        outbox.retries[0]!.metadata.attemptedAt,
    ).toBe(300);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("keeps a local BroadcastChannel delivery in the durable outbox until a server ACK arrives", async () => {
    vi.useFakeTimers();
    const peerDocument = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const outbox = new DurableMemoryOutbox();
    const recoveryVault = new MemoryRecoveryVault();
    const localRoom = new FakeRoom(peerDocument, "local");
    const statuses: StudioCrdtBindingStatus[] = [];
    const localBinding = new StudioCrdtRoomBinding({
      document: client,
      room: room(localRoom),
      outbox,
      recoveryVault,
      outboxScope: "user-local-pending",
      onStatus: (status) => statuses.push(status),
    });
    await localBinding.start();

    add(client, "local-only-stroke", 53);
    await vi.advanceTimersByTimeAsync(40);
    await vi.runAllTicks();

    expect(localRoom.publications).toHaveLength(1);
    expect(outbox.requests.size).toBe(1);
    const updateId = localRoom.publications[0]?.updateId;
    expect(statuses.at(-1)).toMatchObject({
      state: "retrying",
      pendingCount: 1,
      persistenceDurability: "durable",
      lastAckAt: null,
      lastAckServerSequence: null,
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(localRoom.publications).toHaveLength(1);
    localBinding.close();
    client.destroy();

    const serverClient = new StudioCrdtDocument();
    const serverRoom = new FakeRoom(peerDocument, "server");
    const serverBinding = new StudioCrdtRoomBinding({
      document: serverClient,
      room: room(serverRoom),
      outbox,
      recoveryVault,
      outboxScope: "user-local-pending",
    });
    await serverBinding.start();
    await vi.runAllTicks();

    expect(serverRoom.publications.at(-1)?.updateId).toBe(updateId);
    expect(outbox.requests.size).toBe(0);

    serverBinding.close();
    serverClient.destroy();
    peerDocument.destroy();
  });

  it("flushes the final sub-frame batch before graceful room teardown", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    add(client, "last-stroke", 70);

    await binding.closeGracefully();

    expect(server.getStroke("last-stroke")).not.toBeNull();
    client.destroy();
    server.destroy();
  });

  it("waits for the final durable outbox write even after the room disconnects", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const stored = new MemoryOutbox();
    let signalPutStarted: () => void = () => undefined;
    const putStarted = new Promise<void>((resolve) => {
      signalPutStarted = resolve;
    });
    let releasePut: () => void = () => undefined;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const outbox: StudioCrdtOutbox = {
      list: (scope, workId) => stored.list(scope, workId),
      async put(scope, request) {
        signalPutStarted();
        await putGate;
        await stored.put(scope, request);
      },
      remove: (scope, workId, updateId) => stored.remove(scope, workId, updateId),
    };
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-offline-close",
    });
    await binding.start();
    fake.ready = false;
    add(client, "offline-tail-stroke", 75);
    let closed = false;

    const closing = binding.closeGracefully(500).then(() => {
      closed = true;
    });
    await putStarted;
    await Promise.resolve();
    expect(closed).toBe(false);

    releasePut();
    await closing;
    expect(stored.requests.size).toBe(1);

    client.destroy();
    server.destroy();
  });

  it("retries a failed tail persistence before offline close and surfaces the failure", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const stored = new MemoryOutbox();
    const statuses: string[] = [];
    let putAttempts = 0;
    const outbox: StudioCrdtOutbox = {
      list: (scope, workId) => stored.list(scope, workId),
      async put(scope, request) {
        putAttempts += 1;
        if (putAttempts === 1) throw new Error("temporary IndexedDB failure");
        await stored.put(scope, request);
      },
      remove: (scope, workId, updateId) => stored.remove(scope, workId, updateId),
    };
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-persistence-retry",
      onStatus: (status) => statuses.push(`${status.state}:${status.message}`),
    });
    await binding.start();
    fake.ready = false;
    add(client, "retry-tail-stroke", 77);

    await binding.closeGracefully(500);

    expect(putAttempts).toBeGreaterThanOrEqual(2);
    expect(stored.requests.size).toBe(1);
    expect(statuses.some((status) => status.includes("temporary IndexedDB failure"))).toBe(true);

    client.destroy();
    server.destroy();
  });

  it("uses the acknowledged server as the durable sink when local persistence fails online", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const statuses: string[] = [];
    const outbox: StudioCrdtOutbox = {
      list: async () => [],
      put: async () => {
        throw new Error("local quota exceeded");
      },
      remove: async () => undefined,
    };
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-online-fallback",
      onStatus: (status) => statuses.push(`${status.state}:${status.message}`),
    });
    await binding.start();

    add(client, "server-durable-stroke", 78);
    await vi.advanceTimersByTimeAsync(40);

    expect(server.getStroke("server-durable-stroke")).not.toBeNull();
    expect(fake.publications).toHaveLength(1);
    expect(statuses.some((status) => status.includes("local quota exceeded"))).toBe(true);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("keeps degraded outbox health visible after fallback restore and server sync", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const statuses: Array<{
      state: string;
      message: string;
      durabilityAtRisk?: boolean;
    }> = [];
    const outbox: StudioCrdtOutbox = {
      async list() {
        return [];
      },
      async put() {
        return undefined;
      },
      async remove() {
        return undefined;
      },
      getStatus: () => ({
        state: "degraded",
        message: "permanent IndexedDB read failure",
      }),
    };
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-degraded-restore",
      onStatus: (status) => statuses.push(status),
    });

    await binding.start();

    expect(statuses.at(-1)).toMatchObject({
      state: "error",
      durabilityAtRisk: true,
    });
    expect(statuses.at(-1)?.message).toContain("permanent IndexedDB read failure");

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("times out a wedged local persistence call and still reaches the online server", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const outbox: StudioCrdtOutbox = {
      list: async () => [],
      put: () => new Promise<void>(() => undefined),
      remove: async () => undefined,
    };
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(fake),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-online-timeout",
      persistenceTimeoutMs: 100,
    });
    await binding.start();

    add(client, "server-after-timeout-stroke", 79);
    await vi.advanceTimersByTimeAsync(140);

    expect(server.getStroke("server-after-timeout-stroke")).not.toBeNull();
    expect(fake.publications).toHaveLength(1);

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("retries the state-vector sync itself after a reconnect sync failure", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    add(server, "missed-while-disconnected", 80);
    fake.syncFailuresRemaining = 1;

    for (const listener of fake.roomListeners) {
      listener({
        type: "transport-status",
        status: { state: "ready", message: "reconnected", recoverable: true },
      });
    }
    await Promise.resolve();
    expect(client.getStroke("missed-while-disconnected")).toBeNull();

    await vi.advanceTimersByTimeAsync(300);
    expect(client.getStroke("missed-while-disconnected")).not.toBeNull();

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("periodically repairs a durable update whose realtime broadcast was missed", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    add(server, "missed-cross-instance-broadcast", 85);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.getStroke("missed-cross-instance-broadcast")).not.toBeNull();

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("repairs a missed durable update immediately when the next server ACK exposes a gap", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    expect(fake.syncRequests).toBe(1);

    // Sequence 1 commits while its realtime broadcast is lost. The client's own edit is then
    // durably accepted as sequence 2, so the ACK itself becomes an ordering-gap repair signal.
    add(server, "missed-before-local-ack", 86);
    fake.serverSequence = 1;
    add(client, "local-after-missed-broadcast", 87);
    await vi.advanceTimersByTimeAsync(40);

    expect(fake.syncRequests).toBe(2);
    expect(client.getStroke("missed-before-local-ack")).not.toBeNull();
    expect(server.getStroke("local-after-missed-broadcast")).not.toBeNull();

    binding.close();
    client.destroy();
    server.destroy();
  });

  it("uses a remote server-sequence gap to converge without waiting for background sync", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();

    add(server, "missed-sequence-one", 88);
    fake.serverSequence = 1;
    const peer = new StudioCrdtDocument();
    add(peer, "received-sequence-two", 89);
    const secondUpdate = peer.encodeStateAsUpdate();
    server.applyUpdate(secondUpdate);
    fake.serverSequence = 2;
    fake.emitRemote({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      updateId: "44444444-4444-4444-8444-444444444444",
      serverSequence: "2",
      update: encodeStudioCrdtUpdate(secondUpdate),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.syncRequests).toBe(2);
    expect(client.getStroke("received-sequence-two")).not.toBeNull();
    expect(client.getStroke("missed-sequence-one")).not.toBeNull();

    binding.close();
    peer.destroy();
    client.destroy();
    server.destroy();
  });

  it("does not treat peer-local BroadcastChannel counters as authoritative gaps", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server, "local");
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    const peer = new StudioCrdtDocument();
    add(peer, "local-peer-sequence", 89.5);

    fake.emitRemote({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      updateId: "55555555-5555-4555-8555-555555555555",
      // Local peer counters are intentionally independent and may jump between senders.
      serverSequence: "99",
      update: encodeStudioCrdtUpdate(peer.encodeStateAsUpdate()),
    });
    await Promise.resolve();

    expect(fake.syncRequests).toBe(1);
    expect(client.getStroke("local-peer-sequence")).not.toBeNull();
    expect(fake.publications).toHaveLength(0);

    binding.close();
    peer.destroy();
    client.destroy();
    server.destroy();
  });

  it("honors the graceful-close deadline when a publish never settles", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const binding = new StudioCrdtRoomBinding({ document: client, room: room(fake) });
    await binding.start();
    fake.hangPublications = true;
    add(client, "hung-last-stroke", 90);

    const closing = binding.closeGracefully(10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(closing).resolves.toBeUndefined();

    client.destroy();
    server.destroy();
  });

  it("restores an unsent durable outbox update in the next editor session", async () => {
    vi.useFakeTimers();
    const server = new StudioCrdtDocument();
    const firstClient = new StudioCrdtDocument();
    const fake = new FakeRoom(server);
    const outbox = new MemoryOutbox();
    const recoveryVault = new MemoryRecoveryVault();
    const firstBinding = new StudioCrdtRoomBinding({
      document: firstClient,
      room: room(fake),
      outbox,
      recoveryVault,
      outboxScope: "user-a",
    });
    await firstBinding.start();
    fake.failuresRemaining = 1;
    add(firstClient, "offline-close-stroke", 100);
    await vi.advanceTimersByTimeAsync(40);
    expect(outbox.requests.size).toBe(1);
    const originalUpdateId = [...outbox.requests.values()][0]?.updateId;
    firstBinding.close();
    firstClient.destroy();

    const secondClient = new StudioCrdtDocument();
    const secondBinding = new StudioCrdtRoomBinding({
      document: secondClient,
      room: room(fake),
      outbox,
      recoveryVault,
      outboxScope: "user-a",
    });
    await secondBinding.start();
    await Promise.resolve();

    expect(server.getStroke("offline-close-stroke")).not.toBeNull();
    expect(fake.publications.at(-1)?.updateId).toBe(originalUpdateId);
    expect(outbox.requests.size).toBe(0);

    secondBinding.close();
    secondClient.destroy();
    server.destroy();
  });

  it("does not resume an outbox restore after the binding closes", async () => {
    const server = new StudioCrdtDocument();
    const client = new StudioCrdtDocument();
    const source = new StudioCrdtDocument();
    add(source, "stale-after-close", 110);
    let resolveList: (requests: StudioCrdtUpdateRequest[]) => void = () => {
      throw new Error("Outbox list did not start.");
    };
    let listStarted = false;
    const outbox: StudioCrdtOutbox = {
      list: () => new Promise((resolve) => {
        listStarted = true;
        resolveList = resolve;
      }),
      put: async () => undefined,
      remove: async () => undefined,
    };
    const binding = new StudioCrdtRoomBinding({
      document: client,
      room: room(new FakeRoom(server)),
      outbox,
      recoveryVault: new MemoryRecoveryVault(),
      outboxScope: "user-a",
    });
    const starting = binding.start();

    await vi.waitFor(() => expect(listStarted).toBe(true));
    binding.close();
    resolveList([{
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      updateId: "33333333-3333-4333-8333-333333333333",
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(source.encodeStateAsUpdate()),
    }]);

    await expect(starting).resolves.toBeUndefined();
    expect(client.getStroke("stale-after-close")).toBeNull();

    source.destroy();
    client.destroy();
    server.destroy();
  });
});
