import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_COMPANION_WINDOW_LAYOUT_FUTURE_TOLERANCE_MS,
  STUDIO_COMPANION_WINDOW_LAYOUT_KIND,
  STUDIO_COMPANION_WINDOW_LAYOUT_MAX_AGE_MS,
  STUDIO_COMPANION_WINDOW_LAYOUT_MAX_RAW_BYTES,
  STUDIO_COMPANION_WINDOW_LAYOUT_SURFACES,
  captureStudioCompanionWindowLayout,
  clearStudioCompanionWindowLayout,
  loadStudioCompanionWindowLayout,
  matchStudioCompanionWindowLayoutScreen,
  parseStudioCompanionWindowLayout,
  resolveStudioCompanionWindowPlacement,
  saveStudioCompanionWindowLayout,
  studioCompanionWindowLayoutStorageKey,
  type StudioCompanionWindowLayoutStorage,
} from "./studio-companion-window-layout";

const NOW = 2_000_000_000_000;

const primary = {
  availLeft: 0,
  availTop: 24,
  availWidth: 1_920,
  availHeight: 1_056,
  devicePixelRatio: 1,
  isPrimary: true,
  isInternal: true,
  label: "Never persist this built-in display label",
};

const leftExternal = {
  availLeft: -1_600,
  availTop: -96,
  availWidth: 1_600,
  availHeight: 900,
  devicePixelRatio: 1,
  isPrimary: false,
  isInternal: false,
  label: "Private monitor product name",
};

function memoryStorage(): StudioCompanionWindowLayoutStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function captured(
  surface: "workspace" | "navigator" | "review" | "reference" = "navigator",
  screens: readonly unknown[] = [primary, leftExternal],
  currentScreen: unknown = leftExternal
) {
  const layout = captureStudioCompanionWindowLayout({
    surface,
    now: NOW,
    screens,
    currentScreen,
    windowMetrics: {
      screenX: -1_480,
      screenY: 10,
      outerWidth: surface === "navigator" ? 390 : 520,
      outerHeight: surface === "workspace" ? 820 : 860,
    },
  });
  if (!layout) throw new Error("fixture capture failed");
  return layout;
}

describe("studio companion window layout persistence", () => {
  it("uses independent stable keys for every currently supported role", () => {
    expect(STUDIO_COMPANION_WINDOW_LAYOUT_SURFACES).toEqual([
      "workspace",
      "navigator",
      "review",
      "reference",
    ]);
    const keys = STUDIO_COMPANION_WINDOW_LAYOUT_SURFACES.map(
      studioCompanionWindowLayoutStorageKey
    );
    expect(new Set(keys).size).toBe(4);
    expect(keys).toEqual([
      "toonspectrum.studio.companion-window-layout.v1.workspace",
      "toonspectrum.studio.companion-window-layout.v1.navigator",
      "toonspectrum.studio.companion-window-layout.v1.review",
      "toonspectrum.studio.companion-window-layout.v1.reference",
    ]);
    expect(() => studioCompanionWindowLayoutStorageKey("future" as "workspace"))
      .toThrow(TypeError);
  });

  it("round-trips an allowlisted record without labels, sessions, projects, or unknown fields", () => {
    const storage = memoryStorage();
    const layout = captured();
    const hostile = {
      ...layout,
      label: "Secret monitor",
      sessionId: "private-session",
      projectId: "private-project",
      documentTitle: "Unreleased episode",
      outerSize: { ...layout.outerSize, title: "not allowed" },
      screenHint: { ...layout.screenHint, label: "Product name" },
    };

    const saved = saveStudioCompanionWindowLayout(storage, "navigator", hostile, { now: NOW });
    expect(saved.status).toBe("persisted");
    const raw = storage.values.get(studioCompanionWindowLayoutStorageKey("navigator"))!;
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(
      STUDIO_COMPANION_WINDOW_LAYOUT_MAX_RAW_BYTES
    );
    for (const secret of [
      "Secret monitor",
      "private-session",
      "private-project",
      "Unreleased episode",
      "Product name",
      "not allowed",
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(loadStudioCompanionWindowLayout(storage, "navigator", { now: NOW })).toEqual({
      status: "persisted",
      layout: saved.layout,
      failure: null,
    });
    expect(loadStudioCompanionWindowLayout(storage, "review", { now: NOW }).status)
      .toBe("missing");
    expect(saved.layout?.displayTopology).toHaveLength(2);
    expect(saved.layout?.displayTopology.every((screen) => !Object.hasOwn(screen, "label")))
      .toBe(true);
  });

  it("fails closed for malformed, legacy, oversized, cross-role, expired, and future payloads", () => {
    const layout = captured();
    const raw = JSON.stringify(layout);
    const { displayTopology: _legacyMissingTopology, ...legacyLayout } = layout;
    expect(parseStudioCompanionWindowLayout("{", "navigator", { now: NOW })).toBeNull();
    expect(parseStudioCompanionWindowLayout(
      JSON.stringify(legacyLayout),
      "navigator",
      { now: NOW }
    )).toBeNull();
    expect(parseStudioCompanionWindowLayout(
      JSON.stringify({ ...layout, unknown: true }),
      "navigator",
      { now: NOW }
    )).toBeNull();
    expect(parseStudioCompanionWindowLayout(
      `${raw}${" ".repeat(STUDIO_COMPANION_WINDOW_LAYOUT_MAX_RAW_BYTES)}`,
      "navigator",
      { now: NOW }
    )).toBeNull();
    expect(parseStudioCompanionWindowLayout(raw, "review", { now: NOW })).toBeNull();
    expect(parseStudioCompanionWindowLayout(JSON.stringify({ ...layout, version: 2 }), "navigator", {
      now: NOW,
    })).toBeNull();
    expect(parseStudioCompanionWindowLayout(JSON.stringify({ ...layout, kind: "other" }), "navigator", {
      now: NOW,
    })).toBeNull();
    expect(parseStudioCompanionWindowLayout(JSON.stringify({
      ...layout,
      savedAt: NOW - STUDIO_COMPANION_WINDOW_LAYOUT_MAX_AGE_MS - 1,
    }), "navigator", { now: NOW })).toBeNull();
    expect(parseStudioCompanionWindowLayout(JSON.stringify({
      ...layout,
      savedAt: NOW + STUDIO_COMPANION_WINDOW_LAYOUT_FUTURE_TOLERANCE_MS + 1,
    }), "navigator", { now: NOW })).toBeNull();

    for (const invalid of [
      { ...layout, outerSize: { width: 0, height: 860 } },
      { ...layout, outerSize: { width: Number.POSITIVE_INFINITY, height: 860 } },
      { ...layout, localAnchor: { xRatio: -0.1, yRatio: 0.5 } },
      { ...layout, localAnchor: { xRatio: 0.5, yRatio: 1.1 } },
      { ...layout, screenHint: { ...layout.screenHint, availWidth: 0 } },
      { ...layout, screenHint: { ...layout.screenHint, relativeCenterX: 65 } },
      {
        ...layout,
        screenHint: {
          ...layout.screenHint,
          horizontalSlot: null,
          relativeCenterX: null,
        },
      },
      { ...layout, displayTopology: [] },
      {
        ...layout,
        displayTopology: [layout.displayTopology[0], layout.displayTopology[0]],
      },
      {
        ...layout,
        displayTopology: layout.displayTopology.map((screen) => ({
          ...screen,
          isPrimary: true,
        })),
      },
    ]) {
      expect(saveStudioCompanionWindowLayout(memoryStorage(), "navigator", invalid, { now: NOW }))
        .toMatchObject({ status: "session-only", layout: null, failure: "invalid-payload" });
    }

    expect(parseStudioCompanionWindowLayout(JSON.stringify({
      ...layout,
      displayTopology: [...layout.displayTopology].reverse(),
    }), "navigator", { now: NOW })).toBeNull();
    expect(parseStudioCompanionWindowLayout(JSON.stringify({
      ...layout,
      displayTopology: layout.displayTopology.map((screen, index) => (
        index === 0 ? { ...screen, label: "must not be accepted" } : screen
      )),
    }), "navigator", { now: NOW })).toBeNull();
    expect(parseStudioCompanionWindowLayout(JSON.stringify({
      ...layout,
      displayTopology: Array.from({ length: 17 }, (_, index) => ({
        ...layout.displayTopology[0],
        relativeLeft: index * 100,
      })),
    }), "navigator", { now: NOW })).toBeNull();
  });

  it("reports storage read, write, and readback failures without throwing", () => {
    const layout = captured();
    expect(loadStudioCompanionWindowLayout(null, "navigator", { now: NOW }))
      .toMatchObject({ status: "session-only", failure: "storage-unavailable" });
    expect(loadStudioCompanionWindowLayout({ getItem: () => { throw new Error("blocked"); } }, "navigator", {
      now: NOW,
    })).toMatchObject({ status: "session-only", failure: "read-failed" });
    expect(saveStudioCompanionWindowLayout(null, "navigator", layout, { now: NOW }))
      .toMatchObject({ status: "session-only", failure: "storage-unavailable", layout });

    const writeThrows = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error("quota"); }),
    };
    expect(saveStudioCompanionWindowLayout(writeThrows, "navigator", layout, { now: NOW }))
      .toMatchObject({ status: "session-only", failure: "write-failed" });

    const discardedWrite = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    expect(saveStudioCompanionWindowLayout(discardedWrite, "navigator", layout, { now: NOW }))
      .toMatchObject({ status: "session-only", failure: "verification-failed" });

    const readbackThrows = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(),
    };
    expect(saveStudioCompanionWindowLayout(readbackThrows, "navigator", layout, { now: NOW }))
      .toMatchObject({ status: "session-only", failure: "verification-failed" });
  });

  it("verifies role-local removal and reports missing or hostile storage", () => {
    const storage = memoryStorage();
    const navigatorKey = studioCompanionWindowLayoutStorageKey("navigator");
    const reviewKey = studioCompanionWindowLayoutStorageKey("review");
    const referenceKey = studioCompanionWindowLayoutStorageKey("reference");
    storage.values.set(navigatorKey, JSON.stringify(captured("navigator")));
    storage.values.set(reviewKey, JSON.stringify(captured("review")));
    storage.values.set(referenceKey, JSON.stringify(captured("reference")));

    expect(clearStudioCompanionWindowLayout(storage, "navigator"))
      .toEqual({ status: "cleared", failure: null });
    expect(storage.values.has(navigatorKey)).toBe(false);
    expect(storage.values.has(reviewKey)).toBe(true);
    expect(storage.values.has(referenceKey)).toBe(true);
    expect(clearStudioCompanionWindowLayout({
      getItem: () => "still-there",
      setItem: () => undefined,
      removeItem: () => undefined,
    }, "review")).toMatchObject({ status: "session-only", failure: "verification-failed" });
    expect(clearStudioCompanionWindowLayout(null, "review"))
      .toMatchObject({ status: "session-only", failure: "storage-unavailable" });
  });
});

describe("studio companion window layout capture and matching", () => {
  it("captures negative-coordinate screens as a local anchor and restores inside that screen", () => {
    const layout = captured("navigator");
    expect(layout.kind).toBe(STUDIO_COMPANION_WINDOW_LAYOUT_KIND);
    expect(layout.outerSize).toEqual({ width: 390, height: 860 });
    expect(layout.localAnchor.xRatio).toBeGreaterThan(0);
    expect(layout.screenHint).not.toHaveProperty("label");
    expect(layout.screenHint.horizontalSlot).toBe("left");

    const placement = resolveStudioCompanionWindowPlacement({
      layout,
      surface: "navigator",
      screens: [primary, leftExternal],
      now: NOW,
    });
    expect(placement).toMatchObject({
      surface: "navigator",
      left: -1_480,
      top: -56,
      width: 390,
      height: 860,
    });
    expect(placement!.left).toBeGreaterThanOrEqual(leftExternal.availLeft);
    expect(placement!.left + placement!.width)
      .toBeLessThanOrEqual(leftExternal.availLeft + leftExternal.availWidth);
    expect(placement!.top).toBeGreaterThanOrEqual(leftExternal.availTop);
    expect(placement!.top + placement!.height)
      .toBeLessThanOrEqual(leftExternal.availTop + leftExternal.availHeight);
  });

  it("applies the reference window's 320x360 minimum while keeping its layout role-local", () => {
    const layout = captureStudioCompanionWindowLayout({
      surface: "reference",
      now: NOW,
      screens: [primary],
      currentScreen: primary,
      windowMetrics: {
        screenX: 120,
        screenY: 80,
        outerWidth: 100,
        outerHeight: 100,
      },
    });

    expect(layout).toMatchObject({
      surface: "reference",
      outerSize: { width: 320, height: 360 },
    });
    expect(parseStudioCompanionWindowLayout(
      JSON.stringify(layout),
      "review",
      { now: NOW }
    )).toBeNull();
  });

  it("matches a uniquely identifiable screen after screen-array reordering", () => {
    const layout = captured();
    const relabeledLeft = { ...leftExternal, label: "A different non-persisted label" };
    const matched = matchStudioCompanionWindowLayoutScreen(layout, [relabeledLeft, primary]);
    expect(matched).toMatchObject({
      availLeft: -1_600,
      availTop: -96,
      availWidth: 1_600,
      availHeight: 900,
    });
    const placement = resolveStudioCompanionWindowPlacement({
      layout,
      surface: "navigator",
      screens: [relabeledLeft, primary],
      now: NOW,
    });
    expect(placement).not.toBeNull();
    expect(placement!.left).toBeGreaterThanOrEqual(-1_600);
    expect(placement!.left + placement!.width).toBeLessThanOrEqual(0);
  });

  it("requires the complete display topology to match across reloads", () => {
    const layout = captured();
    const third = {
      ...leftExternal,
      availLeft: 1_920,
      availTop: 120,
      label: "Never persisted third display",
    };
    const changedTopologies: readonly (readonly unknown[])[] = [
      [primary],
      [primary, leftExternal, third],
      [primary, { ...leftExternal, availWidth: 1_680 }],
      [primary, { ...leftExternal, devicePixelRatio: 1.25 }],
      [primary, { ...leftExternal, isInternal: true }],
      [
        { ...primary, isPrimary: false },
        { ...leftExternal, isPrimary: true },
      ],
      [primary, { ...leftExternal, availTop: -120 }],
    ];

    for (const screens of changedTopologies) {
      expect(matchStudioCompanionWindowLayoutScreen(layout, screens)).toBeNull();
      expect(resolveStudioCompanionWindowPlacement({
        layout,
        surface: "navigator",
        screens,
        now: NOW,
      })).toBeNull();
    }
  });

  it("accepts WebIDL-like screens whose observable fields live on a prototype", () => {
    const webIdlPrimary = Object.create(primary) as typeof primary;
    const webIdlExternal = Object.create(leftExternal) as typeof leftExternal;
    const layout = captureStudioCompanionWindowLayout({
      surface: "navigator",
      now: NOW,
      screens: [webIdlPrimary, webIdlExternal],
      currentScreen: webIdlExternal,
      windowMetrics: { screenX: -1_500, screenY: -20, outerWidth: 390, outerHeight: 800 },
    });

    expect(layout).not.toBeNull();
    expect(layout!.screenHint).toMatchObject({
      availWidth: 1_600,
      availHeight: 900,
      horizontalSlot: "left",
    });
    expect(layout!.displayTopology).toHaveLength(2);
    expect(JSON.stringify(layout)).not.toContain("Private monitor product name");
  });

  it("does not trust a stale currentScreen over the window's unique screen intersection", () => {
    const layout = captureStudioCompanionWindowLayout({
      surface: "navigator",
      now: NOW,
      screens: [primary, leftExternal],
      currentScreen: primary,
      windowMetrics: {
        screenX: -1_520,
        screenY: -40,
        outerWidth: 390,
        outerHeight: 800,
      },
    });

    expect(layout).not.toBeNull();
    expect(layout!.screenHint).toMatchObject({
      isPrimary: false,
      horizontalSlot: "left",
    });
  });

  it("fails closed when structurally identical screens are ambiguous without a primary anchor", () => {
    const first = {
      availLeft: 0,
      availTop: 0,
      availWidth: 1_280,
      availHeight: 720,
      devicePixelRatio: 1,
      isPrimary: null,
      isInternal: false,
    };
    const second = { ...first, availLeft: 1_280 };
    const layout = captureStudioCompanionWindowLayout({
      surface: "review",
      now: NOW,
      screens: [first, second],
      currentScreen: first,
      windowMetrics: { screenX: 120, screenY: 80, outerWidth: 420, outerHeight: 600 },
    });
    expect(layout).toBeNull();
  });

  it("does not substitute a different screen when the saved target disappears", () => {
    const layout = captured();
    expect(matchStudioCompanionWindowLayoutScreen(layout, [primary])).toBeNull();
    expect(resolveStudioCompanionWindowPlacement({
      layout,
      surface: "navigator",
      screens: [primary],
      now: NOW,
    })).toBeNull();
  });

  it("distinguishes identical right-side monitors through primary-relative topology", () => {
    const upperRight = {
      ...leftExternal,
      availLeft: 1_920,
      availTop: -900,
      label: "same model",
    };
    const lowerRight = {
      ...leftExternal,
      availLeft: 1_920,
      availTop: 180,
      label: "same model",
    };
    const layout = captureStudioCompanionWindowLayout({
      surface: "workspace",
      now: NOW,
      screens: [primary, upperRight, lowerRight],
      currentScreen: lowerRight,
      windowMetrics: { screenX: 2_100, screenY: 200, outerWidth: 520, outerHeight: 700 },
    });
    expect(layout).not.toBeNull();
    const matched = matchStudioCompanionWindowLayoutScreen(layout!, [lowerRight, primary, upperRight]);
    expect(matched).toMatchObject({ availLeft: 1_920, availTop: 180 });
  });

  it("clamps stored size and local anchor to a smaller screen while preserving role minimums when possible", () => {
    const tinyPrimary = {
      availLeft: -320,
      availTop: -40,
      availWidth: 320,
      availHeight: 240,
      devicePixelRatio: 1,
      isPrimary: true,
      isInternal: true,
    };
    const tinyLayout = captureStudioCompanionWindowLayout({
      surface: "workspace",
      now: NOW,
      screens: [tinyPrimary],
      currentScreen: tinyPrimary,
      windowMetrics: { screenX: -320, screenY: -40, outerWidth: 320, outerHeight: 240 },
    });
    if (!tinyLayout) throw new Error("tiny topology capture failed");

    const placement = resolveStudioCompanionWindowPlacement({
      layout: { ...tinyLayout, outerSize: { width: 20_000, height: 20_000 } },
      surface: "workspace",
      screens: [tinyPrimary],
      now: NOW,
    });
    expect(placement).toBeNull();

    const validLarge = {
      ...tinyLayout,
      outerSize: { width: 1_600, height: 1_200 },
      localAnchor: { xRatio: 1, yRatio: 1 },
    };
    expect(resolveStudioCompanionWindowPlacement({
      layout: validLarge,
      surface: "workspace",
      screens: [tinyPrimary],
      now: NOW,
    })).toMatchObject({ left: -320, top: -40, width: 320, height: 240 });
  });

  it("rejects non-finite window metrics, invalid screens, and tied screen intersections", () => {
    expect(captureStudioCompanionWindowLayout({
      surface: "navigator",
      now: NOW,
      screens: [primary],
      currentScreen: primary,
      windowMetrics: { screenX: 0, screenY: 0, outerWidth: Number.NaN, outerHeight: 500 },
    })).toBeNull();
    expect(captureStudioCompanionWindowLayout({
      surface: "navigator",
      now: NOW,
      screens: [{ availLeft: 0, availTop: 0, availWidth: 0, availHeight: 500 }],
      windowMetrics: { screenX: 0, screenY: 0, outerWidth: 300, outerHeight: 500 },
    })).toBeNull();

    const left = { ...primary, availLeft: -500, availWidth: 500, isPrimary: false };
    const right = { ...primary, availLeft: 0, availWidth: 500 };
    expect(captureStudioCompanionWindowLayout({
      surface: "review",
      now: NOW,
      screens: [left, right],
      currentScreen: null,
      windowMetrics: { screenX: -100, screenY: 100, outerWidth: 200, outerHeight: 400 },
    })).toBeNull();
  });
});
