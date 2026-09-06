import { describe, expect, it } from "vitest";

import { buildStudioWillV1OpcBytes } from "./studio-will-v1-opc-interchange";
import {
  packStudioWillV1OpcBuildResult,
  packStudioWillV1OpcExportInput,
} from "./studio-will-v1-opc-packed-codec";
import {
  STUDIO_WILL_V1_OPC_WORKER_MAX_PACKED_POINTS,
  STUDIO_WILL_V1_OPC_WORKER_MAX_STRUCTURED_CLONE_POINTS,
  STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
  isStudioWillV1OpcWorkerRequest,
  isStudioWillV1OpcWorkerResponse,
  studioWillV1OpcWorkerCorrelation,
  studioWillV1OpcWorkerRequestTransfers,
  studioWillV1OpcWorkerResponseTransfers,
  type StudioWillV1OpcWorkerEncodeRequest,
  type StudioWillV1OpcWorkerEncodeSuccess,
} from "./studio-will-v1-opc-worker-protocol";

const SAMPLE_INPUT = {
  width: 32,
  height: 24,
  title: "Packed protocol",
  paths: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
      strokeWidths: [1, 2],
      strokeColor: { r: 10, g: 20, b: 30, a: 255 },
    },
  ],
};

function encodeRequest(): StudioWillV1OpcWorkerEncodeRequest {
  return {
    type: "studio-will-v1-opc/encode",
    version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
    requestId: "packed-encode",
    packedInput: packStudioWillV1OpcExportInput(SAMPLE_INPUT),
  };
}

describe("WILL v1 OPC Worker packed protocol", () => {
  it("uses v2 packed transport and eliminates the object-clone point allowance", () => {
    expect(STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION).toBe(2);
    expect(STUDIO_WILL_V1_OPC_WORKER_MAX_STRUCTURED_CLONE_POINTS).toBe(0);
    expect(STUDIO_WILL_V1_OPC_WORKER_MAX_PACKED_POINTS).toBe(1_000_000);
    const request = encodeRequest();
    expect(isStudioWillV1OpcWorkerRequest(request)).toBe(true);
    expect("input" in request).toBe(false);
    expect(request.packedInput).toBeInstanceOf(Uint8Array);
  });

  it("accepts only exact request keys, versions, owned packets, and options", () => {
    const request = encodeRequest();
    expect(isStudioWillV1OpcWorkerRequest({ ...request, extra: true })).toBe(false);
    expect(isStudioWillV1OpcWorkerRequest({ ...request, version: 1 })).toBe(false);
    expect(isStudioWillV1OpcWorkerRequest({
      ...request,
      options: { willLimits: { maxTotalPoints: 1_000_001 } },
    })).toBe(false);

    const backing = new Uint8Array(request.packedInput.byteLength + 2);
    backing.set(request.packedInput, 1);
    expect(isStudioWillV1OpcWorkerRequest({
      ...request,
      packedInput: backing.subarray(1, -1),
    })).toBe(false);

    const hostile = Object.defineProperty({}, "type", {
      enumerable: true,
      get: () => "studio-will-v1-opc/encode",
    });
    expect(isStudioWillV1OpcWorkerRequest(hostile)).toBe(false);
  });

  it("transfers exact dedicated buffers once and never transfers Blob input", async () => {
    const request = encodeRequest();
    expect(studioWillV1OpcWorkerRequestTransfers(request)).toEqual([
      request.packedInput.buffer,
    ]);

    const decodeBytes = new Uint8Array([1, 2, 3]);
    expect(studioWillV1OpcWorkerRequestTransfers({
      type: "studio-will-v1-opc/decode",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "decode",
      source: decodeBytes,
    })).toEqual([decodeBytes.buffer]);
    expect(studioWillV1OpcWorkerRequestTransfers({
      type: "studio-will-v1-opc/decode",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "blob",
      source: new Blob([decodeBytes]),
    })).toEqual([]);

    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const response: StudioWillV1OpcWorkerEncodeSuccess = {
      type: "studio-will-v1-opc/encode-success",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "response",
      archive: built.bytes.slice(),
      packedResult: packStudioWillV1OpcBuildResult(built),
    };
    expect(isStudioWillV1OpcWorkerResponse(response)).toBe(true);
    expect(studioWillV1OpcWorkerResponseTransfers(response)).toEqual([
      response.archive.buffer,
      response.packedResult.buffer,
    ]);

    const shared = response.archive;
    expect(isStudioWillV1OpcWorkerResponse({
      ...response,
      packedResult: shared,
    })).toBe(false);
    expect(studioWillV1OpcWorkerResponseTransfers({
      ...response,
      packedResult: shared,
    })).toEqual([]);
  });

  it("fails closed on malformed packed responses and preserves correlation", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const packet = packStudioWillV1OpcBuildResult(built);
    packet[0] = 0;
    expect(isStudioWillV1OpcWorkerResponse({
      type: "studio-will-v1-opc/encode-success",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "bad",
      archive: built.bytes.slice(),
      packedResult: packet,
    })).toBe(false);
    expect(studioWillV1OpcWorkerCorrelation({
      type: "studio-will-v1-opc/encode-success",
      requestId: "bad",
    })).toEqual({ requestId: "bad", operation: "encode" });
  });

  it("accepts only bounded typed failure payloads", () => {
    const failure = {
      type: "studio-will-v1-opc/failure",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "failure",
      operation: "decode",
      error: {
        code: "ARCHIVE_INVALID",
        name: "StudioWillV1OpcInterchangeError",
        message: "archive invalid",
      },
    };
    expect(isStudioWillV1OpcWorkerResponse(failure)).toBe(true);
    expect(isStudioWillV1OpcWorkerResponse({
      ...failure,
      error: { ...failure.error, cause: "/private/path" },
    })).toBe(false);
  });
});
