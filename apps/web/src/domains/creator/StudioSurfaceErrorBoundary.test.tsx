// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { lazy, Suspense, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioSurfaceErrorBoundary } from "./StudioSurfaceErrorBoundary";

function FailingSurface({ fail }: { readonly fail: boolean }) {
  if (fail) throw new Error("surface-render-failed");
  return <div data-testid="surface-ready">3D surface ready</div>;
}

function EditorSentinel() {
  const [undoDepth, setUndoDepth] = useState(0);
  return (
    <button
      type="button"
      data-testid="editor-sentinel"
      onClick={() => setUndoDepth((current) => current + 1)}
    >
      Undo {undoDepth}
    </button>
  );
}

function Harness({
  fail,
  onError,
  onExit,
  resetKey,
}: {
  readonly fail: boolean;
  readonly onError?: () => void;
  readonly onExit: () => void;
  readonly resetKey: string;
}) {
  return (
    <>
      <EditorSentinel />
      <StudioSurfaceErrorBoundary
        onError={onError}
        onExit={onExit}
        resetKey={resetKey}
        retryLabel="도구 다시 열기"
        surfaceLabel="전문 3D 제작 도구"
      >
        <FailingSurface fail={fail} />
      </StudioSurfaceErrorBoundary>
    </>
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("StudioSurfaceErrorBoundary", () => {
  it("keeps the editor owner mounted while a failed surface retries", () => {
    const onError = vi.fn();
    const onExit = vi.fn();
    const view = render(
      <Harness fail={false} onError={onError} onExit={onExit} resetKey="work-a:model" />,
    );
    const editor = screen.getByTestId("editor-sentinel");
    fireEvent.click(editor);
    expect(editor.textContent).toBe("Undo 1");

    view.rerender(
      <Harness fail onError={onError} onExit={onExit} resetKey="work-a:model" />,
    );

    const recovery = screen.getByRole("alertdialog", {
      name: "전문 3D 제작 도구를 계속 열 수 없습니다.",
    });
    expect(recovery).toBeTruthy();
    expect(screen.getByTestId("editor-sentinel")).toBe(editor);
    expect(editor.textContent).toBe("Undo 1");
    expect(onError).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: "2D 캔버스로 돌아가기" })[0],
    );

    view.rerender(
      <Harness fail={false} onError={onError} onExit={onExit} resetKey="work-a:model" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "도구 다시 열기" }));

    expect(screen.getByTestId("surface-ready")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("editor-sentinel")).toBe(editor);
  });

  it("clears a latched fault when the surface reset key changes", async () => {
    const onExit = vi.fn();
    const view = render(
      <Harness fail onExit={onExit} resetKey="work-a:model" />,
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    view.rerender(
      <Harness fail={false} onExit={onExit} resetKey="work-b:sculpt" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface-ready")).toBeTruthy();
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("catches a rejected lazy surface and exposes a safe 2D exit", async () => {
    const onExit = vi.fn();
    const RejectedLazySurface = lazy(async () => {
      throw new Error("surface-chunk-rejected");
    });

    render(
      <>
        <div data-testid="canvas-owner">canvas + CRDT + undo owner</div>
        <StudioSurfaceErrorBoundary
          onExit={onExit}
          resetKey="work-a:model"
          surfaceLabel="전문 3D 제작 도구"
        >
          <Suspense fallback={<div role="status">3D loading</div>}>
            <RejectedLazySurface />
          </Suspense>
        </StudioSurfaceErrorBoundary>
      </>,
    );

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByTestId("canvas-owner")).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole("button", { name: "2D 캔버스로 돌아가기" })[1]!,
    );
    expect(onExit).toHaveBeenCalledOnce();
  });
});
