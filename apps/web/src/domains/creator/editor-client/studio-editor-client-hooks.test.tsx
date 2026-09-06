// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import {
  alwaysAvailable,
  CommandRegistry,
  createEditorClient,
  createEditorSnapshotStore,
  EDITOR_REQUEST_SERVICE_KEY,
} from "@toonspectrum/studio-command-registry";
import { afterEach, describe, expect, it } from "vitest";

import { StudioEditorClientProvider } from "./StudioEditorClientContext";
import { useEditorCommand } from "./useEditorCommand";
import { useEditorSelector } from "./useEditorSelector";

import type {
  CommandContext,
  EditorClient,
  EditorCommandRequest,
  EditorSnapshotStore,
} from "@toonspectrum/studio-command-registry";
import type { ReactNode } from "react";

afterEach(cleanup);

interface EditorState {
  brush: string;
  zoom: number;
}

const selectBrush = (state: EditorState) => state.brush;
const selectZoom = (state: EditorState) => state.zoom;

function createHarness() {
  const store: EditorSnapshotStore<EditorState> = createEditorSnapshotStore({
    brush: "pencil",
    zoom: 1,
  });
  const registry = new CommandRegistry();
  const seen: EditorCommandRequest[] = [];
  registry.register({
    id: "brush.choose",
    labels: [{ locale: "ko", label: "브러시 선택" }],
    aliases: [],
    availability: alwaysAvailable,
    helpNodeId: "help/brush/choose",
    execute: async (context: CommandContext) => {
      const request = context.services.get(
        EDITOR_REQUEST_SERVICE_KEY,
      ) as EditorCommandRequest;
      seen.push(request);
      store.update((previous) => ({ ...previous, brush: String(request.payload) }));
      return { status: "ok" as const };
    },
  });
  const client = createEditorClient({
    registry,
    store,
    context: (): CommandContext => ({ workspace: "comic", services: new Map() }),
  });
  return { store, registry, client, seen };
}

function wrap(client: EditorClient<EditorState>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StudioEditorClientProvider client={client}>
        {children}
      </StudioEditorClientProvider>
    );
  };
}

describe("useEditorSelector", () => {
  it("renders the selected slice and re-renders only when that slice changes", () => {
    const { store, client } = createHarness();
    const renders: string[] = [];

    function BrushLabel() {
      renders.push("brush");
      const brush = useEditorSelector(selectBrush);
      return <span data-testid="brush">{brush}</span>;
    }

    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <BrushLabel />
      </Wrapper>,
    );

    expect(screen.getByTestId("brush").textContent).toBe("pencil");
    expect(renders).toHaveLength(1);

    // 다른 조각(zoom)만 바뀌면 리렌더가 나지 않는다.
    act(() => {
      store.update((previous) => ({ ...previous, zoom: 2 }));
    });
    expect(renders).toHaveLength(1);
    expect(screen.getByTestId("brush").textContent).toBe("pencil");

    // 내가 보는 조각이 바뀌면 정확히 한 번 리렌더한다.
    act(() => {
      store.update((previous) => ({ ...previous, brush: "ink" }));
    });
    expect(renders).toHaveLength(2);
    expect(screen.getByTestId("brush").textContent).toBe("ink");
  });

  it("supports a custom equality function", () => {
    const { store, client } = createHarness();
    const renders: string[] = [];
    const selectRoundedZoom = (state: EditorState) => ({ zoom: state.zoom });
    const sameZoom = (a: { zoom: number }, b: { zoom: number }) =>
      Math.round(a.zoom) === Math.round(b.zoom);

    function ZoomLabel() {
      renders.push("zoom");
      const { zoom } = useEditorSelector(selectRoundedZoom, sameZoom);
      return <span data-testid="zoom">{String(zoom)}</span>;
    }

    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <ZoomLabel />
      </Wrapper>,
    );
    expect(renders).toHaveLength(1);

    act(() => {
      store.update((previous) => ({ ...previous, zoom: 1.2 }));
    });
    expect(renders).toHaveLength(1);

    act(() => {
      store.update((previous) => ({ ...previous, zoom: 3 }));
    });
    expect(renders).toHaveLength(2);
    expect(screen.getByTestId("zoom").textContent).toBe("3");
  });
});

describe("useEditorCommand", () => {
  it("dispatches through the registry and tags the receipt with its source", async () => {
    const { client, seen } = createHarness();
    let receiptStatus = "";

    function BrushRail() {
      const brush = useEditorSelector(selectBrush);
      const chooseBrush = useEditorCommand("brush.choose", "rail");
      return (
        <button
          type="button"
          data-testid="choose"
          onClick={() => {
            void chooseBrush("ink").then((receipt) => {
              receiptStatus = receipt.status;
            });
          }}
        >
          {brush}
        </button>
      );
    }

    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <BrushRail />
      </Wrapper>,
    );

    expect(screen.getByTestId("choose").textContent).toBe("pencil");

    await act(async () => {
      screen.getByTestId("choose").click();
      await Promise.resolve();
    });

    expect(seen).toEqual([
      { id: "brush.choose", payload: "ink", source: "rail" },
    ]);
    expect(receiptStatus).toBe("applied");
    expect(screen.getByTestId("choose").textContent).toBe("ink");
  });

  it("keeps the dispatcher reference stable across re-renders", () => {
    const { store, client } = createHarness();
    const dispatchers = new Set<unknown>();

    function StableProbe() {
      const brush = useEditorSelector(selectBrush);
      dispatchers.add(useEditorCommand("brush.choose", "menu"));
      return <span data-testid="probe">{brush}</span>;
    }

    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <StableProbe />
      </Wrapper>,
    );

    act(() => {
      store.update((previous) => ({ ...previous, brush: "ink" }));
    });
    act(() => {
      store.update((previous) => ({ ...previous, brush: "wash" }));
    });

    expect(screen.getByTestId("probe").textContent).toBe("wash");
    expect(dispatchers.size).toBe(1);
  });
});

describe("useStudioEditorClient", () => {
  it("throws a clear error when used outside the provider", () => {
    function Orphan() {
      const brush = useEditorSelector(selectBrush);
      return <span>{brush}</span>;
    }

    expect(() => render(<Orphan />)).toThrow(
      /useStudioEditorClient must be used inside <StudioEditorClientProvider>/u,
    );
  });
});

describe("selectors", () => {
  it("reads every slice from one snapshot source", () => {
    const { store, client } = createHarness();

    function Both() {
      const brush = useEditorSelector(selectBrush);
      const zoom = useEditorSelector(selectZoom);
      return <span data-testid="both">{`${brush}@${String(zoom)}`}</span>;
    }

    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <Both />
      </Wrapper>,
    );
    expect(screen.getByTestId("both").textContent).toBe("pencil@1");

    act(() => {
      store.set({ brush: "ink", zoom: 4 });
    });
    expect(screen.getByTestId("both").textContent).toBe("ink@4");
  });
});
