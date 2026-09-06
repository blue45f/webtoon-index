import { studioRouteOwnsDocumentTitle } from "@/src/domains/creator/studio-router/studio-route-manifest";

export interface AppRouteTitleLocation {
  readonly pathname: string;
  readonly search?: string;
}

/**
 * AppRouter owns generic/dynamic route titles. Editor-style children retain title ownership so a
 * nested route transition cannot overwrite a document title whose source state did not change.
 */
export function shouldAppRouterOwnDocumentTitle({
  pathname,
  search = "",
}: AppRouteTitleLocation): boolean {
  if (pathname.startsWith("/title/")) return false;
  if (pathname.startsWith("/create/")) return false;
  if (pathname === "/learn" || pathname.startsWith("/learn/")) return false;
  if (pathname.startsWith("/u/")) return false;
  if (pathname.startsWith("/community/cafes/")) return false;
  if (pathname.startsWith("/community/post/")) return false;
  // The independently lazy-loaded manual supplies the active article's title.
  if (pathname === "/studio/manual" || pathname.startsWith("/studio/manual/")) return false;
  if (pathname === "/studio" || pathname.startsWith("/studio/")) {
    return !studioRouteOwnsDocumentTitle({ pathname, search });
  }
  return true;
}
