import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioImageDataLike } from "./studio-filters";
import type {
  StudioHealCloneWorkerResponseMessage,
  StudioHealCloneWorkerRunMessage,
  StudioHealCloneWorkerRunRequest,
} from "./studio-heal-clone-worker-protocol";

interface WorkerScopeHarness {
  onmessage: ((event: MessageEvent<StudioHealCloneWorkerRunMessage>) => void) | null;
  postMessage(message: StudioHealCloneWorkerResponseMessage, transfer: Transferable[]): void;
}

function image(width: number, height: number): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = x < width / 2 ? 20 : 220;
      data[offset + 1] = y * 12;
      data[offset + 2] = (x * 9 + y * 5) % 256;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function request(mode: "heal" | "clone" = "clone"): StudioHealCloneWorkerRunRequest {
  const src = image(12, 8);
  return {
    src,
    dst: image(9, 7),
    dabs: [{ srcX: 9, srcY: 3, destX: 3, destY: 4 }],
    radiusPx: 2,
    hardness: 0.75,
    opacity: 1,
    mode,
  };
}

async function loadWorkerHarness(): Promise<{
  messages: StudioHealCloneWorkerResponseMessage[];
  scope: WorkerScopeHarness;
}> {
  vi.resetModules();
  const messages: StudioHealCloneWorkerResponseMessage[] = [];
  vi.stubGlobal("postMessage", vi.fn((message: StudioHealCloneWorkerResponseMessage) => {
    messages.push(message);
  }));
  await import("./studio-heal-clone.worker");
  return { messages, scope: globalThis as unknown as WorkerScopeHarness };
}

function send(scope: WorkerScopeHarness, workerRequest: StudioHealCloneWorkerRunRequest): void {
  scope.onmessage?.({ data: {
    type: "studio-heal-clone/run",
    version: 1,
    request: workerRequest,
  } } as MessageEvent<StudioHealCloneWorkerRunMessage>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio-heal-clone.worker runtime", () => {
  it("ready는 한 번만 보내고 같은 runtime에서 여러 순차 요청을 계속 처리한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    send(scope, request("clone"));
    send(scope, request("heal"));

    expect(messages.map((message) => message.type)).toEqual([
      "studio-heal-clone/ready",
      "studio-heal-clone/success",
      "studio-heal-clone/success",
    ]);
    const cloneResponse = messages[1];
    const healResponse = messages[2];
    if (cloneResponse?.type !== "studio-heal-clone/success") throw new Error("clone success expected");
    if (healResponse?.type !== "studio-heal-clone/success") throw new Error("heal success expected");
    expect(cloneResponse.dst.data).not.toEqual(image(9, 7).data);
    expect(healResponse.dst).toMatchObject({ width: 9, height: 7 });
  });

  it("잘못된 요청을 structured failure로 격리한 뒤 다음 정상 요청을 처리한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const invalid = request();
    invalid.dst.data = new Uint8ClampedArray(4);
    send(scope, invalid);
    send(scope, request());

    expect(messages[1]).toMatchObject({
      type: "studio-heal-clone/failure",
      error: { name: "RangeError" },
    });
    expect(messages[2]?.type).toBe("studio-heal-clone/success");
  });

  it("malformed envelope는 무시하고 runtime handler를 유지한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    scope.onmessage?.({ data: null } as unknown as MessageEvent<StudioHealCloneWorkerRunMessage>);
    send(scope, request());

    expect(messages.map((message) => message.type)).toEqual([
      "studio-heal-clone/ready",
      "studio-heal-clone/success",
    ]);
  });
});
