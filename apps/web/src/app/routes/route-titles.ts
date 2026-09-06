import { useEffect } from "react";

import "./reference-labels";
import { shouldAppRouterOwnDocumentTitle } from "./app-route-title-ownership";
import { CREATOR_RESOURCE_TITLES } from "./creator-resource-titles";

import { useT } from "@/shared/lib/i18n";
import { isStudioRoutePathname } from "@/src/domains/creator/studio-workspace-route";


// 정적 라우트의 브라우저 탭 제목. 동적 라우트(작가·펜카페)는 URL에서 유도하고,
// /title/* 은 작품명이 필요하므로 TitleDetailPage가 useDocumentTitle로 직접 설정한다.
export const STATIC_TITLES: Record<string, string> = {
  "/": "",
  "/ranking": "route.ranking",
  "/search": "route.search",
  "/references": "route.references",
  "/recommend": "route.recommend",
  "/explore": "route.explore",
  "/random": "route.random",
  "/feedback": "route.feedback",
  "/tags": "route.tags",
  "/calendar": "route.calendar",
  "/reviews": "route.reviews",
  "/community": "route.community",
  "/community/cafes": "route.community_cafes",
  "/market": "route.market",
  "/market/browse": "route.marketBrowse",
  "/market/publish": "route.marketPublish",
  "/market/manage": "route.marketManage",
  "/market/library": "route.marketLibrary",
  "/market/wishlist": "route.marketWishlist",
  "/admin/community": "route.adminCommunity",
  "/admin/members": "route.adminMembers",
  "/library": "route.library",
  "/compare": "route.compare",
  "/insights": "route.insights",
  "/authors": "route.authors",
  "/news": "route.news",
  "/about": "route.about",
  "/design": "route.design",
  "/sitemap": "route.sitemap",
  "/guide": "route.guide",
  "/settings": "route.settings",
  "/admin": "route.admin",
  "/terms": "route.terms",
  "/privacy": "route.privacy",
  "/copyright": "route.copyright",
  "/contact": "route.contact",
  "/support": "route.support",
  "/create": "route.create",
  "/studio": "route.studio",
  "/shaper": "route.shaper",
  "/me": "route.me",
  "/fortune": "route.fortune",
  "/play": "route.play",
};

export function useRouteTitle(pathname: string, search: string) {
  const t = useT();
  useEffect(() => {
    if (!shouldAppRouterOwnDocumentTitle({ pathname, search })) return;
    if (pathname === "/") {
      document.title = `${t("app.name")} · ${t("home.creatorTitle")}`;
      return;
    }
    let title: string | undefined;
    if (Object.hasOwn(CREATOR_RESOURCE_TITLES, pathname)) {
      title = CREATOR_RESOURCE_TITLES[pathname];
    } else if (pathname in STATIC_TITLES) {
      const titleKey = STATIC_TITLES[pathname];
      title = titleKey ? t(titleKey) : "";
    } else if (pathname.startsWith("/author/")) {
      title = decodeURIComponent(pathname.slice(8));
    } else if (pathname.startsWith("/pencafe/")) {
      title = `${decodeURIComponent(pathname.slice(9))} ${t("route.pencafeSuffix")}`;
    } else if (pathname.startsWith("/community/")) {
      title = t("route.community");
    } else if (pathname.startsWith("/market/resource/")) {
      title = t("route.market");
    } else if (pathname.startsWith("/admin/")) {
      title = t("route.admin");
    } else if (pathname.startsWith("/me")) {
      title = t("route.me");
    } else if (isStudioRoutePathname(pathname)) {
      title = t("route.studio");
    }
    document.title = title ? `${title} · ${t("app.name")}` : t("app.name");
  }, [pathname, search, t]);
}
