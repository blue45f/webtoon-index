import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError, adminFetch, adminFetchText } from "./admin-client";

import { HTTPError } from "@/src/infrastructure/api";

const { raw } = vi.hoisted(() => ({ raw: vi.fn() }));
vi.mock("@/src/infrastructure/api", () => ({
  api: { raw },
  apiPath: (path: string) => `https://api.qa.invalid${path}`,
  HTTPError: class extends Error {
    constructor(public response: Response, public data: unknown) { super("HTTP failure"); }
  },
}));

describe("admin client hardening", () => {
  beforeEach(() => { raw.mockReset(); raw.mockResolvedValue(new Response('{"ok":true}')); });

  it("uses configured API base and preserves query", async () => {
    await adminFetch("/users?q=a%26b", "not-a-credential");
    expect(raw.mock.calls[0][0]).toBe("https://api.qa.invalid/api/admin/users?q=a%26b");
    expect(new Headers(raw.mock.calls[0][1].headers).has("x-user-id")).toBe(false);
  });
  it("forwards caller cancellation", async () => {
    const controller = new AbortController();
    await adminFetch("/users", "u", { signal: controller.signal });
    expect(raw.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it("preserves explicit content type without duplicate values", async () => {
    await adminFetch("/config", "u", {method:"POST",body:"x",headers:{"content-type":"text/plain"}});
    expect(new Headers(raw.mock.calls[0][1].headers).get("content-type")).toBe("text/plain");
  });
  it("does not override FormData multipart boundaries", async () => {
    await adminFetch("/upload", "u", {method:"POST",body:new FormData()});
    expect(new Headers(raw.mock.calls[0][1].headers).has("content-type")).toBe(false);
  });
  it("handles whitespace-only successful bodies", async () => {
    raw.mockResolvedValue(new Response(" \n\t"));
    await expect(adminFetch("/users", "u")).resolves.toBeUndefined();
  });
  it("wraps unexpected HTML rather than leaking SyntaxError", async () => {
    raw.mockResolvedValue(new Response("<html>gateway</html>"));
    await expect(adminFetch("/users", "u")).rejects.toBeInstanceOf(AdminApiError);
  });
  it("shows actionable validation messages before generic error labels", async () => {
    // The isolated double has a two-argument constructor; avoid depending on
    // the transport library's changing constructor signature in this unit test.
    const error = Object.assign(Object.create(HTTPError.prototype), {
      response:new Response(null,{status:400}), data:{error:"Bad Request",message:["Name required","Email invalid"]},
    });
    raw.mockRejectedValue(error);
    await expect(adminFetch("/users", "u")).rejects.toMatchObject({status:400,message:"Name required\nEmail invalid"});
  });
  it("keeps non-HTTP failures intact", async () => {
    const error = new DOMException("Aborted", "AbortError"); raw.mockRejectedValue(error);
    await expect(adminFetch("/users", "u")).rejects.toBe(error);
  });
  it("preserves CSV exports", async () => {
    raw.mockResolvedValue(new Response("name,role\nQA,admin"));
    await expect(adminFetchText("/users/export/csv", "u")).resolves.toBe("name,role\nQA,admin");
  });
});
