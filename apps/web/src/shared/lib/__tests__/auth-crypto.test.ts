import { describe, it, expect } from "vitest";

import { hashPassword, verifyPassword } from "../auth-crypto";

describe("auth-crypto", () => {
  it("해시는 salt:hash 형식이고 평문을 노출하지 않는다", () => {
    const h = hashPassword("hunter2!");
    expect(h).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(h).not.toContain("hunter2");
  });

  it("올바른 비밀번호는 검증 통과", () => {
    const h = hashPassword("correct-horse");
    expect(verifyPassword("correct-horse", h)).toBe(true);
  });

  it("틀린 비밀번호는 거부", () => {
    const h = hashPassword("correct-horse");
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("같은 비밀번호도 매번 다른 해시(랜덤 salt)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("손상·빈 해시는 false", () => {
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "no-colon")).toBe(false);
    expect(verifyPassword("x", "deadbeef:zzzz")).toBe(false);
  });
});
