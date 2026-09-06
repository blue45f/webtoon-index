export const CREATOR_MARKETPLACE_SOCIAL_THREAD_PREFIX =
  "toonspectrum:market-package:";
export const CREATOR_MARKETPLACE_SOCIAL_COMMENT_ID_PREFIX =
  "market-comment:";
export const CREATOR_MARKETPLACE_SOCIAL_REVIEW_ID_PREFIX =
  "market-review:";

function startsWithPrefix(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix);
}

export function isCreatorMarketplaceSocialThreadId(
  value: unknown,
): value is string {
  return startsWithPrefix(value, CREATOR_MARKETPLACE_SOCIAL_THREAD_PREFIX);
}

export function isCreatorMarketplaceSocialInteractionId(
  value: unknown,
): value is string {
  return startsWithPrefix(
    value,
    CREATOR_MARKETPLACE_SOCIAL_COMMENT_ID_PREFIX,
  ) || startsWithPrefix(
    value,
    CREATOR_MARKETPLACE_SOCIAL_REVIEW_ID_PREFIX,
  );
}

export function isCreatorMarketplaceSocialNamespaceValue(
  value: unknown,
): value is string {
  return isCreatorMarketplaceSocialThreadId(value)
    || isCreatorMarketplaceSocialInteractionId(value);
}
