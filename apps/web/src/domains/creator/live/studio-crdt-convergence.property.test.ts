import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_CRDT_BINARY_WIRE_VERSION,
  STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT,
  STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
  STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
  STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
} from "./studio-crdt-binary-wire";
import {
  F754_PROPERTY_SEEDS,
  F754SeededRandom,
  canonicalStudioCrdtProjection,
  setDeterministicStudioCrdtClientId,
  settleF754Microtasks,
  withF754FailureTrace,
} from "./studio-crdt-convergence-property-helper";
import {
  STUDIO_CRDT_ORIGIN_LOCAL,
  StudioCrdtDocument,
  mergeStudioCrdtUpdates,
  type StudioCrdtDrawStrokePayload,
} from "./studio-crdt-document";
import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  encodeStudioCrdtUpdate,
  type StudioCrdtSyncResponse,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import { StudioCrdtRoomBinding } from "./studio-crdt-room-binding";
import {
  StudioLiveRoom,
  type StudioLiveCrdtRoomEvent,
} from "./studio-live-collaboration-room";
import {
  createStudioServerLiveTransportFactory,
  type StudioLiveSocketLike,
} from "./studio-live-socket-transport";

import type {
  StudioCrdtOutbox,
  StudioCrdtOutboxStatus,
} from "./studio-crdt-outbox";
import type {
  PreserveStudioCrdtRecoveryFrontierInput,
  PreserveStudioCrdtRejectionMarkerInput,
  StudioCrdtPermanentRejectionMarker,
  StudioCrdtRecoveryVault,
  StudioCrdtRecoveryVaultEntry,
} from "./studio-crdt-recovery-vault";
import type { StudioLiveParticipant } from "./studio-live-collaboration-protocol";

import {
  decodeStudioCrdtBinaryEnvelope,
  encodeStudioCrdtBinaryEnvelope,
  fragmentStudioCrdtBinarySyncEnvelope,
} from "@/shared/lib/studio-crdt-binary-envelope";

const WORK_ID = "work-f754";
const OUTBOX_SCOPE = "f754-user";
const SESSION_TOKEN = "f754-signed-session-token";
const EXPECTED_YJS_OUT_OF_ORDER_WARNING =
  "Invalid access: Add Yjs type to a document before reading data.";

interface CapturedUpdate {
  originPeer: number;
  ordinal: number;
  bytes: Uint8Array;
}

async function withF754PropertyTrace(
  random: F754SeededRandom,
  run: () => void | Promise<void>
): Promise<void> {
  await withF754FailureTrace(random, async () => {
    const unexpectedWarnings: string[] = [];
    const warningSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((...arguments_: unknown[]) => {
        if (
          arguments_.length === 1 &&
          arguments_[0] === EXPECTED_YJS_OUT_OF_ORDER_WARNING
        ) {
          return;
        }
        unexpectedWarnings.push(arguments_.map(String).join(" "));
      });

    try {
      await run();
    } finally {
      warningSpy.mockRestore();
    }

    if (unexpectedWarnings.length > 0) {
      throw new Error(
        `Unexpected CRDT warnings:\n${unexpectedWarnings.join("\n")}`
      );
    }
  });
}

function strokePayload(x: number, variant = 0): StudioCrdtDrawStrokePayload {
  return {
    version: 1,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [x, x + variant, x + 1, x + variant + 1],
    pressures: [0.35 + (variant % 3) * 0.1, 0.8],
    stroke: ["#123456", "#9b2c2c", "#1d4ed8", "#047857"][variant % 4]!,
    strokeWidth: 2 + (variant % 9),
  };
}

function addStroke(
  document: StudioCrdtDocument,
  id: string,
  x: number,
  variant = 0
): void {
  document.addStroke({
    id,
    pageId: "page-a",
    layerId: "page-root",
    payload: strokePayload(x, variant),
  });
}

function applyAuthoritativeSync(
  authority: StudioCrdtDocument,
  target: StudioCrdtDocument,
  requestId: string
): void {
  const diff = authority.encodeStateAsUpdate(target.encodeStateVector());
  const chunks = encodeStudioCrdtSyncChunks(diff);
  const response: StudioCrdtSyncResponse = {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    workId: WORK_ID,
    requestId,
    transferId: "00000000-0000-4000-8000-00000000f754",
    chunks,
    chunkCount: chunks.length,
    totalBytes: diff.byteLength,
    serverStateVector: encodeStudioCrdtStateVector(authority.encodeStateVector()),
    serverSequence: "0",
  };
  target.applySyncResponse(response);
}

class F754MemoryOutbox implements StudioCrdtOutbox {
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

  getStatus(): StudioCrdtOutboxStatus {
    return {
      state: "durable",
      message: "F-754 deterministic memory outbox",
    };
  }
}

class F754RecoveryVault implements StudioCrdtRecoveryVault {
  async preserveRejectionMarker(
    input: PreserveStudioCrdtRejectionMarkerInput
  ): Promise<StudioCrdtPermanentRejectionMarker> {
    return { ...input, createdAt: 1 };
  }

  async listRejectionMarkers(): Promise<StudioCrdtPermanentRejectionMarker[]> {
    return [];
  }

  async preserve(
    input: PreserveStudioCrdtRecoveryFrontierInput
  ): Promise<StudioCrdtRecoveryVaultEntry> {
    return {
      vaultId: "f754-vault",
      scope: input.scope,
      workId: input.workId,
      status: "pending-export",
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      rejectedUpdateId: input.rejectedUpdateId,
      updates: input.updates.map((update) => ({ ...update })),
      createdAt: 1,
      exportedAt: null,
    };
  }

  async list(): Promise<StudioCrdtRecoveryVaultEntry[]> {
    return [];
  }

  async markExported(): Promise<void> {
    return undefined;
  }
}

class F754ManualTimers {
  private nextId = 0;
  private readonly timers = new Map<
    number,
    { handler: () => void; delay: number }
  >();

  setTimeout = (handler: () => void, delay: number): number => {
    const id = ++this.nextId;
    this.timers.set(id, { handler, delay });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    if (typeof handle === "number") this.timers.delete(handle);
  };

  runZeroDelay(): void {
    for (const [id, timer] of [...this.timers]) {
      if (timer.delay !== 0) continue;
      this.timers.delete(id);
      timer.handler();
    }
  }
}

interface EmittedSocketEvent {
  event: string;
  payload: unknown;
}

interface HeldBinarySync {
  payload: Record<string, unknown>;
  callback: (value: unknown) => void;
}

interface RemotePublication {
  updateId: string;
  serverSequence: string;
  raw: Uint8Array;
  legacy: Record<string, unknown>;
  binary: Record<string, unknown>;
}

class F754BinaryServerSocket implements StudioLiveSocketLike {
  connected = false;
  auth: Record<string, unknown>;
  readonly emitted: EmittedSocketEvent[] = [];
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly appliedUpdateIds = new Set<string>();
  holdNextBinarySync = false;
  heldBinarySync: HeldBinarySync | null = null;
  joinCount = 0;
  serverSequence = 0;

  constructor(
    auth: { sessionToken: string },
    readonly serverDocument: StudioCrdtDocument
  ) {
    this.auth = { ...auth };
  }

  connect(): StudioLiveSocketLike {
    this.connected = true;
    this.serverEmit("connect");
    return this;
  }

  disconnect(): StudioLiveSocketLike {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.serverEmit("disconnect", "f754 reconnect fence");
    return this;
  }

  emit(event: string, ...args: unknown[]): StudioLiveSocketLike {
    const callback =
      typeof args.at(-1) === "function"
        ? (args.at(-1) as (value: unknown) => void)
        : null;
    const payload = args[0];
    this.emitted.push({ event, payload });
    if (!callback) return this;

    if (event === "studio:join") {
      this.joinCount += 1;
      const connectionId = `f754-connection-${this.joinCount}`;
      callback({
        ok: true,
        data: {
          crdtWireFormats: ["binary-v1", "base64-v4"],
          crdtWireSelectionEpoch: this.selectionEpoch(),
          self: {
            connectionId,
            clientInstanceId: "f754-client",
            name: "F-754 peer",
            role: "owner",
            capabilities: {
              view: true,
              comment: true,
              edit: true,
              manageMembers: true,
            },
            state: "active",
            pageId: null,
            tool: null,
            sharingScreen: false,
            joinedAt: "2026-07-27T00:00:00.000Z",
            updatedAt: "2026-07-27T00:00:00.000Z",
          },
          participants: [
            {
              connectionId,
              clientInstanceId: "f754-client",
              name: "F-754 peer",
              role: "owner",
              capabilities: {
                view: true,
                comment: true,
                edit: true,
                manageMembers: true,
              },
              state: "active",
              pageId: null,
              tool: null,
              sharingScreen: false,
              joinedAt: "2026-07-27T00:00:00.000Z",
              updatedAt: "2026-07-27T00:00:00.000Z",
            },
          ],
          locks: [],
          voiceMembers: [],
          screenShares: [],
        },
      });
      return this;
    }

    if (event === STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT) {
      const request = payload as Record<string, unknown>;
      callback({
        ok: true,
        data: {
          protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
          wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
          workId: WORK_ID,
          format: "binary-v1",
          selectionEpoch: request.selectionEpoch,
          selected: true,
        },
      });
      return this;
    }

    if (event === STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT) {
      const request = payload as Record<string, unknown>;
      if (this.holdNextBinarySync) {
        this.holdNextBinarySync = false;
        this.heldBinarySync = { payload: request, callback };
      } else {
        callback(this.binarySyncResponse(request));
      }
      return this;
    }

    if (event === STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT) {
      const request = payload as Record<string, unknown>;
      const updateId = String(request.updateId);
      const duplicate = this.appliedUpdateIds.has(updateId);
      if (!duplicate) {
        const update = decodeStudioCrdtBinaryEnvelope(request.update, "update").bytes;
        this.serverDocument.applyUpdate(update);
        this.appliedUpdateIds.add(updateId);
        this.serverSequence += 1;
      }
      callback({
        ok: true,
        data: {
          protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
          wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
          workId: WORK_ID,
          updateId,
          serverSequence: String(this.serverSequence),
          duplicate,
        },
      });
      return this;
    }

    callback({ ok: true, data: {} });
    return this;
  }

  on(event: string, listener: (...args: unknown[]) => void): StudioLiveSocketLike {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): StudioLiveSocketLike {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  serverEmit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  releaseHeldBinarySync(): void {
    const held = this.heldBinarySync;
    if (!held) throw new Error("F-754 binary sync was not held");
    this.heldBinarySync = null;
    held.callback(this.binarySyncResponse(held.payload));
  }

  authorRemoteStroke(
    updateId: string,
    strokeId: string,
    x: number,
    variant: number
  ): RemotePublication {
    const updates: Uint8Array[] = [];
    const unsubscribe = this.serverDocument.subscribe((update, origin) => {
      if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
    });
    addStroke(this.serverDocument, strokeId, x, variant);
    unsubscribe();
    const raw = mergeStudioCrdtUpdates(updates);
    this.serverSequence += 1;
    const serverSequence = String(this.serverSequence);
    return {
      updateId,
      serverSequence,
      raw,
      legacy: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: WORK_ID,
        updateId,
        serverSequence,
        update: encodeStudioCrdtUpdate(raw),
      },
      binary: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
        workId: WORK_ID,
        updateId,
        serverSequence,
        update: encodeStudioCrdtBinaryEnvelope("update", raw),
      },
    };
  }

  private selectionEpoch(): string {
    return `00000000-0000-4000-8000-${String(this.joinCount).padStart(12, "0")}`;
  }

  private binarySyncResponse(request: Record<string, unknown>) {
    const stateVector = decodeStudioCrdtBinaryEnvelope(
      request.stateVector,
      "state-vector"
    ).bytes;
    const diff = this.serverDocument.encodeStateAsUpdate(stateVector);
    const envelope = encodeStudioCrdtBinaryEnvelope("sync-diff", diff);
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(envelope);
    return {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
        workId: WORK_ID,
        requestId: request.requestId,
        transferId: `00000000-0000-4000-8000-${String(
          100 + this.joinCount
        ).padStart(12, "0")}`,
        fragments,
        fragmentCount: fragments.length,
        wireBytes: envelope.byteLength,
        totalBytes: diff.byteLength,
        serverStateVector: encodeStudioCrdtBinaryEnvelope(
          "state-vector",
          this.serverDocument.encodeStateVector()
        ),
        serverSequence: String(this.serverSequence),
      },
    };
  }
}

function propertyParticipant(): StudioLiveParticipant {
  return {
    sessionId: "f754-client",
    displayName: "F-754 peer",
    role: "owner",
  };
}

describe("F-754 CRDT deterministic convergence properties", () => {
  it.each(F754_PROPERTY_SEEDS)(
    "converges 2..N peers through offline, duplicate, reorder and authoritative sync (seed=%i)",
    async (seed) => {
      const random = new F754SeededRandom(seed);
      await withF754PropertyTrace(random, () => {
        const peerCount = random.integer(2, 6);
        const peers = Array.from({ length: peerCount }, () => new StudioCrdtDocument());
        const authority = new StudioCrdtDocument();
        const captured: CapturedUpdate[] = [];
        const unsubscribers: Array<() => void> = [];
        const online = Array.from({ length: peerCount }, () => true);
        const clientIdBase = 0x0100_0000 + (seed % 0x000f_ffff) * 8;
        random.trace(`peers=${peerCount} clientIdBase=${clientIdBase}`);

        try {
          peers.forEach((peer, index) => {
            setDeterministicStudioCrdtClientId(peer, clientIdBase + index + 1);
          });
          setDeterministicStudioCrdtClientId(
            authority,
            clientIdBase + peerCount + 1
          );
          addStroke(peers[0]!, "shared", 1, 0);
          const base = peers[0]!.encodeStateAsUpdate();
          authority.applyUpdate(base);
          for (let index = 1; index < peers.length; index += 1) {
            peers[index]!.applyUpdate(base);
          }

          peers.forEach((peer, originPeer) => {
            unsubscribers.push(peer.subscribe((update, origin) => {
              if (origin !== STUDIO_CRDT_ORIGIN_LOCAL) return;
              captured.push({
                originPeer,
                ordinal: captured.length,
                bytes: update,
              });
            }));
          });

          const operationCount = random.integer(18, 30);
          for (let step = 0; step < operationCount; step += 1) {
            const actor = random.integer(0, peerCount - 1);
            if (random.chance(0.2)) {
              online[actor] = !online[actor];
              random.trace(`step=${step} peer=${actor} online=${online[actor]}`);
            }
            const document = peers[actor]!;
            const records = document.getStrokes({ includeDeleted: true });
            const visible = records.filter((record) => !record.deleted);
            const deleted = records.filter((record) => record.deleted);
            const selector = random.next();
            if (selector < 0.18 && visible.length > 0) {
              const selected = random.pick(visible);
              document.deleteStroke(selected.id);
              random.trace(`step=${step} peer=${actor} delete=${selected.id}`);
            } else if (selector < 0.3 && deleted.length > 0) {
              const selected = random.pick(deleted);
              document.upsertStroke({
                id: selected.id,
                pageId: "page-a",
                layerId: "page-root",
                payload: strokePayload(step + 20, actor + step),
              }, { resurrect: true });
              random.trace(`step=${step} peer=${actor} resurrect=${selected.id}`);
            } else if (selector < 0.55 && visible.length > 0) {
              const selected = random.pick(visible);
              document.upsertStroke({
                id: selected.id,
                pageId: "page-a",
                layerId: "page-root",
                payload: strokePayload(step + 30, actor + step),
              });
              random.trace(`step=${step} peer=${actor} update=${selected.id}`);
            } else {
              const id = `stroke-${seed.toString(16)}-${step}-${actor}`;
              addStroke(document, id, step + 40, actor + step);
              random.trace(`step=${step} peer=${actor} add=${id}`);
            }

            const opportunisticDeliveries = random.integer(
              0,
              Math.min(3, captured.length)
            );
            for (
              let delivery = 0;
              delivery < opportunisticDeliveries;
              delivery += 1
            ) {
              const update = random.pick(captured);
              const candidates = peers
                .map((_, index) => index)
                .filter((index) => index !== update.originPeer && online[index]);
              if (candidates.length === 0) continue;
              const target = random.pick(candidates);
              peers[target]!.applyUpdate(update.bytes);
              const duplicated = random.chance(0.35);
              if (duplicated) peers[target]!.applyUpdate(update.bytes);
              random.trace(
                `deliver ordinal=${update.ordinal} ${update.originPeer}->${target}` +
                  ` duplicate=${duplicated}`
              );
            }
          }

          for (const update of random.shuffle(captured)) {
            authority.applyUpdate(update.bytes);
            if (random.chance(0.25)) authority.applyUpdate(update.bytes);
          }
          random.trace(`authority assembled updates=${captured.length}`);

          peers.forEach((peer, target) => {
            for (const update of random.shuffle(captured)) {
              if (random.chance(0.18)) continue;
              peer.applyUpdate(update.bytes);
              if (random.chance(0.25)) peer.applyUpdate(update.bytes);
            }
            applyAuthoritativeSync(authority, peer, `final-sync-${target}`);
            random.trace(`peer=${target} authoritative-sync`);
          });

          const expected = canonicalStudioCrdtProjection(authority);
          for (let index = 0; index < peers.length; index += 1) {
            expect(
              canonicalStudioCrdtProjection(peers[index]!),
              `peer ${index} diverged`
            ).toBe(expected);
          }
        } finally {
          for (const unsubscribe of unsubscribers) unsubscribe();
          for (const peer of peers) peer.destroy();
          authority.destroy();
        }
      });
    }
  );

  it.each(F754_PROPERTY_SEEDS.slice(0, 3))(
    "converges after dual publish, corrupt binary reconnect and gated outbox drain (seed=%i)",
    async (seed) => {
      const random = new F754SeededRandom(seed);
      await withF754PropertyTrace(random, async () => {
        const serverDocument = new StudioCrdtDocument();
        const clientDocument = new StudioCrdtDocument();
        setDeterministicStudioCrdtClientId(
          serverDocument,
          0x0300_0000 + (seed % 0x000f_ffff)
        );
        setDeterministicStudioCrdtClientId(
          clientDocument,
          0x0400_0000 + (seed % 0x000f_ffff)
        );
        const timers = new F754ManualTimers();
        const socket = new F754BinaryServerSocket(
          { sessionToken: SESSION_TOKEN },
          serverDocument
        );
        const outbox = new F754MemoryOutbox();
        const room = new StudioLiveRoom({
          workId: WORK_ID,
          participant: propertyParticipant(),
          dependencies: {
            transportFactory: createStudioServerLiveTransportFactory(
              SESSION_TOKEN,
              {
                createSocket: (auth) => {
                  socket.auth = { ...auth };
                  return socket;
                },
                setTimeout: timers.setTimeout,
                clearTimeout: timers.clearTimeout,
                randomId: (() => {
                  let id = 0;
                  return () =>
                    `00000000-0000-4000-8000-${String(
                      5_000 + ++id
                    ).padStart(12, "0")}`;
                })(),
              }
            ),
          },
        });
        const binding = new StudioCrdtRoomBinding({
          document: clientDocument,
          room,
          outbox,
          recoveryVault: new F754RecoveryVault(),
          outboxScope: OUTBOX_SCOPE,
          randomId: (() => {
            let id = 0;
            return () =>
              `00000000-0000-4000-8000-${String(
                7_000 + ++id
              ).padStart(12, "0")}`;
          })(),
        });
        const crdtEvents: StudioLiveCrdtRoomEvent[] = [];
        const unsubscribeEvents = room.subscribeCrdt((event) => crdtEvents.push(event));

        try {
          await room.start();
          await binding.start();
          random.trace("initial join→select→authoritative binary sync complete");

          const publication = socket.authorRemoteStroke(
            "00000000-0000-4000-8000-00000000d001",
            `dual-${seed}`,
            50,
            random.integer(0, 8)
          );
          const order = random.chance(0.5)
            ? ["legacy", "binary"] as const
            : ["binary", "legacy"] as const;
          for (const kind of order) {
            socket.serverEmit(
              kind === "legacy"
                ? "studio:crdt:update"
                : STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT,
              kind === "legacy" ? publication.legacy : publication.binary
            );
          }
          if (random.chance(0.75)) {
            socket.serverEmit("studio:crdt:update", publication.legacy);
            socket.serverEmit(
              STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT,
              publication.binary
            );
          }
          random.trace(`dual publish order=${order.join("→")}`);
          expect(
            crdtEvents.filter(
              (event) =>
                event.type === "update" &&
                event.update.updateId === publication.updateId
            )
          ).toHaveLength(1);
          expect(clientDocument.getStroke(`dual-${seed}`)).not.toBeNull();

          const missed = socket.authorRemoteStroke(
            "00000000-0000-4000-8000-00000000d002",
            `missed-${seed}`,
            70,
            random.integer(0, 8)
          );
          const corrupted = encodeStudioCrdtBinaryEnvelope("update", missed.raw);
          corrupted[corrupted.byteLength - 1] ^= 0xff;
          socket.holdNextBinarySync = true;
          const publicationsBeforeReconnect = socket.emitted.filter(
            ({ event }) => event === STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT
          ).length;
          socket.serverEmit(STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT, {
            ...missed.binary,
            update: corrupted,
          });
          random.trace("corrupt remote forced fail-closed disconnect");
          expect(room.ready).toBe(false);

          const offlineStrokeId = `offline-${seed}`;
          addStroke(
            clientDocument,
            offlineStrokeId,
            90,
            random.integer(0, 8)
          );
          binding.flush();
          await settleF754Microtasks();
          expect(outbox.requests.size).toBeGreaterThan(0);
          for (const request of outbox.requests.values()) {
            expect(typeof request.update).toBe("string");
            expect(() => decodeStudioCrdtUpdate(request.update)).not.toThrow();
          }
          expect(
            socket.emitted.filter(
              ({ event }) => event === STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT
            )
          ).toHaveLength(publicationsBeforeReconnect);
          random.trace(`offline outbox rows=${outbox.requests.size}`);

          timers.runZeroDelay();
          await settleF754Microtasks();
          expect(socket.joinCount).toBe(2);
          expect(socket.heldBinarySync).not.toBeNull();
          expect(clientDocument.getStroke(`missed-${seed}`)).toBeNull();
          expect(
            socket.emitted.filter(
              ({ event }) => event === STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT
            )
          ).toHaveLength(publicationsBeforeReconnect);
          random.trace("rejoin/select complete; authoritative sync held; drain still gated");

          socket.releaseHeldBinarySync();
          await settleF754Microtasks(24);
          await binding.flushAndWaitForAuthoritativeAck();
          await settleF754Microtasks(12);
          random.trace("authoritative sync released; outbox drained");

          expect(clientDocument.getStroke(`missed-${seed}`)).not.toBeNull();
          expect(serverDocument.getStroke(offlineStrokeId)).not.toBeNull();
          expect(canonicalStudioCrdtProjection(clientDocument)).toBe(
            canonicalStudioCrdtProjection(serverDocument)
          );
          expect(outbox.requests.size).toBe(0);
          expect(socket.joinCount).toBe(2);
        } finally {
          unsubscribeEvents();
          binding.close();
          room.close();
          clientDocument.destroy();
          serverDocument.destroy();
        }
      });
    }
  );
});
