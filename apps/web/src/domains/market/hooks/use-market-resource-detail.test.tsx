// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";


import {
  readCachedMarketResource,
  removeCachedMarketResource,
} from "../models/market-resource-cache";
import { getCreatorMarketplaceResource } from "../remotes/market-resource-remote";

import { useMarketResourceDetail } from "./use-market-resource-detail";

import { NotFoundError } from "@/src/infrastructure/use-api-resource";

vi.mock("../models/market-resource-cache", () => ({
  readCachedMarketResource: vi.fn(),
  removeCachedMarketResource: vi.fn(),
  writeCachedMarketResource: vi.fn(),
}));

vi.mock("../remotes/market-resource-remote", () => ({
  getCreatorMarketplaceResource: vi.fn(),
}));

const getResource = vi.mocked(getCreatorMarketplaceResource);
const readCachedResource = vi.mocked(readCachedMarketResource);
const removeCachedResource = vi.mocked(removeCachedMarketResource);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useMarketResourceDetail", () => {
  it("evicts the cached detail on a confirmed 404 without using stale fallback", async () => {
    getResource.mockRejectedValueOnce(new NotFoundError());

    const { result } = renderHook(() => useMarketResourceDetail("deleted-resource"));
    await waitFor(() => expect(result.current.notFound).toBe(true));

    expect(removeCachedResource).toHaveBeenCalledWith("deleted-resource");
    expect(readCachedResource).not.toHaveBeenCalled();
    expect(result.current.record).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves official starter resource on network failure", async () => {
    getResource.mockRejectedValueOnce(new Error("503 Service Unavailable"));
    readCachedResource.mockReturnValueOnce(null);

    const { result } = renderHook(() =>
      useMarketResourceDetail("e0000001-0000-4000-8000-000000000001")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.record).not.toBeNull();
    expect(result.current.record?.kind).toBe("3d-asset");
    expect(result.current.record?.name).toContain("애니메 표준 휴머노이드 소체");
    expect(result.current.error).toBeNull();
  });
});
