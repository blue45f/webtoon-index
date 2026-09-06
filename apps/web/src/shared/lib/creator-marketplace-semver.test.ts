import { describe, expect, it } from "vitest";

import {
  CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS,
  compareCreatorMarketplaceSemver,
  isCreatorMarketplaceSemver,
  normalizeCreatorMarketplaceLegacySemver,
  suggestNextCreatorMarketplaceSemver,
} from "./creator-marketplace-semver";

describe("creator marketplace external SemVer contract", () => {
  it("normalizes only the historical prerelease spelling for precedence checks", () => {
    expect(normalizeCreatorMarketplaceLegacySemver("1.0.0-01")).toBe("1.0.0-1");
    expect(normalizeCreatorMarketplaceLegacySemver("1.0.0-alpha.0002")).toBe(
      "1.0.0-alpha.2",
    );
    expect(normalizeCreatorMarketplaceLegacySemver("1.0.0+build.7")).toBe(
      "1.0.0+build.7",
    );
    expect(normalizeCreatorMarketplaceLegacySemver("v1.0.0")).toBeNull();
  });

  it.each([
    "0.0.0",
    "1.2.3",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-x-y-z.--",
    "1.0.0+001",
    "1.0.0-rc.1+sha.01",
  ])("accepts strict SemVer 2.0 release %s", (version) => {
    expect(isCreatorMarketplaceSemver(version)).toBe(true);
  });

  it.each([
    "",
    "1",
    "1.2",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.0.0-01",
    "1.0.0-alpha.01",
    "1.0.0-alpha..1",
    "1.0.0+",
    "1.0.0+build_1",
    `1.0.0+${"a".repeat(CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS)}`,
  ])("rejects non-SemVer or overlong external release %s", (version) => {
    expect(isCreatorMarketplaceSemver(version)).toBe(false);
  });

  it("implements the SemVer prerelease precedence example", () => {
    const precedence = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];

    for (let index = 1; index < precedence.length; index += 1) {
      expect(compareCreatorMarketplaceSemver(
        precedence[index]!,
        precedence[index - 1]!,
      )).toBe(1);
    }
  });

  it("ignores build metadata when comparing release precedence", () => {
    expect(compareCreatorMarketplaceSemver(
      "1.0.0+build.7",
      "1.0.0+build.11",
    )).toBe(0);
    expect(compareCreatorMarketplaceSemver(
      "1.0.0-rc.1+sha.a",
      "1.0.0-rc.1+sha.b",
    )).toBe(0);
  });

  it("compares arbitrarily large numeric identifiers without number coercion", () => {
    expect(compareCreatorMarketplaceSemver(
      "999999999999999999999999999999.0.0",
      "999999999999999999999999999998.999.999",
    )).toBe(1);
  });

  it("fails closed when either comparison operand is invalid", () => {
    expect(() => compareCreatorMarketplaceSemver("1.0.0-01", "1.0.0"))
      .toThrowError("creator_marketplace_semver_invalid");
  });

  it.each([
    ["1.2.3-alpha.1", "1.2.3"],
    ["1.2.3-01", "1.2.3"],
    ["1.2.3", "1.2.4"],
    ["1.2.3+build.9", "1.2.4"],
    ["0.0.0", "0.0.1"],
    ["1.2", null],
  ])("suggests the next publishable release after %s", (current, expected) => {
    expect(suggestNextCreatorMarketplaceSemver(current)).toBe(expected);
  });

  it("uses BigInt and returns null when the incremented result exceeds the cap", () => {
    expect(suggestNextCreatorMarketplaceSemver(
      `1.2.${"9".repeat(35)}`,
    )).toBe(`1.2.1${"0".repeat(35)}`);
    expect(suggestNextCreatorMarketplaceSemver(
      `1.2.${"9".repeat(36)}`,
    )).toBeNull();
  });
});
