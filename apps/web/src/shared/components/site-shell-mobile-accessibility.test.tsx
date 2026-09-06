// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FloatingControls } from "./FloatingControls";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

import { useI18n } from "@/shared/lib/i18n";

vi.mock("../../domains/auth/components/auth-menu-shell", () => ({
  AuthMenuShell: () => <button type="button">계정</button>,
}));

const mediaMatches = new Map<string, boolean>();
const mediaListeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();

function installMobileMatchMedia(): void {
  mediaMatches.clear();
  mediaListeners.clear();
  mediaMatches.set("(max-width: 767px)", true);
  mediaMatches.set("(min-width: 1360px)", false);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const listeners = mediaListeners.get(query) ?? new Set();
      mediaListeners.set(query, listeners);
      return {
        get matches() {
          return mediaMatches.get(query) ?? false;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

function setMediaMatch(query: string, matches: boolean): void {
  mediaMatches.set(query, matches);
  const event = { matches, media: query } as MediaQueryListEvent;
  for (const listener of mediaListeners.get(query) ?? []) listener(event);
}

beforeEach(() => {
  installMobileMatchMedia();
  useI18n.getState().setLang("ko");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("mobile site shell accessibility", () => {
  it("isolates the page, loops focus, closes with Escape, and restores the full-menu trigger", async () => {
    const { container } = render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: "전체 메뉴" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "전체 메뉴" });
    const close = within(dialog).getByRole("button", { name: "전체 메뉴 닫기" });
    await waitFor(() => expect(document.activeElement).toBe(close));

    const quickNavigation = container.querySelector<HTMLElement>('nav[aria-label="빠른 이동"]');
    expect(quickNavigation?.hasAttribute("inert")).toBe(true);
    expect(quickNavigation?.getAttribute("aria-hidden")).toBe("true");

    const lastLink = within(dialog).getByRole("link", { name: "내 서재" });
    lastLink.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastLink);

    const backgroundHome = container.querySelector<HTMLElement>('header a[href="/"]');
    backgroundHome?.focus();
    await waitFor(() => expect(document.activeElement).toBe(close));

    expect(screen.queryByRole("button", { name: "설정 닫기" })).toBeNull();
    const backdrop = container.querySelector<HTMLElement>('[data-mobile-menu-backdrop="true"]');
    expect(backdrop?.tagName).toBe("DIV");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "전체 메뉴" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(quickNavigation?.hasAttribute("inert")).toBe(false);
    expect(quickNavigation?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("shows Korean as selected when a fresh browser reports ko-KR", () => {
    useI18n.getState().setLang("ko-KR");

    render(<FloatingControls placement="static" showTheme={false} />);

    const language = screen.getByRole<HTMLSelectElement>("combobox", { name: "언어 선택" });
    expect(useI18n.getState().lang).toBe("ko");
    expect(language.value).toBe("ko");
    expect(language.selectedOptions[0]?.textContent).toContain("한국어");
  });

  it("releases the hidden dialog trap when the desktop navigation breakpoint takes over", async () => {
    const { container } = render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: "전체 메뉴" });
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "전체 메뉴" });
    const quickNavigation = container.querySelector<HTMLElement>('nav[aria-label="빠른 이동"]');
    expect(quickNavigation?.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    act(() => setMediaMatch("(min-width: 1360px)", true));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "전체 메뉴" })).toBeNull());
    expect(quickNavigation?.hasAttribute("inert")).toBe(false);
    expect(quickNavigation?.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).not.toBe(trigger);
  });

  it("reserves the fixed quick-navigation height below the mobile footer", () => {
    const { container } = render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>
    );

    const footer = container.querySelector("footer");
    expect(footer?.className).toContain(
      "pb-[calc(3.75rem+env(safe-area-inset-bottom))]"
    );
    expect(footer?.className).toContain("md:pb-0");
  });
});
