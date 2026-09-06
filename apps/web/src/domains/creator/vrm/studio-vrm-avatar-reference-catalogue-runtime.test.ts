import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_MAX_BYTES,
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL,
  type StudioVrmAvatarReferenceCatalogueEnvelope,
} from "./studio-vrm-avatar-reference-product";
import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
} from "./studio-vrm-avatar-reference-recommendation";

const PRODUCT_MODULE = "./studio-vrm-avatar-reference-product";
const RUNTIME_MODULE = "./studio-vrm-avatar-reference-catalogue-runtime";

type ProductModule = typeof import("./studio-vrm-avatar-reference-product");
type RuntimeModule = typeof import("./studio-vrm-avatar-reference-catalogue-runtime");

function fakeEnvelope(): StudioVrmAvatarReferenceCatalogueEnvelope {
  return {
    authority: {} as StudioVrmAvatarReferenceCatalogueEnvelope["authority"],
    renders: [],
    catalogue: {
      version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
      providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
      modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
      modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
      modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
      catalogueRevision: "runtime-fixture-v1",
      entries: [],
    },
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function streamedResponse(
  bytes: Uint8Array,
  options: {
    readonly chunkSize?: number;
    readonly declaredLength?: number;
    readonly status?: number;
  } = {},
): Response {
  const chunkSize = options.chunkSize ?? Math.max(1, Math.floor(bytes.byteLength / 3));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.byteLength, offset + chunkSize);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
  return new Response(body, {
    status: options.status ?? 200,
    headers: {
      "content-length": String(options.declaredLength ?? bytes.byteLength),
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function runtimeFor(input: {
  readonly bytes: Uint8Array;
  readonly admitted?: StudioVrmAvatarReferenceCatalogueEnvelope | null;
}): Promise<RuntimeModule> {
  vi.resetModules();
  vi.doMock(PRODUCT_MODULE, async () => {
    const actual = await vi.importActual<ProductModule>(PRODUCT_MODULE);
    return {
      ...actual,
      STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_BYTE_LENGTH: input.bytes.byteLength,
      STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_SHA256: sha256(input.bytes),
      admitStudioVrmAvatarReferenceCatalogueEnvelope: () => input.admitted ?? null,
    };
  });
  return import(RUNTIME_MODULE);
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock(PRODUCT_MODULE);
  vi.resetModules();
});

describe("Avatar reference catalogue runtime loader", () => {
  it("streams and admits the committed public artifact with production constants", async () => {
    vi.doUnmock(PRODUCT_MODULE);
    vi.resetModules();
    const runtime = await import(RUNTIME_MODULE);
    const bytes = new Uint8Array(readFileSync(new URL("../../../../public/catalog/studio-vrm-avatar-reference-catalogue-v1.json",
      import.meta.url,
    )));

    const result = await runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl: (async () => streamedResponse(bytes, { chunkSize: 4_093 })) as typeof fetch,
    });
    expect(result).toMatchObject({
      status: "ready",
      catalogueRevision: "avatar-forge-reference-v1-1f8584c7b07e687d",
      diagnostic: { code: "ready" },
    });
    expect(result.catalogue?.entries).toHaveLength(21);
  });

  it("streams one exact same-origin artifact, shares the flight, and caches only success", async () => {
    const bytes = new TextEncoder().encode("{\"fixture\":true}\n");
    const runtime = await runtimeFor({ bytes, admitted: fakeEnvelope() });
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(_url).toBe(STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL);
      expect(init).toMatchObject({
        cache: "no-cache",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      return streamedResponse(bytes, { chunkSize: 2 });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      runtime.loadStudioVrmAvatarReferenceCatalogue({ fetchImpl }),
      runtime.loadStudioVrmAvatarReferenceCatalogue({ fetchImpl }),
    ]);
    expect(first.status).toBe("ready");
    expect(second).toBe(first);
    expect(first.catalogueRevision).toBe("runtime-fixture-v1");
    expect(first.diagnostic).toMatchObject({
      code: "ready",
      expectedByteLength: bytes.byteLength,
      expectedSha256: sha256(bytes),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();

    expect(await runtime.loadStudioVrmAvatarReferenceCatalogue({ fetchImpl })).toBe(first);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("isolates caller abort from the shared request and the other caller", async () => {
    const bytes = new TextEncoder().encode("{\"fixture\":true}\n");
    const runtime = await runtimeFor({ bytes, admitted: fakeEnvelope() });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let coreSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      coreSignal = init?.signal ?? undefined;
      await gate;
      return streamedResponse(bytes);
    }) as typeof fetch;
    const caller = new AbortController();

    const aborted = runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl,
      signal: caller.signal,
    });
    const surviving = runtime.loadStudioVrmAvatarReferenceCatalogue({ fetchImpl });
    caller.abort();
    expect(await aborted).toMatchObject({
      status: "unavailable",
      diagnostic: { code: "aborted" },
    });
    expect(coreSignal).not.toBe(caller.signal);
    expect(coreSignal?.aborted).toBe(false);

    release();
    await expect(surviving).resolves.toMatchObject({ status: "ready" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not permanently cache an HTTP failure and permits an explicit retry", async () => {
    const bytes = new TextEncoder().encode("{\"fixture\":true}\n");
    const runtime = await runtimeFor({ bytes, admitted: fakeEnvelope() });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(streamedResponse(new Uint8Array(), {
        declaredLength: 0,
        status: 503,
      }))
      .mockResolvedValueOnce(streamedResponse(bytes)) as typeof fetch;

    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({ fetchImpl })).resolves
      .toMatchObject({ status: "unavailable", diagnostic: { code: "http", httpStatus: 503 } });
    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({ fetchImpl })).resolves
      .toMatchObject({ status: "ready" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("distinguishes byte-length, digest, and maximum-size failures", async () => {
    const bytes = new TextEncoder().encode("{\"fixture\":true}\n");
    const runtime = await runtimeFor({ bytes, admitted: fakeEnvelope() });
    const short = bytes.slice(0, -1);
    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl: (async () => streamedResponse(short)) as typeof fetch,
    })).resolves.toMatchObject({ diagnostic: { code: "byte-length" } });

    const changed = bytes.slice();
    changed[0] = changed[0]! ^ 1;
    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl: (async () => streamedResponse(changed)) as typeof fetch,
    })).resolves.toMatchObject({ diagnostic: { code: "digest" } });

    const oversized = new Uint8Array(STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_MAX_BYTES + 1);
    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl: (async () => streamedResponse(oversized)) as typeof fetch,
    })).resolves.toMatchObject({ diagnostic: { code: "too-large" } });
  });

  it.each([
    ["utf8", new Uint8Array([0xc3, 0x28]), fakeEnvelope()],
    ["json", new TextEncoder().encode("{"), fakeEnvelope()],
    ["admission", new TextEncoder().encode("{}\n"), null],
  ] as const)("returns a bounded %s diagnostic after exact integrity succeeds", async (
    code,
    bytes,
    admitted,
  ) => {
    const runtime = await runtimeFor({ bytes, admitted });
    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl: (async () => streamedResponse(bytes)) as typeof fetch,
    })).resolves.toMatchObject({
      status: "unavailable",
      catalogue: null,
      diagnostic: { code },
    });
  });

  it("distinguishes network, redirect, and bounded timeout failures", async () => {
    const bytes = new TextEncoder().encode("{\"fixture\":true}\n");
    const runtime = await runtimeFor({ bytes, admitted: fakeEnvelope() });
    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
    })).resolves.toMatchObject({ diagnostic: { code: "network" } });

    const redirected = streamedResponse(bytes);
    Object.defineProperty(redirected, "redirected", { configurable: true, value: true });
    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl: (async () => redirected) as typeof fetch,
    })).resolves.toMatchObject({ diagnostic: { code: "redirect" } });

    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as typeof fetch;
    const pending = runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ diagnostic: { code: "timeout" } });
  });

  it("does not start a shared request for a pre-aborted caller", async () => {
    const bytes = new TextEncoder().encode("{\"fixture\":true}\n");
    const runtime = await runtimeFor({ bytes, admitted: fakeEnvelope() });
    const caller = new AbortController();
    caller.abort();
    const fetchImpl = vi.fn(async () => streamedResponse(bytes)) as typeof fetch;

    await expect(runtime.loadStudioVrmAvatarReferenceCatalogue({
      fetchImpl,
      signal: caller.signal,
    })).resolves.toMatchObject({ diagnostic: { code: "aborted" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
