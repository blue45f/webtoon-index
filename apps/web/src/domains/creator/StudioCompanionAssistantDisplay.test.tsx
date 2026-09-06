// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SFX_LEXICON_DATABASE } from "./assistant/webtoon-sfx-lexicon";
import { StudioCompanionAssistantDisplay } from "./StudioCompanionAssistantDisplay";

const TAB_PREFIX = "companion-assistant";
const SFX_COUNT = SFX_LEXICON_DATABASE.length;
const SFX_PAGE_SIZE = 6;

afterEach(cleanup);

function openTab(label: string) {
  fireEvent.click(screen.getByRole("tab", { name: label }));
}

function openSfxTab() {
  render(<StudioCompanionAssistantDisplay />);
  openTab("효과음 사전");
}

describe("StudioCompanionAssistantDisplay", () => {
  it("renders the six webtoon production helpers", () => {
    const markup = renderToStaticMarkup(<StudioCompanionAssistantDisplay />);

    expect(markup).toContain("웹툰 보조 툴킷");
    expect(markup).toContain("플랫폼 규격");
    expect(markup).toContain("스크롤 페이싱");
    expect(markup).toContain("효과음 사전");
    expect(markup).toContain("컬러 조화");
    expect(markup).toContain("포커스 타이머");
    expect(markup).toContain("크로키 가이드");
    expect(markup).toContain("네이버웹툰 (도전/베도/정식)");
  });

  it("does not present sample dimensions or invented gutters as live document facts", () => {
    render(<StudioCompanionAssistantDisplay />);

    expect(screen.getAllByText("예시 데이터").length).toBeGreaterThan(0);
    expect(screen.getByText(/업로드 차단 판단에 쓰지 않습니다/)).toBeTruthy();
    expect(screen.getByText("포맷 미검사")).toBeTruthy();
    expect(screen.getByText("컷 간 여백 미검사")).toBeTruthy();
    expect((screen.getByLabelText("내보내기 포맷") as HTMLSelectElement).value).toBe("");
  });

  it("labels connected canvas facts and preserves supplied audit fields", () => {
    render(
      <StudioCompanionAssistantDisplay
        canvasWidth={800}
        canvasHeight={1280}
        imageFormat="png"
        panelGuttersPx={[220, 640]}
      />,
    );

    expect(screen.getAllByText("현재 원고").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("원고 폭(px)") as HTMLInputElement).value).toBe("800");
    expect((screen.getByLabelText("원고 높이(px)") as HTMLInputElement).value).toBe("1280");
    expect((screen.getByLabelText("내보내기 포맷") as HTMLSelectElement).value).toBe("png");
    expect(screen.getByText("2개 여백 검사 중")).toBeTruthy();
  });

  it("switches to an explicit manual source as soon as the author edits an audit field", () => {
    render(<StudioCompanionAssistantDisplay />);

    fireEvent.change(screen.getByLabelText("원고 폭(px)"), { target: { value: "940" } });

    expect(screen.getAllByText("직접 입력").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("원고 폭(px)") as HTMLInputElement).value).toBe("940");
  });
});

describe("StudioCompanionAssistantDisplay — 디자인 토큰", () => {
  it("creator UI 에서 테마 전환되지 않는 원시 팔레트 색을 쓰지 않는다", () => {
    const markup = renderToStaticMarkup(<StudioCompanionAssistantDisplay />);
    expect(markup).not.toMatch(/\b(?:text|bg|border)-(?:emerald|amber|rose|slate|zinc|gray)-\d/);
    expect(markup).not.toContain("dark:text-");
  });

  it("규격 감사와 페이싱 결과를 good/warn/bad 시맨틱 토큰으로 칠한다", () => {
    const { container } = render(<StudioCompanionAssistantDisplay />);
    expect(container.innerHTML).toMatch(/border-(?:good|warn|bad)\/35/);
    expect(container.innerHTML).toMatch(/bg-(?:good|warn|bad)\/10/);

    openTab("스크롤 페이싱");
    expect(container.innerHTML).toMatch(/border-(?:good|warn)\/35/);
  });
});

describe("StudioCompanionAssistantDisplay — 탭 시맨틱", () => {
  it("6개 탭을 이름 붙은 tablist 로 노출하고 활성 탭만 selected 로 표시한다", () => {
    render(<StudioCompanionAssistantDisplay />);

    expect(screen.getByRole("tablist", { name: "웹툰 보조 툴킷 탭" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("각 탭이 좁은 창에서 잘려도 전체 이름이 남도록 title 을 단다", () => {
    render(<StudioCompanionAssistantDisplay />);
    expect(screen.getByRole("tab", { name: "스크롤 페이싱" }).getAttribute("title")).toBe(
      "스크롤 페이싱",
    );
  });

  it("활성 탭의 aria-controls 가 실제 렌더된 tabpanel 을 가리킨다", () => {
    render(<StudioCompanionAssistantDisplay />);

    const activeTab = screen.getByRole("tab", { name: "플랫폼 규격" });
    const panel = screen.getByRole("tabpanel");
    expect(activeTab.getAttribute("aria-controls")).toBe(`${TAB_PREFIX}-panel-spec-slicer`);
    expect(panel.getAttribute("id")).toBe(`${TAB_PREFIX}-panel-spec-slicer`);
    expect(panel.getAttribute("aria-labelledby")).toBe(`${TAB_PREFIX}-tab-spec-slicer`);
  });

  it("방향키로 탭을 순환 선택한다", () => {
    render(<StudioCompanionAssistantDisplay />);

    const first = screen.getByRole("tab", { name: "플랫폼 규격" });
    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: "스크롤 페이싱" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(first.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(screen.getByRole("tab", { name: "스크롤 페이싱" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "크로키 가이드" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});

describe("StudioCompanionAssistantDisplay — 스크롤 페이싱", () => {
  it("labels the default run as an example estimate and withholds viewport density judgement", () => {
    render(<StudioCompanionAssistantDisplay />);
    openTab("스크롤 페이싱");

    // The header describes the canvas input; the active panel must independently label its analysis.
    const panel = within(screen.getByRole("tabpanel", { name: "스크롤 페이싱" }));
    expect(panel.getByText("예시 데이터")).toBeTruthy();
    expect(panel.getByText(/컷 높이 600px 가정/)).toBeTruthy();
    expect(panel.getByText("화면당 컷수 미검사")).toBeTruthy();
  });

  it("uses an entered viewport only after the author supplies one", () => {
    render(<StudioCompanionAssistantDisplay />);
    openTab("스크롤 페이싱");

    fireEvent.change(screen.getByLabelText("독자 화면 높이(px)"), {
      target: { value: "844" },
    });

    expect(screen.getByText(/화면당 최대 \d+컷/)).toBeTruthy();
  });

  it("uses connected panel spans when supplied", () => {
    render(
      <StudioCompanionAssistantDisplay
        panels={[
          { id: "p1", topY: 0, bottomY: 600, heightPx: 600, dialogueCount: 1 },
          { id: "p2", topY: 850, bottomY: 1450, heightPx: 600, dialogueCount: 2 },
        ]}
      />,
    );
    openTab("스크롤 페이싱");

    const panel = within(screen.getByRole("tabpanel", { name: "스크롤 페이싱" }));
    expect(panel.getByText("현재 원고")).toBeTruthy();
    expect(panel.getByText("2컷 분석")).toBeTruthy();
  });
});

describe("StudioCompanionAssistantDisplay — 효과음 목록", () => {
  it("잘라낸 결과를 숨기지 않고 개수와 더 보기 어포던스를 함께 보여준다", () => {
    openSfxTab();

    expect(screen.getByText(`총 ${SFX_COUNT}개 중 ${SFX_PAGE_SIZE}개 표시`)).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(SFX_PAGE_SIZE);
    fireEvent.click(screen.getByRole("button", { name: `더 보기 (+${SFX_COUNT - SFX_PAGE_SIZE})` }));

    expect(screen.getByText(`총 ${SFX_COUNT}개 중 ${SFX_PAGE_SIZE * 2}개 표시`)).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(SFX_PAGE_SIZE * 2);
    expect(screen.getByRole("button", { name: `더 보기 (+${SFX_COUNT - SFX_PAGE_SIZE * 2})` })).toBeTruthy();
  });

  it("검색어가 바뀌면 펼쳐둔 개수를 처음으로 되돌린다", () => {
    openSfxTab();
    fireEvent.click(screen.getByRole("button", { name: `더 보기 (+${SFX_COUNT - SFX_PAGE_SIZE})` }));

    fireEvent.change(screen.getByRole("searchbox", { name: "의성어·의태어 검색" }), {
      target: { value: "쿵" },
    });
    expect(screen.queryByText(/12개 표시/)).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "의성어·의태어 검색" }), {
      target: { value: "" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(SFX_PAGE_SIZE);
    expect(screen.getByText(`총 ${SFX_COUNT}개 중 ${SFX_PAGE_SIZE}개 표시`)).toBeTruthy();
  });

  it("결과가 없으면 빈 공간 대신 StudioEmptyState 와 초기화 경로를 준다", () => {
    openSfxTab();

    fireEvent.change(screen.getByRole("searchbox", { name: "의성어·의태어 검색" }), {
      target: { value: "존재하지않는효과음" },
    });

    expect(document.querySelector('[data-studio-empty-state="true"]')).toBeTruthy();
    expect(screen.getByText("검색 결과가 없습니다")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "검색 초기화" }));
    expect(document.querySelector('[data-studio-empty-state="true"]')).toBeNull();
    expect(screen.getByText(`총 ${SFX_COUNT}개 중 ${SFX_PAGE_SIZE}개 표시`)).toBeTruthy();
  });

  it("흰색 글리프가 라이트 테마에서 사라지지 않도록 외곽선을 함께 입힌다", () => {
    openSfxTab();

    const glyph = screen.getByText("퍽");
    expect(glyph.getAttribute("style")).toContain("text-shadow");
    expect(glyph.getAttribute("style")).toContain("#dc2626");
  });

  it("복사와 캔버스 삽입을 모호한 카드 클릭 대신 이름 붙은 별도 액션으로 제공한다", () => {
    const onInsertSfxText = vi.fn();
    render(<StudioCompanionAssistantDisplay onInsertSfxText={onInsertSfxText} />);
    openTab("효과음 사전");

    expect(screen.getByRole("button", { name: "쿵 복사" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "쿵 캔버스에 삽입" }));

    expect(onInsertSfxText).toHaveBeenCalledWith("쿵");
    expect(screen.getByRole("status").textContent).toContain("캔버스에 삽입했습니다");
  });
});

describe("StudioCompanionAssistantDisplay — 클립보드", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "execCommand");
  });

  function stubClipboard(writeText: () => Promise<void>) {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  }

  it("복사가 실제로 성공했을 때만 복사됨을 알린다", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);

    openSfxTab();
    fireEvent.click(screen.getByRole("button", { name: "쿵 복사" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("복사됨");
    });
    expect(writeText).toHaveBeenCalledWith("쿵");
    expect(screen.getByRole("button", { name: "쿵 복사됨" })).toBeTruthy();
  });

  it("클립보드가 막히면 거짓 성공 대신 실패를 알린다", async () => {
    stubClipboard(() => Promise.reject(new Error("blocked")));
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
      writable: true,
    });

    openSfxTab();
    fireEvent.click(screen.getByRole("button", { name: "쿵 복사" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("복사 실패");
    });
    expect(screen.getByRole("button", { name: "쿵 복사 실패" })).toBeTruthy();
  });

  it("언마운트 뒤에는 리셋 타이머가 상태를 건드리지 않는다", async () => {
    stubClipboard(() => Promise.resolve());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const view = render(<StudioCompanionAssistantDisplay />);
    openTab("효과음 사전");
    fireEvent.click(screen.getByRole("button", { name: "쿵 복사" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("복사됨");
    });

    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 1600));

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("StudioCompanionAssistantDisplay — 컬러 조화", () => {
  it("모달과 같은 5개 표준 톤을 모두 노출한다", () => {
    render(<StudioCompanionAssistantDisplay />);
    openTab("컬러 조화");

    for (const name of [
      "아이보리 웜톤 (주인공 표준)",
      "쿨톤 창백 (로판 남주/뱀파이어)",
      "생기 피치 홍조 (히로인/소녀)",
      "건강한 구릿빛 태닝 (액션/스포츠)",
      "딥 브라운 / 다크 엘프 (판타지)",
    ]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("색 띠 묶음에 접근 가능한 이름과 띠별 title 을 준다", () => {
    render(<StudioCompanionAssistantDisplay />);
    openTab("컬러 조화");

    const swatch = screen.getByRole("img", {
      name: "딥 브라운 / 다크 엘프 (판타지) 밑색·1차 음영·2차 음영",
    });
    expect(Array.from(swatch.children).map((band) => band.getAttribute("title"))).toEqual([
      "밑색",
      "1차 음영",
      "2차 음영",
    ]);
  });

  it("임의 밑색을 검증하고 4단계 음영 결과를 즉시 만든다", () => {
    render(<StudioCompanionAssistantDisplay />);
    openTab("컬러 조화");

    const input = screen.getByLabelText("밑색 HEX");
    fireEvent.change(input, { target: { value: "not-a-color" } });
    expect(screen.getByRole("alert").textContent).toContain("#RRGGBB");

    fireEvent.change(input, { target: { value: "#336699" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("img", { name: "계산된 하이라이트·밑색·1차 음영·2차 음영" }),
    ).toBeTruthy();
  });
});

describe("StudioCompanionAssistantDisplay — 타이머와 크로키", () => {
  it("포커스 타이머에서 공정·집중 모드·초기화를 한 화면에서 제어한다", () => {
    render(<StudioCompanionAssistantDisplay />);
    openTab("포커스 타이머");

    fireEvent.change(screen.getByRole("combobox", { name: "집중 모드" }), {
      target: { value: "deep-flow-50" },
    });
    expect(screen.getByText("50:00")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "제작 공정" }), {
      target: { value: "lineart" },
    });
    expect((screen.getByRole("combobox", { name: "제작 공정" }) as HTMLSelectElement).value).toBe(
      "lineart",
    );
    expect(screen.getByRole("button", { name: "세션 초기화" })).toBeTruthy();
  });

  it("크로키 간격과 투시 프리셋을 함께 제어한다", () => {
    render(<StudioCompanionAssistantDisplay />);
    openTab("크로키 가이드");

    fireEvent.click(screen.getByRole("button", { name: "180초" }));
    expect(screen.getByText("03:00")).toBeTruthy();

    const select = screen.getByRole("combobox", { name: "투시 프리셋" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "dutch-tilt" } });
    expect(select.value).toBe("dutch-tilt");
    expect(within(select).getByRole("option", { selected: true }).textContent).toContain("더치 앵글");
    // Verify the preview, not a duplicate label in the native select's option list.
    expect(screen.getByText(/더치 앵글/, { selector: "p" })).toBeTruthy();
    expect(screen.getByText(/소실점 2개/)).toBeTruthy();
  });
});

describe("StudioCompanionAssistantDisplay — 터치 타깃 · 포커스 링", () => {
  it("각 탭 본문의 모든 조작 요소가 공용 포커스 링과 44px 터치 타깃을 갖는다", () => {
    render(<StudioCompanionAssistantDisplay />);

    for (const label of [
      "플랫폼 규격",
      "스크롤 페이싱",
      "효과음 사전",
      "컬러 조화",
      "포커스 타이머",
      "크로키 가이드",
    ]) {
      openTab(label);
      const panel = screen.getByRole("tabpanel", { name: label });
      // Pacing is directly editable through inputs; it does not need an artificial action button.
      const controls = Array.from(panel.querySelectorAll("button, input, select, textarea"));
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.className).toContain("focus-visible:outline-accent");
        if (control.matches('input[type="color"]')) {
          expect(control.classList.contains("size-11")).toBe(true);
        } else {
          expect(control.classList.contains("min-h-11")).toBe(true);
        }
      }
    }
  });

  it("장식용 lucide 아이콘은 접근성 트리에서 감춘다", () => {
    const { container } = render(<StudioCompanionAssistantDisplay />);
    const icons = Array.from(container.querySelectorAll("svg.lucide"));
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });
});