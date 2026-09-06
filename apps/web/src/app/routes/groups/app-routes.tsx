import { accountRoutes } from "./account.routes";
import { adminRoutes } from "./admin.routes";
import { catalogRoutes } from "./catalog.routes";
import { communityRoutes } from "./community.routes";
import { creatorResourcesRoutes } from "./creator-resources.routes";
import { creatorRoutes } from "./creator.routes";
import { experienceRoutes } from "./experience.routes";
import { legalRoutes } from "./legal.routes";
import { marketRoutes } from "./market.routes";
import { notFoundRoutes } from "./not-found.route";
import { referenceRoutes } from "./reference.routes";

/**
 * URL ownership is grouped by product domain while the root router retains cross-domain concerns
 * such as title, error, Suspense, and Studio isolation boundaries.
 */
export const appRoutes = [
  ...catalogRoutes,
  ...referenceRoutes,
  ...communityRoutes,
  ...creatorRoutes,
  ...creatorResourcesRoutes,
  ...marketRoutes,
  ...accountRoutes,
  ...adminRoutes,
  ...legalRoutes,
  ...experienceRoutes,
  ...notFoundRoutes,
];
