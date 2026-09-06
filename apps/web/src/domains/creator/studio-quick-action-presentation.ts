// 퀵 액션(6방향 라디얼)과 작업공간 메뉴의 슬롯 미리보기가 공유하는 표시 정보.
// 라벨·아이콘이 두 곳에서 따로 선언되어 서로 어긋났던 것을 단일 출처로 합쳤다
// (복제 아이콘 Copy/CopyPlus, "말풍선"/"말풍선 추가", "혼색"/"혼색 브러시", "닷지·번"/"닷지/번").
import {
  BringToFront,
  Contrast,
  CopyPlus,
  Droplets,
  Eraser,
  Maximize2,
  MessageCirclePlus,
  MousePointer2,
  PaintBucket,
  PenTool,
  Pipette,
  Redo2,
  Scan,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";

import type { StudioQuickActionId } from "./studio-quick-actions";
import type { LucideIcon } from "lucide-react";

export const STUDIO_QUICK_ACTION_PRESENTATION: Record<
  StudioQuickActionId,
  { label: string; Icon: LucideIcon }
> = {
  undo: { label: "되돌리기", Icon: Undo2 },
  redo: { label: "다시 실행", Icon: Redo2 },
  select: { label: "선택", Icon: MousePointer2 },
  pen: { label: "펜", Icon: PenTool },
  eraser: { label: "지우개", Icon: Eraser },
  eyedropper: { label: "스포이트", Icon: Pipette },
  properties: { label: "속성", Icon: SlidersHorizontal },
  duplicate: { label: "복제", Icon: CopyPlus },
  delete: { label: "삭제", Icon: Trash2 },
  "bring-front": { label: "맨 앞으로", Icon: BringToFront },
  "fit-width": { label: "폭 맞춤", Icon: Maximize2 },
  "add-bubble": { label: "말풍선 추가", Icon: MessageCirclePlus },
  "advanced-fill": { label: "고급 채우기", Icon: PaintBucket },
  "quick-mask": { label: "퀵 마스크", Icon: Scan },
  "wet-mix": { label: "혼색 브러시", Icon: Droplets },
  "dodge-burn": { label: "닷지/번", Icon: Contrast },
};
