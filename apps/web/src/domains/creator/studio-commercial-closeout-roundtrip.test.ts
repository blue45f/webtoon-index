/**
 * Round-trip proof for commercial close-out prefs + stacks (acceptance criterion 4).
 */
import { describe, expect, it } from "vitest";

import {
  appendStudioAdjustmentEntry,
  createEmptyStudioAdjustmentStack,
  normalizeStudioAdjustmentStack,
  studioAdjustmentStackEqual,
  studioAdjustmentStackToFilterFields,
} from "./studio-adjustment-stack";
import {
  createStudioEffectId,
  loadStudioEffectFavoriteState,
  normalizeStudioEffectFavoriteState,
  rememberStudioEffectRecent,
  saveStudioEffectFavoriteState,
  toggleStudioEffectFavorite,
} from "./studio-effect-favorites";
import {
  createStudioMacroSession,
  recordStudioMacroCommand,
  startStudioMacroRecording,
  stopStudioMacroRecording,
} from "./studio-macro-recorder";
import { studioMacroSessionToAutoActionSet } from "./studio-macro-to-auto-actions";
import {
  loadStudioUiDensityState,
  normalizeStudioUiDensityState,
  saveStudioUiDensityState,
  studioUiDensityAllows,
} from "./studio-ui-density";

function memoryStorage() {
  const mem = new Map<string, string>();
  return {
    getItem(key: string) {
      return mem.has(key) ? mem.get(key)! : null;
    },
    setItem(key: string, value: string) {
      mem.set(key, value);
    },
  };
}

describe("commercial close-out round-trips", () => {
  it("adjustment stack survives JSON normalize and maps live filter fields", () => {
    let stack = createEmptyStudioAdjustmentStack();
    stack = appendStudioAdjustmentEntry(stack, { engine: "blur", params: { radius: 3 } });
    stack = appendStudioAdjustmentEntry(stack, {
      engine: "brightness-contrast",
      params: { brightness: 0.1, contrast: 5 },
    });
    const reloaded = normalizeStudioAdjustmentStack(JSON.parse(JSON.stringify(stack)));
    expect(studioAdjustmentStackEqual(stack, reloaded)).toBe(true);
    const fields = studioAdjustmentStackToFilterFields(reloaded);
    expect(fields.blur).toBe(3);
    expect(fields.brightness).toBe(0.1);
    expect(fields.contrast).toBe(5);
  });

  it("effect favorites + recent persist via storage helpers", () => {
    const storage = memoryStorage();
    let state = normalizeStudioEffectFavoriteState();
    const lookId = createStudioEffectId("look", "classic-manga");
    state = toggleStudioEffectFavorite(state, lookId);
    state = rememberStudioEffectRecent(state, lookId);
    expect(saveStudioEffectFavoriteState(storage, state)).toBe(true);
    const reloaded = loadStudioEffectFavoriteState(storage);
    expect(reloaded.favorites).toEqual([lookId]);
    expect(reloaded.recent[0]).toBe(lookId);
  });

  it("density prefs persist and gate chrome regions", () => {
    const storage = memoryStorage();
    expect(saveStudioUiDensityState(storage, { mode: "simple" })).toBe(true);
    const loaded = loadStudioUiDensityState(storage);
    expect(normalizeStudioUiDensityState(loaded).mode).toBe("simple");
    expect(studioUiDensityAllows("simple", "toolbar-ai")).toBe(false);
    expect(studioUiDensityAllows("focus", "right-panel")).toBe(false);
    expect(studioUiDensityAllows("full", "toolbar-ai")).toBe(true);
  });

  it("macro session converts to Auto Action set with allowlisted command types", () => {
    let session = createStudioMacroSession("rt-macro");
    session = startStudioMacroRecording(session, 1_700_000_000_000);
    session = recordStudioMacroCommand(session, { type: "set-opacity", opacity: 0.5 });
    session = recordStudioMacroCommand(session, { type: "lettering-font-size", fontSize: 20 });
    session = stopStudioMacroRecording(session);
    expect(session.commands).toHaveLength(2);
    const actionSet = studioMacroSessionToAutoActionSet(session);
    const types = actionSet.commands.map((command) => command.type);
    expect(types).toEqual(["element.set-opacity", "lettering.set-size"]);
    const reloaded = JSON.parse(JSON.stringify(actionSet));
    expect(reloaded.commands.map((command: { type: string }) => command.type)).toEqual(types);
  });
});
