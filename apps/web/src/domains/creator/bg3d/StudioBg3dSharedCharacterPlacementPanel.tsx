import { Check, LocateFixed, RotateCcw, UserRound, XCircle } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import {
  studioShared3dCharacterWorldTransform,
} from "../studio-shared-3d-scene-runtime";

import type { StudioBg3dSharedCharacterGroundingResult } from "./studio-bg3d-shared-character-grounding";
import type {
  StudioShared3dCharacterRuntimeStatus,
  StudioShared3dCharacterSource,
  StudioShared3dCharacterStageTransform,
  StudioShared3dCharacterTransformCommitHandler,
} from "../studio-shared-3d-scene-bridge";

import { cn } from "@/shared/lib/utils";

export interface StudioBg3dSharedCharacterPlacementPanelProps {
  readonly characters: readonly StudioShared3dCharacterSource[];
  readonly statuses: Readonly<
    Record<string, StudioShared3dCharacterRuntimeStatus | undefined>
  >;
  readonly selectedElementId: string | null;
  readonly disabled?: boolean;
  readonly grounding?: StudioBg3dSharedCharacterGroundingResult;
  readonly onSelect: (elementId: string) => void;
  readonly onCommit: StudioShared3dCharacterTransformCommitHandler;
}

interface PlacementNotice {
  readonly elementId: string;
  readonly tone: "error" | "success";
  readonly message: string;
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly disabled: boolean;
  /** Return false when the canonical Studio writeback rejected this draft. */
  readonly onCommit: (value: number) => boolean;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

function PlacementNumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onCommit,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => formatNumber(value));

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      setDraft(formatNumber(value));
      return;
    }
    const normalized = Math.min(max, Math.max(min, parsed));
    const accepted = onCommit(normalized);
    setDraft(formatNumber(accepted ? normalized : value));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatNumber(value));
    }
  };

  return (
    <label className="min-w-0">
      <span className="mb-1 flex items-center justify-between gap-2 text-[0.66rem] font-semibold text-fg-3">
        <span>{label}</span>
        <span aria-hidden>{unit}</span>
      </span>
      <input
        type="number"
        aria-label={`${label} (${unit})`}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-card px-2 text-right text-xs font-semibold tabular-nums text-fg transition-colors focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}

function statusCopy(status: StudioShared3dCharacterRuntimeStatus | undefined): string {
  if (status === "ready") return "표시 준비됨";
  if (status === "unavailable") return "모델 확인 필요";
  return "불러오는 중";
}

export function StudioBg3dSharedCharacterPlacementPanel({
  characters,
  statuses,
  selectedElementId,
  disabled = false,
  grounding,
  onSelect,
  onCommit,
}: StudioBg3dSharedCharacterPlacementPanelProps) {
  const [notice, setNotice] = useState<PlacementNotice | null>(null);
  const selected = characters.find(({ elementId }) => elementId === selectedElementId)
    ?? characters[0]
    ?? null;

  if (!selected) return null;
  const world = studioShared3dCharacterWorldTransform(
    selected.scene,
    selected.stageTransform,
  );
  const transform: StudioShared3dCharacterStageTransform = {
    position: world.position,
    rotationY: world.rotation[1],
  };
  const runtimeStatus = statuses[selected.runtimeKey];
  const previewOnly = selected.compatibility.previewOmissions.length > 0;
  const editorDisabled = disabled || runtimeStatus === "unavailable" || previewOnly;
  const groundingReceipt = grounding?.ok
    && grounding.receipt.identity.elementId === selected.elementId
    && grounding.receipt.identity.modelRuntimeKey === selected.modelRuntimeKey
    && grounding.receipt.identity.placementHash === selected.placementHash
    ? grounding.receipt
    : null;
  const groundingGapCentimeters = groundingReceipt
    ? Math.abs(groundingReceipt.gapY * 100)
    : 0;
  const groundingMessage = groundingReceipt
    ? groundingReceipt.diagnosis === "grounded"
      ? "발과 배경 표면이 자연스럽게 맞닿아 있어요."
      : groundingReceipt.diagnosis === "floating"
        ? `발이 배경 표면에서 ${formatNumber(groundingGapCentimeters)}cm 떠 있어요.`
        : `발이 배경 표면 아래로 ${formatNumber(groundingGapCentimeters)}cm 들어가 있어요.`
    : grounding && !grounding.ok
      ? "자동으로 옮길 수 있는 안전 범위를 벗어났어요. 높이 Y를 직접 조정해 주세요."
      : "캐릭터의 발과 배경 표면을 확인하는 중이에요.";

  const commitTransform = (next: StudioShared3dCharacterStageTransform) => {
    const result = onCommit({
      elementId: selected.elementId,
      expectedRuntimeKey: selected.runtimeKey,
      expectedPlacementHash: selected.placementHash,
      transform: next,
    });
    if (!result.ok) {
      setNotice({ elementId: selected.elementId, tone: "error", message: result.message });
      return false;
    }
    setNotice({
      elementId: selected.elementId,
      tone: "success",
      message: result.changed
        ? result.receipt.authority === "stage-override"
          ? `${selected.label} 위치를 이 배경 미리보기에 반영했어요. 아래 적용을 누르면 배경 결과와 함께 저장돼요. 다른 배경과 캐릭터 원본은 그대로예요.`
          : `${selected.label} 배치를 캐릭터 원본에 저장했어요. Studio 되돌리기로 복구할 수 있어요.`
        : "이미 같은 배치 값이에요.",
    });
    return true;
  };
  const updatePosition = (axis: 0 | 1 | 2, value: number) => {
    const next = [...transform.position] as [number, number, number];
    next[axis] = value;
    return commitTransform({ ...transform, position: next });
  };

  return (
    <section
      aria-label="배경과 캐릭터 함께 배치"
      data-testid="studio-bg3d-shared-character-placement"
      className="border-b border-line pb-4"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <UserRound size={15} className="shrink-0 text-accent" aria-hidden />
            배경과 캐릭터 함께 배치
          </h3>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
            {previewOnly
              ? "선택한 캐릭터는 현재 모습과 위치를 확인만 할 수 있어요. 미리보기 전용 캐릭터는 이번 배경 연결에 저장되지 않습니다."
              : "이 배경에서만 위치와 방향을 맞춰요. 캐릭터 원본과 다른 배경은 바뀌지 않으며, 아래 적용을 누를 때 배경 결과와 함께 저장돼요."}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-card px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
          {characters.length}명
        </span>
      </div>

      <div className="flex snap-x gap-2 overflow-x-auto pb-2" role="list" aria-label="공유 캐릭터 목록">
        {characters.map((character) => {
          const active = character.elementId === selected.elementId;
          const status = statuses[character.runtimeKey];
          const characterTransform = studioShared3dCharacterWorldTransform(
            character.scene,
            character.stageTransform,
          );
          return (
            <div key={character.elementId} role="listitem" className="min-w-[9.5rem] snap-start">
              <button
                type="button"
                aria-label={`${character.label} · ${statusCopy(status)}`}
                aria-pressed={active}
                disabled={disabled}
                className={cn(
                  "min-h-11 w-full rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                  active
                    ? "border-accent/60 bg-accent-soft text-accent"
                    : "border-line bg-card text-fg-2 hover:bg-raised",
                )}
                onClick={() => {
                  setNotice(null);
                  onSelect(character.elementId);
                }}
              >
                <span className="block truncate text-xs font-bold">{character.label}</span>
                <span className="mt-0.5 block text-[0.62rem] text-fg-3">
                  {statusCopy(status)} · X {formatNumber(characterTransform.position[0])} · Z {formatNumber(characterTransform.position[2])}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-2 rounded-lg border border-line bg-raised/55 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-fg">{selected.label}</p>
            <p className="mt-0.5 text-[0.64rem] text-fg-3">{statusCopy(runtimeStatus)}</p>
          </div>
          <span className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[0.62rem] font-semibold",
            runtimeStatus === "ready"
              ? "border-success/55 bg-success/15 text-success"
              : runtimeStatus === "unavailable"
                ? "border-danger/35 bg-danger/10 text-danger"
                : "border-line bg-card text-fg-3",
          )}>
            {runtimeStatus === "ready" ? <Check size={11} aria-hidden /> : null}
            {runtimeStatus === "unavailable" ? <XCircle size={11} aria-hidden /> : null}
            {runtimeStatus === "ready"
              ? "렌더 준비 완료"
              : runtimeStatus === "unavailable"
                ? "3D 표시 확인 필요"
                : "3D 불러오는 중"}
          </span>
        </div>

        <div
          data-testid="studio-bg3d-shared-character-grounding"
          data-grounding-diagnosis={groundingReceipt?.diagnosis ?? "measuring"}
          className={cn(
            "mb-3 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[0.66rem] leading-relaxed",
            groundingReceipt?.diagnosis === "grounded"
              ? "border-success/35 bg-success/10 text-success"
              : groundingReceipt
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-line bg-card text-fg-3",
          )}
        >
          <LocateFixed size={13} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold">
              {groundingReceipt?.diagnosis === "grounded"
                ? "배경에 접지됨"
                : groundingReceipt?.diagnosis === "floating"
                  ? "바닥에서 떠 있음"
                  : groundingReceipt?.diagnosis === "penetrating"
                    ? "바닥과 겹침"
                    : "바닥 확인 중"}
            </p>
            <p className="mt-0.5">{groundingMessage}</p>
            {groundingReceipt?.surface.source === "stage-plane" ? (
              <p className="mt-0.5 text-fg-3">맞닿을 배경 도형이 없어 기본 스테이지 바닥을 기준으로 계산했어요.</p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PlacementNumberField
            key={`${selected.placementHash}:x`}
            label="좌우 X"
            value={transform.position[0]}
            min={-10}
            max={10}
            step={0.05}
            unit="m"
            disabled={editorDisabled}
            onCommit={(value) => updatePosition(0, value)}
          />
          <PlacementNumberField
            key={`${selected.placementHash}:y`}
            label="높이 Y"
            value={transform.position[1]}
            min={-10}
            max={10}
            step={0.05}
            unit="m"
            disabled={editorDisabled}
            onCommit={(value) => updatePosition(1, value)}
          />
          <PlacementNumberField
            key={`${selected.placementHash}:z`}
            label="앞뒤 Z"
            value={transform.position[2]}
            min={-10}
            max={10}
            step={0.05}
            unit="m"
            disabled={editorDisabled}
            onCommit={(value) => updatePosition(2, value)}
          />
          <PlacementNumberField
            key={`${selected.placementHash}:yaw`}
            label="바라보는 방향"
            value={transform.rotationY * 180 / Math.PI}
            min={-180}
            max={180}
            step={1}
            unit="°"
            disabled={editorDisabled}
            onCommit={(value) => commitTransform({
              ...transform,
              rotationY: value * Math.PI / 180,
            })}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={editorDisabled || !groundingReceipt?.didMove}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9"
            onClick={() => {
              if (!groundingReceipt?.didMove) return;
              commitTransform({
                ...transform,
                position: [
                  transform.position[0],
                  groundingReceipt.placementY,
                  transform.position[2],
                ],
              });
            }}
          >
            <LocateFixed size={14} aria-hidden />
            배경 표면에 맞추기
          </button>
          <button
            type="button"
            disabled={editorDisabled}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9"
            onClick={() => commitTransform({ position: [0, 0, 0], rotationY: 0 })}
          >
            <RotateCcw size={14} aria-hidden />
            배치 초기화
          </button>
        </div>
      </div>

      {previewOnly ? (
        <p
          role="note"
          aria-label="미리보기 전용 캐릭터 안내"
          className="mt-2 text-[0.66rem] leading-relaxed text-warning"
        >
          이 캐릭터는 의상·소품 등 고급 상태 {selected.compatibility.previewOmissions.length}개 때문에 미리보기 전용입니다. 캐릭터와 배치는 이번 연결에 저장되지 않아요. 배경만 적용하거나, 캐릭터 편집기에서 고급 상태를 정리한 뒤 다시 연결해 주세요.
        </p>
      ) : null}
      {notice?.elementId === selected.elementId ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mt-2 text-[0.68rem] leading-relaxed",
            notice.tone === "error" ? "text-danger" : "text-success",
          )}
        >
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}
