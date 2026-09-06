import { defineAppRoutes } from "../app-route-definition";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const NotFoundPage = lazyRetry(
  () => import("@/src/components/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
  "NotFoundPage",
);

export const notFoundRoutes = defineAppRoutes([
  { id: "not-found", path: "*", element: <NotFoundPage /> },
]);
