import { Suspense } from "react";

import {
  StudioContinuityMetadataEditor,
  StudioPanelSplitPanel,
} from "./studio-page-lazy-ui";
import { studioServerAiProviderLabel } from "./studio-server-ai-client";
import {
  SCENARIO_BEAT_LABELS,
  SCENARIO_BEAT_TYPES,
  type ScenarioBeatType,
} from "./studio-story-beats";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";

import type {
  El,
  FocusLinesEl,
  FrameEl,
  SpeedLinesEl,
} from "./studio-element-model";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioInspectorFocusSpeedFrameControlsProps {
  selected: FocusLinesEl | SpeedLinesEl | FrameEl;
  panelGutter: number;
  panelSplitActive: boolean;
  panelSplitHint: string | null;
  panelSplitRatio: number;
  onPanelGutterChange: (value: number) => void;
  onPanelSplitRatioChange: (value: number) => void;
  onPatch: (patch: Partial<El>) => void;
  onSplitFrame: (orientation: "horizontal" | "vertical") => void;
  onTogglePanelSplit: () => void;
}

export function StudioInspectorFocusSpeedFrameControls({
  selected,
  panelGutter,
  panelSplitActive,
  panelSplitHint,
  panelSplitRatio,
  onPanelGutterChange,
  onPanelSplitRatioChange,
  onPatch,
  onSplitFrame,
  onTogglePanelSplit,
}: StudioInspectorFocusSpeedFrameControlsProps) {
  return (
    <>
      {/* 집중선 및 속도선 선 효과 설정 */}
      {selected.type === "focusLines" && (
        <div className="mt-3 space-y-3 border-t border-line/50 pt-3">
          <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">집중선 설정</p>

          <div className="space-y-1 rounded-lg border border-line bg-card/45 p-2">
            <p className="text-[0.66rem] font-semibold text-fg-3">집중선 프리셋</p>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {[
                { label: "기본 집중선", config: { lineCount: 80, innerRadius: 100, outerRadius: 400, noise: 20, strokeWidth: 2.5 } },
                { label: "강렬한 스릴러", config: { lineCount: 160, innerRadius: 80, outerRadius: 500, noise: 40, strokeWidth: 4.5 } },
                { label: "미세 집중선", config: { lineCount: 140, innerRadius: 120, outerRadius: 400, noise: 10, strokeWidth: 1.2 } },
                { label: "방사형 어둠", config: { lineCount: 180, innerRadius: 155, outerRadius: 320, noise: 30, strokeWidth: 6.0 } },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onPatch(p.config as Partial<El>)}
                  className="rounded-md border border-line bg-panel py-0.5 text-center text-[0.65rem] text-fg-2 hover:bg-raised hover:text-fg font-medium transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            선 개수
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={200}
                step={5}
                value={selected.lineCount ?? 80}
                onChange={(e) => onPatch({ lineCount: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{selected.lineCount ?? 80}</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            내부 반경
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={300}
                step={5}
                value={selected.innerRadius ?? 100}
                onChange={(e) => onPatch({ innerRadius: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{selected.innerRadius ?? 100}px</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            외부 반경
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={100}
                max={800}
                step={10}
                value={selected.outerRadius ?? 400}
                onChange={(e) => onPatch({ outerRadius: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{selected.outerRadius ?? 400}px</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            지터 노이즈
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={2}
                value={selected.noise ?? 20}
                onChange={(e) => onPatch({ noise: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{selected.noise ?? 20}</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            선 색상
            <input
              type="color"
              value={selected.stroke ?? "#000000"}
              onChange={(e) => onPatch({ stroke: e.target.value } as Partial<El>)}
              className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            선 두께
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={selected.strokeWidth ?? 2.5}
                onChange={(e) => onPatch({ strokeWidth: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{(selected.strokeWidth ?? 2.5).toFixed(1)}</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            초점 가로 위치
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={selected.centerXRatio ?? 0.5}
                onChange={(e) => onPatch({ centerXRatio: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{Math.round((selected.centerXRatio ?? 0.5) * 100)}%</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            초점 세로 위치
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={selected.centerYRatio ?? 0.5}
                onChange={(e) => onPatch({ centerYRatio: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{Math.round((selected.centerYRatio ?? 0.5) * 100)}%</span>
            </span>
          </label>
        </div>
      )}

      {selected.type === "speedLines" && (
        <div className="mt-3 space-y-3 border-t border-line/50 pt-3">
          <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">속도선 설정</p>

          <div className="space-y-1 rounded-lg border border-line bg-card/45 p-2">
            <p className="text-[0.66rem] font-semibold text-fg-3">속도선 프리셋</p>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {[
                { label: "가로 질주", config: { direction: "horizontal", lineCount: 50, strokeWidth: 2.5 } },
                { label: "세로 낙하", config: { direction: "vertical", lineCount: 60, strokeWidth: 3.5 } },
                { label: "미세 속도선", config: { lineCount: 100, strokeWidth: 1.2 } },
                { label: "강한 폭발선", config: { lineCount: 35, strokeWidth: 6.0 } },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onPatch(p.config as Partial<El>)}
                  className="rounded-md border border-line bg-panel py-0.5 text-center text-[0.65rem] text-fg-2 hover:bg-raised hover:text-fg font-medium transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
            방향
            <div className="flex gap-1">
              {[
                { label: "가로", v: "horizontal" },
                { label: "세로", v: "vertical" },
              ].map((d) => (
                <button
                  key={d.v}
                  type="button"
                  onClick={() => onPatch({ direction: d.v } as Partial<El>)}
                  className={cn(
                    "rounded-md border px-2.5 py-0.5 text-xs",
                    (selected.direction ?? "horizontal") === d.v
                      ? "border-accent/60 bg-accent-soft/50 text-fg"
                      : "border-line text-fg-2 hover:bg-raised"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            선 개수
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={150}
                step={5}
                value={selected.lineCount ?? 50}
                onChange={(e) => onPatch({ lineCount: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{selected.lineCount ?? 50}</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            선 색상
            <input
              type="color"
              value={selected.stroke ?? "#000000"}
              onChange={(e) => onPatch({ stroke: e.target.value } as Partial<El>)}
              className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
            선 두께
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={selected.strokeWidth ?? 2.5}
                onChange={(e) => onPatch({ strokeWidth: Number(e.target.value) } as Partial<El>)}
                className="w-24 accent-accent cursor-pointer"
              />
              <span className="w-8 text-right text-xs tabular-nums text-fg-3">{(selected.strokeWidth ?? 2.5).toFixed(1)}</span>
            </span>
          </label>
        </div>
      )}

      {selected.type === "frame" && (
        <div className="mt-3 space-y-3 border-t border-line/50 pt-3">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.66rem] font-semibold uppercase tracking-wider text-fg-3">이야기 비트·연속성</p>
              {selected.storyBeat ? (
                <button
                  type="button"
                  onClick={() => onPatch({ storyBeat: undefined } as Partial<El>)}
                  className="text-[0.65rem] font-semibold text-fg-3 hover:text-bad"
                >
                  메타 제거
                </button>
              ) : null}
            </div>
            {selected.storyBeat ? (
              <>
                <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <label className="text-[0.68rem] font-semibold text-fg-3">
                    서사 역할
                    <select
                      value={selected.storyBeat.type}
                      onChange={(event) =>
                        onPatch({
                          storyBeat: {
                            ...selected.storyBeat!,
                            type: event.target.value as ScenarioBeatType,
                          },
                        } as Partial<El>)
                      }
                      className="mt-1 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    >
                      {SCENARIO_BEAT_TYPES.map((beatType) => (
                        <option key={beatType} value={beatType}>{SCENARIO_BEAT_LABELS[beatType]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[0.68rem] font-semibold text-fg-3">
                    장면 변화 요약
                    <textarea
                      value={selected.storyBeat.summary}
                      onChange={(event) =>
                        onPatch({
                          storyBeat: {
                            ...selected.storyBeat!,
                            summary: event.target.value.slice(0, 240),
                          },
                        } as Partial<El>)
                      }
                      rows={2}
                      className="mt-1 w-full resize-y rounded-lg border border-line bg-card px-2 py-1.5 text-xs leading-relaxed text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    />
                  </label>
                </div>
                {selected.storyBeat.textAiProvenance ? (
                  <div className="rounded-lg border border-line bg-card/60 px-2.5 py-2 text-[0.65rem] leading-relaxed text-fg-3">
                    <span className="font-semibold text-fg-2">텍스트 생성 이력</span>
                    <span className="mt-0.5 block break-all">
                      {selected.storyBeat.textAiProvenance.provider} / {selected.storyBeat.textAiProvenance.model}
                      {` · 프롬프트 v${selected.storyBeat.textAiProvenance.promptVersion}`}
                      {selected.storyBeat.textAiProvenance.usage?.totalTokens !== undefined
                        ? ` · ${selected.storyBeat.textAiProvenance.usage.totalTokens.toLocaleString("ko-KR")} tokens`
                        : ""}
                    </span>
                    {selected.storyBeat.textAiProvenance.failover ? (
                      <span className="mt-1 block rounded-md border border-warn/35 bg-warn/10 px-2 py-1 text-warn">
                        {studioServerAiProviderLabel(selected.storyBeat.textAiProvenance.failover.attemptedProvider)} 잔액·패키지 한도 소진으로 {studioServerAiProviderLabel(selected.storyBeat.textAiProvenance.failover.actualProvider)}에 자동 전환
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <Suspense fallback={<StudioPanelLoading label="연속성 메타 편집기를 여는 중..." />}>
                  <StudioContinuityMetadataEditor
                    value={selected.storyBeat.continuity ?? {}}
                    onChange={(continuity) =>
                      onPatch({
                        storyBeat: { ...selected.storyBeat!, continuity },
                      } as Partial<El>)
                    }
                    compact
                  />
                </Suspense>
              </>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onPatch({
                    storyBeat: { type: "transition", summary: "" },
                  } as Partial<El>)
                }
                className={cn(buttonClass({ size: "sm", variant: "quiet" }), "w-full justify-center text-xs")}
              >
                이 컷에 이야기 메타 추가
              </button>
            )}
          </div>
          <div className="border-t border-line/40" />
          <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">패널 컷 분할</p>
          <label className="block">
            <span className="flex items-center justify-between text-xs text-fg-2 mb-1.5">
              <span>분할 비율</span>
              <span className="numeral text-fg-3">{panelSplitRatio}% / {100 - panelSplitRatio}%</span>
            </span>
            <input
              type="range"
              aria-label="분할 비율"
              min={20}
              max={80}
              step={5}
              className="w-full accent-accent cursor-pointer"
              value={panelSplitRatio}
              onChange={(e) => onPanelSplitRatioChange(Number(e.target.value))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onSplitFrame("vertical")}
              className={cn(buttonClass({ size: "sm", variant: "solid" }), "min-h-9 w-full justify-center text-xs")}
            >
              세로로 분할
            </button>
            <button
              type="button"
              onClick={() => onSplitFrame("horizontal")}
              className={cn(buttonClass({ size: "sm", variant: "solid" }), "min-h-9 w-full justify-center text-xs")}
            >
              가로로 분할
            </button>
          </div>

          <Suspense fallback={<StudioPanelLoading label="컷 분할 도구를 여는 중..." />}>
            <StudioPanelSplitPanel
              active={panelSplitActive}
              gutterPx={panelGutter}
              hint={panelSplitHint}
              onToggle={onTogglePanelSplit}
              onGutterChange={onPanelGutterChange}
            />
          </Suspense>

          <div className="mt-3.5 border-t border-line/40 pt-2.5 space-y-2.5">
            <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">패널 배경 및 테두리</p>

            <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
              배경색
              <input
                type="color"
                value={selected.bgColor || "#ffffff"}
                onChange={(e) => onPatch({ bgColor: e.target.value } as Partial<El>)}
                className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
              />
            </label>

            <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
              테두리 커스텀
              <input
                type="checkbox"
                checked={!!selected.stroke}
                aria-label="패널 테두리 커스텀"
                onChange={(e) => {
                  const hasStroke = e.target.checked;
                  onPatch({
                    stroke: hasStroke ? (selected.stroke || "#16100c") : undefined,
                    strokeWidth: hasStroke ? (selected.strokeWidth || 3) : undefined,
                  } as Partial<El>);
                }}
                className="size-4 accent-accent cursor-pointer"
              />
            </div>

            {!!selected.stroke && (
              <>
                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  테두리 색상
                  <input
                    type="color"
                    value={selected.stroke || "#16100c"}
                    onChange={(e) => onPatch({ stroke: e.target.value } as Partial<El>)}
                    className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  테두리 두께
                  <span className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={16}
                      step={0.5}
                      value={selected.strokeWidth ?? 3}
                      onChange={(e) => onPatch({ strokeWidth: Number(e.target.value) } as Partial<El>)}
                      className="w-24 accent-accent cursor-pointer sm:w-28 h-2"
                    />
                    <span className="w-8 text-right text-xs tabular-nums text-fg-3">{(selected.strokeWidth ?? 3).toFixed(1)}px</span>
                  </span>
                </label>

                <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  <span>테두리 스타일</span>
                  <div className="flex gap-1 bg-card rounded-lg p-0.5 border border-line w-28">
                    {[
                      { label: "실선", v: "solid" },
                      { label: "점선", v: "dashed" }
                    ].map((style) => (
                      <button
                        key={style.v}
                        type="button"
                        onClick={() => onPatch({ dashStyle: style.v as "solid" | "dashed" } as Partial<El>)}
                        className={cn(
                          "flex-1 rounded py-0.5 text-[0.66rem] font-semibold transition-colors",
                          (selected.dashStyle ?? "solid") === style.v
                            ? "bg-accent text-on-accent"
                            : "text-fg-2 hover:bg-raised"
                        )}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
