import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


/**
 * "조용한 실패 부재" 계약 — Wave E 의 존재 이유를 소스로 고정한다.
 *
 * 실패 경로가 사용자 표면에 닿는지는 런타임 테스트로도 확인하지만, **회귀로 다시
 * 무음이 되는 것**은 호출부가 배선을 떼어낼 때 일어난다. 그래서 접합점 자체를 고정한다.
 */

const studioPage = readStudioPageCompositionSource();
const quickComicController = readFileSync(
  new URL("./comipo/studio-quick-comic-controller.ts", import.meta.url),
  "utf8",
);
const templateLayoutController = readFileSync(
  new URL("./template/studio-template-layout-controller.ts", import.meta.url),
  "utf8",
);
const checkpointsController = readFileSync(
  new URL("./checkpoint/studio-checkpoints-controller.ts", import.meta.url),
  "utf8",
);
const destructiveCombined = [
  studioPage,
  quickComicController,
  templateLayoutController,
  checkpointsController,
].join("\n");
const studioCuttoonEditorView = readFileSync(
  new URL("./studio-cuttoon-editor/StudioCuttoonEditorHosts.tsx", import.meta.url),
  "utf8",
);
const statusRail = readFileSync(
  new URL("./canvas/StudioCanvasStatusRail.tsx", import.meta.url),
  "utf8",
);
const autosaveSession = readFileSync(
  new URL("./studio-autosave-opfs-session.ts", import.meta.url),
  "utf8",
);
const webgpuFilterRuntime = readFileSync(
  new URL("./render/studio-engine-webgpu-filter-runtime.ts", import.meta.url),
  "utf8",
);
const destructivePreview = readFileSync(
  new URL("./studio-destructive-action-preview.ts", import.meta.url),
  "utf8",
);
const confirmHost = readFileSync(
  new URL("./StudioDestructiveConfirmHost.tsx", import.meta.url),
  "utf8",
);
const vrmArchiveAttestationHost = readFileSync(
  new URL("./vrm/StudioVrmProjectArchiveAttestationHost.tsx", import.meta.url),
  "utf8",
);
const createWorkPage = readFileSync(
  new URL("./CreateWorkPage.tsx", import.meta.url),
  "utf8",
);
const createSeriesPage = readFileSync(
  new URL("./CreateSeriesPage.tsx", import.meta.url),
  "utf8",
);

const creatorDir = fileURLToPath(new URL(".", import.meta.url));

function creatorSourceFiles(): readonly string[] {
  return readdirSync(creatorDir).filter(
    (name) =>
      (name.endsWith(".ts") || name.endsWith(".tsx"))
      && !name.includes(".test.")
      && !name.endsWith(".d.ts"),
  );
}

function sourceBetween(start: string, end: string): string {
  const startIndex = studioPage.indexOf(start);
  expect(startIndex, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = studioPage.indexOf(end, startIndex + start.length);
  expect(endIndex, `missing anchor: ${end}`).toBeGreaterThan(startIndex);
  return studioPage.slice(startIndex, endIndex);
}

describe("Studio reliability product boundary", () => {
  it("reports main-canvas GPU loss without invoking a renderer failover", () => {
    const handler = sourceBetween(
      "function onWebGpuDeviceLost()",
      "function onWebGpuFrameReady",
    );

    expect(handler).toContain("announceStudioGpuDeviceLoss(");
    expect(handler).not.toContain("failOverGpuAuthorityAfterSurfaceLoss");
    expect(handler).not.toContain('publishStudioRenderBackend("canvas2d")');
  });

  it("routes autosave failure and durable-authority demotion to the user", () => {
    const autosave = sourceBetween(
      "// 오토세이브 임시저장 리스너",
      "// 서버 자동저장",
    );

    expect(autosave).toContain("onDurableAuthorityDegraded: reportStudioSaveAuthorityDegraded");
    expect(autosave).toContain("reportStudioAutosaveFailure(cause)");
    // 폴백으로 성공한 저장이 강등 고지를 지우지 못하도록 권위를 함께 넘긴다.
    expect(autosave).toContain("noteStudioSaveSucceeded(receipt.authority)");

    const failureIndex = autosave.indexOf("reportStudioAutosaveFailure(cause)");
    const consoleIndex = autosave.indexOf('console.error("Auto-save failed:"');
    // 고지가 콘솔 진단보다 먼저다 — 진단만 남기고 끝나는 경로를 만들지 않는다.
    expect(failureIndex).toBeGreaterThanOrEqual(0);
    expect(consoleIndex).toBeGreaterThan(failureIndex);
  });

  it("keeps the OPFS fallback observable instead of an empty catch", () => {
    expect(autosaveSession).toContain("onDurableAuthorityDegraded");
    expect(autosaveSession).not.toMatch(
      /catch \{\n\s*\/\/ The synchronous browser slot remains a bounded compatibility and lifecycle fallback\.\n\s*\}/,
    );
  });

  it("mounts the reliability notices inside the existing canvas status rail", () => {
    expect(statusRail).toContain(
      'import { StudioReliabilityStatusRail } from "../StudioReliabilityStatusRail"',
    );
    expect(statusRail).toContain("<StudioReliabilityStatusRail />");
    const railIndex = statusRail.indexOf("<StudioReliabilityStatusRail />");
    // 배너 조건에는 follower 게이트가 함께 걸린다(후발 탭에는 복구 버튼을 띄우지 않는다).
    const autosaveBannerIndex = statusRail.indexOf("{hasAutosave && ");
    // 세션 복구 배너와 같은 레일에, 그 위에 산다.
    expect(railIndex).toBeGreaterThan(0);
    expect(autosaveBannerIndex).toBeGreaterThan(railIndex);
  });

  it("actually enforces the safe-mode quality drop instead of only flagging it", () => {
    const guard = sourceBetween(
      "function beginStudioLivingInkStroke(",
      "const fieldScale",
    );

    // 문서 의미는 그대로 — 라이브 잉크만 멈추고 보통 획 경로로 계속 그린다.
    expect(guard).toContain("studioSafeModeQuality().livingInkSuspended");
  });

  it("has no native confirm left anywhere in the creator domain", () => {
    const offenders: string[] = [];
    const nativeConfirmCall = /(?:globalThis|window)\s*\.\s*confirm\s*(?:\?\.)?\s*\(/u;
    for (const name of creatorSourceFiles()) {
      const source = readFileSync(`${creatorDir}${name}`, "utf8");
      if (nativeConfirmCall.test(source)) {
        offenders.push(name);
      }
    }

    expect(
      offenders,
      `네이티브 confirm 은 승인 preview 를 그릴 수 없다. 이 파일들을 confirmStudioDestructiveAction 으로 옮겨라: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the missing-presenter path fail-closed without a native dialog exception", () => {
    expect(destructivePreview).toContain("function defaultPresenter(");
    expect(destructivePreview).toContain("fail-closed");
    expect(destructivePreview).not.toMatch(
      /(?:globalThis|window)\s*\.\s*confirm\s*(?:\?\.)?\s*\(/u,
    );
  });

  it("routes the approval surface through the on-canvas dialog instead of the browser dialog", () => {
    expect(confirmHost).toContain("setStudioDestructiveConfirmPresenter(");
    expect(confirmHost).toContain("StudioDestructiveConfirmDialog");
    // 호스트가 사라질 때 대기 중인 승인은 반드시 닫힌다 — 미해결 프라미스는 조용한 정지다.
    expect(confirmHost).toContain("pending.settle(false)");
    // 스튜디오와 /create 라우트 양쪽에 표면이 있어야 네이티브 fallback 으로 떨어지지 않는다.
    for (const mount of [studioCuttoonEditorView, createWorkPage, createSeriesPage]) {
      expect(mount).toContain("<StudioDestructiveConfirmHost />");
    }
  });

  it("routes VRM archive attestations through a bounded on-canvas presenter", () => {
    expect(studioCuttoonEditorView).toContain("<StudioVrmProjectArchiveAttestationHost />");
    expect(studioPage).toContain("requestStudioVrmProjectArchiveUseContext,");
    expect(vrmArchiveAttestationHost).not.toMatch(
      /(?:globalThis|window)\s*\.\s*(?:confirm|prompt)\s*(?:\?\.)?\s*\(/u,
    );
    expect(vrmArchiveAttestationHost).toContain("StudioVrmProjectArchiveAttestationDialog");
  });

  it("breaks the silence when the WebGPU filter runtime loses its device", () => {
    const handler = webgpuFilterRuntime.slice(
      webgpuFilterRuntime.indexOf("private handleDeviceLost("),
    );
    const announceIndex = handler.indexOf("announceStudioGpuDeviceLoss(");
    const hookIndex = handler.indexOf("this.onDeviceLost?.(");

    expect(announceIndex).toBeGreaterThanOrEqual(0);
    // 고지가 선택적 콜백보다 먼저다 — 콜백을 넘기지 않은 호출부에서도 로스가 사용자에게 닿는다.
    expect(hookIndex).toBeGreaterThan(announceIndex);
  });

  it("warns before the tab closes, but only while work is actually unsaved", () => {
    expect(studioPage).toContain("installStudioUnloadGuard({");
    expect(studioPage).toContain("hasStudioUnloadPromptWork({");
    // 자동저장과 종료 경고가 같은 지문 규칙을 봐야 한다(둘이 갈라지면 판정이 조용히 어긋난다).
    const fingerprints = studioPage.match(/studioPendingStrokeFingerprint\(/g) ?? [];
    expect(fingerprints.length).toBeGreaterThanOrEqual(2);
  });

  it("routes every destructive command through the preview catalog", () => {
    for (const factory of [
      "studioQuickComicReplaceRequest",
      "studioSceneSnapshotReplaceRequest",
      "studioStartFromExampleRequest",
      "studioRemoveEmeresUnderlaysRequest",
      "studioApplyTemplateRequest",
      "studioApplyPanelLayoutRequest",
      "studioApplyCollageRequest",
      "studioRestoreCheckpointRequest",
      "studioDeleteCheckpointRequest",
      "studioClearLivingInkRequest",
    ]) {
      expect(destructiveCombined, `${factory} is not wired`).toContain(`${factory}(`);
    }
    const confirms = destructiveCombined.match(/confirmStudioDestructiveAction\(/g) ?? [];
    expect(confirms.length).toBe(10);
  });

  it("settles every approved destruction so a refused commit cannot vanish", () => {
    const settles = destructiveCombined.match(/settleStudioDestructiveCommit\(/g) ?? [];
    // 승인 10건 중 이메레스·콜라주 등 분기가 있는 곳은 커밋 지점이 여러 개라 승인 수보다 많다.
    expect(settles.length).toBeGreaterThanOrEqual(10);
  });
});
