// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MARKET_COMPARE_MAX_ITEMS,
  MARKET_COMPARE_STORAGE_KEY,
  useMarketCompare,
} from "./use-market-compare";

import { CREATOR_MARKETPLACE_STARTER_RECORDS } from "@/shared/lib/creator-marketplace-starter-catalog";

describe("useMarketCompare", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists add, remove, and clear operations", () => {
    const record = CREATOR_MARKETPLACE_STARTER_RECORDS[0]!;
    const { result } = renderHook(() => useMarketCompare());

    act(() => {
      expect(result.current.toggleCompare(record)).toBe("added");
    });
    expect(result.current.compareCount).toBe(1);
    expect(result.current.isCompared(record.id)).toBe(true);
    expect(localStorage.getItem(MARKET_COMPARE_STORAGE_KEY)).toContain(record.id);

    act(() => {
      expect(result.current.toggleCompare(record)).toBe("removed");
    });
    expect(result.current.compareCount).toBe(0);

    act(() => {
      result.current.toggleCompare(record);
      result.current.clearCompare();
    });
    expect(result.current.compareItems).toEqual([]);
  });

  it("caps the comparison workspace at four validated resources", () => {
    const records = CREATOR_MARKETPLACE_STARTER_RECORDS.slice(
      0,
      MARKET_COMPARE_MAX_ITEMS + 1,
    );
    expect(records).toHaveLength(MARKET_COMPARE_MAX_ITEMS + 1);
    const { result } = renderHook(() => useMarketCompare());

    for (const record of records.slice(0, MARKET_COMPARE_MAX_ITEMS)) {
      act(() => {
        expect(result.current.toggleCompare(record)).toBe("added");
      });
    }
    expect(result.current.compareCount).toBe(MARKET_COMPARE_MAX_ITEMS);
    expect(result.current.isFull).toBe(true);

    act(() => {
      expect(result.current.toggleCompare(records.at(-1)!)).toBe("limit");
    });
    expect(result.current.compareCount).toBe(MARKET_COMPARE_MAX_ITEMS);
  });
});
