/**
 * Studio Panel Split Tool — 자유선(임의 각도) 패널 분할 도구.
 * studio-panel-split 순수 기하를 Konva 오버레이(캔버스 미리보기)와 사이드 패널(토글/여백/안내)로
 * 그린다. 상태는 전부 상위(StudioPage)가 소유하는 fully-controlled 프레젠테이션 —
 * 이 파일엔 로컬 상태가 없다(StudioCropPanel.tsx 와 동일 관례).
 *
 * StudioPanelSplitOverlay 는 StudioPerspectiveOverlay.tsx / ClipMaskGroup.tsx 와 같은 이유로
 * lazy-load 하지 않는다 — react-konva 트리는 StudioPage 의 <Stage> 안에서만 동작할 수 있다.
 */
import { Scissors } from "lucide-react";
import { Group, Line, Text as KText } from "react-konva/lib/ReactKonvaCore";

import { PANEL_SPLIT_MAX_GUTTER_PX, type PanelSplitPreview } from "./studio-panel-split";
import { StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// 캔버스 오버레이 — 드래그 중인 절단선 + (유효하면) 두 조각 미리보기.
// listening=false — 포인터는 Stage 핸들러(onStageDown/Move/Up)가 처리한다(크롭 오버레이와 동일 관례).
// ---------------------------------------------------------------------------

const VALID_COLOR = "#7c5cfc"; // 앱 accent — 이대로 적용 가능.
const INVALID_COLOR = "#f97316"; // 경고색 — 아직 유효하지 않은 절단선.

export type StudioPanelSplitOverlayProps = {
  /** 진행 중인 드래그의 실시간 미리보기. 드래그 중이 아니면 null(아무것도 그리지 않는다). */
  preview: PanelSplitPreview | null;
  /** 여백(px) — polyA/polyB 라벨 표기용(preview 자체엔 원본 gutterPx 가 없다). */
  gutterPx: number;
  /** Stage effScale — 화면상 고정 두께/글자 크기 유지용(다른 오버레이와 동일한 관례). */
  scale: number;
};

export function StudioPanelSplitOverlay({ preview, gutterPx, scale }: StudioPanelSplitOverlayProps): ReactElement | null {
  if (!preview) return null;
  const [x1, y1, x2, y2] = preview.cutSegment;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  // 절단선에 수직인 방향으로 라벨을 살짝 띄운다.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const offset = 16 / scale;
  const labelX = midX - (dy / len) * offset;
  const labelY = midY + (dx / len) * offset;

  return (
    <Group listening={false}>
      {preview.valid && preview.polyA && (
        <Line points={preview.polyA} closed fill="rgba(124, 92, 252, 0.16)" stroke={VALID_COLOR} strokeWidth={1.5 / scale} />
      )}
      {preview.valid && preview.polyB && (
        <Line points={preview.polyB} closed fill="rgba(124, 92, 252, 0.16)" stroke={VALID_COLOR} strokeWidth={1.5 / scale} />
      )}
      <Line
        points={preview.cutSegment}
        stroke={preview.valid ? VALID_COLOR : INVALID_COLOR}
        strokeWidth={2 / scale}
        dash={[8 / scale, 6 / scale]}
      />
      {preview.valid && (
        <KText
          x={labelX}
          y={labelY}
          text={`여백 ${gutterPx}px`}
          fontSize={12 / scale}
          fill={VALID_COLOR}
          offsetX={20 / scale}
          offsetY={6 / scale}
        />
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// 사이드 패널(선택된 프레임의 속성 도크에 삽입) — 도구 토글 + 여백 슬라이더 + 안내/경고 문구.
// ---------------------------------------------------------------------------

export type StudioPanelSplitPanelProps = {
  /** 도구 무장 on/off. */
  active: boolean;
  gutterPx: number;
  /** 드래그 실패 시 상위가 채우는 1회성 안내 문구. null/undefined 면 숨긴다. */
  hint?: string | null;
  onToggle: () => void;
  onGutterChange: (px: number) => void;
};

export function StudioPanelSplitPanel({
  active,
  gutterPx,
  hint,
  onToggle,
  onGutterChange,
}: StudioPanelSplitPanelProps): ReactElement {
  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      {/* 헤더 + 모드 토글 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">자유선 분할</p>
        <StudioToggleChip
          active={active}
          onClick={onToggle}
          title={active ? "분할 도구를 끕니다." : "패널 위에 원하는 각도로 선을 그으면, 그은 선을 따라 정확히 두 칸으로 나뉩니다."}
        >
          <span className="inline-flex items-center gap-1">
            <Scissors className="size-3" aria-hidden />
            {active ? "분할선 그리는 중" : "자유선 분할 시작"}
          </span>
        </StudioToggleChip>
      </div>

      {active && (
        <>
          <StudioSliderRow
            label="여백(Gutter)"
            min={0}
            max={PANEL_SPLIT_MAX_GUTTER_PX}
            step={2}
            value={gutterPx}
            onChange={onGutterChange}
            readout={`${gutterPx}px`}
          />

          <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
            패널 위를 가로질러 드래그하면 그은 선을 따라 정확히 둘로 나뉩니다. 대각선도 가능해요.
            이미 나뉜 칸을 다시 드래그하면 계속 잘라나갈 수 있어요.
          </p>

          {hint && (
            <p className="text-bad text-[0.72rem] leading-relaxed" role="status">
              {hint}
            </p>
          )}
        </>
      )}
    </div>
  );
}
