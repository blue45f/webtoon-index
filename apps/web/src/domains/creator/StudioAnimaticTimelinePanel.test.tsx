// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  studioAnimaticStorageKey,
  type StudioAnimaticDocument,
  type StudioAnimaticPageLike,
  type StudioAnimaticStorage,
} from "./studio-animatic-timeline";
import { StudioAnimaticTimelinePanel } from "./StudioAnimaticTimelinePanel";

const PAGES: StudioAnimaticPageLike[] = [
  {
    id: "page-1",
    name: "도입",
    canvasH: 1_200,
    elements: [
      {
        id: "frame-1",
        type: "frame",
        x: 20,
        y: 20,
        width: 680,
        height: 500,
      },
      {
        id: "dialogue-1",
        type: "bubble",
        x: 80,
        y: 100,
        width: 220,
        height: 90,
        text: "여기서 시작하자.",
        speaker: "하나",
      },
      {
        id: "frame-2",
        type: "frame",
        x: 20,
        y: 600,
        width: 680,
        height: 500,
      },
      {
        id: "sfx-1",
        type: "text",
        x: 100,
        y: 720,
        width: 160,
        height: 80,
        name: "SFX",
        text: "쾅!",
      },
    ],
  },
  {
    id: "page-2",
    name: "마무리",
    canvasH: 900,
    elements: [],
  },
];

class MemoryStorage implements StudioAnimaticStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StudioAnimaticTimelinePanel local commercial workflow", () => {
  it("uses the async SQLite authority by default instead of reading localStorage", async () => {
    const persistence = {
      load: vi.fn(async () => ({ document: null, status: "empty" as const })),
      save: vi.fn(async (_document: StudioAnimaticDocument) => ({ ok: true })),
    };
    const { container } = render(
      <StudioAnimaticTimelinePanel
        workScope="episode-sqlite"
        pages={PAGES}
        persistence={persistence}
      />
    );

    await waitFor(() => expect(persistence.load).toHaveBeenCalledWith("episode-sqlite"));
    expect(
      container.querySelector('[data-studio-animatic-authority="sqlite"]')
    ).toBeTruthy();
    expect(screen.getByText("로컬 SQL 무음 미리보기")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "애니매틱 반복 재생" }));
    await waitFor(() => expect(persistence.save).toHaveBeenCalledOnce());
    expect(persistence.save.mock.calls[0]?.[0]).toMatchObject({
      workScope: "episode-sqlite",
      loop: true,
    });
  });

  it("serializes rapid SQLite writes so an older completion cannot overwrite a newer edit", async () => {
    const releases: Array<() => void> = [];
    const persistence = {
      load: vi.fn(async () => ({ document: null, status: "empty" as const })),
      save: vi.fn((_document: StudioAnimaticDocument) => new Promise<{ ok: true }>((resolve) => {
        releases.push(() => resolve({ ok: true }));
      })),
    };
    render(
      <StudioAnimaticTimelinePanel
        workScope="episode-write-order"
        pages={PAGES}
        persistence={persistence}
      />
    );
    await waitFor(() => expect(persistence.load).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "애니매틱 반복 재생" }));
    fireEvent.change(screen.getByLabelText("미리보기 FPS"), { target: { value: "24" } });

    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(1));
    expect(persistence.save.mock.calls[0]?.[0]).toMatchObject({ loop: true, fps: 12 });
    releases.shift()?.();
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(2));
    expect(persistence.save.mock.calls[1]?.[0]).toMatchObject({ loop: true, fps: 24 });
    releases.shift()?.();
    await waitFor(() => expect(screen.getByText("미리보기 FPS를 변경했습니다.")).toBeTruthy());
  });

  it("exposes a zero-server silent workflow and a mobile horizontal timeline", () => {
    const { container } = render(
      <StudioAnimaticTimelinePanel
        workScope="episode-panel"
        pages={PAGES}
        storage={null}
      />
    );

    const panel = screen.getByRole("region", {
      name: "웹툰 애니매틱 타임라인",
    });
    expect(panel.getAttribute("data-studio-animatic")).toBe("local-only");
    expect(screen.getByText("현재 탭의 무음 미리보기")).toBeTruthy();
    expect(
      screen.getByText(/음성통화·서버 스트리밍·AI 요청 없이/u)
    ).toBeTruthy();
    expect(screen.getByText("JSON 가져오기")).toBeTruthy();
    expect(screen.getByText("JSON 내보내기")).toBeTruthy();

    const timeline = container.querySelector(
      '[data-studio-animatic-horizontal-timeline="true"]'
    );
    expect(timeline).toBeTruthy();
    expect(timeline?.className).toContain("overflow-x-auto");
    expect(timeline?.className).toContain("touch-pan-x");
    expect(timeline?.className).toContain("snap-mandatory");
  });

  it("keeps every interactive control at least 44 CSS pixels high", () => {
    const { container } = render(
      <StudioAnimaticTimelinePanel
        workScope="episode-touch"
        pages={PAGES}
        storage={null}
        onClose={vi.fn()}
      />
    );

    for (const button of container.querySelectorAll("button")) {
      expect(button.className).toMatch(/(?:size-11|min-h-11|min-h-\[5\.5rem\])/u);
    }
    for (const control of container.querySelectorAll(
      'input:not([type="file"]), select'
    )) {
      expect(control.className).toMatch(/(?:h-11|min-h-11)/u);
    }
    const fileLabel = screen.getByText("JSON 가져오기").closest("label");
    expect(fileLabel?.className).toContain("min-h-11");
  });

  it("uses familiar play, scrub, select and explicit loop controls", () => {
    const storage = new MemoryStorage();
    const onDocumentChange = vi.fn();
    const onPreviewSample = vi.fn();
    render(
      <StudioAnimaticTimelinePanel
        workScope="episode-controls"
        pages={PAGES}
        storage={storage}
        onDocumentChange={onDocumentChange}
        onPreviewSample={onPreviewSample}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "애니매틱 재생" })
    );
    expect(
      screen.getByRole("button", { name: "애니매틱 일시 정지" })
    ).toBeTruthy();

    const loop = screen.getByRole("button", {
      name: "애니매틱 반복 재생",
    });
    expect(loop.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(loop);
    expect(loop.getAttribute("aria-pressed")).toBe("true");
    expect(onDocumentChange).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("애니매틱 재생헤드"), {
      target: { value: "2600" },
    });
    expect(
      onPreviewSample.mock.calls.at(-1)?.[0]
    ).toMatchObject({ segmentIndex: 1 });

    fireEvent.click(
      screen.getByRole("button", {
        name: "도입 · 2컷 선택하고 스크럽",
      })
    );
    expect(
      screen
        .getByRole("button", {
          name: "도입 · 2컷 선택하고 스크럽",
        })
        .getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("edits timing, transition, camera and dialogue/SFX cue metadata locally", () => {
    const storage = new MemoryStorage();
    const onDocumentChange = vi.fn<
      (document: StudioAnimaticDocument) => void
    >();
    render(
      <StudioAnimaticTimelinePanel
        workScope="episode-edit"
        pages={PAGES}
        storage={storage}
        onDocumentChange={onDocumentChange}
      />
    );

    fireEvent.change(screen.getByLabelText("선택 컷 hold 밀리초"), {
      target: { value: "3000" },
    });
    expect(onDocumentChange.mock.calls.at(-1)?.[0].segments[0].holdMs).toBe(
      3_000
    );

    fireEvent.change(screen.getByLabelText("선택 컷 전환"), {
      target: { value: "pan" },
    });
    expect(
      onDocumentChange.mock.calls.at(-1)?.[0].segments[0].transition
    ).toEqual({ kind: "pan", durationMs: 400 });

    fireEvent.change(screen.getByLabelText("끝 카메라 Zoom (×)"), {
      target: { value: "1.5" },
    });
    expect(
      onDocumentChange.mock.calls.at(-1)?.[0].segments[0]
        .cameraKeyframes.at(-1)?.zoom
    ).toBe(1.5);

    fireEvent.click(screen.getByRole("button", { name: "대사 cue 추가" }));
    const newCueText = screen.getByDisplayValue("새 대사 cue");
    fireEvent.change(newCueText, { target: { value: "카메라 들어와." } });
    const newSpeaker = screen.getAllByPlaceholderText("화자 (선택)").at(-1);
    expect(newSpeaker).toBeTruthy();
    fireEvent.change(newSpeaker!, { target: { value: "감독" } });

    const saved = storage.getItem(studioAnimaticStorageKey("episode-edit"));
    expect(saved).toBeTruthy();
    const savedDocument = JSON.parse(saved!) as StudioAnimaticDocument;
    expect(
      savedDocument.segments[0]?.cues.find(
        (cue) => cue.text === "카메라 들어와."
      )
    ).toMatchObject({
      kind: "dialogue",
      text: "카메라 들어와.",
      speaker: "감독",
    });
    expect(saved).not.toMatch(/audio|voice|streamUrl/u);
  });

  it("turns off autoplay and animated interpolation for reduced motion", () => {
    const onPreviewSample = vi.fn();
    const { container } = render(
      <StudioAnimaticTimelinePanel
        workScope="episode-reduced"
        pages={PAGES}
        storage={null}
        reducedMotion
        onPreviewSample={onPreviewSample}
      />
    );

    expect(
      screen.getByRole("button", { name: "애니매틱 재생" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "자동 재생·전환·카메라 보간을 끕니다"
    );
    expect(
      container
        .querySelector('[data-studio-animatic-preview="cuts"]')
        ?.getAttribute("data-reduced-motion")
    ).toBe("true");
    expect(onPreviewSample.mock.calls.at(-1)?.[0]).toMatchObject({
      reducedMotion: true,
      transitionKind: "cut",
      transitionProgress: 1,
    });
  });

  it("accepts a host-owned cut renderer without coupling to StudioPage", () => {
    const renderPreview = vi.fn(
      (_sample, segment) => (
        <div data-testid="host-cut-preview">{segment.cutId ?? segment.pageId}</div>
      )
    );
    render(
      <StudioAnimaticTimelinePanel
        workScope="episode-renderer"
        pages={PAGES}
        storage={null}
        renderPreview={renderPreview}
      />
    );

    expect(screen.getByTestId("host-cut-preview").textContent).toBe("frame-1");
    expect(renderPreview).toHaveBeenCalled();
  });
});
