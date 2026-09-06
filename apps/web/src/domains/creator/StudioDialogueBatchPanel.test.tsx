// @vitest-environment jsdom
// Static markup keeps the progressive-enhancement contract compact, while the DOM tests below
// lock down the continuous keyboard-editing workflow and IME boundary.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioDialogueBatchPanel,
  type StudioDialogueBatchPanelProps,
} from "./StudioDialogueBatchPanel";

import type { DialogueSpeechAdapter, DialogueSpeechVoice } from "./lettering/studio-dialogue-read-aloud";

const noop = () => {
  // Static render never invokes event handlers.
};

const PAGES: StudioDialogueBatchPanelProps["pages"] = [
  {
    id: "page-1",
    elements: [
      { id: "bubble-1", type: "bubble", variant: "speech", text: "첫 번째 대사" },
      { id: "text-1", type: "text", text: "두 번째 대사" },
    ],
  },
];

function speechAdapter(supported: boolean): DialogueSpeechAdapter {
  const voices: DialogueSpeechVoice[] = [
    {
      name: "한국어 시스템 음성",
      lang: "ko-KR",
      voiceURI: "test-ko",
      default: true,
      localService: true,
    },
  ];
  return {
    supported,
    getVoices: () => (supported ? voices : []),
    speak: () => supported,
    cancel: () => supported,
    pause: () => supported,
    resume: () => supported,
  };
}

function onlineOnlySpeechAdapter(): DialogueSpeechAdapter {
  return {
    supported: true,
    getVoices: () => [
      {
        name: "온라인 한국어",
        lang: "ko-KR",
        voiceURI: "remote-ko",
        localService: false,
      },
      {
        name: "출처 불명 음성",
        lang: "en-US",
        voiceURI: "unknown-en",
      },
    ],
    speak: () => true,
    cancel: () => true,
    pause: () => true,
    resume: () => true,
  };
}

function renderPanel(
  readAloudAdapter: DialogueSpeechAdapter,
  overrides: Partial<StudioDialogueBatchPanelProps> = {}
): string {
  return renderToStaticMarkup(
    <StudioDialogueBatchPanel
      pages={PAGES}
      currentPageId="page-1"
      selectedId={null}
      onClose={noop}
      onSelectElement={noop}
      onPatchText={noop}
      onApplyReplace={noop}
      readAloudAdapter={readAloudAdapter}
      {...overrides}
    />
  );
}

function hasNestedButton(html: string): boolean {
  const tags = html.match(/<\/?button\b[^>]*>/g) ?? [];
  let depth = 0;
  for (const tag of tags) {
    if (tag.startsWith("</")) depth -= 1;
    else {
      depth += 1;
      if (depth > 1) return true;
    }
  }
  return false;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioDialogueBatchPanel read-aloud progressive enhancement", () => {
  it("keeps dialogue editing available with a clear unsupported-browser message", () => {
    const html = renderPanel(speechAdapter(false));

    expect(html).toContain("대사 낭독 검수");
    expect(html).toContain("이 브라우저는 음성 낭독을 지원하지 않아요.");
    expect(html).toContain("대사 편집은 그대로 사용할 수 있습니다.");
    expect(html).toContain('data-studio-shortcut-boundary="true"');
    expect(html).toContain('aria-label="1페이지 말풍선·말하기 대사 수정"');
    expect(html).not.toContain('aria-label="검색된 대사 전체 낭독"');
    expect(html).not.toContain("대사만 낭독하고 캔버스에서 선택");
  });

  it("renders supported queue controls, voice/rate choices, progress semantics, and 44px targets", () => {
    const html = renderPanel(speechAdapter(true));

    expect(html).toContain('aria-label="검색된 대사 전체 낭독"');
    expect(html).toContain('aria-label="대사 낭독 일시 정지"');
    expect(html).toContain('aria-label="대사 낭독 중지"');
    expect(html).toContain('aria-label="대사 낭독 속도"');
    expect(html).toContain('aria-label="대사 낭독 시스템 음성"');
    expect(html).toContain("속도 1.0×");
    expect(html).toContain("한국어 시스템 음성 · ko-KR");
    expect(html).toContain("기기 내");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-pressed="false"');
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(15);
    expect(html).toContain("검수할 대사 2개");
  });

  it("blocks remote or unknown voices until the author explicitly accepts the OS-service boundary", () => {
    const html = renderPanel(onlineOnlySpeechAdapter());
    const playLabelIndex = html.indexOf('aria-label="검색된 대사 전체 낭독"');
    const playTag = html.slice(html.lastIndexOf("<button", playLabelIndex), html.indexOf(">", playLabelIndex));
    const voiceLabelIndex = html.indexOf('aria-label="대사 낭독 시스템 음성"');
    const voiceTag = html.slice(html.lastIndexOf("<select", voiceLabelIndex), html.indexOf(">", voiceLabelIndex));

    expect(html).toContain('aria-label="온라인 시스템 음성 허용"');
    expect(html).toContain("대사가 운영체제·브라우저의 음성 서비스로 전송될 수 있어요.");
    expect(html).toContain("ToonSpectrum 서버와 AI에는 보내지 않습니다.");
    expect(playTag).toContain('disabled=""');
    expect(voiceTag).toContain('disabled=""');
    expect(html).toContain("기기 내 음성 없음");
    expect(html).not.toContain("온라인 한국어 · ko-KR · 온라인 가능");
  });

  it("keeps each row speaker and canvas-selection action as separate sibling buttons", () => {
    const html = renderPanel(speechAdapter(true));
    const speakerLabel =
      'aria-label="1페이지 말풍선·말하기 대사만 낭독하고 캔버스에서 선택"';
    const selectLabel =
      'aria-label="1페이지 말풍선·말하기 &quot;첫 번째 대사&quot; 선택하고 대사 편집"';
    const speakerStart = html.indexOf(speakerLabel);
    const speakerEnd = html.indexOf("</button>", speakerStart);
    const speakerMarkup = html.slice(speakerStart, speakerEnd);

    expect(speakerStart).toBeGreaterThan(-1);
    expect(html).toContain(selectLabel);
    expect(speakerMarkup).toContain("lucide-volume-2");
    expect(speakerMarkup).not.toContain("대사 수정");
    expect(hasNestedButton(html)).toBe(false);
    expect(html.match(/<button\b/g)?.length).toBe(html.match(/<\/button>/g)?.length);
  });

  it("tracks the mobile keyboard inset without allowing negative or fractional layout values", () => {
    expect(renderPanel(speechAdapter(true), { mobileKeyboardInset: 181.6 })).toContain(
      "--studio-mobile-keyboard-inset:182px"
    );
    expect(renderPanel(speechAdapter(true), { mobileKeyboardInset: -20 })).toContain(
      "--studio-mobile-keyboard-inset:0px"
    );
  });
});

describe("StudioDialogueBatchPanel continuous dialogue editing", () => {
  const WORKFLOW_PAGES: StudioDialogueBatchPanelProps["pages"] = [
    {
      id: "page-1",
      elements: [
        { id: "bubble-3", type: "bubble", variant: "speech", text: "세 번째", x: 20, y: 220 },
        {
          id: "bubble-2",
          type: "bubble",
          variant: "thought",
          text: "잠긴 두 번째",
          x: 20,
          y: 120,
          locked: true,
        },
        { id: "bubble-1", type: "bubble", variant: "speech", text: "첫 번째", x: 20, y: 20 },
      ],
    },
  ];

  function renderWorkflow(selectedId: string | null = "bubble-1") {
    const onSelectElement = vi.fn();
    const onPatchText = vi.fn();
    render(
      <StudioDialogueBatchPanel
        pages={WORKFLOW_PAGES}
        currentPageId="page-1"
        selectedId={selectedId}
        onClose={vi.fn()}
        onSelectElement={onSelectElement}
        onPatchText={onPatchText}
        onApplyReplace={vi.fn()}
        readAloudAdapter={speechAdapter(false)}
      />
    );
    return { onSelectElement, onPatchText };
  }

  it("선택된 대사에서 바로 시작하고 Cmd+Enter 저장 후 잠긴 행을 건너뛴다", () => {
    const { onPatchText, onSelectElement } = renderWorkflow();
    const editors = screen.getAllByRole("textbox", { name: "1페이지 말풍선·말하기 대사 수정" });
    const first = editors[0];
    const third = editors[1];

    expect(document.activeElement).toBe(first);
    expect(first).toHaveProperty("selectionStart", 0);
    expect(first).toHaveProperty("selectionEnd", "첫 번째".length);

    fireEvent.change(first, { target: { value: "첫 번째 수정" } });
    fireEvent.keyDown(first, { key: "Enter", metaKey: true });

    expect(onPatchText).toHaveBeenCalledTimes(1);
    expect(onPatchText).toHaveBeenCalledWith("page-1", "bubble-1", "첫 번째 수정");
    expect(onSelectElement).toHaveBeenLastCalledWith("page-1", "bubble-3");
    expect(document.activeElement).toBe(third);
  });

  it("Ctrl+Shift+Enter는 저장 후 이전 편집 가능 대사로 이동한다", () => {
    const { onPatchText, onSelectElement } = renderWorkflow("bubble-3");
    const editors = screen.getAllByRole("textbox", { name: "1페이지 말풍선·말하기 대사 수정" });
    const first = editors[0];
    const third = editors[1];

    expect(document.activeElement).toBe(third);
    fireEvent.change(third, { target: { value: "세 번째 수정" } });
    fireEvent.keyDown(third, { key: "Enter", ctrlKey: true, shiftKey: true });

    expect(onPatchText).toHaveBeenCalledWith("page-1", "bubble-3", "세 번째 수정");
    expect(onSelectElement).toHaveBeenLastCalledWith("page-1", "bubble-1");
    expect(document.activeElement).toBe(first);
  });

  it("한글 IME 조합 중 Cmd/Ctrl+Enter는 저장하거나 포커스를 옮기지 않는다", () => {
    const { onPatchText, onSelectElement } = renderWorkflow();
    const first = screen.getAllByRole("textbox", { name: "1페이지 말풍선·말하기 대사 수정" })[0];

    fireEvent.change(first, { target: { value: "조합 중" } });
    fireEvent.compositionStart(first);
    fireEvent.keyDown(first, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(first, { key: "Escape" });

    expect(onPatchText).not.toHaveBeenCalled();
    expect(onSelectElement).not.toHaveBeenCalledWith("page-1", "bubble-3");
    expect(document.activeElement).toBe(first);
    expect((first as HTMLTextAreaElement).value).toBe("조합 중");

    fireEvent.compositionEnd(first);
    fireEvent.keyDown(first, { key: "Enter", ctrlKey: true, keyCode: 229 });
    expect(onPatchText).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Enter", ctrlKey: true });
    expect(onPatchText).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(first);
  });

  it("행 제목 한 번 클릭으로 캔버스 선택과 textarea 편집을 함께 시작한다", () => {
    const { onSelectElement } = renderWorkflow(null);
    const editButton = screen.getByRole("button", {
      name: '1페이지 말풍선·말하기 "세 번째" 선택하고 대사 편집',
    });
    const editors = screen.getAllByRole("textbox", { name: "1페이지 말풍선·말하기 대사 수정" });

    fireEvent.click(editButton);

    expect(onSelectElement).toHaveBeenLastCalledWith("page-1", "bubble-3");
    expect(document.activeElement).toBe(editors[1]);
  });
});

describe("StudioDialogueBatchPanel EX-style structure editing", () => {
  const STRUCTURE_PAGES: StudioDialogueBatchPanelProps["pages"] = [
    {
      id: "page-1",
      elements: [
        { id: "bubble-1", type: "bubble", variant: "speech", text: "앞 대사", x: 20, y: 20 },
        { id: "bubble-2", type: "bubble", variant: "speech", text: "뒤 대사", x: 20, y: 120 },
      ],
    },
    {
      id: "page-2",
      elements: [{ id: "text-2", type: "text", text: "다음 페이지", x: 20, y: 20 }],
    },
  ];

  function renderStructurePanel(
    overrides: Partial<StudioDialogueBatchPanelProps> = {}
  ) {
    const onSplitText = vi.fn();
    const onMergeWithNext = vi.fn();
    const onTransferElement = vi.fn();
    const onApplyDialogueRuby = vi.fn();
    const onClearDialogueRuby = vi.fn();
    render(
      <StudioDialogueBatchPanel
        pages={STRUCTURE_PAGES}
        currentPageId="page-1"
        selectedId="bubble-1"
        onClose={vi.fn()}
        onSelectElement={vi.fn()}
        onPatchText={vi.fn()}
        onApplyReplace={vi.fn()}
        onSplitText={onSplitText}
        onMergeWithNext={onMergeWithNext}
        onTransferElement={onTransferElement}
        onApplyDialogueRuby={onApplyDialogueRuby}
        onClearDialogueRuby={onClearDialogueRuby}
        readAloudAdapter={speechAdapter(false)}
        {...overrides}
      />
    );
    return {
      onSplitText,
      onMergeWithNext,
      onTransferElement,
      onApplyDialogueRuby,
      onClearDialogueRuby,
    };
  }

  it("keeps one inline structure menu open and splits the latest draft at the caret", () => {
    const { onSplitText } = renderStructurePanel();
    const firstEditor = screen.getAllByRole<HTMLTextAreaElement>("textbox", {
      name: "1페이지 말풍선·말하기 대사 수정",
    })[0]!;
    fireEvent.change(firstEditor, { target: { value: "앞과 뒤" } });
    firstEditor.setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole("button", {
      name: '1페이지 말풍선·말하기 "앞 대사" 구조 작업',
    }));

    const split = screen.getByRole("button", { name: "커서에서 나누기" });
    fireEvent.pointerDown(split);
    fireEvent.click(split);

    expect(onSplitText).toHaveBeenCalledWith("page-1", "bubble-1", "앞과 뒤", 2);
    expect(screen.queryByRole("group", { name: "1페이지 대사 구조 편집" })).toBeNull();
  });

  it("merges with the next reading-order dialogue and preserves the latest draft", () => {
    const { onMergeWithNext } = renderStructurePanel();
    const firstEditor = screen.getAllByRole<HTMLTextAreaElement>("textbox", {
      name: "1페이지 말풍선·말하기 대사 수정",
    })[0]!;
    fireEvent.change(firstEditor, { target: { value: "합칠 최신본" } });
    fireEvent.click(screen.getByRole("button", {
      name: '1페이지 말풍선·말하기 "앞 대사" 구조 작업',
    }));
    fireEvent.click(screen.getByRole("button", { name: "다음과 합치기" }));

    expect(onMergeWithNext).toHaveBeenCalledWith("page-1", "bubble-1", "합칠 최신본");
  });

  it("moves or copies dialogue to an explicit target page from the same compact menu", () => {
    const { onTransferElement } = renderStructurePanel();
    fireEvent.click(screen.getByRole("button", {
      name: '1페이지 말풍선·말하기 "앞 대사" 구조 작업',
    }));
    const target = screen.getByRole("combobox", { name: "1페이지 대사 이동 대상" });
    fireEvent.change(target, { target: { value: "page-2" } });
    fireEvent.click(screen.getByRole("button", { name: "복사" }));

    expect(onTransferElement).toHaveBeenCalledWith(
      "page-1",
      "bubble-1",
      "page-2",
      "copy",
      "앞 대사",
    );
  });

  it("applies and clears ruby for the current textarea selection from the structure menu", () => {
    const { onApplyDialogueRuby, onClearDialogueRuby } = renderStructurePanel();
    const firstEditor = screen.getAllByRole<HTMLTextAreaElement>("textbox", {
      name: "1페이지 말풍선·말하기 대사 수정",
    })[0]!;
    fireEvent.change(firstEditor, { target: { value: "漢字テスト" } });
    firstEditor.setSelectionRange(0, 2);
    fireEvent.select(firstEditor);
    fireEvent.click(screen.getByRole("button", {
      name: '1페이지 말풍선·말하기 "앞 대사" 구조 작업',
    }));

    const rubyInput = screen.getByLabelText("1페이지 선택 구간 루비 읽기");
    // 한국 웹툰 스튜디오의 한자 독음 입력이므로 예시는 한글이어야 한다(일본어 예시 회귀 금지).
    expect(rubyInput.getAttribute("placeholder")).toBe("예: 한자");
    fireEvent.change(rubyInput, { target: { value: "かんじ" } });
    const applyRuby = screen.getByRole("button", { name: "루비 달기" });
    fireEvent.pointerDown(applyRuby);
    fireEvent.click(applyRuby);

    expect(onApplyDialogueRuby).toHaveBeenCalledWith(
      "page-1",
      "bubble-1",
      "漢字テスト",
      0,
      2,
      "かんじ",
    );

    // Unit test pages are immutable; re-establish draft + selection after apply cleared the draft.
    fireEvent.change(firstEditor, { target: { value: "漢字テスト" } });
    firstEditor.setSelectionRange(0, 2);
    fireEvent.select(firstEditor);
    if (!screen.queryByRole("button", { name: "선택 루비 지우기" })) {
      fireEvent.click(screen.getByRole("button", {
        name: '1페이지 말풍선·말하기 "앞 대사" 구조 작업',
      }));
    }
    const clearRuby = screen.getByRole("button", { name: "선택 루비 지우기" });
    fireEvent.pointerDown(clearRuby);
    fireEvent.click(clearRuby);

    expect(onClearDialogueRuby).toHaveBeenCalledWith(
      "page-1",
      "bubble-1",
      "漢字テスト",
      0,
      2,
    );
  });

  it("shows a plain-text ruby preview when the element already has rubySpans", () => {
    renderStructurePanel({
      pages: [
        {
          id: "page-1",
          elements: [
            {
              id: "bubble-1",
              type: "bubble",
              variant: "speech",
              text: "漢字テスト",
              // DialoguePageLike is structural; rubySpans live on elements at runtime.
              ...({
                rubySpans: [{ start: 0, end: 2, ruby: "かんじ" }],
              } as object),
              x: 20,
              y: 20,
            },
          ],
        },
      ],
    });
    expect(screen.getByLabelText("1페이지 루비 미리보기").textContent).toBe(
      "漢字(かんじ)テスト",
    );
  });
});

describe("StudioDialogueBatchPanel multi-select format scope", () => {
  const FORMAT_PAGES: StudioDialogueBatchPanelProps["pages"] = [
    {
      id: "page-1",
      elements: [
        { id: "bubble-1", type: "bubble", variant: "speech", text: "하나", x: 20, y: 20 },
        { id: "bubble-2", type: "bubble", variant: "speech", text: "둘", x: 20, y: 120 },
        {
          id: "bubble-locked",
          type: "bubble",
          variant: "speech",
          text: "잠김",
          x: 20,
          y: 220,
          locked: true,
        },
        { id: "bubble-3", type: "bubble", variant: "speech", text: "셋", x: 20, y: 320 },
      ],
    },
  ];

  function renderFormatPanel(overrides: Partial<StudioDialogueBatchPanelProps> = {}) {
    const onApplyFormat = vi.fn();
    render(
      <StudioDialogueBatchPanel
        pages={FORMAT_PAGES}
        currentPageId="page-1"
        selectedId={null}
        onClose={vi.fn()}
        onSelectElement={vi.fn()}
        onPatchText={vi.fn()}
        onApplyReplace={vi.fn()}
        onApplyFormat={onApplyFormat}
        readAloudAdapter={speechAdapter(false)}
        {...overrides}
      />
    );
    return { onApplyFormat };
  }

  it("applies format to all matching unlocked selectedIds when scope is 선택만", () => {
    const { onApplyFormat } = renderFormatPanel({
      selectedIds: ["bubble-1", "bubble-2", "bubble-locked", "bubble-missing"],
    });

    expect(screen.getByText("3개 선택")).toBeTruthy();
    const selectedOnly = screen.getByRole("button", { name: "선택만" }) as HTMLButtonElement;
    expect(selectedOnly.disabled).toBe(false);
    fireEvent.click(selectedOnly);
    fireEvent.click(screen.getByRole("button", { name: "굵게" }));

    expect(onApplyFormat).toHaveBeenCalledTimes(1);
    expect(onApplyFormat).toHaveBeenCalledWith(
      ["bubble-1", "bubble-2"],
      { fontStyle: "bold" }
    );
    expect(screen.getByText(/대사 2개에 적용/u)).toBeTruthy();
  });

  it("falls back to selectedId when selectedIds is empty and still enables 선택만", () => {
    const { onApplyFormat } = renderFormatPanel({
      selectedId: "bubble-3",
      selectedIds: [],
    });

    expect(screen.queryByText(/개 선택/u)).toBeNull();
    const selectedOnly = screen.getByRole("button", { name: "선택만" }) as HTMLButtonElement;
    expect(selectedOnly.disabled).toBe(false);
    fireEvent.click(selectedOnly);
    fireEvent.click(screen.getByRole("button", { name: "굵게" }));

    expect(onApplyFormat).toHaveBeenCalledWith(["bubble-3"], { fontStyle: "bold" });
  });

  it("disables 선택만 when no dialogue id is selected among items", () => {
    renderFormatPanel({
      selectedId: null,
      selectedIds: ["not-a-dialogue"],
    });
    const selectedOnly = screen.getByRole("button", { name: "선택만" }) as HTMLButtonElement;
    expect(selectedOnly.disabled).toBe(true);
  });
});

describe("StudioDialogueBatchPanel file interchange", () => {
  function renderInterchange(onImportInterchange = vi.fn()) {
    const rendered = render(
      <StudioDialogueBatchPanel
        pages={PAGES}
        currentPageId="page-1"
        selectedId={null}
        onClose={vi.fn()}
        onSelectElement={vi.fn()}
        onPatchText={vi.fn()}
        onApplyReplace={vi.fn()}
        onImportInterchange={onImportInterchange}
        readAloudAdapter={speechAdapter(false)}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /번역·대본 파일/u }));
    return rendered;
  }

  it("keeps nine formats collapsed until requested and exports the current lettering", () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderInterchange();

    expect(screen.getByRole("combobox", { name: "대사 내보내기 형식" })).toHaveProperty("value", "csv");
    expect(screen.getByText("9종")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내보내기" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/2개 대사를 \.csv 파일로 내보냈어요/u)).toBeTruthy();
  });

  it("parses a JSON translation and delegates one transactional apply with the chosen match mode", async () => {
    const onImportInterchange = vi.fn().mockResolvedValue({
      pages: PAGES,
      matched: 1,
      changed: 1,
      locked: 0,
      missing: 0,
      droppedMetadata: 0,
    });
    const { container } = renderInterchange(onImportInterchange);
    fireEvent.change(screen.getByRole("combobox", { name: "가져온 대사 연결 방식" }), {
      target: { value: "id" },
    });
    const payload = JSON.stringify({
      schema: "toonspectrum.dialogue-script",
      version: 1,
      cues: [{ id: "bubble-1", page: 1, text: "번역" }],
    });
    const file = new File([payload], "translation.json", { type: "application/json" });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new TextEncoder().encode(payload).buffer,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(onImportInterchange).toHaveBeenCalledTimes(1));
    expect(onImportInterchange).toHaveBeenCalledWith(
      expect.objectContaining({ cues: [expect.objectContaining({ id: "bubble-1", text: "번역" })] }),
      "id"
    );
    expect(screen.getByText(/1개 대사를 한 번에 반영했어요/u)).toBeTruthy();
  });

  it("shows an FDX loss preview and applies only after explicit confirmation", async () => {
    const onImportInterchange = vi.fn().mockResolvedValue({
      pages: PAGES,
      matched: 1,
      changed: 1,
      locked: 0,
      missing: 0,
      droppedMetadata: 0,
    });
    const { container } = renderInterchange(onImportInterchange);
    const payload = `<?xml version="1.0" encoding="UTF-8"?>
      <FinalDraft DocumentType="Script">
        <Content>
          <Paragraph Type="Scene Heading"><Text>INT. 교실 - 낮</Text></Paragraph>
          <Paragraph Type="Action"><Text>창문에 비가 내린다.</Text></Paragraph>
          <Paragraph Type="Character"><Text>하나</Text></Paragraph>
          <Paragraph Type="Dialogue"><Text>안녕.</Text></Paragraph>
          <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
        </Content>
      </FinalDraft>`;
    const file = new File([payload], "episode-01.fdx", { type: "application/xml" });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new TextEncoder().encode(payload).buffer,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toContain(".fdx");
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByRole("heading", { name: "FDX 손실 미리보기" })).toBeTruthy();
    expect(onImportInterchange).not.toHaveBeenCalled();
    expect(screen.getByText("episode-01.fdx")).toBeTruthy();
    expect(screen.getByText("가져올 대사").nextElementSibling?.textContent).toBe("1");
    expect(screen.getByText("문맥만 사용").nextElementSibling?.textContent).toBe("2");
    expect(screen.getAllByText("제외")[0]?.nextElementSibling?.textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "확인하고 적용" }));
    await waitFor(() => expect(onImportInterchange).toHaveBeenCalledTimes(1));
    expect(onImportInterchange).toHaveBeenCalledWith(
      expect.objectContaining({
        cues: [expect.objectContaining({ page: 1, panel: 1, speaker: "하나", text: "안녕." })],
      }),
      "auto"
    );
    expect(screen.queryByRole("heading", { name: "FDX 손실 미리보기" })).toBeNull();
    expect(screen.getByText(/1개 대사를 한 번에 반영했어요/u)).toBeTruthy();
  });

  it("cancels a pending FDX import without mutating the document", async () => {
    const onImportInterchange = vi.fn();
    const { container } = renderInterchange(onImportInterchange);
    const payload = `<FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Character"><Text>하나</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>취소할 대사</Text></Paragraph>
    </Content></FinalDraft>`;
    const file = new File([payload], "cancel.fdx", { type: "application/xml" });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new TextEncoder().encode(payload).buffer,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByRole("heading", { name: "FDX 손실 미리보기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onImportInterchange).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "FDX 손실 미리보기" })).toBeNull();
    expect(screen.getByText(/문서는 변경되지 않았습니다/u)).toBeTruthy();
  });
});
