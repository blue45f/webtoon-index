// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_FEATURE_TUTORIALS } from "./studio-feature-tutorials";
import { StudioFeatureTutorialHub } from "./StudioFeatureTutorialHub";

import type { StudioTutorialProgressRepository } from "./studio-tutorial-progress-sqlite";

import { useI18n } from "@/shared/lib/i18n";

beforeEach(() => {
  useI18n.getState().setLang("ko");
  globalThis.localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("StudioFeatureTutorialHub", () => {
  it("hydrates and saves tutorial progress through the SQLite/OPFS authority", async () => {
    const save = vi.fn(async () => undefined);
    const repository: StudioTutorialProgressRepository = {
      authority: "sqlite-opfs",
      load: async () => ({ completed: ["pen"], lastId: "pen" }),
      save,
    };
    render(
      <StudioFeatureTutorialHub
        open
        onClose={vi.fn()}
        acquireProgressRepository={async () => repository}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog").getAttribute("data-studio-tutorial-progress-authority"))
        .toBe("sqlite-opfs");
      expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    });

    const nextTutorial = STUDIO_FEATURE_TUTORIALS[1]!;
    fireEvent.click(screen.getByRole("button", { name: nextTutorial.title }));
    await waitFor(() => {
      expect(save).toHaveBeenLastCalledWith({ completed: ["pen"], lastId: nextTutorial.id });
    });
  });

  it("does not let late hydration overwrite progress chosen in the open dialog", async () => {
    let resolveLoad!: (value: { completed: string[]; lastId: string }) => void;
    const load = new Promise<{ completed: string[]; lastId: string }>((resolve) => {
      resolveLoad = resolve;
    });
    const repository: StudioTutorialProgressRepository = {
      authority: "sqlite-opfs",
      load: () => load,
      save: async () => undefined,
    };
    render(
      <StudioFeatureTutorialHub
        open
        initialTutorialId="pen"
        onClose={vi.fn()}
        acquireProgressRepository={async () => repository}
      />,
    );
    const selected = STUDIO_FEATURE_TUTORIALS[1]!;
    fireEvent.click(screen.getByRole("button", { name: selected.title }));
    resolveLoad({ completed: ["fill"], lastId: "fill" });

    await waitFor(() => {
      expect(screen.getByRole("dialog").getAttribute("data-studio-tutorial-progress-authority"))
        .toBe("sqlite-opfs");
    });
    expect(screen.getByRole("button", { name: selected.title }).getAttribute("aria-current"))
      .toBe("true");
  });

  it("keeps tutorials usable and visibly marks progress as memory-only when SQLite is unavailable", async () => {
    render(
      <StudioFeatureTutorialHub
        open
        onClose={vi.fn()}
        acquireProgressRepository={async () => { throw new Error("OPFS unavailable"); }}
      />,
    );
    const warning = await screen.findByText(/튜토리얼 진행도는 .*이번 탭에서만 유지/u);
    expect(warning.getAttribute("data-studio-tutorial-persistence-status")).toBe("memory-only");
    expect(screen.getByRole("dialog").getAttribute("data-studio-tutorial-progress-authority"))
      .toBe("memory-only");
    fireEvent.click(screen.getByRole("button", { name: STUDIO_FEATURE_TUTORIALS[1]!.title }));
    expect(screen.getByRole("button", { name: STUDIO_FEATURE_TUTORIALS[1]!.title })
      .getAttribute("aria-current")).toBe("true");
  });

  it("closed 이면 렌더하지 않는다", () => {
    const { container } = render(<StudioFeatureTutorialHub open={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("제목·요약·단계 본문을 검색하고 결과 밖 active를 첫 결과로 안전 전환한다", () => {
    render(
      <StudioFeatureTutorialHub
        open
        initialTutorialId="pen"
        onClose={vi.fn()}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "기능 튜토리얼 검색" });
    expect(search.getAttribute("placeholder")).toBe("기능이나 하고 싶은 일을 검색하세요");
    expect(screen.getByRole("status").textContent).toContain(
      `전체 기능 ${STUDIO_FEATURE_TUTORIALS.length}개`,
    );

    fireEvent.change(search, { target: { value: "새 색은 추가되지 않습니다" } });

    expect(screen.getByRole("status").textContent).toContain("검색 결과 1개");
    expect(screen.getByRole("heading", { name: "색 밀어 섞기 (스머지)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "색 밀어 섞기 (스머지)" }).getAttribute("aria-current"))
      .toBe("true");
  });

  it("자동 편집 복사본 문구로 리터치 4종을 찾고 검색어를 지우면 전체 목록을 복구한다", () => {
    render(<StudioFeatureTutorialHub open onClose={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "기능 튜토리얼 검색" });

    fireEvent.change(search, { target: { value: "편집용 이미지 복사본을 자동" } });
    const resultList = document.getElementById("studio-tutorial-search-results");
    expect(resultList).not.toBeNull();
    for (const title of [
      "색 밀어 섞기 (스머지)",
      "물감 섞어 칠하기 (혼색)",
      "밝기·채도 붓 (닷지·번)",
      "형태 밀어 변형 (리퀴파이)",
    ]) {
      expect(within(resultList as HTMLElement).getByRole("button", { name: title })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "튜토리얼 검색어 지우기" }));
    expect(screen.getByRole("status").textContent).toContain(
      `전체 기능 ${STUDIO_FEATURE_TUTORIALS.length}개`,
    );
  });

  it("기본 작업 튜토리얼의 제목뿐 아니라 단계 속 행동 문구로도 바로 찾는다", () => {
    render(<StudioFeatureTutorialHub open onClose={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "기능 튜토리얼 검색" });

    for (const [query, title] of [
      ["휠 역할 버튼", "캔버스 이동·확대와 배율 잠금"],
      ["그룹 경계 상자", "선택·이동·다중 선택과 그룹"],
      ["최신 revision", "저장·자동복구와 안전 백업"],
    ]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByRole("button", { name: title }).getAttribute("aria-current")).toBe("true");
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
  });

  it("새 튜토리얼 번역 키가 아직 없어도 비한국어 화면에는 영어 안전 문구만 표시한다", () => {
    useI18n.getState().setLang("en");
    render(
      <StudioFeatureTutorialHub
        open
        initialTutorialId="fill"
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("heading", { name: "Fill a closed area" })).toBeTruthy();
    expect(screen.getByText("Choose Fill")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/[가-힣]/u);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search feature tutorials" }), {
      target: { value: "editable image copy" },
    });
    expect(screen.getByRole("button", { name: "Apply filters to strokes and images" })).toBeTruthy();
  });

  it("검색 결과 0개에서 명확한 빈 상태와 복구 동작을 제공한다", () => {
    render(<StudioFeatureTutorialHub open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "기능 튜토리얼 검색" }), {
      target: { value: "존재하지않는기능xyz" },
    });

    expect(screen.getByRole("status").textContent).toContain("검색 결과 0개");
    expect(screen.getByText("찾는 기능이 없어요")).toBeTruthy();
    expect(screen.getByText("검색 결과를 찾지 못했어요")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "전체 기능 보기" }));
    expect(screen.queryByText("찾는 기능이 없어요")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("전체 기능");
  });

  it("모바일 목록은 상세 내용을 밀어내지 않고 모든 핵심 조작에 44px 터치 영역을 유지한다", () => {
    render(<StudioFeatureTutorialHub open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const nav = screen.getByRole("navigation");
    const search = screen.getByRole("searchbox", { name: "기능 튜토리얼 검색" });
    const activeTutorial = dialog.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    const activeStep = dialog.querySelector<HTMLButtonElement>('button[aria-current="step"]');
    const closeButton = dialog.querySelector<HTMLButtonElement>("button:first-of-type");

    expect(dialog.className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(nav.className).toContain("max-h-[min(36dvh,16rem)]");
    expect(nav.className).toContain("md:max-h-none");
    expect(search.className).toContain("min-h-11");
    expect(search.className).toContain("pointer-coarse:min-h-11");
    expect(activeTutorial?.className).toContain("min-h-11");
    expect(activeStep?.className).toContain("size-11");
    expect(closeButton?.className).toContain("size-11");
    expect(screen.getByRole("button", { name: "이전" }).className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "다음" }).className).toContain("min-h-11");
  });

  it("따라 해보기는 실제로 누른 버튼을 도구 실행 계약에 전달한다", () => {
    const onTryAction = vi.fn();
    const onClose = vi.fn();
    render(
      <StudioFeatureTutorialHub
        open
        initialTutorialId="brush"
        onClose={onClose}
        onTryAction={onTryAction}
      />,
    );

    const trigger = screen.getByRole("button", { name: "브러시 열기" });
    fireEvent.click(trigger);

    expect(onTryAction).toHaveBeenCalledWith("brush", trigger);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Tab 포커스를 순환하고 배경·스크롤을 잠근 뒤 opener 상태까지 정확히 복원한다", () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    const opener = document.createElement("button");
    opener.textContent = "튜토리얼 열기";
    document.body.append(opener);
    opener.focus();
    const openerInertBeforeOpen = opener.inert;
    document.body.style.overflow = "clip";
    document.documentElement.style.overflow = "auto";
    const onClose = vi.fn();
    const view = render(<StudioFeatureTutorialHub open onClose={onClose} />);

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(opener.inert).toBe(true);

    const dialog = screen.getByRole("dialog");
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(<StudioFeatureTutorialHub open={false} onClose={onClose} />);
    expect(document.body.style.overflow).toBe("clip");
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(opener.inert).toBe(openerInertBeforeOpen);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
