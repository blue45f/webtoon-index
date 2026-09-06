import { describe, expect, it } from "vitest";

import {
  mergeStudioWorkspaceStates,
  reconcileStudioWorkspacePendingSync,
} from "./studio-workspace-three-way-merge";
import {
  DEFAULT_STUDIO_WORKSPACE_STATE,
  normalizeStudioWorkspaceState,
  renameStudioWorkspace,
  resizeStudioDrawingPalettes,
  studioWorkspaceOwnerScope,
  studioWorkspaceStorageKey,
  updateStudioWorkspaceLiveLayout,
  type StudioCustomWorkspace,
  type StudioWorkspaceState,
  type StudioWorkspaceStorage,
} from "./studio-workspaces";

function withCustomWorkspaces(
  state: StudioWorkspaceState,
  workspaces: readonly StudioCustomWorkspace[],
): StudioWorkspaceState {
  return normalizeStudioWorkspaceState({
    ...state,
    activeWorkspaceId: "storyboard",
    customWorkspaces: workspaces,
  });
}

function customWorkspace(
  id: string,
  name: string,
  state: StudioWorkspaceState = DEFAULT_STUDIO_WORKSPACE_STATE,
): StudioCustomWorkspace {
  return {
    id,
    name,
    layout: state.liveLayout,
  };
}

function memoryStorage(
  initial: Readonly<Record<string, string>> = {},
): StudioWorkspaceStorage & {
  readonly values: Map<string, string>;
  readonly writes: string[];
} {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
  };
}

describe("mergeStudioWorkspaceStates", () => {
  it("combines a local palette resize with an external workspace rename", () => {
    const workspace = customWorkspace("custom-one", "Original");
    const base = withCustomWorkspaces(DEFAULT_STUDIO_WORKSPACE_STATE, [workspace]);
    const local = updateStudioWorkspaceLiveLayout(base, {
      ...base.liveLayout,
      drawingPalettes: resizeStudioDrawingPalettes(
        base.liveLayout.drawingPalettes,
        "sub-tools",
        47,
      ),
    });
    const external = renameStudioWorkspace(base, workspace.id, "Renamed");

    const result = mergeStudioWorkspaceStates(base, local, external);

    expect(result.state.liveLayout.drawingPalettes.sizes).toEqual({
      "sub-tools": 47,
      "tool-properties": 53,
    });
    expect(result.state.customWorkspaces[0]?.name).toBe("Renamed");
    expect(result.conflictPaths).toEqual([]);
  });

  it("keeps disjoint catalog additions from both branches", () => {
    const base = DEFAULT_STUDIO_WORKSPACE_STATE;
    const local = withCustomWorkspaces(base, [
      customWorkspace("local-workspace", "Local"),
    ]);
    const external = withCustomWorkspaces(base, [
      customWorkspace("external-workspace", "External"),
    ]);

    const result = mergeStudioWorkspaceStates(base, local, external);

    expect(result.state.customWorkspaces.map(({ id }) => id)).toEqual([
      "local-workspace",
      "external-workspace",
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  it("honors a local deletion when the external entry is unchanged", () => {
    const workspace = customWorkspace("delete-me", "Delete me");
    const base = withCustomWorkspaces(DEFAULT_STUDIO_WORKSPACE_STATE, [workspace]);
    const local = withCustomWorkspaces(base, []);

    const result = mergeStudioWorkspaceStates(base, local, base);

    expect(result.state.customWorkspaces).toEqual([]);
    expect(result.conflictPaths).toEqual([]);
  });

  it("uses local values and reports both canonical paths for a same-palette conflict", () => {
    const base = DEFAULT_STUDIO_WORKSPACE_STATE;
    const local = updateStudioWorkspaceLiveLayout(base, {
      ...base.liveLayout,
      drawingPalettes: resizeStudioDrawingPalettes(
        base.liveLayout.drawingPalettes,
        "sub-tools",
        48,
      ),
    });
    const external = updateStudioWorkspaceLiveLayout(base, {
      ...base.liveLayout,
      drawingPalettes: resizeStudioDrawingPalettes(
        base.liveLayout.drawingPalettes,
        "sub-tools",
        61,
      ),
    });

    const result = mergeStudioWorkspaceStates(base, local, external);

    expect(result.state.liveLayout.drawingPalettes.sizes).toEqual({
      "sub-tools": 48,
      "tool-properties": 52,
    });
    expect(result.conflictPaths).toEqual([
      "liveLayout.drawingPalettes.sizes.sub-tools",
      "liveLayout.drawingPalettes.sizes.tool-properties",
    ]);
  });

  it("accepts external-only device preferences", () => {
    const base = DEFAULT_STUDIO_WORKSPACE_STATE;
    const external = normalizeStudioWorkspaceState({
      ...base,
      mobileControlSide: "left",
      applyQuickActionsOnSwitch: false,
    });

    const result = mergeStudioWorkspaceStates(base, base, external);

    expect(result.state.mobileControlSide).toBe("left");
    expect(result.state.applyQuickActionsOnSwitch).toBe(false);
    expect(result.conflictPaths).toEqual([]);
  });

  it("keeps the local catalog order and reports an incompatible two-branch reorder", () => {
    const first = customWorkspace("first", "First");
    const second = customWorkspace("second", "Second");
    const third = customWorkspace("third", "Third");
    const base = withCustomWorkspaces(DEFAULT_STUDIO_WORKSPACE_STATE, [
      first,
      second,
      third,
    ]);
    const local = withCustomWorkspaces(base, [second, first, third]);
    const external = withCustomWorkspaces(base, [first, third, second]);

    const result = mergeStudioWorkspaceStates(base, local, external);

    expect(result.state.customWorkspaces.map(({ id }) => id)).toEqual([
      "second",
      "first",
      "third",
    ]);
    expect(result.conflictPaths).toEqual(["customWorkspaces.order"]);
  });
});

describe("reconcileStudioWorkspacePendingSync", () => {
  it("returns the latest raw token without writing when the expected envelope is stale", () => {
    const userId = "artist@example.com";
    const storageKey = studioWorkspaceStorageKey(userId);
    const storage = memoryStorage({ [storageKey]: "latest-envelope" });

    const result = reconcileStudioWorkspacePendingSync({
      storage,
      storageKey,
      expectedRaw: "stale-envelope",
      userId,
      ownerScope: studioWorkspaceOwnerScope(userId),
      base: DEFAULT_STUDIO_WORKSPACE_STATE,
      local: DEFAULT_STUDIO_WORKSPACE_STATE,
      external: DEFAULT_STUDIO_WORKSPACE_STATE,
    });

    expect(result).toEqual({
      kind: "retry-latest-raw",
      latestRaw: "latest-envelope",
    });
    expect(storage.writes).toEqual([]);
  });

  it("merges and verifies the write when the raw token still matches", () => {
    const userId = "artist@example.com";
    const storageKey = studioWorkspaceStorageKey(userId);
    const expectedRaw = "external-envelope";
    const storage = memoryStorage({ [storageKey]: expectedRaw });
    const local = updateStudioWorkspaceLiveLayout(
      DEFAULT_STUDIO_WORKSPACE_STATE,
      {
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        drawingPalettes: resizeStudioDrawingPalettes(
          DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.drawingPalettes,
          "sub-tools",
          49,
        ),
      },
    );
    const external = normalizeStudioWorkspaceState({
      ...DEFAULT_STUDIO_WORKSPACE_STATE,
      liveLayout: {
        ...DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout,
        drawingPalettes: resizeStudioDrawingPalettes(
          DEFAULT_STUDIO_WORKSPACE_STATE.liveLayout.drawingPalettes,
          "sub-tools",
          62,
        ),
      },
      mobileControlSide: "left",
    });

    const result = reconcileStudioWorkspacePendingSync({
      storage,
      storageKey,
      expectedRaw,
      userId,
      ownerScope: studioWorkspaceOwnerScope(userId),
      base: DEFAULT_STUDIO_WORKSPACE_STATE,
      local,
      external,
    });

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("Expected an applied merge.");
    expect(result.result.status).toBe("persisted");
    expect(result.result.failure).toBeNull();
    expect(result.result.state.liveLayout.drawingPalettes.sizes["sub-tools"]).toBe(49);
    expect(result.result.state.mobileControlSide).toBe("left");
    expect(result.conflictPaths).toEqual([
      "liveLayout.drawingPalettes.sizes.sub-tools",
      "liveLayout.drawingPalettes.sizes.tool-properties",
    ]);
    expect(storage.writes).toEqual([storageKey]);
    expect(storage.values.get(storageKey)).not.toBe(expectedRaw);
  });

  it("lets storage read exceptions reach the Page failure boundary", () => {
    const userId = "artist@example.com";
    const storageKey = studioWorkspaceStorageKey(userId);
    const storage: StudioWorkspaceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("must not write");
      },
    };

    expect(() =>
      reconcileStudioWorkspacePendingSync({
        storage,
        storageKey,
        expectedRaw: "external-envelope",
        userId,
        ownerScope: studioWorkspaceOwnerScope(userId),
        base: DEFAULT_STUDIO_WORKSPACE_STATE,
        local: DEFAULT_STUDIO_WORKSPACE_STATE,
        external: DEFAULT_STUDIO_WORKSPACE_STATE,
      }),
    ).toThrow("blocked");
  });
});
