import { useId } from "react";

import {
  describeStudioStabilizerLatency,
  STUDIO_STABILIZER_MODES,
  type StudioStabilizerMode,
} from "./brush/studio-stroke-stabilizer";
import { STABILIZER_MAX } from "./studio-brush";

import { cx } from "@/shared/lib/cx";

export interface StudioLineCorrectionControlsProps {
  stabilizer: number;
  onStabilizerChange: (value: number) => void;
  mode: StudioStabilizerMode;
  onModeChange: (value: StudioStabilizerMode) => void;
  postCorrection: number;
  onPostCorrectionChange: (value: number) => void;
  preserveCorners: boolean;
  onPreserveCornersChange: (value: boolean) => void;
  density?: "compact" | "touch";
  className?: string;
}
export function StudioLineCorrectionControls({
  stabilizer,
  onStabilizerChange,
  mode,
  onModeChange,
  postCorrection,
  onPostCorrectionChange,
  preserveCorners,
  onPreserveCornersChange,
  density = "compact",
  className,
}: StudioLineCorrectionControlsProps) {
  const descriptionId = useId();
  const latencyDescriptionId = useId();
  const touch = density === "touch";
  const selectedMode = STUDIO_STABILIZER_MODES.find((candidate) => candidate.id === mode)
    ?? STUDIO_STABILIZER_MODES[1];
  const latency = describeStudioStabilizerLatency(selectedMode.id, stabilizer);
  const instantResponseActive = selectedMode.id === "standard" && stabilizer <= 0;
  const latencyTone = latency.kind === "instant"
    ? "border-good/35 bg-good/10 text-good"
    : latency.kind === "guided" || (latency.estimatedMs !== null && latency.estimatedMs >= 75)
      ? "border-warn/35 bg-warn/10 text-warn"
      : "border-cool/30 bg-cool/10 text-cool";

  return (
    <section
      aria-label="선 보정"
      className={cx(
        "border-t border-line/35",
        touch ? "mt-2.5 space-y-2.5 pt-2.5" : "space-y-2 pt-2",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cx("font-semibold text-fg-2", touch ? "text-xs" : "text-[0.7rem]")}>선 보정</span>
        <span className="text-[0.62rem] tabular-nums text-fg-3">
          입력 {stabilizer} · 후보정 {postCorrection}
        </span>
      </div>

      <label className={cx("flex items-center justify-between gap-2 text-fg-3", touch ? "text-[0.7rem]" : "text-xs")}>
        <span>입력 안정화</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <input
            type="range"
            min={0}
            max={STABILIZER_MAX}
            step={1}
            value={stabilizer}
            onChange={(event) => onStabilizerChange(Number(event.target.value))}
            aria-label="입력 선 보정 강도"
            aria-describedby={latencyDescriptionId}
            className={cx("cursor-pointer accent-accent", touch ? "h-10 w-full max-w-52" : "w-24")}
          />
          <span className="w-5 text-right tabular-nums">{stabilizer}</span>
        </span>
      </label>

      <label className={cx("flex items-center justify-between gap-3 text-fg-3", touch ? "min-h-11 text-[0.7rem]" : "text-xs")}>
        <span className="shrink-0">보정 방식</span>
        <select
          value={mode}
          onChange={(event) => onModeChange(event.target.value as StudioStabilizerMode)}
          aria-describedby={`${descriptionId} ${latencyDescriptionId}`}
          className={cx(
            "min-w-0 rounded-lg border border-line bg-card px-2 text-fg outline-none focus:border-accent",
            touch ? "min-h-11 flex-1 text-xs" : "h-7 w-32 text-xs"
          )}
        >
          {STUDIO_STABILIZER_MODES.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
          ))}
        </select>
      </label>
      <p id={descriptionId} className="text-[0.62rem] leading-relaxed text-fg-3">
        {selectedMode.description}
      </p>

      <div
        role="group"
        aria-label="입력 반응 예상"
        className={cx(
          "flex items-start justify-between gap-2 rounded-lg border px-2.5 py-2",
          latencyTone
        )}
      >
        <span className="min-w-0">
          <span className="block text-[0.68rem] font-bold tabular-nums">{latency.label}</span>
          <span
            id={latencyDescriptionId}
            className="block text-[0.6rem] leading-relaxed text-fg-3"
          >
            {latency.description}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            onModeChange("standard");
            onStabilizerChange(0);
          }}
          disabled={instantResponseActive}
          aria-pressed={instantResponseActive}
          aria-describedby={latencyDescriptionId}
          aria-label={instantResponseActive
            ? "즉시 반응 사용 중"
            : "즉시 반응: 고정 주기 모드와 입력 보정 0으로 전환"}
          className={cx(
            "inline-flex shrink-0 items-center justify-center rounded-lg border border-line bg-card px-2.5 font-semibold text-fg-2 transition-colors",
            "hover:border-accent/45 hover:bg-raised hover:text-fg disabled:cursor-default disabled:border-good/30 disabled:bg-good/10 disabled:text-good",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            touch ? "min-h-11 text-xs" : "min-h-8 text-[0.68rem]"
          )}
        >
          즉시 반응
        </button>
      </div>

      <label className={cx("flex items-center justify-between gap-2 text-fg-3", touch ? "text-[0.7rem]" : "text-xs")}>
        <span title="펜을 놓은 뒤 좌표를 한 번 더 정리합니다.">그린 후 보정</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <input
            type="range"
            min={0}
            max={STABILIZER_MAX}
            step={1}
            value={postCorrection}
            onChange={(event) => onPostCorrectionChange(Number(event.target.value))}
            aria-label="그린 후 선 보정 강도"
            className={cx("cursor-pointer accent-accent", touch ? "h-10 w-full max-w-52" : "w-24")}
          />
          <span className="w-5 text-right tabular-nums">{postCorrection}</span>
        </span>
      </label>

      <label
        className={cx(
          "flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-card/45 px-2.5 text-fg-2",
          touch ? "min-h-11 text-xs" : "min-h-8 text-xs"
        )}
      >
        <span>
          <span className="block font-medium">각진 선 보존</span>
          {touch ? <span className="block text-[0.62rem] leading-relaxed text-fg-3">말풍선·의상 모서리가 둥글어지는 것을 방지</span> : null}
        </span>
        <input
          type="checkbox"
          checked={preserveCorners}
          onChange={(event) => onPreserveCornersChange(event.target.checked)}
          className={cx("shrink-0 rounded accent-accent", touch ? "size-5" : "size-4")}
        />
      </label>
    </section>
  );
}
