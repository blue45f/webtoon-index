/**
 * StudioAnimTimelinePanel — 페이지 하나의 다중 레이어 애니메이션 타임라인을 편집하는
 * 자체완결 플로팅 패널(StudioFrameAnimationPanel/StudioHistoryPanel과 같은 층위). 문서
 * 데이터(AnimationTimelineDoc)와 트랙 편집 자체는 전부 studio-anim-tracks(순수)가 소유하고,
 * 이 패널은 그 함수들을 호출해 새 문서를 만들어 상위(StudioPage)로 올려보내기만 한다 —
 * 로컬 상태는 전혀 없다(재생 미리보기조차 상위가 playing/playhead로 소유·전달).
 * 실제 캔버스 합성/래스터화 캡처는 StudioPage 몫이라 이 패널은 그리드/설정 UI만 그린다.
 */
import { Eye, EyeOff, GanttChartSquare, Ghost, Lock, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect } from "react";

import {
  MAX_CLIP_NAME_LENGTH,
  MAX_TIMELINE_CLIPS,
  MAX_TIMELINE_FRAME_COUNT,
  MIN_TIMELINE_FRAME_COUNT,
  canAddKeyframe,
  hasTrack,
  isStudioAnimEase,
  onionSkinLayersForTrack,
  renameTimelineClip,
  resolveTrackFrameAt,
  setActiveTimelineClip,
  setDocFps,
  setFrameCount,
  setKeyframeEase,
  setTimelineClip,
  trackKeyframeIndexOf,
  type AnimationTimelineDoc,
  type StudioAnimEase,
} from "./studio-anim-tracks";
import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioRemoveTimelineTrackRequest } from "./studio-destructive-command-catalog";
import { MAX_FRAME_FPS, MIN_FRAME_FPS, type OnionSkinSettings } from "./studio-frame-animation";
import { PANEL_LABEL_ROW, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

// 그리드 셀 치수(px) — CSS 변수가 아니라 상수로 고정한 이유: 재생헤드 세로선을
// 그리드 스크롤 컨테이너 안에서 grid-column 배치로만 계산하므로(레이아웃 흔들림 방지)
// JS 쪽에서 셀 폭을 몰라도 되지만, 라벨 열 폭만은 style 계산에 필요해 상수로 둔다.
const LABEL_COL_PX = 132;
const FRAME_COL_PX = 24;
const ROW_H_PX = 30;

const EASE_OPTIONS: ReadonlyArray<{ readonly value: StudioAnimEase; readonly label: string }> = [
  { value: "linear", label: "선형" },
  { value: "ease-in", label: "가속 (ease-in)" },
  { value: "ease-out", label: "감속 (ease-out)" },
  { value: "ease-in-out", label: "가감속 (ease-in-out)" },
];

function createTimelineClipId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `clip-${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 타임라인 그리드 한 행("트랙 후보") — El.id/elementLabel(el) 상당을 StudioPage가 계산해 넘긴다. */
export interface StudioAnimTimelineRow {
  id: string;
  label: string;
  eligible: boolean; // true=트랙 추가 가능(이미지 레이어 + 단일-셀 애니메이션 미사용). false=표시만.
  hidden: boolean;
  locked: boolean; // isEffectivelyLocked 결과 — true면 키프레임 추가/이동/삭제 비활성
}

export interface StudioAnimTimelinePanelProps {
  doc: AnimationTimelineDoc; // 이미 normalizeAnimationTimelineDoc 적용된 값
  rows: StudioAnimTimelineRow[]; // FRONT 먼저(레이어 패널과 동일 순서) — elements.slice().reverse() 기반
  playhead: number; // 0..doc.frameCount-1
  playing: boolean;
  focusedTrackId: string | null;
  onionSkin: OnionSkinSettings;
  onClose: () => void;
  onDocChange: (next: AnimationTimelineDoc) => void; // fps/frameCount — undo 1스텝
  onScrub: (frameIndex: number) => void; // 재생헤드 이동(칼럼 클릭/드래그)
  onTogglePlay: () => void;
  onFocusTrack: (trackId: string | null) => void;
  onAddKeyframe: (trackId: string) => void; // 캡처는 상위(StudioPage) 책임 — 항상 "현재 재생헤드" 위치에 찍는다
  onRemoveKeyframe: (trackId: string, frameIndex: number) => void;
  onMoveKeyframe: (trackId: string, fromFrameIndex: number, toFrameIndex: number) => void;
  onRemoveTrack: (trackId: string) => void;
  onOnionSkinChange: (settings: OnionSkinSettings) => void;
}

export function StudioAnimTimelinePanel({
  doc,
  rows,
  playhead,
  playing,
  focusedTrackId,
  onionSkin,
  onClose,
  onDocChange,
  onScrub,
  onTogglePlay,
  onFocusTrack,
  onAddKeyframe,
  onRemoveKeyframe,
  onMoveKeyframe,
  onRemoveTrack,
  onOnionSkinChange,
}: StudioAnimTimelinePanelProps): ReactElement {
  const focusedRow = focusedTrackId ? (rows.find((r) => r.id === focusedTrackId) ?? null) : null;
  const focusedTrack = focusedTrackId ? (doc.tracks[focusedTrackId] ?? []) : [];
  const focusedKeyframePos = trackKeyframeIndexOf(focusedTrack, playhead);
  const replacingKeyframe = focusedKeyframePos !== -1;
  const focusedKeyframe = focusedKeyframePos !== -1 ? focusedTrack[focusedKeyframePos] ?? null : null;
  const focusedKeyframeEase: StudioAnimEase = focusedKeyframe?.ease ?? "linear";
  const clips = doc.clips ?? [];
  const playbackDisabledReason =
    doc.frameCount < 2 ? "재생하려면 타임라인이 2프레임 이상이어야 해요." : undefined;
  const addKeyframeDisabledReason = !focusedRow
    ? undefined
    : !focusedRow.eligible
      ? "이미지 레이어이면서 단일 셀 프레임 애니메이션을 사용하지 않는 레이어에서만 키프레임을 만들 수 있어요."
      : focusedRow.locked
        ? "레이어 잠금을 풀면 키프레임을 추가할 수 있어요."
        : !replacingKeyframe && !canAddKeyframe(doc, focusedRow.id)
          ? `키프레임은 트랙당 최대 ${MAX_TIMELINE_FRAME_COUNT}장까지 만들 수 있어요.`
          : undefined;
  // 순수 계산이라 렌더마다 다시 구해도 무방(다른 패널들의 render-time 파생값 관례와 동일 —
  // 예: StudioFrameAnimationPanel의 planFrameAnimationExport). 온스킨 실제 렌더는 캔버스(StudioPage)
  // 몫이지만, "지금 몇 장이 겹쳐 보일지" 미리 안내하는 용도로만 여기서 계산한다.
  const onionPreview = focusedTrackId ? onionSkinLayersForTrack(focusedTrack, playhead, onionSkin) : [];

  // Esc 로 닫기 — 입력 필드 안의 Esc 는 각 필드의 몫(StudioFrameAnimationPanel/StudioHistoryPanel과 동일 규약).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      aria-label="다중 레이어 타임라인"
      className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-5rem)] w-[min(46rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-fg">
          <GanttChartSquare size={13} className="shrink-0 text-fg-3" aria-hidden />
          다중 레이어 타임라인
          <span className="font-medium text-fg-3">
            {doc.frameCount}프레임 · {doc.fps}fps
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="다중 레이어 타임라인 패널 닫기"
          className="grid size-6 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:size-11"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        {/* 툴바 */}
        <div className="space-y-1.5 rounded-xl border border-line bg-card/45 p-2.5">
          <StudioSliderRow
            label="재생 속도 (fps)"
            min={MIN_FRAME_FPS}
            max={MAX_FRAME_FPS}
            step={1}
            value={doc.fps}
            onChange={(next) => onDocChange(setDocFps(doc, next))}
            readout={`${doc.fps}`}
          />
          <label className={PANEL_LABEL_ROW}>
            프레임 길이
            <input
              type="number"
              min={MIN_TIMELINE_FRAME_COUNT}
              max={MAX_TIMELINE_FRAME_COUNT}
              value={doc.frameCount}
              onChange={(e) => {
                const raw = Number(e.target.value);
                if (Number.isFinite(raw)) onDocChange(setFrameCount(doc, raw));
              }}
              className="w-16 rounded-md border border-line bg-canvas px-2 py-1 text-right text-xs text-fg outline-none focus:border-accent/50 pointer-coarse:h-11"
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <StudioToolHintTarget
              disabled={Boolean(playbackDisabledReason)}
              unavailableReason={playbackDisabledReason}
              preferredSide="bottom"
              hint={playing ? {
                id: "timeline-playback-pause",
                title: "타임라인 정지",
                description: "공유 재생헤드를 현재 프레임에 멈춰 모든 레이어의 키프레임 상태를 함께 확인합니다.",
                preview: "timeline",
                previewVariant: "pause",
                tip: "정지한 뒤 눈금이나 빈 프레임 칸을 눌러 원하는 위치로 스크럽할 수 있어요.",
              } : {
                id: "timeline-playback",
                title: "타임라인 재생",
                description: "공유 재생헤드를 움직여 모든 레이어의 키프레임을 같은 시간축에서 미리 봅니다.",
                preview: "timeline",
                previewVariant: "play",
                tip: "재생 중에는 여러 레이어의 타이밍과 겹침을 한 번에 검토할 수 있어요.",
              }}
            >
              <button
                type="button"
                onClick={onTogglePlay}
                disabled={Boolean(playbackDisabledReason)}
                className={cn(buttonClass({ size: "sm", variant: "outline" }), "gap-1.5")}
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
                {playing ? "정지" : "재생"}
              </button>
            </StudioToolHintTarget>
            <span className="text-[0.72rem] tabular-nums text-fg-3">
              재생헤드 {playhead + 1} / {doc.frameCount}
            </span>
          </div>

          {/* Named clip exposure ranges — rename/select without a full multi-timeline editor. */}
          <div className="space-y-1.5 border-t border-line/60 pt-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">
                클립 ({clips.length}/{MAX_TIMELINE_CLIPS})
              </p>
              <button
                type="button"
                data-testid="timeline-clip-add"
                disabled={clips.length >= MAX_TIMELINE_CLIPS}
                title={
                  clips.length >= MAX_TIMELINE_CLIPS
                    ? `클립은 최대 ${MAX_TIMELINE_CLIPS}개까지 만들 수 있어요`
                    : "전체 타임라인을 덮는 이름 있는 클립을 추가합니다"
                }
                onClick={() => {
                  const id = createTimelineClipId();
                  onDocChange(
                    setActiveTimelineClip(
                      setTimelineClip(doc, {
                        id,
                        name: `클립 ${clips.length + 1}`,
                        startFrame: 0,
                        endFrame: Math.max(0, doc.frameCount - 1),
                      }),
                      id,
                    ),
                  );
                }}
                className={cn(buttonClass({ size: "sm", variant: "outline" }), "gap-1 text-[0.7rem]")}
              >
                <Plus size={12} />
                클립 추가
              </button>
            </div>
            {clips.length === 0 ? (
              <p className="text-[0.68rem] leading-relaxed text-fg-3" role="status">
                이름 있는 클립으로 노출 구간을 표시·선택할 수 있어요. 키프레임 데이터와는 별개입니다.
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="timeline-clip-list">
                {clips.map((clip) => {
                  const isActive = doc.activeClipId === clip.id;
                  return (
                    <li
                      key={clip.id}
                      className={cn(
                        "flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5",
                        isActive ? "border-accent/50 bg-accent-soft/40" : "border-line/60 bg-card/40",
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={isActive}
                        title={isActive ? "전체 타임라인으로 돌아가기" : "이 클립 구간을 활성 노출로 사용"}
                        onClick={() =>
                          onDocChange(setActiveTimelineClip(doc, isActive ? null : clip.id))
                        }
                        className={cn(
                          "shrink-0 rounded-md border px-1.5 py-0.5 text-[0.65rem] font-semibold",
                          isActive
                            ? "border-accent/50 bg-accent text-on-accent"
                            : "border-line bg-canvas text-fg-2 hover:bg-raised",
                        )}
                      >
                        {isActive ? "활성" : "선택"}
                      </button>
                      <input
                        type="text"
                        value={clip.name}
                        maxLength={MAX_CLIP_NAME_LENGTH}
                        aria-label={`클립 ${clip.id} 이름`}
                        data-testid={`timeline-clip-rename-${clip.id}`}
                        onChange={(event) => {
                          onDocChange(renameTimelineClip(doc, clip.id, event.target.value));
                        }}
                        className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
                      />
                      <span className="shrink-0 text-[0.62rem] tabular-nums text-fg-3">
                        {clip.startFrame + 1}–{clip.endFrame + 1}f
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 그리드 */}
        {rows.length === 0 ? (
          <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
            이 페이지에는 아직 레이어가 없어요.
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: "16rem" }}>
            <div
              className="grid w-max"
              style={{ gridTemplateColumns: `${LABEL_COL_PX}px repeat(${doc.frameCount}, ${FRAME_COL_PX}px)` }}
            >
              {/* 코너(라벨 열 헤더) */}
              <div
                className="sticky left-0 top-0 z-20 border-b border-r border-line bg-panel"
                style={{ height: ROW_H_PX }}
              />
              {/* 프레임 눈금자 — 5프레임마다 숫자, 클릭하면 그 프레임으로 스크럽 */}
              {Array.from({ length: doc.frameCount }, (_, col) => (
                <button
                  key={`ruler-${col}`}
                  type="button"
                  onClick={() => onScrub(col)}
                  title={`프레임 ${col + 1}로 이동`}
                  className="sticky top-0 z-10 flex items-center justify-center border-b border-r border-line/50 bg-panel text-[0.62rem] tabular-nums text-fg-3 hover:bg-raised"
                  style={{ height: ROW_H_PX }}
                >
                  {col === 0 || col === doc.frameCount - 1 || (col + 1) % 5 === 0 ? col + 1 : ""}
                </button>
              ))}

              {rows.map((row) => {
                const track = doc.tracks[row.id] ?? [];
                const isFocused = row.id === focusedTrackId;
                return (
                  <Fragment key={row.id}>
                    {/* 라벨 열 */}
                    <button
                      type="button"
                      onClick={() => onFocusTrack(isFocused ? null : row.id)}
                      title={`${row.hidden ? "(숨김) " : ""}${row.locked ? "(잠김) " : ""}${row.label}${
                        row.eligible ? "" : " (이미지 레이어만 트랙을 만들 수 있어요)"
                      }`}
                      className={cn(
                        "sticky left-0 z-10 flex items-center gap-1.5 truncate border-b border-r border-line bg-panel px-2 text-left text-[0.72rem] transition-colors",
                        isFocused ? "bg-accent-soft/50 font-semibold text-fg" : "text-fg-2 hover:bg-raised",
                        !row.eligible && "opacity-50"
                      )}
                      style={{ height: ROW_H_PX }}
                    >
                      {row.hidden ? (
                        <EyeOff size={11} className="shrink-0 text-fg-3" aria-hidden />
                      ) : (
                        <Eye size={11} className="shrink-0 text-fg-3/60" aria-hidden />
                      )}
                      {row.locked && <Lock size={10} className="shrink-0 text-fg-3" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    </button>

                    {/* 프레임 칼럼들 */}
                    {Array.from({ length: doc.frameCount }, (_, col) => {
                      const kfPos = trackKeyframeIndexOf(track, col);
                      const isKeyframe = kfPos !== -1;
                      const heldFrame = resolveTrackFrameAt(track, col);
                      const isHeldOnly = heldFrame !== null && !isKeyframe;
                      const isEmpty = heldFrame === null;
                      const isPlayheadCol = col === playhead;
                      const canEdit = row.eligible && !row.locked;
                      const showGhostAdd = isEmpty && canEdit && isPlayheadCol;

                      return (
                        <div
                          key={col}
                          role="button"
                          tabIndex={0}
                          onClick={() => onScrub(col)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            onScrub(col);
                          }}
                          onDoubleClick={() => {
                            if (isKeyframe && canEdit) onRemoveKeyframe(row.id, col);
                          }}
                          onContextMenu={(e) => {
                            if (!isKeyframe || !canEdit) return;
                            e.preventDefault();
                            onRemoveKeyframe(row.id, col);
                          }}
                          onDragOver={(e) => {
                            if (canEdit) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            if (!canEdit) return;
                            e.preventDefault();
                            // payload는 "trackId::frameIndex" — 다른 트랙(행)에서 시작된 드래그를
                            // 이 행에 놓으면 무시한다(그렇지 않으면 우연히 같은 frameIndex에 이
                            // 행 자신의 키프레임이 있을 때 엉뚱한 키프레임이 옮겨진다).
                            const raw = e.dataTransfer.getData("text/plain");
                            const sepIdx = raw.lastIndexOf("::");
                            if (sepIdx === -1) return;
                            const sourceTrackId = raw.slice(0, sepIdx);
                            if (sourceTrackId !== row.id) return;
                            const from = Number(raw.slice(sepIdx + 2));
                            if (Number.isFinite(from)) onMoveKeyframe(row.id, from, col);
                          }}
                          title={
                            isKeyframe
                              ? `프레임 ${col + 1} 키프레임 — 더블클릭/우클릭으로 삭제, 드래그로 이동`
                              : `프레임 ${col + 1}${showGhostAdd ? " — 여기에 키프레임 추가" : ""}`
                          }
                          className={cn(
                            "group relative flex items-center justify-center border-b border-r border-line/30",
                            !row.eligible && "opacity-40",
                            isPlayheadCol ? "bg-accent-soft/20" : "hover:bg-raised/60"
                          )}
                          style={{ height: ROW_H_PX }}
                        >
                          {isHeldOnly && <span aria-hidden className="h-px w-full bg-line-strong/70" />}
                          {isKeyframe && (
                            <button
                              type="button"
                              draggable={canEdit}
                              onDragStart={(e) => {
                                if (!canEdit) return;
                                e.dataTransfer.setData("text/plain", `${row.id}::${col}`);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onScrub(col);
                                onFocusTrack(row.id);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (canEdit) onRemoveKeyframe(row.id, col);
                              }}
                              onKeyDown={(e) => {
                                if (!canEdit || (e.key !== "Delete" && e.key !== "Backspace")) return;
                                e.preventDefault();
                                e.stopPropagation();
                                onRemoveKeyframe(row.id, col);
                              }}
                              aria-label={`${row.label} 프레임 ${col + 1} 키프레임 — 선택하려면 클릭, 삭제하려면 더블클릭/Delete, 이동하려면 드래그`}
                              className={cn(
                                "size-2.5 rounded-full border border-line-strong/60 bg-accent",
                                canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                              )}
                            />
                          )}
                          {showGhostAdd && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddKeyframe(row.id);
                              }}
                              aria-label={`${row.label} 프레임 ${col + 1}에 키프레임 추가`}
                              className="absolute inset-0 hidden items-center justify-center text-fg-3 hover:text-accent group-hover:flex"
                            >
                              <Plus size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}

              {/* 재생헤드 세로선 — grid-column/row 배치로 스크롤 컨테이너 안에서 함께 스크롤된다. */}
              <div
                aria-hidden
                className="pointer-events-none z-10 w-px justify-self-center bg-accent"
                style={{ gridColumn: playhead + 2, gridRow: `1 / span ${rows.length + 1}` }}
              />
            </div>
          </div>
        )}

        {/* 포커스된 트랙 보조 영역 */}
        {focusedRow && (
          <div className="space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-fg">{focusedRow.label}</p>
              <button
                type="button"
                onClick={() => onFocusTrack(null)}
                className="shrink-0 text-[0.7rem] text-fg-3 hover:text-fg"
              >
                선택 해제
              </button>
            </div>

            <StudioToolHintTarget
              className="w-full"
              disabled={Boolean(addKeyframeDisabledReason)}
              unavailableReason={addKeyframeDisabledReason}
              preferredSide="left"
              hint={{
                id: "timeline-keyframe-add",
                title: replacingKeyframe ? "현재 키프레임 갱신" : "현재 위치에 키프레임 추가",
                description: replacingKeyframe
                  ? "현재 재생헤드에 있는 키프레임을 레이어의 최신 모습으로 다시 캡처합니다."
                  : "현재 재생헤드 위치의 레이어 모습을 캡처해 새 키프레임으로 기록합니다.",
                preview: "keyframe",
                tip: "다른 프레임으로 이동해 모습을 바꾸고 키프레임을 더하면 타임라인에서 이어 재생할 수 있어요.",
              }}
            >
              <button
                type="button"
                onClick={() => onAddKeyframe(focusedRow.id)}
                disabled={Boolean(addKeyframeDisabledReason)}
                className={cn(buttonClass({ size: "sm", variant: "solid" }), "w-full gap-1.5")}
              >
                <GanttChartSquare size={13} />
                현재 프레임({playhead + 1}) 키프레임 {replacingKeyframe ? "갱신" : "추가"}
              </button>
            </StudioToolHintTarget>

            {focusedKeyframe && focusedRow.eligible && !focusedRow.locked ? (
              <label className={PANEL_LABEL_ROW}>
                이징 (프레임 {playhead + 1})
                <select
                  value={focusedKeyframeEase}
                  aria-label={`프레임 ${playhead + 1} 키프레임 이징`}
                  data-testid="timeline-keyframe-ease"
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!isStudioAnimEase(next)) return;
                    onDocChange(setKeyframeEase(doc, focusedRow.id, playhead, next));
                  }}
                  className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
                >
                  {EASE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {!focusedRow.eligible && (
              <p className="text-[0.7rem] text-fg-3" role="status">
                이미지 레이어이면서 단일-셀 프레임 애니메이션을 쓰지 않을 때만 트랙을 만들 수 있어요.
              </p>
            )}
            {focusedRow.eligible && focusedRow.locked && (
              <p className="text-[0.7rem] text-fg-3" role="status">
                잠긴 레이어예요. 잠금을 풀면 키프레임을 편집할 수 있어요.
              </p>
            )}
            {focusedRow.eligible && !focusedRow.locked && !canAddKeyframe(doc, focusedRow.id) && (
              <p className="text-[0.7rem] text-fg-3" role="status">
                키프레임은 트랙당 최대 {MAX_TIMELINE_FRAME_COUNT}장까지 만들 수 있어요.
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                if (!hasTrack(doc, focusedRow.id)) return;
                void (async () => {
                  if (
                    !(await confirmStudioDestructiveAction(
                      studioRemoveTimelineTrackRequest(focusedRow.label)
                    ))
                  ) return;
                  onRemoveTrack(focusedRow.id);
                })();
              }}
              disabled={!hasTrack(doc, focusedRow.id)}
              title={hasTrack(doc, focusedRow.id) ? undefined : "삭제할 키프레임이 없어요"}
              className={cn(buttonClass({ size: "sm", variant: "quiet", className: "gap-1.5 text-bad hover:text-bad" }), "w-full")}
            >
              <Trash2 size={13} />
              이 레이어 트랙 삭제
            </button>

            {/* 어니언스키닝 — StudioFrameAnimationPanel의 동일 블록을 이식(설정만 컨트롤, 실제 렌더는 StudioPage). */}
            <div className="space-y-1.5 border-t border-line/60 pt-2">
              <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">
                <Ghost size={12} aria-hidden />
                어니언스키닝
              </p>
              <StudioToolHintTarget
                preferredSide="left"
                hint={{
                  id: "timeline-onion-skin",
                  title: "어니언스키닝",
                  description: "현재 키프레임 앞뒤의 레이어 모습을 반투명하게 겹쳐 동작의 간격을 맞춥니다.",
                  preview: "onion-skin",
                  tip: "이전 프레임은 빨강, 다음 프레임은 파랑으로 구분하면 움직임 방향을 빠르게 읽을 수 있어요.",
                }}
              >
                <StudioToggleChip
                  active={onionSkin.enabled}
                  onClick={() => onOnionSkinChange({ ...onionSkin, enabled: !onionSkin.enabled })}
                >
                  어니언스키닝 사용
                </StudioToggleChip>
              </StudioToolHintTarget>
              {onionSkin.enabled && (
                <>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "timeline-onion-prev-count",
                      title: "이전 프레임 수",
                      description: "현재 위치보다 앞선 키프레임을 최대 3장까지 겹쳐 표시합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <StudioSliderRow
                      label="이전 프레임 수"
                      min={0}
                      max={3}
                      step={1}
                      value={onionSkin.prevCount}
                      onChange={(next) => onOnionSkinChange({ ...onionSkin, prevCount: next })}
                    />
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "timeline-onion-next-count",
                      title: "다음 프레임 수",
                      description: "현재 위치보다 뒤의 키프레임을 최대 3장까지 겹쳐 표시합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <StudioSliderRow
                      label="다음 프레임 수"
                      min={0}
                      max={3}
                      step={1}
                      value={onionSkin.nextCount}
                      onChange={(next) => onOnionSkinChange({ ...onionSkin, nextCount: next })}
                    />
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "timeline-onion-opacity",
                      title: "어니언스킨 투명도",
                      description: "앞뒤 키프레임이 현재 그림을 가리지 않도록 겹침 강도를 조절합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <StudioSliderRow
                      label="투명도"
                      min={0.1}
                      max={0.8}
                      step={0.05}
                      value={onionSkin.opacity}
                      onChange={(next) => onOnionSkinChange({ ...onionSkin, opacity: next })}
                      readout={`${Math.round(onionSkin.opacity * 100)}%`}
                    />
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "timeline-onion-tint",
                      title: "앞뒤 프레임 색 구분",
                      description: "이전 키프레임은 빨강, 다음 키프레임은 파랑으로 표시해 시간 방향을 구분합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-2">
                      <input
                        type="checkbox"
                        checked={onionSkin.tint}
                        onChange={(e) => onOnionSkinChange({ ...onionSkin, tint: e.target.checked })}
                        className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                      />
                      색으로 구분 (이전=빨강 · 다음=파랑)
                    </label>
                  </StudioToolHintTarget>
                  <p className="text-[0.7rem] text-fg-3" role="status">
                    지금 위치 기준 {onionPreview.length}장이 겹쳐 보여요.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
