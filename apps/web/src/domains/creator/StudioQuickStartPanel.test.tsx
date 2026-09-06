// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultStudioAppSettings } from "./studio-app-settings";
import { StudioQuickStartPanel } from "./StudioQuickStartPanel";

import { useI18n } from "@/shared/lib/i18n";

afterEach(cleanup);

beforeEach(() => {
  useI18n.getState().setLang("ko");
});

function createHandlers() {
  return {
    onDismiss: vi.fn(),
    onQuickComic: vi.fn(),
    onExample: vi.fn(),
    onOpenTemplate: vi.fn(),
    onOpenCharacter: vi.fn(),
    onOpenBackground3d: vi.fn(),
    onOpenBubble: vi.fn(),
    onSmartShape: vi.fn(),
    onStartDraw: vi.fn(),
    onBrushKit: vi.fn(),
    onCollabFocus: vi.fn(),
    onOpenTutorials: vi.fn(),
    shortcuts: defaultStudioAppSettings().shortcuts,
  };
}

function quickStartCard(): HTMLElement {
  return screen.getByRole("region", { name: "처음이라면 이 순서로 시작하세요" });
}

describe("StudioQuickStartPanel", () => {
  it("is a non-modal card: no aria-modal, no full-canvas backdrop", () => {
    // 감사 근거(docs/rewrite/ux-audit-v5.md §2.1 · 2026-09-02 아키텍처 리뷰 P0): 코치가 모달이라
    // 첫 획 전에 "닫기"가 강제됐다. 계약이 뒤집혔음을 구조로 고정한다.
    const handlers = createHandlers();
    const view = render(<StudioQuickStartPanel {...handlers} />);

    const card = quickStartCard();
    expect(card.hasAttribute("aria-modal")).toBe(false);
    expect(view.container.querySelector('[aria-modal="true"]')).toBeNull();
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();

    // 캔버스를 통째로 덮던 스크림이 사라졌다 — 흐림도, inset-0 오버레이도 없다.
    // (`before:inset-0` 같은 의사요소 장식은 오버레이가 아니므로 유틸리티 경계로 판정한다.)
    for (const element of view.container.querySelectorAll("*")) {
      const classes = element.getAttribute("class") ?? "";
      expect(classes).not.toMatch(/(?:^|\s)inset-0(?:\s|$)/u);
      expect(classes).not.toContain("backdrop-blur-[1px]");
    }
    // 루트는 자기 상자만 차지하고, 그 상자마저 포인터를 먹지 않는다(카드만 pointer-events-auto).
    const root = view.container.querySelector<HTMLElement>(
      '[data-studio-creative-starter="true"]',
    );
    expect(root?.className).toContain("pointer-events-none");
    expect(root?.className).toContain("absolute");
    expect(card.className).toContain("pointer-events-auto");
  });

  it("never steals focus when it mounts", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    const handlers = createHandlers();
    try {
      render(<StudioQuickStartPanel {...handlers} />);

      expect(document.activeElement).toBe(outside);
      expect(handlers.onDismiss).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it("mounts harmlessly under a modal that is already open instead of yielding", () => {
    // 예전에는 모달 계약이 남의 다이얼로그에서 포커스를 빼앗아서, 코치가 스스로 즉시 dismiss
    // 하는 회피가 필요했다(2026-08-21 verify-studio-launch). 이제 아무것도 빼앗지 않으므로
    // 회피도 필요 없다 — 코치는 그대로 남고 포커스는 그 다이얼로그에 머문다.
    const foreign = document.createElement("section");
    foreign.setAttribute("role", "dialog");
    foreign.setAttribute("aria-modal", "true");
    const foreignControl = document.createElement("button");
    foreignControl.type = "button";
    foreign.append(foreignControl);
    document.body.append(foreign);
    foreignControl.focus();

    const handlers = createHandlers();
    try {
      render(<StudioQuickStartPanel {...handlers} />);

      expect(handlers.onDismiss).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(foreignControl);
    } finally {
      foreign.remove();
    }
  });

  it("dismisses on Escape only while focus is inside the card", () => {
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    // 빈 캔버스에서 누른 Esc 는 아무것도 바꾸지 않는다 — 비모달 카드의 계약.
    document.body.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(handlers.onDismiss).not.toHaveBeenCalled();

    const close = within(quickStartCard()).getByRole("button", { name: /빠른 시작 닫기/u });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  it("hands keyboard focus to the menubar when it closes from inside the card", () => {
    // 스스로 뜬 코치에는 돌려줄 트리거가 없어서, 카드 안에서 닫으면 포커스가 BODY 로 떨어진다.
    // 카드 안에 포커스가 있었을 때만 메뉴바 착지점으로 옮긴다(밖에 있으면 건드리지 않는다).
    const originalGetClientRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function getClientRects() {
      return [
        { bottom: 24, height: 24, left: 0, right: 24, top: 0, width: 24, x: 0, y: 0 },
      ] as unknown as DOMRectList;
    };
    const anchor = document.createElement("button");
    anchor.setAttribute("data-studio-main-menu-trigger", "file");
    document.body.append(anchor);

    const handlers = createHandlers();
    try {
      render(<StudioQuickStartPanel {...handlers} />);

      const close = within(quickStartCard()).getByRole("button", {
        name: /빠른 시작 닫기/u,
      });
      close.focus();
      fireEvent.click(close);

      expect(handlers.onDismiss).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(anchor);
    } finally {
      anchor.remove();
      Element.prototype.getClientRects = originalGetClientRects;
    }
  });

  it("leaves outside focus alone when it is dismissed by a canvas pointerdown", async () => {
    const originalGetClientRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function getClientRects() {
      return [
        { bottom: 24, height: 24, left: 0, right: 24, top: 0, width: 24, x: 0, y: 0 },
      ] as unknown as DOMRectList;
    };
    const anchor = document.createElement("button");
    anchor.setAttribute("data-studio-main-menu-trigger", "file");
    document.body.append(anchor);
    const canvas = document.createElement("div");
    canvas.setAttribute("data-studio-canvas-viewport", "true");
    document.body.append(canvas);

    const handlers = createHandlers();
    try {
      render(<StudioQuickStartPanel {...handlers} />);

      // 캔버스로 향한 첫 pointerdown 은 그리려는 동작이다 — 코치만 비키고 포커스는 손대지 않는다.
      fireEvent.pointerDown(canvas);
      await Promise.resolve();
      expect(handlers.onDismiss).toHaveBeenCalledOnce();
      expect(document.activeElement).not.toBe(anchor);
    } finally {
      canvas.remove();
      anchor.remove();
      Element.prototype.getClientRects = originalGetClientRects;
    }
  });

  it("presents the familiar four-step workflow in order and opens immediate actions", () => {
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    const card = quickStartCard();

    expect(within(card).getByText("기능을 열면 바로 작업")).toBeTruthy();
    expect(within(card).getByText(/도구를 열면 바로 캔버스에서 작업해요/u)).toBeTruthy();
    expect(
      Array.from(card.querySelectorAll<HTMLElement>("[data-studio-quickstart-step]"), (step) =>
        step.getAttribute("data-studio-quickstart-step"),
      ),
    ).toEqual(["select", "draw", "dialogue", "save-undo"]);
    expect(within(card).getByText(/V · 클릭하거나 드래그해 고르기/u)).toBeTruthy();
    expect(within(card).getByText("Ctrl/⌘S 저장 · ⌘·Z 되돌리기")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: /2\. 그리기/u }));
    fireEvent.click(within(card).getByRole("button", { name: /3\. 말풍선·텍스트/u }));

    expect(handlers.onStartDraw).toHaveBeenCalledOnce();
    expect(handlers.onOpenBubble).toHaveBeenCalledOnce();
  });

  it("keeps every primary route on its existing callback contract", () => {
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "웹툰 흐름으로 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "예시로 익히기" }));
    fireEvent.click(screen.getByRole("button", { name: "전체 기능 안내" }));

    expect(handlers.onQuickComic).toHaveBeenCalledOnce();
    expect(handlers.onExample).toHaveBeenCalledOnce();
    expect(handlers.onOpenTutorials).toHaveBeenCalledOnce();
  });

  it("keeps secondary tools collapsed by default while preserving every direct route", () => {
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    const details = document.querySelector<HTMLDetailsElement>("[data-studio-quickstart-more]");
    expect(details).not.toBeNull();
    if (!details) return;

    expect(details.open).toBe(false);
    details.open = true;

    const actions = [
      ["선·도형 다듬기", handlers.onSmartShape],
      ["브러시 골라 그리기", handlers.onBrushKit],
      ["컷 나누기", handlers.onOpenTemplate],
      ["캐릭터·포즈", handlers.onOpenCharacter],
      ["3D 배경 열기", handlers.onOpenBackground3d],
      ["캔버스 넓게 보기", handlers.onCollabFocus],
    ] as const;

    for (const [name, handler] of actions) {
      const button = within(details).getByRole("button", { name: new RegExp(name, "u") });
      fireEvent.click(button);
      expect(handler).toHaveBeenCalledOnce();
      if (name === "브러시 골라 그리기") {
        expect(handler).toHaveBeenCalledWith(button);
      }
    }
    expect(details.querySelectorAll("[data-studio-quick-tool]")).toHaveLength(6);
  });

  it("limits canvas obstruction and keeps every interactive target touch-sized", () => {
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    const card = quickStartCard();
    const scrollArea = card.querySelector<HTMLElement>("[data-studio-quickstart-scroll]");

    expect(card.className).toContain("max-h-[min(60dvh,calc(100svh-5rem))]");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).not.toContain("rounded-2xl");
    expect(scrollArea?.className).toContain("overflow-y-auto");

    for (const target of card.querySelectorAll<HTMLElement>("button, summary")) {
      expect(
        ["size-11", "min-h-11", "min-h-12", "min-h-[4.5rem]"].some((token) =>
          target.className.includes(token),
        ),
      ).toBe(true);
    }

    const close = within(card).getByRole("button", { name: /빠른 시작 닫기/u });
    expect(close.getAttribute("data-studio-quickstart-dismiss")).toBe("true");
    // 스크림이 사라지면서 Playwright 검증 스크립트가 쓰는 backdrop 선택자를 닫기 버튼이 잇는다.
    expect(close.getAttribute("data-studio-quickstart-backdrop")).toBe("true");
    fireEvent.click(close);
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  it("floats bottom-right on wide screens and stays clear of the mobile dock", () => {
    const handlers = createHandlers();
    const view = render(<StudioQuickStartPanel {...handlers} />);

    const root = view.container.querySelector<HTMLElement>(
      '[data-studio-creative-starter="true"]',
    );
    // 작은 화면: 위쪽(하단 모바일 독을 비켜서). ≥sm: 우하단 카드 + 그리기 옵션 바 높이만큼 상승.
    expect(root?.className).toContain("top-16");
    expect(root?.className).toContain("sm:right-4");
    expect(root?.className).toContain("sm:top-auto");
    expect(root?.className).toContain("sm:bottom-[calc(var(--studio-draw-options-height,0px)+1rem)]");
    expect(root?.className).toContain("sm:w-[min(22rem,calc(100%-2rem))]");
  });

  it("treats the first interaction outside the coach as a real dismissal", async () => {
    // 회귀 근거(브라우저 실측 2026-08-08): 코치가 떠 있는 채로 메뉴바에서 `텍스트 ▸ 말풍선`을
    // 열면 코치가 가려지기만 하고 dismiss 상태가 남지 않아, 그 패널을 Esc 로 닫는 순간 코치가
    // **다시 나타났다**. 바깥 조작을 진짜 dismiss 로 기록해야 재등장 경로가 닫힌다.
    const outside = document.createElement("button");
    outside.setAttribute("data-studio-main-menu-trigger", "text");
    document.body.append(outside);
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    // pointerdown 이 아니라 click 이어야 한다: pointerdown 에서 닫으면 코치 언마운트가
    // mousedown~mouseup 사이에 끼어들어 메뉴바가 재배치되고, 브라우저가 click 을 트리거가
    // 아닌 공통 조상으로 올려 첫 클릭이 통째로 사라졌다(실측 2026-08-08).
    fireEvent.pointerDown(outside);
    await Promise.resolve();
    expect(handlers.onDismiss).not.toHaveBeenCalled();

    // 그리고 클릭 dispatch 안에서가 아니라 그 뒤(마이크로태스크)에 닫아야 한다 — 클릭을
    // 처리하는 도중에 닫으면 재배치된 메뉴바가 사용자가 겨눈 트리거를 바꿔치기한다.
    fireEvent.click(outside);
    expect(handlers.onDismiss).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(handlers.onDismiss).toHaveBeenCalledOnce();

    outside.remove();
  });

  it("does not treat a click inside the coach as an outside dismissal", async () => {
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    const card = quickStartCard();
    fireEvent.click(within(card).getByRole("button", { name: /2\. 그리기/u }));
    await Promise.resolve();
    expect(handlers.onDismiss).not.toHaveBeenCalled();

    // 닫기 버튼은 자기 onClick 으로 한 번만 닫는다 — 바깥 감시자가 겹쳐 두 번 부르면 안 된다.
    fireEvent.click(within(card).getByRole("button", { name: /빠른 시작 닫기/u }));
    await Promise.resolve();
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  it("shows the current shortcut remap and uses 미지정 for an empty binding", () => {
    const handlers = createHandlers();
    render(
      <StudioQuickStartPanel
        {...handlers}
        shortcuts={{
          ...handlers.shortcuts,
          "tool-select": "Q",
          "tool-pen": "",
          "tool-lettering": "L",
          undo: "Mod+Y",
        }}
      />,
    );

    expect(screen.getByText("Q · 클릭하거나 드래그해 고르기")).toBeTruthy();
    expect(screen.getByText("미지정 · 펜을 열고 바로 그리기")).toBeTruthy();
    expect(screen.getByText("L · 도구를 열어 대사 넣기")).toBeTruthy();
    expect(screen.getByText("Ctrl/⌘S 저장 · ⌘·Y 되돌리기")).toBeTruthy();
  });

  it("uses an English typed fallback for new workflow copy outside Korean locales", () => {
    useI18n.getState().setLang("fr");
    const handlers = createHandlers();
    render(<StudioQuickStartPanel {...handlers} />);

    expect(screen.getByText("Start with these 4 steps")).toBeTruthy();
    expect(screen.getByText("Open a tool and start")).toBeTruthy();
    expect(screen.getByText("Open another tool")).toBeTruthy();
    expect(screen.queryByText("처음 시작하는 4단계")).toBeNull();
  });
});
