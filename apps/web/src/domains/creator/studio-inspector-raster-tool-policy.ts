import type {
  StudioRasterToolAvailability,
  StudioRasterToolGate,
} from "./render/studio-raster-tool-availability";

export type StudioInspectorRasterToolState =
  | "ready"
  | "prepare-page-composite"
  | "prepare-vector-fill"
  | "prepare-raster-target"
  | "blocked";

export interface StudioInspectorRasterToolPolicy {
  /**
   * Whether the command itself may be chosen. A missing ImageEl is not a blocker when Studio can
   * make a faithful, non-destructive page composite as the command starts.
   */
  readonly selectable: boolean;
  readonly state: StudioInspectorRasterToolState;
  readonly statusLabel: string;
  readonly actionLabel: string;
  readonly targetLabel: string;
  readonly description: string;
  readonly unavailableReason: string | null;
}

const FALLBACK_BLOCKED_REASON =
  "현재 페이지 상태에서는 이 도구를 시작할 수 없습니다.";

function blockedPolicy(gate: StudioRasterToolGate): StudioInspectorRasterToolPolicy {
  const unavailableReason = gate.reason ?? FALLBACK_BLOCKED_REASON;
  return {
    selectable: false,
    state: "blocked",
    statusLabel: gate.action ? "조치 필요" : "사용 불가",
    actionLabel: gate.action?.label ?? "사용할 수 없음",
    targetLabel: "대상 준비 필요",
    description: unavailableReason,
    unavailableReason,
  };
}

/**
 * Inspector entry policy.
 *
 * Canonical raster availability intentionally reports an explicit-copy gate as `enabled: false`
 * because no raster target exists yet. Tool palettes have a different responsibility: choosing a
 * tool is allowed when that safe copy can be created as part of the command. This adapter keeps
 * hard blockers fail-closed while avoiding a dead disabled button on vector-only pages.
 */
export function resolveStudioInspectorRasterToolPolicy(
  availability: StudioRasterToolAvailability,
): StudioInspectorRasterToolPolicy {
  const gate = availability.entry;

  switch (gate.mode) {
    case "direct-raster":
      return {
        selectable: gate.enabled,
        state: gate.enabled ? "ready" : "blocked",
        statusLabel: gate.enabled ? "즉시 실행" : "사용 불가",
        actionLabel: gate.enabled ? "선택 이미지에서 바로 실행" : "사용할 수 없음",
        targetLabel: "선택 이미지",
        description:
          gate.reason ??
          "선택한 이미지 레이어에서 별도 합성 준비 없이 바로 실행합니다.",
        unavailableReason: gate.enabled ? null : gate.reason ?? FALLBACK_BLOCKED_REASON,
      };

    case "auto-select-raster":
      if (!gate.enabled) return blockedPolicy(gate);
      return {
        selectable: true,
        state: "prepare-raster-target",
        statusLabel: "자동 대상",
        actionLabel: "이미지 대상 자동 연결 후 실행",
        targetLabel: "표시 이미지",
        description:
          gate.reason ??
          "사용 가능한 이미지 레이어를 자동으로 연결한 뒤 실행합니다.",
        unavailableReason: null,
      };

    case "virtual-vector-fill":
      if (!gate.enabled) return blockedPolicy(gate);
      return {
        selectable: true,
        state: "prepare-vector-fill",
        statusLabel: "벡터 채색",
        actionLabel: "벡터 채색 레이어 준비 후 실행",
        targetLabel: "벡터 선화",
        description:
          gate.reason ??
          "표시 중인 벡터 선화를 보존하고 별도 채색 레이어를 준비한 뒤 실행합니다.",
        unavailableReason: null,
      };

    case "auto-merged-copy":
      if (!gate.enabled) return blockedPolicy(gate);
      return {
        selectable: true,
        state: "prepare-page-composite",
        statusLabel: "합성본 준비",
        actionLabel: "페이지 합성본 준비 후 실행",
        targetLabel: "현재 페이지 합성본",
        description:
          gate.reason ??
          "원본 벡터 레이어를 보존한 페이지 합성본을 준비한 뒤 실행합니다.",
        unavailableReason: null,
      };

    case "needs-raster-copy":
      if (gate.action?.id !== "create-editable-raster-copy") {
        return blockedPolicy(gate);
      }
      return {
        selectable: true,
        state: "prepare-page-composite",
        statusLabel: "합성본 준비",
        actionLabel: "페이지 합성본 준비 후 실행",
        targetLabel: "현재 페이지 합성본",
        description:
          gate.reason ??
          "원본 벡터 레이어를 보존한 페이지 합성본을 준비한 뒤 실행합니다.",
        unavailableReason: null,
      };

    case "blocked":
      return blockedPolicy(gate);
  }
}
