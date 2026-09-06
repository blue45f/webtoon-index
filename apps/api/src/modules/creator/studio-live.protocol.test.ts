import { describe, expect, expectTypeOf, it } from "vitest";

import {
  STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES,
  STUDIO_CRDT_BINARY_UPDATE_MAX_BYTES,
  encodeStudioCrdtBinaryEnvelope,
  fragmentStudioCrdtBinarySyncEnvelope,
} from "../../../../web/src/shared/lib/studio-crdt-binary-envelope";

import * as gatewayCompatibility from "./studio-live.gateway";
import * as protocol from "./studio-live.protocol";

import type {
  StudioLiveAck,
  StudioLiveAuthPrincipal,
  StudioLiveCrdtSyncInput,
  StudioLiveCrdtUpdateInput,
  StudioLiveGesturePreviewInput,
  StudioLiveJoinResult,
  StudioLiveLockUpdate,
  StudioLiveParticipant,
  StudioLiveSessionAuthenticator,
  StudioLiveSessionRevalidator,
} from "./studio-live.protocol";

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function nonzeroOffsetView(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array(bytes.byteLength + 7);
  padded.set(bytes, 3);
  return padded.subarray(3, 3 + bytes.byteLength);
}

const publicParticipant = {
  connectionId: "socket-1",
  clientInstanceId: "client-1",
  name: "작가",
  role: "editor",
  capabilities: {
    view: true,
    comment: true,
    edit: true,
    manageMembers: false,
  },
  state: "active",
  pageId: "page-1",
  tool: "brush",
  sharingScreen: false,
  joinedAt: "2026-07-19T01:02:03.000Z",
  updatedAt: "2026-07-19T01:02:04.000Z",
} as const satisfies StudioLiveParticipant;

function gesturePreviewInput() {
  return {
    workId: "work-1",
    preview: {
      version: 1,
      gestureId: "gesture-protocol-1",
      pageId: "page-1",
      seq: 1,
      phase: "begin",
      operation: "erase",
      base: { documentGeneration: 12 },
      renderer: {
        kind: "freehand",
        mode: "eraser",
        stroke: "#112233",
        strokeWidth: 18,
        opacity: 0.75,
      },
      samples: {
        startIndex: 0,
        points: [12, 18, 20, 24],
        pressures: [0.5, 0.75],
      },
    },
  } satisfies StudioLiveGesturePreviewInput;
}

describe("studio live protocol module", () => {
  it("pins segmented causal stroke rooms to CRDT protocol v6", () => {
    expect(protocol.STUDIO_CRDT_PROTOCOL_VERSION).toBe(6);
    expect(protocol.STUDIO_CRDT_BINARY_WIRE_VERSION).toBe(1);
    expect(protocol.STUDIO_CRDT_BINARY_WIRE_FORMAT).toBe("binary-v1");
    expect(protocol.STUDIO_CRDT_LEGACY_WIRE_FORMAT).toBe("base64-v4");
    expect(protocol.STUDIO_CRDT_SUPPORTED_WIRE_FORMATS).toEqual([
      "binary-v1",
      "base64-v4",
    ]);
    expect(protocol.STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT).toBe("studio:crdt:wire:select");
    expect(protocol.STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT).toBe(
      "studio:crdt:sync:binary:v1"
    );
    expect(protocol.STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT).toBe(
      "studio:crdt:update:binary:v1"
    );
    expect(protocol.STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT).toBe(
      "studio:crdt:remote:binary:v1"
    );
    expect(protocol.STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT).toBe(
      "studio:gesture:preview"
    );
    expect(protocol.STUDIO_LIVE_LOCK_PROTOCOL_VERSION).toBe(2);
    expectTypeOf<StudioLiveJoinResult["crdtWireFormats"]>().toEqualTypeOf<
      readonly ["binary-v1", "base64-v4"] | undefined
    >();
    expectTypeOf<StudioLiveJoinResult["crdtWireSelectionEpoch"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("negotiates binary-v1 with a strict selection epoch without changing document v6", () => {
    const selection = {
      protocolVersion: 6,
      wireVersion: 1,
      workId: "work-1",
      format: "binary-v1",
      selectionEpoch: "00000000-0000-4000-8000-000000000101",
    } as const;

    expect(protocol.StudioLiveCrdtBinarySelectSchema.parse(selection)).toEqual(selection);
    expect(
      protocol.StudioLiveCrdtBinarySelectionSchema.safeParse({
        ...selection,
        selected: true,
      }).success
    ).toBe(true);
    expect(
      protocol.StudioLiveCrdtBinarySelectSchema.safeParse({
        ...selection,
        protocolVersion: 5,
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLiveCrdtBinarySelectSchema.safeParse({
        ...selection,
        wireVersion: 2,
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLiveCrdtBinarySelectSchema.safeParse({
        ...selection,
        format: "base64-v4",
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLiveCrdtBinarySelectSchema.safeParse({
        ...selection,
        selectionEpoch: "stale-epoch",
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLiveCrdtBinarySelectSchema.safeParse({
        ...selection,
        internalCapability: true,
      }).success
    ).toBe(false);
  });

  it("preserves the legacy base64-v4 schemas and inferred input types unchanged", () => {
    const legacySync = {
      protocolVersion: 6,
      workId: "work-1",
      requestId: "request-legacy",
      stateVector: Buffer.from([1, 2, 3]).toString("base64"),
    } as const satisfies StudioLiveCrdtSyncInput;
    const legacyUpdate = {
      protocolVersion: 6,
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000106",
      clientSequence: 1,
      update: Buffer.from([4, 5, 6]).toString("base64"),
    } as const satisfies StudioLiveCrdtUpdateInput;

    expect(protocol.StudioLiveCrdtSyncSchema.parse(legacySync)).toEqual(legacySync);
    expect(protocol.StudioLiveCrdtUpdateSchema.parse(legacyUpdate)).toEqual(
      legacyUpdate
    );
    expectTypeOf<StudioLiveCrdtSyncInput["stateVector"]>().toBeString();
    expectTypeOf<StudioLiveCrdtUpdateInput["update"]>().toBeString();
  });

  it("composes the strict gesture preview mirror without admitting wrapper or resource extensions", () => {
    const input = gesturePreviewInput();

    expect(protocol.StudioLiveGesturePreviewSchema.parse(input)).toEqual(input);
    expect(
      protocol.StudioLiveGesturePreviewSchema.safeParse({
        ...input,
        transportHint: "socket",
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLiveGesturePreviewSchema.safeParse({
        ...input,
        preview: {
          ...input.preview,
          renderer: {
            ...input.preview.renderer,
            brush: "blob:untrusted-brush",
          },
        },
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLiveGesturePreviewSchema.safeParse({
        ...input,
        preview: { ...input.preview, privateAssetUrl: "https://example.com/brush.png" },
      }).success
    ).toBe(false);
    expectTypeOf<StudioLiveGesturePreviewInput["preview"]>().toHaveProperty(
      "gestureId"
    );
    expect(gatewayCompatibility.StudioLiveGesturePreviewSchema).toBe(
      protocol.StudioLiveGesturePreviewSchema
    );
    expect(gatewayCompatibility.STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT).toBe(
      protocol.STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT
    );
  });

  it("normalizes owned sync and update bytes only after binary envelope validation", () => {
    const stateVectorBytes = Uint8Array.of(0, 1, 2, 127, 128, 254, 255);
    const stateVectorEnvelope = encodeStudioCrdtBinaryEnvelope(
      "state-vector",
      stateVectorBytes
    );
    const offsetStateVector = nonzeroOffsetView(stateVectorEnvelope);
    const sync = protocol.StudioLiveCrdtBinarySyncSchema.parse({
      protocolVersion: 6,
      wireVersion: 1,
      workId: "work-1",
      requestId: "request-1",
      stateVector: offsetStateVector,
    });
    offsetStateVector.fill(0);
    expect(sync.stateVector).toEqual(stateVectorBytes);

    const updateBytes = Uint8Array.of(9, 8, 7, 6, 5);
    const updateEnvelope = encodeStudioCrdtBinaryEnvelope("update", updateBytes);
    const update = protocol.StudioLiveCrdtBinaryUpdateSchema.parse({
      protocolVersion: 6,
      wireVersion: 1,
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000102",
      clientSequence: 1,
      update: exactArrayBuffer(updateEnvelope),
    });
    expect(update.update).toEqual(updateBytes);
    expect(
      protocol.StudioLiveCrdtBinaryRemoteUpdateSchema.parse({
        protocolVersion: 6,
        wireVersion: 1,
        workId: "work-1",
        updateId: "00000000-0000-4000-8000-000000000102",
        serverSequence: "12",
        update: Buffer.from(updateEnvelope),
      }).update
    ).toEqual(updateBytes);

    const wrongKind = encodeStudioCrdtBinaryEnvelope(
      "state-vector",
      Uint8Array.of(1)
    );
    const badChecksum = encodeStudioCrdtBinaryEnvelope(
      "update",
      Uint8Array.of(1, 2, 3)
    );
    badChecksum[badChecksum.byteLength - 1] ^= 0xff;
    const oversizedUpdate = encodeStudioCrdtBinaryEnvelope(
      "sync-diff",
      new Uint8Array(STUDIO_CRDT_BINARY_UPDATE_MAX_BYTES + 1)
    );
    oversizedUpdate[5] = 1;
    const baseUpdate = {
      protocolVersion: 6,
      wireVersion: 1,
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000103",
      clientSequence: 2,
    };
    for (const invalidUpdate of [
      Uint8Array.of(1, 2, 3),
      wrongKind,
      badChecksum,
      oversizedUpdate,
    ]) {
      expect(
        protocol.StudioLiveCrdtBinaryUpdateSchema.safeParse({
          ...baseUpdate,
          update: invalidUpdate,
        }).success
      ).toBe(false);
    }
    expect(
      protocol.StudioLiveCrdtBinaryUpdateSchema.safeParse({
        ...baseUpdate,
        update: updateEnvelope,
        legacyFallback: Buffer.from(updateBytes).toString("base64"),
      }).success
    ).toBe(false);
  });

  it("validates one fragmented sync envelope and its exact outer byte metadata", () => {
    const diffBytes = Uint8Array.from(
      { length: STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES * 2 + 17 },
      (_, index) => index & 0xff
    );
    const syncEnvelope = encodeStudioCrdtBinaryEnvelope("sync-diff", diffBytes);
    const originalFragments = fragmentStudioCrdtBinarySyncEnvelope(syncEnvelope);
    const thirdOffsetFragment = nonzeroOffsetView(originalFragments[2]!);
    const wireFragments = [
      Buffer.from(originalFragments[0]!),
      exactArrayBuffer(originalFragments[1]!),
      thirdOffsetFragment,
    ];
    const stateVectorBytes = Uint8Array.of(1, 3, 3, 7);
    const stateVectorEnvelope = encodeStudioCrdtBinaryEnvelope(
      "state-vector",
      stateVectorBytes
    );
    const response = {
      protocolVersion: 6,
      wireVersion: 1,
      workId: "work-1",
      requestId: "request-1",
      transferId: "00000000-0000-4000-8000-000000000104",
      fragments: wireFragments,
      fragmentCount: wireFragments.length,
      wireBytes: syncEnvelope.byteLength,
      totalBytes: diffBytes.byteLength,
      serverStateVector: stateVectorEnvelope,
      serverSequence: "42",
    };

    const parsed = protocol.StudioLiveCrdtBinarySyncResultSchema.parse(response);
    const corruptedFragments =
      fragmentStudioCrdtBinarySyncEnvelope(syncEnvelope).map((fragment) =>
        fragment.slice()
      );
    corruptedFragments[corruptedFragments.length - 1]![
      corruptedFragments.at(-1)!.byteLength - 1
    ] ^= 0xff;
    const invalidResponses = [
      { ...response, fragmentCount: response.fragmentCount + 1 },
      { ...response, wireBytes: response.wireBytes - 1 },
      { ...response, totalBytes: response.totalBytes + 1 },
      {
        ...response,
        serverStateVector: encodeStudioCrdtBinaryEnvelope(
          "update",
          Uint8Array.of(1)
        ),
      },
      { ...response, fragments: corruptedFragments },
      {
        ...response,
        fragments: [diffBytes.subarray(0, 100)],
        fragmentCount: 1,
        wireBytes: 100,
        totalBytes: 100,
      },
      {
        ...response,
        fragments: [
          originalFragments[0]!.subarray(1),
          ...originalFragments.slice(1),
        ],
      },
      { ...response, internalWireHint: "unsafe" },
    ];
    for (const invalidResponse of invalidResponses) {
      expect(
        protocol.StudioLiveCrdtBinarySyncResultSchema.safeParse(invalidResponse)
          .success
        ).toBe(false);
    }

    thirdOffsetFragment.fill(0);
    expect(parsed.diff).toEqual(diffBytes);
    expect(parsed.serverStateVector).toEqual(stateVectorBytes);
    expect(parsed.fragments).toHaveLength(3);
    expect(parsed.fragments[0]).toHaveLength(
      STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES
    );
  });

  it("owns strict binary update ACK and remote metadata contracts", () => {
    const ack = {
      protocolVersion: 6,
      wireVersion: 1,
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000105",
      serverSequence: "123",
      duplicate: false,
    } as const;
    expect(protocol.StudioLiveCrdtBinaryUpdateAckSchema.parse(ack)).toEqual(ack);
    expect(
      protocol.StudioLiveCrdtBinaryUpdateAckSchema.safeParse({
        ...ack,
        serverSequence: "0123",
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLiveCrdtBinaryUpdateAckSchema.safeParse({
        ...ack,
        serverStateVector: "legacy-base64",
      }).success
    ).toBe(false);

    const updateEnvelope = encodeStudioCrdtBinaryEnvelope(
      "update",
      Uint8Array.of(5, 4, 3, 2, 1)
    );
    expect(
      protocol.StudioLiveCrdtBinaryRemoteUpdateSchema.safeParse({
        protocolVersion: 6,
        wireVersion: 1,
        workId: "work-1",
        updateId: ack.updateId,
        serverSequence: "124",
        update: updateEnvelope,
      }).success
    ).toBe(true);
    expect(
      protocol.StudioLiveCrdtBinaryRemoteUpdateSchema.safeParse({
        protocolVersion: 6,
        wireVersion: 1,
        workId: "work-1",
        updateId: ack.updateId,
        serverSequence: "124",
        update: Uint8Array.of(5, 4, 3, 2, 1),
      }).success
    ).toBe(false);
  });

  it("validates v2 renewal fences and correlated release requests strictly", () => {
    const renewal = {
      workId: "work-1",
      resourceId: "page:page-1",
      protocolVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000001",
      renewLeaseId: "lease-1",
      leaseMs: 15_000,
    };
    expect(protocol.StudioLiveLockRequestSchema.safeParse(renewal).success).toBe(true);
    expect(
      protocol.StudioLiveLockRequestSchema.safeParse({ ...renewal, renewLeaseId: "x".repeat(81) })
        .success
    ).toBe(false);
    expect(
      protocol.StudioLiveLockRequestSchema.safeParse({ ...renewal, protocolVersion: 1 }).success
    ).toBe(false);
    const { protocolVersion: _protocolVersion, ...renewalWithoutVersion } = renewal;
    expect(
      protocol.StudioLiveLockRequestSchema.safeParse(renewalWithoutVersion).success
    ).toBe(false);
    const { requestId: _requestId, ...v2WithoutRequestId } = renewal;
    expect(
      protocol.StudioLiveLockRequestSchema.safeParse(v2WithoutRequestId).success
    ).toBe(false);

    const release = {
      workId: "work-1",
      resourceId: "page:page-1",
      leaseId: "lease-2",
      requestId: "00000000-0000-4000-8000-000000000002",
    };
    expect(protocol.StudioLiveLockReleaseSchema.safeParse(release).success).toBe(true);
    expect(
      protocol.StudioLiveLockReleaseSchema.safeParse({ ...release, requestId: "not-a-uuid" })
        .success
    ).toBe(false);
    expect(
      protocol.StudioLiveLockReleaseSchema.safeParse({ ...release, internalNonce: "private" })
        .success
    ).toBe(false);
  });

  it("owns strict public participant and inter-server relay wire contracts", () => {
    expect(protocol.StudioLivePublicParticipantSchema.safeParse(publicParticipant).success).toBe(
      true
    );
    expect(
      protocol.StudioLiveActiveScreenShareSchema.safeParse({
        connectionId: "socket-1",
        shareId: "share-1",
        label: "작업 화면",
      }).success
    ).toBe(true);
    expect(
      protocol.StudioLiveActiveScreenShareSchema.safeParse({
        connectionId: "socket-1",
        shareId: "share-1",
        label: "작업 화면",
        userId: "private-user-id",
      }).success
    ).toBe(false);
    expect(
      protocol.StudioLivePublicParticipantSchema.safeParse({
        ...publicParticipant,
        userId: "private-user-id",
      }).success
    ).toBe(false);

    const request = {
      workId: "work-1",
      targetConnectionId: "socket-2",
      deadlineAt: Date.now() + 2_000,
      sender: publicParticipant,
      relay: {
        type: "screen-request",
        shareId: "share-1",
      },
    } as const;
    expect(protocol.StudioLiveInterServerRelayRequestSchema.safeParse(request).success).toBe(true);
    expect(
      protocol.StudioLiveInterServerRelayRequestSchema.safeParse({
        ...request,
        relay: { ...request.relay, userId: "private-user-id" },
      }).success
    ).toBe(false);
  });

  it("keeps ACK and authentication contracts independently consumable", () => {
    expectTypeOf<StudioLiveAck<{ accepted: true }>>().toEqualTypeOf<
      | { ok: true; data: { accepted: true } }
      | {
          ok: false;
          code:
            | "unauthenticated"
            | "forbidden"
            | "invalid_payload"
            | "not_joined"
            | "rate_limited"
            | "lock_conflict"
            | "lock_stale"
            | "lock_limit"
            | "peer_unavailable"
            | "temporarily_unavailable"
            | "storage_corruption"
            | "internal_error";
          message: string;
        }
    >();
    expectTypeOf<StudioLiveSessionAuthenticator>().returns.resolves.toEqualTypeOf<
      StudioLiveAuthPrincipal | null
    >();
    expectTypeOf<StudioLiveSessionRevalidator>().returns.resolves.toBeBoolean();
    expectTypeOf<Extract<StudioLiveLockUpdate, { action: "released" }>>()
      .toHaveProperty("releaseRequestId");
    expectTypeOf<Extract<StudioLiveLockUpdate, { action: "expired" | "revoked" }>>()
      .not.toHaveProperty("releaseRequestId");

    expect(protocol.studioLiveSessionAuthenticatorProvider.provide).toBe(
      protocol.STUDIO_LIVE_SESSION_AUTHENTICATOR
    );
    expect(protocol.studioLiveSessionRevalidatorProvider.provide).toBe(
      protocol.STUDIO_LIVE_SESSION_REVALIDATOR
    );
  });

  it("preserves every pre-existing gateway value export as the same protocol singleton", () => {
    const compatibilityExports = [
      "STUDIO_LIVE_SESSION_AUTHENTICATOR",
      "STUDIO_LIVE_SESSION_REVALIDATOR",
      "StudioLiveChatSchema",
      "StudioLiveCrdtSyncSchema",
      "StudioLiveCrdtUpdateSchema",
      "StudioLiveCursorSchema",
      "StudioLiveJoinSchema",
      "StudioLiveLockReleaseSchema",
      "StudioLiveLockRequestSchema",
      "StudioLivePresenceSchema",
      "StudioLiveScreenAccessSchema",
      "StudioLiveScreenAnnounceSchema",
      "StudioLiveScreenRequestSchema",
      "StudioLiveScreenStateSchema",
      "StudioLiveScreenStopSchema",
      "StudioLiveSignalSchema",
      "StudioLiveVoiceJoinSchema",
      "StudioLiveVoiceLeaveSchema",
      "StudioLiveVoiceSignalSchema",
      "StudioLiveVoiceStateSchema",
      "studioLiveSessionAuthenticatorProvider",
      "studioLiveSessionRevalidatorProvider",
    ] as const;

    for (const exportName of compatibilityExports) {
      expect(gatewayCompatibility[exportName]).toBe(protocol[exportName]);
    }
  });
});
