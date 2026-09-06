export const STUDIO_UX_ENTRY_CONTINUITY_CHECKPOINT_IDS = [
  "prerequisite-explained",
  "prerequisite-cta-available",
  "cta-changed-state",
  "target-selectable-after-cta",
  "entry-visible-after-target-selection",
] as const;

export type StudioUxEntryContinuityCheckpointId =
  (typeof STUDIO_UX_ENTRY_CONTINUITY_CHECKPOINT_IDS)[number];

export interface StudioUxEntryContinuitySourceClause {
  readonly file: string;
  readonly allOf: readonly string[];
  readonly anyOf?: readonly string[];
}

export interface StudioUxEntryContinuityCheckpointContract {
  readonly id: StudioUxEntryContinuityCheckpointId;
  readonly clauses: readonly StudioUxEntryContinuitySourceClause[];
}

export interface StudioUxEntryContinuityContract {
  readonly id: string;
  readonly title: string;
  readonly prerequisite: string;
  readonly checkpoints: readonly StudioUxEntryContinuityCheckpointContract[];
}

export interface StudioUxEntryContinuityCheckpointResult {
  readonly id: StudioUxEntryContinuityCheckpointId;
  readonly ok: boolean;
  readonly missing: readonly string[];
}

export interface StudioUxEntryContinuityAuditResult {
  readonly id: string;
  readonly ok: boolean;
  readonly score: number;
  readonly passedCheckpoints: number;
  readonly totalCheckpoints: number;
  readonly checkpoints: readonly StudioUxEntryContinuityCheckpointResult[];
}

const STUDIO_UX_ENTRY_CONTINUITY_BASE_CONTRACTS: readonly StudioUxEntryContinuityContract[] = [
  {
    id: "hokusai-selected-freehand",
    title: "Hokusai 자연매체 변환",
    prerequisite: "완성된 freehand 선화 선택",
    checkpoints: [
      {
        id: "prerequisite-explained",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioHokusaiNaturalMediaInspectorSection.tsx",
            allOf: ["캔버스에서 완성된 자유곡선 선화를 먼저 선택해 주세요."],
          },
        ],
      },
      {
        id: "prerequisite-cta-available",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioHokusaiNaturalMediaInspectorSection.tsx",
            allOf: [
              "!selectedDraw && onRequestSelectStroke",
              "onClick={onRequestSelectStroke}",
              "선화 선택하기",
            ],
          },
        ],
      },
      {
        id: "cta-changed-state",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioInspectorDrawingSection.tsx",
            allOf: [
              "onRequestSelectStroke={() => {",
              'setTool("select")',
              "캔버스에서 변환할 자유곡선 선화를 선택하세요",
            ],
          },
        ],
      },
      {
        id: "target-selectable-after-cta",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioInspectorSelectionSection.tsx",
            allOf: [
              'selected.type === "draw"',
            ],
          },
          {
            file: "apps/web/src/domains/creator/StudioInspectorShapeSection.tsx",
            allOf: [
              '(selected.kind ?? "freehand") === "freehand"',
              "selected={selected}",
            ],
          },
        ],
      },
      {
        id: "entry-visible-after-target-selection",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioInspectorDrawingSection.tsx",
            allOf: [
              '<StudioHokusaiNaturalMediaInspectorMount',
              'visible={drawMode !== "shape" && drawMode !== "pixel"}',
              "onRequestSelectStroke={() => {",
              "onReplace={replaceDrawWithHokusaiNaturalMedia}",
            ],
          },
          {
            file: "apps/web/src/domains/creator/StudioHokusaiNaturalMediaInspectorMount.tsx",
            allOf: [
              "if (!visible) return null",
              "selected={selected}",
              "onRequestSelectStroke={onRequestSelectStroke}",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "native-raster-recovery",
    title: "네이티브 획의 선택·필터·리터치 준비",
    prerequisite: "편집 가능한 페이지 합성 래스터 대상",
    checkpoints: [
      {
        id: "prerequisite-explained",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioRasterToolRecoveryPanel.tsx",
            allOf: [
              "entry.entry.reason",
              "픽셀 편집 대상",
              "원본 레이어를 유지하면서 필요한 대상만 안전하게 준비합니다.",
            ],
          },
        ],
      },
      {
        id: "prerequisite-cta-available",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioRasterToolRecoveryPanel.tsx",
            allOf: [
              "showRecovery",
              "onRecover({ toolId: entry.tool.id, action: recovery })",
              "pointer-coarse:min-h-11",
            ],
          },
        ],
      },
      {
        id: "cta-changed-state",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
            allOf: [
              "materializeStudioEditableRasterCopy",
              "setSelectedId(composite.id)",
              "resetPixelSelectionHistoryState(composite.id, null)",
            ],
          },
        ],
      },
      {
        id: "target-selectable-after-cta",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
            allOf: [
              'case "activate-selection"',
              "applyPixelSelectionActivation(resumePlan.selectionTool)",
              'image: "retouch"',
            ],
          },
        ],
      },
      {
        id: "entry-visible-after-target-selection",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
            allOf: [
              'case "arm-retouch"',
              "openInspectorRoute(",
              'image: "retouch"',
            ],
          },
          {
            file: "apps/web/src/domains/creator/StudioInspectorImageToolsSection.tsx",
            allOf: [
              "<StudioInspectorFilterLauncher",
              "<StudioInspectorPixelSelectionLauncher",
              "<StudioRasterToolRecoveryPanel",
              "onRecover={handleRasterRecovery}",
            ],
          },
        ],
      },
    ],
  },
] as const;

/** High-risk prerequisite flows promoted to the blocking registry after vertical wiring. */
const STUDIO_UX_ENTRY_CONTINUITY_PROMOTED_CONTRACTS: readonly StudioUxEntryContinuityContract[] = [
  {
    id: "paper-vector-refinement-selected-stroke",
    title: "Paper 벡터 경로 정리",
    prerequisite: "저장 완료된 자유선 펜 획 선택",
    checkpoints: [
      {
        id: "prerequisite-explained",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
          allOf: ["자유선 펜 획 하나를 선택하세요.", "paperVectorRefinementUnavailableReason"],
        }],
      },
      {
        id: "prerequisite-cta-available",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioNodeEditPanel.tsx",
          allOf: ["onRequestSelectStroke", "선화 선택하기"],
        }],
      },
      {
        id: "cta-changed-state",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioInspectorShapeSection.tsx",
          allOf: [
            "onRequestSelectStroke={() => {",
            'setTool("select")',
            "경로를 정리할 자유곡선 선화를 선택하세요 · Esc로 취소",
          ],
        }],
      },
      {
        id: "target-selectable-after-cta",
        clauses: [
          {
            file: "apps/web/src/domains/creator/StudioInspectorSelectionSection.tsx",
            allOf: [
              'selected.type === "draw"',
            ],
          },
          {
            file: "apps/web/src/domains/creator/StudioInspectorShapeSection.tsx",
            allOf: [
              '(selected.kind ?? "freehand") === "freehand"',
              "<StudioInspectorFreehandPathControls",
              "selected={selected}",
              "onRequestSelectStroke={() => {",
            ],
          },
          {
            file: "apps/web/src/domains/creator/StudioInspectorFreehandPathControls.tsx",
            allOf: [
              "<StudioNodeEditPanel",
              "onRequestSelectStroke={onRequestSelectStroke}",
              "onRefine={onRefine}",
            ],
          },
        ],
      },
      {
        id: "entry-visible-after-target-selection",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioInspectorShapeSection.tsx",
          allOf: [
            "refinementUnavailableReason={",
            "onRefine={applyPaperVectorRefinement}",
          ],
        }],
      },
    ],
  },
  {
    id: "pixel-transform-selection",
    title: "픽셀 선택 내용 변형",
    prerequisite: "래스터 대상과 사용 가능한 픽셀 선택",
    checkpoints: [
      {
        id: "prerequisite-explained",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioLeftToolRail.tsx",
          allOf: [
            "이미지 픽셀 내용 변형을 위해 사각 선택을 시작합니다",
            "변형할 선·도형·이미지를 캔버스에서 먼저 고르세요",
            "objectFreeTransformReady",
            "objectTransformPickRecoveryAvailable",
          ],
        }],
      },
      {
        id: "prerequisite-cta-available",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioLeftToolRail.tsx",
          allOf: [
            "onRequestPixelSelection",
            '"선택 시작하기"',
            '"선택 후 변형"',
            "pixelTransformRecoveryAvailable || objectTransformPickRecoveryAvailable",
          ],
        }],
      },
      {
        id: "cta-changed-state",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
          allOf: [
            "onRequestPixelSelection: () => {",
            'activatePixelSelectionToolFromInspector("rect")',
            "Esc로 취소",
          ],
        }],
      },
      {
        id: "target-selectable-after-cta",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioSelectionToolsPanel.tsx",
          allOf: ["SELECTION_TOOLS", "onPickTool", "selectionUnavailableReason"],
        }],
      },
      {
        id: "entry-visible-after-target-selection",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
          allOf: ["openPixelSelectionTransform", "openInspectorRoute("],
        }],
      },
    ],
  },
  {
    id: "frame-animation-selected-image",
    title: "프레임 애니메이션",
    prerequisite: "편집할 이미지 레이어 선택",
    checkpoints: [
      {
        id: "prerequisite-explained",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioLeftToolRail.tsx",
          allOf: ["애니메이션으로 편집할 이미지 레이어를 먼저 선택하세요."],
        }],
      },
      {
        id: "prerequisite-cta-available",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioLeftToolRail.tsx",
          allOf: [
            "onRequestSelectImage",
            'label={frameAnimationRecoveryAvailable ? "이미지 선택하기"',
            'className={frameAnimationRecoveryAvailable ? "size-11"',
          ],
        }],
      },
      {
        id: "cta-changed-state",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
          allOf: [
            "onRequestSelectImage: () => {",
            'setTool("select")',
            "프레임 애니메이션으로 편집할 이미지를 선택하세요 · Esc로 취소",
          ],
        }],
      },
      {
        id: "target-selectable-after-cta",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioLeftToolRail.tsx",
          allOf: ['selected?.type === "image"', "pixelToolTargetAvailable"],
        }],
      },
      {
        id: "entry-visible-after-target-selection",
        clauses: [{
          file: "apps/web/src/domains/creator/StudioLeftToolRail.tsx",
          allOf: ["openFrameAnimationForSelected", "frameAnimTargetId === selected?.id"],
        }],
      },
    ],
  },
  {
    id: "brush-dynamics-compatible-brush",
    title: "브러시 다이내믹 상세 설정",
    prerequisite: "입자·에어브러시·드라이 미디어 브러시 선택",
    checkpoints: [
      {
        id: "prerequisite-explained",
        clauses: [{
          file: "apps/web/src/domains/creator/brush/StudioBrushStudio.tsx",
          allOf: ["입자 브러시를 먼저 선택하세요", "빠른 설정에서 잉크 입자"],
        }],
      },
      {
        id: "prerequisite-cta-available",
        clauses: [{
          file: "apps/web/src/domains/creator/brush/StudioBrushStudio.tsx",
          allOf: [
            "onRequestCompatibleBrush",
            "호환 브러시 선택하기",
            "min-h-11",
          ],
        }],
      },
      {
        id: "cta-changed-state",
        clauses: [{
          file: "apps/web/src/domains/creator/brush/StudioBrushStudio.tsx",
          allOf: [
            "function onRequestCompatibleBrush(): void",
            "onSelectDynamicsPreset(",
            '"ink-particle"',
            "studioBrushDynamicsPresetSettings",
          ],
        }],
      },
      {
        id: "target-selectable-after-cta",
        clauses: [{
          file: "apps/web/src/domains/creator/brush/StudioBrushStudio.tsx",
          allOf: ["DynamicsRequiredNotice", "studioBrushDynamicsPresetSettings"],
        }],
      },
      {
        id: "entry-visible-after-target-selection",
        clauses: [{
          file: "apps/web/src/domains/creator/brush/StudioBrushStudio.tsx",
          allOf: ["StudioBrushStudio", "currentSnapshot", "onSettingsChange"],
        }],
      },
    ],
  },
  {
    id: "ai-character-reference-image",
    title: "AI 캐릭터 일관성 생성",
    prerequisite: "기준 캐릭터 이미지 선택",
    checkpoints: [
      {
        id: "prerequisite-explained",
        clauses: [{
          file: "apps/web/src/domains/creator/ai/StudioAiCharacterConsistencyPanel.tsx",
          allOf: ["캐릭터 이미지", "선택하세요."],
        }],
      },
      {
        id: "prerequisite-cta-available",
        clauses: [{
          file: "apps/web/src/domains/creator/ai/StudioAiCharacterConsistencyPanel.tsx",
          allOf: [
            "onRequestSelectReference",
            "기준 이미지 선택하기",
            "min-h-11",
          ],
        }],
      },
      {
        id: "cta-changed-state",
        clauses: [{
          file: "apps/web/src/domains/creator/ai/StudioAiToolPopoverBody.tsx",
          allOf: [
            "onRequestSelectReference={() => {",
            'setTool("select")',
            "기준 캐릭터 이미지를 선택하세요 · Esc로 취소",
          ],
        }],
      },
      {
        id: "target-selectable-after-cta",
        clauses: [{
          file: "apps/web/src/domains/creator/ai/StudioAiCharacterConsistencyPanel.tsx",
          allOf: ["hasReference", "referenceThumbnail"],
        }],
      },
      {
        id: "entry-visible-after-target-selection",
        clauses: [{
          file: "apps/web/src/domains/creator/ai/StudioAiCharacterConsistencyPanel.tsx",
          allOf: ["hasReference && referenceThumbnail"],
          anyOf: ["같은 캐릭터로 생성", "AI 캐릭터 일관성 생성"],
        }],
      },
    ],
  },
] as const;

export const STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS: readonly StudioUxEntryContinuityContract[] = [
  ...STUDIO_UX_ENTRY_CONTINUITY_BASE_CONTRACTS,
  ...STUDIO_UX_ENTRY_CONTINUITY_PROMOTED_CONTRACTS,
];

/** No known high-risk guard remains diagnostic-only; new findings start here before promotion. */
export const STUDIO_UX_ENTRY_CONTINUITY_CANDIDATES: readonly StudioUxEntryContinuityContract[] = [];

function clauseMissing(
  clause: StudioUxEntryContinuitySourceClause,
  sources: ReadonlyMap<string, string>,
): readonly string[] {
  const source = sources.get(clause.file);
  if (source === undefined) return [`${clause.file}:<file-missing>`];
  const missing = clause.allOf
    .filter((needle) => !source.includes(needle))
    .map((needle) => `${clause.file}:${needle}`);
  if (clause.anyOf && !clause.anyOf.some((needle) => source.includes(needle))) {
    missing.push(`${clause.file}:<any-of:${clause.anyOf.join("|")}>`);
  }
  return missing;
}

export function auditStudioUxEntryContinuity(
  contract: StudioUxEntryContinuityContract,
  sources: ReadonlyMap<string, string>,
): StudioUxEntryContinuityAuditResult {
  const checkpoints = contract.checkpoints.map((checkpoint) => {
    const missing = checkpoint.clauses.flatMap((clause) =>
      clauseMissing(clause, sources),
    );
    return {
      id: checkpoint.id,
      ok: missing.length === 0,
      missing,
    } satisfies StudioUxEntryContinuityCheckpointResult;
  });
  const passedCheckpoints = checkpoints.filter((checkpoint) => checkpoint.ok).length;
  const score = checkpoints.length > 0
    ? Math.round((passedCheckpoints / checkpoints.length) * 1_000) / 10
    : 0;
  return {
    id: contract.id,
    ok: passedCheckpoints === checkpoints.length,
    score,
    passedCheckpoints,
    totalCheckpoints: checkpoints.length,
    checkpoints,
  };
}
