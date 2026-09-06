/**
 * Market domain remote — Toss-style API boundary.
 * Pages and hooks import from here, not from infrastructure directly.
 */
export {
  getCreatorMarketplaceResource,
  listCreatorMarketplaceResources,
} from "@/src/infrastructure/creator-marketplace-client";
