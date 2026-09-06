import { describe, it, expect } from "vitest";

import { rateLimit, clientIp } from "../rate-limit";

describe("rateLimit", () => {
  it("한도까지 허용하고 초과분은 차단", () => {
    const key = "rl-test-limit";
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(false); // 4번째 차단
  });

  it("키별로 독립 카운트", () => {
    expect(rateLimit("rl-test-x", 1, 60_000)).toBe(true);
    expect(rateLimit("rl-test-x", 1, 60_000)).toBe(false);
    expect(rateLimit("rl-test-y", 1, 60_000)).toBe(true); // 다른 키는 영향 없음
  });
});

describe("clientIp", () => {
  it("x-forwarded-for의 맨 왼쪽 IP", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("x-real-ip 폴백", () => {
    const req = new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("헤더 없으면 unknown", () => {
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
