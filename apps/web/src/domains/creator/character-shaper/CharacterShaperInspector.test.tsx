// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import { CharacterShaperInspector } from "./CharacterShaperInspector";

import type {
  CharacterCapabilityProfile,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterSlotAvailability,
  CharacterSlotCatalog,
  CharacterSlotEntry,
  CharacterSlotKind,
} from "./character-shaper-contract";
import type { CharacterShaperBinding } from "./character-shaper-ui-contract";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

vi.mock("./character-shaper-preview", () => ({
  CharacterSlotPreview: ({ title }: { title?: string }) => <svg data-testid="preview" aria-label={title} role="img" />,
}));

afterEach(cleanup);

const ENTRY: CharacterSlotEntry = {
  id: "eyes:romance-sparkle",
  slot: "eyes",
  label: "순정 반짝눈",
  hint: "크고 둥근 순정 만화 눈",
  tags: [],
  keywords: [],
  preview: { kind: "glyph", icon: "Eye", caption: "" },
  apply: { kind: "semantic-morph", morphs: { eyeSize: 0.4 } },
  requires: [],
  exportLayer: "eyes",
  license: "toonstudio-original",
  order: 0,
};

const IRIS_ENTRY: CharacterSlotEntry = {
  ...ENTRY,
  id: "irises:amber",
  slot: "irises",
  label: "앰버",
  hint: "따뜻한 호박색 눈동자",
  apply: { kind: "iris", irisSize: 0, color: "#b45309" },
  exportLayer: "eyes",
};

function makeRecipe(overrides: Partial<CharacterRecipe> = {}): CharacterRecipe {
  const slots = Object.fromEntries(
    CHARACTER_SLOT_KINDS.map((slot) => [slot, slot === "accessory" ? [] : null]),
  ) as unknown as CharacterRecipe["slots"];
  return {
    version: 1,
    slots,
    colors: { skin: null, hairBase: "#1f1a1c", hairTip: "#4a3f47", iris: "#4a3328", top: null, bottom: null, shoes: null },
    handSide: "both",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<CharacterCapabilityProfile> = {}): CharacterCapabilityProfile {
  return {
    status: "ready",
    modelId: "sample",
    modelName: "샘플 캐릭터",
    humanoid: true,
    semanticMorphs: {
      eyeSize: { kind: "shape-key" },
      eyeSpacing: null,
      eyeTilt: { kind: "shape-key" },
      irisSize: { kind: "shape-key" },
      noseHeight: null,
      noseWidth: null,
      mouthWidth: null,
      lipFullness: null,
      earSize: null,
    } as unknown as CharacterCapabilityProfile["semanticMorphs"],
    expressions: ["happy", "angry"],
    costumeSlots: ["tops"],
    wardrobeMetricsReady: true,
    propsReady: true,
    irisTintable: true,
    originalHairMeshCount: 2,
    surfacePaintReady: true,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<CharacterHostSnapshot> = {}): CharacterHostSnapshot {
  return {
    forgeFace: { headWidth: 1, headHeight: 1, headDepth: 1, cheekVolume: 0.35, chinLength: 1 },
    semanticMorphs: { eyeSize: 0.2 },
    hairStyle: "bob",
    hairBangStyle: "full",
    hairReplaceOriginal: false,
    hairBaseColor: "#1f1a1c",
    hairTipColor: "#4a3f47",
    proportionPresetId: "webtoon-7",
    bodyPresetId: "balanced",
    wardrobe: {},
    propIds: [],
    activePoseId: null,
    activeExpressionId: null,
    expressionWeights: {},
    customColors: {},
    irisColor: "#4a3328",
    handSide: "both",
    lastHandPoseType: null,
    ...overrides,
  };
}

function makeBinding(overrides: Partial<CharacterShaperBinding> = {}): CharacterShaperBinding {
  const catalog: CharacterSlotCatalog = {
    version: 1,
    slots: [
      { id: "eyes", label: "눈", labelEn: "Eyes", hint: "눈 크기·간격·눈꼬리", group: "identity", icon: "Eye", multi: false },
      { id: "irises", label: "눈동자", labelEn: "Irises", hint: "홍채 크기와 색", group: "identity", icon: "Aperture", multi: false },
      { id: "face-shape", label: "얼굴형", labelEn: "Face", hint: "두상 비율", group: "identity", icon: "ScanFace", multi: false },
      { id: "hair", label: "헤어", labelEn: "Hair", hint: "절차형 헤어", group: "identity", icon: "Scissors", multi: false },
      { id: "body", label: "체형", labelEn: "Body", hint: "두신 비율", group: "figure", icon: "Ruler", multi: false },
      { id: "top", label: "상의", labelEn: "Top", hint: "티셔츠·셔츠", group: "figure", icon: "Shirt", multi: false },
      { id: "accessory", label: "액세서리", labelEn: "Accessory", hint: "여러 개", group: "figure", icon: "Gem", multi: true },
      { id: "expression", label: "표정", labelEn: "Expression", hint: "표정", group: "performance", icon: "Laugh", multi: false },
      { id: "pose", label: "포즈", labelEn: "Pose", hint: "전신 포즈", group: "performance", icon: "Move", multi: false },
      { id: "hand-pose", label: "손 포즈", labelEn: "Hand", hint: "손 모양", group: "performance", icon: "Hand", multi: false },
    ],
    entries: [ENTRY, IRIS_ENTRY],
  };
  return {
    catalog,
    profile: makeProfile(),
    snapshot: makeSnapshot(),
    recipe: makeRecipe(),
    baselineRecipe: makeRecipe(),
    history: { canUndo: false, canRedo: false, recentLabels: [], length: 0 },
    busyReason: null,
    handSide: "both",
    compareActive: false,
    evaluate: vi.fn((): CharacterSlotAvailability => ({ status: "available", reason: null, missing: [] })),
    plan: vi.fn((entry: CharacterSlotEntry) => ({
      entryId: entry.id,
      slot: entry.slot,
      label: entry.label,
      steps: [],
      availability: {
        status: "partial",
        reason: "이 모델에는 눈 간격 shape key가 없어 일부만 적용됩니다.",
        missing: ["eyeSpacing"],
      } as CharacterSlotAvailability,
    })),
    commit: vi.fn(),
    clear: vi.fn(() => null),
    remove: vi.fn(() => null),
    setHandSide: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setCompareActive: vi.fn(),
    resetToBaseline: vi.fn(),
    commitFaceParams: vi.fn(),
    commitSemanticMorphs: vi.fn(),
    commitHairParams: vi.fn(),
    commitColor: vi.fn(),
    ...overrides,
  };
}

function makeHost(overrides: Record<string, unknown> = {}): StudioVrmPoserHost {
  return {
    status: "ready",
    vrm: {},
    libraryEntries: [{ id: "sample", name: "샘플 캐릭터" }],
    activeModelId: "sample",
    avatarForgeState: {
      version: 4,
      bodyPresetId: "balanced",
      face: { headWidth: 1, headHeight: 1, headDepth: 1, cheekVolume: 0.35, chinLength: 1 },
      proportions: {
        version: 1,
        overallHeight: 1,
        headBodyRatio: 1,
        armLength: 1,
        legLength: 1,
        torsoLength: 1,
        shoulderWidth: 1,
        handScale: 1,
        footScale: 1,
        neckLength: 1,
      },
      body: { shoulderWidth: 1, torsoLength: 1, hipWidth: 1, armLength: 1, legLength: 1 },
      hair: {
        style: "bob",
        replaceOriginal: false,
        volume: 1,
        length: 1,
        strandWidth: 1,
        fringe: 1,
        curl: 0.2,
        shine: 0.3,
        baseColor: "#1f1a1c",
        tipColor: "#4a3f47",
        bangStyle: "full",
        wave: 0,
        ahoge: 0,
        tailHeight: 0.5,
      },
    },
    proportionRigStatus: "ready",
    proportionRigMessage: "",
    handleAvatarForgeChange: vi.fn(),
    wardrobeState: { top: { itemId: "shirt", color: "#2b3a5e", fit: 1, fitMode: "auto", fabricId: "cotton" } },
    updateWardrobeEquip: vi.fn(),
    costumeMeshes: [{ key: "Tops_01", label: "상의 메시", slot: "tops", mesh: {} }],
    costumeState: { hidden: [], recolor: {} },
    toggleCostumeMesh: vi.fn(),
    recolorCostumeSlot: vi.fn(),
    vrmPropItems: [{ uid: "p1", propId: "glasses", bone: "head", position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1, color: "#222222" }],
    updateVrmProp: vi.fn(),
    removeVrmProp: vi.fn(),
    availableExpressionActions: [{ id: "happy", label: "기쁨", name: "happy", tone: "밝은 미소" }],
    expressionWeights: { happy: 0.5 },
    updateExpressionWeight: vi.fn(),
    handleMirrorPose: vi.fn(),
    handleResetActivePose: vi.fn(),
    handleBodyRotationChange: vi.fn(),
    handleSavePose: vi.fn(),
    bodyRotation: 0,
    fingerEdits: { leftIndexProximal: [0, 0, 0] },
    updateFingerCurl: vi.fn(),
    ...overrides,
  } as StudioVrmPoserHost;
}

function renderInspector(
  slot: CharacterSlotKind,
  options: { binding?: CharacterShaperBinding; h?: StudioVrmPoserHost; hoveredEntryId?: string | null; onClose?: () => void } = {},
) {
  const binding = options.binding ?? makeBinding();
  const h = options.h ?? makeHost();
  const view = render(
    <CharacterShaperInspector
      h={h}
      binding={binding}
      slot={slot}
      hoveredEntryId={options.hoveredEntryId ?? null}
      onClose={options.onClose}
    />,
  );
  return { ...view, binding, h };
}

function commitRange(label: string, value: string) {
  const range = screen.getByRole("slider", { name: label });
  fireEvent.change(range, { target: { value } });
  fireEvent.pointerUp(range);
}

describe("CharacterShaperInspector header", () => {
  it("shows the hovered entry, its badge and the plan's reason", () => {
    renderInspector("eyes", { hoveredEntryId: "eyes:romance-sparkle" });

    expect(screen.getByText("순정 반짝눈")).toBeTruthy();
    expect(screen.getByText("일부 적용")).toBeTruthy();
    expect(screen.getByText("이 모델에는 눈 간격 shape key가 없어 일부만 적용됩니다.")).toBeTruthy();
  });

  it("renders the close button only when onClose is given", () => {
    const { unmount } = renderInspector("eyes");
    expect(screen.queryByRole("button", { name: "정밀 조절 닫기" })).toBeNull();
    unmount();

    const onClose = vi.fn();
    renderInspector("eyes", { onClose });
    fireEvent.click(screen.getByRole("button", { name: "정밀 조절 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lists the model capabilities in plain language", () => {
    renderInspector("eyes");
    const note = screen.getByLabelText("이 모델에서 되는 것");
    expect(within(note).getByText(/눈 간격/u)).toBeTruthy();
    expect(within(note).getByText("2개")).toBeTruthy();
  });
});

describe("CharacterShaperInspector per slot", () => {
  it("face-shape commits forge face params", () => {
    const { binding } = renderInspector("face-shape");
    commitRange("얼굴 너비", "1.1");
    expect(binding.commitFaceParams).toHaveBeenCalledWith({ headWidth: 1.1 }, "얼굴형: 얼굴 너비");
  });

  it("eyes commits supported morphs and refuses the unsupported one", () => {
    const { binding } = renderInspector("eyes");
    expect(screen.getAllByText("이 모델은 지원하지 않습니다").length).toBe(1);
    expect(screen.queryByRole("slider", { name: "눈 간격" })).toBeNull();

    commitRange("눈 크기", "0.5");
    expect(binding.commitSemanticMorphs).toHaveBeenCalledWith({ eyeSize: 0.5 }, "눈: 눈 크기");
  });

  it("irises commits the tint through the binding", () => {
    const { binding } = renderInspector("irises");
    fireEvent.click(screen.getByRole("button", { name: "눈동자 색 앰버" }));
    expect(binding.commitColor).toHaveBeenCalledWith("iris", "#b45309");

    fireEvent.click(screen.getByRole("button", { name: "눈동자 색 모델 원본 색으로 되돌리기" }));
    expect(binding.commitColor).toHaveBeenLastCalledWith("iris", null);
  });

  it("hair commits bangs, palettes, shape ranges and the original-hair switch", () => {
    const { binding } = renderInspector("hair");

    fireEvent.click(screen.getByRole("button", { name: "가르마" }));
    expect(binding.commitHairParams).toHaveBeenCalledWith({ bangStyle: "split" }, "헤어: 앞머리 split");

    fireEvent.click(screen.getByRole("button", { name: "허니 블론드" }));
    expect(binding.commitHairParams).toHaveBeenLastCalledWith(
      { baseColor: "#a16207", tipColor: "#fde68a" },
      "헤어: 허니 블론드",
    );

    commitRange("길이", "1.3");
    expect(binding.commitHairParams).toHaveBeenLastCalledWith({ length: 1.3 }, "헤어: 길이");

    fireEvent.click(screen.getByRole("switch", { name: /원본 헤어 감추기/u }));
    expect(binding.commitHairParams).toHaveBeenLastCalledWith({ replaceOriginal: true }, "헤어: 원본 헤어 감추기");
  });

  it("body writes proportions through the host forge state", () => {
    const { h } = renderInspector("body");
    commitRange("다리 길이", "1.1");
    const call = (h.handleAvatarForgeChange as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.proportions.legLength).toBe(1.1);
    expect(call.proportions.presetId).toBeUndefined();
  });

  it("body disables the proportion ranges while the rig is applying", () => {
    const h = makeHost({ proportionRigStatus: "applying", proportionRigMessage: "체형 리그를 적용하는 중입니다." });
    renderInspector("body", { h });
    expect((screen.getByRole("slider", { name: "다리 길이" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("체형 리그를 적용하는 중입니다.")).toBeTruthy();
  });

  it("top edits the garment color, its fit and the model's own costume meshes", () => {
    const { h } = renderInspector("top");

    const hex = screen.getByLabelText("상의 색 HEX 값");
    fireEvent.change(hex, { target: { value: "#6e2434" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(h.updateWardrobeEquip).toHaveBeenCalledWith("top", { color: "#6e2434" });

    commitRange("상의 품", "1.2");
    expect(h.updateWardrobeEquip).toHaveBeenLastCalledWith("top", { fit: 1.2 });

    fireEvent.click(screen.getByRole("button", { name: /상의 메시/u }));
    expect(h.toggleCostumeMesh).toHaveBeenCalledWith("Tops_01");

    fireEvent.click(screen.getByRole("button", { name: "상의 블랙으로 덮기" }));
    expect(h.recolorCostumeSlot).toHaveBeenCalledWith("tops", "#1c1c22");
  });

  it("accessory scales and removes an equipped prop", () => {
    const { h } = renderInspector("accessory");
    commitRange("안경 크기", "1.5");
    expect(h.updateVrmProp).toHaveBeenCalledWith("p1", { scale: 1.5 });

    fireEvent.click(screen.getByRole("button", { name: "안경 빼기" }));
    expect(h.removeVrmProp).toHaveBeenCalledWith("p1");
  });

  it("expression drives the host weight setter", () => {
    const { h } = renderInspector("expression");
    commitRange("기쁨", "0.8");
    expect(h.updateExpressionWeight).toHaveBeenCalledWith("happy", 0.8);
  });

  it("pose exposes mirror, reset and save", () => {
    const { h } = renderInspector("pose");
    fireEvent.click(screen.getByRole("button", { name: "좌우 반전" }));
    expect(h.handleMirrorPose).toHaveBeenCalledWith("all");

    fireEvent.click(screen.getByRole("button", { name: "포즈 초기화" }));
    expect(h.handleResetActivePose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "현재 포즈 저장" }));
    expect(h.handleSavePose).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("slider", { name: "몸 방향" }), { target: { value: "30" } });
    expect(h.handleBodyRotationChange).toHaveBeenCalledTimes(1);
  });

  it("hand-pose picks the side and curls the fingers of that hand", () => {
    const { binding, h } = renderInspector("hand-pose");
    fireEvent.click(screen.getByRole("button", { name: "왼손" }));
    expect(binding.setHandSide).toHaveBeenCalledWith("left");

    commitRange("왼손 전체 굽힘", "30");
    expect(h.updateFingerCurl).toHaveBeenCalledWith("left", 30);
  });

  it("hand-pose bends one finger at a time without moving the others", () => {
    const { h } = renderInspector("hand-pose");
    fireEvent.click(screen.getByRole("button", { name: "왼손" }));

    commitRange("왼손 검지", "45");
    expect(h.updateFingerCurl).toHaveBeenLastCalledWith("left", 45, "index");

    commitRange("왼손 엄지", "20");
    expect(h.updateFingerCurl).toHaveBeenLastCalledWith("left", 20, "thumb");
  });

  it("hand-pose reads each finger slider from its own bone", () => {
    const rad = (degrees: number) => (degrees * Math.PI) / 180;
    const h = makeHost({
      fingerEdits: {
        leftIndexProximal: [0, 0, -rad(30)],
        leftLittleProximal: [0, 0, -rad(50)],
      },
    });
    renderInspector("hand-pose", { h });
    // 각 슬라이더가 제 본을 읽어야 한다 — 예전처럼 검지 값을 전부에 보여 주면 거짓말이다.
    expect((screen.getByRole("slider", { name: "왼손 검지" }) as HTMLInputElement).value).toBe("30");
    expect((screen.getByRole("slider", { name: "왼손 새끼" }) as HTMLInputElement).value).toBe("50");
    expect((screen.getByRole("slider", { name: "왼손 중지" }) as HTMLInputElement).value).toBe("0");
    // 오른손 슬라이더는 왼손 편집을 따라가지 않는다.
    expect((screen.getByRole("slider", { name: "오른손 검지" }) as HTMLInputElement).value).toBe("0");
  });

  it("locks every control while the binding reports a busy reason", () => {
    const binding = makeBinding({ busyReason: "캡처가 끝난 뒤에 바꿀 수 있습니다." });
    renderInspector("face-shape", { binding });
    expect(screen.getByText("캡처가 끝난 뒤에 바꿀 수 있습니다.")).toBeTruthy();
    expect((screen.getByRole("slider", { name: "얼굴 너비" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("waits for a model before showing the precision controls", () => {
    renderInspector("face-shape", { h: makeHost({ status: "empty" }) });
    expect(screen.queryByRole("slider", { name: "얼굴 너비" })).toBeNull();
    expect(screen.getByText("모델을 불러오면 이 슬롯의 정밀 조절이 열립니다.")).toBeTruthy();
  });
});
