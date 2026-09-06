import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  discardLegacyStudioStockImageAccessKey,
  isStudioStockImageConfigured,
  loadStudioStockImageAccessKey,
  saveStudioStockImageAccessKey,
  searchStockPhotos,
  STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY,
  STUDIO_STOCK_IMAGE_RESULTS_PER_PAGE,
  triggerStockImageDownload,
  type StudioStockImageStorage,
} from "./studio-stock-image-client";

// 인메모리 Web Storage — sessionStorage/localStorage 양쪽 DI 계약을 흉내낸다.
function createMemoryStorage(): StudioStockImageStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const ACCESS_KEY = "unsplash-test-access-key";

// 실제 Unsplash Search Photos 응답의 최소 재현(문서화된 필드만) — 정상 사진 1장.
function unsplashPhotoFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "photo-1",
    description: null,
    alt_description: "a city street at night",
    width: 4000,
    height: 3000,
    color: "#0a0a0a",
    urls: {
      raw: "https://images.unsplash.com/photo-1?raw",
      full: "https://images.unsplash.com/photo-1?full",
      regular: "https://images.unsplash.com/photo-1?regular",
      small: "https://images.unsplash.com/photo-1?small",
      thumb: "https://images.unsplash.com/photo-1?thumb",
    },
    links: {
      self: "https://api.unsplash.com/photos/photo-1",
      html: "https://unsplash.com/photos/photo-1",
      download: "https://unsplash.com/photos/photo-1/download",
      download_location: "https://api.unsplash.com/photos/photo-1/download",
    },
    user: {
      id: "user-1",
      username: "janedoe",
      name: "Jane Doe",
      links: {
        self: "https://api.unsplash.com/users/janedoe",
        html: "https://unsplash.com/@janedoe",
      },
    },
    ...overrides,
  };
}

describe("studio-stock-image-client access key storage", () => {
  it("returns an empty string when storage is empty/absent", () => {
    expect(loadStudioStockImageAccessKey(null)).toBe("");
    expect(loadStudioStockImageAccessKey(createMemoryStorage())).toBe("");
  });

  it("round-trips via save/load", () => {
    const storage = createMemoryStorage();
    saveStudioStockImageAccessKey(storage, ACCESS_KEY);
    expect(loadStudioStockImageAccessKey(storage)).toBe(ACCESS_KEY);
    expect(storage.data.get(STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY)).toBe(ACCESS_KEY);
  });

  it("discards the legacy persistent key without importing it", () => {
    const legacyStorage = createMemoryStorage();
    legacyStorage.data.set(STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY, ACCESS_KEY);
    discardLegacyStudioStockImageAccessKey(legacyStorage);
    expect(legacyStorage.data.has(STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY)).toBe(false);
  });

  it("isStudioStockImageConfigured requires a non-blank key", () => {
    expect(isStudioStockImageConfigured("")).toBe(false);
    expect(isStudioStockImageConfigured("   ")).toBe(false);
    expect(isStudioStockImageConfigured(ACCESS_KEY)).toBe(true);
  });
});

describe("studio-stock-image-client network calls (fetch mocked)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("searchStockPhotos", () => {
    it("does NOT call fetch when the access key is missing (not_configured, no network)", async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("도시 야경", "");

      expect(result).toEqual({ ok: false, code: "not_configured", error: expect.any(String) });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does NOT call fetch for a blank query even when configured", async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("   ", ACCESS_KEY);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_input");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends the exact Unsplash Search Photos request shape (URL/method/headers)", async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ total: 0, total_pages: 0, results: [] }), { status: 200 })
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await searchStockPhotos("도시 야경", ACCESS_KEY);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];

      const expectedUrl = new URL("https://api.unsplash.com/search/photos");
      expectedUrl.searchParams.set("query", "도시 야경");
      expectedUrl.searchParams.set("page", "1");
      expectedUrl.searchParams.set("per_page", String(STUDIO_STOCK_IMAGE_RESULTS_PER_PAGE));
      expectedUrl.searchParams.set("content_filter", "low");
      expect(url).toBe(expectedUrl.toString());

      expect(init.method).toBe("GET");
      expect(init.headers).toEqual({ Authorization: `Client-ID ${ACCESS_KEY}`, "Accept-Version": "v1" });
    });

    it("passes a custom page number through to the request URL", async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ total: 0, total_pages: 0, results: [] }), { status: 200 })
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await searchStockPhotos("cats", ACCESS_KEY, { page: 3 });

      const [url] = mockFetch.mock.calls[0] as unknown as [string];
      expect(new URL(url).searchParams.get("page")).toBe("3");
    });

    it("normalizes a well-formed response into StudioStockPhoto[] with UTM-tagged credit links", async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ total: 132, total_pages: 7, results: [unsplashPhotoFixture()] }),
            { status: 200, headers: { "X-Ratelimit-Limit": "50", "X-Ratelimit-Remaining": "42" } }
          )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("도시 야경", ACCESS_KEY, { page: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.total).toBe(132);
      expect(result.data.totalPages).toBe(7);
      expect(result.data.page).toBe(2);
      expect(result.data.rateLimit).toEqual({ limit: 50, remaining: 42 });
      expect(result.data.photos).toHaveLength(1);

      const photo = result.data.photos[0];
      expect(photo.id).toBe("photo-1");
      expect(photo.description).toBe("a city street at night");
      expect(photo.width).toBe(4000);
      expect(photo.height).toBe(3000);
      expect(photo.color).toBe("#0a0a0a");
      expect(photo.thumbUrl).toBe("https://images.unsplash.com/photo-1?small");
      expect(photo.insertUrl).toBe("https://images.unsplash.com/photo-1?regular");
      expect(photo.downloadLocationUrl).toBe("https://api.unsplash.com/photos/photo-1/download");
      expect(photo.credit.photographerName).toBe("Jane Doe");
      expect(photo.credit.photographerProfileUrl).toBe(
        "https://unsplash.com/@janedoe?utm_source=toonspectrum&utm_medium=referral"
      );
      expect(photo.credit.unsplashPhotoPageUrl).toBe(
        "https://unsplash.com/photos/photo-1?utm_source=toonspectrum&utm_medium=referral"
      );
    });

    it("falls back to alt_description when description is present and non-null", async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              total: 1,
              total_pages: 1,
              results: [unsplashPhotoFixture({ description: "a moody description", alt_description: null })],
            }),
            { status: 200 }
          )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.photos[0].description).toBe("a moody description");
    });

    it("rateLimit is null when the response has no rate-limit headers", async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ total: 0, total_pages: 0, results: [] }), { status: 200 })
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.rateLimit).toBeNull();
    });

    it("skips malformed entries but keeps well-formed ones (one bad photo doesn't fail the whole search)", async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              total: 2,
              total_pages: 1,
              results: [{ id: "broken", urls: {} }, unsplashPhotoFixture({ id: "photo-2" })],
            }),
            { status: 200 }
          )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.photos).toHaveLength(1);
        expect(result.data.photos[0].id).toBe("photo-2");
      }
    });

    it("returns http_error with Unsplash's {errors:[...]} message on 401 (invalid key)", async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ errors: ["Invalid access token"] }), { status: 401 })
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("http_error");
        expect(result.error).toContain("401");
        expect(result.error).toContain("Invalid access token");
      }
    });

    it("returns http_error on 403 rate limit exceeded", async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ errors: ["Rate Limit Exceeded"] }), { status: 403 })
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("http_error");
        expect(result.error).toContain("Rate Limit Exceeded");
      }
    });

    it("returns network_error when fetch rejects", async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error("offline");
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result).toEqual({ ok: false, code: "network_error", error: "offline" });
    });

    it("returns parse_error on malformed JSON body", async () => {
      const mockFetch = vi.fn(async () => new Response("not json", { status: 200 }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("parse_error");
    });

    it("returns parse_error when the response has no results array", async () => {
      const mockFetch = vi.fn(async () => new Response(JSON.stringify({ total: 0 }), { status: 200 }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await searchStockPhotos("cats", ACCESS_KEY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("parse_error");
    });
  });

  describe("triggerStockImageDownload", () => {
    const DOWNLOAD_LOCATION_URL = "https://api.unsplash.com/photos/photo-1/download";

    it("does NOT call fetch when the access key is missing", async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await triggerStockImageDownload(DOWNLOAD_LOCATION_URL, "");
      expect(result).toEqual({ ok: false, code: "not_configured", error: expect.any(String) });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does NOT call fetch when the download_location URL is blank", async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await triggerStockImageDownload("", ACCESS_KEY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_input");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls the exact download_location URL with a GET + Authorization header", async () => {
      const mockFetch = vi.fn(async () => new Response(JSON.stringify({ url: "https://unsplash.com" }), { status: 200 }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await triggerStockImageDownload(DOWNLOAD_LOCATION_URL, ACCESS_KEY);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(DOWNLOAD_LOCATION_URL);
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual({ Authorization: `Client-ID ${ACCESS_KEY}` });
      expect(result).toEqual({ ok: true, data: undefined });
    });

    it("returns http_error on non-2xx", async () => {
      const mockFetch = vi.fn(async () => new Response("", { status: 404 }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await triggerStockImageDownload(DOWNLOAD_LOCATION_URL, ACCESS_KEY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("http_error");
    });

    it("returns network_error when fetch rejects", async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error("offline");
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await triggerStockImageDownload(DOWNLOAD_LOCATION_URL, ACCESS_KEY);
      expect(result).toEqual({ ok: false, code: "network_error", error: "offline" });
    });
  });
});

// inlineStockPhotoForCanvas는 이 스위트에서 의도적으로 테스트하지 않는다 — Image/canvas 픽셀
// 디코딩에 의존해 jsdom으로 검증할 수 없다(studio-image-utils.ts의 downscaleImageFile/
// downscaleDataUrl과 동일한 처지 — 모듈 상단 docstring §5-2 참고).
