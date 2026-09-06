/**
 * Studio Bubble Anchor Panel
 * 말풍선 꼬리 자동 부착 컨트롤 — 대상 요소(또는 고정 좌표)를 지정하면 이후 대상이나 말풍선이
 * 움직여도 꼬리가 계속 그쪽을 향한다. 대상 지정은 캔버스 클릭(무장 토글)으로 이뤄지며, 이
 * 패널 자신은 클릭도 계산도 하지 않는 순수 컨트롤이다(무장 토글 + 상태 표시 + 해제) — 실제
 * 클릭 처리는 StudioPage 의 onStageDown, 실제 기하 계산은 StudioPage 의 commit()/
 * commitCoalesced() 안에서 studio-bubble-anchor.ts 의 계산 함수들을 호출하는 applyBubbleAnchors
 * 가 커밋마다 담당한다(마술봉·스포이드와 동일하게 "패널은 상태만 보여주고 캔버스 제스처는
 * 상위가 처리").
 *
 * 부착 중에는 위(꼬리 위치 & 방향) 섹션의 방향 버튼·세로/가로 위치·길이 슬라이더가
 * 비활성화된다 — 세 값 모두 이 패널이 자동으로 채우므로 수동 조작이 무의미하기 때문이다
 * (StudioPage 쪽 처리, 이 컴포넌트는 그 사실을 안내 문구로만 알려준다).
 */
import {
  Anchor,
  Crosshair,
  Info,
  Link2,
  MapPin,
  MousePointerClick,
  TriangleAlert,
  Unlink2,
} from "lucide-react";

import { StudioToggleChip } from "../studio-panel-ui";

import type { ReactElement } from "react";

export type StudioBubbleAnchorPanelProps = {
  /** 부착 대상 요소 id — selected.tailAnchorId ?? null. */
  anchorId: string | null;
  /** 부착 대상 고정 좌표(anchorId 가 없을 때만 의미 있음) — selected.tailAnchorPoint ?? null. */
  anchorPoint: { x: number; y: number } | null;
  /** anchorId 로 찾은 대상의 표시 라벨(elementLabel 로 StudioPage 가 미리 빌드). anchorId 가
   *  있는데 이 값이 null 이면 "대상을 찾을 수 없음"(직전 커밋에서 자동 해제된 직후) 상태다. */
  anchorTargetLabel: string | null;
  /** 캔버스 클릭으로 대상을 고르는 무장(armed) 모드. */
  pickActive: boolean;
  onTogglePick: () => void;
  /** 부착 해제 — tailAnchorId/tailAnchorPoint 를 모두 지우고 수동 모드로 복귀. */
  onDetach: () => void;
};

export function StudioBubbleAnchorPanel({
  anchorId,
  anchorPoint,
  anchorTargetLabel,
  pickActive,
  onTogglePick,
  onDetach,
}: StudioBubbleAnchorPanelProps): ReactElement {
  const attached = !!anchorId || !!anchorPoint;

  return (
    <div className="mt-2.5 space-y-2.5 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-2">
          <Anchor size={14} className="shrink-0 text-accent" aria-hidden />
          꼬리 자동 부착
        </p>
        {attached && (
          <button
            type="button"
            onClick={onDetach}
            aria-label="꼬리 자동 부착 해제"
            title="부착을 해제하고 수동으로 꼬리를 조절합니다."
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-3"
          >
            <Unlink2 className="size-3.5 shrink-0" aria-hidden />
            해제
          </button>
        )}
      </div>

      <div className="[&>button]:inline-flex [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:justify-center [&>button]:gap-1.5 [&>button]:px-3 [&>button]:text-xs [&>button]:font-semibold [&>button]:focus-visible:outline-none [&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-accent [&>button]:focus-visible:ring-offset-2 [&>button]:focus-visible:ring-offset-card">
        <StudioToggleChip
          active={pickActive}
          onClick={onTogglePick}
          title="켜고 캔버스에서 요소를 클릭하면 그 요소에 꼬리가 자동으로 부착됩니다. 빈 곳을 클릭하면 그 좌표에 고정됩니다."
        >
          <Crosshair className="size-3.5 shrink-0" aria-hidden />
          {pickActive ? "대상을 클릭하세요…" : attached ? "다시 지정" : "대상 지정"}
        </StudioToggleChip>
      </div>

      {anchorId ? (
        anchorTargetLabel ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-2" role="status" aria-live="polite" aria-atomic="true">
            <Link2 size={14} className="mt-0.5 shrink-0 text-good" aria-hidden />
            <span>
              <strong className="font-semibold text-fg">{anchorTargetLabel}</strong>에 부착됨 — 대상이 움직이면
              꼬리가 따라갑니다.
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-warn" role="status" aria-live="polite" aria-atomic="true">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>부착 대상을 찾을 수 없어요(삭제됨). 부착이 자동으로 해제됩니다.</span>
          </p>
        )
      ) : anchorPoint ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-2" role="status" aria-live="polite" aria-atomic="true">
          <MapPin size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span>
            고정 좌표
            <span className="tabular-nums">({Math.round(anchorPoint.x)}, {Math.round(anchorPoint.y)})</span>에 부착됨 —
            말풍선을 옮기면 꼬리 각도가 따라갑니다.
          </span>
        </p>
      ) : pickActive ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-3" role="status" aria-live="polite" aria-atomic="true">
          <MousePointerClick size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span>캔버스에서 요소를 클릭해 부착 대상으로 지정하세요. 빈 캔버스를 클릭하면 그 좌표에 고정됩니다.</span>
        </p>
      ) : (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-3" role="status" aria-atomic="true">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>대상을 지정하면 대상이나 말풍선이 움직여도 꼬리가 계속 그쪽을 가리켜요.</span>
        </p>
      )}
    </div>
  );
}
