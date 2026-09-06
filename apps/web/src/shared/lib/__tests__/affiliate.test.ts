import { describe, expect, it } from "vitest";

import { isAffiliateSupported, buildAffiliateUrl } from "../affiliate";

describe("Affiliate utilities", () => {
  describe("isAffiliateSupported", () => {
    it("returns true for registered platforms", () => {
      expect(isAffiliateSupported("ridi")).toBe(true);
      expect(isAffiliateSupported("yes24")).toBe(true);
      expect(isAffiliateSupported("kyobo")).toBe(true);
      expect(isAffiliateSupported("munpia")).toBe(true);
      expect(isAffiliateSupported("novelpia")).toBe(true);
    });

    it("returns false for unregistered platforms", () => {
      expect(isAffiliateSupported("naver-webtoon")).toBe(false);
      expect(isAffiliateSupported("kakao-page")).toBe(false);
      expect(isAffiliateSupported("google")).toBe(false);
    });
  });

  describe("buildAffiliateUrl", () => {
    it("returns empty string if URL is falsy", () => {
      expect(buildAffiliateUrl("ridi", "")).toBe("");
    });

    it("returns original URL if platform is not supported", () => {
      const url = "https://comic.naver.com/webtoon/list?titleId=12345";
      expect(buildAffiliateUrl("naver-webtoon", url)).toBe(url);
    });

    it("appends affiliate parameter using searchParams if valid URL", () => {
      const original = "https://ridibooks.com/books/123456";
      const decorated = buildAffiliateUrl("ridi", original);
      expect(decorated).toBe("https://ridibooks.com/books/123456?ridi_affiliate=toonspectrum");
    });

    it("updates existing affiliate parameter", () => {
      const original = "https://ridibooks.com/books/123456?ridi_affiliate=old_value&other=1";
      const decorated = buildAffiliateUrl("ridi", original);
      expect(decorated).toContain("ridi_affiliate=toonspectrum");
      expect(decorated).toContain("other=1");
    });

    it("appends affiliate parameter with string fallback for relative/malformed URLs", () => {
      const relative = "/books/123456";
      expect(buildAffiliateUrl("ridi", relative)).toBe("/books/123456?ridi_affiliate=toonspectrum");

      const relativeWithQuery = "/books/123456?page=2";
      expect(buildAffiliateUrl("ridi", relativeWithQuery)).toBe("/books/123456?page=2&ridi_affiliate=toonspectrum");
    });
  });
});
