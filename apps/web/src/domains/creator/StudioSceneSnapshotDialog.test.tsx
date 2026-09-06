// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioSceneSnapshotDialog,
  type StudioSceneSnapshotDialogProps,
} from "./StudioSceneSnapshotDialog";

import type { PageState } from "./studio-page-state";

const PAGE: PageState = {
  id: "page-1",
  elements: [],
  bg: "#ffffff",
  bgGrad: null,
  canvasH: 1_200,
  name: "옥상 장면",
};

function createProps(
  overrides: Partial<StudioSceneSnapshotDialogProps> = {}
): StudioSceneSnapshotDialogProps {
  return {
    sourcePage: PAGE,
    sourceWorkId: null,
    theme: "soft",
    onApply: vi.fn(),
    onClose: vi.fn(),
    repository: {
      list: vi.fn(async () => []),
      save: vi.fn(async () => []),
      duplicate: vi.fn(async () => []),
      delete: vi.fn(async () => []),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("StudioSceneSnapshotDialog", () => {
  it("opens one mobile-safe modal and retains the honest local-only panel", async () => {
    render(<StudioSceneSnapshotDialog {...createProps()} />);

    const dialog = screen.getByRole("dialog", { name: "장면 스냅샷" });
    expect(dialog.getAttribute("data-studio-modal-owner")).toBe("scene-snapshot");
    expect(dialog.className).toContain("100dvh");
    expect(screen.getByText("개인 · 이 기기 전용")).toBeTruthy();
    expect(screen.getByText(/팀 공유와 에셋 마켓 게시는 아직 지원하지 않습니다/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "장면 스냅샷 닫기" }).className).toContain(
      "size-11"
    );
  });

  it("closes through the button and Escape without stacking dialogs", () => {
    const onClose = vi.fn();
    render(<StudioSceneSnapshotDialog {...createProps({ onClose })} />);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "장면 스냅샷 닫기" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("locks background interaction and restores focus and scrolling on unmount", () => {
    const opener = document.createElement("button");
    opener.textContent = "장면 라이브러리 열기";
    document.body.append(opener);
    opener.focus();
    const view = render(<StudioSceneSnapshotDialog {...createProps()} />);

    expect(document.body.style.overflow).toBe("hidden");
    expect(view.container.inert).toBe(true);
    view.unmount();

    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
