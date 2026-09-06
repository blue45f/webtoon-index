import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// CJS handler(module.exports = fn)를 default import 로 가져옵니다(Vitest CJS interop).
import ogHandler from "../../../../../../api/og.js";

describe("api/og.js SSRF and SSR Meta Injection", () => {
  let originalFetch: typeof fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    vi.stubEnv("CANONICAL_HOST", "test-canonical.com");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    mockFetch.mockReset();
  });

  it("returns SPA template directly if the User-Agent is not a bot", async () => {
    const req = {
      query: { slug: "test-webtoon" },
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    };

    let statusVal = 0;
    let sentContent = "";
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockImplementation((code) => {
        statusVal = code;
        return {
          send: (content: string) => {
            sentContent = content;
          },
        };
      }),
    };

    await ogHandler(req, res);

    expect(statusVal).toBe(200);
    expect(sentContent).toContain("<!doctype html>");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses the canonical host and NOT the req Host/X-Forwarded-Host for fetching (SSRF prevention)", async () => {
    const req = {
      query: { slug: "test-webtoon" },
      headers: {
        "user-agent": "facebookexternalhit/1.1",
        "x-forwarded-host": "malicious-host.com",
        "host": "another-malicious.com",
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        title: {
          title: "테스트 웹툰",
          synopsis: "재미있는 웹툰 설명",
          coverImage: "/covers/test.png",
          author: "작가A",
          genres: ["일상", "개그"],
          releaseYear: 2025,
          stats: { ratingCount: 150, ratingAvg: 4.8 },
        },
      }),
    });

    let statusVal = 0;
    let sentContent = "";
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockImplementation((code) => {
        statusVal = code;
        return {
          send: (content: string) => {
            sentContent = content;
          },
        };
      }),
    };

    await ogHandler(req, res);

    // fetch 호출이 malicious-host.com이 아닌 CANONICAL_HOST인 test-canonical.com으로 진행되었는지 검증
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("https://test-canonical.com/api/titles/test-webtoon");
    expect(calledUrl).not.toContain("malicious-host.com");
    expect(calledUrl).not.toContain("another-malicious.com");

    expect(statusVal).toBe(200);
    expect(sentContent).toContain("<title>테스트 웹툰 · 툰스펙트럼</title>");
    expect(sentContent).toContain('content="작가A · 일상 · 개그 — 재미있는 웹툰 설명"');
    expect(sentContent).toContain('href="https://test-canonical.com/title/test-webtoon"');
    expect(sentContent).toContain('content="https://test-canonical.com/covers/test.png"');
    expect(sentContent).toContain('type="application/ld+json"');

    // JSON-LD 구조 확인
    const ldJsonMatch = sentContent.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
    expect(ldJsonMatch).not.toBeNull();
    const ldData = JSON.parse(ldJsonMatch![1]);
    expect(ldData["@context"]).toBe("https://schema.org");
    const book = ldData["@graph"][0];
    expect(book["@type"]).toBe("Book");
    expect(book["name"]).toBe("테스트 웹툰");
    expect(book["author"]["name"]).toBe("작가A");
    expect(book["aggregateRating"]["ratingValue"]).toBe(4.8);
    expect(book["aggregateRating"]["ratingCount"]).toBe(150);

    // Cache-Control 검증
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=300, s-maxage=86400");
  });

  it("defaults OG fetches and generated URLs to the www toonstudio.cloud host", async () => {
    vi.stubEnv("CANONICAL_HOST", "");
    mockFetch.mockRejectedValue(new Error("expected metadata fallback"));
    const req = {
      query: { slug: "canonical-probe" },
      headers: { "user-agent": "Twitterbot/1.0" },
    };
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnValue({ send: vi.fn() }),
    };

    await ogHandler(req, res);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.toonstudio.cloud/api/titles/canonical-probe",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
  });

  it("injects crawler-safe market resource metadata from the canonical API", async () => {
    const resourceId = "123e4567-e89b-42d3-a456-426614174000";
    const req = {
      query: { marketResourceId: resourceId },
      headers: {
        "user-agent": "facebookexternalhit/1.1",
        host: "attacker.invalid",
        "x-forwarded-host": "metadata.internal",
      },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: resourceId,
        name: "먹선 </script><script>alert(1)</script>",
        description: "웹툰 펜선용 브러시",
        kind: "brush",
        resourceVersion: "1.2.0",
        license: "cc-by-4.0",
        tags: ["잉크", "선화"],
        publisher: { id: "publisher", name: "김작가" },
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
      }),
    });
    let sentContent = "";
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnValue({
        send: (content: string) => {
          sentContent = content;
        },
      }),
    };

    await ogHandler(req, res);

    expect(mockFetch).toHaveBeenCalledWith(
      `https://test-canonical.com/api/creator/marketplace/resources/${resourceId}`,
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
    expect(String(mockFetch.mock.calls[0]?.[0])).not.toContain("attacker.invalid");
    expect(sentContent).toContain(
      `href="https://test-canonical.com/market/resource/${resourceId}"`,
    );
    expect(sentContent).toContain('<meta property="og:type" content="article" />');
    expect(sentContent).toContain("먹선 &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(sentContent).not.toContain("</script><script>alert(1)</script>");

    const scripts = [...sentContent.matchAll(
      /<script type="application\/ld\+json">(.*?)<\/script>/gu,
    )];
    const routeGraph = JSON.parse(scripts.at(-1)?.[1] ?? "null");
    expect(routeGraph["@graph"][0]).toMatchObject({
      "@type": "CreativeWork",
      version: "1.2.0",
      isAccessibleForFree: true,
      author: { "@type": "Person", name: "김작가" },
      license: "https://creativecommons.org/licenses/by/4.0/",
    });
    expect(routeGraph["@graph"][1]["@type"]).toBe("BreadcrumbList");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store",
    );
  });

  it("injects crawler-safe static metadata for the market discovery route", async () => {
    const req = {
      query: { marketPage: "browse" },
      headers: { "user-agent": "Googlebot/2.1" },
    };
    let sentContent = "";
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnValue({
        send: (content: string) => {
          sentContent = content;
        },
      }),
    };

    await ogHandler(req, res);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(sentContent).toContain("<title>마켓 탐색 · 툰스펙트럼</title>");
    expect(sentContent).toContain(
      'href="https://test-canonical.com/market/browse"',
    );
    expect(sentContent).toContain('"@type":"SearchResultsPage"');
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=300, s-maxage=86400",
    );
  });

  it("does not fetch or cache malformed market resource identifiers", async () => {
    const req = {
      query: { marketResourceId: "../../metadata" },
      headers: { "user-agent": "Twitterbot/1.0" },
    };
    const send = vi.fn();
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnValue({ send }),
    };

    await ogHandler(req, res);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(send).toHaveBeenCalledOnce();
  });

  it("handles fetch failures gracefully by falling back to default template with no-store cache", async () => {
    const req = {
      query: { slug: "missing-webtoon" },
      headers: { "user-agent": "Twitterbot/1.0" },
    };

    mockFetch.mockRejectedValue(new Error("Network Error"));

    let statusVal = 0;
    let sentContent = "";
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockImplementation((code) => {
        statusVal = code;
        return {
          send: (content: string) => {
            sentContent = content;
          },
        };
      }),
    };

    await ogHandler(req, res);

    expect(statusVal).toBe(200);
    expect(sentContent).toContain("<!doctype html>");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});
