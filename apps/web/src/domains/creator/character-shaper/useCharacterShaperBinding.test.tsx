// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAvatarForgeState } from "../vrm/studio-vrm-avatar-forge";

import { findCharacterSlotEntry, listCharacterSlotEntries } from "./character-shaper-catalog";
import { applyCharacterIrisTint } from "./character-shaper-iris-tint";
import { useCharacterShaperBinding } from "./useCharacterShaperBinding";

import type { CharacterCapabilityProfile, CharacterSlotEntry } from "./character-shaper-contract";
import type { AvatarForgeState } from "../vrm/studio-vrm-avatar-forge";
import type { PropInstance } from "../vrm/studio-vrm-props";
import type { WardrobeSlot, WardrobeState } from "../vrm/studio-vrm-wardrobe";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

const FULL_PROFILE: CharacterCapabilityProfile = {
  status: "ready",
  modelId: "sample",
  modelName: "샘플 캐릭터",
  humanoid: true,
  semanticMorphs: {
    eyeSize: { kind: "shape-key" },
    eyeSpacing: { kind: "shape-key" },
    eyeTilt: { kind: "shape-key" },
    irisSize: { kind: "shape-key" },
    noseHeight: { kind: "shape-key" },
    noseWidth: { kind: "shape-key" },
    mouthWidth: { kind: "shape-key" },
    lipFullness: { kind: "shape-key" },
    earSize: { kind: "shape-key" },
  } as unknown as CharacterCapabilityProfile["semanticMorphs"],
  expressions: ["happy", "angry", "sad", "aa", "ou", "blink"],
  costumeSlots: ["tops", "bottoms", "shoes"],
  wardrobeMetricsReady: true,
  propsReady: true,
  irisTintable: true,
  originalHairMeshCount: 2,
  surfacePaintReady: true,
};

vi.mock("./character-shaper-capability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./character-shaper-capability")>();
  return { ...actual, createCharacterCapabilityProfile: () => FULL_PROFILE };
});

vi.mock("./character-shaper-iris-tint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./character-shaper-iris-tint")>();
  return { ...actual, applyCharacterIrisTint: vi.fn(() => 1) };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

interface FakeHostState {
  status: string;
  avatarForgeState: AvatarForgeState;
  wardrobeState: WardrobeState;
  vrmPropItems: PropInstance[];
  costumeState: { hidden: string[]; recolor: Record<string, string> };
  customColors: Record<string, string>;
  activePoseId: string;
  fingerEdits: Record<string, unknown>;
  activeExpressionId: string;
  expressionWeights: Record<string, number>;
  isCapturing: boolean;
  wardrobeInteractionLocked: boolean;
}

interface FakeHost {
  readonly host: StudioVrmPoserHost;
  readonly state: FakeHostState;
  readonly calls: {
    forge: AvatarForgeState[];
    pose: string[];
    hands: { side: string; poseType: string }[];
    expressionPresets: string[];
  };
}

function createFakeHost(overrides: Partial<FakeHostState> = {}): FakeHost {
  const state: FakeHostState = {
    status: "ready",
    avatarForgeState: createAvatarForgeState(),
    wardrobeState: {},
    vrmPropItems: [],
    costumeState: { hidden: [], recolor: {} },
    customColors: {},
    activePoseId: "ni_weight_left",
    fingerEdits: {},
    activeExpressionId: "preset:xf_joy",
    expressionWeights: { happy: 1 },
    isCapturing: false,
    wardrobeInteractionLocked: false,
    ...overrides,
  };
  const calls: FakeHost["calls"] = { forge: [], pose: [], hands: [], expressionPresets: [] };

  const host = {
    get status() { return state.status; },
    vrm: { scene: { traverse: () => undefined } },
    activeModelId: "sample",
    displayModelName: "샘플 캐릭터",
    wardrobeMetrics: { ready: true },
    detectedOriginalHairCount: 2,
    texturePaintDisabledReason: "",
    get isCapturing() { return state.isCapturing; },
    get wardrobeInteractionLocked() { return state.wardrobeInteractionLocked; },
    isSharingPose: false,
    isThumbnailCapturing: false,
    broadcastPreviewActive: false,
    proportionRigStatus: "idle",
    proportionRigMessage: "",
    get avatarForgeState() { return state.avatarForgeState; },
    get wardrobeState() { return state.wardrobeState; },
    get vrmPropItems() { return state.vrmPropItems; },
    get costumeState() { return state.costumeState; },
    costumeMeshes: [{ key: "Tops", slot: "tops" }],
    get customColors() { return state.customColors; },
    get activePoseId() { return state.activePoseId; },
    customBones: {},
    customYOffset: 0,
    poseTranslations: {},
    get fingerEdits() { return state.fingerEdits; },
    get activeExpressionId() { return state.activeExpressionId; },
    get expressionWeights() { return state.expressionWeights; },
    bodyRotation: 0,

    handleAvatarForgeChange: (next: AvatarForgeState) => {
      calls.forge.push(next);
      state.avatarForgeState = next;
    },
    equipWardrobeItem: (slot: WardrobeSlot, itemId: string | null) => {
      const next: WardrobeState = { ...state.wardrobeState };
      if (itemId === null) delete next[slot];
      else next[slot] = { itemId, color: "#ffffff", fit: 1, fitMode: "auto", fabricId: "cotton" };
      state.wardrobeState = next;
    },
    updateWardrobeEquip: (slot: WardrobeSlot, patch: Record<string, unknown>) => {
      const current = state.wardrobeState[slot];
      if (!current) return;
      state.wardrobeState = { ...state.wardrobeState, [slot]: { ...current, ...patch } };
    },
    setWardrobeState: (next: WardrobeState) => { state.wardrobeState = next; },
    updateCostume: (next: { hidden: string[]; recolor: Record<string, string> }) => { state.costumeState = next; },
    addVrmProp: (propId: string) => {
      state.vrmPropItems = [...state.vrmPropItems, { uid: `${propId}#${state.vrmPropItems.length}`, propId } as PropInstance];
    },
    removeVrmProp: (uid: string) => {
      state.vrmPropItems = state.vrmPropItems.filter((item) => item.uid !== uid);
    },
    setVrmPropItems: (next: PropInstance[]) => { state.vrmPropItems = next; },
    setSelectedVrmPropUid: () => undefined,
    setCustomColors: (next: Record<string, string>) => { state.customColors = next; },
    setExpressionWeights: (next: Record<string, number>) => { state.expressionWeights = next; },
    setActiveExpressionId: (next: string) => { state.activeExpressionId = next; },
    handleExpressionPresetSelect: (preset: { id: string; weights: Record<string, number> }) => {
      calls.expressionPresets.push(preset.id);
      state.activeExpressionId = `preset:${preset.id}`;
      state.expressionWeights = { ...preset.weights };
    },
    handlePoseSelect: (presetId: string) => {
      calls.pose.push(presetId);
      state.activePoseId = presetId;
    },
    applyHandPosePreset: (side: string, poseType: string) => {
      calls.hands.push({ side, poseType });
      state.fingerEdits = { ...state.fingerEdits, [`${side}:${poseType}`]: true };
    },
    setActivePoseId: (next: string) => { state.activePoseId = next; },
    setCustomBones: () => undefined,
    setCustomYOffset: () => undefined,
    setPoseTranslations: () => undefined,
    setFingerEdits: (next: Record<string, unknown>) => { state.fingerEdits = next; },
    setBodyRotation: () => undefined,
  } as unknown as StudioVrmPoserHost;

  return { host, state, calls };
}

function entryOf(id: string): CharacterSlotEntry {
  const found = findCharacterSlotEntry(id);
  if (!found) throw new Error(`missing catalog entry: ${id}`);
  return found;
}

function firstWardrobeEntry(): CharacterSlotEntry {
  const found = listCharacterSlotEntries("top").find((item) => item.apply.kind === "wardrobe" && item.apply.itemId);
  if (!found) throw new Error("no wardrobe top entry in the catalog");
  return found;
}

function firstAccessoryEntry(): CharacterSlotEntry {
  const found = listCharacterSlotEntries("accessory").find((item) => item.apply.kind === "prop");
  if (!found) throw new Error("no accessory entry in the catalog");
  return found;
}

function renderBinding(fake: FakeHost) {
  return renderHook(() => useCharacterShaperBinding(fake.host));
}

describe("useCharacterShaperBinding", () => {
  it("derives the recipe from host state and re-derives after a commit", () => {
    const fake = createFakeHost();
    const { result } = renderBinding(fake);
    expect(result.current.recipe.slots.eyes).toBe("eyes:original");

    act(() => {
      result.current.commit(entryOf("eyes:romance-sparkle"));
    });

    expect(result.current.recipe.slots.eyes).toBe("eyes:romance-sparkle");
    expect(result.current.history.recentLabels[0]).toBe("눈: 순정 반짝");
  });

  it("merges every Avatar Forge write of one commit into a single handleAvatarForgeChange", () => {
    const fake = createFakeHost();
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(entryOf("eyes:romance-sparkle"));
    });

    // Three semantic morphs + one state write, but only one host call.
    expect(fake.calls.forge).toHaveLength(1);
    const morphs = fake.calls.forge[0]?.semanticFaceMorphs ?? {};
    expect(Object.keys(morphs).sort()).toEqual(["eyeSize", "eyeSpacing", "eyeTilt"]);
  });

  it("applies the mouth expression floor without resetting the active expression id", () => {
    const fake = createFakeHost({ activeExpressionId: "preset:xf_joy", expressionWeights: { happy: 0.05 } });
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(entryOf("mouth:natural-smile"));
    });

    expect(fake.state.expressionWeights.happy).toBeCloseTo(0.2, 5);
    expect(fake.state.activeExpressionId).toBe("preset:xf_joy");
  });

  it("keeps a stronger expression weight instead of lowering it to the floor", () => {
    const fake = createFakeHost({ expressionWeights: { happy: 0.8 } });
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(entryOf("mouth:natural-smile"));
    });

    expect(fake.state.expressionWeights.happy).toBeCloseTo(0.8, 5);
  });

  it("refuses every mutation while the host is capturing and says why", () => {
    const fake = createFakeHost({ isCapturing: true });
    const { result } = renderBinding(fake);

    expect(result.current.busyReason).toBe("캡처가 끝난 뒤에 다시 적용할 수 있습니다.");
    let outcome: { ok: boolean; reason: string | null } | null = null;
    act(() => {
      outcome = result.current.commit(entryOf("eyes:romance-sparkle"));
    });
    expect(outcome).toMatchObject({ ok: false, reason: "캡처가 끝난 뒤에 다시 적용할 수 있습니다." });
    expect(fake.calls.forge).toHaveLength(0);
    expect(result.current.history.canUndo).toBe(false);
  });

  it("refuses a mutation whenever the host itself reports the wardrobe locked", () => {
    // 잠금 사유가 캡처·방송 미리보기가 아닌 다른 이유일 때에도 셰이퍼는 멈춰야 한다.
    const fake = createFakeHost({ wardrobeInteractionLocked: true });
    const { result } = renderBinding(fake);

    expect(result.current.busyReason).toBe("지금은 옷을 바꿀 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
    let outcome: { ok: boolean; reason: string | null } | null = null;
    act(() => {
      outcome = result.current.commit(entryOf("eyes:romance-sparkle"));
    });
    expect(outcome).toMatchObject({ ok: false });
    expect(fake.calls.forge).toHaveLength(0);
  });

  it("undo restores the raw host state of every authority the step touched, and redo re-applies it", () => {
    const fake = createFakeHost();
    const wardrobeEntry = firstWardrobeEntry();
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(wardrobeEntry);
    });
    const equipped = { ...fake.state.wardrobeState };
    expect(Object.keys(equipped).length).toBeGreaterThan(0);

    act(() => {
      result.current.undo();
    });
    expect(fake.state.wardrobeState).toEqual({});
    expect(result.current.history.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(fake.state.wardrobeState).toEqual(equipped);
  });

  it("tints the iris on commit and restores the previous tint on undo", () => {
    const fake = createFakeHost();
    const tint = vi.mocked(applyCharacterIrisTint);
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(entryOf("irises:amber"));
    });
    expect(result.current.snapshot.irisColor).toBe("#b8742a");
    expect(tint.mock.calls.some(([, color]) => color === "#b8742a")).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.snapshot.irisColor).toBeNull();
  });

  it("toggles a multi slot: committing an equipped accessory takes it off", () => {
    const fake = createFakeHost();
    const accessory = firstAccessoryEntry();
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(accessory);
    });
    expect(fake.state.vrmPropItems).toHaveLength(1);

    act(() => {
      result.current.commit(accessory);
    });
    expect(fake.state.vrmPropItems).toHaveLength(0);
  });

  it("applies a hand pose to the chosen side only and remembers it for the recipe", () => {
    const fake = createFakeHost();
    const { result } = renderBinding(fake);

    act(() => {
      result.current.setHandSide("left");
    });
    act(() => {
      result.current.commit(entryOf("hand-pose:fist"));
    });

    expect(fake.calls.hands).toEqual([{ side: "left", poseType: "fist" }]);
    expect(result.current.recipe.slots["hand-pose"]).toBe("hand-pose:fist");
    expect(result.current.handSide).toBe("left");
  });

  it("hold-to-compare swaps to the session baseline and back without recording history", () => {
    const fake = createFakeHost();
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(entryOf("eyes:romance-sparkle"));
    });
    const steps = result.current.history.length;
    const changed = fake.state.avatarForgeState;

    act(() => {
      result.current.setCompareActive(true);
    });
    expect(result.current.compareActive).toBe(true);
    expect(fake.state.avatarForgeState.semanticFaceMorphs ?? {}).toEqual({});

    act(() => {
      result.current.setCompareActive(false);
    });
    expect(result.current.compareActive).toBe(false);
    expect(fake.state.avatarForgeState).toEqual(changed);
    expect(result.current.history.length).toBe(steps);
  });

  it("resetToBaseline is itself one undoable step", () => {
    const fake = createFakeHost();
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commit(entryOf("eyes:romance-sparkle"));
    });
    act(() => {
      result.current.resetToBaseline();
    });

    expect(fake.state.avatarForgeState.semanticFaceMorphs ?? {}).toEqual({});
    expect(result.current.history.recentLabels[0]).toBe("처음 상태로 되돌리기");

    act(() => {
      result.current.undo();
    });
    expect(Object.keys(fake.state.avatarForgeState.semanticFaceMorphs ?? {})).toContain("eyeSize");
  });

  it("commitColor writes the iris colour as one labelled step", () => {
    const fake = createFakeHost();
    const { result } = renderBinding(fake);

    act(() => {
      result.current.commitColor("iris", "#3B6FB6");
    });

    expect(result.current.snapshot.irisColor).toBe("#3b6fb6");
    expect(result.current.history.recentLabels[0]).toBe("색: 눈동자");
  });

  it("reports no capability profile and a load hint before a model is ready", () => {
    const fake = createFakeHost({ status: "empty" });
    const { result } = renderBinding(fake);

    expect(result.current.busyReason).toBe("VRM 캐릭터를 먼저 불러오세요.");
    expect(result.current.profile.status).toBe("empty");
    expect(result.current.recipe.slots.eyes).toBeNull();
  });
});
