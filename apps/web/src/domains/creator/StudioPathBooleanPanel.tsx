/**
 * Studio Path Boolean Panel
 * 도형 결합(벡터 패스 불리언) 컨트롤 — 선택한 도형 2개를 합치기/빼기/교차/제외로
 * 하나의 벡터 패스(freehand DrawEl)로 결합한다. 실제 지오메트리 연산은 전용 Worker의
 * CanvasKit PathOps가 담당한다. 이 Worker가 실패하면 원본을 보존한 채 사용 불가로
 * 종료하며 다른 boolean provider를 자동 실행하지 않는다. 문서 권위·단일 Undo 커밋은
 * StudioPage가 유지한다.
 *
 * 완전히 controlled — 내부 비즈니스 상태 없음(StudioExtendedBlendPanel 과 동일 관례).
 * 무장(armed) 도구가 아니라 캔버스 제스처를 바꾸지 않는다 — disarm 연동 불필요.
 */
import { Combine, Loader2 } from "lucide-react";

import { PANEL_CHIP_CLASS } from "./studio-panel-ui";
import { STUDIO_PATH_BOOLEAN_OPS, type StudioPathBooleanOp } from "./studio-path-boolean";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioPathBooleanPanelProps = {
  /** 결합 연산 진행 중 — 모든 버튼을 잠근다(확장 블렌드 병합과 동일 관례). */
  busy?: boolean;
  /**
   * 적용 불가 사유 — 있으면 버튼을 잠그고 사유를 보여준다
   * (면이 있는 그리기 도형 정확히 2개를 함께 선택해야 한다).
   */
  unavailableReason?: string | null;
  /** 연산 1개 적용 — 실제 결합·커밋은 StudioPage 가 수행. */
  onApply: (op: StudioPathBooleanOp) => void;
};

export function StudioPathBooleanPanel({
  busy = false,
  unavailableReason = null,
  onApply,
}: StudioPathBooleanPanelProps): ReactElement {
  const applyDisabled = busy || Boolean(unavailableReason);
  const statusText = busy
    ? "Skia 고품질 경로로 도형을 결합하는 중..."
    : unavailableReason
      ?? "선택한 도형 2개를 곡선 품질을 유지해 하나의 벡터 패스로 결합합니다(⌘Z로 한 번에 되돌리기). 빼기는 아래 도형에서 위 도형을 오려냅니다. 그라데이션·패턴 채우기는 결과에서 단색 채우기로 바뀝니다.";

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Combine size={12} aria-hidden />
          도형 결합
        </p>
        {busy && <Loader2 size={13} className="animate-spin text-accent" aria-hidden />}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {STUDIO_PATH_BOOLEAN_OPS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onApply(entry.id)}
            disabled={applyDisabled}
            title={unavailableReason ?? entry.tip}
            className={cn(
              PANEL_CHIP_CLASS,
              "flex items-center justify-center gap-1",
              !applyDisabled && "border-accent/60 bg-accent-soft/40 text-fg"
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
        {statusText}
      </p>
    </div>
  );
}
