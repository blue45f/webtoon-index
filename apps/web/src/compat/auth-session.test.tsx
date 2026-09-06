// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "./auth-session";
import { persistSession, useSession } from "./auth-session-store";

const apiRaw = vi.hoisted(() => vi.fn());

vi.mock("@/src/infrastructure/api", () => ({
  api: { raw: apiRaw },
  apiPath: (path: string) => `/api${path}`,
}));

function authenticatedResponse(): Response {
  return new Response(
    JSON.stringify({
      authenticated: true,
      user: {
        id: "provider-user",
        name: "서버 사용자",
        email: null,
        image: null,
        role: "user",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function unauthenticatedResponse(): Response {
  return new Response(
    JSON.stringify({ authenticated: false, user: null }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function flushPendingWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function SessionProbe() {
  const { data, ready, status } = useSession();
  return <output>{`${ready ? "ready" : "pending"}:${status}:${data?.user.id ?? "none"}`}</output>;
}

describe("SessionProvider server reconciliation", () => {
  beforeEach(() => {
    apiRaw.mockReset();
    apiRaw.mockImplementation(async () => authenticatedResponse());
    persistSession(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    persistSession(null);
  });

  it("앱 시작과 다시 focus될 때 HttpOnly 쿠키 세션을 동기화한다", async () => {
    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    expect(screen.getByText("pending:unauthenticated:none")).toBeTruthy();
    await waitFor(() => expect(apiRaw).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("ready:authenticated:provider-user")).toBeTruthy();

    globalThis.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(apiRaw).toHaveBeenCalledTimes(2));
  });

  it("명시적인 서버 미인증 응답만 준비된 로그아웃 상태로 확정한다", async () => {
    apiRaw.mockImplementation(async () => unauthenticatedResponse());

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    expect(screen.getByText("pending:unauthenticated:none")).toBeTruthy();
    expect(await screen.findByText("ready:unauthenticated:none")).toBeTruthy();
  });

  it.each([
    ["네트워크 오류", () => Promise.reject(new TypeError("offline"))],
    [
      "5xx 응답",
      () => Promise.resolve(
        new Response(JSON.stringify({ error: "temporarily unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ],
    [
      "손상 응답",
      () => Promise.resolve(
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ],
  ])("초기 %s를 미인증으로 강등하지 않고 cleanup 시 재시도를 취소한다", async (_label, response) => {
    vi.useFakeTimers();
    apiRaw.mockImplementation(response);

    const { unmount } = render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );
    await flushPendingWork();

    expect(apiRaw).toHaveBeenCalledTimes(1);
    expect(screen.getByText("pending:unauthenticated:none")).toBeTruthy();

    unmount();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(apiRaw).toHaveBeenCalledTimes(1);
  });

  it("미확정 응답은 마지막 공개 프로필을 유지하되 검증 전에는 ready가 아니다", async () => {
    vi.useFakeTimers();
    persistSession({ user: { id: "cached-user" }, token: null });
    apiRaw.mockRejectedValue(new TypeError("offline"));

    const { unmount } = render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );
    await flushPendingWork();

    expect(screen.getByText("pending:authenticated:cached-user")).toBeTruthy();
    unmount();
  });

  it.each(["online", "focus"])("자동 재시도를 제한하고 %s 복구 시 서버 세션을 다시 확인한다", async (recoveryEvent) => {
    vi.useFakeTimers();
    apiRaw.mockRejectedValue(new TypeError("offline"));

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );
    await flushPendingWork();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(apiRaw).toHaveBeenCalledTimes(4);
    expect(screen.getByText("pending:unauthenticated:none")).toBeTruthy();

    apiRaw.mockImplementation(async () => authenticatedResponse());
    await act(async () => {
      globalThis.dispatchEvent(new Event(recoveryEvent));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiRaw).toHaveBeenCalledTimes(5);
    expect(screen.getByText("ready:authenticated:provider-user")).toBeTruthy();
  });
});
