import { describe, expect, it } from "vitest";

import {
  MARKET_KINDS,
  MARKET_LICENSES,
  formatMarketByteSize,
  formatMarketDate,
  marketKindMeta,
  marketLicenseMeta,
} from "./market-kind";

import {
  CREATOR_MARKETPLACE_RESOURCE_KINDS,
  CREATOR_MARKETPLACE_RESOURCE_LICENSES,
} from "@/shared/lib/creator-marketplace-resource-contract";


describe("market kind metadata", () => {
  it("마켓 계약의 모든 리소스 종류를 빠짐없이 커버한다", () => {
    expect([...MARKET_KINDS.map((meta) => meta.kind)].sort()).toEqual(
      [...CREATOR_MARKETPLACE_RESOURCE_KINDS].sort()
    );
  });

  it("종류 메타데이터는 고유한 hue와 비어 있지 않은 라벨을 가진다", () => {
    const hues = new Set(MARKET_KINDS.map((meta) => meta.hue));
    expect(hues.size).toBe(MARKET_KINDS.length);
    for (const meta of MARKET_KINDS) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.english.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      // 악센트 persimmon(hue 42)과 충돌하지 않게 데이터 hue는 우회 배치한다.
      expect(Math.abs(meta.hue - 42)).toBeGreaterThan(20);
    }
  });

  it("알 수 없는 종류는 안전한 폴백 메타데이터로 렌더링된다", () => {
    const fallback = marketKindMeta("brush");
    expect(fallback.label).toBe("브러시");
    expect(() => marketKindMeta("palette")).not.toThrow();
  });
});

describe("market license metadata", () => {
  it("마켓 계약의 모든 라이선스를 빠짐없이 커버한다", () => {
    expect([...MARKET_LICENSES.map((meta) => meta.license)].sort()).toEqual(
      [...CREATOR_MARKETPLACE_RESOURCE_LICENSES].sort()
    );
  });

  it("외부 출처 라이선스는 라이선스 전문 링크를 제공한다", () => {
    for (const meta of MARKET_LICENSES) {
      if (meta.license === "toonspectrum-standard") {
        expect(meta.url).toBeNull();
      } else {
        expect(meta.url?.startsWith("https://")).toBe(true);
      }
    }
    expect(marketLicenseMeta("cc0-1.0").label).toContain("CC0");
  });
});

describe("market formatting helpers", () => {
  it("바이트 크기를 사람이 읽는 단위로 표시한다", () => {
    expect(formatMarketByteSize(512)).toBe("512 B");
    expect(formatMarketByteSize(2048)).toBe("2.0 KB");
  });

  it("ISO 날짜를 한국어 표기로 바꾸고 비정상 입력은 원문을 돌려준다", () => {
    expect(formatMarketDate("2026-07-27T01:00:00.000Z")).toMatch(/2026/);
    expect(formatMarketDate("not-a-date")).toBe("not-a-date");
  });
});
