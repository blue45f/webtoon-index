import { defineAppRoutes } from "../app-route-definition";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const HomePage = lazyRetry(
  () => import("@/src/domains/creator-resources/CreatorHomePage").then((module) => ({ default: module.CreatorHomePage })),
  "HomePage",
);
const RankingPage = lazyRetry(
  () => import("@/src/domains/catalog/RankingPage").then((module) => ({ default: module.RankingPage })),
  "RankingPage",
);
const SearchPage = lazyRetry(
  () => import("@/src/domains/catalog/SearchPage").then((module) => ({ default: module.SearchPage })),
  "SearchPage",
);
const RecommendPage = lazyRetry(
  () => import("@/src/domains/catalog/RecommendPage").then((module) => ({ default: module.RecommendPage })),
  "RecommendPage",
);
const ExplorePage = lazyRetry(
  () => import("@/src/domains/catalog/ExplorePage").then((module) => ({ default: module.ExplorePage })),
  "ExplorePage",
);
const CalendarPage = lazyRetry(
  () => import("@/src/domains/catalog/CalendarPage").then((module) => ({ default: module.CalendarPage })),
  "CalendarPage",
);
const LibraryPage = lazyRetry(
  () => import("@/src/domains/catalog/LibraryPage").then((module) => ({ default: module.LibraryPage })),
  "LibraryPage",
);
const ComparePage = lazyRetry(
  () => import("@/src/domains/catalog/ComparePage").then((module) => ({ default: module.ComparePage })),
  "ComparePage",
);
const RandomPage = lazyRetry(
  () => import("@/src/domains/catalog/RandomPage").then((module) => ({ default: module.RandomPage })),
  "RandomPage",
);
const InsightsPage = lazyRetry(
  () => import("@/src/domains/catalog/InsightsPage").then((module) => ({ default: module.InsightsPage })),
  "InsightsPage",
);
const TitleDetailPage = lazyRetry(
  () => import("@/src/domains/catalog/TitleDetailPage").then((module) => ({ default: module.TitleDetailPage })),
  "TitleDetailPage",
);
const AuthorPage = lazyRetry(
  () => import("@/src/domains/catalog/AuthorPage").then((module) => ({ default: module.AuthorPage })),
  "AuthorPage",
);
const TagsPage = lazyRetry(
  () => import("@/src/domains/catalog/TagsPage").then((module) => ({ default: module.TagsPage })),
  "TagsPage",
);
const AuthorsPage = lazyRetry(
  () => import("@/src/domains/catalog/AuthorsPage").then((module) => ({ default: module.AuthorsPage })),
  "AuthorsPage",
);
const NewsPage = lazyRetry(
  () => import("@/src/domains/catalog/NewsPage").then((module) => ({ default: module.NewsPage })),
  "NewsPage",
);
const GuidePage = lazyRetry(
  () => import("@/src/domains/catalog/GuidePage").then((module) => ({ default: module.GuidePage })),
  "GuidePage",
);

export const catalogRoutes = defineAppRoutes([
  { id: "catalog-home", path: "/", element: <HomePage /> },
  { id: "catalog-ranking", path: "/ranking", element: <RankingPage /> },
  { id: "catalog-search", path: "/search", element: <SearchPage /> },
  { id: "catalog-recommend", path: "/recommend", element: <RecommendPage /> },
  { id: "catalog-explore", path: "/explore", element: <ExplorePage /> },
  { id: "catalog-calendar", path: "/calendar", element: <CalendarPage /> },
  { id: "catalog-library", path: "/library", element: <LibraryPage /> },
  { id: "catalog-compare", path: "/compare", element: <ComparePage /> },
  { id: "catalog-random", path: "/random", element: <RandomPage /> },
  { id: "catalog-insights", path: "/insights", element: <InsightsPage /> },
  { id: "catalog-tags", path: "/tags", element: <TagsPage /> },
  { id: "catalog-authors", path: "/authors", element: <AuthorsPage /> },
  { id: "catalog-news", path: "/news", element: <NewsPage /> },
  { id: "catalog-guide", path: "/guide", element: <GuidePage /> },
  { id: "catalog-title", path: "/title/:slug", element: <TitleDetailPage /> },
  { id: "catalog-author", path: "/author/:name", element: <AuthorPage /> },
]);
