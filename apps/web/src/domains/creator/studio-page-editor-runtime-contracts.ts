import { resolveStudioStampBrushKind, STUDIO_STAMP_BRUSH_DEFAULTS } from "./brush/studio-brush-stamp-engine";
import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";

import type { StudioAiImageSize } from "./ai/studio-ai-client";
import type { StudioBg3dShotBatchRecoveryScope } from "./bg3d/studio-bg3d-shot-batch-plan";
import type { StudioBrushStampTuning } from "./brush/studio-brush-library";
import type { StudioFilterKind } from "./filter/studio-filter-menu";
import type { ScenarioPanelAspect } from "./studio-scenario-layout";
import type { SfxPreset } from "./studio-sfx-presets";
import type { StudioSharedDocument } from "./studio-shared-document-client";

export interface StudioBg3dRecoveryAccessSnapshot {
  readonly open: boolean;
  readonly authUserId: string | null;
  readonly hasAuthenticatedSession: boolean;
  readonly workId: string | null;
  readonly remixId: string | null;
  readonly authorizedWorkId: string | null;
  readonly workHydrated: boolean;
  readonly workHydrationFailed: boolean;
  readonly workHydrationUnsupportedFormat: boolean;
  readonly documentReloadRequired: boolean;
  readonly sharedWorkId: string | null;
  readonly sharedDocumentStatus: StudioSharedDocument["status"] | null;
  readonly sharedDocumentCanView: boolean;
  readonly sharedDocumentRevision: number | null;
  readonly currentPageId: string;
  readonly targetElementId: string | undefined;
  readonly currentTargetExists: boolean;
  readonly serverPersistedTargetExists: boolean;
  readonly memoryPartition: string;
  readonly recoveryScope: StudioBg3dShotBatchRecoveryScope | null;
}

export function studioBg3dRecoveryMemoryIdentity(partition: string): string {
  return `memory:${partition}`;
}

/**
 * A matching local element id is not enough to admit browser-durable recovery. Only the last
 * server-ACKed shared document can prove that the page/element identity is stable across reloads.
 * Parsing through the normal bounded project boundary also keeps legacy single-page documents and
 * malformed/ambiguous ids fail-closed.
 */
export function hasStudioBg3dServerPersistedTarget(
  document: StudioSharedDocument["document"] | null,
  pageId: string,
  elementId: string | undefined,
): boolean {
  if (!document || !elementId) return false;
  try {
    const project = creatorWorkSnapshotToStudioProject(document);
    let matchingPageCount = 0;
    let matchingElementCount = 0;
    let matchingImageCount = 0;
    for (const page of project.pagesList) {
      if (page.id !== pageId) continue;
      matchingPageCount += 1;
      for (const candidate of page.elements) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
        const record = candidate as Record<string, unknown>;
        if (record.id !== elementId) continue;
        matchingElementCount += 1;
        if (record.type === "image") matchingImageCount += 1;
      }
    }
    return matchingPageCount === 1 && matchingElementCount === 1 && matchingImageCount === 1;
  } catch {
    return false;
  }
}

export function isStudioBg3dRecoveryScopeLocallyCurrent(
  scope: StudioBg3dShotBatchRecoveryScope,
  snapshot: StudioBg3dRecoveryAccessSnapshot,
): boolean {
  if (
    !snapshot.open ||
    scope !== snapshot.recoveryScope ||
    scope.pageId !== snapshot.currentPageId
  ) return false;
  if (scope.durability === "memory") {
    const memoryIdentity = studioBg3dRecoveryMemoryIdentity(snapshot.memoryPartition);
    return scope.authUserId === memoryIdentity &&
      scope.workId === memoryIdentity &&
      scope.elementId === memoryIdentity;
  }
  return Boolean(
    snapshot.authUserId &&
    snapshot.hasAuthenticatedSession &&
    snapshot.workId &&
    !snapshot.remixId &&
    snapshot.authorizedWorkId === snapshot.workId &&
    snapshot.workHydrated &&
    !snapshot.workHydrationFailed &&
    !snapshot.workHydrationUnsupportedFormat &&
    !snapshot.documentReloadRequired &&
    snapshot.sharedWorkId === snapshot.workId &&
    snapshot.sharedDocumentStatus === "active" &&
    snapshot.sharedDocumentCanView &&
    snapshot.sharedDocumentRevision !== null &&
    snapshot.targetElementId &&
    snapshot.currentTargetExists &&
    snapshot.serverPersistedTargetExists &&
    scope.authUserId === snapshot.authUserId &&
    scope.workId === snapshot.workId &&
    scope.elementId === snapshot.targetElementId
  );
}

export function studioPatchValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length &&
      left.every((value, index) => studioPatchValuesEqual(value, right[index]));
  }
  if (
    left !== null && right !== null &&
    typeof left === "object" && typeof right === "object"
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(rightRecord, key) &&
        studioPatchValuesEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

export const STUDIO_FILTER_SHORTCUTS: Partial<Record<string, StudioFilterKind>> = {
  Digit1: "gaussian-blur",
  Digit2: "motion-blur",
  Digit3: "hue-saturation-brightness",
  Digit4: "brightness-contrast",
  Digit5: "color-curves",
};

export const BRUSH_DELETE_UNDO_MS = 10_000;

/**
 * handleSave가 페이지마다 스테이지를 재캡처하는 무거운 경로라 손을 놓은 지 한참 지난 뒤에만
 * 조용히 돈다 — 로컬 임시저장(1.5초 디바운스)보다 훨씬 길게 잡아 타이핑·드로잉 중 서버 왕복이
 * 겹치지 않게 한다.
 */
export const STUDIO_SERVER_AUTOSAVE_IDLE_MS = 45_000;

export function defaultStampTuningForBrushId(brushId: string): StudioBrushStampTuning | null {
  const kind = resolveStudioStampBrushKind(brushId);
  if (!kind) return null;
  const defaults = STUDIO_STAMP_BRUSH_DEFAULTS[kind];
  return {
    flow: defaults.flow,
    hardness: defaults.hardness,
    minSize: defaults.minSizeRatio,
  };
}

export const STUDIO_INTERCHANGE_IMPORT_PLACEMENT_CHOICES = Object.freeze([
  Object.freeze({
    id: "new-page",
    label: "새 페이지로 추가",
    description: "현재 원고를 건드리지 않고 다음 페이지에 원본 크기와 레이어 순서를 적용합니다.",
    recommended: true,
  }),
  Object.freeze({
    id: "current-page",
    label: "현재 페이지 위에 배치",
    description: "현재 레이어를 유지한 채 가져온 레이어를 맨 위에 추가하고 필요한 경우 페이지 높이를 늘립니다.",
  }),
]);

export const STUDIO_WILL_V1_IMPORT_PLACEMENT_CHOICES = Object.freeze([
  Object.freeze({
    id: "new-page",
    label: "새 페이지에 추가",
    description: "현재 원고를 건드리지 않고 검증된 선을 다음 페이지에 추가합니다.",
    recommended: true,
  }),
  Object.freeze({
    id: "current-page",
    label: "현재 페이지에 추가",
    description: "현재 요소를 유지한 채 검증된 선을 맨 위에 추가합니다.",
  }),
]);

export function scenarioAspectToImageSize(aspect: ScenarioPanelAspect): StudioAiImageSize {
  if (aspect === "landscape") return "1792x1024";
  if (aspect === "portrait") return "1024x1792";
  return "1024x1024";
}

export function filterSfxPresets(presets: readonly SfxPreset[], query: string): SfxPreset[] {
  const normalizedQuery = query.replace(/\s+/g, "").toLowerCase();
  if (!normalizedQuery) return [...presets];
  return presets.filter((preset) => {
    const label = preset.label.replace(/\s+/g, "").toLowerCase();
    const text = preset.text.replace(/\s+/g, "").toLowerCase();
    return label.includes(normalizedQuery) || text.includes(normalizedQuery);
  });
}

