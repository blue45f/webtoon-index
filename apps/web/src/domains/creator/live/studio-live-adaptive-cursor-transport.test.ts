import { afterEach, describe, expect, it } from "vitest";

import {
  createStudioAdaptiveCursorTransportFactory,
} from "./studio-live-adaptive-cursor-transport";
import {
  createStudioLiveEnvelope,
  type StudioLiveEnvelope,
  type StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";
import {
  getStudioLiveCursorQualitySnapshot,
  resetStudioLiveCursorQualityForTests,
} from "./studio-live-cursor-quality";

import type {
  StudioLiveTransport,
  StudioLiveTransportContext,
} from "./studio-live-collaboration-transport";

const PARTICIPANT: StudioLiveParticipant = {
  sessionId: "session-local",
  displayName: "희준 · 이 탭",
  role: "editor",
};

const CONTEXT: StudioLiveTransportContext = {
  workId: "work-1",
  roomName: "room-1",
  participant: PARTICIPANT,
};

class ManualScheduler {
  now = 1_000;
  private sequence = 0;
  private readonly tasks = new Map<number, { dueAt: number; run: () => void }>();

  setTimeout = (run: () => void, delay: number): number => {
    const id = ++this.sequence;
    this.tasks.set(id, { dueAt: this.now + Math.max(0, delay), run });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.dueAt;
      task.run();
    }
    this.now = target;
  }

  get pendingCount(): number {
    return this.tasks.size;
  }
}

class FakeTransport implements StudioLiveTransport {
  readonly mode = "server" as const;
  readonly crdtFanout = "authoritative" as const;
  readonly sent: StudioLiveEnvelope[] = [];
  ready = true;
  nextSendResult = true;
  closed = false;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.nextSendResult) {
      this.nextSendResult = true;
      return false;
    }
    this.sent.push(envelope);
    return true;
  }

  subscribe(_listener: (value: unknown) => void): () => void {
    return () => undefined;
  }

  close(): void {
    this.closed = true;
    this.ready = false;
  }
}

function cursor(
  sequence: number,
  sentAt: number,
  x: number,
  options: { clear?: boolean; drawing?: boolean; points?: readonly number[] } = {},
) {
  return createStudioLiveEnvelope({
    workId: CONTEXT.workId,
    sender: PARTICIPANT,
    sentAt,
    sequence,
    kind: "cursor:update",
    payload: options.clear
      ? { x: 0, y: 0, pageId: null, tool: null }
      : {
          x,
          y: 0.5,
          pageId: "page-1",
          tool: "brush",
          drawing: options.drawing,
          points: options.points,
        },
  });
}

function heartbeat(sequence: number, sentAt: number) {
  return createStudioLiveEnvelope({
    workId: CONTEXT.workId,
    sender: PARTICIPANT,
    sentAt,
    sequence,
    kind: "presence:heartbeat",
    payload: { visibility: "active", pageId: "page-1", tool: "brush" },
  });
}

function createHarness(options: {
  peerCount?: number;
  saveData?: boolean;
  effectiveType?: string | null;
} = {}) {
  const scheduler = new ManualScheduler();
  const inner = new FakeTransport();
  const transport = createStudioAdaptiveCursorTransportFactory({
    baseFactory: () => inner,
    getPeerCount: () => options.peerCount ?? 0,
    getVisibility: () => "visible",
    getNetworkProfile: () => ({
      saveData: options.saveData ?? false,
      effectiveType: options.effectiveType ?? "4g",
    }),
    now: () => scheduler.now,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    diagnosticsIntervalMs: 100,
  })(CONTEXT);
  return { scheduler, inner, transport };
}

afterEach(() => {
  resetStudioLiveCursorQualityForTests();
});

describe("adaptive cursor transport", () => {
  it("sends the first cursor immediately and keeps the newest trailing cursor", () => {
    const { scheduler, inner, transport } = createHarness();

    expect(transport.send(cursor(1, scheduler.now, 0.1))).toBe(true);
    scheduler.advance(10);
    expect(transport.send(cursor(2, scheduler.now, 0.2))).toBe(true);
    scheduler.advance(5);
    expect(transport.send(cursor(3, scheduler.now, 0.3))).toBe(true);
    expect(inner.sent.map((value) => value.sequence)).toEqual([1]);

    scheduler.advance(9);
    expect(inner.sent.map((value) => value.sequence)).toEqual([1, 3]);
    expect((inner.sent[1] as StudioLiveEnvelope<"cursor:update">).payload.x).toBe(0.3);
    expect(getStudioLiveCursorQualitySnapshot("work-1")).toMatchObject({
      sentCount: 1,
      tier: "live",
    });
  });

  it("flushes a delayed cursor before a later envelope sequence", () => {
    const { scheduler, inner, transport } = createHarness();

    transport.send(cursor(1, scheduler.now, 0.1));
    scheduler.advance(8);
    transport.send(cursor(2, scheduler.now, 0.2));
    scheduler.advance(2);
    transport.send(heartbeat(3, scheduler.now));

    expect(inner.sent.map((value) => [value.kind, value.sequence])).toEqual([
      ["cursor:update", 1],
      ["cursor:update", 2],
      ["presence:heartbeat", 3],
    ]);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("drops an obsolete queued cursor and delivers clear immediately", () => {
    const { scheduler, inner, transport } = createHarness();

    transport.send(cursor(1, scheduler.now, 0.1));
    scheduler.advance(8);
    transport.send(cursor(2, scheduler.now, 0.2));
    scheduler.advance(1);
    transport.send(cursor(3, scheduler.now, 0, { clear: true }));

    expect(inner.sent.map((value) => value.sequence)).toEqual([1, 3]);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("removes trail points on save-data while preserving the latest pointer", () => {
    const { scheduler, inner, transport } = createHarness({ saveData: true });

    transport.send(cursor(1, scheduler.now, 0.75, {
      drawing: true,
      points: [0, 0, 40, 40, 80, 80],
    }));

    const delivered = inner.sent[0] as StudioLiveEnvelope<"cursor:update">;
    expect(delivered.payload).toMatchObject({ x: 0.75, drawing: true });
    expect(delivered.payload.points).toBeUndefined();
    expect(getStudioLiveCursorQualitySnapshot("work-1")).toMatchObject({
      cadenceMs: 96,
      compactedCount: 1,
      tier: "constrained",
      reason: "save-data",
    });
  });

  it("retries one failed disposable send with a bounded delay", () => {
    const { scheduler, inner, transport } = createHarness();
    inner.nextSendResult = false;

    expect(transport.send(cursor(1, scheduler.now, 0.4))).toBe(true);
    expect(inner.sent).toHaveLength(0);
    expect(scheduler.pendingCount).toBe(1);

    scheduler.advance(23);
    expect(inner.sent).toHaveLength(0);
    scheduler.advance(1);
    expect(inner.sent.map((value) => value.sequence)).toEqual([1]);
  });

  it("cancels queued work and clears diagnostics when the room closes", () => {
    const { scheduler, inner, transport } = createHarness({ peerCount: 30 });

    transport.send(cursor(1, scheduler.now, 0.1));
    scheduler.advance(10);
    transport.send(cursor(2, scheduler.now, 0.2));
    expect(getStudioLiveCursorQualitySnapshot("work-1")).not.toBeNull();

    transport.close();
    expect(scheduler.pendingCount).toBe(0);
    expect(getStudioLiveCursorQualitySnapshot("work-1")).toBeNull();
    expect(inner.closed).toBe(true);
  });
});
