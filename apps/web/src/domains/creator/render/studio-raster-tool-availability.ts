/**
 * Canonical availability contract for Studio pixel/raster tools.
 *
 * The editor historically encoded the same preconditions independently in the left rail,
 * shortcuts, menus and inspector panels. That made a disabled control say only "select an
 * image" even when the safe, non-destructive answer was to create an editable raster copy of
 * the visible page. This module deliberately contains no React or StudioPage state. Surfaces can
 * resolve the same entry/apply gates and render a consistent reason + recovery action.
 */

export const STUDIO_RASTER_TOOL_IDS = [
  "paint-bucket",
  "filter",
  "pixel-marquee",
  "pixel-lasso",
  "magic-wand",
  "pixel-transform",
  "content-aware-fill",
  "crop",
  "smudge",
  "dodge-burn",
  "wet-mix",
  "liquify",
  "heal",
  "clone-stamp",
  "history-brush",
  "puppet-warp",
  "layer-mask",
  "frame-animation",
] as const;

export type StudioRasterToolId = (typeof STUDIO_RASTER_TOOL_IDS)[number];

export type StudioRasterPreparationPolicy =
  | "raster-or-vector-fill"
  | "raster-or-auto-merged-copy"
  | "raster-or-explicit-copy"
  | "selected-raster-only";

export type StudioRasterApplyRequirement =
  | "none"
  | "pixel-selection"
  | "clone-source"
  | "history-source"
  | "puppet-displacement"
  | "crop-change";

export interface StudioRasterToolSpec {
  readonly id: StudioRasterToolId;
  readonly label: string;
  readonly preparation: StudioRasterPreparationPolicy;
  readonly applyRequirement: StudioRasterApplyRequirement;
  /** Animated images need a static current-frame copy before destructive pixel editing. */
  readonly acceptsAnimatedTarget: boolean;
  /** Playback can change the sampled frame while an async pixel operation is running. */
  readonly requiresStoppedTimeline: boolean;
}

export const STUDIO_RASTER_TOOL_SPECS: Readonly<Record<StudioRasterToolId, StudioRasterToolSpec>> = {
  "paint-bucket": {
    id: "paint-bucket",
    label: "채우기",
    preparation: "raster-or-vector-fill",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  filter: {
    id: "filter",
    label: "필터",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "pixel-marquee": {
    id: "pixel-marquee",
    label: "픽셀 선택",
    preparation: "raster-or-explicit-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "pixel-lasso": {
    id: "pixel-lasso",
    label: "올가미 선택",
    preparation: "raster-or-explicit-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "magic-wand": {
    id: "magic-wand",
    label: "마술봉",
    preparation: "raster-or-explicit-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "pixel-transform": {
    id: "pixel-transform",
    label: "선택 내용 변형",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "pixel-selection",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "content-aware-fill": {
    id: "content-aware-fill",
    label: "콘텐츠 인식 채우기",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "pixel-selection",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  crop: {
    id: "crop",
    label: "자르기",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "crop-change",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  smudge: {
    id: "smudge",
    label: "혼합(스머지)",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "dodge-burn": {
    id: "dodge-burn",
    label: "닷지/번",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "wet-mix": {
    id: "wet-mix",
    label: "혼색 브러시",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  liquify: {
    id: "liquify",
    label: "리퀴파이",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  heal: {
    id: "heal",
    label: "복구 브러시",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "clone-source",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "clone-stamp": {
    id: "clone-stamp",
    label: "복제 도장",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "clone-source",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "history-brush": {
    id: "history-brush",
    label: "히스토리 브러시",
    preparation: "raster-or-explicit-copy",
    applyRequirement: "history-source",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "puppet-warp": {
    id: "puppet-warp",
    label: "퍼펫 워프",
    preparation: "raster-or-auto-merged-copy",
    applyRequirement: "puppet-displacement",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "layer-mask": {
    id: "layer-mask",
    label: "레이어 마스크",
    preparation: "raster-or-explicit-copy",
    applyRequirement: "none",
    acceptsAnimatedTarget: false,
    requiresStoppedTimeline: true,
  },
  "frame-animation": {
    id: "frame-animation",
    label: "프레임 애니메이션",
    preparation: "selected-raster-only",
    applyRequirement: "none",
    acceptsAnimatedTarget: true,
    requiresStoppedTimeline: false,
  },
};

export type StudioRasterRecoveryActionId =
  | "resolve-document-lock"
  | "retry-when-idle"
  | "show-selected-layer"
  | "unlock-selected-layer"
  | "create-selected-static-copy"
  | "stop-timeline"
  | "select-only-raster-layer"
  | "select-raster-layer"
  | "create-editable-raster-copy"
  | "show-hidden-layers"
  | "add-or-import-content"
  | "make-pixel-selection"
  | "pick-clone-source"
  | "pick-history-source"
  | "move-puppet-pin"
  | "adjust-crop-area";

export interface StudioRasterRecoveryAction {
  readonly id: StudioRasterRecoveryActionId;
  readonly label: string;
  /** Recovery never mutates originals unless the user explicitly asks to unlock/show them. */
  readonly safety: "read-only" | "non-destructive-copy" | "document-setting";
}

export type StudioRasterToolGateMode =
  | "direct-raster"
  | "auto-select-raster"
  | "virtual-vector-fill"
  | "auto-merged-copy"
  | "needs-raster-copy"
  | "blocked";

export interface StudioRasterToolGate {
  readonly enabled: boolean;
  readonly mode: StudioRasterToolGateMode;
  readonly reason: string | null;
  readonly action: StudioRasterRecoveryAction | null;
}

export interface StudioRasterToolAvailability {
  readonly tool: StudioRasterToolSpec;
  /** Whether the user can enter/open the tool. */
  readonly entry: StudioRasterToolGate;
  /** Whether the current draft can actually be committed. Entry may be ready while this is not. */
  readonly apply: StudioRasterToolGate;
}

export interface StudioRasterToolAvailabilityContext {
  /** Collaboration/review/master/save locks that prevent any new document layer or pixel mutation. */
  readonly documentMutationBlockedReason?: string | null;
  readonly busy?: boolean;
  readonly timelinePlaying?: boolean;
  readonly selectedType?: string | null;
  readonly selectedHidden?: boolean;
  /** Includes effective item/group lock and destructive asset-policy reasons. */
  readonly selectedMutationBlockedReason?: string | null;
  /** Immutable/reference assets should be copied; ordinary layer/group locks should be unlocked. */
  readonly selectedMutationRecovery?: "unlock" | "copy";
  /** True for a multi-frame cell or animated GIF. */
  readonly selectedAnimated?: boolean;
  /** Visible, editable raster candidates. A unique one may be safely auto-selected for paint bucket. */
  readonly visibleEditableRasterCount?: number;
  /** Visible vector DrawEl count usable as the boundary for a virtual color layer. */
  readonly visibleVectorDrawCount?: number;
  /** Visible items the shared SVG renderer can reproduce exactly. */
  readonly exactRenderableVisibleCount?: number;
  /** Visible items the shared SVG renderer would skip or approximate. */
  readonly unsupportedVisibleCount?: number;
  readonly hiddenContentCount?: number;
  /** An authored page background can be filtered even when there is no attached ImageEl. */
  readonly hasPageBackground?: boolean;
  readonly hasPixelSelection?: boolean;
  readonly hasCloneSource?: boolean;
  readonly hasHistorySource?: boolean;
  readonly hasPuppetDisplacement?: boolean;
  readonly hasCropChange?: boolean;
}

const READY_DIRECT: StudioRasterToolGate = {
  enabled: true,
  mode: "direct-raster",
  reason: null,
  action: null,
};

function action(
  id: StudioRasterRecoveryActionId,
  label: string,
  safety: StudioRasterRecoveryAction["safety"],
): StudioRasterRecoveryAction {
  return { id, label, safety };
}

function blocked(reason: string, recovery: StudioRasterRecoveryAction | null): StudioRasterToolGate {
  return { enabled: false, mode: "blocked", reason, action: recovery };
}

function copyGate(tool: StudioRasterToolSpec, automatic: boolean): StudioRasterToolGate {
  const reason = `현재 선택은 ${tool.label}의 픽셀 대상이 아닙니다. 원본 레이어를 유지한 채 표시 화면의 편집용 래스터 복사본을 만들 수 있어요.`;
  const recovery = action(
    "create-editable-raster-copy",
    "편집용 래스터 복사본 만들기",
    "non-destructive-copy",
  );
  return automatic
    ? { enabled: true, mode: "auto-merged-copy", reason, action: recovery }
    : { enabled: false, mode: "needs-raster-copy", reason, action: recovery };
}

function resolveEntryGate(
  tool: StudioRasterToolSpec,
  context: StudioRasterToolAvailabilityContext,
): StudioRasterToolGate {
  if (context.documentMutationBlockedReason) {
    return blocked(
      context.documentMutationBlockedReason,
      action("resolve-document-lock", "편집 잠금 확인", "document-setting"),
    );
  }
  if (context.busy) {
    return blocked(
      `${tool.label} 작업을 마치는 중입니다. 완료된 뒤 다시 시도하세요.`,
      action("retry-when-idle", "완료 후 다시 시도", "read-only"),
    );
  }

  const selectedImage = context.selectedType === "image";
  if (selectedImage) {
    if (context.selectedHidden) {
      return blocked(
        "선택한 이미지 레이어가 숨겨져 있습니다. 표시한 뒤 픽셀을 편집하세요.",
        action("show-selected-layer", "선택 레이어 표시", "document-setting"),
      );
    }
    if (context.selectedMutationBlockedReason) {
      return blocked(
        context.selectedMutationBlockedReason,
        context.selectedMutationRecovery === "copy"
          ? action("create-selected-static-copy", "편집 가능한 복사본 만들기", "non-destructive-copy")
          : action("unlock-selected-layer", "레이어 잠금·권한 확인", "document-setting"),
      );
    }
    if (context.selectedAnimated && !tool.acceptsAnimatedTarget) {
      return blocked(
        "애니메이션 레이어의 원본 프레임은 직접 픽셀 편집하지 않습니다. 현재 프레임의 정적 복사본을 만들어 편집하세요.",
        action("create-selected-static-copy", "현재 프레임 정적 복사본 만들기", "non-destructive-copy"),
      );
    }
    if (context.timelinePlaying && tool.requiresStoppedTimeline) {
      return blocked(
        "재생 중에는 픽셀 기준 프레임이 계속 바뀝니다. 타임라인을 멈춘 뒤 편집하세요.",
        action("stop-timeline", "타임라인 멈추기", "read-only"),
      );
    }
    return READY_DIRECT;
  }

  const visibleRasterCount = Math.max(0, context.visibleEditableRasterCount ?? 0);
  if (tool.preparation === "selected-raster-only") {
    if (visibleRasterCount === 1) {
      return blocked(
        `${tool.label}에 사용할 이미지 레이어가 하나 있습니다. 그 레이어를 선택하세요.`,
        action("select-only-raster-layer", "이미지 레이어 선택", "read-only"),
      );
    }
    return blocked(
      visibleRasterCount > 1
        ? `${tool.label}에 사용할 이미지 레이어를 선택하세요.`
        : `${tool.label}은 이미지 레이어가 필요합니다. 이미지를 추가하거나 가져오세요.`,
      visibleRasterCount > 1
        ? action("select-raster-layer", "이미지 레이어 선택", "read-only")
        : action("add-or-import-content", "이미지 추가", "document-setting"),
    );
  }

  if (tool.preparation === "raster-or-vector-fill") {
    if (visibleRasterCount === 1) {
      return {
        enabled: true,
        mode: "auto-select-raster",
        reason: "채울 수 있는 이미지 레이어 하나를 자동으로 선택합니다.",
        action: action("select-only-raster-layer", "대상 레이어 보기", "read-only"),
      };
    }
    if (visibleRasterCount > 1) {
      return blocked(
        `채울 수 있는 이미지가 ${visibleRasterCount}개입니다. 대상 레이어를 하나 선택하세요.`,
        action("select-raster-layer", "채울 레이어 선택", "read-only"),
      );
    }
    if ((context.visibleVectorDrawCount ?? 0) > 0) {
      return {
        enabled: true,
        mode: "virtual-vector-fill",
        reason: "표시 중인 벡터 선화 아래에 비파괴 채색 레이어를 준비합니다.",
        action: action(
          "create-editable-raster-copy",
          "벡터 채색 레이어 준비",
          "non-destructive-copy",
        ),
      };
    }
    return blocked(
      "채울 래스터 이미지나 표시 중인 벡터 선화가 없습니다.",
      action("add-or-import-content", "선화 또는 이미지 추가", "document-setting"),
    );
  }

  if (tool.preparation === "raster-or-explicit-copy" && visibleRasterCount > 0) {
    return blocked(
      visibleRasterCount === 1
        ? `${tool.label}에 사용할 이미지 레이어가 하나 있습니다. 그 레이어를 선택하세요.`
        : `${tool.label}에 사용할 이미지 레이어 하나를 선택하세요.`,
      action(
        visibleRasterCount === 1 ? "select-only-raster-layer" : "select-raster-layer",
        "이미지 레이어 선택",
        "read-only",
      ),
    );
  }

  const hasExactMergedSource =
    (context.exactRenderableVisibleCount ?? 0) > 0 || context.hasPageBackground === true;
  const hasUnsupportedSource = (context.unsupportedVisibleCount ?? 0) > 0;
  if (hasUnsupportedSource) {
    return blocked(
      "표시 레이어 중 일부를 화면과 똑같이 래스터 복사본으로 만들 수 없습니다. 지원되지 않는 합성·지우개 획을 먼저 정리하세요.",
      null,
    );
  }
  if (hasExactMergedSource) {
    return copyGate(tool, tool.preparation === "raster-or-auto-merged-copy");
  }
  if ((context.hiddenContentCount ?? 0) > 0) {
    return blocked(
      "페이지의 콘텐츠가 모두 숨겨져 있습니다. 필요한 레이어를 표시한 뒤 다시 시도하세요.",
      action("show-hidden-layers", "숨긴 레이어 확인", "document-setting"),
    );
  }
  return blocked(
    "편집할 표시 콘텐츠가 없습니다. 그림을 그리거나 이미지를 추가한 뒤 다시 시도하세요.",
    action("add-or-import-content", "콘텐츠 추가", "document-setting"),
  );
}

function resolveApplyGate(
  tool: StudioRasterToolSpec,
  context: StudioRasterToolAvailabilityContext,
  entry: StudioRasterToolGate,
): StudioRasterToolGate {
  if (!entry.enabled) return entry;
  switch (tool.applyRequirement) {
    case "pixel-selection":
      return context.hasPixelSelection
        ? entry
        : blocked(
          "적용할 픽셀 영역을 먼저 선택하세요.",
          action("make-pixel-selection", "픽셀 영역 선택", "read-only"),
        );
    case "clone-source":
      return context.hasCloneSource
        ? entry
        : blocked(
          "Alt(Option)+클릭으로 복제할 소스 위치를 먼저 지정하세요.",
          action("pick-clone-source", "캔버스에서 소스 지정", "read-only"),
        );
    case "history-source":
      return context.hasHistorySource
        ? entry
        : blocked(
          "작업 내역에서 복원할 시점을 히스토리 브러시 소스로 먼저 지정하세요.",
          action("pick-history-source", "작업 내역에서 소스 지정", "read-only"),
        );
    case "puppet-displacement":
      return context.hasPuppetDisplacement
        ? entry
        : blocked(
          "핀을 하나 이상 놓고 원본 위치에서 움직여야 적용할 수 있습니다.",
          action("move-puppet-pin", "핀 놓고 움직이기", "read-only"),
        );
    case "crop-change":
      return context.hasCropChange
        ? entry
        : blocked(
          "자르기 경계를 움직여 남길 영역을 정하세요.",
          action("adjust-crop-area", "자르기 영역 조정", "read-only"),
        );
    case "none":
      return entry;
  }
}

/**
 * Resolve both the control gate and the later Apply/paint gate. Keeping both avoids disabling a
 * useful tool merely because its source anchor, selection or deformation has not been authored yet.
 */
export function resolveStudioRasterToolAvailability(
  id: StudioRasterToolId,
  context: StudioRasterToolAvailabilityContext,
): StudioRasterToolAvailability {
  const tool = STUDIO_RASTER_TOOL_SPECS[id];
  const entry = resolveEntryGate(tool, context);
  return {
    tool,
    entry,
    apply: resolveApplyGate(tool, context, entry),
  };
}

/** Build all tool rows for settings/help surfaces without reimplementing matrix order. */
export function resolveStudioRasterToolAvailabilityMatrix(
  context: StudioRasterToolAvailabilityContext,
): readonly StudioRasterToolAvailability[] {
  return STUDIO_RASTER_TOOL_IDS.map((id) => resolveStudioRasterToolAvailability(id, context));
}
