// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createStudioCatalogPreferencesRepository, normalizeStudioCatalogPreferences, type StudioCatalogPreferences } from "./studio-catalog-preferences";
import { useStudioCatalogPreferences } from "./use-studio-catalog-preferences";

afterEach(cleanup);
describe("catalog hydration and retry", () => {
  it("does not overwrite a favorite chosen before slow hydration completes", async () => {
    let resolve!: (value: StudioCatalogPreferences) => void;
    const hydration = new Promise<StudioCatalogPreferences>((r) => { resolve = r; });
    const values = new Map<string, string>();
    const real = createStudioCatalogPreferencesRepository({ get: async (k) => values.get(k) ?? null, set: async (k, v) => { values.set(k, v); }, delete: async (k) => { values.delete(k); } });
    const repository = { ...real, load: () => hydration };
    const acquire = async () => repository;
    const { result } = renderHook(() => useStudioCatalogPreferences("scenes", acquire));
    act(() => result.current.dispatch({ kind: "favorite", id: "chosen", value: true }));
    await waitFor(() => expect(result.current.authority).toBe("sqlite-opfs"));
    await act(async () => { resolve(normalizeStudioCatalogPreferences({ version: 1, favoriteIds: ["stale"] })); await hydration; });
    expect(result.current.state.favoriteIds).toEqual(["chosen"]);
  });
  it("retries pending intent and merges existing durable favorites instead of overwriting them", async () => {
    let failing = true;
    const values = new Map([["elements", JSON.stringify({ version: 1, favoriteIds: ["existing"], recentIds: [], view: "comfortable" })]]);
    const repository = createStudioCatalogPreferencesRepository({ get: async (k) => values.get(k) ?? null, set: async (k, v) => { if (failing) throw new Error("offline"); values.set(k, v); }, delete: async (k) => { values.delete(k); } });
    const acquire = async () => repository;
    const { result } = renderHook(() => useStudioCatalogPreferences("elements", acquire));
    await waitFor(() => expect(result.current.state.favoriteIds).toEqual(["existing"]));
    act(() => result.current.dispatch({ kind: "favorite", id: "new", value: true }));
    await waitFor(() => expect(result.current.authority).toBe("memory-only"));
    expect(result.current.state.favoriteIds).toEqual(["new", "existing"]);
    failing = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.authority).toBe("sqlite-opfs"));
    expect((await repository.load("elements")).favoriteIds).toEqual(["new", "existing"]);
  });
  it("rehydrates stored preferences when a failed initial read is retried without edits", async () => {
    let offline = true;
    const values = new Map([["scenes", JSON.stringify({ version: 1, favoriteIds: ["restored"], recentIds: [], view: "compact" })]]);
    const repository = createStudioCatalogPreferencesRepository({ get: async (key) => { if (offline) throw new Error("unavailable"); return values.get(key) ?? null; }, set: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } });
    const acquire = async () => repository;
    const { result } = renderHook(() => useStudioCatalogPreferences("scenes", acquire));
    await waitFor(() => expect(result.current.authority).toBe("memory-only"));
    offline = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.authority).toBe("sqlite-opfs"));
    expect(result.current.state).toMatchObject({ favoriteIds: ["restored"], view: "compact" });
  });

});
