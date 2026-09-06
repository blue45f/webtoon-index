import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CreatorMarketplaceResourceRecordSchema,
  type CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

export const MARKET_COMPARE_STORAGE_KEY = "toonspectrum:market:compare:v1";
export const MARKET_COMPARE_EVENT = "toonspectrum:market:compare-changed";
export const MARKET_COMPARE_MAX_ITEMS = 4;

export type MarketCompareToggleResult = "added" | "removed" | "limit";

function normalizeRecords(value: unknown): CreatorMarketplaceResourceRecord[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  const records: CreatorMarketplaceResourceRecord[] = [];
  for (const candidate of value) {
    const parsed = CreatorMarketplaceResourceRecordSchema.safeParse(candidate);
    if (!parsed.success || ids.has(parsed.data.id)) continue;
    ids.add(parsed.data.id);
    records.push(parsed.data);
    if (records.length >= MARKET_COMPARE_MAX_ITEMS) break;
  }
  return records;
}

export function readMarketCompareRecords(): CreatorMarketplaceResourceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MARKET_COMPARE_STORAGE_KEY);
    return raw ? normalizeRecords(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

function saveMarketCompareRecords(
  records: readonly CreatorMarketplaceResourceRecord[],
): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeRecords(records);
  try {
    localStorage.setItem(MARKET_COMPARE_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(MARKET_COMPARE_EVENT));
  } catch {
    // Browser storage can be unavailable. The current tab still keeps its in-memory state.
  }
}

export function useMarketCompare() {
  const [compareItems, setCompareItems] = useState<CreatorMarketplaceResourceRecord[]>(
    readMarketCompareRecords,
  );

  useEffect(() => {
    const refresh = (event?: Event) => {
      if (
        event instanceof StorageEvent
        && event.key !== null
        && event.key !== MARKET_COMPARE_STORAGE_KEY
      ) {
        return;
      }
      setCompareItems(readMarketCompareRecords());
    };
    window.addEventListener(MARKET_COMPARE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MARKET_COMPARE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const compareIds = useMemo(
    () => new Set(compareItems.map((record) => record.id)),
    [compareItems],
  );

  const isCompared = useCallback(
    (resourceId: string) => compareIds.has(resourceId),
    [compareIds],
  );

  const toggleCompare = useCallback(
    (record: CreatorMarketplaceResourceRecord): MarketCompareToggleResult => {
      const current = readMarketCompareRecords();
      const existing = current.some((candidate) => candidate.id === record.id);
      if (existing) {
        const next = current.filter((candidate) => candidate.id !== record.id);
        saveMarketCompareRecords(next);
        setCompareItems(next);
        return "removed";
      }

      if (current.length >= MARKET_COMPARE_MAX_ITEMS) return "limit";
      const parsed = CreatorMarketplaceResourceRecordSchema.safeParse(record);
      if (!parsed.success) return "limit";

      const next = [...current, parsed.data];
      saveMarketCompareRecords(next);
      setCompareItems(next);
      return "added";
    },
    [],
  );

  const removeCompare = useCallback((resourceId: string): void => {
    const next = readMarketCompareRecords().filter(
      (candidate) => candidate.id !== resourceId,
    );
    saveMarketCompareRecords(next);
    setCompareItems(next);
  }, []);

  const clearCompare = useCallback((): void => {
    saveMarketCompareRecords([]);
    setCompareItems([]);
  }, []);

  return {
    compareItems,
    compareCount: compareItems.length,
    isFull: compareItems.length >= MARKET_COMPARE_MAX_ITEMS,
    isCompared,
    toggleCompare,
    removeCompare,
    clearCompare,
  };
}
