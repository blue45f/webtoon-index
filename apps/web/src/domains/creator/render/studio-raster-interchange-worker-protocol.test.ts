import { describe, expect, it } from "vitest";

import {
  encodeStudioRasterInterchange,
  STUDIO_RASTER_INTERCHANGE_LIMITS,
} from "./studio-raster-interchange";
import {
  parseStudioRasterInterchangeWorkerResponse,
  STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
  studioRasterInterchangeRequestTransfers,
  studioRasterInterchangeResponseTransfers,
  type StudioRasterInterchangeWorkerRequest,
  type StudioRasterInterchangeWorkerResponse,
} from "./studio-raster-interchange-worker-protocol";

const REQUEST_ID = "raster-worker-protocol-1";
const BITMAP = Object.freeze({
  width: 1,
  height: 1,
  data: new Uint8Array([10, 20, 30, 255]),
});

function encodeSuccess(
  overrides: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    type: "studio-raster-interchange/encode-success",
    version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    requestId: REQUEST_ID,
    result: encodeStudioRasterInterchange("qoi", BITMAP),
    ...overrides,
  };
}

function decodeSuccess(
  overrides: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    type: "studio-raster-interchange/decode-success",
    version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    requestId: REQUEST_ID,
    result: {
      bitmap: BITMAP,
      format: "qoi",
      warnings: [],
    },
    ...overrides,
  };
}

describe("studio raster interchange Worker response protocol", () => {
  it("accepts only exact own-data response envelopes and bounded metadata", () => {
    expect(
      parseStudioRasterInterchangeWorkerResponse({
        type: "studio-raster-interchange/ready",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      }),
    ).toEqual({
      type: "studio-raster-interchange/ready",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    });
    expect(
      parseStudioRasterInterchangeWorkerResponse(encodeSuccess()),
    ).toMatchObject({
      type: "studio-raster-interchange/encode-success",
      requestId: REQUEST_ID,
      result: {
        extension: ".qoi",
        mimeType: "image/qoi",
      },
    });
    expect(
      parseStudioRasterInterchangeWorkerResponse({
        ...(encodeSuccess() as object),
        extra: "must fail closed",
      }),
    ).toBeNull();
    expect(
      parseStudioRasterInterchangeWorkerResponse({
        type: "studio-raster-interchange/ready",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        get extra() {
          throw new Error("getter must never execute");
        },
      }),
    ).toBeNull();

    const encoded = encodeStudioRasterInterchange("qoi", BITMAP);
    expect(
      parseStudioRasterInterchangeWorkerResponse(encodeSuccess({
        result: {
          ...encoded,
          mimeType: "image/private-substitute",
        },
      })),
    ).toBeNull();
    expect(
      parseStudioRasterInterchangeWorkerResponse(encodeSuccess({
        result: {
          ...encoded,
          warnings: new Array(65).fill("warning"),
        },
      })),
    ).toBeNull();
  });

  it("rejects malformed dimensions, pixel counts and RGBA byte lengths", () => {
    expect(
      parseStudioRasterInterchangeWorkerResponse(decodeSuccess()),
    ).toMatchObject({
      type: "studio-raster-interchange/decode-success",
      result: {
        bitmap: { width: 1, height: 1 },
        format: "qoi",
      },
    });
    expect(
      parseStudioRasterInterchangeWorkerResponse(decodeSuccess({
        result: {
          bitmap: {
            width: 2,
            height: 2,
            data: new Uint8Array(4),
          },
          format: "qoi",
          warnings: [],
        },
      })),
    ).toBeNull();
    expect(
      parseStudioRasterInterchangeWorkerResponse(decodeSuccess({
        result: {
          bitmap: {
            width: STUDIO_RASTER_INTERCHANGE_LIMITS.maxWidth + 1,
            height: 1,
            data: new Uint8Array(4),
          },
          format: "qoi",
          warnings: [],
        },
      })),
    ).toBeNull();
    expect(
      parseStudioRasterInterchangeWorkerResponse(decodeSuccess({
        result: {
          bitmap: {
            width: Number.MAX_SAFE_INTEGER,
            height: 2,
            data: new Uint8Array(4),
          },
          format: "qoi",
          warnings: [],
        },
      })),
    ).toBeNull();
  });

  it("never transfers an aliased subarray and normalizes it to private ownership", () => {
    const encoded = encodeStudioRasterInterchange("qoi", BITMAP);
    const encodedOwner = new Uint8Array(encoded.bytes.byteLength + 4);
    encodedOwner.set(encoded.bytes, 2);
    const encodedSubview = encodedOwner.subarray(
      2,
      2 + encoded.bytes.byteLength,
    );
    const aliasedEncode = encodeSuccess({
      result: { ...encoded, bytes: encodedSubview },
    }) as StudioRasterInterchangeWorkerResponse;

    const encodeTransfers =
      studioRasterInterchangeResponseTransfers(aliasedEncode);
    if (aliasedEncode.type !== "studio-raster-interchange/encode-success") {
      throw new Error("encode success expected");
    }
    expect(encodeTransfers).toEqual([aliasedEncode.result.bytes.buffer]);
    expect(aliasedEncode.result.bytes).not.toBe(encodedSubview);
    expect(aliasedEncode.result.bytes.byteOffset).toBe(0);
    expect(aliasedEncode.result.bytes.buffer.byteLength).toBe(
      aliasedEncode.result.bytes.byteLength,
    );
    expect(aliasedEncode.result.bytes).toEqual(encoded.bytes);
    const parsedEncode =
      parseStudioRasterInterchangeWorkerResponse(aliasedEncode);
    expect(parsedEncode?.type).toBe(
      "studio-raster-interchange/encode-success",
    );
    if (parsedEncode?.type !== "studio-raster-interchange/encode-success") {
      throw new Error("encode success expected");
    }
    expect(parsedEncode.result.bytes).not.toBe(encodedSubview);
    expect(parsedEncode.result.bytes.byteOffset).toBe(0);
    expect(parsedEncode.result.bytes.buffer.byteLength).toBe(
      parsedEncode.result.bytes.byteLength,
    );
    expect(parsedEncode.result.bytes).toEqual(encoded.bytes);

    const pixelOwner = new Uint8ClampedArray([99, 10, 20, 30, 255, 88]);
    const pixelSubview = pixelOwner.subarray(1, 5);
    const aliasedDecode = decodeSuccess({
      result: {
        bitmap: { width: 1, height: 1, data: pixelSubview },
        format: "qoi",
        warnings: [],
      },
    }) as StudioRasterInterchangeWorkerResponse;
    const decodeTransfers =
      studioRasterInterchangeResponseTransfers(aliasedDecode);
    if (aliasedDecode.type !== "studio-raster-interchange/decode-success") {
      throw new Error("decode success expected");
    }
    expect(decodeTransfers).toEqual([
      aliasedDecode.result.bitmap.data.buffer,
    ]);
    expect(aliasedDecode.result.bitmap.data).not.toBe(pixelSubview);
    expect(aliasedDecode.result.bitmap.data.byteOffset).toBe(0);
    expect(aliasedDecode.result.bitmap.data.buffer.byteLength).toBe(4);
    expect([...aliasedDecode.result.bitmap.data]).toEqual([
      10,
      20,
      30,
      255,
    ]);
    const parsedDecode =
      parseStudioRasterInterchangeWorkerResponse(aliasedDecode);
    if (parsedDecode?.type !== "studio-raster-interchange/decode-success") {
      throw new Error("decode success expected");
    }
    expect(parsedDecode.result.bitmap.data).not.toBe(pixelSubview);
    expect(parsedDecode.result.bitmap.data.byteOffset).toBe(0);
    expect(parsedDecode.result.bitmap.data.buffer.byteLength).toBe(4);
    expect([...parsedDecode.result.bitmap.data]).toEqual([10, 20, 30, 255]);

    const requestOwner = new Uint8Array([99, 1, 2, 3, 88]);
    const aliasedRequest: StudioRasterInterchangeWorkerRequest = {
      type: "studio-raster-interchange/decode",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      requestId: REQUEST_ID,
      bytes: requestOwner.subarray(1, 4),
    };
    const requestSubview = aliasedRequest.bytes;
    const requestTransfers =
      studioRasterInterchangeRequestTransfers(aliasedRequest);
    expect(requestTransfers).toEqual([aliasedRequest.bytes.buffer]);
    expect(aliasedRequest.bytes).not.toBe(requestSubview);
    expect(aliasedRequest.bytes.byteOffset).toBe(0);
    expect(aliasedRequest.bytes.buffer.byteLength).toBe(3);
    expect([...aliasedRequest.bytes]).toEqual([1, 2, 3]);

    const exactRequest: StudioRasterInterchangeWorkerRequest = {
      ...aliasedRequest,
      bytes: Uint8Array.of(1, 2, 3),
    };
    expect(studioRasterInterchangeRequestTransfers(exactRequest)).toEqual([
      exactRequest.bytes.buffer,
    ]);
  });

  it("validates bounded exact failure envelopes without trusting raw prototypes", () => {
    expect(
      parseStudioRasterInterchangeWorkerResponse({
        type: "studio-raster-interchange/failure",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: REQUEST_ID,
        error: {
          name: "CodecFailure",
          message: "bounded internal failure",
        },
      }),
    ).toMatchObject({
      type: "studio-raster-interchange/failure",
      requestId: REQUEST_ID,
    });
    expect(
      parseStudioRasterInterchangeWorkerResponse({
        type: "studio-raster-interchange/failure",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: REQUEST_ID,
        error: {
          name: "CodecFailure",
          message: "bounded internal failure",
          stack: "/private/codec-worker.js",
        },
      }),
    ).toBeNull();
    expect(
      parseStudioRasterInterchangeWorkerResponse(Object.create({
        type: "studio-raster-interchange/ready",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      })),
    ).toBeNull();
  });
});
