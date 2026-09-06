// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAuthSession,
  handleSessionCoordinationMessage,
  persistSession,
} from "./auth-session-state";
import {
  CLIENT_SESSION_MAX_SERIALIZED_BYTES,
  readClientSession,
  SESSION_KEY,
} from "./auth-session-storage";

function jwtWithExpiry(expiresAtSeconds: number): string {
  const encode = (value: unknown) => globalThis
    .btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `${encode({ alg: "none" })}.${encode({ exp: expiresAtSeconds })}.signature`;
}

describe("browser auth session persistence", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
    persistSession(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    persistSession(null);
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  it("migrates only the public profile and destroys a legacy localStorage bearer", () => {
    const legacy = {
      user: { id: "legacy-user", name: "이전 사용자" },
      token: "opaque-legacy-token",
    };
    globalThis.localStorage.setItem(SESSION_KEY, JSON.stringify(legacy));

    const profileOnly = {
      user: { id: "legacy-user", name: "이전 사용자" },
      token: null,
    };
    expect(readClientSession()).toEqual(profileOnly);
    expect(globalThis.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(JSON.parse(globalThis.sessionStorage.getItem(SESSION_KEY) ?? "null"))
      .toEqual(profileOnly);
  });

  it("drops malformed and oversized JSON instead of repeatedly parsing it", () => {
    globalThis.sessionStorage.setItem(SESSION_KEY, "{not-json");
    expect(readClientSession()).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_KEY)).toBeNull();

    globalThis.sessionStorage.setItem(
      SESSION_KEY,
      "x".repeat(CLIENT_SESSION_MAX_SERIALIZED_BYTES + 1),
    );
    expect(readClientSession()).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("rejects a locally observable expired credential", () => {
    globalThis.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        user: { id: "expired-user" },
        token: jwtWithExpiry(Math.floor(Date.now() / 1_000) - 10),
      }),
    );

    expect(readClientSession()).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("retains a completed login in memory when Web Storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    persistSession({
      user: { id: "memory-only-user", name: "메모리 사용자" },
      token: "memory-only-token",
    });

    expect(getAuthSession()).toEqual({
      user: { id: "memory-only-user", name: "메모리 사용자" },
      token: null,
    });
    expect(globalThis.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("applies a versioned remote logout message without accepting session data", () => {
    persistSession({ user: { id: "tab-user" }, token: "tab-token" });

    handleSessionCoordinationMessage({
      type: "logout",
      version: 1,
      token: "must-not-be-used",
    });

    expect(getAuthSession()).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("publishes only a versioned logout signal to other tabs", () => {
    const channelPost = typeof globalThis.BroadcastChannel === "function"
      ? vi.spyOn(globalThis.BroadcastChannel.prototype, "postMessage")
      : null;
    const storageSet = channelPost
      ? null
      : vi.spyOn(Storage.prototype, "setItem");

    persistSession({ user: { id: "originating-tab" }, token: "private-token" });
    persistSession(null);

    if (channelPost) {
      expect(channelPost).toHaveBeenCalledWith({ type: "logout", version: 1 });
      expect(JSON.stringify(channelPost.mock.calls)).not.toContain("private-token");
      expect(JSON.stringify(channelPost.mock.calls)).not.toContain("originating-tab");
      return;
    }
    const logoutSignal = storageSet?.mock.calls.find(
      ([key]) => key === "toonspectrum-auth-session-logout-v1",
    );
    expect(logoutSignal).toBeDefined();
    expect(JSON.stringify(logoutSignal)).not.toContain("private-token");
    expect(JSON.stringify(logoutSignal)).not.toContain("originating-tab");
  });
});
