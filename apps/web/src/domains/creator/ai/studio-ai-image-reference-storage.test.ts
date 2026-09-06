import { describe, expect, it } from "vitest";

import {
  createEmptyStudioAiImageReferenceDocument,
  serializeStudioAiImageReferenceDocument,
} from "./studio-ai-image-reference-roles";
import {
  clearStudioAiImageReferenceDocument,
  loadStudioAiImageReferenceDocument,
  saveStudioAiImageReferenceDocument,
  STUDIO_AI_IMAGE_REFERENCE_STORAGE_LIMITS,
  STUDIO_AI_IMAGE_REFERENCE_STORAGE_PREFIX,
  studioAiImageReferenceStorageKey,
  type StudioAiImageReferenceStorage,
} from "./studio-ai-image-reference-storage";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function memoryStorage(
  initial: Readonly<Record<string, string>> = {},
): StudioAiImageReferenceStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("Studio AI image reference persistence", () => {
  it("builds bounded, control-free versioned keys isolated by owner and required work", () => {
    const guest = studioAiImageReferenceStorageKey({ workId: "work-a" });
    const ownerA = studioAiImageReferenceStorageKey({
      userScope: "user-a",
      workId: "work-a",
    });
    const ownerB = studioAiImageReferenceStorageKey({
      userScope: "user-b",
      workId: "work-a",
    });
    const workB = studioAiImageReferenceStorageKey({
      userScope: "user-a",
      workId: "work-b",
    });
    const namedGuest = studioAiImageReferenceStorageKey({
      userScope: "guest",
      workId: "work-a",
    });
    const normalized = studioAiImageReferenceStorageKey({
      userScope: " user\u0000\nA ",
      workId: " work\u007f\tA ",
    });
    const longPrefix = "scope-".repeat(100);
    const longA = studioAiImageReferenceStorageKey({
      userScope: `${longPrefix}a`,
      workId: `${longPrefix}a`,
    });
    const longB = studioAiImageReferenceStorageKey({
      userScope: `${longPrefix}b`,
      workId: `${longPrefix}b`,
    });

    expect(guest.startsWith(`${STUDIO_AI_IMAGE_REFERENCE_STORAGE_PREFIX}:`)).toBe(
      true,
    );
    expect(new Set([guest, ownerA, ownerB, workB, namedGuest])).toHaveLength(5);
    expect(
      [...normalized].every((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && (code < 127 || code > 159);
      }),
    ).toBe(true);
    expect(longA).not.toBe(longB);
    expect(
      Math.max(
        ...[guest, ownerA, ownerB, workB, namedGuest, normalized, longA, longB].map(
          (key) => key.length,
        ),
      ),
    ).toBeLessThanOrEqual(
      STUDIO_AI_IMAGE_REFERENCE_STORAGE_LIMITS.maxStorageKeyLength,
    );
    expect(() =>
      studioAiImageReferenceStorageKey({ workId: "\u0000 \n\t" }),
    ).toThrow(/작품 ID/);
  });

  it("round-trips separate owner/work selections without cross-key leakage", () => {
    const storage = memoryStorage();
    const ownerAWorkA = { userScope: "user-a", workId: "work-a" };
    const ownerBWorkA = { userScope: "user-b", workId: "work-a" };
    const ownerAWorkB = { userScope: "user-a", workId: "work-b" };

    saveStudioAiImageReferenceDocument(storage, ownerAWorkA, {
      references: [
        { id: "character-a", role: "character", sha256: HASH_A },
      ],
    });
    saveStudioAiImageReferenceDocument(storage, ownerBWorkA, {
      references: [{ id: "style-b", role: "style", sha256: HASH_B }],
    });

    expect(
      loadStudioAiImageReferenceDocument(storage, ownerAWorkA).references.map(
        ({ id }) => id,
      ),
    ).toEqual(["character-a"]);
    expect(
      loadStudioAiImageReferenceDocument(storage, ownerBWorkA).references.map(
        ({ id }) => id,
      ),
    ).toEqual(["style-b"]);
    expect(loadStudioAiImageReferenceDocument(storage, ownerAWorkB)).toEqual(
      createEmptyStudioAiImageReferenceDocument(),
    );

    expect(clearStudioAiImageReferenceDocument(storage, ownerAWorkA)).toBe(true);
    expect(loadStudioAiImageReferenceDocument(storage, ownerAWorkA)).toEqual(
      createEmptyStudioAiImageReferenceDocument(),
    );
    expect(
      loadStudioAiImageReferenceDocument(storage, ownerBWorkA).references,
    ).toHaveLength(1);
  });

  it("stores canonical metadata only and never persists data URLs or provider secrets", () => {
    const storage = memoryStorage();
    const scope = { userScope: "artist", workId: "episode-01" };
    const saved = saveStudioAiImageReferenceDocument(storage, scope, {
      version: 1,
      references: [
        {
          id: "hero",
          role: "character",
          asset: {
            assetId: "project/hero.asset",
            sha256: HASH_A,
            dataUrl: "data:image/png;base64,SECRET_IMAGE",
            uploadToken: "provider-secret",
          },
          label: "주인공",
          guidance: "얼굴과 의상만 유지",
          dataUrl: "data:image/png;base64,SECOND_SECRET_IMAGE",
          providerApiKey: "secret-key",
          mimeType: "image/png",
        },
        {
          id: "data-url-only",
          role: "style",
          assetId: "data:image/png;base64,SHOULD_BE_DROPPED",
        },
      ],
    });
    const persisted =
      storage.values.get(studioAiImageReferenceStorageKey(scope)) ?? "";

    expect(persisted).toBe(serializeStudioAiImageReferenceDocument(saved));
    expect(persisted).not.toContain("dataUrl");
    expect(persisted).not.toContain("base64");
    expect(persisted).not.toContain("provider-secret");
    expect(persisted).not.toContain("secret-key");
    expect(persisted).not.toContain("mimeType");
    expect(saved.references).toEqual([
      {
        id: "hero",
        role: "character",
        asset: {
          assetId: "project/hero.asset",
          sha256: HASH_A,
        },
        label: "주인공",
        guidance: "얼굴과 의상만 유지",
      },
    ]);
  });

  it("fails closed for unavailable, corrupt, blocked, and quota-limited storage", () => {
    const scope = { workId: "work-safe" };
    const key = studioAiImageReferenceStorageKey(scope);
    const corrupt = memoryStorage({ [key]: "{broken" });
    const blockedRead = {
      getItem: () => {
        throw new Error("private mode");
      },
    };
    const quotaWrite = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    const blockedClear = {
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const candidate = {
      references: [{ id: "style", role: "style", sha256: HASH_B }],
    };

    expect(loadStudioAiImageReferenceDocument(null, scope)).toEqual(
      createEmptyStudioAiImageReferenceDocument(),
    );
    expect(loadStudioAiImageReferenceDocument(corrupt, scope)).toEqual(
      createEmptyStudioAiImageReferenceDocument(),
    );
    expect(loadStudioAiImageReferenceDocument(blockedRead, scope)).toEqual(
      createEmptyStudioAiImageReferenceDocument(),
    );
    expect(() =>
      saveStudioAiImageReferenceDocument(quotaWrite, scope, candidate),
    ).not.toThrow();
    expect(saveStudioAiImageReferenceDocument(null, scope, candidate)).toEqual(
      JSON.parse(serializeStudioAiImageReferenceDocument(candidate)),
    );
    expect(clearStudioAiImageReferenceDocument(null, scope)).toBe(false);
    expect(clearStudioAiImageReferenceDocument(blockedClear, scope)).toBe(false);
    expect(
      saveStudioAiImageReferenceDocument(memoryStorage(), { workId: "" }, candidate),
    ).toEqual(JSON.parse(serializeStudioAiImageReferenceDocument(candidate)));
    expect(
      loadStudioAiImageReferenceDocument(memoryStorage(), { workId: "" }),
    ).toEqual(createEmptyStudioAiImageReferenceDocument());
  });
});
