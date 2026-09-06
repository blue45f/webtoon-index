import {
  ArrowDown,
  ArrowUp,
  Check,
  Layers3,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useId, useState } from "react";

import { StudioThreeDToggleControl } from "../StudioThreeDToggle";

import { cn } from "@/shared/lib/utils";

const STUDIO_HYBRID_DCC_MODIFIER_KINDS = [
  "mirror",
  "array",
  "boolean",
  "solidify",
  "bevel",
  "subdivision",
  "weld",
  "decimate",
  "simple-deform",
] as const;

export type StudioHybridDccModifierKind =
  (typeof STUDIO_HYBRID_DCC_MODIFIER_KINDS)[number];

export type StudioHybridDccModifierMoveDirection = "up" | "down";
export type StudioHybridDccModifierAxis = "x" | "y" | "z";
export type StudioHybridDccModifierBooleanOperation =
  | "union"
  | "difference"
  | "intersection";

interface StudioHybridDccModifierBase {
  readonly id: string;
  readonly enabled: boolean;
  readonly diagnostic?: string | null;
}

export interface StudioHybridDccMirrorModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "mirror";
  readonly axis: StudioHybridDccModifierAxis;
  readonly merge: boolean;
  readonly mergeThreshold: number;
  readonly bisect: boolean;
  readonly clip: boolean;
}

export interface StudioHybridDccArrayModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "array";
  readonly count: number;
  readonly offset: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly mode: "linear" | "radial";
  readonly radialAngleRad?: number;
  readonly realizeInstances: boolean;
}

export interface StudioHybridDccBooleanOperandOption {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface StudioHybridDccBooleanModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "boolean";
  readonly operation: StudioHybridDccModifierBooleanOperation;
  /** Engine adapters may expose a stable object id without leaking mesh payloads into this UI. */
  readonly operandId?: string | null;
  readonly operandOptions?: readonly StudioHybridDccBooleanOperandOption[];
}

export interface StudioHybridDccSolidifyModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "solidify";
  readonly thickness: number;
  readonly evenThickness: boolean;
  readonly rim: boolean;
}

export interface StudioHybridDccBevelModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "bevel";
  readonly amount: number;
  readonly segments: number;
  readonly angleLimitRad: number;
  readonly weightInfluence: number;
}

export interface StudioHybridDccSubdivisionModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "subdivision";
  readonly levels: number;
  readonly smooth: boolean;
}

export interface StudioHybridDccWeldModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "weld";
  readonly quantum: number;
}

export interface StudioHybridDccDecimateModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "decimate";
  readonly ratio: number;
}

export type StudioHybridDccSimpleDeformMode = "twist" | "taper" | "stretch";

export interface StudioHybridDccSimpleDeformModifierView
  extends StudioHybridDccModifierBase {
  readonly kind: "simple-deform";
  readonly mode: StudioHybridDccSimpleDeformMode;
  readonly axis: StudioHybridDccModifierAxis;
  readonly angleRad: number;
  readonly factor: number;
}

export type StudioHybridDccModifierView =
  | StudioHybridDccMirrorModifierView
  | StudioHybridDccArrayModifierView
  | StudioHybridDccBooleanModifierView
  | StudioHybridDccSolidifyModifierView
  | StudioHybridDccBevelModifierView
  | StudioHybridDccSubdivisionModifierView
  | StudioHybridDccWeldModifierView
  | StudioHybridDccDecimateModifierView
  | StudioHybridDccSimpleDeformModifierView;

export interface StudioHybridDccModifierStackView {
  readonly modifiers: readonly StudioHybridDccModifierView[];
}

type StudioHybridDccEditableModifierFields<T> = T extends unknown
  ? Partial<Omit<T, "id" | "kind" | "enabled" | "diagnostic" | "operandOptions">>
  : never;

export type StudioHybridDccModifierPatch =
  StudioHybridDccEditableModifierFields<StudioHybridDccModifierView>;

export interface StudioHybridDccModifierInspectorProps {
  readonly stack: StudioHybridDccModifierStackView;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly className?: string;
  readonly onAdd: (kind: StudioHybridDccModifierKind) => void;
  readonly onToggle: (id: string) => void;
  readonly onMove: (id: string, direction: StudioHybridDccModifierMoveDirection) => void;
  readonly onRemove: (id: string) => void;
  readonly onPatch: (id: string, patch: StudioHybridDccModifierPatch) => void;
  readonly onApply: () => void;
}

const MODIFIER_COPY: Readonly<Record<
  StudioHybridDccModifierKind,
  {
    readonly label: string;
    readonly technical: string;
    readonly description: string;
  }
>> = {
  mirror: {
    label: "대칭 복사",
    technical: "Mirror",
    description: "한쪽 모양을 기준 축 반대편에 복사합니다.",
  },
  array: {
    label: "반복 배열",
    technical: "Array",
    description: "같은 모양을 일정한 간격이나 원형으로 반복합니다.",
  },
  boolean: {
    label: "형태 합치기·빼기",
    technical: "Boolean",
    description: "다른 오브젝트와 합치거나 겹친 부분을 도려냅니다.",
  },
  solidify: {
    label: "두께 만들기",
    technical: "Solidify",
    description: "얇은 면에 실제 두께와 가장자리를 만듭니다.",
  },
  bevel: {
    label: "모서리 다듬기",
    technical: "Bevel",
    description: "날카로운 모서리를 정확한 한 단계 절삭으로 다듬습니다.",
  },
  subdivision: {
    label: "세분화",
    technical: "Subdivision",
    description: "면을 잘게 나누고 부드럽게 만들어 둥근 형태로 다듬습니다.",
  },
  weld: {
    label: "버텍스 병합",
    technical: "Weld",
    description: "가까운 꼭짓점을 하나로 합쳐 구멍과 틈을 정리합니다.",
  },
  decimate: {
    label: "면수 축소",
    technical: "Decimate",
    description: "삼각형 수를 줄여 장면을 가볍게 만듭니다.",
  },
  "simple-deform": {
    label: "변형(비틀기·테이퍼)",
    technical: "Simple Deform",
    description: "오브젝트 축을 따라 비틀거나, 한쪽을 좁히거나, 늘입니다.",
  },
};

const CONTROL_CLASS =
  "min-h-11 w-full min-w-0 rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none transition-[border-color,background-color] duration-150 hover:bg-raised focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none";

interface ModifierNumberFieldProps {
  readonly label: string;
  readonly visibleLabel?: string;
  readonly description?: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly disabled: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}

function ModifierNumberField({
  label,
  visibleLabel,
  description,
  value,
  onChange,
  disabled,
  min,
  max,
  step,
  unit,
}: ModifierNumberFieldProps) {
  return (
    <label className="block min-w-0 text-xs font-medium text-fg-2">
      <span className="mb-1.5 block break-words [overflow-wrap:anywhere]">
        {visibleLabel ?? label}
      </span>
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <input
          type="number"
          aria-label={label}
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className={CONTROL_CLASS}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {unit ? <span className="shrink-0 text-[0.6875rem] text-fg-3">{unit}</span> : null}
      </span>
      {description ? (
        <span className="mt-1.5 block break-words text-[0.6875rem] font-normal leading-relaxed text-fg-3 [overflow-wrap:anywhere]">
          {description}
        </span>
      ) : null}
    </label>
  );
}

interface ModifierSelectFieldProps<T extends string> {
  readonly label: string;
  readonly visibleLabel?: string;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled: boolean;
  readonly options: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean }[];
}

function ModifierSelectField<T extends string>({
  label,
  visibleLabel,
  value,
  onChange,
  disabled,
  options,
}: ModifierSelectFieldProps<T>) {
  return (
    <label className="block min-w-0 text-xs font-medium text-fg-2">
      <span className="mb-1.5 block break-words [overflow-wrap:anywhere]">
        {visibleLabel ?? label}
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        className={CONTROL_CLASS}
        onChange={(event) => onChange(event.currentTarget.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function modifierInstanceName(kind: StudioHybridDccModifierKind, index: number): string {
  return `${index + 1}단계 ${MODIFIER_COPY[kind].label}`;
}

function ModifierToggleField({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly description: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <StudioThreeDToggleControl
      checked={checked}
      disabled={disabled}
      label={label}
      description={description}
      className="min-h-11 rounded-lg bg-canvas/35 px-3 py-2 hover:bg-raised"
      labelClassName="text-xs font-semibold text-fg"
      descriptionClassName="text-[0.6875rem] leading-relaxed text-fg-3"
      onChange={onChange}
    />
  );
}

function ModifierParameters({
  modifier,
  instanceName,
  busy,
  onPatch,
}: {
  readonly modifier: StudioHybridDccModifierView;
  readonly instanceName: string;
  readonly busy: boolean;
  readonly onPatch: (patch: StudioHybridDccModifierPatch) => void;
}) {
  if (modifier.kind === "mirror") {
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierSelectField
          label={`${instanceName} 기준 축`}
          visibleLabel="기준 축"
          value={modifier.axis}
          disabled={busy}
          options={[
            { value: "x", label: "좌우 · X축" },
            { value: "y", label: "위아래 · Y축" },
            { value: "z", label: "앞뒤 · Z축" },
          ]}
          onChange={(axis) => onPatch({ axis })}
        />
        <ModifierNumberField
          label={`${instanceName} 합칠 거리`}
          visibleLabel="합칠 거리"
          value={modifier.mergeThreshold}
          min={0}
          step={0.0001}
          unit="m"
          disabled={busy || !modifier.merge}
          onChange={(mergeThreshold) => onPatch({ mergeThreshold })}
        />
        <ModifierToggleField
          checked={modifier.merge}
          disabled={busy}
          label={`${instanceName} 가운데 점 합치기`}
          description="축 위에서 만나는 점을 하나로 정리합니다."
          onChange={(merge) => onPatch({ merge })}
        />
        <ModifierToggleField
          checked={modifier.clip}
          disabled={busy}
          label={`${instanceName} 기준 축 넘지 않기`}
          description="편집 중인 점이 대칭 축을 지나가지 않게 붙잡습니다."
          onChange={(clip) => onPatch({ clip })}
        />
        <ModifierToggleField
          checked={modifier.bisect}
          disabled={busy}
          label={`${instanceName} 축에서 자른 뒤 복사`}
          description="축 반대편의 기존 모양을 잘라 겹침을 줄입니다."
          onChange={(bisect) => onPatch({ bisect })}
        />
      </div>
    );
  }

  if (modifier.kind === "array") {
    const angleDeg = (modifier.radialAngleRad ?? Math.PI * 2) * 180 / Math.PI;
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierSelectField
          label={`${instanceName} 반복 방식`}
          visibleLabel="반복 방식"
          value={modifier.mode}
          disabled={busy}
          options={[
            { value: "linear", label: "일렬로 반복" },
            { value: "radial", label: "원형으로 반복" },
          ]}
          onChange={(mode) => onPatch({ mode })}
        />
        <ModifierNumberField
          label={`${instanceName} 전체 개수`}
          visibleLabel="전체 개수"
          value={modifier.count}
          min={1}
          max={64}
          step={1}
          unit="개"
          disabled={busy}
          onChange={(count) => onPatch({ count: Math.max(1, Math.trunc(count)) })}
        />
        <fieldset className="min-w-0 sm:col-span-2">
          <legend className="mb-1.5 text-xs font-medium text-fg-2">
            {instanceName} 반복 간격
          </legend>
          <div className="grid min-w-0 grid-cols-1 gap-2 min-[480px]:grid-cols-3">
            {(["x", "y", "z"] as const).map((axis) => (
              <ModifierNumberField
                key={axis}
                label={`${instanceName} 간격 ${axis.toUpperCase()}`}
                visibleLabel={`${axis.toUpperCase()}축 간격`}
                value={modifier.offset[axis]}
                step={0.1}
                unit="m"
                disabled={busy}
                onChange={(value) => onPatch({
                  offset: { ...modifier.offset, [axis]: value },
                })}
              />
            ))}
          </div>
        </fieldset>
        {modifier.mode === "radial" ? (
          <ModifierNumberField
            label={`${instanceName} 원형 전체 각도`}
            visibleLabel="원형 전체 각도"
            value={angleDeg}
            min={0.1}
            max={360}
            step={1}
            unit="°"
            disabled={busy}
            onChange={(value) => onPatch({ radialAngleRad: value * Math.PI / 180 })}
          />
        ) : null}
        <ModifierToggleField
          checked={modifier.realizeInstances}
          disabled={busy}
          label={`${instanceName} 복사본을 실제 메시로 만들기`}
          description="다음 변형이 각 복사본의 점과 면을 직접 다룰 수 있게 합니다."
          onChange={(realizeInstances) => onPatch({ realizeInstances })}
        />
      </div>
    );
  }

  if (modifier.kind === "boolean") {
    const operandOptions = modifier.operandOptions ?? [];
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierSelectField
          label={`${instanceName} 계산 방식`}
          visibleLabel="계산 방식"
          value={modifier.operation}
          disabled={busy}
          options={[
            { value: "union", label: "두 형태 합치기" },
            { value: "difference", label: "현재 오브젝트에서 대상 오브젝트 빼기" },
            { value: "intersection", label: "겹친 부분만 남기기" },
          ]}
          onChange={(operation) => onPatch({ operation })}
        />
        <label className="block min-w-0 text-xs font-medium text-fg-2">
          <span className="mb-1.5 block">대상 오브젝트</span>
          {operandOptions.length > 0 ? (
            <select
              aria-label={`${instanceName} 대상 오브젝트`}
              value={modifier.operandId ?? ""}
              disabled={busy}
              className={CONTROL_CLASS}
              onChange={(event) => onPatch({ operandId: event.currentTarget.value || null })}
            >
              <option value="">대상을 선택하세요</option>
              {operandOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <span
              role="status"
              className="flex min-h-11 items-center rounded-lg border border-dashed border-line bg-canvas/35 px-3 text-[0.6875rem] font-normal leading-relaxed text-fg-3"
            >
              먼저 장면에 다른 오브젝트를 하나 추가하세요.
            </span>
          )}
          <span className="mt-1.5 block break-words text-[0.6875rem] leading-relaxed text-fg-3 [overflow-wrap:anywhere]">
            원본은 그대로 두고 선택한 대상과의 계산 결과만 미리 보여 줍니다.
          </span>
        </label>
      </div>
    );
  }

  if (modifier.kind === "solidify") {
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierNumberField
          label={`${instanceName} 두께`}
          visibleLabel="두께"
          value={modifier.thickness}
          step={0.01}
          unit="m"
          disabled={busy}
          onChange={(thickness) => onPatch({ thickness })}
        />
        <ModifierToggleField
          checked={modifier.evenThickness}
          disabled={busy}
          label={`${instanceName} 두께를 고르게 유지`}
          description="기울어진 면에서도 보이는 두께 차이를 줄입니다."
          onChange={(evenThickness) => onPatch({ evenThickness })}
        />
        <ModifierToggleField
          checked={modifier.rim}
          disabled={busy}
          label={`${instanceName} 열린 가장자리 막기`}
          description="앞면과 뒷면 사이에 옆면을 만들어 빈 틈을 닫습니다."
          onChange={(rim) => onPatch({ rim })}
        />
      </div>
    );
  }

  if (modifier.kind === "subdivision") {
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierNumberField
          label={`${instanceName} 세분화 단계`}
          visibleLabel="세분화 단계"
          description="단계가 높을수록 촘촘하지만 계산량이 늘어납니다."
          value={modifier.levels}
          min={1}
          max={3}
          step={1}
          unit="단계"
          disabled={busy}
          onChange={(levels) => onPatch({ levels })}
        />
        <ModifierToggleField
          checked={modifier.smooth}
          disabled={busy}
          label={`${instanceName} 부드럽게 만들기`}
          description="끄면 면 분할만 하고, 켜면 전체적으로 둥글게 말립니다."
          onChange={(smooth) => onPatch({ smooth })}
        />
      </div>
    );
  }

  if (modifier.kind === "weld") {
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierNumberField
          label={`${instanceName} 병합 거리`}
          visibleLabel="병합 거리"
          description="이 거리보다 가까운 꼭짓점을 하나로 합칩니다."
          value={modifier.quantum}
          min={0.000001}
          step={0.0001}
          unit="m"
          disabled={busy}
          onChange={(quantum) => onPatch({ quantum })}
        />
      </div>
    );
  }

  if (modifier.kind === "decimate") {
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierNumberField
          label={`${instanceName} 유지 비율`}
          visibleLabel="유지 비율"
          description="원본 삼각형 중 남길 비율입니다. 0.05~0.95."
          value={modifier.ratio}
          min={0.05}
          max={0.95}
          step={0.05}
          disabled={busy}
          onChange={(ratio) => onPatch({ ratio })}
        />
      </div>
    );
  }

  if (modifier.kind === "simple-deform") {
    const angleDeg = modifier.angleRad * 180 / Math.PI;
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ModifierSelectField
          label={`${instanceName} 변형 종류`}
          visibleLabel="변형 종류"
          value={modifier.mode}
          disabled={busy}
          options={[
            { value: "twist", label: "비틀기" },
            { value: "taper", label: "테이퍼(한쪽 좁히기)" },
            { value: "stretch", label: "늘리기" },
          ]}
          onChange={(mode) => onPatch({ mode })}
        />
        <ModifierSelectField
          label={`${instanceName} 기준 축`}
          visibleLabel="기준 축"
          value={modifier.axis}
          disabled={busy}
          options={[
            { value: "x", label: "X축" },
            { value: "y", label: "Y축" },
            { value: "z", label: "Z축" },
          ]}
          onChange={(axis) => onPatch({ axis })}
        />
        {modifier.mode === "twist" ? (
          <ModifierNumberField
            label={`${instanceName} 비틀 각도`}
            visibleLabel="비틀 각도"
            description="끝까지 갔을 때의 회전 각도입니다."
            value={angleDeg}
            min={-1440}
            max={1440}
            step={5}
            unit="°"
            disabled={busy}
            onChange={(value) => onPatch({ angleRad: value * Math.PI / 180 })}
          />
        ) : (
          <ModifierNumberField
            label={`${instanceName} 변형 세기`}
            visibleLabel={modifier.mode === "taper" ? "끝 지점 크기 배율" : "축 방향 늘림 배율"}
            description={modifier.mode === "taper"
              ? "1이 원본이며, 작게 주면 한쪽이 좁아집니다."
              : "1이 원본이며, 크게 주면 길어집니다."}
            value={modifier.factor}
            min={0.001}
            max={100}
            step={0.05}
            unit="×"
            disabled={busy}
            onChange={(factor) => onPatch({ factor })}
          />
        )}
      </div>
    );
  }

  const angleDeg = modifier.angleLimitRad * 180 / Math.PI;
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <ModifierNumberField
        label={`${instanceName} 모서리 폭`}
        visibleLabel="모서리 폭"
        value={modifier.amount}
        min={0}
        step={0.01}
        unit="m"
        disabled={busy}
        onChange={(amount) => onPatch({ amount })}
      />
      <ModifierNumberField
        label={`${instanceName} 분할 수`}
        visibleLabel="둥글기 단계 (현재 1단계)"
        description="정확한 다단계 토폴로지가 준비될 때까지 안전한 1단계로 고정됩니다."
        value={modifier.segments}
        min={1}
        max={1}
        step={1}
        unit="단계"
        disabled
        onChange={() => onPatch({ segments: 1 })}
      />
      <ModifierNumberField
        label={`${instanceName} 적용 각도`}
        visibleLabel="적용할 모서리 각도"
        description="이 각도보다 날카로운 모서리를 다듬습니다."
        value={angleDeg}
        min={0}
        max={180}
        step={1}
        unit="°"
        disabled={busy}
        onChange={(value) => onPatch({ angleLimitRad: value * Math.PI / 180 })}
      />
      <ModifierNumberField
        label={`${instanceName} 가중치 영향`}
        visibleLabel="그려 둔 모서리 가중치"
        description="모서리에 따로 지정한 강도를 결과에 얼마나 반영할지 정합니다."
        value={modifier.weightInfluence}
        min={0}
        max={1}
        step={0.05}
        disabled={busy}
        onChange={(weightInfluence) => onPatch({ weightInfluence })}
      />
    </div>
  );
}

function ModifierRow({
  modifier,
  index,
  count,
  busy,
  onToggle,
  onMove,
  onRemove,
  onPatch,
}: {
  readonly modifier: StudioHybridDccModifierView;
  readonly index: number;
  readonly count: number;
  readonly busy: boolean;
  readonly onToggle: (id: string) => void;
  readonly onMove: (id: string, direction: StudioHybridDccModifierMoveDirection) => void;
  readonly onRemove: (id: string) => void;
  readonly onPatch: (id: string, patch: StudioHybridDccModifierPatch) => void;
}) {
  const copy = MODIFIER_COPY[modifier.kind];
  const instanceName = modifierInstanceName(modifier.kind, index);
  const parameterId = useId();

  return (
    <li
      className="min-w-0 px-3 py-3"
      data-studio-hybrid-dcc-modifier={modifier.kind}
      data-modifier-id={modifier.id}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <StudioThreeDToggleControl
          checked={modifier.enabled}
          disabled={busy}
          label={(
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-semibold text-fg">{instanceName}</span>
              <span
                aria-hidden="true"
                className="font-[var(--font-display)] text-[0.625rem] tracking-[0.08em] text-fg-3"
              >
                {copy.technical}
              </span>
            </span>
          )}
          description={copy.description}
          className="min-h-11 min-w-0 flex-1 rounded-lg px-1 py-1 hover:bg-raised"
          labelClassName="text-xs"
          descriptionClassName="text-[0.6875rem] leading-relaxed text-fg-3"
          onChange={() => onToggle(modifier.id)}
        />
        <div className="grid shrink-0 grid-cols-3 gap-1.5 self-end sm:self-start" role="group" aria-label={`${instanceName} 순서와 삭제`}>
          <button
            type="button"
            aria-label={`${instanceName} 위로 이동`}
            title="한 단계 위로"
            disabled={busy || index === 0}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-card text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
            onClick={() => onMove(modifier.id, "up")}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`${instanceName} 아래로 이동`}
            title="한 단계 아래로"
            disabled={busy || index === count - 1}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-card text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
            onClick={() => onMove(modifier.id, "down")}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`${instanceName} 삭제`}
            title="변형 삭제"
            disabled={busy}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-card text-fg-3 hover:border-bad/50 hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
            onClick={() => onRemove(modifier.id)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <fieldset
        id={parameterId}
        disabled={busy}
        className="mt-3 min-w-0 border-t border-line pt-3"
        aria-label={`${instanceName} 설정`}
      >
        <ModifierParameters
          modifier={modifier}
          instanceName={instanceName}
          busy={busy}
          onPatch={(patch) => onPatch(modifier.id, patch)}
        />
      </fieldset>

      {modifier.diagnostic ? (
        <p
          role="status"
          className="mt-3 break-words rounded-lg bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn [overflow-wrap:anywhere]"
        >
          {modifier.diagnostic}
        </p>
      ) : null}
    </li>
  );
}

export function StudioHybridDccModifierInspector({
  stack,
  busy = false,
  error = null,
  className,
  onAdd,
  onToggle,
  onMove,
  onRemove,
  onPatch,
  onApply,
}: StudioHybridDccModifierInspectorProps) {
  const titleId = useId();
  const applyDescriptionId = useId();
  const [addKind, setAddKind] = useState<StudioHybridDccModifierKind>("mirror");
  const modifiers = stack.modifiers;
  const empty = modifiers.length === 0;

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      data-studio-hybrid-dcc-modifier-inspector="true"
      className={cn(
        "w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-line bg-panel text-fg",
        className,
      )}
    >
      <header className="min-w-0 px-3 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
            <Layers3 size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="break-words text-sm font-semibold tracking-tight [overflow-wrap:anywhere]">
              비파괴 변형 스택
            </h3>
            <p className="mt-1 break-words text-xs leading-relaxed text-fg-3 [overflow-wrap:anywhere]">
              위에서 아래 순서로 결과를 겹쳐 미리 봅니다. 적용하기 전에는 원본 메시를 바꾸지 않습니다.
            </p>
          </div>
          <span className="inline-flex min-h-7 shrink-0 items-center rounded-full border border-good/35 bg-good/10 px-2 text-[0.625rem] font-bold text-good">
            확정 전 원본 보존
          </span>
        </div>

        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
          <label className="min-w-0">
            <span className="sr-only">추가할 변형 종류</span>
            <select
              aria-label="추가할 변형 종류"
              value={addKind}
              disabled={busy}
              className={CONTROL_CLASS}
              onChange={(event) => setAddKind(event.currentTarget.value as StudioHybridDccModifierKind)}
            >
              {STUDIO_HYBRID_DCC_MODIFIER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {MODIFIER_COPY[kind].label} · {MODIFIER_COPY[kind].technical}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg border border-line-strong bg-raised px-3 text-xs font-semibold text-fg hover:border-accent/45 hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => onAdd(addKind)}
          >
            <Plus size={16} aria-hidden="true" />
            변형 추가
          </button>
        </div>
      </header>

      {busy ? (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex min-h-11 items-center gap-2 border-t border-line bg-cool/10 px-3 py-2 text-xs leading-relaxed text-cool"
        >
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-cool motion-reduce:animate-none" aria-hidden="true" />
          변형 미리보기를 계산하고 있습니다. 현재 설정은 그대로 보존됩니다.
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="min-w-0 border-t border-bad/35 bg-bad/10 px-3 py-3 text-bad"
        >
          <p className="flex items-center gap-2 text-xs font-semibold">
            <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
            미리보기를 계산하지 못했습니다
          </p>
          <p className="mt-1 break-words text-xs leading-relaxed [overflow-wrap:anywhere]">
            {error} 설정을 수정하거나 문제가 된 변형을 잠시 끈 뒤 다시 확인해 주세요.
          </p>
        </div>
      ) : null}

      {empty ? (
        <div className="border-y border-line px-4 py-7 text-center" data-studio-hybrid-dcc-modifier-empty="true">
          <p className="text-sm font-semibold text-fg">아직 쌓인 변형이 없습니다</p>
          <p className="mx-auto mt-1 max-w-[32ch] text-xs leading-relaxed text-fg-3">
            대칭, 반복, 두께 같은 작업을 추가하면 원본을 지키면서 결과를 비교할 수 있습니다.
          </p>
        </div>
      ) : (
        <ol className="min-w-0 divide-y divide-line border-y border-line" aria-label="비파괴 변형 순서">
          {modifiers.map((modifier, index) => (
            <ModifierRow
              key={modifier.id}
              modifier={modifier}
              index={index}
              count={modifiers.length}
              busy={busy}
              onToggle={onToggle}
              onMove={onMove}
              onRemove={onRemove}
              onPatch={onPatch}
            />
          ))}
        </ol>
      )}

      <footer className="min-w-0 px-3 py-3">
        <p
          id={applyDescriptionId}
          className="break-words text-[0.6875rem] leading-relaxed text-fg-3 [overflow-wrap:anywhere]"
        >
          확정 전에는 설정을 언제든 바꿀 수 있습니다. 확정하면 지금 보이는 결과가 새 원본 메시가 되고 목록은 정리되며, 이후에는 ‘되돌리기’로 이전 변형 목록을 복구할 수 있습니다.
        </p>
        <button
          type="button"
          disabled={busy || empty}
          aria-describedby={applyDescriptionId}
          className="mt-3 inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent shadow-[0_5px_16px_oklch(0.08_0.008_70/0.28)] transition-[background-color,transform] duration-150 hover:bg-accent-2 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
          onClick={onApply}
        >
          <Check size={17} aria-hidden="true" />
          적용해 원본 메시로 확정
        </button>
      </footer>
    </section>
  );
}
