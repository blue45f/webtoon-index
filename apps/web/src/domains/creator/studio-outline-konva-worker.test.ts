// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_OUTLINE_SYNC_MAX_PIXELS,
  applyOutline,
  normalizeOutline,
  outlineKonvaFilter,
} from "./studio-outline";

const workerHarness = vi.hoisted(() => {
  type Call = {
    options: { epoch: number; signal?: AbortSignal };
    reject: (reason?: unknown) => void;
    request: {
      imageData: { data: Uint8ClampedArray; width: number; height: number };
      outline: {
        color: string;
        width: number;
        opacity: number;
        secondColor?: string;
        secondWidth?: number;
      };
    };
    resolve: (value: {
      epoch: number;
      imageData: { data: Uint8ClampedArray; width: number; height: number };
    }) => void;
  };
  const calls: Call[] = [];
  const run = vi.fn((request: Call["request"], options: Call["options"]) =>
    new Promise((resolve, reject) => {
      calls.push({
        options,
        reject,
        request,
        resolve: resolve as Call["resolve"],
      });
    }));
  return { calls, run };
});

vi.mock("./studio-outline-worker-client", () => ({
  runStudioOutlineWorker: workerHarness.run,
}));

function largeImage() {
  const width = 257;
  const height = 256;
  const data = new Uint8ClampedArray(width * height * 4);
  const center = (128 * width + 128) * 4;
  data.set([18, 36, 54, 255], center);
  return { data, width, height };
}

function outlineAttrs(revision: string) {
  return {
    image: {},
    outlineColor: "#ff0000",
    outlineOpacity: 100,
    outlineWidth: 2,
    outlineWorkerRevision: revision,
  };
}

function resolveWorkerCall(index: number): Uint8ClampedArray {
  const call = workerHarness.calls[index]!;
  const imageData = {
    data: new Uint8ClampedArray(call.request.imageData.data),
    width: call.request.imageData.width,
    height: call.request.imageData.height,
  };
  applyOutline(imageData, normalizeOutline(call.request.outline));
  call.resolve({ epoch: call.options.epoch, imageData });
  return imageData.data;
}

afterEach(() => {
  workerHarness.calls.length = 0;
  workerHarness.run.mockClear();
  vi.restoreAllMocks();
});

describe("outlineKonvaFilter Worker EDT boundary", () => {
  it("keeps the bounded tiny path synchronous", () => {
    const data = new Uint8ClampedArray(5 * 5 * 4);
    data.set([1, 2, 3, 255], (2 * 5 + 2) * 4);
    const imageData = { data, width: 5, height: 5 };
    const node = { attrs: outlineAttrs("tiny") };

    outlineKonvaFilter.call(node, imageData);

    expect(STUDIO_OUTLINE_SYNC_MAX_PIXELS).toBeGreaterThan(25);
    expect(workerHarness.run).not.toHaveBeenCalled();
    expect(imageData.data[(2 * 5 + 1) * 4]).toBe(255);
  });

  it("moves a large padded Konva cache to the Worker and commits through the same cache offset", async () => {
    const imageData = largeImage();
    const original = new Uint8ClampedArray(imageData.data);
    let committed: Uint8ClampedArray | null = null;
    const layer = { batchDraw: vi.fn() };
    const node = {
      attrs: outlineAttrs("source-a/filter-a"),
      cache: vi.fn(() => {
        const recache = {
          data: new Uint8ClampedArray(original),
          width: imageData.width,
          height: imageData.height,
        };
        outlineKonvaFilter.call(node, recache);
        committed = recache.data;
      }),
      clearCache: vi.fn(),
      getLayer: vi.fn(() => layer),
      isDestroyed: vi.fn(() => false),
    };

    outlineKonvaFilter.call(node, imageData);
    expect(Array.from(imageData.data)).toEqual(Array.from(original));
    await waitFor(() => expect(workerHarness.run).toHaveBeenCalledOnce());

    const expected = resolveWorkerCall(0);
    await waitFor(() => expect(node.cache).toHaveBeenCalledWith({ offset: 3 }));

    expect(node.clearCache).toHaveBeenCalledOnce();
    expect(layer.batchDraw).toHaveBeenCalledOnce();
    expect(committed).not.toBeNull();
    expect(Array.from(committed!)).toEqual(Array.from(expected));
  });

  it("aborts the previous epoch and ignores its late result after the source revision changes", async () => {
    const firstImage = largeImage();
    const secondImage = largeImage();
    const layer = { batchDraw: vi.fn() };
    const node = {
      attrs: outlineAttrs("source-a/filter-a"),
      cache: vi.fn(() => {
        const recache = largeImage();
        outlineKonvaFilter.call(node, recache);
      }),
      clearCache: vi.fn(),
      getLayer: vi.fn(() => layer),
      isDestroyed: vi.fn(() => false),
    };

    outlineKonvaFilter.call(node, firstImage);
    await waitFor(() => expect(workerHarness.calls).toHaveLength(1));
    node.attrs = outlineAttrs("source-b/filter-b");
    outlineKonvaFilter.call(node, secondImage);
    await waitFor(() => expect(workerHarness.calls).toHaveLength(2));
    expect(workerHarness.calls[0]!.options.signal?.aborted).toBe(true);

    resolveWorkerCall(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(node.cache).not.toHaveBeenCalled();

    resolveWorkerCall(1);
    await waitFor(() => expect(node.cache).toHaveBeenCalledOnce());
    expect(layer.batchDraw).toHaveBeenCalledOnce();
  });

  it("fails closed when the Worker fails and never runs the large EDT on the main-thread buffer", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const imageData = largeImage();
    const original = new Uint8ClampedArray(imageData.data);
    const node = {
      attrs: outlineAttrs("source-failure"),
      cache: vi.fn(),
      clearCache: vi.fn(),
      getLayer: vi.fn(),
    };

    outlineKonvaFilter.call(node, imageData);
    await waitFor(() => expect(workerHarness.calls).toHaveLength(1));
    workerHarness.calls[0]!.reject(new Error("worker boom"));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());

    expect(Array.from(imageData.data)).toEqual(Array.from(original));
    expect(node.cache).not.toHaveBeenCalled();
    expect(node.clearCache).not.toHaveBeenCalled();
  });
});
