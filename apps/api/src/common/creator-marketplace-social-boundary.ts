import { and, inArray, like } from "drizzle-orm";

import {
  CREATOR_MARKETPLACE_SOCIAL_THREAD_PREFIX,
  isCreatorMarketplaceSocialInteractionId,
} from "../../../web/src/shared/lib/creator-marketplace-social-namespace";
import { db, reviewReplies, reviews } from "../db";

const INTERACTION_LOOKUP_BATCH_SIZE = 400;

function uniqueInteractionIds(values: readonly unknown[]): string[] {
  return [...new Set(values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  ))];
}

/**
 * The marketplace intentionally reuses mature review/reply reaction tables. This lookup keeps
 * generic title-review endpoints from mutating marketplace-owned UUID rows through an alternate
 * API, while also recognizing prefixed ids if the storage format is tightened later.
 */
export async function findCreatorMarketplaceSocialInteractionIds(
  values: readonly unknown[],
): Promise<Set<string>> {
  const ids = uniqueInteractionIds(values);
  const owned = new Set(ids.filter(isCreatorMarketplaceSocialInteractionId));

  for (let offset = 0; offset < ids.length; offset += INTERACTION_LOOKUP_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + INTERACTION_LOOKUP_BATCH_SIZE);
    const [reviewRows, commentRows] = await Promise.all([
      db
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(
          inArray(reviews.id, batch),
          like(
            reviews.titleId,
            `${CREATOR_MARKETPLACE_SOCIAL_THREAD_PREFIX}%`,
          ),
        )),
      db
        .select({ id: reviewReplies.id })
        .from(reviewReplies)
        .where(and(
          inArray(reviewReplies.id, batch),
          like(
            reviewReplies.reviewId,
            `${CREATOR_MARKETPLACE_SOCIAL_THREAD_PREFIX}%`,
          ),
        )),
    ]);
    for (const row of reviewRows) owned.add(row.id);
    for (const row of commentRows) owned.add(row.id);
  }

  return owned;
}
