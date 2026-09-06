export type StudioCommunityMarketplaceView =
  | "community"
  | "library"
  | "mine"
  | "share";

export function resolveStudioCommunityMarketplaceInitialView(
  searchParams: Pick<URLSearchParams, "get">,
): StudioCommunityMarketplaceView {
  const requestedView = searchParams.get("communityView");
  if (
    requestedView === "library"
    || requestedView === "mine"
    || requestedView === "share"
  ) {
    return requestedView;
  }
  return "community";
}
