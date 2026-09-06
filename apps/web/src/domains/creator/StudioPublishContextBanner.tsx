import { BookOpen, Layers, Trophy, X } from "lucide-react";

import { cn } from "@/shared/lib/utils";

export type PublishContext = {
  series?: { id: string; title: string; nextEpisodeNo: number } | null;
  challenge?: { id: string; title: string; theme?: string } | null;
};

export function StudioPublishContextBanner({
  context,
  className,
  onDismiss,
}: {
  context: PublishContext;
  className?: string;
  onDismiss?: () => void;
}) {
  const { series, challenge } = context;
  if (!series && !challenge) return null;

  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-start gap-2 rounded-xl border border-accent/35 bg-accent-soft/35 px-3 py-2.5 text-sm text-fg",
        className
      )}
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
        {series ? <Layers size={14} /> : <Trophy size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        {series && (
          <p>
            <span className="font-semibold text-accent">{series.title}</span> 시리즈의{" "}
            <span className="numeral font-bold">{series.nextEpisodeNo}화</span>로 게시됩니다.
          </p>
        )}
        {challenge && (
          <p className={series ? "mt-1" : undefined}>
            챌린지 <span className="font-semibold text-accent">{challenge.title}</span>에 참여합니다.
            {challenge.theme ? (
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-3">{challenge.theme}</span>
            ) : null}
          </p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-fg-3 transition-colors hover:bg-raised hover:text-fg"
          aria-label="게시 맥락 닫기"
        >
          <X size={14} />
        </button>
      )}
      <span className="flex w-full items-center gap-1 text-[0.7rem] text-fg-3 sm:w-auto sm:ml-auto">
        <BookOpen size={11} />
        게시 시 자동 연결 · 설정 변경은 게시 후에도 가능
      </span>
    </div>
  );
}