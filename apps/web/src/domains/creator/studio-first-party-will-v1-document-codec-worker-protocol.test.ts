import { describe, expect, it } from "vitest";

import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  encodeStudioWillV1DocumentTransport,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
  parseStudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage,
  studioFirstPartyWillV1DocumentCodecWorkerRequestTransfers,
  type StudioFirstPartyWillV1DocumentCodecWorkerExpectedResponse,
} from "./studio-first-party-will-v1-document-codec-worker-protocol";
import {
  executeStudioFirstPartyWillV1DocumentCodecWorkerMessage,
} from "./studio-first-party-will-v1-document-codec.worker";
import { sha256HexPortable } from "./studio-sha256";

import type { StudioCodecExecutionRequest } from "./studio-codec-provider-contract";

function request(
  direction: "decode" | "encode" = "encode",
): StudioCodecExecutionRequest {
  const manifest =
    STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest;
  return Object.freeze({
    schemaVersion: 1,
    direction,
    format: manifest.format,
    profile: manifest.profile,
    version: manifest.version,
    mimeType: manifest.mimeTypes[0]!,
    extension: manifest.extensions[0]!,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: manifest.maxInputBytes,
    maxOutputBytes: manifest.maxOutputBytes,
  });
}

async function transport(): Promise<Uint8Array> {
  return encodeStudioWillV1DocumentTransport({
    width: 328,
    height: 439,
    title: "Worker protocol",
    createdAt: "2026-07-30T12:34:56Z",
    application: "ToonSpectrum Studio",
    applicationVersion: "1.0.0",
    paths: [{
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 12 },
        { x: 16, y: 20 },
        { x: 28, y: 14 },
      ],
      strokeWidths: [0.75, 1.25],
      strokeColor: { r: 12, g: 34, b: 56, a: 220 },
      decimalPrecision: 2,
    }],
  });
}

function expected(
  requestId: number,
  codecRequest: StudioCodecExecutionRequest,
  input: Uint8Array,
): StudioFirstPartyWillV1DocumentCodecWorkerExpectedResponse {
  return Object.freeze({
    requestId,
    request: codecRequest,
    inputByteLength: input.byteLength,
    inputSha256:
      `sha256:${sha256HexPortable(input)}` as `sha256:${string}`,
  });
}

describe("first-party WILL v1 document Worker protocol", () => {
  it("copies caller input and transfers only the private Worker snapshot", async () => {
    const input = await transport();
    const original = input.slice();
    const originalBuffer = input.buffer;
    const message =
      createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
        1,
        request(),
        input,
      );

    const cloned = structuredClone(message, {
      transfer:
        studioFirstPartyWillV1DocumentCodecWorkerRequestTransfers(
          message,
        ),
    });

    expect(message.inputBytes.byteLength).toBe(0);
    expect(cloned.inputBytes.byteLength).toBe(original.byteLength);
    expect(input.buffer).toBe(originalBuffer);
    expect(input).toEqual(original);
  });

  it("rejects request aliases, extra fields, and manifest budget drift", async () => {
    const input = await transport();
    expect(() =>
      createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
        1,
        { ...request(), format: "will" },
        input,
      )).toThrowError(expect.objectContaining({
      code: "unsupported-format",
    }));
    expect(() =>
      createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
        1,
        { ...request(), extra: true },
        input,
      )).toThrowError(expect.objectContaining({
      code: "invalid-request",
    }));
    expect(() =>
      createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
        1,
        { ...request(), maxOutputBytes: 1024 },
        input,
      )).toThrowError(expect.objectContaining({
      code: "invalid-request",
    }));
  });

  it("executes the exact provider and validates output bytes plus deep receipt", async () => {
    const input = await transport();
    const codecRequest = request();
    const message =
      createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
        7,
        codecRequest,
        input,
      );
    const workerMessage = structuredClone(message, {
      transfer:
        studioFirstPartyWillV1DocumentCodecWorkerRequestTransfers(
          message,
        ),
    });
    const dispatch =
      await executeStudioFirstPartyWillV1DocumentCodecWorkerMessage(
        workerMessage,
      );

    expect(dispatch).not.toBeNull();
    if (
      !dispatch
      || dispatch.response.type
        !== "studio-first-party-will-v1-document-codec/success"
    ) return;
    const clientResponse = structuredClone(dispatch.response, {
      transfer: [...dispatch.transfer],
    });
    const result =
      await parseStudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage(
        clientResponse,
        expected(7, codecRequest, input),
      );
    expect(result).toMatchObject({
      receipt: {
        providerId:
          "toonspectrum.will-v1-annex-b-document.v1",
        direction: "encode",
        input: { byteLength: input.byteLength },
      },
    });
    expect(result?.receipt.output.byteLength).toBe(
      result?.bytes.byteLength,
    );
  });

  it("fails closed when output or receipt hashes are substituted", async () => {
    const input = await transport();
    const codecRequest = request();
    const message =
      createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
        9,
        codecRequest,
        input,
      );
    const workerMessage = structuredClone(message, {
      transfer:
        studioFirstPartyWillV1DocumentCodecWorkerRequestTransfers(
          message,
        ),
    });
    const dispatch =
      await executeStudioFirstPartyWillV1DocumentCodecWorkerMessage(
        workerMessage,
      );
    if (
      !dispatch
      || dispatch.response.type
        !== "studio-first-party-will-v1-document-codec/success"
    ) {
      throw new Error("Expected a WILL Worker success.");
    }
    const response = structuredClone(dispatch.response);
    const bytes = new Uint8Array(response.bytes);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await expect(
      parseStudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage(
        response,
        expected(9, codecRequest, input),
      ),
    ).resolves.toBeNull();

    const tamperedReceipt = {
      ...structuredClone(dispatch.response),
      receipt: {
        ...dispatch.response.receipt,
        providerId: "substituted.provider",
      },
    };
    await expect(
      parseStudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage(
        tamperedReceipt,
        expected(9, codecRequest, input),
      ),
    ).resolves.toBeNull();
  });
});
