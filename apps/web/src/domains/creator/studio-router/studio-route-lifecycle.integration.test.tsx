// @vitest-environment jsdom

import { cleanup, act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studioEditorInstanceKey } from "../studio-editor-scope";

import { useStudioDocumentLayout } from "./studio-document-layout-context";
import { resolveStudioRoute } from "./studio-route-manifest";
import { StudioDccWorkbenchRoute } from "./StudioDccWorkbenchRoute";
import { StudioDocumentLayout } from "./StudioDocumentLayout";
import { StudioDocumentRuntimeBoundary } from "./StudioDocumentRuntimeBoundary";

import type { StudioDccRouteAccess } from "../hybrid-dcc/studio-dcc-route-access";

afterEach(cleanup);

let nextMountedProbeId = 0;

function StatefulDocumentProbe({ surface }: { readonly surface: string }) {
  const [mountId] = useState(() => ++nextMountedProbeId);
  const [edits, setEdits] = useState(0);
  return (
    <div
      data-mount-id={mountId}
      data-testid="document-probe"
      data-surface={surface}
    >
      <output data-testid="edit-count">{edits}</output>
      <button type="button" onClick={() => setEdits((value) => value + 1)}>
        edit
      </button>
    </div>
  );
}

function ResolvedStudioRuntime({
  pathname,
  search = "",
}: {
  readonly pathname: string;
  readonly search?: string;
}) {
  const resolution = resolveStudioRoute({ pathname, search });
  if (resolution.kind !== "editor") {
    throw new Error(`Expected an editor route, received ${resolution.kind}.`);
  }
  const route = resolution.workspaceRoute;
  const documentKey = studioEditorInstanceKey({
    authScopeKey: "account-a",
    draftSessionEpoch: 0,
    remixId: route.remixSourceWorkId,
    workId: route.workId,
  });
  return (
    <StudioDocumentRuntimeBoundary documentKey={documentKey}>
      <StatefulDocumentProbe surface={route.surface} />
    </StudioDocumentRuntimeBoundary>
  );
}

let nextRuntimeProbeId = 0;

/** Stands in for the document-identity-scoped runtime the layout owns (live room, session id). */
function DocumentRuntimeProbe({ surface }: { readonly surface: string }) {
  const {
    documentKey,
    draftSessionEpoch,
    instantWorkId,
    liveRoomParam,
    remixId,
    workId,
  } = useStudioDocumentLayout();
  const [mountId] = useState(() => ++nextRuntimeProbeId);
  return (
    <div
      data-document-key={documentKey}
      data-draft-epoch={draftSessionEpoch}
      data-instant-work-id={instantWorkId}
      data-live-room={liveRoomParam ?? ""}
      data-mount-id={mountId}
      data-remix-id={remixId ?? ""}
      data-surface={surface}
      data-testid="runtime-probe"
      data-work-id={workId ?? ""}
    />
  );
}

function ResolvedStudioDocument({
  draftSessionEpoch = 0,
  pathname,
  search = "",
}: {
  readonly draftSessionEpoch?: number;
  readonly pathname: string;
  readonly search?: string;
}) {
  const resolution = resolveStudioRoute({ pathname, search });
  if (resolution.kind !== "editor") {
    throw new Error(`Expected an editor route, received ${resolution.kind}.`);
  }
  const route = resolution.workspaceRoute;
  const documentKey = studioEditorInstanceKey({
    authScopeKey: "account-a",
    draftSessionEpoch,
    remixId: route.remixSourceWorkId,
    workId: route.workId,
  });
  return (
    <StudioDocumentRuntimeBoundary documentKey={documentKey}>
      <StudioDocumentLayout
        draftSessionEpoch={draftSessionEpoch}
        studioRoute={route}
      >
        <DocumentRuntimeProbe surface={route.surface} />
      </StudioDocumentLayout>
    </StudioDocumentRuntimeBoundary>
  );
}

function routedDocument(node: ReactNode, entry = "/studio") {
  return <MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>;
}

function probe(): DOMStringMap {
  return screen.getByTestId("runtime-probe").dataset;
}

describe("Studio document layout runtime", () => {
  it("survives surface switches within one identity and tears down on identity rotation", () => {
    nextRuntimeProbeId = 0;
    const view = render(
      routedDocument(<ResolvedStudioDocument pathname="/studio/work/work-1/canvas" />),
    );
    const first = { ...probe() };
    expect(first.surface).toBe("canvas");
    expect(first.workId).toBe("work-1");
    expect(first.instantWorkId).toBeTruthy();

    for (const surface of ["comic", "animation"]) {
      view.rerender(
        routedDocument(
          <ResolvedStudioDocument pathname={`/studio/work/work-1/${surface}`} />,
        ),
      );
      expect(probe().surface).toBe(surface);
      // The layout — and therefore the collaboration runtime it will own — is never remounted by a
      // surface change, because the boundary key above it deliberately ignores presentation.
      expect(probe().mountId).toBe(first.mountId);
      expect(probe().instantWorkId).toBe(first.instantWorkId);
      expect(probe().documentKey).toBe(first.documentKey);
    }

    view.rerender(
      routedDocument(<ResolvedStudioDocument pathname="/studio/work/work-2/canvas" />),
    );
    expect(probe().mountId).not.toBe(first.mountId);
    expect(probe().instantWorkId).not.toBe(first.instantWorkId);
    expect(probe().documentKey).not.toBe(first.documentKey);
  });

  it("tears the layout down when the guest-draft epoch bumps under a stable route", () => {
    nextRuntimeProbeId = 0;
    const view = render(
      routedDocument(
        <ResolvedStudioDocument pathname="/studio/remix/source-1/canvas" />,
      ),
    );
    const before = { ...probe() };
    expect(before.draftEpoch).toBe("0");
    expect(before.remixId).toBe("source-1");

    view.rerender(
      routedDocument(
        <ResolvedStudioDocument
          draftSessionEpoch={1}
          pathname="/studio/remix/source-1/canvas"
        />,
      ),
    );
    expect(probe().draftEpoch).toBe("1");
    expect(probe().mountId).not.toBe(before.mountId);
    expect(probe().instantWorkId).not.toBe(before.instantWorkId);

    // Presentation still must not rotate the runtime after an epoch bump.
    const afterBump = { ...probe() };
    view.rerender(
      routedDocument(
        <ResolvedStudioDocument
          draftSessionEpoch={1}
          pathname="/studio/remix/source-1/3d/dcc/shot"
        />,
      ),
    );
    expect(probe().surface).toBe("dcc");
    expect(probe().mountId).toBe(afterBump.mountId);
  });

  it("publishes the instant jam room into ?room= once and then leaves it alone", () => {
    nextRuntimeProbeId = 0;
    const view = render(routedDocument(<ResolvedStudioDocument pathname="/studio" />));
    const published = { ...probe() };
    expect(published.workId).toBe("");
    expect(published.liveRoom).toBe(published.instantWorkId);

    view.rerender(routedDocument(<ResolvedStudioDocument pathname="/studio/canvas" />));
    expect(probe().mountId).toBe(published.mountId);
    expect(probe().liveRoom).toBe(published.liveRoom);
  });
});

let nextWorkbenchProbeId = 0;

/** Stands in for the DCC runtime the editor subtree owns beneath the workbench route. */
function DccRuntimeProbe() {
  const [mountId] = useState(() => ++nextWorkbenchProbeId);
  return <div data-mount-id={mountId} data-testid="dcc-runtime-probe" />;
}

function RoutedWorkbench({
  dccRouteAccess = "allowed",
  onCloseWorkbench,
  onFlush,
  pathname,
}: {
  readonly dccRouteAccess?: StudioDccRouteAccess;
  readonly onCloseWorkbench: () => void;
  readonly onFlush: () => void;
  readonly pathname: string;
}) {
  const resolution = resolveStudioRoute({ pathname, search: "" });
  if (resolution.kind !== "editor") {
    throw new Error(`Expected an editor route, received ${resolution.kind}.`);
  }
  const route = resolution.workspaceRoute;
  const documentKey = studioEditorInstanceKey({
    authScopeKey: "account-a",
    draftSessionEpoch: 0,
    remixId: route.remixSourceWorkId,
    workId: route.workId,
  });
  return (
    <MemoryRouter initialEntries={["/studio/work/work-1/canvas"]}>
      <StudioDocumentRuntimeBoundary documentKey={documentKey}>
        <StudioDocumentLayout draftSessionEpoch={0} studioRoute={route}>
          <StudioDccWorkbenchRoute
            dccRouteAccess={dccRouteAccess}
            dccRouteRequested={route.surface === "dcc"}
            onCloseWorkbench={onCloseWorkbench}
            onFlushWorkspacePersistence={onFlush}
          >
            <DccRuntimeProbe />
          </StudioDccWorkbenchRoute>
        </StudioDocumentLayout>
      </StudioDocumentRuntimeBoundary>
    </MemoryRouter>
  );
}

function workbenchMountId(): string | undefined {
  return screen.getByTestId("dcc-runtime-probe").dataset.mountId;
}

describe("Studio DCC workbench route lifecycle", () => {
  it("keeps the DCC runtime mounted across canvas ↔ dcc switches and flushes only on leave", () => {
    nextWorkbenchProbeId = 0;
    const onCloseWorkbench = vi.fn();
    const onFlush = vi.fn();
    const view = render(
      <RoutedWorkbench
        pathname="/studio/work/work-1/canvas"
        onCloseWorkbench={onCloseWorkbench}
        onFlush={onFlush}
      />,
    );
    const initialMountId = workbenchMountId();
    expect(initialMountId).toBeTruthy();
    expect(onFlush).not.toHaveBeenCalled();

    view.rerender(
      <RoutedWorkbench
        pathname="/studio/work/work-1/3d/dcc/model"
        onCloseWorkbench={onCloseWorkbench}
        onFlush={onFlush}
      />,
    );
    // Entering the DCC surface must not rotate the runtime the editor subtree owns.
    expect(workbenchMountId()).toBe(initialMountId);
    expect(onFlush).not.toHaveBeenCalled();

    view.rerender(
      <RoutedWorkbench
        pathname="/studio/work/work-1/3d/dcc/sculpt"
        onCloseWorkbench={onCloseWorkbench}
        onFlush={onFlush}
      />,
    );
    // A mode switch stays on the same surface, so it neither remounts nor flushes.
    expect(workbenchMountId()).toBe(initialMountId);
    expect(onFlush).not.toHaveBeenCalled();

    view.rerender(
      <RoutedWorkbench
        pathname="/studio/work/work-1/canvas"
        onCloseWorkbench={onCloseWorkbench}
        onFlush={onFlush}
      />,
    );
    expect(workbenchMountId()).toBe(initialMountId);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onCloseWorkbench).not.toHaveBeenCalled();
  });

  it("arms the pagehide flush only while the DCC surface is mounted", () => {
    nextWorkbenchProbeId = 0;
    const onFlush = vi.fn();
    const view = render(
      <RoutedWorkbench
        pathname="/studio/work/work-1/canvas"
        onCloseWorkbench={() => {}}
        onFlush={onFlush}
      />,
    );
    act(() => {
      globalThis.dispatchEvent(new Event("pagehide"));
    });
    expect(onFlush).not.toHaveBeenCalled();

    view.rerender(
      <RoutedWorkbench
        pathname="/studio/work/work-1/3d/dcc/cad"
        onCloseWorkbench={() => {}}
        onFlush={onFlush}
      />,
    );
    act(() => {
      globalThis.dispatchEvent(new Event("pagehide"));
    });
    expect(onFlush).toHaveBeenCalledTimes(1);

    view.rerender(
      <RoutedWorkbench
        pathname="/studio/work/work-1/canvas"
        onCloseWorkbench={() => {}}
        onFlush={onFlush}
      />,
    );
    onFlush.mockClear();
    act(() => {
      globalThis.dispatchEvent(new Event("pagehide"));
    });
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("auto-closes the workbench when access is denied on the DCC surface only", () => {
    nextWorkbenchProbeId = 0;
    const onCloseWorkbench = vi.fn();
    const view = render(
      <RoutedWorkbench
        dccRouteAccess="denied"
        pathname="/studio/work/work-1/canvas"
        onCloseWorkbench={onCloseWorkbench}
        onFlush={() => {}}
      />,
    );
    expect(onCloseWorkbench).not.toHaveBeenCalled();

    view.rerender(
      <RoutedWorkbench
        dccRouteAccess="pending"
        pathname="/studio/work/work-1/3d/dcc/shot"
        onCloseWorkbench={onCloseWorkbench}
        onFlush={() => {}}
      />,
    );
    expect(onCloseWorkbench).not.toHaveBeenCalled();

    view.rerender(
      <RoutedWorkbench
        dccRouteAccess="denied"
        pathname="/studio/work/work-1/3d/dcc/shot"
        onCloseWorkbench={onCloseWorkbench}
        onFlush={() => {}}
      />,
    );
    expect(onCloseWorkbench).toHaveBeenCalledTimes(1);
  });
});

describe("resolved Studio route lifecycle", () => {
  it("retains state across same-work surfaces and replaces it for work/remix changes", () => {
    nextMountedProbeId = 0;
    const view = render(
      <ResolvedStudioRuntime pathname="/studio" search="?id=work-1" />,
    );
    const initialMountId = screen.getByTestId("document-probe").dataset.mountId;
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByTestId("edit-count").textContent).toBe("1");

    view.rerender(
      <ResolvedStudioRuntime pathname="/studio/work/work-1/comic" />,
    );
    expect(screen.getByTestId("document-probe").dataset.surface).toBe("comic");
    expect(screen.getByTestId("document-probe").dataset.mountId).toBe(initialMountId);
    expect(screen.getByTestId("edit-count").textContent).toBe("1");

    view.rerender(
      <ResolvedStudioRuntime pathname="/studio/work/work-1/3d/dcc/cad" />,
    );
    expect(screen.getByTestId("document-probe").dataset.surface).toBe("dcc");
    expect(screen.getByTestId("document-probe").dataset.mountId).toBe(initialMountId);
    expect(screen.getByTestId("edit-count").textContent).toBe("1");

    view.rerender(
      <ResolvedStudioRuntime pathname="/studio/work/work-2/canvas" />,
    );
    const secondWorkMountId = screen.getByTestId("document-probe").dataset.mountId;
    expect(secondWorkMountId).not.toBe(initialMountId);
    expect(screen.getByTestId("edit-count").textContent).toBe("0");

    view.rerender(
      <ResolvedStudioRuntime pathname="/studio/remix/source-1/animation" />,
    );
    const remixMountId = screen.getByTestId("document-probe").dataset.mountId;
    expect(remixMountId).not.toBe(secondWorkMountId);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));

    view.rerender(
      <ResolvedStudioRuntime pathname="/studio/remix/source-1/3d/dcc/shot" />,
    );
    expect(screen.getByTestId("document-probe").dataset.mountId).toBe(remixMountId);
    expect(screen.getByTestId("edit-count").textContent).toBe("1");

    view.rerender(
      <ResolvedStudioRuntime pathname="/studio/remix/source-2/canvas" />,
    );
    expect(screen.getByTestId("document-probe").dataset.mountId).not.toBe(remixMountId);
    expect(screen.getByTestId("edit-count").textContent).toBe("0");
  });
});
