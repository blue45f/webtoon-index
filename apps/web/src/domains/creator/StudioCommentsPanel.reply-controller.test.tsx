// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addStudioCommentThread,
  createEmptyStudioCommentsDocument,
  resolveStudioCommentThread,
} from "./studio-comments";
import { StudioCommentsPanel } from "./StudioCommentsPanel";

import type { StudioCommentsPanelProps } from "./StudioCommentsPanel";

const ACTOR = { id: "user-1", displayName: "하린" };
const ANCHOR = { type: "page", pageId: "page-1" } as const;
const DOCUMENT = addStudioCommentThread(createEmptyStudioCommentsDocument(), {
  id: "thread-1",
  anchor: ANCHOR,
  author: { id: "user-2", displayName: "민호" },
  body: "말풍선 위치를 확인해 주세요.",
}, new Date("2025-01-01T01:00:00.000Z"));
const TWO_THREAD_DOCUMENT = addStudioCommentThread(DOCUMENT, {
  id: "thread-2",
  anchor: { type: "page", pageId: "page-2" },
  author: { id: "user-3", displayName: "서윤" },
  body: "두 번째 컷의 배경 톤도 확인해 주세요.",
}, new Date("2025-01-01T02:00:00.000Z"));

function panelProps(
  overrides: Partial<StudioCommentsPanelProps> = {}
): StudioCommentsPanelProps {
  return {
    open: true,
    onClose: vi.fn(),
    document: DOCUMENT,
    onChange: vi.fn(async () => true),
    activeAnchor: ANCHOR,
    currentActor: ACTOR,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("StudioCommentsPanel shared reply controller", () => {
  it("opens a compact reply editor from the comment body and cancels it with Escape", async () => {
    const onChange = vi.fn(async () => true);
    render(<StudioCommentsPanel {...panelProps({ onChange })} />);

    const quickReply = await screen.findByRole("button", {
      name: "민호의 댓글에 빠르게 답글",
    });
    expect(quickReply.className).toContain("min-h-11");
    expect(quickReply.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(quickReply);
    const textarea = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    });
    expect(quickReply.getAttribute("aria-expanded")).toBe("true");
    expect(quickReply.getAttribute("aria-controls")).toBe(textarea.closest("form")?.id);
    expect(textarea.getAttribute("aria-keyshortcuts")).toBe(
      "Meta+Enter Control+Enter Escape"
    );
    const touchHint = screen.getByText("클릭해 답글 쓰기");
    expect(touchHint.className).toContain("sm:opacity-0");
    expect(touchHint.className).not.toContain(" opacity-0");

    fireEvent.change(textarea, { target: { value: "취소할 답글" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "민호에게 답글" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("submits a quick reply with Cmd/Ctrl+Enter without opening another modal", async () => {
    const submittedDocuments: StudioCommentsPanelProps["document"][] = [];
    const onChange = vi.fn(async (nextDocument: StudioCommentsPanelProps["document"]) => {
      submittedDocuments.push(nextDocument);
      return true;
    });
    render(<StudioCommentsPanel {...panelProps({ onChange })} />);

    fireEvent.click(await screen.findByRole("button", {
      name: "민호의 댓글에 빠르게 답글",
    }));
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    });
    fireEvent.change(textarea, { target: { value: "바로 등록할 답글" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("dialog", { name: /답글/u })
    ).toBeNull();
    expect(submittedDocuments[0]?.threads[0]?.replies[0]?.body).toBe(
      "바로 등록할 답글"
    );
  });

  it("protects an existing shared draft when another thread is clicked", async () => {
    const sharedReply = {
      threadId: "thread-1",
      body: "보존해야 하는 답글",
      mutationId: "reply-protected-switch",
      submitting: false,
      onThreadChange: vi.fn(),
      onBodyChange: vi.fn(),
      onDiscard: vi.fn(),
      onSubmit: vi.fn(async () => true),
    };
    render(
      <StudioCommentsPanel
        {...panelProps({
          activeAnchor: null,
          document: TWO_THREAD_DOCUMENT,
          sharedReply,
        })}
      />
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "서윤의 댓글에 빠르게 답글",
    }));

    expect(sharedReply.onThreadChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("작성 중인 답글");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    }).value).toBe("보존해야 하는 답글");
  });

  it("keeps resolved and read-only comment bodies non-interactive", async () => {
    const resolvedDocument = resolveStudioCommentThread(DOCUMENT, "thread-1", ACTOR);
    const view = render(
      <StudioCommentsPanel {...panelProps({ document: resolvedDocument })} />
    );

    expect(screen.queryByRole("button", {
      name: "민호의 댓글에 빠르게 답글",
    })).toBeNull();
    expect(screen.getByText("말풍선 위치를 확인해 주세요.").tagName).toBe("P");

    view.rerender(
      <StudioCommentsPanel
        {...panelProps({ readOnlyThreadIds: new Set(["thread-1"]) })}
      />
    );
    expect(screen.queryByRole("button", {
      name: "민호의 댓글에 빠르게 답글",
    })).toBeNull();
    expect(await screen.findByText("로컬 보관본 · 읽기 전용")).toBeTruthy();
  });

  it("labels the current-selection composer body and explains a disabled action", async () => {
    const view = render(<StudioCommentsPanel {...panelProps()} />);

    fireEvent.click(await screen.findByRole("button", { name: "현재 선택에 댓글" }));
    const body = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "댓글 내용",
    });
    await waitFor(() => expect(document.activeElement).toBe(body));
    expect(screen.getByText("댓글 위치").tagName).toBe("SPAN");

    view.rerender(
      <StudioCommentsPanel
        {...panelProps({
          capabilities: { create: false },
          mutationDisabledReason: "열람자는 댓글을 작성할 수 없어요.",
        })}
      />
    );
    fireEvent.keyDown(body, { key: "Escape" });
    const disabledAction = await screen.findByRole("button", { name: "현재 선택에 댓글" });
    expect((disabledAction as HTMLButtonElement).disabled).toBe(true);
    const reasonId = disabledAction.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(reasonId ? document.getElementById(reasonId)?.textContent : null).toBe(
      "열람자는 댓글을 작성할 수 없어요."
    );

    view.rerender(
      <StudioCommentsPanel {...panelProps({ activeAnchor: null })} />
    );
    const selectionRequiredAction = await screen.findByRole("button", {
      name: "현재 선택에 댓글",
    });
    expect((selectionRequiredAction as HTMLButtonElement).disabled).toBe(true);
    const selectionReasonId = selectionRequiredAction.getAttribute("aria-describedby");
    expect(selectionReasonId ? document.getElementById(selectionReasonId)?.textContent : null).toBe(
      "먼저 캔버스에서 페이지, 컷 또는 요소를 선택하세요."
    );
  });

  it("deduplicates identical anchor choices while keeping the first label", async () => {
    render(
      <StudioCommentsPanel
        {...panelProps({
          anchorOptions: [
            { anchor: ANCHOR, label: "첫 번째 페이지" },
            { anchor: ANCHOR, label: "중복 페이지" },
          ],
          onSelectAnchor: vi.fn(),
        })}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "현재 선택에 댓글" }));
    fireEvent.click(screen.getByRole("button", { name: "위치 변경" }));
    const picker = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "댓글 연결 위치",
    });
    expect(Array.from(picker.options).map((option) => option.textContent)).toEqual([
      "위치를 선택하세요",
      "첫 번째 페이지",
    ]);
  });

  it("renders a parent-owned draft, delegates changes with its stable ID, and fences same-tick submit", async () => {
    let settle!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve;
    }));
    const onBodyChange = vi.fn();
    const sharedReply = {
      threadId: "thread-1",
      body: "팝오버에서 작성한 초안",
      mutationId: "reply-stable-1",
      submitting: false,
      onThreadChange: vi.fn(),
      onBodyChange,
      onDiscard: vi.fn(),
      onSubmit,
    };
    const props = panelProps({ sharedReply });
    const view = render(<StudioCommentsPanel {...props} />);

    const textarea = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    });
    expect(textarea.value).toBe("팝오버에서 작성한 초안");
    fireEvent.change(textarea, { target: { value: "검토함에서 이어 쓴 초안" } });
    expect(onBodyChange).toHaveBeenCalledWith("thread-1", "검토함에서 이어 쓴 초안");

    const updatedSharedReply = { ...sharedReply, body: "검토함에서 이어 쓴 초안" };
    view.rerender(<StudioCommentsPanel {...props} sharedReply={updatedSharedReply} />);
    const updatedTextarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    });
    const form = updatedTextarea.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      threadId: "thread-1",
      body: "검토함에서 이어 쓴 초안",
      mutationId: "reply-stable-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(sharedReply.onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "민호에게 답글" })).toBeTruthy();

    view.rerender(
      <StudioCommentsPanel {...props} open={false} sharedReply={updatedSharedReply} />
    );
    expect(screen.queryByRole("textbox", { name: "민호에게 답글" })).toBeNull();
    view.rerender(
      <StudioCommentsPanel {...props} open sharedReply={updatedSharedReply} />
    );
    expect((await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    })).value).toBe("검토함에서 이어 쓴 초안");

    settle(true);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(sharedReply.onDiscard).toHaveBeenCalledWith("thread-1");
  });

  it("keeps the original uncontrolled draft across close and reopen", async () => {
    const props = panelProps();
    const view = render(<StudioCommentsPanel {...props} />);

    fireEvent.click(await screen.findByRole("button", {
      name: "민호의 댓글에 빠르게 답글",
    }));
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "민호에게 답글" });
    fireEvent.change(textarea, { target: { value: "레일 내부 초안" } });
    view.rerender(<StudioCommentsPanel {...props} open={false} />);
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "민호에게 답글" })).toBeNull();
    });
    view.rerender(<StudioCommentsPanel {...props} open />);

    const restored = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    });
    expect(restored.value).toBe("레일 내부 초안");
  });

  it("keeps a shared draft visible across mode switches, rail close, and a different anchor", async () => {
    const onClose = vi.fn();
    const onChange = vi.fn(async () => true);
    const onDiscard = vi.fn();
    const sharedReply = {
      threadId: "thread-1",
      body: "사라지면 안 되는 공유 초안",
      mutationId: "reply-protected-1",
      submitting: false,
      onThreadChange: vi.fn(),
      onBodyChange: vi.fn(),
      onDiscard,
      onSubmit: vi.fn(async () => true),
    };
    const props = panelProps({ onClose, onChange, sharedReply });
    const view = render(<StudioCommentsPanel {...props} />);

    const replyEditor = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    });
    fireEvent.click(screen.getByRole("button", {
      name: "민호의 댓글에 빠르게 답글",
    }));
    expect(replyEditor.isConnected).toBe(true);
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "담당자 지정" }));
    fireEvent.click(screen.getByRole("button", { name: "민호의 댓글 해결 처리" }));
    fireEvent.click(screen.getByRole("button", { name: "검토 댓글 닫기" }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("작성 중인 답글");
    expect(screen.getByRole("textbox", { name: "민호에게 답글" })).toBeTruthy();

    view.rerender(<StudioCommentsPanel {...props} open={false} />);
    view.rerender(
      <StudioCommentsPanel
        {...props}
        activeAnchor={{ type: "page", pageId: "page-2" }}
        document={resolveStudioCommentThread(DOCUMENT, "thread-1", ACTOR)}
        open
      />
    );
    expect((await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "민호에게 답글",
    })).value).toBe("사라지면 안 되는 공유 초안");
    expect(screen.queryByRole("textbox", { name: "댓글 내용" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onDiscard).toHaveBeenCalledWith("thread-1");
  });

  it("fences same-tick double submit in the original uncontrolled path", async () => {
    let settle!: (accepted: boolean) => void;
    const onChange = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve;
    }));
    render(<StudioCommentsPanel {...panelProps({ onChange })} />);

    fireEvent.click(await screen.findByRole("button", {
      name: "민호의 댓글에 빠르게 답글",
    }));
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "민호에게 답글" });
    fireEvent.change(textarea, { target: { value: "한 번만 제출할 초안" } });
    const form = textarea.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    settle(true);
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "민호에게 답글" })).toBeNull();
    });
  });
});
