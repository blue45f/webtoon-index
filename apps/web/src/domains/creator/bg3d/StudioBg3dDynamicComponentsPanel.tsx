import { DoorOpen, ToggleLeft, ToggleRight, Sparkles, Sliders } from "lucide-react";
import React, { useState } from "react";

import {
  DYNAMIC_COMPONENT_PRESETS,
  createDynamicComponent,
  setDynamicComponentValue,
  evaluateDynamicComponentTransform,
  type DynamicComponentKind,
  type DynamicComponentState,
} from "../scene-3d/studio-3d-dynamic-components";

export interface StudioBg3dDynamicComponentsPanelProps {
  readonly onApplyComponentTransform?: (state: DynamicComponentState) => void;
}

export function StudioBg3dDynamicComponentsPanel({
  onApplyComponentTransform,
}: StudioBg3dDynamicComponentsPanelProps): React.JSX.Element {
  const [selectedKind, setSelectedKind] = useState<DynamicComponentKind>("door-single-swing");
  const [componentState, setComponentState] = useState<DynamicComponentState>(() =>
    createDynamicComponent("comp-1", "door-single-swing", false),
  );

  const handleKindSelect = (kind: DynamicComponentKind) => {
    setSelectedKind(kind);
    const next = createDynamicComponent(`comp-${kind}`, kind, false);
    setComponentState(next);
    onApplyComponentTransform?.(next);
  };

  const handleToggle = () => {
    const next = setDynamicComponentValue(componentState, componentState.isOpen ? 0.0 : 1.0);
    setComponentState(next);
    onApplyComponentTransform?.(next);
  };

  const handleSliderChange = (val: number) => {
    const next = setDynamicComponentValue(componentState, val);
    setComponentState(next);
    onApplyComponentTransform?.(next);
  };

  const currentTransform = evaluateDynamicComponentTransform(componentState);

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="flex items-center gap-1.5 font-bold text-fg">
          <DoorOpen className="size-4 text-accent" />
          <span>다이나믹 인터랙션 컴포넌트</span>
        </div>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[0.68rem] text-accent font-semibold">
          {currentTransform.stateLabel}
        </span>
      </div>

      {/* Preset List */}
      <div className="grid grid-cols-2 gap-1.5">
        {DYNAMIC_COMPONENT_PRESETS.map((preset) => (
          <button
            key={preset.kind}
            type="button"
            onClick={() => handleKindSelect(preset.kind)}
            className={`flex flex-col items-start rounded-lg border p-2 text-left transition-all ${
              selectedKind === preset.kind
                ? "border-accent bg-accent/10 font-bold text-accent shadow-sm"
                : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
            }`}
          >
            <span className="text-[0.72rem] leading-tight">{preset.label}</span>
            <span className="mt-0.5 text-[0.62rem] text-fg-3">
              최대 범위: {preset.defaultMaxRange}
              {preset.kind.includes("door") || preset.kind.includes("chest") || preset.kind.includes("book") || preset.kind.includes("wheel") ? "°" : "m"}
            </span>
          </button>
        ))}
      </div>

      {/* Direct Quick Toggle & Slider Controls */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] font-medium text-fg-2">원클릭 열기 / 닫기</span>
          <button
            type="button"
            onClick={handleToggle}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
              componentState.isOpen
                ? "bg-accent text-accent-fg shadow-sm"
                : "border border-line bg-raised text-fg-2 hover:text-fg"
            }`}
          >
            {componentState.isOpen ? (
              <>
                <ToggleRight className="size-4" />
                <span>열림 (Open)</span>
              </>
            ) : (
              <>
                <ToggleLeft className="size-4" />
                <span>닫힘 (Closed)</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1 text-[0.7rem] text-fg-2">
            <Sliders className="size-3 text-fg-3" />
            <span>개방 각도 / 슬라이드 미세 조절:</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={componentState.value}
              onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
              className="h-1.5 w-24 cursor-pointer accent-accent"
            />
            <span className="w-8 text-right font-mono text-xs font-bold text-fg">
              {Math.round(componentState.value * 100)}%
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onApplyComponentTransform?.(componentState)}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.72rem] font-bold text-accent-fg shadow-sm transition-all hover:bg-accent/90"
      >
        <Sparkles className="size-3.5" />
        <span>3D 장면에 인터랙션 상태 적용</span>
      </button>
    </div>
  );
}
