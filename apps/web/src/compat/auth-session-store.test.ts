import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAuthSession,
  getAuthToken,
  mergeCurrentSessionProfile,
  persistSession,
  signIn,
  signInWithGoogleIdToken,
  signOut,
  synchronizeServerSession,
  synchronizeServerSessionState,
} from "./auth-session-store";

const apiRaw = vi.hoisted(() => vi.fn());

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

vi.mock("@/src/infrastructure/api", () => ({
  api: { raw: apiRaw },
  apiPath: (path: string) => `/api${path}`,
}));

describe("auth session store", () => {
  beforeEach(() => {
    apiRaw.mockReset();
    persistSession(null);
  });

  afterEach(() => {
    persistSession(null);
  });

  it("로그아웃 네트워크 실패는 두 번만 재시도한 뒤 pending으로 남기고 세션을 유지한다", async () => {
    persistSession({ user: { id: "web-user" }, token: null });
    apiRaw.mockRejectedValue(new TypeError("network unavailable"));
    const wait = vi.fn(async () => undefined);

    await expect(signOut({ retryDelaysMs: [10, 20, 30], wait })).resolves.toEqual({
      ok: false,
      status: "pending",
      attempts: 3,
      httpStatus: 0,
      error: "로그아웃 확인에 실패했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
    });

    expect(apiRaw).toHaveBeenCalledTimes(3);
    expect(apiRaw).toHaveBeenLastCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        throwHttpErrors: false,
      }),
    );
    expect(wait).toHaveBeenNthCalledWith(1, 10);
    expect(wait).toHaveBeenNthCalledWith(2, 20);
    expect(getAuthToken()).toBeNull();
    expect(getAuthSession()?.user.id).toBe("web-user");
  });

  it("로그아웃 재시도가 권위 응답을 받으면 그때만 로컬 세션을 정리한다", async () => {
    persistSession({ user: { id: "web-user" }, token: null });
    apiRaw
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      signOut({ retryDelaysMs: [0], wait: async () => undefined }),
    ).resolves.toEqual({
      ok: true,
      status: "signed-out",
      attempts: 2,
      httpStatus: 204,
      error: null,
    });
    expect(apiRaw).toHaveBeenCalledTimes(2);
    expect(getAuthSession()).toBeNull();
  });

  it("동시에 누른 로그아웃은 하나의 bounded 요청열만 공유한다", async () => {
    persistSession({ user: { id: "web-user" }, token: null });
    const response = deferred<Response>();
    apiRaw.mockReturnValue(response.promise);

    const first = signOut({ retryDelaysMs: [] });
    const second = signOut({ retryDelaysMs: [] });
    expect(first).toBe(second);
    expect(apiRaw).toHaveBeenCalledOnce();

    response.resolve(new Response(null, { status: 204 }));
    await expect(first).resolves.toMatchObject({
      ok: true,
      attempts: 1,
    });
    expect(getAuthSession()).toBeNull();
  });

  it("검증 전부터 형식이 잘못된 Google credential은 네트워크로 보내지 않는다", async () => {
    await expect(signInWithGoogleIdToken("not-a-jwt")).resolves.toEqual({
      ok: false,
      error: "Google 로그인 응답 형식이 올바르지 않아요.",
      status: 400,
    });
    expect(apiRaw).not.toHaveBeenCalled();
  });

  it("폐기된 Toss 인증 provider는 리다이렉트나 API 요청 없이 거부한다", async () => {
    await expect(signIn("toss")).resolves.toEqual({
      ok: false,
      error: "provider-unavailable-in-vite-spa",
      status: 501,
      url: null,
    });
    expect(apiRaw).not.toHaveBeenCalled();
  });

  it("Google ID 토큰 로그인 성공 시 공개 프로필만 저장한다", async () => {
    apiRaw.mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: "google-user", email: "artist@example.com" },
          token: "signed-google-session",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await signInWithGoogleIdToken("header.payload.signature");

    expect(result).toEqual({ ok: true, error: null, status: 200 });
    expect(apiRaw).toHaveBeenCalledWith(
      "/api/auth/oauth/google/id-token",
      expect.objectContaining({
        method: "POST",
        json: { idToken: "header.payload.signature" },
        throwHttpErrors: false,
      }),
    );
    expect(getAuthToken()).toBeNull();
    expect(getAuthSession()?.user.id).toBe("google-user");
    expect(getAuthSession()?.token).toBeNull();
  });

  it("서버의 안전한 Google 로그인 오류를 표시하고 기존 세션은 만들지 않는다", async () => {
    apiRaw.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Google 로그인 정보가 만료되었어요." }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      signInWithGoogleIdToken("header.payload.signature"),
    ).resolves.toEqual({
      ok: false,
      error: "Google 로그인 정보가 만료되었어요.",
      status: 401,
    });
    expect(getAuthSession()).toBeNull();
  });

  it("Google 로그인 내부 장애의 안전한 503 문구와 상태를 그대로 전달한다", async () => {
    const error = "Google 로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
    apiRaw.mockResolvedValue(
      new Response(
        JSON.stringify({ error }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      signInWithGoogleIdToken("header.payload.signature"),
    ).resolves.toEqual({
      ok: false,
      error,
      status: 503,
    });
    expect(getAuthSession()).toBeNull();
  });

  it.each([
    { error: { message: "internal detail" } },
    { error: ["internal detail"] },
    { error: "   " },
  ])("문자열이 아닌 Google 오류 응답은 안전한 문구로 대체한다: %j", async (payload) => {
    apiRaw.mockResolvedValue(
      new Response(
        JSON.stringify(payload),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      signInWithGoogleIdToken("header.payload.signature"),
    ).resolves.toEqual({
      ok: false,
      error: "Google 로그인에 실패했어요. 다시 시도해 주세요.",
      status: 502,
    });
    expect(getAuthSession()).toBeNull();
  });

  it("네트워크 실패를 예외로 전파하지 않고 재시도 가능한 결과로 반환한다", async () => {
    apiRaw.mockRejectedValue(new TypeError("network unavailable"));

    await expect(
      signInWithGoogleIdToken("header.payload.signature"),
    ).resolves.toEqual({
      ok: false,
      error: "로그인 서버에 연결하지 못했어요. 네트워크를 확인해 주세요.",
      status: 0,
    });
    expect(getAuthSession()).toBeNull();
  });

  it("HttpOnly 쿠키 세션의 공개 사용자 정보를 재수화한다", async () => {
    apiRaw.mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "cookie-user",
            name: "쿠키 사용자",
            email: "cookie@example.com",
            image: null,
            role: "user",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(synchronizeServerSession("startup")).resolves.toEqual({
      user: {
        id: "cookie-user",
        name: "쿠키 사용자",
        email: "cookie@example.com",
        image: null,
        role: "user",
      },
      token: null,
    });
    expect(apiRaw).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        throwHttpErrors: false,
      }),
    );
  });

  it("서버의 명시적 미인증 상태만 stale 클라이언트 세션을 제거한다", async () => {
    persistSession({ user: { id: "stale-user" }, token: "stale-token" });
    apiRaw.mockResolvedValue(
      new Response(
        JSON.stringify({ authenticated: false, user: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(synchronizeServerSession("focus")).resolves.toBeNull();
    expect(getAuthSession()).toBeNull();
  });

  it("401은 캐시와 구분되는 권위 있는 미인증 상태로 반환한다", async () => {
    persistSession({ user: { id: "expired-user" }, token: null });
    apiRaw.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(synchronizeServerSessionState("focus")).resolves.toEqual({
      status: "unauthenticated",
      session: null,
    });
    expect(getAuthSession()).toBeNull();
  });

  it("로그인 도중 도착한 이전 세션 응답이 새 계정을 덮어쓰지 않는다", async () => {
    const oldSessionResponse = deferred<Response>();
    apiRaw.mockImplementation((path: string) => {
      if (path === "/api/auth/session") return oldSessionResponse.promise;
      if (path === "/api/auth/login") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: "new-account",
                name: "새 계정",
                email: "new@example.com",
                image: null,
                role: "creator",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const staleSynchronization = synchronizeServerSession("startup");
    await expect(
      signIn("credentials", {
        email: "new@example.com",
        password: "correct horse battery staple",
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    oldSessionResponse.resolve(
      new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "old-account",
            name: "이전 계정",
            email: "old@example.com",
            image: null,
            role: "user",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(staleSynchronization).resolves.toMatchObject({
      user: { id: "new-account" },
      token: null,
    });
    expect(getAuthSession()?.user.id).toBe("new-account");
  });

  it("로그아웃 도중 도착한 이전 인증 응답이 세션을 되살리지 않는다", async () => {
    persistSession({ user: { id: "signed-in-user" }, token: null });
    const oldSessionResponse = deferred<Response>();
    apiRaw.mockImplementation((path: string) => {
      if (path === "/api/auth/session") return oldSessionResponse.promise;
      if (path === "/api/auth/logout") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const staleSynchronization = synchronizeServerSession("focus");
    await signOut({ retryDelaysMs: [], wait: async () => undefined });
    oldSessionResponse.resolve(
      new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "signed-in-user",
            name: null,
            email: null,
            image: null,
            role: "user",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(staleSynchronization).resolves.toBeNull();
    expect(getAuthSession()).toBeNull();
  });

  it("세션 동기화 네트워크 실패와 손상 응답에는 마지막 확인 상태를 유지한다", async () => {
    const cached = { user: { id: "cached-user" }, token: null };
    persistSession({ user: cached.user, token: "cached-token" });
    apiRaw.mockRejectedValueOnce(new TypeError("offline"));
    await expect(synchronizeServerSession("focus")).resolves.toEqual(cached);

    apiRaw.mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true, user: { id: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(synchronizeServerSession("focus")).resolves.toEqual(cached);
    expect(getAuthSession()).toEqual(cached);
  });

  it("네트워크·5xx·손상 응답을 미인증이 아닌 미확정 상태로 구분한다", async () => {
    const cached = { user: { id: "cached-user" }, token: null };
    persistSession(cached);

    apiRaw.mockRejectedValueOnce(new TypeError("offline"));
    await expect(synchronizeServerSessionState("startup")).resolves.toEqual({
      status: "indeterminate",
      session: cached,
    });

    apiRaw.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "temporarily unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(synchronizeServerSessionState("startup")).resolves.toEqual({
      status: "indeterminate",
      session: cached,
    });

    apiRaw.mockResolvedValueOnce(
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(synchronizeServerSessionState("startup")).resolves.toEqual({
      status: "indeterminate",
      session: cached,
    });
    expect(getAuthSession()).toEqual(cached);
  });

  it("같은 계정의 서버 프로필을 병합하면서 bearer를 저장하지 않는다", () => {
    persistSession({
      user: { id: "profile-user", name: "이전 이름", role: "creator" },
      token: null,
    });

    expect(
      mergeCurrentSessionProfile({
        id: "profile-user",
        name: "새 이름",
        image: "https://images.example/avatar.webp",
      }),
    ).toEqual({
      user: {
        id: "profile-user",
        name: "새 이름",
        image: "https://images.example/avatar.webp",
        role: "creator",
      },
      token: null,
    });
  });
});
