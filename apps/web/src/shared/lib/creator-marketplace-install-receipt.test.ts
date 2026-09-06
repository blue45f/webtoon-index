import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_AGE_MS,
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_ENTRIES,
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
  readCreatorMarketplaceInstallReceipt,
  removeCreatorMarketplaceInstallReceipt,
  resolveCreatorMarketplaceInstallReceiptState,
  writeCreatorMarketplaceInstallReceipt,
  type CreatorMarketplaceInstallReceiptStorage,
} from "./creator-marketplace-install-receipt";

function memoryStorage(): CreatorMarketplaceInstallReceiptStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function logicalPackId(index = 1): string {
  return `community:${index.toString(16).padStart(64, "0")}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Creator Market same-browser install receipts", () => {
  it("roundtrips one bounded receipt and removes it after uninstall", () => {
    const storage = memoryStorage();
    const now = Date.parse("2026-08-31T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(writeCreatorMarketplaceInstallReceipt({
      logicalPackId: logicalPackId(),
      packageVersion: "1.2.3",
      packageFingerprint: "a".repeat(64),
      kind: "brush",
      installedAt: now,
    }, storage)).toBe(true);
    expect(readCreatorMarketplaceInstallReceipt(logicalPackId(), storage, now))
      .toEqual({
        packageVersion: "1.2.3",
        packageFingerprint: "a".repeat(64),
        kind: "brush",
        installedAt: now,
      });

    expect(removeCreatorMarketplaceInstallReceipt(logicalPackId(), storage, now)).toBe(true);
    expect(readCreatorMarketplaceInstallReceipt(logicalPackId(), storage, now)).toBeNull();
    expect(storage.values.has(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY)).toBe(false);
  });

  it("distinguishes the current release, an available update, and a mismatched receipt", () => {
    const current = {
      resourceVersion: "2.0.0",
      manifestHash: "b".repeat(64),
      kind: "palette" as const,
    };
    expect(resolveCreatorMarketplaceInstallReceiptState(current, {
      packageVersion: "2.0.0",
      packageFingerprint: "b".repeat(64),
      kind: "palette",
      installedAt: 1,
    })).toBe("installed-current");
    expect(resolveCreatorMarketplaceInstallReceiptState(current, {
      packageVersion: "1.9.9",
      packageFingerprint: "a".repeat(64),
      kind: "palette",
      installedAt: 1,
    })).toBe("update-available");
    expect(resolveCreatorMarketplaceInstallReceiptState(current, {
      packageVersion: "2.0.0",
      packageFingerprint: "c".repeat(64),
      kind: "palette",
      installedAt: 1,
    })).toBe("no-verified-receipt");
    expect(resolveCreatorMarketplaceInstallReceiptState({
      ...current,
      resourceVersion: "2.0.0-01",
      manifestHash: "d".repeat(64),
    }, {
      packageVersion: "2.0.0-1",
      packageFingerprint: "d".repeat(64),
      kind: "palette",
      installedAt: 1,
    })).toBe("installed-current");
  });

  it("fails closed and self-cleans corrupt, expired, future, and oversized envelopes", () => {
    const storage = memoryStorage();
    const now = Date.parse("2026-08-31T10:00:00.000Z");
    const key = CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY;
    const cases = [
      "{broken",
      JSON.stringify({
        version: 1,
        receipts: {
          [logicalPackId()]: {
            packageVersion: "1.0.0",
            packageFingerprint: "a".repeat(64),
            kind: "brush",
            installedAt: now - CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_AGE_MS - 1,
          },
        },
      }),
      JSON.stringify({
        version: 1,
        receipts: {
          [logicalPackId()]: {
            packageVersion: "1.0.0",
            packageFingerprint: "a".repeat(64),
            kind: "brush",
            installedAt: now + 1,
          },
        },
      }),
      "x".repeat(CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_CHARACTERS + 1),
    ];

    for (const value of cases) {
      storage.setItem(key, value);
      expect(readCreatorMarketplaceInstallReceipt(logicalPackId(), storage, now)).toBeNull();
      expect(storage.getItem(key)).toBeNull();
    }
  });

  it("drops only a corrupt sibling and caps the newest receipts deterministically", () => {
    const storage = memoryStorage();
    const now = Date.parse("2026-08-31T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now + CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_ENTRIES + 1);
    storage.setItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY, JSON.stringify({
      version: 1,
      receipts: {
        [logicalPackId(1)]: {
          packageVersion: "1.0.0",
          packageFingerprint: "a".repeat(64),
          kind: "filter",
          installedAt: now,
        },
        [logicalPackId(2)]: { futureShape: true },
      },
    }));

    expect(readCreatorMarketplaceInstallReceipt(logicalPackId(1), storage, now)).not.toBeNull();
    expect(readCreatorMarketplaceInstallReceipt(logicalPackId(2), storage, now)).toBeNull();
    expect(storage.getItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY))
      .not.toContain("futureShape");

    for (let index = 2; index <= CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_ENTRIES + 1; index += 1) {
      writeCreatorMarketplaceInstallReceipt({
        logicalPackId: logicalPackId(index),
        packageVersion: "1.0.0",
        packageFingerprint: index.toString(16).padStart(64, "0"),
        kind: "filter",
        installedAt: now + index,
      }, storage);
    }

    const persisted = JSON.parse(
      storage.getItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY) ?? "null",
    ) as { receipts: Record<string, unknown> };
    expect(Object.keys(persisted.receipts)).toHaveLength(
      CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_ENTRIES,
    );
    expect(persisted.receipts[logicalPackId(1)]).toBeUndefined();
    expect(persisted.receipts[logicalPackId(
      CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_ENTRIES + 1,
    )]).toBeDefined();
  });
});
