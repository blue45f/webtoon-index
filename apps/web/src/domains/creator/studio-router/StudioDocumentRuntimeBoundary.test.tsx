// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudioDocumentRuntime } from "./studio-document-runtime-context";
import { StudioDocumentRuntimeBoundary } from "./StudioDocumentRuntimeBoundary";

afterEach(cleanup);

function RuntimeProbe({ surface }: { readonly surface: string }) {
  const runtime = useStudioDocumentRuntime();
  return (
    <output
      data-document-key={runtime.documentKey}
      data-instance-id={runtime.instanceId}
      data-testid="runtime"
    >
      {surface}
    </output>
  );
}

describe("StudioDocumentRuntimeBoundary", () => {
  it("preserves one runtime across surfaces and replaces it across documents", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const observer = { mounted, unmounted };
    const view = render(
      <StudioDocumentRuntimeBoundary documentKey="work:one" observer={observer}>
        <RuntimeProbe surface="canvas" />
      </StudioDocumentRuntimeBoundary>,
    );
    const firstInstanceId = screen.getByTestId("runtime").dataset.instanceId;
    expect(mounted).toHaveBeenCalledTimes(1);

    view.rerender(
      <StudioDocumentRuntimeBoundary documentKey="work:one" observer={observer}>
        <RuntimeProbe surface="dcc" />
      </StudioDocumentRuntimeBoundary>,
    );
    expect(screen.getByTestId("runtime").textContent).toBe("dcc");
    expect(screen.getByTestId("runtime").dataset.instanceId).toBe(firstInstanceId);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();

    view.rerender(
      <StudioDocumentRuntimeBoundary documentKey="remix:two" observer={observer}>
        <RuntimeProbe surface="canvas" />
      </StudioDocumentRuntimeBoundary>,
    );
    expect(screen.getByTestId("runtime").dataset.documentKey).toBe("remix:two");
    expect(screen.getByTestId("runtime").dataset.instanceId).not.toBe(firstInstanceId);
    expect(unmounted).toHaveBeenCalledTimes(1);
    expect(mounted).toHaveBeenCalledTimes(2);
  });
});
