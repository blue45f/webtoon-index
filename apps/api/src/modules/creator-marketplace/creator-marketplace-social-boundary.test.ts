import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const service = readFileSync(resolve(
  root,
  "apps/api/src/modules/creator-marketplace/creator-marketplace-social.service.ts",
), "utf8");
const controller = readFileSync(resolve(
  root,
  "apps/api/src/modules/creator-marketplace/creator-marketplace-social.controller.ts",
), "utf8");
const moduleSource = readFileSync(resolve(
  root,
  "apps/api/src/modules/creator-marketplace/creator-marketplace.module.ts",
), "utf8");
const hook = readFileSync(resolve(
  root,
  "apps/web/src/domains/market/hooks/use-market-social.ts",
), "utf8");
const comments = readFileSync(resolve(
  root,
  "apps/web/src/domains/market/components/MarketCommentsSection.tsx",
), "utf8");
const reviews = readFileSync(resolve(
  root,
  "apps/web/src/domains/market/components/MarketReviewsSection.tsx",
), "utf8");
const genericReviewFeed = readFileSync(resolve(
  root,
  "apps/api/src/server/reviews.ts",
), "utf8");

describe("creator marketplace social boundaries", () => {
  it("stores package-level discussion under a collision-resistant identity", () => {
    expect(service).toContain(
      'const MARKET_SOCIAL_KEY_PREFIX = "toonspectrum:market-package:"',
    );
    expect(service).toContain("creatorMarketplacePackageIdentityPreimage");
    expect(service).toContain('createHash("sha256")');
    expect(service).toContain("reviewReplies.reviewId");
    expect(service).toContain("reviews.titleId");
    expect(service).toContain("reviewLikes.reviewId");
  });

  it("uses exact Studio evidence where the installer supports it and labels fallback honestly", () => {
    const eligibility = service.slice(
      service.indexOf("private async assertReviewEligible"),
      service.indexOf("async page("),
    );
    expect(service).toContain("CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS");
    expect(service).toContain(
      "creatorMarketplaceLibraryItems.lastConfirmedResourceVersion",
    );
    expect(eligibility).toContain("membership.studioInstallVerified");
    expect(eligibility).toContain("studioVerificationSupported(resource)");
    expect(eligibility).toContain('qualification: "studio"');
    expect(eligibility).toContain('qualification: "library"');
    expect(eligibility).toContain(
      "Studio에서 설치를 완료한 뒤 평가할 수 있습니다.",
    );
    expect(reviews).toContain("Studio 설치 확인 완료");
    expect(reviews).toContain("계정 보관함 확인");
  });

  it("keeps public reads viewer-aware but uncached and gates every mutation", () => {
    expect(controller).toContain('@Get("/:id/social")');
    expect(controller).toContain(
      '@Header("Cache-Control", "private, no-store, max-age=0")',
    );
    for (const route of [
      '@Post("/:id/comments")',
      '@Delete("/:id/comments/:commentId")',
      '@Post("/:id/comments/:commentId/like")',
      '@Put("/:id/review")',
      '@Delete("/:id/review")',
      '@Post("/:id/reviews/:reviewId/helpful")',
    ]) {
      expect(controller).toContain(route);
    }
    expect(controller.match(/requireUserId\(userId\)/gu)?.length)
      .toBeGreaterThanOrEqual(6);
  });

  it("keeps market review rows out of the title review feed and homepage totals", () => {
    expect(genericReviewFeed).toContain(
      'const MARKET_REVIEW_TITLE_PREFIX = "toonspectrum:market-package:"',
    );
    expect(genericReviewFeed).toContain("NON_MARKET_REVIEW_CONDITION");
    expect(genericReviewFeed).toContain("notLike");
  });

  it("registers the social runtime and blocks self-helpful inflation", () => {
    expect(moduleSource).toContain("CreatorMarketplaceSocialController");
    expect(moduleSource).toContain("CreatorMarketplaceSocialService");
    expect(service).toContain("review.ownerId === userId");
    expect(service).toContain(
      "자신의 리뷰에는 도움 반응을 남길 수 없습니다.",
    );
  });

  it("deduplicates detail reads and revalidates sibling releases and browser tabs", () => {
    expect(hook).toContain("useSyncExternalStore");
    expect(hook).toContain("BroadcastChannel");
    expect(hook).toContain("candidate.packageId === data.packageId");
    expect(hook).toContain('window.addEventListener("focus", refresh)');
    expect(hook).toContain('window.addEventListener("pageshow", refresh)');
  });

  it("removes client impersonation and browser-local social truth", () => {
    expect(comments).toContain("useMarketSocial");
    expect(reviews).toContain("useMarketSocial");
    expect(comments).not.toContain("market-social-store");
    expect(reviews).not.toContain("market-social-store");
    expect(comments).not.toContain("authorNameInput");
    expect(reviews).toContain("대상 v{review.sourceResourceVersion}");
  });
});
