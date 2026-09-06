// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioInterchangeLossPreviewDialog } from "./StudioInterchangeLossPreviewDialog";

import type { StudioInterchangeLossPreviewInput } from "./studio-interchange-loss-preview";

const READY_PREVIEW: StudioInterchangeLossPreviewInput = {
  format: "ora",
  fileName: "episode-03.ora",
  source: {
    pageCount: 1,
    layerCount: 8,
    width: 1_600,
    height: 2_400,
    alpha: "present",
    colorSpace: "sRGB",
    editability: "layered",
  },
  result: {
    pageCount: 1,
    layerCount: 8,
    width: 1_600,
    height: 2_400,
    alpha: "present",
    colorSpace: "sRGB",
    editability: "layered",
  },
  proxy: { enabled: false },
};

const DESTINATION_CHOICES = [
  {
    id: "new-page",
    label: "새 페이지로 추가",
    description: "원본 레이어와 캔버스 크기를 별도 페이지에 유지합니다.",
    recommended: true,
  },
  {
    id: "current-page",
    label: "현재 페이지 위에 배치",
    description: "현재 페이지 좌표계에 맞춰 선택한 레이어 위로 배치합니다.",
  },
] as const;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_024 });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => null,
    [Symbol.iterator]: function* iterator() {
      yield {} as DOMRect;
    },
  } as DOMRectList);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioInterchangeLossPreviewDialog", () => {
  it("does not mount its portal while controlled closed", () => {
    render(
      <StudioInterchangeLossPreviewDialog
        open={false}
        preview={READY_PREVIEW}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-studio-modal-backdrop='true']")).toBeNull();
  });

  it("labels the modal, presents all seven checks, and reveals source/result details on demand", async () => {
    render(
      <StudioInterchangeLossPreviewDialog
        open
        preview={READY_PREVIEW}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "변환 전 손실 확인" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    expect(dialog.getAttribute("data-loss-preview-status")).toBe("ready");
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).toContain("min-w-0");
    expect(dialog.className).toContain("100dvh");
    expect(screen.getByText("episode-03.ora")).toBeTruthy();
    expect(screen.getByRole("list", { name: "가져오기 변환 항목" }).children).toHaveLength(7);
    expect(document.querySelectorAll("[data-loss-gate='advisory']")).toHaveLength(7);
    expect(screen.queryByText("가져온 뒤", { selector: "dt" })).toBeNull();

    const details = screen.getByRole("button", { name: "세부 정보 보기" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(details);

    expect(screen.getByRole("button", { name: "세부 정보 접기" }).getAttribute("aria-expanded"))
      .toBe("true");
    expect(screen.getAllByText("가져온 뒤", { selector: "dt" })).toHaveLength(7);
    expect(screen.getAllByText("1,600 × 2,400 px").length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" })));
  });

  it("requires and controls an optional destination choice, then confirms with the selected id", () => {
    const onConfirm = vi.fn();

    function ChoiceHarness() {
      const [selectedChoiceId, setSelectedChoiceId] = useState<string>();
      return (
        <StudioInterchangeLossPreviewDialog
          open
          preview={READY_PREVIEW}
          choices={DESTINATION_CHOICES}
          selectedChoiceId={selectedChoiceId}
          onSelectedChoiceChange={setSelectedChoiceId}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      );
    }

    render(<ChoiceHarness />);

    expect(screen.getByText("권장")).toBeTruthy();
    expect(screen.getByRole("button", { name: "확인하고 가져오기" })).toHaveProperty("disabled", true);
    expect(screen.getByText("가져올 위치를 선택해야 계속할 수 있습니다.")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /새 페이지로 추가/u }));
    expect(screen.getByRole("radio", { name: /새 페이지로 추가/u })).toHaveProperty("checked", true);
    expect(screen.queryByText("가져올 위치를 선택해야 계속할 수 있습니다.")).toBeNull();

    const confirm = screen.getByRole("button", { name: "확인하고 가져오기" });
    expect(confirm).toHaveProperty("disabled", false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith("new-page");
  });

  it("keeps the 320px layout single-column with full-width, 44px actions and safe-area padding", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    render(
      <StudioInterchangeLossPreviewDialog
        open
        preview={READY_PREVIEW}
        choices={DESTINATION_CHOICES}
        selectedChoiceId="new-page"
        onSelectedChoiceChange={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "변환 전 손실 확인" });
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).not.toContain("min-w-[");
    expect(dialog.parentElement?.className).toContain("safe-area-inset-left");
    expect(screen.getByRole("list", { name: "가져오기 변환 항목" }).className)
      .toContain("sm:grid-cols-2");
    const cancel = screen.getByRole("button", { name: "취소" });
    const confirm = screen.getByRole("button", { name: "확인하고 가져오기" });
    expect(cancel.parentElement?.className).toContain("grid-cols-1");
    expect(cancel.parentElement?.className).toContain("min-[360px]:grid-cols-2");
    expect(cancel.className).toContain("min-h-11");
    expect(confirm.className).toContain("min-h-11");
  });

  it("does not accept a selected destination that became unavailable", () => {
    render(
      <StudioInterchangeLossPreviewDialog
        open
        preview={READY_PREVIEW}
        choices={[{ ...DESTINATION_CHOICES[0]!, disabled: true }]}
        selectedChoiceId="new-page"
        onSelectedChoiceChange={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /새 페이지로 추가/u }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "확인하고 가져오기" }))
      .toHaveProperty("disabled", true);
  });

  it("supports Cancel, Escape, and pointer backdrop dismissal while restoring focus ownership", async () => {
    const onCancel = vi.fn();
    const launcher = document.createElement("button");
    launcher.textContent = "가져오기 열기";
    document.body.append(launcher);
    launcher.focus();

    const view = render(
      <StudioInterchangeLossPreviewDialog
        open
        preview={READY_PREVIEW}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const cancel = screen.getByRole("button", { name: "취소" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    const backdrop = document.querySelector<HTMLButtonElement>("[data-studio-modal-backdrop='true']");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(document.activeElement).toBe(launcher);
    launcher.remove();
  });

  it("locks accidental dismissal while busy but keeps an explicit abort action", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <StudioInterchangeLossPreviewDialog
        open
        busy
        preview={READY_PREVIEW}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "변환 전 손실 확인" });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("파일을 안전하게 가져오는 중입니다. 필요하면 아래에서 중단할 수 있어요.")).toBeTruthy();
    const abort = screen.getByRole("button", { name: "가져오기 중단" });
    expect(abort).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "확인하고 가져오기" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "손실 확인 창 닫기" })).toHaveProperty("disabled", true);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.querySelector("[data-studio-modal-backdrop='true']")!);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(abort);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders codec blockers as critical rows and never calls confirm", () => {
    const onConfirm = vi.fn();
    render(
      <StudioInterchangeLossPreviewDialog
        open
        preview={{
          ...READY_PREVIEW,
          constraints: [{
            category: "layers",
            gate: "blocking",
            message: "암호화된 레이어는 해제한 뒤 다시 시도하세요.",
          }],
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "변환 전 손실 확인" });
    expect(dialog.getAttribute("data-loss-preview-status")).toBe("blocked");
    expect(screen.getByRole("alert").textContent).toContain("현재 설정으로는 가져올 수 없습니다");
    const blockedRow = document.querySelector("[data-loss-category='layers']");
    expect(blockedRow?.getAttribute("data-loss-severity")).toBe("critical");
    expect(blockedRow?.getAttribute("data-loss-gate")).toBe("blocking");

    fireEvent.click(screen.getByRole("button", { name: "먼저 문제 해결" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
