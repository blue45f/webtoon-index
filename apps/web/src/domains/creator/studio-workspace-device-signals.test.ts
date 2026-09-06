import { describe, expect, it } from "vitest";

import { readStudioWorkspaceDeviceSignals } from "./studio-workspace-device-signals";
import { resolveStudioWorkspaceDeviceKind } from "./studio-workspaces";

function matchMediaReturning(matches: boolean) {
  return () => ({ matches });
}

describe("readStudioWorkspaceDeviceSignals", () => {
  it("omits every field a runtime cannot answer rather than inventing a default", () => {
    expect(readStudioWorkspaceDeviceSignals()).toEqual({});
  });

  it("keeps an unanswerable media query out of the signals instead of reporting a fine pointer", () => {
    const signals = readStudioWorkspaceDeviceSignals({
      matchMedia: () => {
        throw new SyntaxError("unsupported media feature");
      },
      maxTouchPoints: 5,
    });
    expect(signals).not.toHaveProperty("coarsePointer");
    expect(signals.maxTouchPoints).toBe(5);
  });

  it("passes an unrecognised pointer type through as unknown, not as a mouse", () => {
    const signals = readStudioWorkspaceDeviceSignals({ lastPointerType: "eraser" });
    expect(signals.pointerType).toBe("unknown");
    expect(resolveStudioWorkspaceDeviceKind(signals)).toBeNull();
  });

  it("reports no pointer type before the first press", () => {
    expect(readStudioWorkspaceDeviceSignals({ lastPointerType: null })).toEqual({});
  });

  it("drops non-finite viewport widths so a NaN never reads as a narrow screen", () => {
    const signals = readStudioWorkspaceDeviceSignals({ innerWidth: Number.NaN });
    expect(signals).not.toHaveProperty("viewportWidth");
    expect(resolveStudioWorkspaceDeviceKind(signals)).toBeNull();
  });

  it("only carries keyboardDriven when the session really is keyboard driven", () => {
    expect(readStudioWorkspaceDeviceSignals({ keyboardDriven: false })).toEqual({});
    expect(readStudioWorkspaceDeviceSignals({ keyboardDriven: true }).keyboardDriven).toBe(true);
  });
});

describe("device classification from collected signals", () => {
  it("classifies a wide pen surface as a pen display and a narrow one as mobile", () => {
    const penDisplay = readStudioWorkspaceDeviceSignals({
      lastPointerType: "pen",
      innerWidth: 1_920,
      matchMedia: matchMediaReturning(false),
    });
    const penTablet = readStudioWorkspaceDeviceSignals({
      lastPointerType: "pen",
      innerWidth: 820,
      matchMedia: matchMediaReturning(true),
    });
    expect(resolveStudioWorkspaceDeviceKind(penDisplay)).toBe("pen-display");
    expect(resolveStudioWorkspaceDeviceKind(penTablet)).toBe("mobile");
  });

  it("classifies a wide touch screen as touch rather than mobile", () => {
    const signals = readStudioWorkspaceDeviceSignals({
      lastPointerType: "touch",
      innerWidth: 1_440,
      maxTouchPoints: 10,
      matchMedia: matchMediaReturning(true),
    });
    expect(resolveStudioWorkspaceDeviceKind(signals)).toBe("touch");
  });

  it("classifies an ordinary laptop as mouse", () => {
    const signals = readStudioWorkspaceDeviceSignals({
      lastPointerType: "mouse",
      innerWidth: 1_512,
      maxTouchPoints: 0,
      matchMedia: matchMediaReturning(false),
    });
    expect(resolveStudioWorkspaceDeviceKind(signals)).toBe("mouse");
  });
});
