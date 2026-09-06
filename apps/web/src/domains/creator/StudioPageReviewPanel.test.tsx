// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioPageReviewPanel } from "./StudioPageReviewPanel";

const viewportState = vi.hoisted(() => ({ mobile: false }));

vi.mock("@/src/hooks/use-media-query", () => ({
  useIsMobile: () => viewportState.mobile,
}));

const PAGES = [
  {
    id: "page-1",
    label: "1화 첫 페이지",
    review: {
      status: "in-review",
      assignee: "희준",
      note: "",
      locked: false,
      updatedAt: 0,
    },
  },
  {
    id: "page-2",
    label: "1화 두 번째 페이지",
    review: {
      status: "approved",
      assignee: "검수자",
      note: "완료",
      locked: true,
      updatedAt: 0,
    },
  },
] as const;

beforeEach(() => {
  viewportState.mobile = false;
  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: 1_200,
  });
  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: 900,
  });
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  window.sessionStorage.clear();
});

describe("StudioPageReviewPanel", () => {
  it("uses a persistent movable desktop panel without blocking the canvas", () => {
    const onClose = vi.fn();
    const onPatchReview = vi.fn();
    render(
      <StudioPageReviewPanel
        open
        onClose={onClose}
        pages={PAGES}
        currentPageId="page-1"
        onSelectPage={vi.fn()}
        onPatchReview={onPatchReview}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "페이지 검토와 잠금",
    });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.getAttribute("data-studio-floating-surface")).toBe("true");
    expect(dialog.getAttribute("data-studio-page-review-surface")).toBe("desktop");
    expect(screen.getByRole("button", {
      name: "페이지 검토와 잠금 이동",
    })).toBeTruthy();
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(screen.getAllByRole("button", {
      name: "편집 가능",
    })[0]!);
    expect(onPatchReview).toHaveBeenCalledWith("page-1", { locked: true });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the full-screen modal contract on mobile", () => {
    viewportState.mobile = true;
    const onClose = vi.fn();
    render(
      <StudioPageReviewPanel
        open
        onClose={onClose}
        pages={PAGES}
        currentPageId="page-1"
        onSelectPage={vi.fn()}
        onPatchReview={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "페이지 검토와 잠금",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-studio-floating-surface")).toBeNull();
    expect(dialog.getAttribute("data-studio-page-review-surface")).toBe("mobile");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", {
      name: "페이지 검토 닫기",
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not mount either surface while closed", () => {
    render(
      <StudioPageReviewPanel
        open={false}
        onClose={vi.fn()}
        pages={PAGES}
        currentPageId="page-1"
        onSelectPage={vi.fn()}
        onPatchReview={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
