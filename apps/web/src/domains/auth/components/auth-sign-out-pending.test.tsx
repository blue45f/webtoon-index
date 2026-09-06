// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthMenu } from "./auth-menu";

import type { AnchorHTMLAttributes } from "react";

const sessionMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock("@/src/compat/auth-session-store", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "author-1",
        name: "테스트 작가",
        email: "artist@example.com",
        image: null,
        role: "user",
      },
      token: null,
    },
    ready: true,
    status: "authenticated",
    update: vi.fn(),
  }),
  signOut: sessionMocks.signOut,
}));

vi.mock("@/src/domains/admin/components/admin-client", () => ({
  adminFetch: vi.fn().mockRejectedValue(new Error("not an admin")),
}));

vi.mock("@/src/compat/router-link", () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/shared/lib/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "auth.menu.triggerLabel": "계정 메뉴",
      "auth.menu.fallbackName": "사용자",
      "auth.menu.adminPanel": "관리자",
      "auth.menu.profile": "프로필",
      "nav.library": "서재",
      "auth.menu.settings": "설정",
      "auth.menu.signOut": "로그아웃",
    })[key] ?? key,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("logout pending UX", () => {
  beforeEach(() => {
    sessionMocks.signOut.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the session menu open, blocks duplicate requests, and retries from the same item", async () => {
    const first = deferred<{
      ok: false;
      status: "pending";
      attempts: number;
      httpStatus: number;
      error: string;
    }>();
    sessionMocks.signOut.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      ok: true,
      status: "signed-out",
      attempts: 1,
      httpStatus: 204,
      error: null,
    });

    render(<AuthMenu defaultMenuOpen />);

    const firstAction = await screen.findByRole("menuitem", { name: "로그아웃" });
    fireEvent.click(firstAction);
    fireEvent.click(firstAction);

    expect(sessionMocks.signOut).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("menuitem", { name: "실시간 연결 정리 중…" })).getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      first.resolve({
        ok: false,
        status: "pending",
        attempts: 3,
        httpStatus: 503,
        error: "로그아웃 확인에 실패했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
      });
      await first.promise;
    });

    const status = await screen.findByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("로그아웃 확인에 실패했어요");

    const retryAction = screen.getByRole("menuitem", { name: "로그아웃 다시 시도" });
    expect(retryAction.getAttribute("aria-describedby")).toBe(status.id);
    fireEvent.click(retryAction);

    await waitFor(() => expect(sessionMocks.signOut).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
