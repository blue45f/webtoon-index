export interface AppRouteMeta {
  path: string;
  label: string;
}

export const appRoutes: AppRouteMeta[] = [
  { path: "/", label: "nav.home" },
  { path: "/ranking", label: "route.ranking" },
  { path: "/search", label: "route.search" },
  { path: "/references", label: "route.references" },
  { path: "/recommend", label: "route.recommend" },
  { path: "/play", label: "route.play" },
  { path: "/explore", label: "route.explore" },
  { path: "/calendar", label: "route.calendar" },
  { path: "/reviews", label: "route.reviews" },
  { path: "/community", label: "route.community" },
  { path: "/market", label: "route.market" },
  { path: "/shaper", label: "route.shaper" },
  { path: "/library", label: "route.library" },
  { path: "/compare", label: "route.compare" },
  { path: "/insights", label: "route.insights" },
  { path: "/sitemap", label: "route.sitemap" },
  { path: "/admin", label: "route.admin" },
];
