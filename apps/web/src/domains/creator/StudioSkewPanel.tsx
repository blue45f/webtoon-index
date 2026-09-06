/**
 * Studio Skew Panel
 * 선택 요소(이미지/텍스트/스티커)의 자유 변형 "기울이기(Skew)" 인스펙터 —
 * X/Y 기울임 슬라이더(-60..60°) + 스냅 각 칩(0/±15/±30/±45) + 원본 복귀.
 * studio-skew 엔진의 도(°) 값을 props 로 읽고 onPatch/onReset 으로만 쓴다.
 * StudioPage 에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음) — Konva 변환(tangent)은
 * 렌더 측(toKonvaSkewAttrs)이 담당하고, 이 패널은 도 단위만 다룬다.
 */
import { RotateCcw } from "lucide-react";

import { StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import { SKEW_RANGE, SKEW_SNAP_ANGLES, isIdentitySkew, type SkewFields } from "./studio-skew";

import { buttonClass } from "@/shared/components/ui/button-utils";

// 축 슬라이더 정의 — 표시 순서·한글 라벨·기울임 방향 설명(title 툴팁).
const SKEW_AXES: { key: "skewX" | "skewY"; label: string; tip: string }[] = [
  { key: "skewX", label: "가로 기울임 (X)", tip: "윗변을 좌우로 밀어 기울입니다(양수=오른쪽)." },
  { key: "skewY", label: "세로 기울임 (Y)", tip: "왼변을 위아래로 밀어 기울입니다(양수=아래쪽)." },
];

// 양극 도(°) readout — 0/음수는 그대로, 양수만 "+"를 붙여 방향(부호)을 드러낸다.
function formatDeg(n: number): string {
  return `${n > 0 ? "+" : ""}${n}°`;
}

export function StudioSkewPanel({
  value,
  onPatch,
  onReset,
}: {
  value: SkewFields;
  onPatch: (patch: SkewFields) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(양축 0)이면 리셋 비활성 — 저장 규약(미설정==0)과 동일한 판정을 쓴다.
  const isIdentity = isIdentitySkew(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">기울이기 (Skew)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="기울임을 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 축별 슬라이더 + 스냅 각 칩 — 칩은 현재 각과 일치하면 눌림(aria-pressed) 상태로 표시. */}
      {SKEW_AXES.map(({ key, label, tip }) => {
        const current = value[key] ?? 0;
        return (
          <div key={key} className="space-y-1.5">
            <StudioSliderRow
              label={<span title={tip}>{label}</span>}
              min={SKEW_RANGE.min}
              max={SKEW_RANGE.max}
              step={SKEW_RANGE.step}
              value={current}
              onChange={(n) => onPatch({ [key]: n })}
              readout={formatDeg(current)}
            />
            <div className="flex flex-wrap gap-1.5">
              {SKEW_SNAP_ANGLES.map((angle) => (
                <StudioToggleChip
                  key={angle}
                  active={current === angle}
                  onClick={() => onPatch({ [key]: angle })}
                  title={`${label}을 ${angle}°로 스냅합니다.`}
                >
                  {formatDeg(angle)}
                </StudioToggleChip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
