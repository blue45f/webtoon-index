// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStudioCompanionReviewProjection } from "./studio-companion-review-projection";
import {
  buildStudioCompanionNavigatorFrame,
  buildStudioCompanionPing,
  buildStudioCompanionPresentationSafe,
  buildStudioCompanionPrimaryGoodbye,
  buildStudioCompanionReferenceColorResult,
  buildStudioCompanionReferencePreviewFrame,
  buildStudioCompanionReferenceState,
  buildStudioCompanionReviewState,
  isStudioCompanionSessionId,
  studioCompanionChannelName,
  type StudioCompanionMessage,
} from "./studio-tools-companion";
import { StudioToolsCompanionPage } from "./StudioToolsCompanionPage";

import { useI18n } from "@/shared/lib/i18n";

class FakeBroadcastChannel {
  static readonly instances: FakeBroadcastChannel[] = [];

  readonly postMessage = vi.fn();
  readonly close = vi.fn(() => {
    this.closed = true;
    this.onmessage = null;
  });
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  emit(data: unknown) {
    if (this.closed) return;
    this.onmessage?.({ data } as MessageEvent);
  }
}

const sessionId = "primary-a-1234";
const sessionIdB = "primary-b-5678";
const primaryInstanceA = "primary-instance-a-1234";
const primaryInstanceB = "primary-instance-b-5678";
const companionPeerB = "companion-peer-b-5678";
const companionPeerC = "companion-peer-c-9012";
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function installObjectUrlSpies() {
  const createObjectURL = vi.fn((blob: Blob) => `blob:frame-${blob.size}-${createObjectURL.mock.calls.length}`);
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

function restoreObjectUrlStatics() {
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
}

function referenceWebpBlob(width: number, height: number): Blob {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 22, true);
  writeAscii(8, "WEBP");
  writeAscii(12, "VP8X");
  view.setUint32(16, 10, true);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes.set([
    widthMinusOne & 0xff,
    (widthMinusOne >>> 8) & 0xff,
    (widthMinusOne >>> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >>> 8) & 0xff,
    (heightMinusOne >>> 16) & 0xff,
  ], 24);
  return new Blob([bytes], { type: "image/webp" });
}

function renderCompanion(entry = `/studio/tools-companion?session=${sessionId}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StudioToolsCompanionPage />
    </MemoryRouter>
  );
}

function companionInstanceId(channel: FakeBroadcastChannel): string {
  const hello = channel.postMessage.mock.calls
    .map(([message]) => message as StudioCompanionMessage)
    .find((message) => message.type === "hello" && message.role === "companion");
  if (!hello || hello.role !== "companion") throw new Error("companion hello missing");
  return hello.companionInstanceId;
}

function latestProtocolChannel(targetSessionId: string): FakeBroadcastChannel {
  const channel = FakeBroadcastChannel.instances.findLast(
    (candidate) => candidate.name === studioCompanionChannelName(targetSessionId),
  );
  if (!channel) throw new Error(`companion channel missing for ${targetSessionId}`);
  return channel;
}

function projectedReview(input: {
  revision?: number;
  documentRevision?: number;
  captureAllowed?: boolean;
} = {}) {
  return createStudioCompanionReviewProjection({
    revision: input.revision ?? 1,
    documentRevision: input.documentRevision ?? 5,
    pageLabel: "1화",
    selectionLabel: "선화",
    canUndo: true,
    canRedo: true,
    captureAllowed: input.captureAllowed ?? true,
    viewport: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
    layers: [{ id: "layer-1", label: "주인공 선화", type: "draw", selected: true }],
    historyLength: 3,
    historyIndex: 2,
    comments: [{ id: "thread-1", author: "편집자", body: "표정 확인", unread: true }],
    brush: {
      id: "pen",
      label: "펜",
      size: 6,
      opacity: 1,
      color: "#112233",
      choices: [{ id: "pencil", label: "연필" }],
    },
  });
}

function connectPrimary(input: {
  channel: FakeBroadcastChannel;
  companionInstance: string;
  primaryInstance?: string;
  generation?: number;
  projection?: ReturnType<typeof projectedReview>;
}) {
  const primaryInstance = input.primaryInstance ?? primaryInstanceA;
  const projection = input.projection ?? projectedReview();
  act(() => {
    input.channel.emit({
      v: 1,
      type: "hello",
      role: "primary",
      primaryInstanceId: primaryInstance,
      targetCompanionInstanceId: input.companionInstance,
      at: Date.now(),
    });
    input.channel.emit({
      v: 1,
      type: "primary-state",
      primaryInstanceId: primaryInstance,
      targetCompanionInstanceId: input.companionInstance,
      tool: "pen",
      density: "full",
      canvasOnly: false,
      title: "1화",
      at: Date.now(),
    });
    input.channel.emit(buildStudioCompanionReviewState({
      primaryInstanceId: primaryInstance,
      targetCompanionInstanceId: input.companionInstance,
      generation: input.generation ?? 1,
      projection,
    }));
  });
  return { primaryInstance, projection };
}

function connectReferencePrimary(input: {
  channel: FakeBroadcastChannel;
  companionInstance: string;
  generation?: number;
  revision?: number;
  referenceRevision?: number;
  itemCount?: number;
  resolvedItemCount?: number;
}) {
  const generation = input.generation ?? 1;
  act(() => {
    input.channel.emit({
      v: 1,
      type: "hello",
      role: "primary",
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: input.companionInstance,
      at: Date.now(),
    });
    input.channel.emit({
      v: 1,
      type: "primary-state",
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: input.companionInstance,
      tool: "pen",
      density: "full",
      canvasOnly: false,
      title: "레퍼런스 작업",
      at: Date.now(),
    });
    input.channel.emit(buildStudioCompanionReferenceState({
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: input.companionInstance,
      generation,
      projection: {
        generation,
        revision: input.revision ?? 1,
        referenceRevision: input.referenceRevision ?? 1,
        itemCount: input.itemCount ?? 0,
        resolvedItemCount: input.resolvedItemCount ?? 0,
        canPickColor: (input.resolvedItemCount ?? 0) > 0,
      },
    }));
  });
}

function navigatorFrame(input: {
  primaryInstance?: string;
  companionInstance: string;
  generation?: number;
  revision?: number;
  sequence?: number;
  marker?: string;
}) {
  return buildStudioCompanionNavigatorFrame({
    primaryInstanceId: input.primaryInstance ?? primaryInstanceA,
    targetCompanionInstanceId: input.companionInstance,
    frame: {
      generation: input.generation ?? 1,
      revision: input.revision ?? 5,
      sequence: input.sequence ?? 1,
      width: 640,
      height: 960,
      blob: new Blob([input.marker ?? "frame"], { type: "image/webp" }),
    },
  });
}

async function emitDecodedNavigatorFrame(
  channel: FakeBroadcastChannel,
  message: ReturnType<typeof navigatorFrame>
) {
  await act(async () => {
    channel.emit(message);
    await Promise.resolve();
  });
}

function SessionSwitchHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => navigate(`/studio/tools-companion?session=${sessionIdB}`)}
      >
        세션 전환
      </button>
      <StudioToolsCompanionPage />
    </>
  );
}

beforeEach(() => {
  useI18n.getState().setLang("ko");
  FakeBroadcastChannel.instances.length = 0;
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 960;
    width = 640;
    height = 960;

    set src(_value: string) {
      this.onload?.();
    }
  });
  window.history.replaceState(null, "", `/studio/tools-companion?session=${sessionId}`);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "getScreenDetails");
  restoreObjectUrlStatics();
});

describe("StudioToolsCompanionPage", () => {
  it("refuses a missing or malformed session instead of joining a global channel", () => {
    renderCompanion("/studio/tools-companion");

    expect(screen.getByRole("alert").textContent).toContain("유효한 분리 세션이 없습니다");
    expect(FakeBroadcastChannel.instances).toHaveLength(0);
  });

  it("reuses one companion identity across StrictMode effect replay and connects immediately", () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/studio/tools-companion?session=${sessionId}`]}>
          <StudioToolsCompanionPage />
        </MemoryRouter>
      </StrictMode>
    );

    expect(FakeBroadcastChannel.instances).toHaveLength(2);
    const helloInstanceIds = FakeBroadcastChannel.instances.flatMap((channel) => (
      channel.postMessage.mock.calls
        .map(([message]) => message as StudioCompanionMessage)
        .filter((message): message is Extract<
          StudioCompanionMessage,
          { type: "hello"; role: "companion" }
        > => message.type === "hello" && message.role === "companion")
        .map((message) => message.companionInstanceId)
    ));
    expect(helloInstanceIds).toHaveLength(2);
    expect(new Set(helloInstanceIds)).toEqual(new Set([helloInstanceIds[0]]));

    const activeChannel = FakeBroadcastChannel.instances[1]!;
    connectPrimary({
      channel: activeChannel,
      companionInstance: helloInstanceIds[0]!,
    });
    expect(screen.getByText(/연결됨 · 1화/u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "펜" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("binds to its primary session and sends commands only after a primary responds", () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0];
    expect(channel?.name).toBe(studioCompanionChannelName(sessionId));
    expect((screen.getByRole("button", { name: "말풍선" }) as HTMLButtonElement).disabled).toBe(true);
    const companionInstance = companionInstanceId(channel!);
    expect(isStudioCompanionSessionId(companionInstance)).toBe(true);

    act(() => {
      channel?.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: null,
        at: Date.now(),
      });
      channel?.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "pen",
        density: "focus",
        canvasOnly: true,
        title: "에피소드 A",
        at: Date.now(),
      });
      channel?.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        at: Date.now(),
      });
      channel?.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceB,
        targetCompanionInstanceId: companionInstance,
        at: Date.now(),
      });
      channel?.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceB,
        targetCompanionInstanceId: companionInstance,
        tool: "eraser",
        density: "simple",
        canvasOnly: false,
        title: "오염되면 안 되는 B",
        at: Date.now(),
      });
    });

    expect(screen.getByText(/연결됨 · 에피소드 A/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "펜" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/밀도 focus/u)).toBeTruthy();
    expect(channel?.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "hello",
      role: "companion",
      companionInstanceId: companionInstance,
      targetPrimaryInstanceId: primaryInstanceA,
    }));
    const targetedHelloCount = channel?.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => (
        message.type === "hello"
        && message.role === "companion"
        && message.targetPrimaryInstanceId === primaryInstanceA
      )).length;
    expect(targetedHelloCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "말풍선" }));
    expect(channel?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 1,
        type: "companion-command",
        command: "bubble",
        companionInstanceId: companionInstance,
        targetPrimaryInstanceId: primaryInstanceA,
        sequence: 1,
      })
    );

    const drawPreset = screen.getByRole("button", { name: /작화 집중/u });
    expect(drawPreset.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /전체 탐색/u }));
    expect(channel?.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-command",
      command: "enter-canvas-only",
      companionInstanceId: companionInstance,
      targetPrimaryInstanceId: primaryInstanceA,
    }));
    const navigatorTab = screen.getByRole("tab", { name: "Navigator" });
    expect(navigatorTab.getAttribute("aria-selected")).toBe("true");
    expect(navigatorTab.className).toContain("min-w-0");
    expect(within(navigatorTab).getByText("Navigator").className)
      .toContain("min-[390px]:inline");

    fireEvent.click(screen.getByRole("tab", { name: "도구" }));
    fireEvent.click(screen.getByRole("button", { name: /기본 배치.*검수/u }));
    expect(channel?.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-command",
      command: "exit-canvas-only",
      companionInstanceId: companionInstance,
      targetPrimaryInstanceId: primaryInstanceA,
    }));
    expect(screen.getByRole("tab", { name: "검수" }).getAttribute("aria-selected"))
      .toBe("true");
  });

  it("removes the primary document title from the entire DOM in presentation-safe mode", () => {
    const view = renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    const secretTitle = "미공개 계약작 7화";
    act(() => {
      channel.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "pen",
        density: "full",
        canvasOnly: false,
        title: secretTitle,
        at: Date.now(),
      });
    });
    expect(view.container.textContent).toContain(secretTitle);

    fireEvent.click(screen.getByRole("tab", { name: "검수" }));
    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));

    expect(view.container.textContent).not.toContain(secretTitle);
    expect(view.container.querySelector("header [role='status']")?.textContent)
      .toContain("연결됨 · 발표 안전");
    expect(screen.getByText("스튜디오")).toBeTruthy();
  });

  it("immediately rediscovers a disconnected primary when presentation-safe is disabled without sending stale demand", () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));
    channel.postMessage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 끄기" }));

    const messages = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage);
    expect(messages.filter((message) => message.type === "hello")).toEqual([
      expect.objectContaining({
        type: "hello",
        role: "companion",
        companionInstanceId: companionInstance,
        targetPrimaryInstanceId: null,
      }),
    ]);
    expect(messages.filter((message) => message.type === "ping")).toHaveLength(0);
    expect(messages.filter((message) => message.type === "companion-control")).toHaveLength(0);
  });

  it("immediately pings a known reconnecting primary without sending demand before generation is verified", () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));
    act(() => {
      channel.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        at: Date.now(),
      });
    });
    channel.postMessage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 끄기" }));

    const messages = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage);
    expect(messages.filter((message) => message.type === "ping")).toEqual([
      expect.objectContaining({
        type: "ping",
        companionInstanceId: companionInstance,
        targetPrimaryInstanceId: primaryInstanceA,
      }),
    ]);
    expect(messages.filter((message) => message.type === "hello")).toHaveLength(0);
    expect(messages.filter((message) => message.type === "companion-control")).toHaveLength(0);
  });

  it("does not duplicate discovery or heartbeat when a connected Navigator resumes demand", () => {
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=navigator`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));
    channel.postMessage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 끄기" }));

    const messages = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage);
    expect(messages.filter((message) => message.type === "hello")).toHaveLength(0);
    expect(messages.filter((message) => message.type === "ping")).toHaveLength(0);
    expect(messages.filter((message) => (
      message.type === "companion-control"
      && message.control.kind === "navigator-demand"
    ))).toEqual([
      expect.objectContaining({
        generation: 1,
        control: { kind: "navigator-demand", active: true },
      }),
    ]);
  });

  it("demands navigator frames only while the Navigator tab is active", () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    const demandMessages = () => channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => (
        message.type === "companion-control"
        && message.control.kind === "navigator-demand"
      ));

    expect(demandMessages()).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Navigator" }));
    expect(demandMessages()).toHaveLength(1);
    expect(demandMessages()[0]).toMatchObject({
      control: { kind: "navigator-demand", active: true },
      generation: 1,
    });

    fireEvent.click(screen.getByRole("tab", { name: "도구" }));
    expect(demandMessages()).toHaveLength(2);
    expect(demandMessages()[1]).toMatchObject({
      control: { kind: "navigator-demand", active: false },
      generation: 1,
    });
  });

  it("stops Navigator capture, revokes its URL, and rejects a late frame in presentation-safe mode", async () => {
    const { createObjectURL, revokeObjectURL } = installObjectUrlSpies();
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    fireEvent.click(screen.getByRole("tab", { name: "Navigator" }));
    const demandMessages = () => channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => (
        message.type === "companion-control"
        && message.control.kind === "navigator-demand"
      ));

    await emitDecodedNavigatorFrame(
      channel,
      navigatorFrame({ companionInstance, sequence: 1 })
    );
    expect(screen.getByRole("img", { name: "현재 페이지 전체 캔버스" })).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));

    expect(screen.getByRole("heading", { name: "Navigator 발표 안전 모드" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "현재 페이지 전체 캔버스" })).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(demandMessages().map((message) => (
      message.type === "companion-control" ? message.control : null
    ))).toEqual([
      { kind: "navigator-demand", active: true },
      { kind: "navigator-demand", active: false },
    ]);

    act(() => channel.emit(navigatorFrame({ companionInstance, sequence: 2, marker: "late" })));
    expect(createObjectURL).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 끄기" }));
    expect(screen.queryByRole("heading", { name: "Navigator 발표 안전 모드" })).toBeNull();
    expect(demandMessages().at(-1)).toEqual(expect.objectContaining({
      control: { kind: "navigator-demand", active: true },
    }));
  });

  it("uses the same presentation-safe Navigator placeholder in a dedicated window", () => {
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=navigator`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));

    expect(screen.getByRole("heading", { name: "Navigator 발표 안전 모드" })).toBeTruthy();
    const demands = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => (
        message.type === "companion-control"
        && message.control.kind === "navigator-demand"
      ));
    expect(demands.at(-1)).toEqual(expect.objectContaining({
      control: { kind: "navigator-demand", active: false },
    }));
  });

  it("mounts the reference surface only while its workspace tab is active and releases demand", async () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectReferencePrimary({ channel, companionInstance });
    const referenceDemands = () => channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => (
        message.type === "companion-control"
        && message.control.kind === "reference-preview-demand"
      ));

    expect(screen.queryByRole("heading", { name: "레퍼런스 전용 화면" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "레퍼런스" }));

    expect(await screen.findByRole("heading", { name: "레퍼런스 전용 화면" })).toBeTruthy();
    await waitFor(() => expect(referenceDemands()).toEqual([
      expect.objectContaining({
        generation: 1,
        control: { kind: "reference-preview-demand", active: true },
      }),
    ]));

    fireEvent.click(screen.getByRole("tab", { name: "도구" }));
    await waitFor(() => expect(referenceDemands()).toEqual([
      expect.objectContaining({ control: { kind: "reference-preview-demand", active: true } }),
      expect.objectContaining({ control: { kind: "reference-preview-demand", active: false } }),
    ]));
    expect(screen.queryByRole("heading", { name: "레퍼런스 전용 화면" })).toBeNull();
  });

  it("never treats another companion ping as primary activity", () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;

    act(() => {
      channel.emit(buildStudioCompanionPing({
        companionInstanceId: "companion-b-5678",
        targetPrimaryInstanceId: primaryInstanceA,
        nonce: "ping-nonce-1234",
      }));
    });

    expect(screen.getByText(/연결 대기/u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "펜" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a losing companion candidate disabled until targeted state confirms the handshake", () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    act(() => {
      channel.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: null,
        at: Date.now(),
      });
    });

    expect(screen.getByText(/연결 대기/u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "펜" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("expires a closed primary and offers a same-session reattach link", () => {
    vi.useFakeTimers();
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0];
    const companionInstance = companionInstanceId(channel!);

    act(() => {
      channel?.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        at: Date.now(),
      });
      channel?.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "select",
        density: "full",
        canvasOnly: false,
        title: "에피소드 A",
        at: Date.now(),
      });
    });
    expect(screen.getByText(/연결됨/u)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(16_001);
    });

    expect(screen.getByText(/연결 대기/u)).toBeTruthy();
    const discoveryHellos = channel?.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => (
        message.type === "hello"
        && message.role === "companion"
        && message.targetPrimaryInstanceId === null
      ));
    expect(discoveryHellos?.length).toBeGreaterThanOrEqual(2);
    const reconnect = screen.getByRole("link", { name: "스튜디오 다시 연결" });
    expect(reconnect.getAttribute("href")).toBe(`http://localhost:3000/studio?session=${sessionId}`);
    expect(reconnect.getAttribute("target")).toBe("_blank");

    act(() => {
      channel?.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceB,
        targetCompanionInstanceId: null,
        at: Date.now(),
      });
      channel?.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceB,
        targetCompanionInstanceId: companionInstance,
        tool: "select",
        density: "full",
        canvasOnly: false,
        title: "에피소드 B",
        at: Date.now(),
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "펜" }));
    expect(channel?.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-command",
      targetPrimaryInstanceId: primaryInstanceB,
    }));
    expect(channel?.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "hello",
      role: "companion",
      targetPrimaryInstanceId: primaryInstanceB,
    }));
  });

  it("disconnects immediately only for an exact fresh primary goodbye", async () => {
    const { revokeObjectURL } = installObjectUrlSpies();
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=navigator`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    await emitDecodedNavigatorFrame(channel, navigatorFrame({ companionInstance }));
    expect(screen.getByText(/연결됨/u)).toBeTruthy();
    expect(screen.getByAltText("현재 페이지 전체 캔버스")).toBeTruthy();

    const goodbye = buildStudioCompanionPrimaryGoodbye({
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: companionInstance,
      surface: "navigator",
    });
    act(() => {
      channel.emit({ ...goodbye, at: Date.now() - 30_001 });
      channel.emit({ ...goodbye, primaryInstanceId: primaryInstanceB });
      channel.emit({ ...goodbye, targetCompanionInstanceId: "other-companion-5678" });
      channel.emit({ ...goodbye, surface: "review" });
    });
    expect(screen.getByText(/연결됨/u)).toBeTruthy();
    expect(screen.getByAltText("현재 페이지 전체 캔버스")).toBeTruthy();

    act(() => channel.emit(goodbye));

    expect(screen.getByText(/연결 대기/u)).toBeTruthy();
    expect(screen.queryByAltText("현재 페이지 전체 캔버스")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "스튜디오 다시 연결" })).toBeTruthy();
  });

  it("does not refresh primary liveness for a pong with the wrong nonce", () => {
    vi.useFakeTimers();
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    act(() => {
      channel.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        at: Date.now(),
      });
      channel.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "select",
        density: "full",
        canvasOnly: false,
        title: "에피소드 A",
        at: Date.now(),
      });
      vi.advanceTimersByTime(8_000);
      channel.emit({
        v: 1,
        type: "pong",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        nonce: "wrong-nonce-1234",
        at: Date.now(),
      });
      vi.advanceTimersByTime(8_001);
    });

    expect(screen.getByText(/연결 대기/u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "펜" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps command sequence monotonic across stale and same-primary re-handshake", () => {
    vi.useFakeTimers();
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    act(() => {
      channel.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        at: Date.now(),
      });
      channel.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "select",
        density: "full",
        canvasOnly: false,
        title: "에피소드 A",
        at: Date.now(),
      });
    });
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: index % 2 === 0 ? "펜" : "선택" }));
    }
    act(() => {
      vi.advanceTimersByTime(16_001);
      channel.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        at: Date.now(),
      });
      channel.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "select",
        density: "full",
        canvasOnly: false,
        title: "에피소드 A",
        at: Date.now(),
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "펜" }));

    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-command",
      companionInstanceId: companionInstance,
      targetPrimaryInstanceId: primaryInstanceA,
      sequence: 11,
    }));
  });

  it("fully resets peer, title, tool, density and errors when the router session changes", () => {
    render(
      <MemoryRouter initialEntries={[`/studio/tools-companion?session=${sessionId}`]}>
        <SessionSwitchHarness />
      </MemoryRouter>
    );
    const first = FakeBroadcastChannel.instances[0]!;
    const firstCompanion = companionInstanceId(first);
    act(() => {
      first.emit({
        v: 1,
        type: "hello",
        role: "primary",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: firstCompanion,
        at: Date.now(),
      });
      first.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: firstCompanion,
        tool: "pen",
        density: "focus",
        canvasOnly: true,
        title: "이전 문서",
        at: Date.now(),
      });
    });
    expect(screen.getByText(/연결됨 · 이전 문서/u)).toBeTruthy();
    first.postMessage.mockImplementationOnce(() => {
      throw new Error("send failed");
    });
    fireEvent.click(screen.getByRole("button", { name: "펜" }));
    expect(screen.getByRole("alert").textContent).toContain("채널 전송에 실패");

    fireEvent.click(screen.getByRole("button", { name: "세션 전환" }));

    expect(first.close).toHaveBeenCalledOnce();
    expect(FakeBroadcastChannel.instances.filter((channel) => (
      channel.name === studioCompanionChannelName(sessionId)
      || channel.name === studioCompanionChannelName(sessionIdB)
    ))).toHaveLength(2);
    const second = latestProtocolChannel(sessionIdB);
    expect(second.name).toBe(studioCompanionChannelName(sessionIdB));
    expect(screen.getByText(/연결 대기/u)).toBeTruthy();
    expect(screen.queryByText(/이전 문서/u)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/밀도 full/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "선택" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "펜" }) as HTMLButtonElement).disabled).toBe(true);
    expect(companionInstanceId(second)).not.toBe(firstCompanion);
  });

  it("closes matching same-origin dedicated windows when the workspace session changes", () => {
    const popups: Array<{ close: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; location: { href: string } }> = [];
    vi.spyOn(window, "open").mockImplementation((url) => {
      const popup = {
        closed: false,
        close: vi.fn(),
        focus: vi.fn(),
        location: { href: String(url) },
      };
      popups.push(popup);
      return popup as unknown as Window;
    });
    render(
      <MemoryRouter initialEntries={[`/studio/tools-companion?session=${sessionId}`]}>
        <SessionSwitchHarness />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Navigator 전용 창 열기 또는 앞으로 가져오기",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "검수 전용 창 열기 또는 앞으로 가져오기",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "레퍼런스 전용 창 열기 또는 앞으로 가져오기",
    }));
    expect(popups).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "세션 전환" }));

    expect(popups[0]?.close).toHaveBeenCalledOnce();
    expect(popups[1]?.close).toHaveBeenCalledOnce();
    expect(popups[2]?.close).toHaveBeenCalledOnce();
  });

  it("never closes dedicated handles that the user navigated away before a session change", () => {
    const popups: Array<{ close: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; location: { href: string } }> = [];
    vi.spyOn(window, "open").mockImplementation((url) => {
      const popup = {
        closed: false,
        close: vi.fn(),
        focus: vi.fn(),
        location: { href: String(url) },
      };
      popups.push(popup);
      return popup as unknown as Window;
    });
    render(
      <MemoryRouter initialEntries={[`/studio/tools-companion?session=${sessionId}`]}>
        <SessionSwitchHarness />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Navigator 전용 창 열기 또는 앞으로 가져오기",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "검수 전용 창 열기 또는 앞으로 가져오기",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "레퍼런스 전용 창 열기 또는 앞으로 가져오기",
    }));
    popups[0]!.location.href = "https://example.com/user-document";
    popups[1]!.location.href = "http://localhost:3000/unrelated-page";
    popups[2]!.location.href = "https://example.com/reference-board";

    fireEvent.click(screen.getByRole("button", { name: "세션 전환" }));

    expect(popups[0]?.close).not.toHaveBeenCalled();
    expect(popups[1]?.close).not.toHaveBeenCalled();
    expect(popups[2]?.close).not.toHaveBeenCalled();
  });

  it("does not close a matching dedicated window on an ordinary workspace unmount", () => {
    const popup = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: `http://localhost:3000/studio/tools-companion?session=${sessionId}&view=navigator` },
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const view = renderCompanion();
    fireEvent.click(screen.getByRole("button", {
      name: "Navigator 전용 창 열기 또는 앞으로 가져오기",
    }));

    view.unmount();

    expect(popup.close).not.toHaveBeenCalled();
  });

  it("keeps status live, touch actions at least 44px, and safe-area padding on small screens", () => {
    renderCompanion(`/studio/tools-companion?session=${sessionId}&remix=source-456`);
    const status = document.querySelector<HTMLElement>("header [role='status']");
    if (!status) throw new Error("companion connection status is missing");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "기본 탭 앞으로" }).className).toContain("min-h-11");
    const companionRoot = screen.getByTestId("studio-tools-companion-root");
    expect(companionRoot.className).toContain("safe-area-inset");
    expect(companionRoot.className).toContain("h-dvh");
    expect(companionRoot.className).toContain("overflow-y-auto");
    expect(screen.getByRole("button", { name: "현재 위치 저장" }).hasAttribute("disabled"))
      .toBe(true);
    expect(screen.getByRole("link", { name: "스튜디오 다시 연결" }).getAttribute("href")).toBe(
      `http://localhost:3000/studio?session=${sessionId}&remix=source-456`
    );
    const toolsTab = screen.getByRole("tab", { name: "도구" });
    fireEvent.keyDown(toolsTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Navigator" }).getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("companion-mode-panel-tools")?.hidden).toBe(true);
    expect(document.getElementById("companion-mode-panel-navigator")?.hidden).toBe(false);
  });

  it("keeps a canonical-path work scope in reconnect and dedicated popup URLs", () => {
    const open = vi.spyOn(window, "open").mockImplementation((url) => ({
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: String(url) },
    }) as unknown as Window);
    renderCompanion(
      `/studio/tools-companion?session=${sessionId}&id=work%2F%ED%95%9C%EA%B8%80`,
    );

    expect(screen.getByRole("link", { name: "스튜디오 다시 연결" }).getAttribute("href")).toBe(
      `http://localhost:3000/studio/work/work%2F%ED%95%9C%EA%B8%80/canvas?session=${sessionId}`,
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Navigator 전용 창 열기 또는 앞으로 가져오기",
    }));
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/studio\/tools-companion\?session=primary-a-1234&id=work%2F%ED%95%9C%EA%B8%80&view=navigator/u,
      ),
      "toonspectrum-studio-tools-primary-a-1234-navigator",
      expect.any(String),
    );
  });

  it("rejects duplicate work scopes without joining the primary channel", () => {
    renderCompanion(
      `/studio/tools-companion?session=${sessionId}&id=work-1&id=work-1`,
    );
    expect(screen.getByRole("alert").textContent).toContain("유효한 작품 범위가 없습니다");
    expect(FakeBroadcastChannel.instances).toHaveLength(0);
  });

  it("rejects an invalid or duplicated surface without opening a channel", () => {
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=navigator&view=review`);

    expect(screen.getByRole("alert").textContent).toContain("유효한 컴패니언 보기 모드가 없습니다");
    expect(FakeBroadcastChannel.instances).toHaveLength(0);
  });

  it("locks a dedicated Navigator surface, omits workspace tabs, and demands frames immediately", () => {
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=navigator`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);

    expect(screen.queryByRole("tablist", { name: "컴패니언 모드" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "캔버스 내비게이터" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "펜" })).toBeNull();
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "hello",
      role: "companion",
      view: "navigator",
    }));

    connectPrimary({ channel, companionInstance });
    const demands = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => message.type === "companion-control" && message.control.kind === "navigator-demand");
    expect(demands).toEqual([
      expect.objectContaining({ control: { kind: "navigator-demand", active: true } }),
    ]);
    expect(screen.getByRole("button", { name: "전체 캔버스 미리보기에서 보이는 위치 이동" }).className)
      .toContain("100dvh");
  });

  it("locks a dedicated review surface without requesting Navigator frames", () => {
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=review`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);

    connectPrimary({ channel, companionInstance });

    expect(screen.queryByRole("tablist", { name: "컴패니언 모드" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "검수 콘솔" })).toBeTruthy();
    expect(document.getElementById("companion-mode-panel-review")?.className).toContain("flex-1");
    expect(channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .some((message) => message.type === "companion-control" && message.control.kind === "navigator-demand"))
      .toBe(false);
  });

  it("locks a dedicated reference surface and hides its preview in presentation-safe mode", async () => {
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=reference`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);

    connectReferencePrimary({ channel, companionInstance });

    expect(screen.queryByRole("tablist", { name: "컴패니언 모드" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "레퍼런스 화면" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "레퍼런스 전용 화면" })).toBeTruthy();
    await waitFor(() => expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-control",
      generation: 1,
      control: { kind: "reference-preview-demand", active: true },
    })));

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));

    expect(screen.getByRole("heading", { name: "발표 안전 모드" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "레퍼런스 전용 화면" })).toBeNull();
    await waitFor(() => expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-control",
      generation: 1,
      control: { kind: "reference-preview-demand", active: false },
    })));
  });

  it("keeps the 320x640 dedicated Reference surface inside the root scroll boundary", () => {
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", 640);
    const view = renderCompanion(
      `/studio/tools-companion?session=${sessionId}&view=reference`
    );

    const root = view.container.firstElementChild as HTMLElement;
    const panel = document.getElementById("companion-mode-panel-reference")!;
    const transportNote = screen.getByText(/편집 문서는 기본 탭만 소유합니다/u);
    expect(root.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("min-h-[29rem]");
    expect(panel.className).toContain("flex-1");
    expect(transportNote.className).toContain("shrink-0");
  });

  it("opens each dedicated surface synchronously from an explicit 44px workspace action", () => {
    const popup = {
      closed: false,
      focus: vi.fn(),
      location: { href: "about:blank" },
    } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    renderCompanion();

    const navigatorLaunch = screen.getByRole("button", {
      name: "Navigator 전용 창 열기 또는 앞으로 가져오기",
    });
    expect(navigatorLaunch.className).toContain("min-h-14");
    fireEvent.click(navigatorLaunch);

    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[0]).toContain(`view=navigator`);
    expect(screen.getByText(/Navigator 창을 열거나 앞으로/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", {
      name: "검수 전용 창 열기 또는 앞으로 가져오기",
    }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]?.[0]).toContain(`view=review`);

    fireEvent.click(screen.getByRole("button", {
      name: "레퍼런스 전용 창 열기 또는 앞으로 가져오기",
    }));
    expect(open).toHaveBeenCalledTimes(3);
    expect(open.mock.calls[2]?.[0]).toContain(`view=reference`);
  });

  it("shows an actionable error when a dedicated popup is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    renderCompanion();

    fireEvent.click(screen.getByRole("button", {
      name: "Navigator 전용 창 열기 또는 앞으로 가져오기",
    }));

    expect(screen.getByRole("alert").textContent).toContain("팝업이 차단됐습니다");
  });

  it("initializes presentation-safe as transient and synchronizes it without exposing the document title", () => {
    const view = renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    act(() => {
      channel.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "pen",
        density: "full",
        canvasOnly: false,
        title: "공개 전 비밀 작품",
        at: Date.now(),
      });
    });

    expect(view.container.textContent).toContain("공개 전 비밀 작품");
    act(() => channel.emit(buildStudioCompanionPresentationSafe({
      companionInstanceId: companionPeerB,
      targetCompanionInstanceId: companionInstance,
      state: {
        enabled: true,
        clock: 1,
        writerInstanceId: companionPeerB,
        mutationId: "presentation-peer-b-0001",
      },
    })));
    expect(view.container.textContent).not.toContain("공개 전 비밀 작품");
    expect(screen.getByRole("button", { name: "발표 안전 끄기" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 끄기" }));
    expect(view.container.textContent).toContain("공개 전 비밀 작품");
  });

  it("never touches localStorage while keeping presentation-safe usable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const view = renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    act(() => {
      channel.emit({
        v: 1,
        type: "primary-state",
        primaryInstanceId: primaryInstanceA,
        targetCompanionInstanceId: companionInstance,
        tool: "pen",
        density: "full",
        canvasOnly: false,
        title: "저장소 차단 비밀 작품",
        at: Date.now(),
      });
    });
    expect(view.container.textContent).toContain("저장소 차단 비밀 작품");

    fireEvent.click(screen.getByRole("button", { name: "발표 안전 켜기" }));

    expect(screen.getByRole("button", { name: "발표 안전 끄기" }).getAttribute("aria-pressed")).toBe("true");
    expect(view.container.textContent).not.toContain("저장소 차단 비밀 작품");
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("converges presentation-safe state through companion peers without browser storage", async () => {
    const { createObjectURL, revokeObjectURL } = installObjectUrlSpies();
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 320;
      naturalHeight = 180;
      width = 320;
      height = 180;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
    renderCompanion(`/studio/tools-companion?session=${sessionId}&view=reference`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const ownInstanceId = companionInstanceId(channel);
    connectReferencePrimary({
      channel,
      companionInstance: ownInstanceId,
      itemCount: 1,
      resolvedItemCount: 1,
    });
    await screen.findByRole("heading", { name: "레퍼런스 전용 화면" });
    await waitFor(() => expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-control",
      control: { kind: "reference-preview-demand", active: true },
    })));
    act(() => channel.emit(buildStudioCompanionReferencePreviewFrame({
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: ownInstanceId,
      frame: {
        generation: 1,
        revision: 1,
        referenceRevision: 1,
        sequence: 1,
        width: 320,
        height: 180,
        blob: referenceWebpBlob(320, 180),
      },
    })));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    const picker = screen.getByRole("button", { name: "스포이드" }) as HTMLButtonElement;
    await waitFor(() => expect(picker.disabled).toBe(false));
    fireEvent.click(picker);
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 320,
        bottom: 180,
        width: 320,
        height: 180,
      }),
    });
    fireEvent.click(viewport, { button: 0, clientX: 160, clientY: 90 });
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-control",
      control: expect.objectContaining({
        kind: "reference-pick-color",
        referenceRevision: 1,
        sequence: 1,
      }),
    }));
    act(() => channel.emit(buildStudioCompanionReferenceColorResult({
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: ownInstanceId,
      result: {
        generation: 1,
        revision: 1,
        referenceRevision: 1,
        sequence: 1,
        color: "#aabbcc",
      },
    })));
    expect(await screen.findByLabelText("최근 선택 색상 #AABBCC")).toBeTruthy();

    const safeMessage = buildStudioCompanionPresentationSafe({
      companionInstanceId: companionPeerB,
      targetCompanionInstanceId: ownInstanceId,
      state: {
        enabled: true,
        clock: 1,
        writerInstanceId: companionPeerB,
        mutationId: "presentation-peer-b-0001",
      },
    });
    act(() => channel.emit(safeMessage));
    expect(screen.getByRole("heading", { name: "발표 안전 모드" })).toBeTruthy();
    expect(screen.queryByLabelText("최근 선택 색상 #AABBCC")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    await waitFor(() => expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-control",
      control: { kind: "reference-preview-demand", active: false },
    })));

    act(() => {
      channel.emit(safeMessage);
      channel.emit(buildStudioCompanionPresentationSafe({
        companionInstanceId: companionPeerB,
        targetCompanionInstanceId: companionPeerC,
        state: {
          enabled: false,
          clock: 2,
          writerInstanceId: companionPeerB,
          mutationId: "presentation-peer-b-0002",
        },
      }));
      channel.emit({
        v: 1,
        type: "hello",
        role: "companion",
        companionInstanceId: companionPeerC,
        targetPrimaryInstanceId: null,
        view: "reference",
        at: Date.now(),
      });
    });
    expect(screen.getByRole("heading", { name: "발표 안전 모드" })).toBeTruthy();
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "companion-presentation-safe",
      targetCompanionInstanceId: companionPeerC,
      state: expect.objectContaining({
        enabled: true,
        clock: 1,
        writerInstanceId: companionPeerB,
      }),
    }));

    act(() => channel.emit(buildStudioCompanionPresentationSafe({
      companionInstanceId: companionPeerB,
      targetCompanionInstanceId: ownInstanceId,
      state: {
        enabled: false,
        clock: 2,
        writerInstanceId: companionPeerB,
        mutationId: "presentation-peer-b-0002",
      },
    })));
    expect(await screen.findByRole("heading", { name: "레퍼런스 전용 화면" })).toBeTruthy();
    expect(screen.queryByLabelText("최근 선택 색상 #AABBCC")).toBeNull();
  });

  it("accepts a peer presentation-safe state without durable writes or an echo broadcast", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const ownInstanceId = companionInstanceId(channel);
    const safeMessageCount = channel.postMessage.mock.calls.filter(([message]) => (
      (message as StudioCompanionMessage).type === "companion-presentation-safe"
    )).length;
    act(() => channel.emit(buildStudioCompanionPresentationSafe({
      companionInstanceId: companionPeerB,
      targetCompanionInstanceId: ownInstanceId,
      state: {
        enabled: true,
        clock: 1,
        writerInstanceId: companionPeerB,
        mutationId: "presentation-peer-b-0001",
      },
    })));
    expect(screen.getByRole("button", { name: "발표 안전 끄기" })).toBeTruthy();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(channel.postMessage.mock.calls.filter(([message]) => (
      (message as StudioCompanionMessage).type === "companion-presentation-safe"
    ))).toHaveLength(safeMessageCount);
  });

  it("rejects a stale presentation-safe revision under deterministic LWW ordering", () => {
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const ownInstanceId = companionInstanceId(channel);

    act(() => channel.emit(buildStudioCompanionPresentationSafe({
      companionInstanceId: companionPeerB,
      targetCompanionInstanceId: ownInstanceId,
      state: {
        enabled: true,
        clock: 7,
        writerInstanceId: companionPeerB,
        mutationId: "presentation-peer-b-0007",
      },
    })));
    expect(screen.getByRole("button", { name: "발표 안전 끄기" })).toBeTruthy();

    act(() => channel.emit(buildStudioCompanionPresentationSafe({
      companionInstanceId: companionPeerC,
      targetCompanionInstanceId: ownInstanceId,
      state: {
        enabled: false,
        clock: 6,
        writerInstanceId: companionPeerC,
        mutationId: "presentation-peer-c-0006",
      },
    })));

    expect(screen.getByRole("button", { name: "발표 안전 끄기" })).toBeTruthy();
  });

  it("closes its channel when the detached window unmounts", () => {
    document.title = "이전 제목";
    const view = renderCompanion();
    const channel = FakeBroadcastChannel.instances[0];
    expect(document.title).toBe("도구 창 · ToonSpectrum Studio");
    view.unmount();
    expect(channel?.close).toHaveBeenCalledOnce();
    expect(document.title).toBe("이전 제목");
  });

  it("sends one goodbye after releasing Navigator demand across pagehide and unmount", () => {
    const view = renderCompanion(`/studio/tools-companion?session=${sessionId}&view=navigator`);
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });

    act(() => window.dispatchEvent(new Event("pagehide")));
    view.unmount();

    const demands = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => message.type === "companion-control" && message.control.kind === "navigator-demand");
    expect(demands).toEqual([
      expect.objectContaining({ control: { kind: "navigator-demand", active: true } }),
      expect.objectContaining({ control: { kind: "navigator-demand", active: false } }),
    ]);
    const goodbyes = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => message.type === "companion-goodbye");
    expect(goodbyes).toEqual([
      expect.objectContaining({
        companionInstanceId: companionInstance,
        targetPrimaryInstanceId: primaryInstanceA,
        surface: "navigator",
      }),
    ]);
    const lifecycleMessages = channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => message.type === "companion-control" || message.type === "companion-goodbye");
    expect(lifecycleMessages.slice(-2).map((message) => message.type)).toEqual([
      "companion-control",
      "companion-goodbye",
    ]);
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it("fences navigator frames by target, generation, document revision and sequence", async () => {
    const { createObjectURL, revokeObjectURL } = installObjectUrlSpies();
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });

    await emitDecodedNavigatorFrame(
      channel,
      navigatorFrame({ companionInstance, marker: "first" })
    );
    fireEvent.click(screen.getByRole("tab", { name: "Navigator" }));
    expect(screen.getByAltText("현재 페이지 전체 캔버스").getAttribute("src")).toContain("blob:frame");
    expect(createObjectURL).toHaveBeenCalledOnce();

    act(() => {
      channel.emit(navigatorFrame({ companionInstance: "other-companion-5678", sequence: 2 }));
      channel.emit(navigatorFrame({ companionInstance, generation: 2, sequence: 2 }));
      channel.emit(navigatorFrame({ companionInstance, sequence: 1 }));
    });
    expect(createObjectURL).toHaveBeenCalledOnce();

    await emitDecodedNavigatorFrame(
      channel,
      navigatorFrame({ companionInstance, sequence: 2, marker: "second" })
    );
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    const nextProjection = projectedReview({ revision: 2, documentRevision: 6 });
    act(() => channel.emit(buildStudioCompanionReviewState({
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: companionInstance,
      generation: 1,
      projection: nextProjection,
    })));
    expect(screen.queryByAltText("현재 페이지 전체 캔버스")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);

    act(() => channel.emit(navigatorFrame({ companionInstance, revision: 5, sequence: 3 })));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    await emitDecodedNavigatorFrame(
      channel,
      navigatorFrame({ companionInstance, revision: 6, sequence: 4 })
    );
    expect(createObjectURL).toHaveBeenCalledTimes(3);

    act(() => channel.emit(buildStudioCompanionReviewState({
      primaryInstanceId: primaryInstanceA,
      targetCompanionInstanceId: companionInstance,
      generation: 2,
      projection: projectedReview({ revision: 1, documentRevision: 0 }),
    })));
    expect(screen.queryByAltText("현재 페이지 전체 캔버스")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it("keeps the decoded Navigator image visible across decode failure and racing frames", async () => {
    class ControlledNavigatorImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      url = "";

      set src(value: string) {
        this.url = value;
        pendingImages.push(this);
      }

      succeed(width = 640, height = 960) {
        this.naturalWidth = width;
        this.naturalHeight = height;
        this.onload?.();
      }
    }
    const pendingImages: ControlledNavigatorImage[] = [];
    vi.stubGlobal("Image", ControlledNavigatorImage);
    const { createObjectURL, revokeObjectURL } = installObjectUrlSpies();
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });
    fireEvent.click(screen.getByRole("tab", { name: "Navigator" }));

    act(() => channel.emit(navigatorFrame({ companionInstance, marker: "first" })));
    const firstUrl = createObjectURL.mock.results[0]?.value as string;
    expect(screen.queryByAltText("현재 페이지 전체 캔버스")).toBeNull();
    await act(async () => {
      pendingImages[0]?.succeed();
      await Promise.resolve();
    });
    expect(screen.getByAltText("현재 페이지 전체 캔버스").getAttribute("src")).toBe(firstUrl);

    act(() => channel.emit(navigatorFrame({
      companionInstance,
      sequence: 2,
      marker: "bad-dimensions",
    })));
    const mismatchedUrl = createObjectURL.mock.results[1]?.value as string;
    expect(screen.getByAltText("현재 페이지 전체 캔버스").getAttribute("src")).toBe(firstUrl);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => {
      pendingImages[1]?.succeed(320, 480);
      await Promise.resolve();
    });
    expect(screen.getByAltText("현재 페이지 전체 캔버스").getAttribute("src")).toBe(firstUrl);
    expect(revokeObjectURL).toHaveBeenCalledWith(mismatchedUrl);

    act(() => channel.emit(navigatorFrame({
      companionInstance,
      sequence: 3,
      marker: "superseded",
    })));
    const supersededUrl = createObjectURL.mock.results[2]?.value as string;
    act(() => channel.emit(navigatorFrame({
      companionInstance,
      sequence: 4,
      marker: "newest",
    })));
    const newestUrl = createObjectURL.mock.results[3]?.value as string;
    expect(revokeObjectURL).toHaveBeenCalledWith(supersededUrl);
    await act(async () => {
      pendingImages[2]?.succeed();
      await Promise.resolve();
    });
    expect(screen.getByAltText("현재 페이지 전체 캔버스").getAttribute("src")).toBe(firstUrl);
    await act(async () => {
      pendingImages[3]?.succeed();
      await Promise.resolve();
    });
    expect(screen.getByAltText("현재 페이지 전체 캔버스").getAttribute("src")).toBe(newestUrl);
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
  });

  it("shares command/control sequence and coalesces brush and navigator streams", async () => {
    vi.useFakeTimers();
    installObjectUrlSpies();
    renderCompanion();
    const channel = FakeBroadcastChannel.instances[0]!;
    const companionInstance = companionInstanceId(channel);
    connectPrimary({ channel, companionInstance });

    fireEvent.click(screen.getByRole("button", { name: "펜" }));
    fireEvent.click(screen.getByRole("tab", { name: "검수" }));
    const size = screen.getByRole("slider", { name: "원격 브러시 크기" });
    fireEvent.change(size, { target: { value: "10" } });
    fireEvent.change(size, { target: { value: "16" } });
    fireEvent.change(size, { target: { value: "24" } });
    const controls = () => channel.postMessage.mock.calls
      .map(([message]) => message as StudioCompanionMessage)
      .filter((message) => (
        message.type === "companion-control"
        && message.control.kind !== "navigator-demand"
      ));
    expect(controls()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(63));
    expect(controls()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(controls()).toEqual([
      expect.objectContaining({
        type: "companion-control",
        sequence: 2,
        control: { kind: "brush", patch: { size: 24 } },
      }),
    ]);

    await emitDecodedNavigatorFrame(channel, navigatorFrame({ companionInstance }));
    fireEvent.click(screen.getByRole("tab", { name: "Navigator" }));
    const navigator = screen.getByRole("button", {
      name: "전체 캔버스 미리보기에서 보이는 위치 이동",
    });
    Object.defineProperty(navigator, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400 }),
    });
    fireEvent.pointerDown(navigator, { pointerId: 7, clientX: 20, clientY: 40 });
    fireEvent.pointerMove(navigator, { pointerId: 7, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(navigator, { pointerId: 7, clientX: 180, clientY: 360 });
    act(() => vi.advanceTimersByTime(31));
    expect(controls()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(controls()).toHaveLength(2);
    expect(controls()[1]).toEqual(expect.objectContaining({
      type: "companion-control",
      sequence: 4,
      control: { kind: "navigate", point: { x: 0.9, y: 1 } },
    }));
    fireEvent(navigator, new Event("lostpointercapture", { bubbles: true }));
  });

  it("revokes navigator URLs on expiry, session switch and unmount", async () => {
    vi.useFakeTimers();
    const { revokeObjectURL } = installObjectUrlSpies();
    const view = render(
      <MemoryRouter initialEntries={[`/studio/tools-companion?session=${sessionId}`]}>
        <SessionSwitchHarness />
      </MemoryRouter>
    );
    const first = FakeBroadcastChannel.instances[0]!;
    const firstCompanion = companionInstanceId(first);
    connectPrimary({ channel: first, companionInstance: firstCompanion });
    await emitDecodedNavigatorFrame(
      first,
      navigatorFrame({ companionInstance: firstCompanion })
    );

    act(() => vi.advanceTimersByTime(12_001));
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    connectPrimary({ channel: first, companionInstance: firstCompanion, generation: 2 });
    await emitDecodedNavigatorFrame(first, navigatorFrame({
      companionInstance: firstCompanion,
      generation: 2,
      sequence: 2,
    }));
    fireEvent.click(screen.getByRole("button", { name: "세션 전환" }));
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);

    const second = latestProtocolChannel(sessionIdB);
    const secondCompanion = companionInstanceId(second);
    connectPrimary({ channel: second, companionInstance: secondCompanion });
    await emitDecodedNavigatorFrame(
      second,
      navigatorFrame({ companionInstance: secondCompanion })
    );
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it("requests Window Management only from the explicit placement button", async () => {
    const getScreenDetails = vi.fn(async () => ({
      currentScreen: { availLeft: 0, availTop: 0, availWidth: 1_920, availHeight: 1_080 },
      screens: [
        { availLeft: 0, availTop: 0, availWidth: 1_920, availHeight: 1_080, isPrimary: true },
        { availLeft: 1_920, availTop: 0, availWidth: 1_280, availHeight: 900, label: "보조 화면" },
      ],
    }));
    const moveTo = vi.spyOn(window, "moveTo").mockImplementation(() => undefined);
    const resizeTo = vi.spyOn(window, "resizeTo").mockImplementation(() => undefined);
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    Object.defineProperty(window, "getScreenDetails", { configurable: true, value: getScreenDetails });
    renderCompanion();
    expect(getScreenDetails).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다른 화면으로 창 이동" }));
      await Promise.resolve();
    });
    expect(getScreenDetails).toHaveBeenCalledOnce();
    expect(moveTo).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(resizeTo).toHaveBeenCalledWith(520, 820);
    expect(screen.getByText(/다른 화면으로 이동을 요청했습니다/u).getAttribute("role")).toBe("status");
    Reflect.deleteProperty(window, "getScreenDetails");
  });

  it("announces requesting placement politely and placement failures as alerts", async () => {
    let resolveDetails: ((value: {
      currentScreen: unknown;
      screens: unknown[];
    }) => void) | null = null;
    const getScreenDetails = vi.fn(() => new Promise<{
      currentScreen: unknown;
      screens: unknown[];
    }>((resolve) => {
      resolveDetails = resolve;
    }));
    Object.defineProperty(window, "getScreenDetails", { configurable: true, value: getScreenDetails });
    renderCompanion();

    fireEvent.click(screen.getByRole("button", { name: "다른 화면으로 창 이동" }));
    expect(screen.getByText("연결된 화면을 확인하고 있습니다…").getAttribute("role")).toBe("status");

    await act(async () => {
      resolveDetails?.({
        currentScreen: { availLeft: 0, availTop: 0, availWidth: 1_000, availHeight: 800 },
        screens: [{ availLeft: 0, availTop: 0, availWidth: 1_000, availHeight: 800 }],
      });
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toContain("사용 가능한 다른 화면을 찾지 못했습니다");
  });

  it("announces unsupported automatic placement as an alert", () => {
    Reflect.deleteProperty(window, "getScreenDetails");
    renderCompanion();

    fireEvent.click(screen.getByRole("button", { name: "다른 화면으로 창 이동" }));

    expect(screen.getByRole("alert").textContent).toContain("자동 창 배치를 지원하지 않습니다");
  });

  it("drops a late screen permission result after an invalid-session page unmounts", async () => {
    let resolveDetails: ((value: {
      currentScreen: unknown;
      screens: unknown[];
    }) => void) | null = null;
    const getScreenDetails = vi.fn(() => new Promise<{
      currentScreen: unknown;
      screens: unknown[];
    }>((resolve) => {
      resolveDetails = resolve;
    }));
    const moveTo = vi.spyOn(window, "moveTo").mockImplementation(() => undefined);
    vi.spyOn(window, "resizeTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "getScreenDetails", { configurable: true, value: getScreenDetails });
    const view = renderCompanion("/studio/tools-companion?session=invalid");
    fireEvent.click(screen.getByRole("button", { name: "다른 화면으로 창 이동" }));
    view.unmount();
    await act(async () => {
      resolveDetails?.({
        currentScreen: { availLeft: 0, availTop: 0, availWidth: 1_000, availHeight: 800 },
        screens: [
          { availLeft: 0, availTop: 0, availWidth: 1_000, availHeight: 800 },
          { availLeft: 1_000, availTop: 0, availWidth: 1_000, availHeight: 800 },
        ],
      });
      await Promise.resolve();
    });
    expect(moveTo).not.toHaveBeenCalled();
  });
});
