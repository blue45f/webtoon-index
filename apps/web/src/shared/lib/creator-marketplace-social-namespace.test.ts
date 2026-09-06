import { describe, expect, it } from "vitest";

import {
  CREATOR_MARKETPLACE_SOCIAL_COMMENT_ID_PREFIX,
  CREATOR_MARKETPLACE_SOCIAL_REVIEW_ID_PREFIX,
  CREATOR_MARKETPLACE_SOCIAL_THREAD_PREFIX,
  isCreatorMarketplaceSocialInteractionId,
  isCreatorMarketplaceSocialNamespaceValue,
  isCreatorMarketplaceSocialThreadId,
} from "./creator-marketplace-social-namespace";

describe("creator marketplace social namespace", () => {
  it("keeps package threads and interaction ids outside ordinary title review ids", () => {
    const thread = `${CREATOR_MARKETPLACE_SOCIAL_THREAD_PREFIX}${"a".repeat(64)}`;
    const comment = `${CREATOR_MARKETPLACE_SOCIAL_COMMENT_ID_PREFIX}11111111-1111-4111-8111-111111111111`;
    const review = `${CREATOR_MARKETPLACE_SOCIAL_REVIEW_ID_PREFIX}22222222-2222-4222-8222-222222222222`;

    expect(isCreatorMarketplaceSocialThreadId(thread)).toBe(true);
    expect(isCreatorMarketplaceSocialInteractionId(comment)).toBe(true);
    expect(isCreatorMarketplaceSocialInteractionId(review)).toBe(true);
    expect(isCreatorMarketplaceSocialNamespaceValue(thread)).toBe(true);
    expect(isCreatorMarketplaceSocialNamespaceValue("ordinary-title-id")).toBe(false);
  });
});
