import { defineAppRoutes } from "../app-route-definition";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const ReviewsPage = lazyRetry(
  () => import("@/src/domains/community/ReviewsPage").then((module) => ({ default: module.ReviewsPage })),
  "ReviewsPage",
);
const CommunityPage = lazyRetry(
  () => import("@/src/domains/community/CommunityPage").then((module) => ({ default: module.CommunityPage })),
  "CommunityPage",
);
const CommunityScopePage = lazyRetry(
  () => import("@/src/domains/community/CommunityPage").then((module) => ({ default: module.CommunityScopePage })),
  "CommunityScopePage",
);
const CafesPage = lazyRetry(
  () => import("@/src/domains/community/CafesPage").then((module) => ({ default: module.CafesPage })),
  "CafesPage",
);
const CafeDetailPage = lazyRetry(
  () => import("@/src/domains/community/CafeDetailPage").then((module) => ({ default: module.CafeDetailPage })),
  "CafeDetailPage",
);
const CommunityPostPage = lazyRetry(
  () => import("@/src/domains/community/CommunityPostPage").then((module) => ({ default: module.CommunityPostPage })),
  "CommunityPostPage",
);
const PencafePage = lazyRetry(
  () => import("@/src/domains/community/PencafePage").then((module) => ({ default: module.PencafePage })),
  "PencafePage",
);

export const communityRoutes = defineAppRoutes([
  { id: "community-reviews", path: "/reviews", element: <ReviewsPage /> },
  { id: "community-home", path: "/community", element: <CommunityPage /> },
  { id: "community-cafes", path: "/community/cafes", element: <CafesPage /> },
  { id: "community-cafe", path: "/community/cafes/:slug", element: <CafeDetailPage /> },
  { id: "community-post", path: "/community/post/:id", element: <CommunityPostPage /> },
  { id: "community-scope", path: "/community/:scope", element: <CommunityScopePage /> },
  { id: "community-pencafe", path: "/pencafe/:name", element: <PencafePage /> },
]);
