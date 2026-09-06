import { describe, expect, it } from "vitest";

import { resolvePgPoolOptions } from "../../../../../../apps/api/src/db";

// pg 풀 슬림화(Neon 비용 가드) 옵션 파서 — 유휴 연결을 빨리 닫아 Neon autosuspend 를 유도하는 설정.
// (모듈 import 는 Pool 객체만 만들고 실제 연결은 하지 않는다 — 쿼리 전까지 lazy.)
describe("resolvePgPoolOptions", () => {
  it("기본값: max 3 · idle 10s · connect 10s · allowExitOnIdle", () => {
    expect(resolvePgPoolOptions({})).toEqual({
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
  });

  it("환경변수 재정의: WEBDEX_PG_POOL_MAX · WEBDEX_PG_IDLE_MS", () => {
    const options = resolvePgPoolOptions({ WEBDEX_PG_POOL_MAX: "8", WEBDEX_PG_IDLE_MS: "30000" });
    expect(options.max).toBe(8);
    expect(options.idleTimeoutMillis).toBe(30_000);
    expect(options.allowExitOnIdle).toBe(true);
  });

  it("범위 클램프 + 잘못된 값은 기본값", () => {
    expect(resolvePgPoolOptions({ WEBDEX_PG_POOL_MAX: "0" }).max).toBe(1); // 최소 1
    expect(resolvePgPoolOptions({ WEBDEX_PG_POOL_MAX: "999" }).max).toBe(50); // 상한
    expect(resolvePgPoolOptions({ WEBDEX_PG_POOL_MAX: "abc" }).max).toBe(3);
    expect(resolvePgPoolOptions({ WEBDEX_PG_IDLE_MS: "10" }).idleTimeoutMillis).toBe(1_000); // 최소 1s
    expect(resolvePgPoolOptions({ WEBDEX_PG_IDLE_MS: "" }).idleTimeoutMillis).toBe(10_000);
    expect(resolvePgPoolOptions({ WEBDEX_PG_IDLE_MS: "3.9e5" }).idleTimeoutMillis).toBe(390_000);
  });
});
