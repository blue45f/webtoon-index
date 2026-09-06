import { useCallback, useEffect, useState } from "react";

import { findMergedMarketResourceById } from "../models/market-custom-registry";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

const WISHLIST_STORAGE_KEY = "toonspectrum:market:wishlist";
export const MARKET_WISHLIST_EVENT = "toonspectrum:market:wishlist-changed";

function getStoredWishlistIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // quota
  }
  return [];
}

function saveWishlistIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent(MARKET_WISHLIST_EVENT));
  } catch {
    // storage error
  }
}

export function useMarketWishlist() {
  const [wishlistIds, setWishlistIds] = useState<string[]>(getStoredWishlistIds);

  useEffect(() => {
    const onUpdate = () => {
      setWishlistIds(getStoredWishlistIds());
    };
    window.addEventListener(MARKET_WISHLIST_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(MARKET_WISHLIST_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  const isWishlisted = useCallback(
    (id: string) => wishlistIds.includes(id),
    [wishlistIds],
  );

  const toggleWishlist = useCallback((record: CreatorMarketplaceResourceRecord): boolean => {
    const current = getStoredWishlistIds();
    const exists = current.includes(record.id);
    let next: string[];
    if (exists) {
      next = current.filter((id) => id !== record.id);
    } else {
      next = [record.id, ...current];
    }
    saveWishlistIds(next);
    setWishlistIds(next);
    return !exists;
  }, []);

  const wishlistItems: CreatorMarketplaceResourceRecord[] = wishlistIds
    .map((id) => findMergedMarketResourceById(id))
    .filter((item): item is CreatorMarketplaceResourceRecord => item !== null);

  return {
    wishlistIds,
    wishlistItems,
    wishlistCount: wishlistIds.length,
    isWishlisted,
    toggleWishlist,
  };
}
