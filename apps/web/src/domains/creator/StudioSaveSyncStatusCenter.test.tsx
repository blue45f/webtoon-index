// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendCanvasOperation,
  createEmptyOperationJournal,
} from "./studio-operation-recovery-coordinator";
import { StudioSaveSyncStatusCenter } from "./StudioSaveSyncStatusCenter";

afterEach(() => {
  cleanup();
});

describe("StudioSaveSyncStatusCenter", () => {
  it("renders compact status pill with save status", () => {
    const journal = createEmptyOperationJournal("doc-1");
    render(<StudioSaveSyncStatusCenter journal={journal} />);

    expect(screen.getByText("저장 완료")).not.toBeNull();
  });

  it("shows pending operations count when journal has buffered ops", () => {
    let journal = createEmptyOperationJournal("doc-1");
    journal = appendCanvasOperation(journal, "stroke", "선화 작화", {});

    render(<StudioSaveSyncStatusCenter journal={journal} />);
    expect(screen.getByText("1개 작업 보존 중")).not.toBeNull();
  });

  it("opens popover dialog on pill click and displays detailed status", () => {
    const onForceCheckpoint = vi.fn();
    let journal = createEmptyOperationJournal("doc-1");
    journal = appendCanvasOperation(journal, "stroke", "스케치", {});

    render(
      <StudioSaveSyncStatusCenter
        journal={journal}
        onForceCheckpoint={onForceCheckpoint}
      />
    );

    const pill = screen.getByRole("button", { name: "저장 및 동기화 상태 열기" });
    fireEvent.click(pill);

    expect(screen.getByRole("dialog", { name: "저장 및 동기화 상태 상세" })).not.toBeNull();
    expect(screen.getByText("로컬 지속성 (OPFS)")).not.toBeNull();
    expect(screen.getByText("작업 단위 저널 (Journal)")).not.toBeNull();

    const checkpointBtn = screen.getByRole("button", { name: /체크포인트 생성/u });
    fireEvent.click(checkpointBtn);
    expect(onForceCheckpoint).toHaveBeenCalledTimes(1);
  });
});
