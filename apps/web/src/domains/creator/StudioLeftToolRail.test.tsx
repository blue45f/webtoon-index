// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStudioLeftToolRailClient,
  type StudioLeftToolRailClient,
  type StudioLeftToolRailClientInput,
} from "./editor-client/studio-left-tool-rail-client";
import { defaultStudioAppSettings } from "./studio-app-settings";
import {
  StudioLeftToolRail,
  type StudioLeftToolRailHandlers,
} from "./StudioLeftToolRail";

import type { El } from "./studio-element-model";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/shared/lib/i18n";

// 이 파일의 기대값은 전부 **한국어 제품 문구**다. 레일 셸 문구는 이제 로케일을 따라가므로,
// jsdom 의 기본 navigator 로케일(en)에 기대면 한국어를 검증하는 테스트가 영어를 받게 된다.
// 검증하려는 로케일을 명시적으로 고정한다.
beforeEach(() => {
  useI18n.setState({ lang: "ko" });
});

const preloadRasterRetouchRuntime = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("./render/studio-raster-retouch-preload", () => ({
  preloadStudioRasterRetouchRuntime: preloadRasterRetouchRuntime,
}));

interface MockRailButtonProps {
  readonly "aria-controls"?: string;
  readonly "aria-expanded"?: boolean;
  readonly "aria-keyshortcuts"?: string;
  readonly "data-studio-rail-tool-id"?: string;
  readonly active?: boolean;
  readonly className?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly hintPreview?: string;
  readonly hintPreviewVariant?: string;
  readonly id?: string;
  readonly icon?: LucideIcon;
  readonly label: string;
  readonly onClick?: () => void;
  readonly onFocus?: () => void;
  readonly onPointerDown?: () => void;
  readonly onPointerEnter?: () => void;
  readonly unavailableReason?: string;
}

vi.mock("./studio-chrome-ui", () => ({
  STUDIO_ICON_SIZE: {
    rail: 14,
    subtab: 14,
  },
  STUDIO_ICON_STROKE: 2,
  studioChromeIconClass: () => "",
  StudioRailDivider: (props: Record<string, string | undefined>) => (
    <hr
      data-studio-rail-group-divider={props["data-studio-rail-group-divider"]}
      data-studio-rail-group-label={props.label}
      aria-label={props.label}
    />
  ),
  StudioRailToolButton: ({
    "aria-controls": ariaControls,
    "aria-expanded": ariaExpanded,
    "aria-keyshortcuts": ariaKeyShortcuts,
    "data-studio-rail-tool-id": railToolId,
    active,
    className,
    description,
    disabled,
    hintPreview,
    hintPreviewVariant,
    id,
    icon: Icon,
    label,
    onClick,
    onFocus,
    onPointerDown,
    onPointerEnter,
    unavailableReason,
  }: MockRailButtonProps) => (
    <button
      id={id}
      type="button"
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-keyshortcuts={ariaKeyShortcuts}
      aria-label={label}
      aria-pressed={active}
      className={className}
      data-hint-description={description}
      data-hint-preview={hintPreview}
      data-hint-preview-variant={hintPreviewVariant}
      data-studio-rail-tool-id={railToolId}
      data-unavailable-reason={unavailableReason}
      disabled={disabled}
      onClick={onClick}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
    >
      {Icon ? <Icon aria-hidden /> : null}
      {label}
    </button>
  ),
  StudioVerticalToolRail: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer?: ReactNode;
  }) => (
    <div role="toolbar" aria-label="그리기 도구">
      <div data-studio-tool-rail-scroll="true">{children}</div>
      {footer ? <div data-studio-tool-rail-footer="true">{footer}</div> : null}
    </div>
  ),
}));

vi.mock("./StudioToolHint", () => ({
  StudioToolHintTarget: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

type RailProps = StudioLeftToolRailClientInput & {
  readonly client: StudioLeftToolRailClient;
  readonly stableHandlers: StudioLeftToolRailHandlers;
  readonly setStrokeWidth: ReturnType<typeof vi.fn>;
};

const IMAGE: El = {
  id: "image-1",
  type: "image",
  src: "data:image/png;base64,AA==",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
};

const USABLE_SELECTION = {
  subpaths: [{
    mode: "add" as const,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
    ],
  }],
  featherPx: 0,
  invert: false,
};

function createHandlers(): StudioLeftToolRailHandlers {
  return {
    activatePrimaryCanvasTool: vi.fn(),
    fitCanvasToWidth: vi.fn(),
    openFrameAnimationForSelected: vi.fn(),
    openPixelSelectionTransform: vi.fn(),
    openSelectedLayerCrop: vi.fn(),
    toggleBg3dEditor: vi.fn(),
    addBubble: vi.fn(),
    addText: vi.fn(),
    announceDrawingShortcut: vi.fn(),
    clearPolyLassoDraft: vi.fn(),
    commitAppSettings: vi.fn(),
    disarmAllPixelTools: vi.fn(),
    onRequestPixelSelection: vi.fn(),
    onRequestSelectImage: vi.fn(),
    returnToSelectTool: vi.fn(),
    toggleHandTool: vi.fn(),
    onPickImage: vi.fn(async () => undefined),
    revealDrawToolProperties: vi.fn(),
    toggleAdvancedFill: vi.fn(),
    toggleDodgeBurnTool: vi.fn(),
    toggleWetMixTool: vi.fn(),
    toggleLiquifyTool: vi.fn(),
    togglePixelMarquee: vi.fn(),
    toggleSmudgeTool: vi.fn(),
    toggleStudioCommentPinPlacement: vi.fn(),
  };
}

function createProps(overrides: Partial<RailProps> = {}): RailProps {
  const stableHandlers = overrides.stableHandlers ?? createHandlers();
  const defaults = {
    activeSurfaceReviewLocked: false,
    pixelToolTargetAvailable: true,
    rasterRetouchTargetAvailable: true,
    advancedFillActive: false,
    advancedFillUnsupportedReason: null,
    appSettings: defaultStudioAppSettings(),
    appSettingsOpen: false,
    canvasOnlyMode: false,
    commentPinArmed: false,
    cropActive: false,
    drawMode: "pen" as const,
    drawShape: "rect" as const,
    eyedropperActive: false,
    frameAnimOpen: false,
    frameAnimTargetId: null,
    isRailToolVisible: () => true,
    liquifyActive: false,
    mobileImmersive: false,
    perspectiveRulerActive: false,
    pixelForceCircle: false,
    pixelSel: null,
    pixelTool: null,
    quickShapeActive: false,
    railMoreOpen: false,
    referencePanelOpen: false,
    mannequinPoserOpen: false,
    poserVrmOpen: false,
    bg3dOpen: false,
    hybridDccOpen: false,
    selected: null,
    selectedImageMutationLocked: false,
    setAppSettingsInitialTab: vi.fn(),
    setAppSettingsOpen: vi.fn(),
    setDrawShape: vi.fn(),
    setEyedropperActive: vi.fn(),
    setMenu: vi.fn(),
    setPerspectiveRulerActive: vi.fn(),
    setPixelForceCircle: vi.fn(),
    setPixelTool: vi.fn(),
    setQuickShapeActive: vi.fn(),
    setRailMoreOpen: vi.fn(),
    setReferencePanelOpen: vi.fn(),
    setMannequinPoserOpen: vi.fn(),
    setPoserVrmOpen: vi.fn(),
    setHybridDccOpen: vi.fn(),
    setStrokeWidth: vi.fn(),
    setViewTool: vi.fn(),
    dodgeBurnActive: false,
    wetMixActive: false,
    smudgeActive: false,
    tool: "select" as const,
    uiDensityMode: "full" as const,
    viewTool: null,
    viewTransformSuppressed: false,
    stableHandlers,
  };
  const merged = { ...defaults, ...overrides, stableHandlers };
  const input = {
    ...merged,
    ...stableHandlers,
  } as StudioLeftToolRailClientInput;

  return {
    ...merged,
    ...stableHandlers,
    client: createStudioLeftToolRailClient(input),
  } as RailProps;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("shows the configured comment shortcut in the placement tool and preserves the toggle action", () => {
  const props = createProps();
  render(<StudioLeftToolRail {...props} />);

  const comment = screen.getByRole("button", { name: "댓글 핀 배치 (⌥·C)" });
  expect(comment.getAttribute("aria-keyshortcuts")).toBe("Alt+C");
  expect(comment.getAttribute("aria-pressed")).toBe("false");
  expect(comment.getAttribute("data-hint-description")).toContain("⌥·C로 바로 시작");
  expect(comment.getAttribute("data-hint-description")).toContain("⇧·C로 핀을 숨길");

  fireEvent.click(comment);
  expect(props.stableHandlers.toggleStudioCommentPinPlacement).toHaveBeenCalledOnce();

  const unboundSettings = defaultStudioAppSettings();
  unboundSettings.shortcuts["tool-comment"] = "";
  cleanup();
  render(<StudioLeftToolRail {...createProps({ appSettings: unboundSettings })} />);
  const unboundComment = screen.getByRole("button", { name: "댓글 핀 배치" });
  expect(unboundComment.getAttribute("aria-keyshortcuts")).toBeNull();

});

it("delegates the 3D background rail entry to the selection-aware editor toggle", () => {
  const props = createProps();
  render(<StudioLeftToolRail {...props} />);

  fireEvent.click(screen.getByRole("button", { name: "3D 배경" }));

  expect(props.stableHandlers.toggleBg3dEditor).toHaveBeenCalledOnce();
});

it("keeps all four retouch labels and aria shortcuts in sync with remapped settings", () => {
  const appSettings = defaultStudioAppSettings();
  appSettings.shortcuts["tool-blend"] = "Alt+S";
  appSettings.shortcuts["tool-wet-mix"] = "Mod+Shift+W";
  appSettings.shortcuts["tool-dodge-burn"] = "D";
  appSettings.shortcuts["tool-liquify"] = "";
  render(<StudioLeftToolRail {...createProps({ appSettings })} />);

  const smudge = screen.getByRole("button", { name: "색 밀어 섞기 · 스머지 (⌥·S)" });
  const wetMix = screen.getByRole("button", { name: "물감 섞어 칠하기 · 혼색 (⌘·⇧·W)" });
  const dodgeBurn = screen.getByRole("button", { name: "밝기·채도 붓 · 닷지·번 (D)" });
  const liquify = screen.getByRole("button", { name: "형태 밀어 변형 · 리퀴파이" });

  expect(smudge.getAttribute("aria-keyshortcuts")).toBe("Alt+S");
  expect(wetMix.getAttribute("aria-keyshortcuts")).toBe("Mod+Shift+W");
  expect(dodgeBurn.getAttribute("aria-keyshortcuts")).toBe("D");
  expect(liquify.getAttribute("aria-keyshortcuts")).toBeNull();
});

function stubAnimationFrame(): void {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

function hiddenToolSettings(): ReturnType<typeof defaultStudioAppSettings> {
  const defaults = defaultStudioAppSettings();
  return {
    ...defaults,
    toolbar: { visibleIds: ["select"] },
  };
}

describe("StudioLeftToolRail", () => {
  it("uses dashed selection silhouettes that remain distinct from solid shape tools", () => {
    render(<StudioLeftToolRail {...createProps()} />);

    const iconClass = (label: string): string => (
      screen
        .getByRole("button", { name: label })
        .querySelector("svg")
        ?.getAttribute("class")
      ?? ""
    );

    const rectangleSelection = iconClass("사각 선택 (M)");
    const circleSelection = iconClass("원형 선택");
    const rectangleShape = iconClass("사각형 도형");
    const ellipseShape = iconClass("타원 도형");

    expect(rectangleSelection).toContain("lucide-square-dashed-mouse-pointer");
    expect(circleSelection).toContain("lucide-circle-dashed");
    expect(rectangleShape).toContain("lucide-square");
    expect(rectangleShape).not.toContain("dashed");
    expect(ellipseShape).toContain("lucide-circle");
    expect(ellipseShape).not.toContain("dashed");
    expect(rectangleSelection).not.toBe(rectangleShape);
    expect(circleSelection).not.toBe(ellipseShape);
  });

  it("wires core draw, insertion, image, and view actions to their single owners", () => {
    const props = createProps({ selected: IMAGE });
    render(<StudioLeftToolRail {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "펜 (B)" }));
    expect(props.stableHandlers.activatePrimaryCanvasTool).toHaveBeenCalledWith("draw", "pen");

    fireEvent.click(screen.getByRole("button", { name: "픽셀 펜 (P)" }));
    expect(props.stableHandlers.activatePrimaryCanvasTool).toHaveBeenCalledWith("draw", "pixel");
    expect(props.setStrokeWidth).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "사각형 도형" }));
    expect(props.stableHandlers.activatePrimaryCanvasTool).toHaveBeenCalledWith("draw", "shape");
    expect(props.setDrawShape).toHaveBeenCalledWith("rect");

    fireEvent.click(screen.getByRole("button", { name: "텍스트 추가" }));
    expect(props.stableHandlers.addText).toHaveBeenCalledWith(undefined, true);
    fireEvent.click(screen.getByRole("button", { name: "말풍선 추가" }));
    expect(props.stableHandlers.addBubble).toHaveBeenCalledWith("speech", undefined, true);

    const imageFileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept]',
    );
    expect(imageFileInput).not.toBeNull();
    expect(imageFileInput?.getAttribute("aria-label")).toBe("캔버스 이미지 파일 선택");
    const openPicker = vi.spyOn(imageFileInput!, "click");
    fireEvent.click(screen.getByRole("button", { name: "이미지 추가" }));
    expect(openPicker).toHaveBeenCalledOnce();
    fireEvent.change(imageFileInput!, {
      target: { files: [new File(["image"], "image.png", { type: "image/png" })] },
    });
    expect(props.stableHandlers.onPickImage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "너비에 맞춤 (Home)" }));
    expect(props.stableHandlers.fitCanvasToWidth).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "보기 확대·축소 (Z)" }));
    expect(props.setViewTool).toHaveBeenCalledExactlyOnceWith("zoom");
  });

  it("prefers workspace-aware fit-width handler when it is provided", () => {
    const stableHandlers: StudioLeftToolRailHandlers = {
    ...createHandlers(),
    fitCanvasToWidthWithFocus: vi.fn(),
  };
    const props = createProps({
      stableHandlers,
      selected: IMAGE,
    });

    render(<StudioLeftToolRail {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "너비에 맞춤 (Home)" }));
    expect(stableHandlers.fitCanvasToWidthWithFocus).toHaveBeenCalledOnce();
    expect(stableHandlers.fitCanvasToWidth).not.toHaveBeenCalled();
  });

  it("keeps fill discoverable and clickable while explaining how an unavailable selection recovers", () => {
    const props = createProps({
      advancedFillUnsupportedReason: "래스터 이미지 레이어를 먼저 선택하세요.",
    });
    render(<StudioLeftToolRail {...props} />);

    const fill = screen.getByRole<HTMLButtonElement>("button", { name: "채우기 (G)" });
    expect(fill.disabled).toBe(false);
    expect(fill.getAttribute("data-hint-description")).toContain(
      "래스터 이미지 레이어를 먼저 선택하세요.",
    );
    expect(fill.getAttribute("data-hint-description")).toContain("안전한 단일 래스터 후보");

    fireEvent.click(fill);
    expect(props.stableHandlers.toggleAdvancedFill).toHaveBeenCalledOnce();
  });

  it("keeps image-only entries actionable through explicit 44px recovery CTAs", () => {
    const props = createProps({
      pixelSel: USABLE_SELECTION,
      pixelToolTargetAvailable: false,
      rasterRetouchTargetAvailable: true,
      selected: null,
    });
    render(<StudioLeftToolRail {...props} />);

    for (const name of [
      "자르기 (C)",
      "색 밀어 섞기 · 스머지 (N)",
      "물감 섞어 칠하기 · 혼색 (⇧·N)",
      "밝기·채도 붓 · 닷지·번 (O)",
      "형태 밀어 변형 · 리퀴파이 (J)",
    ]) {
      const button = screen.getByRole<HTMLButtonElement>("button", { name });
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("data-hint-description")).toContain(
        "편집용 이미지 복사본을 자동",
      );
    }

    // No raster target: transform arms object select ("선택 후 변형"), not pixel marquee.
    const transformPickRecovery = screen.getByRole<HTMLButtonElement>("button", {
      name: "선택 후 변형",
    });
    const imageRecovery = screen.getByRole<HTMLButtonElement>("button", {
      name: "이미지 선택하기",
    });
    expect(transformPickRecovery.disabled).toBe(false);
    expect(transformPickRecovery.className).toContain("size-11");
    expect(imageRecovery.disabled).toBe(false);
    expect(imageRecovery.className).toContain("size-11");

    fireEvent.click(transformPickRecovery);
    fireEvent.click(imageRecovery);
    expect(props.stableHandlers.returnToSelectTool).toHaveBeenCalledOnce();
    expect(props.stableHandlers.onRequestPixelSelection).not.toHaveBeenCalled();
    expect(props.stableHandlers.onRequestSelectImage).toHaveBeenCalledOnce();
  });

  it("starts pixel marquee recovery when a raster target exists but nothing is free-transformable", () => {
    const props = createProps({
      pixelSel: null,
      pixelToolTargetAvailable: true,
      rasterRetouchTargetAvailable: true,
      selected: null,
    });
    render(<StudioLeftToolRail {...props} />);

    const selectionRecovery = screen.getByRole<HTMLButtonElement>("button", {
      name: "선택 시작하기",
    });
    expect(selectionRecovery.disabled).toBe(false);
    fireEvent.click(selectionRecovery);
    expect(props.stableHandlers.onRequestPixelSelection).toHaveBeenCalledOnce();
    expect(props.stableHandlers.returnToSelectTool).not.toHaveBeenCalled();
  });

  it("disables only inactive raster-retouch tools when neither image nor page target is available", () => {
    render(<StudioLeftToolRail {...createProps({
      pixelToolTargetAvailable: false,
      rasterRetouchTargetAvailable: false,
      selected: null,
    })} />);

    for (const name of [
      "자르기 (C)",
      "색 밀어 섞기 · 스머지 (N)",
      "물감 섞어 칠하기 · 혼색 (⇧·N)",
      "밝기·채도 붓 · 닷지·번 (O)",
      "형태 밀어 변형 · 리퀴파이 (J)",
    ]) {
      const button = screen.getByRole<HTMLButtonElement>("button", { name });
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("data-unavailable-reason")).toContain(
        "편집용 이미지 복사본을 자동",
      );
    }
  });

  it("always leaves an armed raster-retouch tool clickable for a direct exit", () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly overrides: Partial<RailProps>;
      readonly handler: (props: RailProps) => ReturnType<typeof vi.fn>;
    }> = [
      {
        name: "자르기 (C)",
        overrides: { cropActive: true },
        handler: (props) => props.stableHandlers.openSelectedLayerCrop as ReturnType<typeof vi.fn>,
      },
      {
        name: "색 밀어 섞기 · 스머지 (N)",
        overrides: { smudgeActive: true },
        handler: (props) => props.stableHandlers.toggleSmudgeTool as ReturnType<typeof vi.fn>,
      },
      {
        name: "물감 섞어 칠하기 · 혼색 (⇧·N)",
        overrides: { wetMixActive: true },
        handler: (props) => props.stableHandlers.toggleWetMixTool as ReturnType<typeof vi.fn>,
      },
      {
        name: "밝기·채도 붓 · 닷지·번 (O)",
        overrides: { dodgeBurnActive: true },
        handler: (props) => props.stableHandlers.toggleDodgeBurnTool as ReturnType<typeof vi.fn>,
      },
      {
        name: "형태 밀어 변형 · 리퀴파이 (J)",
        overrides: { liquifyActive: true },
        handler: (props) => props.stableHandlers.toggleLiquifyTool as ReturnType<typeof vi.fn>,
      },
    ];

    for (const testCase of cases) {
      const props = createProps({
        activeSurfaceReviewLocked: true,
        pixelToolTargetAvailable: false,
        rasterRetouchTargetAvailable: false,
        ...testCase.overrides,
      });
      const view = render(<StudioLeftToolRail {...props} />);
      const button = screen.getByRole<HTMLButtonElement>("button", {
        name: testCase.name,
      });
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("data-unavailable-reason")).toBeNull();
      fireEvent.click(button);
      expect(testCase.handler(props)).toHaveBeenCalledOnce();
      view.unmount();
    }
  });

  it("prewarms raster workers from pointer, touch and keyboard intent", () => {
    render(<StudioLeftToolRail {...createProps()} />);
    const smudge = screen.getByRole("button", { name: "색 밀어 섞기 · 스머지 (N)" });
    const liquify = screen.getByRole("button", { name: "형태 밀어 변형 · 리퀴파이 (J)" });

    fireEvent.pointerEnter(smudge);
    fireEvent.pointerDown(smudge);
    fireEvent.focus(smudge);
    fireEvent.pointerEnter(liquify);

    expect(preloadRasterRetouchRuntime).toHaveBeenCalledTimes(4);
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(1);
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(2);
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(3);
    expect(preloadRasterRetouchRuntime).toHaveBeenNthCalledWith(4, { liquify: true });
  });

  it("shows one primary pointer tool while selection and draw subtools are armed", () => {
    const view = render(
      <StudioLeftToolRail
        {...createProps({
          pixelTool: "rect",
          selected: IMAGE,
          tool: "select",
        })}
      />
    );

    expect(screen.getByRole("button", { name: "선택 (V)" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(
      screen.getByRole("button", { name: "사각 선택 (M)" }).getAttribute("aria-pressed")
    ).toBe("true");

    view.rerender(
      <StudioLeftToolRail
        {...createProps({
          advancedFillActive: true,
          selected: IMAGE,
          tool: "select",
        })}
      />
    );
    expect(screen.getByRole("button", { name: "선택 (V)" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(screen.getByRole("button", { name: "채우기 (G)" }).getAttribute("aria-pressed")).toBe(
      "true"
    );

    view.rerender(
      <StudioLeftToolRail
        {...createProps({
          eyedropperActive: true,
          selected: IMAGE,
          tool: "draw",
          drawMode: "pen",
        })}
      />
    );
    expect(screen.getByRole("button", { name: "펜 (B)" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(
      screen.getByRole("button", { name: "스포이드 (I / Alt+클릭)" }).getAttribute("aria-pressed")
    ).toBe("true");

    view.rerender(
      <StudioLeftToolRail
        {...createProps({
          selected: IMAGE,
          smudgeActive: true,
          tool: "select",
        })}
      />
    );
    expect(screen.getByRole("button", { name: "선택 (V)" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(
      screen.getByRole("button", { name: "색 밀어 섞기 · 스머지 (N)" }).getAttribute("aria-pressed")
    ).toBe("true");

    view.rerender(
      <StudioLeftToolRail
        {...createProps({
          commentPinArmed: true,
          selected: IMAGE,
          tool: "select",
        })}
      />
    );
    expect(screen.getByRole("button", { name: "선택 (V)" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(
      screen.getByRole("button", { name: "댓글 핀 배치 취소" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("gives the eyedropper exclusive pointer ownership and still allows a direct exit", () => {
    const activating = createProps({ advancedFillActive: true });
    const view = render(<StudioLeftToolRail {...activating} />);

    fireEvent.click(screen.getByRole("button", { name: "스포이드 (I / Alt+클릭)" }));
    expect(activating.stableHandlers.disarmAllPixelTools).toHaveBeenCalledOnce();
    expect(activating.setEyedropperActive).toHaveBeenCalledWith(true);
    expect(activating.setMenu).toHaveBeenCalledWith(null);

    const exiting = createProps({
      eyedropperActive: true,
      stableHandlers: activating.stableHandlers,
      setEyedropperActive: activating.setEyedropperActive,
    });
    view.rerender(<StudioLeftToolRail {...exiting} />);
    fireEvent.click(screen.getByRole("button", { name: "스포이드 (I / Alt+클릭)" }));
    expect(activating.stableHandlers.disarmAllPixelTools).toHaveBeenCalledOnce();
    expect(activating.setEyedropperActive).toHaveBeenLastCalledWith(false);
  });

  it("keeps remapped and unbound view shortcut labels synchronized with app settings", () => {
    const appSettings = defaultStudioAppSettings();
    appSettings.shortcuts = {
      ...appSettings.shortcuts,
      "tool-zoom": "Shift+Z",
      "tool-rotate-view": "",
    };

    render(<StudioLeftToolRail {...createProps({ appSettings })} />);

    expect(screen.getByRole("button", { name: "보기 확대·축소 (⇧·Z)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "보기 회전" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "보기 회전 (R)" })).toBeNull();
  });

  it("previews opening and closing each view HUD instead of implying a direct canvas transform", () => {
    const base = createProps();
    const view = render(<StudioLeftToolRail {...base} />);

    const closedZoom = screen.getByRole("button", { name: "보기 확대·축소 (Z)" });
    expect(closedZoom.getAttribute("aria-expanded")).toBe("false");
    expect(closedZoom.getAttribute("aria-controls")).toBe("studio-view-tools-hud-zoom");
    expect(closedZoom.getAttribute("data-hint-preview")).toBe("view-hud");
    expect(closedZoom.getAttribute("data-hint-preview-variant")).toBe("zoom-open");
    expect(closedZoom.getAttribute("data-hint-description")).toContain("HUD를 열어");
    const closedRotate = screen.getByRole("button", { name: "보기 회전 (R)" });
    expect(closedRotate.getAttribute("data-hint-preview")).toBe("view-hud");
    expect(closedRotate.getAttribute("data-hint-preview-variant")).toBe("rotate-open");

    view.rerender(<StudioLeftToolRail {...createProps({ viewTool: "zoom" })} />);
    const openZoom = screen.getByRole("button", { name: "확대·축소 HUD 닫기 (Z)" });
    expect(openZoom.getAttribute("aria-expanded")).toBe("true");
    expect(openZoom.getAttribute("data-hint-preview")).toBe("view-hud");
    expect(openZoom.getAttribute("data-hint-preview-variant")).toBe("zoom-close");
    expect(openZoom.getAttribute("data-hint-description")).toContain("HUD를 닫고");

    view.rerender(<StudioLeftToolRail {...createProps({ viewTool: "rotate" })} />);
    const openRotate = screen.getByRole("button", { name: "회전 HUD 닫기 (R)" });
    expect(openRotate.getAttribute("aria-expanded")).toBe("true");
    expect(openRotate.getAttribute("aria-controls")).toBe("studio-view-tools-hud-rotate");
    expect(openRotate.getAttribute("data-hint-preview")).toBe("view-hud");
    expect(openRotate.getAttribute("data-hint-preview-variant")).toBe("rotate-close");
    expect(openRotate.getAttribute("data-hint-description")).toContain("회전 HUD를 닫고");
  });

  it("activates perspective as a usable pen workflow instead of preserving an eraser or pixel gesture", () => {
    const props = createProps({ drawMode: "eraser", tool: "draw" });
    render(<StudioLeftToolRail {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "투시도" }));

    expect(props.setPerspectiveRulerActive).toHaveBeenCalledWith(true);
    // 획 취소·disarm(스포이드 해제 포함)은 전이 함수가 단독으로 책임진다.
    expect(props.stableHandlers.activatePrimaryCanvasTool).toHaveBeenCalledExactlyOnceWith(
      "draw",
      "pen",
    );
    expect(props.stableHandlers.disarmAllPixelTools).not.toHaveBeenCalled();
    expect(props.stableHandlers.returnToSelectTool).not.toHaveBeenCalled();
    expect(props.stableHandlers.announceDrawingShortcut).toHaveBeenCalledWith(
      "투시도 켜짐 · 소실점 방향으로 펜 선을 맞춰요",
    );
    expect(props.setMenu).toHaveBeenCalledWith(null);
  });

  it("cycles free lasso to polygon lasso to off with labels that describe the real next action", () => {
    const base = createProps({ selected: IMAGE });
    const view = render(<StudioLeftToolRail {...base} />);

    const inactiveLasso = screen.getByRole("button", { name: "올가미 선택" });
    expect(inactiveLasso.getAttribute("data-hint-preview")).toBe("lasso");
    expect(inactiveLasso.getAttribute("data-hint-description")).toContain("자유 곡선");
    fireEvent.click(inactiveLasso);
    expect(base.setPixelTool).toHaveBeenCalledWith("lasso");
    expect(base.stableHandlers.disarmAllPixelTools).toHaveBeenCalledOnce();

    const free = createProps({
      selected: IMAGE,
      pixelTool: "lasso",
      setPixelTool: base.setPixelTool,
      stableHandlers: base.stableHandlers,
    });
    view.rerender(<StudioLeftToolRail {...free} />);
    const freeLasso = screen.getByRole("button", {
      name: "자유 올가미 · 다시 누르면 다각형 올가미",
    });
    expect(freeLasso.getAttribute("data-hint-preview")).toBe("polygon-lasso");
    expect(freeLasso.getAttribute("data-hint-preview-variant")).toBeNull();
    expect(freeLasso.getAttribute("data-hint-description")).toContain("다각형 올가미로 전환");
    fireEvent.click(freeLasso);
    expect(base.setPixelTool).toHaveBeenCalledWith("poly-lasso");

    const polygon = createProps({
      selected: IMAGE,
      pixelTool: "poly-lasso",
      setPixelTool: base.setPixelTool,
      stableHandlers: base.stableHandlers,
    });
    view.rerender(<StudioLeftToolRail {...polygon} />);
    const polygonLasso = screen.getByRole("button", {
      name: "다각형 올가미 · 다시 누르면 끄기",
    });
    expect(polygonLasso.getAttribute("data-hint-preview")).toBe("dismiss");
    expect(polygonLasso.getAttribute("data-hint-description")).toContain("선택 도구를 끕니다");
    fireEvent.click(polygonLasso);
    expect(base.setPixelTool).toHaveBeenCalledWith(null);
  });

  it("exposes review and element locks before mutation buttons can silently no-op", () => {
    const props = createProps({
      activeSurfaceReviewLocked: true,
      pixelSel: USABLE_SELECTION,
      // StudioPage 파생식과 동일: 검토 잠금이거나 선택 이미지가 잠기면 대상 확보 불가.
      pixelToolTargetAvailable: false,
      selected: IMAGE,
      selectedImageMutationLocked: true,
    });
    render(<StudioLeftToolRail {...props} />);

    for (const name of [
      "펜 (B)",
      "픽셀 펜 (P)",
      "지우개 (E)",
      "올가미 채우기",
      "투시도",
      "스마트 도형 켜기",
      "사각형 도형",
      "타원 도형",
      "텍스트 추가",
      "말풍선 추가",
      "변형 (⇧T)",
      "자르기 (C)",
      "프레임 애니메이션",
    ]) {
      expect(screen.getByRole<HTMLButtonElement>("button", { name }).disabled).toBe(true);
    }
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "이미지 추가" }).disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="file"][accept]')?.disabled).toBe(true);
  });

  it("keeps toolbar settings outside the independently scrolling tool list", () => {
    render(<StudioLeftToolRail {...createProps()} />);

    const rail = screen.getByRole("toolbar", { name: "그리기 도구" });
    const scrollRegion = rail.querySelector('[data-studio-tool-rail-scroll="true"]');
    const footer = rail.querySelector('[data-studio-tool-rail-footer="true"]');
    const settings = screen.getByRole("button", { name: "더보기 · 툴바 설정" });

    expect(scrollRegion).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(scrollRegion?.contains(settings)).toBe(false);
    expect(footer?.contains(settings)).toBe(true);
  });

  it("ports the More dialog to the body and restores focus after choosing a hidden tool", () => {
    stubAnimationFrame();
    const props = createProps({
      appSettings: hiddenToolSettings(),
      isRailToolVisible: (id) => id === "select",
      railMoreOpen: true,
    });

    render(<StudioLeftToolRail {...props} />);

    const dialog = screen.getByRole("dialog", { name: "숨긴 도구" });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("overflow-y-auto");

    fireEvent.click(screen.getByRole("button", { name: "핸드(팬)" }));

    expect(props.stableHandlers.commitAppSettings).toHaveBeenCalledWith({
      ...props.appSettings,
      toolbar: { visibleIds: ["select", "hand"] },
    });
    expect(props.setRailMoreOpen).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "더보기 · 툴바 설정" })
    );
  });

  it("opens the toolbar settings tab while preserving the More trigger as modal return focus", () => {
    stubAnimationFrame();
    const props = createProps({
      appSettings: hiddenToolSettings(),
      isRailToolVisible: (id) => id === "select",
      railMoreOpen: true,
    });

    render(<StudioLeftToolRail {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "애플리케이션 설정" }));

    expect(props.setRailMoreOpen).toHaveBeenCalledWith(false);
    expect(props.setAppSettingsInitialTab).toHaveBeenCalledWith("toolbar");
    expect(props.setAppSettingsOpen).toHaveBeenCalledWith(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "더보기 · 툴바 설정" })
    );
  });

  it("closes More with Escape or an outside pointer without trapping the canvas chrome", () => {
    stubAnimationFrame();
    const escapeProps = createProps({
      appSettings: hiddenToolSettings(),
      isRailToolVisible: (id) => id === "select",
      railMoreOpen: true,
    });
    const view = render(<StudioLeftToolRail {...escapeProps} />);

    fireEvent.keyDown(screen.getByRole("dialog", { name: "숨긴 도구" }), { key: "Escape" });
    expect(escapeProps.setRailMoreOpen).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "더보기 · 툴바 설정" })
    );

    const outsideProps = createProps({
      appSettings: hiddenToolSettings(),
      isRailToolVisible: (id) => id === "select",
      railMoreOpen: true,
    });
    view.rerender(<StudioLeftToolRail {...outsideProps} />);
    fireEvent.pointerDown(document.body);

    expect(outsideProps.setRailMoreOpen).toHaveBeenCalledWith(false);
  });

  it("renders the live tool belt in STUDIO_CHROME_RAIL_TOOL_GROUPS order", async () => {
    const { STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER } = await import("./studio-chrome-ia-map");
    render(<StudioLeftToolRail {...createProps()} />);
    const rail = screen.getByRole("toolbar", { name: "그리기 도구" });
    const scroll = rail.querySelector('[data-studio-tool-rail-scroll="true"]');
    expect(scroll).not.toBeNull();
    const liveIds = Array.from(
      scroll!.querySelectorAll<HTMLElement>("[data-studio-rail-tool-id]"),
    ).map((node) => node.getAttribute("data-studio-rail-tool-id"));
    expect(liveIds).toEqual([...STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER]);
    // Draw tools before marquee/transform; view tools after 3D/reference.
    expect(liveIds.indexOf("pen")).toBeLessThan(liveIds.indexOf("marquee-rect"));
    expect(liveIds.indexOf("marquee-rect")).toBeLessThan(liveIds.indexOf("transform"));
    expect(liveIds.indexOf("vrm3d")).toBeLessThan(liveIds.indexOf("zoom"));
  });

  it("labels rail group dividers from the chrome IA map (CSP scannable groups)", async () => {
    const { STUDIO_CHROME_RAIL_TOOL_GROUPS } = await import("./studio-chrome-ia-map");
    render(<StudioLeftToolRail {...createProps()} />);
    for (const group of STUDIO_CHROME_RAIL_TOOL_GROUPS) {
      const divider = document.querySelector(
        `[data-studio-rail-group-divider="${group.id}"]`,
      );
      expect(divider, `missing divider for ${group.id}`).not.toBeNull();
      expect(divider!.getAttribute("data-studio-rail-group-label")).toBe(group.labelKo);
    }
  });

  it("reveals draw properties when a rail draw tool is picked", () => {
    const props = createProps();
    render(<StudioLeftToolRail {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "펜 (B)" }));
    expect(props.stableHandlers.activatePrimaryCanvasTool).toHaveBeenCalledWith("draw", "pen");
    expect(props.stableHandlers.revealDrawToolProperties).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "지우개 (E)" }));
    expect(props.stableHandlers.activatePrimaryCanvasTool).toHaveBeenCalledWith("draw", "eraser");
    expect(props.stableHandlers.revealDrawToolProperties).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "사각형 도형" }));
    expect(props.stableHandlers.activatePrimaryCanvasTool).toHaveBeenCalledWith("draw", "shape");
    expect(props.setDrawShape).toHaveBeenCalledWith("rect");
    expect(props.stableHandlers.revealDrawToolProperties).toHaveBeenCalledTimes(3);
  });

  it("offers free transform (not marquee recovery) when a stroke layer is selected", () => {
    const stroke = {
      id: "draw-1",
      type: "draw",
      mode: "pen",
      points: [10, 10, 80, 60],
      strokeWidth: 4,
      stroke: "#111",
      opacity: 1,
    } as El;
    const props = createProps({ selected: stroke });
    render(<StudioLeftToolRail {...props} />);
    const transform = screen.getByRole("button", { name: "변형 (⇧T)" });
    expect(transform.hasAttribute("disabled")).toBe(false);
    fireEvent.click(transform);
    expect(props.stableHandlers.openPixelSelectionTransform).toHaveBeenCalledOnce();
    expect(props.stableHandlers.onRequestPixelSelection).not.toHaveBeenCalled();
  });

  it("arms select tool instead of pixel marquee when nothing is selected on a vector page", () => {
    const props = createProps({
      selected: null,
      pixelToolTargetAvailable: false,
      rasterRetouchTargetAvailable: false,
    });
    render(<StudioLeftToolRail {...props} />);
    const transform = screen.getByRole("button", { name: "선택 후 변형" });
    fireEvent.click(transform);
    expect(props.stableHandlers.returnToSelectTool).toHaveBeenCalledOnce();
    expect(props.stableHandlers.announceDrawingShortcut).toHaveBeenCalled();
    expect(props.stableHandlers.onRequestPixelSelection).not.toHaveBeenCalled();
    expect(props.stableHandlers.openPixelSelectionTransform).not.toHaveBeenCalled();
  });
});
