import { describe, expect, it } from "vitest";

import { calculateStudioCrc32 } from "./studio-crc32";

function independentCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

describe("calculateStudioCrc32", () => {
  it("matches the standard CRC-32 check vector and empty input", () => {
    expect(calculateStudioCrc32(new Uint8Array())).toBe(0);
    expect(calculateStudioCrc32(new TextEncoder().encode("123456789"))).toBe(0xcbf4_3926);
  });

  it("matches an independent bitwise implementation for deterministic binary patterns", () => {
    for (const length of [1, 255, 4_097, 65_537]) {
      const bytes = Uint8Array.from(
        { length },
        (_, index) => (index * 131 + (index >>> 3) * 17) & 0xff,
      );
      expect(calculateStudioCrc32(bytes)).toBe(independentCrc32(bytes));
    }
  });

  it("respects typed-array view boundaries without changing the source", () => {
    const owner = Uint8Array.from({ length: 40 }, (_, index) => index);
    const before = owner.slice();
    const view = owner.subarray(7, 31);

    expect(calculateStudioCrc32(view)).toBe(independentCrc32(view));
    expect(owner).toEqual(before);
  });
});
