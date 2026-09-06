import { defineAppRoutes } from "../app-route-definition";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const AdminPage = lazyRetry(
  () => import("@/src/domains/admin/AdminPage").then((module) => ({
    default: module.AdminPage,
  })),
  "AdminPage",
);
const AdminCommunityPage = lazyRetry(
  () => import("@/src/domains/admin/AdminCommunityPage").then((module) => ({
    default: module.AdminCommunityPage,
  })),
  "AdminCommunityPage",
);
const AdminMembersPage = lazyRetry(
  () => import("@/src/domains/admin/AdminMembersPage").then((module) => ({
    default: module.AdminMembersPage,
  })),
  "AdminMembersPage",
);

export const adminRoutes = defineAppRoutes([
  { id: "admin-home", path: "/admin", element: <AdminPage /> },
  {
    id: "admin-community",
    path: "/admin/community",
    element: <AdminCommunityPage />,
  },
  { id: "admin-members", path: "/admin/members", element: <AdminMembersPage /> },
]);
