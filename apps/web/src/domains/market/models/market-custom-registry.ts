/**
 * Market Custom Registry
 * 
 * Manages user-published, user-edited, and locally registered creator assets.
 * Persists in localStorage and merges with starter records so that all published
 * and edited assets seamlessly appear in Browse, Home, My Assets, and Detail views.
 */

import type {
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { CREATOR_MARKETPLACE_STARTER_RECORDS } from "@/shared/lib/creator-marketplace-starter-catalog";

const CUSTOM_REGISTRY_STORAGE_KEY = "toonspectrum:market:custom-published";
export const MARKET_CUSTOM_REGISTRY_EVENT = "toonspectrum:market:custom-registry-updated";

function emitCustomRegistryUpdate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MARKET_CUSTOM_REGISTRY_EVENT));
  }
}

export function getCustomPublishedResources(): CreatorMarketplaceResourceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_REGISTRY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CreatorMarketplaceResourceRecord[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // quota or parsing failure
  }
  return [];
}

export function saveCustomPublishedResources(
  records: CreatorMarketplaceResourceRecord[],
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CUSTOM_REGISTRY_STORAGE_KEY, JSON.stringify(records));
    emitCustomRegistryUpdate();
  } catch {
    // storage failure
  }
}

export function getCustomPublishedResourceById(
  id: string,
): CreatorMarketplaceResourceRecord | null {
  const customs = getCustomPublishedResources();
  return customs.find((r) => r.id === id) ?? null;
}

export function saveCustomPublishedResource(
  record: CreatorMarketplaceResourceRecord,
): void {
  const customs = getCustomPublishedResources();
  const existingIndex = customs.findIndex((r) => r.id === record.id);
  let updated: CreatorMarketplaceResourceRecord[];
  if (existingIndex >= 0) {
    updated = [...customs];
    updated[existingIndex] = record;
  } else {
    updated = [record, ...customs];
  }
  saveCustomPublishedResources(updated);
}

export function updateCustomPublishedResource(
  id: string,
  updates: Partial<CreatorMarketplaceResourceRecord>,
): CreatorMarketplaceResourceRecord | null {
  const customs = getCustomPublishedResources();
  const index = customs.findIndex((r) => r.id === id);
  if (index >= 0) {
    const existing = customs[index];
    const updatedRecord: CreatorMarketplaceResourceRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    customs[index] = updatedRecord;
    saveCustomPublishedResources(customs);
    return updatedRecord;
  }

  // If modifying a starter record, create an overlay copy
  const starter = CREATOR_MARKETPLACE_STARTER_RECORDS.find((r) => r.id === id);
  if (starter) {
    const overlaidRecord: CreatorMarketplaceResourceRecord = {
      ...starter,
      ...updates,
      isOwner: true,
      updatedAt: new Date().toISOString(),
    };
    saveCustomPublishedResources([overlaidRecord, ...customs]);
    return overlaidRecord;
  }

  return null;
}

export function deleteCustomPublishedResource(id: string): boolean {
  const customs = getCustomPublishedResources();
  const filtered = customs.filter((r) => r.id !== id);
  if (filtered.length !== customs.length) {
    saveCustomPublishedResources(filtered);
    return true;
  }
  return false;
}

export function getAllMergedMarketResources(): CreatorMarketplaceResourceRecord[] {
  const customs = getCustomPublishedResources();
  const customIds = new Set(customs.map((c) => c.id));
  const starters = CREATOR_MARKETPLACE_STARTER_RECORDS.filter(
    (s) => !customIds.has(s.id),
  );
  return [...customs, ...starters];
}

export function findMergedMarketResourceById(
  id: string,
): CreatorMarketplaceResourceRecord | null {
  const custom = getCustomPublishedResourceById(id);
  if (custom) return custom;
  return CREATOR_MARKETPLACE_STARTER_RECORDS.find((s) => s.id === id) ?? null;
}
