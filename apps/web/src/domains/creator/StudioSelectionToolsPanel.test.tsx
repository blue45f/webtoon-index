import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { emptyPixelSelection } from "./studio-selection-tools";
import { StudioSelectionToolsPanel } from "./StudioSelectionToolsPanel";

import type { StudioToolHintSpec } from "./studio-tool-hints";
import type { ReactNode } from "react";

vi.mock("./StudioToolHint", () => ({
  StudioToolHintTarget: ({
    hint,
    children,
    className,
    disabled,
    unavailableReason,
  }: {
    hint: StudioToolHintSpec;
    children: ReactNode;
    className?: string;
    disabled?: boolean;
    unavailableReason?: string;
  }) => (
    <span
      className={className}
      data-hint-id={hint.id}
      data-preview-kind={hint.preview}
      data-preview-variant={hint.previewVariant}
      data-hint-disabled={disabled ? "true" : undefined}
      data-unavailable-reason={unavailableReason}
    >
      {children}
    </span>
  ),
}));

const componentSource = readFileSync(
  new URL("./StudioSelectionToolsPanel.tsx", import.meta.url),
  "utf8"
);

const selection = {
  ...emptyPixelSelection(),
  subpaths: [{
    mode: "add" as const,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.5, y: 0.8 },
    ],
  }],
};

function renderPanel(overrides: Partial<Parameters<typeof StudioSelectionToolsPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <StudioSelectionToolsPanel
      selection={selection}
      activeTool="lasso"
      combineMode="add"
      onPickTool={vi.fn()}
      onCombineModeChange={vi.fn()}
      onBrushRadiusChange={vi.fn()}
      onFeatherChange={vi.fn()}
      onToggleInvert={vi.fn()}
      canUndoSelection
      canRedoSelection={false}
      onUndoSelection={vi.fn()}
      onRedoSelection={vi.fn()}
      onUndoSubpath={vi.fn()}
      onClearSelection={vi.fn()}
      onSelectAll={vi.fn()}
      onExpand={vi.fn()}
      onContract={vi.fn()}
      onRotate={vi.fn()}
      onFlip={vi.fn()}
      onTranslate={vi.fn()}
      onScale={vi.fn()}
      onContentTransform={vi.fn()}
      onApplyAdjust={vi.fn()}
      onContentAwareFill={vi.fn()}
      onCopyToNewLayer={vi.fn()}
      onCutToNewLayer={vi.fn()}
      {...overrides}
    />
  );
}

function openingButtonForAriaLabel(html: string, ariaLabel: string): string {
  const labelIndex = html.indexOf(`aria-label="${ariaLabel}"`);
  if (labelIndex < 0) return "";
  const start = html.lastIndexOf("<button", labelIndex);
  const end = html.indexOf(">", labelIndex);
  return html.slice(start, end + 1);
}

describe("StudioSelectionToolsPanel", () => {
  it("labels subpath removal independently from document undo", () => {
    const html = renderPanel();

    expect(html).toContain('aria-label="마지막 선택 영역 제거"');
    expect(html).toContain("마지막 영역 제거");
    expect(html).toContain('aria-label="선택 작업 실행 취소"');
    expect(html).toContain('aria-label="선택 작업 다시 실행"');
    expect(html).toContain("선택 기록");
    expect(html).not.toContain(">되돌리기<");
  });

  it("routes every advanced pixel-selection action to an explicit rich preview", () => {
    const html = renderPanel();
    const expectedMappings = [
      ["selection-boundary", "select-all"],
      ["selection-boundary", "clear"],
      ["selection-boundary", "invert"],
      ["selection-boundary", "remove-last-subpath"],
      ["selection-boundary", "expand"],
      ["selection-boundary", "contract"],
      ["selection-history", "undo"],
      ["selection-history", "redo"],
      ["selection-marquee-transform", "rotate-custom"],
      ["selection-marquee-transform", "rotate-cw-90"],
      ["selection-marquee-transform", "rotate-ccw-90"],
      ["selection-marquee-transform", "rotate-180"],
      ["selection-marquee-transform", "flip-x"],
      ["selection-marquee-transform", "flip-y"],
      ["selection-marquee-transform", "translate-left"],
      ["selection-marquee-transform", "translate-right"],
      ["selection-marquee-transform", "translate-up"],
      ["selection-marquee-transform", "translate-down"],
      ["selection-marquee-transform", "scale-up"],
      ["selection-marquee-transform", "scale-down"],
      ["selection-content-transform", "apply-scale-rotate"],
      ["selection-content-transform", "rotate-cw-90"],
      ["selection-content-transform", "flip-x"],
      ["selection-content-transform", "flip-y"],
      ["selection-content-transform", "delete"],
      ["selection-content-transform", "content-aware-fill"],
      ["selection-adjust", "brightness"],
      ["selection-adjust", "hue"],
    ] as const;

    for (const [kind, variant] of expectedMappings) {
      expect(html).toContain(
        `data-preview-kind="${kind}" data-preview-variant="${variant}"`
      );
    }

    const buttonCount = html.match(/<button\b/gu)?.length ?? 0;
    const richHintTargetCount = html.match(/data-hint-id=/gu)?.length ?? 0;
    // 의도적 변경(2026-07-29): 임시 modifier와 같은 "새 선택" 작업을 명시해 4상태 UI로 통일(38 → 39).
    expect(buttonCount).toBe(39);
    expect(richHintTargetCount).toBe(buttonCount);
  });

  it("removes native title duplication and explains unavailable action states", () => {
    expect(componentSource).not.toMatch(/\btitle=/u);

    const noSelectionHtml = renderPanel({
      selection: null,
      canUndoSelection: false,
      canRedoSelection: false,
    });
    expect(noSelectionHtml).toContain('data-unavailable-reason="먼저 이미지에서 픽셀 영역을 선택하세요."');
    expect(noSelectionHtml).toContain('data-unavailable-reason="해제할 선택 영역이 없습니다."');
    expect(noSelectionHtml).toContain('data-unavailable-reason="되돌릴 선택 작업이 없습니다."');
    expect(noSelectionHtml).toContain('data-unavailable-reason="다시 적용할 선택 작업이 없습니다."');

    const zeroValueHtml = renderPanel();
    expect(zeroValueHtml).toContain('data-unavailable-reason="밝기 값을 0이 아닌 값으로 조절하세요."');
    expect(zeroValueHtml).toContain('data-unavailable-reason="색조 값을 0°가 아닌 값으로 조절하세요."');
  });

  it("disables only boundary transforms for a full-image selection without subpaths", () => {
    const fullImageHtml = renderPanel({
      selection: {
        ...emptyPixelSelection(),
        invert: true,
      },
    });
    const boundaryReason = "전체 이미지 선택에는 변형할 점선 선택 경계가 없습니다.";
    const boundaryHintIds = [
      "pixel-selection-expand",
      "pixel-selection-contract",
      "pixel-selection-marquee-rotate-custom",
      "pixel-selection-marquee-rotate-cw-90",
      "pixel-selection-marquee-rotate-ccw-90",
      "pixel-selection-marquee-rotate-180",
      "pixel-selection-marquee-flip-x",
      "pixel-selection-marquee-flip-y",
      "pixel-selection-marquee-translate-left",
      "pixel-selection-marquee-translate-right",
      "pixel-selection-marquee-translate-up",
      "pixel-selection-marquee-translate-down",
      "pixel-selection-marquee-scale-up",
      "pixel-selection-marquee-scale-down",
    ];

    for (const hintId of boundaryHintIds) {
      expect(fullImageHtml).toMatch(
        new RegExp(
          `data-hint-id="${hintId}"[^>]*data-hint-disabled="true"[^>]*data-unavailable-reason="${boundaryReason}"`,
          "u"
        )
      );
    }

    for (const contentHintId of [
      "pixel-selection-content-apply",
      "pixel-selection-content-rotate-cw-90",
      "pixel-selection-content-flip-x",
      "pixel-selection-content-flip-y",
      "pixel-selection-adjust-brightness",
      "pixel-selection-adjust-hue",
      "pixel-selection-content-delete",
      "pixel-selection-content-aware-fill",
    ]) {
      expect(fullImageHtml).not.toMatch(
        new RegExp(`data-hint-id="${contentHintId}"[^>]*data-unavailable-reason="${boundaryReason}"`, "u")
      );
    }
  });

  it("uses plain Korean copy for the animated selection boundary", () => {
    const html = renderPanel({ selection: null, activeTool: "rect" });

    expect(componentSource).not.toContain("마칭앤츠");
    expect(html).toContain("점선 선택 경계가 영역을 표시합니다.");
  });

  it("keeps selection-only shortcuts in the rich hint copy", () => {
    expect(componentSource).toContain('shortcut: "⌘/Ctrl+A"');
    expect(componentSource).toContain('shortcut: "⌘/Ctrl+D"');
    expect(componentSource).toContain('shortcut: "⌘/Ctrl+⇧+I"');
    expect(componentSource).toContain('shortcut: "⌘/Ctrl+Z"');
    expect(componentSource).toContain('shortcut: "⌘/Ctrl+⇧+Z"');
  });

  it("locks new work while keeping the active selection tool available as an exit", () => {
    const html = renderPanel({ busy: true });
    const busyReason = "다른 픽셀 작업을 적용하는 동안 기다려 주세요.";
    const activeToolHint =
      html.match(/<span[^>]*data-hint-id="pixel-selection-lasso"[^>]*>/u)?.[0] ?? "";
    const activeToolButton = openingButtonForAriaLabel(html, "올가미 종료");
    const inactiveToolButton = openingButtonForAriaLabel(html, "사각형");
    const rangeCount = html.match(/<input[^>]*type="range"[^>]*>/gu)?.length ?? 0;
    const disabledRangeCount =
      html.match(/<input[^>]*type="range"[^>]*disabled=""[^>]*>/gu)?.length ?? 0;

    expect(html).toContain('aria-busy="true"');
    expect(activeToolHint).not.toContain('data-hint-disabled="true"');
    expect(activeToolButton).not.toContain('disabled=""');
    expect(inactiveToolButton).toContain('disabled=""');
    expect(html).toContain("현재 선택 도구는 종료할 수 있습니다.");
    expect(html.match(/data-hint-disabled="true"/gu)?.length).toBe(38);
    expect(html.match(new RegExp(`data-unavailable-reason="${busyReason}"`, "gu"))?.length).toBe(38);
    expect(disabledRangeCount).toBe(rangeCount);
    expect(html).toContain("pointer-coarse:min-h-11");
    expect(html).toContain("pointer-coarse:min-w-11");
  });
});

describe("StudioSelectionToolsPanel — 색상 범위(Color Range)", () => {
  const colorRangeProps = {
    colorRangeSamples: [
      { r: 220, g: 40, b: 40 },
      { r: 40, g: 60, b: 220 },
    ],
    colorRangeFuzziness: 72,
    onColorRangeFuzzinessChange: vi.fn(),
    onColorRangeFuzzinessCommit: vi.fn(),
    onColorRangeTogglePick: vi.fn(),
    onColorRangeTogglePreview: vi.fn(),
    onColorRangeRemoveSample: vi.fn(),
    onColorRangeClearSamples: vi.fn(),
    onColorRangeApply: vi.fn(),
  } as const;

  it("stays hidden (fully backward compatible) when the color-range callbacks are absent", () => {
    const html = renderPanel();
    expect(html).not.toContain("data-studio-color-range");
    expect(html).not.toContain("색상 범위");
    expect(html.match(/<button\b/gu)?.length).toBe(39); // 색상 범위를 제외한 4상태 선택 작업 UI
  });

  it("renders sample chips, armed pick toggle, fuzziness slider, preview toggle, and apply", () => {
    const html = renderPanel(colorRangeProps);

    expect(html).toContain('data-studio-color-range="true"');
    expect(html).toContain("#DC2828"); // 220,40,40 헥사 칩 라벨
    expect(html).toContain("#283CDC"); // 40,60,220
    expect(html).toContain('aria-label="색상 샘플 1 (#DC2828) 제거"');
    expect(html).toContain('aria-label="색상 샘플 모두 지우기"');
    expect(html).toContain('aria-label="캔버스에서 색 추출"');
    expect(html).toContain('aria-label="색상 범위 미리보기"');
    expect(html).toContain('aria-label="색상 범위로 선택"');
    expect(html).toContain("허용량");
    expect(html).toContain(">72<"); // readout
    expect(html).toContain("색상 범위로 선택 (추가)"); // 선택 작업 라벨 반영

    // 모든 버튼은 리치 힌트 타깃과 1:1 — 기본 39개 + 색상 범위 6개(지우기+칩2+추출+미리보기+적용).
    const buttonCount = html.match(/<button\b/gu)?.length ?? 0;
    const hintTargetCount = html.match(/data-hint-id=/gu)?.length ?? 0;
    expect(buttonCount).toBe(45);
    expect(hintTargetCount).toBe(buttonCount);
  });

  it("mirrors the armed pick state from props (page-owned, fully controlled)", () => {
    const armed = renderPanel({ ...colorRangeProps, colorRangePickArmed: true });
    expect(armed).toMatch(/aria-pressed="true"[^>]*aria-label="캔버스 색 추출 종료"/u);
    expect(armed).toContain("이미지 위를 클릭하면 그 지점의 색이 샘플로 추가됩니다.");

    const disarmed = renderPanel(colorRangeProps);
    expect(disarmed).toMatch(/aria-pressed="false"[^>]*aria-label="캔버스에서 색 추출"/u);
  });

  it("reflects the current combine mode on the apply button", () => {
    const html = renderPanel({ ...colorRangeProps, combineMode: "subtract" });
    expect(html).toContain("색상 범위로 선택 (빼기)");
    expect(html).toMatch(
      /data-hint-id="pixel-selection-color-range-apply"[^>]*data-preview-kind="selection-subtract"/u
    );
  });

  it("explains why apply/preview are unavailable without samples", () => {
    const html = renderPanel({ ...colorRangeProps, colorRangeSamples: [] });
    expect(html).toContain("아직 추출한 색이 없습니다.");
    expect(html).toContain('data-unavailable-reason="먼저 캔버스에서 색을 추출하세요."');
    expect(html).toContain('data-unavailable-reason="지울 색 샘플이 없습니다."');
    expect(html).toMatch(/aria-label="색상 범위로 선택"[^>]*|disabled[^>]*aria-label="색상 범위로 선택"/u);
  });

  it("disables the whole section with the shared busy reason while pixel work runs", () => {
    const html = renderPanel({ ...colorRangeProps, busy: true });
    const busyReason = "다른 픽셀 작업을 적용하는 동안 기다려 주세요.";
    // 활성 올가미 종료 1개만 열어 두고 나머지 44개를 같은 busy 사유로 잠근다.
    expect(html.match(/data-hint-disabled="true"/gu)?.length).toBe(44);
    expect(html.match(new RegExp(`data-unavailable-reason="${busyReason}"`, "gu"))?.length).toBe(44);
  });

  it("keeps armed color-range toggles closable during a busy calculation", () => {
    const html = renderPanel({
      ...colorRangeProps,
      busy: true,
      colorRangePickArmed: true,
      colorRangePreviewEnabled: true,
    });

    expect(openingButtonForAriaLabel(html, "캔버스 색 추출 종료")).not.toContain(
      'disabled=""'
    );
    expect(openingButtonForAriaLabel(html, "색상 범위 미리보기 종료")).not.toContain(
      'disabled=""'
    );
    expect(html).toContain("색 추출 도구는 지금 종료할 수 있습니다.");
  });
});
