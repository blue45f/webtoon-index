import { RefreshCw } from "lucide-react";

import { formatMarketDateTime } from "../models/market-kind";

interface StaleNoticeBarProps {
  readonly savedAt?: string;
  readonly message?: string;
  readonly onRetry: () => void;
  readonly className?: string;
}

const DEFAULT_CLASS
  = "flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg-2";

// 에러 블록이 아닌 status 안내 — role="alert"로 바꾸면 장애 시 방문자 경험이 퇴행한다.
export function StaleNoticeBar({ savedAt, message, onRetry, className }: StaleNoticeBarProps) {
  return (
    <div role="status" className={className ?? DEFAULT_CLASS}>
      <span>
        {message
          ?? `연결이 불안정해 ${formatMarketDateTime(savedAt ?? new Date().toISOString())}에 저장된 사본을 보여드리고 있어요. 현재 공개 상태는 확인되지 않았어요`}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded border border-line bg-panel px-2 py-1 font-medium text-fg-2 transition-colors duration-150 hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 pointer-coarse:min-h-11 pointer-coarse:px-3"
      >
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
        다시 시도
      </button>
    </div>
  );
}
