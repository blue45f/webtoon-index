import { describe, expect, it } from "vitest";

import {
  EMPTY_STUDIO_LAYER_SOLO_STATE,
  clearStudioLayerSolo,
  planStudioLayerSoloLocalHidden,
  toggleStudioLayerSolo,
} from "./studio-layer-solo";

describe("planStudioLayerSoloLocalHidden", () => {
  it("hides every layer except the solo target", () => {
    const hidden = planStudioLayerSoloLocalHidden(["a", "b", "c"], "b");
    expect([...hidden].sort()).toEqual(["a", "c"]);
  });

  it("fails closed when the solo target is unknown", () => {
    expect(planStudioLayerSoloLocalHidden(["a", "b"], "z").size).toBe(0);
  });
});

describe("toggleStudioLayerSolo", () => {
  const all = ["ink", "tone", "bg"] as const;

  it("enters solo and snapshots the current local-hidden set", () => {
    const current = new Set(["bg"]);
    const result = toggleStudioLayerSolo({
      state: EMPTY_STUDIO_LAYER_SOLO_STATE,
      targetId: "ink",
      allItemIds: all,
      currentLocalHidden: current,
    });
    expect(result.state.soloId).toBe("ink");
    expect([...result.state.snapshotLocalHidden!]).toEqual(["bg"]);
    expect([...result.localHiddenIds].sort()).toEqual(["bg", "tone"]);
  });

  it("exits solo on the same target and restores the snapshot", () => {
    const entered = toggleStudioLayerSolo({
      state: EMPTY_STUDIO_LAYER_SOLO_STATE,
      targetId: "ink",
      allItemIds: all,
      currentLocalHidden: new Set(["bg"]),
    });
    const exited = toggleStudioLayerSolo({
      state: entered.state,
      targetId: "ink",
      allItemIds: all,
      currentLocalHidden: entered.localHiddenIds,
    });
    expect(exited.state).toEqual(EMPTY_STUDIO_LAYER_SOLO_STATE);
    expect([...exited.localHiddenIds]).toEqual(["bg"]);
  });

  it("switches solo target without replacing the original snapshot", () => {
    const entered = toggleStudioLayerSolo({
      state: EMPTY_STUDIO_LAYER_SOLO_STATE,
      targetId: "ink",
      allItemIds: all,
      currentLocalHidden: new Set(["bg"]),
    });
    const switched = toggleStudioLayerSolo({
      state: entered.state,
      targetId: "tone",
      allItemIds: all,
      currentLocalHidden: entered.localHiddenIds,
    });
    expect(switched.state.soloId).toBe("tone");
    expect([...switched.state.snapshotLocalHidden!]).toEqual(["bg"]);
    expect([...switched.localHiddenIds].sort()).toEqual(["bg", "ink"]);
  });
});

describe("clearStudioLayerSolo", () => {
  it("restores the snapshot when solo is active", () => {
    const cleared = clearStudioLayerSolo({
      soloId: "ink",
      snapshotLocalHidden: new Set(["x"]),
    });
    expect(cleared.state.soloId).toBeNull();
    expect([...cleared.localHiddenIds]).toEqual(["x"]);
  });
});
