/**
 * Studio Puppet Warp Panel
 * 퍼펫 워프(핀 메쉬 변형) 인스펙터 — 모드 토글 + 핀 목록(삭제) + 초기화/적용/취소.
 *
 * 크롭 패널과 동일한 "적용해야 확정되는 파괴적 편집" 패턴이다: 핀을 놓고 드래그하는 동안은
 * 캔버스 위 오버레이(StudioPuppetWarpOverlay)만 실시간으로 갱신되고, 실제 이미지 픽셀은 "적용"을
 * 눌러야 원본 해상도로 구워진다(⌘Z 로 되돌리기 가능한 히스토리 1건). 핀 좌표 자체(추가/삭제/
 * 드래그)는 상위(StudioPage)가 소유하는 fully-controlled 컴포넌트 — 로컬 상태 없음.
 *
 * 핀을 캔버스에 추가하는 제스처(빈 영역 클릭)와 개별 드래그(오버레이의 네이티브 Konva 드래그)는
 * 둘 다 이 패널 밖에서 일어난다 — 이 패널은 "이미 놓인 핀들의 목록 관리 + 실행" 만 담당한다
 * (StudioPerspectivePanel 이 소실점 드래그를 오버레이에 맡기는 것과 동일 역할 분담).
 */
import { Check, RotateCcw, Trash2, Waypoints, X } from "lucide-react";
import { useId } from "react";

import { StudioToggleChip } from "./studio-panel-ui";
import { MAX_PUPPET_PINS, type PuppetPin } from "./studio-puppet-warp";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export type StudioPuppetWarpPanelProps = {
  /** 퍼펫 워프 모드 on/off — on 이면 캔버스 클릭으로 핀을 추가하고 드래그로 옮길 수 있다. */
  active: boolean;
  pins: PuppetPin[];
  /** 원본 로드·굽기 진행 중 — 컨트롤 잠금. */
  busy?: boolean;
  /** 적용 가능 여부 — 핀이 없거나 전부 원본 위치 그대로(변형 없음)면 false. */
  canApply?: boolean;
  /** 모드 토글(진입/종료) — 진입 시 핀 목록을 비운 새 세션으로 시작한다. */
  onToggle: () => void;
  onRemovePin: (id: string) => void;
  /** 핀은 그대로 두고 전부 원본 위치로 되돌린다(드래그만 취소). */
  onResetPositions: () => void;
  /** 적용 — 현재 핀 배치대로 원본 해상도를 왜곡해 이미지 교체(히스토리 1건). */
  onApply: () => void;
  /** 취소 — 핀 전부 버리고 모드 종료(굽기 없음). */
  onCancel: () => void;
};

export function StudioPuppetWarpPanel({
  active,
  pins,
  busy = false,
  canApply = false,
  onToggle,
  onRemovePin,
  onResetPositions,
  onApply,
  onCancel,
}: StudioPuppetWarpPanelProps): ReactElement {
  const statusId = useId();
  const statusText = busy
    ? "퍼펫 워프를 원본 해상도로 적용하는 중입니다. 완료될 때까지 설정을 유지합니다."
    : pins.length === 0
      ? `이미지를 클릭해 핀을 놓으세요(최대 ${MAX_PUPPET_PINS}개). 핀을 드래그하면 주변 메쉬가 함께 움직입니다.`
      : !canApply
        ? "핀을 원본 위치에서 움직여 변형을 만든 뒤 적용하세요."
        : "변형을 적용할 준비가 됐습니다. 적용 전까지 원본 픽셀은 바뀌지 않습니다.";
  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Waypoints size={12} aria-hidden />
          퍼펫 워프
        </p>
        <StudioToggleChip
          active={active}
          disabled={busy}
          onClick={onToggle}
          title={
            busy
              ? "현재 변형을 적용한 뒤 퍼펫 워프를 종료할 수 있습니다."
              : active
              ? "퍼펫 워프를 끕니다(놓은 핀은 버려집니다)."
              : "퍼펫 워프를 켜고 이미지 위에 핀을 놓아 모양을 변형합니다."
          }
        >
          {active ? "조정 중" : "시작"}
        </StudioToggleChip>
      </div>

      {active ? (
        <>
          {pins.length === 0 ? (
            <p id={statusId} className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
              {statusText}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {pins.map((p, index) => {
                const moved = p.x !== p.restX || p.y !== p.restY;
                return (
                  <li key={p.id} className="flex items-center gap-1.5">
                    <span className="w-14 shrink-0 text-[0.68rem] font-semibold text-fg-3">핀 {index + 1}</span>
                    <span
                      className={cn(
                        "flex-1 truncate text-[0.68rem]",
                        moved ? "text-accent" : "text-fg-3"
                      )}
                    >
                      {moved ? "이동됨" : "원본 위치"}
                    </span>
                    <button
                      type="button"
                      aria-label={`핀 ${index + 1} 삭제`}
                      title="이 핀 삭제"
                      disabled={busy}
                      onClick={() => onRemovePin(p.id)}
                      className="grid size-6 shrink-0 place-items-center rounded border border-line text-fg-3 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {pins.length > 0 ? (
            <p id={statusId} className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
              {statusText}
              {!busy && canApply
                ? " 팔다리를 굽히는 정도의 자연스러운 범위를 권장합니다."
                : null}
            </p>
          ) : null}

          <div className="flex items-center gap-1.5 border-t border-line/40 pt-2">
            <button
              type="button"
              onClick={onApply}
              disabled={busy || !canApply}
              aria-describedby={statusId}
              className={cn(buttonClass({ size: "sm", variant: "solid" }), "flex-1 gap-1")}
              title={busy
                ? "현재 변형을 적용하는 중입니다."
                : !canApply
                  ? pins.length === 0
                    ? "이미지에 핀을 먼저 놓으세요."
                    : "핀을 원본 위치에서 움직인 뒤 적용하세요."
                  : "지금 핀 배치대로 이미지를 원본 해상도로 왜곡해 반영합니다(⌘Z 복구 가능)."}
            >
              <Check className="size-3.5" aria-hidden />
              {busy ? "적용 중..." : "적용"}
            </button>
            <button
              type="button"
              onClick={onResetPositions}
              disabled={busy || pins.length === 0}
              aria-describedby={statusId}
              className={buttonClass({ size: "sm", variant: "quiet" })}
              title={busy
                ? "현재 변형을 적용하는 중입니다."
                : pins.length === 0
                  ? "되돌릴 핀이 아직 없습니다."
                  : "핀은 그대로 두고 전부 원본 위치로 되돌립니다."}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              초기화
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className={buttonClass({ size: "sm", variant: "quiet" })}
              title="핀을 전부 버리고 퍼펫 워프를 종료합니다(Esc)."
            >
              <X className="size-3.5" aria-hidden />
              취소
            </button>
          </div>
        </>
      ) : (
        <p className="text-[0.72rem] leading-relaxed text-fg-3">
          퍼펫 워프를 시작하면 이미지 위에 핀을 놓아 인형 관절처럼 부분부분 굽히거나 늘릴 수
          있어요.
        </p>
      )}
    </div>
  );
}
