/**
 * Studio Crop Panel
 * 이미지 크롭 도구 인스펙터 — 크롭 모드 토글 + 비율 프리셋(자유/1:1/4:3/16:9) +
 * 초기화/적용/취소.
 *
 * 크롭 rect 상태·드래그는 상위(StudioPage)가 소유하는 fully-controlled 프레젠테이션
 * 컴포넌트다(로컬 상태 없음). 적용은 원본 픽셀을 자연 해상도로 잘라 교체하는 파괴적
 * 작업이지만 patchEl 히스토리 1건이라 ⌘Z 로 되돌릴 수 있다.
 */
import { Check, Crop, RotateCcw, X } from "lucide-react";

import { CROP_ASPECTS, type CropAspectId } from "./studio-crop";
import { StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export type StudioCropPanelProps = {
  /** 크롭 모드 on/off — on 이면 캔버스 위 크롭 rect 오버레이가 조작 가능하다. */
  active: boolean;
  /** 현재 비율 잠금 프리셋. */
  aspect: CropAspectId;
  /** 원본 로드·자르기 진행 중 — 컨트롤 잠금. */
  busy?: boolean;
  /** 적용 가능 여부 — 전체 영역(자를 것 없음)이면 false. */
  canApply?: boolean;
  /** 크롭 모드 토글(진입/종료). */
  onToggle: () => void;
  onAspectChange: (id: CropAspectId) => void;
  /** 크롭 영역을 전체로 초기화. */
  onReset: () => void;
  /** 크롭 적용 — 원본 해상도로 잘라 이미지 교체(히스토리 1건). */
  onApply: () => void;
  /** 크롭 취소 — 영역을 버리고 모드 종료. */
  onCancel: () => void;
};

export function StudioCropPanel({
  active,
  aspect,
  busy = false,
  canApply = false,
  onToggle,
  onAspectChange,
  onReset,
  onApply,
  onCancel,
}: StudioCropPanelProps): ReactElement {
  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      {/* 헤더 + 모드 토글 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">크롭</p>
        <StudioToggleChip
          active={active}
          disabled={busy}
          onClick={onToggle}
          title={
            busy
              ? "현재 크롭을 적용하는 중입니다."
              : active
              ? "크롭 모드를 끕니다(조절 중인 영역은 버려집니다)."
              : "크롭 모드를 켜고 이미지에서 남길 영역을 조절합니다."
          }
        >
          <span className="inline-flex items-center gap-1">
            <Crop className="size-3" aria-hidden />
            {active ? "크롭 중" : "크롭 시작"}
          </span>
        </StudioToggleChip>
      </div>

      {active ? (
        <>
          {/* 비율 잠금 — 다음 핸들 드래그부터 화면 표시 비율이 고정된다. */}
          <div className="flex items-center justify-between gap-2 text-xs text-fg-2">
            비율
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              {CROP_ASPECTS.map((a) => (
                <StudioToggleChip
                  key={a.id}
                  active={aspect === a.id}
                  disabled={busy}
                  onClick={() => onAspectChange(a.id)}
                  title={busy ? "현재 크롭을 적용하는 중입니다." : a.tip}
                >
                  {a.label}
                </StudioToggleChip>
              ))}
            </span>
          </div>

          {/* 사용법 힌트 */}
          <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
            모서리·변 핸들을 드래그해 남길 영역을 조절하고, 안쪽을 끌면 영역이 이동합니다. 적용하면
            원본 해상도로 잘립니다(⌘Z 복구 가능).
          </p>

          {/* 실행 — 적용(파괴적)·초기화·취소 */}
          <div className="flex items-center gap-1.5 border-t border-line/40 pt-2">
            <button
              type="button"
              onClick={onApply}
              disabled={busy || !canApply}
              className={cn(buttonClass({ size: "sm", variant: "solid" }), "flex-1 gap-1")}
              title="크롭을 적용해 선택한 영역만 남깁니다(원본 해상도 유지)."
            >
              <Check className="size-3.5" aria-hidden />
              {busy ? "적용 중..." : "적용"}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className={buttonClass({ size: "sm", variant: "quiet" })}
              title="크롭 영역을 이미지 전체로 되돌립니다."
            >
              <RotateCcw className="size-3.5" aria-hidden />
              초기화
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className={buttonClass({ size: "sm", variant: "quiet" })}
              title="크롭을 취소하고 모드를 종료합니다(Esc)."
            >
              <X className="size-3.5" aria-hidden />
              취소
            </button>
          </div>
        </>
      ) : (
        <p className="text-[0.72rem] leading-relaxed text-fg-3">
          크롭을 시작하면 이미지 위에 조절 핸들이 나타납니다. 비율을 잠그고 원하는 부분만 남겨
          보세요.
        </p>
      )}
    </div>
  );
}
