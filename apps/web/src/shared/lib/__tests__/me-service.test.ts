import { describe, expect, it } from "vitest";

import {
  MAX_COLLECTION_EMOJI_LENGTH,
  MAX_COLLECTION_NAME_LENGTH,
  MAX_MERGE_COLLECTION_TITLE_IDS,
  MAX_MERGE_COLLECTIONS,
  MAX_MERGE_ID_LENGTH,
  MAX_MERGE_MAP_ITEMS,
  MAX_MERGE_REVIEW_TEXT_LENGTH,
  MAX_MERGE_TAG_LENGTH,
  MAX_MERGE_TAGS,
  normalizeCollectionEmoji,
  normalizeCollectionName,
  normalizeMergePayload,
} from "../../../../../../apps/api/src/modules/me/me.service";

describe("me service input normalization", () => {
  it("caps imported local data before /api/me/merge bulk inserts it", () => {
    const manyRatings = Object.fromEntries(
      Array.from({ length: MAX_MERGE_MAP_ITEMS + 25 }, (_, index) => [` title-${index} `.repeat(4), 5])
    );
    const collections = Array.from({ length: MAX_MERGE_COLLECTIONS + 5 }, (_, collectionIndex) => ({
      name: `컬렉션 ${collectionIndex} `.repeat(40),
      emoji: "📚".repeat(20),
      titleIds: Array.from({ length: MAX_MERGE_COLLECTION_TITLE_IDS + 20 }, (_, titleIndex) =>
        ` collection-${collectionIndex}-title-${titleIndex} `.repeat(8)
      ),
    }));

    const normalized = normalizeMergePayload({
      ratings: manyRatings,
      subscriptions: manyRatings,
      likedReviews: manyRatings,
      collections,
    });

    expect(normalized.ratings).toHaveLength(MAX_MERGE_MAP_ITEMS);
    expect(normalized.subscriptions).toHaveLength(MAX_MERGE_MAP_ITEMS);
    expect(normalized.likedReviews).toHaveLength(MAX_MERGE_MAP_ITEMS);
    expect(normalized.collections).toHaveLength(MAX_MERGE_COLLECTIONS);
    expect(normalized.collections[0]?.name.length).toBeLessThanOrEqual(MAX_COLLECTION_NAME_LENGTH);
    expect(normalized.collections[0]?.emoji.length).toBeLessThanOrEqual(MAX_COLLECTION_EMOJI_LENGTH);
    expect(normalized.collections[0]?.titleIds).toHaveLength(MAX_MERGE_COLLECTION_TITLE_IDS);
    expect(normalized.collections[0]?.titleIds.every((titleId) => titleId.length <= MAX_MERGE_ID_LENGTH)).toBe(true);
  });

  it("drops invalid merge values and clamps review text and tags", () => {
    const normalized = normalizeMergePayload({
      ratings: {
        good: 4.5,
        [" ".repeat(5)]: 5,
        invalid: "nope",
      },
      reads: {
        want: "want",
        invalid: "archived",
      },
      reviews: {
        good: {
          rating: 99,
          text: "후기".repeat(MAX_MERGE_REVIEW_TEXT_LENGTH),
          tags: Array.from({ length: MAX_MERGE_TAGS + 3 }, (_, index) => `태그-${index}`.repeat(20)),
          spoiler: "truthy",
        },
      },
      collections: [
        {
          name: "  ",
          titleIds: ["title-a"],
        },
      ],
    });

    expect(normalized.ratings).toEqual([{ titleId: "good", value: 4.5 }]);
    expect(normalized.reads).toEqual([{ titleId: "want", state: "want" }]);
    expect(normalized.reviews).toHaveLength(1);
    expect(normalized.reviews[0]?.rating).toBe(5);
    expect(normalized.reviews[0]?.text.length).toBe(MAX_MERGE_REVIEW_TEXT_LENGTH);
    expect(normalized.reviews[0]?.tags).toHaveLength(MAX_MERGE_TAGS);
    expect(normalized.reviews[0]?.tags.every((tag) => tag.length <= MAX_MERGE_TAG_LENGTH)).toBe(true);
    expect(normalized.collections).toEqual([]);
  });

  it("preserves canonical guest collection IDs and empty collections for login merge", () => {
    const clientId = "550e8400-e29b-41d4-a716-446655440000";
    const normalized = normalizeMergePayload({
      collections: [
        { id: clientId, name: " 빈 컬렉션 ", emoji: "📚", titleIds: [] },
        { id: "legacy-local-id", name: "구버전", titleIds: [] },
      ],
    });

    expect(normalized.collections).toEqual([
      { clientId, name: "빈 컬렉션", emoji: "📚", titleIds: [] },
      { name: "구버전", emoji: "📚", titleIds: [] },
    ]);
  });

  it("normalizes collection names and emoji for direct collection updates", () => {
    expect(normalizeCollectionName("  ".repeat(10))).toBe("");
    expect(normalizeCollectionName("이름".repeat(100)).length).toBeLessThanOrEqual(MAX_COLLECTION_NAME_LENGTH);
    expect(normalizeCollectionEmoji("📚".repeat(20)).length).toBeLessThanOrEqual(MAX_COLLECTION_EMOJI_LENGTH);
    expect(normalizeCollectionEmoji(undefined)).toBe("📚");
  });
});
