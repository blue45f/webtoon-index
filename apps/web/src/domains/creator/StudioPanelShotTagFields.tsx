/**
 * Studio Panel Shot Tag Fields — 컷(페이지)에 샷 타입/카메라 앵글을 태깅하는 프레젠테이션 컴포넌트.
 * 순수 로직은 studio-panel-shot-tags.ts(카탈로그·withShotTag 커밋 함수)가 담당하고, 이 컴포넌트는
 * 네이티브 <select> 2개를 칩처럼 스타일링해 값 표시 + 변경 이벤트 위임만 한다(로컬 상태 없음).
 *
 * 커스텀 팝오버 대신 네이티브 select를 쓰는 이유:
 * 1) 로컬 열림 상태가 필요 없어, 그리드/스트립처럼 드래그 가능한 카드 안에 둬도 outside-click
 *    핸들러와 충돌하지 않는다(드래그 중 카드가 언마운트될 때 팝오버 상태가 붕 뜨는 문제도 없음).
 * 2) 키보드/스크린리더 기본 접근성을 별도 구현 없이 얻는다.
 * 3) 옵션이 7~11개로 적어 네이티브 UI로도 스캔 비용이 낮다.
 *
 * 값 커밋은 상위(호출측)가 studio-panel-shot-tags.withShotTag 로 페이지 배열을 갱신하는 방식을
 * 기대한다 — 빈 문자열("")을 그대로 patch 값으로 넘겨도 withShotTag 가 미카탈로그 값으로 처리해
 * 키를 제거하므로, 이 컴포넌트는 "" ↔ null 변환을 신경 쓰지 않아도 된다.
 */
import { CAMERA_ANGLES, SHOT_TYPES } from "./studio-panel-shot-tags";

import type { ChangeEvent, ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioPanelShotTagFieldsProps {
  /** studio-panel-shot-tags.SHOT_TYPES 의 id. 미설정/미카탈로그 값은 "선택 안 함" 표시. */
  shotType?: string;
  /** studio-panel-shot-tags.CAMERA_ANGLES 의 id. */
  cameraAngle?: string;
  /** 선택값(빈 문자열 포함) 그대로 전달 — 제거 의미는 호출측(withShotTag)이 해석한다. */
  onShotTypeChange: (value: string) => void;
  onCameraAngleChange: (value: string) => void;
  /** compact = 그리드 카드 같은 좁은 공간, default = 상세 패널. */
  size?: "compact" | "default";
  className?: string;
}

/**
 * 마우스에서는 카드 안에 들어가는 촘촘한 칩, 터치에서는 44px 타깃.
 * 20px(compact)·32px(default) 셀렉트는 손가락으로 열기 어려워 컷 태깅이 사실상 데스크톱
 * 전용 기능이었다 — `pointer-coarse` 는 이 저장소가 이미 쓰는 터치 승격 규칙이다.
 */
const SIZE_CLASS: Record<NonNullable<StudioPanelShotTagFieldsProps["size"]>, string> = {
  compact: "h-5 px-1 text-[9px] pointer-coarse:h-11 pointer-coarse:px-1.5 pointer-coarse:text-[11px]",
  default: "h-8 px-2 text-xs pointer-coarse:h-11",
};

const SELECT_BASE_CLASS =
  "min-w-0 flex-1 rounded-md border border-line bg-card/80 text-fg-2 outline-none transition-colors hover:border-accent/50 focus:border-accent focus:text-fg";

/** 컷 카드/패널에서 상시 노출되는 샷 타입 · 카메라 앵글 셀렉트 한 쌍. */
export function StudioPanelShotTagFields({
  shotType,
  cameraAngle,
  onShotTypeChange,
  onCameraAngleChange,
  size = "default",
  className,
}: StudioPanelShotTagFieldsProps): ReactElement {
  const sizeClass = SIZE_CLASS[size];

  const handleShotType = (e: ChangeEvent<HTMLSelectElement>) => onShotTypeChange(e.target.value);
  const handleCameraAngle = (e: ChangeEvent<HTMLSelectElement>) => onCameraAngleChange(e.target.value);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <select
        value={shotType ?? ""}
        onChange={handleShotType}
        title="샷 타입"
        aria-label="샷 타입"
        className={cn(SELECT_BASE_CLASS, sizeClass)}
      >
        <option value="">샷</option>
        {SHOT_TYPES.map((s) => (
          <option key={s.id} value={s.id} title={s.label}>
            {s.abbr}
          </option>
        ))}
      </select>
      <select
        value={cameraAngle ?? ""}
        onChange={handleCameraAngle}
        title="카메라 앵글"
        aria-label="카메라 앵글"
        className={cn(SELECT_BASE_CLASS, sizeClass)}
      >
        <option value="">앵글</option>
        {CAMERA_ANGLES.map((a) => (
          <option key={a.id} value={a.id} title={a.label}>
            {a.abbr}
          </option>
        ))}
      </select>
    </div>
  );
}
