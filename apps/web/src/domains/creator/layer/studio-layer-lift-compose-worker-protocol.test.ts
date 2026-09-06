import { Image, encodePng } from "image-js";
import { describe, expect, it } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  StudioLayerLiftComposeWorkerProtocolError,
  createStudioLayerLiftComposeWorkerRequest,
  createStudioLayerLiftComposeWorkerResult,
  decodeStudioLayerLiftComposeWorkerRequest,
  isStudioLayerLiftComposeWorkerRequest,
  isStudioLayerLiftComposeWorkerResponse,
  studioLayerLiftComposeWorkerRequestTransfers,
  studioLayerLiftComposeWorkerResponseIdentity,
  studioLayerLiftComposeWorkerResultTransfers,
} from "./studio-layer-lift-compose-worker-protocol";
import {
  executeStudioLayerLiftComposeWorkerMessage,
} from "./studio-layer-lift-compose.worker";
import {
  composeStudioLayerLiftBeta,
} from "./studio-layer-lift-compositor";

import type {
  StudioLayerLiftComposeWorkerRequest,
  StudioLayerLiftComposeWorkerResult,
} from "./studio-layer-lift-compose-worker-protocol";
import type {
  StudioLayerLiftCompositorInput,
  StudioLayerLiftCompositorPngEncoder,
} from "./studio-layer-lift-compositor";

function hash(bytes: Uint8Array | Uint8ClampedArray): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new Uint8Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ))}`;
}

function digest(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function input(): StudioLayerLiftCompositorInput {
  const sourceRgba = Uint8ClampedArray.from([
    10, 20, 30, 255,
    200, 10, 20, 128,
    50, 60, 70, 255,
    90, 100, 110, 255,
  ]);
  const foregroundMask = Uint8Array.from([0, 255, 128, 0]);
  return {
    requestId: "worker-request",
    sourceId: "worker-source",
    width: 4,
    height: 1,
    sourceSha256: hash(sourceRgba),
    sourceRgba,
    providerReceiptSha256: digest("a"),
    providerLayers: [{
      layerId: "character",
      role: "character",
      order: 0,
      rgbaSha256: digest("b"),
      maskSha256: hash(foregroundMask),
    }],
    foregroundLayerId: "character",
    foregroundMaskSha256: hash(foregroundMask),
    foregroundMask,
    backgroundOutputId: "background-output",
    foregroundOutputId: "foreground-output",
    fillTilePixels: 8,
  };
}

const encodePlane: StudioLayerLiftCompositorPngEncoder = async (plane) => {
  const png = encodePng(new Image(plane.width, plane.height, {
    colorModel: "RGBA",
    bitDepth: 8,
    data: new Uint8Array(
      plane.bytes.buffer,
      plane.bytes.byteOffset,
      plane.bytes.byteLength,
    ),
  }));
  return png.slice().buffer as ArrayBuffer;
};

const decodeDimensions = async () => ({ width: 4, height: 1 });

function transferRequest(
  request: StudioLayerLiftComposeWorkerRequest,
): StudioLayerLiftComposeWorkerRequest {
  return structuredClone(request, {
    transfer: [...studioLayerLiftComposeWorkerRequestTransfers(request)],
  });
}

async function resultMessage(
  request: StudioLayerLiftComposeWorkerRequest,
): Promise<StudioLayerLiftComposeWorkerResult> {
  const decoded = decodeStudioLayerLiftComposeWorkerRequest(request);
  const result = await composeStudioLayerLiftBeta(decoded.input, {
    encodePng: encodePlane,
    decodePngDimensions: decodeDimensions,
  });
  return createStudioLayerLiftComposeWorkerResult(request, result);
}

describe("Studio Layer Lift compositor Worker protocol", () => {
  it("transfers only product-owned source/mask snapshots", () => {
    const raw = input();
    const sourceBuffer = raw.sourceRgba.buffer;
    const maskBuffer = raw.foregroundMask.buffer;
    const request = createStudioLayerLiftComposeWorkerRequest(raw, 2, 7);
    const requestSourceBuffer = request.sourceRgbaBuffer;
    const requestMaskBuffer = request.foregroundMaskBuffer;

    expect(requestSourceBuffer).not.toBe(sourceBuffer);
    expect(requestMaskBuffer).not.toBe(maskBuffer);
    expect(studioLayerLiftComposeWorkerRequestTransfers(request))
      .toEqual([requestSourceBuffer, requestMaskBuffer]);
    const delivered = transferRequest(request);

    expect(requestSourceBuffer.byteLength).toBe(0);
    expect(requestMaskBuffer.byteLength).toBe(0);
    expect(sourceBuffer.byteLength).toBe(16);
    expect(maskBuffer.byteLength).toBe(4);
    expect(isStudioLayerLiftComposeWorkerRequest(delivered)).toBe(true);
    const decoded = decodeStudioLayerLiftComposeWorkerRequest(delivered);
    expect(decoded).toMatchObject({ generation: 2, sequence: 7 });
    expect(decoded.input.sourceRgba).not.toBe(raw.sourceRgba);
    expect(decoded.input.foregroundMask).not.toBe(raw.foregroundMask);
    expect(decoded.input.sourceRgba).toEqual(raw.sourceRgba);
    expect(decoded.input.foregroundMask).toEqual(raw.foregroundMask);
  });

  it("rejects byte-length, hash, field and sequence tampering", () => {
    const canonical = createStudioLayerLiftComposeWorkerRequest(input(), 1, 1);
    const wrongLength = {
      ...canonical,
      sourceByteLength: canonical.sourceByteLength - 1,
    };
    expect(isStudioLayerLiftComposeWorkerRequest(wrongLength)).toBe(false);

    const wrongHash = structuredClone(canonical);
    new Uint8Array(wrongHash.foregroundMaskBuffer)[0] = 255;
    expect(() =>
      decodeStudioLayerLiftComposeWorkerRequest(wrongHash)
    ).toThrowError(StudioLayerLiftComposeWorkerProtocolError);

    expect(isStudioLayerLiftComposeWorkerRequest({
      ...canonical,
      extra: true,
    })).toBe(false);
    expect(() =>
      createStudioLayerLiftComposeWorkerRequest(input(), 0, 1)
    ).toThrowError(StudioLayerLiftComposeWorkerProtocolError);
  });

  it("moves five exact result buffers and validates transported provenance", async () => {
    const request = transferRequest(
      createStudioLayerLiftComposeWorkerRequest(input(), 3, 9),
    );
    const result = await resultMessage(request);
    const transfers = studioLayerLiftComposeWorkerResultTransfers(result);
    const originalBuffers = [...transfers];
    const delivered = structuredClone(result, {
      transfer: [...transfers],
    });

    expect(transfers).toHaveLength(5);
    expect(originalBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(isStudioLayerLiftComposeWorkerResponse(delivered)).toBe(true);
    expect(studioLayerLiftComposeWorkerResponseIdentity(delivered))
      .toEqual({ generation: 3, sequence: 9 });
    expect(delivered).toMatchObject({
      requestId: "worker-request",
      backgroundOutputId: "background-output",
      foregroundOutputId: "foreground-output",
      diagnostics: {
        sourceRgbaSha256: input().sourceSha256,
        foregroundMaskSha256: input().foregroundMaskSha256,
      },
    });
  });

  it("fails closed on malformed result buffers and composition receipts", async () => {
    const request = transferRequest(
      createStudioLayerLiftComposeWorkerRequest(input(), 1, 2),
    );
    const result = await resultMessage(request);
    expect(isStudioLayerLiftComposeWorkerResponse({
      ...result,
      backgroundRgbaByteLength: result.backgroundRgbaByteLength - 1,
    })).toBe(false);

    const receiptTamper = structuredClone(result) as unknown as {
      compositionReceipt: {
        background: { artifactSha256: `sha256:${string}` };
      };
    };
    receiptTamper.compositionReceipt.background.artifactSha256 = digest("f");
    expect(isStudioLayerLiftComposeWorkerResponse(receiptTamper)).toBe(false);
  });

  it("executes the real pure compositor boundary and never emits placeholder success", async () => {
    const request = transferRequest(
      createStudioLayerLiftComposeWorkerRequest(input(), 5, 11),
    );
    const success = await executeStudioLayerLiftComposeWorkerMessage(request, {
      encodePng: encodePlane,
      decodePngDimensions: decodeDimensions,
    });
    expect(success.response.kind).toBe("studio-layer-lift-compose/result");
    expect(success.transfer).toHaveLength(5);

    const failure = await executeStudioLayerLiftComposeWorkerMessage({
      generation: 5,
      sequence: 12,
      invalid: true,
    });
    expect(failure).toMatchObject({
      response: {
        kind: "studio-layer-lift-compose/error",
        generation: 5,
        sequence: 12,
        code: "protocol",
      },
      transfer: [],
    });
  });
});
