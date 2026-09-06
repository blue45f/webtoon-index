// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_WORKBENCH_PREFS_STORAGE_KEY,
  defaultStudioWorkbenchPrefs,
} from "../studio-workbench-prefs";

import { StudioWebtoonAssistantModal } from "./StudioWebtoonAssistantModal";
import { WebtoonCroquisPoseGuide } from "./webtoon-croquis-pose-guide";
import { WEBTOON_PLATFORM_SPECS } from "./webtoon-platform-spec-validator";

const PREFIX = "studio-webtoon-assistant";

function seedPrefs(patch: {
  assistant?: Partial<ReturnType<typeof defaultStudioWorkbenchPrefs>["assistant"]>;
  aiSuite?: Partial<ReturnType<typeof defaultStudioWorkbenchPrefs>["aiSuite"]>;
}): string {
  const base = defaultStudioWorkbenchPrefs();
  const raw = JSON.stringify({
    assistant: { ...base.assistant, ...patch.assistant },
    aiSuite: { ...base.aiSuite, ...patch.aiSuite },
  });
  globalThis.localStorage.setItem(STUDIO_WORKBENCH_PREFS_STORAGE_KEY, raw);
  return raw;
}

function readPrefs() {
  const raw = globalThis.localStorage.getItem(STUDIO_WORKBENCH_PREFS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ReturnType<typeof defaultStudioWorkbenchPrefs>) : null;
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("StudioWebtoonAssistantModal — shell", () => {
  it("renders nothing when open is false", () => {
    render(<StudioWebtoonAssistantModal open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("studio-webtoon-assistant-modal")).toBeNull();
  });

  it("portals a modal dialog with the repo modal contract when open", () => {
    render(
      <StudioWebtoonAssistantModal
        open
        onClose={() => {}}
        canvasWidth={690}
        canvasHeight={15000}
      />,
    );

    const dialog = screen.getByTestId("studio-webtoon-assistant-modal");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(`${PREFIX}-title`);
    // 스크림은 다이얼로그의 형제여야 한다 — 다이얼로그 자신이 스크림이면 안 된다.
    const backdrop = document.querySelector("[data-studio-modal-backdrop='true']");
    expect(backdrop).not.toBeNull();
    expect(backdrop?.parentElement).toBe(dialog.parentElement);
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    // 높이는 dvh 규범을 따른다(vh 기반 금지).
    expect(dialog.className).toContain("max-h-[100dvh]");
    expect(dialog.className.replace(/dvh/g, "")).not.toContain("vh");
    // 배경 스크롤 잠금.
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("keeps the whole canvas content and 6 feature tabs reachable", () => {
    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);

    expect(screen.getByText(/웹툰 창작 보조 센터/)).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "플랫폼 규격 & 슬라이서",
      "스크롤 페이싱 시뮬레이터",
      "효과음·의성어 사전",
      "피부/그림자 컬러 조화",
      "마감 & 포커스플로우",
      "인체 크로키 & 구도 가이드",
    ]);
    // 플랫폼 라벨은 스펙 모듈이 단일 출처다 — 여기서 문자열을 다시 적지 않는다.
    for (const spec of Object.values(WEBTOON_PLATFORM_SPECS)) {
      expect(screen.getByText(spec.name)).toBeTruthy();
    }
    expect(screen.getByText(/ToonSlicer 컷 안전 분할 계획/)).toBeTruthy();
  });

  it("closes on Escape and on a scrim click", () => {
    const onClose = vi.fn();
    const { rerender } = render(<StudioWebtoonAssistantModal open onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId("studio-webtoon-assistant-modal"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<StudioWebtoonAssistantModal open onClose={onClose} />);
    fireEvent.click(document.querySelector("[data-studio-modal-backdrop='true']")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("restores background scroll when it closes", () => {
    const { rerender } = render(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<StudioWebtoonAssistantModal open={false} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("uses only themed status tokens — no raw palette or OS-bound dark: variants", () => {
    // 원색 팔레트는 라이트·고대비 테마에서 따라오지 않고, `dark:` 는 이 저장소에서
    // OS 설정(prefers-color-scheme)에 걸린다 — 앱 테마는 :root[data-theme] 로 바뀐다.
    const rawPalette =
      /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|shadow)-(?:emerald|amber|rose|slate|zinc|gray|neutral|stone|sky|indigo|red|green|yellow|blue|violet)-\d/;
    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);

    // 여섯 탭을 모두 렌더해 본다 — 비활성 탭의 마크업은 검사 범위 밖으로 새기 쉽다.
    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      const markup = screen.getByTestId("studio-webtoon-assistant-modal").outerHTML;
      expect(markup).not.toMatch(rawPalette);
      expect(markup).not.toContain("dark:");
    }
  });
});

describe("StudioWebtoonAssistantModal — tab accessibility", () => {
  it("wires every tab to the single tab panel", () => {
    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);

    const tabs = screen.getAllByRole("tab");
    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(`${PREFIX}-tab-spec-slicer`);

    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe(`${PREFIX}-panel-spec-slicer`);
    expect(panel.getAttribute("aria-labelledby")).toBe(`${PREFIX}-tab-spec-slicer`);
    expect(selected[0].getAttribute("aria-controls")).toBe(panel.id);

    // roving tabIndex: 선택된 탭만 tabbable.
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
      "-1",
      "-1",
      "-1",
    ]);
  });

  it("moves selection with ArrowRight and swaps the rendered panel", () => {
    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);

    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowRight" });

    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe(`${PREFIX}-panel-scroll-pacing`);
    expect(screen.getByText("페이싱 건강도 점수")).toBeTruthy();
  });

  it("labels fixture-derived analyses as sample data", () => {
    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    expect(screen.getByText(/샘플 보호 영역 3곳 기준 예시/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getByText(/샘플 컷 5개 기준 예시/)).toBeTruthy();
  });
});

describe("StudioWebtoonAssistantModal — SFX search", () => {
  it("teaches the empty state instead of rendering a blank grid", () => {
    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("tab")[2]);

    expect(screen.getByText(/검색 결과 \d+건/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("효과음 검색"), {
      target: { value: "존재하지않는효과음xyz" },
    });

    expect(screen.getByText("검색 결과가 없습니다")).toBeTruthy();
    expect(screen.getByText("검색 결과 0건")).toBeTruthy();
  });

  it("shows a real failure state when the clipboard is blocked", async () => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("tab")[2]);
    fireEvent.click(screen.getAllByText("텍스트 복사")[0]);

    expect(await screen.findByText("복사 실패")).toBeTruthy();
    expect(screen.queryByText("복사됨")).toBeNull();
  });

  it("shows 복사됨 only after the write actually resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("tab")[2]);
    fireEvent.click(screen.getAllByText("텍스트 복사")[0]);

    expect(await screen.findByText("복사됨")).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe("StudioWebtoonAssistantModal — croquis metronome", () => {
  it("advances the pose exactly once per interval under StrictMode", () => {
    vi.useFakeTimers();
    const advance = vi.spyOn(WebtoonCroquisPoseGuide.prototype, "getRandomPose");

    render(
      <StrictMode>
        <StudioWebtoonAssistantModal open onClose={() => {}} />
      </StrictMode>,
    );
    fireEvent.click(screen.getAllByRole("tab")[5]);
    fireEvent.click(screen.getByText("시작"));

    const baseline = advance.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // 업데이터가 순수하지 않으면 StrictMode 이중 호출로 두 번 넘어간다.
    expect(advance.mock.calls.length - baseline).toBe(1);
    expect(screen.getByText("60s")).toBeTruthy();
  });

  it("stops ticking while the modal is closed", () => {
    vi.useFakeTimers();
    const advance = vi.spyOn(WebtoonCroquisPoseGuide.prototype, "getRandomPose");

    const { rerender } = render(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("tab")[5]);
    fireEvent.click(screen.getByText("시작"));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("55s")).toBeTruthy();

    rerender(<StudioWebtoonAssistantModal open={false} onClose={() => {}} />);
    const baseline = advance.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    expect(advance.mock.calls.length).toBe(baseline);

    rerender(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("tab")[5]);
    expect(screen.getByText("55s")).toBeTruthy();
  });
});

describe("StudioWebtoonAssistantModal — preference round-trip", () => {
  it("restores the stored tab, platform and croquis interval on mount", () => {
    seedPrefs({
      assistant: {
        activeTab: "croquis-pose",
        platformId: "lezhin-comics",
        croquisIntervalSec: 180,
      },
    });

    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);

    const selected = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected?.id).toBe(`${PREFIX}-tab-croquis-pose`);
    expect(screen.getByText("180s")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("tab")[0]);
    const lezhinName = WEBTOON_PLATFORM_SPECS["lezhin-comics"].name;
    const lezhinButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.startsWith(lezhinName));
    expect(lezhinButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to defaults for a retired stored id", () => {
    seedPrefs({ assistant: { activeTab: "tab-that-no-longer-exists" } });
    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);

    const selected = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected?.id).toBe(`${PREFIX}-tab-spec-slicer`);
  });

  it("persists a tab change without clobbering the sibling aiSuite section", async () => {
    seedPrefs({ aiSuite: { styleId: "sibling-owned-style" } });

    render(<StudioWebtoonAssistantModal open onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("tab")[4]);

    await waitFor(() => {
      expect(readPrefs()?.assistant.activeTab).toBe("focus-timer");
    });
    expect(readPrefs()?.aiSuite.styleId).toBe("sibling-owned-style");
  });

  it("never writes while the modal is closed", () => {
    const seeded = seedPrefs({ assistant: { activeTab: "sfx-lexicon" } });
    render(<StudioWebtoonAssistantModal open={false} onClose={() => {}} />);
    expect(globalThis.localStorage.getItem(STUDIO_WORKBENCH_PREFS_STORAGE_KEY)).toBe(seeded);
  });
});
