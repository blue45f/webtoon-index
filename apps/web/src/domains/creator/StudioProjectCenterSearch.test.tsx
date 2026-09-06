// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioProjectCenterSearch } from "./StudioProjectCenterSearch";

function Fixture() {
  return (
    <div data-studio-project-actions-menu="true">
      <StudioProjectCenterSearch />
      <button type="button" title="프로젝트를 안전하게 보관">
        아카이브 백업
      </button>
      <button type="button" title="게시 전 구조 검사">
        게시 사전검사
      </button>
      <button type="button" aria-label="버전 체크포인트 열기">
        버전
      </button>
      <button type="button" data-project-center-control="true">
        닫기
      </button>
    </div>
  );
}

afterEach(cleanup);

describe("StudioProjectCenterSearch", () => {
  it("filters actions by visible text, title and accessible name", async () => {
    render(<Fixture />);
    const search = screen.getByRole("searchbox", {
      name: "프로젝트 센터 도구 검색",
    }) as HTMLInputElement;

    fireEvent.change(search, { target: { value: "검사" } });

    await waitFor(() => {
      const matched = screen.getByRole("button", { name: "게시 사전검사" });
      const hidden = document.querySelector<HTMLButtonElement>(
        'button[title="프로젝트를 안전하게 보관"]',
      );
      expect(matched.hasAttribute("hidden")).toBe(false);
      expect(hidden?.hidden).toBe(true);
    });

    fireEvent.change(search, { target: { value: "체크포인트" } });
    await waitFor(() => {
      const matched = screen.getByRole("button", {
        name: "버전 체크포인트 열기",
      });
      expect(matched.hasAttribute("hidden")).toBe(false);
    });
  });

  it("uses slash to focus search and Escape to clear it before the dialog closes", async () => {
    render(<Fixture />);
    const search = screen.getByRole("searchbox", {
      name: "프로젝트 센터 도구 검색",
    }) as HTMLInputElement;

    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: "없는 도구" } });
    await screen.findByText("일치하는 프로젝트 도구가 없습니다");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(search.value).toBe("");
    expect(screen.queryByText("일치하는 프로젝트 도구가 없습니다")).toBeNull();
  });
});
