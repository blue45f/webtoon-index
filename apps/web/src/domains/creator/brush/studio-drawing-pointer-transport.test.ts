import { describe, expect, it, vi } from "vitest";

import {
  beginStudioStrokePointerSession,
  type StudioPointerEventLike,
} from "../canvas/studio-pointer-input";

import {
  createStudioDrawingPointerTransportController,
  resolveStudioDrawingPointerCaptureTarget,
  type StudioDrawingPointerEventTarget,
  type StudioDrawingPointerFinishRequest,
  type StudioDrawingPointerTransportPorts,
  type StudioDrawingPointerVisibilityTarget,
} from "./studio-drawing-pointer-transport";

function captureOption(options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean {
  return typeof options === "boolean" ? options : options?.capture === true;
}

class TestEventTarget implements StudioDrawingPointerEventTarget {
  private readonly listeners = new Map<
    string,
    Array<{ capture: boolean; listener: EventListenerOrEventListenerObject }>
  >();
  throwOnAddType: string | null = null;

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (this.throwOnAddType === type) throw new Error(`listener failure: ${type}`);
    const entries = this.listeners.get(type) ?? [];
    entries.push({ capture: captureOption(options), listener });
    this.listeners.set(type, entries);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void {
    const capture = captureOption(options);
    const entries = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener || entry.capture !== capture)
    );
  }

  emit(type: string, event: Event): void {
    for (const { listener } of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  listenerCount(type?: string): number {
    if (type) return this.listeners.get(type)?.length ?? 0;
    return [...this.listeners.values()].reduce((total, entries) => total + entries.length, 0);
  }

  listenerCapture(type: string): boolean | undefined {
    return this.listeners.get(type)?.[0]?.capture;
  }
}

class TestVisibilityTarget extends TestEventTarget implements StudioDrawingPointerVisibilityTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

class TestCaptureTarget extends TestEventTarget {
  readonly releasePointerCapture = vi.fn((pointerId: number) => {
    this.captured.delete(pointerId);
  });
  readonly setPointerCapture = vi.fn((pointerId: number) => {
    this.captured.add(pointerId);
  });
  private readonly captured = new Set<number>();

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }
}

function pointerEvent(
  type: string,
  overrides: Partial<PointerEvent & StudioPointerEventLike> = {}
): PointerEvent {
  return {
    type,
    pointerId: 7,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 20,
    pressure: 0.5,
    timeStamp: 1,
    target: null,
    ...overrides,
  } as PointerEvent;
}

function pointerSession(event: PointerEvent) {
  const session = beginStudioStrokePointerSession(event);
  if (!session) throw new Error("expected a pointer session");
  return session;
}

function portSpies(overrides: Partial<StudioDrawingPointerTransportPorts> = {}) {
  const finishes: Array<{ event: PointerEvent; request: StudioDrawingPointerFinishRequest }> = [];
  const onAuthoritativeMove = vi.fn();
  const onRawPreviewMove = vi.fn();
  const onDiscard = vi.fn();
  const onFinish = vi.fn((event: PointerEvent, request: StudioDrawingPointerFinishRequest) => {
    finishes.push({ event, request });
  });
  return {
    finishes,
    ports: {
      getLastAuthoritativePointer: () => null,
      onAuthoritativeMove,
      onRawPreviewMove,
      onDiscard,
      onFinish,
      ...overrides,
    } satisfies StudioDrawingPointerTransportPorts,
    onAuthoritativeMove,
    onRawPreviewMove,
    onDiscard,
    onFinish,
  };
}

describe("studio drawing pointer transport", () => {
  it("resolves Konva content before the native target and falls back without React or Konva types", () => {
    const content = new TestCaptureTarget();
    const nativeTarget = new TestCaptureTarget();
    const down = pointerEvent("pointerdown", { target: nativeTarget as unknown as EventTarget });

    expect(resolveStudioDrawingPointerCaptureTarget({ content }, down)).toBe(content);
    expect(resolveStudioDrawingPointerCaptureTarget(null, down)).toBe(nativeTarget);
    expect(resolveStudioDrawingPointerCaptureTarget(null, pointerEvent("pointerdown"))).toBeNull();
  });

  it("arms one pointer atomically and clears listeners, capture, and session on release/dispose", () => {
    const windowTarget = new TestEventTarget();
    const documentTarget = new TestVisibilityTarget();
    const captureTarget = new TestCaptureTarget();
    const down = pointerEvent("pointerdown", { target: captureTarget as unknown as EventTarget });
    const controller = createStudioDrawingPointerTransportController({
      documentTarget,
      windowTarget,
    });
    controller.updatePorts(portSpies().ports);

    expect(controller.start({ pointerEvent: down, session: pointerSession(down), stage: null }))
      .toEqual({ captured: true, started: true });
    expect(controller.getSession()?.pointerId).toBe(7);
    expect(controller.getCaptureTarget()).toBe(captureTarget);
    expect(captureTarget.setPointerCapture).toHaveBeenCalledWith(7);
    expect(windowTarget.listenerCount()).toBe(6);
    expect(windowTarget.listenerCapture("pointermove")).toBe(true);
    expect(windowTarget.listenerCapture("pointerrawupdate")).toBe(true);
    expect(documentTarget.listenerCount("visibilitychange")).toBe(1);
    expect(captureTarget.listenerCount("lostpointercapture")).toBe(1);

    const foreignDown = pointerEvent("pointerdown", { pointerId: 9 });
    expect(
      controller.start({ pointerEvent: foreignDown, session: pointerSession(foreignDown), stage: null })
    ).toEqual({ captured: false, started: false });
    expect(controller.getSession()?.pointerId).toBe(7);

    controller.release();
    expect(controller.getSession()).toBeNull();
    expect(controller.getCaptureTarget()).toBeNull();
    expect(windowTarget.listenerCount()).toBe(0);
    expect(documentTarget.listenerCount()).toBe(0);
    expect(captureTarget.listenerCount()).toBe(0);
    expect(captureTarget.releasePointerCapture).toHaveBeenCalledWith(7);

    // React StrictMode setup→cleanup→setup reuses the stable controller instance.
    controller.dispose();
    expect(controller.start({ pointerEvent: down, session: pointerSession(down), stage: null }).started)
      .toBe(true);
    controller.dispose();
  });

  it("rolls back capture and every partially installed listener when a host listener throws", () => {
    const windowTarget = new TestEventTarget();
    windowTarget.throwOnAddType = "pointercancel";
    const documentTarget = new TestVisibilityTarget();
    const captureTarget = new TestCaptureTarget();
    const down = pointerEvent("pointerdown", { target: captureTarget as unknown as EventTarget });
    const controller = createStudioDrawingPointerTransportController({
      documentTarget,
      windowTarget,
    });

    expect(controller.start({ pointerEvent: down, session: pointerSession(down), stage: null }))
      .toEqual({ captured: false, started: false });
    expect(controller.getSession()).toBeNull();
    expect(controller.getCaptureTarget()).toBeNull();
    expect(windowTarget.listenerCount()).toBe(0);
    expect(documentTarget.listenerCount()).toBe(0);
    expect(captureTarget.listenerCount()).toBe(0);
    expect(captureTarget.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("uses capture-phase native moves as the authoritative transport and always reads latest ports", () => {
    const windowTarget = new TestEventTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown");
    const firstMove = vi.fn();
    const secondMove = vi.fn((_event: PointerEvent) => {
      const session = controller.getSession();
      if (session) {
        controller.replaceSession({
          ...session,
          lastAuthoritativeSample: {
            ...session.lastAuthoritativeSample,
            clientX: 999,
          },
        });
      }
    });
    controller.updatePorts(portSpies({ onAuthoritativeMove: firstMove }).ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    windowTarget.emit("pointermove", pointerEvent("pointermove", { pointerId: 99 }));
    expect(firstMove).not.toHaveBeenCalled();
    windowTarget.emit("pointermove", pointerEvent("pointermove", { timeStamp: 2 }));
    expect(firstMove).toHaveBeenCalledTimes(1);

    controller.updatePorts(portSpies({ onAuthoritativeMove: secondMove }).ports);
    windowTarget.emit("pointermove", pointerEvent("pointermove", { timeStamp: 3 }));
    expect(firstMove).toHaveBeenCalledTimes(1);
    expect(secondMove).toHaveBeenCalledTimes(1);
    expect(controller.getSession()?.lastAuthoritativeSample.clientX).toBe(999);
    controller.release();
  });

  it("delivers processed and raw pen samples synchronously without a frame-queue wait", () => {
    const windowTarget = new TestEventTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown");
    const order: string[] = [];
    const spies = portSpies({
      onAuthoritativeMove: () => {
        order.push("authoritative");
      },
      onRawPreviewMove: () => {
        order.push("raw-preview");
      },
    });
    controller.updatePorts(spies.ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    order.push("before-raw");
    windowTarget.emit("pointerrawupdate", pointerEvent("pointerrawupdate", { timeStamp: 2 }));
    order.push("after-raw");
    windowTarget.emit("pointermove", pointerEvent("pointermove", { timeStamp: 3 }));
    order.push("after-move");

    expect(order).toEqual([
      "before-raw",
      "raw-preview",
      "after-raw",
      "authoritative",
      "after-move",
    ]);
    expect(controller.getDiagnostics()).toMatchObject({
      authoritativeMoveDeliveries: 1,
      rawPreviewDeliveries: 1,
    });
    controller.release();
  });

  it("uses pen raw updates for cursor preview without advancing authoritative ink", () => {
    const windowTarget = new TestEventTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown", { pointerType: "pen" });
    const spies = portSpies();
    controller.updatePorts(spies.ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    const raw = pointerEvent("pointerrawupdate", { pointerType: "pen", timeStamp: 2 });
    windowTarget.emit("pointerrawupdate", raw);

    expect(spies.onRawPreviewMove).toHaveBeenCalledTimes(1);
    expect(spies.onRawPreviewMove).toHaveBeenCalledWith(raw);
    expect(spies.onAuthoritativeMove).not.toHaveBeenCalled();

    const processed = pointerEvent("pointermove", { pointerType: "pen", timeStamp: 3 });
    windowTarget.emit("pointermove", processed);
    expect(spies.onAuthoritativeMove).toHaveBeenCalledTimes(1);
    controller.release();
  });

  it("does not install the high-rate raw preview listener for mouse or touch", () => {
    for (const pointerType of ["mouse", "touch"] as const) {
      const windowTarget = new TestEventTarget();
      const controller = createStudioDrawingPointerTransportController({ windowTarget });
      const down = pointerEvent("pointerdown", { pointerType });
      controller.updatePorts(portSpies().ports);
      controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

      expect(windowTarget.listenerCount("pointerrawupdate")).toBe(0);
      expect(windowTarget.listenerCount()).toBe(5);
      controller.release();
    }
  });

  it("finishes released mouse contact without routing the hover coordinate as final ink", () => {
    const windowTarget = new TestEventTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown", { pointerType: "mouse", buttons: 1 });
    const spies = portSpies();
    controller.updatePorts(spies.ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    const hover = pointerEvent("pointermove", { pointerType: "mouse", buttons: 0, timeStamp: 2 });
    windowTarget.emit("pointermove", hover);

    expect(spies.onAuthoritativeMove).not.toHaveBeenCalled();
    expect(spies.finishes).toEqual([
      {
        event: hover,
        request: {
          cancelled: false,
          consumeReleaseSample: false,
          reason: "released-contact",
        },
      },
    ]);
    controller.release();
  });

  it("deduplicates native/stage end while ignoring foreign releases", () => {
    const windowTarget = new TestEventTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown");
    const spies = portSpies({
      onFinish: (event, request) => {
        spies.finishes.push({ event, request });
        controller.release();
      },
    });
    controller.updatePorts(spies.ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    const foreignUp = pointerEvent("pointerup", { pointerId: 99 });
    windowTarget.emit("pointerup", foreignUp);
    expect(spies.finishes).toEqual([]);
    expect(controller.consumeHandledNativeEnd(foreignUp)).toBe(false);

    const up = pointerEvent("pointerup", { buttons: 0, timeStamp: 2 });
    windowTarget.emit("pointerup", up);
    expect(spies.finishes[0]?.request).toEqual({
      cancelled: false,
      consumeReleaseSample: true,
      reason: "pointerup",
    });
    expect(controller.consumeHandledNativeEnd(up)).toBe(true);
    expect(controller.consumeHandledNativeEnd(up)).toBe(false);
    expect(controller.getSession()).toBeNull();
  });

  it("claims the final pointerup endpoint exactly once even before a consumer releases", () => {
    const windowTarget = new TestEventTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown");
    const spies = portSpies();
    controller.updatePorts(spies.ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    const up = pointerEvent("pointerup", {
      buttons: 0,
      clientX: 127,
      clientY: 233,
      pressure: 0,
      timeStamp: 9,
    });
    windowTarget.emit("pointerup", up);
    windowTarget.emit("pointerup", up);
    windowTarget.emit("pointermove", pointerEvent("pointermove", { timeStamp: 10 }));

    expect(spies.onFinish).toHaveBeenCalledTimes(1);
    expect(spies.onFinish).toHaveBeenCalledWith(up, {
      cancelled: false,
      consumeReleaseSample: true,
      reason: "pointerup",
    });
    expect(spies.onFinish.mock.calls[0]?.[0]).toMatchObject({
      clientX: 127,
      clientY: 233,
      pressure: 0,
    });
    expect(controller.getDiagnostics()).toEqual({
      authoritativeMoveDeliveries: 0,
      rawPreviewDeliveries: 0,
      finishRequests: 1,
      discardRequests: 0,
      deliveriesAfterTerminalClaim: 2,
    });
    controller.release();
  });

  it("releases capture and high-rate listeners when a terminal consumer throws", () => {
    const windowTarget = new TestEventTarget();
    const captureTarget = new TestCaptureTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown", {
      target: captureTarget as unknown as EventTarget,
    });
    const expected = new Error("finish failed");
    controller.updatePorts(portSpies({
      onFinish: () => {
        throw expected;
      },
    }).ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    expect(() => {
      windowTarget.emit("pointerup", pointerEvent("pointerup", { buttons: 0 }));
    }).toThrow(expected);
    expect(controller.getSession()).toBeNull();
    expect(windowTarget.listenerCount()).toBe(0);
    expect(captureTarget.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it.each([
    ["pen", "finish"],
    ["mouse", "finish"],
    ["touch", "discard"],
  ] as const)("routes %s pointercancel through %s semantics", (pointerType, outcome) => {
    const windowTarget = new TestEventTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const down = pointerEvent("pointerdown", { pointerType });
    const spies = portSpies();
    controller.updatePorts(spies.ports);
    controller.start({ pointerEvent: down, session: pointerSession(down), stage: null });

    const cancel = pointerEvent("pointercancel", { pointerType, buttons: 0, timeStamp: 2 });
    windowTarget.emit("pointercancel", cancel);

    if (outcome === "finish") {
      expect(spies.finishes[0]?.request).toEqual({
        cancelled: true,
        consumeReleaseSample: false,
        reason: "pointercancel-prefix",
      });
      expect(spies.onDiscard).not.toHaveBeenCalled();
    } else {
      expect(spies.finishes).toEqual([]);
      expect(spies.onDiscard).toHaveBeenCalledTimes(1);
    }
    expect(controller.consumeHandledNativeEnd(cancel)).toBe(true);
    controller.release();
  });

  it("ignores descendant blur, preserves a pen prefix on top-level abort, and discards touch", () => {
    const windowTarget = new TestEventTarget();
    const documentTarget = new TestVisibilityTarget();
    const controller = createStudioDrawingPointerTransportController({
      documentTarget,
      windowTarget,
    });
    const penDown = pointerEvent("pointerdown");
    const penLast = pointerEvent("pointermove", { timeStamp: 2 });
    const penSpies = portSpies({ getLastAuthoritativePointer: () => penLast });
    controller.updatePorts(penSpies.ports);
    controller.start({ pointerEvent: penDown, session: pointerSession(penDown), stage: null });

    windowTarget.emit("blur", { type: "blur", target: {} } as unknown as Event);
    expect(penSpies.finishes).toEqual([]);
    windowTarget.emit(
      "blur",
      { type: "blur", target: windowTarget } as unknown as Event
    );
    expect(penSpies.finishes).toEqual([
      {
        event: penLast,
        request: {
          cancelled: true,
          consumeReleaseSample: false,
          reason: "transport-abort",
        },
      },
    ]);
    controller.release();

    const touchDown = pointerEvent("pointerdown", { pointerType: "touch" });
    const touchSpies = portSpies({ getLastAuthoritativePointer: () => touchDown });
    controller.updatePorts(touchSpies.ports);
    controller.start({ pointerEvent: touchDown, session: pointerSession(touchDown), stage: null });
    documentTarget.visibilityState = "hidden";
    documentTarget.emit(
      "visibilitychange",
      { type: "visibilitychange", target: documentTarget } as unknown as Event
    );
    expect(touchSpies.onDiscard).toHaveBeenCalledTimes(1);
    expect(touchSpies.finishes).toEqual([]);
    controller.release();
  });

  it("treats lost capture as foreign, wait, or finish while leaving the global end net armed", () => {
    const windowTarget = new TestEventTarget();
    const captureTarget = new TestCaptureTarget();
    const controller = createStudioDrawingPointerTransportController({ windowTarget });
    const penDown = pointerEvent("pointerdown", {
      target: captureTarget as unknown as EventTarget,
    });
    const penSpies = portSpies();
    controller.updatePorts(penSpies.ports);
    controller.start({ pointerEvent: penDown, session: pointerSession(penDown), stage: null });

    captureTarget.emit("lostpointercapture", pointerEvent("lostpointercapture", { pointerId: 99 }));
    expect(controller.getCaptureTarget()).toBe(captureTarget);
    captureTarget.emit("lostpointercapture", pointerEvent("lostpointercapture", { buttons: 0 }));
    expect(controller.getCaptureTarget()).toBeNull();
    expect(controller.getSession()?.pointerId).toBe(7);
    expect(penSpies.finishes).toEqual([]);
    const penUp = pointerEvent("pointerup", { buttons: 0, timeStamp: 3 });
    windowTarget.emit("pointerup", penUp);
    expect(penSpies.finishes[0]?.request.reason).toBe("pointerup");
    controller.release();

    const mouseCapture = new TestCaptureTarget();
    const mouseDown = pointerEvent("pointerdown", {
      pointerType: "mouse",
      target: mouseCapture as unknown as EventTarget,
    });
    const mouseSpies = portSpies();
    controller.updatePorts(mouseSpies.ports);
    controller.start({ pointerEvent: mouseDown, session: pointerSession(mouseDown), stage: null });
    const lost = pointerEvent("lostpointercapture", { pointerType: "mouse", buttons: 0 });
    mouseCapture.emit("lostpointercapture", lost);
    expect(mouseSpies.finishes).toEqual([
      {
        event: lost,
        request: {
          cancelled: false,
          consumeReleaseSample: false,
          reason: "lost-capture",
        },
      },
    ]);
    controller.release();
  });
});
