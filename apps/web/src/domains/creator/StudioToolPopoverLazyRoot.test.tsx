// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { Suspense, act, lazy } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioFloatingToolPopover } from "./studio-chrome-ui";

afterEach(() => {
  cleanup();
});

describe("Studio lazy ToolBelt popover root", () => {
  it("keeps the portal and fallback interactive while its body chunk resolves", async () => {
    let resolveBody: ((module: { default: () => React.JSX.Element }) => void) | undefined;
    const LazyBody = lazy(
      () => new Promise<{ default: () => React.JSX.Element }>((resolve) => {
        resolveBody = resolve;
      })
    );
    const view = render(
      <StudioFloatingToolPopover id="ai-group" open>
        <Suspense fallback={<button type="button">AI 메뉴를 여는 중...</button>}>
          <LazyBody />
        </Suspense>
      </StudioFloatingToolPopover>
    );

    const root = document.body.querySelector('[data-studio-tool-popover="ai-group"]');
    expect(root).not.toBeNull();
    expect(root?.textContent).toContain("AI 메뉴를 여는 중...");

    await act(async () => {
      resolveBody?.({ default: () => <button type="button">AI 생성 실행</button> });
    });
    await waitFor(() => expect(root?.textContent).toContain("AI 생성 실행"));
    expect(document.body.querySelector('[data-studio-tool-popover="ai-group"]')).toBe(root);

    view.rerender(
      <StudioFloatingToolPopover id="ai-group" open={false}>
        <Suspense fallback={null}>
          <LazyBody />
        </Suspense>
      </StudioFloatingToolPopover>
    );
    expect(document.body.querySelector('[data-studio-tool-popover="ai-group"]')).toBeNull();
  });
});
