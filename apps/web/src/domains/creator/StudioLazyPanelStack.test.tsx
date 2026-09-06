// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetStudioBg3dRetainedOwnerForTests } from "./bg3d/studio-bg3d-retained-owner";
import { StudioBg3dRetainedOwnerHost } from "./bg3d/StudioBg3dRetainedOwnerHost";
import { StudioDocumentRuntimeContext } from "./studio-router/studio-document-runtime-context";
import {
  StudioLazyPanelStack,
  type StudioLazyPanelStackHandlers,
  type StudioLazyPanelStackProps,
} from "./StudioLazyPanelStack";


import type { ReactElement } from "react";

const commentsSessionHarness = vi.hoisted(() => ({ nextInstanceId: 0 }));

vi.mock("./studio-page-lazy-ui", async () => {
  const { useState } = await import("react");
  const panel = (name: string) => () => (
    <div data-optional-panel={name}>{name}</div>
  );

  function MockStudioCommentsPanelSession({ commentsOpen }: { commentsOpen: boolean }) {
    const [instanceId] = useState(() => ++commentsSessionHarness.nextInstanceId);
    return (
      <div
        data-optional-panel="comments"
        data-open={String(commentsOpen)}
        data-instance-id={instanceId}
      />
    );
  }

  function MockStudioTeamPanel({
    followingSessionId = null,
    onToggleFollow,
  }: {
    followingSessionId?: string | null;
    onToggleFollow?: (sessionId: string) => void;
  }) {
    return (
      <div data-following-session={followingSessionId ?? "none"} data-optional-panel="team">
        <button type="button" onClick={() => onToggleFollow?.("peer-mobile-follow")}>
          팀 패널 참가자
        </button>
      </div>
    );
  }

  return {
    StudioAiProvenancePanel: panel("ai-provenance"),
    StudioAutoActionsPanel: panel("auto-actions"),
    StudioBackground3D: ({ onClose, onInsert }: { onClose: () => void; onInsert: (value: unknown) => void }) => (
      <div data-optional-panel="bg3d">
        <button type="button" onClick={() => onInsert({ kind: "bg3d" })}>BG3D 삽입</button>
        <button type="button" onClick={onClose}>BG3D 닫기</button>
      </div>
    ),
    StudioCharacterBiblePanel: panel("character-bible"),
    StudioCheckpointPanel: panel("checkpoint"),
    StudioColorWheelOverlay: panel("color-wheel"),
    StudioCommentsPanelSession: MockStudioCommentsPanelSession,
    StudioContinuityPanel: ({ documentKey, onSelectTarget, onSelectScene }: {
      documentKey?: string;
      onSelectTarget: (target: { pageId: string; elementId: string }) => void;
      onSelectScene: (sceneId: string) => void;
    }) => (
      <div data-optional-panel="continuity" data-document-key={documentKey ?? "none"}>
        <button type="button" onClick={() => onSelectTarget({ pageId: "quality-page", elementId: "quality-frame" })}>품질 문제 이동</button>
        <button type="button" onClick={() => onSelectScene("quality-scene")}>연속성 문제 이동</button>
      </div>
    ),
    StudioPageReviewPanel: panel("page-review"),
    StudioProductionInsightsPanel: panel("production-insights"),
    StudioPublicationOperationsPanel: panel("publication-operations"),
    StudioPublishPackagePanel: panel("publish-package"),
    StudioPublishPreflightPanel: panel("publish-preflight"),
    StudioQuickActionsMenu: panel("quick-actions"),
    StudioReferencePanel: panel("reference"),
    StudioScenarioAutoLayoutPanel: panel("scenario"),
    StudioScrollPreviewPanel: panel("scroll-preview"),
    StudioStoryboardGridPanel: panel("storyboard"),
    StudioTeamPanel: MockStudioTeamPanel,
    StudioTimelapsePanel: panel("timelapse"),
    StudioVrmPoser: ({
      initialScene,
      onClose,
      onInsert,
    }: {
      initialScene?: unknown;
      onClose: () => void;
      onInsert: (value: unknown) => void;
    }) => (
      <div data-optional-panel="vrm" data-has-initial-scene={String(Boolean(initialScene))}>
        <button type="button" onClick={() => onInsert({ kind: "vrm" })}>VRM 삽입</button>
        <button type="button" onClick={onClose}>VRM 닫기</button>
      </div>
    ),
    StudioWriterRoomPanel: panel("writer-room"),
    WorkFxPanel: panel("work-fx"),
  };
});

function createHandlers(): StudioLazyPanelStackHandlers {
  return {
    insertBg3dResult: vi.fn(async () => true),
    insertVrmResult: vi.fn(async () => true),
  } as unknown as StudioLazyPanelStackHandlers;
}

function createProps(
  overrides: Partial<StudioLazyPanelStackProps> = {},
): StudioLazyPanelStackProps {
  return {
    aiProvenanceOpen: false,
    autoActionsOpen: false,
    bg3dOpen: false,
    characterBibleOpen: false,
    checkpointPanelOpen: false,
    colorWheelOpen: false,
    commentsOpen: false,
    commentsPanelMounted: false,
    continuityOpen: false,
    elementById: new Map(),
    fxPanelOpen: false,
    isMobile: false,
    pageReviewOpen: false,
    pages: [],
    pagesHistory: [],
    poserVrmOpen: false,
    productionInsightsOpen: false,
    publicationOperationsOpen: false,
    publishPackageOpen: false,
    publishPreflightOpen: false,
    quickActionsOpen: false,
    recentColors: [],
    referencePanelOpen: false,
    scenarioOpen: false,
    scrollPreviewOpen: false,
    storyboardGridOpen: false,
    teamPanelOpen: false,
    timelapseOpen: false,
    validateRecoveryAccess: vi.fn(async () => true),
    quickActionsDisabledActions: new Set(),
    stableHandlers: createHandlers(),
    writerRoomOpen: false,
    ...overrides,
  } as unknown as StudioLazyPanelStackProps;
}

beforeEach(() => {
  commentsSessionHarness.nextInstanceId = 0;
});

afterEach(() => {
  cleanup();
  resetStudioBg3dRetainedOwnerForTests();
  vi.clearAllMocks();
});

function withRetainedBg3dHost(element: ReactElement) {
  return (
    <>
      <StudioBg3dRetainedOwnerHost />
      {element}
    </>
  );
}

describe("StudioLazyPanelStack", () => {
  it("does not mount optional surfaces while every open flag is false", () => {
    const view = render(withRetainedBg3dHost(<StudioLazyPanelStack {...createProps()} />));

    expect(view.container.querySelectorAll("[data-optional-panel]")).toHaveLength(0);
  });

  it("keeps one comments session instance mounted across close and reopen after activation", () => {
    const view = render(withRetainedBg3dHost(
      <StudioLazyPanelStack
        {...createProps({ commentsOpen: false, commentsPanelMounted: false })}
      />
    ));
    expect(view.container.querySelector('[data-optional-panel="comments"]')).toBeNull();

    view.rerender(withRetainedBg3dHost(
      <StudioLazyPanelStack
        {...createProps({ commentsOpen: true, commentsPanelMounted: true })}
      />
    ));
    const openedSession = view.container.querySelector('[data-optional-panel="comments"]');
    expect(openedSession?.getAttribute("data-open")).toBe("true");
    expect(openedSession?.getAttribute("data-instance-id")).toBe("1");

    view.rerender(withRetainedBg3dHost(
      <StudioLazyPanelStack
        {...createProps({ commentsOpen: false, commentsPanelMounted: true })}
      />
    ));
    const closedSession = view.container.querySelector('[data-optional-panel="comments"]');
    expect(closedSession).toBe(openedSession);
    expect(closedSession?.getAttribute("data-open")).toBe("false");
    expect(closedSession?.getAttribute("data-instance-id")).toBe("1");

    view.rerender(withRetainedBg3dHost(
      <StudioLazyPanelStack
        {...createProps({ commentsOpen: true, commentsPanelMounted: true })}
      />
    ));
    const reopenedSession = view.container.querySelector('[data-optional-panel="comments"]');
    expect(reopenedSession).toBe(openedSession);
    expect(reopenedSession?.getAttribute("data-open")).toBe("true");
    expect(reopenedSession?.getAttribute("data-instance-id")).toBe("1");
  });

  it("wires caller-owned follow state and toggle semantics into the Team panel", () => {
    const setFollowingStudioSessionId = vi.fn();
    render(withRetainedBg3dHost(
      <StudioLazyPanelStack
        {...createProps({
          followingStudioSessionId: "peer-mobile-follow",
          setFollowingStudioSessionId,
          teamPanelOpen: true,
        })}
      />
    ));

    expect(screen.getByText("팀 패널 참가자").parentElement?.dataset.followingSession).toBe(
      "peer-mobile-follow"
    );
    fireEvent.click(screen.getByRole("button", { name: "팀 패널 참가자" }));

    expect(setFollowingStudioSessionId).toHaveBeenCalledOnce();
    const update = setFollowingStudioSessionId.mock.calls[0]?.[0] as (
      current: string | null
    ) => string | null;
    expect(update("peer-mobile-follow")).toBeNull();
    expect(update(null)).toBe("peer-mobile-follow");
  });

  it("delegates semantic VRM insertion and clears the caller-owned initial scene on close", () => {
    const stableHandlers = createHandlers();
    const setPoserInitialDataUrl = vi.fn();
    const setPoserInitialElementId = vi.fn();
    const setPoserVrmOpen = vi.fn();
    const scene = { version: 2 };
    render(withRetainedBg3dHost(
      <StudioLazyPanelStack
        {...createProps({
          elementById: new Map([
            ["vrm-image", { id: "vrm-image", type: "image", vrmScene: scene } as never],
          ]),
          poserInitialElementId: "vrm-image",
          poserVrmOpen: true,
          setPoserInitialDataUrl,
          setPoserInitialElementId,
          setPoserVrmOpen,
          stableHandlers,
        })}
      />
    ));

    expect(screen.getByText("VRM 삽입").closest("[data-has-initial-scene]")?.getAttribute("data-has-initial-scene"))
      .toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "VRM 삽입" }));
    expect(stableHandlers.insertVrmResult).toHaveBeenCalledWith({ kind: "vrm" });

    fireEvent.click(screen.getByRole("button", { name: "VRM 닫기" }));
    expect(setPoserVrmOpen).toHaveBeenCalledWith(false);
    expect(setPoserInitialDataUrl).toHaveBeenCalledWith(undefined);
    expect(setPoserInitialElementId).toHaveBeenCalledWith(undefined);
  });

  it("delegates semantic BG3D insertion and clears every caller-owned initial value on close", () => {
    const stableHandlers = createHandlers();
    const setBg3dInitialDataUrl = vi.fn();
    const setBg3dInitialElementId = vi.fn();
    const setBg3dInitialScene = vi.fn();
    const setBg3dOpen = vi.fn();
    render(withRetainedBg3dHost(
      <StudioLazyPanelStack
        {...createProps({
          bg3dOpen: true,
          setBg3dInitialDataUrl,
          setBg3dInitialElementId,
          setBg3dInitialScene,
          setBg3dOpen,
          stableHandlers,
        })}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "BG3D 삽입" }));
    expect(stableHandlers.insertBg3dResult).toHaveBeenCalledWith({ kind: "bg3d" });

    fireEvent.click(screen.getByRole("button", { name: "BG3D 닫기" }));
    expect(setBg3dOpen).toHaveBeenCalledWith(false);
    expect(setBg3dInitialDataUrl).toHaveBeenCalledWith(undefined);
    expect(setBg3dInitialScene).toHaveBeenCalledWith(undefined);
    expect(setBg3dInitialElementId).toHaveBeenCalledWith(undefined);
  });
});


describe("quality inspection host navigation admission", () => {
  it.each([false, true])("preserves target ownership when page switch admission=%s", (admitted) => {
    const setCurrentPageId = vi.fn(() => admitted);
    const setTool = vi.fn();
    const setSelectedId = vi.fn();
    const setContinuityOpen = vi.fn();
    const props = createProps({
      continuityOpen: true,
      continuityIssues: [],
      continuityScenes: [{ id: "quality-scene", pageId: "quality-page", frameId: "quality-frame",
        label: "품질 장면", beat: { sceneId: "quality-scene" } }],
      studioComments: { version: 1, threads: [] },
      workId: null,
      title: "",
      setTool,
      setSelectedId,
      setContinuityOpen,
      stableHandlers: { ...createHandlers(), setCurrentPageId },
    });
    render(withRetainedBg3dHost(
      <StudioDocumentRuntimeContext.Provider value={{ documentKey: "auth:draft:unique", instanceId: "runtime" }}>
        <StudioLazyPanelStack {...props} />
      </StudioDocumentRuntimeContext.Provider>
    ));
    expect(screen.getByRole("button", { name: "품질 문제 이동" }).parentElement?.getAttribute("data-document-key"))
      .toBe("auth:draft:unique");
    fireEvent.click(screen.getByRole("button", { name: "품질 문제 이동" }));
    fireEvent.click(screen.getByRole("button", { name: "연속성 문제 이동" }));
    expect(setCurrentPageId).toHaveBeenCalledTimes(2);
    expect(setCurrentPageId).toHaveBeenCalledWith("quality-page");
    expect(setTool).toHaveBeenCalledTimes(admitted ? 2 : 0);
    expect(setSelectedId).toHaveBeenCalledTimes(admitted ? 2 : 0);
    expect(setContinuityOpen).toHaveBeenCalledTimes(admitted ? 2 : 0);
    if (admitted) expect(setSelectedId).toHaveBeenCalledWith("quality-frame");
  });
});
