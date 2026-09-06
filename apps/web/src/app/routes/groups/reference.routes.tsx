import "../reference-labels";

import { defineAppRoutes } from "../app-route-definition";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const ReferencePage = lazyRetry(
  () => import("@/src/domains/catalog/references/ReferencePage").then((module) => ({ default: module.ReferencePage })),
  "ReferencePage",
);

export const referenceRoutes = defineAppRoutes([
  { id: "catalog-references", path: "/references", element: <ReferencePage /> },
]);
