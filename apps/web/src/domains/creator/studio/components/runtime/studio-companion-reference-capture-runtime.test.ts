import { describe, expect, it, vi } from "vitest";

import {
  createStudioCompanionReferenceCaptureRuntime,
  type StudioCompanionReferencePreviewRuntimeModule,
  type StudioCompanionReferenceSourceRuntimeModule,
} from "./studio-companion-reference-capture-runtime";

import type {
  StudioCompanionReferenceSourceRuntime,
  StudioCompanionReferenceSourceSnapshot,
} from "./studio-companion-reference-source-runtime";
import type { StudioCompanionReferencePreviewFrame } from "@/src/domains/creator/studio-companion-reference-projection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function sourceSnapshot(fill = 17): StudioCompanionReferenceSourceSnapshot & {
  pixels: Uint8ClampedArray;
  drawable: { width: number; height: number };
} {
  const pixels = new Uint8ClampedArray([fill, fill + 1, fill + 2, 255]);
  const drawable = { width: 1, height: 1 };
  const items = Object.freeze([Object.freeze({
    source: Object.freeze({
      drawable,
      width: 1,
      height: 1,
      pixels,
      layoutWidth: 1,
      layoutHeight: 1,
    }),
    view: Object.freeze({
      centerX: 0.5,
      centerY: 0.5,
      zoom: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      grayscale: false,
    }),
  })]);
  const sampling = Object.freeze({ boardWidth: 1_280, boardHeight: 720, items });
  return Object.freeze({
    boardWidth: 1_280 as const,
    boardHeight: 720 as const,
    itemCount: 1,
    resolvedItemCount: 1,
    canPickColor: true,
    previewInput: sampling,
    colorSamplingInput: sampling,
    pixels,
    drawable,
  });
}

function zeroResolvedSourceSnapshot(
  itemCount: number
): StudioCompanionReferenceSourceSnapshot {
  const snapshot = sourceSnapshot();
  return Object.freeze({
    ...snapshot,
    itemCount,
    resolvedItemCount: 0,
    canPickColor: false,
  });
}

function trackAbortListeners(signal: AbortSignal) {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  vi.spyOn(signal, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "abort") listeners.add(listener);
    originalAdd(type, listener, options);
  });
  vi.spyOn(signal, "removeEventListener").mockImplementation((type, listener, options) => {
    if (type === "abort") listeners.delete(listener);
    originalRemove(type, listener, options);
  });
  return listeners;
}

function sourceModuleFrom(
  resolveSnapshot: (
    document: unknown,
    signal: AbortSignal
  ) => Promise<StudioCompanionReferenceSourceSnapshot | null>
): {
  module: StudioCompanionReferenceSourceRuntimeModule;
  runtime: StudioCompanionReferenceSourceRuntime;
  setDemand: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  let current: StudioCompanionReferenceSourceSnapshot | null = null;
  const owned = new Set<ReturnType<typeof sourceSnapshot>>();
  const clearOwned = () => {
    for (const snapshot of owned) {
      snapshot.pixels.fill(0);
      snapshot.drawable.width = 1;
      snapshot.drawable.height = 1;
    }
    owned.clear();
    current = null;
  };
  const release = vi.fn(clearOwned);
  const setDemand = vi.fn(async (demand: {
    active: boolean;
    document: unknown;
    signal?: AbortSignal;
  }) => {
    clearOwned();
    if (!demand.active) return { status: "inactive" as const, snapshot: null };
    const snapshot = await resolveSnapshot(demand.document, demand.signal!);
    if (!snapshot || demand.signal?.aborted) return { status: "stale" as const, snapshot: null };
    current = snapshot;
    if ("pixels" in snapshot) owned.add(snapshot as ReturnType<typeof sourceSnapshot>);
    return { status: "ready" as const, snapshot };
  });
  const runtime: StudioCompanionReferenceSourceRuntime = {
    setDemand,
    current: () => current,
    release,
  };
  return {
    module: { createStudioCompanionReferenceSourceRuntime: () => runtime },
    runtime,
    setDemand,
    release,
  };
}

function terminalSourceModuleFrom(
  resolveSnapshot: () => Promise<StudioCompanionReferenceSourceSnapshot | null>
) {
  const runtimes: Array<{
    setDemand: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }> = [];
  const create = vi.fn((): StudioCompanionReferenceSourceRuntime => {
    let released = false;
    let current: StudioCompanionReferenceSourceSnapshot | null = null;
    const setDemand = vi.fn(async (demand: { active: boolean; signal?: AbortSignal }) => {
      if (released || !demand.active) return { status: "inactive" as const, snapshot: null };
      const snapshot = await resolveSnapshot();
      if (!snapshot || demand.signal?.aborted) return { status: "stale" as const, snapshot: null };
      current = snapshot;
      return { status: "ready" as const, snapshot };
    });
    const release = vi.fn(() => {
      released = true;
      current = null;
    });
    runtimes.push({ setDemand, release });
    return { setDemand, current: () => current, release };
  });
  return {
    module: { createStudioCompanionReferenceSourceRuntime: create },
    create,
    runtimes,
  } satisfies {
    module: StudioCompanionReferenceSourceRuntimeModule;
    create: ReturnType<typeof vi.fn>;
    runtimes: Array<{
      setDemand: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    }>;
  };
}

function callbacks() {
  let snapshot: Readonly<{ document: unknown; revision: number; itemCount: number }> = Object.freeze({
    document: Object.freeze({ referenceRevision: 1 }),
    revision: 1,
    itemCount: 1,
  });
  let blocked = false;
  const onProjectionChanged = vi.fn();
  const getSnapshot = vi.fn(() => snapshot);
  return {
    input: {
      getSnapshot,
      isCaptureBlocked: () => blocked,
      onProjectionChanged,
    },
    getSnapshot,
    onProjectionChanged,
    setRevision: (revision: number) => {
      snapshot = Object.freeze({
        document: Object.freeze({ referenceRevision: revision }),
        revision,
        itemCount: snapshot.itemCount,
      });
    },
    setItemCount: (itemCount: number) => {
      snapshot = Object.freeze({ ...snapshot, itemCount });
    },
    setSnapshot: (next: { document: unknown; revision: number; itemCount: number }) => {
      snapshot = Object.freeze(next);
    },
    setBlocked: (value: boolean) => { blocked = value; },
  };
}

function frame(overrides: Partial<StudioCompanionReferencePreviewFrame> = {}) {
  return {
    generation: 3,
    revision: 2,
    referenceRevision: 1,
    sequence: 1,
    width: 320,
    height: 180,
    blob: new Blob([new Uint8Array([1])], { type: "image/webp" }),
    ...overrides,
  } satisfies StudioCompanionReferencePreviewFrame;
}

describe("Studio companion reference capture runtime", () => {
  it("loads neither source nor preview chunks before Reference demand", async () => {
    const sourceLoader = vi.fn();
    const previewLoader = vi.fn();
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: sourceLoader,
      loadPreviewRuntime: previewLoader,
    });

    expect(runtime.getProjection(1)).toBeNull();
    await expect(runtime.captureFrame({
      generation: 1,
      revision: 2,
      referenceRevision: 1,
      sequence: 1,
      signal: new AbortController().signal,
    })).resolves.toBeNull();
    await expect(runtime.sampleColor({
      current: { generation: 1, revision: 1, referenceRevision: 1 },
      point: { x: 0.5, y: 0.5 },
      sequence: 1,
      signal: new AbortController().signal,
    })).resolves.toBeNull();
    await expect(runtime.setDemand(false)).resolves.toBe(false);

    expect(sourceLoader).not.toHaveBeenCalled();
    expect(previewLoader).not.toHaveBeenCalled();
  });

  it("advances the first ready projection beyond bootstrap revision 1 at the same board revision", async () => {
    const source = sourceModuleFrom(async () => sourceSnapshot());
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
    });

    await expect(runtime.setDemand(true)).resolves.toBe(true);
    expect(runtime.getProjection(6)).toEqual(expect.objectContaining({
      generation: 6,
      revision: 3,
      referenceRevision: 1,
      resolvedItemCount: 1,
    }));
  });

  it("prepares on first demand, reuses one revision, and replaces it when revision advances", async () => {
    const first = sourceSnapshot(20);
    const second = sourceSnapshot(40);
    const source = sourceModuleFrom(async (document) => (
      (document as { referenceRevision: number }).referenceRevision === 1 ? first : second
    ));
    const loadSourceRuntime = vi.fn(async () => source.module);
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime,
    });

    await expect(runtime.setDemand(true)).resolves.toBe(true);
    expect(state.onProjectionChanged).toHaveBeenCalledTimes(2);
    expect(runtime.getProjection(3)).toEqual({
      generation: 3,
      revision: 3,
      referenceRevision: 1,
      itemCount: 1,
      resolvedItemCount: 1,
      canPickColor: true,
    });
    await expect(runtime.setDemand(true)).resolves.toBe(true);
    expect(loadSourceRuntime).toHaveBeenCalledOnce();
    expect(source.setDemand).toHaveBeenCalledOnce();
    expect(state.getSnapshot).toHaveBeenCalled();

    state.setRevision(2);
    expect(runtime.getProjection(3)).toEqual({
      generation: 3,
      revision: 4,
      referenceRevision: 2,
      itemCount: 1,
      resolvedItemCount: 0,
      canPickColor: false,
    });
    await vi.waitFor(() => expect(state.onProjectionChanged).toHaveBeenCalledTimes(4));
    expect(runtime.getProjection(3)).toEqual(expect.objectContaining({
      generation: 3,
      revision: 5,
      referenceRevision: 2,
    }));
    expect(source.setDemand).toHaveBeenCalledTimes(2);
    expect(source.release).toHaveBeenCalledOnce();
    expect(first.pixels.every((value) => value === 0)).toBe(true);
  });

  it("publishes a monotonic unresolved projection before replacement decoding can fail", async () => {
    const first = sourceSnapshot(32);
    const source = sourceModuleFrom(async (document) => {
      if ((document as { referenceRevision: number }).referenceRevision === 2) {
        throw new Error("replacement decode failed");
      }
      return first;
    });
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
    });

    await expect(runtime.setDemand(true)).resolves.toBe(true);
    const previous = runtime.getProjection(5)!;
    expect(previous).toEqual(expect.objectContaining({
      revision: 3,
      referenceRevision: 1,
      resolvedItemCount: 1,
    }));

    state.setRevision(2);
    const invalidated = runtime.getProjection(5)!;
    expect(invalidated).toEqual({
      generation: 5,
      revision: 4,
      referenceRevision: 2,
      itemCount: 1,
      resolvedItemCount: 0,
      canPickColor: false,
    });
    expect(invalidated.revision).toBeGreaterThan(previous.revision);
    expect(first.pixels.every((value) => value === 0)).toBe(true);

    await vi.waitFor(() => expect(source.setDemand).toHaveBeenCalledTimes(2));
    expect(runtime.getProjection(5)).toEqual(invalidated);
    await expect(runtime.setDemand(true)).resolves.toBe(false);
    // Depending on microtask settlement, explicit demand either joins attempt 2 or starts attempt 3.
    expect(source.setDemand.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(source.setDemand.mock.calls.length).toBeLessThanOrEqual(3);
    expect(runtime.getProjection(5)).toEqual(invalidated);
    await expect(runtime.captureFrame({
      ...previous,
      sequence: 1,
      signal: new AbortController().signal,
    })).resolves.toBeNull();
    expect(state.onProjectionChanged).toHaveBeenCalledTimes(3);
    runtime.release();
  });

  it("retries transient source failures on one unresolved public cursor with a bounded backoff", async () => {
    vi.useFakeTimers({ now: 10_000 });
    try {
      let attempts = 0;
      const source = sourceModuleFrom(async () => {
        attempts += 1;
        if (attempts < 4) throw new Error("transient source failure");
        return sourceSnapshot(80);
      });
      const state = callbacks();
      const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
        loadSourceRuntime: async () => source.module,
      });

      await expect(runtime.setDemand(true)).resolves.toBe(false);
      const unresolved = runtime.getProjection(7);
      expect(unresolved).toEqual({
        generation: 7,
        revision: 2,
        referenceRevision: 1,
        itemCount: 1,
        resolvedItemCount: 0,
        canPickColor: false,
      });
      expect(source.setDemand).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(500);
      expect(source.setDemand).toHaveBeenCalledTimes(2);
      expect(runtime.getProjection(7)).toEqual(unresolved);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(source.setDemand).toHaveBeenCalledTimes(3);
      expect(runtime.getProjection(7)).toEqual(unresolved);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(source.setDemand).toHaveBeenCalledTimes(4);
      expect(runtime.getProjection(7)).toEqual(expect.objectContaining({
        revision: 3,
        referenceRevision: 1,
        resolvedItemCount: 1,
      }));
      expect(state.onProjectionChanged).toHaveBeenCalledTimes(2);
      runtime.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries ready-0 only for a contentful board and stops at the shared four-attempt budget", async () => {
    vi.useFakeTimers({ now: 20_000 });
    try {
      const contentfulSource = terminalSourceModuleFrom(
        async () => zeroResolvedSourceSnapshot(1)
      );
      const contentfulState = callbacks();
      const contentfulRuntime = createStudioCompanionReferenceCaptureRuntime(
        contentfulState.input,
        { loadSourceRuntime: async () => contentfulSource.module }
      );

      await expect(contentfulRuntime.setDemand(true)).resolves.toBe(false);
      const unresolved = contentfulRuntime.getProjection(2);
      await vi.advanceTimersByTimeAsync(500 + 1_000 + 2_000 + 10_000);
      expect(contentfulSource.create).toHaveBeenCalledTimes(4);
      await expect(contentfulRuntime.setDemand(true)).resolves.toBe(false);
      expect(contentfulSource.create).toHaveBeenCalledTimes(4);
      expect(contentfulSource.runtimes.every((entry) => entry.release.mock.calls.length === 1))
        .toBe(true);
      expect(contentfulRuntime.getProjection(2)).toEqual(unresolved);
      expect(unresolved).toEqual(expect.objectContaining({
        itemCount: 1,
        resolvedItemCount: 0,
        revision: 2,
      }));
      contentfulRuntime.release();

      const emptySource = sourceModuleFrom(async () => zeroResolvedSourceSnapshot(0));
      const emptyState = callbacks();
      emptyState.setItemCount(0);
      const emptyRuntime = createStudioCompanionReferenceCaptureRuntime(emptyState.input, {
        loadSourceRuntime: async () => emptySource.module,
      });
      await expect(emptyRuntime.setDemand(true)).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(emptySource.setDemand).toHaveBeenCalledOnce();
      expect(emptyRuntime.getProjection(2)).toEqual(expect.objectContaining({
        itemCount: 0,
        resolvedItemCount: 0,
        revision: 3,
      }));
      emptyRuntime.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps committed document/revision/count atomic and discards an awaited stale source", async () => {
    const firstPending = deferred<StudioCompanionReferenceSourceSnapshot | null>();
    const secondPending = deferred<StudioCompanionReferenceSourceSnapshot | null>();
    const source = sourceModuleFrom((document) => (
      (document as { id: string }).id === "commit-a"
        ? firstPending.promise
        : secondPending.promise
    ));
    const state = callbacks();
    state.setSnapshot({ document: { id: "commit-a" }, revision: 1, itemCount: 2 });
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
    });

    const firstDemand = runtime.setDemand(true);
    await vi.waitFor(() => expect(source.setDemand).toHaveBeenCalledOnce());
    expect(source.setDemand.mock.calls[0]?.[0].document).toEqual({ id: "commit-a" });
    const firstSignal = source.setDemand.mock.calls[0]?.[0].signal as AbortSignal;
    state.setSnapshot({ document: { id: "commit-b" }, revision: 2, itemCount: 5 });
    expect(runtime.getProjection(4)).toEqual(expect.objectContaining({
      referenceRevision: 2,
      itemCount: 5,
      resolvedItemCount: 0,
      canPickColor: false,
    }));
    await vi.waitFor(() => expect(source.setDemand).toHaveBeenCalledTimes(2));
    expect(source.setDemand.mock.calls[1]?.[0].document).toEqual({ id: "commit-b" });
    expect(firstSignal.aborted).toBe(true);

    const current = sourceSnapshot(90);
    secondPending.resolve(current);
    await vi.waitFor(() => expect(state.onProjectionChanged).toHaveBeenCalledTimes(3));
    firstPending.resolve(sourceSnapshot(10));
    await expect(firstDemand).resolves.toBe(false);
    expect(runtime.getProjection(4)).toEqual(expect.objectContaining({
      referenceRevision: 2,
      resolvedItemCount: 1,
    }));
    expect(state.onProjectionChanged).toHaveBeenCalledTimes(3);
  });

  it("does not import the preview compositor for blocked, aborted, or mismatched captures", async () => {
    const source = sourceModuleFrom(async () => sourceSnapshot());
    const createFrame = vi.fn(async (
      input: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[0],
      _options?: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[1],
      _dependencies?: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[2]
    ) => frame({
      generation: input.generation,
      revision: input.revision,
      referenceRevision: input.referenceRevision,
      sequence: input.sequence,
    }));
    const loadPreviewRuntime = vi.fn(async (): Promise<StudioCompanionReferencePreviewRuntimeModule> => ({
      createStudioCompanionReferencePreviewFrame: createFrame,
      sampleStudioCompanionReferenceColor: vi.fn(() => "#112233"),
    }));
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
      loadPreviewRuntime,
    });
    await runtime.setDemand(true);
    const projection = runtime.getProjection(3)!;
    const request = {
      generation: projection.generation,
      revision: projection.revision,
      referenceRevision: projection.referenceRevision,
      sequence: 1,
      signal: new AbortController().signal,
    };

    state.setBlocked(true);
    await expect(runtime.captureFrame(request)).resolves.toBeNull();
    state.setBlocked(false);
    await expect(runtime.captureFrame({ ...request, revision: 99 })).resolves.toBeNull();
    const aborted = new AbortController();
    aborted.abort();
    await expect(runtime.captureFrame({ ...request, signal: aborted.signal })).resolves.toBeNull();
    expect(loadPreviewRuntime).not.toHaveBeenCalled();

    await expect(runtime.captureFrame(request)).resolves.toEqual(frame({
      generation: projection.generation,
      revision: projection.revision,
      referenceRevision: projection.referenceRevision,
      sequence: request.sequence,
    }));
    expect(loadPreviewRuntime).toHaveBeenCalledOnce();
    expect(createFrame).toHaveBeenCalledWith(expect.objectContaining({
      generation: 3,
      revision: 3,
      referenceRevision: 1,
      sequence: 1,
      boardWidth: 1_280,
      boardHeight: 720,
    }), { signal: expect.any(AbortSignal) }, {
      encoderScope: expect.any(Object),
    });
  });

  it("exits never-settling source and preview loaders on abort without retaining request listeners", async () => {
    const sourceLoaderPending = deferred<StudioCompanionReferenceSourceRuntimeModule>();
    const sourceState = callbacks();
    const sourceRuntime = createStudioCompanionReferenceCaptureRuntime(sourceState.input, {
      loadSourceRuntime: () => sourceLoaderPending.promise,
    });
    const sourceDemand = sourceRuntime.setDemand(true);
    await Promise.resolve();
    await expect(sourceRuntime.setDemand(false)).resolves.toBe(false);
    await expect(sourceDemand).resolves.toBe(false);
    sourceRuntime.release();

    const source = sourceModuleFrom(async () => sourceSnapshot());
    const previewLoaderPending = deferred<StudioCompanionReferencePreviewRuntimeModule>();
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
      loadPreviewRuntime: () => previewLoaderPending.promise,
    });
    await runtime.setDemand(true);
    const projection = runtime.getProjection(3)!;
    const controller = new AbortController();
    const requestListeners = trackAbortListeners(controller.signal);
    const capture = runtime.captureFrame({
      generation: projection.generation,
      revision: projection.revision,
      referenceRevision: projection.referenceRevision,
      sequence: 1,
      signal: controller.signal,
    });
    await Promise.resolve();
    expect(requestListeners.size).toBe(1);
    controller.abort();
    await expect(capture).resolves.toBeNull();
    expect(requestListeners.size).toBe(0);
    runtime.release();
  });

  it("fails closed and removes a partially registered hostile request signal", async () => {
    const source = sourceModuleFrom(async () => sourceSnapshot());
    const loadPreviewRuntime = vi.fn();
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
      loadPreviewRuntime,
    });
    await runtime.setDemand(true);
    const projection = runtime.getProjection(3)!;
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const hostileSignal = {
      aborted: false,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener);
        throw new Error("registered, then rejected");
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener);
      },
    } as unknown as AbortSignal;

    await expect(runtime.captureFrame({
      generation: projection.generation,
      revision: projection.revision,
      referenceRevision: projection.referenceRevision,
      sequence: 1,
      signal: hostileSignal,
    })).resolves.toBeNull();
    expect(listeners.size).toBe(0);
    expect(loadPreviewRuntime).not.toHaveBeenCalled();
    runtime.release();
  });

  it("uses one encoder quarantine scope across committed Reference revisions", async () => {
    const source = sourceModuleFrom(async () => sourceSnapshot());
    const createFrame = vi.fn(async (
      input: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[0],
      _options?: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[1],
      _dependencies?: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[2]
    ) => frame({
      generation: input.generation,
      revision: input.revision,
      referenceRevision: input.referenceRevision,
      sequence: input.sequence,
    }));
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
      loadPreviewRuntime: async () => ({
        createStudioCompanionReferencePreviewFrame: createFrame,
        sampleStudioCompanionReferenceColor: () => null,
      }),
    });
    await runtime.setDemand(true);
    const first = runtime.getProjection(4)!;
    await runtime.captureFrame({
      generation: first.generation,
      revision: first.revision,
      referenceRevision: first.referenceRevision,
      sequence: 1,
      signal: new AbortController().signal,
    });

    state.setRevision(2);
    expect(runtime.getProjection(4)?.resolvedItemCount).toBe(0);
    await vi.waitFor(() => expect(state.onProjectionChanged).toHaveBeenCalledTimes(4));
    const second = runtime.getProjection(4)!;
    await runtime.captureFrame({
      generation: second.generation,
      revision: second.revision,
      referenceRevision: second.referenceRevision,
      sequence: 2,
      signal: new AbortController().signal,
    });

    expect(createFrame).toHaveBeenCalledTimes(2);
    const firstScope = createFrame.mock.calls[0]?.[2]?.encoderScope;
    const secondScope = createFrame.mock.calls[1]?.[2]?.encoderScope;
    expect(firstScope).toEqual(expect.any(Object));
    expect(secondScope).toBe(firstScope);
    runtime.release();
  });

  it("never lets an issued unresolved cursor capture the later ready source from the same epoch", async () => {
    const pending = deferred<StudioCompanionReferenceSourceSnapshot | null>();
    const source = sourceModuleFrom(() => pending.promise);
    const loadPreviewRuntime = vi.fn();
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
      loadPreviewRuntime,
    });

    const demand = runtime.setDemand(true);
    const unresolved = runtime.getProjection(9)!;
    expect(unresolved).toEqual(expect.objectContaining({
      revision: 2,
      resolvedItemCount: 0,
      canPickColor: false,
    }));
    pending.resolve(sourceSnapshot(44));
    await expect(demand).resolves.toBe(true);
    expect(runtime.getProjection(9)?.revision).toBe(3);

    await expect(runtime.captureFrame({
      generation: unresolved.generation,
      revision: unresolved.revision,
      referenceRevision: unresolved.referenceRevision,
      sequence: 1,
      signal: new AbortController().signal,
    })).resolves.toBeNull();
    expect(loadPreviewRuntime).not.toHaveBeenCalled();
  });

  it("drops an encoded frame if its source revision changes while composition is in flight", async () => {
    const source = sourceModuleFrom(async () => sourceSnapshot());
    const pending = deferred<StudioCompanionReferencePreviewFrame | null>();
    const createFrame = vi.fn((
      _input: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[0],
      _options?: Parameters<
        StudioCompanionReferencePreviewRuntimeModule["createStudioCompanionReferencePreviewFrame"]
      >[1]
    ) => pending.promise);
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
      loadPreviewRuntime: async () => ({
        createStudioCompanionReferencePreviewFrame: createFrame,
        sampleStudioCompanionReferenceColor: () => "#112233",
      }),
    });
    await runtime.setDemand(true);
    const projection = runtime.getProjection(3)!;
    const capture = runtime.captureFrame({
      generation: projection.generation,
      revision: projection.revision,
      referenceRevision: projection.referenceRevision,
      sequence: 1,
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(createFrame).toHaveBeenCalledOnce());

    state.setRevision(2);
    expect(runtime.getProjection(3)).toEqual(expect.objectContaining({
      referenceRevision: 2,
      resolvedItemCount: 0,
      canPickColor: false,
    }));
    const encodeSignal = createFrame.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(encodeSignal.aborted).toBe(true);
    pending.resolve(frame());
    await expect(capture).resolves.toBeNull();
  });

  it("samples only primary-owned RGBA at an exact issued cursor", async () => {
    const snapshot = sourceSnapshot(60);
    const source = sourceModuleFrom(async () => snapshot);
    const sample = vi.fn(() => "#aabbcc");
    const loadPreviewRuntime = vi.fn(async (): Promise<StudioCompanionReferencePreviewRuntimeModule> => ({
      createStudioCompanionReferencePreviewFrame: vi.fn(async () => null),
      sampleStudioCompanionReferenceColor: sample,
    }));
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
      loadPreviewRuntime,
    });
    await runtime.setDemand(true);
    const projection = runtime.getProjection(8)!;
    const request = {
      current: {
        generation: projection.generation,
        revision: projection.revision,
        referenceRevision: projection.referenceRevision,
      },
      point: { x: 0.25, y: 0.75 },
      sequence: 2,
      signal: new AbortController().signal,
    };

    await expect(runtime.sampleColor({
      ...request,
      current: { ...request.current, referenceRevision: 99 },
    })).resolves.toBeNull();
    expect(loadPreviewRuntime).not.toHaveBeenCalled();
    await expect(runtime.sampleColor(request)).resolves.toBe("#aabbcc");
    expect(sample).toHaveBeenCalledWith(
      snapshot.colorSamplingInput.items,
      { x: 0.25, y: 0.75 },
      1_280,
      720
    );
  });

  it("releases source RGBA on inactive demand and makes release terminal and idempotent", async () => {
    const first = sourceSnapshot(70);
    const second = sourceSnapshot(80);
    let loadCount = 0;
    const source = sourceModuleFrom(async () => (loadCount++ === 0 ? first : second));
    const loadSourceRuntime = vi.fn(async () => source.module);
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime,
    });

    await runtime.setDemand(true);
    await expect(runtime.setDemand(false)).resolves.toBe(false);
    expect(first.pixels.every((value) => value === 0)).toBe(true);
    expect(runtime.getProjection(1)).toBeNull();

    await runtime.setDemand(true);
    expect(second.pixels.some((value) => value !== 0)).toBe(true);
    runtime.release();
    runtime.release();
    expect(second.pixels.every((value) => value === 0)).toBe(true);
    await expect(runtime.setDemand(true)).resolves.toBe(false);
    expect(runtime.getProjection(1)).toBeNull();
    expect(loadSourceRuntime).toHaveBeenCalledOnce();
  });

  it("creates a fresh terminal source runtime after demand is turned off and back on", async () => {
    let fill = 30;
    const source = terminalSourceModuleFrom(async () => sourceSnapshot(fill++));
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
    });

    await expect(runtime.setDemand(true)).resolves.toBe(true);
    await expect(runtime.setDemand(false)).resolves.toBe(false);
    await expect(runtime.setDemand(true)).resolves.toBe(true);

    expect(source.create).toHaveBeenCalledTimes(2);
    expect(source.runtimes[0]?.release).toHaveBeenCalledOnce();
    expect(source.runtimes[0]?.setDemand).toHaveBeenCalledOnce();
    expect(source.runtimes[1]?.setDemand).toHaveBeenCalledOnce();
    runtime.release();
    expect(source.runtimes[1]?.release).toHaveBeenCalledOnce();
  });

  it("fails closed when the reference revision regresses", async () => {
    const snapshot = sourceSnapshot();
    const source = sourceModuleFrom(async () => snapshot);
    const state = callbacks();
    const runtime = createStudioCompanionReferenceCaptureRuntime(state.input, {
      loadSourceRuntime: async () => source.module,
    });

    state.setRevision(4);
    await runtime.setDemand(true);
    expect(runtime.getProjection(2)?.referenceRevision).toBe(4);
    state.setRevision(3);
    expect(runtime.getProjection(2)).toBeNull();
    expect(snapshot.pixels.every((value) => value === 0)).toBe(true);
  });
});
