// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import { CharacterShaperOutputDock } from "./CharacterShaperOutputDock";

import type {
  CharacterCapabilityProfile,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterSlotAvailability,
} from "./character-shaper-contract";
import type { CharacterShaperBinding, CharacterShaperDrawerMode } from "./character-shaper-ui-contract";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

const exportCharacterSemanticPsd = vi.hoisted(() => vi.fn());
const captureStudioVrmRgba = vi.hoisted(() => vi.fn(() => new Uint8ClampedArray(4)));
const encodeStudioVrmCapturePngBlob = vi.hoisted(() => vi.fn(async () => new Blob(["png"])));

vi.mock("./character-shaper-semantic-psd", () => ({
  exportCharacterSemanticPsd,
  boundCharacterSemanticCaptureSize: (width: number, height: number) => ({ width, height }),
}));

vi.mock("../vrm/studio-vrm-raster-capture", () => ({
  captureStudioVrmRgba,
  encodeStudioVrmCapturePngBlob,
}));

vi.mock("../vrm/studio-vrm-poser-helpers", () => ({
  roundExportSize: () => ({ width: 512, height: 640 }),
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
    isCapturing: false,
    libraryEntries: [{ id: "sample", name: "샘플 캐릭터" }],
    activeModelId: "sample",
    transparentBackground: true,
    setTransparentBackground: vi.fn(),
    insertBackgroundColor: "#ffffff",
    setInsertBackgroundColor: vi.fn(),
    handleInsert: vi.fn(),
    texturePaintDisabledReason: "",
    captureRef: { current: { gl: { domElement: document.createElement("canvas") }, scene: {}, camera: {} } },
    ...overrides,
  } as StudioVrmPoserHost;
}

function renderDock(
  options: {
    h?: StudioVrmPoserHost;
    binding?: CharacterShaperBinding;
    drawer?: CharacterShaperDrawerMode;
    compact?: boolean;
    paintActive?: boolean;
  } = {},
) {
  const h = options.h ?? makeHost();
  const binding = options.binding ?? makeBinding();
  const onOpenDrawer = vi.fn();
  const onTogglePaint = vi.fn();
  const view = render(
    <CharacterShaperOutputDock
      h={h}
      binding={binding}
      drawer={options.drawer ?? null}
      onOpenDrawer={onOpenDrawer}
      paintActive={options.paintActive ?? false}
      onTogglePaint={onTogglePaint}
      compact={options.compact ?? false}
    />,
  );
  return { ...view, h, binding, onOpenDrawer, onTogglePaint };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  exportCharacterSemanticPsd.mockResolvedValue({
    blob: new Blob(["psd"]),
    receipt: {
      width: 512,
      height: 640,
      layerNames: ["피부", "얼굴", "눈", "헤어", "상의", "하의", "신발", "음영", "하이라이트", "주선"],
      skipped: [{ pass: "surface-paint", reason: "표면 드로잉 텍스처가 없습니다." }],
      byteLength: 1024,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CharacterShaperOutputDock", () => {
  it("opens each drawer mode and marks the open one", () => {
    const { onOpenDrawer } = renderDock({ drawer: "photo" });

    expect(screen.getByRole("button", { name: "사진 포즈" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "웹캠" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 AI 추천" }));
    expect(onOpenDrawer).toHaveBeenCalledWith("reference");
  });

  it("toggles 표면 드로잉 and reports the runtime's reason when it cannot run", () => {
    const { onTogglePaint } = renderDock();
    fireEvent.click(screen.getByRole("button", { name: "표면 드로잉" }));
    expect(onTogglePaint).toHaveBeenCalledTimes(1);

    cleanup();
    renderDock({ h: makeHost({ texturePaintDisabledReason: "이 모델에는 칠할 수 있는 표면이 없습니다." }) });
    const blocked = screen.getByRole("button", { name: "표면 드로잉" }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toBe("이 모델에는 칠할 수 있는 표면이 없습니다.");
  });

  it("adds the character to the canvas through the host", () => {
    const { h } = renderDock();
    fireEvent.click(screen.getByRole("button", { name: "캔버스에 추가" }));
    expect(h.handleInsert).toHaveBeenCalledTimes(1);
  });

  it("blocks the insert while the runtime is capturing", () => {
    const { h } = renderDock({ h: makeHost({ isCapturing: true }) });
    const insert = screen.getByRole("button", { name: "캔버스에 추가" }) as HTMLButtonElement;
    expect(insert.disabled).toBe(true);
    fireEvent.click(insert);
    expect(h.handleInsert).not.toHaveBeenCalled();
  });

  it("switches the transparent background and reveals the background color", () => {
    const { h } = renderDock();
    expect(screen.queryByLabelText("삽입 배경색")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /투명 배경/u }));
    expect(h.setTransparentBackground).toHaveBeenCalledWith(false);

    cleanup();
    const opaque = renderDock({ h: makeHost({ transparentBackground: false }) });
    const color = screen.getByLabelText("삽입 배경색");
    fireEvent.change(color, { target: { value: "#112233" } });
    expect(opaque.h.setInsertBackgroundColor).toHaveBeenCalledWith("#112233");
  });

  it("saves a PNG from the live capture state", async () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "PNG 저장" }));

    expect(await screen.findByText(/PNG를 저장했습니다/u)).toBeTruthy();
    expect(captureStudioVrmRgba).toHaveBeenCalledTimes(1);
    expect(encodeStudioVrmCapturePngBlob).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), {
      width: 512,
      height: 640,
    });
  });

  it("exports the semantic PSD and reports the receipt with the skipped passes", async () => {
    const { h } = renderDock();
    fireEvent.click(screen.getByRole("button", { name: "PSD 내보내기" }));

    expect(screen.getByRole("status").textContent).toContain("레이어를 나누는 중");
    expect(await screen.findByText(/PSD 레이어 10개 저장/u)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("표면 드로잉 텍스처가 없습니다.");

    const input = exportCharacterSemanticPsd.mock.calls[0]?.[0] as {
      readonly vrm: unknown;
      readonly width: number;
      readonly height: number;
    };
    expect(input.vrm).toBe(h.vrm);
    expect(input.width).toBe(512);
    expect(input.height).toBe(640);
  });

  it("says so when the scene is not ready instead of exporting", () => {
    renderDock({ h: makeHost({ captureRef: { current: { gl: null, scene: null, camera: null } } }) });
    fireEvent.click(screen.getByRole("button", { name: "PSD 내보내기" }));
    expect(exportCharacterSemanticPsd).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("캡처할 3D 장면이 아직 준비되지 않았습니다.");
  });

  it("reports a failed export instead of staying silent", async () => {
    exportCharacterSemanticPsd.mockRejectedValueOnce(new Error("레이어 캡처 크기가 올바르지 않습니다."));
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "PSD 내보내기" }));
    expect(await screen.findByText(/PSD를 내보내지 못했습니다/u)).toBeTruthy();
  });

  it("collapses to icon buttons with an overflow sheet on mobile", () => {
    renderDock({ compact: true });

    expect(screen.queryByRole("button", { name: "PNG 저장" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "내보내기 더 보기" }));

    const sheet = screen.getByRole("group", { name: "내보내기" });
    expect(sheet).toBeTruthy();
    expect(screen.getByRole("button", { name: "PNG 저장" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "PSD 내보내기" })).toBeTruthy();
  });
});
