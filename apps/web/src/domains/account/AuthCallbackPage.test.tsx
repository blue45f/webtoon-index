// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthCallbackPage } from "./AuthCallbackPage";

import type { PropsWithChildren } from "react";

const apiRaw = vi.hoisted(() => vi.fn());
const completeOAuthLogin = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/shared/components/section", () => ({
  Container: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("@/shared/lib/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/src/compat/auth-session-store", () => ({
  completeOAuthLogin,
}));

vi.mock("@/src/compat/router-link", () => ({
  default: ({ children, href }: PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { raw: apiRaw },
  apiPath: (path: string) => `/api${path}`,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

function sessionResponse(authenticated: boolean): Response {
  return new Response(
    JSON.stringify(
      authenticated
        ? {
            authenticated: true,
            user: {
              id: "google-user-1",
              name: "Google User",
              email: "artist@example.test",
              image: null,
              role: "user",
            },
          }
        : { authenticated: false, user: null },
    ),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("AuthCallbackPage server-issued session completion", () => {
  beforeEach(() => {
    apiRaw.mockReset();
    completeOAuthLogin.mockReset();
    navigate.mockReset();
    globalThis.history.replaceState({}, "", "/auth/callback#session=1");
  });

  afterEach(() => {
    cleanup();
    globalThis.history.replaceState({}, "", "/");
  });

  it("loads the public user from the HttpOnly-cookie session marker", async () => {
    apiRaw.mockResolvedValueOnce(sessionResponse(true));

    render(<AuthCallbackPage />);

    expect(screen.getByText("auth.callback.message.working")).toBeTruthy();
    await waitFor(() => expect(completeOAuthLogin).toHaveBeenCalledWith(
      expect.objectContaining({ id: "google-user-1" }),
    ));
    expect(apiRaw).toHaveBeenCalledExactlyOnceWith("/api/auth/session", {
      method: "GET",
      cache: "no-store",
      throwHttpErrors: false,
    });
    expect(screen.getByText("auth.callback.message.done")).toBeTruthy();
    expect(screen.queryByText("auth.callback.error.failed")).toBeNull();
  });

  it("fails closed when the marker has no authenticated cookie session", async () => {
    apiRaw.mockResolvedValueOnce(sessionResponse(false));

    render(<AuthCallbackPage />);

    expect(await screen.findByText("auth.callback.error.failed")).toBeTruthy();
    expect(completeOAuthLogin).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
