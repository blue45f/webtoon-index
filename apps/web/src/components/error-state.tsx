import { AlertTriangle, RefreshCw } from "lucide-react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

// 데이터 로드 실패 시 페이지들이 공통으로 쓰는 에러 안내 + 재시도 블록.
// role="alert"로 등장 시점에 스크린리더에 실패를 즉시 공지한다.
export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title: string;
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useT();

  return (
    <div
      className={cn(
        "rounded-2xl border border-bad/40 bg-[oklch(0.66_0.2_25/0.12)] p-12 text-center",
        className
      )}
      role="alert"
    >
      <AlertTriangle size={24} className="mx-auto mb-3 text-bad" />
      <p className="text-sm font-medium text-fg">{title}</p>
      {/* 틴트된 에러 표면 위에서 본문 대비 확보 — fg-3은 이 배경에서 흐릿함 → fg-2 */}
      <p className="mt-1 text-sm text-fg-2">{message ?? t("common.loading.empty")}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={buttonClass({ size: "sm", variant: "outline", className: "mt-4 gap-1.5" })}
        >
          <RefreshCw size={14} />
          {t("common.retry.short")}
        </button>
      )}
    </div>
  );
}
