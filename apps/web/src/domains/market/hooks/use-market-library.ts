import { useCallback, useEffect, useState } from "react";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { acquireCreatorMarketplaceCloudLibraryRelease } from "@/src/infrastructure/creator-marketplace-client";

export interface AcquiredMarketItem {
  id: string;
  resourceId: string;
  acquiredAt: string;
  archived: boolean;
  resource: CreatorMarketplaceResourceRecord;
}

const LIBRARY_STORAGE_KEY = "toonspectrum:market:acquired-library";
export const MARKET_LIBRARY_EVENT = "toonspectrum:market:library-changed";

function getStoredLibraryItems(): AcquiredMarketItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AcquiredMarketItem[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // storage error
  }
  return [];
}

function saveLibraryItems(items: AcquiredMarketItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(MARKET_LIBRARY_EVENT));
  } catch {
    // quota
  }
}

export function useMarketLibrary() {
  const [items, setItems] = useState<AcquiredMarketItem[]>(getStoredLibraryItems);

  useEffect(() => {
    const onUpdate = () => {
      setItems(getStoredLibraryItems());
    };
    window.addEventListener(MARKET_LIBRARY_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(MARKET_LIBRARY_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  const isAcquired = useCallback(
    (resourceId: string) => items.some((item) => item.resourceId === resourceId),
    [items],
  );

  const acquireResource = useCallback(
    async (record: CreatorMarketplaceResourceRecord): Promise<boolean> => {
      // 1. Try background cloud API acquisition
      try {
        await acquireCreatorMarketplaceCloudLibraryRelease(record.id);
      } catch {
        // Safe fallback to client library entitlement
      }

      // 2. Persist local entitlement
      const current = getStoredLibraryItems();
      const existing = current.find((i) => i.resourceId === record.id);
      if (existing) {
        if (existing.archived) {
          existing.archived = false;
          saveLibraryItems(current);
        }
        return true;
      }

      const newItem: AcquiredMarketItem = {
        id: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        resourceId: record.id,
        acquiredAt: new Date().toISOString(),
        archived: false,
        resource: record,
      };

      saveLibraryItems([newItem, ...current]);
      setItems([newItem, ...current]);
      return true;
    },
    [],
  );

  const archiveItem = useCallback((id: string, archived: boolean) => {
    const current = getStoredLibraryItems();
    const target = current.find((i) => i.id === id || i.resourceId === id);
    if (!target) return;
    target.archived = archived;
    saveLibraryItems(current);
    setItems([...current]);
  }, []);

  const removeItem = useCallback((id: string) => {
    const current = getStoredLibraryItems();
    const filtered = current.filter((i) => i.id !== id && i.resourceId !== id);
    saveLibraryItems(filtered);
    setItems(filtered);
  }, []);

  return {
    items,
    activeItems: items.filter((i) => !i.archived),
    archivedItems: items.filter((i) => i.archived),
    totalCount: items.filter((i) => !i.archived).length,
    isAcquired,
    acquireResource,
    archiveItem,
    removeItem,
  };
}
