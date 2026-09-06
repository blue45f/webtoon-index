import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_TOKEN_TTL_MS,
  SESSION_USER_CACHE_MAX_ENTRIES,
  SESSION_USER_CACHE_TTL_MS,
  clearSessionUserCache,
  getSessionUserCached,
  invalidateSessionUser,
  sessionUserCacheSize,
  signSession,
  verifySession,
  verifySessionToken,
} from "../../../../../../apps/api/src/server/session";

// 세션 마이크로캐시 — 요청마다 나가던 users SELECT(예: isAdminUser)를 TTL 30초로 흡수하는 계층.
// loader 주입형이라 DB 없이 호출 횟수로 캐시 동작을 검증한다.
describe("session user micro-cache", () => {
  beforeEach(() => {
    clearSessionUserCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSessionUserCache();
  });

  function makeLoader() {
    let calls = 0;
    const loader = async (id: string) => {
      calls += 1;
      return { id, role: "user", email: `${id}@example.com` };
    };
    return { loader, count: () => calls };
  }

  it("TTL(30초) 내 재조회는 loader 를 다시 호출하지 않고, 만료 후엔 다시 읽는다", async () => {
    const { loader, count } = makeLoader();

    const first = await getSessionUserCached("u-1", loader);
    const second = await getSessionUserCached("u-1", loader);
    expect(first).toEqual(second);
    expect(count()).toBe(1); // 캐시 적중 — SELECT 1회만

    vi.advanceTimersByTime(SESSION_USER_CACHE_TTL_MS - 1);
    await getSessionUserCached("u-1", loader);
    expect(count()).toBe(1); // 아직 TTL 내

    vi.advanceTimersByTime(2); // TTL 경과
    await getSessionUserCached("u-1", loader);
    expect(count()).toBe(2); // 만료 → 재조회
  });

  it("invalidateSessionUser — 프로필/권한 변경 직후 해당 사용자만 즉시 무효화된다", async () => {
    const { loader, count } = makeLoader();
    await getSessionUserCached("u-a", loader);
    await getSessionUserCached("u-b", loader);
    expect(count()).toBe(2);

    invalidateSessionUser("u-a");
    await getSessionUserCached("u-a", loader); // 무효화된 사용자 → 재조회
    await getSessionUserCached("u-b", loader); // 다른 사용자 → 캐시 유지
    expect(count()).toBe(3);

    // null/undefined 는 조용히 무시(기존 시그니처 호출부 안전)
    expect(() => invalidateSessionUser(null)).not.toThrow();
    expect(() => invalidateSessionUser(undefined)).not.toThrow();
  });

  it("null(미존재 사용자) 결과도 TTL 동안 캐시해 반복 SELECT 를 막는다", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return null;
    };
    expect(await getSessionUserCached("ghost", loader)).toBeNull();
    expect(await getSessionUserCached("ghost", loader)).toBeNull();
    expect(calls).toBe(1);
  });

  it("loader 가 throw 하면(DB 장애) 캐시하지 않는다 — 복구 후 즉시 정상 조회", async () => {
    let calls = 0;
    const flaky = async (id: string) => {
      calls += 1;
      if (calls === 1) throw new Error("db down");
      return { id, role: "user", email: null };
    };
    await expect(getSessionUserCached("u-err", flaky)).rejects.toThrow("db down");
    expect(sessionUserCacheSize()).toBe(0);
    await expect(getSessionUserCached("u-err", flaky)).resolves.toMatchObject({ id: "u-err" });
  });

  it("최대 500엔트리 — 가득 차면 가장 오래 사용되지 않은 항목부터 정리(LRU성)", async () => {
    const { loader, count } = makeLoader();
    for (let i = 0; i < SESSION_USER_CACHE_MAX_ENTRIES; i++) {
      await getSessionUserCached(`u-${i}`, loader);
    }
    expect(sessionUserCacheSize()).toBe(SESSION_USER_CACHE_MAX_ENTRIES);

    // u-0 을 최근 사용으로 터치 → 다음 정리에서 u-1 이 먼저 빠진다
    await getSessionUserCached("u-0", loader);
    expect(count()).toBe(SESSION_USER_CACHE_MAX_ENTRIES); // 터치는 캐시 적중

    await getSessionUserCached("u-new", loader); // 한도 도달 → 가장 오래된 u-1 제거
    expect(sessionUserCacheSize()).toBeLessThanOrEqual(SESSION_USER_CACHE_MAX_ENTRIES);

    const before = count();
    await getSessionUserCached("u-0", loader); // 살아남음 → 적중
    expect(count()).toBe(before);
    await getSessionUserCached("u-1", loader); // 제거됨 → 재조회
    expect(count()).toBe(before + 1);
  });
});

describe("서명 세션 토큰(기존 시그니처 유지)", () => {
  it("sign → verify 라운드트립, 변조 토큰과 레거시 토큰은 거부", () => {
    const token = signSession("user-123", 7);
    expect(verifySession(token)).toBe("user-123");
    expect(verifySessionToken(token)).toMatchObject({ userId: "user-123", sessionVersion: 7 });
    expect(verifySession(`${token}x`)).toBeNull();
    expect(verifySession("user-123")).toBeNull(); // 레거시 평문 id 거부
    expect(verifySession("user-123.fake-signature")).toBeNull(); // v1 결정적 토큰도 거부
    expect(verifySession(null)).toBeNull();
  });

  it("만료된 v2 토큰은 거부한다", () => {
    const token = signSession("user-expired", 1, 0);
    expect(verifySessionToken(token, SESSION_TOKEN_TTL_MS - 1)).toMatchObject({ userId: "user-expired" });
    expect(verifySessionToken(token, SESSION_TOKEN_TTL_MS + 1)).toBeNull();
  });
});
