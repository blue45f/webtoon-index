import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "../bg3d/read-studio-bg3d-editor-source";
import { readStudioVrmPoserImplementationSource } from "../vrm/studio-vrm-poser-implementation-source";


const backgroundSource = readStudioBg3dEditorSource();
const vrmSource = [
  readFileSync(new URL("../vrm/StudioVrmPoserTypes.ts", import.meta.url), "utf8"),
  readStudioVrmPoserImplementationSource(
    new URL("../vrm/studio-vrm-poser-implementation-source.ts", import.meta.url),
  ),
].join("\n");

function sliceBetween(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectPreviewVariant(source: string, preview: string, variant: string): void {
  expect(source).toMatch(new RegExp(`preview: "${preview}",\\s+previewVariant: "${variant}"`, "u"));
}

describe("Studio 3D viewport Motion Coach integration", () => {
  it("gives every background viewport action an explicit stable semantic ID", () => {
    for (const id of [
      "bg3d:transform:translate",
      "bg3d:transform:rotate",
      "bg3d:transform:scale",
      "bg3d:view:quad",
      "bg3d:history:undo",
      "bg3d:history:redo",
      "bg3d:transform:snap",
      "bg3d:object:ground",
      "bg3d:object:origin-ground",
      "bg3d:object:surface-snap",
      "bg3d:camera:focus-selection",
      "bg3d:camera:zoom-in",
      "bg3d:camera:zoom-out",
      "bg3d:camera:reset",
      "bg3d:view:line-preview",
    ]) {
      expect(backgroundSource).toContain(`id: "${id}"`);
    }

    expect(backgroundSource).toContain('preview: "object-translate"');
    expect(backgroundSource).toContain('preview: "object-rotate"');
    expect(backgroundSource).toContain('preview: "object-scale"');
    expect(backgroundSource).toContain('preview: "object-ground"');
    expect(backgroundSource).toContain('preview: "camera-zoom"');
    expect(backgroundSource).toContain('preview: "camera-reset"');
    expect(backgroundSource).toContain('preview: "quad-view"');
    expect(backgroundSource).toContain('preview: "line-art"');
    expect(backgroundSource).toContain('preview: "undo"');
    expect(backgroundSource).toContain('preview: "redo"');
  });

  it("replaces native background toolbar titles and explains unavailable actions", () => {
    const toolbar = sliceBetween(
      backgroundSource,
      '"absolute left-2 top-2 z-10 grid grid-cols-3 gap-1.5 sm:left-2.5 sm:top-2.5 sm:flex sm:flex-col"',
      // Marks the drag-hint block that follows the toolbar. The trailing `?` is deliberately not
      // part of the token: the hint's guard gains clauses (it is now also suppressed while the
      // scene is empty), and this slice is about where the toolbar ends, not how the hint is gated.
      "{!immersiveSceneActive && !physicsInteractionLocked && !viewportHinted"
    );

    expect(toolbar).toContain("<StudioToolHintTarget");
    expect(toolbar).not.toContain("title=");
    expect(toolbar).toContain('unavailableReason={!canUndo ? "되돌릴 3D 장면 변경이 없습니다."');
    expect(toolbar).toContain('unavailableReason={!canRedo ? "다시 적용할 3D 장면 변경이 없습니다."');
    expect(toolbar).toContain("disabled={Boolean(groundSelectionDisabledReason)}");
    expect(toolbar).toContain("disabled={Boolean(focusSelectionDisabledReason)}");
    expect(backgroundSource).toContain('"화면에 맞출 객체를 하나만 선택해 주세요."');
    expect(backgroundSource).toContain('"선택한 객체의 잠금을 해제하세요."');
  });

  it("keeps both viewport tool groups inside short mobile canvases", () => {
    expect(backgroundSource).toContain(
      '"absolute left-2 top-2 z-10 grid grid-cols-3 gap-1.5 sm:left-2.5 sm:top-2.5 sm:flex sm:flex-col"'
    );
    expect(backgroundSource).toContain(
      'className="col-span-3 grid grid-cols-3 gap-1 rounded-lg border border-line/70 bg-panel/80 p-1 shadow-sm backdrop-blur sm:flex sm:flex-col"'
    );
    expect(backgroundSource).toContain(
      '"absolute right-2 top-2 z-10 grid grid-cols-2 gap-1.5 sm:right-2.5 sm:top-2.5 sm:flex sm:flex-col"'
    );
    expect(backgroundSource.match(/immersiveSceneActive && "hidden"/gu)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });

  it("grounds every unlocked member of a mixed multi-selection", () => {
    expect(backgroundSource).toContain(
      "const canGroundSelection = selectedEntities.some((entity) => !isBgObjectTransformBlocked(entity));"
    );
    expect(backgroundSource).toContain("const groundSelectionDisabledReason =");
    expect(backgroundSource).toContain("disabled={Boolean(groundSelectionDisabledReason)}");
    expect(backgroundSource).toContain("unavailableReason={groundSelectionDisabledReason}");
  });

  it("preserves the live snap interval, angle, and axis summary in the coach", () => {
    expect(backgroundSource).toContain(
      "const snapSettingsSummary = studioBg3dSnapSettingsSummary(snapSettings);"
    );
    expect(backgroundSource).toContain("현재 설정: ${snapSettingsSummary}.");
    expect(backgroundSource).toContain("· ${snapSettingsSummary}");
  });

  it("previews the next background toggle action instead of the current state", () => {
    const idleHints = sliceBetween(
      backgroundSource,
      "const BG3D_VIEWPORT_HINTS =",
      "const ADD_BUTTONS:"
    );
    const statefulHints = sliceBetween(
      backgroundSource,
      "const quadViewHint: StudioToolHintSpec = isQuadView",
      "const layerListItems: StudioBg3dLayerListItem[]"
    );
    expect(backgroundSource).toContain("const quadViewHint: StudioToolHintSpec = isQuadView");
    expect(backgroundSource).toContain('title: "단일 뷰로 복귀"');
    expectPreviewVariant(idleHints, "quad-view", "open");
    expectPreviewVariant(statefulHints, "quad-view", "close");
    expect(backgroundSource).toContain("const snapToggleHint: StudioToolHintSpec = snapSettings.enabled");
    expect(backgroundSource).toContain('title: "변형 스냅 끄기"');
    expectPreviewVariant(idleHints, "object-snap", "enable");
    expectPreviewVariant(statefulHints, "object-snap", "disable");
    expect(backgroundSource).toContain("const lineArtPreviewHint: StudioToolHintSpec = lineArtPreview");
    expect(backgroundSource).toContain('title: "선화 미리보기 끄기"');
    expectPreviewVariant(idleHints, "line-art", "enable");
    expectPreviewVariant(statefulHints, "line-art", "disable");
    expect(statefulHints).not.toContain('preview: "dismiss"');
    expect(backgroundSource).toContain('aria-label={isQuadView ? "단일 뷰로 복귀" : "4분할 뷰 열기"}');
    expect(backgroundSource).toContain(
      'aria-label={lineArtPreview ? "선화 미리보기 끄기" : "선화 미리보기 켜기"}'
    );
  });

  it("gives the VRM viewport history and camera controls their own coach actions", () => {
    for (const id of [
      "vrm:history:undo",
      "vrm:history:redo",
      "vrm:camera:zoom-in",
      "vrm:camera:zoom-out",
      "vrm:camera:reset",
      "vrm:camera:turntable",
    ]) {
      expect(vrmSource).toContain(`id: "${id}"`);
    }

    expect(vrmSource).toContain('preview: "camera-zoom"');
    expect(vrmSource).toContain('preview: "camera-reset"');
    expect(vrmSource).toContain('preview: "camera-orbit"');

    const toolbar = sliceBetween(
      vrmSource,
      '<div className="absolute left-2.5 top-2.5 z-10 flex flex-col gap-1.5">',
      "{texturePaintModeSelected || !viewportHinted ?"
    );
    expect(toolbar).toContain("VRM_VIEWPORT_HINTS.undo");
    expect(toolbar).toContain("hint={turntableHint}");
    expect(toolbar).not.toContain("title=");
    expect(toolbar).toContain('!viewportCanUndo');
    expect(toolbar).toContain('"표면 페인트 획을 마친 뒤 실행 취소할 수 있습니다."');
    expect(toolbar).toContain('"되돌릴 캐릭터 변경이 없습니다."');
    expect(toolbar).toContain('!viewportCanRedo');
    expect(toolbar).toContain('"표면 페인트 획을 마친 뒤 다시 실행할 수 있습니다."');
    expect(toolbar).toContain('"다시 적용할 캐릭터 변경이 없습니다."');
  });

  it("switches the active turntable coach to the stop action", () => {
    const idleHints = sliceBetween(vrmSource, "const VRM_VIEWPORT_HINTS =", "const HEX_COLOR_PATTERN");
    const activeHint = sliceBetween(
      vrmSource,
      "const turntableHint: StudioToolHintSpec = turntable",
      "const [viewResetNonce"
    );
    expect(vrmSource).toContain("const turntableHint: StudioToolHintSpec = turntable");
    expect(vrmSource).toContain('title: "턴테이블 회전 중지"');
    expectPreviewVariant(idleHints, "camera-orbit", "start");
    expectPreviewVariant(activeHint, "camera-orbit", "stop");
    expect(activeHint).not.toContain('preview: "timeline"');
    expect(vrmSource).toContain(
      'aria-label={turntable ? "턴테이블 회전 중지" : "턴테이블 회전 시작"}'
    );
  });
});
