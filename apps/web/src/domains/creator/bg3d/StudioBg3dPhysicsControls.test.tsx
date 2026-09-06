import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";
import controlFieldsSource from "./studio-bg3d-control-fields.tsx?raw";
// 2026-08-21 intentional change: describeStudioBg3dPhysicsStatus and its phase copy moved into
// studio-bg3d-editor-derivations.ts during the editor split.
import editorDerivationsSource from "./studio-bg3d-editor-derivations.ts?raw";
import returnFocusSource from "./studio-bg3d-return-focus.ts?raw";
import ltPanelSource from "./StudioBg3dLtPanel.tsx?raw";
import {
  StudioBg3dPhysicsPanel,
  StudioBg3dPhysicsTransport,
} from "./StudioBg3dPhysicsControls";
import physicsControlsSource from "./StudioBg3dPhysicsControls.tsx?raw";
import shapesPanelSource from "./StudioBg3dShapesPanel.tsx?raw";
import viewPanelSource from "./StudioBg3dViewPanelContent.tsx?raw";

const background3dSource = [
  readStudioBg3dEditorSource(),
  editorDerivationsSource,
  shapesPanelSource,
  viewPanelSource,
  ltPanelSource,
  returnFocusSource,
].join("\n");

function renderTransport(phase: "loading" | "paused" | "complete"): string {
  return renderToStaticMarkup(
    <StudioBg3dPhysicsTransport
      phase={phase}
      progress={phase === "complete" ? 1 : 0.5}
      currentSeconds={phase === "complete" ? 4 : 2}
      durationSeconds={4}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onReset={vi.fn()}
      onBake={vi.fn()}
    />,
  );
}

function transportButton(markup: string): string {
  const match = markup.match(
    /<button[^>]*data-testid="bg3d-physics-play-pause"[^>]*>[\s\S]*?<\/button>/u,
  );
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

function sourceSlice(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Studio BG3D physics control quality", () => {
  it("offers an enabled, explicitly labelled replay action after completion", () => {
    const button = transportButton(renderTransport("complete"));

    expect(button).toContain('aria-label="물리 미리보기 처음부터 다시 재생"');
    expect(button).toContain("다시 재생");
    expect(button).not.toMatch(/\sdisabled(?:=""|(?=[ >]))/u);
    expect(background3dSource).toContain(
      'const offset = physicsPhaseRef.current === "complete" ? 0 : physicsPlaybackOffsetRef.current;',
    );
  });

  it("keeps playback unavailable only while results are still loading", () => {
    const loadingButton = transportButton(renderTransport("loading"));
    const pausedButton = transportButton(renderTransport("paused"));

    expect(loadingButton).toMatch(/\sdisabled(?:=""|(?=[ >]))/u);
    expect(pausedButton).not.toMatch(/\sdisabled(?:=""|(?=[ >]))/u);
    expect(pausedButton).toContain('aria-label="물리 미리보기 재생"');
  });

  it("exposes progress without turning frame-rate updates into live announcements", () => {
    const complete = renderTransport("complete");
    const progressbar = complete.match(/<div role="progressbar"[^>]*>/u)?.[0] ?? "";
    const statusOutput = sourceSlice(
      background3dSource,
      'data-testid="bg3d-physics-status"',
      "</output>",
    );

    expect(progressbar).toContain('aria-valuemin="0"');
    expect(progressbar).toContain('aria-valuemax="100"');
    expect(progressbar).toContain('aria-valuenow="100"');
    expect(progressbar).toContain(
      'aria-valuetext="재생 완료 · 4.0초 / 4.0초 · 100퍼센트"',
    );
    expect(statusOutput).toContain("describeStudioBg3dPhysicsStatus(physicsPhase, physicsError)");
    expect(statusOutput).not.toContain("physicsProgress * 100");
    expect(background3dSource).toContain(
      "물리 미리보기 재생이 완료되었습니다. 다시 재생하거나 현재 자세를 적용할 수 있습니다.",
    );
  });

  it("hands focus from the removed start action to the loading transport cancel action", () => {
    const loading = renderTransport("loading");
    const resetButton = loading.match(
      /<button[^>]*data-testid="bg3d-physics-reset"[^>]*>[\s\S]*?<\/button>/u,
    )?.[0] ?? "";

    expect(resetButton).toContain('aria-label="물리 미리보기 계산 취소"');
    expect(background3dSource).toContain("shouldTransferPhysicsFocusRef.current = true;");
    expect(background3dSource).toContain("currentAction.focus({ preventScroll: true });");
    expect(background3dSource).toContain("currentActionRef={physicsTransportActionRef}");
    expect(background3dSource).toContain("startButtonRef={physicsStartButtonRef}");
    expect(physicsControlsSource).toContain(
      'ref={!canControl && phase === "loading" ? currentActionRef : null}',
    );
  });

  it("uses the defined bad token and keeps duration choices touch-sized", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dPhysicsPanel
        selectedCount={1}
        durationSeconds={4}
        gravityPreset="earth"
        groundEnabled
        phase="error"
        progress={0}
        unavailableReason={null}
        errorMessage="물리 미리보기를 시작할 수 없습니다."
        onDurationChange={vi.fn()}
        onGravityPresetChange={vi.fn()}
        onGroundEnabledChange={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(markup).toContain("border-bad/40");
    expect(markup).toContain("text-bad");
    expect(physicsControlsSource).not.toContain("danger");
    expect(markup.match(/pointer-coarse:min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("Studio BG3D modal focus contract", () => {
  it("reuses the shared modal owner for initial focus, trapping, Escape, inert, and focus return", () => {
    expect(background3dSource).toContain("useStudioModalSheet({");
    expect(background3dSource).toContain('activeKey: open ? "studio-bg3d" : null');
    expect(background3dSource).toContain("dialogRef: modalDialogRef");
    expect(background3dSource).toContain("rootRef: modalRootRef");
    expect(background3dSource).toContain(
      "resolveReturnFocus: () => resolveStudioBg3dReturnFocus(modalDialogRef.current)",
    );
    expect(background3dSource).toContain(
      "modalRootRef.current = modalDialogRef.current?.ownerDocument.body ?? null;",
    );
    expect(background3dSource).toContain('button.title === "3D 배경 재편집"');
    expect(background3dSource).toContain('normalizedText(button) === "3D 배경"');
    expect(background3dSource).toContain('data-bg3d-initial-focus="true"');
    expect(background3dSource).toContain("ref={modalDialogRef}");
    expect(background3dSource).toContain('aria-hidden={!open || undefined}');
    expect(background3dSource).toContain('aria-modal={open ? "true" : undefined}');
    expect(background3dSource).toContain("hidden={!open}");
    expect(background3dSource).toContain("inert={!open ? true : undefined}");
    expect(background3dSource).toContain('role={open ? "dialog" : undefined}');
    expect(background3dSource).toContain("tabIndex={-1}");

    // 키보드 핸들러는 공유 모달 오너로 이동했다 — 에디터 소스 어디에도 Escape 처리가 남으면 안 된다.
    expect(background3dSource).not.toContain('e.key === "Escape"');
  });
});

describe("Studio BG3D rig control quality", () => {
  it("keeps new rig, IK, and pose-bake controls touch-sized", () => {
    const start = background3dSource.indexOf("리그 제약");
    const end = background3dSource.indexOf("모델 애니메이션", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const rigControls = background3dSource.slice(start, end);

    expect(rigControls.match(/pointer-coarse:(?:min-h|h)-11/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(9);
    expect(rigControls.match(/touchFriendly/g)?.length ?? 0).toBe(3);
  });

  it("connects every disabled pose-bake action to a concrete visible reason", () => {
    expect(background3dSource).toContain("const selectedRigBakeDisabledReason =");
    expect(background3dSource).toContain(
      'aria-describedby={\n                                selectedRigBakeDisabledReason',
    );
    expect(background3dSource).toContain('id="bg3d-rig-bake-disabled-reason"');
    expect(background3dSource).toContain(
      "물리 미리보기 중에는 포즈로 구울 수 없습니다. 현재 자세를 적용하거나 미리보기를 초기화해 주세요.",
    );
    expect(background3dSource).toContain(
      "모델 리그를 준비하는 중입니다. 준비가 끝나면 포즈로 구울 수 있습니다.",
    );
  });

  it("binds pose, aim, and IK mutations to model-owned canonical selections", () => {
    expect(background3dSource).toContain("resolveStudioBg3dRigSelection({");
    expect(background3dSource).toContain("mutateStudioBg3dPoseOverride({");
    expect(background3dSource).toContain("mutateStudioBg3dAimConstraint({");
    expect(background3dSource).toContain("mutateStudioBg3dTwoBoneIkConstraint({");
    expect(background3dSource).toContain("modelId: selectedCustomModel.id");
    expect(background3dSource).not.toContain(
      "current.aims.filter((aim) => aim.jointKey !== selectedPoseJointKey)",
    );
    expect(background3dSource).not.toContain(
      "if (ik.endJointKey !== selectedIkEndJointKey) return ik;",
    );
  });

  it("shows live animation time without committing mixer ticks into scene history", () => {
    const playheadStart = controlFieldsSource.indexOf("export function BgAnimationPlayhead({");
    expect(playheadStart).toBeGreaterThanOrEqual(0);
    const playheadEffect = controlFieldsSource.slice(playheadStart);

    expect(playheadEffect).toContain("globalThis.setInterval");
    expect(playheadEffect).toContain("setLiveSample");
    expect(playheadEffect).not.toContain("setCustomModels");
    expect(playheadEffect).not.toContain("commitImmediateHistoryTransition");
    expect(playheadEffect).toContain("value={displayTime}");
    expect(background3dSource).toContain('active={open && activePanelTab === "models"}');
    expect(controlFieldsSource).toContain("현재 애니메이션 시간");
    expect(background3dSource).toContain("createStudioBg3dRigPoseBakeHistoryTransition(");
    expect(background3dSource).toContain("customModels: beforeCustomModels");
  });
});

describe("Studio BG3D physics transaction boundary", () => {
  it("rejects stale Worker and bake results against the exact editor source token", () => {
    expect(background3dSource).toContain("createStudioBg3dPhysicsSessionSourceToken({");
    expect(background3dSource.match(/isStudioBg3dPhysicsSessionSourceCurrent\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
    expect(background3dSource).toContain("readonly sourceToken: string;");
    expect(background3dSource).toContain("sourceToken,");
    expect(background3dSource).toContain(
      "물리 계산 중 장면이 변경되어 오래된 결과를 폐기했습니다. 다시 실행해 주세요.",
    );
    expect(background3dSource).toContain(
      "물리 미리보기 시작 뒤 장면이 변경되어 현재 자세를 적용하지 않았습니다.",
    );
  });

  it("fails closed when any visible deforming model would have a stale static collider", () => {
    expect(background3dSource).toContain("const unsupportedVisibleModel = customModels.find");
    expect(background3dSource).toContain("model.animation !== undefined");
    expect(background3dSource).toContain("(cacheEntry?.metrics.skins ?? 0) > 0");
    expect(background3dSource).toContain(
      "보이는 리그·애니메이션·모프 모델은 현재 자세와 충돌체가 어긋날 수 있습니다.",
    );
  });
});
