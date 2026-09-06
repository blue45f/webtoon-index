import {
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES } from "../../../../web/src/shared/lib/studio-remote-reference-image-contract";

import { StudioRemoteReferenceImageService } from "./studio-remote-reference-image.service";

import type {
  StudioRemoteReferenceDnsResolver,
  StudioRemoteReferenceHttpRequester,
  StudioRemoteReferenceHttpResponse,
} from "./studio-remote-reference-image.network";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

let userSequence = 0;
function uniqueUser(label: string): string {
  userSequence += 1;
  return `${label}-${userSequence}`;
}

function response({
  statusCode = 200,
  headers = {},
  chunks = [PNG_1X1],
}: {
  statusCode?: number;
  headers?: Record<string, string | string[] | undefined>;
  chunks?: readonly Uint8Array[];
} = {}): StudioRemoteReferenceHttpResponse & { cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  return {
    statusCode,
    headers,
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    },
    cancel,
  };
}

function publicResolver(
  select: (hostname: string) => { address: string; family: 4 | 6 } = () => ({
    address: "93.184.216.34",
    family: 4,
  })
): StudioRemoteReferenceDnsResolver & { resolve: ReturnType<typeof vi.fn> } {
  return {
    resolve: vi.fn(async (hostname: string) => [select(hostname)]),
  };
}

function requester(
  implementation: StudioRemoteReferenceHttpRequester["request"]
): StudioRemoteReferenceHttpRequester & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(implementation) };
}

function successfulPngResponse(): StudioRemoteReferenceHttpResponse & {
  cancel: ReturnType<typeof vi.fn>;
} {
  return response({
    headers: {
      "content-type": "image/png",
      "content-length": String(PNG_1X1.byteLength),
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("StudioRemoteReferenceImageService", () => {
  it("returns a bounded private-data contract after DNS pinning, stream and image validation", async () => {
    const dns = publicResolver();
    const http = requester(async () => successfulPngResponse());
    const service = new StudioRemoteReferenceImageService(dns, http);

    const result = await service.importRemoteImage(
      uniqueUser("success"),
      "https://images.example.org/reference.png?private-token=secret"
    );

    expect(result).toMatchObject({
      version: 1,
      mediaType: "image/png",
      byteLength: PNG_1X1.byteLength,
      width: 1,
      height: 1,
      decodedRgbaBytes: 4,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(result.dataUrl).toBe(`data:image/png;base64,${PNG_1X1.toString("base64")}`);
    expect(result).not.toHaveProperty("sourceUrl");
    expect(dns.resolve).toHaveBeenCalledWith("images.example.org");
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.objectContaining({ hostname: "images.example.org" }),
      endpoint: { address: "93.184.216.34", family: 4 },
      signal: expect.any(AbortSignal),
    }));
  });

  it("revalidates and pins DNS independently at every redirect hop", async () => {
    const dns = publicResolver((hostname) => hostname === "first.example.org"
      ? { address: "93.184.216.34", family: 4 }
      : { address: "1.1.1.1", family: 4 });
    const redirect = response({
      statusCode: 302,
      headers: { location: "https://second.example.org/final.png" },
      chunks: [],
    });
    const http = requester(vi.fn()
      .mockResolvedValueOnce(redirect)
      .mockResolvedValueOnce(successfulPngResponse()));
    const service = new StudioRemoteReferenceImageService(dns, http);

    await expect(service.importRemoteImage(
      uniqueUser("redirect"),
      "https://first.example.org/start.png"
    )).resolves.toMatchObject({ mediaType: "image/png" });

    expect(redirect.cancel).toHaveBeenCalledOnce();
    expect(dns.resolve).toHaveBeenNthCalledWith(1, "first.example.org");
    expect(dns.resolve).toHaveBeenNthCalledWith(2, "second.example.org");
    expect(http.request.mock.calls[0]?.[0]).toMatchObject({
      endpoint: { address: "93.184.216.34", family: 4 },
    });
    expect(http.request.mock.calls[1]?.[0]).toMatchObject({
      endpoint: { address: "1.1.1.1", family: 4 },
    });
  });

  it("blocks a redirect that resolves to loopback before making the second request", async () => {
    const dns = publicResolver((hostname) => hostname === "public.example.org"
      ? { address: "93.184.216.34", family: 4 }
      : { address: "127.0.0.1", family: 4 });
    const redirect = response({
      statusCode: 307,
      headers: { location: "http://private.example.org/metadata.png" },
      chunks: [],
    });
    const http = requester(async () => redirect);
    const service = new StudioRemoteReferenceImageService(dns, http);

    await expect(service.importRemoteImage(
      uniqueUser("private-redirect"),
      "http://public.example.org/start.png"
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(http.request).toHaveBeenCalledOnce();
  });

  it("rejects HTTPS-to-HTTP redirect downgrade without resolving the downgraded URL", async () => {
    const dns = publicResolver();
    const redirect = response({
      statusCode: 302,
      headers: { location: "http://images.example.org/insecure.png" },
      chunks: [],
    });
    const http = requester(async () => redirect);
    const service = new StudioRemoteReferenceImageService(dns, http);

    await expect(service.importRemoteImage(
      uniqueUser("downgrade"),
      "https://images.example.org/start.png"
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(dns.resolve).toHaveBeenCalledOnce();
  });

  it("caps redirect traversal and cancels every discarded response", async () => {
    let redirects = 0;
    const discarded: Array<ReturnType<typeof response>> = [];
    const http = requester(async () => {
      redirects += 1;
      const current = response({
        statusCode: 302,
        headers: { location: `/hop-${redirects}.png` },
        chunks: [],
      });
      discarded.push(current);
      return current;
    });
    const service = new StudioRemoteReferenceImageService(publicResolver(), http);

    const error = await service.importRemoteImage(
      uniqueUser("redirect-cap"),
      "https://images.example.org/start.png"
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(502);
    expect(http.request).toHaveBeenCalledTimes(4);
    expect(discarded).toHaveLength(4);
    expect(discarded.every((item) => item.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("rejects an oversized Content-Length before consuming the response body", async () => {
    let iterated = false;
    const upstream = response({
      headers: {
        "content-type": "image/png",
        "content-length": String(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES + 1),
      },
      chunks: [],
    });
    upstream.body = {
      async *[Symbol.asyncIterator]() {
        iterated = true;
        yield PNG_1X1;
      },
    };
    const service = new StudioRemoteReferenceImageService(
      publicResolver(),
      requester(async () => upstream)
    );

    await expect(service.importRemoteImage(
      uniqueUser("declared-size"),
      "https://images.example.org/large.png"
    )).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(iterated).toBe(false);
    expect(upstream.cancel).toHaveBeenCalled();
  });

  it("enforces the byte cap while streaming when Content-Length is absent", async () => {
    const upstream = response({
      headers: { "content-type": "image/png" },
      chunks: [
        new Uint8Array(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES),
        Uint8Array.of(1),
      ],
    });
    const service = new StudioRemoteReferenceImageService(
      publicResolver(),
      requester(async () => upstream)
    );

    await expect(service.importRemoteImage(
      uniqueUser("stream-size"),
      "https://images.example.org/chunked.png"
    )).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(upstream.cancel).toHaveBeenCalled();
  });

  it("rejects MIME/magic mismatch and compressed transfer encoding", async () => {
    const mismatched = response({
      headers: { "content-type": "image/jpeg" },
    });
    const compressed = response({
      headers: {
        "content-type": "image/png",
        "content-encoding": "gzip",
      },
    });
    const http = requester(vi.fn()
      .mockResolvedValueOnce(mismatched)
      .mockResolvedValueOnce(compressed));
    const service = new StudioRemoteReferenceImageService(publicResolver(), http);

    await expect(service.importRemoteImage(
      uniqueUser("mime-mismatch"),
      "https://images.example.org/not-jpeg.jpg"
    )).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(service.importRemoteImage(
      uniqueUser("content-encoding"),
      "https://images.example.org/compressed.png"
    )).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it("applies one total timeout across DNS, redirects and streaming", async () => {
    vi.useFakeTimers();
    const http = requester(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const service = new StudioRemoteReferenceImageService(publicResolver(), http);
    const operation = service.importRemoteImage(
      uniqueUser("timeout"),
      "https://images.example.org/slow.png"
    );
    const assertion = expect(operation).rejects.toBeInstanceOf(GatewayTimeoutException);

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("rate-limits authenticated-user abuse before another network request", async () => {
    const dns = publicResolver();
    const http = requester(async () => successfulPngResponse());
    const service = new StudioRemoteReferenceImageService(dns, http);
    const userId = uniqueUser("rate-limit");

    for (let index = 0; index < 20; index += 1) {
      await expect(service.importRemoteImage(userId, "http://127.0.0.1/image.png"))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    const limited = await service.importRemoteImage(userId, "http://127.0.0.1/image.png")
      .catch((error: unknown) => error);
    expect(limited).toBeInstanceOf(HttpException);
    expect((limited as HttpException).getStatus()).toBe(429);
    expect((limited as HttpException).getResponse()).toMatchObject({
      code: "creator_remote_reference_rate_limited",
    });
    expect(http.request).not.toHaveBeenCalled();
  });

  it("limits per-user concurrent fetches and releases capacity after settlement", async () => {
    const pending: Array<(value: StudioRemoteReferenceHttpResponse) => void> = [];
    const http = requester(() => new Promise((resolve) => pending.push(resolve)));
    const service = new StudioRemoteReferenceImageService(publicResolver(), http);
    const userId = uniqueUser("concurrency");

    const first = service.importRemoteImage(
      userId,
      "https://images.example.org/first.png"
    );
    const second = service.importRemoteImage(
      userId,
      "https://images.example.org/second.png"
    );
    const busy = await service.importRemoteImage(
      userId,
      "https://images.example.org/third.png"
    ).catch((error: unknown) => error);
    expect(busy).toBeInstanceOf(HttpException);
    expect((busy as HttpException).getStatus()).toBe(429);
    expect((busy as HttpException).getResponse()).toMatchObject({
      code: "creator_remote_reference_busy",
    });

    await vi.waitFor(() => expect(http.request).toHaveBeenCalledTimes(2));
    pending.splice(0).forEach((resolve) => resolve(successfulPngResponse()));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    // A policy failure, rather than another busy response, proves both finally paths released.
    await expect(service.importRemoteImage(userId, "http://127.0.0.1/image.png"))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
