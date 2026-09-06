import { describe, expect, it, vi } from "vitest";

import {
  encodeStudioCodecRgbaEnvelope,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
} from "./studio-first-party-raster-codec-provider";
import {
  createStudioFirstPartyRasterCodecWorkerRunMessage,
} from "./studio-first-party-raster-codec-worker-protocol";
import {
  installStudioFirstPartyRasterCodecWorkerRuntime,
  type StudioFirstPartyRasterCodecDedicatedWorkerScope,
} from "./studio-first-party-raster-codec.worker";

import type { StudioCodecExecutionRequest } from "./studio-codec-provider-contract";

function request(): StudioCodecExecutionRequest {
  const provider = STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.find(
    (candidate) => candidate.manifest.format === "qoi",
  );
  if (!provider) throw new Error("Missing QOI fixture provider.");
  return {
    schemaVersion: 1,
    direction: "encode",
    format: "qoi",
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

function input(): Uint8Array {
  return encodeStudioCodecRgbaEnvelope({
    width: 2,
    height: 1,
    data: Uint8Array.of(
      255, 20, 10, 255,
      40, 80, 220, 255,
    ),
  });
}

function throwingScope(): {
  readonly scope: StudioFirstPartyRasterCodecDedicatedWorkerScope;
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

describe("first-party raster codec Worker runtime", () => {
  it("closes when transferring a successful response throws", async () => {
    const runtime = throwingScope();
    installStudioFirstPartyRasterCodecWorkerRuntime(runtime.scope);
    const message = createStudioFirstPartyRasterCodecWorkerRunMessage(
      1,
      request(),
      input(),
    );

    runtime.scope.onmessage?.({ data: message } as MessageEvent<unknown>);

    await vi.waitFor(() => {
      expect(runtime.close).toHaveBeenCalledOnce();
    });
    expect(runtime.postMessage).toHaveBeenCalledOnce();
    expect(runtime.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: "studio-first-party-raster-codec/success",
      requestId: 1,
    });
    expect(runtime.postMessage.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it("closes when posting a protocol failure throws", async () => {
    const runtime = throwingScope();
    installStudioFirstPartyRasterCodecWorkerRuntime(runtime.scope);

    runtime.scope.onmessage?.({
      data: {
        type: "studio-first-party-raster-codec/run",
        version: 1,
        requestId: 2,
      },
    } as MessageEvent<unknown>);

    await vi.waitFor(() => {
      expect(runtime.close).toHaveBeenCalledOnce();
    });
    expect(runtime.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: "studio-first-party-raster-codec/failure",
      requestId: 2,
      error: { code: "protocol-error" },
    });
    expect(runtime.postMessage.mock.calls[0]?.[1]).toEqual([]);
  });
});
