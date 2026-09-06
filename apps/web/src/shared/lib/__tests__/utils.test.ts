import { describe, it, expect } from "vitest";

import { kstDayOfWeek, formatCount, clamp } from "../utils";

describe("kstDayOfWeek", () => {
  it("0~6 범위의 정수를 반환 (서버 TZ 무관)", () => {
    const d = kstDayOfWeek();
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(6);
  });
});

describe("formatCount", () => {
  it("천 미만은 그대로", () => {
    expect(formatCount(980)).toBe("980");
  });
  it("만/억 단위 축약", () => {
    expect(formatCount(12345)).toBe("1.2만");
    expect(formatCount(123456789)).toBe("1.2억");
  });
});

describe("clamp", () => {
  it("범위로 제한", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
