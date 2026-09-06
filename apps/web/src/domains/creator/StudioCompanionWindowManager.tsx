import { ExternalLink, Images, ListChecks, Map, MonitorCog } from "lucide-react";
import { useState } from "react";

import type { StudioCompanionSurface } from "./studio-tools-companion";

import { cn } from "@/shared/lib/utils";

export type DedicatedCompanionSurface = Extract<
  StudioCompanionSurface,
  "navigator" | "review" | "reference"
>;

export interface StudioCompanionWindowManagerProps {
  disabled: boolean;
  onOpenSurface: (surface: DedicatedCompanionSurface) => boolean;
}

const SURFACES: ReadonlyArray<{
  description: string;
  icon: typeof Map;
  label: string;
  surface: DedicatedCompanionSurface;
}> = [
  {
    surface: "navigator",
    label: "Navigator 전용 창",
    description: "전체 캔버스와 현재 보이는 영역을 계속 표시합니다.",
    icon: Map,
  },
  {
    surface: "review",
    label: "검수 전용 창",
    description: "레이어, 작업 기록과 댓글을 별도 화면에서 확인합니다.",
    icon: ListChecks,
  },
  {
    surface: "reference",
    label: "레퍼런스 전용 창",
    description: "참고 이미지와 색상 피커를 캔버스와 분리해 크게 확인합니다.",
    icon: Images,
  },
];

const SURFACE_NOTICE_LABELS: Readonly<Record<DedicatedCompanionSurface, string>> = {
  navigator: "Navigator",
  review: "검수",
  reference: "레퍼런스",
};

export function StudioCompanionWindowManager({
  disabled,
  onOpenSurface,
}: StudioCompanionWindowManagerProps) {
  const [notice, setNotice] = useState<{ surface: DedicatedCompanionSurface; blocked: boolean } | null>(null);

  function openSurface(surface: DedicatedCompanionSurface) {
    // Keep this callback synchronous: browsers may revoke popup activation after an await.
    const opened = onOpenSurface(surface);
    setNotice({ surface, blocked: !opened });
  }

  return (
    <section aria-labelledby="companion-window-manager-title" className="space-y-2">
      <div className="flex items-start gap-2">
        <MonitorCog className="mt-0.5 size-3.5 shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0">
          <h2 id="companion-window-manager-title" className="text-xs font-semibold uppercase tracking-wider text-fg-3">
            멀티 디스플레이
          </h2>
          <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
            작업공간과 세 전용 창을 독립 배치해 최대 4화면으로 확장할 수 있습니다.
            브라우저 정책에 맞춰 필요한 창을 하나씩 열어 주세요.
          </p>
        </div>
      </div>

      <div
        data-companion-window-list
        className="grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-2"
      >
        {SURFACES.map(({ description, icon: Icon, label, surface }) => (
          <button
            key={surface}
            type="button"
            disabled={disabled}
            aria-label={`${label} 열기 또는 앞으로 가져오기`}
            onClick={() => openSurface(surface)}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-xl border border-line/70 bg-card px-3 py-2 text-left outline-none",
              "transition-colors motion-reduce:transition-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/35",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-raised text-fg-2">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs font-semibold text-fg-2">{label}</strong>
              <span className="mt-0.5 block line-clamp-2 text-[0.66rem] leading-relaxed text-fg-3">
                {description}
              </span>
            </span>
            <ExternalLink className="size-3.5 shrink-0 text-fg-3" aria-hidden />
          </button>
        ))}
      </div>

      {notice ? (
        <p
          role={notice.blocked ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-[0.68rem] leading-relaxed",
            notice.blocked
              ? "border-bad/40 bg-bad/10 text-bad"
              : "border-good/35 bg-good/10 text-good"
          )}
        >
          {notice.blocked
            ? "팝업이 차단됐습니다. 주소창의 팝업 권한을 허용한 뒤 다시 눌러 주세요."
            : `${SURFACE_NOTICE_LABELS[notice.surface]} 창을 열거나 앞으로 가져오도록 요청했습니다.`}
        </p>
      ) : null}
    </section>
  );
}

export default StudioCompanionWindowManager;
