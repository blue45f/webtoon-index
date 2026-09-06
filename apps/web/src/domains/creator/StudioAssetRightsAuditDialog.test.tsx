// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioAssetRightsAuditDialog } from "./StudioAssetRightsAuditDialog";

import type { El } from "./studio-element-model";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioAssetRightsAuditDialog", () => {
  it("projects the placed asset ledger and closes with a named 44px control", () => {
    const onClose = vi.fn();
    render(
      <StudioAssetRightsAuditDialog
        open
        onClose={onClose}
        workId="episode-1"
        pages={[
          {
            id: "page-1",
            elements: [
              {
                id: "upload-1",
                type: "image",
                src: "data:image/png;base64,AA==",
                x: 0,
                y: 0,
                width: 10,
                height: 10,
              } as El,
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("고유 에셋")).toBeTruthy();
    expect(screen.getAllByText("local:upload-1").length).toBeGreaterThan(0);
    expect(screen.getByText("게시 전 확인 필요")).toBeTruthy();
    const close = screen.getByRole("button", {
      name: "에셋 권리·납품 감사 닫기",
    });
    expect(close.className).toContain("size-11");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not mount while closed", () => {
    render(
      <StudioAssetRightsAuditDialog open={false} onClose={vi.fn()} pages={[]} />
    );
    expect(
      screen.queryByRole("dialog", { name: "에셋 권리·납품 감사" })
    ).toBeNull();
  });
});
