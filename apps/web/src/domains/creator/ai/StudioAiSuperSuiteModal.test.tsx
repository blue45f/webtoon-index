// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_WORKBENCH_PREFS_STORAGE_KEY } from "../studio-workbench-prefs";

import { StudioAiSuperSuiteModal } from "./StudioAiSuperSuiteModal";

// jsdom 환경에서는 import.meta.url 이 http 스킴이라 new URL(...) 로는 파일을 못 연다.
const modalSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/ai/StudioAiSuperSuiteModal.tsx"),
  "utf8"
);

/** 프라미스 한 바퀴 — copyStudioText 는 async 라 클릭 직후에는 아직 상태가 바뀌지 않는다. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function seedPrefs(aiSuite: Record<string, unknown>): void {
  localStorage.setItem(
    STUDIO_WORKBENCH_PREFS_STORAGE_KEY,
    JSON.stringify({
      assistant: {
        activeTab: "sfx-lexicon",
        platformId: "kakao-webtoon",
        readerSpeed: "fast",
        skinToneId: "deep-warm",
        focusStage: "inking",
        focusPreset: "deep-50",
        croquisIntervalSec: 180,
      },
      aiSuite,
    })
  );
}

function readPrefs(): {
  assistant: Record<string, unknown>;
  aiSuite: Record<string, unknown>;
} {
  return JSON.parse(localStorage.getItem(STUDIO_WORKBENCH_PREFS_STORAGE_KEY) ?? "{}") as {
    assistant: Record<string, unknown>;
    aiSuite: Record<string, unknown>;
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("StudioAiSuperSuiteModal — 모달 셸", () => {
  it("open 이 false 면 DOM 에 아무것도 남기지 않는다", () => {
    render(<StudioAiSuperSuiteModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("body 포털로 열고 스크림은 다이얼로그의 형제로 둔다", () => {
    const onClose = vi.fn();
    render(<StudioAiSuperSuiteModal open onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.tagName).toBe("SECTION");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-testid")).toBe("studio-ai-super-suite-modal");
    // 텍스트 입력이 많은 창이라 스튜디오 단축키가 타이핑을 삼키면 안 된다.
    expect(dialog.getAttribute("data-studio-shortcut-boundary")).toBe("true");

    const backdrop = document.querySelector('[data-studio-modal-backdrop="true"]');
    expect(backdrop).not.toBeNull();
    // 스크림이 다이얼로그 자신이면 포커스 격리가 스스로를 가둔다.
    expect(backdrop).not.toBe(dialog);
    expect(backdrop?.parentElement).toBe(dialog.parentElement);
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.getAttribute("tabindex")).toBe("-1");

    // 제목은 패널 안에 있고 aria-labelledby 가 그것을 가리킨다.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy ?? "");
    expect(title?.textContent).toContain("AI 웹툰 생성 슈퍼 스위트");
    expect(dialog.contains(title)).toBe(true);
  });

  it("배경 스크롤을 잠갔다가 닫을 때 원래 값으로 되돌린다", () => {
    document.body.style.overflow = "auto";
    const { rerender } = render(<StudioAiSuperSuiteModal open onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");

    rerender(<StudioAiSuperSuiteModal open={false} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("Escape 와 스크림 클릭으로 닫힌다", () => {
    const onClose = vi.fn();
    render(<StudioAiSuperSuiteModal open onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(document.querySelector('[data-studio-modal-backdrop="true"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("StudioAiSuperSuiteModal — 탭 시맨틱", () => {
  it("5개 도구를 tablist/tab 으로 노출하고 활성 탭만 tabbable 로 둔다", () => {
    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);

    expect(screen.getByRole("tablist", { name: "AI 슈퍼 스위트 도구" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "화풍 변환 툰필터",
      "AI 음영 어시스트",
      "프롬프트 증강기",
      "콘티 자동 디렉터",
      "감정-말풍선 매처",
    ]);

    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.tabIndex).toBe(0);
    expect(tabs.slice(1).every((tab) => tab.tabIndex === -1)).toBe(true);

    const panel = screen.getByRole("tabpanel");
    expect(tabs[0]?.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
  });

  it("방향키로 탭을 옮긴다", () => {
    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);
    const tabs = screen.getAllByRole("tab");

    fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("가상 광원 방향 (Light Direction)")).toBeTruthy();

    fireEvent.keyDown(screen.getAllByRole("tab")[1] as HTMLElement, { key: "End" });
    expect(screen.getAllByRole("tab")[4]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("대사 문장 입력 및 감정 테스트")).toBeTruthy();
  });
});

describe("StudioAiSuperSuiteModal — 선택 상태 저장·복원", () => {
  it("저장된 탭과 파라미터를 되살린다", () => {
    seedPrefs({
      activeTab: "shading-assist",
      styleId: "thriller-noir-grit",
      lightDirection: "backlight-rim",
      ambientLight: "cool-moon",
      genreHint: "horror",
    });

    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);

    expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "☼ 역광/림" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: "달빛 쿨톤" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("카탈로그에 없는 저장 값은 기본값으로 떨어뜨린다", () => {
    seedPrefs({
      activeTab: "retired-tab",
      styleId: "retired-style",
      lightDirection: "retired-direction",
      ambientLight: "retired-temp",
      genreHint: "retired-genre",
    });

    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);

    expect(screen.getAllByRole("tab")[0]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("생성형 AI 최종 합성 프롬프트")).toBeTruthy();
  });

  it("변경을 저장하면서 어시스턴트 창이 쓰는 절반은 건드리지 않는다", () => {
    seedPrefs({
      activeTab: "style-filter",
      styleId: "romance-manhwa",
      lightDirection: "top-left",
      ambientLight: "warm-dawn",
      genreHint: "",
    });

    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "AI 음영 어시스트" }));
    fireEvent.click(screen.getByRole("button", { name: "석양 골든" }));

    const saved = readPrefs();
    expect(saved.aiSuite.activeTab).toBe("shading-assist");
    expect(saved.aiSuite.ambientLight).toBe("sunset-golden");
    // 같은 저장 키의 다른 절반 — 통째로 새로 쓰면 여기가 날아간다.
    expect(saved.assistant.platformId).toBe("kakao-webtoon");
    expect(saved.assistant.croquisIntervalSec).toBe(180);
  });
});

describe("StudioAiSuperSuiteModal — 클립보드", () => {
  it("복사에 실패하면 '복사됨'이 아니라 실패를 알린다", async () => {
    // jsdom 에는 navigator.clipboard 도 document.execCommand 도 없다 = 두 경로 모두 실패.
    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "포지티브 프롬프트 복사" }));
    await flush();

    expect(screen.getByText("복사 실패")).toBeTruthy();
    expect(screen.queryByText("복사됨")).toBeNull();
  });

  it("실제로 복사됐을 때만 '복사됨'을 띄운다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "네거티브 프롬프트 복사" }));
    await flush();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.[0])).toContain("bad anatomy");
    expect(screen.getByText("복사됨")).toBeTruthy();
    expect(screen.queryByText("복사 실패")).toBeNull();
  });
});

describe("StudioAiSuperSuiteModal — 입력 검증", () => {
  it("장면 아이디어가 비면 빈 프롬프트 대신 입력을 요구한다", () => {
    const onApplyPrompt = vi.fn();
    render(<StudioAiSuperSuiteModal open onClose={() => {}} onApplyPrompt={onApplyPrompt} />);

    expect(
      screen.getByRole("button", { name: "포지티브 프롬프트만 배경/캐릭터 생성기로 전송" })
    ).toBeTruthy();

    const concept = screen.getByLabelText("원하는 장면 아이디어 입력:");
    fireEvent.change(concept, { target: { value: "" } });

    expect(concept.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/장면 아이디어를 2자 이상/u)).toBeTruthy();
    expect(screen.getByText("입력이 더 필요해요")).toBeTruthy();
    expect(screen.queryByText("생성형 AI 최종 합성 프롬프트")).toBeNull();
    expect(screen.queryByRole("button", { name: "포지티브 프롬프트 복사" })).toBeNull();
    expect(onApplyPrompt).not.toHaveBeenCalled();
  });

  it("대본이 비면 0컷 표를 그리지 않는다", () => {
    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "콘티 자동 디렉터" }));

    expect(screen.getByText(/자동 생성된 컷별 콘티/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("대본 / 시나리오 줄글 입력"), {
      target: { value: "   \n  " },
    });

    expect(screen.queryByText(/자동 생성된 컷별 콘티/u)).toBeNull();
    expect(screen.getByText("입력이 더 필요해요")).toBeTruthy();
  });
});

describe("StudioAiSuperSuiteModal — 색·토큰", () => {
  it("림라이트가 꺼져 있으면 흰색을 지어내지 않는다", () => {
    render(<StudioAiSuperSuiteModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "AI 음영 어시스트" }));

    fireEvent.click(screen.getByLabelText("외곽선 림라이트 (Rim Light) 강조 활성화"));

    const rimCell = screen.getByText("림라이트 컬러").parentElement as HTMLElement;
    expect(rimCell.textContent).toContain("없음");
    expect(rimCell.querySelector("div.border-dashed")).not.toBeNull();
    expect(rimCell.querySelector('div[style*="background-color"]')).toBeNull();
  });

  it("생 팔레트 색과 하드코딩 hex 를 쓰지 않는다", () => {
    expect(modalSource).not.toMatch(
      /\b(?:emerald|rose|amber|sky|indigo|violet|zinc|neutral|stone|gray|grey|slate|red|green|blue|yellow|teal|cyan|lime|orange|fuchsia|pink|purple)-\d{2,3}\b/u
    );
    expect(modalSource).not.toContain("#ffffff");
    expect(modalSource).not.toContain("bg-black");
    expect(modalSource).not.toContain("text-white");
  });

  it("공용 모달 계약·프리미티브를 그대로 쓴다", () => {
    expect(modalSource).toContain('import { useStudioModalSheet } from "../useStudioModalSheet";');
    expect(modalSource).toContain("useStudioModalSheet({");
    expect(modalSource).toContain('data-studio-modal-backdrop="true"');
    expect(modalSource).toContain("createPortal(content, document.body)");
    expect(modalSource).toContain("StudioWorkbenchTabStrip");
    expect(modalSource).toContain("studioWorkbenchTabPanelProps(idPrefix, activeTab)");
    // 클립보드는 반드시 공용 훅을 지난다 — 직접 호출은 성공 여부도, 타이머 정리도 못 한다.
    expect(modalSource).toContain(
      'import { useStudioCopyFeedback } from "../use-studio-copy-feedback";'
    );
    expect(modalSource).not.toContain("navigator.clipboard");
    expect(modalSource).not.toContain("setTimeout(");
    // dvh 사이징. vh 기반 높이는 모바일 주소창에서 잘린다.
    expect(modalSource).toContain("max-h-[100dvh]");
    expect(modalSource).toContain("sm:max-h-[calc(100dvh-2rem)]");
    expect(modalSource).not.toContain("h-[88vh]");
    expect(modalSource).toContain("overscroll-contain");
    // 두께·오프셋 없는 맨 outline 대신 공용 포커스 링.
    expect(modalSource).not.toContain("focus-visible:outline-accent");
    expect(modalSource).toContain("STUDIO_FOCUS_RING");
    expect(modalSource).toContain("STUDIO_TOUCH_TARGET");
  });

  it("animate-* 는 언제나 motion-reduce 짝을 데리고 다닌다", () => {
    const animated = modalSource.match(/animate-(?!none)[\w-]+/gu) ?? [];
    expect(animated.length).toBeGreaterThan(0);
    for (const match of modalSource.matchAll(/className="([^"]*animate-(?!none)[^"]*)"/gu)) {
      expect(match[1]).toContain("motion-reduce:animate-none");
    }
    expect(modalSource).toContain("animate-pulse text-accent motion-reduce:animate-none");
  });
});
