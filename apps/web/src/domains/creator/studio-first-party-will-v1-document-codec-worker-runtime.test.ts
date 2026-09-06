import { describe, expect, it, vi } from "vitest";

import {
  encodeStudioWillV1DocumentTransport,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
} from "./studio-first-party-will-v1-document-codec-worker-protocol";
import {
  installStudioFirstPartyWillV1DocumentCodecWorkerRuntime,
  type StudioFirstPartyWillV1DocumentCodecDedicatedWorkerScope,
} from "./studio-first-party-will-v1-document-codec.worker";

import type { StudioCodecExecutionRequest } from "./studio-codec-provider-contract";

function request(): StudioCodecExecutionRequest {
  const manifest =
    STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest;
  return {
    schemaVersion: 1,
    direction: "encode",
    format: manifest.format,
    profile: manifest.profile,
    version: manifest.version,
    mimeType: manifest.mimeTypes[0]!,
    extension: manifest.extensions[0]!,
    allowedModes: ["public-clean-room"],
    requireDeterministic: true,
    maxInputBytes: manifest.maxInputBytes,
    maxOutputBytes: manifest.maxOutputBytes,
  };
}

async function input(): Promise<Uint8Array> {
  return encodeStudioWillV1DocumentTransport({
    width: 328,
    height: 439,
    title: "Worker runtime",
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

function throwingScope(): {
  readonly scope:
    StudioFirstPartyWillV1DocumentCodecDedicatedWorkerScope;
  readonly close: ReturnType<typeof vi.fn>;
  readonly postMessage: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const postMessage = vi.fn(() => {
    throw new DOMException("Transfer failed.", "DataCloneError");
  });
  return {
    scope: {
      onmessage: null,
      postMessage,
      close,
    },
    close,
    postMessage,
  };
}

describe("first-party WILL v1 document Worker runtime", () => {
  it("closes when transferring a successful response throws", async () => {
    const runtime = throwingScope();
    installStudioFirstPartyWillV1DocumentCodecWorkerRuntime(
      runtime.scope,
    );
    const message =
      createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
        1,
        request(),
        await input(),
      );

    runtime.scope.onmessage?.({ data: message } as MessageEvent<unknown>);

    await vi.waitFor(() => {
      expect(runtime.close).toHaveBeenCalledOnce();
    });
    expect(runtime.postMessage).toHaveBeenCalledOnce();
    expect(runtime.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: "studio-first-party-will-v1-document-codec/success",
      requestId: 1,
    });
    expect(runtime.postMessage.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it("closes when posting a protocol failure throws", async () => {
    const runtime = throwingScope();
    installStudioFirstPartyWillV1DocumentCodecWorkerRuntime(
      runtime.scope,
    );

    runtime.scope.onmessage?.({
      data: {
        type: "studio-first-party-will-v1-document-codec/run",
        version: 1,
        requestId: 2,
      },
    } as MessageEvent<unknown>);

    await vi.waitFor(() => {
      expect(runtime.close).toHaveBeenCalledOnce();
    });
    expect(runtime.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: "studio-first-party-will-v1-document-codec/failure",
      requestId: 2,
      error: { code: "protocol-error" },
    });
    expect(runtime.postMessage.mock.calls[0]?.[1]).toEqual([]);
  });
});
