import { defineAppRoutes } from "../app-route-definition";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const AccountPage = lazyRetry(
  () => import("@/src/domains/account/AccountPage").then((module) => ({
    default: module.AccountPage,
  })),
  "AccountPage",
);
const UserProfilePage = lazyRetry(
  () => import("@/src/domains/account/UserProfilePage").then((module) => ({
    default: module.UserProfilePage,
  })),
  "UserProfilePage",
);
const SettingsPage = lazyRetry(
  () => import("@/src/domains/account/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
  "SettingsPage",
);
const AuthCallbackPage = lazyRetry(
  () => import("@/src/domains/account/AuthCallbackPage").then((module) => ({
    default: module.AuthCallbackPage,
  })),
  "AuthCallbackPage",
);

export const accountRoutes = defineAppRoutes([
  { id: "account-me", path: "/me", element: <AccountPage /> },
  { id: "account-profile", path: "/u/:userId", element: <UserProfilePage /> },
  { id: "account-settings", path: "/settings", element: <SettingsPage /> },
  {
    id: "account-auth-callback",
    path: "/auth/callback",
    element: <AuthCallbackPage />,
  },
]);
