import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchApiResource, NotFoundError } from "./use-api-resource";

describe("useApiResource fetch 계약", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("200 응답을 JSON 으로 파싱하고 no-store 로 요청한다", async () => {
    const payload = { hello: "world" };
    const mockFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(payload), { status: 200 })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const data = await fetchApiResource<typeof payload>("/api/home", "실패");

    expect(data).toEqual(payload);
    const request = mockFetch.mock.calls[0]![0] as unknown as Request;
    expect(request.cache).toBe("no-store");
  });

  it("404 는 NotFoundError 로 던진다(notFound 흐름)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("null", { status: 404 })
    ) as unknown as typeof fetch;

    await expect(fetchApiResource("/api/authors/none", "실패")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("그 외 비-OK 응답은 errorMessage 로 던진다", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("boom", { status: 500 })
    ) as unknown as typeof fetch;

    await expect(fetchApiResource("/api/home", "홈 데이터를 불러오지 못했습니다.")).rejects.toThrow(
      "홈 데이터를 불러오지 못했습니다."
    );
  });

  it("서버가 JSON message 를 반환하면 해당 메시지를 보존해 던진다", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ message: "서버 점검 중입니다." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    await expect(fetchApiResource("/api/home", "홈 데이터를 불러오지 못했습니다.")).rejects.toThrow(
      "서버 점검 중입니다."
    );
  });
});
