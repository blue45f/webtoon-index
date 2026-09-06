// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStudioCompanionReviewProjection } from "./studio-companion-review-projection";
import {
  parseStudioCompanionMessage,
  startStudioCompanionPrimaryRuntime,
  type StudioCompanionMessage,
  type StudioCompanionPrimaryRuntime,
} from "./studio-tools-companion";
import { StudioToolsCompanionPage } from "./StudioToolsCompanionPage";

import { useI18n } from "@/shared/lib/i18n";

const SESSION_ID = "multi-window-session-1234";

class SharedBroadcastChannel {
  static readonly channels = new Map<string, Set<SharedBroadcastChannel>>();
  static readonly transcript: Array<{ data: unknown; sender: SharedBroadcastChannel }> = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  private closed = false;

  constructor(readonly name: string) {
    const peers = SharedBroadcastChannel.channels.get(name) ?? new Set<SharedBroadcastChannel>();
    peers.add(this);
    SharedBroadcastChannel.channels.set(name, peers);
  }

  postMessage(data: unknown): void {
    if (this.closed) return;
    SharedBroadcastChannel.transcript.push({ data, sender: this });
    for (const peer of SharedBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this || peer.closed) continue;
      peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onmessage = null;
    const peers = SharedBroadcastChannel.channels.get(this.name);
    peers?.delete(this);
    if (peers?.size === 0) SharedBroadcastChannel.channels.delete(this.name);
  }

  static reset(): void {
    for (const peers of SharedBroadcastChannel.channels.values()) {
      for (const peer of peers) {
        peer.closed = true;
        peer.onmessage = null;
      }
    }
    SharedBroadcastChannel.channels.clear();
    SharedBroadcastChannel.transcript.length = 0;
  }
}

function renderCompanion(surface: "workspace" | "navigator" | "review") {
  const view = surface === "workspace" ? "" : `&view=${surface}`;
  return render(
    <MemoryRouter initialEntries={[`/studio/tools-companion?session=${SESSION_ID}${view}`]}>
      <StudioToolsCompanionPage />
    </MemoryRouter>
  );
}

function messages(): StudioCompanionMessage[] {
  return SharedBroadcastChannel.transcript.flatMap(({ data }) => {
    const message = parseStudioCompanionMessage(data);
    return message ? [message] : [];
  });
}

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
let primaryRuntime: StudioCompanionPrimaryRuntime | null = null;

beforeEach(() => {
  useI18n.getState().setLang("ko");
  SharedBroadcastChannel.reset();
  vi.stubGlobal("BroadcastChannel", SharedBroadcastChannel);
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 960;
    width = 640;
    height = 960;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:multi-window-navigator-frame"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  primaryRuntime?.dispose();
  primaryRuntime = null;
  SharedBroadcastChannel.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("Studio tools companion multi-window integration", () => {
  it("propagates transient presentation-safe state between two companion windows", async () => {
    const storageRead = vi.spyOn(Storage.prototype, "getItem");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const workspaceView = renderCompanion("workspace");
    const navigatorView = renderCompanion("navigator");
    const workspace = within(workspaceView.container);
    const navigator = within(navigatorView.container);

    fireEvent.click(workspace.getByRole("button", { name: "발표 안전 켜기" }));

    await waitFor(() => {
      expect(workspace.getByRole("button", { name: "발표 안전 끄기" })).toBeTruthy();
      expect(navigator.getByRole("button", { name: "발표 안전 끄기" })).toBeTruthy();
    });
    expect(storageRead).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("keeps workspace, Navigator, and Review concurrently bound through one primary runtime", async () => {
    const onCommand = vi.fn();
    const onControl = vi.fn();
    const captureNavigatorFrame = vi.fn(async (request: {
      generation: number;
      revision: number;
      sequence: number;
      signal: AbortSignal;
    }) => request.signal.aborted
      ? null
      : {
          generation: request.generation,
          revision: request.revision,
          sequence: request.sequence,
          width: 640,
          height: 960,
          blob: new Blob(["multi-window-frame"], { type: "image/webp" }),
        });
    const projection = createStudioCompanionReviewProjection({
      revision: 1,
      documentRevision: 7,
      pageLabel: "멀티 모니터 원고",
      selectionLabel: "선화",
      canUndo: true,
      canRedo: false,
      captureAllowed: true,
      viewport: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      layers: [{ id: "layer-line", label: "선화", type: "draw", selected: true }],
      historyLength: 3,
      historyIndex: 2,
      comments: [{ id: "thread-review", author: "편집자", body: "표정을 확인해 주세요." }],
      brush: {
        id: "pen",
        label: "펜",
        size: 6,
        opacity: 1,
        color: "#112233",
        choices: [{ id: "pen", label: "펜" }],
      },
    });

    primaryRuntime = startStudioCompanionPrimaryRuntime({
      search: `?session=${SESSION_ID}`,
      getSnapshot: () => ({
        tool: "pen",
        density: "full",
        canvasOnly: false,
        title: "멀티 모니터 원고",
      }),
      getReviewProjection: () => projection,
      captureNavigatorFrame,
      onCommand,
      onControl,
    });
    expect(primaryRuntime).not.toBeNull();

    const workspaceView = renderCompanion("workspace");
    const navigatorView = renderCompanion("navigator");
    const reviewView = renderCompanion("review");
    const workspace = within(workspaceView.container);
    const navigator = within(navigatorView.container);
    const review = within(reviewView.container);

    await waitFor(() => {
      expect(workspace.getByText(/연결됨/u)).toBeTruthy();
      expect(navigator.getByText(/연결됨/u)).toBeTruthy();
      expect(review.getByText(/연결됨/u)).toBeTruthy();
      expect(primaryRuntime?.binding.activeBindings().map(({ surface }) => surface)).toEqual([
        "workspace",
        "navigator",
        "review",
      ]);
    });

    const workspaceId = primaryRuntime?.binding.companionInstanceId("workspace");
    const navigatorId = primaryRuntime?.binding.companionInstanceId("navigator");
    const reviewId = primaryRuntime?.binding.companionInstanceId("review");
    expect(new Set([workspaceId, navigatorId, reviewId]).size).toBe(3);
    for (const companionInstanceId of [workspaceId, navigatorId, reviewId]) {
      expect(messages()).toContainEqual(expect.objectContaining({
        type: "primary-state",
        targetCompanionInstanceId: companionInstanceId,
      }));
    }

    await waitFor(() => {
      expect(captureNavigatorFrame).toHaveBeenCalled();
      expect(navigator.getByRole("img", { name: "현재 페이지 전체 캔버스" })).toBeTruthy();
    });
    expect(messages()).toContainEqual(expect.objectContaining({
      type: "companion-control",
      companionInstanceId: navigatorId,
      control: { kind: "navigator-demand", active: true },
    }));
    expect(messages()).toContainEqual(expect.objectContaining({
      type: "navigator-frame",
      targetCompanionInstanceId: navigatorId,
      revision: projection.documentRevision,
    }));

    fireEvent.click(review.getByRole("tab", { name: /기록/u }));
    fireEvent.click(review.getByRole("button", { name: "실행 취소" }));
    expect(onControl).toHaveBeenLastCalledWith({ kind: "history", action: "undo" });

    navigatorView.unmount();
    expect(primaryRuntime?.binding.companionInstanceId("navigator")).toBeNull();
    expect(messages()).toContainEqual(expect.objectContaining({
      type: "companion-goodbye",
      companionInstanceId: navigatorId,
      surface: "navigator",
    }));
    expect(workspace.getByText(/연결됨/u)).toBeTruthy();
    expect(review.getByText(/연결됨/u)).toBeTruthy();

    const replacementNavigatorView = renderCompanion("navigator");
    const replacementNavigator = within(replacementNavigatorView.container);
    await waitFor(() => {
      expect(replacementNavigator.getByText(/연결됨/u)).toBeTruthy();
      expect(primaryRuntime?.binding.companionInstanceId("navigator")).not.toBe(navigatorId);
      expect(primaryRuntime?.generation("navigator")).toBe(2);
    });
    fireEvent.click(workspace.getByRole("button", { name: "지우개" }));
    expect(onCommand).toHaveBeenLastCalledWith("eraser");
    fireEvent.click(review.getByRole("button", { name: "실행 취소" }));
    expect(onControl).toHaveBeenLastCalledWith({ kind: "history", action: "undo" });
  });
});
