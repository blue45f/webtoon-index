import { describe, expect, it } from "vitest";

import {
  encodeStudioCodecRgbaEnvelope,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
} from "./studio-first-party-raster-codec-provider";
import {
  createStudioFirstPartyRasterCodecWorkerRunMessage,
  normalizeStudioFirstPartyRasterCodecWorkerRequest,
  parseStudioFirstPartyRasterCodecWorkerRunMessage,
  parseStudioFirstPartyRasterCodecWorkerSuccessMessage,
  studioFirstPartyRasterCodecWorkerRequestTransfers,
  StudioFirstPartyRasterCodecWorkerProtocolError,
} from "./studio-first-party-raster-codec-worker-protocol";
import {
  executeStudioFirstPartyRasterCodecWorkerMessage,
} from "./studio-first-party-raster-codec.worker";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioCodecDirection,
  StudioCodecExecutionRequest,
} from "./studio-codec-provider-contract";

function request(
  format = "qoi",
  direction: StudioCodecDirection = "encode",
): StudioCodecExecutionRequest {
  const provider = STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.find(
    (candidate) => candidate.manifest.format === format,
  );
  if (!provider) throw new Error(`Missing fixture provider for ${format}.`);
  return {
    schemaVersion: 1,
    direction,
    format,
    profile: STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
    version: STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
    mimeType: provider.manifest.mimeTypes[0]!,
    extension: provider.manifest.extensions[0]!,
    allowedModes: ["public-clean-room"],
    requireDeterministic: true,
    maxInputBytes: 4 * 1024 * 1024,
    maxOutputBytes: 4 * 1024 * 1024,
  };
}

function rgbaEnvelope(): Uint8Array {
  return encodeStudioCodecRgbaEnvelope({
    width: 2,
    height: 1,
    data: Uint8Array.of(
      255, 20, 10, 255,
      40, 80, 220, 255,
    ),
  });
}

describe("first-party raster codec Worker protocol", () => {
  it("copies caller input into one exact transferable buffer", () => {
    const source = rgbaEnvelope();
    const original = source.slice();
    const originalBuffer = source.buffer;
    const message =
      createStudioFirstPartyRasterCodecWorkerRunMessage(
        7,
        request(),
        source,
      );
    const transfers =
      studioFirstPartyRasterCodecWorkerRequestTransfers(message);

    expect(transfers).toEqual([message.inputBytes]);
    expect(message.inputBytes).not.toBe(originalBuffer);
    expect(new Uint8Array(message.inputBytes)).toEqual(source);

    const workerCopy = structuredClone(message, { transfer: transfers });
    expect(message.inputBytes.byteLength).toBe(0);
    expect(source.buffer).toBe(originalBuffer);
    expect(source).toEqual(original);
    expect(
      parseStudioFirstPartyRasterCodecWorkerRunMessage(workerCopy),
    ).toMatchObject({
      requestId: 7,
      request: {
        format: "qoi",
        direction: "encode",
        profile: STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
      },
    });
  });

  it.each([
    [
      "format",
      { ...request(), format: "webp" },
      "unsupported-format",
    ],
    [
      "direction",
      { ...request(), direction: "transcode" },
      "unsupported-direction",
    ],
    [
      "profile",
      { ...request(), profile: "vendor-private-v9" },
      "unsupported-profile",
    ],
    [
      "version",
      { ...request(), version: "99.0.0" },
      "unsupported-version",
    ],
  ])("rejects an unsupported %s with an explicit code", (
    _label,
    candidate,
    code,
  ) => {
    expect(() =>
      normalizeStudioFirstPartyRasterCodecWorkerRequest(candidate),
    ).toThrow(
      expect.objectContaining({
        name: "StudioFirstPartyRasterCodecWorkerProtocolError",
        code,
      }),
    );
  });

  it("rejects aliases, extra fields, oversized input, and hostile records", () => {
    expect(() =>
      normalizeStudioFirstPartyRasterCodecWorkerRequest({
        ...request(),
        mimeType: "application/octet-stream",
      }),
    ).toThrow(
      expect.objectContaining({ code: "invalid-request" }),
    );
    expect(() =>
      normalizeStudioFirstPartyRasterCodecWorkerRequest({
        ...request(),
        extra: true,
      }),
    ).toThrow(StudioFirstPartyRasterCodecWorkerProtocolError);
    expect(() =>
      createStudioFirstPartyRasterCodecWorkerRunMessage(
        1,
        { ...request(), maxInputBytes: 1 },
        rgbaEnvelope(),
      ),
    ).toThrow(
      expect.objectContaining({ code: "budget-exceeded" }),
    );
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("raw trap");
      },
    });
    expect(() =>
      normalizeStudioFirstPartyRasterCodecWorkerRequest(hostile),
    ).toThrow(
      expect.objectContaining({ code: "invalid-request" }),
    );
  });
});

describe("first-party raster codec Worker execution host", () => {
  it("reuses the provider boundary and returns a transferable strict receipt", async () => {
    const message =
      createStudioFirstPartyRasterCodecWorkerRunMessage(
        11,
        request(),
        rgbaEnvelope(),
      );
    const workerMessage = structuredClone(message, {
      transfer: studioFirstPartyRasterCodecWorkerRequestTransfers(message),
    });
    const dispatch =
      await executeStudioFirstPartyRasterCodecWorkerMessage(workerMessage);

    expect(dispatch).not.toBeNull();
    if (!dispatch) return;
    expect(dispatch.response).toMatchObject({
      type: "studio-first-party-raster-codec/success",
      requestId: 11,
      receipt: {
        providerId: "toonspectrum.raster.qoi.v1",
        direction: "encode",
        format: "qoi",
      },
    });
    expect(dispatch.transfer).toHaveLength(1);
    const clientResponse = structuredClone(dispatch.response, {
      transfer: [...dispatch.transfer],
    });
    const parsed =
      await parseStudioFirstPartyRasterCodecWorkerSuccessMessage(
        clientResponse,
        {
          requestId: 11,
          request: workerMessage.request,
          inputByteLength: workerMessage.inputBytes.byteLength,
          inputSha256:
            `sha256:${sha256HexPortable(
              new Uint8Array(workerMessage.inputBytes),
            )}`,
        },
      );
    expect(parsed?.bytes.byteLength).toBeGreaterThan(0);
    expect(parsed?.receipt.output.byteLength).toBe(
      parsed?.bytes.byteLength,
    );
  });

  it("maps malformed codec input to a stable provider code without raw errors", async () => {
    const message =
      createStudioFirstPartyRasterCodecWorkerRunMessage(
        12,
        request("qoi", "decode"),
        Uint8Array.of(0x00),
      );
    const workerMessage = structuredClone(message, {
      transfer: studioFirstPartyRasterCodecWorkerRequestTransfers(message),
    });
    const dispatch =
      await executeStudioFirstPartyRasterCodecWorkerMessage(workerMessage);

    expect(dispatch?.response).toEqual({
      type: "studio-first-party-raster-codec/failure",
      version: 1,
      requestId: 12,
      error: {
        code: "provider-failure",
        providerCode: "provider-runtime-error",
      },
    });
    expect(dispatch?.response).not.toHaveProperty("message");
    expect(dispatch?.response).not.toHaveProperty("stack");
  });

  it("returns explicit unsupported errors and ignores uncorrelated garbage", async () => {
    const unsupported = {
      ...createStudioFirstPartyRasterCodecWorkerRunMessage(
        13,
        request(),
        rgbaEnvelope(),
      ),
      request: {
        ...request(),
        profile: "unknown-profile",
      },
    };
    await expect(
      executeStudioFirstPartyRasterCodecWorkerMessage(unsupported),
    ).resolves.toMatchObject({
      response: {
        type: "studio-first-party-raster-codec/failure",
        requestId: 13,
        error: {
          code: "unsupported-profile",
          providerCode: null,
        },
      },
    });
    await expect(
      executeStudioFirstPartyRasterCodecWorkerMessage({
        raw: "secret-error",
      }),
    ).resolves.toBeNull();
  });
});
