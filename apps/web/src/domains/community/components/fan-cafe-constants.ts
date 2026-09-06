import { KIND_LABEL } from "./fan-cafe-utils";

import type { FanCafePostKind } from "@/shared/lib/types";

export const TAG_CHIP_LIMIT = 10;
export const FAN_CAFE_REPLY_MAX_LENGTH = 700;
export const FAN_CAFE_POST_TITLE_MAX_LENGTH = 80;
export const FAN_CAFE_POST_TEXT_MAX_LENGTH = 1200;
export const FAN_CAFE_POST_TAGS_MAX_LENGTH = 80;
export const FAN_CAFE_ACTIVITY_STORAGE_KEY = "toonspectrum-fan-cafe-activity-log-v1";

export type FanCafeKindFilter = FanCafePostKind | "all";

export const KIND_ITEMS: { value: FanCafeKindFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "talk", label: KIND_LABEL.talk },
  { value: "theory", label: KIND_LABEL.theory },
  { value: "fanart", label: KIND_LABEL.fanart },
  { value: "cheer", label: KIND_LABEL.cheer },
];

export const MAX_REPLY_DEPTH = 4;

// 글쓰기 잠금(예: 장르 카페 미가입) — 잠금 사유와 해제 액션을 패널 밖에서 주입한다.
export interface FanCafeComposeLock {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}
