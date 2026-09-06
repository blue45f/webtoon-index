// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { computeStudioProductionInsights } from "./studio-production-insights";
import { StudioProjectHealthSummary } from "./StudioProjectHealthSummary";

describe("StudioProjectHealthSummary", () => {
  it("teaches the local-only scope and presents a healthy project without decorative noise", () => {
    render(
      <StudioProjectHealthSummary
        insights={computeStudioProductionInsights({
          pages: [
            {
              frames: [{ dialogue: "출발하자." }],
              review: { status: "approved", locked: true },
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "프로젝트 건강 진단" }),
    ).toBeTruthy();
    expect(screen.getByText("로컬 규칙 v1")).toBeTruthy();
    expect(screen.getByText("주요 문제 없음")).toBeTruthy();
    expect(screen.getByText("10/10 규칙 통과")).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "프로젝트 건강 규칙 통과율" })
        .getAttribute("aria-valuenow"),
    ).toBe("100");
    expect(
      screen.getByText(/원고는 업로드하지 않아요/),
    ).toBeTruthy();
  });

  it("orders actionable health rows and gives a concrete next step for each issue", () => {
    render(
      <StudioProjectHealthSummary
        insights={computeStudioProductionInsights({
          pages: [
            {
              review: { status: "changes-requested", locked: false },
            },
          ],
          issues: [{ severity: "error" }],
        })}
      />,
    );

    expect(screen.getByText("완료 전 차단")).toBeTruthy();
    expect(screen.getByText("수정 요청 페이지 1개")).toBeTruthy();
    expect(screen.getByText("연결된 검사에서 차단 이슈 1개")).toBeTruthy();
    expect(screen.getByText("컷 구조가 없는 페이지 1개")).toBeTruthy();
    expect(screen.getAllByText(/다음 조치 ·/)).toHaveLength(3);
    expect(
      screen.getByText(/같은 페이지가 여러 항목에 포함될 수 있습니다/),
    ).toBeTruthy();
  });
});
