// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioFinishQualityView } from "./StudioFinishQualityView";

import type { StudioFinishQualityResult } from "./studio-finish-quality";

const result: StudioFinishQualityResult = {
  version: 1,
  status: "needs-work",
  score: 76,
  canExport: true,
  readyForFinalReview: false,
  checkedPageCount: 2,
  checkedElementCount: 6,
  checkedDialogueCount: 2,
  checkedImageCount: 1,
  checkedStrokeCount: 1,
  openCommentCount: 1,
  counts: { blocker: 0, error: 1, warning: 1, info: 0, total: 2 },
  truncated: false,
  issues: [
    {
      id: "finish-error",
      fingerprint: "error",
      code: "BUBBLE_TEXT_OVERFLOW",
      severity: "error",
      category: "dialogue",
      title: "말풍선 대사가 잘릴 수 있습니다",
      message: "대사가 말풍선 안에 들어가지 않습니다.",
      pageId: "page-1",
      pageIndex: 0,
      elementId: "bubble-1",
      elementIndex: 1,
    },
    {
      id: "finish-warning",
      fingerprint: "warning",
      code: "IMAGE_SOURCE_EXTERNAL",
      severity: "warning",
      category: "image",
      title: "외부 이미지 연결을 확인하세요",
      message: "외부 URL이 만료될 수 있습니다.",
      pageId: "page-2",
      pageIndex: 1,
      elementId: "image-1",
      elementIndex: 0,
    },
  ],
};

afterEach(cleanup);

describe("StudioFinishQualityView", () => {
  it("renders the score, counts and actionable issues", () => {
    const onSelectIssue = vi.fn();
    render(
      <StudioFinishQualityView
        result={result}
        onSelectIssue={onSelectIssue}
      />
    );

    expect(screen.getByRole("heading", { name: "마감 품질 검사" })).toBeTruthy();
    expect(screen.getByLabelText("마감 품질 점수 76점")).toBeTruthy();
    expect(screen.getByText("표시 2 / 전체 2")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "말풍선 대사가 잘릴 수 있습니다, 1페이지 · 요소 bubble-1로 이동",
      })
    );
    expect(onSelectIssue).toHaveBeenCalledWith(result.issues[0]);
  });

  it("filters by query, severity and inspection category", () => {
    render(<StudioFinishQualityView result={result} />);

    fireEvent.change(screen.getByPlaceholderText("문제·코드·페이지 검색"), {
      target: { value: "외부 이미지" },
    });
    expect(screen.queryByText("말풍선 대사가 잘릴 수 있습니다")).toBeNull();
    expect(screen.getByText("외부 이미지 연결을 확인하세요")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("심각도 필터"), {
      target: { value: "error" },
    });
    expect(screen.getByText("현재 필터에 맞는 문제가 없습니다")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("문제·코드·페이지 검색"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("검사 영역 필터"), {
      target: { value: "dialogue" },
    });
    expect(screen.getByText("말풍선 대사가 잘릴 수 있습니다")).toBeTruthy();
    expect(screen.queryByText("외부 이미지 연결을 확인하세요")).toBeNull();
  });

  it("exposes report download through an explicit callback", () => {
    const onDownloadReport = vi.fn();
    render(
      <StudioFinishQualityView
        result={result}
        onDownloadReport={onDownloadReport}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "마감 품질 검사 JSON 보고서 다운로드",
      })
    );
    expect(onDownloadReport).toHaveBeenCalledTimes(1);
  });
});
