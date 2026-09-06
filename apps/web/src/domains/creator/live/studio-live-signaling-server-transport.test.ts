import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioLiveEnvelope,
  type StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";
import { createStudioLiveSignalingServerTransport } from "./studio-live-signaling-server-transport";

const NOW = Date.parse("2026-08-16T00:00:00.000Z");
const participant: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000101",
  displayName: "작가",
  role: "owner",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio live signaling server transport", () => {
  it("does not report a local BroadcastChannel preview as cross-browser primary delivery", async () => {
    const postMessage = vi.fn();
    class FakeBroadcastChannel {
      constructor(readonly name: string) {}

      postMessage(value: unknown): void {
        postMessage(value);
      }

      addEventListener(
        _type: "message",
        _listener: (event: MessageEvent<unknown>) => void,
      ): void {}

      removeEventListener(
        _type: "message",
        _listener: (event: MessageEvent<unknown>) => void,
      ): void {}

      close(): void {}
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const transport = createStudioLiveSignalingServerTransport({
      workId: "work-signaling-only",
      roomName: "room-signaling-only",
      participant,
    });
    await transport.connect();
    const cursor = createStudioLiveEnvelope({
      workId: "work-signaling-only",
      sender: participant,
      sentAt: NOW,
      sequence: 1,
      kind: "cursor:update",
      payload: { x: 0.2, y: 0.4, pageId: "page-1", tool: "pen" },
    });
    const preview = createStudioLiveEnvelope({
      workId: "work-signaling-only",
      sender: participant,
      sentAt: NOW,
      sequence: 2,
      kind: "preview:gesture",
      payload: {
        version: 1,
        gestureId: "gesture-signaling-only",
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation: "draw",
        base: { documentGeneration: 1 },
        renderer: {
          kind: "freehand",
          mode: "pen",
          stroke: "#112233",
          strokeWidth: 4,
        },
        samples: { startIndex: 0, points: [1, 2] },
      },
    });

    expect(transport.mode).toBe("server");
    expect(transport.crdtFanout).toBe("mesh");
    expect(transport.send(cursor)).toBe(true);
    expect(transport.send(preview)).toBe(false);
    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(cursor);
    transport.close();
  });
});
