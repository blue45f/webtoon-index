import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  importStudioRemoteReferenceImage,
  StudioRemoteReferenceImageRequestError,
} from "./studio-remote-reference-image-client";

import {
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES,
  type StudioRemoteReferenceImageResponse,
} from "@/shared/lib/studio-remote-reference-image-contract";

const { apiPost, isHttpError, toApiError } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  isHttpError: vi.fn(() => false),
  toApiError: vi.fn(async (_error: unknown, fallback: string) => new Error(fallback)),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { raw: { post: apiPost } },
  apiPath: (path: string) => path,
  isHttpError,
  toApiError,
}));

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function responseContract(
  bytes = Uint8Array.of(1, 2, 3)
): Promise<StudioRemoteReferenceImageResponse> {
  return {
    version: 1,
    mediaType: "image/png",
    byteLength: bytes.byteLength,
    width: 1,
    height: 1,
    decodedRgbaBytes: 4,
    sha256: await sha256(bytes),
    dataUrl: `data:image/png;base64,${globalThis.btoa(String.fromCharCode(...bytes))}`,
  };
}

function jsonResponse(
  value: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("remote reference image browser transport", () => {
  beforeEach(() => {
    apiPost.mockReset();
    isHttpError.mockReset().mockReturnValue(false);
    toApiError.mockReset().mockImplementation(
      async (_error: unknown, fallback: string) => new Error(fallback)
    );
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 1,
      height: 1,
      close: vi.fn(),
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the shared authenticated API transport, forwards AbortSignal and verifies bytes", async () => {
    const contract = await responseContract();
    apiPost.mockResolvedValue(jsonResponse(contract));
    const controller = new AbortController();

    const result = await importStudioRemoteReferenceImage(
      "https://images.example.org/reference.png?token=signed",
      controller.signal
    );

    expect(apiPost).toHaveBeenCalledWith(
      "/api/creator/reference-images/import",
      {
        json: { url: "https://images.example.org/reference.png?token=signed" },
        signal: controller.signal,
      }
    );
    expect(result).toMatchObject(contract);
    expect(result.bytes).toEqual(Uint8Array.of(1, 2, 3));
    expect(result.blob.type).toBe("image/png");
    await expect(result.blob.arrayBuffer()).resolves.toEqual(
      Uint8Array.of(1, 2, 3).buffer
    );
  });

  it("rejects invalid URL syntax locally before network access", async () => {
    await expect(importStudioRemoteReferenceImage("file:///etc/passwd"))
      .rejects.toBeInstanceOf(StudioRemoteReferenceImageRequestError);
    await expect(importStudioRemoteReferenceImage(
      "https://user:password@images.example.org/reference.png"
    )).rejects.toBeInstanceOf(StudioRemoteReferenceImageRequestError);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("preserves an already-aborted caller reason and never starts fetch", async () => {
    const controller = new AbortController();
    const reason = new DOMException("panel closed", "AbortError");
    controller.abort(reason);

    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/reference.png",
      controller.signal
    )).rejects.toBe(reason);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("forwards in-flight cancellation through the shared fetch transport", async () => {
    const controller = new AbortController();
    apiPost.mockImplementation((
      _url: string,
      options: { signal: AbortSignal }
    ) => new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true }
      );
    }));
    const reason = new DOMException("user cancelled", "AbortError");
    const operation = importStudioRemoteReferenceImage(
      "https://images.example.org/reference.png",
      controller.signal
    );
    controller.abort(reason);

    await expect(operation).rejects.toBe(reason);
  });

  it("rejects oversized JSON before parsing its data URL", async () => {
    const contract = await responseContract();
    apiPost.mockResolvedValue(jsonResponse(contract, {
      "content-length": String(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES + 1),
    }));

    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/reference.png"
    )).rejects.toThrow("안전 크기 한도");
  });

  it("rejects a truncated response that disagrees with Content-Length", async () => {
    const contract = await responseContract();
    const serialized = JSON.stringify(contract);
    apiPost.mockResolvedValue(new Response(serialized, {
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(serialized).byteLength + 1),
      },
    }));

    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/truncated.png"
    )).rejects.toThrow("Content-Length와 일치하지 않습니다");
  });

  it("rejects foreign response fields, malformed data URL lengths and SHA mismatch", async () => {
    const contract = await responseContract();
    apiPost
      .mockResolvedValueOnce(jsonResponse({ ...contract, sourceUrl: "https://secret.invalid" }))
      .mockResolvedValueOnce(jsonResponse({ ...contract, dataUrl: "data:image/png;base64,AA==" }))
      .mockResolvedValueOnce(jsonResponse({ ...contract, sha256: "b".repeat(64) }));

    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/foreign.png"
    )).rejects.toThrow("응답 계약");
    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/short.png"
    )).rejects.toThrow("data URL 길이");
    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/tampered.png"
    )).rejects.toThrow("SHA-256");
  });

  it("rejects structurally admitted bytes when the browser pixel decoder cannot decode them", async () => {
    const contract = await responseContract();
    apiPost.mockResolvedValue(jsonResponse(contract));
    vi.mocked(globalThis.createImageBitmap).mockRejectedValueOnce(new Error("decode failed"));

    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/corrupt.png"
    )).rejects.toThrow("압축 픽셀 데이터를 해석하지 못했습니다");
  });

  it("rejects a decoded dimension that disagrees with the bounded server contract", async () => {
    const contract = await responseContract();
    apiPost.mockResolvedValue(jsonResponse(contract));
    vi.mocked(globalThis.createImageBitmap).mockResolvedValueOnce({
      width: 2,
      height: 1,
      close: vi.fn(),
    } as unknown as ImageBitmap);

    await expect(importStudioRemoteReferenceImage(
      "https://images.example.org/wrong-dimensions.png"
    )).rejects.toThrow("실제 크기가 서버 검증 결과와 일치하지 않습니다");
  });

  it("maps authenticated API failures to a status-bearing UI error", async () => {
    const upstreamError = { response: { status: 429 } };
    apiPost.mockRejectedValue(upstreamError);
    isHttpError.mockReturnValue(true);
    toApiError.mockResolvedValue(new Error("요청이 너무 많습니다."));

    const error = await importStudioRemoteReferenceImage(
      "https://images.example.org/reference.png"
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StudioRemoteReferenceImageRequestError);
    expect(error).toMatchObject({
      message: "요청이 너무 많습니다.",
      status: 429,
    });
  });
});
