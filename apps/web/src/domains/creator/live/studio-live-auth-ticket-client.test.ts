import { describe, expect, it, vi } from "vitest";

import {
  createStudioLiveGuestCredential,
  requestStudioLiveAuthTicket,
} from "./studio-live-auth-ticket-client";

const TICKET = `${"a".repeat(36)}.${"b".repeat(80)}.${"c".repeat(43)}`;

describe("Studio live auth ticket client", () => {
  it("uses only cookie credentials and the existing CSRF proof", async () => {
    const payload = {
      version: 1,
      ticket: TICKET,
      issuedAt: "2026-08-02T00:00:00.000Z",
      expiresAt: "2026-08-02T00:01:00.000Z",
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    await expect(requestStudioLiveAuthTicket({
      endpoint: "/api/creator/studio-live/auth-ticket",
      fetch,
    })).resolves.toEqual(payload);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/creator/studio-live/auth-ticket");
    expect(init?.credentials).toBe("include");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-toonspectrum-csrf")).toBe("1");
    expect(headers.has("x-user-id")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({ version: 1 });
  });

  it("rejects malformed or oversized responses without reflecting their body", async () => {
    const malformed = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ error: "secret-provider-body" }), { status: 200 }));
    const error = await requestStudioLiveAuthTicket({ fetch: malformed })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("secret-provider-body");

    await expect(requestStudioLiveAuthTicket({
      fetch: vi.fn<typeof globalThis.fetch>(async () =>
        new Response("x", { headers: { "Content-Length": "999999" } })),
    })).rejects.toThrow("허용 크기를 초과");
  });

  it("creates only a canonical cryptographically-shaped guest credential", () => {
    expect(createStudioLiveGuestCredential(
      () => "7a75f75a-4abc-4def-8abc-04c9e58a52f1",
    )).toBe("guest:v1:7a75f75a-4abc-4def-8abc-04c9e58a52f1");
    expect(() => createStudioLiveGuestCredential(() => "guessable"))
      .toThrow();
  });
});
