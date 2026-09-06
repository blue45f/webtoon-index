// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  confirmStudioDestructiveAction,
  resetStudioDestructiveActionLedger,
} from "./studio-destructive-action-preview";
import {
  studioDeletePageRequest,
  studioDeleteProductionBibleEntryRequest,
  studioExportSplitChoiceRequest,
} from "./studio-destructive-command-catalog";
import { StudioDestructiveConfirmHost } from "./StudioDestructiveConfirmHost";

afterEach(() => {
  cleanup();
  resetStudioDestructiveActionLedger();
});

/** 다이얼로그가 실제로 열릴 때까지 마이크로태스크를 흘려보낸다. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("StudioDestructiveConfirmHost", () => {
  it("replaces the browser dialog with an on-canvas preview of the exact loss", async () => {
    render(<StudioDestructiveConfirmHost />);
    const answer = confirmStudioDestructiveAction(
      studioDeletePageRequest({ pageNumber: 3, elementCount: 12 }),
    );
    await flush();
    await screen.findByText("3페이지 삭제");

    const dialog = document.querySelector("[data-studio-destructive-confirm]");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("3페이지 삭제")).toBeTruthy();
    expect(screen.getByText("3페이지")).toBeTruthy();
    expect(screen.getByText("요소 12개가 함께 사라져요")).toBeTruthy();
    expect(screen.getByText("실행 취소 가능")).toBeTruthy();

    fireEvent.click(
      document.querySelector("[data-studio-destructive-confirm-button]") as HTMLElement,
    );
    await expect(answer).resolves.toBe(true);
    expect(document.querySelector("[data-studio-destructive-confirm]")).toBeNull();
  });

  it("declines on cancel without running anything", async () => {
    render(<StudioDestructiveConfirmHost />);
    // 자체 저장소를 쓰는 사이드카 — 통합 저널을 지나지 않아 여전히 되돌릴 수 없다.
    const answer = confirmStudioDestructiveAction(
      studioDeleteProductionBibleEntryRequest("소품 목록"),
    );
    await flush();

    expect(await screen.findByText("되돌릴 수 없음")).toBeTruthy();
    fireEvent.click(
      document.querySelector("[data-studio-destructive-cancel]") as HTMLElement,
    );
    await expect(answer).resolves.toBe(false);
  });

  it("names both outcomes when cancelling is a second action", async () => {
    render(<StudioDestructiveConfirmHost />);
    const answer = confirmStudioDestructiveAction(
      studioExportSplitChoiceRequest({
        scale: 3,
        maxCanvasDimLabel: "16,384",
        partCount: 4,
        fittingScale: 2,
      }),
    );
    await flush();

    expect(await screen.findByText("4개 파일로 나눠 저장")).toBeTruthy();
    expect(screen.getByText("2×로 낮춰 한 파일")).toBeTruthy();
    // 문서를 건드리지 않는 명령에 손실 블록을 띄우지 않는다.
    expect(document.querySelector("[data-studio-destructive-losses]")).toBeNull();

    fireEvent.click(
      document.querySelector("[data-studio-destructive-cancel]") as HTMLElement,
    );
    await expect(answer).resolves.toBe(false);
  });

  it("serializes overlapping approvals instead of silently dropping the later one", async () => {
    render(<StudioDestructiveConfirmHost />);
    const first = confirmStudioDestructiveAction(
      studioDeletePageRequest({ pageNumber: 1 }),
    );
    const second = confirmStudioDestructiveAction(
      studioDeletePageRequest({ pageNumber: 2 }),
    );
    await flush();

    expect(await screen.findByText("1페이지 삭제")).toBeTruthy();
    expect(screen.getByText("뒤에 1건 대기")).toBeTruthy();

    fireEvent.click(
      document.querySelector("[data-studio-destructive-cancel]") as HTMLElement,
    );
    await expect(first).resolves.toBe(false);
    await flush();

    expect(await screen.findByText("2페이지 삭제")).toBeTruthy();
    fireEvent.click(
      document.querySelector("[data-studio-destructive-confirm-button]") as HTMLElement,
    );
    await expect(second).resolves.toBe(true);
  });

  it("closes pending approvals when the host unmounts so no caller stalls forever", async () => {
    const view = render(<StudioDestructiveConfirmHost />);
    const answer = confirmStudioDestructiveAction(
      studioDeletePageRequest({ pageNumber: 5 }),
    );
    await flush();
    await screen.findByRole("alertdialog");
    expect(document.querySelector("[data-studio-destructive-confirm]")).not.toBeNull();

    view.unmount();
    await expect(answer).resolves.toBe(false);
  });
});
