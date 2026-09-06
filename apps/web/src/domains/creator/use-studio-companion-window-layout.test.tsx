/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureStudioCompanionWindowLayout,
  clearStudioCompanionWindowLayout,
  loadStudioCompanionWindowLayout,
  saveStudioCompanionWindowLayout,
  studioCompanionWindowLayoutStorageKey,
  type StudioCompanionWindowLayoutSurface,
} from "./studio-companion-window-layout";
import {
  createStudioCompanionWindowPreferenceSnapshot,
  createStudioCompanionWindowPreferencesRuntime,
  type CreateStudioCompanionWindowPreferencesRuntimeOptions,
  type StudioCompanionWindowPreferencesRepository,
} from "./studio-companion-window-preferences-sqlite";
import {
  STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS,
  STUDIO_COMPANION_WINDOW_LAYOUT_RESIZE_DEBOUNCE_MS,
  studioCompanionWindowLayoutRememberStorageKey,
  useStudioCompanionWindowLayout,
  type UseStudioCompanionWindowLayoutInput,
  type UseStudioCompanionWindowLayoutResult,
} from "./use-studio-companion-window-layout";

const NOW = 2_000_000_000_000;

const primaryScreen = {
  availLeft: 0,
  availTop: 24,
  availWidth: 1_920,
  availHeight: 1_056,
  devicePixelRatio: 1,
  isPrimary: true,
  isInternal: true,
};

const externalScreen = {
  availLeft: -1_600,
  availTop: -96,
  availWidth: 1_600,
  availHeight: 900,
  devicePixelRatio: 1,
  isPrimary: false,
  isInternal: false,
};

class FakePermissionStatus extends EventTarget {
  constructor(public state: PermissionState) {
    super();
  }

  change(state: PermissionState): void {
    this.state = state;
    this.dispatchEvent(new Event("change"));
  }
}

class FakeScreenDetails extends EventTarget {
  constructor(
    public screens: unknown[],
    public currentScreen: unknown
  ) {
    super();
  }

  changeScreens(screens: unknown[], currentScreen: unknown): void {
    this.screens = screens;
    this.currentScreen = currentScreen;
    this.dispatchEvent(new Event("screenschange"));
  }
}

type MutableWindowMetrics = {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
};

type BrowserFixture = {
  details: FakeScreenDetails;
  getScreenDetails: ReturnType<typeof vi.fn>;
  metrics: MutableWindowMetrics;
  moveTo: ReturnType<typeof vi.fn>;
  permission: FakePermissionStatus;
  queryPermission: ReturnType<typeof vi.fn>;
  resizeTo: ReturnType<typeof vi.fn>;
};

const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [owner, key] of [
  [window, "getScreenDetails"],
  [window, "localStorage"],
  [window, "moveTo"],
  [window, "outerHeight"],
  [window, "outerWidth"],
  [window, "resizeTo"],
  [window, "screenX"],
  [window, "screenY"],
  [navigator, "permissions"],
  [document, "visibilityState"],
] as const) {
  originalDescriptors.set(`${owner === window ? "window" : owner === navigator ? "navigator" : "document"}.${key}`,
    Object.getOwnPropertyDescriptor(owner, key));
}

let visibilityState: DocumentVisibilityState;
let latestResultReader: (() => UseStudioCompanionWindowLayoutResult) | null;
let preferenceMutationSequence = 0;

function testPreferencesRepository(): StudioCompanionWindowPreferencesRepository {
  return {
    authority: "sqlite-opfs",
    async load(surface) {
      const storage = window.localStorage;
      const rememberKey = studioCompanionWindowLayoutRememberStorageKey(surface);
      const rawRemember = storage.getItem(rememberKey);
      let rememberEnabled: boolean | null = null;
      if (rawRemember === "1" || rawRemember === "0") {
        rememberEnabled = rawRemember === "1";
      } else if (rawRemember !== null) {
        storage.removeItem(rememberKey);
        rememberEnabled = false;
      }
      const loaded = loadStudioCompanionWindowLayout(storage, surface, { now: NOW });
      if (loaded.status === "session-only" && loaded.failure === "invalid-payload") {
        clearStudioCompanionWindowLayout(storage, surface);
      }
      const loadedLayout = loaded.status === "persisted" ? loaded.layout : null;
      if (rememberEnabled === null && loadedLayout === null) return null;
      preferenceMutationSequence += 1;
      return createStudioCompanionWindowPreferenceSnapshot({
        surface,
        revision: 1,
        writerInstanceId: "test-layout-writer-0001",
        mutationId: `test-layout-load-${String(preferenceMutationSequence).padStart(4, "0")}`,
        rememberEnabled: rememberEnabled ?? true,
        layout: loadedLayout,
      });
    },
    async save(snapshot) {
      const storage = window.localStorage;
      const rememberKey = studioCompanionWindowLayoutRememberStorageKey(snapshot.surface);
      const currentRemember = storage.getItem(rememberKey);
      const nextRemember = snapshot.rememberEnabled ? "1" : "0";
      if (!snapshot.rememberEnabled || currentRemember !== null) {
        if (currentRemember !== nextRemember) storage.setItem(rememberKey, nextRemember);
      }
      const result = snapshot.layout
        ? saveStudioCompanionWindowLayout(storage, snapshot.surface, snapshot.layout, {
          now: snapshot.layout.savedAt,
        })
        : clearStudioCompanionWindowLayout(storage, snapshot.surface);
      if (result.status === "session-only") throw new Error(result.failure);
      return { accepted: true, snapshot };
    },
    async flush() {
      await Promise.resolve();
    },
  };
}

function testPreferencesRuntimeFactory(
  options: CreateStudioCompanionWindowPreferencesRuntimeOptions,
) {
  return createStudioCompanionWindowPreferencesRuntime({
    ...options,
    writerInstanceId: "test-layout-runtime-0001",
    createMutationId: () => {
      preferenceMutationSequence += 1;
      return `test-layout-mutation-${String(preferenceMutationSequence).padStart(4, "0")}`;
    },
    repositoryFactory: async () => testPreferencesRepository(),
    channelFactory: () => null,
  });
}

function restoreProperty(owner: object, namespace: string, key: string): void {
  const descriptor = originalDescriptors.get(`${namespace}.${key}`);
  if (descriptor) Object.defineProperty(owner, key, descriptor);
  else Reflect.deleteProperty(owner, key);
}

function installBrowserFixture(
  permissionState: PermissionState = "granted",
  initialMetrics: MutableWindowMetrics = {
    screenX: 120,
    screenY: 80,
    outerWidth: 520,
    outerHeight: 780,
  },
  screens: unknown[] = [primaryScreen, externalScreen],
  currentScreen: unknown = primaryScreen
): BrowserFixture {
  const metrics = { ...initialMetrics };
  const permission = new FakePermissionStatus(permissionState);
  const details = new FakeScreenDetails(screens, currentScreen);
  const queryPermission = vi.fn(async () => permission);
  const getScreenDetails = vi.fn(async () => details);
  const moveTo = vi.fn((left: number, top: number) => {
    metrics.screenX = left;
    metrics.screenY = top;
  });
  const resizeTo = vi.fn((width: number, height: number) => {
    metrics.outerWidth = width;
    metrics.outerHeight = height;
  });

  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: queryPermission },
  });
  Object.defineProperty(window, "getScreenDetails", {
    configurable: true,
    value: getScreenDetails,
  });
  Object.defineProperty(window, "moveTo", { configurable: true, value: moveTo });
  Object.defineProperty(window, "resizeTo", { configurable: true, value: resizeTo });
  for (const key of ["screenX", "screenY", "outerWidth", "outerHeight"] as const) {
    Object.defineProperty(window, key, {
      configurable: true,
      get: () => metrics[key],
    });
  }
  return { details, getScreenDetails, metrics, moveTo, permission, queryPermission, resizeTo };
}

function setVisibility(next: DocumentVisibilityState): void {
  visibilityState = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderLayoutHook(
  props: UseStudioCompanionWindowLayoutInput,
  defaultRememberEnabled = true
) {
  const hook = renderHook(
    (input: UseStudioCompanionWindowLayoutInput) => useStudioCompanionWindowLayout({
      ...input,
      initialRememberEnabled: input.initialRememberEnabled ?? defaultRememberEnabled,
      preferencesRuntimeFactory: input.preferencesRuntimeFactory ?? testPreferencesRuntimeFactory,
    }),
    { initialProps: props }
  );
  latestResultReader = () => hook.result.current;
  return hook;
}

function result(): UseStudioCompanionWindowLayoutResult {
  if (!latestResultReader) throw new Error("hook result is unavailable");
  return latestResultReader();
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function persistedLayout(
  surface: StudioCompanionWindowLayoutSurface = "navigator"
) {
  const layout = captureStudioCompanionWindowLayout({
    surface,
    now: NOW,
    screens: [primaryScreen, externalScreen],
    currentScreen: externalScreen,
    windowMetrics: {
      screenX: -1_480,
      screenY: -56,
      outerWidth: surface === "navigator" ? 390 : 520,
      outerHeight: surface === "workspace" ? 820 : 860,
    },
  });
  if (!layout) throw new Error("layout fixture capture failed");
  return layout;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  visibilityState = "visible";
  latestResultReader = null;
  preferenceMutationSequence = 0;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreProperty(window, "window", "getScreenDetails");
  restoreProperty(window, "window", "localStorage");
  restoreProperty(window, "window", "moveTo");
  restoreProperty(window, "window", "outerHeight");
  restoreProperty(window, "window", "outerWidth");
  restoreProperty(window, "window", "resizeTo");
  restoreProperty(window, "window", "screenX");
  restoreProperty(window, "window", "screenY");
  restoreProperty(navigator, "navigator", "permissions");
  restoreProperty(document, "document", "visibilityState");
});

describe("useStudioCompanionWindowLayout", () => {
  it("defaults a brand-new role to remember-off until the user opts in", async () => {
    const browser = installBrowserFixture("granted");
    const layoutKey = studioCompanionWindowLayoutStorageKey("workspace");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");

    renderLayoutHook(
      { surface: "workspace", enabled: true, interactionReady: true },
      false
    );
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 2);

    expect(result()).toMatchObject({
      status: "ready",
      hasSaved: false,
      rememberEnabled: false,
      sessionOnly: false,
    });
    expect(browser.queryPermission).not.toHaveBeenCalled();
    expect(browser.getScreenDetails).not.toHaveBeenCalled();
    expect(storageWrite.mock.calls.filter(([key]) => key === layoutKey)).toHaveLength(0);
  });

  it("fails a present invalid remember preference closed and removes it safely", async () => {
    const rememberKey = studioCompanionWindowLayoutRememberStorageKey("workspace");
    window.localStorage.setItem(rememberKey, "invalid-opt-in");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    const browser = installBrowserFixture("granted");

    renderLayoutHook({
      surface: "workspace",
      enabled: true,
      interactionReady: true,
      initialRememberEnabled: true,
    });
    await flushEffects();

    expect(result()).toMatchObject({
      status: "ready",
      hasSaved: false,
      rememberEnabled: false,
      sessionOnly: false,
    });
    expect(storageRemove).toHaveBeenCalledWith(rememberKey);
    expect(window.localStorage.getItem(rememberKey)).toBeNull();
    expect(browser.queryPermission).not.toHaveBeenCalled();
    expect(browser.getScreenDetails).not.toHaveBeenCalled();
  });

  it("does not touch storage or window-management before primary binding and never prompts automatically", async () => {
    const browser = installBrowserFixture("prompt");
    const storageRead = vi.spyOn(Storage.prototype, "getItem");
    const view = renderLayoutHook({
      surface: "navigator",
      enabled: true,
      interactionReady: false,
    });
    await flushEffects();

    expect(result().status).toBe("waiting-for-binding");
    expect(storageRead).not.toHaveBeenCalled();
    expect(browser.queryPermission).not.toHaveBeenCalled();
    expect(browser.getScreenDetails).not.toHaveBeenCalled();

    view.rerender({ surface: "navigator", enabled: true, interactionReady: true });
    await flushEffects();

    expect(storageRead).toHaveBeenCalledWith(studioCompanionWindowLayoutStorageKey("navigator"));
    expect(browser.queryPermission).toHaveBeenCalledWith({ name: "window-management" });
    expect(browser.getScreenDetails).not.toHaveBeenCalled();
    expect(browser.moveTo).not.toHaveBeenCalled();
    expect(result().status).toBe("permission-required");
  });

  it("restores one uniquely matched layout once and persists only after two stable samples", async () => {
    const layout = persistedLayout();
    expect(saveStudioCompanionWindowLayout(window.localStorage, "navigator", layout, { now: NOW }).status)
      .toBe("persisted");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const onRestored = vi.fn();
    const onSaved = vi.fn();
    const browser = installBrowserFixture("granted");

    renderLayoutHook({
      surface: "navigator",
      enabled: true,
      interactionReady: true,
      onRestored,
      onSaved,
    });
    await flushEffects();

    expect(browser.moveTo).toHaveBeenCalledTimes(1);
    expect(browser.moveTo).toHaveBeenCalledWith(-1_480, -56);
    expect(browser.resizeTo).toHaveBeenCalledWith(390, 860);
    expect(result().status).toBe("settling");
    expect(storageWrite).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new Event("blur")));
    expect(storageWrite).not.toHaveBeenCalled();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS - 1);
    expect(onSaved).not.toHaveBeenCalled();
    await advance(1);

    expect(storageWrite).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(result()).toMatchObject({ status: "restored", hasSaved: true, sessionOnly: false });

    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 3);
    expect(browser.moveTo).toHaveBeenCalledTimes(1);
    expect(browser.resizeTo).toHaveBeenCalledTimes(1);
    expect(storageWrite).toHaveBeenCalledTimes(1);
  });

  it("issues one restore under React StrictMode effect replay", async () => {
    const layout = persistedLayout("navigator");
    expect(saveStudioCompanionWindowLayout(window.localStorage, "navigator", layout, { now: NOW }).status)
      .toBe("persisted");
    const browser = installBrowserFixture("granted");
    const hook = renderHook(
      (input: UseStudioCompanionWindowLayoutInput) => useStudioCompanionWindowLayout(input),
      {
        initialProps: {
          surface: "navigator",
          enabled: true,
          interactionReady: true,
          initialRememberEnabled: true,
          preferencesRuntimeFactory: testPreferencesRuntimeFactory,
        },
        wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
      }
    );
    latestResultReader = () => hook.result.current;

    await flushEffects();

    expect(browser.moveTo).toHaveBeenCalledTimes(1);
    expect(browser.resizeTo).toHaveBeenCalledTimes(1);
    expect(result().status).toBe("settling");
  });

  it("does not replay an automatic restore after a transient binding reconnect", async () => {
    const layout = persistedLayout("navigator");
    expect(saveStudioCompanionWindowLayout(window.localStorage, "navigator", layout, { now: NOW }).status)
      .toBe("persisted");
    const browser = installBrowserFixture("granted");
    const view = renderLayoutHook({
      surface: "navigator",
      enabled: true,
      interactionReady: true,
    });
    await flushEffects();

    expect(browser.moveTo).toHaveBeenCalledTimes(1);
    expect(browser.resizeTo).toHaveBeenCalledTimes(1);

    view.rerender({ surface: "navigator", enabled: true, interactionReady: false });
    await flushEffects();
    Object.assign(browser.metrics, {
      screenX: 240,
      screenY: 160,
      outerWidth: 640,
      outerHeight: 720,
    });
    view.rerender({ surface: "navigator", enabled: true, interactionReady: true });
    await flushEffects();

    expect(result().status).toBe("ready");
    expect(browser.moveTo).toHaveBeenCalledTimes(1);
    expect(browser.resizeTo).toHaveBeenCalledTimes(1);
    expect(browser.metrics).toMatchObject({
      screenX: 240,
      screenY: 160,
      outerWidth: 640,
      outerHeight: 720,
    });
  });

  it("keeps restore lifetime independent per companion surface", async () => {
    for (const surface of ["navigator", "review", "reference"] as const) {
      const layout = persistedLayout(surface);
      expect(saveStudioCompanionWindowLayout(window.localStorage, surface, layout, { now: NOW }).status)
        .toBe("persisted");
    }
    const browser = installBrowserFixture("granted");
    const view = renderLayoutHook({
      surface: "navigator",
      enabled: true,
      interactionReady: true,
    });
    await flushEffects();
    expect(browser.moveTo).toHaveBeenCalledTimes(1);
    expect(browser.resizeTo).toHaveBeenCalledTimes(1);

    view.rerender({ surface: "review", enabled: true, interactionReady: true });
    await flushEffects();
    expect(browser.moveTo).toHaveBeenCalledTimes(2);
    expect(browser.resizeTo).toHaveBeenCalledTimes(2);

    view.rerender({ surface: "reference", enabled: true, interactionReady: true });
    await flushEffects();
    expect(browser.moveTo).toHaveBeenCalledTimes(3);
    expect(browser.resizeTo).toHaveBeenCalledTimes(3);

    view.rerender({ surface: "navigator", enabled: true, interactionReady: true });
    await flushEffects();
    expect(browser.moveTo).toHaveBeenCalledTimes(3);
    expect(browser.resizeTo).toHaveBeenCalledTimes(3);
  });

  it("debounces resize by 250ms and polls geometry only while visible", async () => {
    const browser = installBrowserFixture("granted", {
      screenX: 120,
      screenY: 80,
      outerWidth: 520,
      outerHeight: 780,
    });
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    renderLayoutHook({ surface: "workspace", enabled: true, interactionReady: true });
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);
    expect(storageWrite).toHaveBeenCalledTimes(1);

    browser.metrics.outerWidth = 700;
    act(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    });
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_RESIZE_DEBOUNCE_MS - 1);
    expect(storageWrite).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(storageWrite).toHaveBeenCalledTimes(1);
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS - STUDIO_COMPANION_WINDOW_LAYOUT_RESIZE_DEBOUNCE_MS);
    expect(storageWrite).toHaveBeenCalledTimes(2);
    storageWrite.mockClear();

    act(() => setVisibility("hidden"));
    browser.metrics.outerWidth = 760;
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 3);
    expect(storageWrite).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);
    expect(storageWrite).toHaveBeenCalledTimes(1);
  });

  it("marks a topology change stale and waits for explicit placement before learning it", async () => {
    const onTopologyStale = vi.fn();
    const browser = installBrowserFixture("granted", {
      screenX: 120,
      screenY: 80,
      outerWidth: 520,
      outerHeight: 780,
    });
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    renderLayoutHook({
      surface: "workspace",
      enabled: true,
      interactionReady: true,
      onTopologyStale,
    });
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);
    storageWrite.mockClear();

    const rightExternal = {
      ...externalScreen,
      availLeft: 1_920,
      availTop: 120,
    };
    act(() => browser.details.changeScreens([primaryScreen, rightExternal], rightExternal));
    expect(result().status).toBe("stale-topology");
    expect(onTopologyStale).toHaveBeenCalledTimes(1);
    expect(browser.moveTo).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();

    browser.metrics.screenX = 2_040;
    browser.metrics.screenY = 180;
    act(() => result().notifyManualPlacement());
    await flushEffects();
    expect(browser.getScreenDetails).toHaveBeenCalledTimes(2);
    expect(result().status).toBe("settling");
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);

    expect(storageWrite).toHaveBeenCalledTimes(1);
    expect(result().status).toBe("saved");
    expect(browser.moveTo).not.toHaveBeenCalled();
  });

  it("keeps a stale-topology guard across a transient binding reconnect", async () => {
    const onTopologyStale = vi.fn();
    const browser = installBrowserFixture("granted");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const layoutKey = studioCompanionWindowLayoutStorageKey("workspace");
    const view = renderLayoutHook({
      surface: "workspace",
      enabled: true,
      interactionReady: true,
      onTopologyStale,
    });
    await flushEffects();

    const rightExternal = {
      ...externalScreen,
      availLeft: 1_920,
      availTop: 120,
    };
    act(() => browser.details.changeScreens([primaryScreen, rightExternal], rightExternal));
    expect(result().status).toBe("stale-topology");
    expect(onTopologyStale).toHaveBeenCalledTimes(1);

    view.rerender({ surface: "workspace", enabled: true, interactionReady: false });
    await flushEffects();
    view.rerender({ surface: "workspace", enabled: true, interactionReady: true });
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 2);

    expect(result().status).toBe("stale-topology");
    expect(onTopologyStale).toHaveBeenCalledTimes(1);
    expect(browser.moveTo).not.toHaveBeenCalled();
    expect(browser.resizeTo).not.toHaveBeenCalled();
    expect(storageWrite.mock.calls.filter(([key]) => key === layoutKey)).toHaveLength(0);
  });

  it("falls back to session-only memory when storage access throws", async () => {
    const blockedStorage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
      removeItem: vi.fn(() => { throw new Error("blocked"); }),
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: blockedStorage,
    });
    installBrowserFixture("granted");
    const onSaved = vi.fn();
    renderLayoutHook({
      surface: "review",
      enabled: true,
      interactionReady: true,
      onSaved,
    });
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);

    expect(result()).toMatchObject({
      status: "session-only",
      hasSaved: true,
      rememberEnabled: true,
      sessionOnly: true,
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ surface: "review" }), true);
    expect(blockedStorage.setItem).not.toHaveBeenCalled();
  });

  it("keeps role-specific opt-out while blocked storage falls back to session memory", async () => {
    const blockedStorage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
      removeItem: vi.fn(() => { throw new Error("blocked"); }),
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: blockedStorage,
    });
    installBrowserFixture("granted");
    const view = renderLayoutHook({ surface: "review", enabled: true, interactionReady: true });
    await flushEffects();

    act(() => result().setRememberEnabled(false));
    expect(result()).toMatchObject({ rememberEnabled: false, sessionOnly: true });

    view.rerender({ surface: "navigator", enabled: true, interactionReady: true });
    await flushEffects();
    expect(result()).toMatchObject({ rememberEnabled: true, sessionOnly: true });

    view.rerender({ surface: "review", enabled: true, interactionReady: true });
    await flushEffects();
    expect(result()).toMatchObject({ rememberEnabled: false, sessionOnly: true });
  });

  it("does not persist maximized geometry and resumes after the window returns to a normal size", async () => {
    const browser = installBrowserFixture("granted", {
      screenX: primaryScreen.availLeft,
      screenY: primaryScreen.availTop,
      outerWidth: primaryScreen.availWidth,
      outerHeight: primaryScreen.availHeight,
    });
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const layoutKey = studioCompanionWindowLayoutStorageKey("workspace");
    const layoutWriteCount = () => storageWrite.mock.calls.filter(([key]) => key === layoutKey).length;
    renderLayoutHook({ surface: "workspace", enabled: true, interactionReady: true });
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);

    expect(layoutWriteCount()).toBe(0);
    expect(result()).toMatchObject({ status: "ready", hasSaved: false });

    Object.assign(browser.metrics, {
      screenX: 120,
      screenY: 80,
      outerWidth: 520,
      outerHeight: 780,
    });
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 2);

    expect(layoutWriteCount()).toBe(1);
    expect(result()).toMatchObject({ status: "saved", hasSaved: true });
  });

  it("keeps the previous layout when the browser ignores a programmatic restore", async () => {
    const layout = persistedLayout("navigator");
    expect(saveStudioCompanionWindowLayout(window.localStorage, "navigator", layout, { now: NOW }).status)
      .toBe("persisted");
    const layoutKey = studioCompanionWindowLayoutStorageKey("navigator");
    const previousRawLayout = window.localStorage.getItem(layoutKey);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const onRestored = vi.fn();
    const onSaved = vi.fn();
    const browser = installBrowserFixture("granted");
    browser.moveTo.mockImplementation(() => undefined);
    browser.resizeTo.mockImplementation(() => undefined);

    renderLayoutHook({
      surface: "navigator",
      enabled: true,
      interactionReady: true,
      onRestored,
      onSaved,
    });
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);

    expect(browser.moveTo).toHaveBeenCalledTimes(1);
    expect(browser.resizeTo).toHaveBeenCalledTimes(1);
    expect(result().status).toBe("restore-failed");
    expect(onRestored).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(storageWrite.mock.calls.filter(([key]) => key === layoutKey)).toHaveLength(0);
    expect(window.localStorage.getItem(layoutKey)).toBe(previousRawLayout);

    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 3);
    expect(storageWrite.mock.calls.filter(([key]) => key === layoutKey)).toHaveLength(0);
    expect(window.localStorage.getItem(layoutKey)).toBe(previousRawLayout);
  });

  it("remembers opt-out per role and does not inherit it when the surface changes", async () => {
    const browser = installBrowserFixture("granted");
    const first = renderLayoutHook({ surface: "review", enabled: true, interactionReady: true });
    await flushEffects();

    act(() => result().setRememberEnabled(false));
    expect(result().rememberEnabled).toBe(false);
    expect(window.localStorage.getItem(studioCompanionWindowLayoutRememberStorageKey("review")))
      .toBe("0");
    first.unmount();
    browser.queryPermission.mockClear();
    browser.getScreenDetails.mockClear();

    const second = renderLayoutHook({ surface: "review", enabled: true, interactionReady: true });
    await flushEffects();

    expect(result()).toMatchObject({ rememberEnabled: false, status: "ready" });
    expect(browser.queryPermission).not.toHaveBeenCalled();
    expect(browser.getScreenDetails).not.toHaveBeenCalled();

    second.rerender({ surface: "navigator", enabled: true, interactionReady: true });
    await flushEffects();

    expect(result()).toMatchObject({ rememberEnabled: true, sessionOnly: false });
    expect(window.localStorage.getItem(studioCompanionWindowLayoutRememberStorageKey("navigator")))
      .toBeNull();
    expect(browser.queryPermission).toHaveBeenCalledTimes(1);
  });

  it("does not leak session-only state across surface transitions", async () => {
    const blockedStorage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
      removeItem: vi.fn(() => { throw new Error("blocked"); }),
    };
    const healthyRecords = new Map<string, string>();
    const healthyStorage = {
      getItem: vi.fn((key: string) => healthyRecords.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { healthyRecords.set(key, value); }),
      removeItem: vi.fn((key: string) => { healthyRecords.delete(key); }),
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: blockedStorage,
    });
    installBrowserFixture("granted");
    const view = renderLayoutHook({ surface: "review", enabled: true, interactionReady: true });
    await flushEffects();
    expect(result().sessionOnly).toBe(true);

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: healthyStorage,
    });
    view.rerender({ surface: "navigator", enabled: true, interactionReady: true });
    await flushEffects();

    expect(result().sessionOnly).toBe(false);
    expect(healthyStorage.getItem).toHaveBeenCalledWith(
      studioCompanionWindowLayoutRememberStorageKey("navigator")
    );
  });

  it("clears a corrupt role payload and continues with persistent storage", async () => {
    installBrowserFixture("granted");
    const layoutKey = studioCompanionWindowLayoutStorageKey("workspace");
    window.localStorage.setItem(layoutKey, "{not-json");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    renderLayoutHook({ surface: "workspace", enabled: true, interactionReady: true });
    await flushEffects();

    expect(storageRemove).toHaveBeenCalledWith(layoutKey);
    expect(result()).toMatchObject({ hasSaved: false, sessionOnly: false });
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);

    const roleWrites = storageWrite.mock.calls.filter(([key]) => key === layoutKey);
    expect(roleWrites).toHaveLength(1);
    expect(() => JSON.parse(window.localStorage.getItem(layoutKey) ?? "")).not.toThrow();
    expect(result()).toMatchObject({ hasSaved: true, sessionOnly: false, status: "saved" });
  });

  it("tears down geometry polling when screen details become unusable", async () => {
    const browser = installBrowserFixture("granted");
    const layoutKey = studioCompanionWindowLayoutStorageKey("workspace");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    renderLayoutHook({ surface: "workspace", enabled: true, interactionReady: true });
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);
    expect(storageWrite.mock.calls.filter(([key]) => key === layoutKey)).toHaveLength(1);
    storageWrite.mockClear();

    browser.details.screens = [];
    act(() => browser.permission.change("granted"));
    await flushEffects();
    expect(result().status).toBe("unsupported");

    browser.metrics.screenX += 80;
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 3);
    expect(storageWrite.mock.calls.filter(([key]) => key === layoutKey)).toHaveLength(0);
  });

  it("flushes a stable candidate on lifecycle events and exposes reset/toggle actions", async () => {
    const browser = installBrowserFixture("granted");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    const layoutKey = studioCompanionWindowLayoutStorageKey("review");
    const layoutWriteCount = () => storageWrite.mock.calls.filter(([key]) => key === layoutKey).length;
    renderLayoutHook({ surface: "review", enabled: true, interactionReady: true });
    await flushEffects();

    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(layoutWriteCount()).toBe(1);
    expect(result().hasSaved).toBe(true);

    act(() => result().resetSavedLayout());
    expect(storageRemove).toHaveBeenCalledWith(studioCompanionWindowLayoutStorageKey("review"));
    expect(result().hasSaved).toBe(false);
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 2);
    expect(layoutWriteCount()).toBe(1);

    browser.metrics.screenX += 40;
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 2);
    expect(layoutWriteCount()).toBe(2);
    expect(result().hasSaved).toBe(true);

    act(() => result().toggleRememberEnabled());
    expect(result().rememberEnabled).toBe(false);
    expect(result().hasSaved).toBe(false);
    expect(window.localStorage.getItem(studioCompanionWindowLayoutRememberStorageKey("review")))
      .toBe("0");
    browser.metrics.screenX += 40;
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS * 3);
    expect(layoutWriteCount()).toBe(2);

    act(() => result().setRememberEnabled(true));
    expect(result().rememberEnabled).toBe(true);
    expect(window.localStorage.getItem(studioCompanionWindowLayoutRememberStorageKey("review")))
      .toBe("1");
    await flushEffects();
    await advance(STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS);
    expect(layoutWriteCount()).toBe(3);
  });
});
