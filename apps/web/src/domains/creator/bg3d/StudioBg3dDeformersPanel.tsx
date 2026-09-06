import { Move3d, Sparkles } from "lucide-react";
import React, { useState } from "react";

import type {
  DeformerKind,
  MeshDeformerConfig,
} from "../scene-3d/studio-3d-mesh-deformers";

export interface StudioBg3dDeformersPanelProps {
  readonly onApplyDeformer?: (config: MeshDeformerConfig) => void;
}

export function StudioBg3dDeformersPanel({
  onApplyDeformer,
}: StudioBg3dDeformersPanelProps): React.JSX.Element {
  const [kind, setKind] = useState<DeformerKind>("bend");
  const [strength, setStrength] = useState<number>(45);
  const [axis, setAxis] = useState<"x" | "y" | "z">("y");

  const handleKindSelect = (selectedKind: DeformerKind) => {
    setKind(selectedKind);
    let defaultStrength = 45;
    if (selectedKind === "twist") defaultStrength = 90;
    if (selectedKind === "taper") defaultStrength = -0.5;
    if (selectedKind === "squash-stretch") defaultStrength = 0.3;
    if (selectedKind === "noise-displacement") defaultStrength = 1.0;

    setStrength(defaultStrength);
    onApplyDeformer?.({
      kind: selectedKind,
      strength: defaultStrength,
      axis,
      minBound: -1.0,
      maxBound: 1.0,
    });
  };

  const handleStrengthChange = (val: number) => {
    setStrength(val);
    onApplyDeformer?.({
      kind,
      strength: val,
      axis,
      minBound: -1.0,
      maxBound: 1.0,
    });
  };

  const handleAxisSelect = (selectedAxis: "x" | "y" | "z") => {
    setAxis(selectedAxis);
    onApplyDeformer?.({
      kind,
      strength,
      axis: selectedAxis,
      minBound: -1.0,
      maxBound: 1.0,
    });
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="flex items-center gap-1.5 font-bold text-fg">
          <Move3d className="size-4 text-accent" />
          <span>3D 절차적 디포머 (Mesh Deformers)</span>
        </div>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[0.68rem] text-accent font-semibold">
          {axis.toUpperCase()}축 기준
        </span>
      </div>

      {/* Deformer Types */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { id: "bend" as const, label: "구부리기 (Bend)", desc: "아치 및 곡선으로 휘어짐" },
          { id: "twist" as const, label: "비틀기 (Twist)", desc: "스파이럴 회전 꼬임 효과" },
          { id: "taper" as const, label: "테이퍼 (Taper)", desc: "끝단 뾰족화 또는 나팔형 팽창" },
          { id: "squash-stretch" as const, label: "스쿼시 & 스트레치", desc: "만화적 체적 보존 탄성 과장" },
          { id: "noise-displacement" as const, label: "노이즈 왜곡 (Noise)", desc: "유기적인 표면 파동 변형" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleKindSelect(item.id)}
            className={`flex flex-col items-start rounded-lg border p-2 text-left transition-all ${
              kind === item.id
                ? "border-accent bg-accent/10 font-bold text-accent shadow-sm"
                : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
            }`}
          >
            <span className="text-[0.72rem] leading-tight">{item.label}</span>
            <span className="mt-0.5 text-[0.62rem] text-fg-3 line-clamp-1">{item.desc}</span>
          </button>
        ))}
      </div>

      {/* Deformation Parameters */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[0.68rem] text-fg-2">변형 강도 (Strength / Angle):</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={kind === "bend" || kind === "twist" ? "-180" : "-1"}
              max={kind === "bend" || kind === "twist" ? "180" : "2"}
              step={kind === "bend" || kind === "twist" ? "5" : "0.05"}
              value={strength}
              onChange={(e) => handleStrengthChange(parseFloat(e.target.value))}
              className="h-1.5 w-24 cursor-pointer accent-accent"
            />
            <span className="w-12 text-right font-mono text-xs font-bold text-fg">
              {strength}
              {kind === "bend" || kind === "twist" ? "°" : ""}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[0.68rem] text-fg-2">변형 기준 축 (Deform Axis):</span>
          <div className="flex gap-1">
            {(["x", "y", "z"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => handleAxisSelect(a)}
                className={`w-7 rounded py-0.5 font-mono text-[0.68rem] font-bold uppercase transition-all ${
                  axis === a
                    ? "bg-accent text-accent-fg"
                    : "border border-line bg-raised text-fg-2 hover:text-fg"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          onApplyDeformer?.({
            kind,
            strength,
            axis,
            minBound: -1.0,
            maxBound: 1.0,
          })
        }
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.72rem] font-bold text-accent-fg shadow-sm transition-all hover:bg-accent/90"
      >
        <Sparkles className="size-3.5" />
        <span>선택 3D 메쉬에 디포머 변형 적용</span>
      </button>
    </div>
  );
}
