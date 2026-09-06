// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import { CharacterShaperReferenceDrawer } from "./CharacterShaperReferenceDrawer";

import type {
  CharacterCapabilityProfile,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterSlotAvailability,
} from "./character-shaper-contract";
import type { CharacterShaperBinding, CharacterShaperDrawerMode } from "./character-shaper-ui-contract";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

const extractCharacterReferencePalette = vi.hoisted(() => vi.fn());
const rememberStudioVrmWebcamSessionConsent = vi.hoisted(() => vi.fn());

vi.mock("./character-shaper-palette-extract", () => ({ extractCharacterReferencePalette }));

vi.mock("../vrm/studio-vrm-poser-preferences-sqlite", () => ({
  rememberStudioVrmWebcamSessionConsent,
  hasStudioVrmWebcamSessionConsent: () => false,
}));

vi.mock("../vrm/useStudioVrmAvatarReferenceCatalogue", () => ({
  studioVrmAvatarReferenceCatalogueDiagnosticMessage: () => "추천 기준을 불러오지 못했습니다.",
}));

vi.mock("../vrm/StudioVrmAvatarReferenceRecommendationsPanel", () => ({
  StudioVrmAvatarReferenceRecommendationsPanel: ({
    disabled,
    onApply,
  }: {
    disabled?: boolean;
    onApply: (selection: { presetId: string }) => void;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onApply({ presetId: "preset-a" })}>
      추천 프리셋 적용
    </button>
  ),
}));

vi.mock("../vrm/StudioVrmPhotoPoseScanner", () => ({
  StudioVrmPhotoPoseScanner: ({
    handoff,
    onApply,
  }: {
    handoff?: { file: File; token: number } | null;
    onApply: (payload: { sourceName: string }) => boolean;
  }) => (
    <>
      <button type="button" onClick={() => onApply({ sourceName: "pose.png" })}>
        사진 포즈 적용
      </button>
      <p data-testid="photo-handoff">{handoff ? `${handoff.file.name}#${handoff.token}` : "none"}</p>
    </>
  ),
}));

function makeRecipe(): CharacterRecipe {
  const slots = Object.fromEntries(
    CHARACTER_SLOT_KINDS.map((slot) => [slot, slot === "accessory" ? [] : null]),
  ) as unknown as CharacterRecipe["slots"];
  return {
    version: 1,
    slots,
    colors: { skin: null, hairBase: null, hairTip: null, iris: null, top: null, bottom: null, shoes: null },
    handSide: "both",
  };
}

function makeBinding(overrides: Partial<CharacterShaperBinding> = {}): CharacterShaperBinding {
  return {
    catalog: { version: 1, slots: [], entries: [] },
    profile: {} as CharacterCapabilityProfile,
    snapshot: {} as CharacterHostSnapshot,
    recipe: makeRecipe(),
    baselineRecipe: makeRecipe(),
    history: { canUndo: false, canRedo: false, recentLabels: [], length: 0 },
    busyReason: null,
    handSide: "both",
    compareActive: false,
    evaluate: vi.fn((): CharacterSlotAvailability => ({ status: "available", reason: null, missing: [] })),
    plan: vi.fn(),
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
    vrm: { scene: {} },
    activePanelTab: "pose",
    activeCharacterSection: "library",
    handlePanelTabChange: vi.fn(),
    handleCharacterSectionChange: vi.fn(),
    avatarForgeReferenceCatalogue: { catalogue: null, status: "idle", diagnosticCode: null, retry: vi.fn() },
    avatarForgeReferenceInteractionBlocked: () => false,
    handleAvatarForgeReferencePreview: vi.fn(),
    handleAvatarForgeReferenceApply: vi.fn(),
    setAvatarForgeReferencePreview: vi.fn(),
    handlePhotoPoseApply: vi.fn(() => true),
    wardrobeState: { top: { itemId: "shirt", color: "#2b3a5e", fit: 1, fitMode: "auto", fabricId: "cotton" } },
    updateWardrobeEquip: vi.fn(),
    webcamActive: false,
    webcamLoading: false,
    webcamError: null,
    showConsent: false,
    webcamConsentGranted: false,
    faceDetected: false,
    trackingOptions: { mirrorMode: true, gazeLock: false, fingerTracking: false, sensitivity: 1, smoothing: 0.5 },
    setTrackingOptions: vi.fn(),
    setWebcamActive: vi.fn(),
    setWebcamError: vi.fn(),
    setShowConsent: vi.fn(),
    setWebcamConsentGranted: vi.fn(),
    handleCapturePose: vi.fn(),
    videoRef: { current: null },
    ...overrides,
  } as StudioVrmPoserHost;
}

function renderDrawer(
  options: { mode?: Exclude<CharacterShaperDrawerMode, null>; h?: StudioVrmPoserHost; binding?: CharacterShaperBinding } = {},
) {
  const h = options.h ?? makeHost();
  const binding = options.binding ?? makeBinding();
  const onModeChange = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <CharacterShaperReferenceDrawer
      h={h}
      binding={binding}
      mode={options.mode ?? "reference"}
      onModeChange={onModeChange}
      onClose={onClose}
    />,
  );
  // The drawer does not own `mode` — the shell does. Switching tabs in a test therefore means
  // re-rendering the same element with the mode the shell would have set.
  const setMode = (next: Exclude<CharacterShaperDrawerMode, null>) => {
    view.rerender(
      <CharacterShaperReferenceDrawer
        h={h}
        binding={binding}
        mode={next}
        onModeChange={onModeChange}
        onClose={onClose}
      />,
    );
  };
  return { ...view, h, binding, onModeChange, onClose, setMode };
}

beforeEach(() => {
  vi.clearAllMocks();
  extractCharacterReferencePalette.mockReturnValue({
    swatches: ["#112233", "#445566"],
    skin: "#f5c6a0",
    hair: "#1f1a1c",
    accent: "#b45309",
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: vi.fn(async () => ({ width: 400, height: 500, close: vi.fn() })),
  });
  const context2d = {
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => contextId === "2d" ? context2d : null) as
      typeof HTMLCanvasElement.prototype.getContext
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CharacterShaperReferenceDrawer tabs", () => {
  it("marks the active tab and switches modes by click and by arrow key", () => {
    const { onModeChange } = renderDrawer({ mode: "reference" });

    expect(screen.getByRole("tab", { name: "참고 이미지 AI 추천" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "사진 포즈" }));
    expect(onModeChange).toHaveBeenCalledWith("photo");

    fireEvent.keyDown(screen.getByRole("tab", { name: "참고 이미지 AI 추천" }), { key: "ArrowRight" });
    expect(onModeChange).toHaveBeenLastCalledWith("photo");

    fireEvent.keyDown(screen.getByRole("tab", { name: "참고 이미지 AI 추천" }), { key: "End" });
    expect(onModeChange).toHaveBeenLastCalledWith("webcam");
  });

  it("puts the initial focus on the active tab", async () => {
    renderDrawer({ mode: "webcam" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tab", { name: "웹캠" })));
  });

  it("closes through the header button", () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "참고 도구 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("claims the forge surface while the recommendation tab is open and restores it on close", () => {
    const { h, unmount } = renderDrawer({ mode: "reference" });
    expect(h.handlePanelTabChange).toHaveBeenCalledWith("character");
    expect(h.handleCharacterSectionChange).toHaveBeenCalledWith("forge");

    unmount();
    expect(h.handlePanelTabChange).toHaveBeenLastCalledWith("pose");
    expect(h.handleCharacterSectionChange).toHaveBeenLastCalledWith("library");
  });
});

describe("CharacterShaperReferenceDrawer reference tab", () => {
  it("states that the analysis stays on the device", () => {
    renderDrawer({ mode: "reference" });
    expect(screen.getByText("MediaPipe 이미지 임베더 · 기기 내 처리 · 업로드 없음")).toBeTruthy();
  });

  it("extracts a palette from the chosen image and applies a swatch to hair, iris and top", async () => {
    const { binding, h } = renderDrawer({ mode: "reference" });

    const input = screen.getByLabelText("참고 이미지 선택");
    const file = new File(["binary"], "ref.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole("button", { name: "헤어 색으로" })).toBeTruthy());
    expect(extractCharacterReferencePalette).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "헤어 색으로" }));
    expect(binding.commitColor).toHaveBeenCalledWith("hairBase", "#1f1a1c");

    fireEvent.click(screen.getByRole("button", { name: "색 #445566 고르기" }));
    fireEvent.click(screen.getByRole("button", { name: "눈동자 색으로" }));
    expect(binding.commitColor).toHaveBeenLastCalledWith("iris", "#445566");

    fireEvent.click(screen.getByRole("button", { name: "상의 색으로" }));
    expect(h.updateWardrobeEquip).toHaveBeenCalledWith("top", { color: "#445566" });
    expect(screen.getByRole("status", { name: "팔레트 적용 결과" }).textContent).toContain("#445566");
  });

  it("blocks the top color when no garment is equipped and says why", async () => {
    renderDrawer({ mode: "reference", h: makeHost({ wardrobeState: {} }) });

    const input = screen.getByLabelText("참고 이미지 선택");
    fireEvent.change(input, { target: { files: [new File(["binary"], "ref.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "상의 색으로" })).toBeTruthy());

    const top = screen.getByRole("button", { name: "상의 색으로" }) as HTMLButtonElement;
    expect(top.disabled).toBe(true);
    expect(top.title).toBe("상의를 먼저 입혀야 색을 바꿀 수 있습니다.");
  });

  it("refuses a non-image file with a reason", async () => {
    renderDrawer({ mode: "reference" });
    const input = screen.getByLabelText("참고 이미지 선택");
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });

    expect(await screen.findByText("이미지 파일만 읽을 수 있습니다.")).toBeTruthy();
    expect(extractCharacterReferencePalette).not.toHaveBeenCalled();
  });

  it("hands the already-chosen reference image to the photo tab so it is picked only once", async () => {
    const { onModeChange, setMode } = renderDrawer({ mode: "reference" });

    const input = screen.getByLabelText("참고 이미지 선택");
    const file = new File(["binary"], "ref.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    const handoffButton = await screen.findByRole("button", { name: "이 사진에서 포즈도 읽기" });
    fireEvent.click(handoffButton);
    expect(onModeChange).toHaveBeenCalledWith("photo");

    setMode("photo");
    expect(screen.getByTestId("photo-handoff").textContent).toBe("ref.png#1");
  });

  it("offers no photo handoff for a file the palette refused", async () => {
    renderDrawer({ mode: "reference" });
    const input = screen.getByLabelText("참고 이미지 선택");
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });

    expect(await screen.findByText("이미지 파일만 읽을 수 있습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "이 사진에서 포즈도 읽기" })).toBeNull();
  });

  it("forwards the recommendation panel's apply to the host", () => {
    const { h } = renderDrawer({ mode: "reference" });
    fireEvent.click(screen.getByRole("button", { name: "추천 프리셋 적용" }));
    expect(h.handleAvatarForgeReferenceApply).toHaveBeenCalledWith({ presetId: "preset-a" });
  });
});

describe("CharacterShaperReferenceDrawer photo and webcam tabs", () => {
  it("forwards a photo pose apply to the host", () => {
    const { h } = renderDrawer({ mode: "photo" });
    fireEvent.click(screen.getByRole("button", { name: "사진 포즈 적용" }));
    expect(h.handlePhotoPoseApply).toHaveBeenCalledWith({ sourceName: "pose.png" });
  });

  it("asks for consent before turning the camera on", () => {
    const { h } = renderDrawer({ mode: "webcam" });
    fireEvent.click(screen.getByRole("button", { name: /트래킹 시작/u }));
    expect(h.setShowConsent).toHaveBeenCalledWith(true);
    expect(h.setWebcamActive).not.toHaveBeenCalled();
  });

  it("remembers the session consent and starts tracking after the creator agrees", () => {
    const { h } = renderDrawer({ mode: "webcam", h: makeHost({ showConsent: true }) });
    fireEvent.click(screen.getByRole("button", { name: "동의하고 카메라 켜기" }));
    expect(rememberStudioVrmWebcamSessionConsent).toHaveBeenCalledTimes(1);
    expect(h.setWebcamConsentGranted).toHaveBeenCalledWith(true);
    expect(h.setWebcamActive).toHaveBeenCalledWith(true);
  });

  it("freezes the current expression and flips the tracking toggles while running", () => {
    const h = makeHost({ webcamActive: true, faceDetected: true });
    renderDrawer({ mode: "webcam", h });

    fireEvent.click(screen.getByRole("button", { name: /표정 굳히기/u }));
    expect(h.handleCapturePose).toHaveBeenCalledTimes(1);

    const mirror = screen.getByRole("switch", { name: /거울 모드/u });
    expect(mirror.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(mirror);
    const updater = (h.setTrackingOptions as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as (
      previous: Record<string, unknown>,
    ) => Record<string, unknown>;
    expect(updater({ mirrorMode: true })).toEqual({ mirrorMode: false });
  });
});
