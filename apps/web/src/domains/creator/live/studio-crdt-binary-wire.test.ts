import { describe, expect, it } from "vitest";

import {
  createStudioCrdtBinarySelectionRequest,
  createStudioCrdtBinarySyncRequest,
  createStudioCrdtBinaryUpdateRequest,
  parseStudioCrdtBinaryRemoteUpdate,
  parseStudioCrdtBinarySelection,
  parseStudioCrdtBinarySyncResponse,
  parseStudioCrdtBinaryUpdateAck,
  parseStudioCrdtWireAdvertisement,
  STUDIO_CRDT_BINARY_WIRE_FORMAT,
  STUDIO_CRDT_BINARY_WIRE_VERSION,
} from "./studio-crdt-binary-wire";
import {
  decodeStudioCrdtStateVector,
  decodeStudioCrdtSyncChunks,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtUpdate,
  STUDIO_CRDT_PROTOCOL_VERSION,
} from "./studio-crdt-protocol";

import {
  encodeStudioCrdtBinaryEnvelope,
  fragmentStudioCrdtBinarySyncEnvelope,
} from "@/shared/lib/studio-crdt-binary-envelope";

const WORK_ID = "work-1";
const REQUEST_ID = "request-1";
const UPDATE_ID = "00000000-0000-4000-8000-000000000001";
const TRANSFER_ID = "00000000-0000-4000-8000-000000000002";
const EPOCH = "00000000-0000-4000-8000-000000000003";

describe("studio CRDT binary client wire", () => {
  it("accepts only the exact additive join advertisement", () => {
    expect(parseStudioCrdtWireAdvertisement({})).toBeNull();
    expect(parseStudioCrdtWireAdvertisement({
      crdtWireFormats: ["binary-v1", "base64-v4"],
      crdtWireSelectionEpoch: EPOCH,
    })).toEqual({
      formats: ["binary-v1", "base64-v4"],
      selectionEpoch: EPOCH,
    });

    for (const malformed of [
      { crdtWireFormats: ["base64-v4", "binary-v1"], crdtWireSelectionEpoch: EPOCH },
      { crdtWireFormats: ["binary-v1"], crdtWireSelectionEpoch: EPOCH },
      { crdtWireFormats: ["binary-v1", "base64-v4"] },
      { crdtWireSelectionEpoch: EPOCH },
      { crdtWireFormats: ["binary-v1", "base64-v4"], crdtWireSelectionEpoch: "stale" },
    ]) {
      expect(parseStudioCrdtWireAdvertisement(malformed)).toBe(false);
    }
  });

  it("correlates the select acknowledgement to the exact work and epoch", () => {
    expect(createStudioCrdtBinarySelectionRequest(WORK_ID, EPOCH)).toEqual({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: WORK_ID,
      format: STUDIO_CRDT_BINARY_WIRE_FORMAT,
      selectionEpoch: EPOCH,
    });
    const selection = {
      ...createStudioCrdtBinarySelectionRequest(WORK_ID, EPOCH),
      selected: true,
    };
    expect(parseStudioCrdtBinarySelection(selection, {
      workId: WORK_ID,
      selectionEpoch: EPOCH,
    })).toEqual(selection);
    expect(parseStudioCrdtBinarySelection(
      { ...selection, selectionEpoch: UPDATE_ID },
      { workId: WORK_ID, selectionEpoch: EPOCH }
    )).toBeNull();
    expect(parseStudioCrdtBinarySelection(
      { ...selection, selected: false },
      { workId: WORK_ID, selectionEpoch: EPOCH }
    )).toBeNull();
  });

  it("encodes state vectors and updates into owned binary envelopes", () => {
    const stateVector = Uint8Array.of(1, 2, 3);
    const sync = createStudioCrdtBinarySyncRequest({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: WORK_ID,
      requestId: REQUEST_ID,
      stateVector: encodeStudioCrdtStateVector(stateVector),
    });
    expect(sync).toMatchObject({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: WORK_ID,
      requestId: REQUEST_ID,
    });
    expect(
      decodeStudioCrdtStateVector(
        encodeStudioCrdtStateVector(
          // The common envelope decoder is covered independently; the request must not be Base64.
          sync.stateVector.subarray(24)
        )
      )
    ).toEqual(stateVector);

    const update = Uint8Array.of(4, 5, 6);
    const publication = createStudioCrdtBinaryUpdateRequest({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: WORK_ID,
      updateId: UPDATE_ID,
      clientSequence: 7,
      update: encodeStudioCrdtUpdate(update),
    });
    expect(publication).toMatchObject({
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      updateId: UPDATE_ID,
      clientSequence: 7,
    });
    expect(publication.update).toBeInstanceOf(Uint8Array);
    expect(publication.update.subarray(24)).toEqual(update);
  });

  it("reassembles a fragmented sync response and projects it onto the stable CRDT API", () => {
    const diff = new Uint8Array(90_000);
    diff[0] = 17;
    diff[diff.length - 1] = 91;
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(
      encodeStudioCrdtBinaryEnvelope("sync-diff", diff)
    );
    const serverVector = Uint8Array.of(7, 8, 9);
    const response = parseStudioCrdtBinarySyncResponse({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: WORK_ID,
      requestId: REQUEST_ID,
      transferId: TRANSFER_ID,
      fragments,
      fragmentCount: fragments.length,
      wireBytes: fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0),
      totalBytes: diff.byteLength,
      serverStateVector: encodeStudioCrdtBinaryEnvelope("state-vector", serverVector),
      serverSequence: "42",
    }, { expectedWorkId: WORK_ID });

    expect(response).not.toBeNull();
    expect(decodeStudioCrdtSyncChunks(
      response?.chunks ?? [],
      response?.totalBytes
    )).toEqual(diff);
    expect(decodeStudioCrdtStateVector(response?.serverStateVector ?? "")).toEqual(
      serverVector
    );
  });

  it("fails closed on damaged, reordered, truncated, or inconsistent sync fragments", () => {
    const diff = new Uint8Array(82_000);
    diff[0] = 1;
    diff[diff.length - 1] = 2;
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(
      encodeStudioCrdtBinaryEnvelope("sync-diff", diff)
    );
    const base = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: WORK_ID,
      requestId: REQUEST_ID,
      transferId: TRANSFER_ID,
      fragments,
      fragmentCount: fragments.length,
      wireBytes: fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0),
      totalBytes: diff.byteLength,
      serverStateVector: encodeStudioCrdtBinaryEnvelope(
        "state-vector",
        Uint8Array.of(1)
      ),
      serverSequence: "1",
    };

    expect(parseStudioCrdtBinarySyncResponse({
      ...base,
      fragments: [fragments[1], fragments[0], fragments[2]],
    }, { expectedWorkId: WORK_ID })).toBeNull();
    expect(parseStudioCrdtBinarySyncResponse({
      ...base,
      fragments: fragments.slice(1),
      fragmentCount: fragments.length - 1,
    }, { expectedWorkId: WORK_ID })).toBeNull();
    expect(parseStudioCrdtBinarySyncResponse({
      ...base,
      totalBytes: diff.byteLength - 1,
    }, { expectedWorkId: WORK_ID })).toBeNull();

    const corrupted = fragments.map((fragment) => fragment.slice());
    corrupted.at(-1)![corrupted.at(-1)!.length - 1] ^= 0xff;
    expect(parseStudioCrdtBinarySyncResponse({
      ...base,
      fragments: corrupted,
    }, { expectedWorkId: WORK_ID })).toBeNull();
  });

  it("projects binary ACKs and remotes without weakening legacy validation", () => {
    expect(parseStudioCrdtBinaryUpdateAck({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: WORK_ID,
      updateId: UPDATE_ID,
      serverSequence: "9",
      duplicate: false,
    }, { expectedWorkId: WORK_ID })).toEqual({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: WORK_ID,
      updateId: UPDATE_ID,
      serverSequence: "9",
      serverStateVector: null,
      duplicate: false,
    });

    const raw = Uint8Array.of(9, 8, 7);
    const remote = parseStudioCrdtBinaryRemoteUpdate({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: WORK_ID,
      updateId: UPDATE_ID,
      serverSequence: "10",
      update: encodeStudioCrdtBinaryEnvelope("update", raw),
    }, { expectedWorkId: WORK_ID });
    expect(remote).not.toBeNull();
    expect(decodeStudioCrdtUpdate(remote?.update ?? "")).toEqual(raw);

    const corrupted = encodeStudioCrdtBinaryEnvelope("update", raw);
    corrupted[corrupted.length - 1] ^= 0xff;
    expect(parseStudioCrdtBinaryRemoteUpdate({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: WORK_ID,
      updateId: UPDATE_ID,
      serverSequence: "10",
      update: corrupted,
    }, { expectedWorkId: WORK_ID })).toBeNull();
  });
});
