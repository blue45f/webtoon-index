import { Suspense, useId, useMemo } from "react";

import { isEffectivelyHidden } from "./studio-layers";
import {
  resolveStudioFigmaSelectionLayoutMetrics,
  selectStudioFigmaDesignTargets,
} from "./studio-selection-transform-advanced";
import { StudioPathBooleanPanel } from "./studio-page-lazy-ui";
import {
  resolveStudioSelectMatchingOptions,
  selectStudioMatchingElementIds,
  type StudioSelectMatchingCriterion,
} from "./studio-select-matching";
import { createStudioInspectorTabA11y } from "./studio-inspector-tab-a11y";
import { StudioFigmaDesignPanel } from "./StudioFigmaDesignPanel";
import { StudioInspectorAsideShell } from "./StudioInspectorAsideShell";
import { StudioInspectorContextRouteSync } from "./StudioInspectorContextRouteSync";
import { StudioInspectorDrawingSection } from "./StudioInspectorDrawingSection";
import { StudioInspectorEmptyCoachSection } from "./StudioInspectorEmptyCoachSection";
import { StudioInspectorMultiSelectionSection } from "./StudioInspectorMultiSelectionSection";
import { StudioInspectorSelectionSection } from "./StudioInspectorSelectionSection";
import { StudioInspectorUnselectedImageTools } from "./StudioInspectorUnselectedImageTools";
import { StudioSelectionMatchingPanel } from "./StudioSelectionMatchingPanel";
import { useStudioInspectorAsideModel } from "./useStudioInspectorAsideModel";

import type { StudioInspectorAsideProps } from "./StudioInspectorAsideTypes";

import { buttonClass } from "@/shared/components/ui/button-utils";

export function StudioInspectorAsideBody(props: StudioInspectorAsideProps) {
  const model = useStudioInspectorAsideModel(props);
  const tabA11y = createStudioInspectorTabA11y(useId());
  const {
    inspectorContentMode,
    inspectorLayout,
    selected,
    elements,
    groups,
    localHiddenElementIds,
    marqueeIds,
    inspectorInteractionPolicy,
    changeInspectorLayout,
    startEditText,
    applyFigmaSelectionLayoutPatch,
    zoomToSelection,
    flipSelected,
    selectLayersFromNavigator,
    announceDrawingShortcut,
    pathBooleanBusy,
    pathBooleanInspectorUnavailableReason,
    applyPathBooleanCombine,
  } = model;
  const hasMultiSelection =
    inspectorContentMode === "selection" && marqueeIds.length > 1;
  const figmaDesignTargets = inspectorContentMode === "selection"
    ? selectStudioFigmaDesignTargets(elements, marqueeIds, selected)
    : [];
  // The precision resolver promotes group W/H and relative rotation on top of the conservative
  // Figma-style metrics, so the numeric panel and the atomic group planner agree on capability.
  const figmaSelectionMetrics = resolveStudioFigmaSelectionLayoutMetrics(figmaDesignTargets);
  const matchingSourceId =
    figmaDesignTargets.length === 1 ? figmaDesignTargets[0]!.id : null;
  const visibleMatchingElements = useMemo(
    () => matchingSourceId
      ? elements.filter(
          (element) =>
            !localHiddenElementIds.has(element.id)
            && !isEffectivelyHidden(element, groups),
        )
      : [],
    [elements, groups, localHiddenElementIds, matchingSourceId],
  );
  const matchingOptions = useMemo(
    () => matchingSourceId
      ? resolveStudioSelectMatchingOptions(visibleMatchingElements, matchingSourceId)
      : [],
    [matchingSourceId, visibleMatchingElements],
  );

  const selectMatchingElements = (criterion: StudioSelectMatchingCriterion) => {
    if (!matchingSourceId) return;
    const ids = selectStudioMatchingElementIds(
      visibleMatchingElements,
      matchingSourceId,
      criterion,
    );
    if (ids.length < 2) return;
    const option = matchingOptions.find((candidate) => candidate.criterion === criterion);
    selectLayersFromNavigator(ids);
    announceDrawingShortcut(`${option?.label ?? "같은 항목"} ${ids.length}개 선택`);
  };

  return (
    <StudioInspectorAsideShell model={model} tabA11y={tabA11y}>
      <StudioInspectorContextRouteSync
        contentMode={inspectorContentMode}
        layout={inspectorLayout}
        selectedType={selected?.type ?? null}
        onChange={changeInspectorLayout}
      />
      <div
        id={tabA11y.primary.properties.panelId}
        role="tabpanel"
        aria-labelledby={tabA11y.primary.properties.tabId}
        hidden={inspectorLayout.primary !== "properties"}
        className={
          inspectorContentMode === "drawing"
            ? "min-h-0 lg:flex lg:flex-1 lg:flex-col"
            : "space-y-2"
        }
      >
          {inspectorContentMode === "selection"
            && !hasMultiSelection
            && selected
            && (selected.type === "text"
              || selected.type === "bubble"
              || selected.type === "sticker") ? (
            <button
              type="button"
              disabled={inspectorInteractionPolicy.selection.disabled}
              title={inspectorInteractionPolicy.selection.reason}
              aria-label={selected.type === "bubble" ? "대사 편집" : "글자 편집"}
              data-studio-inspector-primary-text-edit="true"
              data-inspector-priority="essential"
              data-inspector-control-id="element.edit-text"
              onClick={() => startEditText(selected.id)}
              className={buttonClass({
                size: "md",
                variant: "solid",
                className: "min-h-11 w-full justify-between px-3 text-left",
              })}
            >
              <span>{selected.type === "bubble" ? "대사 편집" : "글자 편집"}</span>
              <span className="text-[0.6875rem] font-semibold opacity-80">내용 수정</span>
            </button>
          ) : null}
          {inspectorContentMode === "selection" && matchingSourceId ? (
            <StudioSelectionMatchingPanel
              key={matchingSourceId}
              options={matchingOptions}
              onSelect={selectMatchingElements}
            />
          ) : null}
          {inspectorContentMode === "selection" && (
            <div>
              <StudioFigmaDesignPanel
                metrics={figmaSelectionMetrics}
                disabled={inspectorInteractionPolicy.selection.disabled}
                disabledReason={inspectorInteractionPolicy.selection.reason}
                onChange={applyFigmaSelectionLayoutPatch}
                onZoomToSelection={zoomToSelection}
                onFlipHorizontal={() => flipSelected("horizontal")}
                onFlipVertical={() => flipSelected("vertical")}
              />
            </div>
          )}
          {!hasMultiSelection ? (
            <StudioInspectorSelectionSection model={model} tabA11y={tabA11y} />
          ) : (
            <StudioInspectorMultiSelectionSection model={model} />
          )}
          {inspectorContentMode === "selection" && marqueeIds.length === 2 && (
            <div
              aria-label="도형 결합"
              className="rounded-xl border border-line bg-panel/40 p-3"
            >
              <Suspense fallback={null}>
                <StudioPathBooleanPanel
                  busy={pathBooleanBusy}
                  unavailableReason={pathBooleanInspectorUnavailableReason}
                  onApply={(op) => applyPathBooleanCombine(op)}
                />
              </Suspense>
            </div>
          )}
          <StudioInspectorEmptyCoachSection model={model} />
          <StudioInspectorDrawingSection model={model} />
          <StudioInspectorUnselectedImageTools model={model} tabA11y={tabA11y} />
      </div>
    </StudioInspectorAsideShell>
  );
}