import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  StudioLayerLiftArtifactError,
  admitStudioLayerLiftArtifactPair,
  decodeStudioLayerLiftPngDimensions,
  isStudioLayerLiftTrustedArtifactPair,
  verifyStudioLayerLiftArtifactPairReceipt,
  type StudioLayerLiftArtifactPairInput,
  type StudioLayerLiftPngDecoder,
} from "./studio-layer-lift-artifact";

const BACKGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";
const FOREGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFElEQVR42mNggIKeBVsOnLjz4T8AGVwGNJa9xxsAAAAASUVORK5CYII=";

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function sha256DigestBuffer(bytes: Uint8Array): ArrayBuffer {
  const hex = sha256HexPortable(bytes);
  return Uint8Array.from(
    { length: hex.length / 2 },
    (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  ).buffer;
}

function input(
  overrides: Partial<StudioLayerLiftArtifactPairInput> = {},
): StudioLayerLiftArtifactPairInput {
  return {
    requestId: "lift-request-1",
    sourceId: "scene-source-1",
    sourceWidth: 4,
    sourceHeight: 1,
    background: {
      outputId: "lift-background-1",
      bytes: ownedBuffer(decodeBase64(BACKGROUND_PNG_BASE64)),
    },
    foreground: {
      outputId: "lift-foreground-1",
      bytes: ownedBuffer(decodeBase64(FOREGROUND_PNG_BASE64)),
    },
    ...overrides,
  };
}

function decoder(
  dimensions = { width: 4, height: 1 },
): StudioLayerLiftPngDecoder {
  return vi.fn(async () => dimensions);
}

function expectArtifactError(
  code: StudioLayerLiftArtifactError["code"],
): (error: unknown) => boolean {
  return (error: unknown) => {
    expect(error).toBeInstanceOf(StudioLayerLiftArtifactError);
    expect((error as StudioLayerLiftArtifactError).code).toBe(code);
    return true;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admitStudioLayerLiftArtifactPair", () => {
  it("admits real still PNG bytes and binds IDs, dimensions, budgets, and SHA-256", async () => {
    const request = input();
    const originalBackground = new Uint8Array(request.background.bytes as ArrayBuffer);
    const originalForeground = new Uint8Array(request.foreground.bytes as ArrayBuffer);

    const result = await admitStudioLayerLiftArtifactPair(request, {
      decodePngDimensions: decoder(),
    });

    expect(result.receipt).toMatchObject({
      requestId: request.requestId,
      sourceId: request.sourceId,
      sourceWidth: 4,
      sourceHeight: 1,
      aggregatePixelCount: 8,
      aggregateDecodedByteLength: 32,
      aggregateByteLength:
        originalBackground.byteLength + originalForeground.byteLength,
      background: {
        outputId: "lift-background-1",
        width: 4,
        height: 1,
        pixelCount: 4,
        decodedByteLength: 16,
        sha256: `sha256:${sha256HexPortable(originalBackground)}`,
      },
      foreground: {
        outputId: "lift-foreground-1",
        width: 4,
        height: 1,
        pixelCount: 4,
        decodedByteLength: 16,
        sha256: `sha256:${sha256HexPortable(originalForeground)}`,
      },
    });
    expect(result.receipt.receiptSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.background.bytes).not.toBe(request.background.bytes);
    expect(result.foreground.bytes).not.toBe(request.foreground.bytes);

    const verified = await verifyStudioLayerLiftArtifactPairReceipt({
      requestId: request.requestId,
      sourceId: request.sourceId,
      sourceWidth: 4,
      sourceHeight: 1,
      backgroundOutputId: "lift-background-1",
      foregroundOutputId: "lift-foreground-1",
      receipt: structuredClone(result.receipt),
      backgroundBytes: result.background.bytes,
      foregroundBytes: result.foreground.bytes,
    });
    expect(verified.receipt).toEqual(result.receipt);
    expect(verified.receipt).not.toBe(result.receipt);
    expect(Object.isFrozen(verified.receipt)).toBe(true);
    expect(Object.isFrozen(verified.receipt.background)).toBe(true);
    expect(Object.isFrozen(verified.receipt.foreground)).toBe(true);
    expect(verified.background.bytes).not.toBe(result.background.bytes);
    expect(verified.foreground.bytes).not.toBe(result.foreground.bytes);
  });

  it("trusts only pair identities issued by the admission boundaries", async () => {
    const request = input();
    const admitted = await admitStudioLayerLiftArtifactPair(request, {
      decodePngDimensions: decoder(),
    });

    expect(isStudioLayerLiftTrustedArtifactPair(admitted)).toBe(true);
    expect(
      isStudioLayerLiftTrustedArtifactPair(structuredClone(admitted)),
    ).toBe(false);
    expect(
      isStudioLayerLiftTrustedArtifactPair({
        receipt: admitted.receipt,
        background: admitted.background,
        foreground: admitted.foreground,
      }),
    ).toBe(false);

    const verified = await verifyStudioLayerLiftArtifactPairReceipt({
      requestId: request.requestId,
      sourceId: request.sourceId,
      sourceWidth: request.sourceWidth,
      sourceHeight: request.sourceHeight,
      backgroundOutputId: request.background.outputId,
      foregroundOutputId: request.foreground.outputId,
      receipt: structuredClone(admitted.receipt),
      backgroundBytes: admitted.background.bytes,
      foregroundBytes: admitted.foreground.bytes,
    });

    expect(isStudioLayerLiftTrustedArtifactPair(verified)).toBe(true);
    expect(
      isStudioLayerLiftTrustedArtifactPair(structuredClone(verified)),
    ).toBe(false);
  });

  it("hashes and returns owned snapshots when caller buffers mutate during WebCrypto", async () => {
    const request = input();
    const admitted = await admitStudioLayerLiftArtifactPair(request, {
      decodePngDimensions: decoder(),
    });
    const expectedBackground = Uint8Array.from(
      new Uint8Array(admitted.background.bytes),
    );
    const expectedForeground = Uint8Array.from(
      new Uint8Array(admitted.foreground.bytes),
    );
    const releases: Array<() => void> = [];
    const digest = vi.fn((
      _algorithm: string,
      data: ArrayBuffer | ArrayBufferView,
    ) => {
      const snapshot = Uint8Array.from(
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
      return new Promise<ArrayBuffer>((resolve) => {
        releases.push(() => resolve(sha256DigestBuffer(snapshot)));
      });
    });
    vi.stubGlobal("crypto", { subtle: { digest } });

    const pending = verifyStudioLayerLiftArtifactPairReceipt({
      requestId: request.requestId,
      sourceId: request.sourceId,
      sourceWidth: request.sourceWidth,
      sourceHeight: request.sourceHeight,
      backgroundOutputId: request.background.outputId,
      foregroundOutputId: request.foreground.outputId,
      receipt: admitted.receipt,
      backgroundBytes: admitted.background.bytes,
      foregroundBytes: admitted.foreground.bytes,
    });
    expect(releases).toHaveLength(2);

    new Uint8Array(admitted.background.bytes).fill(0);
    new Uint8Array(admitted.foreground.bytes).fill(0);
    releases.forEach((release) => release());

    const verified = await pending;
    expect(new Uint8Array(verified.background.bytes)).toEqual(
      expectedBackground,
    );
    expect(new Uint8Array(verified.foreground.bytes)).toEqual(
      expectedForeground,
    );
  });

  it.each([
    {
      name: "signature",
      mutate(bytes: Uint8Array) {
        bytes[0] ^= 0xff;
      },
    },
    {
      name: "chunk CRC",
      mutate(bytes: Uint8Array) {
        bytes[32] ^= 0x01;
      },
    },
    {
      name: "IEND/trailing-byte boundary",
      mutate(bytes: Uint8Array) {
        const expanded = new Uint8Array(bytes.byteLength + 1);
        expanded.set(bytes);
        bytes.set(expanded.subarray(0, bytes.byteLength));
        return expanded;
      },
    },
  ])("rejects an invalid PNG $name before native decode", async ({ mutate }) => {
    const bytes = decodeBase64(BACKGROUND_PNG_BASE64);
    const replacement = mutate(bytes) ?? bytes;
    const decode = decoder();
    const request = input({
      background: {
        outputId: "lift-background-1",
        bytes: ownedBuffer(replacement),
      },
    });

    await expect(
      admitStudioLayerLiftArtifactPair(request, {
        decodePngDimensions: decode,
      }),
    ).rejects.toSatisfy(expectArtifactError("invalid-png"));
    expect(decode).not.toHaveBeenCalled();
  });

  it("requires both IHDR and native decoder dimensions to equal the source", async () => {
    await expect(
      admitStudioLayerLiftArtifactPair(
        input({ sourceWidth: 3 }),
        { decodePngDimensions: decoder() },
      ),
    ).rejects.toSatisfy(expectArtifactError("dimension-mismatch"));

    await expect(
      admitStudioLayerLiftArtifactPair(input(), {
        decodePngDimensions: decoder({ width: 4, height: 2 }),
      }),
    ).rejects.toSatisfy(expectArtifactError("dimension-mismatch"));
  });

  it("enforces individual compressed/decoded and aggregate pair budgets", async () => {
    const request = input();
    const backgroundLength = (request.background.bytes as ArrayBuffer).byteLength;
    const aggregateLength =
      backgroundLength + (request.foreground.bytes as ArrayBuffer).byteLength;

    await expect(
      admitStudioLayerLiftArtifactPair(request, {
        decodePngDimensions: decoder(),
        limits: { maximumCompressedBytes: backgroundLength - 1 },
      }),
    ).rejects.toSatisfy(expectArtifactError("budget-exceeded"));

    await expect(
      admitStudioLayerLiftArtifactPair(input(), {
        decodePngDimensions: decoder(),
        limits: { maximumPairCompressedBytes: aggregateLength - 1 },
      }),
    ).rejects.toSatisfy(expectArtifactError("budget-exceeded"));

    await expect(
      admitStudioLayerLiftArtifactPair(input(), {
        decodePngDimensions: decoder(),
        limits: { maximumPairDecodedBytes: 31 },
      }),
    ).rejects.toSatisfy(expectArtifactError("budget-exceeded"));

    await expect(
      admitStudioLayerLiftArtifactPair(input(), {
        decodePngDimensions: decoder(),
        limits: { maximumPixels: 3 },
      }),
    ).rejects.toSatisfy(expectArtifactError("budget-exceeded"));
  });

  it("rejects hostile byte budgets before making either full-buffer snapshot", async () => {
    const request = input();
    const maximumCompressedBytes =
      (request.background.bytes as ArrayBuffer).byteLength - 1;
    const copy = vi.spyOn(Uint8Array, "from");
    try {
      await expect(
        admitStudioLayerLiftArtifactPair(request, {
          decodePngDimensions: decoder(),
          limits: { maximumCompressedBytes },
        }),
      ).rejects.toSatisfy(expectArtifactError("budget-exceeded"));
      expect(copy).not.toHaveBeenCalled();
    } finally {
      copy.mockRestore();
    }
  });

  it("honors AbortSignal before and while a decoder promise is pending", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const neverCalled = decoder();
    await expect(
      admitStudioLayerLiftArtifactPair(input(), {
        signal: preAborted.signal,
        decodePngDimensions: neverCalled,
      }),
    ).rejects.toSatisfy(expectArtifactError("aborted"));
    expect(neverCalled).not.toHaveBeenCalled();

    const controller = new AbortController();
    const pendingDecoder = vi.fn(
      () => new Promise<{ width: number; height: number }>(() => undefined),
    );
    const pending = admitStudioLayerLiftArtifactPair(input(), {
      signal: controller.signal,
      decodePngDimensions: pendingDecoder,
    });
    await vi.waitFor(() => expect(pendingDecoder).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toSatisfy(expectArtifactError("aborted"));
  });

  it("fails closed without a native decoder and keeps tests model/DOM-free through injection", async () => {
    vi.stubGlobal("ImageDecoder", undefined);
    vi.stubGlobal("createImageBitmap", undefined);

    await expect(admitStudioLayerLiftArtifactPair(input())).rejects.toSatisfy(
      expectArtifactError("decode-unavailable"),
    );
  });

  it("selects ImageDecoder before createImageBitmap and falls back deterministically", async () => {
    const imageClose = vi.fn();
    const decoderClose = vi.fn();
    const bitmapDecoder = vi.fn(async () => ({
      width: 99,
      height: 99,
      close: vi.fn(),
    }));
    class FakeImageDecoder {
      readonly tracks = { ready: Promise.resolve() };

      async decode() {
        return {
          image: {
            displayWidth: 4,
            displayHeight: 1,
            close: imageClose,
          },
        };
      }

      close(): void {
        decoderClose();
      }
    }
    vi.stubGlobal("ImageDecoder", FakeImageDecoder);
    vi.stubGlobal("createImageBitmap", bitmapDecoder);

    await expect(
      decodeStudioLayerLiftPngDimensions(
        decodeBase64(BACKGROUND_PNG_BASE64),
        undefined,
      ),
    ).resolves.toEqual({ width: 4, height: 1 });
    expect(bitmapDecoder).not.toHaveBeenCalled();
    expect(imageClose).toHaveBeenCalledOnce();
    expect(decoderClose).toHaveBeenCalledOnce();

    const bitmapClose = vi.fn();
    const fallback = vi.fn(async () => ({
      width: 4,
      height: 1,
      close: bitmapClose,
    }));
    vi.stubGlobal("ImageDecoder", undefined);
    vi.stubGlobal("createImageBitmap", fallback);
    await expect(
      decodeStudioLayerLiftPngDimensions(
        decodeBase64(FOREGROUND_PNG_BASE64),
        undefined,
      ),
    ).resolves.toEqual({ width: 4, height: 1 });
    expect(fallback).toHaveBeenCalledOnce();
    expect(bitmapClose).toHaveBeenCalledOnce();
  });

  it("maps a rejecting createImageBitmap fallback without leaking a side-chain rejection", async () => {
    vi.stubGlobal("ImageDecoder", undefined);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decoder rejected fixture")),
    );
    const controller = new AbortController();

    await expect(
      decodeStudioLayerLiftPngDimensions(
        decodeBase64(BACKGROUND_PNG_BASE64),
        controller.signal,
      ),
    ).rejects.toSatisfy(expectArtifactError("decode-failed"));
  });

  it("rejects receipt authority or returned-byte tampering", async () => {
    const request = input();
    const first = await admitStudioLayerLiftArtifactPair(request, {
      decodePngDimensions: decoder(),
    });
    const mismatchedReceipt = {
      ...first.receipt,
      sourceId: "other-source",
    };
    await expect(
      verifyStudioLayerLiftArtifactPairReceipt({
        requestId: request.requestId,
        sourceId: request.sourceId,
        sourceWidth: 4,
        sourceHeight: 1,
        backgroundOutputId: "lift-background-1",
        foregroundOutputId: "lift-foreground-1",
        receipt: mismatchedReceipt,
        backgroundBytes: first.background.bytes,
        foregroundBytes: first.foreground.bytes,
      }),
    ).rejects.toMatchObject({ code: "receipt-mismatch" });

    const second = await admitStudioLayerLiftArtifactPair(input(), {
      decodePngDimensions: decoder(),
    });
    new Uint8Array(second.background.bytes)[8] ^= 0x01;
    await expect(
      verifyStudioLayerLiftArtifactPairReceipt({
        requestId: request.requestId,
        sourceId: request.sourceId,
        sourceWidth: 4,
        sourceHeight: 1,
        backgroundOutputId: "lift-background-1",
        foregroundOutputId: "lift-foreground-1",
        receipt: second.receipt,
        backgroundBytes: second.background.bytes,
        foregroundBytes: second.foreground.bytes,
      }),
    ).rejects.toMatchObject({ code: "receipt-mismatch" });
  });

  it("rejects verifier dimensions and byte budgets before starting WebCrypto hashing", async () => {
    const digest = vi.fn();
    vi.stubGlobal("crypto", { subtle: { digest } });

    await expect(verifyStudioLayerLiftArtifactPairReceipt({
      requestId: "lift-request-1",
      sourceId: "scene-source-1",
      sourceWidth: 8_193,
      sourceHeight: 1,
      backgroundOutputId: "lift-background-1",
      foregroundOutputId: "lift-foreground-1",
      receipt: {},
      backgroundBytes: new ArrayBuffer(1),
      foregroundBytes: new ArrayBuffer(1),
    })).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(digest).not.toHaveBeenCalled();
  });
});
