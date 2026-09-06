import type { Tool } from "./studio-editor-tool-model";

export interface StudioInspectorInteractionGate {
  disabled: boolean;
  reason?: string;
}

export interface StudioInspectorInteractionPolicy {
  global: StudioInspectorInteractionGate;
  page: StudioInspectorInteractionGate;
  selection: StudioInspectorInteractionGate;
  reasons: string[];
}

export interface StudioInspectorInteractionPolicyInput {
  saving: boolean;
  collaborationDocumentLocked: boolean;
  activeSurfaceReviewLocked: boolean;
  selectedContentMutationLocked: boolean;
  masterEditMode: boolean;
}

export function resolveStudioInspectorInteractionPolicy(
  input: StudioInspectorInteractionPolicyInput,
): StudioInspectorInteractionPolicy {
  const globalReason = input.collaborationDocumentLocked
    ? "공동 문서 편집 권한이 없어 변경할 수 없어요."
    : input.saving
      ? "저장이 끝난 뒤 변경할 수 있어요."
      : input.activeSurfaceReviewLocked
        ? "검토 잠금을 해제한 뒤 변경할 수 있어요."
        : undefined;
  const global = globalReason
    ? { disabled: true, reason: globalReason }
    : { disabled: false };
  const page =
    global.disabled || !input.masterEditMode
      ? global
      : {
          disabled: true,
          reason: "마스터 편집을 마친 뒤 페이지 설정을 변경할 수 있어요.",
        };
  const selection =
    global.disabled || !input.selectedContentMutationLocked
      ? global
      : {
          disabled: true,
          reason: "선택한 레이어의 잠금을 해제한 뒤 변경할 수 있어요.",
        };

  return {
    global,
    page,
    selection,
    reasons: studioInspectorDisabledReasons(input),
  };
}

export function studioInspectorDisabledReasons(
  input: StudioInspectorInteractionPolicyInput,
): string[] {
  return [
    input.masterEditMode
      ? "마스터 편집 중에는 페이지 우측 패널의 일부 조작이 잠길 수 있어요."
      : null,
    input.collaborationDocumentLocked
      ? "협업 문서 권한으로 편집 기능이 잠겨 있습니다."
      : null,
    input.saving
      ? "저장이 진행 중이라 편집이 잠시 비활성화되어 있습니다."
      : null,
    input.activeSurfaceReviewLocked
      ? "현재 작업면의 검토 잠금이 활성화되어 있어 패널 편집이 제한됩니다."
      : null,
    input.selectedContentMutationLocked
      ? "선택한 레이어가 잠겨 있어 일부 우측 패널 조작이 제한됩니다."
      : null,
  ].filter((reason): reason is string => reason !== null);
}

export function studioInspectorToolToggleDisabled(
  gate: StudioInspectorInteractionGate,
  active: boolean,
): boolean {
  return gate.disabled && !active;
}

export type StudioInspectorContentMode = "drawing" | "selection" | "empty";

export function resolveStudioInspectorContentMode(input: {
  tool: Tool;
  hasSelection: boolean;
}): StudioInspectorContentMode {
  if (input.tool === "draw") return "drawing";
  return input.hasSelection ? "selection" : "empty";
}
