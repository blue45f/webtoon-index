import { describe, expect, it } from "vitest";

import {
  getCreatorMarketplaceResource,
  listCreatorMarketplaceResources,
} from "./market-resource-remote";

import * as client from "@/src/infrastructure/creator-marketplace-client";


describe("market-resource-remote", () => {
  it("re-exports the shipped marketplace client, not a copy", () => {
    expect(getCreatorMarketplaceResource).toBe(client.getCreatorMarketplaceResource);
    expect(listCreatorMarketplaceResources).toBe(client.listCreatorMarketplaceResources);
  });
});
