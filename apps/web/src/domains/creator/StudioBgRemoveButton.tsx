import { Layers3, Loader2, Scissors, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/shared/lib/utils";

interface StudioBgRemoveButtonProps {
  readonly src: string;
  /** Legacy destructive quick action. The new layer-lift path remains non-destructive. */
  readonly onResult: (dataUrl: string) => void;
  readonly onOpenLayerLift?: () => void;
  readonly layerLiftDisabledReason?: string | null;
}

// One local extraction surface: the primary action preserves the source and creates layers;
// quick background removal remains available as an explicitly destructive secondary action.
export function StudioBgRemoveButton({
  src,
  onResult,
  onOpenLayerLift,
  layerLiftDisabledReason = null,
}: StudioBgRemoveButtonProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Foreground segmentation is an explicit secondary action. Keep its validation,
      // MediaPipe arbiter, WASM asset resolver, and pixel compositor out of Studio startup.
      const { removeBackground } = await import("./studio-bg-remove");
      const result = await removeBackground(src);
      onResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "배경 제거에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-xl border border-line bg-panel/50"
    >
      <div className="flex items-start gap-2.5 border-b border-line px-3 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent-soft text-accent">
          <Layers3 size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-xs font-bold text-fg">
            로컬 레이어 추출
          </h3>
          <p className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">
            픽셀을 업로드하지 않고 인물·캐릭터와 배경을 분리합니다.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-good/30 bg-good/10 px-2 py-1 text-[0.58rem] font-bold text-good">
          <ShieldCheck size={11} aria-hidden />
          기기 처리
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <button
          type="button"
          onClick={onOpenLayerLift}
          disabled={!onOpenLayerLift || Boolean(layerLiftDisabledReason)}
          aria-describedby={layerLiftDisabledReason
            ? `${descriptionId}-disabled`
            : descriptionId}
          className={cn(
            "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent/90",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "disabled:cursor-not-allowed disabled:opacity-45",
          )}
        >
          <Layers3 size={15} aria-hidden />
          컷 레이어 복원
          <span className="rounded-full bg-on-accent/15 px-1.5 py-0.5 text-[0.56rem]">
            Beta
          </span>
        </button>
        <p
          id={layerLiftDisabledReason
            ? `${descriptionId}-disabled`
            : descriptionId}
          role={layerLiftDisabledReason ? "status" : undefined}
          className={cn(
            "text-[0.66rem] leading-relaxed",
            layerLiftDisabledReason ? "text-warn" : "text-fg-3",
          )}
        >
          {layerLiftDisabledReason
            ?? "원본 백업·분리 배경·분리 전경을 한 그룹으로 만들며, 실행 취소 한 번으로 되돌립니다."}
        </p>
        <div className="h-px bg-line" aria-hidden />
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {busy
            ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
            : <Scissors size={14} aria-hidden />}
          {busy ? "배경 제거 중…" : "빠른 배경 제거"}
        </button>
        {error ? (
          <p role="alert" className="text-xs text-bad">{error}</p>
        ) : (
          <p className="text-[0.66rem] leading-relaxed text-fg-3">
            {busy
              ? "처음 한 번만 로컬 모델을 준비합니다. 원본 이미지는 서버로 보내지 않습니다."
              : "선택 레이어 자체를 투명 PNG로 바꾸는 빠른 작업입니다. 원본 보존이 필요하면 위 기능을 사용하세요."}
          </p>
        )}
      </div>
    </section>
  );
}
