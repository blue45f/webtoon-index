// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS, STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY } from "./studio-hybrid-dcc-viewport-interaction";
import { useStudioHybridDccViewportPreferences } from "./useStudioHybridDccViewportPreferences";

const db = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), acquire: vi.fn(), asAsyncKeyValueStore: vi.fn() }));
vi.mock("../studio-local-database-runtime", () => ({ acquireStudioLocalDatabase: db.acquire }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { resolve, promise };
}

describe("DCC viewport shared SQLite preference authority", () => {
  beforeEach(() => {
    db.get.mockReset().mockResolvedValue(null);
    db.set.mockReset().mockResolvedValue(undefined);
    db.asAsyncKeyValueStore.mockReset().mockReturnValue(db);
    db.acquire.mockReset().mockResolvedValue(db);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("restores the app's preference namespace without writing defaults or touching browser KV", async () => {
    const localRead = vi.spyOn(Storage.prototype, "getItem");
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    db.get.mockResolvedValue(JSON.stringify({ ...STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS, showGrid: false }));
    const { result } = renderHook(useStudioHybridDccViewportPreferences);
    await waitFor(() => expect(result.current.persistenceState).toBe("ready"));
    expect(result.current.preferences.showGrid).toBe(false);
    expect(db.asAsyncKeyValueStore).toHaveBeenCalledWith("studio-ui-preferences-v1");
    expect(db.set).not.toHaveBeenCalled();
    expect(localRead).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
  });

  it("preserves edits made during restoration and restores other stored fields", async () => {
    const read = deferred<string>();
    db.get.mockReturnValue(read.promise);
    const { result } = renderHook(useStudioHybridDccViewportPreferences);
    act(() => result.current.patchPreferences({ showGrid: false }));
    expect(db.set).not.toHaveBeenCalled();
    await act(async () => read.resolve(JSON.stringify({ ...STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS, translationStep: 2 })));
    await waitFor(() => expect(result.current.persistenceState).toBe("ready"));
    expect(result.current.preferences).toMatchObject({ showGrid: false, translationStep: 2 });
    await waitFor(() => expect(db.set).toHaveBeenCalledTimes(1));
    expect(JSON.parse(db.set.mock.calls[0][1])).toMatchObject({ showGrid: false, translationStep: 2 });
  });

  it("serializes complete preference writes so an older gesture cannot win", async () => {
    const write = deferred<void>();
    db.set.mockImplementationOnce(() => write.promise);
    const { result } = renderHook(useStudioHybridDccViewportPreferences);
    await waitFor(() => expect(result.current.persistenceState).toBe("ready"));
    act(() => result.current.patchPreferences({ translationStep: 2 }));
    await waitFor(() => expect(db.set).toHaveBeenCalledTimes(1));
    act(() => result.current.setPreferences((value) => ({ ...value, translationStep: 3 })));
    expect(db.set).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve());
    await waitFor(() => expect(db.set).toHaveBeenCalledTimes(2));
    expect(db.set.mock.calls[1][0]).toBe(STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY);
    expect(JSON.parse(db.set.mock.calls[1][1]).translationStep).toBe(3);
    await waitFor(() => expect(result.current.persistenceState).toBe("ready"));
  });

  it("retains session editing and reports unavailable storage without a fallback write", async () => {
    db.acquire.mockRejectedValue(new Error("OPFS unavailable"));
    const write = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(useStudioHybridDccViewportPreferences);
    await waitFor(() => expect(result.current.persistenceState).toBe("error"));
    act(() => result.current.patchPreferences({ showAxes: false }));
    expect(result.current.preferences.showAxes).toBe(false);
    expect(db.set).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects a failed save as durable and recovers on the next authored edit", async () => {
    db.set.mockRejectedValueOnce(new Error("quota"));
    const { result } = renderHook(useStudioHybridDccViewportPreferences);
    await waitFor(() => expect(result.current.persistenceState).toBe("ready"));
    act(() => result.current.patchPreferences({ showAxes: false }));
    await waitFor(() => expect(result.current.persistenceState).toBe("error"));
    expect(result.current.preferences.showAxes).toBe(false);
    act(() => result.current.patchPreferences({ showGround: false }));
    await waitFor(() => expect(result.current.persistenceState).toBe("ready"));
    expect(JSON.parse(db.set.mock.calls[1][1])).toMatchObject({ showAxes: false, showGround: false });
  });
});
