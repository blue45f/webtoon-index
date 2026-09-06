import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  resolveStudioCommunityMarketplaceInitialView,
  type StudioCommunityMarketplaceView,
} from "./studio-community-marketplace-view";

export function useStudioCommunityMarketplaceInitialView(): StudioCommunityMarketplaceView {
  const location = useLocation();
  const navigate = useNavigate();
  const initialLocationRef = useRef(location);
  const consumedInitialViewRef = useRef(false);
  const [initialView] = useState(() =>
    resolveStudioCommunityMarketplaceInitialView(
      new URLSearchParams(location.search),
    ),
  );

  useEffect(() => {
    if (consumedInitialViewRef.current) return;
    consumedInitialViewRef.current = true;

    const initialLocation = initialLocationRef.current;
    const nextSearchParams = new URLSearchParams(initialLocation.search);
    if (!nextSearchParams.has("communityView")) return;

    nextSearchParams.delete("communityView");
    const nextSearch = nextSearchParams.toString();
    void navigate(
      {
        pathname: initialLocation.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: initialLocation.hash,
      },
      {
        replace: true,
        state: initialLocation.state,
      },
    );
  }, [navigate]);

  return initialView;
}
