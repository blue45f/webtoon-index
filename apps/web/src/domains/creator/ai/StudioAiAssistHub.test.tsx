// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAiAssistHub } from "./StudioAiAssistHub";

import type { StudioAiAssistHubProps } from "./StudioAiAssistHub";

const animationFrames: FrameRequestCallback[] = [];

function createProps(
  overrides: Partial<StudioAiAssistHubProps> = {}
): StudioAiAssistHubProps {
  return {
    activeTool: "background",
    connectionLabel: "연결됨",
    connectionOk: true,
    imageConfigured: true,
    onApplyPresetPrompt: vi.fn(),
    onOpenSettings: vi.fn(),
    onToolChange: vi.fn(),
    recentState: { version: 1, entries: [] },
    textConfigured: true,
    toolPanel: <input aria-label="활성 AI 도구 입력" />,
    ...overrides,
  };
}

function installScrollSpy(container: HTMLElement) {
  const panel = container.querySelector<HTMLElement>(
    "[data-studio-ai-assist-tool-panel]"
  );
  expect(panel).not.toBeNull();
  const scrollIntoView = vi.fn();
  Object.defineProperty(panel, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  return scrollIntoView;
}

beforeEach(() => {
  animationFrames.length = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("StudioAiAssistHub production entry points", () => {
  it("exposes the episode workflow and the advanced suite as real touch targets", () => {
    const onOpenEpisodeProduction = vi.fn();
    const onPreloadEpisodeProduction = vi.fn();
    const onOpenSuperSuite = vi.fn();
    const onPreloadSuperSuite = vi.fn();
    const view = render(
      <StudioAiAssistHub
        {...createProps({
          onOpenEpisodeProduction,
          onPreloadEpisodeProduction,
          onOpenSuperSuite,
          onPreloadSuperSuite,
        })}
      />
    );

    const production = screen.getByRole("button", { name: /회차 AI 프로덕션/ });
    // The inline "AI 웹툰 생성 슈퍼 스위트" button was replaced by
    // StudioAiProductionLaunchpad, a task-first launcher that presents the same
    // super-suite flow as a card. Both entry points and their chunk preloading
    // must still work, which is what this test actually guards.
    const suite = screen.getByRole("button", { name: /화풍·연출 레시피 만들기/ });

    expect(production.className).toContain("min-h-16");
    expect(
      view.container.querySelector('[data-studio-ai-production-launchpad="true"]')
    ).not.toBeNull();

    fireEvent.mouseEnter(production);
    fireEvent.pointerDown(production);
    fireEvent.focus(suite);
    fireEvent.click(production);
    fireEvent.click(suite);

    expect(onPreloadEpisodeProduction).toHaveBeenCalledTimes(2);
    expect(onPreloadSuperSuite).toHaveBeenCalledTimes(1);
    expect(onOpenEpisodeProduction).toHaveBeenCalledTimes(1);
    expect(onOpenSuperSuite).toHaveBeenCalledTimes(1);
  });
});

describe("StudioAiAssistHub prompt reveal", () => {
  it("applies a preset and scrolls its own tool panel after the next frame", () => {
    const props = createProps();
    const view = render(<StudioAiAssistHub {...props} />);
    const scrollIntoView = installScrollSpy(view.container);

    fireEvent.click(screen.getByRole("button", { name: "교실·낮" }));

    expect(props.onApplyPresetPrompt).toHaveBeenCalledWith(
      "background",
      expect.stringContaining("한국 고등학교 교실")
    );
    expect(animationFrames).toHaveLength(1);
    expect(scrollIntoView).not.toHaveBeenCalled();

    animationFrames[0]?.(0);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
  });

  it("uses the same owned-panel reveal path for a recent prompt", () => {
    const prompt = "비 오는 밤의 옥상";
    const props = createProps({
      recentState: {
        version: 1,
        entries: [{ tool: "background", prompt, at: 1 }],
      },
    });
    const view = render(<StudioAiAssistHub {...props} />);
    const scrollIntoView = installScrollSpy(view.container);

    fireEvent.click(screen.getByRole("button", { name: prompt }));

    expect(props.onApplyPresetPrompt).toHaveBeenCalledWith("background", prompt);
    expect(animationFrames).toHaveLength(1);
    animationFrames[0]?.(0);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
  });
});

describe("StudioAiAssistHub execution preflight", () => {
  it("places a compact, reduced-motion disclosure before the active tool panel", () => {
    const view = render(<StudioAiAssistHub {...createProps()} />);
    const preflight = view.container.querySelector<HTMLElement>(
      "[data-studio-ai-execution-preflight]"
    );
    const panel = view.container.querySelector<HTMLElement>(
      "[data-studio-ai-assist-tool-panel]"
    );
    const summary = preflight?.querySelector("summary");

    expect(preflight).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(preflight?.dataset.executionReady).toBe("true");
    expect(summary?.className).toContain("min-h-11");
    expect(
      preflight?.querySelector('[class*="motion-reduce:transition-none"]')
    ).not.toBeNull();
    expect(preflight?.textContent).toContain("실행 전 확인");
    expect(preflight?.textContent).toContain("제공자 과금 가능");
    expect(
      preflight!.compareDocumentPosition(panel!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(summary!);

    expect(preflight?.hasAttribute("open")).toBe(true);
    expect(preflight?.textContent).toContain("처리 경로");
    expect(preflight?.textContent).toContain("배경 이미지 1개");
    expect(preflight?.textContent).toContain("원본 캔버스를 덮어쓰지 않고");
  });

  it("labels a server text route as server quota", () => {
    const view = render(
      <StudioAiAssistHub
        {...createProps({
          activeTool: "composition",
          connectionLabel: "DeepSeek 연결됨",
          imageConfigured: false,
          textConfigured: true,
        })}
      />
    );
    const preflight = view.container.querySelector<HTMLElement>(
      "[data-studio-ai-execution-preflight]"
    );

    expect(preflight?.dataset.executionReady).toBe("true");
    expect(preflight?.textContent).toContain("서버 쿼터");
    expect(preflight?.textContent).toContain("구도 제안 1세트");
  });

  it("keeps the relevant missing-provider reason visible without opening details", () => {
    const view = render(
      <StudioAiAssistHub
        {...createProps({
          activeTool: "background",
          connectionLabel: "Z.ai 연결됨",
          connectionOk: true,
          imageConfigured: false,
          textConfigured: true,
        })}
      />
    );
    const preflight = view.container.querySelector<HTMLElement>(
      "[data-studio-ai-execution-preflight]"
    );

    expect(preflight?.dataset.executionReady).toBe("false");
    expect(screen.getByRole("alert").textContent).toContain(
      "이미지 API가 연결되지 않아"
    );
    expect(preflight?.textContent).toContain("실행 불가");
  });
});
