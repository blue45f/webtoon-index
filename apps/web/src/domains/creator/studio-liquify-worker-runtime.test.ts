import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLiquifyDisplacement, buildLiquifyDisplacementField } from "./studio-liquify";

import type {
  StudioLiquifyWorkerResponseMessage,
  StudioLiquifyWorkerRunMessage,
} from "./studio-liquify-worker-protocol";

interface WorkerScopeHarness {
  onmessage: ((event: MessageEvent<StudioLiquifyWorkerRunMessage>) => void) | null;
  postMessage(message: StudioLiquifyWorkerResponseMessage, transfer: Transferable[]): void;
}

async function loadWorkerHarness(): Promise<{
  messages: StudioLiquifyWorkerResponseMessage[];
  scope: WorkerScopeHarness;
}> {
  vi.resetModules();
  const messages: StudioLiquifyWorkerResponseMessage[] = [];
  vi.stubGlobal("postMessage", vi.fn((message: StudioLiquifyWorkerResponseMessage) => {
    messages.push(message);
  }));
  await import("./studio-liquify.worker");
  return { messages, scope: globalThis as unknown as WorkerScopeHarness };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio-liquify.worker runtime", () => {
  it("준비 신호 뒤 실제 변위를 적용하고 필드 밖 원본 픽셀을 보존한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const src = {
      data: new Uint8ClampedArray([
        10, 20, 30, 255, 40, 50, 60, 255,
        70, 80, 90, 255, 100, 110, 120, 255,
      ]),
      width: 2,
      height: 2,
    };
    const dst = { ...src, data: new Uint8ClampedArray(src.data) };

    scope.onmessage?.({ data: {
      type: "studio-liquify/run",
      version: 1,
      request: {
        src,
        dst,
        field: {
          originX: 1,
          originY: 1,
          width: 1,
          height: 1,
          dx: new Float32Array([0.5]),
          dy: new Float32Array([0]),
        },
      },
    } } as unknown as MessageEvent<StudioLiquifyWorkerRunMessage>);

    expect(messages[0]).toEqual({ type: "studio-liquify/ready", version: 1 });
    expect(messages[1]?.type).toBe("studio-liquify/success");
    if (messages[1]?.type !== "studio-liquify/success") throw new Error("success expected");
    expect(messages[1].applied).toBe(true);
    expect(messages[1].dst.data.slice(0, 12)).toEqual(src.data.slice(0, 12));
    expect(messages[1].dst.data[15]).toBe(255);
  });

  it("stroke 요청의 field 생성과 픽셀 적용을 Worker 런타임 안에서 함께 수행한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const width = 12;
    const height = 8;
    const src = {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    };
    for (let offset = 0; offset < src.data.length; offset += 4) {
      src.data[offset] = (offset / 4) % 255;
      src.data[offset + 3] = 255;
    }
    const dst = { ...src, data: new Uint8ClampedArray(src.data) };

    scope.onmessage?.({ data: {
      type: "studio-liquify/run",
      version: 1,
      request: {
        src,
        dst,
        stroke: {
          points: [{ x: 2, y: 4 }, { x: 9, y: 4 }],
          radiusPx: 3,
          strength: 0.8,
          options: { mode: "push" },
        },
      },
    } } as unknown as MessageEvent<StudioLiquifyWorkerRunMessage>);

    expect(messages[1]?.type).toBe("studio-liquify/success");
    if (messages[1]?.type !== "studio-liquify/success") throw new Error("success expected");
    expect(messages[1].applied).toBe(true);
    expect(messages[1].dst.data).not.toEqual(src.data);
  });

  it("cropped RGBA에도 전체 canvas 좌표로 field를 만들고 full-frame과 byte-identical하게 적용한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const canvasWidth = 20;
    const canvasHeight = 12;
    const full = {
      data: new Uint8ClampedArray(canvasWidth * canvasHeight * 4),
      width: canvasWidth,
      height: canvasHeight,
    };
    for (let y = 0; y < canvasHeight; y += 1) {
      for (let x = 0; x < canvasWidth; x += 1) {
        const offset = (y * canvasWidth + x) * 4;
        full.data[offset] = (x * 29 + y * 13) % 256;
        full.data[offset + 1] = (x * 7 + y * 37) % 256;
        full.data[offset + 2] = (x * 41 + y * 3) % 256;
        full.data[offset + 3] = 255;
      }
    }
    const region = { originX: 2, originY: 1, canvasWidth, canvasHeight };
    const cropWidth = 16;
    const cropHeight = 10;
    const crop = new Uint8ClampedArray(cropWidth * cropHeight * 4);
    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const sourceOffset = ((region.originY + y) * canvasWidth + region.originX + x) * 4;
        crop.set(full.data.subarray(sourceOffset, sourceOffset + 4), (y * cropWidth + x) * 4);
      }
    }
    const src = { data: crop, width: cropWidth, height: cropHeight };
    const dst = { ...src, data: new Uint8ClampedArray(src.data) };
    const stroke = {
      points: [{ x: 7.25, y: 5.5 }, { x: 12.75, y: 6.25 }],
      radiusPx: 3,
      strength: 0.8,
      options: { mode: "push" as const },
    };

    scope.onmessage?.({ data: {
      type: "studio-liquify/run",
      version: 1,
      request: { src, dst, region, stroke },
    } } as unknown as MessageEvent<StudioLiquifyWorkerRunMessage>);

    const expected = { ...full, data: new Uint8ClampedArray(full.data) };
    const field = buildLiquifyDisplacementField(
      stroke.points,
      stroke.radiusPx,
      stroke.strength,
      canvasWidth,
      canvasHeight,
      stroke.options,
    )!;
    applyLiquifyDisplacement(full, expected, field);
    const expectedCrop = new Uint8ClampedArray(crop.length);
    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const sourceOffset = ((region.originY + y) * canvasWidth + region.originX + x) * 4;
        expectedCrop.set(expected.data.subarray(sourceOffset, sourceOffset + 4), (y * cropWidth + x) * 4);
      }
    }

    expect(messages[1]?.type).toBe("studio-liquify/success");
    if (messages[1]?.type !== "studio-liquify/success") throw new Error("success expected");
    expect(messages[1].dst.data).toEqual(expectedCrop);
  });

  it("field가 생기지 않는 stroke는 성공 응답 applied=false로 반환한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const src = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    const dst = { ...src, data: new Uint8ClampedArray(src.data) };

    scope.onmessage?.({ data: {
      type: "studio-liquify/run",
      version: 1,
      request: {
        src,
        dst,
        stroke: { points: [{ x: 1, y: 1 }], radiusPx: 2, strength: 1 },
      },
    } } as unknown as MessageEvent<StudioLiquifyWorkerRunMessage>);

    expect(messages[1]).toMatchObject({ type: "studio-liquify/success", applied: false });
  });

  it("잘못된 dst 길이를 구조화된 failure로 반환한다", async () => {
    const { messages, scope } = await loadWorkerHarness();
    scope.onmessage?.({ data: {
      type: "studio-liquify/run",
      version: 1,
      request: {
        src: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
        dst: { data: new Uint8ClampedArray(4), width: 2, height: 2 },
        field: {
          originX: 0,
          originY: 0,
          width: 1,
          height: 1,
          dx: new Float32Array(1),
          dy: new Float32Array(1),
        },
      },
    } } as MessageEvent<StudioLiquifyWorkerRunMessage>);

    expect(messages[1]).toMatchObject({
      type: "studio-liquify/failure",
      error: { name: "RangeError" },
    });
  });
});
