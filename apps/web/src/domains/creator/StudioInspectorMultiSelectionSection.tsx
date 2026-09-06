import { StudioInspectorBatchRenameSection } from "./StudioInspectorBatchRenameSection";
import { StudioInspectorSelectionActions } from "./StudioInspectorOrderAlignSection";
import { StudioInspectorMutationLockNotice } from "./StudioInspectorUtilityPanels";

import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";

/**
 * Multi-selection Inspector body.
 *
 * Representative-only appearance/text controls stay hidden, but selection-wide commands no longer
 * disappear with them. The same handlers used by the canvas and single-selection Inspector are
 * surfaced here under one mutation gate, so lock/session policy and undo semantics remain shared.
 */
export function StudioInspectorMultiSelectionSection({
  model,
}: {
  model: StudioInspectorAsideModel;
}) {
  const {
    alignSelected,
    announceDrawingShortcut,
    commit,
    elements,
    groups,
    disarmAllPixelTools,
    duplicateSelected,
    inspectorInteractionPolicy,
    inspectorTransientOwners,
    marqueeIds,
    removeSelected,
    reorder,
  } = model;

  if (marqueeIds.length < 2) return null;

  return (
    <section
      data-testid="studio-inspector-context-multi-selection"
      data-studio-multi-selection-count={marqueeIds.length}
      aria-label={`${marqueeIds.length}개 선택 묶음 작업`}
      className="rounded-xl border border-line bg-panel/40 p-3"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold tracking-tight text-fg">선택 묶음 작업</p>
          <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-fg-3">
            공통 수치는 위 변형에서, 배치·순서·이름 작업은 여기에서 한 번에 적용합니다.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-bold tabular-nums text-accent">
          {marqueeIds.length}개
        </span>
      </div>

      <StudioInspectorMutationLockNotice
        gate={inspectorInteractionPolicy.selection}
        hasActiveSession={inspectorTransientOwners.length > 0}
        onExit={disarmAllPixelTools}
      />

      <fieldset
        disabled={inspectorInteractionPolicy.selection.disabled}
        title={inspectorInteractionPolicy.selection.reason}
        className="m-0 min-w-0 border-0 p-0 disabled:[&_button]:cursor-not-allowed disabled:[&_button]:opacity-50"
      >
        <legend className="sr-only">다중 선택 배치와 빠른 작업</legend>
        <StudioInspectorSelectionActions
          selectionCount={marqueeIds.length}
          reorder={reorder}
          alignSelected={alignSelected}
          duplicateSelected={duplicateSelected}
          removeSelected={removeSelected}
        />
        <StudioInspectorBatchRenameSection
          elements={elements}
          selectedIds={marqueeIds}
          groups={groups}
          commit={(next) => !inspectorInteractionPolicy.selection.disabled && commit(next)}
          announce={announceDrawingShortcut}
        />
      </fieldset>
    </section>
  );
}
