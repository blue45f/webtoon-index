import { Navigate } from "react-router-dom";

import { defineAppRoutes } from "../app-route-definition";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const CreatorHubPage = lazyRetry(() => import("@/src/domains/creator-resources/CreatorHubPage").then((module) => ({ default: module.CreatorHubPage })), "CreatorHubPage");
const OpportunitiesPage = lazyRetry(() => import("@/src/domains/creator-resources/ResourceSearchPage").then((module) => ({ default: module.OpportunitiesPage })), "OpportunitiesPage");
const ReferencesPage = lazyRetry(() => import("@/src/domains/creator-resources/ResourceSearchPage").then((module) => ({ default: module.ReferencesPage })), "ReferencesPage");
const WorksPage = lazyRetry(() => import("@/src/domains/creator-resources/ResourceSearchPage").then((module) => ({ default: module.WorksPage })), "WorksPage");
const RecipesPage = lazyRetry(() => import("@/src/domains/creator-resources/RecipesPage").then((module) => ({ default: module.RecipesPage })), "RecipesPage");
const StoryLabPage = lazyRetry(() => import("@/src/domains/creator-resources/StoryLabPage").then((module) => ({ default: module.StoryLabPage })), "StoryLabPage");
const PublishingPage = lazyRetry(() => import("@/src/domains/creator-resources/PublishingPage").then((module) => ({ default: module.PublishingPage })), "PublishingPage");
const SourcesPage = lazyRetry(() => import("@/src/domains/creator-resources/SourcesPage").then((module) => ({ default: module.SourcesPage })), "SourcesPage");

export const creatorResourcesRoutes = defineAppRoutes([
  { id: "resources-hub", path: "/creator-hub", element: <CreatorHubPage /> },
  { id: "resources-opportunities", path: "/opportunities", element: <OpportunitiesPage /> },
  { id: "resources-references", path: "/creator-hub/references", element: <ReferencesPage /> },
  { id: "resources-recipes", path: "/learn/recipes", element: <RecipesPage /> },
  { id: "resources-story", path: "/story-lab", element: <StoryLabPage /> },
  { id: "resources-works", path: "/discover/works", element: <WorksPage /> },
  { id: "resources-publishing", path: "/publishing", element: <PublishingPage /> },
  { id: "resources-sources", path: "/insights/resources", element: <SourcesPage /> },
  { id: "resources-showcase", path: "/showcase", element: <Navigate to="/create" replace /> },
  { id: "resources-challenges", path: "/challenges", element: <Navigate to="/create/challenges" replace /> },
]);
