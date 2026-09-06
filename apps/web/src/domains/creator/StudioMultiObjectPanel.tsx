/**
 * Studio 3D 다중 오브젝트 배치 패널(Multi-Object Placement Panel).
 *
 * 3D 씬에 배치된 소품 인스턴스를 리스트로 관리하며,
 * 룸 레이아웃 프리셋 적용, 바닥 스냅, 복제, 삭제, 개별 Transform 슬라이더를 제공한다.
 */

import { Copy, GripVertical, Layers, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  STUDIO_ROOM_LAYOUT_PRESETS,
  type Studio3DObjectInstance,
} from "./studio-multi-object-layout";
import {
  StudioPanelChip,
  StudioSectionHeader,
  StudioSliderRow,
} from "./studio-panel-ui";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";

export interface StudioMultiObjectPanelProps {
  /** 현재 배치된 3D 오브젝트 인스턴스 목록. */
  readonly objects: readonly Studio3DObjectInstance[];
  /** 오브젝트 배치 변경 콜백. */
  readonly onObjectsChange: (objects: readonly Studio3DObjectInstance[]) => void;
  /** 오브젝트 복제 콜백. */
  readonly onDuplicate: (id: string) => void;
  /** 오브젝트 삭제 콜백. */
  readonly onRemove: (id: string) => void;
  /** 바닥 스냅 콜백. */
  readonly onSnapToFloor: (id: string) => void;
  /** 룸 프리셋 적용 콜백. */
  readonly onApplyRoomPreset: (presetId: string) => void;
}

export function StudioMultiObjectPanel({
  objects,
  onDuplicate,
  onRemove,
  onSnapToFloor,
  onApplyRoomPreset,
}: StudioMultiObjectPanelProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <StudioSectionHeader
        title="3D 소품 배치"
        description="룸 프리셋으로 일괄 배치하거나 개별 오브젝트를 관리하세요."
      />

      {/* 룸 레이아웃 프리셋 */}
      <div className="space-y-1">
        <span className="text-xs font-semibold text-fg-2">
          <Layers size={12} className="mr-1 inline-block align-[-2px]" aria-hidden />
          룸 레이아웃 프리셋
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="룸 레이아웃 프리셋">
          {STUDIO_ROOM_LAYOUT_PRESETS.map((preset) => (
            <StudioPanelChip
              key={preset.id}
              onClick={() => onApplyRoomPreset(preset.id)}
              title={preset.label}
            >
              {preset.label.split("(")[0]?.trim() ?? preset.label}
            </StudioPanelChip>
          ))}
        </div>
      </div>

      {/* 배치된 오브젝트 리스트 */}
      <div className="space-y-1">
        <span className="text-xs font-semibold text-fg-2">
          배치된 오브젝트 ({objects.length})
        </span>
        {objects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line/70 bg-card/60 p-3 text-[0.7rem] leading-relaxed text-fg-3">
            배치된 3D 소품이 없습니다. 룸 프리셋을 적용하거나 모델을 추가하세요.
          </p>
        ) : (
          <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-line/50 bg-card/40 p-1">
            {objects.map((obj) => (
              <div
                key={obj.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId((prev) => (prev === obj.id ? null : obj.id))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId((prev) => (prev === obj.id ? null : obj.id));
                  }
                }}
                className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-[0.72rem] transition-colors ${
                  selectedId === obj.id
                    ? "bg-accent/15 text-accent"
                    : "text-fg-2 hover:bg-card/80"
                }`}
              >
                <GripVertical size={11} className="shrink-0 text-fg-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{obj.name}</span>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSnapToFloor(obj.id);
                    }}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "!px-1" })}
                    title="바닥 스냅"
                  >
                    <RotateCcw size={11} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicate(obj.id);
                    }}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "!px-1" })}
                    title="복제"
                  >
                    <Copy size={11} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(obj.id);
                    }}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "!px-1 text-rose-400" })}
                    title="삭제"
                  >
                    <Trash2 size={11} aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 선택된 오브젝트의 Transform 정보 */}
      {selectedId ? (() => {
        const obj = objects.find((o) => o.id === selectedId);
        if (!obj) return null;
        return (
          <div className="space-y-2 rounded-lg border border-line/50 bg-card/40 p-2">
            <span className="text-xs font-semibold text-fg-2">
              「{obj.name}」 Transform
            </span>
            <StudioSliderRow
              label="X"
              min={-10}
              max={10}
              step={0.1}
              value={Math.round(obj.position[0] * 10) / 10}
              onChange={() => {}}
              readout={obj.position[0].toFixed(1)}
            />
            <StudioSliderRow
              label="Y"
              min={-10}
              max={10}
              step={0.1}
              value={Math.round(obj.position[1] * 10) / 10}
              onChange={() => {}}
              readout={obj.position[1].toFixed(1)}
            />
            <StudioSliderRow
              label="Z"
              min={-10}
              max={10}
              step={0.1}
              value={Math.round(obj.position[2] * 10) / 10}
              onChange={() => {}}
              readout={obj.position[2].toFixed(1)}
            />
          </div>
        );
      })() : null}
    </div>
  );
}
