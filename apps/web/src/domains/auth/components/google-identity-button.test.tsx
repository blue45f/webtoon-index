// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleIdentityButton } from "./google-identity-button";

const signInWithGoogleIdToken = vi.hoisted(() => vi.fn());
const initialize = vi.hoisted(() => vi.fn());
const renderButton = vi.hoisted(() => vi.fn());
let credentialCallback: ((response: { credential?: string }) => void) | null = null;

vi.mock("@/src/compat/auth-session-store", () => ({
  signInWithGoogleIdToken,
}));

describe("Google Identity Services 로그인 버튼", () => {
  beforeAll(() => {
    initialize.mockImplementation(
      (config: { callback: (response: { credential?: string }) => void }) => {
        credentialCallback = config.callback;
      },
    );
    renderButton.mockImplementation((parent: HTMLElement) => {
      const button = document.createElement("button");
      button.textContent = "Continue with Google";
      parent.appendChild(button);
    });
    window.google = { accounts: { id: { initialize, renderButton } } };
  });

  beforeEach(() => {
    signInWithGoogleIdToken.mockReset();
    initialize.mockClear();
    renderButton.mockClear();
    window.google = { accounts: { id: { initialize, renderButton } } };
  });

  afterEach(() => {
    cleanup();
  });

  it("GIS 모듈 로드 실패에는 모듈 다시 불러오기 동작을 안내한다", async () => {
    delete window.google;

    render(
      <GoogleIdentityButton
        clientId="client.apps.googleusercontent.com"
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        document.querySelector('script[src="https://accounts.google.com/gsi/client"]'),
      ).not.toBeNull();
    });
    fireEvent.error(
      document.querySelector('script[src="https://accounts.google.com/gsi/client"]')!,
    );

    expect(
      await screen.findByText("Google 로그인 모듈을 불러오지 못했어요."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Google 로그인 모듈 다시 불러오기" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).toBeNull();
    expect(signInWithGoogleIdToken).not.toHaveBeenCalled();
  });

  it("공식 GIS 버튼을 렌더하고 credential 로그인 성공을 부모에 알린다", async () => {
    const onSuccess = vi.fn();
    signInWithGoogleIdToken.mockResolvedValue({ ok: true, error: null, status: 200 });

    render(
      <GoogleIdentityButton
        clientId="client.apps.googleusercontent.com"
        onSuccess={onSuccess}
      />,
    );

    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client.apps.googleusercontent.com",
        auto_select: false,
        use_fedcm_for_button: true,
      }),
    );
    expect(screen.getByText("Continue with Google")).toBeTruthy();

    await act(async () => {
      credentialCallback?.({ credential: "header.payload.signature" });
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(signInWithGoogleIdToken).toHaveBeenCalledWith(
      "header.payload.signature",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("로그인 실패에는 새 credential을 받는 재시도를 제공하고 기존 GIS 버튼을 숨긴다", async () => {
    const errorMessage = "Google 로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
    signInWithGoogleIdToken.mockResolvedValue({
      ok: false,
      error: errorMessage,
      status: 503,
    });

    render(
      <GoogleIdentityButton
        clientId="client.apps.googleusercontent.com"
        onSuccess={vi.fn()}
      />,
    );
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));

    await act(async () => {
      credentialCallback?.({ credential: "header.payload.signature" });
    });

    expect(
      await screen.findByText(errorMessage),
    ).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Google로 다시 시도" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "다른 방식으로 Google 로그인" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Google로 다시 시도" }));

    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    expect(signInWithGoogleIdToken).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeTruthy();
  });

  it("discloses the redirect fallback only after GIS failure when discovery authorized it", async () => {
    const onRedirectFallback = vi.fn();
    signInWithGoogleIdToken.mockResolvedValue({
      ok: false,
      error: "Google 로그인 응답을 처리하지 못했어요.",
      status: 503,
    });

    render(
      <GoogleIdentityButton
        clientId="client.apps.googleusercontent.com"
        onSuccess={vi.fn()}
        onRedirectFallback={onRedirectFallback}
      />,
    );
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));

    await act(async () => {
      credentialCallback?.({ credential: "header.payload.signature" });
    });

    const fallback = await screen.findByRole("button", {
      name: "다른 방식으로 Google 로그인",
    });
    expect(onRedirectFallback).not.toHaveBeenCalled();
    fireEvent.click(fallback);
    expect(onRedirectFallback).toHaveBeenCalledTimes(1);
  });
});
