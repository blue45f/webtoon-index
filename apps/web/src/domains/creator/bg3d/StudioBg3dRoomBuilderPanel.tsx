// "3D 배경" 템플릿 탭의 방 만들기(파라메트릭 블로킹) 패널 — SketchUp처럼 치수·오프닝·가구를
// 수치로 조정해 방 한 칸을 절차 생성한다. 프레젠테이션 전용(무상태): 스펙 상태와 "추가" 액션은
// 모두 부모(StudioBackground3D.tsx)가 소유한다 — StudioBg3dSceneTemplatePanel과 같은 계약.
// 스펙 변경은 raw 값 그대로 올리고, clamp는 부모가 clampStudioBg3dRoomSpec으로 한 곳에서 한다.
import { DoorOpen, Home, Plus, Trash2 } from "lucide-react";

import { LtRangeControl } from "./studio-bg3d-control-fields";
import {
  STUDIO_BG3D_ROOM_FURNITURE_KINDS,
  STUDIO_BG3D_ROOM_FURNITURE_LABELS,
  STUDIO_BG3D_ROOM_LIMITS,
  STUDIO_BG3D_ROOM_PRESETS,
  STUDIO_BG3D_ROOM_WALL_IDS,
  STUDIO_BG3D_ROOM_WALL_LABELS,
  buildStudioBg3dRoomParts,
  type StudioBg3dRoomFurnitureKind,
  type StudioBg3dRoomOpening,
  type StudioBg3dRoomSpec,
  type StudioBg3dRoomWallId,
} from "./studio-bg3d-room-builder";

import { cx } from "@/shared/lib/cx";

export interface StudioBg3dRoomBuilderPanelProps {
  readonly spec: StudioBg3dRoomSpec;
  readonly disabled?: boolean;
  /** raw 스펙을 그대로 전달 — 부모가 clampStudioBg3dRoomSpec으로 정규화해 저장한다. */
  readonly onSpecChange: (next: StudioBg3dRoomSpec) => void;
  readonly onApplyPreset: (presetId: string) => void;
  readonly onInsert: () => void;
}

const NUMBER_INPUT =
  "w-full min-w-0 rounded-md border border-line bg-card px-1.5 py-1 text-right text-[0.7rem] tabular-nums text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";
const SELECT_INPUT =
  "min-h-8 w-full min-w-0 rounded-md border border-line bg-card px-1 text-[0.68rem] text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

function updateOpening(
  spec: StudioBg3dRoomSpec,
  index: number,
  patch: Partial<StudioBg3dRoomOpening>,
): StudioBg3dRoomSpec {
  return {
    ...spec,
    openings: spec.openings.map((opening, i) => (i === index ? { ...opening, ...patch } : opening)),
  };
}

export function StudioBg3dRoomBuilderPanel({
  spec,
  disabled = false,
  onSpecChange,
  onApplyPreset,
  onInsert,
}: StudioBg3dRoomBuilderPanelProps) {
  const limits = STUDIO_BG3D_ROOM_LIMITS;
  const partCount = buildStudioBg3dRoomParts(spec).length;

  const commitNumber = (value: string, apply: (parsed: number) => void) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) apply(parsed);
  };

  return (
    <div>
      <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
        바닥과 벽 4면, 문·창 오프닝, 가구를 수치로 조정해 방 한 칸을 만듭니다. 씬 템플릿과 달리
        추가하기 전에 크기와 배치를 자유롭게 바꿀 수 있어요.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="방 프리셋">
        {STUDIO_BG3D_ROOM_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.description}
            disabled={disabled}
            className="rounded-full border border-line bg-card px-2.5 py-1 text-[0.68rem] font-semibold text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => onApplyPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-card/70 px-3 py-2">
        <LtRangeControl
          id="bg3d-room-width"
          label="가로 폭"
          min={limits.minWidth}
          max={limits.maxWidth}
          step={0.5}
          value={spec.width}
          valueText={`${spec.width}m`}
          disabled={disabled}
          onChange={(width) => onSpecChange({ ...spec, width })}
        />
        <LtRangeControl
          id="bg3d-room-depth"
          label="세로 깊이"
          min={limits.minDepth}
          max={limits.maxDepth}
          step={0.5}
          value={spec.depth}
          valueText={`${spec.depth}m`}
          disabled={disabled}
          onChange={(depth) => onSpecChange({ ...spec, depth })}
        />
        <LtRangeControl
          id="bg3d-room-wall-height"
          label="벽 높이"
          min={limits.minWallHeight}
          max={limits.maxWallHeight}
          step={0.1}
          value={spec.wallHeight}
          valueText={`${spec.wallHeight}m`}
          disabled={disabled}
          onChange={(wallHeight) => onSpecChange({ ...spec, wallHeight })}
        />
        <LtRangeControl
          id="bg3d-room-wall-thickness"
          label="벽 두께"
          min={limits.minWallThickness}
          max={limits.maxWallThickness}
          step={0.01}
          value={spec.wallThickness}
          valueText={`${Math.round(spec.wallThickness * 100)}cm`}
          disabled={disabled}
          onChange={(wallThickness) => onSpecChange({ ...spec, wallThickness })}
        />
        <div className="grid grid-cols-2 gap-2 pt-2">
          <label className="flex items-center justify-between gap-2 text-[0.68rem] font-semibold text-fg-2">
            바닥색
            <input
              type="color"
              aria-label="방 바닥색"
              value={spec.floorColor}
              disabled={disabled}
              onChange={(event) => onSpecChange({ ...spec, floorColor: event.target.value })}
              className="size-8 cursor-pointer rounded-md border border-line bg-transparent p-0.5"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[0.68rem] font-semibold text-fg-2">
            벽색
            <input
              type="color"
              aria-label="방 벽색"
              value={spec.wallColor}
              disabled={disabled}
              onChange={(event) => onSpecChange({ ...spec, wallColor: event.target.value })}
              className="size-8 cursor-pointer rounded-md border border-line bg-transparent p-0.5"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-line bg-card/70 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-fg">
            <DoorOpen size={13} className="text-accent" aria-hidden />
            문 · 창 오프닝
          </h4>
          <span className="flex gap-1">
            <button
              type="button"
              disabled={disabled || spec.openings.length >= limits.maxOpenings}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-line bg-card px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => onSpecChange({
                ...spec,
                openings: [
                  ...spec.openings,
                  { wall: "south", type: "door", centerOffset: 0, width: 0.95, height: 2.05, sillHeight: 0 },
                ],
              })}
            >
              <Plus size={12} aria-hidden />문
            </button>
            <button
              type="button"
              disabled={disabled || spec.openings.length >= limits.maxOpenings}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-line bg-card px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => onSpecChange({
                ...spec,
                openings: [
                  ...spec.openings,
                  { wall: "east", type: "window", centerOffset: 0, width: 1.5, height: 1.1, sillHeight: 0.9 },
                ],
              })}
            >
              <Plus size={12} aria-hidden />창
            </button>
          </span>
        </div>
        {spec.openings.length === 0 ? (
          <p className="py-1 text-[0.66rem] leading-relaxed text-fg-3">
            아직 오프닝이 없어요. 문·창을 추가하면 벽이 자동으로 갈라집니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {spec.openings.map((opening, index) => (
              <li
                key={index}
                className="rounded-lg border border-line/70 bg-panel/60 p-2"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span
                    className={cx(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold",
                      opening.type === "door" ? "bg-accent-soft text-accent" : "bg-raised text-fg-2",
                    )}
                  >
                    {opening.type === "door" ? "문" : "창"}
                  </span>
                  <select
                    aria-label={`오프닝 ${index + 1} 벽 선택`}
                    className={SELECT_INPUT}
                    value={opening.wall}
                    disabled={disabled}
                    onChange={(event) => onSpecChange(
                      updateOpening(spec, index, { wall: event.target.value as StudioBg3dRoomWallId }),
                    )}
                  >
                    {STUDIO_BG3D_ROOM_WALL_IDS.map((wall) => (
                      <option key={wall} value={wall}>{STUDIO_BG3D_ROOM_WALL_LABELS[wall]}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`오프닝 ${index + 1} 삭제`}
                    disabled={disabled}
                    className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-fg-3 hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => onSpecChange({
                      ...spec,
                      openings: spec.openings.filter((_, i) => i !== index),
                    })}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
                <div className={cx("grid gap-1.5", opening.type === "window" ? "grid-cols-4" : "grid-cols-3")}>
                  <label className="min-w-0 text-[0.62rem] font-semibold text-fg-3">
                    위치
                    <input
                      type="number"
                      aria-label={`오프닝 ${index + 1} 위치 오프셋(m)`}
                      step={0.1}
                      value={opening.centerOffset}
                      disabled={disabled}
                      className={NUMBER_INPUT}
                      onChange={(event) => commitNumber(event.target.value, (centerOffset) =>
                        onSpecChange(updateOpening(spec, index, { centerOffset })))}
                    />
                  </label>
                  <label className="min-w-0 text-[0.62rem] font-semibold text-fg-3">
                    폭
                    <input
                      type="number"
                      aria-label={`오프닝 ${index + 1} 폭(m)`}
                      step={0.1}
                      min={0.3}
                      value={opening.width}
                      disabled={disabled}
                      className={NUMBER_INPUT}
                      onChange={(event) => commitNumber(event.target.value, (width) =>
                        onSpecChange(updateOpening(spec, index, { width })))}
                    />
                  </label>
                  <label className="min-w-0 text-[0.62rem] font-semibold text-fg-3">
                    높이
                    <input
                      type="number"
                      aria-label={`오프닝 ${index + 1} 높이(m)`}
                      step={0.1}
                      min={0.2}
                      value={opening.height}
                      disabled={disabled}
                      className={NUMBER_INPUT}
                      onChange={(event) => commitNumber(event.target.value, (height) =>
                        onSpecChange(updateOpening(spec, index, { height })))}
                    />
                  </label>
                  {opening.type === "window" ? (
                    <label className="min-w-0 text-[0.62rem] font-semibold text-fg-3">
                      창턱
                      <input
                        type="number"
                        aria-label={`오프닝 ${index + 1} 창턱 높이(m)`}
                        step={0.1}
                        min={0.1}
                        value={opening.sillHeight}
                        disabled={disabled}
                        className={NUMBER_INPUT}
                        onChange={(event) => commitNumber(event.target.value, (sillHeight) =>
                          onSpecChange(updateOpening(spec, index, { sillHeight })))}
                      />
                    </label>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-line bg-card/70 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-fg">
            <Home size={13} className="text-accent" aria-hidden />
            가구 · 구조물
          </h4>
          <select
            aria-label="가구 추가"
            className={cx(SELECT_INPUT, "w-auto")}
            value=""
            disabled={disabled || spec.furniture.length >= limits.maxFurniture}
            onChange={(event) => {
              const kind = event.target.value as StudioBg3dRoomFurnitureKind | "";
              if (!kind) return;
              onSpecChange({
                ...spec,
                furniture: [...spec.furniture, { kind, x: 0, z: 0, yawDeg: 0 }],
              });
            }}
          >
            <option value="">+ 추가…</option>
            {STUDIO_BG3D_ROOM_FURNITURE_KINDS.map((kind) => (
              <option key={kind} value={kind}>{STUDIO_BG3D_ROOM_FURNITURE_LABELS[kind]}</option>
            ))}
          </select>
        </div>
        {spec.furniture.length === 0 ? (
          <p className="py-1 text-[0.66rem] leading-relaxed text-fg-3">
            테이블·의자·침대·책장·기둥·계단을 방 좌표(m)로 배치할 수 있어요.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {spec.furniture.map((item, index) => (
              <li key={index} className="grid grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_auto] items-end gap-1.5 rounded-lg border border-line/70 bg-panel/60 p-2">
                <span className="truncate text-[0.68rem] font-bold text-fg">
                  {STUDIO_BG3D_ROOM_FURNITURE_LABELS[item.kind]}
                </span>
                <label className="min-w-0 text-[0.62rem] font-semibold text-fg-3">
                  X
                  <input
                    type="number"
                    aria-label={`${STUDIO_BG3D_ROOM_FURNITURE_LABELS[item.kind]} ${index + 1} X 좌표(m)`}
                    step={0.1}
                    value={item.x}
                    disabled={disabled}
                    className={NUMBER_INPUT}
                    onChange={(event) => commitNumber(event.target.value, (x) => onSpecChange({
                      ...spec,
                      furniture: spec.furniture.map((entry, i) => (i === index ? { ...entry, x } : entry)),
                    }))}
                  />
                </label>
                <label className="min-w-0 text-[0.62rem] font-semibold text-fg-3">
                  Z
                  <input
                    type="number"
                    aria-label={`${STUDIO_BG3D_ROOM_FURNITURE_LABELS[item.kind]} ${index + 1} Z 좌표(m)`}
                    step={0.1}
                    value={item.z}
                    disabled={disabled}
                    className={NUMBER_INPUT}
                    onChange={(event) => commitNumber(event.target.value, (z) => onSpecChange({
                      ...spec,
                      furniture: spec.furniture.map((entry, i) => (i === index ? { ...entry, z } : entry)),
                    }))}
                  />
                </label>
                <label className="min-w-0 text-[0.62rem] font-semibold text-fg-3">
                  방향
                  <select
                    aria-label={`${STUDIO_BG3D_ROOM_FURNITURE_LABELS[item.kind]} ${index + 1} 방향`}
                    className={SELECT_INPUT}
                    value={String(item.yawDeg)}
                    disabled={disabled}
                    onChange={(event) => {
                      const yawDeg = Number(event.target.value);
                      onSpecChange({
                        ...spec,
                        furniture: spec.furniture.map((entry, i) => (i === index ? { ...entry, yawDeg } : entry)),
                      });
                    }}
                  >
                    {[0, 90, 180, 270].map((deg) => (
                      <option key={deg} value={String(deg)}>{deg}°</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={`${STUDIO_BG3D_ROOM_FURNITURE_LABELS[item.kind]} ${index + 1} 삭제`}
                  disabled={disabled}
                  className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-fg-3 hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => onSpecChange({
                    ...spec,
                    furniture: spec.furniture.filter((_, i) => i !== index),
                  })}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={disabled}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent bg-accent px-3 text-xs font-bold text-on-accent transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9"
        onClick={onInsert}
      >
        <Plus size={14} aria-hidden />
        방 추가 · 오브젝트 {partCount}개
      </button>
      <p className="mt-1.5 text-[0.64rem] leading-relaxed text-fg-3">
        추가된 방은 일반 도형으로 저장되어 각 벽·가구를 따로 선택해 다듬을 수 있고, Ctrl+Z 한 번에
        방 전체가 되돌아갑니다.
      </p>
    </div>
  );
}
