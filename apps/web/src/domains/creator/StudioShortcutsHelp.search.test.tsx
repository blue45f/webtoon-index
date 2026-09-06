// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioShortcutsHelp } from "./StudioShortcutsHelp";

import { useI18n } from "@/shared/lib/i18n";

describe("StudioShortcutsHelp search and familiar operations", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    useI18n.setState({ lang: "ko" });
  });

  afterEach(() => {
    cleanup();
  });

  it("익숙한 기본 조작을 먼저 설명하고 기능명·동의어·키로 단축키를 찾는다", () => {
    render(<StudioShortcutsHelp open onClose={() => undefined} />);

    expect(screen.getByText("선택하고 움직이기")).toBeTruthy();
    expect(screen.getByText("화면만 이동·확대하기")).toBeTruthy();
    expect(screen.getByText("취소하고 되돌리기")).toBeTruthy();

    const search = screen.getByRole("searchbox", { name: "단축키와 조작 검색" });
    fireEvent.change(search, { target: { value: "페인트 버킷" } });
    expect(screen.getByRole("button", { name: "검색어 지우기" }).className)
      .toContain("pointer-coarse:size-11");
    expect(screen.getByText("검색 결과 1개")).toBeTruthy();
    expect(screen.getByText("고급 채우기 켜기·끄기")).toBeTruthy();
    expect(screen.queryByText("펜으로 전환")).toBeNull();

    fireEvent.change(search, { target: { value: "⌘Z" } });
    expect(screen.getByText("실행취소")).toBeTruthy();
  });

  it("검색 결과가 없을 때 전체 목록으로 돌아가는 복구 동작을 제공한다", () => {
    render(<StudioShortcutsHelp open onClose={() => undefined} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "단축키와 조작 검색" }), {
      target: { value: "존재하지 않는 기능" },
    });

    expect(screen.getByText("찾는 조작이 없습니다")).toBeTruthy();
    const showAll = screen.getByRole("button", { name: "전체 단축키 보기" });
    expect(showAll.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(showAll);
    expect(screen.getByText("전체 단축키")).toBeTruthy();
  });

  it("검색창과 편집 가능한 대상에서는 물음표 입력을 유지하고 바깥에서만 닫는다", () => {
    const onClose = vi.fn();
    render(<StudioShortcutsHelp open onClose={onClose} />);
    const search = screen.getByRole("searchbox", { name: "단축키와 조작 검색" });

    fireEvent.keyDown(search, { key: "?" });
    fireEvent.change(search, { target: { value: "?" } });
    expect((search as HTMLInputElement).value).toBe("?");
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const contentEditable = document.createElement("div");
    contentEditable.setAttribute("contenteditable", "true");
    const roleTextbox = document.createElement("div");
    roleTextbox.setAttribute("role", "textbox");
    dialog.append(textarea, select, contentEditable, roleTextbox);

    for (const target of [textarea, select, contentEditable, roleTextbox]) {
      fireEvent.keyDown(target, { key: "?" });
    }
    expect(onClose).not.toHaveBeenCalled();

    const outsideQuestion = new KeyboardEvent("keydown", {
      key: "?",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(outsideQuestion);
    expect(outsideQuestion.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("IME 조합과 legacy keyCode 229 중에는 물음표와 Escape를 닫기 명령으로 쓰지 않는다", () => {
    const onClose = vi.fn();
    render(<StudioShortcutsHelp open onClose={onClose} />);

    for (const key of ["?", "Escape"]) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }));
    }
    const legacyImeEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(legacyImeEscape, "keyCode", { value: 229 });
    document.body.dispatchEvent(legacyImeEscape);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
